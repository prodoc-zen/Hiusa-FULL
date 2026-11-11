<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class ApprovalRequestRequestedAtTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    private function attributes(): array
    {
        $organization = Organization::factory()->create();
        $requester = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);

        return [
            'organization_id' => $organization->id,
            'entity_type' => 'election',
            'entity_id' => 1,
            'requested_by' => $requester->school_id,
            'required_role' => 'DEPARTMENT_HEAD',
        ];
    }

    public function test_requested_at_is_the_app_clock_when_the_caller_does_not_pass_one(): void
    {
        $attributes = $this->attributes();
        $frozen = Carbon::parse('2026-11-11 17:59:00', config('app.timezone'));
        Carbon::setTestNow($frozen);

        $approval = ApprovalRequest::create($attributes)->fresh();

        $this->assertSame($frozen->toJSON(), $approval->requested_at->toJSON());
        $this->assertSame($frozen->toJSON(), $approval->toArray()['requested_at']);
    }

    public function test_an_explicit_requested_at_is_kept(): void
    {
        $attributes = $this->attributes();
        Carbon::setTestNow(Carbon::parse('2026-11-11 17:59:00', config('app.timezone')));
        $explicit = Carbon::parse('2026-11-08 09:15:00', config('app.timezone'));

        $approval = ApprovalRequest::create($attributes + ['requested_at' => $explicit])->fresh();

        $this->assertSame($explicit->toJSON(), $approval->requested_at->toJSON());
    }
}
