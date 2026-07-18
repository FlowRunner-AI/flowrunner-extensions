# Square FlowRunner Extension

Connect FlowRunner to the [Square](https://squareup.com/) v2 API to run payments, refunds, orders, catalog, customers, cards on file, invoices, inventory, subscriptions, payouts and team management. Authenticates with a personal access token and supports both Production and Sandbox environments.

> All money amounts are integer minor units (cents) — e.g. `1000` = $10.00.

## Ideal Use Cases

- Charge saved cards on file, capture or void authorized payments, and issue full or partial refunds
- Create and pay orders, then generate and publish invoices with email or shareable payment links
- Sync catalog items, customers and multi-location inventory counts with external systems
- Enroll customers in subscription plans and manage pauses, resumes and cancellations
- Reconcile settlements by reading payouts and their individual entries

## List of Actions

### Locations
List Locations, Get Location

### Payments
List Payments, Get Payment, Create Payment, Update Payment, Complete Payment, Cancel Payment

### Refunds
Refund Payment, List Refunds, Get Refund

### Orders
Create Order, Get Order, Update Order, Search Orders, Pay Order, Calculate Order, Clone Order

### Catalog
List Catalog, Get Catalog Object, Upsert Catalog Item, Delete Catalog Object, Search Catalog, Get Catalog Info

### Customers
List Customers, Get Customer, Create Customer, Update Customer, Delete Customer, Search Customers

### Cards
Create Card, List Cards, Get Card, Disable Card

### Invoices
Create Invoice, List Invoices, Get Invoice, Update Invoice, Publish Invoice, Cancel Invoice, Delete Invoice, Search Invoices

### Inventory
Get Inventory Count, Batch Retrieve Inventory Counts, Adjust Inventory, Record Physical Count

### Subscriptions
Create Subscription, Search Subscriptions, Get Subscription, Update Subscription, Cancel Subscription, Pause Subscription, Resume Subscription

### Payouts
List Payouts, Get Payout, List Payout Entries

### Team
Search Team Members, Get Team Member

## List of Triggers

This service does not define any triggers.

## Configuration

- **Access Token** (required) — a Square access token. Create an application at [developer.squareup.com/apps](https://developer.squareup.com/apps) and copy the access token for the chosen environment.
- **Environment** (required, default `Production`) — `Production` uses connect.squareup.com; `Sandbox` uses connect.squareupsandbox.com for testing. The token must match the selected environment.

## Notes

- Location IDs are required by many operations (Create Payment, Create Order, Create Invoice); pass the special value `main` to Get Location to fetch the account's main location.
- Write operations accept an optional idempotency key and generate one automatically when omitted.
- Payments created with Autocomplete off are only authorized and must later be captured with Complete Payment (or voided with Cancel Payment) before the ~6-day expiry.

## Agent Ideas

- When a **Shopify** "On New Order" trigger fires, use **Square** "Create Order" and "Create Payment" to record and charge the order against a saved card on file.
- After **Square** "Refund Payment" completes, use **QuickBooks Online** "Create Payment" to record the reversal, then **Slack** "Send Message To Channel" to alert the finance team.
- Use **Square** "List Payouts" and "List Payout Entries" to pull settlement detail, then **Google Sheets** "Add Row" to append each entry into a reconciliation spreadsheet.
