# Bitrix24 FlowRunner Extension

Automate a Bitrix24 portal's CRM and collaboration tools from FlowRunner: manage leads, contacts, companies, and deals with full CRUD plus field-schema discovery, read CRM reference data, post timeline comments and activities, run tasks, look up users, and send in-app notifications. A generic **Call REST Method** action reaches any of Bitrix24's 600+ REST methods not covered by a dedicated action. Authentication uses a single-portal inbound webhook URL.

## Ideal Use Cases

- Sync new leads, contacts, and companies into Bitrix24 CRM from web forms, spreadsheets, or other apps
- Advance deals through pipeline stages and log timeline comments as automated workflows progress
- Create and complete tasks, assign responsible users, and notify them via the Bitrix24 notification center
- Enrich or reconcile CRM records by looking up statuses, deal pipelines, and portal users
- Reach any uncovered Bitrix24 REST method (products, quotes, disk, telephony, etc.) through Call REST Method

## List of Actions

### Leads
- List Leads, Get Lead, Create Lead, Update Lead, Delete Lead, Get Lead Fields

### Contacts
- List Contacts, Get Contact, Create Contact, Update Contact, Delete Contact, Get Contact Fields

### Companies
- List Companies, Get Company, Create Company, Update Company, Delete Company, Get Company Fields

### Deals
- List Deals, Get Deal, Create Deal, Update Deal, Delete Deal, Get Deal Fields

### CRM Reference Data
- Get Status List, Get Deal Categories

### Activities
- Add Timeline Comment, Create Activity, List Activities

### Tasks
- List Tasks, Get Task, Create Task, Update Task, Complete Task, Delete Task

### Users
- List Users, Get Current User, Search Users

### Messaging
- Send Notification

### Advanced
- Call REST Method

## List of Triggers

This service does not define any triggers.

## Authentication

The service authenticates with a single-portal Bitrix24 **inbound webhook URL**. OAuth2 multi-portal "local applications" are out of scope.

Create one under **Bitrix24 → Developer resources → Other → Inbound webhook**. The URL includes the user ID and token segments, e.g. `https://yourcompany.bitrix24.com/rest/1/abc123token/`. Grant the permission scopes your actions need when creating it: `crm`, `task`, `user`, and `im` (for Send Notification). All API calls run with the permissions of the user who created the webhook (see Get Current User).

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| Inbound Webhook URL | Yes | Full inbound webhook URL of your portal, including the user ID and token segments. |

## Notes

- List actions return up to 50 items per page. Pass the returned `next` value as **Start Offset** to fetch the following page, and use Bitrix24's `filter` / `order` / `select` parameters. Filter keys are UPPERCASE field names (e.g. `TITLE`, `STATUS_ID`) and support comparison prefixes such as `>=`, `<=`, `>`, and `%` for substring matching.
- Task actions accept UPPERCASE field names on input but return task objects with camelCase property names.
- Create/Update actions expose common fields as convenience parameters; use **Additional Fields** to set any other standard or custom `UF_*` field, which overrides the convenience parameters.

## Agent Ideas

- After **Bitrix24** "Create Deal" moves a prospect into the pipeline, use **Gmail** "Send Message" to email the contact a proposal, then call **Bitrix24** "Add Timeline Comment" to log that the proposal was sent.
- When a **Gmail** "On New Email" trigger fires from a prospect, call **Bitrix24** "Create Lead" to capture them in CRM and **Bitrix24** "Send Notification" to alert the assigned sales rep.
- Use **Google Sheets** "Get Rows" to read a batch of prospects and call **Bitrix24** "Create Contact" for each, or reverse it with **Bitrix24** "List Deals" feeding **Google Sheets** "Add Row" to build a pipeline report.
- When a **Slack** "On Channel Message" trigger flags a support request, call **Bitrix24** "Create Task" to assign follow-up work to the responsible user.
