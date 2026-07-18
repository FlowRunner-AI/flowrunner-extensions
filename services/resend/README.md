# Resend FlowRunner Extension

Send and manage transactional and marketing email through the [Resend](https://resend.com) API. Supports rich single sends (CC/BCC, reply-to, custom headers, tags, natural-language scheduling, plus FlowRunner-file and remote-URL attachments), independent batch sends, and full management of sending domains with DNS verification, API keys, audiences, contacts, and broadcasts. Authenticates with a Resend API key.

## Ideal Use Cases

- Send transactional emails (receipts, password resets, alerts) from an automated flow, optionally scheduled for later delivery
- Attach a FlowRunner-generated file or a remote document to an outgoing email
- Fan out up to 100 independent emails in one call with Send Batch Emails
- Register and verify a sending domain, then manage its tracking and TLS settings
- Build and maintain audiences and contacts, then create and send broadcasts (marketing campaigns) with personalization and unsubscribe links
- Provision and revoke scoped API keys for downstream systems

## List of Actions

### Emails
- Send Email
- Get Email
- Update Email
- Cancel Scheduled Email
- Send Batch Emails

### Domains
- Create Domain
- List Domains
- Get Domain
- Verify Domain
- Update Domain
- Delete Domain

### API Keys
- Create API Key
- List API Keys
- Delete API Key

### Audiences
- Create Audience
- List Audiences
- Get Audience
- Delete Audience

### Contacts
- Create Contact
- List Contacts
- Get Contact
- Update Contact
- Delete Contact

### Broadcasts
- Create Broadcast
- List Broadcasts
- Get Broadcast
- Update Broadcast
- Send Broadcast
- Delete Broadcast

## List of Triggers

This service does not define any triggers.

## Notes

- **Scheduling**: Send Email, Update Email, and Send Broadcast accept natural language (e.g. `in 1 hour`) or an ISO 8601 timestamp. Emails with attachments cannot be scheduled.
- **Attachments**: Send Email supports one FlowRunner file (bytes are base64-encoded and embedded) and remote files by public URL, up to 40 MB total per email. Batch sends do not support attachments, tags, or scheduling.
- **API key scopes**: Domains, audiences, contacts, and broadcasts require a Full Access key; Sending Access keys can only send email.
- Broadcast HTML supports personalization variables like `{{{FIRST_NAME|there}}}` and requires the `{{{RESEND_UNSUBSCRIBE_URL}}}` link.

## Agent Ideas

- When an **Airtable** "On New Record" trigger fires for a new sign-up, use **Resend** "Send Email" to deliver a personalized welcome message, then "Create Contact" to add the person to a Resend audience for future broadcasts.
- Use **Google Sheets** "Get Rows" to pull a subscriber list, loop **Resend** "Create Contact" to add each into an audience, then "Create Broadcast" and "Send Broadcast" to run a campaign against it.
- Use **Typeform** "Get Form Responses" to collect survey submissions, then use **Resend** "Send Batch Emails" to send each respondent a tailored follow-up in a single call.
