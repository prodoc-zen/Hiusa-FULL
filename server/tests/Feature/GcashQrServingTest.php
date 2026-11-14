<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\Merchandise;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** The GCash QR is kept on the private disk and opened through an authenticated route, never linked from the public folder. */
class GcashQrServingTest extends TestCase
{
    use RefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    private const OPEN_URL = '/merchandise/gcash-settings/qr';

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    private function upload(Organization $organization)
    {
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $organization->id, 'account_status' => 'active']));

        return $this->post('/api/merchandise/gcash-settings', [
            'qr_code' => UploadedFile::fake()->createWithContent('qr.png', base64_decode(self::PNG)),
        ], ['Accept' => 'application/json']);
    }

    public function test_an_upload_lands_on_the_private_disk_and_the_answer_is_an_open_url(): void
    {
        $organization = Organization::factory()->create(['gcash_qr_url' => null]);
        $before = glob(public_path('uploads/gcash/*')) ?: [];

        $response = $this->upload($organization)->assertOk();

        $stored = $organization->fresh()->gcash_qr_url;
        Storage::disk('local')->assertExists($stored);
        $this->assertStringStartsNotWith('/uploads/', $stored);
        $this->assertSame(self::OPEN_URL, $response->json('gcash_qr_open_url'));
        $this->assertNull($response->json('gcash_qr_url'));
        $this->assertSame($before, glob(public_path('uploads/gcash/*')) ?: []);
    }

    public function test_the_open_url_is_withheld_when_the_saved_file_is_gone(): void
    {
        $organization = Organization::factory()->create(['gcash_qr_url' => 'gcash-qr/9/missing.png']);
        Sanctum::actingAs(User::factory()->student()->create(['organization_id' => $organization->id, 'account_status' => 'active']));

        $this->getJson('/api/merchandise/gcash-settings')->assertOk()->assertExactJson(['gcash_qr_open_url' => null]);
        $this->getJson('/api'.self::OPEN_URL)->assertNotFound();
    }

    public function test_a_student_of_the_organization_opens_the_image_with_their_token(): void
    {
        $organization = Organization::factory()->create(['gcash_qr_url' => null]);
        $this->upload($organization)->assertOk();
        Sanctum::actingAs(User::factory()->student()->create(['organization_id' => $organization->id, 'account_status' => 'active']));

        $this->getJson('/api/merchandise/gcash-settings')->assertOk()->assertJson(['gcash_qr_open_url' => self::OPEN_URL]);
        $response = $this->get('/api'.self::OPEN_URL)->assertOk();
        $this->assertSame('image/png', $response->headers->get('Content-Type'));
        $this->assertSame('nosniff', $response->headers->get('X-Content-Type-Options'));
    }

    public function test_an_officer_without_the_store_area_can_still_see_the_qr_a_buyer_sees(): void
    {
        $organization = Organization::factory()->create(['gcash_qr_url' => null]);
        $this->upload($organization)->assertOk();
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id, 'account_status' => 'active']);
        AccountProfile::where('user_school_id', $officer->school_id)->where('organization_id', $organization->id)->update(['modules' => ['finance']]);
        Sanctum::actingAs($officer);

        $this->getJson('/api/merchandise/gcash-settings')->assertOk()->assertJson(['gcash_qr_open_url' => self::OPEN_URL]);
        $this->get('/api'.self::OPEN_URL)->assertOk();
    }

    public function test_a_signed_out_visitor_cannot_open_the_image(): void
    {
        $this->getJson('/api'.self::OPEN_URL)->assertUnauthorized();
    }

    public function test_a_qr_saved_before_the_move_is_still_opened_through_the_route(): void
    {
        $organization = Organization::factory()->create(['gcash_qr_url' => '/uploads/gcash/demo-gcash-qr.png']);
        Sanctum::actingAs(User::factory()->student()->create(['organization_id' => $organization->id, 'account_status' => 'active']));

        $this->getJson('/api/merchandise/gcash-settings')->assertOk()->assertJson(['gcash_qr_open_url' => self::OPEN_URL]);
        $this->get('/api'.self::OPEN_URL)->assertOk();
    }

    public function test_a_gcash_order_is_refused_when_the_column_is_set_but_the_file_is_gone(): void
    {
        $organization = Organization::factory()->create(['gcash_qr_url' => 'gcash-qr/9/missing.png']);
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id, 'account_status' => 'active']);
        $item = Merchandise::factory()->create(['organization_id' => $organization->id, 'price' => 100, 'stock_quantity' => 5, 'is_active' => true]);
        $message = 'GCash payment is unavailable until an administrator uploads the official QR code.';
        Sanctum::actingAs($buyer);

        $this->post('/api/orders', [
            'merchandise_id' => $item->id,
            'quantity' => 1,
            'payment_method' => 'gcash',
            'payment_reference' => '1234567890123',
            'payment_proof' => UploadedFile::fake()->createWithContent('proof.png', base64_decode(self::PNG)),
        ], ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonPath('message', $message);

        $orderId = $this->postJson('/api/orders', ['merchandise_id' => $item->id, 'quantity' => 1, 'payment_method' => 'cash'])
            ->assertCreated()->json('id');
        $this->post("/api/orders/{$orderId}/payment", [
            'payment_reference' => '1234567890123',
            'payment_proof' => UploadedFile::fake()->createWithContent('proof.png', base64_decode(self::PNG)),
        ], ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonPath('message', $message);
    }

    public function test_a_saved_value_that_climbs_out_of_the_folder_is_not_served(): void
    {
        $organization = Organization::factory()->create(['gcash_qr_url' => '/uploads/gcash/../../.env.example']);
        Sanctum::actingAs(User::factory()->student()->create(['organization_id' => $organization->id, 'account_status' => 'active']));

        $this->getJson('/api/merchandise/gcash-settings')->assertOk()->assertJson(['gcash_qr_open_url' => null]);
        $this->getJson('/api'.self::OPEN_URL)->assertNotFound();
    }

    public function test_replacing_a_private_qr_deletes_the_previous_file(): void
    {
        $organization = Organization::factory()->create(['gcash_qr_url' => null]);
        $this->upload($organization)->assertOk();
        $first = $organization->fresh()->gcash_qr_url;

        $this->upload($organization)->assertOk();

        Storage::disk('local')->assertMissing($first);
        $this->assertNotSame($first, $organization->fresh()->gcash_qr_url);
        Storage::disk('local')->assertExists($organization->fresh()->gcash_qr_url);
    }
}
