<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Replacing the GCash QR removes the old upload but never the shared demo image the seeders point at. */
class GcashQrReplaceTest extends TestCase
{
    use RefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    /** @var list<string> */
    private array $created = [];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    protected function tearDown(): void
    {
        foreach ($this->created as $path) {
            if (is_file($path)) {
                unlink($path);
            }
        }
        parent::tearDown();
    }

    private function existingQr(string $name): string
    {
        $path = public_path('uploads/gcash/'.$name);
        file_put_contents($path, base64_decode(self::PNG));
        $this->created[] = $path;

        return '/uploads/gcash/'.$name;
    }

    private function replaceQrFor(Organization $organization): void
    {
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $organization->id]));
        $this->post('/api/merchandise/gcash-settings', [
            'qr_code' => UploadedFile::fake()->createWithContent('qr.png', base64_decode(self::PNG)),
        ], ['Accept' => 'application/json'])->assertOk();
    }

    public function test_replacing_the_qr_deletes_the_previous_upload(): void
    {
        $url = $this->existingQr('qr-replace-test-old.png');
        $organization = Organization::factory()->create(['gcash_qr_url' => $url]);

        $this->replaceQrFor($organization);

        $this->assertFileDoesNotExist(public_path(ltrim($url, '/')));
        $this->assertNotSame($url, $organization->fresh()->gcash_qr_url);
    }

    public function test_replacing_the_qr_keeps_the_shared_demo_image(): void
    {
        $url = $this->existingQr('demo-qr-replace-test.png');
        $organization = Organization::factory()->create(['gcash_qr_url' => $url]);

        $this->replaceQrFor($organization);

        $this->assertFileExists(public_path(ltrim($url, '/')));
        $this->assertNotSame($url, $organization->fresh()->gcash_qr_url);
    }
}
