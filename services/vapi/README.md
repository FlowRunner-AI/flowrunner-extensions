# Vapi FlowRunner Extension

Vapi is a voice AI platform for building and running phone-call agents. This extension manages the full Vapi lifecycle — placing and analyzing calls, configuring assistants, tools, and squads, provisioning phone numbers, running text chats and sessions, uploading knowledge files, and driving outbound campaigns and analytics. Authenticates with a Vapi private API key.

## Ideal Use Cases

- Place outbound AI phone calls (single or fan-out) and later collect the transcript, recording, and structured analysis
- Build and maintain saved voice assistants with custom models, voices, transcribers, tools, and webhooks
- Provision or import phone numbers and route inbound calls to an assistant, squad, or workflow
- Run multi-assistant squads that hand live calls off between triage, billing, and support
- Talk to the same assistant over text via chats and persistent sessions
- Launch outbound calling campaigns at scale and track per-status progress
- Aggregate call cost, count, and duration analytics for reporting

## List of Actions

### Calls
- Create Call, List Calls, Get Call, Update Call, Delete Call, Get Call Recording, Get Call Logs

### Assistants
- Create Assistant, List Assistants, Get Assistant, Update Assistant, Delete Assistant

### Phone Numbers
- Create Phone Number, List Phone Numbers, Get Phone Number, Update Phone Number, Delete Phone Number

### Tools
- Create Tool, List Tools, Get Tool, Update Tool, Delete Tool

### Squads
- Create Squad, List Squads, Get Squad, Update Squad, Delete Squad

### Chat
- Create Chat, List Chats, Get Chat, Delete Chat

### Sessions
- Create Session, List Sessions, Get Session, Update Session, Delete Session

### Files
- Upload File, List Files, Get File, Rename File, Delete File

### Campaigns
- Create Campaign, List Campaigns, Get Campaign, Update Campaign, Delete Campaign

### Analytics
- Run Analytics Query

## List of Triggers

This service does not define any triggers.

## Authentication

Authenticate with a Vapi **private** API key from the Vapi Dashboard (Organization Settings → API Keys), provided as the service's API Key configuration item and sent as a Bearer token.

## Notes

- Get Call Recording downloads the recording (stereo, mono, per-channel, video, or packet capture) into FlowRunner file storage and returns the stored file URL. Recordings and logs are only available after a call has ended.
- Upload File accepts a FlowRunner file or any accessible URL and pushes it to Vapi for use in knowledge bases and Query tools.
- Assistant, phone number, squad, tool, and campaign parameters are backed by dictionaries that let you pick existing resources by name.

## Agent Ideas

- After a **Vapi** "Get Call" returns a completed call's analysis, use **HubSpot** "Update Deal" to log the summary and success evaluation onto the associated deal
- When a **Google Sheets** "On New Row" trigger fires with a lead list, call **Vapi** "Create Call" to dial each customer with your assistant and record the outcome
- After a **Vapi** "Get Call" retrieves a call transcript and summary, use **Slack** "Send Message To Channel" to post the recap and recording link to the sales team
