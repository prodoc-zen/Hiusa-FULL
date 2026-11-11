<?php

namespace Tests\Feature;

use App\Models\Merchandise;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** A product image must be a real picture: the server refuses a PDF whatever the picker allowed. */
class MerchandiseImageUploadTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $this->organization->id]));
    }

    public function test_a_pdf_is_refused_as_a_new_product_image(): void
    {
        $this->post('/api/merchandise', [
            'name' => 'HIUSA Shirt', 'category' => 'Apparel', 'price' => 200, 'stock_quantity' => 3,
            'image' => UploadedFile::fake()->create('price-list.pdf', 20, 'application/pdf'),
        ], ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors('image');

        $this->assertSame(0, Merchandise::count());
    }

    public function test_a_pdf_is_refused_as_a_product_or_size_image_on_edit(): void
    {
        $item = Merchandise::factory()->create(['organization_id' => $this->organization->id]);
        $before = $item->image_url;

        $this->put("/api/merchandise/{$item->id}", [
            'image' => UploadedFile::fake()->create('price-list.pdf', 20, 'application/pdf'),
        ], ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors('image');

        $this->put("/api/merchandise/{$item->id}", [
            'variants' => json_encode([['name' => 'M', 'stock_quantity' => 2]]),
            'variant_images' => [UploadedFile::fake()->create('price-list.pdf', 20, 'application/pdf')],
        ], ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors('variant_images.0');

        $this->assertSame($before, $item->fresh()->image_url);
    }
}
