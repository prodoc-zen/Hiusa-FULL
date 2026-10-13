<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Grievance;
use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OverallFeedbackRegressionTest extends TestCase
{
    use RefreshDatabase;

    public function test_closed_grievance_deletion_is_scoped_and_preserves_the_students_record(): void
    {
        $org = Organization::factory()->create();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $case = Grievance::create(['organization_id' => $org->id, 'submitted_by' => $student->school_id, 'title' => 'Venue concern', 'description' => 'A concern about the venue.', 'category' => 'General', 'urgency' => 'Low', 'is_anonymous' => true, 'status' => 'submitted']);
        Sanctum::actingAs($student);
        $draft = Grievance::create(['organization_id' => $org->id, 'submitted_by' => $student->school_id, 'title' => 'Withdrawn concern', 'description' => 'An unreviewed concern.', 'category' => 'General', 'urgency' => 'Low', 'is_anonymous' => false, 'status' => 'submitted']);
        $this->deleteJson('/api/grievances/'.$draft->id)->assertOk();
        $this->assertDatabaseMissing('grievances', ['id' => $draft->id]);
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]));
        $this->deleteJson('/api/grievances/'.$case->id)->assertNotFound();
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $org->id]));
        $this->deleteJson('/api/grievances/'.$case->id)->assertConflict();
        $case->update(['status' => 'resolved', 'remarks' => 'Venue repaired.']);
        $this->deleteJson('/api/grievances/'.$case->id)->assertNoContent();
        $this->assertSoftDeleted($case);
        $this->getJson('/api/grievances')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/grievances/'.$case->id)->assertNotFound();
        Sanctum::actingAs($student);
        $this->getJson('/api/grievances')->assertOk()->assertJsonPath('data.0.id', $case->id);
        $this->getJson('/api/grievances/'.$case->id)->assertOk()->assertJsonPath('remarks', 'Venue repaired.');
    }

    public function test_deleted_inventory_stays_deleted_and_preserves_completed_order_details(): void
    {
        $org = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $buyer = User::factory()->student()->create(['organization_id' => $org->id]);
        $item = Merchandise::factory()->create(['organization_id' => $org->id]);
        $order = Order::factory()->create(['organization_id' => $org->id, 'student_id' => $buyer->school_id, 'merchandise_id' => $item->id, 'status' => 'claimed']);
        Sanctum::actingAs($buyer);
        $this->deleteJson('/api/merchandise/'.$item->id)->assertForbidden();
        Sanctum::actingAs(User::factory()->admin()->create());
        $this->deleteJson('/api/merchandise/'.$item->id)->assertNotFound();
        Sanctum::actingAs($admin);
        $this->deleteJson('/api/merchandise/'.$item->id)->assertOk();
        $this->assertSoftDeleted($item);
        $this->getJson('/api/merchandise')->assertOk()->assertJsonCount(0, 'data');
        $this->assertSame($item->name, $order->fresh()->merchandise->name);
        $this->getJson('/api/orders')->assertOk()->assertJsonPath('data.0.merchandise.name', $item->name);
    }

    public function test_inventory_with_unfulfilled_orders_cannot_be_deleted(): void
    {
        $admin = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        $item = Merchandise::factory()->create(['organization_id' => $admin->organization_id]);
        Order::factory()->create(['organization_id' => $admin->organization_id, 'merchandise_id' => $item->id, 'status' => 'paid']);
        Sanctum::actingAs($admin);
        $this->deleteJson('/api/merchandise/'.$item->id)->assertConflict();
        $this->assertNotNull($item->fresh());
        $this->assertNull($item->fresh()->deleted_at);
    }

    public function test_all_claim_tokens_combines_paid_and_claimed_before_pagination_and_is_organization_scoped(): void
    {
        $admin = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        $item = Merchandise::factory()->create(['organization_id' => $admin->organization_id]);
        $buyer = User::factory()->student()->create(['organization_id' => $admin->organization_id]);
        foreach (['paid' => 11, 'claimed' => 12, 'pending' => 2] as $status => $count) {
            Order::factory()->count($count)->create(['organization_id' => $admin->organization_id, 'merchandise_id' => $item->id, 'student_id' => $buyer->school_id, 'status' => $status]);
        }
        Order::factory()->create(['organization_id' => Organization::factory()->create()->id, 'status' => 'paid']);
        Sanctum::actingAs($admin);
        $response = $this->getJson('/api/orders?status=claimable&sort=oldest')->assertOk()->assertJsonPath('total', 23)->assertJsonCount(10, 'data');
        foreach ($response->json('data') as $row) {
            $this->assertContains($row['status'], ['paid', 'claimed']);
        }
        $this->getJson('/api/orders?status=claimed')->assertOk()->assertJsonPath('total', 12);
    }

    public function test_sao_photo_upload_keeps_nested_audience_fields_and_rejects_invalid_files(): void
    {
        Storage::fake('public');
        $admin = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        $fields = ['title' => 'University notice', 'body' => 'Please review the attached photo.', 'target_scope' => 'selected_organizations', 'target_organization_ids' => [$admin->organization_id], 'target_roles' => ['ADMIN'], 'publish' => false];
        Sanctum::actingAs($admin);
        $this->post('/api/system/announcements', ['payload' => json_encode($fields), 'image' => UploadedFile::fake()->image('photo.png')])->assertForbidden();
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]));
        $response = $this->withHeader('Accept', 'application/json')->post('/api/system/announcements', ['payload' => json_encode($fields), 'image' => UploadedFile::fake()->image('photo.png')])->assertCreated()->assertJsonPath('target_roles.0', 'ADMIN')->assertJsonPath('recipients_count', 1);
        Storage::disk('public')->assertExists(substr($response->json('image_url'), strlen('/storage/')));
        $this->post('/api/system/announcements', ['payload' => json_encode($fields), 'image' => UploadedFile::fake()->create('bad.pdf', 10, 'application/pdf')])->assertUnprocessable()->assertJsonValidationErrors('image');
        $this->post('/api/system/announcements/'.$response->json('id'), ['_method' => 'PUT', 'payload' => json_encode([...$fields, 'title' => 'Updated notice']), 'image' => UploadedFile::fake()->image('replacement.png')])->assertOk()->assertJsonPath('title', 'Updated notice');
    }

    public function test_college_deletion_revokes_affected_sessions_and_leaves_other_colleges_active(): void
    {
        $college = College::create(['name' => 'Archived College', 'is_active' => true]);
        $org = Organization::factory()->create(['college' => $college->name]);
        $member = User::factory()->admin()->create(['organization_id' => $org->id]);
        $member->createToken('session');
        $other = User::factory()->admin()->create();
        $other->createToken('session');
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]));
        $this->deleteJson('/api/system/colleges/'.$college->id)->assertNoContent();
        $this->assertSame(0, $member->tokens()->count());
        $this->assertSame(1, $other->tokens()->count());
        $this->assertSame('active', $other->fresh()->account_status);
        $this->assertTrue($other->organization->is_active);
    }
}
