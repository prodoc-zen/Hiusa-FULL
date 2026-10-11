<?php

// Proves the delete guards against a real MariaDB or MySQL with two connections: one side holds a lock for
// four seconds, the other arrives meanwhile, and each pair is run in both orders. SQLite has no row locks and
// cannot show any of this.
//
//   LOCK_INTERLEAVE_DATABASE=<throwaway database> DB_CONNECTION=mysql DB_HOST=127.0.0.1 DB_PORT=<free port> \
//   DB_DATABASE=<throwaway database> DB_USERNAME=... DB_PASSWORD=... php scripts/lock-interleave/interleave.php
//
// The database must be migrated and throwaway: the run seeds rows and does not clean them up. ONLY=<part of a
// scenario name> runs a subset. The exit code is 1 when any check fails.
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Election;
use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use App\Models\Venue;
use Illuminate\Support\Facades\DB;

$root = dirname(__DIR__, 2).'/server';
require $root.'/vendor/autoload.php';
$app = require $root.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$config = config('database.connections.'.config('database.default'));
if ($config['host'] !== '127.0.0.1' || getenv('LOCK_INTERLEAVE_DATABASE') !== $config['database'] || in_array((int) $config['port'], [3306, 3307], true)) {
    fwrite(STDERR, "refusing: LOCK_INTERLEAVE_DATABASE must name the throwaway database on 127.0.0.1, and never port 3306 or 3307\n");
    exit(1);
}

$hold = 4.0;
$failed = false;
$only = getenv('ONLY') ?: null;
$sao = Organization::where('slug', 'student-affairs-office')->value('id') ?? Organization::factory()->create(['slug' => 'student-affairs-office', 'name' => 'Student Affairs Office'])->id;

function seed(int $sao): array
{
    $org = Organization::factory()->create();
    $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
    $director = User::factory()->superAdmin()->create(['organization_id' => $sao]);
    $venue = Venue::create(['name' => 'Gym '.uniqid(), 'location' => 'Main', 'capacity' => 10]);
    $event = Event::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->school_id, 'status' => 'planning']);
    $budget = Budget::create(['organization_id' => $org->id, 'title' => 'B', 'allocated_amount' => '5000.00', 'remaining_amount' => '5000.00', 'warning_threshold' => '500.00', 'submission_status' => 'pending_department_head']);
    $election = Election::factory()->create(['organization_id' => $org->id, 'status' => 'upcoming', 'approved_at' => now(), 'finalized_at' => now()]);

    return compact('org', 'admin', 'director', 'venue', 'event', 'budget', 'election');
}

/** A seed with a pending Admin approval request for the budget and for the election, as a review finds them. */
function seedWithApprovals(int $sao): array
{
    $s = seed($sao);
    $officer = User::factory()->officer()->create(['organization_id' => $s['org']->id]);
    foreach (['budget' => $s['budget'], 'election' => $s['election']] as $type => $record) {
        $s[$type.'Approval'] = ApprovalRequest::create([
            'organization_id' => $s['org']->id, 'entity_type' => $type, 'entity_id' => $record->id, 'required_role' => 'ADMIN',
            'requested_by' => $officer->school_id, 'status' => 'pending', 'requested_at' => now(),
        ]);
    }

    return $s;
}

/** Starts $a, then $b after $delay seconds, and returns both workers' reports. */
function run(array $a, array $b, float $delay): array
{
    $epoch = microtime(true);
    $spawn = function (array $spec) use ($epoch) {
        $command = [PHP_BINARY, __DIR__.'/worker.php', base64_encode(json_encode($spec)), (string) $epoch];

        return [proc_open($command, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes), $pipes];
    };
    $first = $spawn($a);
    usleep((int) ($delay * 1e6));
    $second = $spawn($b);
    $reports = [];
    foreach ([$first, $second] as [$process, $pipes]) {
        $text = stream_get_contents($pipes[1]).stream_get_contents($pipes[2]);
        proc_close($process);
        preg_match_all('/^\{"label".*$/m', $text, $found);
        $reports[] = json_decode(end($found[0]) ?: '', true) ?? ['label' => 'unparsed', 'started' => 0, 'ended' => 0, 'raw' => substr($text, 0, 700)];
    }

    return $reports;
}

