<?php

namespace Tests\Feature;

use App\Models\EventRequirement;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class RequirementSamplePolicyTest extends TestCase
{
    use DatabaseMigrations;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->value('id')]));
    }

    public static function catalogs(): array
    {
        return [
            'organization' => ['/api/compliance/requirement-types', 'compliance_requirement_types', ['academic_year' => '2026-2027', 'name' => 'Constitution', 'deadline_at' => '2026-12-31']],
            'semestral report' => ['/api/compliance/requirement-types', 'compliance_requirement_types', ['academic_year' => '2026-2027', 'category' => 'semestral_report', 'name' => 'Semester report', 'deadline_at' => '2026-12-31']],
            'event' => ['/api/event-requirements', 'event_requirements', ['name' => 'Proposal', 'allowed_extensions' => ['pdf']]],
        ];
    }

    #[DataProvider('catalogs')]
    public function test_a_publisher_cannot_create_a_requirement_without_a_sample(string $url, string $table, array $payload): void
    {
        $count = DB::table($table)->count();
        $this->postJson($url, $payload)->assertUnprocessable()->assertJsonValidationErrors(['template', 'template_url']);
        $this->assertDatabaseCount($table, $count);
        $this->assertDatabaseMissing('notifications', ['title' => 'New compliance requirement']);
        $this->postJson($url, [...$payload, 'template_url' => 'javascript:alert(1)'])->assertUnprocessable()->assertJsonValidationErrors('template_url');
    }

    #[DataProvider('catalogs')]
    public function test_a_sample_is_created_and_replaced_atomically_in_the_same_request(string $url, string $table, array $payload): void
    {
        $id = $this->post($url, [...$payload, 'template' => UploadedFile::fake()->create('sample.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])
            ->assertCreated()->assertJsonPath('template_original_name', 'sample.pdf')->assertJsonMissingPath('template_path')->json('id');
        $path = DB::table($table)->where('id', $id)->value('template_path');
        Storage::disk('local')->assertExists($path);
        $this->post($url.'/'.$id, [...$payload, '_method' => 'PUT', 'template' => UploadedFile::fake()->create('replacement.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('template_original_name', 'replacement.pdf');
        Storage::disk('local')->assertMissing($path);
        $nextPath = DB::table($table)->where('id', $id)->value('template_path');
        Storage::disk('local')->assertExists($nextPath);
        $this->putJson($url.'/'.$id, [...$payload, 'template_url' => 'https://example.edu/official-format'])
            ->assertOk()->assertJsonPath('template_url', 'https://example.edu/official-format')->assertJsonPath('template_original_name', null);
        Storage::disk('local')->assertMissing($nextPath);
        $this->deleteJson($url.'/'.$id.'/template')->assertConflict();
        $this->putJson($url.'/'.$id, [...$payload, 'is_active' => false])->assertOk();
        $this->deleteJson($url.'/'.$id.'/template')->assertOk();
        $this->putJson($url.'/'.$id, [...$payload, 'is_active' => true])->assertUnprocessable()->assertJsonValidationErrors('template');
    }

    #[DataProvider('catalogs')]
    public function test_a_failed_sample_upload_rolls_back_the_requirement(string $url, string $table, array $payload): void
    {
        $count = DB::table($table)->count();
        $disk = \Mockery::mock(FilesystemAdapter::class);
        $disk->shouldReceive('putFileAs')->once()->andReturn(false);
        Storage::shouldReceive('disk')->with('local')->andReturn($disk);
        $this->post($url, [...$payload, 'template' => UploadedFile::fake()->create('sample.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])->assertStatus(500);
        $this->assertDatabaseCount($table, $count);
        $this->assertDatabaseMissing('notifications', ['title' => 'New compliance requirement']);
    }

    public function test_legacy_requirements_need_a_real_sample_before_they_can_be_published_again(): void
    {
        $event = EventRequirement::create(['name' => 'Legacy proposal', 'allowed_extensions' => ['pdf'], 'is_active' => false, 'template_path' => 'missing.pdf', 'template_original_name' => 'missing.pdf']);
        $this->putJson('/api/event-requirements/'.$event->id, ['name' => $event->name, 'allowed_extensions' => ['pdf'], 'is_active' => true])->assertUnprocessable();
        $this->assertFalse($event->fresh()->is_active);
        $this->putJson('/api/event-requirements/'.$event->id, ['name' => $event->name, 'allowed_extensions' => ['pdf'], 'is_active' => true, 'template_url' => 'https://example.edu/format'])->assertOk();
        $this->assertTrue($event->fresh()->is_active);
    }

    public function test_sample_permissions_and_file_validation_cannot_be_bypassed(): void
    {
        $payload = self::catalogs()['event'][2];
        $this->post('/api/event-requirements', [...$payload, 'template' => UploadedFile::fake()->image('photo.png')], ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors('template');
        $this->post('/api/event-requirements', [...$payload, 'template' => UploadedFile::fake()->create('sample.pdf', 10, 'application/pdf'), 'template_url' => 'https://example.edu/format'], ['Accept' => 'application/json'])->assertUnprocessable();
        Sanctum::actingAs(User::factory()->admin()->create());
        $this->postJson('/api/event-requirements', [...$payload, 'template_url' => 'https://example.edu/format'])->assertForbidden();
        $this->postJson('/api/compliance/requirement-types', [...self::catalogs()['organization'][2], 'template_url' => 'https://example.edu/format'])->assertForbidden();
    }
}
