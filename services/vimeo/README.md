# Vimeo FlowRunner Extension

Manage a connected Vimeo account through the Vimeo API (v3.4) via OAuth2: list, search, update, and delete videos, upload videos from a public URL (pull approach) with transcode-status polling, and work with thumbnails, folders (projects), showcases (albums), channels, comments, likes, text tracks, and users. Every parameter that expects a video, showcase, channel, or user accepts a numeric id, an API URI (e.g. `/videos/123456789`), or a `vimeo.com` URL.

## Ideal Use Cases

- Publish AI-generated or externally hosted videos into Vimeo from a file URL, then poll until transcoding completes and the video is playable.
- Maintain a video library programmatically: rename, re-describe, change privacy, organize into folders, and curate into shareable showcases.
- Refresh a video's thumbnail by capturing a frame at a chosen time offset.
- Discover public Vimeo content by keyword and pull metadata into content pipelines or reports.
- Automate engagement: like videos, post comments, and monitor comment threads.

## List of Actions

### Videos
- List My Videos
- Get Video
- Update Video
- Delete Video
- Search Public Videos

### Upload
- Upload Video from URL
- Get Upload Status

### Thumbnails
- List Video Thumbnails
- Set Thumbnail from Frame

### Folders
- List Folders
- Create Folder
- Add Video to Folder

### Showcases
- List Showcases
- Get Showcase
- Create Showcase
- Add Video to Showcase

### Channels
- List My Channels
- Get Channel

### Comments
- List Video Comments
- Add Comment to Video

### Likes
- Like Video
- Unlike Video
- List Liked Videos

### Text Tracks
- List Text Tracks

### Users
- Get Current User
- Get User

## List of Triggers

This service does not define any triggers.

## Configuration

- **Client Id** (shared, required) - The Client Identifier of your Vimeo app from https://developer.vimeo.com/apps.
- **Client Secret** (shared, required) - The Client Secret of your Vimeo app from https://developer.vimeo.com/apps.

## Notes

- **Authentication:** OAuth2 (authorization code flow) with scopes `public private create edit delete upload interact stats`. Vimeo access tokens do not expire and Vimeo issues no refresh tokens, so the token is stored and reused as-is.
- **Upload access gating:** the general API works immediately, but the `upload` capability must be requested from Vimeo (a routine review from the app settings page). Until granted, **Upload Video from URL** fails with a 403 error. Uploads also count against the account's storage quota.
- **Pull upload:** **Upload Video from URL** returns immediately while Vimeo downloads and transcodes the file in the background — poll **Get Upload Status** until the transcode status is `complete` before the video is playable.
- List actions return a flat `{ items, total, page, perPage, nextPage }` object; `nextPage` is present only when more results exist.

## Agent Ideas

- Use **YouTube** "Upload Video" alongside **Vimeo** "Upload Video from URL" to cross-post the same source video to both platforms, then poll **Vimeo** "Get Upload Status" until transcoding completes before sharing the link.
- After **Google Drive** "Download File" produces a shareable file URL for a rendered video, call **Vimeo** "Upload Video from URL" to publish it, then **Vimeo** "Add Video to Showcase" to curate it into a client-facing collection.
- Run **Vimeo** "List Video Comments" to gather new feedback on a video, then use **Gmail** "Send Message" to email a digest of the latest comments to the content team.
