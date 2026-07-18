# Adobe Acrobat Sign FlowRunner Extension

FlowRunner integration for Adobe Acrobat Sign (REST API v6, OAuth2). Upload documents as transient documents, send agreements out for e-signature (from uploads or library templates), track signing progress through members, events, and signing URLs, send reminders, pull signer-entered form data, and download signed PDFs and audit trails into FlowRunner file storage. Also lists library templates, web forms, users, and groups.

## Ideal Use Cases

- Send a contract, NDA, or offer letter for e-signature and follow it to completion
- Kick off signing from a reusable library template rather than a fresh upload each time
- Embed a signing link in your own email or app via Get Signing URLs instead of Acrobat Sign's notification
- Nudge slow signers with targeted reminders to specific participants
- Archive the signed PDF and its certified audit trail into FlowRunner file storage for compliance
- Pull signer-entered field values (names, dates, custom fields) out of an agreement as structured data after signing

## List of Actions

- **Transient Documents** — Upload Transient Document
- **Agreements** — Send Agreement, Create Draft Agreement, List Agreements, Get Agreement, Cancel Agreement, Get Signing URLs, Get Agreement Members, Get Agreement Events, Send Reminder, Get Form Data, Download Agreement PDF, Download Audit Trail, List Agreement Documents
- **Library Templates** — List Library Documents, Get Library Document
- **Web Forms** — List Web Forms, Get Web Form
- **Users** — Get Current User, List Users
- **Groups** — List Groups

## List of Triggers

This service does not define any triggers.

## Authentication & Configuration

OAuth2 with an Acrobat Sign OAuth application. Create one in the Acrobat Sign web app under **Account > Acrobat Sign API > API Applications** (Domain: CUSTOMER), then **Configure OAuth** and enable these scopes with the `self` modifier: `user_read`, `user_write`, `agreement_read`, `agreement_write`, `agreement_send`, `library_read`, `widget_read`.

Config items:

- **Client ID** (shared) — the OAuth app's Application ID
- **Client Secret** (shared) — the OAuth app's Client Secret
- **Shard** (not shared) — the region shard your account lives on, visible in your account URL (e.g. `secure.na1.adobesign.com` => `na1`). Choices: `na1`, `na2`, `na3`, `na4`, `eu1`, `eu2`, `jp1`, `au1`, `in1`, `sg1` (default `na1`).

The Shard only locates the OAuth authorize and token endpoints. On connect, the service resolves your account's actual regional API host from `GET /baseUris` and stores it with the token, so all subsequent API calls automatically hit the correct host even if it differs from the shard host. If a connection fails to resolve its API access point, confirm the Shard matches your account region and reconnect.

Note: **List Users** requires the connected user to be an account administrator; non-admin connections receive a permission error.

## Agent Ideas

- Use **HubSpot** "Get Deal By ID" to pull a closed deal's contact, then chain **Adobe Acrobat Sign** "Upload Transient Document" and "Send Agreement" to send the contract for signature to that contact
- When **Gmail** "On New Email" delivers an inbound contract attachment, use **Adobe Acrobat Sign** "Upload Transient Document" and "Create Draft Agreement" to stage it for review before sending
- After **Adobe Acrobat Sign** "Get Agreement" reports a SIGNED status, use "Download Agreement PDF" and "Download Audit Trail", then **Google Drive** "Upload File" to archive both into a compliance folder
- Use **Adobe Acrobat Sign** "Get Form Data" to pull signer-entered field values, then **Google Sheets** "Add Row" to log each completed agreement into a tracking spreadsheet
