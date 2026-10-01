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

    /**
     * config[$role] is compared to App.jsx's live routes directly, with
     * nothing subtracted out first - a role's own array in
     * config/client_routes.php must be exactly what App.jsx grants it today,
     * never that plus anything else. Pending paths belong solely under the
     * separate 'pending_client' key (see
     * test_pending_client_paths_never_leak_into_a_roles_live_config_list);
     * merging them into a role's own list here - the actual bug this test
     * once missed - would make this assertion fail directly instead of
     * silently passing because the pending paths got diffed back out first.
     */
    public function test_config_matches_app_jsx_live_routes_per_role(): void
    {
        $liveByRole = $this->liveRoutesByRole();
        $config = config('client_routes');

        foreach (self::ROLES as $role) {
            $configLive = $config[$role] ?? [];
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

    /**
     * The regression this whole file is named after: config/client_routes.php
     * once array_merge'd pending_client's finance paths straight into
     * SBO_OFFICER and DEPARTMENT_HEAD's live arrays "so the briefing could
     * already link to them", which handed SBO_OFFICER a working href to
     * /dashboard/finance/budget-allocation - an ADMIN-only page in App.jsx.
     * ClientRouteAccess::hrefFor trusts config[$role] completely, so nothing
     * short of the live array itself being clean catches this.
     */
    public function test_pending_client_paths_never_leak_into_a_roles_live_config_list(): void
    {
        $config = config('client_routes');
        $this->assertIsArray($config['pending_client'], 'client_routes must keep a pending_client list, even when it is empty.');

        foreach ($config['pending_client'] as $role => $pendingPaths) {
            foreach ($pendingPaths as $path) {
                $this->assertNotContains(
                    $path,
                    $config[$role] ?? [],
                    "{$role}: pending_client path '{$path}' is also present in {$role}'s own live list - pending paths must live only under pending_client until App.jsx grants them."
                );
            }
        }
    }

    public function test_pending_client_entries_are_not_yet_live_in_app_jsx(): void
    {
        $liveByRole = $this->liveRoutesByRole();
        $config = config('client_routes');
        $this->assertIsArray($config['pending_client'], 'client_routes must keep a pending_client list, even when it is empty.');

        foreach ($config['pending_client'] as $role => $pendingPaths) {
            foreach ($pendingPaths as $path) {
                $this->assertNotContains(
                    $path,
                    $liveByRole[$role] ?? [],
                    "{$role}: '{$path}' is marked pending_client but App.jsx already grants it - move it out of pending_client into {$role}'s live list."
                );
            }
        }
    }

    public function test_parser_treats_a_conditional_one_line_route_as_self_closing(): void
    {
        $lines = [
            '<Route element={<ProtectedRoute />}>',
            '  <Route path="/dashboard" element={<DashboardLayout />}>',
            '    {ShowDevTool && <Route path="dev-tool" element={<DevToolPage />} />}',
            '    <Route path="reachable" element={<ProtectedRoute allowedRoles={["ADMIN"]}><ReachablePage /></ProtectedRoute>} />',
            '  </Route>',
            '</Route>',
        ];

        $byRole = $this->rolesByRouteFromLines($lines);

        // If the conditional line were mistaken for an unclosed opening tag,
        // its "dev-tool" frame would never be popped and "reachable" would
        // resolve to /dashboard/dev-tool/reachable instead.
        $this->assertSame(['/dashboard/reachable'], $byRole['ADMIN']);
    }

    public function test_parser_intersects_child_roles_with_an_ancestor_gate(): void
    {
        $lines = [
            '<Route element={<ProtectedRoute />}>',
            '  <Route path="/dashboard" element={<DashboardLayout />}>',
            '    <Route path="finance" element={<ProtectedRoute allowedRoles={["ADMIN", "SBO_OFFICER", "STUDENT"]} />}>',
            '      <Route path="budget" element={<ProtectedRoute allowedRoles={["ADMIN", "DEPARTMENT_HEAD"]}><BudgetPage /></ProtectedRoute>} />',
            '    </Route>',
            '  </Route>',
            '</Route>',
        ];

        $byRole = $this->rolesByRouteFromLines($lines);

        // "budget" lists DEPARTMENT_HEAD, but the "finance" wrapper gates its
        // children to ADMIN/SBO_OFFICER/STUDENT only - DEPARTMENT_HEAD must
        // not be treated as reachable just because a child route named it.
        $this->assertSame(['/dashboard/finance/budget'], $byRole['ADMIN']);
        $this->assertSame([], $byRole['DEPARTMENT_HEAD']);
    }

    /**
     * @return array<string, list<string>> role => sorted unique /dashboard/... paths it can reach per App.jsx
     */
    private function liveRoutesByRole(): array
    {
        $appJsxPath = dirname(base_path()).'/client/src/App.jsx';
        $this->assertFileExists($appJsxPath, 'client/src/App.jsx was not found relative to the server app - has the monorepo layout changed?');

        $lines = file($appJsxPath, FILE_IGNORE_NEW_LINES) ?: [];

        return $this->rolesByRouteFromLines($lines);
    }

    /**
     * Walks a list of JSX lines tracking a stack of enclosing <Route
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
     * A second, parallel stack carries each ancestor gate's cumulative
     * allowed roles. A child's own `allowedRoles` is intersected with that
     * cumulative set before being recorded, so a child that (incorrectly)
     * lists a role its parent gate never granted - e.g. DEPARTMENT_HEAD
     * under a "finance" wrapper gated to
     * ADMIN/SBO_OFFICER/STUDENT - is never counted as reachable by that role.
     * A route with no `allowedRoles` of its own (a plain path segment, or a
     * gate-only `<ProtectedRoute />` with no role restriction) simply passes
     * its parent's cumulative set down unchanged.
     *
     * A one-line conditional route such as `{Flag && <Route path="x" ... />}`
     * is a single self-closing `<Route>` wrapped in a JS expression: it must
     * be treated as self-closed even though the line's last two characters
     * are `/>}` rather than `/>`, or it is mistaken for an opening tag that
     * pushes a stack frame with no matching `</Route>` to pop it back off.
     *
     * @param  list<string>  $lines
     * @return array<string, list<string>> role => sorted unique /dashboard/... paths it can reach
     */
    private function rolesByRouteFromLines(array $lines): array
    {
        $stack = [];
        $roleStack = [];
        $destinations = [];

        foreach ($lines as $line) {
            $trimmed = trim($line);

            if ($trimmed === '</Route>') {
                array_pop($stack);
                array_pop($roleStack);
                continue;
            }

            if (! str_contains($trimmed, '<Route')) {
                continue;
            }

            // Self-closed even when the whole <Route .../> is wrapped in a
            // JS expression, e.g. `{Flag && <Route ... />}` - the trailing
            // `}` (and any whitespace around it) does not change that this
            // is one complete, childless <Route> tag.
            $selfClosed = (bool) preg_match('/\/>\s*\}?\s*$/', $trimmed);

            $pathAttr = null;
            if (preg_match('/\bpath="([^"]*)"/', $trimmed, $pathMatch) === 1) {
                $pathAttr = $pathMatch[1];
            }

            $roles = null;
            if (preg_match('/allowedRoles=\{\[([^\]]*)\]\}/', $trimmed, $rolesMatch) === 1) {
                preg_match_all('/"([A-Z_]+)"/', $rolesMatch[1], $roleNames);
                $roles = $roleNames[1];
            }

            $parentRoles = count($roleStack) > 0 ? $roleStack[count($roleStack) - 1] : null;
            $effectiveRoles = $this->intersectRoles($parentRoles, $roles);

            if ($selfClosed) {
                // A leaf: it has no children, so it cannot open a nested <Route>.
                if ($pathAttr !== null && $roles !== null) {
                    $destinations[] = ['path' => $this->resolvePath($stack, $pathAttr), 'roles' => $effectiveRoles];
                }

                continue;
            }

            // An opening tag with children below, closed later by its own </Route>.
            $protectedRouteIsGateOnly = (bool) preg_match('/<ProtectedRoute[^>]*\/>/', $trimmed);

            if ($pathAttr !== null && $roles !== null && ! $protectedRouteIsGateOnly) {
                $destinations[] = ['path' => $this->resolvePath($stack, $pathAttr), 'roles' => $effectiveRoles];
            }

            $stack[] = $pathAttr;
            $roleStack[] = $roles !== null ? $effectiveRoles : $parentRoles;
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
     * @param  list<string>|null  $parent  Cumulative roles inherited from every ancestor gate, or null if no ancestor gate has restricted roles yet.
     * @param  list<string>|null  $own  Roles this line's own allowedRoles attribute lists, or null if it has none.
     * @return list<string>|null
     */
    private function intersectRoles(?array $parent, ?array $own): ?array
    {
        if ($own === null) {
            return $parent;
        }

        if ($parent === null) {
            return array_values($own);
        }

        return array_values(array_intersect($parent, $own));
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
