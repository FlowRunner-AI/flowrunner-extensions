# Etsy FlowRunner Extension

Integrates the Etsy Open API v3 with FlowRunner to manage a seller's shop: listings (create drafts, update, delete, full inventory control with a safe fetch-modify-write flow), listing images, orders (receipts) with shipment tracking, reviews, shop sections, shipping profiles, the seller taxonomy, and the payment ledger. Authenticates via OAuth2 with mandatory PKCE.

## Ideal Use Cases

- Sync Etsy orders into fulfillment, accounting, or CRM workflows and push tracking numbers back to buyers
- Create and publish product listings (including images and variations) from a product database or spreadsheet
- Keep prices and stock quantities in sync with an external inventory system
- Monitor shop reviews and payment ledger activity

## List of Actions

- **Users & Shops:** Get Current User, Get Shop, Update Shop
- **Listings:** List Shop Listings, Get Listing, Get Listings by IDs, Create Draft Listing, Update Listing, Delete Listing, Get Listing Inventory, Update Listing Inventory
- **Listing Images:** List Listing Images, Upload Listing Image, Delete Listing Image
- **Receipts:** List Shop Receipts, Get Receipt, Update Receipt, Create Receipt Shipment, List Receipt Transactions
- **Reviews:** List Shop Reviews
- **Shop Sections:** List Shop Sections, Create Shop Section
- **Shipping:** List Shipping Profiles
- **Taxonomy:** List Seller Taxonomy Nodes, Get Taxonomy Properties
- **Payments:** List Payment Ledger Entries

## List of Triggers

This service does not define any triggers.

## Authentication

OAuth2 (authorization code) with mandatory PKCE (S256). Create an app at [etsy.com/developers/your-apps](https://www.etsy.com/developers/your-apps) and supply its keystring as the Client ID and its shared secret as the Client Secret. Every API call sends both the OAuth bearer token and the `x-api-key` keystring header. Scopes requested: `listings_r`, `listings_w`, `listings_d`, `transactions_r`, `transactions_w`, `shops_r`, `shops_w`, `email_r`.

Note: new Etsy apps start with provisional access. Production API access requires Etsy's personal-app approval, and apps serving multiple users additionally require Etsy's Commercial Access review.

## Notes

- Shop-scoped actions default to the connected account's own shop; an explicit Shop ID parameter can target another shop where permitted.
- Etsy access tokens are formatted `{user_id}.{token}`; the numeric user id is derivable from the token prefix.
- Update Listing Inventory wraps Etsy's full-replace inventory endpoint safely: it fetches the current inventory, applies the requested price/quantity changes (optionally filtered by SKU), strips read-only fields, and writes the result back.

## Agent Ideas

- Poll **Etsy** "List Shop Receipts" for unshipped paid orders, buy a label with **Shippo** "Create Shipment" then "Create Transaction (Buy Label)", and push the carrier and tracking code back with **Etsy** "Create Receipt Shipment" to notify the buyer automatically.
- Use **Google Sheets** "Get Rows" to read prices and stock levels from an external inventory sheet, then call **Etsy** "Update Listing Inventory" for each SKU to keep the shop's pricing and quantities in sync.
- Collect new feedback with **Etsy** "List Shop Reviews" and use **Gmail** "Send Message" to alert the shop owner about any low-star review that needs a response.
