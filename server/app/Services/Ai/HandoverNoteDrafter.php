<?php

namespace App\Services\Ai;

use App\Contracts\TextGenerator;
use Illuminate\Support\Carbon;
use InvalidArgumentException;

/**
 * Writes the remarks of one handover item (finance, events, tasks, organization, election or compliance) from a term
 * digest plus the open items. The model is only ever shown the facts of the item's own category, so a note cannot
 * wander into another one; a note that still names something from another category, adds a number that is not in its
 * facts, runs over the 2,000 character remarks limit or comes back empty is replaced by a template of bullet lines.
 */
class HandoverNoteDrafter
{
    public const CATEGORIES = ['finance', 'events', 'tasks', 'organization', 'election', 'compliance'];

    /** The remarks column accepts 2,000 characters. */
    public const MAX_CHARACTERS = 2000;

    private const KIND_LABELS = ['cash_advance' => 'cash advance', 'collection' => 'collection', 'invoice' => 'invoice'];

    private const ELECTION_STATES = [
        'none' => 'No election is recorded.',
        'scheduled' => 'An election is scheduled.',
        'open' => 'An election is open now.',
        'closed' => 'The election is closed and its results are not finalized yet.',
        'finalized' => 'The election results are finalized.',
    ];

    public function __construct(private readonly TextGenerator $ai) {}

    /**
     * @param  array{category: string, digest?: array<string, mixed>, open_items?: array<string, mixed>}  $facts
     * @return array{text: string, engine: string, model: ?string, facts: array<string, mixed>}
     */
    public function draftFromFacts(array $facts): array
    {
        $category = $facts['category'] ?? null;
        if (! in_array($category, self::CATEGORIES, true)) {
            throw new InvalidArgumentException('The handover category is not one of the six items.');
        }

        $scoped = $this->scoped($category, $facts['digest'] ?? [], $facts['open_items'] ?? []);
        $generated = $this->ai->generate(AiInstructions::handoverNote(), ReviewNoteDrafter::wrapFacts($scoped), 700, 0.2);
        $text = is_array($generated) ? $this->ai->plainText((string) ($generated['text'] ?? '')) : '';

        if ($text !== '' && $this->acceptable($text, $category, $scoped, $facts)) {
            $model = (string) ($generated['model'] ?? '');

            return ['text' => $text, 'engine' => str_starts_with($model, 'claude') ? 'claude' : 'groq', 'model' => $model, 'facts' => $scoped];
        }

        return ['text' => $this->template($category, $scoped), 'engine' => 'template', 'model' => null, 'facts' => $scoped];
    }

    /**
     * Only what belongs to the item: the other five categories' facts never reach the model.
     *
     * @return array<string, mixed>
     */
    private function scoped(string $category, array $digest, array $openItems): array
    {
        $scope = ['category' => $category, 'organization' => $digest['organization'] ?? null, 'semester' => $digest['semester'] ?? null];

        return $scope + match ($category) {
            'finance' => ['finance' => $digest['finance'] ?? null, 'unsettled' => $openItems['unsettled'] ?? []],
            'events' => ['events' => $digest['events'] ?? [], 'scheduled_events' => $this->notAlreadyListed($openItems['scheduled_events'] ?? [], $digest['events'] ?? [])],
            'tasks' => ['tasks' => $digest['tasks'] ?? null, 'pending_tasks' => $openItems['pending_tasks'] ?? []],
            'organization' => ['officers' => $this->positionsOnly($digest['officers'] ?? []), 'announcements' => $digest['announcements'] ?? null, 'merchandise' => $digest['merchandise'] ?? null],
            'election' => ['elections' => $digest['elections'] ?? [], 'election_state' => $openItems['election_state'] ?? 'none'],
            'compliance' => ['missing_compliance' => $openItems['missing_compliance'] ?? []],
        };
    }

    /**
     * A person is named by position only, so a student's name never reaches the model or the stored facts.
     *
     * @return list<array{position: string}>
     */
    private function positionsOnly(array $officers): array
    {
        return array_map(fn ($officer) => ['position' => (string) ($officer['position'] ?? 'Officer')], array_values($officers));
    }

    /** A scheduled event the semester's events already list, by title and date, is not said twice. */
    private function notAlreadyListed(array $scheduled, array $events): array
    {
        $listed = array_map(fn ($event) => mb_strtolower(($event['title'] ?? '').'|'.($event['date'] ?? '')), $events);

        return array_values(array_filter($scheduled, fn ($event) => ! in_array(mb_strtolower(($event['title'] ?? '').'|'.($event['date'] ?? '')), $listed, true)));
    }

    private function acceptable(string $text, string $category, array $scoped, array $facts): bool
    {
        if (mb_strlen($text) > self::MAX_CHARACTERS || ! $this->ai->preservesNumericFacts($text, $scoped)) {
            return false;
        }

        // A title that belongs to another category, and is not also one of this category's, must not appear.
        $own = array_map('mb_strtolower', $this->titles($category, $scoped));
        foreach ($this->otherTitles($category, $facts) as $title) {
            if (! in_array(mb_strtolower($title), $own, true) && mb_stripos($text, $title) !== false) {
                return false;
            }
        }

        return true;
    }

    /** @return list<string> */
    private function titles(string $category, array $scoped): array
    {
        return match ($category) {
            'events' => array_merge(array_column($scoped['events'], 'title'), array_column($scoped['scheduled_events'], 'title')),
            'tasks' => array_column($scoped['pending_tasks'], 'title'),
            'election' => array_column($scoped['elections'], 'title'),
            'compliance' => array_map('strval', $scoped['missing_compliance']),
            default => [],
        };
    }

