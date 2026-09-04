# Manage Budget Allocation and Monitoring

**Users:** Admin, Department Head, SBO Officer

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

- **Role Access:** Admin, Department Head, and SBO Officer can access budget allocation routes and APIs.
- **Create Budget Allocation:** the budget form captures title, amount, warning threshold, and optional linked event. Event creation can also atomically create an event-linked proposal from the same validated budget fields.
- **Validate Budget Details:** server validation enforces non-negative amounts and organization-scoped event links.
- **Submit Request for Approval:** Admin/SBO proposals require Department Head review; Department Head proposals require Admin review to prevent self-approval.
- **Review Approval Request:** approval decisions are handled by the approval workflow.
- **Track Allocated/Remaining Funds:** budget records store allocated and remaining amounts.
- **View Spending Against Budget:** budget and event views separately aggregate expense, income, remaining funds, advisory risk, and transaction counts from linked ledger records.
- **Update Budget Status:** approval state is derived from the linked approval request, and only approved budgets can receive ledger transactions.
