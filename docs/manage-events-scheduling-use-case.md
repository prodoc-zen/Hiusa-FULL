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
- **Create Event:** `EventsPage` captures event type, expected participants, schedule, planning requirements, resources, vendor/logistics details, and optional proposed budget data. When an amount is supplied, the backend creates a separate event-linked budget proposal; no financial values are represented only as UI text.
- **Save Record:** `EventController@store` atomically saves the organization-scoped planning event, event approval request, optional linked budget, and budget approval request.
- **Submit Event for Approval:** event creation creates a Department Head approval request.
- **Review Approval Request:** approval decisions are handled by the approval workflow.
- **Edit Event:** `EventController@update` supports updating event information and resubmitting rejected events.
- **Monitor Event:** the event list and detail view show event/approval state, attendance totals, allocated budget, event income, actual spending, remaining funds, advisory risk, and the latest organization OLS forecast. Budget approval state comes from the linked approval request.
- **Update Event Status:** Admin can move an approved event to ongoing/completed/cancelled according to the server-enforced transition rules. Approval itself cannot be bypassed from event status controls.
- **Financial Link Integrity:** transactions using an event-linked budget inherit that event. A conflicting event/budget selection is rejected, keeping event reports and budget balances consistent.
- **Notify User:** approval workflow notifications are handled through existing approval request review logic.
