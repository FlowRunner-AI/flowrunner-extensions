# ShipBob FlowRunner Extension

Automate e-commerce fulfillment workflows with ShipBob's order management, inventory tracking, and shipping platform. Create orders, manage products, track shipments, process returns, and manage warehouse receiving orders through automated workflows.

## Ideal Use Cases

- Automating order creation from external sales channels or custom storefronts
- Estimating shipping costs before placing orders
- Tracking shipment status and sending delivery notifications to customers
- Monitoring inventory levels and triggering restocking workflows
- Processing returns and issuing refunds based on return completion
- Syncing order and product data between ShipBob and other platforms
- Alerting support teams when shipments encounter exceptions or holds
- Building custom fulfillment dashboards with real-time order data
- Managing warehouse receiving orders (WROs) for inbound inventory
- Batch cancelling shipments and marking tracking as uploaded

## List of Actions

### Order Management

- Create Order
- Get Order
- Get Orders
- Cancel Order
- Estimate Fulfillment Cost
- Batch Cancel Shipments
- Mark Tracking Uploaded

### Product Management

- Create Product
- Get Products

### Inventory & Shipments

- Get Inventory
- Get Shipment
- Create Return

### Warehouse Receiving Orders (WRO)

- Create WRO
- Get WROs
- Get WRO
- Get Fulfillment Centers
- Get WRO Boxes
- Get WRO Box Labels
- Cancel WRO
- Set WRO External Sync

## List of Triggers

- On Order Shipped
- On Shipment Delivered
- On Shipment Exception
- On Shipment On Hold
- On Return Completed

## Agent Ideas

- When ShipBob's "On Order Shipped" trigger fires, use Gmail's "Send Message" to email the customer with tracking details and an estimated delivery date
- Use Google Sheets' "Get Rows" to fetch a batch of new product entries, then call ShipBob's "Create Product" for each row to sync your product catalog into ShipBob's fulfillment system
- When ShipBob's "On Shipment Exception" trigger fires, use Slack's "Send Message To Channel" to alert your operations team with the shipment ID and exception details so they can take immediate action
