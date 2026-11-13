<?php

namespace Tests\Feature;

use App\Http\Controllers\ElectionApplicationController;
use App\Http\Controllers\ElectionBallotController;
use App\Http\Controllers\ElectionGovernanceController;
use App\Http\Controllers\ElectionReportController;
use App\Http\Controllers\ElectionResultsController;
use App\Http\Controllers\OfficerTransitionController;
use App\Models\AccountProfile;
use App\Models\Election;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The full election process is built in separate slices that must never share a file, so every route of the contract is
 * registered up front on a stub controller: an allowed role reaches the stub (501), any other role is refused (403), and
 * the middleware each route carries is pinned here. The routes that already worked keep their behaviour; they only move
 * to the controller that will own them.
 */
class ElectionRouteScaffoldTest extends TestCase
{
    use RefreshDatabase;

    private const ALL = ['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'];

    /** @return array<int, array{0: string, 1: string, 2: array{0: class-string, 1: string}, 3: array<int, string>, 4: string, 5: ?string}> */
    private static function scaffold(): array
    {
        $apply = ['ADMIN', 'SBO_OFFICER', 'STUDENT'];
        $oversight = ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'SUPER_ADMIN'];

        return [
            // method, uri, [controller, action], roles, throttle, period.writable argument or null

            ['POST', 'api/elections/{id}/suspend', [ElectionGovernanceController::class, 'suspend'], ['ADMIN'], 'api-write', 'election'],
            ['POST', 'api/elections/{id}/resume', [ElectionGovernanceController::class, 'resume'], ['ADMIN'], 'api-write', 'election'],
            ['POST', 'api/elections/{id}/cancel', [ElectionGovernanceController::class, 'cancel'], ['ADMIN'], 'api-write', 'election'],
            ['GET', 'api/elections/{id}/approval-history', [ElectionGovernanceController::class, 'approvalHistory'], $oversight, 'api-read', null],

            ['GET', 'api/elections/{id}/applications', [ElectionApplicationController::class, 'index'], ['ADMIN', 'SBO_OFFICER'], 'api-read', null],
            ['GET', 'api/elections/{id}/applications/mine', [ElectionApplicationController::class, 'mine'], $apply, 'api-read', null],
            ['POST', 'api/elections/{id}/applications', [ElectionApplicationController::class, 'store'], $apply, 'api-write', 'election,voter'],
            ['POST', 'api/elections/{id}/applications/{application}', [ElectionApplicationController::class, 'update'], $apply, 'api-write', 'election,voter'],
            ['POST', 'api/elections/{id}/applications/{application}/submit', [ElectionApplicationController::class, 'submit'], $apply, 'api-write', 'election,voter'],
            ['POST', 'api/elections/{id}/applications/{application}/withdraw', [ElectionApplicationController::class, 'withdraw'], $apply, 'api-write', 'election,voter'],
            ['GET', 'api/elections/{id}/applications/{application}/files/{kind}', [ElectionApplicationController::class, 'file'], $apply, 'api-read', null],
            ['POST', 'api/elections/{id}/slates', [ElectionApplicationController::class, 'slateStore'], $apply, 'api-write', 'election,voter'],
            ['POST', 'api/elections/{id}/slates/{partylist}', [ElectionApplicationController::class, 'slateUpdate'], $apply, 'api-write', 'election,voter'],
            ['POST', 'api/elections/{id}/slates/{partylist}/members', [ElectionApplicationController::class, 'slateMemberStore'], $apply, 'api-write', 'election,voter'],
            ['POST', 'api/elections/{id}/slates/{partylist}/submit', [ElectionApplicationController::class, 'slateSubmit'], $apply, 'api-write', 'election,voter'],
            ['PATCH', 'api/elections/{id}/applications/{application}/review', [ElectionApplicationController::class, 'review'], ['ADMIN'], 'api-write', 'election'],

            ['POST', 'api/elections/{id}/runoff', [ElectionResultsController::class, 'runoff'], ['ADMIN'], 'api-write', 'election'],
            ['POST', 'api/elections/{id}/positions/{position}/tie-resolution', [ElectionResultsController::class, 'resolveTie'], ['DEPARTMENT_HEAD', 'SUPER_ADMIN'], 'api-write', null],

            ['GET', 'api/officer-transition/officers', [OfficerTransitionController::class, 'officers'], $oversight, 'api-read', null],
            ['GET', 'api/officer-transition/handover', [OfficerTransitionController::class, 'handover'], $oversight, 'api-read', null],
            ['POST', 'api/officer-transition/handover/{handover}', [OfficerTransitionController::class, 'prepare'], ['ADMIN', 'SBO_OFFICER'], 'api-write', null],
            ['POST', 'api/officer-transition/handover/{handover}/acknowledge', [OfficerTransitionController::class, 'acknowledge'], ['ADMIN', 'SBO_OFFICER'], 'api-write', null],
            ['GET', 'api/officer-transition/handover/{handover}/attachment', [OfficerTransitionController::class, 'attachment'], $oversight, 'api-read', null],
            ['GET', 'api/officer-transition/renewal', [OfficerTransitionController::class, 'renewal'], $oversight, 'api-read', null],

            ['GET', 'api/elections/{id}/reports/{type}', [ElectionReportController::class, 'show'], ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'], 'api-read', null],
        ];
    }

    public static function scaffoldRoutes(): array
    {
        $cases = [];
        foreach (self::scaffold() as $row) {
            $cases[$row[0].' '.$row[1]] = $row;
        }

        return $cases;
    }

