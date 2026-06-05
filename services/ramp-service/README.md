# Ramp FlowRunner Extension

Integrates with the Ramp corporate spend platform for card management, transaction monitoring, user provisioning, vendor and bill pay operations, and expense reimbursements. Authenticates via OAuth2 client credentials and supports both production and sandbox environments.

## Ideal Use Cases

- Monitoring new card transactions in real time for spend alerts and policy enforcement
- Issuing, freezing, unfreezing, or terminating corporate cards from automation flows
- Onboarding and offboarding employees by inviting users and managing their card access
- Syncing AP bills and vendor records with external accounting or ERP systems
- Automating reimbursement approval routing based on amount, user, or department
- Building expense and AP dashboards from filtered transaction, bill, and reimbursement data
- Reacting to newly submitted bills or reimbursements with approval workflows

## List of Actions

### Transactions

- Get Transaction
- List Transactions

### Cards

- Freeze Card
- Get Card
- Issue Card
- List Cards
- Terminate Card
- Unfreeze Card

### Users

- Get User
- Invite User
- List Users

### Organization

- List Departments
- List Locations

### Vendors

- Create Vendor
- Get Vendor
- List Vendors

### Bills

- Get Bill
- List Bills

### Reimbursements

- Approve Reimbursement
- Get Reimbursement
- List Reimbursements

## List of Triggers

- On New Bill
- On New Reimbursement
- On New Transaction

## Agent Ideas

- When a **Ramp** "On New Transaction" trigger fires, use **Slack** "Send Message" to alert the finance channel with merchant, amount, and cardholder, then call **Google Sheets** "Append Row" to log it into a live spend tracker
- When **Parseur** "On Document Processed" extracts an invoice, call **Ramp** "Create Vendor" if the vendor is new, then use **Ramp** "Get Bill" / "List Bills" to detect duplicates before AP entry
- When a **Ramp** "On New Reimbursement" trigger fires, use **Gmail** "Send Message" to notify the approver with the receipt details, and after manual review call **Ramp** "Approve Reimbursement" to advance it for payment
