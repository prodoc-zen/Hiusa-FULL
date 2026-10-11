<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Event;
use App\Models\Organization;
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

    private function foreignRegistration(): Organization
    {
        return Organization::factory()->create(['college' => $this->cbe->name, 'college_id' => $this->cbe->id, 'lifecycle_status' => 'returned', 'is_active' => false]);
    }

    public function test_withdrawing_another_colleges_registration_matches_withdrawing_one_that_does_not_exist(): void
    {
        $foreign = $this->foreignRegistration();
        Sanctum::actingAs($this->head);

        $wrongOwner = $this->deleteJson("/api/college/organizations/{$foreign->id}");
        $missing = $this->deleteJson('/api/college/organizations/999999');

        $this->assertSame(404, $wrongOwner->getStatusCode());
        $this->assertSame($wrongOwner->getContent(), $missing->getContent());
        $this->assertStringNotContainsString('App\\Models', (string) $missing->json('message'));
        $this->assertDatabaseHas('organizations', ['id' => $foreign->id]);
    }

    public function test_editing_another_colleges_registration_matches_editing_one_that_does_not_exist(): void
    {
        $foreign = $this->foreignRegistration();
        Sanctum::actingAs($this->head);

        $wrongOwner = $this->putJson("/api/college/organizations/{$foreign->id}", ['name' => 'Renamed']);
        $missing = $this->putJson('/api/college/organizations/999999', ['name' => 'Renamed']);

        $this->assertSame(404, $wrongOwner->getStatusCode());
        $this->assertSame($wrongOwner->getContent(), $missing->getContent());
        $this->assertStringNotContainsString('App\\Models', (string) $missing->json('message'));
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

    public function test_a_missing_route_bound_record_never_names_its_model(): void
    {
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->value('id')]));

        $response = $this->putJson('/api/system/organizations/999999', ['name' => 'Renamed']);

        $this->assertSame(404, $response->getStatusCode());
        $this->assertStringNotContainsString('App\\Models', (string) $response->json('message'));
    }
}
