<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * The notice version lives in two hand-synced places: config/hiusa.php (what the middleware and the consent
 * controller compare against) and client/src/utils/privacyNotice.js (what the dialog compares the stored version to).
 * If one is bumped without the other, everyone signed in gets the dialog on every page load and agreeing records
 * nothing new, because the server already holds its own current version.
 */
class PrivacyNoticeVersionTest extends TestCase
{
    public function test_the_client_notice_version_matches_the_server_config(): void
    {
        $path = dirname(base_path()).'/client/src/utils/privacyNotice.js';
        $this->assertFileExists($path, 'client/src/utils/privacyNotice.js was not found relative to the server app - has the monorepo layout changed?');

        $this->assertSame(1, preg_match('/export const PRIVACY_NOTICE_VERSION\s*=\s*[\'"]([^\'"]{1,40})[\'"]/', (string) file_get_contents($path), $found), 'PRIVACY_NOTICE_VERSION was not found in privacyNotice.js');

        $this->assertSame(config('hiusa.privacy_notice_version'), $found[1]);
    }
}
