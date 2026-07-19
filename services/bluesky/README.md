# Bluesky FlowRunner Extension

Publish and manage content on [Bluesky](https://bsky.app) through the AT Protocol XRPC API. Posts get automatic rich-text facets, so links, @mentions and #hashtags in your text render as clickable without any manual markup. Anywhere a post reference is needed you can pass either an `at://` URI or a regular `bsky.app` post URL. Self-hosted PDS instances are supported.

## Ideal Use Cases

- Cross-post announcements, blog links or release notes to Bluesky automatically from other tools
- Turn AI-generated copy and images into ready-to-publish posts (300-character limit, one image up to 1 MB)
- Monitor mentions, replies and keyword searches, then reply, quote or repost programmatically
- Sync a content calendar (spreadsheet or Airtable) into published Bluesky posts
- Grow and maintain a social graph: follow/unfollow, mute/unmute and audit followers and follows
- Resolve handles to stable DIDs and hydrate known posts for engagement tracking

## List of Actions

### Posting

- Create Post
- Create Post with Image
- Reply to Post
- Quote Post
- Repost
- Like Post
- Delete Post

### Feeds & Search

- Get Timeline
- Get Author Feed
- Get Post Thread
- Get Posts
- Search Posts

### Profiles

- Get Profile
- Get Profiles
- Search Users

### Social Graph

- Follow User
- Unfollow User
- Get Followers
- Get Follows
- Mute User
- Unmute User

### Notifications

- List Notifications
- Mark Notifications Seen

### Identity

- Resolve Handle

## List of Triggers

This service does not define any triggers.

## Authentication

Connect with an **App Password** — not your main account password. Create one in the Bluesky app under Settings -> Privacy and Security -> App Passwords. The service opens a session via `com.atproto.server.createSession`. Configuration items:

- **Identifier** — your handle (e.g. `alice.bsky.social`) or account email
- **App Password** — the generated app password
- **PDS URL** — defaults to `https://bsky.social`; change only for a self-hosted PDS

Notes: posts are capped at 300 characters, images at 1 MB (PNG, JPEG, WebP, GIF, AVIF). Removing a like is not supported (it requires the like record's own key). Bluesky rate-limits session creation (~30 sign-ins per 5 minutes per account), so batch high-frequency flows.

## Agent Ideas

- Use **AI Image Generator** "Generate Image" to render a visual, then call **Bluesky** "Create Post with Image" to publish it with an auto-formatted caption including links and hashtags
- Read scheduled content with **Google Sheets** "Get Rows" and call **Bluesky** "Create Post" for each due row, writing the returned `bsky.app` URL back with "Add Row"
- Fetch a campaign calendar via **Airtable** "Get Records" and call **Bluesky** "Create Post" or "Quote Post" for each entry to drive announcements from a single source of truth
