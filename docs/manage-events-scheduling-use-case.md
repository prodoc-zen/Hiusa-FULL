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
- **Save Record:** `EventController@store` atomically saves the organization-scoped planning event, the Department Head's event approval request (always), optional linked budget, and budget approval request.
- **Submit Event for Approval:** the Department Head approves every event proposal. When SAO has configured file requirements that apply to the event, the event stays in planning after the Department Head approves, the Admin uploads each required file, and the SAO then approves the event or returns the files. The Department Head can view the submitted files but only the SAO decides the SAO request. Without applicable requirements the Department Head's approval approves the event.
- **Review Approval Request:** approval decisions are handled by the approval workflow.
- **Edit Event:** `EventController@update` supports updating event information and resubmitting rejected events.
- **Monitor Event:** the event list and detail view show event/approval state, attendance totals, allocated budget, event income, actual spending, remaining funds, advisory risk, and the latest organization OLS forecast. Budget approval state comes from the linked approval request.
- **Activity Calendar:** selecting a date with one event opens its detail view directly; dates with multiple events show artwork and descriptions for each event before selection.
- **Update Event Status:** Admin can move an approved event to ongoing/completed/cancelled according to the server-enforced transition rules. Approval itself cannot be bypassed from event status controls.
- **Financial Link Integrity:** transactions using an event-linked budget inherit that event. A conflicting event/budget selection is rejected, keeping event reports and budget balances consistent.
- **SAO File Checklist:** SAO can add instructions to requirements, reorder them, and remove items with no submitted files. Items already referenced by event submissions must be deactivated instead, preserving the submitted records. Active requirement order and instructions appear in the Admin submission panel.
- **Notify User:** approval workflow notifications are handled through existing approval request review logic.
