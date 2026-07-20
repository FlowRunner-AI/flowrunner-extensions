# SFTP FlowRunner Extension

Transfer and manage files on any SFTP (SSH File Transfer Protocol) server. Browse directories, stat and check paths, download files into FlowRunner file storage or read them inline as text, upload from a FlowRunner file, a public URL, or raw text content, and rename, delete, chmod, and manage remote directories. Authenticates by password, by OpenSSH private key (with optional passphrase), or both. Each action opens a fresh SSH session over the `ssh2-sftp-client` driver and tears it down when done — no pooled or cached connections.

## Ideal Use Cases

- Pull data drops (CSV, JSON, XML) that a partner deposits on their SFTP server and hand them to downstream parsing or database steps
- Push generated reports, invoices, or exports to a customer's or vendor's SFTP inbox on a schedule
- Bridge a legacy SFTP-based file exchange to modern cloud storage, email, or spreadsheets
- Poll a directory, process new files, then rename or move them into a "processed" folder to avoid reprocessing
- Housekeeping: create dated directories, set file permissions, and clean up old files or folders

## List of Actions

### Browse
- Check Path Exists
- Get File Info
- List Directory

### Download
- Download File
- Read File as Text

### Upload
- Upload File
- Upload File from URL
- Upload Text Content

### Files
- Change Permissions
- Delete File
- Rename / Move File

### Directories
- Create Directory
- Remove Directory

## List of Triggers

This service does not define any triggers.

## Configuration

Set these config items on the service. All are non-shared (per-account).

- **Host** (required) — SFTP server hostname or IP, e.g. `sftp.example.com`. Must be reachable from FlowRunner and publish an IPv4 (A) record.
- **Port** — TCP port of the SFTP/SSH server. Defaults to `22`.
- **Username** (required) — the user to authenticate as.
- **Password** — password for the user. Leave empty when using a Private Key.
- **Private Key** — full OpenSSH private key block (`-----BEGIN OPENSSH PRIVATE KEY-----` … `-----END OPENSSH PRIVATE KEY-----`). Leave empty when using a Password.
- **Private Key Passphrase** — passphrase that decrypts an encrypted Private Key. Leave empty for an unencrypted key or password auth.

Provide a Password, a Private Key, or both; at least one credential is required.

## Notes

- **This is SFTP-over-SSH, not FTP.** The default port is `22` (SSH), not `21` (plain FTP) or `990` (FTPS). Those protocols are not supported.
- **Connection model.** A short-lived `ssh2-sftp-client` session is created, connected, used, and always disconnected per action. Connections are never pooled or reused between calls.
- **IPv6 egress.** The FlowRunner runtime has no IPv6 route. If the host resolves to an IPv6-only address the connection fails with `ENETUNREACH` — use a host that also publishes an IPv4 (A) record, or connect by IPv4 address. This is the same caveat as the database services.
- **Text vs. stored files.** *Download File* stores the file in FlowRunner file storage and returns a `fileUrl`; *Read File as Text* returns contents inline (UTF-8, Base64, or Latin-1) without staging a file. Both load the whole file into memory, so prefer *Download File* for large or binary files.
- **Destructive operations.** *Remove Directory* with Recursive on deletes the directory and all its contents permanently. *Delete File* only removes files (use *Remove Directory* for directories); enable Ignore Missing for idempotent deletes.

## Agent Ideas

- Use **SFTP** "List Directory" then "Download File" to pull a partner's daily CSV drop, and **Google Sheets** "Add Rows" to load each row into a tracking spreadsheet.
- When a **Google Sheets** "On New Row" trigger fires, build a report with **SFTP** "Upload Text Content" to push a CSV line straight to a vendor's SFTP inbox, then **Gmail** "Send Message" to notify the recipient.
- Use **SFTP** "Download File" to fetch an invoice PDF, run **PDF.co** "Parse Invoice with AI" to extract its fields, then **SFTP** "Rename / Move File" to move the processed file into an archive folder.
