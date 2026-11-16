<?php

namespace App\Services\Ai;

use App\Contracts\TextGenerator;
use Illuminate\Support\Carbon;

/**
 * Writes the four narrative sections of a Semestral Accomplishment Report from a TermDigest: one structured model
 * call, then checks on every section. Any miss (no answer, a section too long or empty, a number or a quoted title
 * the digest does not hold, a cancelled event described as held, an empty semester not said to be empty) sends the
 * whole draft to the template, which only restates the digest as bullet lines. The draft is advice to an editor:
 * nothing is submitted from here.
 */
class SemesterNarrativeDrafter
{
    public const SECTIONS = ['accomplishments', 'implementation', 'evaluation', 'next_semester_plan'];

    public const MAX_WORDS = 120;

    // Words a template keeps free so a trimmed list can still say that more exists.
    private const TRIM_NOTE = '- More are listed in the system.';

    public function __construct(private readonly TextGenerator $ai) {}

    /**
     * @param  array<string, mixed>  $digest  the TermDigest shape
     * @return array{sections: array<string, string>, engine: string, model: ?string}
     */
    public function draftFromDigest(array $digest): array
    {
        $digest = $this->withoutNames($digest);
        $generated = $this->ai->generateStructured(
            AiInstructions::semesterNarrative(),
            ReviewNoteDrafter::noticedFacts($digest),
            'hiusa_semester_narrative',
            $this->schema(),
            1400,
            0.2,
        );
        $sections = is_array($generated) ? $this->checked($generated['data'] ?? null, $digest) : null;

        if ($sections === null) {
            return ['sections' => $this->template($digest), 'engine' => 'template', 'model' => null];
        }

        $model = (string) ($generated['model'] ?? '');

        return ['sections' => $sections, 'engine' => str_starts_with($model, 'claude') ? 'claude' : 'groq', 'model' => $model];
    }

    /** A person is named by position only, so a student's name never reaches the model. */
    private function withoutNames(array $digest): array
    {
        $digest['officers'] = array_map(fn ($officer) => ['position' => (string) ($officer['position'] ?? 'Officer')], array_values($digest['officers'] ?? []));

        return $digest;
    }

    /** The titles the digest names: the only words that may sit inside double quotes in a draft. */
    public static function suppliedTitles(array $digest): array
    {
        return collect([...($digest['events'] ?? []), ...($digest['elections'] ?? []), ...($digest['upcoming_events'] ?? [])])
            ->pluck('title')->filter(fn ($title) => is_string($title) && $title !== '')->values()->all();
    }

    /** @return array<string, mixed> */
    private function schema(): array
    {
        return [
            'type' => 'object',
            'additionalProperties' => false,
            'required' => self::SECTIONS,
            'properties' => array_fill_keys(self::SECTIONS, ['type' => 'string']),
        ];
    }

    /**
     * @return array<string, string>|null the four plain sections when every check holds, otherwise null
     */
    private function checked(mixed $data, array $digest): ?array
    {
        if (! is_array($data)) {
            return null;
        }

        $sections = [];
        foreach (self::SECTIONS as $key) {
            $text = is_string($data[$key] ?? null) ? $this->ai->plainText($data[$key]) : '';
            if ($text === '' || self::words($text) > self::MAX_WORDS || ! $this->ai->preservesNumericFacts($text, $digest)) {
                return null;
            }
            $sections[$key] = $text;
        }

        $all = implode("\n", $sections);
        if (! self::quotesOnlySuppliedTitles($all, $digest)
            || self::describesCancelledAsHeld($all, $this->cancelledTitles($digest))
            || (($digest['events'] ?? []) === [] && preg_match('/\bno events?\b/iu', $sections['accomplishments']) !== 1)) {
            return null;
        }

        return $sections;
    }

    public static function words(string $text): int
    {
        return count(preg_split('/\s+/u', trim($text), -1, PREG_SPLIT_NO_EMPTY) ?: []);
    }

    /** True when every phrase in double quotes is a title the digest supplied. */
    public static function quotesOnlySuppliedTitles(string $text, array $digest): bool
    {
        $known = array_map('mb_strtolower', self::suppliedTitles($digest));
        preg_match_all('/["\x{201C}]([^"\x{201C}\x{201D}]{1,300})["\x{201D}]/u', $text, $matches);

        foreach ($matches[1] as $quoted) {
            if (! in_array(mb_strtolower(trim($quoted)), $known, true)) {
                return false;
            }
        }

        return true;
    }

    /**
     * True when a sentence naming a cancelled event does not say it was cancelled, or says it was held, attended or
     * done without saying it was not.
     *
     * @param  list<string>  $cancelledTitles
     */
    public static function describesCancelledAsHeld(string $text, array $cancelledTitles): bool
    {
        $sentences = preg_split('/(?<=[.!?])\s+|\n+/u', $text, -1, PREG_SPLIT_NO_EMPTY) ?: [];

        foreach ($cancelledTitles as $title) {
            foreach ($sentences as $sentence) {
                if (mb_stripos($sentence, $title) === false) {
                    continue;
                }
                $cancelled = preg_match('/\bcancel/iu', $sentence) === 1;
                $heldWords = preg_match('/\b(held|conducted|attended|successful(?:ly)?|completed|celebrated|took place)\b/iu', $sentence) === 1;
                $negated = preg_match('/\b(not|never|without)\b|n\'t/iu', $sentence) === 1;
                if (! $cancelled || ($heldWords && ! $negated)) {
                    return true;
                }
            }
        }

        return false;
    }

