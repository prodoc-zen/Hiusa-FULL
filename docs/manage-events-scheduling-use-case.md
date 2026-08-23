# Manage Events and Scheduling

**Users:** Admin

**Manage Events and Scheduling**
|-- <<include>> Create Event
|   |-- <<include>> Enter Event Details
|   |-- <<include>> Set Event Schedule
|   |-- <<extend>> Add Budget Requirements / Notes
|   |-- <<extend>> Add Vendor Deadlines
|   |-- <<extend>> Add Logistics Checklist
|   |-- <<include>> Save Record
|   `-- <<include>> Submit Event for Approval
|       `-- <<include>> Submit Request for Approval
|-- <<include>> Edit Event
|   |-- <<include>> View Event Details
|   |-- <<include>> Update Event Information
|   |-- <<include>> Save Record
|   `-- <<extend>> Resubmit Material Changes for Approval
|-- <<include>> Monitor Event
|   |-- <<include>> View Event Status
|   |-- <<include>> View Attendance Summary
|   `-- <<include>> View Linked Budget Status
|-- <<include>> Update Event Status
|   |-- <<extend>> Start Approved Event
|   |-- <<extend>> Complete Active Event
|   `-- <<extend>> Cancel Event
`-- <<include>> Notify User

## Implementation Coverage

- **Role Access:** Admin-only route, sidebar, and API middleware protect event scheduling changes.
- **Create Event:** `EventsPage` captures event details, schedule, optional budget requirements, vendor deadlines, and logistics checklist. Budget requirements are planning notes; the financial allocation is a separate budget record explicitly linked through `budgets.event_id`.
- **Save Record:** `EventController@store` saves events as `planning` and scopes them to the organization.
- **Submit Event for Approval:** event creation creates a Department Head approval request.
- **Review Approval Request:** approval decisions are handled by the approval workflow.
- **Edit Event:** `EventController@update` supports updating event information and resubmitting rejected events.
- **Monitor Event:** the event list and detail view show event/approval state, attendance totals, and every organization-scoped budget whose `event_id` matches the event. Budget approval state comes from the linked approval request.
- **Update Event Status:** Admin can move an approved event to ongoing/completed/cancelled according to the server-enforced transition rules. Approval itself cannot be bypassed from event status controls.
- **Financial Link Integrity:** transactions using an event-linked budget inherit that event. A conflicting event/budget selection is rejected, keeping event reports and budget balances consistent.
- **Notify User:** approval workflow notifications are handled through existing approval request review logic.
