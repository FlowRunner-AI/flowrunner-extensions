# Instagram for Business FlowRunner Extension

Publish and manage content on Instagram Business/Creator accounts through the Meta Graph API. Publish photos, reels, stories, and carousels via the container-then-publish flow with automatic status polling; list and inspect media; moderate comments (including hide and reply); pull account and media insights; and search public hashtags. Instagram account parameters auto-resolve to the connected Business/Creator account when left blank.

## Ideal Use Cases

- Automatically publish AI-generated or curated photos, reels, and stories on a schedule
- Cross-post content from other platforms into an Instagram carousel or single-media post
- Monitor and moderate comments by replying to, hiding, or deleting them programmatically
- Track account growth and post performance by pulling account and media insights into reports
- Discover trending content by searching hashtags and fetching their top or recent media

## List of Actions

### Publishing
- Publish Photo
- Publish Reel
- Publish Story
- Publish Carousel
- Get Container Status
- Get Publishing Limit

### Media
- List Media
- Get Media
- Get Media Children

### Comments
- List Comments
- Get Comment
- Create Comment
- Reply to Comment
- Hide or Unhide Comment
- Delete Comment

### Insights
- Get Account Insights
- Get Media Insights

### Account
- Get Account Info
- List Connected IG Accounts
- Get Tagged Media

### Hashtags
- Search Hashtag
- Get Hashtag Top Media
- Get Hashtag Recent Media

## List of Triggers

This service does not define any triggers.

## Authentication

OAuth2 via Meta (Graph API `v25.0`). Provide a Meta app **App Client ID** and **App Client Secret** (both shared). The connect flow requests these scopes:

`instagram_basic instagram_content_publish instagram_manage_comments instagram_manage_insights pages_show_list business_management`

**Requirements and gating:**

- The Instagram account must be a **Business or Creator** account and **linked to a Facebook Page**.
- `instagram_content_publish` requires **Meta App Review Advanced Access** for public/production use. In **Development mode** you can publish to your own connected accounts without review.
- Some hashtag and insight features have per-account limits (see Notes).

## Configuration

| Setting | Required | Description |
| ------- | -------- | ----------- |
| App Client ID | Yes | Meta app App ID with the Instagram Graph API product added. |
| App Client Secret | Yes | Meta app App Secret. |

Every action accepts an optional **Instagram Account ID** parameter, backed by the connected-accounts dictionary. When left empty, the service resolves the first Instagram Business account linked to your Pages (via `GET /me/accounts`) and caches it for the invocation. A recent-media dictionary similarly powers media-selection parameters.

## Notes

- **Publishing is a two-step flow.** A media container is created (`POST /{ig-user-id}/media`), then published (`POST /{ig-user-id}/media_publish`). Image and image-story containers are ready immediately; video/reel/carousel-video containers are polled on `GET /{creation-id}?fields=status_code` every 5 seconds until `FINISHED`. `ERROR`/`EXPIRED` statuses are surfaced with the reported reason. Reel/Story/Carousel actions use an extended 600-second execution timeout to allow for transcoding.
- **Publishing rate limit:** up to **50 API-published posts per 24-hour** rolling window (a carousel counts as one). Check **Get Publishing Limit** before bulk publishing.
- **Account insights `metric_type`:** interaction metrics (Reach, Accounts Engaged, Total Interactions, Likes, Comments, Shares, Saves) require `metric_type=total_value`; time-series metrics (Follower Count, Profile Views) return per-period values. Mixing the two metric families in one call is rejected by the API, so select one family at a time.
- **Media insights availability varies by media type** (image, video/reel, carousel, story). Reach and Total Interactions are the most broadly supported; requesting an unsupported metric for a given media returns an API error.
- **Hashtag query limit:** an account may query up to **30 unique hashtags per rolling 7-day** window across Search Hashtag / Top Media / Recent Media.

## Agent Ideas

- Use **AI Image Generator** "Generate Image" to create post artwork, then call **Instagram for Business** "Publish Photo" to publish it and "Create Comment" to seed the first comment with a hashtag set.
- Use **Google Drive** "Download File" to pull approved marketing assets, then call **Instagram for Business** "Publish Carousel" to post them as a multi-image carousel.
- On a schedule, call **Instagram for Business** "Get Account Insights" and "Get Media Insights", then use **Google Sheets** "Add Row" to log follower growth and post performance into a tracking spreadsheet.
