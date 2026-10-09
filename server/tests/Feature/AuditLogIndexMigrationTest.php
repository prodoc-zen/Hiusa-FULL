<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AuditLogIndexMigrationTest extends TestCase
{
    use RefreshDatabase;

    private const INDEXES = ['audit_logs_organization_id_created_at_index', 'audit_logs_user_id_created_at_index'];

    private function migration(): object
    {
        return require database_path('migrations/2026_10_10_000001_add_audit_log_indexes.php');
    }

    public function test_the_audit_log_filters_are_indexed_and_the_migration_can_run_twice_and_roll_back(): void
    {
        foreach (self::INDEXES as $name) {
            $this->assertTrue(Schema::hasIndex('audit_logs', $name), "{$name} is missing.");
        }

        $migration = $this->migration();
        $migration->up();
        $this->assertTrue(Schema::hasIndex('audit_logs', 'audit_logs_user_id_created_at_index'));

        $migration->down();
        foreach (self::INDEXES as $name) {
            $this->assertFalse(Schema::hasIndex('audit_logs', $name));
        }
        $this->assertTrue(Schema::hasIndex('audit_logs', 'audit_module_action_index'), 'down() drops only the two new indexes.');

        $migration->down();
        $migration->up();
        foreach (self::INDEXES as $name) {
            $this->assertTrue(Schema::hasIndex('audit_logs', $name));
        }
    }
}
