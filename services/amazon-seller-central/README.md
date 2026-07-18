# Amazon Seller Central FlowRunner Extension

FlowRunner integration for the Amazon Selling Partner API (SP-API). Connect a seller account
via Login with Amazon and automate marketplace participations, orders and merchant shipment
confirmation, catalog search, listings management, FBA inventory, reports (with gzip-aware
document downloads to file storage), finances, and feed submission across the North America,
Europe, and Far East regions.

## Ideal Use Cases

- Sync new and updated orders into an ERP, CRM, or spreadsheet, then confirm merchant-fulfilled shipments with tracking back to Amazon.
- Manage listings programmatically: inspect a listing, create or replace it, patch price/quantity, or delete offers.
- Monitor FBA inventory levels and trigger restock or reorder workflows when fulfillable quantities run low.
- Generate business reports (all orders, open listings, sales and traffic, FBA planning), poll to completion, and download the decompressed output for downstream processing.
- Reconcile Amazon settlements by pulling financial events and event groups, and push bulk catalog or pricing changes through the feeds pipeline.

## List of Actions

### Sellers

- Get Marketplace Participations

### Orders

- Confirm Shipment
- Get Order
- List Order Items
- List Orders

### Catalog

- Get Catalog Item
- Search Catalog Items

### Listings

- Delete Listing Item
- Get Listing Item
- Patch Listing Item
- Put Listing Item

### Inventory

- Get Inventory Summaries

### Reports

- Create Report
- Download Report Document
- Get Report
- Get Report Document
- List Reports

### Finances

- List Financial Event Groups
- List Financial Events

### Feeds

- Create Feed
- Create Feed Document
- Get Feed
- Upload Feed Content

## List of Triggers

This service does not define any triggers.

## Authentication

OAuth2 via Amazon's SP-API website authorization workflow (Login with Amazon), completed on the
seller's Seller Central consent page. FlowRunner appends the `redirect_uri`; it must match a
redirect URI configured on the SP-API app. The callback returns `spapi_oauth_code` and
`selling_partner_id`; the code is exchanged for LWA tokens at `api.amazon.com`. API calls
authenticate with the `x-amz-access-token` header only (no AWS SigV4 signing). Access tokens last
about one hour and are refreshed automatically; refresh tokens are long-lived.

## Configuration

- **Client Id / Client Secret** (shared) — the app's LWA credentials from the Seller Central Developer Console.
- **Application ID** — the SP-API app id (`amzn1.sp.solution....`), used in the consent URL.
- **Region** — North America (default), Europe (incl. India), or Far East; selects both the Seller Central consent domain and the `sellingpartnerapi-{na|eu|fe}` API base.
- **Draft App** — adds `version=beta` to the consent URL so unpublished (draft) apps can be authorized.

## Notes

- Using this integration requires registering as an SP-API developer and creating an app in the Seller Central Developer Console. Sellers can only authorize apps whose roles cover the called APIs.
- SP-API rate limits are strict and per-endpoint (e.g. Orders listing about 0.0167 rps, Create Report about 1 per minute, Create Feed about 1 every 2 minutes). Space out calls and avoid tight loops; the operation descriptions note the tight limits.
- Buyer PII (names, addresses, emails on orders) requires Restricted Data Tokens, which are out of scope for this service — order operations return non-PII data only.
- Listings and feeds are processed asynchronously: an `ACCEPTED` or queued response means the submission passed validation, not that it is live. Poll with Get Report / Get Feed to confirm processing.
- Download Report Document decompresses GZIP content, stores the result in FlowRunner file storage, and returns the file URL plus a text preview of the first 50 KB.

## Agent Ideas

- After **List Orders** returns recent orders, use **Google Sheets** "Add Row" to log each order into a fulfillment tracking sheet, then call **Confirm Shipment** once the package ships to push tracking back to Amazon.
- When a **ShipBob** "On Order Shipped" trigger fires, use Amazon Seller Central **Confirm Shipment** to mark the corresponding merchant-fulfilled order as Shipped with the carrier and tracking number.
- Use **List Financial Events** to pull Amazon settlement events, then call **QuickBooks Online** "Create Bill" to record the associated fees and charges in accounting.
