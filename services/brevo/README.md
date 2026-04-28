# Brevo FlowRunner Extension

All-in-one marketing and CRM platform integration for transactional email, SMS messaging, contact management, and sales pipeline operations. Manage contacts, lists, deals, companies, tasks, and notes through a unified API.

## Ideal Use Cases

- Sending transactional emails and template-based notifications for order confirmations and alerts
- Managing contact lists and segmenting audiences for targeted campaigns
- Tracking CRM deals through sales pipelines with stage management
- Sending transactional SMS messages for time-sensitive notifications
- Automating contact creation and updates from external data sources
- Managing CRM tasks and notes for sales team coordination
- Monitoring email and SMS delivery statistics for reporting

## List of Actions

- Add Contacts to List
- Create Company
- Create Contact
- Create Deal
- Create List
- Create Note
- Create Task
- Delete Company
- Delete Contact
- Delete Deal
- Delete Note
- Delete Task
- Get Account Info
- Get Companies
- Get Company
- Get Contact
- Get Contacts
- Get Deal
- Get Deals
- Get Email Statistics
- Get Email Templates
- Get List Contacts
- Get Lists
- Get Note
- Get SMS Statistics
- Get Senders
- Get Task
- Get Tasks
- Get Transactional Emails
- Remove Contacts from List
- Send Template Email
- Send Transactional Email
- Send Transactional SMS
- Update Company
- Update Contact
- Update Deal
- Update Note
- Update Task

## Agent Ideas

- Use **Parseur** "Get Parsed Data" to extract lead details from incoming emails, then call **Brevo** "Create Contact" to add each lead and "Add Contacts to List" to assign them to a nurture list
- When a **Google Sheets** "On New Row" trigger fires with a new order, use **Brevo** "Send Template Email" to send the customer an order confirmation using a pre-built template with dynamic variables
- When a **Slack** "On Block Action" trigger fires from a deal-approval button, use **Brevo** "Update Deal" to advance the deal stage in the CRM pipeline and **Slack** "Update Message In Channel" to confirm the action
