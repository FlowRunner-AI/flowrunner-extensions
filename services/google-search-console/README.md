# Google Search Console FlowRunner Extension

FlowRunner integration for [Google Search Console](https://search.google.com/search-console) — query search performance data (clicks, impressions, CTR, average position) across the full dimension and filter surface, manage properties and sitemaps, and inspect URL index status through the [Search Console API](https://developers.google.com/webmaster-tools) using the connected user's Google account (OAuth 2.0).

## Ideal Use Cases

- Pull daily/weekly search analytics (top queries, pages, countries, devices) into reports or dashboards
- Monitor a site's organic performance and alert when clicks or average position shift
- Automate sitemap submission and check how many URLs Google has indexed
- Verify whether a newly published page is indexed and view its Google-selected canonical
- Add or remove properties and audit permission levels across accounts

## List of Actions

### Search Analytics

- Query Search Analytics

### Sites

- Add Site
- Delete Site
- Get Site
- List Sites

### Sitemaps

- Delete Sitemap
- Get Sitemap
- List Sitemaps
- Submit Sitemap

### URL Inspection

- Inspect URL

## List of Triggers

This service does not define any triggers.

## Authentication

Connect via OAuth 2.0 with a Google account that has access to the target Search Console properties. Provide your OAuth 2.0 **Client Id** and **Client Secret** from the Google Cloud Console in the service configuration.

## Notes

- **Property formats**: URL-prefix properties use the site URL (e.g. `https://www.example.com/`); domain properties use the `sc-domain:` prefix (e.g. `sc-domain:example.com`). Pass the value exactly as it appears in Search Console for every action's Site URL parameter.
- **Data freshness**: Search analytics dates use `YYYY-MM-DD` in America/Los_Angeles (PT) time and typically lag 2–3 days unless a fresh Data State is requested.
- **Query Search Analytics** returns up to 25,000 rows per request (default 1,000); use Start Row to paginate. Country values are ISO 3166-1 alpha-3 codes (e.g. `usa`, `deu`); device values are `DESKTOP`, `MOBILE`, or `TABLET`.
- **Inspect URL** is rate-limited by Google to roughly 2,000 inspections per property per day and requires at least full access to the property.

## Agent Ideas

- Use **Google Search Console** "Query Search Analytics" to pull the week's top queries and pages, then use **Google Sheets** "Add Row" to append each row into a performance-tracking spreadsheet
- After publishing a page, use **Google Search Console** "Submit Sitemap" and then "Inspect URL" to confirm indexing, and use **Slack** "Send Message To Channel" to notify the team of the index verdict
- Use **Google Search Console** "Query Search Analytics" to detect queries where average position dropped, then use **Gmail** "Send Message" to email an SEO summary with the affected pages
