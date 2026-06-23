# BigCommerce FlowRunner Extension

Connect FlowRunner to [BigCommerce](https://www.bigcommerce.com/) to manage your store catalog,
customers, orders, carts, and pricing. The extension authenticates with OAuth2 (single-click app
flow) and covers the catalog (products, variants, images, custom fields, modifiers, categories,
brands), inventory adjustments, customers and addresses, customer groups, orders and shipments,
refunds, carts, and price lists — plus real-time webhook triggers on orders, products, inventory,
and customers.

## Ideal Use Cases

- Add and maintain products, variants, images, categories, and brands programmatically.
- Reliably set or adjust stock levels per variant and location.
- Create and manage customers, addresses, and customer groups.
- Create orders, transition order statuses, and create shipments with tracking.
- Quote and issue order refunds against settled payments.
- Build carts and add line items for headless or assisted-selling flows.
- Apply wholesale or regional pricing with price lists and per-variant price records.
- React in real time to new orders, status changes, product/inventory updates, and new customers.

## List of Actions

**Products** — Create, Get, List, Update, Delete Product
**Product Variants** — Create, Get, List, Update, Delete Product Variant
**Product Images** — Create, List, Delete Product Image
**Product Custom Fields** — Create, List, Update, Delete Product Custom Field
**Product Modifiers** — Create, List, Update, Delete Product Modifier
**Categories** — Create, Get, List, Update, Delete Category
**Brands** — Create, Get, List, Update, Delete Brand
**Inventory** — Set Inventory Level, Adjust Inventory Level
**Customers** — Create, Get, List, Update, Delete Customer
**Customer Addresses** — Create, List, Update, Delete Customer Address
**Customer Groups** — Create, Get, List, Update, Delete Customer Group
**Orders** — Create, Get, List, Update Order; Update Order Status; List Order Products / Coupons / Statuses
**Order Shipments** — Create, Get, List, Update, Delete Order Shipment
**Order Refunds** — Create Refund Quote, Create Refund, List Refunds
**Carts** — Create, Get, Add Line Items, Delete Cart
**Price Lists** — Create, Get, List, Update, Delete Price List; Set, List, Delete Price Record

## List of Triggers

- On Order Created
- On Order Status Updated
- On Product Created
- On Product Updated
- On Inventory Updated
- On Customer Created

## Agent Ideas

- When a **BigCommerce** "On Order Created" trigger fires, use **Gmail** "Send Message" to email the customer an order confirmation and **Google Sheets** "Add Row" to log the order into a sales tracking spreadsheet.
- When a **BigCommerce** "On Inventory Updated" trigger fires for a low-stock variant, use **Slack** "Send Message To Channel" to alert the operations channel so the team can reorder.
- Use **Google Sheets** "Get Rows" to read a supplier price feed, then call **BigCommerce** "Set Price Record" for each variant to sync wholesale pricing into a price list.
