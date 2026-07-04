# ShipStation FlowRunner Extension

Automate e-commerce shipping and fulfillment with ShipStation. Manage orders, buy shipping labels, compare live carrier rates, void labels, and keep customers, products, warehouses, stores, and webhooks in sync through automated workflows.

## Ideal Use Cases

- Syncing orders from sales channels and driving order-based automations
- Comparing live carrier rates to pick the cheapest or fastest service
- Buying shipping labels and capturing tracking numbers, then voiding unused ones
- Marking externally-fulfilled orders as shipped and notifying customers
- Holding, tagging, and restoring orders as part of fulfillment logic
- Syncing customer and product data into a CRM or catalog
- Managing warehouses (Ship From Locations), stores, and carrier webhooks
- Reacting to new orders and shipments in real time with polling triggers

## List of Actions

### Orders

- List Orders
- Get Order
- Create or Update Order
- Delete Order
- Mark Order as Shipped
- Hold Order Until
- Restore Order from Hold
- Add Tag to Order
- Remove Tag from Order

### Shipments

- List Shipments
- Get Shipment Rates
- Create Shipment Label
- Void Shipment Label

### Customers

- List Customers
- Get Customer

### Products

- List Products
- Get Product
- Update Product

### Warehouses

- List Warehouses
- Get Warehouse
- Create Warehouse
- Delete Warehouse

### Stores

- List Stores
- Get Store
- Refresh Store

### Carriers

- List Carriers
- List Carrier Services
- List Carrier Packages

### Webhooks

- List Webhooks
- Subscribe Webhook
- Unsubscribe Webhook

## List of Triggers

- On New Order
- On New Shipment

## Agent Ideas

- When Shopify's "On New Order" trigger fires, use ShipStation "Create or Update Order" to push the order into fulfillment, then "Get Shipment Rates" to pick the cheapest carrier before buying a label.
- When ShipStation's "On New Shipment" trigger fires, use Gmail's "Send Message" to email the customer their carrier and tracking number.
- When ShipStation's "On New Order" trigger fires, use Slack's "Send Message To Channel" to alert the fulfillment team and Google Sheets' "Add Row" to log the order for reporting.
