<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ValidationMessageTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_validation_failure_answers_with_the_first_message_only_and_lists_every_field(): void
    {
        Sanctum::actingAs(User::factory()->admin()->create());

        $response = $this->postJson('/api/announcements', ['title' => '', 'body' => '', 'target_role' => 'nobody'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['title', 'body']);

        $errors = $response->json('errors');
        $this->assertGreaterThan(1, count($errors));
        $this->assertSame(collect($errors)->flatten()->first(), $response->json('message'));
        $this->assertStringNotContainsString('(and', $response->json('message'));
    }

    public function test_a_public_endpoint_answers_the_same_way(): void
    {
        $response = $this->postJson('/api/login', [])->assertStatus(422);

        $this->assertSame(collect($response->json('errors'))->flatten()->first(), $response->json('message'));
    }
}
