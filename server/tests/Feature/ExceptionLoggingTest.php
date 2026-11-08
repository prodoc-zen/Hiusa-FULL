<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;
use RuntimeException;
use Tests\TestCase;

class ExceptionLoggingTest extends TestCase
{
    private string $logDirectory;

    protected function setUp(): void
    {
        parent::setUp();

        $this->logDirectory = sys_get_temp_dir().'/hiusa-exception-log-'.uniqid();
        File::ensureDirectoryExists($this->logDirectory);
        config([
            'logging.default' => 'null',
            'logging.channels.exceptions.path' => $this->logDirectory.'/exceptions.log',
        ]);
        Log::forgetChannel('exceptions');
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->logDirectory);

        parent::tearDown();
    }

    private function loggedText(): string
    {
        return collect(File::files($this->logDirectory))->map(fn ($file) => File::get($file->getPathname()))->implode("\n");
    }

    public function test_a_500_is_written_to_the_exceptions_log_even_when_the_default_channel_discards_it(): void
    {
        Route::middleware('api')->get('/api/__boom', fn () => throw new RuntimeException('database exploded'));

        $this->getJson('/api/__boom')->assertStatus(500);

        $text = $this->loggedText();
        $this->assertStringContainsString('GET /api/__boom', $text);
        $this->assertStringContainsString('RuntimeException: database exploded', $text);
    }

    public function test_expected_client_errors_are_not_written_to_the_exceptions_log(): void
    {
        $this->getJson('/api/events')->assertUnauthorized();
        $this->getJson('/api/does-not-exist')->assertNotFound();

        $this->assertSame('', $this->loggedText());
    }

    public function test_an_unwritable_exceptions_log_does_not_change_the_response(): void
    {
        config(['logging.channels.exceptions.path' => $this->logDirectory.'/missing/deeper/exceptions.log']);
        File::put($this->logDirectory.'/missing', 'a file where the folder should be');
        Log::forgetChannel('exceptions');
        Route::middleware('api')->get('/api/__boom', fn () => throw new RuntimeException('still a plain 500'));

        $this->getJson('/api/__boom')->assertStatus(500);
    }
}
