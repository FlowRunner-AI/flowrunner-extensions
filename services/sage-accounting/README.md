# Sage Accounting FlowRunner Extension

Connect FlowRunner to Sage Business Cloud Accounting (Sage Accounting) — the SMB bookkeeping SaaS — over the Sage Accounting API v3.1. Manage businesses, contacts (customers and vendors), sales invoices, sales credit notes, sales quotes, purchase invoices, products, services, ledger accounts, bank accounts, contact payments, tax rates, and manual journals. This is distinct from the separate Sage Intacct service in this repository.

## Ideal Use Cases

- Automatically create Sage sales invoices from orders, subscriptions, or form submissions captured elsewhere
- Sync customer and vendor records between a CRM and Sage's contact list
- Record customer receipts and vendor payments against outstanding invoices when payments settle
- Push products and services into Sage's catalog and keep prices up to date
- Post manual journal entries and export ledger, invoice, or payment data for reporting

## List of Actions

- **Businesses** — List Businesses, Get Business
- **Contacts** — List Contacts, Get Contact, Create Contact, Update Contact, Delete Contact
- **Sales Invoices** — List Sales Invoices, Get Sales Invoice, Create Sales Invoice, Update Sales Invoice, Delete Sales Invoice
- **Sales Credit Notes** — List Sales Credit Notes, Get Sales Credit Note, Create Sales Credit Note, Update Sales Credit Note, Delete Sales Credit Note
- **Sales Quotes** — List Sales Quotes, Get Sales Quote, Create Sales Quote, Update Sales Quote, Delete Sales Quote
- **Purchase Invoices** — List Purchase Invoices, Get Purchase Invoice, Create Purchase Invoice, Update Purchase Invoice, Delete Purchase Invoice
- **Products** — List Products, Get Product, Create Product, Update Product, Delete Product
- **Services** — List Services, Get Service, Create Service, Update Service, Delete Service
- **Ledger Accounts** — List Ledger Accounts, Get Ledger Account, Create Ledger Account
- **Bank Accounts** — List Bank Accounts, Get Bank Account
- **Contact Payments** — Create Contact Payment, List Contact Payments, Get Contact Payment
- **Tax Rates** — List Tax Rates
- **Journals** — Create Journal, List Journals, Get Journal

## List of Triggers

This service does not define any triggers.

## Authentication

Sage Accounting uses OAuth2. Register a Sage app at developer.sage.com and supply the shared **Client Id** and **Client Secret** configuration items. Access tokens are short-lived (~5 minutes) and refresh tokens are single-use and rotate on every refresh (~31-day life), so both the connection callback and each token refresh return a newly issued refresh token; FlowRunner handles this rotation automatically. The connection is scoped to the business selected during authorization, so most accounts need no per-action business selector.

## Notes

- Delete operations only succeed for artefacts with no payments or allocations (typically drafts); paid or allocated documents must be voided in Sage.
- On update actions, providing line arrays (invoice, credit note, quote, or sales-price lines) replaces all existing lines rather than merging them.
- Contact Payment is how invoice payments are recorded in Sage — allocate a receipt or payment across one or more invoices/credit notes, with any remainder recorded as payment on account.
- Dictionaries back the id parameters for contacts, ledger accounts, ledger account types, bank accounts, tax rates, products, services, and artefact statuses, so pickers show current values from the connected business.

## Agent Ideas

- Use **Stripe** "Get Invoices List" to pull settled payments, then call Sage Accounting "Create Sales Invoice" and "Create Contact Payment" to mirror the revenue and mark it paid in the ledger.
- When a **HubSpot** deal closes via "Create Deal", use Sage Accounting "Create Contact" for the customer and "Create Sales Invoice" to bill the agreed amount automatically.
- On a schedule, call Sage Accounting "List Sales Invoices" and "List Contact Payments", then use **Google Sheets** "Add Rows" to append the results into an accounts-receivable tracking sheet for reporting.
