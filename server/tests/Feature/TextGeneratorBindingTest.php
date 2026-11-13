<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Services\Ai\FallbackTextGenerator;
use App\Services\GroqResponsesService;
use Tests\TestCase;

class TextGeneratorBindingTest extends TestCase
{
    public function test_without_an_anthropic_key_the_generator_is_groq_alone(): void
    {
        config()->set('services.anthropic.key', '');
        config()->set('services.ai.provider', null);

        $this->assertInstanceOf(GroqResponsesService::class, app(TextGenerator::class));
    }

    public function test_an_explicit_anthropic_choice_still_uses_groq_while_the_key_is_empty(): void
    {
        config()->set('services.anthropic.key', '  ');
        config()->set('services.ai.provider', 'anthropic');

        $this->assertInstanceOf(GroqResponsesService::class, app(TextGenerator::class));
    }

    public function test_a_key_turns_claude_on_with_groq_as_the_fallback(): void
    {
        config()->set('services.anthropic.key', 'test-key');
        config()->set('services.ai.provider', null);

        $this->assertInstanceOf(FallbackTextGenerator::class, app(TextGenerator::class));
    }

    public function test_groq_can_be_forced_even_with_a_key(): void
    {
        config()->set('services.anthropic.key', 'test-key');
        config()->set('services.ai.provider', 'groq');

        $this->assertInstanceOf(GroqResponsesService::class, app(TextGenerator::class));
    }

    public function test_the_choice_follows_config_changed_after_the_first_resolution(): void
    {
        config()->set('services.anthropic.key', '');
        $this->assertInstanceOf(GroqResponsesService::class, app(TextGenerator::class));

        config()->set('services.anthropic.key', 'test-key');
        $this->assertInstanceOf(FallbackTextGenerator::class, app(TextGenerator::class));
    }

    public function test_production_defaults_ship_with_claude_off(): void
    {
        $this->assertSame('', trim((string) config('services.anthropic.key')));
        $this->assertSame('claude-sonnet-5-5', config('services.anthropic.model'));
        $this->assertSame('low', config('services.anthropic.effort'));
        $this->assertInstanceOf(GroqResponsesService::class, app(TextGenerator::class));
    }
}
