# ManyChat FlowRunner Extension

Chat marketing automation across Facebook Messenger, Instagram, WhatsApp, Telegram, and SMS. Manage subscribers, tags, custom and bot fields, and send content or existing flows to subscribers on any connected channel. Authenticate with a ManyChat API key (a ManyChat Pro account is required), sent as `Authorization: Bearer <token>`.

## Ideal Use Cases

- Sync subscribers and their custom field values with your CRM, e-commerce store, or spreadsheets
- Tag and segment subscribers automatically based on events elsewhere in your stack
- Send transactional or promotional messages and trigger existing ManyChat flows from your own workflows
- Look up subscriber profiles by name, email, phone, or custom field to enrich or route conversations
- Maintain global bot fields to drive dynamic content and business logic across all subscribers

## List of Actions

### Subscribers

- Create Subscriber
- Find Subscriber by System Field
- Find Subscribers by Custom Field
- Find Subscribers by Name
- Get Subscriber
- Update Subscriber

### Tagging

- Add Tag to Subscriber
- Add Tag to Subscriber by Name
- Create Tag
- Delete Tag
- Delete Tag by Name
- List Tags
- Remove Tag from Subscriber
- Remove Tag from Subscriber by Name

### Custom Fields

- Create Custom Field
- List Custom Fields
- Set Custom Field
- Set Custom Field by Name

### Bot Fields

- Create Bot Field
- List Bot Fields
- Set Bot Field
- Set Bot Field by Name

### Sending

- Send Content
- Send Content by User Ref
- Send Flow

### Page

- Get Page Info
- List Flows
- List Growth Tools
- List OTN Topics

## List of Triggers

This service does not define any triggers.

## Notes

- **Channel namespace**: ManyChat API endpoints live under the `/fb` namespace for historical reasons, but they serve subscribers on **all** connected channels (Instagram, WhatsApp, Telegram, and SMS included), not just Facebook Messenger. "Page" actions and Get Page Info likewise reflect the whole ManyChat account regardless of channel.
- **Messaging windows**: Facebook Messenger enforces a 24-hour messaging window; sending outside it requires a Message Tag (Account Update, Confirmed Event Update, Post-Purchase Update, Human Agent) or an opted-in One-Time Notification (OTN) topic. WhatsApp requires pre-approved template messages outside its 24-hour service window.
- **Subscriber creation**: Only phone-based channels (WhatsApp and SMS) support Create Subscriber. Messenger and Instagram subscribers must opt in through the channel itself.
- **Dictionaries**: Dynamic pickers are provided for tags, flows, custom fields, and bot fields to populate the corresponding parameters in the actions above.

## Agent Ideas

- When a **Shopify** "On New Order" trigger fires, use ManyChat "Find Subscriber by System Field" to locate the buyer by email, then "Send Content" with a Post-Purchase Update message tag to confirm the order.
- Use ManyChat "Find Subscribers by Custom Field" to pull qualified leads, then call **HubSpot** "Create Contact" to push each one into your CRM for sales follow-up.
- After a **Shopify** "On New Customer" trigger fires, use ManyChat "Add Tag to Subscriber by Name" to tag the subscriber and **Google Sheets** "Add Row" to log the new customer to a shared tracking sheet.
