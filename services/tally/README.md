# Tally FlowRunner Extension

Connect FlowRunner to [Tally](https://tally.so), the form builder, via the Tally API. Manage forms, questions, submissions, and webhooks, look up the current user and workspaces, and react to new form submissions in real time.

## Ideal Use Cases

- Route new form submissions into spreadsheets, CRMs, or databases the moment they arrive
- Sync respondent answers to a Slack channel or email for immediate team follow-up
- Programmatically create, publish, and update forms from FlowRunner flows
- Map question ids to human-readable titles when interpreting submission responses
- Manage submission webhooks and clean up submissions across your Tally account

## List of Actions

### Forms

- List Forms
- Get Form
- Create Form
- Update Form
- Delete Form

### Questions

- List Form Questions

### Submissions

- List Submissions
- Get Submission
- Delete Submission

### Webhooks

- List Webhooks
- Create Webhook
- Update Webhook
- Delete Webhook

### Account

- Get Current User
- List Workspaces

## List of Triggers

- On New Submission (real-time, via Tally webhooks)

## Configuration

- **API Key** (required) — your Tally API key. Create it in Tally → Settings → API keys. Sent as `Authorization: Bearer <key>`.

## Notes

- Form names are derived from the FORM_TITLE block. Create Form takes no separate name field — set the title inside the blocks array; Update Form can change the name and status afterward.
- The Tally API is rate limited to roughly 100 requests per minute.

## Agent Ideas

- When a **Tally** "On New Submission" trigger fires, use **Google Sheets** "Add Row" to log each respondent's answers into a submissions spreadsheet
- When a **Tally** "On New Submission" trigger fires, use **Slack** "Send Message To Channel" to notify the team with the respondent's key answers for immediate follow-up
- Use **Tally** "List Submissions" to pull a form's responses, then call **Notion** "Create Page" to archive each submission as a database entry for tracking
