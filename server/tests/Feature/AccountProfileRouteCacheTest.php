<?php

namespace Tests\Feature;

use Illuminate\Http\Request;
use Tests\TestCase;

class AccountProfileRouteCacheTest extends TestCase
{
    public function test_membership_routes_remain_protected_when_loaded_from_the_route_cache(): void
    {
        $relativePath = 'bootstrap/cache/membership-test-'.bin2hex(random_bytes(8)).'.php';
        $cachePath = base_path($relativePath);
        $previousPath = getenv('APP_ROUTES_CACHE');
        putenv('APP_ROUTES_CACHE='.$relativePath);

        try {
            $this->artisan('route:cache')->assertExitCode(0);
            $this->refreshApplication();
            $this->assertTrue($this->app->routesAreCached());

            foreach (['organizations', 'candidates', 'invite'] as $endpoint) {
                $method = $endpoint === 'invite' ? 'POST' : 'GET';
                $url = '/api/account-profiles/'.$endpoint;
                $route = $this->app['router']->getRoutes()->match(Request::create($url, $method));
                $this->assertContains('auth:sanctum', $route->gatherMiddleware());
                $this->assertContains('role:SUPER_ADMIN,ADMIN', $route->gatherMiddleware());
                $this->json($method, $url)->assertUnauthorized()->assertJsonPath('message', 'Unauthenticated.');
            }
        } finally {
            if (is_file($cachePath)) {
                unlink($cachePath);
            }
            putenv($previousPath === false ? 'APP_ROUTES_CACHE' : 'APP_ROUTES_CACHE='.$previousPath);
        }
    }
}
