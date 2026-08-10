# View and Update Assigned Tasks

**Users:** SBO Officer

**View and Update Assigned Tasks**
|-- <<include>> Load Assigned Tasks
|-- <<include>> View Task Details
|   |-- <<include>> Load Assigned Task
|   |-- <<include>> Display Task Description
|   |-- <<include>> Display Deadline
|   |-- <<include>> Display Task Status
|   |-- <<extend>> View Related Event
|   |-- <<extend>> View Task Progress History
|   `-- <<extend>> View AI Assignment Explanation
|-- <<extend>> Update Task Progress
|   |-- <<include>> Enter Progress Update
|   |-- <<include>> Validate Progress Update
|   `-- <<include>> Save Task Update
|-- <<extend>> Mark Task as Completed
|   |-- <<include>> Confirm Completion
|   |-- <<include>> Update Task Status
|   `-- <<include>> Save Task Update
`-- <<include>> Notify Admin
    |-- <<include>> Identify Assigned Admin
    |-- <<include>> Generate Task Update Notification
    `-- <<include>> Save Notification Record

## Implementation Coverage

- **Role Access:** SBO Officer can access assigned tasks and status-update API.
- **Load Assigned Tasks:** `TaskController@index` scopes SBO Officer results to tasks assigned to or created by the officer.
- **View Task Details:** task rows display title, assignee, deadline, status, event relation, and AI assignment notes when present.
- **Update Task Progress:** SBO Officer can move pending tasks to in progress.
- **Mark Task as Completed:** SBO Officer can complete in-progress tasks; completion normalizes progress to 100%.
- **Notify Admin:** SBO Officer task updates create task notifications for organization Admin users.
