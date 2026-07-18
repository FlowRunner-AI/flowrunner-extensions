# Confluence FlowRunner Extension

Connects FlowRunner to Confluence Cloud through Atlassian OAuth 2.0 (3LO), automatically resolving the connected account's cloudId. Manage spaces, pages, blog posts, footer and inline comments, attachments (including upload/download via FlowRunner file storage), and labels, and search content with CQL.

## Ideal Use Cases

- Publish or update Confluence pages and blog posts programmatically, with version numbers incremented automatically on updates.
- Sync documents and files into Confluence by uploading attachments, then download or link them in later flow steps.
- Build knowledge-base automations: create child pages under a parent, tag content with labels, and organize spaces.
- Monitor and moderate discussion by listing, creating, and deleting footer and inline comments on pages.
- Surface relevant content across the site using CQL search or the convenience Text/Space/Type filters.

## List of Actions

### Spaces
- List Spaces
- Get Space

### Pages
- List Pages
- Get Page
- Get Pages in Space
- Get Child Pages
- Create Page
- Update Page
- Delete Page

### Blog Posts
- List Blog Posts
- Get Blog Post
- Create Blog Post

### Comments
- List Footer Comments on Page
- Create Footer Comment
- Get Comment
- Delete Comment
- List Inline Comments on Page

### Attachments
- List Page Attachments
- Get Attachment
- Upload Attachment
- Download Attachment
- Delete Attachment

### Labels
- Get Page Labels
- Add Labels to Page
- Remove Label from Page

### Search
- Search Content (CQL)

### Users
- Get Current User

## List of Triggers

This service does not define any triggers.

## Authentication

Uses Atlassian OAuth 2.0 (3LO). Provide the **Client ID** and **Client Secret** from your app at https://developer.atlassian.com/console/myapps, with the Confluence classic scopes enabled (read/write content, read/write space, search, read user, attachment download, offline access). On the first call the extension resolves the accessible Confluence Cloud site (cloudId) for the connected account automatically.

## Agent Ideas

- After a **Jira** "Create Issue" fires, use Confluence "Create Page" to publish a linked design or spec page and "Add Labels to Page" to tag it for the project.
- Use **Google Docs** "Export Document" to render a doc, then Confluence "Upload Attachment" to attach it to a page and "Create Footer Comment" to announce the update.
- When a **Slack** "On File Shared" trigger fires, use Confluence "Upload Attachment" to archive the file onto the relevant page, then "Download Attachment" to reuse it in later steps.
