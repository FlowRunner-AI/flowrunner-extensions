# Box FlowRunner Extension

Connect FlowRunner to [Box](https://www.box.com/) to manage cloud files and folders, control
sharing, and coordinate collaborators. The extension authenticates with OAuth2 and covers the
full file and folder lifecycle — upload (including large, chunked uploads), download, organize,
version, comment, task, apply metadata, share, search, and recover from trash — plus
collaboration management and real-time webhook triggers on any item.

## Ideal Use Cases

- Upload generated documents, exports, or attachments straight into a Box folder.
- Upload large files (over 50 MB) reliably with the chunked upload action.
- Download a Box file into Backendless storage for further processing in a flow.
- Organize content programmatically: create folders, move, copy, rename, or delete files and folders.
- Manage a file's version history: list, fetch, promote, or delete older versions.
- Collaborate on documents with comments and review/complete tasks.
- Apply, read, and remove enterprise metadata templates on files.
- Share files or folders by creating password-protected, expiring shared links.
- Grant or revoke access by adding, updating, and removing collaborators (users or groups) on files and folders.
- Find content across an account or enterprise with full-text search before acting on it.
- Recover or permanently remove items from the trash.
- React to Box events in real time (file, folder, and collaboration changes) with webhook triggers.

## List of Actions

**Files**
- Upload File
- Upload Large File
- Get File Info
- Download File
- Update File
- Move File
- Copy File
- Delete File

**Versions**
- List File Versions
- Get File Version
- Promote File Version
- Delete File Version

**Folders**
- Create Folder
- Get Folder Info
- List Folder Items
- Update Folder
- Move Folder
- Copy Folder
- Delete Folder

**Sharing**
- Create File Shared Link
- Create Folder Shared Link
- Remove Shared Link

**Collaborations**
- Add Collaboration
- Get Collaboration
- List Folder Collaborations
- List File Collaborations
- Update Collaboration
- Remove Collaboration

**Comments**
- Create Comment
- List File Comments
- Get Comment
- Update Comment
- Delete Comment

**Tasks**
- Create Task
- List File Tasks
- Get Task
- Update Task
- Delete Task

**Metadata**
- Create Metadata Instance
- Get Metadata Instance
- List Metadata Instances
- Delete Metadata Instance

**Trash**
- List Trashed Items
- Restore File
- Restore Folder
- Permanently Delete File
- Permanently Delete Folder

**Search & Account**
- Search Content
- Get Current User

## List of Triggers

These are real-time webhook triggers (SINGLE_APP). Box delivers events to a callback URL; the
extension verifies each delivery's signature using the webhook signature keys you set in the Box
Developer Console.

- On File Event — fires when a watched file is uploaded, deleted, moved, renamed, and more.
- On Folder Event — fires when a watched folder is created, renamed, moved, deleted, or a file is uploaded into it.
- On Collaboration Event — fires when collaboration on a watched folder is created, accepted, rejected, updated, or removed.

## Configuration

- **Client ID** / **Client Secret** — from your Box app (developer.box.com).
- **Webhook Primary Signature Key** / **Webhook Secondary Signature Key** — from the Box Developer
  Console (your app → Webhooks → Manage signature keys). Required to verify incoming webhook payloads
  for the triggers above.
