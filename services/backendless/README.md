# Backendless Service FlowRunner Extension

Unified Backendless platform integration combining database operations, file management, messaging, PDF generation, and real-time event triggers across your Backendless applications. Connects via OAuth2.

## Ideal Use Cases

- Automating database CRUD operations across Backendless apps with dynamic table schemas
- Reacting to record changes, file uploads, counter updates, and user registrations in real time
- Sending templated emails and push notifications from automated workflows
- Managing files and directories in Backendless storage programmatically
- Generating PDF documents from HTML templates with dynamic field substitution

## List of Actions

- Add To File
- Create Directory
- Create File
- Delete File
- Delete Record In Database
- Delete Records In Database
- Find Record(s) in Database
- Generate PDF
- List Directory
- Save Record In Database
- Send Email
- Send Push Notification
- Update Records With Query

## List of Triggers

- Counter: Add And Get
- Counter: Compare And Set
- Counter: Decrement And Get
- Counter: Get And Add
- Counter: Get And Decrement
- Counter: Get And Increment
- Counter: Increment And Get
- Counter: Reset
- File Copied
- File Deleted
- File Moved
- File Renamed
- File Uploaded
- On New User Registered
- On Push Notification Published
- On Push Notification Sent From Template
- On Record Created
- On Record Deleted
- On Record Updated
- Timer: Execute

## Agent Ideas

- When a Backendless "On Record Created" trigger fires, use **Google Sheets** "Add Row" to log details and **Slack** "Send Message To Channel" to notify the team
- When a Backendless "File Uploaded" trigger fires, use **Gemini AI** "Generate Content" to analyze the document and Backendless "Save Record In Database" to store extracted metadata
- Use Backendless "Find Record(s) in Database" to fetch pending customers, then **Gmail** "Send Message" to deliver personalized onboarding emails
