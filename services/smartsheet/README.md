# Smartsheet FlowRunner Extension

Manage Smartsheet work-management data — sheets, rows, columns, attachments, discussions, workspaces, folders, reports, and webhooks — through a personal API access token. Supports the US, EU, and Gov data regions, and exports/downloads sheet and attachment files directly to FlowRunner file storage.

## Ideal Use Cases

- Append form submissions or CRM records as new rows in a project-tracking sheet, then send an update request asking owners to fill in the remaining fields.
- Export a sheet to Excel, PDF, or CSV on a schedule and deliver the download link by email or chat.
- Sync rows between sheets, copy or move sheets into workspaces, and keep an audit trail via cell history.
- Search across all Smartsheet content, fetch the matching rows, and act on them in a downstream step.
- Attach files or links to rows and download row attachments into FlowRunner storage for further processing.

## List of Actions

- **Sheets** — List Sheets, Get Sheet, Create Sheet, Copy Sheet, Move Sheet, Update Sheet, Delete Sheet, Export Sheet (Excel / PDF / CSV to file storage)
- **Rows** — Add Rows, Update Rows, Get Row, Delete Rows, Move Rows to Another Sheet, Copy Rows to Another Sheet, Get Cell History
- **Columns** — List Columns, Get Column, Add Column, Update Column, Delete Column
- **Attachments** — List Attachments, Attach URL to Row, Attach File to Row, Get Attachment, Download Attachment, Delete Attachment
- **Discussions** — List Discussions, Create Discussion on Row, Create Discussion on Sheet, Add Comment, Delete Discussion
- **Workspaces & Folders** — List Workspaces, Get Workspace, Create Workspace, List Home Folders, Get Folder, Create Folder in Workspace
- **Reports** — List Reports, Get Report
- **Search** — Search Sheet, Search Everything
- **Users & Contacts** — Get Current User, List Users, List Contacts
- **Update Requests** — Create Update Request
- **Webhooks** — List Webhooks, Create Webhook, Set Webhook Status, Delete Webhook

## List of Triggers

This service does not define any triggers. Change notifications are delivered through Smartsheet's own webhook system — use Create Webhook and Set Webhook Status to register a callback endpoint (see the caveat under Notes).

## Configuration

- **Access Token** (required) — a Smartsheet personal API access token, sent as a Bearer token. Generate it in Smartsheet under **Account → Personal Settings → API Access → Generate new access token**.
- **Region** — the data region of your account: `US` (api.smartsheet.com, default), `EU` (api.smartsheet.eu), or `Gov` (api.smartsheetgov.com).

## Notes

- **File storage**: Export Sheet, Download Attachment, and Attach File to Row use FlowRunner file storage. Export and Download save bytes and return a stable download URL; Get Attachment's own URL expires after about 2 minutes, so prefer Download Attachment when a later step needs the file.
- **Webhook verification handshake**: newly created webhooks start disabled (`NEW_NOT_VERIFIED`). Enabling one via Set Webhook Status triggers a challenge request — the callback endpoint must echo the `Smartsheet-Hook-Challenge` header value back (in a `Smartsheet-Hook-Response` header or a `smartsheetHookResponse` JSON body field), or the webhook stays disabled with a failure status.
- **Dictionaries**: sheet, column (per selected sheet), workspace, and report pickers populate the corresponding parameters; you can also paste raw IDs.

## Agent Ideas

- Use **Google Sheets** "Get Rows" to pull records from a spreadsheet, then call **Smartsheet** "Add Rows" to mirror each row into a Smartsheet project tracker.
- Run **Smartsheet** "Export Sheet" to produce a PDF or Excel file, then use **Gmail** "Send Message" to email the download link to stakeholders.
- Run **Smartsheet** "Search Everything" to locate matching rows, feed each result into "Get Row", and post a summary to a channel with **Slack** "Send Message To Channel".
