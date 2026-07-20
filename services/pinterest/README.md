# Pinterest FlowRunner Extension

Manage a Pinterest account through the [Pinterest API v5](https://developers.pinterest.com/docs/api/v5/): read the connected profile and analytics, organize boards and board sections, create image, carousel, and full async video pins, save (repin) existing pins, and search your own content. Authenticates via OAuth2.

## Ideal Use Cases

- Auto-publish marketing image or carousel pins to a board from a content pipeline
- Upload marketing videos as video pins straight from FlowRunner file storage
- Keep boards and sections organized programmatically as new content is produced
- Pull account and per-pin engagement analytics into a reporting workflow
- Repin curated content into campaign boards and search your own pins/boards

## List of Actions

- **User** — Get User Account, Get User Account Analytics
- **Boards** — List Boards, Get Board, Create Board, Update Board, Delete Board, List Board Pins
- **Board Sections** — List Board Sections, Create Board Section, List Section Pins, Delete Board Section
- **Pins** — Create Pin, Create Video Pin, Get Pin, Update Pin, Delete Pin, List Pins, Save Pin to Board, Get Pin Analytics
- **Search** — Search My Pins, Search My Boards
- **Media** — Register Media Upload, Get Media Upload Status

## List of Triggers

This service does not define any triggers.

## Authentication

OAuth2 (authorization code flow). Create a Pinterest app at <https://developers.pinterest.com/apps> and supply its **App ID** (Client Id) and **App secret** (Client Secret) as shared config items. Access tokens last ~30 days and are refreshed automatically using the long-lived refresh token.

## Access Levels (important)

New Pinterest apps start with **Trial access**: rate-limited and restricted to the connected account's own data. **Standard access** — required for analytics endpoints and broader search — plus a **business** Pinterest account is granted only after Pinterest reviews your app. Get User Account Analytics and Get Pin Analytics need a business account with Standard access.

## Notes

- **Create Pin** builds a standard image pin from a single image URL, or a carousel pin when more than one image URL is supplied. For video use **Create Video Pin**.
- **Create Video Pin** performs Pinterest's full asynchronous media flow from a FlowRunner video file: it registers a media upload, pushes the bytes to Pinterest's storage, polls until processing succeeds, then creates the pin with a supplied cover image URL. Uses file storage; processing can take a couple of minutes. **Register Media Upload** and **Get Media Upload Status** expose the individual steps for advanced/manual flows.
- List endpoints paginate with a `bookmark` token returned in each response and passed back to fetch the next page.

## Agent Ideas

- Call **AI Image Generator** "Generate Image" to produce campaign artwork, then use **Pinterest** "Create Pin" to publish it (or several generated images as a carousel) to a board.
- Use **Canva** "Export Design and Wait" to render a finished design, then **Pinterest** "Create Pin" to post the exported image with a destination link.
- Fetch queued content with **Google Sheets** "Get Rows" (or **Airtable** "Get Records"), then loop **Pinterest** "Create Pin" to publish each row and record the returned pin ids back to the sheet.
