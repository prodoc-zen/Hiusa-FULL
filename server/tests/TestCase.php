<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;

abstract class TestCase extends BaseTestCase
{
    /**
     * Records a ledger entry the way the Finance page does: as a form, with the official receipt attached to an expense.
     * The file lands on the faked private disk, never the real one.
     */
    protected function postTransaction(array $body): TestResponse
    {
        if (! str_contains(str_replace('\\', '/', (string) config('filesystems.disks.local.root')), 'framework/testing')) {
            Storage::fake('local');
        }

        if (($body['type'] ?? null) === 'expense' && ! isset($body['receipt_file']) && ! isset($body['receipt_file_url'])) {
            $body['receipt_file'] = UploadedFile::fake()->create('receipt.pdf', 10, 'application/pdf');
        }

        return $this->post('/api/transactions', $body, ['Accept' => 'application/json']);
    }
}
