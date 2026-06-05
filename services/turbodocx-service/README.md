# TurboDocx FlowRunner Extension

Document generation and e-signature automation integration for TurboDocx. Generate documents from templates with dynamic variables, manage signing and review workflows, download completed documents to FlowRunner file storage, and track signature audit trails.

## Ideal Use Cases

- Generating contracts, proposals, or reports from templates populated with CRM or spreadsheet data
- Automating document signing workflows by sending documents to recipients via TurboDocx
- Downloading signed documents and storing them in FlowRunner for archiving or further processing
- Building bulk document generation pipelines from batch data sources
- Tracking document signature status and audit trails within automated flows

## List of Actions

- Create Deliverable
- Create Tag
- Delete Template
- Download Document
- Download Signed Document
- Generate Document
- Get Signature Audit Trail
- Get Template By ID
- Get Template Preview Link
- Get Template Variables
- Get Templates Dictionary
- Ingest Bulk Batch
- List All Batches
- List Jobs in Batch
- Prepare for Review
- Prepare for Signing
- Send for Review
- Send for Signing

## Agent Ideas

- When a **Google Sheets** "On New Row" trigger fires with a new client record, use **TurboDocx** "Generate Document" to produce a contract and "Send for Signing" to dispatch it to the client automatically
- Use **TurboDocx** "Download Signed Document" after a signing event to store the PDF URL and write it back to **Google Sheets** "Update Cell" as a record link
- Combine **Gmail** "On New Email" with **TurboDocx** "Get Template Variables" to extract required fields and "Generate Document" to produce the requested document on demand