function show(string $title, array $reports, array $checks): void
{
    global $failed;
    echo "\n== {$title}\n";
    foreach ($reports as $report) {
        echo '   '.json_encode($report)."\n";
    }
    foreach ($checks as $name => $ok) {
        $failed = $failed || ! $ok;
        echo '   '.($ok ? 'PASS' : 'FAIL').'  '.$name."\n";
    }
}

$bookingBody = fn (array $s) => ['venue_id' => $s['venue']->id, 'event_id' => $s['event']->id, 'start_time' => '2030-03-12T09:00:00+08:00', 'end_time' => '2030-03-12T11:00:00+08:00'];
$blocked = fn (array $r) => ($r['ended'] - $r['started']) >= $hold - 1.5;
$ledgerEntry = fn (array $s) => "insert into transactions (organization_id, recorded_by, budget_id, type, amount, category, description, transaction_date, created_at, updated_at) values ({$s['org']->id}, {$s['admin']->school_id}, {$s['budget']->id}, 'expense', 100, 'Supplies', 'Supplies', '2026-10-05', now(), now())";

$scenarios = [
    'event_delete_then_booking' => function () use ($sao, $hold, $bookingBody, $blocked) {
        $s = seed($sao);
        [$a, $b] = run(
            ['label' => 'A delete event (pauses after taking the event lock)', 'user' => $s['admin']->school_id, 'method' => 'DELETE', 'uri' => "/api/events/{$s['event']->id}", 'pause' => ['regex' => '/from `events`.*for update/', 'sec' => $hold]],
            ['label' => 'B book the event', 'user' => $s['admin']->school_id, 'method' => 'POST', 'uri' => '/api/venue-bookings', 'body' => $bookingBody($s)],
            1.2,
        );
        show('event delete holds the lock, a booking for that event arrives', [$a, $b], [
            'A answered 200' => ($a['status'] ?? null) === 200,
            'B was held until A committed' => $blocked($b),
            'B answered 422, not a server error' => ($b['status'] ?? null) === 422,
            'no booking row, event gone' => DB::table('venue_bookings')->where('event_id', $s['event']->id)->count() === 0 && ! DB::table('events')->where('id', $s['event']->id)->exists(),
        ]);
    },
    'booking_then_event_delete' => function () use ($sao, $hold, $bookingBody, $blocked) {
        $s = seed($sao);
        [$a, $b] = run(
            ['label' => 'A book the event (pauses after the insert, before commit)', 'user' => $s['admin']->school_id, 'method' => 'POST', 'uri' => '/api/venue-bookings', 'body' => $bookingBody($s), 'pause' => ['regex' => '/^insert into `venue_bookings`/', 'sec' => $hold]],
            ['label' => 'B delete the event', 'user' => $s['admin']->school_id, 'method' => 'DELETE', 'uri' => "/api/events/{$s['event']->id}"],
            1.2,
        );
        show('a booking is inserted, then the event delete arrives', [$a, $b], [
            'A answered 201' => ($a['status'] ?? null) === 201,
            'B was held until A committed' => $blocked($b),
            'B answered 409' => ($b['status'] ?? null) === 409,
            'booking and event both still exist' => DB::table('venue_bookings')->where('event_id', $s['event']->id)->count() === 1 && DB::table('events')->where('id', $s['event']->id)->exists(),
        ]);
    },
    'venue_delete_then_booking' => function () use ($sao, $hold, $bookingBody, $blocked) {
        $s = seed($sao);
        [$a, $b] = run(
            ['label' => 'A delete venue (pauses after taking the venue lock)', 'user' => $s['director']->school_id, 'method' => 'DELETE', 'uri' => "/api/venues/{$s['venue']->id}", 'pause' => ['regex' => '/from `venues`.*for update/', 'sec' => $hold]],
            ['label' => 'B book the venue', 'user' => $s['admin']->school_id, 'method' => 'POST', 'uri' => '/api/venue-bookings', 'body' => $bookingBody($s)],
            1.2,
        );
        show('venue delete holds the lock, a booking for that venue arrives', [$a, $b], [
            'A answered 200' => ($a['status'] ?? null) === 200,
            'B was held until A committed' => $blocked($b),
            'B answered 422, not a server error' => ($b['status'] ?? null) === 422,
            'no booking row for the venue' => DB::table('venue_bookings')->where('venue_id', $s['venue']->id)->count() === 0,
        ]);
    },
    'booking_then_venue_delete' => function () use ($sao, $hold, $bookingBody, $blocked) {
        $s = seed($sao);
        [$a, $b] = run(
            ['label' => 'A book the venue (pauses after the insert, before commit)', 'user' => $s['admin']->school_id, 'method' => 'POST', 'uri' => '/api/venue-bookings', 'body' => $bookingBody($s), 'pause' => ['regex' => '/^insert into `venue_bookings`/', 'sec' => $hold]],
            ['label' => 'B delete the venue', 'user' => $s['director']->school_id, 'method' => 'DELETE', 'uri' => "/api/venues/{$s['venue']->id}"],
            1.2,
        );
        show('a booking is inserted, then the venue delete arrives', [$a, $b], [
            'A answered 201' => ($a['status'] ?? null) === 201,
            'B was held until A committed' => $blocked($b),
            'B answered 409' => ($b['status'] ?? null) === 409,
            'booking and venue both still exist' => DB::table('venue_bookings')->where('venue_id', $s['venue']->id)->count() === 1 && DB::table('venues')->where('id', $s['venue']->id)->exists(),
        ]);
    },
    'budget_ledger_entry_then_delete' => function () use ($sao, $hold, $blocked, $ledgerEntry) {
        $s = seed($sao);
        [$a, $b] = run(
            ['label' => 'A record a ledger entry (held open, uncommitted)', 'kind' => 'sql', 'sql' => $ledgerEntry($s), 'hold' => $hold],
            ['label' => 'B delete the budget', 'user' => $s['admin']->school_id, 'method' => 'DELETE', 'uri' => "/api/budgets/{$s['budget']->id}"],
            1.2,
        );
        show('a ledger entry is inserted for the budget, then the budget delete arrives', [$a, $b], [
            'A committed' => ($a['status'] ?? null) === 'committed',
            'B was held until A committed' => $blocked($b),
            'B answered 409' => ($b['status'] ?? null) === 409,
            'budget exists and the entry keeps its budget_id' => DB::table('budgets')->where('id', $s['budget']->id)->exists() && DB::table('transactions')->where('budget_id', $s['budget']->id)->count() === 1,
        ]);
    },
    'budget_delete_then_ledger_entry' => function () use ($sao, $hold, $blocked, $ledgerEntry) {
        $s = seed($sao);
        [$a, $b] = run(
            ['label' => 'A delete the budget (pauses after taking the budget lock)', 'user' => $s['admin']->school_id, 'method' => 'DELETE', 'uri' => "/api/budgets/{$s['budget']->id}", 'pause' => ['regex' => '/from `budgets`.*for update/', 'sec' => $hold]],
            ['label' => 'B record a ledger entry for it', 'kind' => 'sql', 'sql' => $ledgerEntry($s), 'hold' => 0],
            1.2,
        );
        show('budget delete holds the lock, a ledger entry for it arrives', [$a, $b], [
            'A answered 200' => ($a['status'] ?? null) === 200,
            'B was held until A committed' => $blocked($b),
            'B refused by the foreign key, no detached entry' => ($b['status'] ?? null) === 'error' && DB::table('transactions')->where('organization_id', $s['org']->id)->count() === 0,
        ]);
    },
    'budget_approval_then_delete' => function () use ($sao, $hold, $blocked) {
        $s = seed($sao);
        [$a, $b] = run(
            ['label' => 'A approve the budget (held open, uncommitted)', 'kind' => 'sql', 'sql' => "update budgets set submission_status = 'approved' where id = {$s['budget']->id}", 'hold' => $hold],
            ['label' => 'B delete the budget', 'user' => $s['admin']->school_id, 'method' => 'DELETE', 'uri' => "/api/budgets/{$s['budget']->id}"],
            1.2,
        );
        show('the budget is approved in an open transaction, then the delete arrives', [$a, $b], [
            'A committed' => ($a['status'] ?? null) === 'committed',
            'B was held until A committed' => $blocked($b),
            'B answered 409' => ($b['status'] ?? null) === 409,
            'approved budget still exists' => DB::table('budgets')->where('id', $s['budget']->id)->where('submission_status', 'approved')->exists(),
        ]);
    },
    'budget_review_then_delete' => function () use ($sao, $hold, $blocked) {
        $s = seedWithApprovals($sao);
        [$a, $b] = run(
            ['label' => 'A approve the budget request (pauses after taking the organization lock, before the budget lock)', 'user' => $s['admin']->school_id, 'method' => 'PATCH', 'uri' => "/api/approval-requests/{$s['budgetApproval']->id}", 'body' => ['status' => 'approved'], 'pause' => ['regex' => '/from `organizations`.*for update/', 'sec' => $hold]],
            ['label' => 'B delete the budget', 'user' => $s['admin']->school_id, 'method' => 'DELETE', 'uri' => "/api/budgets/{$s['budget']->id}"],
            1.2,
        );
        show('a review holds the approval row, then the budget delete arrives', [$a, $b], [
            'A answered 200' => ($a['status'] ?? null) === 200,
            'B was held until A committed' => $blocked($b),
            'B answered 409, not a deadlock 500' => ($b['status'] ?? null) === 409,
            'approved budget still exists' => DB::table('budgets')->where('id', $s['budget']->id)->where('submission_status', 'approved')->exists(),
        ]);
    },
    'budget_delete_then_review' => function () use ($sao, $hold, $blocked) {
        $s = seedWithApprovals($sao);
        [$a, $b] = run(
            ['label' => 'A delete the budget (pauses after taking the budget lock)', 'user' => $s['admin']->school_id, 'method' => 'DELETE', 'uri' => "/api/budgets/{$s['budget']->id}", 'pause' => ['regex' => '/from `budgets`.*for update/', 'sec' => $hold]],
            ['label' => 'B approve the budget request', 'user' => $s['admin']->school_id, 'method' => 'PATCH', 'uri' => "/api/approval-requests/{$s['budgetApproval']->id}", 'body' => ['status' => 'approved']],
            1.2,
        );
        show('budget delete holds its locks, a review of its request arrives', [$a, $b], [
            'A answered 200' => ($a['status'] ?? null) === 200,
            'B was held until A committed' => $blocked($b),
            'B answered 404 or 409, not a server error' => in_array($b['status'] ?? null, [404, 409], true),
            'budget and its request are gone' => ! DB::table('budgets')->where('id', $s['budget']->id)->exists() && ! DB::table('approval_requests')->where('id', $s['budgetApproval']->id)->exists(),
        ]);
    },
    'election_review_then_delete' => function () use ($sao, $hold, $blocked) {
        $s = seedWithApprovals($sao);
        [$a, $b] = run(
            ['label' => 'A approve the election request (pauses after taking the organization lock, before the election update)', 'user' => $s['admin']->school_id, 'method' => 'PATCH', 'uri' => "/api/approval-requests/{$s['electionApproval']->id}", 'body' => ['status' => 'approved'], 'pause' => ['regex' => '/from `organizations`.*for update/', 'sec' => $hold]],
            ['label' => 'B delete the election', 'user' => $s['admin']->school_id, 'method' => 'DELETE', 'uri' => "/api/elections/{$s['election']->id}"],
            1.2,
        );
        show('a review holds the approval row, then the election delete arrives', [$a, $b], [
            'A answered 200' => ($a['status'] ?? null) === 200,
            'B was held until A committed' => $blocked($b),
            'B answered 200, not a deadlock 500' => ($b['status'] ?? null) === 200,
            'election and its request are gone' => ! DB::table('elections')->where('id', $s['election']->id)->exists() && ! DB::table('approval_requests')->where('id', $s['electionApproval']->id)->exists(),
        ]);
    },
    'election_delete_then_position' => function () use ($sao, $hold, $blocked) {
        $s = seed($sao);
        DB::table('elections')->where('id', $s['election']->id)->update(['finalized_at' => null]);
        [$a, $b] = run(
            ['label' => 'A delete the election (pauses after taking the election lock)', 'user' => $s['admin']->school_id, 'method' => 'DELETE', 'uri' => "/api/elections/{$s['election']->id}", 'pause' => ['regex' => '/from `elections`.*for update/', 'sec' => $hold]],
            ['label' => 'B add a position to it', 'user' => $s['admin']->school_id, 'method' => 'POST', 'uri' => "/api/elections/{$s['election']->id}/positions", 'body' => ['title' => 'President']],
            1.2,
        );
        show('election delete holds the lock, a position for that election arrives', [$a, $b], [
            'A answered 200' => ($a['status'] ?? null) === 200,
            'B was held until A committed' => $blocked($b),
            'B answered 404, not a server error' => ($b['status'] ?? null) === 404,
            'no position row left' => DB::table('election_positions')->count() === 0,
        ]);
    },
    'election_opens_then_delete' => function () use ($sao, $hold, $blocked) {
        $s = seed($sao);
        [$a, $b] = run(
            ['label' => 'A open the election (held open, uncommitted)', 'kind' => 'sql', 'sql' => "update elections set status = 'active' where id = {$s['election']->id}", 'hold' => $hold],
            ['label' => 'B delete the election', 'user' => $s['admin']->school_id, 'method' => 'DELETE', 'uri' => "/api/elections/{$s['election']->id}"],
            1.2,
        );
        show('the election opens in an open transaction, then the delete arrives', [$a, $b], [
            'A committed' => ($a['status'] ?? null) === 'committed',
            'B was held until A committed' => $blocked($b),
            'B answered 409' => ($b['status'] ?? null) === 409,
            'open election still exists' => DB::table('elections')->where('id', $s['election']->id)->where('status', 'active')->exists(),
        ]);
    },
    'election_delete_then_opens' => function () use ($sao, $hold, $blocked) {
        $s = seed($sao);
        [$a, $b] = run(
            ['label' => 'A delete the election (pauses after taking the election lock)', 'user' => $s['admin']->school_id, 'method' => 'DELETE', 'uri' => "/api/elections/{$s['election']->id}", 'pause' => ['regex' => '/from `elections`.*for update/', 'sec' => $hold]],
            ['label' => 'B open the election', 'kind' => 'sql', 'sql' => "update elections set status = 'active' where id = {$s['election']->id}", 'hold' => 0],
            1.2,
        );
        show('election delete holds the lock, opening the election arrives', [$a, $b], [
            'A answered 200' => ($a['status'] ?? null) === 200,
            'B was held until A committed' => $blocked($b),
            'B changed no row (the election is gone)' => ($b['rows'] ?? null) === 0,
        ]);
    },
];

foreach ($scenarios as $name => $scenario) {
    if (! $only || str_contains($name, $only)) {
        $scenario();
    }
}

exit($failed ? 1 : 0);
