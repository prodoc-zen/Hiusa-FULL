<?php

namespace App\Console\Commands;

use App\Models\AcademicSemester;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\SemesterDefaults;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class EnsureSemesterRequirements extends Command
{
    protected $signature = 'hiusa:ensure-semester-requirements {--dry-run : List what would be created without writing anything}';

    protected $description = 'File the registration, renewal, semestral report and event requirements for an active semester that has none';

    public function handle(SemesterDefaults $defaults): int
    {
        $semesters = AcademicSemester::with('academicYear')->where('status', 'active')->orderBy('id')->get();
        if ($semesters->isEmpty()) {
            $this->warn('There is no active academic semester.');

            return Command::SUCCESS;
        }

        $sao = User::where('role', 'SUPER_ADMIN')->where('account_status', 'active')->orderBy('school_id')->first();
        if (! $sao) {
            $this->error('There is no active SAO account to own the requirements.');

            return Command::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');
        foreach ($semesters as $semester) {
            $label = "semester {$semester->id} (A.Y. {$semester->academicYear->label}, semester {$semester->number})";
            $created = DB::transaction(function () use ($defaults, $semester, $sao, $dryRun) {
                $missing = $defaults->missing($semester);
                if (! $dryRun && ($missing['compliance'] > 0 || $missing['events'] > 0)) {
                    $defaults->create($semester, $sao->school_id);
                    AuditLog::create([
                        'organization_id' => $sao->getRawOriginal('organization_id'),
                        'user_id' => $sao->school_id,
                        'actor_role' => $sao->role,
                        'module' => 'system_administration',
                        'action' => 'semester_requirements_backfilled',
                        'description' => "Filed the missing requirement rows for academic year {$semester->academicYear->label}, semester {$semester->number} from the server command line.",
                        'record_type' => AcademicSemester::class,
                        'record_id' => $semester->id,
                        'new_values' => $missing,
                        'created_at' => now(),
                    ]);
                }

                return $missing;
            });

            if ($created['compliance'] === 0 && $created['events'] === 0) {
                $this->line("{$label} already has its requirements. Nothing to do.");

                continue;
            }
            $this->line(($dryRun ? 'Would create ' : 'Created ')."{$created['compliance']} compliance requirement(s) and {$created['events']} event requirement(s) for {$label}.");
        }

        return Command::SUCCESS;
    }
}
