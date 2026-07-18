# Wix FlowRunner Extension

Connects FlowRunner to the Wix REST API (`https://www.wixapis.com`) using an account-level API key. It covers CRM contacts with labels, CMS data collections (Wix Data v2), Wix Stores products, eCommerce orders and fulfillments, blog draft posts with optional immediate publish, coupons, site members, and site properties across a single connected Wix site.

## Ideal Use Cases

- Sync new leads or customers into Wix CRM contacts and apply labels for segmentation
- Import, upsert, and query records in Wix CMS data collections for content-driven sites
- Manage the Wix Stores catalog by creating, updating, and querying products
- Fulfill eCommerce orders with carrier tracking and monitor order and payment status
- Automate blog publishing by drafting posts from plain text or Ricos rich content
- Create and manage promotional coupons for stores and bookings

## List of Actions

### Contacts
- Query Contacts
- Get Contact
- Create Contact
- Update Contact
- Delete Contact
- List Contact Labels
- Label Contact
- Unlabel Contact

### CMS Data
- Query Data Items
- Get Data Item
- Insert Data Item
- Update Data Item
- Save Data Item
- Remove Data Item
- List Data Collections

### Store Products
- Query Products
- Get Product
- Create Product
- Update Product
- Delete Product

### Orders
- Search Orders
- Get Order
- Create Order Fulfillment

### Blog
- List Blog Posts
- Get Blog Post
- Create Draft Blog Post
- List Blog Categories

### Coupons
- Query Coupons
- Create Coupon
- Get Coupon
- Delete Coupon

### Members
- List Members
- Get Member

### Site
- Get Site Properties

## List of Triggers

This service does not define any triggers.

## Configuration

Authentication is via a Wix account API key (all config items are unshared):

- **API Key** — Created in Wix under Account Settings → API Keys; grant it the permission scopes for the APIs you use (Contacts, Wix Data, Stores, eCommerce, Blog, Members).
- **Account ID** — Your Wix account ID, shown on the API Keys page.
- **Site ID** — The Wix site to operate on, found in the site dashboard URL or under site Settings. Most Wix APIs are site-scoped.

Every request sends the raw key in the `Authorization` header (no `Bearer` prefix) plus `wix-account-id` and `wix-site-id`.

## Notes

- Update Contact fetches the contact's current revision automatically when one is not supplied (Wix uses revisions for optimistic locking).
- Save Data Item upserts by `_id`; on update the provided data fully replaces the existing item, so include every field you want to keep.
- Create Order Fulfillment requires the order to be approved, and each line item can appear in only one fulfillment. Tracking links are auto-generated for known carriers (fedex, ups, usps, dhl, canadaPost); supply the tracking link explicitly for custom carriers.
- Stores catalog (v1) and Coupons (v2) expect stringified-JSON filters; the service stringifies object filters automatically for those operations.
- The Data Collections, Products, and Contact Labels dictionaries power the pickers behind the collection, product, and label-key parameters.

## Agent Ideas

- When a **Gmail** "On New Email" trigger fires with a sales inquiry, use **Wix** "Create Contact" and then "Label Contact" to add the sender to Wix CRM under a "Leads" label
- Use **Wix** "Search Orders" to pull recently approved orders, then call **Google Sheets** "Add Rows" to log each order into a fulfillment tracking spreadsheet
- Use **Shopify** "Get Product" details for a bestselling item, then call **Wix** "Create Product" to cross-list the same product in the Wix Stores catalog
