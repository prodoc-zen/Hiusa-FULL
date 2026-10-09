<?php

namespace App\Services\Dashboard;

/**
 * Gates every href the dashboard briefing hands back against
 * config/client_routes.php, so a role never receives a link to a client
 * route it is not allowed to open.
 *
 * A link may carry a query so it can land on a tab or a record. The path
 * before the first "?" is what the role's allowlist is checked against; the
 * query is only kept when every parameter is one the client pages read and
 * every value is a short slug or id, so a link can never smuggle in an
 * arbitrary parameter or a URL.
 */
class ClientRouteAccess
{
    private const QUERY_PARAMETERS = ['tab', 'status', 'view', 'record', 'review', 'event', 'organization', 'create', 'new'];

    public function hrefFor(string $role, ?string $path): ?string
    {
        if ($path === null) {
            return null;
        }

        $query = null;
        $separator = strpos($path, '?');
        if ($separator !== false) {
            $query = substr($path, $separator + 1);
            $path = substr($path, 0, $separator);
        }

        $allowed = config("client_routes.{$role}", []);
        if (! in_array($path, $allowed, true)) {
            return null;
        }

        if ($query === null) {
            return $path;
        }

        return $this->validQuery($query) ? $path.'?'.$query : null;
    }

    private function validQuery(string $query): bool
    {
        foreach (explode('&', $query) as $pair) {
            $parts = explode('=', $pair, 2);

            if (! in_array($parts[0], self::QUERY_PARAMETERS, true)
                || ! isset($parts[1])
                || preg_match('/^[A-Za-z0-9_-]{1,64}$/D', $parts[1]) !== 1) {
                return false;
            }
        }

        return true;
    }
}
