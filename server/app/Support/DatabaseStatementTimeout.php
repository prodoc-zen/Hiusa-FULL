<?php

namespace App\Support;

use Illuminate\Database\Connection;
use PDO;
use PDOException;
use WeakMap;

/**
 * Caps how long one statement may run, so a plan that goes wrong on production statistics fails in seconds instead of
 * holding a connection for minutes. MariaDB enforces max_statement_time on every statement; MySQL's
 * max_execution_time covers read-only SELECT statements only.
 */
class DatabaseStatementTimeout
{
    public static function sqlFor(string $serverVersion, int $seconds): string
    {
        return stripos($serverVersion, 'MariaDB') !== false
            ? 'SET SESSION max_statement_time = '.$seconds
            : 'SET SESSION max_execution_time = '.($seconds * 1000);
    }

    /** A session setting is lost with the server connection, so it is applied once to every PDO the connection holds. */
    public static function register(Connection $connection, int $seconds): void
    {
        $applied = new WeakMap;
        $connection->beforeExecuting(function () use ($connection, $seconds, $applied) {
            $pdo = $connection->getPdo();
            if (isset($applied[$pdo])) {
                return;
            }
            $applied[$pdo] = true;

            try {
                $pdo->exec(self::sqlFor((string) $pdo->getAttribute(PDO::ATTR_SERVER_VERSION), $seconds));
            } catch (PDOException $exception) {
                report($exception);
            }
        });
    }
}
