# Mollie FlowRunner Extension

Accept and manage online payments through Mollie's v2 REST API — create hosted-checkout payments, refunds, chargebacks, captures, and payment links, and manage customers, mandates, subscriptions, payment methods, balances, settlements, invoices, profiles, and terminals. Authenticate with a Mollie `live_...` or `test_...` API key.

## Ideal Use Cases

- Generate a hosted checkout URL for a customer and track the payment through to paid, refunded, or charged-back.
- Send shareable payment links via email or chat for invoices, donations, or pay-what-you-want flows.
- Set up recurring billing: establish a mandate with a first payment, then charge customers automatically via subscriptions.
- Issue full or partial refunds and monitor chargebacks for dispute handling and reconciliation.
- Reconcile payouts and fees by pulling balances, settlements, and Mollie fee invoices (organization access token required).

## List of Actions

### Payments
Create Payment, List Payments, Get Payment, Update Payment, Cancel Payment

### Refunds
Create Refund, List Payment Refunds, Get Refund, Cancel Refund, List All Refunds

### Chargebacks
List Payment Chargebacks, Get Chargeback, List All Chargebacks

### Captures
Create Capture, List Captures, Get Capture

### Payment Links
Create Payment Link, List Payment Links, Get Payment Link, Update Payment Link, Delete Payment Link, List Payment Link Payments

### Customers
Create Customer, List Customers, Get Customer, Update Customer, Delete Customer, List Customer Payments, Create Customer Payment

### Mandates
Create Mandate, List Mandates, Get Mandate, Revoke Mandate

### Subscriptions
Create Subscription, List Customer Subscriptions, List All Subscriptions, Get Subscription, Update Subscription, Cancel Subscription, List Subscription Payments

### Payment Methods
List Enabled Payment Methods, List All Payment Methods, Get Payment Method

### Balances
List Balances, Get Balance, Get Balance Report, List Balance Transactions

### Settlements
List Settlements, Get Settlement, List Settlement Payments

### Invoices
List Invoices, Get Invoice

### Profiles
List Profiles, Get Profile

### Terminals
List Terminals, Get Terminal

## List of Triggers

This service does not define any triggers.

## Authentication & Notes

- Configure a single **API Key** item with a `live_...` or `test_...` key from the Mollie Dashboard (Developers → API keys). Test keys run the same API in test mode.
- **Organization-level operations** — the Balances, Settlements, and Invoices APIs do not accept regular API keys. Supply an **organization access token** in the same API Key field to use these operations.
- **Amounts** are Mollie amount objects — `{ "currency": "EUR", "value": "10.00" }` — with a string value carrying two decimals (zero decimals for currencies like JPY and ISK).
- The deprecated **Orders API is intentionally excluded**; itemize payments with the `lines` property on Create Payment instead (required by some methods such as Klarna).

## Agent Ideas

- After **Mollie** "Create Payment" returns a `checkoutUrl`, use **Gmail** "Send Message" to email the customer their hosted checkout link and payment reference.
- When a **Mollie** "Create Payment Link" produces a shareable `paymentLinkUrl`, use **Slack** "Send Message To Channel" to post it into a sales channel for the team to share.
- Use **Mollie** "List Settlements" and "List Settlement Payments" to reconcile a payout, then **Google Sheets** "Add Rows" to log each included payment into a finance tracking spreadsheet.
