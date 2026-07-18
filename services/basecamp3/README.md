# Basecamp FlowRunner Extension

Connect FlowRunner to [Basecamp](https://basecamp.com) (the Basecamp 4 / "bc3" API) to manage projects, to-do lists and to-dos, message board posts, comments, campfire chat, people, schedule entries, and documents. Authentication is OAuth2 via 37signals Launchpad, and every project tool (to-dos, messages, docs, schedule, campfire) is resolved automatically from the project's dock — so you normally only ever pass a project id.

## Ideal Use Cases

- Turn incoming form submissions, tickets, or leads into new Basecamp to-dos with assignees and due dates
- Keep a project's message board or documents in sync with content generated elsewhere in a flow
- Post automated status updates or alerts to a project's campfire chat
- Fan out schedule entries to a project team from an external calendar or planning system
- Complete or uncomplete to-dos programmatically as work moves through downstream systems

## List of Actions

- **Projects** — List Projects, Get Project, Create Project, Update Project, Trash Project
- **To-do Lists** — Get Todoset, List To-do Lists, Get To-do List, Create To-do List, Update To-do List
- **To-dos** — List To-dos, Get To-do, Create To-do, Update To-do, Complete To-do, Uncomplete To-do
- **Recordings** — Trash Recording
- **Messages** — List Messages, Get Message, Create Message, Update Message
- **Comments** — List Comments, Get Comment, Create Comment
- **Campfire** — List Campfires, Get Campfire Lines, Create Campfire Line
- **People** — List All People, List Project People, Get Person, Get My Profile
- **Schedule** — List Schedule Entries, Create Schedule Entry
- **Documents** — List Documents, Get Document, Create Document, Update Document

## List of Triggers

This service does not define any triggers.

## Authentication

OAuth2 via 37signals Launchpad. Create an integration at https://launchpad.37signals.com/integrations and supply its Client ID and Client Secret. On connect, the integration exchanges the code for a token and resolves the connected user's first Basecamp (bc3) account, embedding that account id alongside the access token (a composite token) because every Basecamp API URL is scoped to the account.

## Notes

- **Automatic dock resolution.** Basecamp scopes tool endpoints (to-dos, messages, documents, schedule, campfire) to per-project tool ids that live in each project's dock. The to-do list, message, document, schedule, and campfire actions resolve those ids automatically from the project you pass, so you only supply the project id.
- **Pagination.** List actions return `items`, `totalCount`, and `nextPage` / `nextPageUrl` when more pages exist; pass `nextPage` back as the Page parameter to continue.
- **Recordings.** In Basecamp almost everything (to-dos, messages, documents, comments, schedule entries, campfire lines) is a "recording" — use Trash Recording to send any of them to the trash.
- **People ids.** To-do assignees and schedule participants are set by numeric people ids; use List All People / List Project People (or the people dictionary) to find them.

## Agent Ideas

- After **Basecamp** "Create To-do" assigns a task, use **Slack** "Send Direct Message" to notify the assignee with the to-do content and due date
- When a **Google Calendar** "On Event Starting Soon" trigger fires, use **Basecamp** "Create Campfire Line" to post a heads-up to the project team's chat
- Use **Basecamp** "List To-dos" to gather a project's open tasks, then **Gmail** "Send Message" to email a daily progress digest to stakeholders
