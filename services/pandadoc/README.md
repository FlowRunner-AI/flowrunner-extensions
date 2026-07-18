# PandaDoc FlowRunner Extension

Create documents from PandaDoc templates or uploaded PDF/DOCX files, send them for eSignature, generate embedded signing sessions and ready-to-share links, download completed PDFs to FlowRunner file storage, and manage templates, contacts, folders, members, webhook subscriptions, and API logs. Authenticates with a PandaDoc API key.

## Ideal Use Cases

- Auto-generate a contract from a template when a CRM deal is won, pre-fill client tokens, and send it for signature.
- Turn an uploaded PDF or DOCX into a signable document and email it to recipients with a custom subject and message.
- Create a per-recipient signing link to embed in your own app or portal instead of PandaDoc's default emails.
- Download the signed PDF (optionally watermarked) to file storage once a document is completed, for archival.
- Register webhook subscriptions to react to document state changes downstream.

## List of Actions

### Documents

- Create Document from File
- Create Document from Template
- Create Document Link
- Delete Document
- Download Document PDF
- Get Document Details
- Get Document Status
- List Documents
- Send Document
- Update Document Name

### Templates

- Get Template Details
- List Templates

### Contacts

- Create Contact
- Delete Contact
- Get Contact
- List Contacts
- Update Contact

### Folders

- Create Document Folder
- List Document Folders
- List Template Folders

### Members

- Get Member
- List Members

### Webhooks

- Create Webhook Subscription
- Delete Webhook Subscription
- List Webhook Subscriptions

### API Logs

- Get API Log Event
- List API Log Events

## List of Triggers

This service does not define any triggers.

## Authentication

API key, sent as `Authorization: API-Key <key>`, configured per connection (not shared). Create a key in PandaDoc under **Settings → API & Integrations**. Sandbox keys are free and instant; production keys require an API-enabled plan.

## Notes

- **Document lifecycle**: A freshly created document stays in the transient `document.uploaded` status for a few seconds before becoming `document.draft`, and cannot be sent until it reaches draft. **Send Document** handles this automatically by polling every 2 seconds for up to ~30 seconds; you can also poll **Get Document Status** manually.
- **Silent send + links**: To share your own links instead of PandaDoc's emails, use **Send Document** with Silent enabled, then **Create Document Link** to generate a per-recipient session (`https://app.pandadoc.com/s/{sessionId}`).
- **File storage**: **Create Document from File** uploads a PDF/DOCX from FlowRunner file storage, and **Download Document PDF** saves the (optionally watermarked) PDF back to file storage and returns its URL.
- **Update Document Name** is draft-only; the endpoint returns no content, so the action returns a synthesized success object.
- Template, document folder, contact, and document pickers are backed by dictionaries and are not standalone actions.

## Agent Ideas

- When a **HubSpot** "Get Deal By ID" returns a won deal, call **PandaDoc** "Create Document from Template" with the client as a recipient, then "Send Document" to route the contract for signature.
- After **PandaDoc** "Send Document" (Silent), use "Create Document Link" to mint a signing link and **Slack** "Send Message To Channel" to post it to the deal's channel for the account team.
- Once a document is completed, use **PandaDoc** "Download Document PDF" to save the signed file, then **Gmail** "Send Message" to email it to the client, or **Google Drive** "Upload File" to archive it in a shared folder.
