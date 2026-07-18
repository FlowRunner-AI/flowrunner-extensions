# CloudConvert FlowRunner Extension

Convert, merge, capture, optimize, archive, and inspect files through the CloudConvert v2 API. Every conversion action accepts a public URL or a FlowRunner file, and by default waits for the job to finish and saves the output back to FlowRunner file storage. Raw job graphs and job/task management give full access to CloudConvert pipelines when the convenience actions are not enough.

## Ideal Use Cases

- Convert incoming documents, images, audio, or video between 200+ formats within a flow
- Merge a batch of files (Office docs, images, PDFs) into a single PDF for reports or invoices
- Capture a webpage as a PDF or screenshot for archiving or notifications
- Shrink PDFs and images, or generate thumbnails, before storing or emailing them
- Bundle generated files into a ZIP/7Z/TAR archive for delivery
- Extract PDF, image EXIF, or video metadata to drive downstream logic
- Build arbitrary multi-step conversion pipelines with raw job graphs and monitor them via jobs/tasks

## List of Actions

### Conversion
- Capture Website
- Convert File
- Create Archive
- Create Thumbnail
- Extract Metadata
- Merge Files to PDF
- Optimize File

### Jobs
- Create Job
- Delete Job
- Get Job
- List Jobs

### Tasks
- Get Task
- List Tasks

### Reference
- List Supported Formats

### Account
- Get Current User

## List of Triggers

This service does not define any triggers.

## Configuration

- **API Key** — create at cloudconvert.com under Dashboard → Authorization → API Keys with at least the `task.read` and `task.write` scopes.
- **Environment** — Production (`api.cloudconvert.com`, default) or Sandbox (`api.sandbox.cloudconvert.com`) for free testing with whitelisted files; the Sandbox requires its own API key created in the CloudConvert Sandbox dashboard.

## Notes

- Conversion actions (Convert File, Merge Files to PDF, Capture Website, Optimize File, Create Archive, Create Thumbnail) wait for completion and save outputs to FlowRunner file storage by default; disable Wait For Completion to return immediately and poll later with Get Job.
- Create Job outputs are **not** auto-saved — retrieve temporary download URLs from each task's `result.files`.
- CloudConvert deletes jobs automatically 24 hours after they end; use Delete Job to remove sensitive files sooner.

## Agent Ideas

- When a **Dropbox** "On New File" trigger fires, call **CloudConvert** "Convert File" to convert the file to PDF, then store the result back with **Dropbox** "Upload File from URL".
- Use **Google Drive** "Download File" to pull a set of source files, then **CloudConvert** "Merge Files to PDF" to combine them into one report and re-upload with **Google Drive** "Upload File".
- After **CloudConvert** "Capture Website" saves a webpage screenshot to storage, use **Gmail** "Send Message" to email the capture to stakeholders as an attachment.
