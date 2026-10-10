# Manage Budget Allocation and Monitoring

**Users:** Admin

**Manage Budget Allocation and Monitoring**
|-- <<extend>> Create Budget Allocation
|   |-- <<include>> Select Event or Project
|   |-- <<include>> Enter Budget Amount
|   |-- <<include>> Validate Budget Details
|   `-- <<include>> Submit Request for Approval
|-- <<include>> Review Approval Request
|-- <<include>> Track Allocated Budget
|-- <<include>> Track Remaining Funds
|-- <<extend>> View Spending Against Budget
`-- <<extend>> Update Budget Status

## Implementation Coverage

- **Role Access:** Admin can monitor, create, edit, and review budget proposals. Super Admin and Department Head do not access budget records.
- **Create Budget Allocation:** the Admin-only budget form captures title, amount, warning threshold, and optional linked event. Admin event creation can also atomically create an event-linked proposal from the same validated budget fields.
- **Semester Allocation:** Admin can optionally attach a financial semester when proposing or editing a budget. The API rejects semesters from another organization and returns the semester name with the budget list. Semester reports include advisories only for budgets attached to their semester.
- **Validate Budget Details:** server validation enforces non-negative amounts and organization-scoped event links.
- **Submit Request for Approval:** every budget proposal requires review by a different Admin account. The requester cannot approve their own request.
- **Review Approval Request:** approval decisions are handled by the approval workflow.
- **Track Allocated/Remaining Funds:** budget records store allocated and remaining amounts.
- **Spent Amount on Budget Payloads:** `GET /api/budgets` and the budget `POST` and `PUT` responses carry `spent_amount`, a two decimal string per budget. It sums the budget's expense ledger entries only, leaves out cash advance releases and repayments, and ignores income, which raises `remaining_amount` above the allocation. It is computed in one query per page. The approval request rows carry the same `spent_amount` in `summary` for budgets.
- **View Spending Against Budget:** budget and event views separately aggregate expense, income, remaining funds, advisory risk, and transaction counts from linked ledger records.
- **Update Budget Status:** approval state is derived from the linked approval request, and only approved budgets can receive ledger transactions.
