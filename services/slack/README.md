# Slack FlowRunner Extension

Enables seamless interaction with the Slack API for automating workspace activities. Includes real-time and polling triggers, rich messaging with Block Kit support, interactive buttons, and channel management actions. Supports OAuth2 connection and handles multiple workspaces.

## Ideal Use Cases

- Monitor Slack channels for specific messages, reactions, or button clicks.
- Build interactive approval flows with Block Kit buttons and update messages after user action.
- Trigger workflows when users join, interact in channels, or click interactive elements.
- Automate message delivery to channels or users with rich layouts (buttons, menus, images).
- Manage channels and members dynamically.
- Query and retrieve Slack data like messages and files.

## List of Actions

- Create Private Channel
- Create Public Channel
- Delete Message In Channel
- Find Channel
- Find Member
- Find Members
- Get File Info
- Get Latest Channel Messages
- Get Latest Thread Messages
- Get Message
- Invite User To Channel
- Kick User From Channel
- Search Messages
- Send Direct Message
- Send Message To Channel
- Update Message In Channel

## List of Triggers

- On Block Action
- On Channel Created
- On Channel Message
- On File Shared
- On Mention
- On Message from Query
- On New Member
- On Reaction Added

## Agent Ideas

- When a **Slack** "On Block Action" trigger fires from an approval button click, use **Jira Issues** "Transition Issue" to move the corresponding ticket to "Approved" status, then use **Slack** "Update Message In Channel" to replace the buttons with a confirmation message.
- When a **Google Sheets** "On New Row" trigger fires with a new lead, use **Slack** "Send Message To Channel" with Block Kit buttons to notify the sales team and let them claim the lead via "On Block Action".
- When a **HubSpot** "Create Deal" action completes, use **Slack** "Send Direct Message" to notify the assigned sales rep with deal details.
