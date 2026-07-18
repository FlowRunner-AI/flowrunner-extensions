# RingCentral FlowRunner Extension

Connect to a RingCentral account via OAuth2 to send SMS and faxes, place RingOut (click-to-call) calls, read the message store and call log (including voicemail audio, fax pages, MMS media, and call recordings saved to FlowRunner file storage), manage personal address book contacts, inspect account extensions and phone numbers, and work with team messaging chats and teams.

> **Production access is gated by RingCentral.** New RingCentral apps start in the Sandbox environment (`platform.devtest.ringcentral.com`) and work immediately with a devtest account. They must graduate through RingCentral's "Apply for Production" review before they can be used against Production (`platform.ringcentral.com`). Select the environment with the `Environment` config item; it drives both the OAuth2 flow and all API calls.

## Ideal Use Cases

- Send SMS confirmations, alerts, or two-way notifications from a business phone number as part of a workflow.
- Fax documents (PDF, TIFF, DOCX, images) stored in FlowRunner file storage to one or more recipients.
- Place click-to-call (RingOut) calls between two numbers and track their status programmatically.
- Archive voicemail audio, fax pages, MMS media, and call recordings into FlowRunner file storage for downstream processing.
- Sync personal address book contacts and audit account extensions, phone numbers, and presence.
- Post to and create team messaging chats and teams for internal collaboration automations.

## Configuration

- **Client Id** / **Client Secret** (shared) — from your RingCentral app at https://developers.ringcentral.com/my-account.html (3-legged OAuth authorization code flow).
- **Environment** — `Production` (default) or `Sandbox`.

## List of Actions

### SMS

- Send SMS

### Messages

- List Messages
- Get Message
- Delete Message
- Get Message Attachment Content

### Fax

- Send Fax

### RingOut

- Make RingOut Call
- Get RingOut Status
- Cancel RingOut

### Call Log

- List Call Log Records
- Get Call Log Record
- List Account Call Log
- Get Call Recording Content

### Contacts

- List Contacts
- Get Contact
- Create Contact
- Update Contact
- Delete Contact

### Account

- Get Account Info
- List Extensions
- Get Extension
- Get Current Extension
- List Phone Numbers
- Get Presence

### Team Messaging

- List Chats
- List Teams
- Get Chat
- Post Message to Chat
- List Chat Posts
- Create Team

## List of Triggers

This service does not define any triggers.

## Agent Ideas

- When a **HubSpot** "Search Contacts" call finds a lead due for follow-up, use **RingCentral** "Send SMS" to text the contact and "Make RingOut Call" to connect a sales rep, then record the outcome with **HubSpot** "Update Contact".
- Use **RingCentral** "List Call Log Records" to pull the day's calls, download each recording with "Get Call Recording Content", and append the call details to a spreadsheet via **Google Sheets** "Add Row".
- After a **Google Calendar** "List Events" call surfaces upcoming appointments, use **RingCentral** "Send SMS" to send reminder texts to attendees and "Send Fax" to deliver any required paperwork from FlowRunner file storage.
