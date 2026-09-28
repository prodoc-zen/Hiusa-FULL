<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

class CacheApiResponse
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! config('performance.api_cache.enabled') || ! $request->user()) {
            return $next($request);
        }

        if (in_array($request->method(), ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
            $response = $next($request);

            if ($response->isSuccessful()) {
                $user = $request->user();
                $this->invalidateOrganization($user->organization_id);
                // Every successful write bumps the "sao" version, which only
                // SUPER_ADMIN cache keys include, so a SUPER_ADMIN's
                // university-wide views never hand back a stale cached
                // response after any organization's write.
                $this->invalidateSao();
                if ($user->role === 'SUPER_ADMIN') {
                    // A SUPER_ADMIN write can affect any organization (e.g.
                    // approving an org's budget or booking), not just their
                    // own - bumping only their own org's version left every
                    // other org on a stale cache hit for up to the TTL. The
                    // global version is part of every cache key, so this
                    // invalidates everyone at once.
                    $this->invalidateGlobal();
                }
            }

            return $response;
        }

        if (! $request->isMethod('GET')) {
            return $next($request);
        }

        if (! $this->routeRoleAllows($request)) {
            return $next($request);
        }

        $cacheKey = $this->cacheKey($request);

        try {
            $cached = Cache::get($cacheKey);
        } catch (Throwable) {
            return $next($request);
        }

        if (is_array($cached) && isset($cached['content'], $cached['content_type'], $cached['etag'])) {
            return $this->cachedResponse($request, $cached);
        }

        $response = $next($request);

        if (! $this->isCacheable($response)) {
            return $response;
        }

        $content = $response->getContent();
        $cached = [
            'content' => $content,
            'content_type' => (string) $response->headers->get('Content-Type', 'application/json'),
            'etag' => '"'.hash('sha256', $content).'"',
        ];

        try {
            Cache::put(
                $cacheKey,
                $cached,
                max(1, (int) config('performance.api_cache.ttl_seconds', 20)),
            );
        } catch (Throwable) {
            return $this->withPrivateHeaders($response, $cached['etag'], 'BYPASS');
        }

        if ($this->etagMatches($request, $cached['etag'])) {
            return $this->notModifiedResponse($cached['etag'], 'MISS');
        }

        return $this->withPrivateHeaders($response, $cached['etag'], 'MISS');
    }

    private function cacheKey(Request $request): string
    {
        $user = $request->user();
        $query = $request->query();
        $this->sortRecursively($query);

        try {
            $orgVersion = (int) Cache::get($this->versionKey($user->organization_id), 1);
            $globalVersion = (int) Cache::get($this->globalVersionKey(), 1);
        } catch (Throwable) {
            $orgVersion = 1;
            $globalVersion = 1;
        }

        $identity = implode(':', [
            $user->organization_id,
            $user->getAuthIdentifier(),
            $user->role,
            $orgVersion,
            $globalVersion,
        ]);

        if ($user->role === 'SUPER_ADMIN') {
            try {
                $saoVersion = (int) Cache::get($this->saoVersionKey(), 1);
            } catch (Throwable) {
                $saoVersion = 1;
            }

            $identity .= ':'.$saoVersion;
        }

        return 'api-response:'.hash('sha256', $identity.'|'.$request->path().'|'.json_encode($query));
    }

    private function isCacheable(Response $response): bool
    {
        $contentType = strtolower((string) $response->headers->get('Content-Type'));
        $length = strlen($response->getContent());

        return $response->getStatusCode() === 200
            && str_contains($contentType, 'application/json')
            && ! $response->headers->has('Set-Cookie')
            && $length <= max(1, (int) config('performance.api_cache.max_bytes', 1048576));
    }

    private function cachedResponse(Request $request, array $cached): Response
    {
        if ($this->etagMatches($request, $cached['etag'])) {
            return $this->notModifiedResponse($cached['etag'], 'HIT');
        }

        $response = response($cached['content'], 200)
            ->header('Content-Type', $cached['content_type']);

        return $this->withPrivateHeaders($response, $cached['etag'], 'HIT');
    }

    private function notModifiedResponse(string $etag, string $cacheStatus): Response
    {
        return $this->withPrivateHeaders(response('', 304), $etag, $cacheStatus);
    }

    private function withPrivateHeaders(Response $response, string $etag, string $cacheStatus): Response
    {
        $response->headers->set('Cache-Control', 'private, no-cache, max-age=0, must-revalidate');
        $response->headers->set('ETag', $etag);
        $response->headers->set('Vary', 'Authorization, Accept-Encoding');
        $response->headers->set('X-Cache', $cacheStatus);

        return $response;
    }

    private function etagMatches(Request $request, string $etag): bool
    {
        return in_array($etag, $request->getETags(), true);
    }

    private function invalidateOrganization(int|string $organizationId): void
    {
        try {
            $key = $this->versionKey($organizationId);
            Cache::put($key, (int) Cache::get($key, 1) + 1, now()->addDays(30));
        } catch (Throwable) {
            // Cache failure must not turn a successful business write into an error.
        }
    }

    private function invalidateGlobal(): void
    {
        try {
            $key = $this->globalVersionKey();
            Cache::put($key, (int) Cache::get($key, 1) + 1, now()->addDays(30));
        } catch (Throwable) {
            // Cache failure must not turn a successful business write into an error.
        }
    }

    private function invalidateSao(): void
    {
        try {
            $key = $this->saoVersionKey();
            Cache::put($key, (int) Cache::get($key, 1) + 1, now()->addDays(30));
        } catch (Throwable) {
            // Cache failure must not turn a successful business write into an error.
        }
    }

    private function versionKey(int|string $organizationId): string
    {
        return "api-response-version:organization:{$organizationId}";
    }

    private function globalVersionKey(): string
    {
        return 'api-response-version:global';
    }

    private function saoVersionKey(): string
    {
        return 'api-response-version:sao';
    }

    private function routeRoleAllows(Request $request): bool
    {
        $role = $request->user()->role;

        foreach ($request->route()?->gatherMiddleware() ?? [] as $middleware) {
            if (! str_starts_with($middleware, 'role:')) {
                continue;
            }

            $allowed = explode(',', substr($middleware, strlen('role:')));

            return in_array($role, $allowed, true);
        }

        return true;
    }

    private function sortRecursively(array &$values): void
    {
        ksort($values);

        foreach ($values as &$value) {
            if (is_array($value)) {
                $this->sortRecursively($value);
            }
        }
    }
}
