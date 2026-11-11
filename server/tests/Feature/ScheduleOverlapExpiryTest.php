<?php

namespace Tests\Feature;

use Illuminate\Console\Scheduling\Schedule;
use Tests\TestCase;

class ScheduleOverlapExpiryTest extends TestCase
{
    public function test_every_task_that_cannot_overlap_has_a_short_lock_so_a_reboot_cannot_leave_one_for_a_day(): void
    {
        $locked = collect(app(Schedule::class)->events())->filter(fn ($event) => $event->withoutOverlapping);

        $this->assertNotEmpty($locked);

        foreach ($locked as $event) {
            $expected = match ($event->expression) {
                '* * * * *' => 5,
                '0 * * * *' => 70,
                default => 120,
            };

            $this->assertSame($expected, $event->expiresAt, "{$event->expression} {$event->description} {$event->command}");
        }
    }

    public function test_the_scheduler_heartbeat_is_still_scheduled_every_minute(): void
    {
        $heartbeat = collect(app(Schedule::class)->events())->first(fn ($event) => $event->description === 'scheduler-heartbeat');

        $this->assertNotNull($heartbeat);
        $this->assertSame('* * * * *', $heartbeat->expression);
    }
}
