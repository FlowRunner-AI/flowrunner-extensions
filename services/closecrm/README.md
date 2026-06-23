# Close CRM FlowRunner Extension

A FlowRunner extension that integrates Close CRM via OAuth2, providing access to leads, contacts, opportunities, activities (notes, calls, emails, SMS, meetings), tasks, sequences, bulk actions, search, webhooks, and account configuration. Dropdown parameters expose friendly plain-string labels (e.g., status types) that map internally to Close API values.

## Ideal Use Cases

- Sync leads, contacts, and opportunities between Close and other systems
- Automate lead status and opportunity pipeline progression
- Log and manage activities: notes, calls, emails, SMS, and meetings
- Create, update, complete, and assign follow-up tasks
- Run Smart Views and advanced searches to segment and enrich records
- Subscribe contacts to email sequences and manage bulk lead actions
- React in real time to CRM changes via webhook-backed triggers

## Configuration

This is an OAuth2 service. It requires three configuration items:

- **Client ID** — Close OAuth2 client ID (shared)
- **Client Secret** — Close OAuth2 client secret (shared)
- **Default Email Account ID** — fallback `email_account_id` used by Send Email when none is supplied (not shared)

Authentication uses the standard OAuth2 authorization code flow; FlowRunner manages connection, callback handling, and automatic token refresh.

## List of Actions

- **Leads**: List Leads, Get Lead, Create Lead, Update Lead, Delete Lead, Merge Leads, Find Lead by Email, Find Lead by Phone
- **Contacts**: List Contacts, Get Contact, Create Contact, Update Contact, Delete Contact
- **Opportunities**: List Opportunities, Get Opportunity, Create Opportunity, Update Opportunity, Delete Opportunity
- **Notes**: List Notes, Create Note, Update Note, Delete Note
- **Calls**: List Calls, Log Call, Update Call, Delete Call
- **Emails**: List Emails, Send Email, Delete Email
- **SMS**: List SMS, Send SMS, Delete SMS
- **Meetings**: List Meetings, Get Meeting
- **Tasks**: List Tasks, Create Task, Update Task, Complete Task, Delete Task
- **Activity Feed**: List Activities
- **Configuration**: List Pipelines, List Lead Statuses, List Opportunity Statuses, List Custom Fields, List Custom Object Types
- **Users**: Get Me, List Users
- **Search**: Run Advanced Search, Run Smart View
- **Sequences**: List Sequences, Subscribe Contact to Sequence, Pause Sequence Subscription, Resume Sequence Subscription
- **Bulk Actions**: Bulk Edit Leads, Bulk Delete Leads, Bulk Email, Get Bulk Action Status
- **Webhooks**: List Webhooks, Create Webhook, Update Webhook, Delete Webhook
- **Audit Log**: List Events
- **Files**: Upload File

## List of Triggers

- On Lead Created, On Lead Updated, On Lead Status Changed, On Lead Deleted, On Lead Merged
- On Opportunity Created, On Opportunity Updated, On Opportunity Status Changed
- On Contact Created, On Contact Updated
- On Task Created, On Task Completed
- On Note Created
- On Call Completed
- On Email Sent, On Email Received
- On SMS Sent, On SMS Received
- On Meeting Completed
- On Custom Activity Created

## Agent Ideas

- When a **Close CRM** "On Lead Status Changed" trigger fires for a won deal, use **Gmail** "Send Message" to send the customer an onboarding email enriched with details from "Get Lead".
- Pull new prospect rows with **Google Sheets** "Get Rows", then call **Close CRM** "Create Lead" for each to bulk-import them, and notify the team with **Slack** "Send Message To Channel".
- When a **Close CRM** "On Opportunity Created" trigger fires, use **Slack** "Send Message To Channel" to alert the sales team and **Google Sheets** "Add Row" to log the opportunity in a pipeline tracker.
