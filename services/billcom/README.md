# BILL.com FlowRunner Extension

Automates accounts payable and accounts receivable workflows in BILL.com. Manage vendors, customers, bills, invoices, and payments with session-based authentication and support for both production and sandbox environments.

## Ideal Use Cases

- Automating vendor bill creation and payment tracking from external order systems
- Syncing customer records and invoices between BILL.com and other business platforms
- Recording bill payments and charging customers when milestones or due dates are reached
- Building accounts payable and receivable reporting pipelines
- Sending invoices to customers automatically after order fulfillment

## List of Actions

### Vendors
- Create Vendor, Get Vendor, Update Vendor, List Vendors

### Bills
- Create Bill, Get Bill, Update Bill, List Bills

### Customers
- Create Customer, Get Customer, Update Customer, List Customers

### Invoices
- Create Invoice, Get Invoice, Update Invoice, List Invoices, Send Invoice

### Bill Payments
- Record Bill Payment, Get Bill Payment, List Bill Payments

### Receivable Payments
- Charge Customer, Get Receivable Payment, List Receivable Payments

## List of Triggers

### Bills
- On Bill Created, On Bill Updated

### Invoices
- On Invoice Created, On Invoice Updated

### Vendors
- On Vendor Created

### Payments
- On Payment Updated, On Payment Failed

## Agent Ideas

- When a **BILL.com** "On Bill Created" trigger fires, use **Slack** "Send Message" to notify the finance channel with the vendor name and amount for approval
- When a **BILL.com** "On Payment Failed" trigger fires, use **Gmail** "Send Email" to alert the accounts payable team with the payment details so they can retry or investigate
- When a **BILL.com** "On Invoice Created" trigger fires, use **Google Sheets** "Append Row" to log the invoice number, customer, and amount into a revenue tracking spreadsheet
