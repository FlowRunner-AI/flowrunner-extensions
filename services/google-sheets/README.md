# Google Sheets FlowRunner Extension

Comprehensive Google Sheets integration via OAuth2 for reading, writing, and managing spreadsheet data. Supports real-time and polling triggers for new rows, updated rows, and document changes — plus CSV import and file export to FlowRunner storage.

## Ideal Use Cases

- Capturing form submissions or webhook data as new rows in a spreadsheet
- Monitoring a sheet for new or updated rows and triggering downstream automation
- Exporting spreadsheets as Excel, CSV, or PDF files and storing the download URL
- Syncing CRM or database records to a Google Sheet as a reporting layer
- Building data pipelines that read, transform, and write rows across multiple sheets

## List of Actions

- Add Document
- Add Row
- Add Rows
- Add Sheet
- Clear Cell
- Clear Cell by A1
- Clear Row
- Clear Rows or Cells Area
- Copy Sheet to Document
- Delete Document
- Delete Sheet
- Export Document
- Export Sheet
- Find Row
- Find Rows
- Find Sheet
- Format Row
- Get Cell
- Get Cell by A1
- Get Drives
- Get Last Row
- Get Rows
- Get Sheet Columns
- Get Sheets List
- Get Spreadsheets
- Import from CSV
- Load Header Row
- Rename Document
- Rename Sheet
- Set Header Row
- Update Cell
- Update Cell by A1
- Update Row
- Update Rows

## List of Triggers

- On Document Changed
- On New Document
- On New Row
- On New Sheet
- On New or Updated Row

## Agent Ideas

- When a **Google Sheets** "On New Row" trigger fires with a new lead, use **Brevo** "Create Contact" to add the lead to the CRM and **Slack** "Send Message To Channel" to notify the sales team
- Use **Google Sheets** "Export Sheet" to generate an Excel file on a schedule and pass the URL to **Gmail** "Send Message" as a daily report attachment
- When a **Typeform** submission arrives, use **Google Sheets** "Add Row" to log the response and **ElevenLabs** "Text to Speech" to generate a personalised audio confirmation