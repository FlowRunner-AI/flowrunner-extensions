# Ramp FlowRunner Extension

Integrates with the Ramp corporate spend platform for card management, transaction monitoring, user provisioning, vendor and bill pay operations, and expense reimbursements. Authenticates via OAuth2 client credentials and supports production and sandbox environments.

## Ideal Use Cases

- Monitoring new card transactions for spend alerts and policy enforcement
- Issuing, freezing, unfreezing, or terminating corporate cards
- Onboarding and offboarding employees via user invites and card access
- Syncing AP bills and vendor records with accounting or ERP systems
- Automating reimbursement approval routing by amount, user, or department
- Building expense and AP dashboards from filtered Ramp data

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

- When a **Ramp** "On New Transaction" trigger fires, use **Slack** "Send Message To Channel" to alert finance, then **Google Sheets** "Add Row" to log it into a spend tracker
- When **Parseur** "On Document Processed (Realtime)" extracts an invoice, call **Ramp** "Create Vendor" for new vendors and "List Bills" to detect duplicates before AP entry
- When a **Ramp** "On New Reimbursement" trigger fires, use **Gmail** "Send Message" to notify the approver, then call **Ramp** "Approve Reimbursement" after review
