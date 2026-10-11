<?php

namespace Tests\Unit;

use App\Support\DatabaseStatementTimeout;
use Illuminate\Database\Connection;
use PDO;
use Tests\TestCase;

class DatabaseStatementTimeoutTest extends TestCase
{
    public function test_mariadb_gets_max_statement_time_in_seconds(): void
    {
        $this->assertSame('SET SESSION max_statement_time = 30', DatabaseStatementTimeout::sqlFor('10.4.32-MariaDB', 30));
        $this->assertSame('SET SESSION max_statement_time = 30', DatabaseStatementTimeout::sqlFor('5.5.5-10.4.32-MariaDB', 30));
    }

    public function test_mysql_gets_max_execution_time_in_milliseconds(): void
    {
        $this->assertSame('SET SESSION max_execution_time = 30000', DatabaseStatementTimeout::sqlFor('8.4.0', 30));
    }

    public function test_the_timeout_is_set_once_per_server_connection_and_again_after_a_reconnect(): void
    {
        $first = new RecordingPdo('10.4.32-MariaDB');
        $second = new RecordingPdo('10.4.32-MariaDB');
        $connection = new Connection($first);
        DatabaseStatementTimeout::register($connection, 30);

        $connection->statement('select 1');
        $connection->statement('select 2');
        $this->assertSame(['SET SESSION max_statement_time = 30'], $first->executed);

        $connection->setPdo($second);
        $connection->statement('select 3');
        $this->assertSame(['SET SESSION max_statement_time = 30'], $second->executed);
    }

    public function test_a_server_that_refuses_the_setting_does_not_break_the_query(): void
    {
        $pdo = new RecordingPdo('8.4.0', refuses: true);
        $connection = new Connection($pdo);
        DatabaseStatementTimeout::register($connection, 30);

        $connection->statement('select 1');

        $this->assertSame(['select 1'], $pdo->statements);
    }
}

class RecordingPdo extends PDO
{
    /** @var string[] */
    public array $executed = [];

    /** @var string[] */
    public array $statements = [];

    public function __construct(private string $version, private bool $refuses = false)
    {
        parent::__construct('sqlite::memory:');
    }

    public function getAttribute(int $attribute): mixed
    {
        return $attribute === PDO::ATTR_SERVER_VERSION ? $this->version : parent::getAttribute($attribute);
    }

    public function exec(string $statement): int|false
    {
        if ($this->refuses) {
            throw new \PDOException('Unknown system variable');
        }
        $this->executed[] = $statement;

        return 0;
    }

    public function prepare(string $query, array $options = []): \PDOStatement|false
    {
        $this->statements[] = $query;

        return parent::prepare($query, $options);
    }
}
