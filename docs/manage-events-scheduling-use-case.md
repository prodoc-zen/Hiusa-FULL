# Manage Events and Scheduling

**Users:** Admin

**Manage Events and Scheduling**
|-- <<extend>> Create Event
|   |-- <<include>> Enter Event Details
|   |-- <<include>> Set Event Schedule
|   |-- <<include>> Add Event Budget Details
|   |-- <<extend>> Add Vendor Deadlines
|   |-- <<extend>> Add Logistics Checklist
|   `-- <<include>> Save Record
|-- <<extend>> Edit Event
|   |-- <<include>> View Event Details
|   |-- <<include>> Update Event Information
|   `-- <<include>> Save Record
|-- <<include>> Submit Event for Approval
|-- <<include>> Review Approval Request
`-- <<include>> Notify User

## Implementation Coverage

- **Role Access:** Admin-only route, sidebar, and API middleware protect event scheduling changes.
- **Create Event:** `EventsPage` captures event details, schedule, budget flag/details, vendor deadlines, and logistics checklist.
- **Save Record:** `EventController@store` saves events as `planning` and scopes them to the organization.
- **Submit Event for Approval:** event creation creates a Department Head approval request.
- **Review Approval Request:** approval decisions are handled by the approval workflow.
- **Edit Event:** `EventController@update` supports updating event information and resubmitting rejected events.
- **Notify User:** approval workflow notifications are handled through existing approval request review logic.
