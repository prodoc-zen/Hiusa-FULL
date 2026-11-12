<?php

namespace Tests\Feature;

use App\Models\Transaction;
use Tests\TestCase;

/** Ledger reads follow the active semester, so a factory row must land in the current one rather than at random over six months. */
class TransactionFactoryTest extends TestCase
{
    public function test_a_factory_transaction_is_dated_within_the_last_week(): void
    {
        foreach (range(1, 50) as $ignored) {
            $date = Transaction::factory()->make(['budget_id' => null, 'recorded_by' => null])->transaction_date;

            $this->assertGreaterThanOrEqual(now()->subWeek()->subMinute()->timestamp, $date->getTimestamp());
            $this->assertLessThanOrEqual(now()->addMinute()->timestamp, $date->getTimestamp());
        }
    }
}
