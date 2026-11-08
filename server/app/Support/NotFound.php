<?php

namespace App\Support;

use Illuminate\Database\Eloquent\ModelNotFoundException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/** A record the caller may not see answers exactly like one that does not exist (see bootstrap/app.php). */
class NotFound
{
    public static function unless(bool $condition): void
    {
        if (! $condition) {
            throw new NotFoundHttpException('Not found.', new ModelNotFoundException);
        }
    }
}
