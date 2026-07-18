# PrestaShop FlowRunner Extension

Connects FlowRunner to a self-hosted PrestaShop store through its Webservice API. Manage the product catalog, per-product stock, categories, customers, orders (including status changes), addresses, carts and store reference data, plus a generic escape hatch to reach any other webservice resource. Reads are returned as JSON and writes are converted internally to the XML the webservice requires, so you always work with plain objects.

## Ideal Use Cases

- Sync products, prices and multilanguage fields between PrestaShop and external systems (PIM, spreadsheets, ERPs)
- Keep stock quantities up to date from a warehouse, supplier feed or fulfillment provider
- Automate order fulfillment by advancing order status (triggering PrestaShop's emails, invoices and stock movements)
- Export new customers and orders to a CRM, accounting tool or marketing platform
- Reach uncovered resources (combinations, specific prices, taxes, carriers) via the generic Call Webservice Resource action

## List of Actions

### Products
- Create Product
- Delete Product
- Get Product
- List Products
- Update Product

### Stock
- Get Stock Available
- List Stock Availables
- Update Stock Quantity

### Categories
- Create Category
- Get Category
- List Categories

### Customers
- Create Customer
- Delete Customer
- Get Customer
- List Customers
- Update Customer

### Orders
- Get Order
- List Order States
- List Orders
- Update Order Status

### Addresses
- Get Address
- List Addresses

### Carts
- Get Cart
- List Carts

### Store Reference
- List Currencies
- List Languages
- List Manufacturers

### Advanced
- Call Webservice Resource

## List of Triggers

This service does not define any triggers.

## Configuration

- **Store URL** (required) — your shop base URL, e.g. `https://mystore.com`. All calls go to `{storeUrl}/api`.
- **API Key** (required) — the webservice key created in the back office.
- **Language ID** (optional, default `1`) — numeric language id used for multilanguage fields (name, description, slug). Use **List Languages** to find ids.

## Authentication

Authentication uses HTTP Basic auth with a PrestaShop webservice key (sent as the username, no password). Before the service can connect you must enable the webservice under **Advanced Parameters -> Webservice** in the PrestaShop back office and, on the key itself, tick the permission for every resource and HTTP method the service uses (for example GET/POST/PUT/DELETE on `products`, `stock_availables`, `categories`, `customers`, `orders`, `order_histories`, and any resource you reach via Call Webservice Resource). PrestaShop returns a `404` both for missing records and for resources the key cannot access, so a permission gap can look like a missing record.

## Agent Ideas

- Use **ShipBob** "Get Inventory" to read current warehouse stock, then call **PrestaShop** "Update Stock Quantity" on each product's stock_available record to keep the storefront in sync.
- When a **ShipBob** "On Order Shipped" trigger fires, call **PrestaShop** "Update Order Status" to advance the matching order to a Shipped state so the customer receives PrestaShop's shipping notification.
- After **PrestaShop** "List Customers" returns new accounts, call **Klaviyo** "Create or Update Profile" to add each shopper to your marketing lists.
