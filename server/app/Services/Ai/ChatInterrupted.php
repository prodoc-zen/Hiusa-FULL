<?php

namespace App\Services\Ai;

use RuntimeException;

/** Thrown inside a model stream callback to end the stream early: the client left or a line failed the guard. */
final class ChatInterrupted extends RuntimeException
{
    public function __construct(public readonly string $reason)
    {
        parent::__construct($reason);
    }
}
