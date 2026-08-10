# Manage Tasks and Workflow

**Users:** Admin

**Manage Tasks and Workflow**
|-- <<extend>> Create Task
|   |-- <<include>> Enter Task Details
|   |-- <<include>> Set Task Deadline
|   |-- <<extend>> Link Task to Event
|   `-- <<include>> Save Record
|-- <<include>> Evaluate Officer Eligibility
|   |-- <<include>> Check Officer Role
|   |-- <<include>> Check Officer Workload
|   `-- <<include>> Check Past Performance
|-- <<include>> Apply Rule-Based Weighted Scoring
|-- <<include>> Recommend Best-Fit Officer
|-- <<extend>> Generate Task Explanation Using Groq LLM
|-- <<extend>> Generate Workflow
|   |-- <<include>> Create Task Sequence
|   |-- <<include>> Set Task Deadlines
|   `-- <<include>> Link Workflow to Event
|-- <<include>> Assign Task
`-- <<include>> Monitor Task Status

## Implementation Coverage

- **Role Access:** Admin-only task board/create/task-progress routes and task create/update/delete APIs.
- **Create Task:** `TasksPage` captures task title, description, assignee, related event, deadline, and status.
- **Link Task to Event:** task creation supports optional `event_id` and validates organization ownership.
- **Evaluate Officer Eligibility:** `TaskController` validates assignees are SBO Officers and checks their active/completed task counts.
- **Rule-Based Weighted Scoring:** role, workload, performance, and final scores are calculated when assigning a task.
- **Recommend Best-Fit Officer:** when no officer is selected, the server scores every active SBO Officer and assigns the highest-ranked candidate.
- **Generate Task Explanation Using Groq LLM:** the server requests a concise Groq explanation when configured and records a deterministic scoring explanation otherwise.
- **Generate Workflow:** Part 2 event planner can create linked AI-generated workflow tasks.
- **Assign Task:** Admin assigns tasks to SBO Officers.
- **Monitor Task Status:** Admin task-progress route displays workload and completion progress.
