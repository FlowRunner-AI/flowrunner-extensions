# SharePoint FlowRunner Extension

Connect Microsoft SharePoint through the Microsoft Graph API to manage sites, lists, list items, and document libraries. Browse and search sites, read and write list items, upload, move, copy, and share files, and react to new or updated items and files. Connects via OAuth2.

## Ideal Use Cases

- Sync SharePoint list items with external systems like CRMs, databases, and spreadsheets.
- Automate document workflows: upload, organize, share, move, and copy files across libraries.
- Trigger flows when list items or files are created or updated.
- Search across sites, lists, and drives to surface content on demand.
- Provision new lists and folders as part of onboarding or project setup.

## List of Actions

- Copy Drive Item
- Create Folder
- Create List
- Create List Item
- Create Sharing Link
- Delete Drive Item
- Delete List
- Delete List Item
- Download File
- Get Drive Item
- Get Drive Item By Path
- Get Drives
- Get Followed Sites
- Get List
- Get List Item
- Get List Items
- Get Lists
- Get Root Site
- Get Site By ID
- Get Site By Path
- Get User Profile
- List Folder Children
- Move Drive Item
- Search SharePoint
- Search Sites
- Update List Item
- Upload File

## List of Triggers

- On File Updated
- On New File
- On New List Item
- On Updated List Item

## Agent Ideas

- When a **SharePoint** "On New File" trigger fires in a document library, use **Parseur** "Upload Document" to parse the file and extract its structured data.
- Use **Google Sheets** "Get Rows" to read records, then call **SharePoint** "Create List Item" to sync each row into a SharePoint list.
- When a **SharePoint** "On New List Item" trigger fires, use **Outlook** "Send Message" to email the item details to a stakeholder.
