<?php

namespace Tests\Feature;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ComplianceSemesterMigrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_failed_index_creation_can_be_retried_without_readding_the_column_or_foreign_key(): void
    {
        $index = 'compliance_req_semester_active_idx';
        $this->assertTrue(Schema::hasColumn('compliance_requirement_types', 'academic_semester_id'));
        $this->assertTrue(Schema::hasIndex('compliance_requirement_types', $index));
        Schema::table('compliance_requirement_types', function (Blueprint $table) use ($index) {
            $table->dropIndex($index);
        });

        $migration = require database_path('migrations/2026_10_06_000003_add_academic_semester_to_compliance_requirements.php');
        $migration->up();

        $this->assertTrue(Schema::hasIndex('compliance_requirement_types', $index));
        $this->assertTrue(Schema::hasIndex('event_requirements', 'event_req_semester_venue_active_idx'));
        $this->assertLessThanOrEqual(64, strlen($index));
        $this->assertLessThanOrEqual(64, strlen('event_req_semester_venue_active_idx'));
    }

    public function test_compliance_semester_migration_can_roll_back_and_run_again(): void
    {
        $migration = require database_path('migrations/2026_10_06_000003_add_academic_semester_to_compliance_requirements.php');

        $migration->down();
        $this->assertFalse(Schema::hasColumn('compliance_requirement_types', 'academic_semester_id'));
        $migration->up();
        $this->assertTrue(Schema::hasColumn('compliance_requirement_types', 'academic_semester_id'));
        $this->assertTrue(Schema::hasIndex('compliance_requirement_types', 'compliance_req_semester_active_idx'));
    }
}
