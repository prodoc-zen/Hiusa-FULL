<?php

namespace App\Services;

use App\Models\Organization;
use App\Models\StudentRegistryEntry;
use App\Models\User;

/**
 * Whether a member checking in to an organization's event is enrolled and in good standing on dues. It only
 * informs the officer: nothing here blocks a check-in. Enrollment reads the school records loaded for the
 * organization's college and says "not_checked" when that college has none, never "not enrolled". Dues read
 * the same open-invoice balances the student accounts page shows, so the two cannot disagree.
 */
class EventEligibility
{
    public function __construct(private readonly StudentAccountBalances $balances) {}

    /**
     * The dues amount is finance detail: pass $withAmount false for a viewer without finance access and the rows
     * keep the "dues" state and the flag but carry no "dues_balance".
     *
     * @param  array<int, int|string>  $schoolIds
     * @return array<int, array{enrollment: string, dues: string, dues_balance?: float, flagged: bool}>
     */
    public function forMembers(array $schoolIds, int $organizationId, bool $withAmount = true): array
    {
        $schoolIds = array_values(array_unique(array_map('intval', $schoolIds)));
        if ($schoolIds === []) {
            return [];
        }

        $collegeId = Organization::whereKey($organizationId)->value('college_id');
        $recordsLoaded = $collegeId && StudentRegistryEntry::students()->where('college_id', $collegeId)->exists();
        $enrolled = $recordsLoaded
            ? StudentRegistryEntry::students()->where('college_id', $collegeId)->whereIn('school_id', $schoolIds)->pluck('school_id')->map(fn ($id) => (int) $id)->all()
            : [];

        $accounts = $this->balances->rows(User::whereIn('school_id', $schoolIds)->get(), $organizationId)->keyBy(fn (array $account) => (int) $account['student']['school_id']);

        $result = [];
        foreach ($schoolIds as $schoolId) {
            $account = $accounts->get($schoolId);
            $balance = round((float) ($account['invoice_debt'] ?? 0), 2);
            $dues = $balance < 0.005 ? 'clear' : (($account['overdue_invoice_count'] ?? 0) > 0 ? 'overdue' : 'unpaid');
            $enrollment = ! $recordsLoaded ? 'not_checked' : (in_array($schoolId, $enrolled, true) ? 'enrolled' : 'not_in_records');

            $result[$schoolId] = [
                'enrollment' => $enrollment,
                'dues' => $dues,
                'dues_balance' => $dues === 'clear' ? 0.0 : $balance,
                'flagged' => $enrollment === 'not_in_records' || $dues !== 'clear',
            ];
            if (! $withAmount) {
                unset($result[$schoolId]['dues_balance']);
            }
        }

        return $result;
    }

    public function forMember(int $schoolId, int $organizationId, bool $withAmount = true): array
    {
        return $this->forMembers([$schoolId], $organizationId, $withAmount)[$schoolId];
    }
}
