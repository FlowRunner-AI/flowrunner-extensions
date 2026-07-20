# TikTok FlowRunner Extension

Connect to a TikTok account via OAuth2 (TikTok Login Kit) to read the connected user's profile and video analytics through the Display API and to publish videos and photo carousels through the Content Posting API. Supports posting from a public URL or an uploaded FlowRunner file, plus a wait-for-completion convenience that polls until the post is live.

## Ideal Use Cases

- Auto-publish videos to TikTok when new content is produced elsewhere in a flow (from a public URL or a stored FlowRunner file)
- Cross-post the same video or image set to TikTok alongside other social channels
- Publish a photo carousel and track its processing status until it goes live
- Pull a creator's video list and engagement counts (views, likes, comments, shares) for reporting or content analysis
- Verify a connection and fetch profile stats (follower/following/likes/video counts) as a health check

## List of Actions

### Content Posting

- Query Creator Info
- Post Video from URL
- Post Video from File
- Post Photos
- Get Post Status
- Post Video and Wait

### User

- Get User Info

### Videos

- List Videos
- Query Videos

## List of Triggers

This service does not define any triggers.

## Configuration & Authentication

Authenticate with OAuth2 (TikTok Login Kit). Two config items are required:

- **Client Key** (`clientId`) — the TikTok app "Client key" from https://developers.tiktok.com/apps (TikTok's authorize endpoint uses the `client_key` parameter).
- **Client Secret** (`clientSecret`) — the TikTok app client secret.

Scopes requested: `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`, `video.publish`, `video.upload`.

## Important Gating Notes

- **Private-only until audited.** Unaudited TikTok apps can only publish with the `SELF_ONLY` ("Private") privacy level. Public visibility (Public / Followers / Friends) requires passing TikTok's app audit. Always call **Query Creator Info** before posting and only use privacy levels present in the returned `privacy_level_options`.
- **Direct Post domain verification.** Posting via `PULL_FROM_URL` (Post Video from URL, Post Photos, Post Video and Wait) requires the source domain to be verified in the TikTok developer portal, or TikTok rejects the request.
- **File upload size cap.** Post Video from File uploads in a single chunk and is limited to 64 MB; for larger videos, host the file publicly and use Post Video from URL.
- `privacy_level` values are `PUBLIC_TO_EVERYONE`, `FOLLOWER_OF_CREATOR`, `MUTUAL_FOLLOW_FRIENDS`, `SELF_ONLY` (note: `MUTUAL_FOLLOW_FRIENDS`, not `MUTUALLY_...`).

## Agent Ideas

- Use **AI Image Generator** "Generate Image" to create carousel visuals, then call **TikTok** "Post Photos" (after "Query Creator Info") to publish them as a photo post
- After **YouTube** "Upload Video" completes, cross-post the same clip with **TikTok** "Post Video from URL" and track it via "Get Post Status"
- Store a rendered video in **Dropbox**, get a fetchable link with "Get Temporary Link", then hand it to **TikTok** "Post Video and Wait" to publish and confirm the post is live in one call