    /** @return list<string> */
    private function cancelledTitles(array $digest): array
    {
        return collect($digest['events'] ?? [])->where('status', 'cancelled')->pluck('title')->filter()->values()->all();
    }

    /**
     * The digest restated as bullet lines, nothing derived: no count, sum or percentage that is not already a fact.
     *
     * @return array<string, string>
     */
    private function template(array $digest): array
    {
        $semester = (string) ($digest['semester'] ?? 'the semester');
        $events = $digest['events'] ?? [];
        $money = fn ($amount) => 'PHP '.number_format((float) $amount, 2);
        $day = fn ($date) => Carbon::parse($date)->format('F j, Y');

        $accomplishments = $events === []
            ? ["- No events were recorded for {$semester}."]
            : array_map(fn (array $event) => match ($event['status']) {
                'completed' => "- \"{$event['title']}\" was held on {$day($event['date'])}.",
                'cancelled' => "- \"{$event['title']}\" was cancelled and was not held ({$day($event['date'])}).",
                'ongoing' => "- \"{$event['title']}\" is under way (started {$day($event['date'])}).",
                default => "- \"{$event['title']}\" is scheduled for {$day($event['date'])}.",
            }, $events);

        $tasks = $digest['tasks'] ?? ['completed' => 0, 'overdue' => 0, 'open' => 0];
        $implementation = [
            "- Tasks: {$tasks['completed']} completed, {$tasks['overdue']} overdue, {$tasks['open']} still open.",
            '- Announcements posted: '.($digest['announcements']['posted'] ?? 0).'.',
            '- Merchandise orders: '.($digest['merchandise']['orders'] ?? 0).', of which '.($digest['merchandise']['claimed'] ?? 0).' were claimed.',
        ];
        foreach ($events as $event) {
            if ($event['status'] === 'cancelled') {
                continue;
            }
            if ($event['budget_allocated'] !== null) {
                $implementation[] = "- \"{$event['title']}\": budget used ".(($event['budget_used'] ?? null) === null ? '[not recorded]' : $money($event['budget_used']))." of {$money($event['budget_allocated'])}.";
            } elseif ($event['status'] === 'completed') {
                $implementation[] = "- \"{$event['title']}\": [budget used not recorded].";
            }
        }

        $evaluation = [];
        foreach ($events as $event) {
            if ($event['status'] === 'completed') {
                $evaluation[] = $event['attendance'] !== null
                    ? "- \"{$event['title']}\": {$event['attendance']} attended."
                    : "- \"{$event['title']}\": [number of attendees not recorded].";
            }
        }
        foreach ($digest['elections'] ?? [] as $election) {
            $evaluation[] = "- Election \"{$election['title']}\": {$election['ballots']} ballots cast by {$election['voters']} eligible voters.";
        }
        $finance = $digest['finance'] ?? ['income' => 0, 'expense' => 0, 'closing_balance' => 0];
        $evaluation[] = "- Money this semester: income {$money($finance['income'])}, expenses {$money($finance['expense'])}, closing balance {$money($finance['closing_balance'])}.";
        if (($tasks['overdue'] ?? 0) > 0) {
            $evaluation[] = "- Tasks overdue at the end of the semester: {$tasks['overdue']}.";
        }

        $plan = array_map(fn (array $event) => "- \"{$event['title']}\" on {$day($event['date'])}.", $digest['upcoming_events'] ?? []);
        if ($plan === []) {
            $plan[] = '- No events are scheduled yet.';
        }
        $plan[] = '- [objectives and activities to be decided by the officers]';
        if (($digest['officers'] ?? []) !== []) {
            $plan[] = '- Officer positions: '.implode(', ', array_column($digest['officers'], 'position')).'.';
        }

        return [
            'accomplishments' => $this->fit($accomplishments),
            'implementation' => $this->fit($implementation),
            'evaluation' => $this->fit($evaluation),
            'next_semester_plan' => $this->fit($plan),
        ];
    }

    /** Keeps whole lines while the section stays inside the word limit, then notes that more exists. */
    private function fit(array $lines): string
    {
        if (self::words(implode("\n", $lines)) <= self::MAX_WORDS) {
            return implode("\n", $lines);
        }

        $kept = [];
        $words = self::words(self::TRIM_NOTE);
        foreach ($lines as $line) {
            $words += self::words($line);
            if ($words > self::MAX_WORDS) {
                break;
            }
            $kept[] = $line;
        }
        $kept[] = self::TRIM_NOTE;

        return implode("\n", $kept);
    }
}
