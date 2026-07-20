# Facebook Messenger FlowRunner Extension

Interact with the Facebook Messenger Platform via the Meta Graph API. Send text, media, template, and quick-reply messages, drive sender actions, browse conversations and user profiles, and configure a Page's Messenger Profile (greeting, get-started button, persistent menu).

## Ideal Use Cases

- Deliver automated replies, order updates, or notifications to customers who have messaged your Facebook Page
- Send rich interactive messages (button templates, generic-template carousels, quick replies) to guide users through a flow
- Discover conversations and page-scoped user IDs (PSIDs), then look up user profiles for personalization
- Configure a Page's Messenger onboarding experience: greeting text, Get Started button, and persistent menu

## List of Actions

### Sending

- Send Text Message
- Send Media Message
- Send Button Template
- Send Generic Template
- Send Quick Replies
- Send Sender Action

### Conversations

- List Conversations
- Get Conversation Messages

### Users

- Get User Profile

### Messenger Profile

- Get Messenger Profile
- Set Get Started Button
- Set Greeting
- Set Persistent Menu
- Delete Messenger Profile Fields

### Pages

- List My Pages

## List of Triggers

This service does not define any triggers.

## Authentication

OAuth2 against the Meta Graph API (`v21.0`). Configure an **App Client ID** and **App Client Secret** from your Meta app dashboard (Settings > Basic); both are marked shared. The app must have the Messenger product added and request the `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, and `pages_read_engagement` permissions.

The Send API and Messenger Profile calls use a **Page access token** (not the user OAuth token). Every action accepts an optional **Page ID** (backed by the Pages dictionary); the service resolves the matching Page access token via `GET /me/accounts`, defaulting to the first managed Page when Page ID is empty.

## Notes

- **App Review required for public use.** `pages_messaging` needs Meta App Review (Advanced Access) to message users outside your app roles. In Development mode the service works against Pages you own (admins/developers/testers) without review — ideal for building and testing.
- **24-hour messaging window.** Standard `RESPONSE`/`UPDATE` messages are only allowed within 24 hours of the user's last message. Outside that window, send with `messaging_type = MESSAGE_TAG` and an eligible tag (`HUMAN_AGENT`, `ACCOUNT_UPDATE`, `CONFIRMED_EVENT_UPDATE`, `POST_PURCHASE_UPDATE`).
- **Recipients must message the Page first.** You cannot start cold conversations. A recipient's PSID is only available from conversations the user has initiated — use **List Conversations** and **Get Conversation Messages** to discover PSIDs.

## Agent Ideas

- After **Get Conversation Messages** surfaces a customer PSID, call **HubSpot** "Create Contact" to log the lead, then use **Send Text Message** to reply within the 24-hour window
- When **HubSpot** "Get Contact By Email" confirms an existing customer, use **Send Button Template** to offer support options and **Send Quick Replies** to collect a structured response
- Reach a customer on whichever channel they last used by pairing **WhatsApp** "Send Text Message" with **Facebook Messenger** "Send Text Message", personalizing each with data from **Get User Profile**
