# Canva FlowRunner Extension

Integrates the Canva Connect API with FlowRunner to manage designs, export them as PDF/PNG/JPG/PPTX/GIF/MP4 files, upload assets to the Canva media library, organize folders, and autofill brand templates. Authenticates via OAuth2 with PKCE. The async export, asset-upload, and autofill jobs each offer an "and Wait" variant that polls to completion; exported files are saved to FlowRunner file storage as durable URLs (Canva's own download URLs expire after 24 hours).

## Ideal Use Cases

- Programmatically generate branded documents by autofilling Canva Enterprise brand templates with data from a spreadsheet, CRM, or form submission
- Export finished Canva designs to PDF or image files and route them into email, storage, or downstream document workflows
- Sync images and media into the Canva media library as reusable assets for design creation and autofill
- Organize a team's designs and assets into Canva project folders as part of a content pipeline

## List of Actions

- **Designs:** Create Design, Get Design, List Designs
- **Exports:** Export Design, Export Design and Wait, Get Export Job
- **Assets:** Delete Asset, Get Asset, Get Asset Upload Job, Update Asset, Upload Asset, Upload Asset and Wait
- **Folders:** Create Folder, Delete Folder, Get Folder, List Folder Items, Move Folder Item, Update Folder
- **Brand Templates (Enterprise):** Get Brand Template, Get Brand Template Dataset, List Brand Templates
- **Autofill (Enterprise):** Autofill Design, Autofill Design and Wait, Get Autofill Job
- **Users:** Get Current User, Get User Profile

## List of Triggers

This service does not define any triggers.

## Authentication

OAuth2 with mandatory PKCE. Create an integration at [canva.com/developers/integrations](https://www.canva.com/developers/integrations) and supply its Client ID and Client Secret. Scopes requested: `asset:read`, `asset:write`, `design:content:read`, `design:content:write`, `design:meta:read`, `brandtemplate:meta:read`, `brandtemplate:content:read`, `folder:read`, `folder:write`, `profile:read`.

## Notes

- New integrations start in **preview mode** — only members of the developer's own Canva team can connect them. Production use by other users requires submitting the integration for Canva's review and approval.
- **Brand Templates** and **Autofill** actions are a Canva Enterprise feature and fail for users on other Canva plans.
- Design contents cannot be read directly through the Connect API; use Export Design (or Export Design and Wait) to obtain a design as a file.

## Agent Ideas

- Use **Airtable** "Get Records" to pull row data, call **Canva** "Autofill Design and Wait" to render a branded design from a brand template for each row, then "Export Design and Wait" to produce a shareable PDF
- After **Canva** "Export Design and Wait" saves an exported file to FlowRunner storage, use **Google Drive** "Upload File" to archive the finished design into a shared team folder
- When a **Gmail** "On New Attachment" trigger fires, use **Canva** "Upload Asset and Wait" to add the image to the Canva media library, then "Create Design" seeded with that asset
