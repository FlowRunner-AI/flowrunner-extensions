# Mixpanel FlowRunner Extension

Integrates Mixpanel product analytics across all three data-residency regions (US, EU, India). Ingests events and user/group profiles, manages identity stitching, runs analytics queries (segmentation, funnels, retention, Insights), exports raw event data, and syncs Lexicon data-dictionary schemas. Authentication is split per Mixpanel's model: a Project Token powers ingestion, while a Service Account powers query, import, export, identity merge and Lexicon operations.

## Ideal Use Cases

- Stream product events and user/group profile updates into Mixpanel from your own backend or third-party apps
- Backfill historical events with strict per-record validation via Import Events
- Run scheduled segmentation, funnel, retention and Insights reports and route the results into dashboards or alerts
- Export raw event data for a date range into FlowRunner file storage for warehousing or downstream processing
- Sync an internal tracking plan into Mixpanel's Lexicon data dictionary

## List of Actions

### Event Ingestion
- Track Event
- Import Events

### User Profiles
- Set Profile Properties
- Set Profile Properties Once
- Increment Profile Properties
- Append To Profile List Properties
- Union Profile List Properties
- Remove From Profile List Properties
- Unset Profile Properties
- Delete Profile
- Batch Update Profiles

### Group Profiles
- Set Group Properties
- Set Group Properties Once
- Union Group List Properties
- Remove From Group List Properties
- Unset Group Properties
- Delete Group Profile
- Batch Update Group Profiles

### Identity Management
- Create Alias
- Create Identity
- Merge Identities

### Analytics Queries
- Run Segmentation Query
- Query Event Counts
- Get Today's Top Events
- List Top Event Names
- Query Insights Report

### Funnels & Retention
- Run Funnel Query
- List Saved Funnels
- Run Retention Query

### Profiles & Cohorts
- Query Profiles
- List Cohorts
- Get Activity Stream

### Data Export
- Export Events

### Lexicon
- List Lexicon Schemas
- Get Lexicon Schema
- Upload Lexicon Schemas

## List of Triggers

This service does not define any triggers.

## Configuration

- **Data Residency Region** (required) — US, EU or India. Selects the correct API hosts (api / api-eu / api-in, mixpanel.com / eu.mixpanel.com / in.mixpanel.com, data / data-eu / data-in). Check it in Project Settings → Overview.
- **Project Token** (required) — powers ingestion operations (Track Event, profile/group updates, Create Alias, Create Identity). Found under Project Settings → Overview → Access Keys.
- **Service Account Username** / **Service Account Secret** — required for query, import, export, identity merge and Lexicon operations. Create under Organization Settings → Service Accounts; the secret is shown only once.
- **Project ID** — numeric project ID required together with the Service Account credentials. Found under Project Settings → Overview.

## Notes

- Ingestion vs. Service Account: Track Event and profile/group updates need only the Project Token; Import Events, all Analytics Queries, Funnels & Retention, Profiles & Cohorts, Data Export, Merge Identities and Lexicon operations require Service Account credentials plus Project ID.
- Query API operations are rate limited to 60 queries per hour and 5 concurrent queries.
- Export Events returns events inline (capped at 1,000 rows by default, up to 100,000); enable Save To File to store large JSONL exports via FlowRunner file storage and return a download URL instead.
- Identity operations apply only to Legacy/Original ID Merge projects and have no effect on Simplified ID Merge, where identities are stitched automatically.

## Agent Ideas

- Use **Amplitude** "Get Event Segmentation" to pull product analytics from one platform, then call **Mixpanel** "Import Events" to backfill the same events into Mixpanel for side-by-side comparison
- After **Segment** "Track Event" captures user activity, call **Mixpanel** "Set Profile Properties" to enrich the corresponding Mixpanel user profile with the latest attributes
- Run **Mixpanel** "Run Funnel Query" on a schedule and, when conversion drops, use **Slack** "Send Message To Channel" to alert the growth team with the per-step counts
