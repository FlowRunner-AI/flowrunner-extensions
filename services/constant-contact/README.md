# Constant Contact FlowRunner Extension

Manage Constant Contact email marketing directly from FlowRunner: create and upsert contacts, organize them into lists, tags, custom fields, and segments, and build, schedule, test, and report on email campaigns. Connects via OAuth2 (with automatically rotating refresh tokens); requires a Client Id and Client Secret from the Constant Contact developer portal.

## Ideal Use Cases

- Sync new subscribers from forms, spreadsheets, or your app into Constant Contact and add them to the right lists (upsert by email)
- Keep contact profiles, custom fields, and tags up to date from external systems of record
- Programmatically build a custom-HTML email campaign, set recipients, send a test, and schedule the send
- Bulk add or remove hundreds of contacts across many lists as background activities and monitor completion
- Pull campaign performance reports (sends, opens, clicks, bounces, opt-outs) into dashboards or downstream automations

## List of Actions

### Account
- Get Account Summary

### Contacts
- List Contacts
- Get Contact
- Create Contact
- Update Contact
- Delete Contact
- Create or Update Contact

### Contact Lists
- List Contact Lists
- Get Contact List
- Create Contact List
- Update Contact List
- Delete Contact List
- Add Contacts to Lists
- Remove Contacts from Lists
- Get Activity Status

### Custom Fields
- List Custom Fields
- Create Custom Field
- Delete Custom Field

### Tags
- List Tags
- Create Tag
- Delete Tag

### Segments
- List Segments
- Get Segment
- Create Segment
- Update Segment Name
- Delete Segment

### Email Campaigns
- List Campaigns
- Get Campaign
- Create Campaign
- Update Campaign Name
- Delete Campaign

### Campaign Activities
- Get Campaign Activity
- Update Campaign Activity
- Send Test Email
- Schedule Campaign
- Get Campaign Schedules
- Unschedule Campaign

### Reporting
- Get Campaign Summary Reports
- Get Campaign Activity Stats

## List of Triggers

This service does not define any triggers.

## Notes

- Authentication is OAuth2. Provide the Client Id and Client Secret from the Constant Contact developer portal; access tokens are refreshed automatically and refresh tokens rotate on each use.
- Add Contacts to Lists, Remove Contacts from Lists, Delete Contact List, and Delete Tag run as asynchronous background activities — monitor them with **Get Activity Status** until the state is `completed`.
- Campaigns use custom-code HTML (include the `[[trackingImage]]` token and an unsubscribe link, and use a verified from address). Set recipients with **Update Campaign Activity** before calling **Schedule Campaign**, and use the `primary_email` activity id from **Get Campaign** for all Campaign Activities actions.

## Agent Ideas

- Use **Typeform** "Get Form Responses" to collect new sign-ups, then call **Constant Contact** "Create or Update Contact" to upsert each respondent by email and add them to a subscriber list
- Use **Google Sheets** "Get Rows" to read a mailing list, upsert each row with **Constant Contact** "Create or Update Contact", then "Create Campaign" and "Schedule Campaign" to launch the email
- After **Constant Contact** "Get Campaign Summary Reports" returns opens and clicks, use **Gmail** "Send Message" to email a performance digest to the marketing team
