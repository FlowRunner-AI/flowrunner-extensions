# Razorpay FlowRunner Extension

Integrates the Razorpay Payment Gateway API (v1) for accepting and managing payments in India. Covers orders, payments (with capture, card details, and downtimes), refunds, shareable payment links, invoices, reusable items, customers, plans, recurring subscriptions with add-ons, UPI QR codes, settlements, and virtual accounts. Authenticates with HTTP Basic using your Key ID and Key Secret.

## Ideal Use Cases

- Create an order, then capture and reconcile the payment made against it in a checkout flow
- Send a customer a shareable payment link or a UPI QR code and track when it is paid
- Bill customers on a recurring schedule with subscription plans and one-off add-ons
- Generate and issue invoices from reusable billing items and deliver them by SMS or email
- Issue full or partial refunds and reconcile settlements, including on-demand payouts to your bank

## List of Actions

### Orders
- Create Order, List Orders, Get Order, Update Order, List Order Payments

### Payments
- List Payments, Get Payment, Capture Payment, Update Payment, Get Card of Payment, List Downtimes, Get Downtime

### Refunds
- Create Refund, List Payment Refunds, Get Payment Refund, List All Refunds, Get Refund, Update Refund

### Payment Links
- Create Payment Link, List Payment Links, Get Payment Link, Update Payment Link, Cancel Payment Link, Send Payment Link Notification

### Invoices
- Create Invoice, List Invoices, Get Invoice, Update Invoice, Issue Invoice, Cancel Invoice, Delete Invoice, Send Invoice Notification

### Items
- Create Item, List Items, Get Item, Update Item, Delete Item

### Customers
- Create Customer, List Customers, Get Customer, Update Customer

### Plans
- Create Plan, List Plans, Get Plan

### Subscriptions
- Create Subscription, List Subscriptions, Get Subscription, Update Subscription, Cancel Subscription, Pause Subscription, Resume Subscription, Create Subscription Add-on, Get Add-on, Delete Add-on

### QR Codes
- Create QR Code, List QR Codes, Get QR Code, Close QR Code, List QR Code Payments

### Settlements
- List Settlements, Get Settlement, Get Combined Settlement Recon, Create On-demand Settlement, List On-demand Settlements, Get On-demand Settlement

### Virtual Accounts
- Create Virtual Account, List Virtual Accounts, Get Virtual Account, Close Virtual Account, List Virtual Account Payments

## List of Triggers

This service does not define any triggers.

## Authentication

Every request uses HTTP Basic authentication. Supply your API **Key ID** (starts with `rzp_test_...` or `rzp_live_...`) and **Key Secret**, both generated in the Razorpay Dashboard under Account & Settings > API Keys. The Key Secret is shown only once at generation time.

## Notes

- **Amounts** are always in the smallest currency unit — paise for INR (`10000` = ₹100).
- **List actions** paginate with `count` (max 100) and `skip`; most also accept `from`/`to` Unix timestamps (seconds).
- **RazorpayX** (payouts and payroll) is out of scope for this service.
- The customer, plan, and item pickers are backed by internal dictionary lookups and are not standalone actions.

## Agent Ideas

- After a **Razorpay** "Capture Payment" or "Get Payment" confirms a successful charge, use **Gmail** "Send Message" to email the customer a payment receipt with the amount and payment ID.
- Use **HubSpot** "Create Contact" for a new customer, then call **Razorpay** "Create Payment Link" to send them a checkout URL and record the returned short_url back on the contact.
- When a **Razorpay** "List Settlements" run returns a new settlement, use **Google Sheets** "Add Row" to log the settlement amount, fees, and status into a finance reconciliation spreadsheet.
