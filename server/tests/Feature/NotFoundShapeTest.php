<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Event;
use App\Models\Organization;
use App\Models\OrganizationApplication;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A record the caller may not see and a record that does not exist answer with the same body, and
 * neither names a model class.
 */
class NotFoundShapeTest extends TestCase
{
    use RefreshDatabase;

    private College $ccs;

    private College $cbe;

    private User $head;

    protected function setUp(): void
    {
        parent::setUp();
        config(['app.debug' => false]);
        $this->ccs = College::create(['name' => 'College of Computer Studies', 'code' => 'CCS']);
        $this->cbe = College::create(['name' => 'College of Business Education', 'code' => 'CBE']);
        $this->head = User::factory()->departmentHead()->create(['organization_id' => Organization::factory()->create(['college' => $this->ccs->name, 'college_id' => $this->ccs->id, 'organization_type' => 'COLLEGE'])->id]);
    }

    public function test_an_application_of_another_college_matches_one_that_does_not_exist(): void
    {
        $foreign = OrganizationApplication::create(['college_id' => $this->cbe->id, 'name' => 'Chess Club', 'acronym' => 'CHESS', 'school_id' => 87000010, 'first_name' => 'Ana', 'last_name' => 'Cruz', 'email' => 'ana@example.test', 'position_title' => 'President', 'status' => 'pending_dean']);
        Sanctum::actingAs($this->head);

        $wrongOwner = $this->getJson("/api/organization-applications/{$foreign->id}");
        $missing = $this->getJson('/api/organization-applications/999999');
        $reviewWrongOwner = $this->patchJson("/api/organization-applications/{$foreign->id}/review", ['action' => 'endorse']);
        $reviewMissing = $this->patchJson('/api/organization-applications/999999/review', ['action' => 'endorse']);

        $this->assertSame(404, $wrongOwner->getStatusCode());
        $this->assertSame($wrongOwner->getContent(), $missing->getContent());
        $this->assertSame(404, $reviewWrongOwner->getStatusCode());
        $this->assertSame($reviewWrongOwner->getContent(), $reviewMissing->getContent());
        $this->assertStringNotContainsString('App\\Models', (string) $missing->json('message'));
        $this->assertSame('pending_dean', $foreign->fresh()->status);
    }

    public function test_an_event_file_the_caller_cannot_see_matches_one_that_does_not_exist(): void
    {
        $mine = Organization::factory()->create();
        $other = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $mine->id]);
        $own = Event::factory()->create(['organization_id' => $mine->id, 'created_by' => $admin->school_id]);
        $foreign = Event::factory()->create(['organization_id' => $other->id, 'created_by' => $admin->school_id]);
        Sanctum::actingAs($admin);

        $invisible = $this->getJson("/api/events/{$foreign->id}/submission/files/1");
        $missingEvent = $this->getJson('/api/events/999999/submission/files/1');
        $missingFile = $this->getJson("/api/events/{$own->id}/submission/files/999999");

        $this->assertSame(404, $invisible->getStatusCode());
        $this->assertSame($invisible->getContent(), $missingEvent->getContent());
        $this->assertSame($invisible->getContent(), $missingFile->getContent());
    }

    public function test_deleting_another_organizations_event_matches_deleting_one_that_does_not_exist(): void
    {
        $mine = Organization::factory()->create();
        $other = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $mine->id]);
        $foreign = Event::factory()->create(['organization_id' => $other->id, 'created_by' => $admin->school_id, 'status' => 'planning']);
        Sanctum::actingAs($admin);

        $wrongOwner = $this->deleteJson("/api/events/{$foreign->id}");
        $missing = $this->deleteJson('/api/events/999999');

        $this->assertSame(404, $wrongOwner->getStatusCode());
        $this->assertSame($wrongOwner->getContent(), $missing->getContent());
        $this->assertDatabaseHas('events', ['id' => $foreign->id]);
    }

    public function test_a_missing_route_bound_record_never_names_its_model(): void
    {
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->value('id')]));

        $response = $this->putJson('/api/system/organizations/999999', ['name' => 'Renamed']);

        $this->assertSame(404, $response->getStatusCode());
        $this->assertStringNotContainsString('App\\Models', (string) $response->json('message'));
    }
}
