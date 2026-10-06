#!/usr/bin/env bash

set -Eeuo pipefail

site_address="${1:?Usage: bash scripts/check-membership-routes.sh https://your-site}"
site_address="${site_address%/}"

for endpoint in organizations candidates; do
    url="$site_address/api/account-profiles/$endpoint"
    if ! status="$(curl --silent --show-error --max-time 15 --output /dev/null \
        --write-out '%{http_code}' --header 'Accept: application/json' "$url")"; then
        echo "Membership API check could not reach $url." >&2
        exit 1
    fi

    # With no token, a registered protected route must return 401, not 404 or HTML.
    if [[ "$status" != 401 ]]; then
        echo "Membership API check failed: $url returned HTTP $status; expected 401." >&2
        echo "Deploy the latest Laravel image, refresh its route cache, and restart Laravel before using Admin or SAO membership actions." >&2
        exit 1
    fi
done

echo "Admin and SAO membership API routes are available and require authentication."
