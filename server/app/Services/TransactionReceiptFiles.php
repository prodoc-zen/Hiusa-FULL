<?php

namespace App\Services;

use App\Models\AiMessageAttachment;
use App\Models\User;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * A receipt file kept for a ledger transaction. It lives on the private local disk and the transaction's
 * receipt_file_url holds its path on that disk, never a public link; GET /transactions/{id}/receipt-file opens it.
 */
class TransactionReceiptFiles
{
    private const DISK = 'local';

    private const ROOT = 'finance-receipts/';

    /** Copies an Ask AI attachment into the organization's receipt folder, so the ledger keeps the file when the conversation is deleted. */
    public function copyFromAttachment(User $user, AiMessageAttachment $attachment): ?string
    {
        $disk = Storage::disk($attachment->disk);
        if ($user->organization_id === null || ! $disk->exists($attachment->path)) {
            return null;
        }

        $extension = pathinfo($attachment->path, PATHINFO_EXTENSION);
        $path = self::ROOT.$user->organization_id.'/'.Str::uuid().($extension !== '' ? '.'.$extension : '');

        return Storage::disk(self::DISK)->put($path, (string) $disk->get($attachment->path)) ? $path : null;
    }

    public function discard(string $path): void
    {
        if ($this->isOurs($path)) {
            Storage::disk(self::DISK)->delete($path);
        }
    }

    /** True for a path this service wrote; older ledger rows hold public links and are not opened here. */
    public function isOurs(?string $path): bool
    {
        return is_string($path) && str_starts_with($path, self::ROOT) && ! str_contains($path, '..') && ! str_contains($path, '\\');
    }

    public function exists(string $path): bool
    {
        return $this->isOurs($path) && Storage::disk(self::DISK)->exists($path);
    }

    public function absolutePath(string $path): string
    {
        return Storage::disk(self::DISK)->path($path);
    }
}
