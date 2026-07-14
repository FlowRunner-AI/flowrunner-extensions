# UpLead FlowRunner Extension

Access UpLead's B2B contact and company database from FlowRunner. Enrich people and companies, search for contacts at a target company, and check your remaining API credits.

## Ideal Use Cases

- Enrich an inbound lead's work email into a full contact profile (title, verified email, phone, LinkedIn, company) before routing it to sales.
- Build prospect lists by searching all contacts at a target company, filtered by job function, seniority, title, and location.
- Enrich a company by domain to pull firmographics (employees, revenue, industry, SIC/NAICS, socials) for account scoring or CRM sync.
- Turn a bare email into both the person and their company record in a single call for fast form-fill or CRM auto-population.
- Monitor remaining API credits and validate the connection before running batch enrichment jobs.

## List of Actions

### Enrichment
- Enrich Person
- Enrich Company
- Enrich Person and Company

### Prospecting
- Search Contacts

### Account
- Get Remaining Credits

## List of Triggers

This service does not define any triggers.

## Authentication

UpLead uses an API key sent in the `Authorization` header (the raw key, with no `Bearer` prefix).

| Config item | Required | Description |
| ----------- | -------- | ----------- |
| API Key     | Yes      | Your UpLead API key. Find it in UpLead under **Integrations / API**. |

## Credit usage

UpLead deducts credits per revealed record. Enrichment charges one credit per successful match with a `valid` or `accept_all` email status. Contact searches charge only when records are revealed. Use **Get Remaining Credits** to monitor your balance.

## Verified against the UpLead API docs (docs.uplead.com)

- Base URL: `https://api.uplead.com/v2`
- Auth: `Authorization: <apiKey>` header (verified).
- Endpoints (verified in the public API reference): `person-search`, `company-search`, `prospector-search`, `combined-search`, `credits`.
- `management_level` codes (`M`, `D`, `VP`, `C`, `CX`) and the `job_function` enum are taken from the documented `prospector-search` parameter values; friendly labels are mapped to the API codes in the service.

## Verify before production

The UpLead public API surface is lightly documented. The endpoints, auth header, and parameter enums above were confirmed from the UpLead API reference, but exact response field names and error shapes should be validated against a live account with real credits before relying on this service in production. Sample results in the JSDoc are representative of the documented fields and may differ slightly from live payloads.

Additional documented endpoints not built into this service (available if needed): `prospector-pro-search`, `company-name-to-domain`, `quick-search`, `industries`, and `lists`.

## Agent Ideas

- Use UpLead **Enrich Person and Company** on an inbound email, then call **HubSpot** "Create Contact" (and "Create Company") to auto-populate the CRM with a verified, enriched record.
- Run UpLead **Search Contacts** against a target company domain, then use **HubSpot** "Create Contact" or **Pipedrive** "Get Persons"/CRM create actions to build a fresh prospect list.
- After UpLead **Enrich Company** returns firmographics for a new domain, use **Slack** "Send Message To Channel" to notify the sales team of the account's size, revenue, and industry.
