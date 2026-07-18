# Printful FlowRunner Extension

Connects FlowRunner to [Printful](https://www.printful.com/), the print-on-demand and fulfillment platform. Browse the blank product catalog, manage your store's sync products and variants, place and manage orders (including drafts, cost estimates, confirmation and cancellation), calculate shipping and tax rates, manage the file library, and configure store webhooks. Authenticates with a Printful private token (Bearer); an optional Store ID is sent as the `X-PF-Store-Id` header for account-level tokens covering multiple stores.

## Ideal Use Cases

- Sync new products from a source system into your Printful store, mapping catalog variants to retail prices and print files
- Automate order fulfillment: create draft orders, preview costs, then confirm eligible orders for fulfillment
- Quote live shipping options and sales tax to customers before an order is placed
- Register and track print files in the Printful library, reusing file ids across variants and orders
- Keep an external catalog in sync by listing, updating and deleting sync products and variants

## List of Actions

### Stores
- List Stores
- Get Store Info

### Catalog
- List Catalog Products
- Get Catalog Product
- Get Catalog Variant
- List Categories

### Sync Products
- List Sync Products
- Get Sync Product
- Create Sync Product
- Update Sync Product
- Delete Sync Product
- Get Sync Variant
- Update Sync Variant
- Delete Sync Variant

### Orders
- List Orders
- Get Order
- Create Order
- Update Order
- Confirm Order
- Cancel Order
- Estimate Order Costs

### Shipping & Tax
- Get Shipping Rates
- Get Tax Rate

### Files
- List Files
- Add File
- Get File

### Countries
- List Countries

### Webhooks
- Get Webhook Config
- Set Webhook Config
- Disable Webhooks

## List of Triggers

This service does not define any triggers.

## Configuration

- **API Key** (required) — Your Printful private token, sent as a Bearer token. Create it in the Printful Dashboard under Settings → API (or at developers.printful.com).
- **Store ID** (optional) — Needed when the token is account-level and covers multiple stores; sent as the `X-PF-Store-Id` header. Find store ids with **List Stores**.

## Notes

- **API version** — This extension targets the Printful v1 API. The v2 API is still in beta and is not used here.
- **Full replacement on updates** — **Update Sync Product** treats a provided Sync Variants list as a complete replacement of the existing variants: variants missing from the request are deleted, variants with an id are updated, and variants without an id are created. Omit Sync Variants to change only the product name/thumbnail. Likewise, **Update Sync Variant** with Print Files replaces the variant's entire file list.
- **Draft-first orders** — **Create Order** and **Update Order** produce an editable draft that is not billed or fulfilled until confirmed. Confirm inline via "Confirm for Fulfillment" or later with **Confirm Order**. **Cancel Order** cancels a pending order or deletes a draft.
- **Id references** — Product, variant, order and file operations accept either the numeric Printful id or an external id prefixed with `@` (e.g. `@my-order-1`).

## Agent Ideas

- Use **Shopify** "Get List of Products" to read a store's catalog, then call **Printful** "Create Sync Product" to mirror each product into Printful with mapped catalog variants and print files
- When a **Shopify** "On New Order" trigger fires, call **Printful** "Get Shipping Rates" and "Create Order" (with "Confirm for Fulfillment") to submit the order for print-on-demand fulfillment
- Use **Printful** "List Orders" to pull recent orders and their statuses, then **Google Sheets** "Add Rows" to log fulfillment progress into a tracking spreadsheet
