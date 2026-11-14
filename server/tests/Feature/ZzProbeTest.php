<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use App\Services\Ai\AskAiService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class ZzProbeTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    public function test_probe(): void
    {
        config(['performance.api_cache.enabled' => false, 'services.groq.key' => '', 'services.anthropic.key' => '']);
        $home = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $org = Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION', 'lifecycle_status' => 'active', 'is_active' => true]);
        $users = [
            'SUPER_ADMIN' => User::factory()->superAdmin()->create(['organization_id' => $home->id]),
            'DEPARTMENT_HEAD' => $this->makeCollegeHead($this->makeCollege('CCS')),
            'ADMIN' => User::factory()->admin()->create(['organization_id' => $org->id]),
            'SBO_OFFICER' => User::factory()->officer()->create(['organization_id' => $org->id]),
            'STUDENT' => User::factory()->student()->create(['organization_id' => $org->id]),
        ];
        $qs = json_decode(file_get_contents(getenv('PROBE')), true);
        $svc = $this->app->make(AskAiService::class);
        foreach ($qs as [$role, $q]) {
            $u = $users[$role];
            $intent = $svc->classifyIntent($q, null, $u->role);
            $p = $svc->deterministicAnswer($u, $q, $intent);
            $hrefs = collect($p['sections'])->pluck('rows')->flatten(1)->pluck('href')->filter()->values()->all();
            fwrite(STDERR, "\n[$role] $q\n  -> $intent | {$p['title']}\n  ".substr(str_replace("\n", ' / ', $p['answer']), 0, 400)."\n  hrefs: ".json_encode($hrefs)."\n");
        }
        $this->assertTrue(true);
    }
}
