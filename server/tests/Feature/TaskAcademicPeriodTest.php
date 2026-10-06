<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\Organization;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TaskAcademicPeriodTest extends TestCase
{
    use RefreshDatabase;

    public function test_tasks_inherit_the_active_semester_and_completed_tasks_are_read_only(): void
    {
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $first = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $second = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);
        $admin = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        $sao = User::factory()->superAdmin()->create(['organization_id' => Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION'])->id]);
        $task = Task::create(['organization_id' => $admin->organization_id, 'created_by' => $admin->school_id, 'title' => 'Prepare program', 'deadline' => '2026-11-01 17:00:00', 'status' => 'pending']);
        $this->assertSame($first->id, $task->academic_semester_id);

        Sanctum::actingAs($admin);
        $this->getJson('/api/tasks')->assertOk()->assertJsonPath('total', 1);
        Sanctum::actingAs($sao);
        $this->patchJson("/api/system/academic-semesters/{$second->id}/active")->assertOk();
        Sanctum::actingAs($admin);
        $this->assertSame($second->id, AcademicSemester::active()?->id);
        $this->assertDatabaseHas('tasks', ['id' => $task->id, 'academic_semester_id' => $first->id]);
        $this->getJson('/api/tasks')->assertOk()->assertJsonPath('total', 0);
        $this->getJson('/api/tasks?academic_semester_id='.$first->id)->assertOk()->assertJsonFragment(['title' => 'Prepare program']);
        $this->putJson("/api/tasks/{$task->id}", ['title' => 'Changed'])->assertStatus(409);
        $this->patchJson("/api/tasks/{$task->id}/status", ['status' => 'completed'])->assertStatus(409);
        $this->deleteJson("/api/tasks/{$task->id}")->assertStatus(409);
        $this->assertDatabaseHas('tasks', ['id' => $task->id, 'title' => 'Prepare program']);
    }
}
