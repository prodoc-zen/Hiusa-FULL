<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\User;
use Database\Seeders\SboPositionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** The "Can handle finance" switch on a position, mirroring "Can book venues". */
class FinancePositionSwitchTest extends TestCase
{
    use RefreshDatabase;

    private function officer(Organization $organization, ?string $position): User
    {
        return User::factory()->officer()->create(['organization_id' => $organization->id, 'position_title' => $position]);
    }

    private function position(Organization $organization, string $title, string $role = 'SBO_OFFICER'): SboPosition
    {
        return SboPosition::create(['organization_id' => $organization->id, 'role' => $role, 'title' => $title, 'is_active' => true]);
    }

    public function test_new_positions_default_the_finance_switch_by_title(): void
    {
        $organization = Organization::factory()->create();

        $on = ['Treasurer', 'Auditor', 'Business Manager', 'Secretary', ' treasurer ', 'AUDITOR', 'Business-Manager', ' secretary '];
        $off = ['President', 'Assistant Secretary', 'Public Information Officer', 'Representative', 'Assistant Treasurer'];
        foreach ([...$on, ...$off] as $index => $title) {
            $this->position($organization, $title, $index % 2 ? 'ADMIN' : 'SBO_OFFICER');
        }

        foreach ($on as $title) {
            $this->assertTrue(SboPosition::financeDefaultFor($title), "{$title} should default ON");
        }
        foreach ($off as $title) {
            $this->assertFalse(SboPosition::financeDefaultFor($title), "{$title} should default OFF");
        }
        $this->assertSame(count($on), SboPosition::where('can_handle_finance', true)->count());
        $this->assertSame(count($off), SboPosition::where('can_handle_finance', false)->count());
    }

    public function test_an_explicit_choice_beats_the_title_default_and_the_database_default_is_off(): void
    {
        $organization = Organization::factory()->create();

        $this->assertFalse((bool) SboPosition::create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Treasurer', 'can_handle_finance' => false])->fresh()->can_handle_finance);
        $this->assertTrue((bool) SboPosition::create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Representative', 'can_handle_finance' => true])->fresh()->can_handle_finance);
        $id = DB::table('sbo_positions')->insertGetId(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Muse']);
        $this->assertFalse((bool) DB::table('sbo_positions')->where('id', $id)->value('can_handle_finance'));
    }

    public function test_the_migration_backfills_the_four_finance_titles_and_is_reversible(): void
    {
        $organization = Organization::factory()->create();
        foreach (['Treasurer', 'Auditor', 'Business Manager', 'President', 'Secretary'] as $title) {
            $this->position($organization, $title);
        }
        DB::table('sbo_positions')->insert(['organization_id' => $organization->id, 'role' => 'ADMIN', 'title' => '  TREASURER ', 'is_active' => true]);

        $migration = require database_path('migrations/2026_11_24_000001_add_can_handle_finance_to_sbo_positions.php');
        $migration->down();
        $this->assertFalse(Schema::hasColumn('sbo_positions', 'can_handle_finance'));
        $this->assertSame(6, DB::table('sbo_positions')->count());

        $migration->up();

        $this->assertTrue(Schema::hasColumn('sbo_positions', 'can_handle_finance'));
        $on = DB::table('sbo_positions')->where('can_handle_finance', true)->pluck('title')->map(fn ($title) => trim($title))->sort()->values()->all();
        $this->assertSame(['Auditor', 'Business Manager', 'Secretary', 'TREASURER', 'Treasurer'], $on);
        $this->assertSame(['President'], DB::table('sbo_positions')->where('can_handle_finance', false)->orderBy('title')->pluck('title')->all());
    }

    public function test_can_handle_finance_follows_the_role_and_the_position_switch(): void
    {
        $organization = Organization::factory()->create();
        $this->position($organization, 'Treasurer');
        $this->position($organization, 'Representative')->update(['can_handle_finance' => true]);
        $this->position($organization, 'Auditor')->update(['is_active' => false]);

        $this->assertTrue(User::factory()->admin()->create(['organization_id' => $organization->id])->canHandleFinance());
        $this->assertFalse(User::factory()->student()->create(['organization_id' => $organization->id])->canHandleFinance());
        $this->assertTrue($this->officer($organization, 'Treasurer')->canHandleFinance());
        $this->assertTrue($this->officer($organization, 'Representative')->canHandleFinance());
        $this->assertFalse($this->officer($organization, 'Auditor')->canHandleFinance(), 'an inactive position never handles finance');
        $this->assertFalse($this->officer($organization, null)->canHandleFinance());
        $this->assertFalse($this->officer($organization, '   ')->canHandleFinance());
        $this->assertTrue($this->officer($organization, 'Business Manager')->canHandleFinance(), 'a title the list does not hold follows the title default');
        $this->assertFalse($this->officer($organization, 'Public Information Officer')->canHandleFinance());

        SboPosition::where('title', 'Treasurer')->update(['can_handle_finance' => false]);
        foreach (['Treasurer', 'treasurer', ' Treasurer ', 'Treasurer'] as $title) {
            $this->assertFalse($this->officer($organization, $title)->canHandleFinance(), "'{$title}' follows the switched off row");
        }

        $other = Organization::factory()->create();
        $this->assertTrue($this->officer($other, 'Treasurer')->canHandleFinance(), 'another organization keeps its own positions');
    }

    public function test_the_signed_in_payload_carries_the_flag_and_the_list_of_others_does_not(): void
    {
        $organization = Organization::factory()->create();
        $this->position($organization, 'Treasurer');
        $treasurer = $this->officer($organization, 'Treasurer');
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($treasurer);
        $this->getJson('/api/user')->assertOk()->assertJsonPath('can_handle_finance', true)->assertJsonPath('can_book_venues', false);

        SboPosition::where('title', 'Treasurer')->update(['can_handle_finance' => false]);
        // The response is cached per account, so a second holder of the position reads the new switch.
        Sanctum::actingAs($this->officer($organization, 'Treasurer'));
        $this->getJson('/api/user')->assertOk()->assertJsonPath('can_handle_finance', false);

        Sanctum::actingAs($admin);
        $this->getJson('/api/user')->assertOk()->assertJsonPath('can_handle_finance', true);
        $this->getJson('/api/users?per_page=50')->assertOk()->assertJsonMissingPath('data.0.can_handle_finance');
    }

    public function test_an_admin_sets_the_switch_when_creating_and_updating_a_position(): void
    {
        $organization = Organization::factory()->create();
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $organization->id]));

        $treasurer = $this->postJson('/api/sbo-positions', ['role' => 'SBO_OFFICER', 'title' => 'Treasurer'])->assertCreated()->assertJsonPath('can_handle_finance', true)->json('id');
        $rep = $this->postJson('/api/sbo-positions', ['role' => 'SBO_OFFICER', 'title' => 'Representative'])->assertCreated()->assertJsonPath('can_handle_finance', false)->json('id');
        $this->postJson('/api/sbo-positions', ['role' => 'SBO_OFFICER', 'title' => 'Muse', 'can_handle_finance' => true])->assertCreated()->assertJsonPath('can_handle_finance', true);

        $this->putJson("/api/sbo-positions/{$rep}", ['can_handle_finance' => true])->assertOk()->assertJsonPath('can_handle_finance', true);
        $this->putJson("/api/sbo-positions/{$treasurer}", ['can_handle_finance' => false])->assertOk()->assertJsonPath('can_handle_finance', false);
        $this->putJson("/api/sbo-positions/{$treasurer}", ['description' => 'Keeps the books'])->assertOk()->assertJsonPath('can_handle_finance', false);
        $this->putJson("/api/sbo-positions/{$treasurer}", ['can_handle_finance' => 'maybe'])->assertUnprocessable();
        $this->assertDatabaseHas('audit_logs', ['module' => 'positions', 'action' => 'updated', 'record_id' => $treasurer]);
    }

