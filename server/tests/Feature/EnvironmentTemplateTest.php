<?php

namespace Tests\Feature;

use Dotenv\Dotenv;
use Illuminate\Support\Env;
use Tests\TestCase;

class EnvironmentTemplateTest extends TestCase
{
    public function test_all_environment_examples_are_portable_consistent_and_parseable(): void
    {
        $serverContents = file_get_contents(base_path('.env.example'));
        $clientContents = file_get_contents(base_path('../client/.env.example'));
        $aiContents = file_get_contents(base_path('../ai-service/.env.example'));

        $server = Dotenv::parse($serverContents);
        $client = Dotenv::parse($clientContents);
        $ai = Dotenv::parse($aiContents);

        $this->assertSame('Asia/Manila', $server['APP_TIMEZONE']);
        $this->assertSame('https://api.groq.com/openai/v1/responses', $server['GROQ_API_URL']);
        $this->assertSame('openai/gpt-oss-20b', $server['GROQ_MODEL']);
        $this->assertSame('', $server['GROQ_API_KEY']);
        $this->assertSame('20', $server['ANNOUNCEMENT_AI_DAILY_LIMIT']);
        $this->assertSame($server['HIUSA_AI_SERVICE_KEY'], $ai['HIUSA_AI_SERVICE_KEY']);
        $this->assertSame('127.0.0.1', $ai['HIUSA_AI_HOST']);
        $this->assertSame('http://localhost:8000/api', $client['VITE_API_URL']);
        $this->assertSame('http://localhost:8001', $server['HIUSA_AI_SERVICE_URL']);
        $this->assertSame('http://localhost:5173', $server['FRONTEND_URL']);
        $this->assertSame('', $server['FRONTEND_URLS']);
        $this->assertSame('', $server['FRONTEND_ORIGIN_PATTERNS']);

        $environment = Env::getRepository();
        $originalFrontendUrl = $environment->get('FRONTEND_URL');
        $originalFrontendUrls = $environment->get('FRONTEND_URLS');
        $originalPatterns = $environment->get('FRONTEND_ORIGIN_PATTERNS');

        try {
            $environment->clear('FRONTEND_URL');
            $environment->clear('FRONTEND_URLS');
            $environment->clear('FRONTEND_ORIGIN_PATTERNS');
            $environment->set('FRONTEND_URL', $server['FRONTEND_URL']);
            $environment->set('FRONTEND_URLS', $server['FRONTEND_URLS']);
            $environment->set('FRONTEND_ORIGIN_PATTERNS', $server['FRONTEND_ORIGIN_PATTERNS']);

            $cors = require config_path('cors.php');

            $this->assertSame([$server['FRONTEND_URL']], $cors['allowed_origins']);
            $this->assertSame([], $cors['allowed_origins_patterns']);
        } finally {
            $environment->clear('FRONTEND_URL');
            $environment->clear('FRONTEND_URLS');
            $environment->clear('FRONTEND_ORIGIN_PATTERNS');

            if ($originalFrontendUrl !== null) {
                $environment->set('FRONTEND_URL', $originalFrontendUrl);
            }

            if ($originalFrontendUrls !== null) {
                $environment->set('FRONTEND_URLS', $originalFrontendUrls);
            }

            if ($originalPatterns !== null) {
                $environment->set('FRONTEND_ORIGIN_PATTERNS', $originalPatterns);
            }
        }

        foreach ([$serverContents, $clientContents, $aiContents] as $contents) {
            $this->assertStringNotContainsString('gsk_', $contents);
            $this->assertStringNotContainsString('John Carlo', $contents);
            $this->assertStringNotContainsString('192.168.1.19', $contents);
        }

        $this->assertFileExists(base_path('../scripts/setup-env.ps1'));
    }
}
