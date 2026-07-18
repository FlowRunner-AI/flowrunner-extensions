# Cloudinary FlowRunner Extension

Manage a Cloudinary media library from FlowRunner: perform signed uploads of images, videos, and raw files from a remote URL or a FlowRunner file, organize and search assets (Lucene-style queries, tags, folders), pre-generate or build on-the-fly transformation URLs, download derived assets to file storage, and monitor account usage. Authenticates with your cloud name plus API key and secret.

## Ideal Use Cases

- Auto-upload files received in a flow (from a URL or FlowRunner file storage) into Cloudinary and get back an optimized secure delivery URL
- Generate resized, cropped, or format-converted delivery URLs (e.g. `w_400,h_300,c_fill,q_auto,f_auto`) to feed optimized media into emails, sheets, or other services
- Organize a media library at scale: tag, move, rename, and search assets, and create or clean up folders
- Download a transformed variant of an asset into file storage to pass on to downstream steps
- Monitor plan credits, storage, and bandwidth usage from an automated flow

## List of Actions

### Upload

- Upload Asset
- Upload from URL

### Asset Management

- Get Asset Details
- List Resources
- Search Assets
- Update Asset
- Rename Asset
- Apply Transformation
- Destroy Asset
- Delete Assets

### Delivery

- Generate Delivery URL
- Download Asset

### Tags

- Manage Tags
- List Tags

### Folders

- List Root Folders
- List Subfolders
- Create Folder
- Delete Folder

### Account

- Get Usage
- Ping

## List of Triggers

This service does not define any triggers.

## Configuration

- **Cloud Name** — your Cloudinary product environment cloud name
- **API Key** — Cloudinary API key
- **API Secret** — Cloudinary API secret (used to sign uploads and delivery URLs)

Upload calls are signed (SHA-1) and sent as multipart; Admin API calls use HTTP Basic auth. Generate Delivery URL builds CDN URLs with no API call and can optionally sign them for environments that restrict unsigned transformations.

## Agent Ideas

- Use **AI Vision** "Analyze Image" to describe an incoming image, then call Cloudinary "Upload Asset" with the generated description as contextual metadata and tags for a searchable, auto-labeled media library
- When a **Dropbox** "On New File" trigger fires, upload the file into Cloudinary with "Upload from URL" (via the Dropbox "Get Temporary Link"), then "Generate Delivery URL" to publish an optimized, resized CDN version
- Use Cloudinary "Search Assets" with a Lucene-style query to find matching assets, "Download Asset" to pull a transformed variant into file storage, and **Google Sheets** "Add Row" to log each asset's public ID and secure URL
