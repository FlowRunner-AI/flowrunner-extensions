# Amplitude FlowRunner Extension

Integrates [Amplitude](https://amplitude.com) product analytics with FlowRunner: ingest events and identify users, run dashboard analytics (segmentation, funnels, retention, revenue LTV), manage behavioral cohorts with asynchronous member downloads, maintain tracking-plan taxonomy, look up user profiles and activity, manage chart annotations, schedule GDPR/CCPA privacy deletions and export raw event data to file storage. Supports US and EU data-residency regions.

## Ideal Use Cases

- Send server-side events and update user/group properties from automated workflows
- Query product metrics (segmentation, funnels, retention, revenue LTV, active users) for reporting
- Sync static cohorts from external lists and export cohort members asynchronously
- Keep the tracking-plan taxonomy (event categories, types, properties, user properties) in sync
- Look up user profiles/activity and mark releases or campaigns with chart annotations
- Fulfil right-to-be-forgotten requests via scheduled deletion jobs and back up raw events to file storage

## List of Actions

- **Event Ingestion**: Track Event, Track Multiple Events, Batch Upload Events, Identify User, Group Identify
- **Analytics**: List Events, Get Event Segmentation, Get Funnel Analysis, Get Retention Analysis, Get Realtime Active Users, Get Average Session Length, Get Average Sessions Per User, Get Session Length Distribution, Get Revenue LTV
- **Users**: Search Users, Get User Activity, Get User Profile
- **Chart Annotations**: List / Get / Create / Update / Delete Chart Annotation
- **Cohorts**: List Cohorts, Request Cohort Download, Get Cohort Download Status, Download Cohort, Get Cohort Download Usage, Upload Cohort, Update Cohort Membership
- **Taxonomy**: List / Create / Update / Delete Event Category, Event Type, Event Property and User Property
- **Privacy**: Create User Deletion Job, List User Deletion Jobs, Remove User From Deletion Job
- **Export**: Export Raw Events

## List of Triggers

This service does not define any triggers.

## Configuration

| Item | Description |
| --- | --- |
| API Key | Project API key (Settings → Projects → your project → General). Sent in the request body for event ingestion and used as the Basic-auth username for analytics APIs. |
| Secret Key | Project secret key. Combined with the API key for Basic auth on Dashboard REST, Cohorts, Taxonomy, Export and Deletion APIs; also used alone (`Api-Key` header) for the User Profile API. |
| Region | `US` (default) or `EU`. EU projects use `api.eu.amplitude.com` (ingestion) and `analytics.eu.amplitude.com` (analytics). |

## Authentication

Auth differs by action group:

- **Event Ingestion** (Track Event, Track Multiple Events, Batch Upload Events, Identify User, Group Identify): the project **API key is sent in the request body** — no auth header.
- **Analytics / Cohorts / Taxonomy / Chart Annotations / Privacy / Export**: HTTP **Basic auth** with `api_key:secret_key`.
- **Get User Profile**: `Authorization: Api-Key <secret key>` against `profile-api.amplitude.com`. This API is **US-only and not available for EU-region projects**.

## Notes

- **Export Raw Events** stores the ZIP archive returned by the Export API (gzipped JSON files, one event per line) in FlowRunner file storage and returns the file URL and size. The archive is **not unpacked** by the service. Export size is limited to 4 GB per request.
- Cohort downloads are asynchronous: **Request Cohort Download → Get Cohort Download Status → Download Cohort**. Downloads count against a monthly quota (check with **Get Cohort Download Usage**).
- **Create User Deletion Job** schedules irreversible GDPR/CCPA data deletion. Users can be removed from a job (**Remove User From Deletion Job**) only until 3 days before its execution day.
- Taxonomy create operations require the Amplitude Govern (Taxonomy) add-on.

## Agent Ideas

- Use **Segment** "Track Event" to capture activity across sources, then call Amplitude "Track Event" (or "Batch Upload Events") to backfill matching events into Amplitude for cross-tool analysis
- Run Amplitude "Get Funnel Analysis" or "Get Retention Analysis" on a schedule and pipe the metrics into **Google Sheets** "Add Row" to maintain a running analytics dashboard
- When a churn-risk cohort is identified, use Amplitude "Upload Cohort" to define it, then post the cohort size and definition to a channel with **Slack** "Send Message To Channel" to alert the growth team
