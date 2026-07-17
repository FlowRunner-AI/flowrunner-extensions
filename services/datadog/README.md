# Datadog FlowRunner Extension

Automate the [Datadog](https://www.datadoghq.com/) monitoring and observability platform: post and search events, submit and query metrics, ship and search logs, and manage monitors, downtimes, incidents, dashboards, SLOs, hosts, users, Synthetics, and notebooks. Authenticates with a Datadog API key plus application key and works across all six Datadog sites (US1/US3/US5, EU, AP1, and US1-FED).

## Ideal Use Cases

- Push deployment or release markers into the event stream and correlate them with metric and log spikes
- Submit custom business metrics and query timeseries to drive alerting and reporting workflows
- Ship application logs to the log intake and search indexed logs for errors during incident triage
- Programmatically create, mute, and search monitors and schedule downtimes around planned maintenance
- Declare and update incidents, sync host tags, and gate deployments on Synthetic CI test runs

## List of Actions

### Events
- Post Event, List Events, Search Events

### Metrics
- Submit Metric, Query Timeseries, List Metrics, Get Metric Metadata, Update Metric Metadata

### Logs
- Send Log, Search Logs

### Monitors
- Create Monitor, List Monitors, Get Monitor, Update Monitor, Delete Monitor, Mute Monitor, Unmute Monitor, Search Monitors

### Downtimes
- Create Downtime, List Downtimes, Get Downtime, Cancel Downtime

### Incidents
- Create Incident, List Incidents, Get Incident, Update Incident, Delete Incident

### Dashboards
- Create Dashboard, List Dashboards, Get Dashboard, Delete Dashboard

### SLOs
- Create SLO, List SLOs, Get SLO, Update SLO, Delete SLO, Get SLO History

### Hosts
- List Hosts, Get Host Totals, Mute Host, Unmute Host

### Host Tags
- List All Host Tags, Get Host Tags, Add Host Tags, Update Host Tags, Remove Host Tags

### Users
- List Users, Get User, Create User, Disable User

### Synthetics
- List Synthetics Tests, Get Synthetics Test, Trigger Synthetics CI Tests, Get Synthetics Test Results

### Service Checks
- Submit Service Check

### Notebooks
- List Notebooks, Get Notebook

### Account
- Validate API Key

## List of Triggers

This service does not define any triggers.

## Configuration

- **API Key** — Datadog API key, sent as the `DD-API-KEY` header (Organization Settings > API Keys).
- **Application Key** — Datadog application key, sent as the `DD-APPLICATION-KEY` header (Organization Settings > Application Keys).
- **Site** — Your Datadog site, the domain you log in at without `app.` (e.g. `datadoghq.com`, `us3.datadoghq.com`, `us5.datadoghq.com`, `datadoghq.eu`, `ap1.datadoghq.com`, `ddog-gov.com`). Determines the API host `https://api.{site}`; log intake uses the separate host `https://http-intake.logs.{site}`.

## Notes

- **Incidents** require Incident Management to be enabled for your organization; the underlying API is in preview. The Create/List/Get/Update/Delete Incident actions will fail if the feature is not enabled.
- The Monitors, Dashboards, and SLOs actions expose dictionary pickers so IDs can be selected by name in the FlowRunner UI.

## Agent Ideas

- When a **Datadog** "Search Monitors" run surfaces monitors in the alert state, use **PagerDuty** "Create Incident" to page the on-call responder with the failing monitor details.
- After a **Datadog** "Create Incident" fires, use **Slack** "Send Message To Channel" to broadcast the incident title and severity to the team's incident channel for coordination.
- When a **Sentry** "Get Issue" reveals a spike in a production error, use **Datadog** "Search Logs" to pull the correlated backend log lines and **Datadog** "Post Event" to mark the investigation on the event stream.
