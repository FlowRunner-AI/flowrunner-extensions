# Zoho Desk FlowRunner Extension

Zoho Desk integration for automating help desk operations: create, update, search, assign, and close tickets; manage ticket comments and email conversation threads (including sending replies); and maintain the contacts, accounts, agents, and departments behind them. Connects via Zoho OAuth2 with region-aware data centers and automatic organization resolution.

## Configuration

- **Client ID** / **Client Secret** — from the Zoho API Console (api-console.zoho.com)
- **Region** — your Zoho data center: com (US), eu, in, com.au, jp, ca, sa
- **Organization ID** — optional; leave empty to auto-use your first Zoho Desk organization

## List of Actions

### Organizations

- List Organizations

### Tickets

- Assign Ticket
- Close Ticket
- Create Ticket
- Get Ticket
- List Tickets
- Move Tickets to Trash
- Search Tickets
- Update Ticket

### Ticket Comments

- Add Ticket Comment
- List Ticket Comments
- Update Ticket Comment

### Ticket Threads

- Get Ticket Thread
- List Ticket Threads
- Send Ticket Reply

### Contacts

- Create Contact
- Get Contact
- List Contact Tickets
- List Contacts
- Update Contact

### Accounts

- Create Account
- Get Account
- List Accounts
- Update Account

### Agents

- Get Agent
- Get Current Agent
- List Agents

### Departments

- Get Department
- List Departments

### Search

- Global Search

## Notes

- Sending a ticket reply requires the **From Address** to be a support email address configured for the ticket's department in Zoho Desk.
- When creating a ticket with only a **Requester Email** (no contact selected), Zoho Desk reuses the contact with that email or auto-creates a new one.
- Moving tickets to trash places them in the Recycle Bin, where an administrator can restore them before permanent purge.

## Agent Ideas

- Use **Zoho Desk** "Search Tickets" to pull open high-priority tickets, then post a digest to a support channel with **Slack** "Send Message To Channel" so the team can triage quickly.
- When a **Zoho Desk** "Get Contact" reveals a customer without a CRM record, call **Zoho CRM** "Create Record" to add them as a lead and keep support and sales data in sync.
- Escalate a bug reported through **Zoho Desk** "Get Ticket" by creating a tracked engineering task with **Jira Issues** "Create Issue" (or **Linear** "Create Issue"), then use **Zoho Desk** "Add Ticket Comment" to note the linked issue.