    private function routeFor(string $method, string $uri)
    {
        $route = collect(Route::getRoutes()->getRoutes())->first(fn ($candidate) => $candidate->uri() === $uri && in_array($method, $candidate->methods(), true));
        $this->assertNotNull($route, "$method $uri is not registered.");

        return $route;
    }

    /** @dataProvider scaffoldRoutes */
    public function test_each_new_route_is_registered_with_its_controller_roles_and_middleware(string $method, string $uri, array $action, array $roles, string $throttle, ?string $period): void
    {
        $route = $this->routeFor($method, $uri);
        $middleware = $route->gatherMiddleware();

        $this->assertSame($action[0].'@'.$action[1], $route->getActionName());
        $this->assertContains('auth:sanctum', $middleware);
        $this->assertContains('role:'.implode(',', $roles), $middleware);
        $this->assertContains('throttle:'.$throttle, $middleware);

        $periodMiddleware = collect($middleware)->filter(fn ($name) => is_string($name) && str_starts_with($name, 'period.writable'))->values()->all();
        $this->assertSame($period === null ? [] : ['period.writable:'.$period], $periodMiddleware);
    }

    /** @dataProvider scaffoldRoutes */
    public function test_an_allowed_role_reaches_the_stub_and_every_other_role_is_refused(string $method, string $uri, array $action, array $roles): void
    {
        $organization = Organization::factory()->create();
        $election = Election::factory()->create(['organization_id' => $organization->id]);
        $path = '/'.str_replace(['{id}', '{application}', '{partylist}', '{position}', '{handover}', '{kind}', '{type}'], [$election->id, 1, 1, 1, 1, 'coc', 'results'], $uri);

        foreach (self::ALL as $role) {
            $user = User::factory()->create(['organization_id' => $organization->id, 'role' => $role, 'account_status' => 'active']);
            Sanctum::actingAs($user);

            $response = $this->json($method, $path);

            if (in_array($role, $roles, true)) {
                // The governance, filing, runoff and tie routes are built; their behaviour is pinned in ElectionGovernanceTest, ElectionCandidacyFilingTest, ElectionScreeningTest, ElectionRunoffTest and ElectionTieResolutionTest.
                if (in_array($action[0], [ElectionGovernanceController::class, ElectionApplicationController::class, ElectionResultsController::class], true)) {
                    continue;
                }
                $response->assertStatus(501);
            } else {
                $response->assertForbidden();
            }
        }
    }

    public function test_the_moved_routes_point_at_their_new_controllers(): void
    {
        $this->assertSame(ElectionBallotController::class.'@vote', $this->routeFor('POST', 'api/elections/{id}/vote')->getActionName());
        $this->assertSame(ElectionBallotController::class.'@voters', $this->routeFor('GET', 'api/elections/{id}/voters')->getActionName());
        $this->assertSame(ElectionResultsController::class.'@results', $this->routeFor('GET', 'api/elections/{id}/results')->getActionName());
    }

    public function test_only_the_admin_writes_candidates(): void
    {
        foreach ([['POST', 'api/elections/{id}/candidates'], ['PUT', 'api/elections/{id}/candidates/{candidateId}'], ['DELETE', 'api/elections/{id}/candidates/{candidateId}']] as [$method, $uri]) {
            $this->assertContains('role:ADMIN', $this->routeFor($method, $uri)->gatherMiddleware(), "$method $uri");
        }

        $organization = Organization::factory()->create();
        $election = Election::factory()->create(['organization_id' => $organization->id, 'status' => 'upcoming', 'finalized_at' => null]);
        Sanctum::actingAs(User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'account_status' => 'active']));

        $this->postJson("/api/elections/{$election->id}/candidates", [])->assertForbidden();
        $this->putJson("/api/elections/{$election->id}/candidates/1", [])->assertForbidden();
        $this->deleteJson("/api/elections/{$election->id}/candidates/1")->assertForbidden();
    }

    public function test_the_election_route_files_are_loaded_from_one_glob(): void
    {
        $this->assertNotEmpty(glob(base_path('routes/elections/*.php')));
        $this->assertStringContainsString("glob(__DIR__.'/elections/*.php')", file_get_contents(base_path('routes/api.php')));
    }

    public function test_a_module_limited_officer_can_still_file_and_read_their_own_candidacy(): void
    {
        $organization = Organization::factory()->create();
        $election = Election::factory()->create(['organization_id' => $organization->id]);
        $officer = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'account_status' => 'active']);
        AccountProfile::where('user_school_id', $officer->school_id)->update(['modules' => ['events']]);
        Sanctum::actingAs($officer);

        foreach ([
            ['GET', "/api/elections/{$election->id}/applications/mine"],
            ['GET', "/api/elections/{$election->id}/applications/1/files/coc"],
            ['POST', "/api/elections/{$election->id}/applications"],
            ['POST', "/api/elections/{$election->id}/applications/1"],
            ['POST', "/api/elections/{$election->id}/applications/1/submit"],
            ['POST', "/api/elections/{$election->id}/applications/1/withdraw"],
            ['POST', "/api/elections/{$election->id}/slates"],
            ['POST', "/api/elections/{$election->id}/slates/1"],
            ['POST', "/api/elections/{$election->id}/slates/1/members"],
            ['POST', "/api/elections/{$election->id}/slates/1/submit"],
        ] as [$method, $path]) {
            // The routes are built: the officer's module limit must not refuse them (the filing tests pin what they answer).
            $this->assertNotSame(403, $this->json($method, $path)->getStatusCode(), "$method $path");
        }

        // The oversight reads still need the elections module the officer was not given.
        $this->getJson("/api/elections/{$election->id}/applications")->assertForbidden();
        // The officer transition page is open to every officer.
        $this->getJson('/api/officer-transition/renewal')->assertStatus(501);
    }
}
