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
|-- <<extend>> Generate Workflow
|   |-- <<include>> Create Task Sequence
|   |-- <<include>> Set Task Deadlines
|   |-- <<include>> Link Tasks to Event
|   `-- <<include>> Save Workflow
`-- <<include>> Save Generated Plan

## Implementation Coverage

- **Role Access:** Admin-only event-planner route and API endpoint.
- **Select Event:** event planner form selects the event to plan.
- **Enter Event Planning Requirements:** Admin submits planning requirements from `EventsPage`.
- **Generate Event Plan Using Groq LLM:** `POST /events/{id}/generate-plan` calls Groq when `GROQ_API_KEY` is configured and uses a deterministic fallback otherwise.
- **Generate Timeline, Checklists, Delay Detection:** both Groq and the deterministic fallback require clearly labeled timeline, resource checklist, logistics checklist, and possible delay/conflict sections.
- **Generate Workflow:** optional workflow creation stores linked AI-generated workflow tasks with distinct, ordered deadlines before the event starts.
- **Save Generated Plan:** generated text is saved in `ai_outputs` and copied into event `planning_details`.
