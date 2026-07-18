# Salesloft FlowRunner Extension

Connect FlowRunner to the Salesloft sales engagement platform (API v2). Manage people and accounts, enroll prospects in cadences, create and complete tasks, log calls, record notes, and read email and meeting activity — all through the Salesloft REST API over OAuth2.

## Ideal Use Cases

- Sync new leads from a form, CRM, or spreadsheet into Salesloft as people and enroll them in the right cadence
- Automatically create and assign follow-up tasks for reps, then mark general tasks complete when handled elsewhere
- Log completed calls (sentiment, disposition, duration) against people to keep cadence steps and activity history in sync
- Attach notes to people or accounts from external systems so reps see full context on the record
- Pull email and meeting engagement data into reporting spreadsheets or dashboards

## List of Actions

### People

- Create Person, Delete Person, Get Person, List People, Update Person

### Accounts

- Create Account, Delete Account, Get Account, List Accounts, Update Account

### Cadences

- Add Person to Cadence, Get Cadence, Get Cadence Membership, List Cadence Memberships, List Cadences, Remove Person from Cadence

### Tasks

- Complete Task, Create Task, Delete Task, Get Task, List Tasks, Update Task

### Notes

- Create Note, Delete Note, Get Note, List Notes, Update Note

### Activities

- Get Call, Get Email, List Calls, List Emails, Log a Call

### Meetings

- List Meetings

### Users

- Get Current User, Get User, List Users

### Reference Data

- List Account Stages, List Account Tiers, List Custom Fields, List Person Stages, List Tags

## List of Triggers

This service does not define any triggers.

## Authentication

Salesloft uses OAuth2 (no scopes). Register an OAuth application at https://accounts.salesloft.com/oauth/applications and provide its Application Id (**Client Id**) and Secret (**Client Secret**) in the service configuration, then connect an account.

## Notes

- Salesloft only allows `general` tasks to be completed through the API. Call and email tasks are completed by logging the call (**Log a Call**) or sending the email in Salesloft.
- Custom field and tag values reference names configured for your team; use **List Custom Fields** and **List Tags** to look up valid keys before setting them on people and accounts.

## Agent Ideas

- Use **HubSpot** "Get Contact By Email" (or "Create Contact") to source a lead, then call **Salesloft** "Create Person" and "Add Person to Cadence" to enroll the prospect in an outreach sequence
- When a **Google Calendar** "Create Event" books a discovery call, use **Salesloft** "Create Task" to schedule the rep's prep to-do and "Create Note" to attach agenda context to the person's record
- After a call is handled, use **Salesloft** "Log a Call" to record its disposition and notes, then use **Gmail** "Send Message" to send the prospect a templated follow-up email
