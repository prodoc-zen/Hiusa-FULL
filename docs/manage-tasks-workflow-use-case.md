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
|   |-- <<include>> Require Assigned SBO Position
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
- **Create Task:** `/dashboard/tasks/create-task` is a dedicated creation workspace that captures title, description, assignee, related event, deadline, and status, with assignment-readiness guidance. The Task Board action navigates here instead of opening a duplicate modal.
- **Link Task to Event:** task creation supports optional `event_id` and validates organization ownership.
- **Evaluate Officer Eligibility:** `TaskController` requires an active SBO Officer with an assigned SBO position before either manual or automatic delegation, then checks active/completed task counts.
- **Rule-Based Weighted Scoring:** role, workload, performance, and final scores are calculated using configurable normalized weights. Every candidate ranking is stored in `task_recommendations` with the exact weights and calculation time.
- **Recommend Best-Fit Officer:** when no officer is selected, the server scores every active SBO Officer and assigns the highest-ranked candidate.
- **Generate Task Explanation Using Groq LLM:** the server requests a concise Groq explanation when configured and records a deterministic scoring explanation otherwise.
- **Generate Workflow:** the event planner proposes tasks first; an Admin must review and confirm before linked tasks become active.
- **Assign Task:** Admin assigns tasks to SBO Officers.
- **Monitor Task Status:** Admin task-progress route displays workload and completion progress. API responses expose dependency-derived `blocked` and `ready` workflow states, and blocked tasks cannot start or complete.
