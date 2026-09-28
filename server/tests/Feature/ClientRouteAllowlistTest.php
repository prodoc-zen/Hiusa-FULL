<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * Guards config/client_routes.php against drift from client/src/App.jsx.
 * client_routes.php is DashboardInsightEngine/DashboardBriefingService's
 * single source of which dashboard paths each role may open, and it is
 * hand-maintained - it already drifted once (missing
 * super-admin/event-requirements, a dead super-admin/approvals entry left
 * over from before that route became a redirect, and DEPARTMENT_HEAD listed
 * against two finance pages App.jsx never actually grants it).
 *
 * This test parses the live route tree straight out of App.jsx (path plus
 * the ProtectedRoute allowedRoles guarding it, with nested child paths
 * resolved under their parent) and asserts config/client_routes.php matches
 * it exactly, per role, except for paths the config marks 'pending_client' -
 * decided but not yet wired into the client's route guards.
 */
class ClientRouteAllowlistTest extends TestCase
{
    private const ROLES = ['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'];

    public function test_config_matches_app_jsx_live_routes_per_role(): void
    {
        $liveByRole = $this->liveRoutesByRole();
        $config = config('client_routes');

        foreach (self::ROLES as $role) {
            $pending = $config['pending_client'][$role] ?? [];
            $configLive = array_values(array_diff($config[$role] ?? [], $pending));
            sort($configLive);

            $live = $liveByRole[$role] ?? [];

            $missing = array_values(array_diff($live, $configLive));
            $extra = array_values(array_diff($configLive, $live));

            $this->assertSame(
                $live,
                $configLive,
                "{$role}: config/client_routes.php has drifted from App.jsx.\n"
                .'Live in App.jsx but missing from config: '.json_encode($missing)."\n"
                .'In config but not reachable in App.jsx: '.json_encode($extra)
            );
        }
    }

    public function test_pending_client_entries_are_not_yet_live_in_app_jsx(): void
    {
        $liveByRole = $this->liveRoutesByRole();
        $config = config('client_routes');

        foreach ($config['pending_client'] ?? [] as $role => $pendingPaths) {
            foreach ($pendingPaths as $path) {
                $this->assertNotContains(
                    $path,
                    $liveByRole[$role] ?? [],
                    "{$role}: '{$path}' is marked pending_client but App.jsx already grants it - move it out of pending_client into {$role}'s live list."
                );
            }
        }
    }

    /**
     * Walks App.jsx line by line tracking a stack of enclosing <Route
     * path="..."> segments, so a child route's full path is its own path
     * attribute prefixed by every ancestor route's path attribute (e.g. a
     * "manage-announcements" child under the "announcements" parent, itself
     * under the "/dashboard" route, resolves to
     * /dashboard/announcements/manage-announcements).
     *
     * A line is only recorded as a destination when it carries both a
     * `path="..."` attribute and an inline `allowedRoles={[...]}` - index
     * routes, bare Navigate redirects, and routes with no ProtectedRoute at
     * all never match and are correctly excluded. A parent route whose
     * ProtectedRoute is itself self-closed (e.g. the "finance" wrapper) is a
     * pure pass-through gate, not a destination, so it is only pushed onto
     * the stack for its children; a parent whose ProtectedRoute wraps a real
     * page component (e.g. the "elections" hub) is recorded as a
     * destination in its own right as well as being pushed for its children.
     *
     * @return array<string, list<string>> role => sorted unique /dashboard/... paths it can reach per App.jsx
     */
    private function liveRoutesByRole(): array
    {
        $appJsxPath = dirname(base_path()).'/client/src/App.jsx';
        $this->assertFileExists($appJsxPath, 'client/src/App.jsx was not found relative to the server app - has the monorepo layout changed?');

        $lines = file($appJsxPath, FILE_IGNORE_NEW_LINES) ?: [];

        $stack = [];
        $destinations = [];

        foreach ($lines as $line) {
            $trimmed = trim($line);

            if ($trimmed === '</Route>') {
                array_pop($stack);
                continue;
            }

            if (! str_contains($trimmed, '<Route')) {
                continue;
            }

            $selfClosed = str_ends_with($trimmed, '/>');

            $pathAttr = null;
            if (preg_match('/\bpath="([^"]*)"/', $trimmed, $pathMatch) === 1) {
                $pathAttr = $pathMatch[1];
            }

            $roles = null;
            if (preg_match('/allowedRoles=\{\[([^\]]*)\]\}/', $trimmed, $rolesMatch) === 1) {
                preg_match_all('/"([A-Z_]+)"/', $rolesMatch[1], $roleNames);
                $roles = $roleNames[1];
            }

            if ($selfClosed) {
                // A leaf: it has no children, so it cannot open a nested <Route>.
                if ($pathAttr !== null && $roles !== null) {
                    $destinations[] = ['path' => $this->resolvePath($stack, $pathAttr), 'roles' => $roles];
                }

                continue;
            }

            // An opening tag with children below, closed later by its own </Route>.
            $protectedRouteIsGateOnly = (bool) preg_match('/<ProtectedRoute[^>]*\/>/', $trimmed);

            if ($pathAttr !== null && $roles !== null && ! $protectedRouteIsGateOnly) {
                $destinations[] = ['path' => $this->resolvePath($stack, $pathAttr), 'roles' => $roles];
            }

            $stack[] = $pathAttr;
        }

        $byRole = array_fill_keys(self::ROLES, []);

        foreach ($destinations as $destination) {
            if (! str_starts_with($destination['path'], '/dashboard')) {
                continue;
            }

            foreach ($destination['roles'] as $role) {
                if (array_key_exists($role, $byRole)) {
                    $byRole[$role][] = $destination['path'];
                }
            }
        }

        foreach ($byRole as $role => $paths) {
            $unique = array_values(array_unique($paths));
            sort($unique);
            $byRole[$role] = $unique;
        }

        return $byRole;
    }

    /**
     * @param  array<int, string|null>  $stack
     */
    private function resolvePath(array $stack, string $segment): string
    {
        $prefix = '';

        foreach ($stack as $frame) {
            if ($frame === null || $frame === '') {
                continue;
            }

            $prefix = str_starts_with($frame, '/') ? $frame : $prefix.'/'.$frame;
        }

        return str_starts_with($segment, '/') ? $segment : $prefix.'/'.$segment;
    }
}
