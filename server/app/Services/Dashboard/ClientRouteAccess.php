<?php

namespace App\Services\Dashboard;

/**
 * Gates every href the dashboard briefing hands back against
 * config/client_routes.php, so a role never receives a link to a client
 * route it is not allowed to open.
 */
class ClientRouteAccess
{
    public function hrefFor(string $role, ?string $path): ?string
    {
        if ($path === null) {
            return null;
        }

        $allowed = config("client_routes.{$role}", []);

        return in_array($path, $allowed, true) ? $path : null;
    }
}
