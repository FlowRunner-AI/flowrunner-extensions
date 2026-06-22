# GitHub FlowRunner Extension

Comprehensive GitHub integration via OAuth2 for managing repositories, issues, pull requests, branches, files, commits, releases, organizations, teams, gists, webhooks, secrets, variables, GitHub Actions workflows, and more. Includes reading file contents and commit history, searching repositories and issues, triggering and inspecting Actions workflow runs, and polling triggers that react to repository, issue, pull request, and account activity. Requires a GitHub OAuth App (Client ID and Client Secret) to authenticate.

## Ideal Use Cases

- Automating repository lifecycle tasks such as creating repos, branches, files, and releases
- Reading file contents and reviewing commit history to drive code-aware automations
- Searching repositories, issues, and pull requests with GitHub search syntax to locate relevant items
- Triaging and managing issues and pull requests, including labels, milestones, assignees, and comments
- Synchronizing GitHub activity (new issues, PRs, pushes, releases, stars) into downstream flows
- Managing organizations, teams, collaborators, and membership programmatically
- Maintaining CI/CD configuration through repository, organization, and environment secrets and variables
- Triggering GitHub Actions workflows on demand and monitoring their runs and jobs for status reporting
- Publishing gists and triggering repository dispatch events for custom workflow automation
- Monitoring notifications, mentions, and review requests for a connected GitHub account

## List of Actions

- Add Collaborator
- Add Label to Issue/PR
- Add Team Member
- Add Team Repository
- Assign Issue/PR
- Check Organization Membership
- Create Branch
- Create Deploy Key
- Create Discussion
- Create Discussion Comment
- Create Environment Secret
- Create Environment Variable
- Create File
- Create Gist
- Create Issue
- Create Issue Comment
- Create Label
- Create Milestone
- Create Organization Project
- Create Organization Repository
- Create Organization Secret
- Create Organization Variable
- Create Pull Request
- Create Release
- Create Repository
- Create Repository Dispatch Event
- Create Repository Project
- Create Repository Secret
- Create Repository Variable
- Create Repository Webhook
- Create Team
- Delete Branch
- Delete Deploy Key
- Delete Environment Secret
- Delete Environment Variable
- Delete File
- Delete Gist
- Delete Label
- Delete Milestone
- Delete Organization Secret
- Delete Organization Variable
- Delete Project
- Delete Release
- Delete Repository
- Delete Repository Secret
- Delete Repository Variable
- Delete Repository Webhook
- Delete Team
- Find Branch
- Find Issue
- Find Organization
- Find or Create Issue
- Find or Create Pull Request
- Find Pull Request
- Find Repository
- Find User
- Fork Repository
- Get Commit
- Get Contents
- Get Current User
- Get File Content
- Get Workflow Run
- List Commits
- List Workflow Run Jobs
- List Workflow Runs
- List Workflows
- Merge Pull Request
- Remove Collaborator
- Remove Label from Issue/PR
- Remove Team Member
- Remove Team Repository
- Search Issues and Pull Requests
- Search Repositories
- Star Repository
- Trigger Workflow
- Unassign Issue/PR
- Unstar Repository
- Unwatch Repository
- Update File
- Update Issue
- Update Label
- Update Milestone
- Update Organization Variable
- Update Repository Variable
- Update Environment Variable
- Watch Repository

## List of Triggers

- New Branch
- New Collaborator
- New Commit
- New Commit Comment
- New Gist
- New Global Event
- New Label
- New Mention
- New Milestone
- New Notification
- New Organization
- New Repo Event
- New Repository
- New Review Request
- New Team
- New Watcher
- On Issue Opened
- On Pull Request Opened
- On Push
- On Release Published
- On Star

## Agent Ideas

- When a **GitHub** "On Issue Opened" trigger fires, use **Slack** "Send Message To Channel" to notify the engineering channel with the issue title, author, and link
- When a **GitHub** "On Push" trigger fires, call **GitHub** "Trigger Workflow" to launch a CI/CD workflow on the pushed ref, then poll **GitHub** "List Workflow Runs" and "Get Workflow Run" and post the conclusion to **Slack** "Send Message To Channel"
- When a **GitHub** "On Pull Request Opened" trigger fires, use **GitHub** "List Workflow Run Jobs" to summarize check status for that branch and **Slack** "Send Message To Channel" to alert reviewers of any failed jobs
- Use **Gmail** "On New Email" to capture inbound bug reports, then call **GitHub** "Search Issues and Pull Requests" to find duplicates and **GitHub** "Find or Create Issue" to file or update a matching issue
- Use **GitHub** "List Workflows" and "Get File Content" to audit a repository's Actions configuration, then send the summary via **Gmail** "Send Message" as a daily project digest
