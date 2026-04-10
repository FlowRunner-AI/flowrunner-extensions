# QuickBooks Online FlowRunner Extension

Automates accounting workflows in QuickBooks Online including customers, vendors, employees, invoices, bills, estimates, items, accounts, payments, tax agencies, and financial reports. Connects via OAuth2.

## Ideal Use Cases

- Automating invoice and estimate creation when orders or milestones are reached
- Syncing customer, vendor, and employee records between systems
- Recording payments and reconciling invoices from external sources
- Generating profit and loss reports on a schedule
- Managing vendor bills, tax agencies, and accounts payable

## List of Actions

### Customers
- Create, Get, Update, Deactivate, List Customers

### Invoices
- Create, Get, Update, Delete, Void, List, Send Invoice, Get Invoice PDF

### Items
- Create, Get, Update, List Items

### Payments
- Create, Get, Delete, Void, List Payments

### Vendors
- Create, Get, Update, Deactivate, List Vendors

### Accounts
- Create, Get, Update, List Accounts

### Bills
- Create, Get, Update, Delete, List Bills

### Estimates
- Create, Get, Update, Delete, List, Send Estimate, Get Estimate PDF

### Employees
- Create, Get, Update, Deactivate, List Employees

### Company
- Get Company Info, Update Company Info, Get Preferences

### Tax
- Create, Get, List Tax Agencies

### Reports
- Get Profit and Loss Report, Get Profit and Loss Detail Report

## Agent Ideas

- When **Stripe** "Create Charge" processes a payment, use **QuickBooks Online** "Create Payment" and "Create Invoice" to record it
- Use **Google Sheets** "Add Row" to log **QuickBooks Online** "Get Profit and Loss Report" results into an automated financial archive
- After **QuickBooks Online** "Create Employee" adds a new hire, use **Slack** "Send Message To Channel" to notify HR
