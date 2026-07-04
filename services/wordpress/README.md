# WordPress FlowRunner Extension

A complete integration with the self-hosted WordPress REST API (v2). Authenticates with HTTP Basic auth backed by an Application Password and exposes the full content-management surface — posts, pages, categories, tags, users, media, comments, search, settings, and taxonomies — as FlowRunner actions, dictionaries, and a polling trigger.

## Ideal Use Cases

- Auto-publish AI-generated articles to a WordPress blog as drafts for human review.
- Sync product launches, release notes, or knowledge-base entries into WordPress pages.
- Trigger downstream workflows (Slack, email, CRM) the moment a new post is published.
- Bulk-curate categories and tags from spreadsheets or AI classifiers.
- Mirror media assets into the WordPress library from external storage by URL.
- Moderate, edit, or delete comments programmatically.
- Read site-wide settings as part of agent context, or report on the connected user.

## Authentication

This extension uses **HTTP Basic auth** with an Application Password. It does **not** use the user's main login password.

1. Sign in to WordPress as the user the integration should act as. The user must have permission for the operations you intend to perform (Editor or Administrator is typical).
2. Open **Users → Profile → Application Passwords**.
3. Enter a name (e.g. `FlowRunner`) and click **Add New Application Password**.
4. Copy the generated password. Spaces in the displayed value are accepted — the service strips them automatically.

If you do not see the Application Passwords section, ensure the site is served over HTTPS and that no security plugin (WordFence, iThemes Security, etc.) has disabled application passwords.

### Configuration Items

| Field | Required | Description |
|-------|:--------:|-------------|
| `Site URL` | yes | Full origin of the WordPress site, including protocol. Example: `https://yoursite.com`. Trailing slashes are removed automatically. |
| `Username` | yes | WordPress login of the user whose Application Password is being used. |
| `Application Password` | yes | The Application Password generated in step 4 above. |

## List of Actions

### Posts

- List Posts
- Get Post
- Create Post
- Update Post
- Delete Post

### Pages

- List Pages
- Get Page
- Create Page
- Update Page
- Delete Page

### Categories

- List Categories
- Get Category
- Create Category
- Update Category
- Delete Category

### Tags

- List Tags
- Get Tag
- Create Tag
- Update Tag
- Delete Tag

### Users

- List Users
- Get User
- Get Current User
- Create User
- Update User
- Delete User

### Media

- List Media
- Get Media
- Upload Media From URL
- Update Media
- Delete Media

### Comments

- List Comments
- Get Comment
- Create Comment
- Update Comment
- Delete Comment

### Search

- Search Site

### Settings

- Get Settings
- Update Settings

### Taxonomies

- List Taxonomies
- List Post Types

## List of Dictionaries

These DICTIONARY methods power dropdowns inside other actions and are also callable directly.

- Get Categories Dictionary
- Get Tags Dictionary
- Get Authors Dictionary

## List of Triggers

- **On New Published Post** (POLLING) — fires for each new published post since the previous poll. Optional category filter. Polling interval can be customized (minimum 30 seconds).

## Notes & Limitations

- **Force-deletes**: WordPress does not support trashing for categories, tags, users, or media. The corresponding delete actions in this extension always send `force=true`. For posts, pages, and comments the `Force` toggle is honoured (off → trash, on → permanent delete).
- **User deletion** requires a `Reassign To` user ID so WordPress can transfer the deleted user's posts to another account.
- **Update Settings** requires the connected user to have `manage_options` (Administrator). Use cautiously — settings changes affect the entire site.
- **Upload Media From URL** downloads the source URL through the FlowRunner runtime and then uploads the bytes to WordPress as `multipart/form-data`. Large files may exceed the runtime download budget; for big assets prefer uploading directly inside WordPress.
- **Comments**: when omitting `Author User ID`, supply `Author Name` and `Author Email` so the WordPress moderation pipeline can attribute the comment.
- **Application Passwords vs OAuth**: this extension targets self-hosted WordPress using REST + Application Passwords. WordPress.com hosted sites require a different OAuth flow and are not in scope.

## Agent Ideas

- When a **Google Sheets** "On New Row" trigger fires with a content brief, use **WordPress** "Upload Media From URL" to add the cover image and "Create Post" with status `draft` to stage the article for review.
- When **WordPress** "On New Published Post" fires, use **Slack** "Send Message To Channel" to notify the marketing channel and **X-Twitter** "Create Post" to announce the article.
- When a **Gmail** "On New Email" trigger detects a new contributor submission, use **WordPress** "Create User" to onboard them with the `author` role and "Create Post" to seed their first draft.
