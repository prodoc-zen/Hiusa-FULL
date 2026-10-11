<?php

// One side of an interleaving, started by interleave.php: either a real HTTP request through the Laravel
// kernel (optionally pausing inside its transaction right after a query that matches), or raw SQL held in
// an open transaction.
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

$root = dirname(__DIR__, 2).'/server';
require $root.'/vendor/autoload.php';
$app = require $root.'/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$kernel->bootstrap();

$config = config('database.connections.'.config('database.default'));
if ($config['host'] !== '127.0.0.1' || getenv('LOCK_INTERLEAVE_DATABASE') !== $config['database'] || in_array((int) $config['port'], [3306, 3307], true)) {
    fwrite(STDERR, "refusing: LOCK_INTERLEAVE_DATABASE must name the throwaway database on 127.0.0.1, and never port 3306 or 3307\n");
    exit(1);
}

$spec = json_decode(base64_decode($argv[1]), true);
$epoch = (float) $argv[2];
$result = ['label' => $spec['label'], 'started' => round(microtime(true) - $epoch, 2)];

try {
    if (($spec['kind'] ?? 'http') === 'http') {
        $pause = $spec['pause'] ?? null;
        if ($pause) {
            DB::listen(function ($query) use ($pause, &$result, $epoch) {
                if (preg_match($pause['regex'], $query->sql) && ! isset($result['paused_at'])) {
                    $result['paused_at'] = round(microtime(true) - $epoch, 2);
                    usleep((int) ($pause['sec'] * 1e6));
                }
            });
        }
        $http = Request::create($spec['uri'], $spec['method'], [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'], isset($spec['body']) ? json_encode($spec['body']) : null);
        $app->instance('request', $http);
        Sanctum::actingAs(User::where('school_id', $spec['user'])->firstOrFail());
        $response = $kernel->handle($http);
        $result['status'] = $response->getStatusCode();
        $result['body'] = substr((string) $response->getContent(), 0, 140);
    } else {
        $pdo = DB::connection()->getPdo();
        $pdo->exec('set innodb_lock_wait_timeout = 30');
        $pdo->beginTransaction();
        try {
            $result['rows'] = $pdo->exec($spec['sql']);
            $result['ran_at'] = round(microtime(true) - $epoch, 2);
            usleep((int) (($spec['hold'] ?? 0) * 1e6));
            $pdo->commit();
            $result['status'] = 'committed';
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }
} catch (Throwable $e) {
    $result['status'] ??= 'error';
    $result['error'] = substr(get_class($e).': '.$e->getMessage(), 0, 160);
}

$result['ended'] = round(microtime(true) - $epoch, 2);
echo json_encode($result)."\n";
