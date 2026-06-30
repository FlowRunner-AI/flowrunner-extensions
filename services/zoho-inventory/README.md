# Zoho Inventory FlowRunner Extension

Integration with Zoho Inventory's order and stock management platform. Manage contacts, items, composite items and bundles, inventory adjustments, sales orders, packages and shipments, sales returns, invoices, customer payments, credit notes, purchase orders, bills, vendor payments and credits, transfer orders, and multi-location warehouses through a single OAuth2-connected service. Auto-detects your Zoho regional data center and ships polling triggers for near-real-time event tracking.

## Ideal Use Cases

- Syncing products, stock levels, and price lists between Zoho Inventory and external storefronts or databases
- Automating order-to-cash: create sales orders, generate invoices, record customer payments, and email invoices
- Driving procure-to-pay: raise purchase orders, receive stock, record bills, and pay vendors
- Fulfilling orders through packages and shipment orders, and processing sales returns and credit notes
- Monitoring low-stock items and new or updated records to trigger reorder and notification workflows
- Managing inventory across multiple warehouse locations with transfer orders and stock adjustments

## List of Actions

### Diagnostics
- Test Connection

### Contacts
- Create Contact
- Get Contact
- Update Contact
- Delete Contact
- Mark Contact Active
- Mark Contact Inactive
- List Contacts

### Items
- Create Item
- Get Item
- Update Item
- Delete Item
- Mark Item Active
- Mark Item Inactive
- List Items

### Item Groups
- Create Item Group
- Get Item Group
- Update Item Group
- Delete Item Group
- List Item Groups

### Composite Items
- Create Composite Item
- Get Composite Item
- Update Composite Item
- Delete Composite Item
- Create Bundle
- Delete Bundle

### Inventory Adjustments
- Create Inventory Adjustment
- Get Inventory Adjustment
- Delete Inventory Adjustment
- List Inventory Adjustments

### Sales Orders
- Create Sales Order
- Get Sales Order
- Update Sales Order
- Delete Sales Order
- Mark Sales Order Confirmed
- Mark Sales Order Void
- List Sales Orders

### Packages
- Create Package
- Get Package
- Update Package
- Delete Package
- List Packages

### Shipment Orders
- Create Shipment Order
- Get Shipment Order
- Mark Shipment Delivered
- Delete Shipment Order

### Sales Returns
- Create Sales Return
- Get Sales Return
- Update Sales Return
- Delete Sales Return
- List Sales Returns
- Receive Sales Return

### Invoices
- Create Invoice
- Get Invoice
- Update Invoice
- Delete Invoice
- Mark Invoice Sent
- Mark Invoice Void
- Mark Invoice Draft
- Email Invoice
- Write Off Invoice
- List Invoices

### Customer Payments
- Record Customer Payment
- Get Customer Payment
- Update Customer Payment
- Delete Customer Payment
- List Customer Payments

### Credit Notes
- Create Credit Note
- Get Credit Note
- Update Credit Note
- Delete Credit Note
- Apply Credit Note To Invoices
- List Credit Notes

### Purchase Orders
- Create Purchase Order
- Get Purchase Order
- Update Purchase Order
- Delete Purchase Order
- Mark PO Issued
- Mark PO Cancelled
- List Purchase Orders
- Receive Purchase Order
- Get Purchase Receive
- Delete Purchase Receive

### Bills
- Create Bill
- Get Bill
- Update Bill
- Delete Bill
- Mark Bill Open
- Mark Bill Void
- List Bills

### Vendor Payments
- Record Vendor Payment
- Get Vendor Payment
- Delete Vendor Payment
- List Vendor Payments

### Vendor Credits
- Create Vendor Credit
- Get Vendor Credit
- Delete Vendor Credit
- Apply Vendor Credit To Bills
- List Vendor Credits

### Transfer Orders
- Create Transfer Order
- Get Transfer Order
- Delete Transfer Order
- Mark Transfer Received
- List Transfer Orders

### Locations
- Enable Multi-Location
- Create Location
- Get Location
- Update Location
- Delete Location
- Mark Location Primary

## List of Triggers

- On New Or Updated Sales Order (Polling)
- On New Or Updated Purchase Order (Polling)
- On New Or Updated Invoice (Polling)
- On New Or Updated Bill (Polling)
- On New Or Updated Item (Polling)
- On New Or Updated Contact (Polling)
- On New Or Updated Package (Polling)
- On Low Stock Item (Polling)

## Authentication

This service uses **OAuth2**. Connect a Zoho account from the connection settings before using any action. Zoho serves users from one of eight regional data centers; the originating data center is detected during the OAuth callback and reused for all subsequent calls and token refreshes.

## Configuration

- **Client ID** (required) — OAuth 2.0 Client ID from the Zoho API Console (https://api-console.zoho.com).
- **Client Secret** (required) — OAuth 2.0 Client Secret issued alongside the Client ID.
- **Data Center** (optional) — Default Zoho data center for the initial OAuth redirect (`US`, `EU`, `IN`, `AU`, `JP`, `CA`, `CN`, `SA`). Multi-DC clients are auto-detected during the callback. Defaults to `US`.
- **Default Organization ID** (optional) — Fallback `organization_id` used when an action does not specify one. Find IDs in Zoho Inventory → Settings → Organizations.
- **Low Stock Threshold Multiplier** (optional) — Multiplier applied to each item's reorder level when evaluating the low-stock trigger. `1` triggers at exactly the reorder level; `1.5` triggers when stock drops below 1.5× the reorder level. Defaults to `1`.

> **Note:** Zoho Inventory exposes outgoing webhooks only through its in-app Settings → Automation → Workflow Rules UI — there is no webhook REST endpoint — so this extension ships polling triggers only.

## Agent Ideas

- When Zoho Inventory's "On New Or Updated Sales Order (Polling)" trigger fires, use **ShipBob** "Create Order" to fulfill it, then **Gmail** "Send Message" to email the customer their tracking details.
- When Zoho Inventory's "On Low Stock Item (Polling)" trigger fires, use **Slack** "Send Message To Channel" to alert the purchasing team, then call Zoho Inventory's "Create Purchase Order" to reorder from the vendor.
- When Zoho Inventory's "On New Or Updated Invoice (Polling)" trigger fires, use **QuickBooks Online** "Create Invoice" to mirror the sale into your books, and after payment call **QuickBooks Online** "Create Payment" to record it.
