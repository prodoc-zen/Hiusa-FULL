<?php

namespace App\Console\Commands;

use App\Models\College;
use App\Models\Organization;
use Illuminate\Console\Command;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SyncColleges extends Command
{
    protected $signature = 'colleges:sync {file : Text file, one college per line as "Name", "Name,CODE" or "Name, with commas | CODE"} {--dry-run}';

    protected $description = 'Add the colleges in a text file, with their home organizations, without touching the ones already there';

    public function handle(): int
    {
        $path = $this->argument('file');
        $contents = is_file($path) && is_readable($path) ? file_get_contents($path) : false;

        if ($contents === false) {
            $this->error("Cannot read the file {$path}.");

            return Command::FAILURE;
        }

        [$entries, $errors] = $this->parse($contents);

        if (! $errors && ! $entries) {
            $errors[] = 'The list has no colleges.';
        }

        $existing = College::orderBy('id')->get();
        $byName = [];
        $byLooseName = [];
        $codeOwners = [];

        foreach ($existing as $college) {
            $key = $this->fold($college->name);

            if (isset($byName[$key])) {
                $errors[] = "The database already holds two colleges that differ only by case or spacing: \"{$byName[$key]->name}\" and \"{$college->name}\". Fix that by hand first.";
            }

            $byName[$key] = $college;
            $byLooseName[$this->looseFold($college->name)] = $college;

            if (! $this->isBlank($college->code)) {
                $codeOwners[mb_strtoupper(trim($college->code))] = $college;
            }
        }

        if (! $errors) {
            foreach ($entries as $entry) {
                $college = $byName[$this->fold($entry['name'])] ?? null;
                $receivesCode = $entry['code'] !== null && ($college === null || $this->isBlank($college->code));
                $owner = $receivesCode ? ($codeOwners[$entry['code']] ?? null) : null;

                if ($owner) {
                    $errors[] = "The code {$entry['code']} already belongs to \"{$owner->name}\", so line {$entry['line']} cannot use it.";
                }

                if ($college === null) {
                    $clash = College::where('name', $entry['name'])->first() ?? $byLooseName[$this->looseFold($entry['name'])] ?? null;

                    if ($clash && preg_match('/[\p{Cf}\p{Cc}]/u', $clash->name)) {
                        $errors[] = "Line {$entry['line']} \"{$entry['name']}\" collides with the existing college \"{$clash->name}\", which contains an invisible character and must be fixed by hand in the database first. The database treats it as equal to the new name and would refuse it.";
                    } elseif ($clash) {
                        $errors[] = "Line {$entry['line']} \"{$entry['name']}\" collides with the existing college \"{$clash->name}\": the database treats accents as equal, so it would refuse the new name. Write the line exactly like the existing name, or remove it.";
                    }
                }
            }
        }

        if ($errors) {
            foreach ($errors as $error) {
                $this->error($error);
            }

            $this->error('Nothing was written.');

            return Command::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');
        $counts = ['created' => 0, 'existed' => 0, 'filled' => 0, 'differs' => 0, 'homes' => 0, 'linked' => 0];
        $lines = [];

        $sync = function () use ($entries, $byName, $dryRun, &$counts, &$lines) {
            $unlinked = [];

            foreach (Organization::student()->whereNull('college_id')->get(['id', 'college']) as $organization) {
                if (! $this->isBlank($organization->college)) {
                    $unlinked[$this->fold($organization->college)][] = $organization->id;
                }
            }

            foreach ($entries as $entry) {
                $college = $byName[$this->fold($entry['name'])] ?? null;
                $home = $college ? Organization::where('organization_type', 'COLLEGE')->where('college_id', $college->id)->first() : null;

                if (! $college) {
                    $withCode = $entry['code'] !== null ? " with code {$entry['code']}" : '';
                    $lines[] = ($dryRun ? 'Would create' : 'Created')." college \"{$entry['name']}\"{$withCode}.";
                    $counts['created']++;
                    $college = $dryRun ? null : College::create(['name' => $entry['name'], 'code' => $entry['code'], 'is_active' => true]);
                } elseif ($entry['code'] === null || mb_strtoupper(trim((string) $college->code)) === $entry['code']) {
                    $lines[] = "College \"{$college->name}\" already exists.";
                    $counts['existed']++;
                } elseif ($this->isBlank($college->code)) {
                    $lines[] = ($dryRun ? 'Would fill' : 'Filled')." the code of \"{$college->name}\": {$entry['code']}.";
                    $counts['filled']++;

                    if (! $dryRun) {
                        $college->update(['code' => $entry['code']]);
                    }

                    if ($home && $this->isBlank($home->acronym)) {
                        $lines[] = ($dryRun ? 'Would set' : 'Set')." the acronym of the home organization of \"{$college->name}\": {$entry['code']}.";

                        if (! $dryRun) {
                            $home->update(['acronym' => $entry['code']]);
                        }
                    }
                } else {
                    $lines[] = "The code of \"{$college->name}\" is {$college->code} but the list says {$entry['code']}; left as it is.";
                    $counts['differs']++;
                }

                if ($college === null || ! $home) {
                    $name = $college->name ?? $entry['name'];
                    $lines[] = ($dryRun ? 'Would create' : 'Created')." the home organization for \"{$name}\".";
                    $counts['homes']++;

                    if (! $dryRun) {
                        $this->createHomeOrganization($college);
                    }
                }

                $ids = $unlinked[$this->fold($entry['name'])] ?? [];

                if ($ids) {
                    $name = $college->name ?? $entry['name'];
                    $lines[] = ($dryRun ? 'Would link ' : 'Linked ').count($ids).' student '.Str::plural('organization', count($ids))." to \"{$name}\".";
                    $counts['linked'] += count($ids);

                    if (! $dryRun) {
                        foreach (array_chunk($ids, 500) as $chunk) {
                            Organization::student()->whereIn('id', $chunk)->whereNull('college_id')->update(['college_id' => $college->id]);
                        }
                    }
                }
            }
        };

        try {
            $dryRun ? $sync() : DB::transaction($sync);
        } catch (QueryException $e) {
            if (($e->errorInfo[0] ?? $e->getCode()) !== '23000') {
                throw $e;
            }

            $reason = trim(strtok($e->getPrevious()?->getMessage() ?? 'unique constraint failed', "\n"));
            $this->error("The database refused a name or code as a duplicate: {$reason}. Nothing was written.");

            return Command::FAILURE;
        }

        foreach ($lines as $line) {
            $this->line($line);
        }

        $listed = collect($entries)->map(fn ($entry) => $this->fold($entry['name']));
        $missing = $existing->reject(fn (College $college) => $listed->contains($this->fold($college->name)));

        if ($missing->isNotEmpty()) {
            $this->line('');
            $this->line('Not in the list, left untouched:');

            foreach ($missing as $college) {
                $this->line("  {$college->name}");
            }
        }

        $this->line('');
        $this->info(($dryRun ? 'Dry run: nothing was written. ' : 'Done. ').implode(', ', [
            $counts['created'].' '.Str::plural('college', $counts['created']).($dryRun ? ' would be created' : ' created'),
            "{$counts['existed']} already existed",
            $counts['filled'].' '.Str::plural('code', $counts['filled']).($dryRun ? ' would be filled' : ' filled'),
            $counts['differs'].' code '.Str::plural('mismatch', $counts['differs']).' left as '.($counts['differs'] === 1 ? 'it is' : 'they are'),
            $counts['homes'].' home '.Str::plural('organization', $counts['homes']).($dryRun ? ' would be created' : ' created'),
            $counts['linked'].' student '.Str::plural('organization', $counts['linked']).($dryRun ? ' would be linked' : ' linked'),
            "{$missing->count()} not in the list",
        ]).'.');

        return Command::SUCCESS;
    }

    private function parse(string $contents): array
    {
        $entries = [];
        $errors = [];
        $seenNames = [];
        $seenCodes = [];

        if (! mb_check_encoding($contents, 'UTF-8')) {
            return [[], ['The file is not valid UTF-8 text.']];
        }

        foreach (preg_split('/\R/u', preg_replace('/^\xEF\xBB\xBF/', '', $contents)) as $index => $raw) {
            $number = $index + 1;
            $line = $this->squash($raw);

            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }

            if (preg_match('/[\p{Cf}\p{Cc}]/u', $line)) {
                $errors[] = "Line {$number} has an invisible or control character (a zero-width space or soft hyphen pasted from a chat app, for example). Retype the line.";

                continue;
            }

            if (preg_match('/[\x{FF5C}\x{00A6}\x{2223}\x{01C0}]/u', $line)) {
                $errors[] = "Line {$number} has a character that looks like a pipe but is not one (a full-width or broken bar, for example). Retype the pipe with the | key.";

                continue;
            }

            $code = null;
            $piped = str_contains($line, '|');
            $comma = $piped ? false : strrpos($line, ',');

            if ($piped) {
                if (substr_count($line, '|') > 1) {
                    $errors[] = "Line {$number} has more than one pipe. Write the name, then one pipe, then the optional code (like College of Law, Arts | CLA).";

                    continue;
                }

                [$line, $tail] = array_map('trim', explode('|', $line));

                if ($tail !== '') {
                    if (! $this->isCode($tail)) {
                        $errors[] = "Line {$number} has \"{$tail}\" after the pipe, which is not a code. A code is up to 8 letters, digits and hyphens only, in capitals or in lowercase (like CCS or COE).";

                        continue;
                    }

                    $code = strtoupper($tail);
                }
            } elseif ($comma !== false) {
                $tail = trim(substr($line, $comma + 1));
                $line = trim(substr($line, 0, $comma));

                if ($tail === '') {
                    $errors[] = "Line {$number} has no code after the comma.";

                    continue;
                }

                if (! $this->isCode($tail)) {
                    $errors[] = "Line {$number} has a comma but \"{$tail}\" is not a code. A name that really contains a comma is written in the pipe form, like {$this->pipeExample()}. Otherwise a code is up to 8 letters, digits and hyphens only, in capitals or in lowercase (like CCS or COE).";

                    continue;
                }

                $code = strtoupper($tail);
            }

            $name = $line;

            if ($name === '') {
                $errors[] = "Line {$number} has no college name.";

                continue;
            }

            if (str_starts_with($name, '"') || str_ends_with($name, '"')) {
                $errors[] = "Line {$number} has a name that starts or ends with a double quote. Remove the quotes (a spreadsheet adds them around a name with a comma). A name that really contains a comma is written in the pipe form, like {$this->pipeExample()}.";

                continue;
            }

            if (! $piped && str_contains($name, ',')) {
                $errors[] = "Line {$number} has a name with a comma: \"{$name}\". A name that really contains a comma is written in the pipe form, like {$this->pipeExample()}. Otherwise a code is up to 8 letters, digits and hyphens only (like CCS or COE).";

                continue;
            }

            if (mb_strlen($name) > 245) {
                $errors[] = "Line {$number} has a name longer than 245 characters.";

                continue;
            }

            $key = $this->databaseFold($name);

            if (isset($seenNames[$key])) {
                $errors[] = "Line {$number} repeats the college on line {$seenNames[$key]}.";

                continue;
            }

            if ($code !== null && isset($seenCodes[$code])) {
                $errors[] = "Line {$number} uses the code {$code}, which line {$seenCodes[$code]} already uses.";

                continue;
            }

            $seenNames[$key] = $number;

            if ($code !== null) {
                $seenCodes[$code] = $number;
            }

            $entries[] = ['line' => $number, 'name' => $name, 'code' => $code];
        }

        return [$entries, $errors];
    }

    private function pipeExample(): string
    {
        return 'College of Hospitality, Tourism and Customs Administration | CHTCA';
    }

    private function squash(string $text): string
    {
        $straight = strtr($text, [
            "\u{2018}" => "'", "\u{2019}" => "'", "\u{201A}" => "'", "\u{201B}" => "'", "\u{02BC}" => "'",
            "\u{201C}" => '"', "\u{201D}" => '"', "\u{201E}" => '"',
        ]);

        return trim(preg_replace('/\s+/u', ' ', $straight));
    }

    private function fold(string $name): string
    {
        return mb_strtolower($this->squash($name));
    }

    private function looseFold(string $name): string
    {
        return $this->fold(preg_replace('/\p{Cf}/u', '', $name));
    }

    private function databaseFold(string $name): string
    {
        $folded = '';

        foreach (preg_split('//u', $this->looseFold($name), -1, PREG_SPLIT_NO_EMPTY) as $char) {
            $ascii = Str::ascii($char);
            $folded .= $ascii === '' ? $char : mb_strtolower($ascii);
        }

        return $folded;
    }

    private function isCode(string $text): bool
    {
        return preg_match('/^(?=[A-Za-z0-9-]*[A-Za-z0-9])[A-Za-z0-9-]{1,8}$/D', $text) === 1
            && ! (preg_match('/[a-z]/', $text) && preg_match('/[A-Z]/', $text));
    }

    private function isBlank(?string $value): bool
    {
        return $value === null || trim($value) === '';
    }

    private function createHomeOrganization(College $college): void
    {
        $name = $college->name;
        for ($suffix = 2; Organization::where('name', $name)->exists(); $suffix++) {
            $tail = ' (College'.($suffix > 2 ? ' '.$suffix : '').')';
            $name = mb_substr($college->name, 0, 255 - mb_strlen($tail)).$tail;
        }

        $base = rtrim(mb_substr(Str::slug($name), 0, 240), '-') ?: 'college';
        $slug = $base;
        for ($suffix = 2; Organization::where('slug', $slug)->exists(); $suffix++) {
            $slug = $base.'-'.$suffix;
        }

        Organization::create([
            'name' => $name,
            'slug' => $slug,
            'college' => $college->name,
            'college_id' => $college->id,
            'acronym' => $this->isBlank($college->code) ? null : $college->code,
            'organization_type' => 'COLLEGE',
            'is_active' => true,
            'lifecycle_status' => 'active',
        ]);
    }
}
