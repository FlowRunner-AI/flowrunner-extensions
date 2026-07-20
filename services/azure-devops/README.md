# Azure DevOps FlowRunner Extension

Connect to Azure DevOps Services to manage projects, teams, work items, WIQL queries, Git repositories, pull requests, pipelines, builds and team iterations across a single organization. Authenticates with a Personal Access Token (PAT) over HTTP Basic auth.

## Ideal Use Cases

- Automatically create Bug or Task work items from incoming alerts, forms or support tickets
- Run WIQL queries on a schedule and batch-fetch matching work items for reporting
- Open, review, complete or comment on pull requests as part of a release workflow
- Trigger a YAML pipeline run or queue a classic build, then poll for its result
- Track sprint progress by listing a team's iterations and their assigned work items

## List of Actions

### Projects & Teams
- Get Project, List Projects, List Teams

### Work Items
- Add Comment to Work Item, Create Work Item, Delete Work Item, Get Work Item, Get Work Items Batch, List Work Item Comments, Update Work Item

### Queries
- Run WIQL Query

### Repositories (Git)
- Get File Content, Get Repository, List Branches, List Commits, List Repositories

### Pull Requests
- Add Pull Request Comment, Create Pull Request, Get Pull Request, List Pull Requests, Update Pull Request

### Pipelines & Builds
- Get Build, Get Pipeline Run, List Builds, List Pipelines, Queue Build, Run Pipeline

### Boards
- List Team Iterations

## List of Triggers

This service does not define any triggers.

## Authentication

Configure two items: **Organization** (the `{organization}` segment of `https://dev.azure.com/{organization}`) and a **Personal Access Token** created under User Settings → Personal Access Tokens. The PAT is sent over HTTP Basic auth and must carry the scopes for the resources you use (Work Items, Code, Build, Release). A PAT is used because Azure DevOps 3-legged OAuth is closed to new applications.

Create Work Item and Update Work Item accept convenience fields (title, state, assigned-to, tags, area/iteration path) or raw JSON-Patch operations for any other field. WIQL queries return only work item IDs — pass them to Get Work Items Batch for full field values.

## Agent Ideas

- When a **GitHub** "On Pull Request Opened" trigger fires, use Azure DevOps "Create Work Item" to open a tracking Task and "Add Comment to Work Item" with the PR link for cross-repo traceability.
- After Azure DevOps "Run Pipeline" and "Get Pipeline Run" report a failed result, use **Slack** "Send Message To Channel" to alert the team with the run state and result.
- When a **Jira** "Create Issue" is raised for a code defect, use Azure DevOps "Create Pull Request" and "Add Pull Request Comment" to open and annotate the fix branch back in Azure Repos.
