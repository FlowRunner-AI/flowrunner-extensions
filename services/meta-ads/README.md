# Meta Ads FlowRunner Extension

Manage the full Meta (Facebook) advertising stack through the Marketing API over the Graph API — ad accounts, campaigns, ad sets, ads, creatives, ad-image uploads, custom audiences (with automatic email/phone SHA-256 hashing), Pages, and the flagship Insights performance reporting.

## Ideal Use Cases

- Programmatically create and manage campaigns, ad sets, and ads, keeping everything paused until you activate delivery.
- Pull campaign, ad set, or ad performance metrics (impressions, clicks, spend, CTR, reach) on a schedule for dashboards and reports.
- Build and refresh customer-file custom audiences from CRM or email-list data — the service hashes contacts for you.
- Upload creative images from FlowRunner file storage and assemble single-image link ad creatives from friendly fields.

## Authentication

OAuth2 via the Meta Graph API (`v25.0`). Configure a Meta app with the **Marketing API** product added, then provide its **App Client ID** and **App Client Secret** (both shared OAuth credentials). The service requests these scopes: `ads_management`, `ads_read`, `business_management`, `pages_show_list`. The flow exchanges the authorization code for a short-lived token and upgrades it to a long-lived (~60 day) user token; refresh re-exchanges the stored long-lived token.

**Access gating:** Full programmatic ad management requires **Standard Access**, granted only after **Meta App Review**. With **Development Access** (the default for a new app) these actions work **only against ad accounts, Pages, and audiences you own or administer**. Plan for App Review before operating on clients' assets.

## Notes

- **Money fields are in minor currency units.** Budget, spend, bid, and balance fields (`daily_budget`, `lifetime_budget`, `bid_amount`, `amount_spent`, `balance`, `spend_cap`) are in the ad account's minor units — cents for USD (`5000` = `$50.00`). Insights `spend` and cost metrics are the exception: returned in **major** units (dollars).
- **Ad Account IDs** may be supplied with or without the `act_` prefix; it is normalized automatically.
- **Custom audiences:** supply plain emails or phone numbers to Add/Remove Users — the service normalizes and SHA-256-hashes each value before sending, as Meta requires.

## List of Actions

- **Ad Accounts** — List Ad Accounts, Get Ad Account
- **Campaigns** — List Campaigns, Get Campaign, Create Campaign, Update Campaign, Delete Campaign
- **Ad Sets** — List Ad Sets, Get Ad Set, Create Ad Set, Update Ad Set, Delete Ad Set
- **Ads** — List Ads, Get Ad, Create Ad, Update Ad, Delete Ad
- **Creatives** — List Ad Creatives, Get Ad Creative, Create Link Ad Creative
- **Ad Images** — Upload Ad Image
- **Insights** — Get Insights
- **Custom Audiences** — List Custom Audiences, Create Custom Audience, Add Users to Audience, Remove Users from Audience, Delete Custom Audience
- **Pages** — List My Pages

## List of Triggers

This service does not define any triggers.

## Agent Ideas

- Use **Google Sheets** "Get Rows" to read a CRM export, then call **Meta Ads** "Add Users to Audience" to sync those contacts into a custom audience for retargeting.
- On a schedule, call **Meta Ads** "Get Insights" for each active campaign and use **Google Sheets** "Add Rows" to append the daily impressions, spend, and CTR into a performance-tracking spreadsheet.
- After **Meta Ads** "Get Insights" reports spend or cost-per-result crossing a threshold, use **Slack** "Send Message To Channel" to alert the marketing team so they can pause the ad set.
- Pull an email list with **Klaviyo** "Get List Profiles", then feed the addresses into **Meta Ads** "Add Users to Audience" to build a lookalike-seed custom audience from your subscribers.
