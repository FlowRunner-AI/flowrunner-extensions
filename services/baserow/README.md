# Baserow FlowRunner Extension

FlowRunner integration for [Baserow](https://baserow.io), the open-source no-code database. Read and write rows and manage databases, tables, and fields using a Baserow **database token**. Works with both Baserow Cloud and self-hosted instances.

## Ideal Use Cases

- Sync form submissions, orders, or CRM records into a Baserow table as structured rows.
- Query rows with search, ordering, and filters to feed downstream steps in an automation.
- Keep a Baserow table in sync with another system via batch create/update/delete operations.
- Provision new tables and fields on the fly to store data collected during a workflow.

## List of Actions

### Databases

- List Databases

### Tables

- List Tables
- Get Table
- Create Table

### Fields

- List Fields
- Create Field

### Rows

- List Rows
- Get Row
- Create Row
- Update Row
- Delete Row
- Move Row
- Create Rows (Batch)
- Update Rows (Batch)
- Delete Rows (Batch)

## List of Triggers

This service does not define any triggers.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| **Base URL** | No | Baserow API base URL. Defaults to `https://api.baserow.io` for Baserow Cloud. Self-hosted instances set their own URL (e.g. `https://baserow.example.com`); strip any trailing slash. |
| **API Token** | Yes | A Baserow database token (see below). |

### Getting a database token

Database tokens grant programmatic access to specific databases and are distinct from your account login.

1. In Baserow, click your account name (top left) → **Settings**.
2. Open the **Database tokens** tab.
3. Create a token and grant it the create/read/update/delete permissions you need on the database(s) you want to reach.
4. Copy the token into the **API Token** config item.

All requests authenticate with the `Authorization: Token <apiToken>` header against `{baseUrl}/api`.

## `user_field_names`

By default every row operation sends `user_field_names=true`, so rows are keyed by their **human-readable field names** (e.g. `{"Name":"Acme","Status":"Open"}`) instead of Baserow's internal `field_123` identifiers. Each row operation exposes a **Use Field Names** toggle; turn it off to work with internal field IDs instead.

## Filter syntax

`List Rows` accepts a **Filters** object whose keys use Baserow's `filter__{field}__{type}` convention, mapped to the value to match:

```json
{
  "filter__Name__contains": "Acme",
  "filter__Age__higher_than": "18",
  "filter__Status__single_select_equal": "Open"
}
```

Common filter types include `equal`, `not_equal`, `contains`, `contains_not`, `higher_than`, `lower_than`, `date_equal`, `empty`, and `not_empty`. When you supply more than one filter, the **Filter Type** parameter (`AND` / `OR`) controls how they combine. **Order By** takes a comma-separated list of field names; prefix a name with `-` for descending order (e.g. `-Created,Name`).

## Notes

Baserow returns errors as `{ "error": "ERROR_CODE", "detail": "..." }`. The service surfaces both, throwing `Baserow API error [ERROR_CODE]: <detail>`.

## Agent Ideas

- Use **Google Sheets** "Get Rows" to pull a batch of records from a spreadsheet, then call **Baserow** "Create Rows (Batch)" to import them into a Baserow table in a single request.
- When an **Airtable** "On New or Updated Record" trigger fires, use **Baserow** "Create Row" or "Update Row" to mirror the change into a Baserow table.
- Use **Baserow** "List Rows" with a filter to find rows needing follow-up, then call **Gmail** "Send Message" to email each contact.
