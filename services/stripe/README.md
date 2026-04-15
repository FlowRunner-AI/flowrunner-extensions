# Stripe FlowRunner Extension

Complete payment processing integration with Stripe API for handling payments, subscriptions, customers, and financial operations. Supports comprehensive payment workflows, webhook handling, and full CRUD operations for all major Stripe objects.

## Ideal Use Cases

- Process online payments and handle payment intents
- Manage customer subscriptions and recurring billing
- Create and manage products, prices, and payment links
- Handle refunds, transfers, and payouts
- Manage customer data and payment methods
- Process webhook events for real-time payment updates
- Create checkout sessions for seamless payment experiences
- Manage invoices and billing operations

## List of Actions

### Payment Processing
- Create Charge
- Create Payment Intent
- Get Payment Intent
- Confirm Payment Intent
- Cancel Payment Intent
- List Payment Intents

### Customer Management
- Create Customer
- Get Customer
- Update Customer
- Delete Customer
- List Customers

### Subscription Management
- Create Subscription
- Get Subscription
- Update Subscription
- Cancel Subscription
- List Subscriptions

### Product Management
- Create Product
- Get Product
- Update Product
- Delete Product
- List Products
- Create Price
- Get Price
- Update Price
- List Prices

### Payment Links
- Create Payment Link
- Get Payment Link
- Update Payment Link
- List Payment Links
- Get Line Items for Payment Link
- Create Line Items for Payment Link

### Money Movement
- Create Transfer
- Get Transfer
- Update Transfer
- List Transfers
- Reverse Transfer
- Create Refund
- Get Refund
- Update Refund
- List Refunds
- Create Payout
- Get Payout
- Update Payout
- Cancel Payout
- List Payouts

### Invoicing
- Create Invoice
- Get Invoice
- Update Invoice
- Delete Invoice
- Finalize Invoice
- Pay Invoice
- Send Invoice
- Void Invoice
- List Invoices

### Checkout Sessions
- Create Checkout Session
- Get Checkout Session
- Expire Checkout Session
- List Checkout Sessions
- Get Line Items

### Account Management
- Retrieve Balance
- Create Connected Account

### Developer Tools
- Create Webhook Endpoint
- Get Webhook Endpoint
- Update Webhook Endpoint
- Delete Webhook Endpoint
- List Webhook Endpoints
- Custom Stripe Request

## List of Triggers

- Parse Webhook Event (handles all Stripe webhook events)

## Configuration

Requires Stripe Secret Key (Private Key) from your Stripe Dashboard at https://dashboard.stripe.com/apikeys

For OAuth connections, configure your Client ID and redirect URLs in Stripe Connect settings.