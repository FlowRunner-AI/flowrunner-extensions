# NetSuite FlowRunner Extension

Full NetSuite ERP integration for managing customers, vendors, invoices, sales orders, items, and payments via the SuiteTalk REST API. Supports custom SuiteQL queries for advanced data retrieval. Connects through OAuth2 authentication.

## Ideal Use Cases

- Automating customer and vendor record management across your ERP
- Creating and tracking invoices and customer payments
- Managing sales order lifecycles from creation through fulfillment
- Synchronizing product and item catalogs with external systems
- Running custom SuiteQL queries for reporting and data analysis
- Coordinating multi-subsidiary and multi-currency financial workflows

## List of Actions

### Customers
- Create Customer
- Get Customer
- Update Customer
- Delete Customer
- List Customers

### Vendors
- Create Vendor
- Get Vendor
- Update Vendor
- Delete Vendor
- List Vendors

### Invoices
- Create Invoice
- Get Invoice
- Update Invoice
- Delete Invoice
- List Invoices

### Sales Orders
- Create Sales Order
- Get Sales Order
- Update Sales Order
- Delete Sales Order
- List Sales Orders

### Items
- Get Item
- List Items

### Payments
- Create Payment
- Get Payment
- Delete Payment
- List Payments

### Utilities
- Run SuiteQL Query

## Agent Ideas

- Use **Stripe** "Create Payment Intent" to collect a payment online, then call **NetSuite** "Create Payment" and "Create Invoice" to record the transaction and invoice in the ERP automatically
- Use **NetSuite** "List Customers" to export the full customer roster, then call **Google Sheets** "Add Rows" to build a live customer directory spreadsheet for the team
- When a **NetSuite** "Run SuiteQL Query" finds overdue invoices, use **Gmail** "Send Message" to notify each customer with their outstanding balance and payment instructions
