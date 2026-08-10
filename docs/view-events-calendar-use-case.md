# View Events and Activity Calendar

**Users:** Admin, SBO Officer, Department Head, Student

**View Events and Activity Calendar**
|-- <<include>> Load Approved Events
|-- <<include>> Display Activity Calendar
|-- <<extend>> Open Event Details
|   `-- <<include>> View Details
|-- <<extend>> Filter Events by Date
`-- <<extend>> View Upcoming Events

## Implementation Coverage

- **Role Access:** all four roles can access the activity-calendar route and events API.
- **Load Approved Events:** Student and Department Head event lists are limited to approved, ongoing, or completed events.
- **Display Activity Calendar:** `EventsPage` displays the event list with schedule, location, and status.
- **Open Event Details:** `GET /events/{id}` loads schedule/details for all roles; officer tasks and attendee records are included only for Admin and SBO Officer.
- **Filter Events by Date:** `EventsPage` provides date and text filters without exposing unauthorized task data to Student or Department Head roles.
- **View Upcoming Events:** `EventsPage` computes upcoming/approved events for the summary cards.
