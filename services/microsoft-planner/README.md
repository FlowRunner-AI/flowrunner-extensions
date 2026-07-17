# Microsoft Planner FlowRunner Extension

Manage Microsoft Planner boards through the Microsoft Graph API (v1.0) using OAuth2. Create and organize plans inside Microsoft 365 groups, structure work with buckets, and create, update, and assign tasks with dates, priority, progress, and category labels. Planner versions every object with etags and requires an `If-Match` header on all writes; this service fetches the current etag automatically before each update or delete, so flows never handle etags manually.

## Ideal Use Cases

- Automatically create a Planner task in the right bucket when a new lead, ticket, or form submission arrives
- Keep boards organized by adding buckets and updating task bucket, dates, priority, or completion as work progresses
- Break tasks into subtasks by adding and checking off checklist items programmatically
- Assign the right team members to tasks and keep assignees in sync as ownership changes
- Report on all tasks assigned to the signed-in user, or on all tasks within a specific plan or bucket

## List of Actions

### Plans
- Create Plan, Get Plan, List Plans, Update Plan, Delete Plan, Get Plan Details, Update Plan Details

### Buckets
- Create Bucket, Get Bucket, List Buckets, Update Bucket, Delete Bucket

### Tasks
- Create Task, Get Task, List Plan Tasks, List Bucket Tasks, List My Tasks, Update Task, Delete Task

### Task Details
- Get Task Details, Update Task Details, Add Checklist Items, Update Checklist Item, Delete Checklist Item

### Assignments
- Assign User To Task, Unassign User From Task

## List of Triggers

This service does not define any triggers.

## Authentication

OAuth2 via a Microsoft Entra app registration (`login.microsoftonline.com/common`). Delegated scopes: `offline_access`, `User.Read`, `User.ReadBasic.All`, `Tasks.ReadWrite`, `Group.ReadWrite.All`. Only Microsoft 365 (Unified) groups can own Planner plans (up to 200 per group), only basic (non-premium) plans are accessible, and personal Microsoft accounts are not supported. Dropdowns for groups, plans, buckets, tasks, and users are populated dynamically from your directory.

## Agent Ideas

- When a task is created in Planner via **Create Task**, use **Microsoft Teams** "Send Channel Message" to notify the assigned team's channel with the task title and due date
- Use **Microsoft Planner** "List My Tasks" to gather the signed-in user's open work, then call **Outlook** "Send Message" to email a daily digest of outstanding tasks
- When an **Outlook** "Get Messages List" flow surfaces an actionable email, call **Microsoft Planner** "Create Task" and **Add Checklist Items** to turn it into a tracked task with subtasks
