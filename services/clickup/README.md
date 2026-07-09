# ClickUp FlowRunner Extension

Bring ClickUp workspace, space, folder, list, and task automation to FlowRunner. Covers the ClickUp v2 API surface most automations need: reads and writes across the hierarchy, task comments, checklists, time tracking, and polling triggers for created or updated tasks. Uses OAuth 2.0 and cascading dropdowns so operators pick workspaces, lists, and tasks instead of copying IDs.

## Ideal Use Cases

- Automating task creation and assignment from external triggers (forms, AI agents, emails)
- Syncing tasks between ClickUp and other tools by polling for new or updated tasks
- Building AI agents that triage work, log progress comments, and track time
- Generating folders, lists, and checklists on demand from project templates
- Reading workspace, space, and list metadata for cross-tool dashboards and reports

## List of Actions

### Workspaces
- Get Workspaces

### Spaces
- Get Spaces
- Get Space

### Folders
- Get Folders
- Create Folder
- Update Folder
- Delete Folder

### Lists
- Get Lists
- Create List
- Get List
- Update List
- Delete List

### Tasks
- Get Tasks
- Get Task
- Create Task
- Update Task
- Delete Task

### Comments
- Get Task Comments
- Create Task Comment

### Checklists
- Create Checklist
- Create Checklist Item

### Time Tracking
- Get Time Entries
- Create Time Entry

## List of Triggers

- On New Task
- On Updated Task

## Agent Ideas

- Watch a triage list and, on each new task, classify it and set priority or assignee.
- When a task moves to "in progress", post a comment and start a time entry automatically.
- Nightly, read a list's tasks and generate a status report in another tool.
- On task creation, add a standard "Definition of done" checklist from a template.
