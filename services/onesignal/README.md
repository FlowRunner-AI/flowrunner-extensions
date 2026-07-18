# OneSignal FlowRunner Extension

Send push notifications, email, and SMS through the [OneSignal](https://onesignal.com) messaging platform, and manage the audience behind them: users (current User Model API), channel subscriptions, segments, and templates. Authenticates with your OneSignal App ID and REST API key. Also exposes message delivery statistics, message history CSV exports, and app-level outcome analytics.

## Ideal Use Cases

- Trigger transactional or marketing push notifications, emails, and SMS from any FlowRunner workflow, targeting users by segment, external ID, or advanced filters.
- Schedule and later cancel time-sensitive campaigns using Send After and delivery optimization.
- Keep your OneSignal audience in sync with a CRM or database by creating and updating users, aliases, and channel subscriptions.
- Send branded, dashboard-designed campaigns via reusable push templates.
- Report on delivery outcomes and conversion analytics for sent messages.

## List of Actions

### Messages

- Send Push Notification
- Send Email
- Send SMS
- Send Push with Template
- List Messages
- Get Message
- Cancel Scheduled Message
- Get Message History

### Segments

- List Segments
- Create Segment
- Delete Segment

### Users

- Create User
- Get User
- Update User
- Delete User
- Create Alias
- Delete Alias

### Subscriptions

- Create Subscription
- Update Subscription
- Delete Subscription

### Templates

- List Templates
- Get Template

### App

- View App Details
- View Outcomes

## List of Triggers

This service does not define any triggers.

## Configuration

| Setting | Required | Description |
| ------- | -------- | ----------- |
| App ID | Yes | Your OneSignal App ID (UUID), from OneSignal under Settings > Keys & IDs. |
| REST API Key | Yes | The app REST API key from the same page (the app REST API key, not the User Auth Key); sent as `Authorization: Key <key>`. |

## Notes

- The App ID is injected automatically into every call; actions never ask for it.
- Send actions choose targeting in this order: External IDs (`include_aliases.external_id`) > Filters (push only) > Segments, defaulting to `["Subscribed Users"]`.
- **Get Message History** is asynchronous: OneSignal emails a CSV download link to the provided address and requires a paid plan feature.
- **View App Details**: OneSignal restricts parts of this endpoint to the Organization API key; a 403 from the REST key is surfaced as-is.
- Message retention differs by source: API-sent messages are kept for 30 days, dashboard-sent messages for the app's lifetime.

## Agent Ideas

- When a **HubSpot** "Get Contact By ID" returns a lead, call **OneSignal** "Create User" to register them with an external_id and email subscription, then use "Send Email" to deliver a personalized onboarding message.
- Use **Airtable** "Find Many Records" to pull a list of high-value customers, then call **OneSignal** "Update User" to tag each one before running "Send Push Notification" with a tag-based filter for a targeted campaign.
- Read a spreadsheet of scheduled announcements with **Google Sheets** "Get Rows", then call **OneSignal** "Send Push with Template" for each row with a Send After time to queue campaigns in advance.
