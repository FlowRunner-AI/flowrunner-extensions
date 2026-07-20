# Kajabi FlowRunner Extension

Kajabi is an all-in-one platform for creators to sell online courses, coaching, communities, and digital products. This extension integrates with the Kajabi Public API (JSON:API) to manage sites, contacts (with tagging), offers (with grant/revoke enrollment), products and courses, tags, purchases and orders, opt-in forms, and webhooks across the sites in a Kajabi account.

## Ideal Use Cases

- Sync new or updated Kajabi contacts into a CRM or email marketing platform
- Automatically grant an offer (enroll a student) when a contact completes an external purchase or form
- Tag and segment contacts based on activity tracked in other systems
- Log new orders and purchases into a spreadsheet or reporting pipeline
- Register webhooks so downstream flows can react to Kajabi events

## List of Actions

### Sites

- List Sites, Get Site

### Contacts

- List Contacts, Get Contact, Create Contact, Update Contact, Delete Contact
- Add Tag to Contact, Remove Tag from Contact

### Offers

- List Offers, Get Offer, Grant Offer to Contact, Revoke Offer from Contact

### Products

- List Products, Get Product, List Courses, Get Course

### Tags

- List Tags, Get Tag

### Commerce

- List Purchases, Get Purchase, List Orders, Get Order

### Forms

- List Forms, Get Form

### Webhooks

- List Webhooks, Create Webhook, Get Webhook, Delete Webhook

## List of Triggers

This service does not define any triggers. Use Create Webhook to have Kajabi deliver events to a target URL.

## Authentication

Kajabi uses OAuth2 **client credentials** (machine-to-machine) — there is no interactive account-connect step. Configure a **Client ID** and **Client Secret** (both created in Kajabi under Settings → Third Party Integrations → Public API). The service exchanges them for a Bearer token internally on each call. The Public API requires the Kajabi Pro plan or the API add-on.

## Notes

- Base URL is `https://api.kajabi.com/v1` and all responses follow the JSON:API spec with `links`/`meta` pagination.
- Most operations are site-scoped: call **List Sites** first to obtain a Site ID to pass into contact, offer, tag, and webhook operations. Create Contact and Create Webhook require a Site ID.
- Tags are **read-only** via the API — Kajabi does not expose a create-tag endpoint. Manage tags in the Kajabi dashboard, then use **List Tags** to find a tag ID and attach it with **Add Tag to Contact** (by tag ID, not name).
- **Grant Offer to Contact** enrolls the contact (creating a customer if needed) and sends a welcome email by default; set Send Welcome Email to false to suppress it.

## Agent Ideas

- Use **HubSpot** "Get Contact By Email" to check a lead, then call Kajabi **Create Contact** and **Grant Offer to Contact** to enroll them in a course after a deal closes.
- After a Kajabi **List Orders** or **List Purchases** run, use **Google Sheets** "Add Rows" to log each order into a revenue-tracking spreadsheet.
- When a new Kajabi contact is found via **List Contacts**, use **Mailchimp** "Add Or Update List Member" to sync them into an email list and **Slack** "Send Message To Channel" to notify your team.