    /**
     * The titles of every other category, taken from the full facts.
     *
     * @return list<string>
     */
    private function otherTitles(string $category, array $facts): array
    {
        $digest = $facts['digest'] ?? [];
        $open = $facts['open_items'] ?? [];
        $titles = [];
        foreach (self::CATEGORIES as $other) {
            if ($other === $category) {
                continue;
            }
            $titles = array_merge($titles, match ($other) {
                'events' => array_merge(array_column($digest['events'] ?? [], 'title'), array_column($open['scheduled_events'] ?? [], 'title')),
                'tasks' => array_column($open['pending_tasks'] ?? [], 'title'),
                'election' => array_column($digest['elections'] ?? [], 'title'),
                'compliance' => array_map('strval', $open['missing_compliance'] ?? []),
                default => [],
            });
        }

        // A very short title would match inside ordinary words.
        return array_values(array_filter(array_unique($titles), fn ($title) => is_string($title) && mb_strlen($title) >= 4));
    }

    /** The facts of the item as bullet lines, kept inside the remarks limit. */
    private function template(string $category, array $scoped): string
    {
        $money = fn ($amount) => 'PHP '.number_format((float) $amount, 2);
        $day = fn ($date) => Carbon::parse($date)->format('F j, Y');
        $lines = [];

        switch ($category) {
            case 'finance':
                $finance = $scoped['finance'] ?? null;
                if ($finance) {
                    $lines[] = "- This term: income {$money($finance['income'])}, expenses {$money($finance['expense'])}, closing balance {$money($finance['closing_balance'])}.";
                }
                foreach ($scoped['unsettled'] as $item) {
                    $label = self::KIND_LABELS[$item['kind'] ?? ''] ?? 'item';
                    $lines[] = rtrim("- Unsettled {$label}: {$money($item['amount'] ?? 0)}. ".mb_strimwidth(trim((string) ($item['note'] ?? '')), 0, 200, '...'));
                }
                if ($scoped['unsettled'] === []) {
                    $lines[] = '- Nothing is recorded as unsettled.';
                }
                break;
            case 'events':
                foreach ($scoped['events'] as $event) {
                    $lines[] = match ($event['status'] ?? '') {
                        'completed' => "- \"{$event['title']}\" was held on {$day($event['date'])}".(($event['attendance'] ?? null) !== null ? " with {$event['attendance']} attending." : '.'),
                        'cancelled' => "- \"{$event['title']}\" was cancelled and was not held ({$day($event['date'])}).",
                        default => "- \"{$event['title']}\" is planned for {$day($event['date'])}.",
                    };
                }
                foreach ($scoped['scheduled_events'] as $event) {
                    $lines[] = "- Still scheduled: \"{$event['title']}\" on {$day($event['date'])}.";
                }
                if ($lines === []) {
                    $lines[] = '- No events were recorded this term and none are scheduled.';
                }
                break;
            case 'tasks':
                $tasks = $scoped['tasks'];
                if ($tasks) {
                    $lines[] = "- Tasks this term: {$tasks['completed']} completed, {$tasks['overdue']} overdue, {$tasks['open']} still open.";
                }
                foreach ($scoped['pending_tasks'] as $task) {
                    $lines[] = "- \"{$task['title']}\" is with {$task['owner']}, due {$task['deadline']}.";
                }
                if ($scoped['pending_tasks'] === []) {
                    $lines[] = '- No task is waiting on anyone.';
                }
                break;
            case 'organization':
                if ($scoped['organization']) {
                    $lines[] = "- Organization: {$scoped['organization']}.";
                }
                if ($scoped['officers'] !== []) {
                    $lines[] = '- Officer positions this term: '.implode(', ', array_column($scoped['officers'], 'position')).'.';
                }
                if ($scoped['announcements']) {
                    $lines[] = "- Announcements posted: {$scoped['announcements']['posted']}.";
                }
                if ($scoped['merchandise']) {
                    $lines[] = "- Merchandise orders: {$scoped['merchandise']['orders']}, of which {$scoped['merchandise']['claimed']} were claimed.";
                }
                if ($lines === []) {
                    $lines[] = '- No organization records are available for this term.';
                }
                break;
            case 'election':
                $lines[] = '- '.(self::ELECTION_STATES[$scoped['election_state']] ?? self::ELECTION_STATES['none']);
                foreach ($scoped['elections'] as $election) {
                    $lines[] = "- Election \"{$election['title']}\": {$election['ballots']} ballots cast by {$election['voters']} eligible voters.";
                }
                break;
            case 'compliance':
                foreach ($scoped['missing_compliance'] as $name) {
                    $lines[] = "- Still missing: {$name}.";
                }
                if ($scoped['missing_compliance'] === []) {
                    $lines[] = '- No compliance requirement is recorded as missing.';
                }
                break;
        }

        return $this->withinLimit($lines);
    }

    /** Whole lines while they fit; the last line that does not is dropped and the list says more exists. */
    private function withinLimit(array $lines): string
    {
        $note = '- More items are listed in the system.';
        $text = implode("\n", $lines);
        if (mb_strlen($text) <= self::MAX_CHARACTERS) {
            return $text;
        }

        $kept = [];
        $length = mb_strlen($note) + 1;
        foreach ($lines as $line) {
            $length += mb_strlen($line) + 1;
            if ($length > self::MAX_CHARACTERS) {
                break;
            }
            $kept[] = $line;
        }
        $kept[] = $note;

        return implode("\n", $kept);
    }
}
