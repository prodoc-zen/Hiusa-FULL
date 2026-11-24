<?php

namespace App\Services;

use App\Models\AiMessageAttachment;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Http\UploadedFile;
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

    /** Keeps an uploaded official receipt in the organization's receipt folder, named from what the file is rather than what it was called. */
    public function storeUploaded(int $organizationId, UploadedFile $file): ?string
    {
        $extension = strtolower((string) $file->guessExtension());
        $extension = $extension === 'jpeg' ? 'jpg' : $extension;
        $path = self::ROOT.$organizationId.'/'.Str::uuid().($extension !== '' ? '.'.$extension : '');

        return Storage::disk(self::DISK)->put($path, (string) file_get_contents($file->getRealPath())) ? $path : null;
    }

    /** True when the path is a file this service kept for that organization and it is still on disk. */
    public function isKeptFor(?string $path, int $organizationId): bool
    {
        return $this->isOurs($path) && str_starts_with($path, self::ROOT.$organizationId.'/') && $this->exists($path);
    }

    /** Removes a kept file once nothing refers to it, archived entries included. */
    public function discardIfUnreferenced(?string $path, int $organizationId): void
    {
        if ($this->isKeptFor($path, $organizationId) && ! Transaction::withoutGlobalScope(Transaction::NOT_ARCHIVED)->where('receipt_file_url', $path)->exists()) {
            $this->discard($path);
        }
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
