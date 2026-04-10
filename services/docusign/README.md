# DocuSign FlowRunner Extension

Automate document signing workflows with DocuSign's eSignature platform. Send envelopes from templates or custom documents, track signing progress, manage recipients, and trigger workflows based on envelope lifecycle events such as completion, decline, or voiding.

## Ideal Use Cases

- Sending contracts and agreements for signature using pre-built templates
- Creating envelopes with dynamically generated documents from URLs
- Tracking envelope status and monitoring signing progress
- Automating post-signature workflows when documents are completed
- Handling declined or voided envelopes with escalation or retry logic
- Downloading signed documents for archival or further processing
- Resending signing notifications to recipients who missed the original email

## List of Actions

### Envelopes

- Send Envelope from Template
- Send Envelope with Document
- Get Envelope Status
- List Envelopes
- Void Envelope
- Resend Envelope

### Documents

- Download Document
- List Envelope Documents

### Recipients

- Get Envelope Recipients

## List of Triggers

- On Envelope Completed
- On Envelope Sent
- On Envelope Declined
- On Envelope Voided

## Agent Ideas

- When DocuSign's "On Envelope Completed" trigger fires, use Google Sheets' "Add Row" to log the signed envelope details into a contract tracking spreadsheet for compliance records
- Use Salesforce Essentials' "Find Record" to retrieve a contact's details, then call DocuSign's "Send Envelope from Template" to send a personalized agreement for signature
- When DocuSign's "On Envelope Declined" trigger fires, use Slack's "Send Message To Channel" to alert the sales team with the envelope subject and decline reason so they can follow up immediately
