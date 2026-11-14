<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\College;
use App\Models\Organization;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class StudentRegistryFixTest extends TestCase
{
    use RefreshDatabase;

    private College $cit;

    private College $cbe;

    private User $sao;

    private User $dean;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cit = College::create(['name' => 'College of Information Technology', 'code' => 'CIT', 'is_active' => true]);
        $this->cbe = College::create(['name' => 'College of Business', 'code' => 'CBE', 'is_active' => true]);
        $citHome = $this->home($this->cit);
        $this->home($this->cbe);
        $saoOrg = Organization::firstOrCreate(['acronym' => 'SAO'], ['name' => 'Student Affairs Office', 'slug' => 'student-affairs-office', 'organization_type' => 'UNIVERSITY', 'is_active' => true, 'lifecycle_status' => 'active']);

        $this->sao = User::factory()->superAdmin()->create(['organization_id' => $saoOrg->id]);
        $this->dean = User::factory()->departmentHead()->create(['organization_id' => $citHome->id]);
    }

    private function home(College $college): Organization
    {
        return Organization::create([
            'name' => $college->name, 'slug' => str($college->name)->slug(), 'acronym' => $college->code, 'college' => $college->name,
            'college_id' => $college->id, 'organization_type' => 'COLLEGE', 'is_active' => true, 'lifecycle_status' => 'active',
        ]);
    }

    private function entry(array $overrides = []): StudentRegistryEntry
    {
        return StudentRegistryEntry::create([
            'school_id' => 2600001, 'first_name' => 'Ana', 'last_name' => 'Cruz', 'birth_date' => '2007-01-02',
            'college_id' => $this->cit->id, 'program' => 'BS IT', 'year_level' => '1st Year', 'section' => null, ...$overrides,
        ]);
    }

    public function test_the_sao_removes_a_record_that_has_no_account_and_it_is_audited(): void
    {
        $entry = $this->entry();
        Sanctum::actingAs($this->sao);

        $this->deleteJson("/api/students/registry/{$entry->id}")->assertNoContent();

        $this->assertDatabaseMissing('student_registry', ['id' => $entry->id]);
        $this->assertDatabaseHas('audit_logs', [
            'module' => 'student_registry', 'action' => 'deleted', 'record_type' => StudentRegistryEntry::class,
            'record_id' => $entry->id, 'user_id' => $this->sao->school_id,
        ]);
        $values = AuditLog::where('action', 'deleted')->where('module', 'student_registry')->first()->old_values;
        $this->assertSame(2600001, (int) $values['school_id']);
        $this->assertArrayNotHasKey('birth_date', $values);
    }

    public function test_a_dean_removes_only_records_of_their_own_college(): void
    {
        $own = $this->entry();
        $other = $this->entry(['school_id' => 2600002, 'college_id' => $this->cbe->id]);
        Sanctum::actingAs($this->dean);

        $this->deleteJson("/api/students/registry/{$other->id}")->assertNotFound();
        $this->assertDatabaseHas('student_registry', ['id' => $other->id]);

        $this->deleteJson("/api/students/registry/{$own->id}")->assertNoContent();
        $this->assertDatabaseMissing('student_registry', ['id' => $own->id]);
    }

    public function test_a_record_tied_to_an_account_is_refused_with_the_reason(): void
    {
        $claimed = $this->entry(['claimed_at' => now()]);
        $withAccount = $this->entry(['school_id' => 2600002]);
        User::factory()->create(['school_id' => 2600002, 'role' => 'STUDENT']);
        Sanctum::actingAs($this->sao);

        foreach ([$claimed, $withAccount] as $entry) {
            $this->deleteJson("/api/students/registry/{$entry->id}")
                ->assertStatus(409)->assertJsonPath('message', 'This record is tied to an account, so it cannot be changed here.');
            $this->patchJson("/api/students/registry/{$entry->id}", ['first_name' => 'Bea', 'last_name' => 'Lim', 'birth_date' => '2007-03-04'])
                ->assertStatus(409)->assertJsonPath('message', 'This record is tied to an account, so it cannot be changed here.');
            $this->assertDatabaseHas('student_registry', ['id' => $entry->id, 'first_name' => 'Ana']);
        }
        $this->assertSame(0, AuditLog::where('module', 'student_registry')->count());
    }

    public function test_only_the_sao_and_deans_can_remove_or_correct_records(): void
    {
        $entry = $this->entry();
        foreach (['STUDENT', 'ADMIN', 'SBO_OFFICER'] as $role) {
            Sanctum::actingAs(User::factory()->create(['role' => $role, 'organization_id' => $this->dean->organization_id]));
            $this->deleteJson("/api/students/registry/{$entry->id}")->assertForbidden();
            $this->patchJson("/api/students/registry/{$entry->id}", ['first_name' => 'Bea', 'last_name' => 'Lim', 'birth_date' => '2007-03-04'])->assertForbidden();
        }
        $this->assertDatabaseHas('student_registry', ['id' => $entry->id, 'first_name' => 'Ana']);
    }

    public function test_the_sao_corrects_a_name_and_birth_date_and_the_audit_row_keeps_the_names(): void
    {
        $entry = $this->entry();
        Sanctum::actingAs($this->sao);

        $this->patchJson("/api/students/registry/{$entry->id}", ['first_name' => 'Anna', 'last_name' => 'Cruz-Lim', 'birth_date' => '2007-03-04'])
            ->assertOk()->assertJsonPath('name', 'Anna Cruz-Lim')->assertJsonPath('birth_date', '2007-03-04')->assertJsonPath('school_id', 2600001);

        $fresh = $entry->fresh();
        $this->assertSame('Anna', $fresh->first_name);
        $this->assertSame('Cruz-Lim', $fresh->last_name);
        $this->assertSame('2007-03-04', $fresh->birth_date->format('Y-m-d'));
        $log = AuditLog::where('module', 'student_registry')->where('action', 'updated')->firstOrFail();
        $this->assertSame($entry->id, (int) $log->record_id);
        $this->assertSame($this->sao->school_id, $log->user_id);
        $this->assertSame(['first_name' => 'Ana', 'last_name' => 'Cruz'], $log->old_values);
        $this->assertSame(['first_name' => 'Anna', 'last_name' => 'Cruz-Lim', 'birth_date_changed' => true], $log->new_values);
    }

    public function test_a_dean_corrects_own_college_records_only_and_does_not_see_the_birth_date(): void
    {
        $own = $this->entry();
        $other = $this->entry(['school_id' => 2600002, 'college_id' => $this->cbe->id]);
        Sanctum::actingAs($this->dean);

        $this->patchJson("/api/students/registry/{$other->id}", ['first_name' => 'Bea', 'last_name' => 'Lim', 'birth_date' => '2007-03-04'])->assertNotFound();
        $this->assertSame('Ana', $other->fresh()->first_name);

        $this->patchJson("/api/students/registry/{$own->id}", ['first_name' => 'Bea', 'last_name' => 'Lim', 'birth_date' => '2007-03-04'])
            ->assertOk()->assertJsonPath('name', 'Bea Lim')->assertJsonMissingPath('birth_date');
        $this->assertSame('2007-03-04', $own->fresh()->birth_date->format('Y-m-d'));

        $this->patchJson("/api/students/registry/{$own->id}", ['first_name' => 'Bea', 'last_name' => 'Lima'])->assertOk()->assertJsonPath('name', 'Bea Lima');
        $this->assertSame('2007-03-04', $own->fresh()->birth_date->format('Y-m-d'));
        $this->assertFalse(AuditLog::where('action', 'updated')->latest('id')->first()->new_values['birth_date_changed']);
    }

    public function test_a_correction_must_be_a_real_name_and_a_real_past_date(): void
    {
        $entry = $this->entry();
        Sanctum::actingAs($this->sao);

        $this->patchJson("/api/students/registry/{$entry->id}", ['first_name' => '', 'last_name' => 'Lim', 'birth_date' => '2007-03-04'])->assertStatus(422)->assertJsonValidationErrors('first_name');
        $this->patchJson("/api/students/registry/{$entry->id}", ['first_name' => 'Bea', 'last_name' => str_repeat('x', 61), 'birth_date' => '2007-03-04'])->assertStatus(422)->assertJsonValidationErrors('last_name');
        $this->patchJson("/api/students/registry/{$entry->id}", ['first_name' => 'Bea', 'last_name' => 'Lim', 'birth_date' => '2999-01-01'])->assertStatus(422)->assertJsonValidationErrors('birth_date');
        $this->patchJson("/api/students/registry/{$entry->id}", ['first_name' => 'Bea', 'last_name' => 'Lim', 'birth_date' => '03/04/2007'])->assertStatus(422)->assertJsonValidationErrors('birth_date');

        $this->assertSame('Ana', $entry->fresh()->first_name);
        $this->assertSame(0, AuditLog::where('module', 'student_registry')->count());
    }
}
