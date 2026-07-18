# Klaviyo FlowRunner Extension

Klaviyo email and SMS marketing automation for FlowRunner: manage profiles, subscriptions, lists, segments, events, metrics with aggregate analytics, campaigns, templates, flows, tags, and GDPR/CCPA data privacy requests.

## Ideal Use Cases

- Sync contacts from a CRM, store, or spreadsheet into Klaviyo with upsert (Create or Update Profile) and manage list membership or marketing consent
- Track custom events (orders, product views, sign-ups) to power flows, segments, and analytics
- Build reports and dashboards from time-bucketed metric aggregates (event count, revenue, unique profiles)
- Trigger and inspect email/SMS campaigns and automation flows, and render personalized templates
- Handle unsubscribes, suppressions, and irreversible data privacy deletion requests for compliance

## List of Actions

### Profiles
- List Profiles, Get Profile, Get Profile by Email, Create Profile, Update Profile, Create or Update Profile, Suppress Profiles, Unsuppress Profiles

### Subscriptions
- Subscribe Profiles, Unsubscribe Profiles

### Lists
- List Lists, Get List, Create List, Update List, Delete List, Add Profiles to List, Remove Profiles from List, Get List Profiles

### Segments
- List Segments, Get Segment, Get Segment Profiles

### Events
- Create Event, List Events, Get Event

### Metrics
- List Metrics, Get Metric, Query Metric Aggregates

### Campaigns
- List Campaigns, Get Campaign, Delete Campaign, Send Campaign, Get Campaign Recipient Estimation

### Templates
- List Templates, Get Template, Create Template, Render Template

### Flows
- List Flows, Get Flow, Update Flow Status

### Tags
- List Tags, Create Tag, Delete Tag

### Data Privacy
- Request Profile Deletion

## List of Triggers

This service does not define any triggers.

## Authentication

- API-key service. Config item `apiKey` (`shared: false`): a Klaviyo **private** API key (`pk_...`) from Klaviyo → Settings → API keys (full-access or scoped).
- Every request sends `Authorization: Klaviyo-API-Key <key>`, a pinned `revision: 2026-01-15` header, and `Content-Type: application/json` against `https://a.klaviyo.com/api/`.

## API Revision Note

The service pins `revision: 2026-01-15`. Verified against developers.klaviyo.com at build time (2026-07):

- Latest stable revision was `2026-07-15`, but its changelog includes breaking changes outside the endpoint groups used here that were not individually verified.
- The changelog confirms **no breaking changes** between `2025-04-15` (the spec baseline) and `2026-01-15` for any endpoint group this service uses (profiles, profile-import, subscription/suppression bulk jobs, lists, segments, events, metrics, metric-aggregates, campaigns, campaign-send-jobs, templates, template-render, flows, tags, data-privacy-deletion-jobs).
- `2026-01-15` is guaranteed supported until at least one year after the subsequent revision (≥ 2027-04-15). Bump the `API_REVISION` constant in `src/index.js` after verifying newer revisions.

## Notes

- Klaviyo uses JSON:API. List responses are unwrapped to `{ items, nextCursor }` (the cursor is parsed from `links.next`'s `page[cursor]`); single resources are returned as-is (`{ data: {...} }`).
- List operations expose a raw `filter` param (Klaviyo filter syntax, e.g. `equals(email,"a@b.com")`) alongside convenience params (email, metric, profile, channel, name, start/end dates) that build filter strings in code.
- Subscribe/Unsubscribe/Suppress, Create Event, and Request Profile Deletion are processed asynchronously by Klaviyo. Phone numbers must be in E.164 format (e.g. `+15005550006`).
- Dictionaries back the list, segment, metric, campaign, template, flow, and tag picker parameters (campaigns default to the Email channel).

## Agent Ideas

- When a **Shopify** "On New Order" trigger fires, call **Klaviyo** "Create Event" (Placed Order) and "Create or Update Profile" to feed the customer into Klaviyo flows and revenue analytics
- Use **Google Sheets** "Get Rows" to read a contact export, then call **Klaviyo** "Create or Update Profile" and "Subscribe Profiles" to sync each contact into a Klaviyo list with SUBSCRIBED consent
- After a **Klaviyo** "Query Metric Aggregates" run, use **Gmail** "Send Message" to email the weekly revenue-and-engagement report to stakeholders
