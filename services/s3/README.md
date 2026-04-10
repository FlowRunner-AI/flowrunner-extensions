# S3 Storage FlowRunner Extension

Universal S3-compatible object storage integration supporting 13+ providers including Amazon S3, Cloudflare R2, DigitalOcean Spaces, Backblaze B2, MinIO, Wasabi, and more. Manage buckets and objects with two authentication methods: direct API Key credentials or IAM Role via STS AssumeRole for cross-account access.

## Ideal Use Cases

- Uploading and organizing files in S3-compatible storage from automated workflows
- Generating temporary presigned URLs for secure, time-limited file sharing
- Backing up files or external data to cloud object storage
- Copying objects across buckets for archival, migration, or replication workflows
- Monitoring bucket contents and verifying object existence before processing
- Bulk-deleting objects for automated storage cleanup and lifecycle management
- Transferring files from external URLs directly into S3 without intermediate steps

## List of Actions

### Bucket Management

- Create Bucket
- Delete Bucket
- List Buckets

### Object Management

- Check Object Exists
- Copy Object
- Delete Multiple Objects
- Delete Object
- Get Object Metadata
- Get Presigned URL
- List Objects
- Upload Object
- Upload Object from URL

## Agent Ideas

- When a "File Uploaded" trigger fires, use **S3 Storage** "Upload Object from URL" to replicate the file into an S3 bucket for off-site backup, then use **Slack** "Send Message To Channel" to notify the team with the object key and bucket name.
- Use **S3 Storage** "List Objects" to scan a bucket for new report files, then call **Gmail** "Send Message" with a **S3 Storage** "Get Presigned URL" link so recipients can securely download each report without AWS credentials.
- When a **Google Sheets** "On New Row" trigger fires with asset metadata, use **S3 Storage** "Upload Object from URL" to fetch and store each asset in S3, then use **Google Sheets** "Update Row" to write back the object key and storage confirmation.