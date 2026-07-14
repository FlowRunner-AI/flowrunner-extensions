# Formstack FlowRunner Extension

Manage online forms, submissions, fields, folders, webhooks, and confirmations through the Formstack Forms API v2. Authenticates with a Formstack **Access Token** (an OAuth2 bearer token) sent as `Authorization: Bearer <accessToken>`.

## Ideal Use Cases

- Sync new form submissions into a CRM, spreadsheet, or database as they arrive.
- Programmatically create forms and fields, then collect submissions via the API.
- Notify a team channel or send an email whenever a form receives a new submission.
- Manage submission data, webhooks, and folders as part of a larger automation.

## The form / submission / field-id model

Formstack forms are made of **fields**, each with a numeric **field id**. Submission data is stored and returned keyed by field id, not by label — e.g. `{ "field": "48234502", "value": "jane@example.com" }`.

To interpret submission values you need the field-id-to-label mapping:

- **Get Form** returns the form together with its field definitions (id, label, type).
- **List Form Fields** returns just the field definitions for a form.

When **creating a submission** you supply an array of `{ field, value }` objects; the service converts them to the `field_{id}=value` pairs the API expects. Get the field ids from Get Form or List Form Fields first.

## List of Actions

### Forms

- Copy Form
- Create Form
- Delete Form
- Get Form
- List Forms

### Submissions

- Create Submission
- Delete Submission
- Get Submission
- List Submissions

### Fields

- Create Field
- List Form Fields

### Folders

- List Folders

### Webhooks

- Create Webhook
- Delete Webhook
- List Webhooks

### Confirmations

- List Confirmations

## List of Triggers

- On New Submission (polling) — monitors a form and emits each new submission as a raw submission object. The first polling cycle records a watermark and emits nothing, so the existing backlog is not replayed.

## Notes

- Errors from Formstack (`{ "status": "error", "error": "..." }`) are surfaced as `Formstack API error: <message>`.
- Submission values are keyed by field id — pair with Get Form or List Form Fields to map ids to labels.

## Agent Ideas

- When a **Formstack** "On New Submission" trigger fires, use **Google Sheets** "Add Row" to log the submission (after mapping field ids to labels with "List Form Fields") and **Slack** "Send Message To Channel" to alert the team.
- When a **Formstack** "On New Submission" trigger fires, call **Formstack** "Get Form" to resolve field labels, then use **Gmail** "Send Message" to email a formatted copy of the submission to a recipient.
- Use **Google Sheets** "Get Rows" to read a list of contacts and call **Formstack** "Create Submission" for each one to seed a form with records.
