# Gmail FlowRunner Extension

Full Gmail integration via OAuth2 for sending, drafting, labeling, and monitoring emails. Includes real-time and polling triggers for new emails, threads, labels, and attachments — and supports saving email attachments directly to FlowRunner file storage.

## Ideal Use Cases

- Automating email responses and draft creation based on incoming messages
- Monitoring a Gmail inbox for new emails matching specific criteria and triggering downstream flows
- Saving email attachments to file storage and passing the URL to document processing services
- Managing labels programmatically to organize and route incoming mail
- Sending transactional or notification emails from within a flow

## List of Actions

- Add Label To Message
- Create Draft
- Create Label
- Delete Draft
- Delete Messages
- Get Attachment
- Get Attachments
- Get Drafts List
- Get Labels
- Get Message
- Get Message Labels
- Get Messages List
- Get Threads
- Mark Message as Read
- Mark Message as Unread
- Remove Label From Message
- Save Attachment
- Send Draft
- Send Message

## List of Triggers

- On Email Starred
- On New Attachment
- On New Email
- On New Label
- On New Thread

## Agent Ideas

- When a **Gmail** "On New Attachment" trigger fires, use "Save Attachment" to store the file and pass the URL to **TurboDocx** "Generate Document" for automated document processing
- Use **Gmail** "On New Email" to detect incoming support requests, extract key details, and create a **Jira Issues** ticket automatically with the email body as description
- When a **Gmail** "On New Thread" trigger fires, use "Get Message" to read the content and **Brevo** "Create Contact" to capture the sender's details in the CRM