    public function test_an_officer_cannot_change_the_switch(): void
    {
        $organization = Organization::factory()->create();
        $treasurer = $this->position($organization, 'Treasurer');
        Sanctum::actingAs($this->officer($organization, 'Treasurer'));

        $this->putJson("/api/sbo-positions/{$treasurer->id}", ['can_handle_finance' => false])->assertForbidden();
        $this->assertTrue((bool) $treasurer->fresh()->can_handle_finance);
    }

    public function test_the_database_seeder_gives_positions_their_finance_defaults(): void
    {
        Storage::fake('local');

        $this->seed();

        $organization = Organization::student()->firstOrFail();
        foreach (['ADMIN', 'SBO_OFFICER'] as $role) {
            foreach (['Treasurer', 'Auditor', 'Business Manager', 'Secretary'] as $title) {
                $this->assertTrue((bool) SboPosition::where(['organization_id' => $organization->id, 'role' => $role, 'title' => $title])->value('can_handle_finance'), "{$title} ({$role}) should seed ON");
            }
            foreach (['President', 'Assistant Secretary', 'Public Information Officer', 'Representative'] as $title) {
                $this->assertFalse((bool) SboPosition::where(['organization_id' => $organization->id, 'role' => $role, 'title' => $title])->value('can_handle_finance'), "{$title} ({$role}) should seed OFF");
            }
        }
    }

    public function test_reseeding_keeps_a_finance_switch_an_admin_changed(): void
    {
        $organization = Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION']);

        $this->seed(SboPositionSeeder::class);
        SboPosition::where(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Treasurer'])->update(['can_handle_finance' => false]);
        SboPosition::where(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Representative'])->update(['can_handle_finance' => true]);

        $this->seed(SboPositionSeeder::class);

        $this->assertFalse((bool) SboPosition::where(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Treasurer'])->value('can_handle_finance'));
        $this->assertTrue((bool) SboPosition::where(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Representative'])->value('can_handle_finance'));
    }
}
