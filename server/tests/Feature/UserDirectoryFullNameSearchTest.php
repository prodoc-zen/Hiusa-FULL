<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class UserDirectoryFullNameSearchTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $organization->id, 'first_name' => 'Quill', 'last_name' => 'Keeper', 'email' => 'keeper@ex.test']);
        Sanctum::actingAs($this->admin);

        foreach ([['Juan', 'Dela Cruz'], ['Juana', 'Santos'], ['Maria', 'Cruz']] as $n => [$first, $last]) {
            User::factory()->student()->create(['organization_id' => $organization->id, 'first_name' => $first, 'last_name' => $last, 'email' => "member{$n}@ex.test"]);
        }
    }

    private function found(string $search): array
    {
        return collect($this->getJson('/api/users?'.http_build_query(['search' => $search]))->assertOk()->json('data'))
            ->map(fn ($user) => trim($user['first_name'].' '.$user['last_name']))->sort()->values()->all();
    }

    public function test_a_full_name_finds_the_member(): void
    {
        $this->assertSame(['Juan Dela Cruz'], $this->found('Juan Dela Cruz'));
        $this->assertSame(['Juan Dela Cruz'], $this->found('juan dela cruz'));
        $this->assertSame(['Juan Dela Cruz'], $this->found('  Juan   Dela Cruz '));
    }

    public function test_surname_first_finds_the_member_with_or_without_the_comma(): void
    {
        $this->assertSame(['Juan Dela Cruz'], $this->found('Dela Cruz, Juan'));
        $this->assertSame(['Juan Dela Cruz'], $this->found('Dela Cruz,Juan'));
        $this->assertSame(['Juan Dela Cruz'], $this->found('Dela Cruz Juan'));
    }

    public function test_a_single_word_and_a_partial_full_name_still_match(): void
    {
        $this->assertSame(['Juan Dela Cruz', 'Juana Santos'], $this->found('Juan'));
        $this->assertSame(['Juan Dela Cruz', 'Maria Cruz'], $this->found('Cruz'));
        $this->assertSame(['Juan Dela Cruz'], $this->found('Juan Dela'));
        $this->assertSame([], $this->found('Juan Santos'));
    }

    public function test_the_search_text_is_bound_not_interpolated(): void
    {
        $this->assertSame([], $this->found("Juan Dela Cruz' OR '1'='1"));
    }
}
