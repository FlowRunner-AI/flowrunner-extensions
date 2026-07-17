# Microsoft OneNote FlowRunner Extension

FlowRunner integration for Microsoft OneNote via the Microsoft Graph API (`/me/onenote`). Work with the signed-in user's notebooks, section groups, sections, and pages: create pages from HTML (images referenced by public URL render on the page), read page content as XHTML, update or append content with structured change commands, and run asynchronous copy operations for notebooks, sections, and pages with built-in wait-for-completion polling.

## Ideal Use Cases

- Automatically capture meeting notes, form submissions, or AI-generated summaries as new OneNote pages
- Append log entries, status updates, or research snippets to an existing page as work progresses
- Scaffold a notebook / section structure for a new project, client, or team
- Duplicate a template notebook, section, or page for each new engagement and track the async copy to completion
- Extract page content as XHTML to feed downstream summarization, search indexing, or archival

## List of Actions

### Notebooks

- Create Notebook, Get Notebook, List Notebooks, List Notebook Sections, Create Section, Copy Notebook

### Section Groups

- List Section Groups, Get Section Group, List Section Group Sections, Create Section in Section Group

### Sections

- List Sections, Get Section, List Section Pages, Copy Section To Notebook, Copy Section To Section Group

### Pages

- Create Page, Get Page, Get Page Content, List Pages, Update Page Content, Copy Page To Section, Delete Page

### Operations

- Get Operation Status

## List of Triggers

This service does not define any triggers.

## Authentication

OAuth2 via Microsoft Entra (login.microsoftonline.com, common tenant). Required delegated Microsoft Graph permissions: `Notes.ReadWrite`, `Notes.Create`, `User.Read`, `offline_access`.

## Configuration

- **Client ID** — Application (client) ID of your Microsoft Entra app registration
- **Client Secret** — Client secret of your Microsoft Entra app registration

## Notes

- Copy actions (Copy Notebook, Copy Section To Notebook, Copy Section To Section Group, Copy Page To Section) run asynchronously on Microsoft's side. By default they poll until completion (up to ~100 seconds); disable Wait For Completion to return immediately and track progress with **Get Operation Status**.
- **Create Page** accepts external image URLs (`<img src='https://…' />`), which OneNote downloads and renders; **Update Page Content** does not support external image URLs.
- Update targets are `data-id` values prefixed with `#`, generated element IDs from **Get Page Content** (with Include Element IDs enabled), or the keywords `body` and `title`.
- For work / school accounts with many sections, prefer **List Section Pages** over **List Pages**; full-text page search is available only on personal accounts with notebooks on consumer OneDrive.

## Agent Ideas

- After **Outlook** "Get Messages List" pulls in a meeting recap thread, call **Microsoft OneNote** "Create Page" to file the summary into a project section, then use "Update Page Content" to append follow-ups as they arrive.
- Use **Microsoft OneNote** "Get Page Content" to extract a spec page as XHTML, then create tracked action items with **Microsoft To Do** "Create Task" for each item.
- When **Microsoft OneDrive** "Upload File" stores a new report, use **Microsoft OneNote** "Create Page" to add a summary page linking to it, keeping notes and files together in the same account.
