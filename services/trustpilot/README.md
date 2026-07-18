# Trustpilot FlowRunner Extension

Look up Trustpilot company profiles, ratings, and TrustScores, read public and private reviews, post and delete company replies, and send review invitations. Public data (business units, public reviews, categories, consumer profiles) is served from the app's API key, while private data and write actions (private reviews, replies, invitations) use the connected business user's OAuth token.

## Ideal Use Cases

- Resolve a website domain to a Trustpilot business unit id, then pull its star rating, TrustScore, and per-star review counts for monitoring or reporting.
- Sync new reviews into a spreadsheet, database, or CRM, using private reviews to match each review to the customer's email and order reference.
- Auto-reply to reviews (or clear a reply) on behalf of the business as part of a moderation or support workflow.
- Drive review collection by sending templated email invitations tied to an order id, or generating single-use invitation links to distribute over SMS, chat, or your own emails.
- Research a market sector by listing categories and the companies registered within them.

## List of Actions

### Business Units
- Find Business Unit
- Get Business Unit
- Get Business Unit Web Links
- Search Business Units

### Categories
- Get Business Units in Category
- List Categories

### Consumers
- Get Consumer Profile

### Public Reviews
- Get Public Review
- List Public Reviews

### Private Reviews
- Delete Review Reply
- Get Private Review
- List Private Reviews
- Reply to Review

### Invitations
- Generate Review Invitation Link
- List Invitation Templates
- Send Email Invitation

## List of Triggers

This service does not define any triggers.

## Authentication

Trustpilot API access is a gated business feature: it requires a Trustpilot business account with API access enabled. Configure the OAuth application **Client ID** and **Client Secret** provided by Trustpilot; redirect URLs must be registered with your Trustpilot Customer Success Manager. The Client ID doubles as the public API key — public actions (Business Units, Public Reviews, Categories, Consumers) authenticate with it and need no account connection. Private actions (Private Reviews, replies, Invitations) require connecting a Trustpilot business user with access to the target business unit. Invitation actions call Trustpilot's separate invitations host (`invitations-api.trustpilot.com`); the sender email used for email invitations must be verified in your Trustpilot account.

## Agent Ideas

- Use **Trustpilot** "List Private Reviews" to fetch new low-star reviews with the consumer's email, then call **Zendesk** "Create Ticket" to open a support case and **Trustpilot** "Reply to Review" to acknowledge the reviewer publicly.
- When a new Trustpilot review comes in, use **Trustpilot** "List Public Reviews" to retrieve it and **Slack** "Send Message To Channel" to alert your team with the stars, title, and text for a quick response.
- Use **Trustpilot** "List Private Reviews" to pull reviews with their order reference and consumer email, then **Google Sheets** "Add Row" to log each review's rating, date, and customer into a reporting spreadsheet.
