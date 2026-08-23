<?php

namespace Tests\Feature;

use Dotenv\Dotenv;
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
        $this->assertSame($server['HIUSA_AI_SERVICE_KEY'], $ai['HIUSA_AI_SERVICE_KEY']);
        $this->assertSame('0.0.0.0', $ai['HIUSA_AI_HOST']);
        $this->assertSame('http://localhost:8000/api', $client['VITE_API_URL']);

        $this->assertSame(1, preg_match($server['FRONTEND_ORIGIN_PATTERNS'], 'http://192.168.50.25:5173'));
        $this->assertSame(1, preg_match($server['FRONTEND_ORIGIN_PATTERNS'], 'http://10.0.0.20:5174'));
        $this->assertSame(0, preg_match($server['FRONTEND_ORIGIN_PATTERNS'], 'https://public.example.com'));

        foreach ([$serverContents, $clientContents, $aiContents] as $contents) {
            $this->assertStringNotContainsString('gsk_', $contents);
            $this->assertStringNotContainsString('John Carlo', $contents);
            $this->assertStringNotContainsString('192.168.1.19', $contents);
        }

        $this->assertFileExists(base_path('../scripts/setup-env.ps1'));
    }
}
