# Generate Event Plans and Workflows

**Users:** Admin

**Generate Event Plans and Workflows**
|-- <<include>> Select Event
|-- <<include>> Enter Event Planning Requirements
|-- <<include>> Generate Event Plan Using Groq LLM
|   |-- <<include>> Generate Timeline
|   |-- <<include>> Generate Resource Checklist
|   |-- <<include>> Generate Logistics Checklist
|   `-- <<extend>> Detect Possible Delays or Conflicts
|-- <<include>> Generate Draft Workflow
|   |-- <<include>> Create Task Sequence
|   |-- <<include>> Set Task Deadlines
|   |-- <<include>> Link Tasks to Event
|   `-- <<include>> Rank Eligible Officers
|-- <<include>> Admin Review/Edit/Discard
`-- <<include>> Confirm and Create Workflow

## Implementation Coverage

- **Role Access:** Admin-only event-planner route and API endpoint.
- **Select Event:** event planner form selects the event to plan.
- **Enter Event Planning Requirements:** Admin submits planning requirements from `EventsPage`.
- **Generate Event Plan Using Groq LLM:** `POST /events/{id}/generate-plan` sends real event, planning, linked-budget, and schedule-conflict context through Laravel and requires schema-constrained output. A provider/validation failure returns an error and creates no dummy tasks.
- **Generate Timeline, Checklists, Delay Detection:** the validated output contains overview, phases, timeline, resources, logistics, risks, conflicts, and task drafts.
- **Review Workflow:** drafts include editable phases, priorities, deadlines, dependencies, recommended positions, and deterministic officer rankings. Each regeneration is a separate `ai_outputs.version`.
- **Confirm Workflow:** `POST /events/{id}/workflows/{aiOutput}/confirm` creates tasks, links dependencies, persists every ranking, notifies officers, and marks only that version accepted.
