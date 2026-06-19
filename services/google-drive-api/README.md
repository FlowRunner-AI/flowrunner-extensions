# Google Drive FlowRunner Extension

Complete Google Drive automation for file management, content processing, and collaborative workflows. Upload, organize, share, copy, export, and read files, and trigger actions based on file system changes.

## Ideal Use Cases

- Automating document processing workflows and file organization systems
- Managing collaborative file sharing and permission control
- Processing uploaded files for content analysis and data extraction
- Building automated backup and archival systems for business documents
- Creating dynamic file organization based on content analysis and metadata
- Monitoring folders for new uploads to trigger immediate processing
- Integrating file operations with project management and workflow systems
- Generating reports and documents automatically and storing them in organized structures

## List of Actions

- Add File Sharing Preference
- Copy File
- Create File
- Create Folder
- Create Shortcut
- Delete File
- Download File
- Export File
- Find File
- Find Folder
- Find Multiple Files
- Get File Content
- Get File Data
- Get Folder Listing
- Move File
- Rename File/Folder
- Upload File

## List of Triggers

- On File Updated
- On New File
- On New Folder

## Agent Ideas

- When a **Google Drive** "On New File" trigger fires, use "Get File Content" to read the document and **Gmail** "Send Message" to email a summary to the team.
- Use **PDF.co** "Parse Invoice with AI" on a downloaded invoice, then **Google Sheets** "Add Row" to log the data and **Google Drive** "Move File" to archive the original.
- When a **Google Drive** "On New Folder" trigger fires, use "Add File Sharing Preference" to grant access and **Gmail** "Send Message" to notify collaborators.
