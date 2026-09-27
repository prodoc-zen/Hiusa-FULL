<?php

namespace Tests\Feature;

use App\Models\EvaluationResponse;
use App\Models\EvaluationWindow;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\EvaluationDemoSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class EvaluationDemoSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_seeder_creates_clearly_labeled_demo_data_and_is_rerunnable(): void
    {
        $this->seed(EvaluationDemoSeeder::class);

        $window = EvaluationWindow::first();
        $this->assertNotNull($window);
        $this->assertStringContainsString('DEMO', $window->title);
        $this->assertSame('closed', $window->status);

        $responses = EvaluationResponse::all();
        $this->assertCount(10, $responses);
        foreach ($responses as $response) {
            $this->assertStringContainsString('DEMO', $response->feedback);
        }

        // Rerunning must not throw (unique window/user constraint, duplicate org, etc.)
        // and must not pile up duplicate demo windows.
        $this->seed(EvaluationDemoSeeder::class);
        $this->assertSame(1, EvaluationWindow::where('title', 'like', 'DEMO -%')->count());
        $this->assertCount(10, EvaluationResponse::all());
    }

    public function test_default_database_seeder_never_creates_demo_evaluation_data(): void
    {
        $reflection = new \ReflectionClass(DatabaseSeeder::class);
        $source = file_get_contents($reflection->getFileName());

        $this->assertStringNotContainsString('EvaluationDemoSeeder', $source);
    }
}
