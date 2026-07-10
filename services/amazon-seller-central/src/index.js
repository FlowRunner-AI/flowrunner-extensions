// Amazon Seller Central - FlowRunner extension over the Amazon Selling Partner API
// (orders, FBA inventory, catalog, listings, pricing, reports, feeds, finances, notifications,
// fulfillment, and related seller operations). OAuth2 (Login with Amazon) + a polling onNewOrder trigger.

// ============================================================================
//  CONSTANTS
// ============================================================================
// Region-scoped SP-API hosts. The host is derived from the chosen marketplace's region; the
// user never picks a host. Default NA (overridable by the `region` config item).
const SP_API_HOSTS = {
  NA: 'https://sellingpartnerapi-na.amazon.com',
  EU: 'https://sellingpartnerapi-eu.amazon.com',
  FE: 'https://sellingpartnerapi-fe.amazon.com',
}

// Login with Amazon (LWA) endpoints. Authorization-code -> refresh token; API calls carry the
// LWA access token in the x-amz-access-token header (NOT Authorization: Bearer). AWS SigV4 is
// no longer required (as of Oct 2023).
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'
const LWA_AUTHORIZE_URL = 'https://sellercentral.amazon.com/apps/authorize/consent'

// Grantless scope for the Notifications API (subscriptions + destinations are provisioned with a
// client-credentials grantless token, not the seller's authorization-code token).
const NOTIFICATIONS_SCOPE = 'sellingpartnerapi::notifications'

// Marketplace -> region map, so the right region host is chosen from the selected marketplaceId.
// Source: SP-API "Marketplace IDs" reference. Defaults to NA for any unknown id.
const MARKETPLACE_REGION = {
  // North America
  ATVPDKIKX0DER: 'NA', // US
  A2EUQ1WTGCTBG2: 'NA', // CA
  A1AM78C64UM0Y8: 'NA', // MX
  A2Q3Y263D00KWC: 'NA', // BR
  // Europe
  A1RKKUPIHCS9HS: 'EU', // ES
  A1F83G8C2ARO7P: 'EU', // UK
  A13V1IB3VIYZZH: 'EU', // FR
  AMEN7PMS3EDWL: 'EU', // BE
  A1805IZSGTT6HS: 'EU', // NL
  A1PA6795UKMFR9: 'EU', // DE
  APJ6JRA9NG5V4: 'EU', // IT
  A2NODRKZP88ZB9: 'EU', // SE
  AE08WJ6YKNBMC: 'EU', // ZA
  A1C3SOZRARQ6R3: 'EU', // PL
  ARBP9OOSHTCHU: 'EU', // EG
  A33AVAJ2PDY3EV: 'EU', // TR
  A17E79C6D8DWNP: 'EU', // SA
  A2VIGQ35RCS4UG: 'EU', // AE
  A21TJRUUN4KGV: 'EU', // IN
  // Far East
  A19VAU5U5O7RUS: 'FE', // SG
  A39IBJ37TRP1C6: 'FE', // AU
  A1VC38T7YXB528: 'FE', // JP
}

// Sane internal cap on auto-pagination loops so a huge result set can't run forever.
const MAX_PAGES = 25

// Curated common report/feed types. getReports/getFeeds require at least one type code (or a
// nextToken); the report/feed dictionaries seed these so a user can pick a recent report/feed.
const COMMON_REPORT_TYPES = [
  'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL',
  'GET_MERCHANT_LISTINGS_ALL_DATA',
  'GET_FBA_INVENTORY_PLANNING_DATA',
  'GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA',
  'GET_AFN_INVENTORY_DATA',
  'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE',
  'GET_SALES_AND_TRAFFIC_REPORT',
]
const COMMON_FEED_TYPES = [
  'POST_PRODUCT_DATA',
  'POST_INVENTORY_AVAILABILITY_DATA',
  'POST_PRODUCT_PRICING_DATA',
  'POST_PRODUCT_OVERRIDES_DATA',
  'POST_PRODUCT_IMAGE_DATA',
  'JSON_LISTINGS_FEED',
]

// Trigger poll: on the very first run, look back this far so the first poll is bounded.
const FIRST_POLL_LOOKBACK_MS = 60 * 60 * 1000 // 1 hour

const ERROR_HINTS = {
  400: 'Amazon rejected the request — check the parameters; a date must be ISO 8601 and a marketplace must be one you are connected to.',
  401: 'Authentication failed — reconnect the Amazon Seller Central account.',
  403: 'Access denied — the connected app may be missing the required data-access role (e.g. the PII/Brand-Owner role for buyer info), or the token is invalid.',
  404: 'Not found — the ID may be wrong; use the matching "Get …" action to pick a valid one.',
  429: 'Amazon rate limit hit — SP-API limits are low and per-operation; retry in a moment.',
}

// ============================================================================
//  DROPDOWN CHOICE MAPS  (friendly label -> SP-API value)
// ============================================================================
// Dropdowns show friendly plain-string labels; these maps translate the chosen label back to the
// exact SP-API value in code (see #resolveChoice / #resolveChoices). Unknown values pass through
// unchanged, so a raw API code typed by an agent still works.
const ORDER_STATUS_MAP = { 'Pending Availability': 'PendingAvailability', Pending: 'Pending', Unshipped: 'Unshipped', 'Partially Shipped': 'PartiallyShipped', Shipped: 'Shipped', 'Invoice Unconfirmed': 'InvoiceUnconfirmed', Canceled: 'Canceled', Unfulfillable: 'Unfulfillable' }
const FULFILLMENT_CHANNEL_MAP = { 'Amazon (FBA)': 'AFN', 'Merchant (FBM)': 'MFN' }
const SHIPMENT_STATUS_MAP = { 'Ready For Pickup': 'ReadyForPickup', 'Picked Up': 'PickedUp', 'Refused Pickup': 'RefusedPickup' }
const CATALOG_IDENTIFIERS_TYPE_MAP = { ASIN: 'ASIN', EAN: 'EAN', GTIN: 'GTIN', ISBN: 'ISBN', JAN: 'JAN', MINSA: 'MINSA', 'SKU (Seller SKU)': 'SKU', UPC: 'UPC' }
const CATALOG_INCLUDED_DATA_MAP = { Attributes: 'attributes', Classifications: 'classifications', Dimensions: 'dimensions', Identifiers: 'identifiers', Images: 'images', 'Product Types': 'productTypes', Relationships: 'relationships', 'Sales Ranks': 'salesRanks', Summaries: 'summaries' }
const PUT_LISTING_REQUIREMENTS_MAP = { 'Listing (offer + product)': 'LISTING', 'Product Only': 'LISTING_PRODUCT_ONLY', 'Offer Only': 'LISTING_OFFER_ONLY' }
const LISTING_INCLUDED_DATA_MAP = { Summaries: 'summaries', Attributes: 'attributes', Issues: 'issues', Offers: 'offers', 'Fulfillment Availability': 'fulfillmentAvailability', Procurement: 'procurement', Relationships: 'relationships', 'Product Types': 'productTypes' }
const PRICING_ITEM_TYPE_MAP = { 'By ASIN': 'Asin', 'By Seller SKU': 'Sku' }
const OFFER_TYPE_MAP = { 'Consumer (B2C)': 'B2C', 'Business (B2B)': 'B2B' }
const CUSTOMER_TYPE_MAP = { 'Consumer (B2C)': 'Consumer', 'Business (B2B)': 'Business' }
const REPORT_TYPE_MAP = { 'All Orders (by order date)': 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL', 'All Active Listings': 'GET_MERCHANT_LISTINGS_ALL_DATA', 'FBA Inventory Planning': 'GET_FBA_INVENTORY_PLANNING_DATA', 'FBA Manage Inventory': 'GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA', 'FBA Inventory (AFN)': 'GET_AFN_INVENTORY_DATA', 'Settlement Report': 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE', 'Sales and Traffic': 'GET_SALES_AND_TRAFFIC_REPORT' }
const PROCESSING_STATUS_MAP = { 'In Queue': 'IN_QUEUE', 'In Progress': 'IN_PROGRESS', Done: 'DONE', Cancelled: 'CANCELLED', Fatal: 'FATAL' }
const REPORT_PERIOD_MAP = { 'Every 5 minutes': 'PT5M', 'Every 15 minutes': 'PT15M', 'Every 30 minutes': 'PT30M', Hourly: 'PT1H', 'Every 2 hours': 'PT2H', 'Every 4 hours': 'PT4H', 'Every 8 hours': 'PT8H', 'Every 12 hours': 'PT12H', Daily: 'P1D', 'Every 2 days': 'P2D', 'Every 3 days': 'P3D', 'Every 84 hours': 'PT84H', Weekly: 'P7D', 'Every 14 days': 'P14D', 'Every 15 days': 'P15D', 'Every 18 days': 'P18D', 'Every 30 days': 'P30D', Monthly: 'P1M' }
const FEED_TYPE_MAP = { 'Product Data': 'POST_PRODUCT_DATA', 'Inventory Availability': 'POST_INVENTORY_AVAILABILITY_DATA', 'Product Pricing': 'POST_PRODUCT_PRICING_DATA', 'Product Overrides': 'POST_PRODUCT_OVERRIDES_DATA', 'Product Images': 'POST_PRODUCT_IMAGE_DATA', 'JSON Listings Feed': 'JSON_LISTINGS_FEED' }
const NOTIFICATION_TYPE_MAP = { 'Any Offer Changed': 'ANY_OFFER_CHANGED', 'Order Change': 'ORDER_CHANGE', 'FBA Outbound Shipment Status': 'FBA_OUTBOUND_SHIPMENT_STATUS', 'Feed Processing Finished': 'FEED_PROCESSING_FINISHED', 'Report Processing Finished': 'REPORT_PROCESSING_FINISHED', 'Fee Promotion': 'FEE_PROMOTION', 'Fulfillment Order Status': 'FULFILLMENT_ORDER_STATUS', 'Listings Item Status Change': 'LISTINGS_ITEM_STATUS_CHANGE', 'Listings Item Issues Change': 'LISTINGS_ITEM_ISSUES_CHANGE', 'Product Type Definitions Change': 'PRODUCT_TYPE_DEFINITIONS_CHANGE', 'B2B Any Offer Changed': 'B2B_ANY_OFFER_CHANGED', 'Branded Item Content Change': 'BRANDED_ITEM_CONTENT_CHANGE', 'Item Product Type Change': 'ITEM_PRODUCT_TYPE_CHANGE', 'MFN Order Status Change': 'MFN_ORDER_STATUS_CHANGE', 'Order Status Change': 'ORDER_STATUS_CHANGE', 'Pricing Health': 'PRICING_HEALTH', 'Account Status Changed': 'ACCOUNT_STATUS_CHANGED', 'Data Kiosk Query Finished': 'DATA_KIOSK_QUERY_PROCESSING_FINISHED' }
const DESTINATION_KIND_MAP = { 'Amazon SQS Queue': 'sqs', 'Amazon EventBridge': 'eventBridge' }
const RDT_DATA_ELEMENTS_MAP = { 'Buyer Info': 'buyerInfo', 'Shipping Address': 'shippingAddress', 'Buyer Tax Information': 'buyerTaxInformation' }
const METRICS_GRANULARITY_MAP = { Hourly: 'Hour', Daily: 'Day', Weekly: 'Week', Monthly: 'Month', Yearly: 'Year', 'Total (whole interval)': 'Total' }
const METRICS_BUYER_TYPE_MAP = { 'All Buyers': 'All', 'Business (B2B)': 'B2B', 'Consumer (B2C)': 'B2C' }
const METRICS_FULFILLMENT_NETWORK_MAP = { 'Merchant (FBM)': 'MFN', 'Amazon (FBA)': 'AFN' }
const RESTRICTION_CONDITION_MAP = { New: 'new_new', 'New - Open Box': 'new_open_box', Refurbished: 'refurbished_refurbished', 'Used - Like New': 'used_like_new', 'Used - Very Good': 'used_very_good', 'Used - Good': 'used_good', 'Used - Acceptable': 'used_acceptable', 'Collectible - Like New': 'collectible_like_new', 'Collectible - Very Good': 'collectible_very_good', 'Collectible - Good': 'collectible_good', 'Collectible - Acceptable': 'collectible_acceptable', Club: 'club_club' }
const LISTING_IDENTIFIERS_TYPE_MAP = { 'Seller SKU': 'SKU', ASIN: 'ASIN', EAN: 'EAN', FNSKU: 'FNSKU', GTIN: 'GTIN', ISBN: 'ISBN', JAN: 'JAN', MINSAN: 'MINSAN', UPC: 'UPC' }
const LISTING_WITH_STATUS_MAP = { Buyable: 'BUYABLE', Discoverable: 'DISCOVERABLE' }
const LISTING_SORT_BY_MAP = { SKU: 'sku', 'Created Date': 'createdDate', 'Last Updated Date': 'lastUpdatedDate' }
const SORT_ORDER_MAP = { Ascending: 'ASC', Descending: 'DESC' }
const PRODUCT_TYPE_REQUIREMENTS_MAP = { 'Listing (Product + Offer)': 'LISTING', 'Listing - Product Only': 'LISTING_PRODUCT_ONLY', 'Listing - Offer Only': 'LISTING_OFFER_ONLY' }
const REQUIREMENTS_ENFORCED_MAP = { Enforced: 'ENFORCED', 'Not Enforced': 'NOT_ENFORCED' }
const CATALOG2020_INCLUDED_DATA_MAP = { Identifiers: 'identifiers', Images: 'images', 'Product Types': 'productTypes', 'Sales Ranks': 'salesRanks', Summaries: 'summaries', Variations: 'variations' }
const MCF_SHIPPING_SPEED_MAP = { Standard: 'Standard', Expedited: 'Expedited', Priority: 'Priority', 'Scheduled Delivery': 'ScheduledDelivery' }
const FULFILLMENT_ACTION_MAP = { 'Ship Now': 'Ship', Hold: 'Hold' }
const FULFILLMENT_POLICY_MAP = { 'Fill Or Kill': 'FillOrKill', 'Fill All': 'FillAll', 'Fill All Available': 'FillAllAvailable' }
const MFN_DIMENSION_UNIT_MAP = { Inches: 'inches', Centimeters: 'centimeters' }
const MFN_WEIGHT_UNIT_MAP = { Ounces: 'ounces', Grams: 'grams' }
const DELIVERY_EXPERIENCE_MAP = { 'Adult Signature': 'DeliveryConfirmationWithAdultSignature', Signature: 'DeliveryConfirmationWithSignature', 'Confirmation Without Signature': 'DeliveryConfirmationWithoutSignature', 'No Tracking': 'NoTracking' }
const HAZMAT_TYPE_MAP = { None: 'None', 'Limited Quantity Hazmat': 'LQHazmat' }
const SHIPPING_CHANNEL_TYPE_MAP = { 'Amazon Order': 'AMAZON', 'External / Off-Amazon': 'EXTERNAL' }
const LABEL_SIZE_UNIT_MAP = { Inch: 'INCH', Centimeter: 'CENTIMETER' }
const INBOUND_PLAN_STATUS_MAP = { Active: 'ACTIVE', Voided: 'VOIDED', Shipped: 'SHIPPED' }
const INBOUND_PLAN_SORT_BY_MAP = { 'Last Updated Time': 'LAST_UPDATED_TIME', 'Creation Time': 'CREATION_TIME' }
const SELF_SHIP_REASON_MAP = { 'Appointment Requested By Mistake': 'APPOINTMENT_REQUESTED_BY_MISTAKE', 'Vehicle Delay': 'VEHICLE_DELAY', 'Slot Not Suitable': 'SLOT_NOT_SUITABLE', 'Outside Carrier Business Hours': 'OUTSIDE_CARRIER_BUSINESS_HOURS', 'Unfavourable External Conditions': 'UNFAVOURABLE_EXTERNAL_CONDITIONS', 'Procurement Delay': 'PROCUREMENT_DELAY', 'Shipping Plan Changed': 'SHIPPING_PLAN_CHANGED', 'Increased Quantity': 'INCREASED_QUANTITY', Other: 'OTHER' }
const ITEM_LABEL_TYPE_MAP = { 'Standard Format (PDF)': 'STANDARD_FORMAT', 'Thermal Printing': 'THERMAL_PRINTING' }
const ITEM_LABEL_PAGE_TYPE_MAP = { 'A4 - 21 labels': 'A4_21', 'A4 - 24 labels': 'A4_24', 'A4 - 24 labels (64x33mm)': 'A4_24_64x33', 'A4 - 24 labels (66x35mm)': 'A4_24_66x35', 'A4 - 24 labels (70x36mm)': 'A4_24_70x36', 'A4 - 24 labels (70x37mm)': 'A4_24_70x37', 'A4 - 24 labels (Italy)': 'A4_24i', 'A4 - 27 labels': 'A4_27', 'A4 - 40 labels (52x29mm)': 'A4_40_52x29', 'A4 - 44 labels (48x25mm)': 'A4_44_48x25', 'Letter - 30 labels': 'Letter_30' }

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[Amazon Seller Central] info:', ...args),
  debug: (...args) => console.log('[Amazon Seller Central] debug:', ...args),
  error: (...args) => console.log('[Amazon Seller Central] error:', ...args),
  warn: (...args) => console.log('[Amazon Seller Central] warn:', ...args),
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getMarketplacesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter marketplaces by name or country. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getOrdersDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","required":true,"description":"The marketplace to list recent orders from."}
 */

/**
 * @typedef {Object} getOrdersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter orders by id or status. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (NextToken) for the next page of results."}
 * @paramDef {"type":"getOrdersDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"The marketplace whose recent orders to list."}
 */

/**
 * @typedef {Object} getReportsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter reports by id or type. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (nextToken) for the next page of results."}
 */

/**
 * @typedef {Object} getReportDocumentsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter finished reports by type. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (nextToken) for the next page of results."}
 */

/**
 * @typedef {Object} getFeedsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter feeds by id or type. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (nextToken) for the next page of results."}
 */

/**
 * @typedef {Object} getFeedDocumentsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter finished feeds by type. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (nextToken) for the next page of results."}
 */

/**
 * @typedef {Object} ShipmentStatusOrderItem
 * @property {String} orderItemId - The order item id (from Get Order Items).
 * @property {Number} quantity - The quantity of this item being updated.
 */

/**
 * @typedef {Object} ConfirmShipmentItem
 * @property {String} orderItemId - The order item id (from Get Order Items).
 * @property {Number} quantity - The quantity of this item in the package.
 */

/**
 * @typedef {Object} ListingsPatch
 * @property {String} op - The patch operation: add, replace, delete, or merge.
 * @property {String} path - JSON path of the attribute, e.g. /attributes/item_name.
 * @property {Array<Object>} value - The Amazon attribute-value array for the patch (omit for delete).
 */

/**
 * @typedef {Object} MessageAttachment
 * @property {String} uploadDestinationId - The upload destination id from Create Upload Destination.
 * @property {String} fileName - The file name to attach (e.g. fitment.pdf).
 */

/**
 * @typedef {Object} FeeEstimateItem
 * @property {String} idType - Whether idValue is an ASIN or a Seller SKU (ASIN or SellerSKU).
 * @property {String} idValue - The ASIN or Seller SKU to estimate fees for.
 * @property {String} marketplaceId - The marketplace to estimate fees in.
 * @property {Number} listingPrice - The price you would list the item at.
 * @property {String} currencyCode - ISO currency code for the price (e.g. USD).
 * @property {Boolean} isAmazonFulfilled - Estimate FBA fees (true) or merchant-fulfilled fees (false).
 * @property {String} identifier - A unique id you assign to this item (echoed back in the result).
 */

/**
 * @typedef {Object} getDestinationsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter destinations by name. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getSubscriptionsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Notification Type","name":"notificationType","required":true,"description":"The notification type whose active subscription to list."}
 */

/**
 * @typedef {Object} getSubscriptionsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter subscriptions. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getSubscriptionsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"The notification type whose active subscription to list."}
 */

/**
 * @typedef {Object} MCFItem
 * @property {String} sellerSku - Your SKU for the FBA item to ship.
 * @property {String} sellerFulfillmentOrderItemId - Your unique per-line id for this item within the order.
 * @property {Number} quantity - How many units of this SKU to ship.
 * @property {Number} perUnitDeclaredValue - Optional declared value per unit (for customs/insurance).
 * @property {String} giftMessage - Optional gift message printed for this item.
 * @property {String} displayableComment - Optional comment shown on the packing slip for this item.
 */

/**
 * @typedef {Object} MCFReturnItem
 * @property {String} sellerSku - The SKU of the item being returned.
 * @property {String} sellerFulfillmentOrderItemId - Your per-line id for the item in the original order.
 * @property {String} amazonShipmentId - The Amazon shipment id the item shipped in (from Get Fulfillment Order).
 * @property {String} returnReasonCode - The return reason code (from List Return Reason Codes).
 * @property {String} returnComment - Optional free-text comment about the return.
 */

/**
 * @typedef {Object} getProductTypesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional keywords to find matching product types (e.g. luggage). Filtering is performed by Amazon."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getFulfillmentOrdersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter MCF orders by id. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (nextToken) for the next page of results."}
 */

/**
 * @typedef {Object} getReturnReasonCodesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Seller SKU","name":"sellerSku","required":true,"description":"The SKU whose valid return reasons to list."}
 * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","description":"The marketplace whose return reasons to list."}
 */

/**
 * @typedef {Object} getReturnReasonCodesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter return reasons. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getReturnReasonCodesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"The SKU (and optional marketplace) whose valid return reasons to list."}
 */

/**
 * @typedef {Object} getDataKioskQueriesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter queries by id or status. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (nextToken) for the next page of results."}
 */

/**
 * @typedef {Object} getDataKioskDocumentsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter completed queries by id. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (nextToken) for the next page of results."}
 */

/**
 * @typedef {Object} MFNItem
 * @property {String} orderItemId - The order item id from Get Order Items.
 * @property {Number} quantity - How many units of this item go in the package.
 */

/**
 * @typedef {Object} ShippingPackage
 * @property {String} packageClientReferenceId - A unique reference you assign to this package (any string).
 * @property {Number} length - Package length.
 * @property {Number} width - Package width.
 * @property {Number} height - Package height.
 * @property {String} dimensionUnit - Dimension unit: INCH or CENTIMETER.
 * @property {Number} weightValue - Package weight.
 * @property {String} weightUnit - Weight unit: POUND, OUNCE, KILOGRAM or GRAM.
 * @property {Number} insuredValueAmount - Optional insured value amount for the package.
 * @property {String} description - Optional description of the package contents.
 */

/**
 * @typedef {Object} getInboundPlansDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter inbound plans by name or id. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (paginationToken) for the next page of results."}
 */

/**
 * @typedef {Object} getInboundShipmentsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","required":true,"description":"The inbound plan whose shipments to list."}
 */

/**
 * @typedef {Object} getInboundShipmentsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter shipments by id. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getInboundShipmentsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"The inbound plan whose shipments to list."}
 */

/**
 * @typedef {Object} getPackingOptionsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","required":true,"description":"The inbound plan whose packing options to list."}
 */

/**
 * @typedef {Object} getPackingOptionsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter packing options by id or status. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (paginationToken) for the next page of results."}
 * @paramDef {"type":"getPackingOptionsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"The inbound plan whose packing options to list."}
 */

/**
 * @typedef {Object} getPackingGroupsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","required":true,"description":"The inbound plan whose packing groups to list."}
 */

/**
 * @typedef {Object} getPackingGroupsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter packing groups by id. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (paginationToken) for the next page of results."}
 * @paramDef {"type":"getPackingGroupsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"The inbound plan whose packing groups to list."}
 */

/**
 * @typedef {Object} getPlacementOptionsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","required":true,"description":"The inbound plan whose placement options to list."}
 */

/**
 * @typedef {Object} getPlacementOptionsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter placement options by id or status. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (paginationToken) for the next page of results."}
 * @paramDef {"type":"getPlacementOptionsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"The inbound plan whose placement options to list."}
 */

/**
 * @typedef {Object} getTransportationOptionsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","required":true,"description":"The inbound plan whose transportation options to list."}
 * @paramDef {"type":"String","label":"Placement Option","name":"placementOptionId","description":"Scope the options to this placement option. Provide either this or a shipment."}
 * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","description":"Scope the options to this shipment. Provide either this or a placement option."}
 */

/**
 * @typedef {Object} getTransportationOptionsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter options by carrier, shipping mode or id. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (paginationToken) for the next page of results."}
 * @paramDef {"type":"getTransportationOptionsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"The inbound plan plus the placement option or shipment whose transportation options to list."}
 */

/**
 * @typedef {Object} getDeliveryWindowOptionsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","required":true,"description":"The inbound plan the shipment belongs to."}
 * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","required":true,"description":"The shipment whose delivery windows to list."}
 */

/**
 * @typedef {Object} getDeliveryWindowOptionsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter windows by date, availability or id. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (paginationToken) for the next page of results."}
 * @paramDef {"type":"getDeliveryWindowOptionsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"The inbound plan and shipment whose delivery windows to list."}
 */

/**
 * @typedef {Object} getSelfShipAppointmentSlotsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","required":true,"description":"The inbound plan the shipment belongs to."}
 * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","required":true,"description":"The shipment whose drop-off slots to list."}
 */

/**
 * @typedef {Object} getSelfShipAppointmentSlotsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter slots by start time or id. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (paginationToken) for the next page of results."}
 * @paramDef {"type":"getSelfShipAppointmentSlotsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"The inbound plan and shipment whose drop-off slots to list."}
 */

/**
 * @typedef {Object} InboundItem
 * @property {String} msku - The merchant SKU (your seller SKU) being sent in.
 * @property {Number} quantity - How many units of this MSKU are being shipped (1-500000).
 * @property {String} labelOwner - Who applies the FNSKU label: AMAZON, SELLER or NONE.
 * @property {String} prepOwner - Who performs any required prep: AMAZON, SELLER or NONE.
 * @property {String} expiration - Optional expiration date (YYYY-MM-DD). Units of one MSKU with different expiration dates cannot share a box.
 * @property {String} manufacturingLotCode - Optional manufacturing lot code for the units.
 */

/**
 * @typedef {Object} InboundBox
 * @property {String} contentInformationSource - How Amazon learns the box contents: BOX_CONTENT_PROVIDED (you list the items below), BARCODE_2D, or MANUAL_PROCESS (fees apply).
 * @property {Number} length - Box length.
 * @property {Number} width - Box width.
 * @property {Number} height - Box height.
 * @property {String} dimensionUnit - Dimension unit: IN or CM.
 * @property {Number} weightValue - Box weight.
 * @property {String} weightUnit - Weight unit: LB or KG.
 * @property {Number} quantity - The number of identical boxes with these dimensions/contents.
 * @property {Array<InboundItem>} items - The items in the box. Required for BOX_CONTENT_PROVIDED and ignored otherwise.
 * @property {String} packageId - Existing box package id, only when updating a box in a content update preview.
 */

/**
 * @typedef {Object} InboundPallet
 * @property {Number} quantity - The number of identical pallets.
 * @property {Number} length - Pallet length (optional).
 * @property {Number} width - Pallet width (optional).
 * @property {Number} height - Pallet height (optional).
 * @property {String} dimensionUnit - Dimension unit: IN or CM.
 * @property {Number} weightValue - Pallet weight (optional).
 * @property {String} weightUnit - Weight unit: LB or KG.
 * @property {String} stackability - Whether the pallet can be stacked at pick-up: STACKABLE or NON_STACKABLE.
 */

/**
 * @typedef {Object} InboundPackageGrouping
 * @property {Array<InboundBox>} boxes - The boxes in this grouping.
 * @property {String} packingGroupId - The packing group these boxes belong to. Use before the placement option is confirmed.
 * @property {String} shipmentId - The shipment these boxes belong to. Use after the placement option is confirmed.
 */

/**
 * @typedef {Object} InboundCustomPlacement
 * @property {String} warehouseId - The fulfillment center to send the units to (e.g. YYZ14).
 * @property {Array<InboundItem>} items - The items routed to this warehouse.
 */

/**
 * @typedef {Object} InboundTransportationConfig
 * @property {String} shipmentId - The shipment being configured (from Get Inbound Plan).
 * @property {String} readyToShipWindowStart - When you will hand the shipment over (ISO 8601, minute precision) - a pick-up date, not a delivery date.
 * @property {String} contactName - Optional seller contact name for the shipment.
 * @property {String} contactPhoneNumber - Optional seller contact phone number (required if a contact name is given).
 * @property {String} contactEmail - Optional seller contact email.
 * @property {String} freightClass - Optional LTL freight class (e.g. FC_50). Freight quotes are only returned when freight information is provided.
 * @property {Number} declaredValueAmount - Optional declared value of the freight.
 * @property {String} declaredValueCurrency - ISO 4217 currency code for the declared value (e.g. USD).
 * @property {Array<InboundPallet>} pallets - Optional pallet configuration for LTL shipments.
 */

/**
 * @typedef {Object} InboundTransportationSelection
 * @property {String} shipmentId - The shipment the transportation option applies to.
 * @property {String} transportationOptionId - The transportation option being confirmed for that shipment.
 * @property {String} contactName - Optional seller contact name.
 * @property {String} contactPhoneNumber - Optional seller contact phone number (required if a contact name is given).
 * @property {String} contactEmail - Optional seller contact email.
 */

/**
 * @typedef {Object} SpdTrackingItem
 * @property {String} boxId - The Amazon box id (e.g. FBA10ABC0YY100001), available once transportation is confirmed.
 * @property {String} trackingId - The carrier tracking number for that box.
 */

/**
 * @typedef {Object} MskuQuantity
 * @property {String} msku - The merchant SKU to print labels for.
 * @property {Number} quantity - How many labels to print for that MSKU (1-10000).
 */

/**
 * @typedef {Object} MskuPrepDetail
 * @property {String} msku - The merchant SKU the prep details apply to.
 * @property {String} prepCategory - The prep category: ADULT, BABY, FRAGILE, GRANULAR, HANGER, LIQUID, PERFORATED, SET, SHARP, SMALL, TEXTILE or NONE.
 * @property {Array<String>} prepTypes - The prep types, e.g. ITEM_LABELING, ITEM_POLYBAGGING, ITEM_BUBBLEWRAP, ITEM_TAPING, ITEM_NO_PREP.
 */

/**
 * @typedef {Object} InboundTaxRate
 * @property {String} taxType - The tax type: CGST, SGST, IGST or TOTAL_TAX.
 * @property {Number} gstRate - The GST rate.
 * @property {Number} cessRate - The cess rate.
 */

/**
 * @integrationName Amazon Seller Central
 * @integrationIcon /icon.svg
 * @requireOAuth
 */
class AmazonSellerCentral {
  constructor(config) {
    this.config = config || {}
    // LWA OAuth credentials come from config (with back-compat fallbacks to the generic keys).
    this.clientId = this.config.lwaClientId || this.config.clientId
    this.clientSecret = this.config.lwaClientSecret || this.config.clientSecret
    this.applicationId = this.config.applicationId
    this.region = this.config.region || 'NA'
  }

  // ==========================================================================
  //  CORE - every external call goes through #apiRequest
  // ==========================================================================
  // Resolves the region-scoped SP-API host for a marketplaceId (falls back to the configured
  // region, then NA). The user never selects a host directly.
  #hostFor(marketplaceId) {
    const region = (marketplaceId && MARKETPLACE_REGION[marketplaceId]) || this.region || 'NA'

    return SP_API_HOSTS[region] || SP_API_HOSTS.NA
  }

  async #apiRequest({ url, method, body, query, logTag, grantlessScope, extraHeaders }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ url }`)

      // Most calls carry the seller's LWA access token; grantless ops (Notifications
      // destinations/subscriptions) instead carry a client-credentials token minted for a scope.
      const token = grantlessScope ? await this.#grantlessToken(grantlessScope) : this.#getAccessToken()

      // A real body keeps the JSON content type; an arg-less call sends no body and no
      // application/json header (body null/undefined both mean "no body"). Some families add
      // extra request headers (Amazon Shipping v2 requires x-amzn-shipping-business-id).
      const hasBody = body !== undefined && body !== null
      const headers = { ...(hasBody ? this.#jsonHeaders(token) : this.#authHeaders(token)), ...(extraHeaders || {}) }
      const request = Flowrunner.Request[method](url)
        .set(headers)
        .query(this.#compactQuery(query))

      if (hasBody) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  // The SP-API auth header is x-amz-access-token (the LWA access token), NOT Authorization: Bearer.
  #authHeaders(token) {
    return {
      'x-amz-access-token': token || this.#getAccessToken(),
    }
  }

  #jsonHeaders(token) {
    return {
      'x-amz-access-token': token || this.#getAccessToken(),
      'Content-Type': 'application/json',
    }
  }

  // Mints a grantless LWA access token (client-credentials grant) for a Notifications scope.
  // Grantless ops act on the seller's behalf without their authorization-code token; the LWA
  // client_id/client_secret from config are the credentials. The token is short-lived and minted
  // per request (no cross-invocation cache available here).
  async #grantlessToken(scope) {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('LWA Client ID and Client Secret must be configured to perform this notifications operation.')
    }

    const response = await Flowrunner.Request.post(LWA_TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(new URLSearchParams({
        grant_type: 'client_credentials',
        scope,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }).toString())

    return response.access_token
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.body?.status
    // SP-API errors: { "errors": [ { code, message, details } ] }
    const errors = error?.body?.errors
    const first = Array.isArray(errors) && errors.length ? errors[0] : null
    const apiMessage = (first && (first.message || first.code)) ||
      error?.body?.error?.message ||
      error?.body?.message ||
      error?.message ||
      'Request failed'

    const friendly = ERROR_HINTS[status]

    logger.error(`${ logTag } failed: ${ apiMessage }`)

    throw new Error(friendly ? `${ friendly } (${ apiMessage })` : apiMessage)
  }

  // Removes keys whose value is null/undefined/empty-string/empty-array so optional query
  // params are omitted entirely. Arrays are joined with commas (SP-API query convention).
  #compactQuery(query) {
    const out = {}

    if (!query) return out

    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined || value === '') continue

      if (Array.isArray(value)) {
        const joined = value.filter(v => v !== null && v !== undefined && v !== '').join(',')

        if (joined) out[key] = joined

        continue
      }

      out[key] = value
    }

    return out
  }

  // Removes keys whose value is null/undefined/empty so optional body fields are omitted.
  #compactBody(obj) {
    const out = {}

    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && value !== undefined && value !== '') {
        out[key] = value
      }
    }

    return out
  }

  // Accepts an Array<String> OR a comma-separated string and returns a clean array.
  #toArray(value) {
    if (value === null || value === undefined || value === '') return []

    const list = Array.isArray(value) ? value : String(value).split(',')

    return list.map(v => String(v).trim()).filter(Boolean)
  }

  // Maps a friendly dropdown label back to its SP-API value. Unknown values (already an API code,
  // free text, or undefined/null) pass through unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Array/comma-list variant of #resolveChoice for multi-select dropdowns. Always returns an array.
  #resolveChoices(input, mapping) {
    return this.#toArray(input).map(v => this.#resolveChoice(v, mapping))
  }

  // The connected seller's Selling-Partner id. Resolved once from the connection context /
  // config - NOT a per-call user input (it is constant per connected account). Used as the
  // {sellerId} path segment of the Listings Items endpoints.
  #sellerId() {
    return (this.request && this.request.headers && this.request.headers['oauth-connection-identity']) ||
      this.config.sellerId ||
      this.config.merchantId
  }

  // Amazon Shipping v2 requires the x-amzn-shipping-business-id header (the enrolled region) on
  // every call, in addition to x-amz-access-token. The region comes from the shippingBusinessRegion
  // config item (defaults to AmazonShipping_US).
  #shippingHeaders() {
    return { 'x-amzn-shipping-business-id': this.config.shippingBusinessRegion || 'AmazonShipping_US' }
  }

  // ==========================================================================
  //  OAUTH2 SYSTEM METHODS  (Login with Amazon - LWA)
  // ==========================================================================
  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    // docs: https://developer-docs.amazon.com/sp-api/docs/website-authorization-workflow
    // The Flowrunner OAuth platform appends `state` and `redirect_uri` before redirecting the
    // user to consent - the service must NOT add either itself. application_id is the SP-API app id.
    const params = new URLSearchParams({
      application_id: this.applicationId || this.clientId,
    })

    // Draft apps require &version=beta; expose it via a config flag (default off).
    if (this.config.draftApp === true || this.config.draftApp === 'true') {
      params.set('version', 'beta')
    }

    return `${ LWA_AUTHORIZE_URL }?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   */
  async executeCallback(callbackObject) {
    // docs: https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api
    // Amazon redirects with ?spapi_oauth_code=<code>; the platform passes it as callbackObject.code.
    // The LWA token POST is form-urlencoded (no JSON content type).
    const response = await Flowrunner.Request.post(LWA_TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(new URLSearchParams({
        grant_type: 'authorization_code',
        code: callbackObject.code,
        redirect_uri: callbackObject.redirectURI,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }).toString())

    return {
      token: response.access_token,
      expirationInSeconds: response.expires_in,
      refreshToken: response.refresh_token,
      connectionIdentityName: callbackObject.selling_partner_id || 'Amazon Seller',
      overwrite: true,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   */
  async refreshToken(refreshToken) {
    // docs: https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api
    // LWA refresh tokens are reusable; the refresh response carries no new refresh_token, so
    // echo the same one back.
    const response = await Flowrunner.Request.post(LWA_TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }).toString())

    return {
      token: response.access_token,
      expirationInSeconds: response.expires_in,
      refreshToken: response.refresh_token || refreshToken,
    }
  }

  // ==========================================================================
  //  ACTIONS - Sellers / Marketplaces
  // ==========================================================================
  /**
   * @operationName Get Marketplace Participations
   * @category Sellers
   * @description Returns the marketplaces the connected seller participates in, with each marketplace's id, name, country, currency and participation status. Use this to discover the marketplace ids that nearly every other action needs.
   * @route POST /get-marketplace-participations
   * @returns {Object}
   * @sampleResult {"payload":[{"marketplace":{"id":"ATVPDKIKX0DER","name":"Amazon.com","countryCode":"US","defaultCurrencyCode":"USD","defaultLanguageCode":"en_US","domainName":"www.amazon.com"},"participation":{"isParticipating":true,"hasSuspendedListings":false}}]}
   */
  async getMarketplaceParticipations() {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getmarketplaceparticipations
    return await this.#apiRequest({
      url: `${ SP_API_HOSTS[this.region] || SP_API_HOSTS.NA }/sellers/v1/marketplaceParticipations`,
      logTag: 'getMarketplaceParticipations',
    })
  }

  // ==========================================================================
  //  ACTIONS - Orders
  // ==========================================================================
  /**
   * @operationName Get Orders
   * @category Orders
   * @description Lists and filters a seller's orders in one or more marketplaces. Filter by created/updated date, status and fulfillment channel. Use Last Updated After for incremental syncs and Created After for one-off pulls; one of the two is required.
   * @route POST /get-orders
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","required":true,"description":"One or more marketplaces to pull orders from. Pick from your connected marketplaces."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Return orders created at or after this date/time (ISO 8601). Provide this OR Last Updated After."}
   * @paramDef {"type":"String","label":"Last Updated After","name":"lastUpdatedAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Return orders whose status changed at or after this date/time (ISO 8601). Best for incremental syncs."}
   * @paramDef {"type":"Array<String>","label":"Order Statuses","name":"orderStatuses","uiComponent":{"type":"DROPDOWN","options":{"values":["Pending Availability","Pending","Unshipped","Partially Shipped","Shipped","Invoice Unconfirmed","Canceled","Unfulfillable"]}},"description":"Filter to specific order statuses. Leave empty for all."}
   * @paramDef {"type":"Array<String>","label":"Fulfillment Channels","name":"fulfillmentChannels","uiComponent":{"type":"DROPDOWN","options":{"values":["Amazon (FBA)","Merchant (FBM)"]}},"description":"AFN = Fulfilled by Amazon (FBA); MFN = Fulfilled by Merchant (FBM)."}
   * @paramDef {"type":"Number","label":"Max Results Per Page","name":"maxResultsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Page size, 1-100. Defaults to 100."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response. Leave empty for the first page."}
   * @returns {Object}
   * @sampleResult {"payload":{"Orders":[{"AmazonOrderId":"902-1845936-5435065","OrderStatus":"Unshipped","PurchaseDate":"2024-03-10T18:00:00Z","LastUpdateDate":"2024-03-10T18:05:00Z","OrderTotal":{"CurrencyCode":"USD","Amount":"49.99"},"FulfillmentChannel":"MFN","MarketplaceId":"ATVPDKIKX0DER","NumberOfItemsShipped":0,"NumberOfItemsUnshipped":1}],"NextToken":"abc123"}}
   */
  async getOrders(marketplaceIds, createdAfter, lastUpdatedAfter, orderStatuses, fulfillmentChannels, maxResultsPerPage, nextToken) {
    orderStatuses = this.#resolveChoices(orderStatuses, ORDER_STATUS_MAP)
    fulfillmentChannels = this.#resolveChoices(fulfillmentChannels, FULFILLMENT_CHANNEL_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/getorders
    const markets = this.#toArray(marketplaceIds)

    if (!markets.length) {
      throw new Error('At least one Marketplace is required — use Get Marketplace Participations to pick one.')
    }

    if (!createdAfter && !lastUpdatedAfter && !nextToken) {
      throw new Error('Provide either Created After or Last Updated After (ISO 8601) — at least one date is required.')
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor(markets[0]) }/orders/v0/orders`,
      query: {
        MarketplaceIds: markets,
        CreatedAfter: createdAfter,
        LastUpdatedAfter: lastUpdatedAfter,
        OrderStatuses: this.#toArray(orderStatuses),
        FulfillmentChannels: this.#toArray(fulfillmentChannels),
        MaxResultsPerPage: maxResultsPerPage,
        NextToken: nextToken,
      },
      logTag: 'getOrders',
    })
  }

  /**
   * @operationName Get Order
   * @category Orders
   * @description Retrieves a single order by its Amazon order id, including status, totals and fulfillment channel. Use after Get Orders to inspect one order in detail.
   * @route POST /get-order
   * @paramDef {"type":"String","label":"Order","name":"orderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The Amazon order to retrieve. Pick from Get Orders."}
   * @returns {Object}
   * @sampleResult {"payload":{"AmazonOrderId":"902-1845936-5435065","OrderStatus":"Unshipped","PurchaseDate":"2024-03-10T18:00:00Z","OrderTotal":{"CurrencyCode":"USD","Amount":"49.99"},"FulfillmentChannel":"MFN","MarketplaceId":"ATVPDKIKX0DER"}}
   */
  async getOrder(orderId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getorder
    if (!orderId) throw new Error('An Order id is required — use Get Orders to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/orders/v0/orders/${ encodeURIComponent(orderId) }`,
      logTag: 'getOrder',
    })
  }

  /**
   * @operationName Get Order Items
   * @category Orders
   * @description Lists the line items of an order - ASIN, seller SKU, item id, quantity ordered/shipped and item price. Use this to get the order-item ids needed to confirm or update a shipment.
   * @route POST /get-order-items
   * @paramDef {"type":"String","label":"Order","name":"orderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The order whose line items to retrieve. Pick from Get Orders."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"payload":{"AmazonOrderId":"902-1845936-5435065","OrderItems":[{"ASIN":"B00CZX5JE2","SellerSKU":"SKU-123","OrderItemId":"60696125413094","Title":"Carry-On","QuantityOrdered":1,"QuantityShipped":0,"ItemPrice":{"CurrencyCode":"USD","Amount":"49.99"}}],"NextToken":null}}
   */
  async getOrderItems(orderId, nextToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getorderitems
    if (!orderId) throw new Error('An Order id is required — use Get Orders to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/orders/v0/orders/${ encodeURIComponent(orderId) }/orderItems`,
      query: { NextToken: nextToken },
      logTag: 'getOrderItems',
    })
  }

  /**
   * @operationName Get Order Address
   * @category Orders
   * @description Retrieves the shipping address for an order. This returns buyer Personally Identifiable Information and requires the connected app to have the data-access (PII) role. Use when you need the destination address for fulfillment.
   * @route POST /get-order-address
   * @paramDef {"type":"String","label":"Order","name":"orderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The order to get the shipping address for. Returns buyer PII — requires the data-access (PII) role. Pick from Get Orders."}
   * @returns {Object}
   * @sampleResult {"payload":{"AmazonOrderId":"902-1845936-5435065","ShippingAddress":{"Name":"Jane Buyer","AddressLine1":"123 Any St","City":"Seattle","StateOrRegion":"WA","PostalCode":"98101","CountryCode":"US"}}}
   */
  async getOrderAddress(orderId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getorderaddress
    // PII (restricted) - at runtime this path needs a Restricted Data Token (RDT) in
    // the x-amz-access-token header; the platform supplies that token.
    if (!orderId) throw new Error('An Order id is required — use Get Orders to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/orders/v0/orders/${ encodeURIComponent(orderId) }/address`,
      logTag: 'getOrderAddress',
    })
  }

  /**
   * @operationName Get Order Buyer Info
   * @category Orders
   * @description Retrieves buyer contact details for an order (email, name, tax info). This returns buyer Personally Identifiable Information and requires the data-access (PII) role on the connected app.
   * @route POST /get-order-buyer-info
   * @paramDef {"type":"String","label":"Order","name":"orderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The order to get buyer contact details for. Returns buyer PII — requires the data-access (PII) role. Pick from Get Orders."}
   * @returns {Object}
   * @sampleResult {"payload":{"AmazonOrderId":"902-1845936-5435065","BuyerEmail":"abc@marketplace.amazon.com","BuyerName":"Jane Buyer"}}
   */
  async getOrderBuyerInfo(orderId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getorderbuyerinfo
    // PII (restricted) - needs a Restricted Data Token (RDT) at runtime; the platform supplies it.
    if (!orderId) throw new Error('An Order id is required — use Get Orders to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/orders/v0/orders/${ encodeURIComponent(orderId) }/buyerInfo`,
      logTag: 'getOrderBuyerInfo',
    })
  }

  /**
   * @operationName Get Order Items Buyer Info
   * @category Orders
   * @description Lists per-item buyer information for an order - gift messages, gift-wrap level and buyer customizations. This returns Personally Identifiable Information and requires the data-access (PII) role.
   * @route POST /get-order-items-buyer-info
   * @paramDef {"type":"String","label":"Order","name":"orderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The order to get per-item buyer info (gift messages, customizations) for. Returns PII — requires the data-access role. Pick from Get Orders."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"payload":{"AmazonOrderId":"902-1845936-5435065","OrderItems":[{"OrderItemId":"60696125413094","GiftMessageText":"Enjoy!","GiftWrapLevel":"Classic"}],"NextToken":null}}
   */
  async getOrderItemsBuyerInfo(orderId, nextToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getorderitemsbuyerinfo
    // PII (restricted) - needs a Restricted Data Token (RDT) at runtime; the platform supplies it.
    if (!orderId) throw new Error('An Order id is required — use Get Orders to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/orders/v0/orders/${ encodeURIComponent(orderId) }/orderItems/buyerInfo`,
      query: { NextToken: nextToken },
      logTag: 'getOrderItemsBuyerInfo',
    })
  }

  /**
   * @operationName Update Shipment Status
   * @category Orders
   * @description Updates the shipment status of an order (used by Amazon Easy Ship / store-pickup flows) to Ready For Pickup, Picked Up or Refused Pickup. Optionally scope the update to specific items.
   * @route POST /update-shipment-status
   * @paramDef {"type":"String","label":"Order","name":"orderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The order to update the shipment status for (Amazon Easy Ship / store pickup flows). Pick from Get Orders."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace the order belongs to."}
   * @paramDef {"type":"String","label":"Shipment Status","name":"shipmentStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Ready For Pickup","Picked Up","Refused Pickup"]}},"required":true,"description":"New shipment status for the order."}
   * @paramDef {"type":"Array<ShipmentStatusOrderItem>","label":"Order Items (optional, partial update)","name":"orderItems","description":"Optional list of specific items + quantities to update. Leave empty to update the whole order."}
   * @returns {Object}
   * @sampleResult {"success":true,"orderId":"902-1845936-5435065","shipmentStatus":"ReadyForPickup"}
   */
  async updateShipmentStatus(orderId, marketplaceId, shipmentStatus, orderItems) {
    shipmentStatus = this.#resolveChoice(shipmentStatus, SHIPMENT_STATUS_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/updateshipmentstatus
    // Request body: { marketplaceId, shipmentStatus, orderItems:[{orderItemId,quantity}] }
    if (!orderId) throw new Error('An Order id is required — use Get Orders to pick one.')
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')
    if (!shipmentStatus) throw new Error('A Shipment Status is required.')

    const body = this.#compactBody({
      marketplaceId,
      shipmentStatus,
      orderItems: Array.isArray(orderItems) && orderItems.length
        ? orderItems.map(item => ({ orderItemId: item.orderItemId, quantity: item.quantity }))
        : undefined,
    })

    await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/orders/v0/orders/${ encodeURIComponent(orderId) }/shipment`,
      method: 'post',
      body,
      logTag: 'updateShipmentStatus',
    })

    // The endpoint returns 204 No Content on success - return a clear success shape.
    return { success: true, orderId, shipmentStatus }
  }

  /**
   * @operationName Confirm Shipment
   * @category Orders
   * @description Confirms a Merchant-Fulfilled (MFN) order shipment with carrier and tracking details. Provide the carrier code, tracking number, ship date and the items in the package. Use this to mark a self-fulfilled order as shipped.
   * @route POST /confirm-shipment
   * @paramDef {"type":"String","label":"Order","name":"orderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The order being shipped. Pick from Get Orders."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace the order belongs to."}
   * @paramDef {"type":"String","label":"Package Reference","name":"packageReference","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"A unique reference you assign to this package (any string). Use different values to confirm multiple packages on one order. Sent to Amazon as packageReferenceId."}
   * @paramDef {"type":"String","label":"Carrier Code","name":"carrierCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The shipping carrier's standardized code, e.g. UPS, USPS, FedEx, DHL. Amazon requires a carrier code."}
   * @paramDef {"type":"String","label":"Tracking Number","name":"trackingNumber","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The carrier tracking number for the package."}
   * @paramDef {"type":"String","label":"Ship Date","name":"shipDate","uiComponent":{"type":"DATE_TIME_PICKER"},"required":true,"description":"When the package was/will be shipped (ISO 8601, e.g. 2022-11-30T16:15:30Z)."}
   * @paramDef {"type":"Array<ConfirmShipmentItem>","label":"Order Items","name":"orderItems","required":true,"description":"The items (and quantities) in this package. Pull item ids from Get Order Items."}
   * @paramDef {"type":"String","label":"Carrier Name","name":"carrierName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional human-readable carrier name (use when the carrier has no standard code)."}
   * @paramDef {"type":"String","label":"Shipping Method","name":"shippingMethod","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional shipping service level, e.g. SHIPPING."}
   * @returns {Object}
   * @sampleResult {"success":true,"orderId":"902-1845936-5435065","packageReferenceId":"123"}
   */
  async confirmShipment(orderId, marketplaceId, packageReference, carrierCode, trackingNumber, shipDate, orderItems, carrierName, shippingMethod) {
    // docs: https://developer-docs.amazon.com/sp-api/docs/confirm-the-shipment-status
    // Request body: { marketplaceId, packageDetail:{ packageReferenceId, carrierCode, carrierName,
    //   shippingMethod, trackingNumber, shipDate, orderItems:[{orderItemId,quantity}] } }
    if (!orderId) throw new Error('An Order id is required — use Get Orders to pick one.')
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')
    if (!packageReference) throw new Error('A Package Reference is required.')
    if (!carrierCode) throw new Error('A Carrier Code is required (e.g. UPS, USPS, FedEx).')
    if (!trackingNumber) throw new Error('A Tracking Number is required.')
    if (!shipDate) throw new Error('A Ship Date (ISO 8601) is required.')

    const items = Array.isArray(orderItems) ? orderItems : []

    if (!items.length) {
      throw new Error('At least one Order Item is required — pull item ids from Get Order Items.')
    }

    // API-exact body field: packageReferenceId (value comes from the packageReference param).
    const packageDetail = this.#compactBody({
      packageReferenceId: packageReference,
      carrierCode,
      carrierName,
      shippingMethod,
      trackingNumber,
      shipDate,
      orderItems: items.map(item => ({ orderItemId: item.orderItemId, quantity: item.quantity })),
    })

    await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/orders/v0/orders/${ encodeURIComponent(orderId) }/shipmentConfirmation`,
      method: 'post',
      body: { marketplaceId, packageDetail },
      logTag: 'confirmShipment',
    })

    // The endpoint returns 204 No Content on success - return a clear success shape.
    return { success: true, orderId, packageReferenceId: packageReference }
  }

  // ==========================================================================
  //  ACTIONS - FBA Inventory
  // ==========================================================================
  /**
   * @operationName Get Inventory Summaries
   * @category Inventory
   * @description Returns FBA (Fulfilled by Amazon) inventory levels for a marketplace - fulfillable, inbound, reserved and unfulfillable quantities per seller SKU. Use this to monitor stock for items Amazon fulfills.
   * @route POST /get-inventory-summaries
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to report FBA inventory for (sent as both granularityId and marketplaceIds)."}
   * @paramDef {"type":"Boolean","label":"Include Details","name":"details","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"Include the detailed quantity breakdown (fulfillable, inbound, reserved, unfulfillable)."}
   * @paramDef {"type":"Array<String>","label":"Seller SKUs","name":"sellerSkus","description":"Up to 50 seller SKUs to filter to. Leave empty for all FBA SKUs."}
   * @paramDef {"type":"String","label":"Changed Since","name":"startDateTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return summaries changed since this date/time (ISO 8601, max 18 months back). Enables pagination."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor (expires 30 seconds after creation)."}
   * @returns {Object}
   * @sampleResult {"payload":{"inventorySummaries":[{"asin":"B00CZX5JE2","fnSku":"X001ABC","sellerSku":"SKU-123","totalQuantity":42,"inventoryDetails":{"fulfillableQuantity":40,"inboundShippedQuantity":2}}]},"pagination":{"nextToken":null}}
   */
  async getInventorySummaries(marketplaceId, details, sellerSkus, startDateTime, nextToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getinventorysummaries
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/fba/inventory/v1/summaries`,
      query: {
        granularityType: 'Marketplace',
        granularityId: marketplaceId,
        marketplaceIds: marketplaceId,
        details: details === true ? 'true' : undefined,
        sellerSkus: this.#toArray(sellerSkus),
        startDateTime,
        nextToken,
      },
      logTag: 'getInventorySummaries',
    })
  }

  // ==========================================================================
  //  ACTIONS - Catalog
  // ==========================================================================
  /**
   * @operationName Search Catalog Items
   * @category Catalog
   * @description Searches the Amazon catalog by keywords or by product identifiers (ASIN/UPC/EAN/etc.). Use Keywords for discovery or Identifiers to look up known products. Returns summaries plus any additional data sets you request.
   * @route POST /search-catalog-items
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to search the Amazon catalog in."}
   * @paramDef {"type":"Array<String>","label":"Keywords","name":"keywords","description":"Search terms (up to 20). Use this OR Identifiers, not both."}
   * @paramDef {"type":"Array<String>","label":"Identifiers","name":"identifiers","description":"Up to 20 product identifiers (ASIN/UPC/EAN/etc.) to look up. Use this OR Keywords."}
   * @paramDef {"type":"String","label":"Identifiers Type","name":"identifiersType","uiComponent":{"type":"DROPDOWN","options":{"values":["ASIN","EAN","GTIN","ISBN","JAN","MINSA","SKU (Seller SKU)","UPC"]}},"description":"Which identifier type the Identifiers are. Required when Identifiers is set."}
   * @paramDef {"type":"Array<String>","label":"Brand Names","name":"brandNames","description":"Filter results to these brands."}
   * @paramDef {"type":"Array<String>","label":"Included Data","name":"includedData","uiComponent":{"type":"DROPDOWN","options":{"values":["Attributes","Classifications","Dimensions","Identifiers","Images","Product Types","Relationships","Sales Ranks","Summaries"]}},"defaultValue":["Summaries"],"description":"Which data sets to return per item. Defaults to Summaries."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":10,"description":"Results per page, 1-20. Defaults to 10."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"numberOfResults":1,"pagination":{"nextToken":null},"items":[{"asin":"B00CZX5JE2","summaries":[{"marketplaceId":"ATVPDKIKX0DER","brand":"AmazonBasics","itemName":"Carry-On"}]}]}
   */
  async searchCatalogItems(marketplaceId, keywords, identifiers, identifiersType, brandNames, includedData, pageSize, pageToken) {
    identifiersType = this.#resolveChoice(identifiersType, CATALOG_IDENTIFIERS_TYPE_MAP)
    includedData = this.#resolveChoices(includedData, CATALOG_INCLUDED_DATA_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/searchcatalogitems
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')

    const ids = this.#toArray(identifiers)

    if (ids.length && !identifiersType) {
      throw new Error('An Identifiers Type is required when Identifiers are provided (e.g. ASIN, UPC).')
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/catalog/2022-04-01/items`,
      query: {
        marketplaceIds: marketplaceId,
        keywords: this.#toArray(keywords),
        identifiers: ids,
        identifiersType: ids.length ? identifiersType : undefined,
        brandNames: this.#toArray(brandNames),
        includedData: this.#toArray(includedData).length ? this.#toArray(includedData) : ['summaries'],
        pageSize: pageSize || 10,
        pageToken,
      },
      logTag: 'searchCatalogItems',
    })
  }

  /**
   * @operationName Get Catalog Item
   * @category Catalog
   * @description Retrieves a single Amazon catalog item by ASIN, with summaries and any additional data sets you request. Use after Search Catalog Items to read full product details.
   * @route POST /get-catalog-item
   * @paramDef {"type":"String","label":"ASIN","name":"asin","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The Amazon ASIN to retrieve. Pull from Search Catalog Items."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to read the catalog item in."}
   * @paramDef {"type":"Array<String>","label":"Included Data","name":"includedData","uiComponent":{"type":"DROPDOWN","options":{"values":["Attributes","Classifications","Dimensions","Identifiers","Images","Product Types","Relationships","Sales Ranks","Summaries"]}},"defaultValue":["Summaries"],"description":"Which data sets to return. Defaults to Summaries."}
   * @returns {Object}
   * @sampleResult {"asin":"B00CZX5JE2","summaries":[{"marketplaceId":"ATVPDKIKX0DER","brand":"AmazonBasics","itemName":"Carry-On","manufacturer":"Amazon"}]}
   */
  async getCatalogItem(asin, marketplaceId, includedData) {
    includedData = this.#resolveChoices(includedData, CATALOG_INCLUDED_DATA_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/getcatalogitem
    if (!asin) throw new Error('An ASIN is required — pull one from Search Catalog Items.')
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/catalog/2022-04-01/items/${ encodeURIComponent(asin) }`,
      query: {
        marketplaceIds: marketplaceId,
        includedData: this.#toArray(includedData).length ? this.#toArray(includedData) : ['summaries'],
      },
      logTag: 'getCatalogItem',
    })
  }

  // ==========================================================================
  //  ACTIONS - Listings Items (full CRUD on a seller's own SKU listings)
  // ==========================================================================
  /**
   * @operationName Create or Replace Listing
   * @category Listings
   * @description Creates or fully replaces the listing for one of your SKUs. Provide the Amazon product type and the attributes map for that product type. Use this to publish a new product or overwrite an existing one.
   * @route POST /put-listings-item
   * @paramDef {"type":"String","label":"Seller SKU","name":"sku","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Your SKU for this listing. Creates or fully replaces the listing for this SKU."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to publish the listing to."}
   * @paramDef {"type":"String","label":"Product Type","name":"productType","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The Amazon product type for this item (e.g. LUGGAGE, SHOES). Defines which attributes are valid."}
   * @paramDef {"type":"Object","label":"Attributes","name":"attributes","required":true,"description":"The listing attributes keyed by Amazon attribute name (e.g. item_name, condition_type). Each value is an array of {value, marketplace_id, language_tag}. The exact keys depend on the product type — see Amazon's Product Type Definitions."}
   * @paramDef {"type":"String","label":"Requirements","name":"requirements","uiComponent":{"type":"DROPDOWN","options":{"values":["Listing (offer + product)","Product Only","Offer Only"]}},"defaultValue":"Listing (offer + product)","description":"Which requirement set to validate against. Defaults to full Listing."}
   * @returns {Object}
   * @sampleResult {"sku":"SKU-123","status":"ACCEPTED","submissionId":"f1dc2914-1f9f-4e8d","issues":[]}
   */
  async putListingsItem(sku, marketplaceId, productType, attributes, requirements) {
    requirements = this.#resolveChoice(requirements, PUT_LISTING_REQUIREMENTS_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/putlistingsitem
    // Request: PUT /listings/2021-08-01/items/{sellerId}/{sku}?marketplaceIds=...
    //   body: { productType, requirements, attributes }
    if (!sku) throw new Error('A Seller SKU is required.')
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')
    if (!productType) throw new Error('A Product Type is required (e.g. LUGGAGE).')
    if (!attributes || typeof attributes !== 'object') throw new Error('An Attributes object is required for the listing.')

    const sellerId = this.#requireSellerId()

    const body = this.#compactBody({
      productType,
      requirements: requirements || 'LISTING',
      attributes,
    })

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/listings/2021-08-01/items/${ encodeURIComponent(sellerId) }/${ encodeURIComponent(sku) }`,
      method: 'put',
      query: { marketplaceIds: marketplaceId },
      body,
      logTag: 'putListingsItem',
    })
  }

  /**
   * @operationName Update Listing
   * @category Listings
   * @description Partially updates a SKU's listing with JSON-Patch-style operations (add/replace/delete/merge a single attribute). Use this to change one or two fields (e.g. price, title) without resubmitting the whole listing.
   * @route POST /patch-listings-item
   * @paramDef {"type":"String","label":"Seller SKU","name":"sku","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The SKU of the listing to partially update. Pull from Get Inventory Summaries or Get Order Items."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace the listing is in."}
   * @paramDef {"type":"String","label":"Product Type","name":"productType","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The Amazon product type of the listing (e.g. LUGGAGE)."}
   * @paramDef {"type":"Array<ListingsPatch>","label":"Patches","name":"patches","required":true,"description":"JSON-Patch-style operations to apply. Each is {op, path, value}, e.g. replace /attributes/item_name."}
   * @returns {Object}
   * @sampleResult {"sku":"SKU-123","status":"ACCEPTED","submissionId":"a2bc3914-2f9f-4e8d","issues":[]}
   */
  async patchListingsItem(sku, marketplaceId, productType, patches) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/patchlistingsitem
    // Request: PATCH /listings/2021-08-01/items/{sellerId}/{sku}?marketplaceIds=...
    //   body: { productType, patches:[{op,path,value}] }
    if (!sku) throw new Error('A Seller SKU is required.')
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')
    if (!productType) throw new Error('A Product Type is required (e.g. LUGGAGE).')

    const list = Array.isArray(patches) ? patches : []

    if (!list.length) {
      throw new Error('At least one Patch operation is required (e.g. replace /attributes/item_name).')
    }

    const sellerId = this.#requireSellerId()

    const body = {
      productType,
      patches: list.map(patch => this.#compactBody({ op: patch.op, path: patch.path, value: patch.value })),
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/listings/2021-08-01/items/${ encodeURIComponent(sellerId) }/${ encodeURIComponent(sku) }`,
      method: 'patch',
      query: { marketplaceIds: marketplaceId },
      body,
      logTag: 'patchListingsItem',
    })
  }

  /**
   * @operationName Delete Listing
   * @category Listings
   * @description Deletes your listing (offer) for a SKU in the chosen marketplace. This removes the offer - use with care. Use when you want to stop selling a SKU.
   * @route POST /delete-listings-item
   * @paramDef {"type":"String","label":"Seller SKU","name":"sku","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The SKU of the listing to delete. This removes your offer for the SKU in the chosen marketplace."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to delete the listing from."}
   * @returns {Object}
   * @sampleResult {"sku":"SKU-123","status":"ACCEPTED","submissionId":"d3bc4914-3f9f-4e8d"}
   */
  async deleteListingsItem(sku, marketplaceId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/deletelistingsitem
    // Body-less DELETE - the path and verb are the whole request:
    //   DELETE /listings/2021-08-01/items/{sellerId}/{sku}?marketplaceIds=...
    if (!sku) throw new Error('A Seller SKU is required.')
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')

    const sellerId = this.#requireSellerId()

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/listings/2021-08-01/items/${ encodeURIComponent(sellerId) }/${ encodeURIComponent(sku) }`,
      method: 'delete',
      query: { marketplaceIds: marketplaceId },
      logTag: 'deleteListingsItem',
    })
  }

  /**
   * @operationName Get Listing
   * @category Listings
   * @description Retrieves your listing for a SKU - summaries, attributes, issues, offers and fulfillment availability (choose which data sets to include). Use this to inspect or audit a SKU's current listing state.
   * @route POST /get-listings-item
   * @paramDef {"type":"String","label":"Seller SKU","name":"sku","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The SKU of the listing to retrieve. Pull from Get Inventory Summaries or Get Order Items."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace the listing is in."}
   * @paramDef {"type":"Array<String>","label":"Included Data","name":"includedData","uiComponent":{"type":"DROPDOWN","options":{"values":["Summaries","Attributes","Issues","Offers","Fulfillment Availability","Procurement","Relationships","Product Types"]}},"defaultValue":["Summaries"],"description":"Which data sets to return. Defaults to Summaries."}
   * @returns {Object}
   * @sampleResult {"sku":"SKU-123","summaries":[{"marketplaceId":"ATVPDKIKX0DER","status":["BUYABLE"],"itemName":"Carry-On","productType":"LUGGAGE"}]}
   */
  async getListingsItem(sku, marketplaceId, includedData) {
    includedData = this.#resolveChoices(includedData, LISTING_INCLUDED_DATA_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/getlistingsitem
    if (!sku) throw new Error('A Seller SKU is required.')
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')

    const sellerId = this.#requireSellerId()

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/listings/2021-08-01/items/${ encodeURIComponent(sellerId) }/${ encodeURIComponent(sku) }`,
      query: {
        marketplaceIds: marketplaceId,
        includedData: this.#toArray(includedData).length ? this.#toArray(includedData) : ['summaries'],
      },
      logTag: 'getListingsItem',
    })
  }

  // The {sellerId} path segment is required by the Listings endpoints. Resolve it once and
  // fail with a remediating message if it is not available on the connection.
  #requireSellerId() {
    const sellerId = this.#sellerId()

    if (!sellerId) {
      throw new Error('Could not determine the connected seller id — reconnect the Amazon Seller Central account, or set the seller (merchant) id in the service configuration.')
    }

    return sellerId
  }

  // ==========================================================================
  //  ACTIONS - Product Pricing
  // ==========================================================================
  /**
   * @operationName Get Pricing
   * @category Pricing
   * @description Returns your own listing/regular/buying prices for items, looked up by ASIN or by Seller SKU. Use this to read the prices you have set for products in a marketplace.
   * @route POST /get-pricing
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to price items in."}
   * @paramDef {"type":"String","label":"Lookup By","name":"itemType","uiComponent":{"type":"DROPDOWN","options":{"values":["By ASIN","By Seller SKU"]}},"required":true,"description":"Whether to look up by ASIN or by your Seller SKU."}
   * @paramDef {"type":"Array<String>","label":"ASINs","name":"asins","description":"Up to 20 ASINs (when Lookup By = ASIN)."}
   * @paramDef {"type":"Array<String>","label":"Seller SKUs","name":"skus","description":"Up to 20 seller SKUs (when Lookup By = Seller SKU)."}
   * @paramDef {"type":"String","label":"Item Condition","name":"itemCondition","uiComponent":{"type":"DROPDOWN","options":{"values":["New","Used","Collectible","Refurbished","Club"]}},"defaultValue":"New","description":"Condition to price. Defaults to New."}
   * @paramDef {"type":"String","label":"Offer Type","name":"offerType","uiComponent":{"type":"DROPDOWN","options":{"values":["Consumer (B2C)","Business (B2B)"]}},"defaultValue":"Consumer (B2C)","description":"Consumer (B2C) or Business (B2B) pricing."}
   * @returns {Object}
   * @sampleResult {"payload":[{"status":"Success","ASIN":"B00CZX5JE2","Product":{"Offers":[{"ListingPrice":{"CurrencyCode":"USD","Amount":49.99},"ItemCondition":"New"}]}}]}
   */
  async getPricing(marketplaceId, itemType, asins, skus, itemCondition, offerType) {
    itemType = this.#resolveChoice(itemType, PRICING_ITEM_TYPE_MAP)
    offerType = this.#resolveChoice(offerType, OFFER_TYPE_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/getpricing
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')
    if (!itemType) throw new Error('A Lookup By (ASIN or Seller SKU) is required.')

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/products/pricing/v0/price`,
      query: {
        MarketplaceId: marketplaceId,
        ItemType: itemType,
        Asins: itemType === 'Asin' ? this.#toArray(asins) : undefined,
        Skus: itemType === 'Sku' ? this.#toArray(skus) : undefined,
        ItemCondition: itemCondition || 'New',
        OfferType: offerType || 'B2C',
      },
      logTag: 'getPricing',
    })
  }

  /**
   * @operationName Get Competitive Pricing
   * @category Pricing
   * @description Returns competitive pricing for items (lowest prices, number of offers) looked up by ASIN or Seller SKU. Use this to compare your prices against the market.
   * @route POST /get-competitive-pricing
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to price items in."}
   * @paramDef {"type":"String","label":"Lookup By","name":"itemType","uiComponent":{"type":"DROPDOWN","options":{"values":["By ASIN","By Seller SKU"]}},"required":true,"description":"Whether to look up by ASIN or by your Seller SKU."}
   * @paramDef {"type":"Array<String>","label":"ASINs","name":"asins","description":"Up to 20 ASINs (when Lookup By = ASIN)."}
   * @paramDef {"type":"Array<String>","label":"Seller SKUs","name":"skus","description":"Up to 20 seller SKUs (when Lookup By = Seller SKU)."}
   * @paramDef {"type":"String","label":"Customer Type","name":"customerType","uiComponent":{"type":"DROPDOWN","options":{"values":["Consumer (B2C)","Business (B2B)"]}},"defaultValue":"Consumer (B2C)","description":"Consumer (B2C) or Business (B2B). Defaults to Consumer."}
   * @returns {Object}
   * @sampleResult {"payload":[{"status":"Success","ASIN":"B00CZX5JE2","Product":{"CompetitivePricing":{"NumberOfOfferListings":[{"condition":"New","Count":12}]}}}]}
   */
  async getCompetitivePricing(marketplaceId, itemType, asins, skus, customerType) {
    itemType = this.#resolveChoice(itemType, PRICING_ITEM_TYPE_MAP)
    customerType = this.#resolveChoice(customerType, CUSTOMER_TYPE_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/getcompetitivepricing
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')
    if (!itemType) throw new Error('A Lookup By (ASIN or Seller SKU) is required.')

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/products/pricing/v0/competitivePrice`,
      query: {
        MarketplaceId: marketplaceId,
        ItemType: itemType,
        Asins: itemType === 'Asin' ? this.#toArray(asins) : undefined,
        Skus: itemType === 'Sku' ? this.#toArray(skus) : undefined,
        CustomerType: customerType || 'Consumer',
      },
      logTag: 'getCompetitivePricing',
    })
  }

  /**
   * @operationName Get Item Offers
   * @category Pricing
   * @description Lists the current offers (including Buy Box and lowest prices) for an ASIN in a given condition. Use this to see all marketplace offers competing for a product.
   * @route POST /get-item-offers
   * @paramDef {"type":"String","label":"ASIN","name":"asin","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The ASIN to list offers for. Pull from Search Catalog Items."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to list offers in."}
   * @paramDef {"type":"String","label":"Item Condition","name":"itemCondition","uiComponent":{"type":"DROPDOWN","options":{"values":["New","Used","Collectible","Refurbished","Club"]}},"required":true,"defaultValue":"New","description":"Condition of offers to list."}
   * @paramDef {"type":"String","label":"Customer Type","name":"customerType","uiComponent":{"type":"DROPDOWN","options":{"values":["Consumer (B2C)","Business (B2B)"]}},"defaultValue":"Consumer (B2C)","description":"Consumer or Business offers. Defaults to Consumer."}
   * @returns {Object}
   * @sampleResult {"payload":{"ASIN":"B00CZX5JE2","status":"Success","ItemCondition":"New","Summary":{"TotalOfferCount":12,"BuyBoxPrices":[{"LandedPrice":{"CurrencyCode":"USD","Amount":49.99}}]}}}
   */
  async getItemOffers(asin, marketplaceId, itemCondition, customerType) {
    customerType = this.#resolveChoice(customerType, CUSTOMER_TYPE_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/getitemoffers
    if (!asin) throw new Error('An ASIN is required — pull one from Search Catalog Items.')
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')
    if (!itemCondition) throw new Error('An Item Condition is required (e.g. New).')

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/products/pricing/v0/items/${ encodeURIComponent(asin) }/offers`,
      query: {
        MarketplaceId: marketplaceId,
        ItemCondition: itemCondition,
        CustomerType: customerType || 'Consumer',
      },
      logTag: 'getItemOffers',
    })
  }

  /**
   * @operationName Get Listing Offers
   * @category Pricing
   * @description Lists the current offers (including Buy Box and lowest prices) for one of your Seller SKUs in a given condition. Use this to see how your SKU stacks up against competing offers.
   * @route POST /get-listing-offers
   * @paramDef {"type":"String","label":"Seller SKU","name":"sellerSku","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Your SKU to list offers for. Pull from Get Inventory Summaries or Get Order Items."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace the SKU is listed in."}
   * @paramDef {"type":"String","label":"Item Condition","name":"itemCondition","uiComponent":{"type":"DROPDOWN","options":{"values":["New","Used","Collectible","Refurbished","Club"]}},"required":true,"defaultValue":"New","description":"Condition of offers to list."}
   * @paramDef {"type":"String","label":"Customer Type","name":"customerType","uiComponent":{"type":"DROPDOWN","options":{"values":["Consumer (B2C)","Business (B2B)"]}},"defaultValue":"Consumer (B2C)","description":"Consumer or Business offers. Defaults to Consumer."}
   * @returns {Object}
   * @sampleResult {"payload":{"SKU":"SKU-123","status":"Success","ItemCondition":"New","Summary":{"TotalOfferCount":12,"BuyBoxPrices":[{"LandedPrice":{"CurrencyCode":"USD","Amount":49.99}}]}}}
   */
  async getListingOffers(sellerSku, marketplaceId, itemCondition, customerType) {
    customerType = this.#resolveChoice(customerType, CUSTOMER_TYPE_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/getlistingoffers
    if (!sellerSku) throw new Error('A Seller SKU is required.')
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')
    if (!itemCondition) throw new Error('An Item Condition is required (e.g. New).')

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/products/pricing/v0/listings/${ encodeURIComponent(sellerSku) }/offers`,
      query: {
        MarketplaceId: marketplaceId,
        ItemCondition: itemCondition,
        CustomerType: customerType || 'Consumer',
      },
      logTag: 'getListingOffers',
    })
  }

  // ==========================================================================
  //  ACTIONS - Reports
  // ==========================================================================
  /**
   * @operationName Create Report
   * @category Reports
   * @description Requests Amazon to generate a report (orders, listings, FBA inventory, settlement, etc.) for one or more marketplaces. Returns a reportId you poll with Get Report; when DONE, download it with Get Report Document.
   * @route POST /create-report
   * @paramDef {"type":"String","label":"Report Type","name":"reportType","uiComponent":{"type":"DROPDOWN","options":{"values":["All Orders (by order date)","All Active Listings","FBA Inventory Planning","FBA Manage Inventory","FBA Inventory (AFN)","Settlement Report","Sales and Traffic"]}},"required":true,"description":"The Amazon report to generate. Pick a common type; any Amazon report-type code is also accepted."}
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","required":true,"description":"Marketplaces the report should cover (1-25)."}
   * @paramDef {"type":"String","label":"Data Start Time","name":"dataStartTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the report's data window (ISO 8601). Optional."}
   * @paramDef {"type":"String","label":"Data End Time","name":"dataEndTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the report's data window (ISO 8601). Optional."}
   * @returns {Object}
   * @sampleResult {"reportId":"50000018088"}
   */
  async createReport(reportType, marketplaceIds, dataStartTime, dataEndTime) {
    reportType = this.#resolveChoice(reportType, REPORT_TYPE_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/createreport
    // Request body: { reportType, dataStartTime?, marketplaceIds }
    if (!reportType) throw new Error('A Report Type is required.')

    const markets = this.#toArray(marketplaceIds)

    if (!markets.length) {
      throw new Error('At least one Marketplace is required — use Get Marketplace Participations to pick one.')
    }

    const body = this.#compactBody({
      reportType,
      marketplaceIds: markets,
      dataStartTime,
      dataEndTime,
    })

    return await this.#apiRequest({
      url: `${ this.#hostFor(markets[0]) }/reports/2021-06-30/reports`,
      method: 'post',
      body,
      logTag: 'createReport',
    })
  }

  /**
   * @operationName Get Report
   * @category Reports
   * @description Retrieves a report's processing status and, once DONE, its reportDocumentId. Poll this after Create Report; pass the reportDocumentId to Get Report Document to download the file.
   * @route POST /get-report
   * @paramDef {"type":"String","label":"Report","name":"reportId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getReportsDictionary","required":true,"description":"The report to check status of. Pick from your recent reports, or pass an id from Create Report."}
   * @returns {Object}
   * @sampleResult {"reportId":"50000018088","reportType":"GET_MERCHANT_LISTINGS_ALL_DATA","processingStatus":"DONE","reportDocumentId":"amzn1.spdoc.1.4.na.abc","createdTime":"2024-03-10T20:11:24Z"}
   */
  async getReport(reportId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getreport
    if (!reportId) throw new Error('A Report id is required — from Create Report.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/reports/2021-06-30/reports/${ encodeURIComponent(reportId) }`,
      logTag: 'getReport',
    })
  }

  /**
   * @operationName Get Reports
   * @category Reports
   * @description Lists your recent reports, optionally filtered by report type, processing status and marketplace. Use this to find a previously requested report's id.
   * @route POST /get-reports
   * @paramDef {"type":"Array<String>","label":"Report Types","name":"reportTypes","description":"Filter to these report-type codes (1-10). Provide this or a Next Token."}
   * @paramDef {"type":"Array<String>","label":"Processing Statuses","name":"processingStatuses","uiComponent":{"type":"DROPDOWN","options":{"values":["In Queue","In Progress","Done","Cancelled","Fatal"]}},"description":"Filter by processing status."}
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","description":"Filter to these marketplaces (1-10)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":10,"description":"Results per page, 1-100. Defaults to 10."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response. Use alone for the next page."}
   * @returns {Object}
   * @sampleResult {"reports":[{"reportId":"50000018088","reportType":"GET_MERCHANT_LISTINGS_ALL_DATA","processingStatus":"DONE","reportDocumentId":"amzn1.spdoc.1.4.na.abc","createdTime":"2024-03-10T20:11:24Z"}],"nextToken":null}
   */
  async getReports(reportTypes, processingStatuses, marketplaceIds, pageSize, nextToken) {
    processingStatuses = this.#resolveChoices(processingStatuses, PROCESSING_STATUS_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/getreports
    const types = this.#toArray(reportTypes)

    if (!types.length && !nextToken) {
      throw new Error('Provide at least one Report Type or a Next Token.')
    }

    const markets = this.#toArray(marketplaceIds)

    return await this.#apiRequest({
      url: `${ this.#hostFor(markets[0]) }/reports/2021-06-30/reports`,
      query: {
        reportTypes: types,
        processingStatuses: this.#toArray(processingStatuses),
        marketplaceIds: markets,
        pageSize: nextToken ? undefined : (pageSize || 10),
        nextToken,
      },
      logTag: 'getReports',
    })
  }

  /**
   * @operationName Cancel Report
   * @category Reports
   * @description Cancels a report that is still queued or in progress. Has no effect once the report is DONE or FATAL. Use to stop an unneeded report request.
   * @route POST /cancel-report
   * @paramDef {"type":"String","label":"Report","name":"reportId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getReportsDictionary","required":true,"description":"The report to cancel (only works while it is queued or in progress). Pick from your recent reports, or pass an id from Create Report."}
   * @returns {Object}
   * @sampleResult {"success":true,"reportId":"50000018088"}
   */
  async cancelReport(reportId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/cancelreport
    // Body-less DELETE - the path and verb are the whole request:
    //   DELETE /reports/2021-06-30/reports/{reportId}
    if (!reportId) throw new Error('A Report id is required — from Create Report.')

    await this.#apiRequest({
      url: `${ this.#hostFor() }/reports/2021-06-30/reports/${ encodeURIComponent(reportId) }`,
      method: 'delete',
      logTag: 'cancelReport',
    })

    return { success: true, reportId }
  }

  /**
   * @operationName Get Report Document
   * @category Reports
   * @description Returns a presigned download URL (and any compression algorithm) for a finished report's document. Use the reportDocumentId from a DONE report (Get Report). The URL points at Amazon S3, not the SP-API host.
   * @route POST /get-report-document
   * @paramDef {"type":"String","label":"Report Document","name":"reportDocumentId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getReportDocumentsDictionary","required":true,"description":"The finished report whose document to download. Pick from your DONE reports, or pass a reportDocumentId from Get Report."}
   * @returns {Object}
   * @sampleResult {"reportDocumentId":"amzn1.spdoc.1.4.na.abc","url":"https://tortuga-prod.s3.amazonaws.com/...","compressionAlgorithm":"GZIP"}
   */
  async getReportDocument(reportDocumentId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getreportdocument
    if (!reportDocumentId) throw new Error('A Report Document id is required — from a DONE report (Get Report).')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/reports/2021-06-30/documents/${ encodeURIComponent(reportDocumentId) }`,
      logTag: 'getReportDocument',
    })
  }

  /**
   * @operationName Create Report Schedule
   * @category Reports
   * @description Schedules a report to be generated automatically on a recurring period (e.g. daily, hourly). Returns a reportScheduleId. Use this to receive a report on a cadence instead of requesting each one manually.
   * @route POST /create-report-schedule
   * @paramDef {"type":"String","label":"Report Type","name":"reportType","uiComponent":{"type":"DROPDOWN","options":{"values":["All Orders (by order date)","All Active Listings","FBA Inventory Planning","FBA Manage Inventory","FBA Inventory (AFN)","Settlement Report","Sales and Traffic"]}},"required":true,"description":"The report to schedule. Same codes as Create Report."}
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","required":true,"description":"Marketplaces the scheduled report covers (1-25)."}
   * @paramDef {"type":"String","label":"Period","name":"period","uiComponent":{"type":"DROPDOWN","options":{"values":["Every 5 minutes","Every 15 minutes","Every 30 minutes","Hourly","Every 2 hours","Every 4 hours","Every 8 hours","Every 12 hours","Daily","Every 2 days","Every 3 days","Every 84 hours","Weekly","Every 14 days","Every 15 days","Every 18 days","Every 30 days","Monthly"]}},"required":true,"description":"How often the report is generated."}
   * @paramDef {"type":"String","label":"First Run Time","name":"nextReportCreationTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the first scheduled report should be created (ISO 8601). Optional."}
   * @returns {Object}
   * @sampleResult {"reportScheduleId":"ID323"}
   */
  async createReportSchedule(reportType, marketplaceIds, period, nextReportCreationTime) {
    reportType = this.#resolveChoice(reportType, REPORT_TYPE_MAP)
    period = this.#resolveChoice(period, REPORT_PERIOD_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/createreportschedule
    // Request body: { reportType, marketplaceIds, period }
    if (!reportType) throw new Error('A Report Type is required.')

    const markets = this.#toArray(marketplaceIds)

    if (!markets.length) {
      throw new Error('At least one Marketplace is required — use Get Marketplace Participations to pick one.')
    }

    if (!period) throw new Error('A Period is required (e.g. Daily).')

    const body = this.#compactBody({
      reportType,
      marketplaceIds: markets,
      period,
      nextReportCreationTime,
    })

    return await this.#apiRequest({
      url: `${ this.#hostFor(markets[0]) }/reports/2021-06-30/schedules`,
      method: 'post',
      body,
      logTag: 'createReportSchedule',
    })
  }

  // ==========================================================================
  //  ACTIONS - Feeds
  // ==========================================================================
  /**
   * @operationName Create Feed Document
   * @category Feeds
   * @description Step 1 of submitting a feed: creates a feed-document slot and returns a presigned S3 upload URL plus a feedDocumentId. Upload your feed file's bytes to that URL (with the same Content-Type), then call Create Feed with the feedDocumentId.
   * @route POST /create-feed-document
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"defaultValue":"text/tab-separated-values; charset=UTF-8","description":"The media type + charset of the feed file you will upload (e.g. text/tab-separated-values; charset=UTF-8 or application/json; charset=UTF-8)."}
   * @returns {Object}
   * @sampleResult {"feedDocumentId":"amzn1.tortuga.3.abc","url":"https://tortuga-prod.s3.amazonaws.com/..."}
   */
  async createFeedDocument(contentType) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/createfeeddocument
    // Request body: { contentType }
    if (!contentType) throw new Error('A Content Type is required (e.g. text/tab-separated-values; charset=UTF-8).')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/feeds/2021-06-30/documents`,
      method: 'post',
      body: { contentType },
      logTag: 'createFeedDocument',
    })
  }

  /**
   * @operationName Create Feed
   * @category Feeds
   * @description Step 2 of submitting a feed: submits the uploaded feed document for processing. Provide the feed type, marketplaces and the feedDocumentId from Create Feed Document (after you uploaded the file). Returns a feedId you poll with Get Feed.
   * @route POST /create-feed
   * @paramDef {"type":"String","label":"Feed Type","name":"feedType","uiComponent":{"type":"DROPDOWN","options":{"values":["Product Data","Inventory Availability","Product Pricing","Product Overrides","Product Images","JSON Listings Feed"]}},"required":true,"description":"The Amazon feed type to submit (e.g. POST_PRODUCT_PRICING_DATA). Any Amazon feed-type code is accepted."}
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","required":true,"description":"Marketplaces the feed applies to (1-25)."}
   * @paramDef {"type":"String","label":"Feed Document","name":"feedDocument","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The feedDocumentId from Create Feed Document (after you uploaded the file to its URL). Sent to Amazon as inputFeedDocumentId."}
   * @returns {Object}
   * @sampleResult {"feedId":"50000017291"}
   */
  async createFeed(feedType, marketplaceIds, feedDocument) {
    feedType = this.#resolveChoice(feedType, FEED_TYPE_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/createfeed
    // Request body: { feedType, marketplaceIds, inputFeedDocumentId }
    if (!feedType) throw new Error('A Feed Type is required.')

    const markets = this.#toArray(marketplaceIds)

    if (!markets.length) {
      throw new Error('At least one Marketplace is required — use Get Marketplace Participations to pick one.')
    }

    if (!feedDocument) {
      throw new Error('A Feed Document id is required — get one from Create Feed Document and upload your file first.')
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor(markets[0]) }/feeds/2021-06-30/feeds`,
      method: 'post',
      body: { feedType, marketplaceIds: markets, inputFeedDocumentId: feedDocument },
      logTag: 'createFeed',
    })
  }

  /**
   * @operationName Get Feed
   * @category Feeds
   * @description Retrieves a feed's processing status and, once DONE, its resultFeedDocumentId (the processing report). Poll this after Create Feed; pass resultFeedDocumentId to Get Feed Document.
   * @route POST /get-feed
   * @paramDef {"type":"String","label":"Feed","name":"feedId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getFeedsDictionary","required":true,"description":"The feed to check status of. Pick from your recent feeds, or pass an id from Create Feed."}
   * @returns {Object}
   * @sampleResult {"feedId":"50000017291","feedType":"POST_PRODUCT_PRICING_DATA","processingStatus":"DONE","resultFeedDocumentId":"amzn1.tortuga.3.xyz"}
   */
  async getFeed(feedId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getfeed
    if (!feedId) throw new Error('A Feed id is required — from Create Feed.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/feeds/2021-06-30/feeds/${ encodeURIComponent(feedId) }`,
      logTag: 'getFeed',
    })
  }

  /**
   * @operationName Get Feeds
   * @category Feeds
   * @description Lists your recent feeds, optionally filtered by feed type, processing status and marketplace. Use this to find a previously submitted feed's id.
   * @route POST /get-feeds
   * @paramDef {"type":"Array<String>","label":"Feed Types","name":"feedTypes","description":"Filter to these feed-type codes (1-10). Provide this or a Next Token."}
   * @paramDef {"type":"Array<String>","label":"Processing Statuses","name":"processingStatuses","uiComponent":{"type":"DROPDOWN","options":{"values":["In Queue","In Progress","Done","Cancelled","Fatal"]}},"description":"Filter by processing status."}
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","description":"Filter to these marketplaces (1-10)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":10,"description":"Results per page, 1-100. Defaults to 10."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor. Use alone for the next page."}
   * @returns {Object}
   * @sampleResult {"feeds":[{"feedId":"50000017291","feedType":"POST_PRODUCT_PRICING_DATA","processingStatus":"DONE"}],"nextToken":null}
   */
  async getFeeds(feedTypes, processingStatuses, marketplaceIds, pageSize, nextToken) {
    processingStatuses = this.#resolveChoices(processingStatuses, PROCESSING_STATUS_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/getfeeds
    const types = this.#toArray(feedTypes)

    if (!types.length && !nextToken) {
      throw new Error('Provide at least one Feed Type or a Next Token.')
    }

    const markets = this.#toArray(marketplaceIds)

    return await this.#apiRequest({
      url: `${ this.#hostFor(markets[0]) }/feeds/2021-06-30/feeds`,
      query: {
        feedTypes: types,
        processingStatuses: this.#toArray(processingStatuses),
        marketplaceIds: markets,
        pageSize: nextToken ? undefined : (pageSize || 10),
        nextToken,
      },
      logTag: 'getFeeds',
    })
  }

  /**
   * @operationName Cancel Feed
   * @category Feeds
   * @description Cancels a feed that is still queued and has not started processing. Has no effect once processing has begun. Use to stop an unneeded feed submission.
   * @route POST /cancel-feed
   * @paramDef {"type":"String","label":"Feed","name":"feedId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getFeedsDictionary","required":true,"description":"The feed to cancel (only works while it is queued and not yet processing). Pick from your recent feeds, or pass an id from Create Feed."}
   * @returns {Object}
   * @sampleResult {"success":true,"feedId":"50000017291"}
   */
  async cancelFeed(feedId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/cancelfeed
    // Body-less DELETE - the path and verb are the whole request:
    //   DELETE /feeds/2021-06-30/feeds/{feedId}
    if (!feedId) throw new Error('A Feed id is required — from Create Feed.')

    await this.#apiRequest({
      url: `${ this.#hostFor() }/feeds/2021-06-30/feeds/${ encodeURIComponent(feedId) }`,
      method: 'delete',
      logTag: 'cancelFeed',
    })

    return { success: true, feedId }
  }

  /**
   * @operationName Get Feed Document
   * @category Feeds
   * @description Returns a presigned download URL (and any compression algorithm) for a feed's processing report. Use the resultFeedDocumentId from a DONE feed (Get Feed). The URL points at Amazon S3, not the SP-API host.
   * @route POST /get-feed-document
   * @paramDef {"type":"String","label":"Feed Document","name":"feedDocumentId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getFeedDocumentsDictionary","required":true,"description":"The finished feed whose processing report to download. Pick from your DONE feeds, or pass a resultFeedDocumentId from Get Feed."}
   * @returns {Object}
   * @sampleResult {"feedDocumentId":"amzn1.tortuga.3.xyz","url":"https://tortuga-prod.s3.amazonaws.com/...","compressionAlgorithm":"GZIP"}
   */
  async getFeedDocument(feedDocumentId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getfeeddocument
    if (!feedDocumentId) throw new Error('A Feed Document id is required — from a DONE feed (Get Feed).')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/feeds/2021-06-30/documents/${ encodeURIComponent(feedDocumentId) }`,
      logTag: 'getFeedDocument',
    })
  }

  // ==========================================================================
  //  ACTIONS - Finances
  // ==========================================================================
  /**
   * @operationName List Financial Event Groups
   * @category Finances
   * @description Lists financial event groups (settlement periods) with their processing status and totals. Use this to find the settlement period whose detailed events you want, then drill in with List Financial Events.
   * @route POST /list-financial-event-groups
   * @paramDef {"type":"Number","label":"Max Results Per Page","name":"maxResultsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":10,"description":"Page size, 1-100. Defaults to 10."}
   * @paramDef {"type":"String","label":"Started After","name":"startedAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Return groups that started at or after this date/time (ISO 8601). Window must be 180 days or less."}
   * @paramDef {"type":"String","label":"Started Before","name":"startedBefore","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Return groups that started before this date/time (ISO 8601)."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"payload":{"FinancialEventGroupList":[{"FinancialEventGroupId":"22Pyc1234","ProcessingStatus":"Closed","OriginalTotal":{"CurrencyCode":"USD","CurrencyAmount":1234.56}}],"NextToken":null}}
   */
  async listFinancialEventGroups(maxResultsPerPage, startedAfter, startedBefore, nextToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listfinancialeventgroups
    return await this.#apiRequest({
      url: `${ this.#hostFor() }/finances/v0/financialEventGroups`,
      query: {
        MaxResultsPerPage: maxResultsPerPage || 10,
        FinancialEventGroupStartedAfter: startedAfter,
        FinancialEventGroupStartedBefore: startedBefore,
        NextToken: nextToken,
      },
      logTag: 'listFinancialEventGroups',
    })
  }

  /**
   * @operationName List Financial Events
   * @category Finances
   * @description Lists financial events (shipments, refunds, fees, adjustments) posted in a date window. Use this to reconcile payouts and accounting across all orders.
   * @route POST /list-financial-events
   * @paramDef {"type":"Number","label":"Max Results Per Page","name":"maxResultsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Page size, 1-100. Defaults to 100."}
   * @paramDef {"type":"String","label":"Posted After","name":"postedAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Return events posted at or after this date/time (ISO 8601)."}
   * @paramDef {"type":"String","label":"Posted Before","name":"postedBefore","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Return events posted before this date/time (ISO 8601)."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"payload":{"FinancialEvents":{"ShipmentEventList":[{"AmazonOrderId":"902-1845936-5435065","PostedDate":"2024-03-12T00:00:00Z"}]},"NextToken":null}}
   */
  async listFinancialEvents(maxResultsPerPage, postedAfter, postedBefore, nextToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listfinancialevents
    return await this.#apiRequest({
      url: `${ this.#hostFor() }/finances/v0/financialEvents`,
      query: {
        MaxResultsPerPage: maxResultsPerPage || 100,
        PostedAfter: postedAfter,
        PostedBefore: postedBefore,
        NextToken: nextToken,
      },
      logTag: 'listFinancialEvents',
    })
  }

  /**
   * @operationName List Financial Events By Order
   * @category Finances
   * @description Lists the financial events (shipments, refunds, fees) for a single order. Use this to reconcile the payout and fees of one specific order.
   * @route POST /list-financial-events-by-order-id
   * @paramDef {"type":"String","label":"Order","name":"orderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The Amazon order to list financial events for. Pick from Get Orders."}
   * @paramDef {"type":"Number","label":"Max Results Per Page","name":"maxResultsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Page size, 1-100."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response."}
   * @returns {Object}
   * @sampleResult {"payload":{"FinancialEvents":{"ShipmentEventList":[{"AmazonOrderId":"902-1845936-5435065","PostedDate":"2024-03-12T00:00:00Z"}]},"NextToken":null}}
   */
  async listFinancialEventsByOrderId(orderId, maxResultsPerPage, nextToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listfinancialeventsbyorderid
    if (!orderId) throw new Error('An Order id is required — use Get Orders to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/finances/v0/financialEventsByOrderId/${ encodeURIComponent(orderId) }`,
      query: {
        MaxResultsPerPage: maxResultsPerPage || 100,
        NextToken: nextToken,
      },
      logTag: 'listFinancialEventsByOrderId',
    })
  }

  // ==========================================================================
  //  ACTIONS - Notifications (subscriptions + delivery destinations; grantless)
  // ==========================================================================
  /**
   * @operationName Create Subscription
   * @category Notifications
   * @description Subscribes to an SP-API event type (e.g. Any Offer Changed, Order Change) so Amazon delivers those events to a destination you created. Events are delivered to an AWS EventBridge bus or SQS queue, not an HTTPS URL. Create the destination first, then subscribe.
   * @route POST /create-subscription
   * @paramDef {"type":"String","label":"Notification Type","name":"notificationType","uiComponent":{"type":"DROPDOWN","options":{"values":["Any Offer Changed","Order Change","FBA Outbound Shipment Status","Feed Processing Finished","Report Processing Finished","Fee Promotion","Fulfillment Order Status","Listings Item Status Change","Listings Item Issues Change","Product Type Definitions Change","B2B Any Offer Changed","Branded Item Content Change","Item Product Type Change","MFN Order Status Change","Order Status Change","Pricing Health","Account Status Changed","Data Kiosk Query Finished"]}},"required":true,"description":"The event type to subscribe to (e.g. Any Offer Changed, Order Change)."}
   * @paramDef {"type":"String","label":"Destination","name":"destinationId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getDestinationsDictionary","required":true,"description":"The delivery destination (SQS queue or EventBridge bus) to send events to. Create one with Create Destination."}
   * @paramDef {"type":"String","label":"Payload Version","name":"payloadVersion","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"defaultValue":"1.0","description":"The notification payload schema version. Almost always 1.0."}
   * @returns {Object}
   * @sampleResult {"payload":{"subscriptionId":"7fcf8c7d-2f0c-4f0a-9b8a-3c1d2e9b0f11","payloadVersion":"1.0","destinationId":"f3d4cee3-e6c7-49d4-bf0d-ff0b5f0d6d2f"}}
   */
  async createSubscription(notificationType, destinationId, payloadVersion) {
    notificationType = this.#resolveChoice(notificationType, NOTIFICATION_TYPE_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/createsubscription
    // Request: POST /notifications/v1/subscriptions/{notificationType}
    //   body: { payloadVersion, destinationId }
    if (!notificationType) throw new Error('A Notification Type is required.')
    if (!destinationId) throw new Error('A Destination is required — use Create Destination, then pick it here.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/notifications/v1/subscriptions/${ encodeURIComponent(notificationType) }`,
      method: 'post',
      body: this.#compactBody({ payloadVersion: payloadVersion || '1.0', destinationId }),
      grantlessScope: NOTIFICATIONS_SCOPE,
      logTag: 'createSubscription',
    })
  }

  /**
   * @operationName Get Subscription
   * @category Notifications
   * @description Retrieves the current subscription for a notification type and payload version, including its subscription id and destination. Use this to check whether a type is subscribed and where its events go.
   * @route POST /get-subscription
   * @paramDef {"type":"String","label":"Notification Type","name":"notificationType","uiComponent":{"type":"DROPDOWN","options":{"values":["Any Offer Changed","Order Change","FBA Outbound Shipment Status","Feed Processing Finished","Report Processing Finished","Fee Promotion","Fulfillment Order Status","Listings Item Status Change","Listings Item Issues Change","Product Type Definitions Change","B2B Any Offer Changed","Branded Item Content Change","Item Product Type Change","MFN Order Status Change","Order Status Change","Pricing Health","Account Status Changed","Data Kiosk Query Finished"]}},"required":true,"description":"The event type whose current subscription to retrieve."}
   * @paramDef {"type":"String","label":"Payload Version","name":"payloadVersion","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"defaultValue":"1.0","description":"The payload schema version to look up. Almost always 1.0."}
   * @returns {Object}
   * @sampleResult {"payload":{"subscriptionId":"7fcf8c7d-2f0c-4f0a-9b8a-3c1d2e9b0f11","payloadVersion":"1.0","destinationId":"f3d4cee3-e6c7-49d4-bf0d-ff0b5f0d6d2f"}}
   */
  async getSubscription(notificationType, payloadVersion) {
    notificationType = this.#resolveChoice(notificationType, NOTIFICATION_TYPE_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/getsubscription
    if (!notificationType) throw new Error('A Notification Type is required.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/notifications/v1/subscriptions/${ encodeURIComponent(notificationType) }`,
      query: { payloadVersion: payloadVersion || '1.0' },
      grantlessScope: NOTIFICATIONS_SCOPE,
      logTag: 'getSubscription',
    })
  }

  /**
   * @operationName Get Subscription By ID
   * @category Notifications
   * @description Retrieves a specific subscription by its id (and notification type). Use this after Create Subscription to confirm the subscription's destination and payload version.
   * @route POST /get-subscription-by-id
   * @paramDef {"type":"String","label":"Notification Type","name":"notificationType","uiComponent":{"type":"DROPDOWN","options":{"values":["Any Offer Changed","Order Change","FBA Outbound Shipment Status","Feed Processing Finished","Report Processing Finished","Fee Promotion","Fulfillment Order Status","Listings Item Status Change","Listings Item Issues Change","Product Type Definitions Change","B2B Any Offer Changed","Branded Item Content Change","Item Product Type Change","MFN Order Status Change","Order Status Change","Pricing Health","Account Status Changed","Data Kiosk Query Finished"]}},"required":true,"description":"The event type the subscription belongs to."}
   * @paramDef {"type":"String","label":"Subscription","name":"subscriptionId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getSubscriptionsDictionary","dependsOn":["notificationType"],"required":true,"description":"The subscription to retrieve. Pick the active subscription for the chosen notification type."}
   * @returns {Object}
   * @sampleResult {"payload":{"subscriptionId":"7fcf8c7d-2f0c-4f0a-9b8a-3c1d2e9b0f11","payloadVersion":"1.0","destinationId":"f3d4cee3-e6c7-49d4-bf0d-ff0b5f0d6d2f"}}
   */
  async getSubscriptionById(notificationType, subscriptionId) {
    notificationType = this.#resolveChoice(notificationType, NOTIFICATION_TYPE_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/getsubscriptionbyid
    if (!notificationType) throw new Error('A Notification Type is required.')
    if (!subscriptionId) throw new Error('A Subscription id is required — from Create Subscription.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/notifications/v1/subscriptions/${ encodeURIComponent(notificationType) }/${ encodeURIComponent(subscriptionId) }`,
      grantlessScope: NOTIFICATIONS_SCOPE,
      logTag: 'getSubscriptionById',
    })
  }

  /**
   * @operationName Delete Subscription By ID
   * @category Notifications
   * @description Deletes a subscription by its id, stopping event delivery for that notification type. Use with care - events will no longer be sent to the destination for this type.
   * @route POST /delete-subscription-by-id
   * @paramDef {"type":"String","label":"Notification Type","name":"notificationType","uiComponent":{"type":"DROPDOWN","options":{"values":["Any Offer Changed","Order Change","FBA Outbound Shipment Status","Feed Processing Finished","Report Processing Finished","Fee Promotion","Fulfillment Order Status","Listings Item Status Change","Listings Item Issues Change","Product Type Definitions Change","B2B Any Offer Changed","Branded Item Content Change","Item Product Type Change","MFN Order Status Change","Order Status Change","Pricing Health","Account Status Changed","Data Kiosk Query Finished"]}},"required":true,"description":"The event type the subscription belongs to."}
   * @paramDef {"type":"String","label":"Subscription","name":"subscriptionId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getSubscriptionsDictionary","dependsOn":["notificationType"],"required":true,"description":"The subscription to delete. This stops event delivery for this type. Pick the active subscription for the chosen notification type."}
   * @returns {Object}
   * @sampleResult {"success":true,"subscriptionId":"7fcf8c7d-2f0c-4f0a-9b8a-3c1d2e9b0f11"}
   */
  async deleteSubscriptionById(notificationType, subscriptionId) {
    notificationType = this.#resolveChoice(notificationType, NOTIFICATION_TYPE_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/deletesubscriptionbyid
    // Body-less DELETE - the path and verb are the whole request:
    //   DELETE /notifications/v1/subscriptions/{notificationType}/{subscriptionId}
    if (!notificationType) throw new Error('A Notification Type is required.')
    if (!subscriptionId) throw new Error('A Subscription id is required — from Create Subscription.')

    await this.#apiRequest({
      url: `${ this.#hostFor() }/notifications/v1/subscriptions/${ encodeURIComponent(notificationType) }/${ encodeURIComponent(subscriptionId) }`,
      method: 'delete',
      grantlessScope: NOTIFICATIONS_SCOPE,
      logTag: 'deleteSubscriptionById',
    })

    return { success: true, subscriptionId }
  }

  /**
   * @operationName Create Destination
   * @category Notifications
   * @description Creates a delivery destination for SP-API notifications - either an Amazon SQS queue or an Amazon EventBridge bus that you own. After creating a destination, subscribe event types to it with Create Subscription.
   * @route POST /create-destination
   * @paramDef {"type":"String","label":"Destination Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"A human label for this delivery destination."}
   * @paramDef {"type":"String","label":"Destination Type","name":"destinationKind","uiComponent":{"type":"DROPDOWN","options":{"values":["Amazon SQS Queue","Amazon EventBridge"]}},"required":true,"defaultValue":"Amazon SQS Queue","description":"Whether events are delivered to an Amazon SQS queue or an Amazon EventBridge bus."}
   * @paramDef {"type":"String","label":"SQS Queue ARN","name":"sqsArn","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The ARN of your SQS queue (required when Destination Type = SQS), e.g. arn:aws:sqs:us-east-2:444455556666:queue1."}
   * @paramDef {"type":"String","label":"EventBridge Region","name":"eventBridgeRegion","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"AWS region of your EventBridge bus (required when Destination Type = EventBridge), e.g. us-east-2."}
   * @paramDef {"type":"String","label":"EventBridge Account ID","name":"eventBridgeAccount","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Your AWS account id for the EventBridge bus (required when Destination Type = EventBridge)."}
   * @returns {Object}
   * @sampleResult {"payload":{"destinationId":"f3d4cee3-e6c7-49d4-bf0d-ff0b5f0d6d2f","name":"YourDestinationName","resource":{"sqs":{"arn":"arn:aws:sqs:us-east-2:444455556666:queue1"}}}}
   */
  async createDestination(name, destinationKind, sqsArn, eventBridgeRegion, eventBridgeAccount) {
    destinationKind = this.#resolveChoice(destinationKind, DESTINATION_KIND_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/createdestination
    // Request: POST /notifications/v1/destinations
    //   sqs:          { name, resourceSpecification:{ sqs:{ arn } } }
    //   eventBridge:  { name, resourceSpecification:{ eventBridge:{ region, accountId } } }
    if (!name) throw new Error('A Destination Name is required.')

    const kind = destinationKind || 'sqs'
    let resourceSpecification

    if (kind === 'sqs') {
      if (!sqsArn) throw new Error('An SQS Queue ARN is required when Destination Type is SQS.')

      resourceSpecification = { sqs: { arn: sqsArn } }
    } else {
      if (!eventBridgeRegion || !eventBridgeAccount) {
        throw new Error('EventBridge Region and Account ID are required when Destination Type is EventBridge.')
      }

      resourceSpecification = { eventBridge: { region: eventBridgeRegion, accountId: eventBridgeAccount } }
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/notifications/v1/destinations`,
      method: 'post',
      body: { name, resourceSpecification },
      grantlessScope: NOTIFICATIONS_SCOPE,
      logTag: 'createDestination',
    })
  }

  /**
   * @operationName Get Destinations
   * @category Notifications
   * @description Lists all notification delivery destinations (SQS queues and EventBridge buses) you have created. Use this to find a destination id to subscribe to or delete.
   * @route POST /get-destinations
   * @returns {Object}
   * @sampleResult {"payload":[{"destinationId":"f3d4cee3-e6c7-49d4-bf0d-ff0b5f0d6d2f","name":"YourDestinationName","resource":{"sqs":{"arn":"arn:aws:sqs:us-east-2:444455556666:queue1"}}}]}
   */
  async getDestinations() {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getdestinations
    return await this.#apiRequest({
      url: `${ this.#hostFor() }/notifications/v1/destinations`,
      grantlessScope: NOTIFICATIONS_SCOPE,
      logTag: 'getDestinations',
    })
  }

  /**
   * @operationName Get Destination
   * @category Notifications
   * @description Retrieves a single notification delivery destination by its id, including its SQS/EventBridge resource details. Use after Get Destinations to inspect one destination.
   * @route POST /get-destination
   * @paramDef {"type":"String","label":"Destination","name":"destinationId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getDestinationsDictionary","required":true,"description":"The destination to retrieve. From Create Destination / Get Destinations."}
   * @returns {Object}
   * @sampleResult {"payload":{"destinationId":"f3d4cee3-e6c7-49d4-bf0d-ff0b5f0d6d2f","name":"YourDestinationName","resource":{"sqs":{"arn":"arn:aws:sqs:us-east-2:444455556666:queue1"}}}}
   */
  async getDestination(destinationId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getdestination
    if (!destinationId) throw new Error('A Destination is required — use Get Destinations to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/notifications/v1/destinations/${ encodeURIComponent(destinationId) }`,
      grantlessScope: NOTIFICATIONS_SCOPE,
      logTag: 'getDestination',
    })
  }

  /**
   * @operationName Delete Destination
   * @category Notifications
   * @description Deletes a notification delivery destination by its id. Any subscriptions using it stop receiving events. Use with care.
   * @route POST /delete-destination
   * @paramDef {"type":"String","label":"Destination","name":"destinationId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getDestinationsDictionary","required":true,"description":"The destination to delete. Any subscriptions using it stop receiving events. From Get Destinations."}
   * @returns {Object}
   * @sampleResult {"success":true,"destinationId":"f3d4cee3-e6c7-49d4-bf0d-ff0b5f0d6d2f"}
   */
  async deleteDestination(destinationId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/deletedestination
    // Body-less DELETE - the path and verb are the whole request:
    //   DELETE /notifications/v1/destinations/{destinationId}
    if (!destinationId) throw new Error('A Destination is required — use Get Destinations to pick one.')

    await this.#apiRequest({
      url: `${ this.#hostFor() }/notifications/v1/destinations/${ encodeURIComponent(destinationId) }`,
      method: 'delete',
      grantlessScope: NOTIFICATIONS_SCOPE,
      logTag: 'deleteDestination',
    })

    return { success: true, destinationId }
  }

  // ==========================================================================
  //  ACTIONS - Tokens (Restricted Data Token / RDT)
  // ==========================================================================
  /**
   * @operationName Create Restricted Data Token
   * @category Tokens
   * @description Mints a Restricted Data Token (RDT) that authorizes a call to a PII / restricted SP-API path (e.g. an order's shipping address). Use the returned token in the x-amz-access-token header when you call that exact path. Requires the connected app to have the data-access (PII) role.
   * @route POST /create-restricted-data-token
   * @paramDef {"type":"String","label":"HTTP Method","name":"method","uiComponent":{"type":"DROPDOWN","options":{"values":["GET","POST","PUT","DELETE"]}},"required":true,"defaultValue":"GET","description":"The HTTP method of the restricted path you will call with this token."}
   * @paramDef {"type":"String","label":"Restricted Path","name":"path","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The exact SP-API path the token authorizes, e.g. /orders/v0/orders/902-3159896-1390916/address."}
   * @paramDef {"type":"Array<String>","label":"Data Elements","name":"dataElements","uiComponent":{"type":"DROPDOWN","options":{"values":["Buyer Info","Shipping Address","Buyer Tax Information"]}},"description":"Which PII elements the token may access. Required for some paths (e.g. shippingAddress, buyerInfo)."}
   * @paramDef {"type":"String","label":"Target Application","name":"targetApplication","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional — a developer/application id to delegate the token to (for app-to-app data sharing). Leave empty for self."}
   * @returns {Object}
   * @sampleResult {"restrictedDataToken":"Atz.sprdt|IQEBLjAsAhRmHjNgHpi0U-Dme37rR6CuUpSR...","expiresIn":3600}
   */
  async createRestrictedDataToken(method, path, dataElements, targetApplication) {
    dataElements = this.#resolveChoices(dataElements, RDT_DATA_ELEMENTS_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/createrestricteddatatoken
    // Request: POST /tokens/2021-03-01/restrictedDataToken
    //   { restrictedResources:[ { method, path, dataElements? } ], targetApplication? }
    if (!method) throw new Error('An HTTP Method is required (e.g. GET).')
    if (!path) throw new Error('A Restricted Path is required, e.g. /orders/v0/orders/{orderId}/address.')

    const elements = this.#toArray(dataElements)
    const resource = this.#compactBody({
      method,
      path,
      dataElements: elements.length ? elements : undefined,
    })

    const body = this.#compactBody({
      restrictedResources: [resource],
      targetApplication,
    })

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/tokens/2021-03-01/restrictedDataToken`,
      method: 'post',
      body,
      logTag: 'createRestrictedDataToken',
    })
  }

  // ==========================================================================
  //  ACTIONS - Solicitations (request a buyer review)
  // ==========================================================================
  /**
   * @operationName Get Solicitation Actions For Order
   * @category Solicitations
   * @description Returns which buyer-solicitation actions are currently allowed for an order (e.g. requesting a product review and seller feedback). Check this before sending a solicitation.
   * @route POST /get-solicitation-actions-for-order
   * @paramDef {"type":"String","label":"Order","name":"amazonOrderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The order to check available buyer-solicitation actions for. Pick from Get Orders."}
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace(s) the order belongs to."}
   * @returns {Object}
   * @sampleResult {"_links":{"self":{"href":"/solicitations/v1/orders/123-1234567-1234567"},"actions":[{"href":"/solicitations/v1/orders/123-1234567-1234567/solicitations/productReviewAndSellerFeedback","name":"productReviewAndSellerFeedback"}]}}
   */
  async getSolicitationActionsForOrder(amazonOrderId, marketplaceIds) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getsolicitationactionsfororder
    if (!amazonOrderId) throw new Error('An Order id is required — use Get Orders to pick one.')

    const markets = this.#toArray(marketplaceIds)

    if (!markets.length) {
      throw new Error('At least one Marketplace is required — use Get Marketplace Participations to pick one.')
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor(markets[0]) }/solicitations/v1/orders/${ encodeURIComponent(amazonOrderId) }`,
      query: { marketplaceIds: markets },
      logTag: 'getSolicitationActionsForOrder',
    })
  }

  /**
   * @operationName Request Product Review And Seller Feedback
   * @category Solicitations
   * @description Sends Amazon's "Request a Review" solicitation for a delivered order, asking the buyer for a product review and seller feedback. One request per order, within Amazon's eligibility window. Check Get Solicitation Actions For Order first.
   * @route POST /create-product-review-solicitation
   * @paramDef {"type":"String","label":"Order","name":"amazonOrderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The delivered order to request a product review + seller feedback for. One request per order, within Amazon's eligibility window. Pick from Get Orders."}
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace(s) the order belongs to."}
   * @returns {Object}
   * @sampleResult {"success":true,"amazonOrderId":"123-1234567-1234567"}
   */
  async createProductReviewAndSellerFeedbackSolicitation(amazonOrderId, marketplaceIds) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/createproductreviewandsellerfeedbacksolicitation
    // Body-less action POST - the path, verb, and marketplaceIds query are the whole request:
    //   POST /solicitations/v1/orders/{amazonOrderId}/solicitations/productReviewAndSellerFeedback?marketplaceIds=...
    if (!amazonOrderId) throw new Error('An Order id is required — use Get Orders to pick one.')

    const markets = this.#toArray(marketplaceIds)

    if (!markets.length) {
      throw new Error('At least one Marketplace is required — use Get Marketplace Participations to pick one.')
    }

    await this.#apiRequest({
      url: `${ this.#hostFor(markets[0]) }/solicitations/v1/orders/${ encodeURIComponent(amazonOrderId) }/solicitations/productReviewAndSellerFeedback`,
      method: 'post',
      query: { marketplaceIds: markets },
      logTag: 'createProductReviewAndSellerFeedbackSolicitation',
    })

    return { success: true, amazonOrderId }
  }

  // ==========================================================================
  //  ACTIONS - Messaging (buyer-seller messaging for an order)
  // ==========================================================================
  /**
   * @operationName Get Messaging Actions For Order
   * @category Messaging
   * @description Returns which buyer-messaging actions are permitted for an order (e.g. confirm delivery details, send a digital access key). Check this before sending a message of a given type.
   * @route POST /get-messaging-actions-for-order
   * @paramDef {"type":"String","label":"Order","name":"amazonOrderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The order to list permitted buyer-messaging actions for. Pick from Get Orders."}
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace(s) the order belongs to."}
   * @returns {Object}
   * @sampleResult {"_links":{"self":{"href":"/messaging/v1/orders/123-1234567-1234567"},"actions":[{"href":"/messaging/v1/orders/123-1234567-1234567/messages/confirmDeliveryDetails","name":"confirmDeliveryDetails"}]}}
   */
  async getMessagingActionsForOrder(amazonOrderId, marketplaceIds) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getmessagingactionsfororder
    const markets = this.#requireOrderAndMarkets(amazonOrderId, marketplaceIds)

    return await this.#apiRequest({
      url: `${ this.#hostFor(markets[0]) }/messaging/v1/orders/${ encodeURIComponent(amazonOrderId) }`,
      query: { marketplaceIds: markets },
      logTag: 'getMessagingActionsForOrder',
    })
  }

  /**
   * @operationName Get Messaging Attributes
   * @category Messaging
   * @description Returns the buyer's messaging attributes for an order - notably whether the buyer has opted out of unsolicited messages. Check this before sending an optional message.
   * @route POST /get-messaging-attributes
   * @paramDef {"type":"String","label":"Order","name":"amazonOrderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The order to check the buyer's messaging-opt-out status for. Pick from Get Orders."}
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace(s) the order belongs to."}
   * @returns {Object}
   * @sampleResult {"buyer":{"buyerFeatures":["BUYER_OPTED_OUT_OF_MESSAGING"]}}
   */
  async getAttributes(amazonOrderId, marketplaceIds) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getattributes
    const markets = this.#requireOrderAndMarkets(amazonOrderId, marketplaceIds)

    return await this.#apiRequest({
      url: `${ this.#hostFor(markets[0]) }/messaging/v1/orders/${ encodeURIComponent(amazonOrderId) }/attributes`,
      query: { marketplaceIds: markets },
      logTag: 'getAttributes',
    })
  }

  /**
   * @operationName Confirm Customization Details
   * @category Messaging
   * @description Sends the buyer a message confirming/requesting the customization details for a personalized order. Optionally attach files (from Create Upload Destination).
   * @route POST /confirm-customization-details
   * @paramDef {"type":"String","label":"Order","name":"amazonOrderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The order to send a customization-confirmation message for. Pick from Get Orders."}
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace(s) the order belongs to."}
   * @paramDef {"type":"String","label":"Message Text","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":true,"description":"The message body to send to the buyer requesting/confirming customization details."}
   * @paramDef {"type":"Array<MessageAttachment>","label":"Attachments","name":"attachments","description":"Optional files to attach. Each is {uploadDestinationId, fileName} from Create Upload Destination."}
   * @returns {Object}
   * @sampleResult {"success":true,"amazonOrderId":"123-1234567-1234567"}
   */
  async confirmCustomizationDetails(amazonOrderId, marketplaceIds, text, attachments) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/confirmcustomizationdetails
    // Request: POST /messaging/v1/orders/{amazonOrderId}/messages/confirmCustomizationDetails?marketplaceIds=...
    //   { text, attachments? }
    return await this.#sendOrderMessage('confirmCustomizationDetails', amazonOrderId, marketplaceIds, text, {
      attachments: this.#messageAttachments(attachments),
    })
  }

  /**
   * @operationName Confirm Delivery Details
   * @category Messaging
   * @description Sends the buyer a message confirming delivery details for an order. Use after a package is delivered to confirm receipt or offer help.
   * @route POST /create-confirm-delivery-details
   * @paramDef {"type":"String","label":"Order","name":"amazonOrderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The order to send the message for. Pick from Get Orders."}
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace(s) the order belongs to."}
   * @paramDef {"type":"String","label":"Message Text","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":true,"description":"The message body to send to the buyer."}
   * @returns {Object}
   * @sampleResult {"success":true,"amazonOrderId":"123-1234567-1234567"}
   */
  async createConfirmDeliveryDetails(amazonOrderId, marketplaceIds, text) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/createconfirmdeliverydetails
    // Request: POST /messaging/v1/orders/{amazonOrderId}/messages/confirmDeliveryDetails?marketplaceIds=...  { text }
    return await this.#sendOrderMessage('confirmDeliveryDetails', amazonOrderId, marketplaceIds, text)
  }

  /**
   * @operationName Confirm Order Details
   * @category Messaging
   * @description Sends the buyer a message confirming the details of their order (e.g. that it has been received and is being processed).
   * @route POST /create-confirm-order-details
   * @paramDef {"type":"String","label":"Order","name":"amazonOrderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The order to send the message for. Pick from Get Orders."}
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace(s) the order belongs to."}
   * @paramDef {"type":"String","label":"Message Text","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":true,"description":"The message body to send to the buyer."}
   * @returns {Object}
   * @sampleResult {"success":true,"amazonOrderId":"123-1234567-1234567"}
   */
  async createConfirmOrderDetails(amazonOrderId, marketplaceIds, text) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/createconfirmorderdetails
    // Request: POST /messaging/v1/orders/{amazonOrderId}/messages/confirmOrderDetails?marketplaceIds=...  { text }
    return await this.#sendOrderMessage('confirmOrderDetails', amazonOrderId, marketplaceIds, text)
  }

  /**
   * @operationName Confirm Service Details
   * @category Messaging
   * @description Sends the buyer a message confirming appointment/service details for a service order. Use for Amazon Home Services-style orders.
   * @route POST /create-confirm-service-details
   * @paramDef {"type":"String","label":"Order","name":"amazonOrderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The order to send the message for. Pick from Get Orders."}
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace(s) the order belongs to."}
   * @paramDef {"type":"String","label":"Message Text","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":true,"description":"The message body to send to the buyer."}
   * @returns {Object}
   * @sampleResult {"success":true,"amazonOrderId":"123-1234567-1234567"}
   */
  async createConfirmServiceDetails(amazonOrderId, marketplaceIds, text) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/createconfirmservicedetails
    // Request: POST /messaging/v1/orders/{amazonOrderId}/messages/confirmServiceDetails?marketplaceIds=...  { text }
    return await this.#sendOrderMessage('confirmServiceDetails', amazonOrderId, marketplaceIds, text)
  }

  /**
   * @operationName Send Unexpected Problem
   * @category Messaging
   * @description Sends the buyer a message about an unexpected problem with their order (e.g. a delay) and that you are working to resolve it.
   * @route POST /create-unexpected-problem
   * @paramDef {"type":"String","label":"Order","name":"amazonOrderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The order to send the message for. Pick from Get Orders."}
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace(s) the order belongs to."}
   * @paramDef {"type":"String","label":"Message Text","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":true,"description":"The message body to send to the buyer."}
   * @returns {Object}
   * @sampleResult {"success":true,"amazonOrderId":"123-1234567-1234567"}
   */
  async createUnexpectedProblem(amazonOrderId, marketplaceIds, text) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/createunexpectedproblem
    // Request: POST /messaging/v1/orders/{amazonOrderId}/messages/unexpectedProblem?marketplaceIds=...  { text }
    return await this.#sendOrderMessage('unexpectedProblem', amazonOrderId, marketplaceIds, text)
  }

  /**
   * @operationName Send Digital Access Key
   * @category Messaging
   * @description Sends the buyer a message containing a digital access key or activation instructions for a digital product. Optionally attach files.
   * @route POST /create-digital-access-key
   * @paramDef {"type":"String","label":"Order","name":"amazonOrderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The order to send a digital access key for. Pick from Get Orders."}
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace(s) the order belongs to."}
   * @paramDef {"type":"String","label":"Message Text","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":true,"description":"The message body containing the digital access key/instructions for the buyer."}
   * @paramDef {"type":"Array<MessageAttachment>","label":"Attachments","name":"attachments","description":"Optional files to attach. Each is {uploadDestinationId, fileName}."}
   * @returns {Object}
   * @sampleResult {"success":true,"amazonOrderId":"123-1234567-1234567"}
   */
  async createDigitalAccessKey(amazonOrderId, marketplaceIds, text, attachments) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/createdigitalaccesskey
    // Request: POST /messaging/v1/orders/{amazonOrderId}/messages/digitalAccessKey?marketplaceIds=...  { text, attachments? }
    return await this.#sendOrderMessage('digitalAccessKey', amazonOrderId, marketplaceIds, text, {
      attachments: this.#messageAttachments(attachments),
    })
  }

  /**
   * @operationName Send Amazon Motors Attachments
   * @category Messaging
   * @description Sends the buyer fitment/vehicle documents for an Amazon Motors order. This message type carries only attachments (no text body). Provide the files from Create Upload Destination.
   * @route POST /create-amazon-motors
   * @paramDef {"type":"String","label":"Order","name":"amazonOrderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The Amazon Motors order to send fitment/vehicle attachments for. Pick from Get Orders."}
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace(s) the order belongs to."}
   * @paramDef {"type":"Array<MessageAttachment>","label":"Attachments","name":"attachments","required":true,"description":"The files (fitment/vehicle docs) to send. Each is {uploadDestinationId, fileName} from Create Upload Destination."}
   * @returns {Object}
   * @sampleResult {"success":true,"amazonOrderId":"123-1234567-1234567"}
   */
  async createAmazonMotors(amazonOrderId, marketplaceIds, attachments) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/createamazonmotors
    // Request: POST /messaging/v1/orders/{amazonOrderId}/messages/amazonMotors?marketplaceIds=...  { attachments }
    const files = this.#messageAttachments(attachments)

    if (!files.length) {
      throw new Error('At least one Attachment is required — use Create Upload Destination to get an uploadDestinationId.')
    }

    return await this.#sendOrderMessage('amazonMotors', amazonOrderId, marketplaceIds, undefined, { attachments: files })
  }

  /**
   * @operationName Send Warranty Information
   * @category Messaging
   * @description Sends the buyer warranty document(s) for an order, with optional coverage start/end dates. This message type carries attachments (no text body). Provide the files from Create Upload Destination.
   * @route POST /create-warranty
   * @paramDef {"type":"String","label":"Order","name":"amazonOrderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The order to send warranty information for. Pick from Get Orders."}
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace(s) the order belongs to."}
   * @paramDef {"type":"Array<MessageAttachment>","label":"Attachments","name":"attachments","required":true,"description":"The warranty document(s) to send. Each is {uploadDestinationId, fileName}."}
   * @paramDef {"type":"String","label":"Coverage Start Date","name":"coverageStartDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional warranty coverage start (ISO 8601)."}
   * @paramDef {"type":"String","label":"Coverage End Date","name":"coverageEndDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional warranty coverage end (ISO 8601)."}
   * @returns {Object}
   * @sampleResult {"success":true,"amazonOrderId":"123-1234567-1234567"}
   */
  async createWarranty(amazonOrderId, marketplaceIds, attachments, coverageStartDate, coverageEndDate) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/createwarranty
    // Request: POST /messaging/v1/orders/{amazonOrderId}/messages/warranty?marketplaceIds=...
    //   { attachments, coverageStartDate?, coverageEndDate? }
    const files = this.#messageAttachments(attachments)

    if (!files.length) {
      throw new Error('At least one Attachment is required — use Create Upload Destination to get an uploadDestinationId.')
    }

    return await this.#sendOrderMessage('warranty', amazonOrderId, marketplaceIds, undefined, {
      attachments: files,
      coverageStartDate,
      coverageEndDate,
    })
  }

  /**
   * @operationName Request Negative Feedback Removal
   * @category Messaging
   * @description Asks Amazon to review a buyer's negative feedback for removal eligibility on an order. Sends a removal request; there is no message body.
   * @route POST /create-negative-feedback-removal
   * @paramDef {"type":"String","label":"Order","name":"amazonOrderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The order to request negative-feedback removal review for. Sends Amazon a removal request; no message body. Pick from Get Orders."}
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace(s) the order belongs to."}
   * @returns {Object}
   * @sampleResult {"success":true,"amazonOrderId":"123-1234567-1234567"}
   */
  async createNegativeFeedbackRemoval(amazonOrderId, marketplaceIds) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/createnegativefeedbackremoval
    // Body-less action POST - the path, verb, and marketplaceIds query are the whole request:
    //   POST /messaging/v1/orders/{amazonOrderId}/messages/negativeFeedbackRemoval?marketplaceIds=...
    const markets = this.#requireOrderAndMarkets(amazonOrderId, marketplaceIds)

    await this.#apiRequest({
      url: `${ this.#hostFor(markets[0]) }/messaging/v1/orders/${ encodeURIComponent(amazonOrderId) }/messages/negativeFeedbackRemoval`,
      method: 'post',
      query: { marketplaceIds: markets },
      logTag: 'createNegativeFeedbackRemoval',
    })

    return { success: true, amazonOrderId }
  }

  // Shared order+marketplace guard for Messaging/Solicitations methods. Returns the cleaned
  // marketplace array (the order id was already validated by the caller via this helper).
  #requireOrderAndMarkets(amazonOrderId, marketplaceIds) {
    if (!amazonOrderId) throw new Error('An Order id is required — use Get Orders to pick one.')

    const markets = this.#toArray(marketplaceIds)

    if (!markets.length) {
      throw new Error('At least one Marketplace is required — use Get Marketplace Participations to pick one.')
    }

    return markets
  }

  // Normalizes the attachments array to the documented {uploadDestinationId, fileName} wire shape.
  #messageAttachments(attachments) {
    if (!Array.isArray(attachments)) return []

    return attachments
      .filter(a => a && a.uploadDestinationId)
      .map(a => this.#compactBody({ uploadDestinationId: a.uploadDestinationId, fileName: a.fileName }))
  }

  // Posts a buyer-seller message of the given action type. `text` is required for text-carrying
  // actions; `extra` carries attachments / coverage dates. Returns a 201-empty success shape.
  async #sendOrderMessage(action, amazonOrderId, marketplaceIds, text, extra) {
    const markets = this.#requireOrderAndMarkets(amazonOrderId, marketplaceIds)

    // Text-carrying actions require non-empty text; attachment-only actions pass text === undefined.
    if (text !== undefined && !text) {
      throw new Error('A Message Text is required.')
    }

    const body = this.#compactBody({ text, ...(extra || {}) })

    await this.#apiRequest({
      url: `${ this.#hostFor(markets[0]) }/messaging/v1/orders/${ encodeURIComponent(amazonOrderId) }/messages/${ action }`,
      method: 'post',
      query: { marketplaceIds: markets },
      body,
      logTag: action,
    })

    return { success: true, amazonOrderId }
  }

  // ==========================================================================
  //  ACTIONS - Sales (Order Metrics)
  // ==========================================================================
  /**
   * @operationName Get Order Metrics
   * @category Sales
   * @description Returns aggregated order metrics (total sales, unit/order counts, average selling price) over a time interval, bucketed by a granularity (hourly, daily, weekly, monthly, yearly, or total). High-value analytics for sales reporting.
   * @route POST /get-order-metrics
   * @paramDef {"type":"Array<String>","label":"Marketplaces","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace(s) to aggregate order metrics for."}
   * @paramDef {"type":"String","label":"Interval","name":"interval","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The time window as start--end with timezone offsets, e.g. 2024-01-01T00:00:00-08:00--2024-01-08T00:00:00-08:00."}
   * @paramDef {"type":"String","label":"Granularity","name":"granularity","uiComponent":{"type":"DROPDOWN","options":{"values":["Hourly","Daily","Weekly","Monthly","Yearly","Total (whole interval)"]}},"required":true,"defaultValue":"Daily","description":"How to bucket the interval (Hourly, Daily, Weekly, Monthly, Yearly, or Total)."}
   * @paramDef {"type":"String","label":"Granularity Time Zone","name":"granularityTimeZone","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Time zone for bucketing (e.g. US/Pacific). Required unless Granularity is Total."}
   * @paramDef {"type":"String","label":"Buyer Type","name":"buyerType","uiComponent":{"type":"DROPDOWN","options":{"values":["All Buyers","Business (B2B)","Consumer (B2C)"]}},"defaultValue":"All Buyers","description":"Limit to all buyers, business (B2B), or consumer (B2C). Defaults to All."}
   * @paramDef {"type":"String","label":"Fulfillment Network","name":"fulfillmentNetwork","uiComponent":{"type":"DROPDOWN","options":{"values":["Merchant (FBM)","Amazon (FBA)"]}},"description":"Limit to a fulfillment network. Leave empty for both."}
   * @paramDef {"type":"String","label":"First Day Of Week","name":"firstDayOfWeek","uiComponent":{"type":"DROPDOWN","options":{"values":["Monday","Sunday"]}},"defaultValue":"Monday","description":"For Weekly granularity, which day starts the week. Defaults to Monday."}
   * @paramDef {"type":"String","label":"ASIN","name":"asin","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optionally restrict metrics to one ASIN (mutually exclusive with SKU)."}
   * @paramDef {"type":"String","label":"Seller SKU","name":"sku","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optionally restrict metrics to one Seller SKU (mutually exclusive with ASIN)."}
   * @returns {Object}
   * @sampleResult {"payload":[{"interval":"2024-01-01T00:00:00-08:00--2024-01-02T00:00:00-08:00","unitCount":5,"orderItemCount":5,"orderCount":4,"averageUnitPrice":{"amount":"39.99","currencyCode":"USD"},"totalSales":{"amount":"199.95","currencyCode":"USD"}}]}
   */
  async getOrderMetrics(marketplaceIds, interval, granularity, granularityTimeZone, buyerType, fulfillmentNetwork, firstDayOfWeek, asin, sku) {
    granularity = this.#resolveChoice(granularity, METRICS_GRANULARITY_MAP)
    buyerType = this.#resolveChoice(buyerType, METRICS_BUYER_TYPE_MAP)
    fulfillmentNetwork = this.#resolveChoice(fulfillmentNetwork, METRICS_FULFILLMENT_NETWORK_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/getordermetrics
    const markets = this.#toArray(marketplaceIds)

    if (!markets.length) {
      throw new Error('At least one Marketplace is required — use Get Marketplace Participations to pick one.')
    }

    if (!interval) throw new Error('An Interval is required, e.g. 2024-01-01T00:00:00-08:00--2024-01-08T00:00:00-08:00.')
    if (!granularity) throw new Error('A Granularity is required (e.g. Daily).')

    if (granularity !== 'Total' && !granularityTimeZone) {
      throw new Error('A Granularity Time Zone is required (e.g. US/Pacific) unless Granularity is Total.')
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor(markets[0]) }/sales/v1/orderMetrics`,
      query: {
        marketplaceIds: markets,
        interval,
        granularity,
        granularityTimeZone,
        buyerType: buyerType || 'All',
        fulfillmentNetwork,
        firstDayOfWeek: firstDayOfWeek || 'Monday',
        asin,
        sku,
      },
      logTag: 'getOrderMetrics',
    })
  }

  // ==========================================================================
  //  ACTIONS - Product Fees (estimate Amazon selling + FBA fees)
  // ==========================================================================
  /**
   * @operationName Get My Fees Estimate For SKU
   * @category Fees
   * @description Estimates Amazon's selling and FBA fees for one of your Seller SKUs at a price you specify. Use this for repricing/margin analysis. The estimate does not change anything.
   * @route POST /get-my-fees-estimate-for-sku
   * @paramDef {"type":"String","label":"Seller SKU","name":"sellerSku","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Your SKU to estimate Amazon fees for. Pull from Get Inventory Summaries or Get Order Items."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to estimate fees in."}
   * @paramDef {"type":"Number","label":"Listing Price","name":"listingPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"The price you would list the item at (the fee estimate is based on this)."}
   * @paramDef {"type":"String","label":"Currency","name":"currencyCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"defaultValue":"USD","description":"ISO currency code for the price (e.g. USD, EUR, GBP)."}
   * @paramDef {"type":"Number","label":"Shipping Price","name":"shippingPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional shipping charge to include in the estimate."}
   * @paramDef {"type":"Boolean","label":"Fulfilled By Amazon (FBA)","name":"isAmazonFulfilled","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Estimate FBA fees (true) or merchant-fulfilled fees (false)."}
   * @paramDef {"type":"String","label":"Identifier","name":"identifier","uiComponent":{"type":"SINGLE_LINE_TEXT"},"defaultValue":"1","description":"A unique id you assign to this estimate request (echoed back in the result)."}
   * @returns {Object}
   * @sampleResult {"payload":{"FeesEstimateResult":{"Status":"Success","FeesEstimateIdentifier":{"MarketplaceId":"ATVPDKIKX0DER","IdType":"SellerSKU","IdValue":"SKU-123"},"FeesEstimate":{"TotalFeesEstimate":{"CurrencyCode":"USD","Amount":7.50},"FeeDetailList":[{"FeeType":"ReferralFee","FinalFee":{"CurrencyCode":"USD","Amount":4.50}}]}}}}
   */
  async getMyFeesEstimateForSKU(sellerSku, marketplaceId, listingPrice, currencyCode, shippingPrice, isAmazonFulfilled, identifier) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getmyfeesestimateforsku
    // Request: POST /products/fees/v0/listings/{SellerSKU}/feesEstimate
    //   { FeesEstimateRequest:{ MarketplaceId, IsAmazonFulfilled, Identifier, PriceToEstimateFees:{ ListingPrice:{CurrencyCode,Amount}, Shipping?:{...} } } }
    if (!sellerSku) throw new Error('A Seller SKU is required.')

    const body = {
      FeesEstimateRequest: this.#feesEstimateRequest(marketplaceId, listingPrice, currencyCode, shippingPrice, isAmazonFulfilled, identifier),
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/products/fees/v0/listings/${ encodeURIComponent(sellerSku) }/feesEstimate`,
      method: 'post',
      body,
      logTag: 'getMyFeesEstimateForSKU',
    })
  }

  /**
   * @operationName Get My Fees Estimate For ASIN
   * @category Fees
   * @description Estimates Amazon's selling and FBA fees for an ASIN at a price you specify. Use this for repricing/margin analysis on catalog products. The estimate does not change anything.
   * @route POST /get-my-fees-estimate-for-asin
   * @paramDef {"type":"String","label":"ASIN","name":"asin","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The ASIN to estimate Amazon fees for. Pull from Search Catalog Items."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to estimate fees in."}
   * @paramDef {"type":"Number","label":"Listing Price","name":"listingPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"The price you would list the item at."}
   * @paramDef {"type":"String","label":"Currency","name":"currencyCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"defaultValue":"USD","description":"ISO currency code for the price (e.g. USD)."}
   * @paramDef {"type":"Number","label":"Shipping Price","name":"shippingPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional shipping charge to include in the estimate."}
   * @paramDef {"type":"Boolean","label":"Fulfilled By Amazon (FBA)","name":"isAmazonFulfilled","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Estimate FBA fees (true) or merchant-fulfilled fees (false)."}
   * @paramDef {"type":"String","label":"Identifier","name":"identifier","uiComponent":{"type":"SINGLE_LINE_TEXT"},"defaultValue":"1","description":"A unique id you assign to this estimate request (echoed back)."}
   * @returns {Object}
   * @sampleResult {"payload":{"FeesEstimateResult":{"Status":"Success","FeesEstimate":{"TotalFeesEstimate":{"CurrencyCode":"USD","Amount":7.50},"FeeDetailList":[{"FeeType":"ReferralFee","FinalFee":{"CurrencyCode":"USD","Amount":4.50}}]}}}}
   */
  async getMyFeesEstimateForASIN(asin, marketplaceId, listingPrice, currencyCode, shippingPrice, isAmazonFulfilled, identifier) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getmyfeesestimateforasin
    // Request: POST /products/fees/v0/items/{Asin}/feesEstimate
    //   { FeesEstimateRequest:{ MarketplaceId, IsAmazonFulfilled, Identifier, PriceToEstimateFees:{ ListingPrice:{CurrencyCode,Amount} } } }
    if (!asin) throw new Error('An ASIN is required — pull one from Search Catalog Items.')

    const body = {
      FeesEstimateRequest: this.#feesEstimateRequest(marketplaceId, listingPrice, currencyCode, shippingPrice, isAmazonFulfilled, identifier),
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/products/fees/v0/items/${ encodeURIComponent(asin) }/feesEstimate`,
      method: 'post',
      body,
      logTag: 'getMyFeesEstimateForASIN',
    })
  }

  /**
   * @operationName Get My Fees Estimates (Batch)
   * @category Fees
   * @description Estimates Amazon fees for up to 20 products (by ASIN or Seller SKU) at prices you specify, in a single batch call. Use this to price a whole list at once. The estimates do not change anything.
   * @route POST /get-my-fees-estimates
   * @paramDef {"type":"Array<FeeEstimateItem>","label":"Items","name":"items","required":true,"description":"Up to 20 fee-estimate requests. Each item is one product + price to estimate fees for: {idType (ASIN/SellerSKU), idValue, marketplaceId, listingPrice, currencyCode, isAmazonFulfilled, identifier}."}
   * @returns {Object}
   * @sampleResult {"FeesEstimateByIdResult":[{"FeesEstimateResult":{"Status":"Success","FeesEstimate":{"TotalFeesEstimate":{"CurrencyCode":"USD","Amount":7.50}}},"FeesEstimateIdentifier":{"MarketplaceId":"ATVPDKIKX0DER","IdType":"ASIN","IdValue":"B00CZX5JE2"}}]}
   */
  async getMyFeesEstimates(items) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getmyfeesestimates
    // Request: POST /products/fees/v0/feesEstimate  (TOP-LEVEL JSON ARRAY body - no wrapper)
    //   [ { IdType, IdValue, FeesEstimateRequest:{ MarketplaceId, IsAmazonFulfilled, Identifier, PriceToEstimateFees:{ ListingPrice:{CurrencyCode,Amount} } } } ]
    const list = Array.isArray(items) ? items : []

    if (!list.length) {
      throw new Error('At least one Item is required (each is a product + price to estimate fees for).')
    }

    const marketplaceId = list[0] && list[0].marketplaceId
    const body = list.map(item => ({
      IdType: item.idType,
      IdValue: item.idValue,
      FeesEstimateRequest: this.#feesEstimateRequest(item.marketplaceId, item.listingPrice, item.currencyCode, undefined, item.isAmazonFulfilled, item.identifier),
    }))

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/products/fees/v0/feesEstimate`,
      method: 'post',
      body,
      logTag: 'getMyFeesEstimates',
    })
  }

  // Builds the documented FeesEstimateRequest object shared by the three fee-estimate methods.
  #feesEstimateRequest(marketplaceId, listingPrice, currencyCode, shippingPrice, isAmazonFulfilled, identifier) {
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')

    if (listingPrice === null || listingPrice === undefined || listingPrice === '') {
      throw new Error('A Listing Price is required for the fee estimate.')
    }

    const currency = currencyCode || 'USD'
    const priceToEstimateFees = { ListingPrice: { CurrencyCode: currency, Amount: Number(listingPrice) } }

    if (shippingPrice !== null && shippingPrice !== undefined && shippingPrice !== '') {
      priceToEstimateFees.Shipping = { CurrencyCode: currency, Amount: Number(shippingPrice) }
    }

    return this.#compactBody({
      MarketplaceId: marketplaceId,
      IsAmazonFulfilled: isAmazonFulfilled === undefined ? true : isAmazonFulfilled,
      Identifier: identifier || '1',
      PriceToEstimateFees: priceToEstimateFees,
    })
  }

  // ==========================================================================
  //  ACTIONS - Listings: Restrictions / search / Product Type Definitions
  // ==========================================================================
  /**
   * @operationName Get Listing Restrictions
   * @category Listings
   * @description Checks whether you are allowed to list a given ASIN (and condition) in a marketplace, and returns any approval-required reasons with links to request approval. Use this before creating a listing to confirm eligibility.
   * @route POST /get-listings-restrictions
   * @paramDef {"type":"String","label":"ASIN","name":"asin","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The ASIN you want to check listing eligibility for. Pull from Search Catalog Items or Get Order Items."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to check restrictions in."}
   * @paramDef {"type":"String","label":"Condition","name":"conditionType","uiComponent":{"type":"DROPDOWN","options":{"values":["New","New - Open Box","Refurbished","Used - Like New","Used - Very Good","Used - Good","Used - Acceptable","Collectible - Like New","Collectible - Very Good","Collectible - Good","Collectible - Acceptable","Club"]}},"description":"The condition you intend to list the item in. Leave blank to check all conditions."}
   * @paramDef {"type":"String","label":"Reason Language","name":"reasonLocale","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Locale for the human-readable restriction reasons (e.g. en_US). Defaults to the marketplace language."}
   * @returns {Object}
   * @sampleResult {"restrictions":[{"marketplaceId":"ATVPDKIKX0DER","conditionType":"used_very_good","reasons":[{"message":"You cannot list the product in this condition.","reasonCode":"APPROVAL_REQUIRED","links":[{"resource":"https://sellercentral.amazon.com/hz/approvalrequest","verb":"GET","title":"Request Approval","type":"text/html"}]}]}]}
   */
  async getListingsRestrictions(asin, marketplaceId, conditionType, reasonLocale) {
    conditionType = this.#resolveChoice(conditionType, RESTRICTION_CONDITION_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/getlistingsrestrictions
    if (!asin) throw new Error('An ASIN is required — use Search Catalog Items to find one.')
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')

    const sellerId = this.#requireSellerId()

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/listings/2021-08-01/restrictions`,
      query: {
        asin,
        sellerId,
        marketplaceIds: marketplaceId,
        conditionType,
        reasonLocale,
      },
      logTag: 'getListingsRestrictions',
    })
  }

  /**
   * @operationName Search My Listings
   * @category Listings
   * @description Lists your own SKU listings in a marketplace, optionally filtered by identifiers, status and severity, and sorted. This is the "list" operation for your catalog of listings. Use it to enumerate, then act on, your items.
   * @route POST /search-listings-items
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace whose listings to search (one marketplace per call)."}
   * @paramDef {"type":"Array<String>","label":"Identifiers","name":"identifiers","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Up to 20 product identifiers (e.g. your SKUs or ASINs) to filter to. Leave blank to list all your items. Requires Identifiers Type."}
   * @paramDef {"type":"String","label":"Identifiers Type","name":"identifiersType","uiComponent":{"type":"DROPDOWN","options":{"values":["Seller SKU","ASIN","EAN","FNSKU","GTIN","ISBN","JAN","MINSAN","UPC"]}},"description":"What kind of identifiers you provided above. Required when Identifiers is set."}
   * @paramDef {"type":"Array<String>","label":"Included Data","name":"includedData","uiComponent":{"type":"DROPDOWN","options":{"values":["Summaries","Attributes","Issues","Offers","Fulfillment Availability","Procurement","Relationships","Product Types"]}},"defaultValue":["Summaries"],"description":"Which detail sets to return per item. Defaults to Summaries."}
   * @paramDef {"type":"Array<String>","label":"With Status","name":"withStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Buyable","Discoverable"]}},"description":"Only include listings with these statuses."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["SKU","Created Date","Last Updated Date"]}},"defaultValue":"Last Updated Date","description":"Field to sort results by."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"defaultValue":"Descending","description":"Ascending or descending."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":10,"description":"Results per page (max 20)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Token from a prior response to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"numberOfResults":1,"pagination":{"nextToken":"abc123"},"items":[{"sku":"SKU-123","summaries":[{"marketplaceId":"ATVPDKIKX0DER","status":["BUYABLE"],"itemName":"Sample Item","createdDate":"2024-01-01T00:00:00Z","lastUpdatedDate":"2024-02-01T00:00:00Z"}]}]}
   */
  async searchListingsItems(marketplaceId, identifiers, identifiersType, includedData, withStatus, sortBy, sortOrder, pageSize, pageToken) {
    identifiersType = this.#resolveChoice(identifiersType, LISTING_IDENTIFIERS_TYPE_MAP)
    includedData = this.#resolveChoices(includedData, LISTING_INCLUDED_DATA_MAP)
    withStatus = this.#resolveChoices(withStatus, LISTING_WITH_STATUS_MAP)
    sortBy = this.#resolveChoice(sortBy, LISTING_SORT_BY_MAP)
    sortOrder = this.#resolveChoice(sortOrder, SORT_ORDER_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/searchlistingsitems
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')

    const ids = this.#toArray(identifiers)

    if (ids.length && !identifiersType) {
      throw new Error('An Identifiers Type is required when Identifiers are provided (e.g. SKU or ASIN).')
    }

    const sellerId = this.#requireSellerId()

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/listings/2021-08-01/items/${ encodeURIComponent(sellerId) }`,
      query: {
        marketplaceIds: marketplaceId,
        identifiers: ids,
        identifiersType: ids.length ? identifiersType : undefined,
        includedData: this.#toArray(includedData).length ? this.#toArray(includedData) : ['summaries'],
        withStatus: this.#toArray(withStatus),
        sortBy: sortBy || 'lastUpdatedDate',
        sortOrder: sortOrder || 'DESC',
        pageSize: pageSize || 10,
        pageToken,
      },
      logTag: 'searchListingsItems',
    })
  }

  /**
   * @operationName Search Product Types
   * @category Product Type Definitions
   * @description Finds Amazon product types by keyword (e.g. "luggage") or by a sample item title, for a marketplace. Use this to discover the right product type before fetching its listing schema or creating a listing.
   * @route POST /search-definitions-product-types
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to search product types for."}
   * @paramDef {"type":"Array<String>","label":"Keywords","name":"keywords","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Keywords to find matching product types (e.g. luggage). Cannot be combined with Item Name."}
   * @paramDef {"type":"String","label":"Item Name","name":"itemName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A product title to get a recommended product type for. Cannot be combined with Keywords."}
   * @paramDef {"type":"String","label":"Display Locale","name":"locale","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Locale for the returned display names (e.g. en_US)."}
   * @paramDef {"type":"String","label":"Search Locale","name":"searchLocale","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Language of the Keywords / Item Name you entered."}
   * @returns {Object}
   * @sampleResult {"productTypes":[{"name":"LUGGAGE","marketplaceIds":["ATVPDKIKX0DER"],"displayName":"Luggage"}],"productTypeVersion":"UHEdwbleo="}
   */
  async searchDefinitionsProductTypes(marketplaceId, keywords, itemName, locale, searchLocale) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/searchdefinitionsproducttypes
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/definitions/2020-09-01/productTypes`,
      query: {
        marketplaceIds: marketplaceId,
        keywords: this.#toArray(keywords),
        itemName,
        locale,
        searchLocale,
      },
      logTag: 'searchDefinitionsProductTypes',
    })
  }

  /**
   * @operationName Get Product Type Schema
   * @category Product Type Definitions
   * @description Returns the listing requirements and attribute schema for an Amazon product type in a marketplace. The schema link tells you which attributes Create/Replace Listing expects. Use this to build a valid listing.
   * @route POST /get-definitions-product-type
   * @paramDef {"type":"String","label":"Product Type","name":"productType","dictionary":"getProductTypesDictionary","required":true,"description":"The product type to fetch the listing schema for (e.g. LUGGAGE)."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace whose schema to fetch (one per call)."}
   * @paramDef {"type":"String","label":"Requirements","name":"requirements","uiComponent":{"type":"DROPDOWN","options":{"values":["Listing (Product + Offer)","Listing - Product Only","Listing - Offer Only"]}},"defaultValue":"Listing (Product + Offer)","description":"Which requirement set to return."}
   * @paramDef {"type":"String","label":"Requirements Enforced","name":"requirementsEnforced","uiComponent":{"type":"DROPDOWN","options":{"values":["Enforced","Not Enforced"]}},"defaultValue":"Enforced","description":"Whether to enforce attribute requirements."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","uiComponent":{"type":"SINGLE_LINE_TEXT"},"defaultValue":"DEFAULT","description":"Locale for the schema labels (e.g. en_US)."}
   * @paramDef {"type":"String","label":"Product Type Version","name":"productTypeVersion","uiComponent":{"type":"SINGLE_LINE_TEXT"},"defaultValue":"LATEST","description":"Schema version to return. Defaults to the latest."}
   * @returns {Object}
   * @sampleResult {"metaSchema":{"link":{"resource":"https://example.com/meta-schema.json","verb":"GET"},"checksum":"abc"},"schema":{"link":{"resource":"https://example.com/LUGGAGE_en_US.json","verb":"GET"},"checksum":"def"},"requirements":"LISTING","requirementsEnforced":"ENFORCED","productType":"LUGGAGE","displayName":"Luggage","productTypeVersion":{"version":"UHEdwbleo=","latest":true}}
   */
  async getDefinitionsProductType(productType, marketplaceId, requirements, requirementsEnforced, locale, productTypeVersion) {
    requirements = this.#resolveChoice(requirements, PRODUCT_TYPE_REQUIREMENTS_MAP)
    requirementsEnforced = this.#resolveChoice(requirementsEnforced, REQUIREMENTS_ENFORCED_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/getdefinitionsproducttype
    if (!productType) throw new Error('A Product Type is required — use Search Product Types to find one.')
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')

    const sellerId = this.#sellerId()

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/definitions/2020-09-01/productTypes/${ encodeURIComponent(productType) }`,
      query: {
        marketplaceIds: marketplaceId,
        sellerId,
        requirements: requirements || 'LISTING',
        requirementsEnforced: requirementsEnforced || 'ENFORCED',
        locale: locale || 'DEFAULT',
        productTypeVersion: productTypeVersion || 'LATEST',
      },
      logTag: 'getDefinitionsProductType',
    })
  }

  // ==========================================================================
  //  ACTIONS - Catalog Items v2020-12-01 (legacy-but-live; distinct from 2022-04-01)
  // ==========================================================================
  /**
   * @operationName Search Catalog (2020-12-01)
   * @category Catalog
   * @description Searches the Amazon catalog (v2020-12-01) by keywords and/or brand for a marketplace, returning ASINs with the chosen data sets. Use this when an integration is pinned to the 2020-12-01 catalog shape (salesRanks/images differ from 2022-04-01).
   * @route POST /search-catalog-items-2020
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to search the Amazon catalog in."}
   * @paramDef {"type":"Array<String>","label":"Keywords","name":"keywords","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Search terms (e.g. product title words). Leave blank to browse by brand/classification."}
   * @paramDef {"type":"Array<String>","label":"Brand Names","name":"brandNames","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Restrict results to these brands."}
   * @paramDef {"type":"Array<String>","label":"Included Data","name":"includedData","uiComponent":{"type":"DROPDOWN","options":{"values":["Identifiers","Images","Product Types","Sales Ranks","Summaries","Variations"]}},"defaultValue":["Summaries"],"description":"Which detail sets to return per item. Defaults to Summaries."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":10,"description":"Results per page (max 20)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Token from a prior response for the next page."}
   * @returns {Object}
   * @sampleResult {"numberOfResults":1,"pagination":{"nextToken":"abc"},"items":[{"asin":"B07N4M94X4","summaries":[{"marketplaceId":"ATVPDKIKX0DER","itemName":"Sample Product","brandName":"SampleBrand"}]}]}
   */
  async searchCatalogItems2020(marketplaceId, keywords, brandNames, includedData, pageSize, pageToken) {
    includedData = this.#resolveChoices(includedData, CATALOG2020_INCLUDED_DATA_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/searchcatalogitems-1
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/catalog/2020-12-01/items`,
      query: {
        marketplaceIds: marketplaceId,
        keywords: this.#toArray(keywords),
        brandNames: this.#toArray(brandNames),
        includedData: this.#toArray(includedData).length ? this.#toArray(includedData) : ['summaries'],
        pageSize: pageSize || 10,
        pageToken,
      },
      logTag: 'searchCatalogItems2020',
    })
  }

  /**
   * @operationName Get Catalog Item (2020-12-01)
   * @category Catalog
   * @description Fetches a single catalog item by ASIN (v2020-12-01) with the chosen data sets (identifiers, images, sales ranks, summaries, variations). Use this when pinned to the 2020-12-01 catalog shape.
   * @route POST /get-catalog-item-2020
   * @paramDef {"type":"String","label":"ASIN","name":"asin","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The ASIN of the catalog item to fetch."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to read the item from."}
   * @paramDef {"type":"Array<String>","label":"Included Data","name":"includedData","uiComponent":{"type":"DROPDOWN","options":{"values":["Identifiers","Images","Product Types","Sales Ranks","Summaries","Variations"]}},"defaultValue":["Summaries"],"description":"Which detail sets to return. Defaults to Summaries."}
   * @returns {Object}
   * @sampleResult {"asin":"B07N4M94X4","summaries":[{"marketplaceId":"ATVPDKIKX0DER","itemName":"Sample Product","brandName":"SampleBrand"}],"salesRanks":[{"marketplaceId":"ATVPDKIKX0DER","ranks":[{"title":"Books","rank":1234}]}]}
   */
  async getCatalogItem2020(asin, marketplaceId, includedData) {
    includedData = this.#resolveChoices(includedData, CATALOG2020_INCLUDED_DATA_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/getcatalogitem
    if (!asin) throw new Error('An ASIN is required.')
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/catalog/2020-12-01/items/${ encodeURIComponent(asin) }`,
      query: {
        marketplaceIds: marketplaceId,
        includedData: this.#toArray(includedData).length ? this.#toArray(includedData) : ['summaries'],
      },
      logTag: 'getCatalogItem2020',
    })
  }

  // ==========================================================================
  //  ACTIONS - Data Kiosk (async GraphQL analytics queries)
  // ==========================================================================
  /**
   * @operationName Create Data Kiosk Query
   * @category Data Kiosk
   * @description Submits a Data Kiosk GraphQL analytics query and returns its query id. The query runs asynchronously - poll Get Data Kiosk Query until it is Done, then Get Document for the result. Strict rate limit (about one per minute).
   * @route POST /create-query
   * @paramDef {"type":"String","label":"GraphQL Query","name":"query","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":true,"description":"The Data Kiosk GraphQL query to run (max 8000 chars). Build it in the Amazon Data Kiosk schema explorer, e.g. analytics_salesAndTraffic_2023_11_15 { ... }."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"To fetch the next page of a prior query's results, pass its pagination token here."}
   * @returns {Object}
   * @sampleResult {"queryId":"12345678"}
   */
  async createQuery(query, paginationToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/createquery
    // Request: POST /dataKiosk/2023-11-15/queries  body: { query, paginationToken? }
    if (!query) throw new Error('A GraphQL Query is required (build it in the Data Kiosk schema explorer).')

    const body = this.#compactBody({ query, paginationToken })

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/dataKiosk/2023-11-15/queries`,
      method: 'post',
      body,
      logTag: 'createQuery',
    })
  }

  /**
   * @operationName Get Data Kiosk Queries
   * @category Data Kiosk
   * @description Lists your Data Kiosk queries, optionally filtered by processing status and created date. Use this to find a query id or check which queries are done.
   * @route POST /get-queries
   * @paramDef {"type":"Array<String>","label":"Processing Statuses","name":"processingStatuses","uiComponent":{"type":"DROPDOWN","options":{"values":["In Queue","In Progress","Cancelled","Done","Fatal"]}},"description":"Filter by query status."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":10,"description":"Results per page (max 100)."}
   * @paramDef {"type":"String","label":"Created Since","name":"createdSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only queries created at or after this time."}
   * @paramDef {"type":"String","label":"Created Until","name":"createdUntil","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only queries created at or before this time."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Token from a prior response for the next page."}
   * @returns {Object}
   * @sampleResult {"queries":[{"queryId":"12345678","query":"query{...}","processingStatus":"DONE","createdTime":"2024-01-01T00:00:00Z","dataDocumentId":"DOCUMENT_ID"}],"pagination":{"nextToken":"abc"}}
   */
  async getQueries(processingStatuses, pageSize, createdSince, createdUntil, paginationToken) {
    processingStatuses = this.#resolveChoices(processingStatuses, PROCESSING_STATUS_MAP)

    // docs: https://developer-docs.amazon.com/sp-api/reference/getqueries
    return await this.#apiRequest({
      url: `${ this.#hostFor() }/dataKiosk/2023-11-15/queries`,
      query: {
        processingStatuses: this.#toArray(processingStatuses),
        pageSize: pageSize || 10,
        createdSince,
        createdUntil,
        paginationToken,
      },
      logTag: 'getQueries',
    })
  }

  /**
   * @operationName Get Data Kiosk Query
   * @category Data Kiosk
   * @description Returns the status and details of one Data Kiosk query, including its data document id once it is Done. Use this to poll a query and then pass dataDocumentId to Get Document.
   * @route POST /get-query
   * @paramDef {"type":"String","label":"Query","name":"queryId","dictionary":"getDataKioskQueriesDictionary","required":true,"description":"The query to check the status of."}
   * @returns {Object}
   * @sampleResult {"queryId":"12345678","processingStatus":"DONE","query":"query{...}","createdTime":"2024-01-01T00:00:00Z","dataDocumentId":"DOCUMENT_ID","errorDocumentId":null}
   */
  async getQuery(queryId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getquery
    if (!queryId) throw new Error('A Query id is required — use Get Data Kiosk Queries to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/dataKiosk/2023-11-15/queries/${ encodeURIComponent(queryId) }`,
      logTag: 'getQuery',
    })
  }

  /**
   * @operationName Cancel Data Kiosk Query
   * @category Data Kiosk
   * @description Cancels a Data Kiosk query that is still in queue or in progress. Use this to stop a query you no longer need.
   * @route POST /cancel-query
   * @paramDef {"type":"String","label":"Query","name":"queryId","dictionary":"getDataKioskQueriesDictionary","required":true,"description":"The query to cancel."}
   * @returns {Object}
   * @sampleResult {"status":"cancelled","queryId":"12345678"}
   */
  async cancelQuery(queryId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/cancelquery
    // Body-less DELETE - the path and verb are the whole request:
    //   DELETE /dataKiosk/2023-11-15/queries/{queryId}  (no request body)
    if (!queryId) throw new Error('A Query id is required — use Get Data Kiosk Queries to pick one.')

    await this.#apiRequest({
      url: `${ this.#hostFor() }/dataKiosk/2023-11-15/queries/${ encodeURIComponent(queryId) }`,
      method: 'delete',
      logTag: 'cancelQuery',
    })

    return { status: 'cancelled', queryId }
  }

  /**
   * @operationName Get Data Kiosk Document
   * @category Data Kiosk
   * @description Returns a presigned URL (5-minute TTL) for a completed Data Kiosk query's data document (or error document). Fetch the URL to download the query results.
   * @route POST /get-document
   * @paramDef {"type":"String","label":"Document","name":"documentId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getDataKioskDocumentsDictionary","required":true,"description":"The dataDocumentId (or errorDocumentId) from a completed query. Pick from your completed queries, or paste an id from Get Data Kiosk Query."}
   * @returns {Object}
   * @sampleResult {"documentId":"DOCUMENT_ID","documentUrl":"https://d34o8swod1owfl.cloudfront.net/signed"}
   */
  async getDocument(documentId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getdocument
    if (!documentId) throw new Error('A Document id is required — use Get Data Kiosk Query to read dataDocumentId.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/dataKiosk/2023-11-15/documents/${ encodeURIComponent(documentId) }`,
      logTag: 'getDocument',
    })
  }

  // ==========================================================================
  //  ACTIONS - Fulfillment Outbound (Multi-Channel Fulfillment / MCF)
  // ==========================================================================
  /**
   * @operationName Get Fulfillment Preview
   * @category Fulfillment Outbound
   * @description Quotes shipping speeds, weights and FBA fees for shipping your FBA inventory to a destination address - without creating an order. Use this to price a Multi-Channel Fulfillment shipment before committing.
   * @route POST /get-fulfillment-preview
   * @paramDef {"type":"String","label":"Recipient Name","name":"recipientName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Name of the person receiving the shipment."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"addressLine1","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Street address of the destination."}
   * @paramDef {"type":"String","label":"Address Line 2","name":"addressLine2","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Apartment, suite, unit, etc. (optional)."}
   * @paramDef {"type":"String","label":"City","name":"city","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Destination city."}
   * @paramDef {"type":"String","label":"State / Region","name":"stateOrRegion","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Destination state, province, or region."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Destination ZIP / postal code."}
   * @paramDef {"type":"String","label":"Country Code","name":"countryCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"defaultValue":"US","description":"Two-letter ISO country code (e.g. US, GB, DE)."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Recipient phone number (optional)."}
   * @paramDef {"type":"Array<MCFItem>","label":"Items","name":"items","required":true,"description":"The items you want a fulfillment quote for. Each is {sellerSku, sellerFulfillmentOrderItemId, quantity}."}
   * @paramDef {"type":"Array<String>","label":"Shipping Speeds","name":"shippingSpeedCategories","uiComponent":{"type":"DROPDOWN","options":{"values":["Standard","Expedited","Priority","Scheduled Delivery"]}},"description":"Which shipping speeds to quote. Leave blank for all eligible."}
   * @paramDef {"type":"Boolean","label":"Include COD Preview","name":"includeCODFulfillmentPreview","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"Include cash-on-delivery pricing in the preview."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","description":"The marketplace to quote in."}
   * @returns {Object}
   * @sampleResult {"payload":{"fulfillmentPreviews":[{"shippingSpeedCategory":"Standard","isFulfillable":true,"isCODCapable":false,"estimatedShippingWeight":{"unit":"pounds","value":1.2},"estimatedFees":[{"name":"FBAPerUnitFulfillmentFee","amount":{"currencyCode":"USD","value":3.5}}]}]}}
   */
  async getFulfillmentPreview(recipientName, addressLine1, addressLine2, city, stateOrRegion, postalCode, countryCode, phone, items, shippingSpeedCategories, includeCODFulfillmentPreview, marketplaceId) {
    shippingSpeedCategories = this.#resolveChoices(shippingSpeedCategories, MCF_SHIPPING_SPEED_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/getfulfillmentpreview
    // Request: POST /fba/outbound/2020-07-01/fulfillmentOrders/preview
    //   body: { address, items:[{sellerSku, sellerFulfillmentOrderItemId, quantity}], shippingSpeedCategories? }
    const address = this.#mcfAddress(recipientName, addressLine1, addressLine2, city, stateOrRegion, postalCode, countryCode, phone)
    const mcfItems = this.#mcfItems(items)

    const body = this.#compactBody({
      address,
      items: mcfItems,
      shippingSpeedCategories: this.#toArray(shippingSpeedCategories),
      includeCODFulfillmentPreview: includeCODFulfillmentPreview || undefined,
      marketplaceId,
    })

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/fba/outbound/2020-07-01/fulfillmentOrders/preview`,
      method: 'post',
      body,
      logTag: 'getFulfillmentPreview',
    })
  }

  /**
   * @operationName Create Fulfillment Order
   * @category Fulfillment Outbound
   * @description Creates a Multi-Channel Fulfillment order - Amazon picks, packs and ships your FBA inventory to any address. This consumes inventory and physically ships. Use it to fulfill an off-Amazon order from FBA stock.
   * @route POST /create-fulfillment-order
   * @paramDef {"type":"String","label":"Order Reference","name":"orderReference","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Your own unique reference for this MCF order (max 40 chars). You will use this to track/cancel it later. Sent to Amazon as sellerFulfillmentOrderId."}
   * @paramDef {"type":"String","label":"Displayable Order Number","name":"displayableOrderNumber","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The order number shown to the recipient on the packing slip (max 40 chars). Sent to Amazon as displayableOrderId."}
   * @paramDef {"type":"String","label":"Order Date","name":"displayableOrderDate","uiComponent":{"type":"DATE_TIME_PICKER"},"required":true,"description":"The order date shown on the packing slip (ISO 8601, e.g. 2024-01-01T00:00:00Z)."}
   * @paramDef {"type":"String","label":"Packing Slip Comment","name":"displayableOrderComment","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":true,"description":"A thank-you / note shown to the recipient on the packing slip (max 750 chars)."}
   * @paramDef {"type":"String","label":"Shipping Speed","name":"shippingSpeedCategory","uiComponent":{"type":"DROPDOWN","options":{"values":["Standard","Expedited","Priority","Scheduled Delivery"]}},"required":true,"description":"How fast to ship the order."}
   * @paramDef {"type":"String","label":"Recipient Name","name":"recipientName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Name of the person receiving the shipment."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"addressLine1","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Street address of the destination."}
   * @paramDef {"type":"String","label":"Address Line 2","name":"addressLine2","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Apartment, suite, unit, etc. (optional)."}
   * @paramDef {"type":"String","label":"City","name":"city","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Destination city."}
   * @paramDef {"type":"String","label":"State / Region","name":"stateOrRegion","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Destination state, province, or region."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Destination ZIP / postal code."}
   * @paramDef {"type":"String","label":"Country Code","name":"countryCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"defaultValue":"US","description":"Two-letter ISO country code (e.g. US, GB, DE)."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Recipient phone number (optional)."}
   * @paramDef {"type":"Array<MCFItem>","label":"Items","name":"items","required":true,"description":"The FBA items to ship. Each is {sellerSku, sellerFulfillmentOrderItemId, quantity} (plus optional perUnitDeclaredValue, giftMessage, displayableComment)."}
   * @paramDef {"type":"String","label":"Fulfillment Action","name":"fulfillmentAction","uiComponent":{"type":"DROPDOWN","options":{"values":["Ship Now","Hold"]}},"defaultValue":"Ship Now","description":"Ship the order now, or place it on hold."}
   * @paramDef {"type":"String","label":"Fulfillment Policy","name":"fulfillmentPolicy","uiComponent":{"type":"DROPDOWN","options":{"values":["Fill Or Kill","Fill All","Fill All Available"]}},"defaultValue":"Fill Or Kill","description":"How Amazon handles partial availability."}
   * @paramDef {"type":"Array<String>","label":"Notification Emails","name":"notificationEmails","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Emails to notify when the shipment ships (optional)."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","description":"The marketplace this order belongs to."}
   * @returns {Object}
   * @sampleResult {"status":"created","sellerFulfillmentOrderId":"MCF-1001"}
   */
  async createFulfillmentOrder(orderReference, displayableOrderNumber, displayableOrderDate, displayableOrderComment, shippingSpeedCategory, recipientName, addressLine1, addressLine2, city, stateOrRegion, postalCode, countryCode, phone, items, fulfillmentAction, fulfillmentPolicy, notificationEmails, marketplaceId) {
    shippingSpeedCategory = this.#resolveChoice(shippingSpeedCategory, MCF_SHIPPING_SPEED_MAP)
    fulfillmentAction = this.#resolveChoice(fulfillmentAction, FULFILLMENT_ACTION_MAP)
    fulfillmentPolicy = this.#resolveChoice(fulfillmentPolicy, FULFILLMENT_POLICY_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/createfulfillmentorder
    // Request: POST /fba/outbound/2020-07-01/fulfillmentOrders
    //   body: { sellerFulfillmentOrderId, displayableOrderId, displayableOrderDate, displayableOrderComment,
    //           shippingSpeedCategory, destinationAddress:{name,addressLine1,city,stateOrRegion,postalCode,countryCode},
    //           items:[{sellerSku, sellerFulfillmentOrderItemId, quantity}] }
    // (UI param orderReference -> sellerFulfillmentOrderId; displayableOrderNumber -> displayableOrderId)
    if (!orderReference) throw new Error('An Order Reference is required (your unique id for this MCF order).')
    if (!displayableOrderNumber) throw new Error('A Displayable Order Number is required (shown on the packing slip).')
    if (!displayableOrderDate) throw new Error('An Order Date is required (ISO 8601).')
    if (!displayableOrderComment) throw new Error('A Packing Slip Comment is required.')
    if (!shippingSpeedCategory) throw new Error('A Shipping Speed is required (e.g. Standard).')

    const destinationAddress = this.#mcfAddress(recipientName, addressLine1, addressLine2, city, stateOrRegion, postalCode, countryCode, phone)
    const mcfItems = this.#mcfItems(items)

    const body = this.#compactBody({
      sellerFulfillmentOrderId: orderReference,
      displayableOrderId: displayableOrderNumber,
      displayableOrderDate,
      displayableOrderComment,
      shippingSpeedCategory,
      destinationAddress,
      items: mcfItems,
      fulfillmentAction: fulfillmentAction || undefined,
      fulfillmentPolicy: fulfillmentPolicy || undefined,
      notificationEmails: this.#toArray(notificationEmails),
      marketplaceId,
    })

    await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/fba/outbound/2020-07-01/fulfillmentOrders`,
      method: 'post',
      body,
      logTag: 'createFulfillmentOrder',
    })

    return { status: 'created', sellerFulfillmentOrderId: orderReference }
  }

  /**
   * @operationName List Fulfillment Orders
   * @category Fulfillment Outbound
   * @description Lists your Multi-Channel Fulfillment orders, optionally only those updated after a date. Use this to find an MCF order id to fetch, update or cancel.
   * @route POST /list-all-fulfillment-orders
   * @paramDef {"type":"String","label":"Updated After","name":"queryStartDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only orders updated at or after this time."}
   * @paramDef {"type":"String","label":"Page Token","name":"nextToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Token from a prior response for the next page."}
   * @returns {Object}
   * @sampleResult {"payload":{"fulfillmentOrders":[{"sellerFulfillmentOrderId":"MCF-1001","displayableOrderId":"1001","fulfillmentOrderStatus":"Complete","statusUpdatedDate":"2024-01-02T00:00:00Z"}],"nextToken":"abc"}}
   */
  async listAllFulfillmentOrders(queryStartDate, nextToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listallfulfillmentorders
    return await this.#apiRequest({
      url: `${ this.#hostFor() }/fba/outbound/2020-07-01/fulfillmentOrders`,
      query: { queryStartDate, nextToken },
      logTag: 'listAllFulfillmentOrders',
    })
  }

  /**
   * @operationName Get Fulfillment Order
   * @category Fulfillment Outbound
   * @description Returns full details of one Multi-Channel Fulfillment order - its items, shipments (with Amazon shipment ids and package numbers) and any returns. Use it to track an MCF order or feed a return/tracking lookup.
   * @route POST /get-fulfillment-order
   * @paramDef {"type":"String","label":"Order ID","name":"sellerFulfillmentOrderId","dictionary":"getFulfillmentOrdersDictionary","required":true,"description":"The MCF order to fetch."}
   * @returns {Object}
   * @sampleResult {"payload":{"fulfillmentOrder":{"sellerFulfillmentOrderId":"MCF-1001","fulfillmentOrderStatus":"Complete"},"fulfillmentOrderItems":[{"sellerSku":"SKU-123","quantity":1}],"fulfillmentShipments":[{"amazonShipmentId":"Dt3MfdfY3","fulfillmentShipmentStatus":"SHIPPED"}]}}
   */
  async getFulfillmentOrder(sellerFulfillmentOrderId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getfulfillmentorder
    if (!sellerFulfillmentOrderId) throw new Error('An Order ID is required — use List Fulfillment Orders to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/fba/outbound/2020-07-01/fulfillmentOrders/${ encodeURIComponent(sellerFulfillmentOrderId) }`,
      logTag: 'getFulfillmentOrder',
    })
  }

  /**
   * @operationName Update Fulfillment Order
   * @category Fulfillment Outbound
   * @description Updates an existing Multi-Channel Fulfillment order that has not yet shipped - change its shipping speed, ship/hold action or packing-slip comment. Use this to amend an MCF order before it ships.
   * @route POST /update-fulfillment-order
   * @paramDef {"type":"String","label":"Order ID","name":"sellerFulfillmentOrderId","dictionary":"getFulfillmentOrdersDictionary","required":true,"description":"The MCF order to update."}
   * @paramDef {"type":"String","label":"Shipping Speed","name":"shippingSpeedCategory","uiComponent":{"type":"DROPDOWN","options":{"values":["Standard","Expedited","Priority","Scheduled Delivery"]}},"description":"Change the shipping speed (optional)."}
   * @paramDef {"type":"String","label":"Fulfillment Action","name":"fulfillmentAction","uiComponent":{"type":"DROPDOWN","options":{"values":["Ship Now","Hold"]}},"description":"Switch between Ship and Hold (optional)."}
   * @paramDef {"type":"String","label":"Packing Slip Comment","name":"displayableOrderComment","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Replace the packing-slip comment (optional, max 750 chars)."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","description":"The marketplace of the order."}
   * @returns {Object}
   * @sampleResult {"status":"updated","sellerFulfillmentOrderId":"MCF-1001"}
   */
  async updateFulfillmentOrder(sellerFulfillmentOrderId, shippingSpeedCategory, fulfillmentAction, displayableOrderComment, marketplaceId) {
    shippingSpeedCategory = this.#resolveChoice(shippingSpeedCategory, MCF_SHIPPING_SPEED_MAP)
    fulfillmentAction = this.#resolveChoice(fulfillmentAction, FULFILLMENT_ACTION_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/updatefulfillmentorder
    // Request: PUT /fba/outbound/2020-07-01/fulfillmentOrders/{sellerFulfillmentOrderId}
    //   body: { shippingSpeedCategory? } (any subset of the documented order fields)
    if (!sellerFulfillmentOrderId) throw new Error('An Order ID is required — use List Fulfillment Orders to pick one.')

    const body = this.#compactBody({
      shippingSpeedCategory,
      fulfillmentAction,
      displayableOrderComment,
      marketplaceId,
    })

    await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/fba/outbound/2020-07-01/fulfillmentOrders/${ encodeURIComponent(sellerFulfillmentOrderId) }`,
      method: 'put',
      body,
      logTag: 'updateFulfillmentOrder',
    })

    return { status: 'updated', sellerFulfillmentOrderId }
  }

  /**
   * @operationName Cancel Fulfillment Order
   * @category Fulfillment Outbound
   * @description Cancels a Multi-Channel Fulfillment order that has not yet entered the shipping process. Use this to stop an MCF order before it ships.
   * @route POST /cancel-fulfillment-order
   * @paramDef {"type":"String","label":"Order ID","name":"sellerFulfillmentOrderId","dictionary":"getFulfillmentOrdersDictionary","required":true,"description":"The MCF order to cancel."}
   * @returns {Object}
   * @sampleResult {"status":"cancelled","sellerFulfillmentOrderId":"MCF-1001"}
   */
  async cancelFulfillmentOrder(sellerFulfillmentOrderId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/cancelfulfillmentorder
    // Body-less PUT - the path and verb are the whole request:
    //   PUT /fba/outbound/2020-07-01/fulfillmentOrders/{sellerFulfillmentOrderId}/cancel  (no request body)
    if (!sellerFulfillmentOrderId) throw new Error('An Order ID is required — use List Fulfillment Orders to pick one.')

    await this.#apiRequest({
      url: `${ this.#hostFor() }/fba/outbound/2020-07-01/fulfillmentOrders/${ encodeURIComponent(sellerFulfillmentOrderId) }/cancel`,
      method: 'put',
      logTag: 'cancelFulfillmentOrder',
    })

    return { status: 'cancelled', sellerFulfillmentOrderId }
  }

  /**
   * @operationName Create Fulfillment Return
   * @category Fulfillment Outbound
   * @description Authorizes a customer return for items from a Multi-Channel Fulfillment order, returning RMA details and a returns label page. Use this after Get Fulfillment Order to start a return.
   * @route POST /create-fulfillment-return
   * @paramDef {"type":"String","label":"Order ID","name":"sellerFulfillmentOrderId","dictionary":"getFulfillmentOrdersDictionary","required":true,"description":"The original MCF order the returned items belong to."}
   * @paramDef {"type":"Array<MCFReturnItem>","label":"Return Items","name":"items","required":true,"description":"The items to authorize a return for. Each is {sellerSku, sellerFulfillmentOrderItemId, amazonShipmentId, returnReasonCode, returnComment?}."}
   * @returns {Object}
   * @sampleResult {"payload":{"returnItems":[{"sellerReturnItemId":"item-1","sellerFulfillmentOrderItemId":"item-1","amazonShipmentId":"Dt3MfdfY3","sellerReturnReasonCode":"MissingParts","status":"Processed"}],"invalidReturnItems":[],"returnAuthorizations":[{"returnAuthorizationId":"ra-1","fulfillmentCenterId":"PHX7","amazonRmaId":"rma-1","rmaPageURL":"https://example.com/rma"}]}}
   */
  async createFulfillmentReturn(sellerFulfillmentOrderId, items) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/createfulfillmentreturn
    // Request: PUT /fba/outbound/2020-07-01/fulfillmentOrders/{sellerFulfillmentOrderId}/return
    //   body: { items:[{sellerSku, sellerFulfillmentOrderItemId, amazonShipmentId, returnReasonCode, returnComment?}] }
    if (!sellerFulfillmentOrderId) throw new Error('An Order ID is required — use List Fulfillment Orders to pick one.')

    const list = Array.isArray(items) ? items : []

    if (!list.length) {
      throw new Error('At least one Return Item is required.')
    }

    const returnItems = list.map(item => {
      if (!item || !item.sellerSku) throw new Error('Each Return Item needs a Seller SKU.')
      if (!item.sellerFulfillmentOrderItemId) throw new Error('Each Return Item needs the original Order Item id.')
      if (!item.amazonShipmentId) throw new Error('Each Return Item needs the Amazon shipment id (from Get Fulfillment Order).')
      if (!item.returnReasonCode) throw new Error('Each Return Item needs a return reason code (from List Return Reason Codes).')

      return this.#compactBody({
        sellerSku: item.sellerSku,
        sellerFulfillmentOrderItemId: item.sellerFulfillmentOrderItemId,
        amazonShipmentId: item.amazonShipmentId,
        returnReasonCode: item.returnReasonCode,
        returnComment: item.returnComment,
      })
    })

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/fba/outbound/2020-07-01/fulfillmentOrders/${ encodeURIComponent(sellerFulfillmentOrderId) }/return`,
      method: 'put',
      body: { items: returnItems },
      logTag: 'createFulfillmentReturn',
    })
  }

  /**
   * @operationName Get Package Tracking Details
   * @category Fulfillment Outbound
   * @description Returns carrier tracking status and events for a fulfillment shipment package, identified by its package number. Use this to track an MCF shipment to the customer.
   * @route POST /get-package-tracking-details
   * @paramDef {"type":"Number","label":"Package Number","name":"packageNumber","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"The package number from a fulfillment shipment (see Get Fulfillment Order)."}
   * @returns {Object}
   * @sampleResult {"payload":{"packageNumber":2222222222,"currentStatus":"DELIVERED","carrierCode":"UPS","estimatedArrivalDate":"2024-01-05T00:00:00Z","trackingEvents":[{"eventDate":"2024-01-05T10:00:00Z","eventCode":"EVENT_301","eventDescription":"Delivered"}]}}
   */
  async getPackageTrackingDetails(packageNumber) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getpackagetrackingdetails
    if (packageNumber === null || packageNumber === undefined || packageNumber === '') {
      throw new Error('A Package Number is required (from a fulfillment shipment).')
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/fba/outbound/2020-07-01/tracking`,
      query: { packageNumber },
      logTag: 'getPackageTrackingDetails',
    })
  }

  /**
   * @operationName List Return Reason Codes
   * @category Fulfillment Outbound
   * @description Lists the valid return reason codes for a SKU (used when authorizing a Multi-Channel Fulfillment return). Use this to find the right returnReasonCode for Create Fulfillment Return.
   * @route POST /list-return-reason-codes
   * @paramDef {"type":"String","label":"Seller SKU","name":"sellerSku","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The SKU to fetch valid return reasons for."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","description":"The marketplace whose return reasons to list."}
   * @paramDef {"type":"String","label":"Language","name":"language","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Locale for reason descriptions, e.g. en_US."}
   * @returns {Object}
   * @sampleResult {"payload":{"reasonCodeDetails":[{"returnReasonCode":"MissingParts","description":"Parts missing","translatedDescription":"Parts missing"}]}}
   */
  async listReturnReasonCodes(sellerSku, marketplaceId, language) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listreturnreasoncodes
    if (!sellerSku) throw new Error('A Seller SKU is required.')

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/fba/outbound/2020-07-01/returnReasonCodes`,
      query: { sellerSku, marketplaceId, language },
      logTag: 'listReturnReasonCodes',
    })
  }

  /**
   * @operationName Get Fulfillment Features
   * @category Fulfillment Outbound
   * @description Lists the Multi-Channel Fulfillment features available in a marketplace and whether your account is eligible for each. Use this to check feature eligibility (e.g. Block Amazon Logistics).
   * @route POST /get-features
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to list features for."}
   * @returns {Object}
   * @sampleResult {"payload":{"features":[{"name":"EASYSHIP","description":"Easy Ship eligible inventory","sellerEligible":true}]}}
   */
  async getFeatures(marketplaceId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getfeatures
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/fba/outbound/2020-07-01/features`,
      query: { marketplaceId },
      logTag: 'getFeatures',
    })
  }

  /**
   * @operationName Get Feature Inventory
   * @category Fulfillment Outbound
   * @description Lists the SKUs in your inventory that are eligible for a given Multi-Channel Fulfillment feature in a marketplace. Use this to see which items qualify for a feature.
   * @route POST /get-feature-inventory
   * @paramDef {"type":"String","label":"Feature Name","name":"featureName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The feature, e.g. EASYSHIP (see Get Fulfillment Features)."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to list eligible inventory in."}
   * @paramDef {"type":"String","label":"Page Token","name":"nextToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Token from a prior response for the next page."}
   * @returns {Object}
   * @sampleResult {"payload":{"marketplaceId":"ATVPDKIKX0DER","featureName":"EASYSHIP","featureSkus":[{"sellerSku":"SKU-123","fnSku":"X001","asin":"B00CZX5JE2","skuCount":10}],"nextToken":"abc"}}
   */
  async getFeatureInventory(featureName, marketplaceId, nextToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getfeatureinventory
    if (!featureName) throw new Error('A Feature Name is required (e.g. EASYSHIP).')
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/fba/outbound/2020-07-01/features/inventory/${ encodeURIComponent(featureName) }`,
      query: { marketplaceId, nextToken },
      logTag: 'getFeatureInventory',
    })
  }

  /**
   * @operationName Get Feature SKU Eligibility
   * @category Fulfillment Outbound
   * @description Checks whether one SKU is eligible for a given Multi-Channel Fulfillment feature in a marketplace, with the reasons if not. Use this to confirm a single SKU qualifies for a feature.
   * @route POST /get-feature-sku
   * @paramDef {"type":"String","label":"Feature Name","name":"featureName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The feature, e.g. EASYSHIP (see Get Fulfillment Features)."}
   * @paramDef {"type":"String","label":"Seller SKU","name":"sellerSku","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The SKU to check eligibility for."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to check eligibility in."}
   * @returns {Object}
   * @sampleResult {"payload":{"marketplaceId":"ATVPDKIKX0DER","featureName":"EASYSHIP","isEligible":true,"skuInfo":{"sellerSku":"SKU-123","fnSku":"X001","asin":"B00CZX5JE2","skuCount":10}}}
   */
  async getFeatureSKU(featureName, sellerSku, marketplaceId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getfeaturesku
    if (!featureName) throw new Error('A Feature Name is required (e.g. EASYSHIP).')
    if (!sellerSku) throw new Error('A Seller SKU is required.')
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/fba/outbound/2020-07-01/features/inventory/${ encodeURIComponent(featureName) }/${ encodeURIComponent(sellerSku) }`,
      query: { marketplaceId },
      logTag: 'getFeatureSKU',
    })
  }

  // Assembles the documented MCF destination Address object from the flat first-class params.
  #mcfAddress(recipientName, addressLine1, addressLine2, city, stateOrRegion, postalCode, countryCode, phone) {
    if (!recipientName) throw new Error('A Recipient Name is required.')
    if (!addressLine1) throw new Error('An Address Line 1 is required.')
    if (!city) throw new Error('A City is required.')
    if (!stateOrRegion) throw new Error('A State / Region is required.')
    if (!postalCode) throw new Error('A Postal Code is required.')
    if (!countryCode) throw new Error('A Country Code is required (two-letter ISO, e.g. US).')

    return this.#compactBody({
      name: recipientName,
      addressLine1,
      addressLine2,
      city,
      stateOrRegion,
      postalCode,
      countryCode,
      phone,
    })
  }

  // Normalizes the MCF items array to the documented wire shape (sellerSku/sellerFulfillmentOrderItemId/quantity + optional).
  #mcfItems(items) {
    const list = Array.isArray(items) ? items : []

    if (!list.length) {
      throw new Error('At least one Item is required (each is a SKU + quantity to ship).')
    }

    return list.map(item => {
      if (!item || !item.sellerSku) throw new Error('Each Item needs a Seller SKU.')
      if (!item.sellerFulfillmentOrderItemId) throw new Error('Each Item needs a per-line Order Item id.')

      if (item.quantity === null || item.quantity === undefined || item.quantity === '') {
        throw new Error('Each Item needs a Quantity.')
      }

      return this.#compactBody({
        sellerSku: item.sellerSku,
        sellerFulfillmentOrderItemId: item.sellerFulfillmentOrderItemId,
        quantity: Number(item.quantity),
        perUnitDeclaredValue: item.perUnitDeclaredValue,
        giftMessage: item.giftMessage,
        displayableComment: item.displayableComment,
      })
    })
  }

  // ==========================================================================
  //  ACTIONS - Fulfillment Inbound (v2024-03-20)
  // ==========================================================================
  // The inbound workflow is a funnel: create a plan -> generate + confirm a packing option ->
  // set packing information -> generate + confirm a placement option (this creates the shipments)
  // -> generate + confirm transportation options -> ship. Most write operations are ASYNCHRONOUS:
  // they return only an operationId and the real work (and its validation errors) surfaces through
  // Get Inbound Operation Status.
  /**
   * @operationName List Inbound Plans
   * @category Fulfillment Inbound
   * @description Lists the seller's FBA inbound plans with minimal information (id, name, status, source address, timestamps). Filter by status and sort by creation or last-updated time. Use this to find the inbound plan id every other inbound action needs.
   * @route POST /list-inbound-plans
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Voided","Shipped"]}},"description":"Only return inbound plans in this state. Leave empty for all."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Last Updated Time","Creation Time"]}},"description":"Which timestamp to sort the plans by."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction for the chosen sort field."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Plans per page, 1-30. Defaults to Amazon's page size."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response. Leave empty for the first page."}
   * @returns {Object}
   * @sampleResult {"inboundPlans":[{"inboundPlanId":"wf1234abcd-1234-abcd-5678-1234abcd5678","name":"Spring restock","status":"ACTIVE","marketplaceIds":["ATVPDKIKX0DER"],"createdAt":"2024-03-20T10:00:00Z","lastUpdatedAt":"2024-03-21T09:00:00Z","sourceAddress":{"city":"Seattle","countryCode":"US","postalCode":"98101"}}],"pagination":{"nextToken":null}}
   */
  async listInboundPlans(status, sortBy, sortOrder, pageSize, paginationToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listinboundplans
    status = this.#resolveChoice(status, INBOUND_PLAN_STATUS_MAP)
    sortBy = this.#resolveChoice(sortBy, INBOUND_PLAN_SORT_BY_MAP)
    sortOrder = this.#resolveChoice(sortOrder, SORT_ORDER_MAP)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans`,
      query: { status, sortBy, sortOrder, pageSize, paginationToken },
      logTag: 'listInboundPlans',
    })
  }

  /**
   * @operationName Create Inbound Plan
   * @category Fulfillment Inbound
   * @description Starts a new FBA inbound plan - the container for everything needed to send inventory into Amazon's fulfillment network. Provide the destination marketplaces, the ship-from address and the MSKUs with quantities. This is ASYNCHRONOUS: it returns an inbound plan id plus an operationId; poll Get Inbound Operation Status until it succeeds before generating packing options.
   * @route POST /create-inbound-plan
   * @paramDef {"type":"Array<String>","label":"Destination Marketplaces","name":"destinationMarketplaces","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplaces the inventory is being sent to. Pick from your connected marketplaces."}
   * @paramDef {"type":"Array<InboundItem>","label":"Items","name":"items","required":true,"description":"The units being sent in. Each is {msku, quantity, labelOwner, prepOwner} plus optional expiration and manufacturingLotCode."}
   * @paramDef {"type":"String","label":"Ship From Name","name":"sourceName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Contact name at the address the inventory ships from."}
   * @paramDef {"type":"String","label":"Ship From Address Line 1","name":"sourceAddressLine1","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Street address the inventory ships from."}
   * @paramDef {"type":"String","label":"Ship From City","name":"sourceCity","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"City the inventory ships from."}
   * @paramDef {"type":"String","label":"Ship From Postal Code","name":"sourcePostalCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"ZIP / postal code the inventory ships from."}
   * @paramDef {"type":"String","label":"Ship From Country Code","name":"sourceCountryCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"defaultValue":"US","description":"Two-letter ISO country code of the ship-from address (e.g. US, GB, DE)."}
   * @paramDef {"type":"String","label":"Ship From Phone","name":"sourcePhoneNumber","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Phone number for the ship-from contact. Amazon requires it on the source address."}
   * @paramDef {"type":"String","label":"Ship From Address Line 2","name":"sourceAddressLine2","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Suite, floor, unit, etc. (optional)."}
   * @paramDef {"type":"String","label":"Ship From State / Province","name":"sourceStateOrProvinceCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"State or province code of the ship-from address."}
   * @paramDef {"type":"String","label":"Ship From Company","name":"sourceCompanyName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Business name at the ship-from address (optional)."}
   * @paramDef {"type":"String","label":"Ship From District / County","name":"sourceDistrictOrCounty","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"District or county of the ship-from address (optional)."}
   * @paramDef {"type":"String","label":"Ship From Email","name":"sourceEmail","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email for the ship-from contact (optional)."}
   * @paramDef {"type":"String","label":"Plan Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A name for the plan shown in Seller Central. Amazon generates one when omitted."}
   * @returns {Object}
   * @sampleResult {"inboundPlanId":"wf1234abcd-1234-abcd-5678-1234abcd5678","operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async createInboundPlan(destinationMarketplaces, items, sourceName, sourceAddressLine1, sourceCity, sourcePostalCode, sourceCountryCode, sourcePhoneNumber, sourceAddressLine2, sourceStateOrProvinceCode, sourceCompanyName, sourceDistrictOrCounty, sourceEmail, name) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/createinboundplan
    const markets = this.#toArray(destinationMarketplaces)

    if (!markets.length) {
      throw new Error('At least one Destination Marketplace is required — use Get Marketplace Participations to pick one.')
    }

    const body = this.#compactBody({
      destinationMarketplaces: markets,
      items: this.#inboundItems(items),
      sourceAddress: this.#inboundAddress({
        name: sourceName,
        addressLine1: sourceAddressLine1,
        addressLine2: sourceAddressLine2,
        city: sourceCity,
        stateOrProvinceCode: sourceStateOrProvinceCode,
        postalCode: sourcePostalCode,
        countryCode: sourceCountryCode,
        phoneNumber: sourcePhoneNumber,
        companyName: sourceCompanyName,
        districtOrCounty: sourceDistrictOrCounty,
        email: sourceEmail,
      }),
      name,
    })

    return await this.#apiRequest({
      url: `${ this.#hostFor(markets[0]) }/inbound/fba/2024-03-20/inboundPlans`,
      method: 'post',
      body,
      logTag: 'createInboundPlan',
    })
  }

  /**
   * @operationName Get Inbound Plan
   * @category Fulfillment Inbound
   * @description Retrieves the top-level state of an inbound plan - name, status, source address, and the ids of its packing options, placement options and shipments. Use this to discover the shipment ids created once a placement option is confirmed.
   * @route POST /get-inbound-plan
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan to read. Pick from List Inbound Plans."}
   * @returns {Object}
   * @sampleResult {"inboundPlanId":"wf1234abcd-1234-abcd-5678-1234abcd5678","name":"Spring restock","status":"ACTIVE","marketplaceIds":["ATVPDKIKX0DER"],"createdAt":"2024-03-20T10:00:00Z","lastUpdatedAt":"2024-03-21T09:00:00Z","packingOptions":[{"packingOptionId":"po1234abcd-1234-abcd-5678-1234abcd5678","status":"ACCEPTED"}],"placementOptions":[{"placementOptionId":"pl1234abcd-1234-abcd-5678-1234abcd5678","status":"OFFERED"}],"shipments":[{"shipmentId":"sh1234abcd-1234-abcd-5678-1234abcd5678","status":"WORKING"}]}
   */
  async getInboundPlan(inboundPlanId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getinboundplan
    this.#requireInboundPlanId(inboundPlanId)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }`,
      logTag: 'getInboundPlan',
    })
  }

  /**
   * @operationName Update Inbound Plan Name
   * @category Fulfillment Inbound
   * @description Renames an existing inbound plan. This only changes the label shown in Seller Central and has no effect on the plan's contents, packing or shipments.
   * @route POST /update-inbound-plan-name
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan to rename. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The new name for the inbound plan."}
   * @returns {Object}
   * @sampleResult {"success":true,"inboundPlanId":"wf1234abcd-1234-abcd-5678-1234abcd5678","name":"Spring restock"}
   */
  async updateInboundPlanName(inboundPlanId, name) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/updateinboundplanname
    this.#requireInboundPlanId(inboundPlanId)

    if (!name) throw new Error('A Name is required.')

    await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/name`,
      method: 'put',
      body: { name },
      logTag: 'updateInboundPlanName',
    })

    // The endpoint returns 204 No Content on success - return a clear success shape.
    return { success: true, inboundPlanId, name }
  }

  /**
   * @operationName Cancel Inbound Plan
   * @category Fulfillment Inbound
   * @description Voids an inbound plan so its shipments are no longer expected by Amazon. Cancelling outside the void window may incur charges - that window is 24 hours for Amazon-partnered Small Parcel Delivery and one hour for Less-Than-Truckload shipments. This is ASYNCHRONOUS: poll Get Inbound Operation Status with the returned operationId to confirm the cancellation.
   * @route POST /cancel-inbound-plan
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan to cancel. Pick from List Inbound Plans."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async cancelInboundPlan(inboundPlanId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/cancelinboundplan
    this.#requireInboundPlanId(inboundPlanId)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/cancellation`,
      method: 'put',
      logTag: 'cancelInboundPlan',
    })
  }

  /**
   * @operationName List Inbound Plan Items
   * @category Fulfillment Inbound
   * @description Lists every item package in an inbound plan with its ASIN, FNSKU, MSKU, quantity, label/prep owners and the prep instructions Amazon requires. Use this to review what the plan will send in and which prep Amazon expects.
   * @route POST /list-inbound-plan-items
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan whose items to list. Pick from List Inbound Plans."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page, 1-1000. Defaults to Amazon's page size."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response. Leave empty for the first page."}
   * @returns {Object}
   * @sampleResult {"items":[{"asin":"B00CZX5JE2","fnsku":"X001ABC","msku":"SKU-123","quantity":10,"labelOwner":"AMAZON","prepOwner":"SELLER","prepInstructions":[{"prepType":"ITEM_LABELING","prepOwner":"AMAZON","fee":{"amount":0.55,"code":"USD"}}]}],"pagination":{"nextToken":null}}
   */
  async listInboundPlanItems(inboundPlanId, pageSize, paginationToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listinboundplanitems
    this.#requireInboundPlanId(inboundPlanId)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/items`,
      query: { pageSize, paginationToken },
      logTag: 'listInboundPlanItems',
    })
  }

  /**
   * @operationName List Inbound Plan Boxes
   * @category Fulfillment Inbound
   * @description Lists every box package in an inbound plan with its dimensions, weight, contents and box id. Boxes appear only after packing information has been set. Use this to verify what Amazon recorded for the plan's boxes.
   * @route POST /list-inbound-plan-boxes
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan whose boxes to list. Pick from List Inbound Plans."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Boxes per page, 1-1000. Defaults to Amazon's page size."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response. Leave empty for the first page."}
   * @returns {Object}
   * @sampleResult {"boxes":[{"packageId":"pk1234abcd-1234-abcd-5678-1234abcd5678","boxId":"FBA10ABC0YY100001","contentInformationSource":"BOX_CONTENT_PROVIDED","quantity":2,"dimensions":{"length":3,"width":4,"height":5,"unitOfMeasurement":"CM"},"weight":{"unit":"KG","value":5.5},"items":[{"msku":"SKU-123","quantity":10}]}],"pagination":{"nextToken":null}}
   */
  async listInboundPlanBoxes(inboundPlanId, pageSize, paginationToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listinboundplanboxes
    this.#requireInboundPlanId(inboundPlanId)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/boxes`,
      query: { pageSize, paginationToken },
      logTag: 'listInboundPlanBoxes',
    })
  }

  /**
   * @operationName List Inbound Plan Pallets
   * @category Fulfillment Inbound
   * @description Lists the pallet packages in an inbound plan with dimensions, weight and stackability. A plan only has pallets once Less-Than-Truckload (LTL) transportation options have been generated with pallet details.
   * @route POST /list-inbound-plan-pallets
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan whose pallets to list. Pick from List Inbound Plans."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pallets per page, 1-1000. Defaults to Amazon's page size."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response. Leave empty for the first page."}
   * @returns {Object}
   * @sampleResult {"pallets":[{"packageId":"pk1234abcd-1234-abcd-5678-1234abcd5678","quantity":2,"stackability":"STACKABLE","dimensions":{"length":120,"width":100,"height":150,"unitOfMeasurement":"CM"},"weight":{"unit":"KG","value":250}}],"pagination":{"nextToken":null}}
   */
  async listInboundPlanPallets(inboundPlanId, pageSize, paginationToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listinboundplanpallets
    this.#requireInboundPlanId(inboundPlanId)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/pallets`,
      query: { pageSize, paginationToken },
      logTag: 'listInboundPlanPallets',
    })
  }

  /**
   * @operationName Generate Packing Options
   * @category Fulfillment Inbound
   * @description Asks Amazon to compute the ways the plan's units may be grouped into packing groups, with any fees or discounts per option. Run this first on a new plan; the options themselves are then read with List Packing Options. This is ASYNCHRONOUS: poll Get Inbound Operation Status with the returned operationId before listing the options.
   * @route POST /generate-packing-options
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan to generate packing options for. Pick from List Inbound Plans."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async generatePackingOptions(inboundPlanId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/generatepackingoptions
    this.#requireInboundPlanId(inboundPlanId)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/packingOptions`,
      method: 'post',
      logTag: 'generatePackingOptions',
    })
  }

  /**
   * @operationName List Packing Options
   * @category Fulfillment Inbound
   * @description Lists the packing options generated for an inbound plan, each with its packing groups, fees, discounts, expiration and status. Generate Packing Options must have completed first. Use this to compare options before confirming one.
   * @route POST /list-packing-options
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan whose packing options to list. Pick from List Inbound Plans."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Options per page, 1-20. Defaults to Amazon's page size."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response. Leave empty for the first page."}
   * @returns {Object}
   * @sampleResult {"packingOptions":[{"packingOptionId":"po1234abcd-1234-abcd-5678-1234abcd5678","status":"OFFERED","expiration":"2024-03-27T10:00:00.000Z","packingGroups":["pg1234abcd-1234-abcd-5678-1234abcd5678"],"fees":[],"discounts":[]}],"pagination":{"nextToken":null}}
   */
  async listPackingOptions(inboundPlanId, pageSize, paginationToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listpackingoptions
    this.#requireInboundPlanId(inboundPlanId)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/packingOptions`,
      query: { pageSize, paginationToken },
      logTag: 'listPackingOptions',
    })
  }

  /**
   * @operationName Confirm Packing Option
   * @category Fulfillment Inbound
   * @description Accepts one of the offered packing options, fixing how the plan's units are grouped for packing. Do this before setting packing information or generating placement options. This is ASYNCHRONOUS: poll Get Inbound Operation Status with the returned operationId to confirm it took effect.
   * @route POST /confirm-packing-option
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the packing option belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Packing Option","name":"packingOptionId","dictionary":"getPackingOptionsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The packing option to accept. Pick from List Packing Options."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async confirmPackingOption(inboundPlanId, packingOptionId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/confirmpackingoption
    this.#requireInboundPlanId(inboundPlanId)

    if (!packingOptionId) {
      throw new Error('A Packing Option is required — use List Packing Options to pick one.')
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/packingOptions/${ encodeURIComponent(packingOptionId) }/confirmation`,
      method: 'post',
      logTag: 'confirmPackingOption',
    })
  }

  /**
   * @operationName List Packing Group Items
   * @category Fulfillment Inbound
   * @description Lists the items Amazon assigned to a packing group, with ASIN, FNSKU, MSKU, quantity and prep instructions. Packing options must have been generated first. Use this to know exactly what goes into the boxes of one group.
   * @route POST /list-packing-group-items
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the packing group belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Packing Group","name":"packingGroupId","dictionary":"getPackingGroupsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The packing group whose items to list. Pick from the packing groups of a packing option."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page, 1-1000. Defaults to Amazon's page size."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response. Leave empty for the first page."}
   * @returns {Object}
   * @sampleResult {"items":[{"asin":"B00CZX5JE2","fnsku":"X001ABC","msku":"SKU-123","quantity":10,"labelOwner":"AMAZON","prepOwner":"SELLER","prepInstructions":[]}],"pagination":{"nextToken":null}}
   */
  async listPackingGroupItems(inboundPlanId, packingGroupId, pageSize, paginationToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listpackinggroupitems
    this.#requireInboundPlanId(inboundPlanId)

    if (!packingGroupId) {
      throw new Error('A Packing Group is required — use List Packing Options to pick one of its packing groups.')
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/packingGroups/${ encodeURIComponent(packingGroupId) }/items`,
      query: { pageSize, paginationToken },
      logTag: 'listPackingGroupItems',
    })
  }

  /**
   * @operationName List Packing Group Boxes
   * @category Fulfillment Inbound
   * @description Lists the boxes previously supplied for a packing group through Set Packing Information. This supports the workflow where boxes are packed before Amazon decides how the plan is split into shipments.
   * @route POST /list-packing-group-boxes
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the packing group belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Packing Group","name":"packingGroupId","dictionary":"getPackingGroupsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The packing group whose boxes to list. Pick from the packing groups of a packing option."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Boxes per page, 1-1000. Defaults to Amazon's page size."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response. Leave empty for the first page."}
   * @returns {Object}
   * @sampleResult {"boxes":[{"packageId":"pk1234abcd-1234-abcd-5678-1234abcd5678","contentInformationSource":"BOX_CONTENT_PROVIDED","quantity":2,"dimensions":{"length":3,"width":4,"height":5,"unitOfMeasurement":"CM"},"weight":{"unit":"KG","value":5.5},"items":[{"msku":"SKU-123","quantity":10}]}],"pagination":{"nextToken":null}}
   */
  async listPackingGroupBoxes(inboundPlanId, packingGroupId, pageSize, paginationToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listpackinggroupboxes
    this.#requireInboundPlanId(inboundPlanId)

    if (!packingGroupId) {
      throw new Error('A Packing Group is required — use List Packing Options to pick one of its packing groups.')
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/packingGroups/${ encodeURIComponent(packingGroupId) }/boxes`,
      query: { pageSize, paginationToken },
      logTag: 'listPackingGroupBoxes',
    })
  }

  /**
   * @operationName Set Packing Information
   * @category Fulfillment Inbound
   * @description Supplies the box-level detail Amazon needs for placement and transportation estimates - each box's dimensions, weight, how its contents are declared, and the units inside. Group boxes by packing group before the placement option is confirmed, or by shipment afterwards. This is ASYNCHRONOUS: poll Get Inbound Operation Status with the returned operationId; box validation errors surface there.
   * @route POST /set-packing-information
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan to set packing information on. Pick from List Inbound Plans."}
   * @paramDef {"type":"Array<InboundPackageGrouping>","label":"Package Groupings","name":"packageGroupings","required":true,"description":"The boxes, grouped by packingGroupId (before placement is confirmed) or by shipmentId (after). Each grouping is {boxes, packingGroupId} or {boxes, shipmentId}."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async setPackingInformation(inboundPlanId, packageGroupings) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/setpackinginformation
    this.#requireInboundPlanId(inboundPlanId)

    const groupings = Array.isArray(packageGroupings) ? packageGroupings : []

    if (!groupings.length) {
      throw new Error('At least one Package Grouping is required (boxes plus the packing group or shipment they belong to).')
    }

    const body = {
      packageGroupings: groupings.map(grouping => {
        // Amazon accepts exactly one grouping key: packingGroupId pre-placement, shipmentId post.
        if (!grouping || (!grouping.packingGroupId && !grouping.shipmentId)) {
          throw new Error('Each Package Grouping needs a Packing Group id (before the placement option is confirmed) or a Shipment id (after it is).')
        }

        return this.#compactBody({
          boxes: this.#inboundBoxes(grouping.boxes),
          packingGroupId: grouping.packingGroupId,
          shipmentId: grouping.shipmentId,
        })
      }),
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/packingInformation`,
      method: 'post',
      body,
      logTag: 'setPackingInformation',
    })
  }

  /**
   * @operationName Generate Placement Options
   * @category Fulfillment Inbound
   * @description Asks Amazon to compute how the plan should be split across fulfillment centers, with the placement fees or discounts of each option. Optionally force units to specific warehouses with a custom placement. This is ASYNCHRONOUS: poll Get Inbound Operation Status with the returned operationId before listing the options.
   * @route POST /generate-placement-options
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan to generate placement options for. Pick from List Inbound Plans."}
   * @paramDef {"type":"Array<InboundCustomPlacement>","label":"Custom Placement","name":"customPlacement","description":"Optional. Force units to specific fulfillment centers - each entry is {warehouseId, items}. Leave empty to let Amazon choose the placement."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async generatePlacementOptions(inboundPlanId, customPlacement) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/generateplacementoptions
    this.#requireInboundPlanId(inboundPlanId)

    const placements = Array.isArray(customPlacement) ? customPlacement : []

    const body = this.#compactBody({
      customPlacement: placements.length
        ? placements.map(placement => {
          if (!placement || !placement.warehouseId) {
            throw new Error('Each Custom Placement needs a Warehouse id (e.g. YYZ14).')
          }

          return { warehouseId: placement.warehouseId, items: this.#inboundItems(placement.items) }
        })
        : undefined,
    })

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/placementOptions`,
      method: 'post',
      body,
      logTag: 'generatePlacementOptions',
    })
  }

  /**
   * @operationName List Placement Options
   * @category Fulfillment Inbound
   * @description Lists the placement options generated for an inbound plan, each with its shipment ids, placement fees, discounts, expiration and status. Use this to compare the cost of each split before confirming one.
   * @route POST /list-placement-options
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan whose placement options to list. Pick from List Inbound Plans."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Options per page, 1-20. Defaults to Amazon's page size."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response. Leave empty for the first page."}
   * @returns {Object}
   * @sampleResult {"placementOptions":[{"placementOptionId":"pl1234abcd-1234-abcd-5678-1234abcd5678","status":"OFFERED","expiration":"2024-03-27T10:00:00.000Z","shipmentIds":["sh1234abcd-1234-abcd-5678-1234abcd5678"],"fees":[{"type":"PLACEMENT_SERVICES","value":{"amount":12.5,"code":"USD"}}],"discounts":[]}],"pagination":{"nextToken":null}}
   */
  async listPlacementOptions(inboundPlanId, pageSize, paginationToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listplacementoptions
    this.#requireInboundPlanId(inboundPlanId)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/placementOptions`,
      query: { pageSize, paginationToken },
      logTag: 'listPlacementOptions',
    })
  }

  /**
   * @operationName Confirm Placement Option
   * @category Fulfillment Inbound
   * @description Accepts a placement option, which creates the plan's shipments and their destination fulfillment centers. This is permanent - a plan's placement cannot be changed once confirmed. This is ASYNCHRONOUS: poll Get Inbound Operation Status with the returned operationId, then read the new shipment ids with Get Inbound Plan.
   * @route POST /confirm-placement-option
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the placement option belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Placement Option","name":"placementOptionId","dictionary":"getPlacementOptionsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The placement option to accept. Pick from List Placement Options. This cannot be changed later."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async confirmPlacementOption(inboundPlanId, placementOptionId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/confirmplacementoption
    this.#requireInboundPlanId(inboundPlanId)

    if (!placementOptionId) {
      throw new Error('A Placement Option is required — use List Placement Options to pick one.')
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/placementOptions/${ encodeURIComponent(placementOptionId) }/confirmation`,
      method: 'post',
      logTag: 'confirmPlacementOption',
    })
  }

  /**
   * @operationName Generate Transportation Options
   * @category Fulfillment Inbound
   * @description Asks Amazon to quote carriers for the shipments of a confirmed placement option. Supply, per shipment, the ready-to-ship window (your pick-up date) and optionally contact, freight and pallet details - freight (LTL) quotes are only returned when freight information is provided. This is ASYNCHRONOUS: poll Get Inbound Operation Status with the returned operationId before listing the options.
   * @route POST /generate-transportation-options
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan to quote transportation for. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Placement Option","name":"placementOptionId","dictionary":"getPlacementOptionsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The confirmed placement option whose shipments to quote. Pick from List Placement Options."}
   * @paramDef {"type":"Array<InboundTransportationConfig>","label":"Shipment Configurations","name":"shipmentTransportationConfigurations","required":true,"description":"One entry per shipment: {shipmentId, readyToShipWindowStart} plus optional contact, freight class / declared value, and pallets."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async generateTransportationOptions(inboundPlanId, placementOptionId, shipmentTransportationConfigurations) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/generatetransportationoptions
    this.#requireInboundPlanId(inboundPlanId)

    if (!placementOptionId) {
      throw new Error('A Placement Option is required — use List Placement Options to pick the confirmed one.')
    }

    const configs = Array.isArray(shipmentTransportationConfigurations) ? shipmentTransportationConfigurations : []

    if (!configs.length) {
      throw new Error('At least one Shipment Configuration is required — use Get Inbound Plan to list the shipment ids created by the placement option.')
    }

    const body = {
      placementOptionId,
      shipmentTransportationConfigurations: configs.map(config => {
        if (!config || !config.shipmentId) {
          throw new Error('Each Shipment Configuration needs a Shipment id — use Get Inbound Plan to list them.')
        }

        if (!config.readyToShipWindowStart) {
          throw new Error('Each Shipment Configuration needs a Ready To Ship Window Start (ISO 8601, e.g. 2024-04-01T10:00Z) — this is the pick-up date, not a delivery date.')
        }

        return this.#compactBody({
          shipmentId: config.shipmentId,
          readyToShipWindow: { start: config.readyToShipWindowStart },
          contactInformation: this.#inboundContact(config),
          freightInformation: this.#inboundFreight(config),
          pallets: Array.isArray(config.pallets) && config.pallets.length ? this.#inboundPallets(config.pallets) : undefined,
        })
      }),
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/transportationOptions`,
      method: 'post',
      body,
      logTag: 'generateTransportationOptions',
    })
  }

  /**
   * @operationName List Transportation Options
   * @category Fulfillment Inbound
   * @description Lists the carrier options quoted for an inbound plan - carrier, shipping mode and solution, quote, carrier appointment and any preconditions (for example a delivery window that must be confirmed first). Filter to one placement option or one shipment. Transportation options must be generated first.
   * @route POST /list-transportation-options
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan whose transportation options to list. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Placement Option","name":"placementOptionId","dictionary":"getPlacementOptionsDictionary","dependsOn":["inboundPlanId"],"description":"Only return options for this placement option. Provide either a Placement Option or a Shipment."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"description":"Only return options for this shipment. Provide either a Placement Option or a Shipment."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Options per page, 1-20. Defaults to Amazon's page size."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response. Leave empty for the first page."}
   * @returns {Object}
   * @sampleResult {"transportationOptions":[{"transportationOptionId":"to1234abcd-1234-abcd-5678-1234abcd5678","shipmentId":"sh1234abcd-1234-abcd-5678-1234abcd5678","shippingMode":"GROUND_SMALL_PARCEL","shippingSolution":"AMAZON_PARTNERED_CARRIER","carrier":{"name":"UPS","alphaCode":"UPSN"},"quote":{"cost":{"amount":42.5,"code":"USD"},"expiration":"2024-03-27T10:00:00.000Z"},"preconditions":[]}],"pagination":{"nextToken":null}}
   */
  async listTransportationOptions(inboundPlanId, placementOptionId, shipmentId, pageSize, paginationToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listtransportationoptions
    this.#requireInboundPlanId(inboundPlanId)

    // Amazon requires the result set to be scoped: one of placementOptionId / shipmentId.
    if (!placementOptionId && !shipmentId) {
      throw new Error('Provide either a Placement Option or a Shipment — Amazon needs one of them to scope the transportation options.')
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/transportationOptions`,
      query: { placementOptionId, shipmentId, pageSize, paginationToken },
      logTag: 'listTransportationOptions',
    })
  }

  /**
   * @operationName Confirm Transportation Options
   * @category Fulfillment Inbound
   * @description Books the chosen carrier for every shipment in the plan. The placement option must already be confirmed, and once transportation is confirmed no new options can be generated or confirmed for the plan. This is ASYNCHRONOUS: poll Get Inbound Operation Status with the returned operationId.
   * @route POST /confirm-transportation-options
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan to confirm transportation for. Pick from List Inbound Plans."}
   * @paramDef {"type":"Array<InboundTransportationSelection>","label":"Transportation Selections","name":"transportationSelections","required":true,"description":"One entry per shipment: {shipmentId, transportationOptionId} plus optional contact details. Pick option ids from List Transportation Options."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async confirmTransportationOptions(inboundPlanId, transportationSelections) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/confirmtransportationoptions
    this.#requireInboundPlanId(inboundPlanId)

    const selections = Array.isArray(transportationSelections) ? transportationSelections : []

    if (!selections.length) {
      throw new Error('At least one Transportation Selection is required — use List Transportation Options to pick an option per shipment.')
    }

    const body = {
      transportationSelections: selections.map(selection => {
        if (!selection || !selection.shipmentId) {
          throw new Error('Each Transportation Selection needs a Shipment id — use Get Inbound Plan to list them.')
        }

        if (!selection.transportationOptionId) {
          throw new Error('Each Transportation Selection needs a Transportation Option id — use List Transportation Options to pick one.')
        }

        return this.#compactBody({
          shipmentId: selection.shipmentId,
          transportationOptionId: selection.transportationOptionId,
          contactInformation: this.#inboundContact(selection),
        })
      }),
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/transportationOptions/confirmation`,
      method: 'post',
      body,
      logTag: 'confirmTransportationOptions',
    })
  }

  /**
   * @operationName Get Inbound Shipment
   * @category Fulfillment Inbound Shipments
   * @description Retrieves the full detail of one shipment in an inbound plan - destination fulfillment center, source address, status, Amazon reference id, shipment confirmation id, selected delivery window, tracking details and the selected transportation option. Use the selectedTransportationOptionId to look the carrier details back up.
   * @route POST /get-inbound-shipment
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment to read. Pick from the shipments of the inbound plan."}
   * @returns {Object}
   * @sampleResult {"shipmentId":"sh1234abcd-1234-abcd-5678-1234abcd5678","name":"Spring restock - 1","status":"WORKING","amazonReferenceId":"FBA15D9XYZ","shipmentConfirmationId":"FBA15D9XYZ","placementOptionId":"pl1234abcd-1234-abcd-5678-1234abcd5678","selectedTransportationOptionId":"to1234abcd-1234-abcd-5678-1234abcd5678","destination":{"destinationType":"AMAZON_WAREHOUSE","warehouseId":"YYZ14"},"source":{"sourceType":"SELLER_FACILITY"},"selectedDeliveryWindow":{"deliveryWindowOptionId":"dw1234abcd-1234-abcd-5678-1234abcd5678","startDate":"2024-04-05T14:00:00.000Z","endDate":"2024-04-05T20:00:00.000Z","availabilityType":"AVAILABLE"}}
   */
  async getInboundShipment(inboundPlanId, shipmentId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getshipment
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }`,
      logTag: 'getInboundShipment',
    })
  }

  /**
   * @operationName Update Inbound Shipment Name
   * @category Fulfillment Inbound Shipments
   * @description Renames a shipment inside an inbound plan. This is a label change only and does not affect the shipment's contents, carrier or delivery window.
   * @route POST /update-inbound-shipment-name
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment to rename. Pick from the shipments of the inbound plan."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The new name for the shipment."}
   * @returns {Object}
   * @sampleResult {"success":true,"shipmentId":"sh1234abcd-1234-abcd-5678-1234abcd5678","name":"Spring restock - 1"}
   */
  async updateShipmentName(inboundPlanId, shipmentId, name) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/updateshipmentname
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    if (!name) throw new Error('A Name is required.')

    await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/name`,
      method: 'put',
      body: { name },
      logTag: 'updateShipmentName',
    })

    // The endpoint returns 204 No Content on success - return a clear success shape.
    return { success: true, shipmentId, name }
  }

  /**
   * @operationName List Inbound Shipment Items
   * @category Fulfillment Inbound Shipments
   * @description Lists the item packages in one shipment with ASIN, FNSKU, MSKU, quantity, label/prep owners and prep instructions. Use this to reconcile what a single shipment actually carries after the plan was split.
   * @route POST /list-inbound-shipment-items
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment whose items to list. Pick from the shipments of the inbound plan."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page, 1-1000. Defaults to Amazon's page size."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response. Leave empty for the first page."}
   * @returns {Object}
   * @sampleResult {"items":[{"asin":"B00CZX5JE2","fnsku":"X001ABC","msku":"SKU-123","quantity":10,"labelOwner":"AMAZON","prepOwner":"SELLER","prepInstructions":[]}],"pagination":{"nextToken":null}}
   */
  async listShipmentItems(inboundPlanId, shipmentId, pageSize, paginationToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listshipmentitems
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/items`,
      query: { pageSize, paginationToken },
      logTag: 'listShipmentItems',
    })
  }

  /**
   * @operationName List Inbound Shipment Boxes
   * @category Fulfillment Inbound Shipments
   * @description Lists the box packages in one shipment with their box ids, dimensions, weight and contents. The box ids returned here are what Small Parcel Delivery tracking numbers are attached to.
   * @route POST /list-inbound-shipment-boxes
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment whose boxes to list. Pick from the shipments of the inbound plan."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Boxes per page, 1-1000. Defaults to Amazon's page size."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response. Leave empty for the first page."}
   * @returns {Object}
   * @sampleResult {"boxes":[{"packageId":"pk1234abcd-1234-abcd-5678-1234abcd5678","boxId":"FBA15D9XYZU000001","contentInformationSource":"BOX_CONTENT_PROVIDED","quantity":1,"dimensions":{"length":3,"width":4,"height":5,"unitOfMeasurement":"CM"},"weight":{"unit":"KG","value":5.5},"items":[{"msku":"SKU-123","quantity":10}]}],"pagination":{"nextToken":null}}
   */
  async listShipmentBoxes(inboundPlanId, shipmentId, pageSize, paginationToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listshipmentboxes
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/boxes`,
      query: { pageSize, paginationToken },
      logTag: 'listShipmentBoxes',
    })
  }

  /**
   * @operationName List Inbound Shipment Pallets
   * @category Fulfillment Inbound Shipments
   * @description Lists the pallet packages in one palletized shipment with dimensions, weight and stackability. Pallets only exist once Less-Than-Truckload (LTL) transportation options were generated with pallet details.
   * @route POST /list-inbound-shipment-pallets
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment whose pallets to list. Pick from the shipments of the inbound plan."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pallets per page, 1-1000. Defaults to Amazon's page size."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response. Leave empty for the first page."}
   * @returns {Object}
   * @sampleResult {"pallets":[{"packageId":"pk1234abcd-1234-abcd-5678-1234abcd5678","quantity":2,"stackability":"STACKABLE","dimensions":{"length":120,"width":100,"height":150,"unitOfMeasurement":"CM"},"weight":{"unit":"KG","value":250}}],"pagination":{"nextToken":null}}
   */
  async listShipmentPallets(inboundPlanId, shipmentId, pageSize, paginationToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listshipmentpallets
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/pallets`,
      query: { pageSize, paginationToken },
      logTag: 'listShipmentPallets',
    })
  }

  /**
   * @operationName Update Inbound Shipment Source Address
   * @category Fulfillment Inbound Shipments
   * @description Changes the address a shipment ships from. Only possible before the shipment's carrier is confirmed, and it invalidates the existing transportation options - regenerate them afterwards to re-quote from the new origin. This is ASYNCHRONOUS: poll Get Inbound Operation Status with the returned operationId.
   * @route POST /update-inbound-shipment-source-address
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment whose source address to change. Pick from the shipments of the inbound plan."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Contact name at the new ship-from address."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"addressLine1","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Street address of the new origin."}
   * @paramDef {"type":"String","label":"City","name":"city","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"City of the new origin."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"ZIP / postal code of the new origin."}
   * @paramDef {"type":"String","label":"Country Code","name":"countryCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"defaultValue":"US","description":"Two-letter ISO country code of the new origin (e.g. US, GB, DE)."}
   * @paramDef {"type":"String","label":"Phone","name":"phoneNumber","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Phone number for the ship-from contact. Amazon requires it on the source address."}
   * @paramDef {"type":"String","label":"Address Line 2","name":"addressLine2","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Suite, floor, unit, etc. (optional)."}
   * @paramDef {"type":"String","label":"State / Province","name":"stateOrProvinceCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"State or province code of the new origin."}
   * @paramDef {"type":"String","label":"Company","name":"companyName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Business name at the new origin (optional)."}
   * @paramDef {"type":"String","label":"District / County","name":"districtOrCounty","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"District or county of the new origin (optional)."}
   * @paramDef {"type":"String","label":"Email","name":"email","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email for the ship-from contact (optional)."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async updateShipmentSourceAddress(inboundPlanId, shipmentId, name, addressLine1, city, postalCode, countryCode, phoneNumber, addressLine2, stateOrProvinceCode, companyName, districtOrCounty, email) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/updateshipmentsourceaddress
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    const address = this.#inboundAddress({
      name,
      addressLine1,
      addressLine2,
      city,
      stateOrProvinceCode,
      postalCode,
      countryCode,
      phoneNumber,
      companyName,
      districtOrCounty,
      email,
    })

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/sourceAddress`,
      method: 'put',
      body: { address },
      logTag: 'updateShipmentSourceAddress',
    })
  }

  /**
   * @operationName Update Inbound Shipment Tracking Details
   * @category Fulfillment Inbound Shipments
   * @description Attaches carrier tracking to a non-Amazon-partnered shipment. For Small Parcel Delivery supply one tracking number per box id; for Less-Than-Truckload supply the freight bill number and optionally the bill of lading. This is ASYNCHRONOUS: poll Get Inbound Operation Status with the returned operationId.
   * @route POST /update-inbound-shipment-tracking-details
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment to attach tracking to. Pick from the shipments of the inbound plan."}
   * @paramDef {"type":"Array<SpdTrackingItem>","label":"Small Parcel Tracking Items","name":"spdTrackingItems","description":"For Small Parcel Delivery: one {boxId, trackingId} per box. Box ids come from List Inbound Shipment Boxes and only exist once transportation is confirmed."}
   * @paramDef {"type":"Array<String>","label":"Freight Bill Numbers","name":"freightBillNumbers","description":"For Less-Than-Truckload: the freight bill number of the shipment. Amazon accepts a single value."}
   * @paramDef {"type":"String","label":"Bill Of Lading Number","name":"billOfLadingNumber","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"For Less-Than-Truckload: the carrier's shipment acknowledgement document number (optional)."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async updateShipmentTrackingDetails(inboundPlanId, shipmentId, spdTrackingItems, freightBillNumbers, billOfLadingNumber) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/updateshipmenttrackingdetails
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    const spdItems = (Array.isArray(spdTrackingItems) ? spdTrackingItems : []).map(item => {
      if (!item || !item.boxId) throw new Error('Each Small Parcel Tracking Item needs a Box id — use List Inbound Shipment Boxes to get them.')
      if (!item.trackingId) throw new Error('Each Small Parcel Tracking Item needs a Tracking id.')

      return { boxId: item.boxId, trackingId: item.trackingId }
    })

    const freightBills = this.#toArray(freightBillNumbers)

    // The two shipping modes are mutually exclusive in practice; send only the branch supplied.
    const trackingDetails = this.#compactBody({
      spdTrackingDetail: spdItems.length ? { spdTrackingItems: spdItems } : undefined,
      ltlTrackingDetail: freightBills.length
        ? this.#compactBody({ freightBillNumber: freightBills, billOfLadingNumber })
        : undefined,
    })

    if (!Object.keys(trackingDetails).length) {
      throw new Error('Tracking details are required — provide Small Parcel Tracking Items (per box) or a Freight Bill Number (LTL).')
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/trackingDetails`,
      method: 'put',
      body: { trackingDetails },
      logTag: 'updateShipmentTrackingDetails',
    })
  }

  /**
   * @operationName Get Delivery Challan Document
   * @category Fulfillment Inbound Shipments
   * @description Returns a short-lived download URL for the delivery challan document of a shipment. This document is specific to Partnered Carrier Program transportation in the India (IN) marketplace and is not available elsewhere.
   * @route POST /get-delivery-challan-document
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment whose delivery challan document to download (IN marketplace only)."}
   * @returns {Object}
   * @sampleResult {"documentDownload":{"downloadType":"URL","uri":"https://example.amazonaws.com/challan.pdf","expiration":"2024-04-01T12:00:00.000Z"}}
   */
  async getDeliveryChallanDocument(inboundPlanId, shipmentId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getdeliverychallandocument
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/deliveryChallanDocument`,
      logTag: 'getDeliveryChallanDocument',
    })
  }

  /**
   * @operationName Generate Delivery Window Options
   * @category Fulfillment Inbound Shipments
   * @description Asks Amazon to compute the delivery windows available for a shipment - the slots in which the fulfillment center expects it. Some transportation options list a confirmed delivery window as a precondition. This is ASYNCHRONOUS: poll Get Inbound Operation Status with the returned operationId before listing the windows.
   * @route POST /generate-delivery-window-options
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment to generate delivery window options for."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async generateDeliveryWindowOptions(inboundPlanId, shipmentId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/generatedeliverywindowoptions
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/deliveryWindowOptions`,
      method: 'post',
      logTag: 'generateDeliveryWindowOptions',
    })
  }

  /**
   * @operationName List Delivery Window Options
   * @category Fulfillment Inbound Shipments
   * @description Lists the delivery windows available for a shipment, each with its start/end date, availability type (available, blocked, congested or discounted) and the time it stays valid. Generate Delivery Window Options must have completed first.
   * @route POST /list-delivery-window-options
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment whose delivery window options to list."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Options per page, 1-20. Defaults to Amazon's page size."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response. Leave empty for the first page."}
   * @returns {Object}
   * @sampleResult {"deliveryWindowOptions":[{"deliveryWindowOptionId":"dw1234abcd-1234-abcd-5678-1234abcd5678","availabilityType":"AVAILABLE","startDate":"2024-04-05T14:00:00.000Z","endDate":"2024-04-05T20:00:00.000Z","validUntil":"2024-04-01T20:00:00.000Z"}],"pagination":{"nextToken":null}}
   */
  async listDeliveryWindowOptions(inboundPlanId, shipmentId, pageSize, paginationToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listdeliverywindowoptions
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/deliveryWindowOptions`,
      query: { pageSize, paginationToken },
      logTag: 'listDeliveryWindowOptions',
    })
  }

  /**
   * @operationName Confirm Delivery Window Options
   * @category Fulfillment Inbound Shipments
   * @description Books a delivery window for a shipment. The placement option must be confirmed first. Once confirmed, no new windows can be generated, though the chosen window can still be changed until the shipment closes. This is ASYNCHRONOUS: poll Get Inbound Operation Status with the returned operationId.
   * @route POST /confirm-delivery-window-options
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment to book a delivery window for."}
   * @paramDef {"type":"String","label":"Delivery Window Option","name":"deliveryWindowOptionId","dictionary":"getDeliveryWindowOptionsDictionary","dependsOn":["inboundPlanId","shipmentId"],"required":true,"description":"The delivery window to book. Pick from List Delivery Window Options."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async confirmDeliveryWindowOptions(inboundPlanId, shipmentId, deliveryWindowOptionId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/confirmdeliverywindowoptions
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    if (!deliveryWindowOptionId) {
      throw new Error('A Delivery Window Option is required — use List Delivery Window Options to pick one.')
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/deliveryWindowOptions/${ encodeURIComponent(deliveryWindowOptionId) }/confirmation`,
      method: 'post',
      logTag: 'confirmDeliveryWindowOptions',
    })
  }

  /**
   * @operationName Generate Shipment Content Update Previews
   * @category Fulfillment Inbound Shipments
   * @description Prices a proposed change to the contents of a shipment whose carrier is already confirmed. Supply the complete intended set of boxes and items - not a delta - and Amazon returns a preview of the new transportation cost that can be accepted before it expires. This is ASYNCHRONOUS: poll Get Inbound Operation Status with the returned operationId, then read the preview.
   * @route POST /generate-shipment-content-update-previews
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment whose contents you intend to change."}
   * @paramDef {"type":"Array<InboundBox>","label":"Boxes","name":"boxes","required":true,"description":"Every box the shipment should contain after the update. Include a packageId to update an existing box; omit it to add a new one. Existing boxes you leave out are removed."}
   * @paramDef {"type":"Array<InboundItem>","label":"Items","name":"items","required":true,"description":"Every item the shipment should contain after the update. Each is {msku, quantity, labelOwner, prepOwner}."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async generateShipmentContentUpdatePreviews(inboundPlanId, shipmentId, boxes, items) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/generateshipmentcontentupdatepreviews
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    const body = {
      boxes: this.#inboundBoxes(boxes),
      items: this.#inboundItems(items),
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/contentUpdatePreviews`,
      method: 'post',
      body,
      logTag: 'generateShipmentContentUpdatePreviews',
    })
  }

  /**
   * @operationName List Shipment Content Update Previews
   * @category Fulfillment Inbound Shipments
   * @description Lists the pending content update previews for a shipment, each summarising the requested boxes/items and the transportation option that would apply, plus the expiry after which it can no longer be confirmed.
   * @route POST /list-shipment-content-update-previews
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment whose content update previews to list."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Previews per page, 1-20. Defaults to Amazon's page size."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response. Leave empty for the first page."}
   * @returns {Object}
   * @sampleResult {"contentUpdatePreviews":[{"contentUpdatePreviewId":"cu1234abcd-1234-abcd-5678-1234abcd5678","expiration":"2024-04-01T12:00:00.000Z","transportationOption":{"transportationOptionId":"to1234abcd-1234-abcd-5678-1234abcd5678","shipmentId":"sh1234abcd-1234-abcd-5678-1234abcd5678","shippingMode":"GROUND_SMALL_PARCEL","shippingSolution":"AMAZON_PARTNERED_CARRIER","carrier":{"name":"UPS","alphaCode":"UPSN"},"quote":{"cost":{"amount":48,"code":"USD"}}}}],"pagination":{"nextToken":null}}
   */
  async listShipmentContentUpdatePreviews(inboundPlanId, shipmentId, pageSize, paginationToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listshipmentcontentupdatepreviews
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/contentUpdatePreviews`,
      query: { pageSize, paginationToken },
      logTag: 'listShipmentContentUpdatePreviews',
    })
  }

  /**
   * @operationName Get Shipment Content Update Preview
   * @category Fulfillment Inbound Shipments
   * @description Retrieves one content update preview - the boxes and items it would apply and the transportation cost that comes with them. Read this to review the cost impact before confirming the change, and note the expiration after which it lapses.
   * @route POST /get-shipment-content-update-preview
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment the preview belongs to."}
   * @paramDef {"type":"String","label":"Content Update Preview ID","name":"contentUpdatePreviewId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The preview to read. Pick one from List Shipment Content Update Previews."}
   * @returns {Object}
   * @sampleResult {"contentUpdatePreviewId":"cu1234abcd-1234-abcd-5678-1234abcd5678","expiration":"2024-04-01T12:00:00.000Z","requestedUpdates":{"boxes":[{"packageId":"pk1234abcd-1234-abcd-5678-1234abcd5678","quantity":1}],"items":[{"msku":"SKU-123","quantity":10}]},"transportationOption":{"transportationOptionId":"to1234abcd-1234-abcd-5678-1234abcd5678","shipmentId":"sh1234abcd-1234-abcd-5678-1234abcd5678","shippingMode":"GROUND_SMALL_PARCEL","shippingSolution":"AMAZON_PARTNERED_CARRIER","quote":{"cost":{"amount":48,"code":"USD"}},"preconditions":[]}}
   */
  async getShipmentContentUpdatePreview(inboundPlanId, shipmentId, contentUpdatePreviewId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getshipmentcontentupdatepreview
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    if (!contentUpdatePreviewId) {
      throw new Error('A Content Update Preview ID is required — use List Shipment Content Update Previews to pick one.')
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/contentUpdatePreviews/${ encodeURIComponent(contentUpdatePreviewId) }`,
      logTag: 'getShipmentContentUpdatePreview',
    })
  }

  /**
   * @operationName Confirm Shipment Content Update Preview
   * @category Fulfillment Inbound Shipments
   * @description Applies a content update preview to the shipment and accepts the transportation cost it quotes. It must be confirmed before the preview's expiration. This is ASYNCHRONOUS: poll Get Inbound Operation Status with the returned operationId.
   * @route POST /confirm-shipment-content-update-preview
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment the preview belongs to."}
   * @paramDef {"type":"String","label":"Content Update Preview ID","name":"contentUpdatePreviewId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The preview to apply, before it expires. Pick one from List Shipment Content Update Previews."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async confirmShipmentContentUpdatePreview(inboundPlanId, shipmentId, contentUpdatePreviewId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/confirmshipmentcontentupdatepreview
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    if (!contentUpdatePreviewId) {
      throw new Error('A Content Update Preview ID is required — use List Shipment Content Update Previews to pick one.')
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/contentUpdatePreviews/${ encodeURIComponent(contentUpdatePreviewId) }/confirmation`,
      method: 'post',
      logTag: 'confirmShipmentContentUpdatePreview',
    })
  }

  /**
   * @operationName Generate Self-Ship Appointment Slots
   * @category Fulfillment Inbound Shipments
   * @description Starts computing the drop-off appointment slots available for a self-shipped shipment, optionally within a desired date range. Only supported in the MX, BR, EG, SA, AE and IN marketplaces. This is ASYNCHRONOUS: poll Get Inbound Operation Status with the returned operationId, then read the slots with Get Self-Ship Appointment Slots.
   * @route POST /generate-self-ship-appointment-slots
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment to generate drop-off slots for."}
   * @paramDef {"type":"String","label":"Desired Start Date","name":"desiredStartDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Earliest date/time you would drop the shipment off (ISO 8601). Optional."}
   * @paramDef {"type":"String","label":"Desired End Date","name":"desiredEndDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Latest date/time you would drop the shipment off (ISO 8601). Optional."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async generateSelfShipAppointmentSlots(inboundPlanId, shipmentId, desiredStartDate, desiredEndDate) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/generateselfshipappointmentslots
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    const body = this.#compactBody({ desiredStartDate, desiredEndDate })

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/selfShipAppointmentSlots`,
      method: 'post',
      body,
      logTag: 'generateSelfShipAppointmentSlots',
    })
  }

  /**
   * @operationName Get Self-Ship Appointment Slots
   * @category Fulfillment Inbound Shipments
   * @description Lists the warehouse drop-off appointment slots available for a self-shipped shipment, with the time each slot covers and when the offer expires. Generate Self-Ship Appointment Slots must have completed first. Only supported in the MX, BR, EG, SA, AE and IN marketplaces.
   * @route POST /get-self-ship-appointment-slots
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment whose drop-off slots to list."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Slots per page, 1-20. Defaults to Amazon's page size."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous response. Leave empty for the first page."}
   * @returns {Object}
   * @sampleResult {"selfShipAppointmentSlotsAvailability":{"expiresAt":"2024-04-01T12:00:00.000Z","slots":[{"slotId":"sl1234abcd-1234-abcd-5678-1234abcd5678","slotTime":{"startTime":"2024-04-05T13:15:30Z","endTime":"2024-04-05T15:15:30Z"}}]},"pagination":{"nextToken":null}}
   */
  async getSelfShipAppointmentSlots(inboundPlanId, shipmentId, pageSize, paginationToken) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getselfshipappointmentslots
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/selfShipAppointmentSlots`,
      query: { pageSize, paginationToken },
      logTag: 'getSelfShipAppointmentSlots',
    })
  }

  /**
   * @operationName Schedule Self-Ship Appointment
   * @category Fulfillment Inbound Shipments
   * @description Books, or reschedules onto, a warehouse drop-off slot for a self-shipped shipment and returns the resulting appointment id, time and status. Supply a reason when rescheduling an existing appointment. Only supported in the MX, BR, EG, SA, AE and IN marketplaces.
   * @route POST /schedule-self-ship-appointment
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment to book the drop-off for."}
   * @paramDef {"type":"String","label":"Appointment Slot","name":"slotId","dictionary":"getSelfShipAppointmentSlotsDictionary","dependsOn":["inboundPlanId","shipmentId"],"required":true,"description":"The slot to book. Pick from Get Self-Ship Appointment Slots."}
   * @paramDef {"type":"String","label":"Reason","name":"reasonComment","uiComponent":{"type":"DROPDOWN","options":{"values":["Appointment Requested By Mistake","Vehicle Delay","Slot Not Suitable","Outside Carrier Business Hours","Unfavourable External Conditions","Procurement Delay","Shipping Plan Changed","Increased Quantity","Other"]}},"description":"Why the appointment is being rescheduled. Leave empty when booking a slot for the first time."}
   * @returns {Object}
   * @sampleResult {"selfShipAppointmentDetails":{"appointmentId":1000,"appointmentStatus":"ARRIVAL_SCHEDULED","appointmentSlotTime":{"startTime":"2024-04-05T13:15:30Z","endTime":"2024-04-05T15:15:30Z"}}}
   */
  async scheduleSelfShipAppointment(inboundPlanId, shipmentId, slotId, reasonComment) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/scheduleselfshipappointment
    reasonComment = this.#resolveChoice(reasonComment, SELF_SHIP_REASON_MAP)
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    if (!slotId) {
      throw new Error('An Appointment Slot is required — use Get Self-Ship Appointment Slots to pick one.')
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/selfShipAppointmentSlots/${ encodeURIComponent(slotId) }/schedule`,
      method: 'post',
      body: this.#compactBody({ reasonComment }),
      logTag: 'scheduleSelfShipAppointment',
    })
  }

  /**
   * @operationName Cancel Self-Ship Appointment
   * @category Fulfillment Inbound Shipments
   * @description Cancels the booked warehouse drop-off appointment for a self-shipped shipment, with a reason for the cancellation. Only supported in the MX, BR, EG, SA, AE and IN marketplaces. This is ASYNCHRONOUS: poll Get Inbound Operation Status with the returned operationId.
   * @route POST /cancel-self-ship-appointment
   * @paramDef {"type":"String","label":"Inbound Plan","name":"inboundPlanId","dictionary":"getInboundPlansDictionary","required":true,"description":"The inbound plan the shipment belongs to. Pick from List Inbound Plans."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","dictionary":"getInboundShipmentsDictionary","dependsOn":["inboundPlanId"],"required":true,"description":"The shipment whose drop-off appointment to cancel."}
   * @paramDef {"type":"String","label":"Reason","name":"reasonComment","uiComponent":{"type":"DROPDOWN","options":{"values":["Appointment Requested By Mistake","Vehicle Delay","Slot Not Suitable","Outside Carrier Business Hours","Unfavourable External Conditions","Procurement Delay","Shipping Plan Changed","Increased Quantity","Other"]}},"description":"Why the appointment is being cancelled."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async cancelSelfShipAppointment(inboundPlanId, shipmentId, reasonComment) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/cancelselfshipappointment
    reasonComment = this.#resolveChoice(reasonComment, SELF_SHIP_REASON_MAP)
    this.#requireInboundPlanId(inboundPlanId)
    this.#requireInboundShipmentId(shipmentId)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/selfShipAppointmentCancellation`,
      method: 'put',
      body: this.#compactBody({ reasonComment }),
      logTag: 'cancelSelfShipAppointment',
    })
  }

  /**
   * @operationName List Item Compliance Details
   * @category Fulfillment Inbound Items
   * @description Returns the inbound compliance details Amazon holds for a list of MSKUs in a marketplace - ASIN, FNSKU and tax details such as the HSN code and declared value. Use this to check what compliance information is missing before creating an inbound plan.
   * @route POST /list-item-compliance-details
   * @paramDef {"type":"Array<String>","label":"MSKUs","name":"mskus","required":true,"description":"The merchant SKUs to look compliance details up for."}
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace whose compliance details to read."}
   * @returns {Object}
   * @sampleResult {"complianceDetails":[{"msku":"SKU-123","asin":"B00CZX5JE2","fnsku":"X001ABC","taxDetails":{"hsnCode":"900410","declaredValue":{"amount":25,"code":"INR"}}}]}
   */
  async listItemComplianceDetails(mskus, marketplaceId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listitemcompliancedetails
    const skus = this.#toArray(mskus)

    if (!skus.length) throw new Error('At least one MSKU is required.')
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/inbound/fba/2024-03-20/items/compliance`,
      query: { mskus: skus, marketplaceId },
      logTag: 'listItemComplianceDetails',
    })
  }

  /**
   * @operationName Update Item Compliance Details
   * @category Fulfillment Inbound Items
   * @description Sets the tax compliance details (HSN code, declared value and tax rates) for one MSKU. Amazon only uses these details for India (IN) marketplace compliance validation. This is ASYNCHRONOUS: poll Get Inbound Operation Status with the returned operationId.
   * @route POST /update-item-compliance-details
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace the compliance details apply to. Only the India (IN) marketplace validates them."}
   * @paramDef {"type":"String","label":"MSKU","name":"msku","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The merchant SKU whose compliance details to set."}
   * @paramDef {"type":"String","label":"HSN Code","name":"hsnCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The Harmonized System of Nomenclature code for the item."}
   * @paramDef {"type":"Number","label":"Declared Value","name":"declaredValueAmount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The declared value of one unit."}
   * @paramDef {"type":"String","label":"Declared Value Currency","name":"declaredValueCurrency","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"ISO 4217 currency code for the declared value (e.g. INR). Required when a declared value is given."}
   * @paramDef {"type":"Array<InboundTaxRate>","label":"Tax Rates","name":"taxRates","description":"The applicable tax rates. Each is {taxType, gstRate, cessRate} where taxType is CGST, SGST, IGST or TOTAL_TAX."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async updateItemComplianceDetails(marketplaceId, msku, hsnCode, declaredValueAmount, declaredValueCurrency, taxRates) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/updateitemcompliancedetails
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')
    if (!msku) throw new Error('An MSKU is required.')

    const rates = Array.isArray(taxRates) ? taxRates : []

    const taxDetails = this.#compactBody({
      hsnCode,
      declaredValue: this.#inboundCurrency(declaredValueAmount, declaredValueCurrency, 'Declared Value'),
      taxRates: rates.length
        ? rates.map(rate => this.#compactBody({ taxType: rate.taxType, gstRate: rate.gstRate, cessRate: rate.cessRate }))
        : undefined,
    })

    if (!Object.keys(taxDetails).length) {
      throw new Error('Provide at least one compliance detail — an HSN Code, a Declared Value, or Tax Rates.')
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/inbound/fba/2024-03-20/items/compliance`,
      method: 'put',
      query: { marketplaceId },
      body: { msku, taxDetails },
      logTag: 'updateItemComplianceDetails',
    })
  }

  /**
   * @operationName List Prep Details
   * @category Fulfillment Inbound Items
   * @description Returns the preparation requirements Amazon holds for a list of MSKUs in a marketplace - the prep category, the prep types required, and any constraint on who must perform the prep or apply the label. Check this before an inbound plan so items are not rejected at receive.
   * @route POST /list-prep-details
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace whose prep requirements to read."}
   * @paramDef {"type":"Array<String>","label":"MSKUs","name":"mskus","required":true,"description":"The merchant SKUs to look prep details up for."}
   * @returns {Object}
   * @sampleResult {"mskuPrepDetails":[{"msku":"SKU-123","prepCategory":"LIQUID","prepTypes":["ITEM_CAP_SEALING"],"prepOwnerConstraint":"SELLER_ONLY","labelOwnerConstraint":"NONE_ONLY","allOwnersConstraint":"NONE_ONLY"}]}
   */
  async listPrepDetails(marketplaceId, mskus) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/listprepdetails
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')

    const skus = this.#toArray(mskus)

    if (!skus.length) throw new Error('At least one MSKU is required.')

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/inbound/fba/2024-03-20/items/prepDetails`,
      query: { marketplaceId, mskus: skus },
      logTag: 'listPrepDetails',
    })
  }

  /**
   * @operationName Set Prep Details
   * @category Fulfillment Inbound Items
   * @description Declares how a list of MSKUs must be prepared for Amazon's fulfillment network - the prep category and the prep types that apply. Setting these up front avoids prep-related rejections when the units are received. This is ASYNCHRONOUS: poll Get Inbound Operation Status with the returned operationId.
   * @route POST /set-prep-details
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace the prep details apply to."}
   * @paramDef {"type":"Array<MskuPrepDetail>","label":"MSKU Prep Details","name":"mskuPrepDetails","required":true,"description":"One entry per SKU: {msku, prepCategory, prepTypes}. Use List Prep Details to see what Amazon currently expects."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678"}
   */
  async setPrepDetails(marketplaceId, mskuPrepDetails) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/setprepdetails
    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')

    const details = Array.isArray(mskuPrepDetails) ? mskuPrepDetails : []

    if (!details.length) {
      throw new Error('At least one MSKU Prep Detail is required (each is an MSKU plus its prep category and prep types).')
    }

    const body = {
      marketplaceId,
      mskuPrepDetails: details.map(detail => {
        if (!detail || !detail.msku) throw new Error('Each MSKU Prep Detail needs an MSKU.')
        if (!detail.prepCategory) throw new Error('Each MSKU Prep Detail needs a Prep Category (e.g. LIQUID, TEXTILE, NONE).')

        const prepTypes = this.#toArray(detail.prepTypes)

        if (!prepTypes.length) {
          throw new Error('Each MSKU Prep Detail needs at least one Prep Type (e.g. ITEM_LABELING, ITEM_NO_PREP).')
        }

        return { msku: detail.msku, prepCategory: detail.prepCategory, prepTypes }
      }),
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/inbound/fba/2024-03-20/items/prepDetails`,
      method: 'post',
      body,
      logTag: 'setPrepDetails',
    })
  }

  /**
   * @operationName Create Marketplace Item Labels
   * @category Fulfillment Inbound Items
   * @description Generates printable FNSKU item labels for up to 100 MSKUs in a marketplace and returns short-lived download URLs. Choose a standard PDF sheet layout (with a page type) or thermal printing with an explicit label height and width.
   * @route POST /create-marketplace-item-labels
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to print the item labels for."}
   * @paramDef {"type":"String","label":"Label Type","name":"labelType","uiComponent":{"type":"DROPDOWN","options":{"values":["Standard Format (PDF)","Thermal Printing"]}},"required":true,"description":"Standard Format prints onto a label sheet (choose a Page Type); Thermal Printing produces one label per print (set Height and Width)."}
   * @paramDef {"type":"Array<MskuQuantity>","label":"MSKU Quantities","name":"mskuQuantities","required":true,"description":"The SKUs and how many labels to print for each, up to 100 entries. Each is {msku, quantity}."}
   * @paramDef {"type":"String","label":"Page Type","name":"pageType","uiComponent":{"type":"DROPDOWN","options":{"values":["A4 - 21 labels","A4 - 24 labels","A4 - 24 labels (64x33mm)","A4 - 24 labels (66x35mm)","A4 - 24 labels (70x36mm)","A4 - 24 labels (70x37mm)","A4 - 24 labels (Italy)","A4 - 27 labels","A4 - 40 labels (52x29mm)","A4 - 44 labels (48x25mm)","Letter - 30 labels"]}},"description":"The label sheet layout to print onto. Applies to Standard Format labels."}
   * @paramDef {"type":"Number","label":"Height","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Label height, 25-100. Used for thermal printing."}
   * @paramDef {"type":"Number","label":"Width","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Label width, 25-100. Used for thermal printing."}
   * @paramDef {"type":"String","label":"Locale Code","name":"localeCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"defaultValue":"en_US","description":"The language of the label text, as language_COUNTRY (e.g. en_US, fr_CA). Defaults to en_US."}
   * @returns {Object}
   * @sampleResult {"documentDownloads":[{"downloadType":"URL","uri":"https://example.amazonaws.com/labels.pdf","expiration":"2024-04-01T12:00:00.000Z"}]}
   */
  async createMarketplaceItemLabels(marketplaceId, labelType, mskuQuantities, pageType, height, width, localeCode) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/createmarketplaceitemlabels
    labelType = this.#resolveChoice(labelType, ITEM_LABEL_TYPE_MAP)
    pageType = this.#resolveChoice(pageType, ITEM_LABEL_PAGE_TYPE_MAP)

    if (!marketplaceId) throw new Error('A Marketplace is required — use Get Marketplace Participations to pick one.')
    if (!labelType) throw new Error('A Label Type is required (Standard Format or Thermal Printing).')

    const quantities = Array.isArray(mskuQuantities) ? mskuQuantities : []

    if (!quantities.length) {
      throw new Error('At least one MSKU Quantity is required (each is an MSKU plus how many labels to print).')
    }

    const body = this.#compactBody({
      marketplaceId,
      labelType,
      mskuQuantities: quantities.map(entry => {
        if (!entry || !entry.msku) throw new Error('Each MSKU Quantity needs an MSKU.')

        if (entry.quantity === null || entry.quantity === undefined || entry.quantity === '') {
          throw new Error('Each MSKU Quantity needs a Quantity (how many labels to print).')
        }

        return { msku: entry.msku, quantity: Number(entry.quantity) }
      }),
      pageType,
      height,
      width,
      localeCode,
    })

    return await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/inbound/fba/2024-03-20/items/labels`,
      method: 'post',
      body,
      logTag: 'createMarketplaceItemLabels',
    })
  }

  /**
   * @operationName Get Inbound Operation Status
   * @category Fulfillment Inbound
   * @description Reports whether an asynchronous inbound operation succeeded, failed or is still running, together with any operation problems Amazon raised. Every inbound action that returns an operationId must be followed by this poll - a SUCCESS here is what makes the next step of the workflow safe to run, and a FAILED status carries the validation errors.
   * @route POST /get-inbound-operation-status
   * @paramDef {"type":"String","label":"Operation ID","name":"operationId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The operationId returned by the asynchronous inbound action you want to check."}
   * @returns {Object}
   * @sampleResult {"operationId":"op1234abcd-1234-abcd-5678-1234abcd5678","operation":"createInboundPlan","operationStatus":"SUCCESS","operationProblems":[]}
   */
  async getInboundOperationStatus(operationId) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getinboundoperationstatus
    if (!operationId) {
      throw new Error('An Operation ID is required — it is returned by the asynchronous inbound action you want to check.')
    }

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/operations/${ encodeURIComponent(operationId) }`,
      logTag: 'getInboundOperationStatus',
    })
  }

  #requireInboundPlanId(inboundPlanId) {
    if (!inboundPlanId) {
      throw new Error('An Inbound Plan is required — use List Inbound Plans to pick one.')
    }
  }

  #requireInboundShipmentId(shipmentId) {
    if (!shipmentId) {
      throw new Error('A Shipment is required — use Get Inbound Plan to list the shipments of the plan.')
    }
  }

  // Assembles the documented inbound AddressInput from the flat first-class address params. Unlike
  // the MCF address, Amazon requires a phone number here and uses stateOrProvinceCode.
  #inboundAddress(parts) {
    if (!parts.name) throw new Error('A ship-from Name is required.')
    if (!parts.addressLine1) throw new Error('A ship-from Address Line 1 is required.')
    if (!parts.city) throw new Error('A ship-from City is required.')
    if (!parts.postalCode) throw new Error('A ship-from Postal Code is required.')
    if (!parts.countryCode) throw new Error('A ship-from Country Code is required (two-letter ISO, e.g. US).')
    if (!parts.phoneNumber) throw new Error('A ship-from Phone is required — Amazon rejects an inbound source address without one.')

    return this.#compactBody(parts)
  }

  // Normalizes the inbound items array to the documented ItemInput shape.
  #inboundItems(items) {
    const list = Array.isArray(items) ? items : []

    if (!list.length) {
      throw new Error('At least one Item is required (each is an MSKU, a quantity, and the label and prep owners).')
    }

    return list.map(item => {
      if (!item || !item.msku) throw new Error('Each Item needs an MSKU.')

      if (item.quantity === null || item.quantity === undefined || item.quantity === '') {
        throw new Error('Each Item needs a Quantity.')
      }

      if (!item.labelOwner) throw new Error('Each Item needs a Label Owner (AMAZON, SELLER or NONE).')
      if (!item.prepOwner) throw new Error('Each Item needs a Prep Owner (AMAZON, SELLER or NONE).')

      return this.#compactBody({
        msku: item.msku,
        quantity: Number(item.quantity),
        labelOwner: item.labelOwner,
        prepOwner: item.prepOwner,
        expiration: item.expiration,
        manufacturingLotCode: item.manufacturingLotCode,
      })
    })
  }

  // Normalizes the inbound boxes array to the documented BoxInput / BoxUpdateInput shape.
  #inboundBoxes(boxes) {
    const list = Array.isArray(boxes) ? boxes : []

    if (!list.length) {
      throw new Error('At least one Box is required (each is a content source, dimensions, weight and quantity).')
    }

    return list.map(box => {
      if (!box || !box.contentInformationSource) {
        throw new Error('Each Box needs a Content Information Source (BOX_CONTENT_PROVIDED, BARCODE_2D or MANUAL_PROCESS).')
      }

      if (box.quantity === null || box.quantity === undefined || box.quantity === '') {
        throw new Error('Each Box needs a Quantity (the number of identical boxes).')
      }

      // Amazon rejects box items unless the contents are declared here; with BARCODE_2D or
      // MANUAL_PROCESS the contents are read from the barcode or keyed at receive instead.
      const items = box.contentInformationSource === 'BOX_CONTENT_PROVIDED' ? this.#inboundItems(box.items) : undefined

      return this.#compactBody({
        contentInformationSource: box.contentInformationSource,
        dimensions: this.#inboundDimensions(box, 'Box', true),
        weight: this.#inboundWeight(box, 'Box', true),
        quantity: Number(box.quantity),
        items,
        packageId: box.packageId,
      })
    })
  }

  // Normalizes the inbound pallets array to the documented PalletInput shape. Only quantity is
  // required; dimensions and weight are optional per pallet.
  #inboundPallets(pallets) {
    const list = Array.isArray(pallets) ? pallets : []

    return list.map(pallet => {
      if (!pallet || pallet.quantity === null || pallet.quantity === undefined || pallet.quantity === '') {
        throw new Error('Each Pallet needs a Quantity (the number of identical pallets).')
      }

      return this.#compactBody({
        quantity: Number(pallet.quantity),
        dimensions: this.#inboundDimensions(pallet, 'Pallet', false),
        weight: this.#inboundWeight(pallet, 'Pallet', false),
        stackability: pallet.stackability,
      })
    })
  }

  // Builds the API Dimensions object from the flat length/width/height/dimensionUnit fields of a
  // box or pallet entry. Returns undefined when the entry carries no dimensions at all.
  #inboundDimensions(entry, label, required) {
    const provided = [entry.length, entry.width, entry.height].some(value => value !== null && value !== undefined && value !== '')

    if (!provided) {
      if (required) throw new Error(`Each ${ label } needs a length, width and height.`)

      return undefined
    }

    if ([entry.length, entry.width, entry.height].some(value => value === null || value === undefined || value === '')) {
      throw new Error(`Each ${ label } needs all three of length, width and height.`)
    }

    if (!entry.dimensionUnit) throw new Error(`Each ${ label } with dimensions needs a Dimension Unit (IN or CM).`)

    return {
      length: Number(entry.length),
      width: Number(entry.width),
      height: Number(entry.height),
      unitOfMeasurement: entry.dimensionUnit,
    }
  }

  // Builds the API Weight object from the flat weightValue/weightUnit fields of a box or pallet.
  #inboundWeight(entry, label, required) {
    if (entry.weightValue === null || entry.weightValue === undefined || entry.weightValue === '') {
      if (required) throw new Error(`Each ${ label } needs a weight.`)

      return undefined
    }

    if (!entry.weightUnit) throw new Error(`Each ${ label } with a weight needs a Weight Unit (LB or KG).`)

    return { value: Number(entry.weightValue), unit: entry.weightUnit }
  }

  // Builds the API Currency object; both the amount and the ISO code are required together.
  #inboundCurrency(amount, code, label) {
    if (amount === null || amount === undefined || amount === '') return undefined

    if (!code) throw new Error(`A currency code is required alongside the ${ label } (e.g. USD).`)

    return { amount: Number(amount), code }
  }

  // Builds the optional ContactInformation object from an entry's flat contact fields. Amazon
  // requires a phone number whenever a contact is supplied at all.
  #inboundContact(entry) {
    if (!entry.contactName && !entry.contactPhoneNumber && !entry.contactEmail) return undefined

    if (!entry.contactName || !entry.contactPhoneNumber) {
      throw new Error('Contact details need both a name and a phone number.')
    }

    return this.#compactBody({
      name: entry.contactName,
      phoneNumber: entry.contactPhoneNumber,
      email: entry.contactEmail,
    })
  }

  // Builds the optional FreightInformation object. Without it Amazon returns no freight (LTL) quotes.
  #inboundFreight(entry) {
    const freight = this.#compactBody({
      freightClass: entry.freightClass,
      declaredValue: this.#inboundCurrency(entry.declaredValueAmount, entry.declaredValueCurrency, 'freight declared value'),
    })

    return Object.keys(freight).length ? freight : undefined
  }

  // ==========================================================================
  //  DICTIONARIES - back every resource-pick param
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Marketplaces Dictionary
   * @description Provides the connected seller's marketplaces for dropdown selection in other actions.
   * @route POST /get-marketplaces-dictionary
   * @paramDef {"type":"getMarketplacesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Amazon.com (US)","value":"ATVPDKIKX0DER","note":"USD"}],"cursor":null}
   */
  async getMarketplacesDictionary(payload) {
    const { search } = payload || {}

    const result = await this.#apiRequest({
      url: `${ SP_API_HOSTS[this.region] || SP_API_HOSTS.NA }/sellers/v1/marketplaceParticipations`,
      logTag: 'getMarketplacesDictionary',
    })

    const entries = (result && result.payload) || []
    const term = search ? String(search).toLowerCase() : null

    const items = entries
      .map(entry => entry.marketplace)
      .filter(Boolean)
      .filter(marketplace => !term ||
        (marketplace.name || '').toLowerCase().includes(term) ||
        (marketplace.countryCode || '').toLowerCase().includes(term))
      .map(marketplace => ({
        label: `${ marketplace.name } (${ marketplace.countryCode })`,
        value: marketplace.id,
        note: marketplace.defaultCurrencyCode,
      }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Orders Dictionary
   * @description Provides recent orders in the selected marketplace for dropdown selection in other actions.
   * @route POST /get-orders-dictionary
   * @paramDef {"type":"getOrdersDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor and the marketplace whose recent orders to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"902-1845936-5435065 — Unshipped (49.99 USD)","value":"902-1845936-5435065","note":"2024-03-10T18:00:00Z"}],"cursor":null}
   */
  async getOrdersDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const marketplaceId = criteria && criteria.marketplaceId

    if (!marketplaceId) {
      return { items: [], cursor: null }
    }

    // Recent window: CreatedAfter = now - 30 days.
    const createdAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const result = await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/orders/v0/orders`,
      query: {
        MarketplaceIds: [marketplaceId],
        CreatedAfter: createdAfter,
        NextToken: cursor,
      },
      logTag: 'getOrdersDictionary',
    })

    const orders = (result && result.payload && result.payload.Orders) || []
    const term = search ? String(search).toLowerCase() : null

    const items = orders
      .filter(order => !term ||
        (order.AmazonOrderId || '').toLowerCase().includes(term) ||
        (order.OrderStatus || '').toLowerCase().includes(term))
      .map(order => {
        const total = order.OrderTotal || {}
        const amount = total.Amount !== undefined ? `${ total.Amount } ${ total.CurrencyCode || '' }`.trim() : ''

        return {
          label: `${ order.AmazonOrderId } — ${ order.OrderStatus }${ amount ? ` (${ amount })` : '' }`,
          value: order.AmazonOrderId,
          note: order.PurchaseDate,
        }
      })

    return {
      items,
      cursor: (result && result.payload && result.payload.NextToken) || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Reports Dictionary
   * @description Provides recent reports for dropdown selection in Get Report and Cancel Report.
   * @route POST /get-reports-dictionary
   * @paramDef {"type":"getReportsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"All Active Listings — Done","value":"50000018088","note":"2024-03-10T20:11:24Z"}],"cursor":null}
   */
  async getReportsDictionary(payload) {
    const { search, cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ this.#hostFor() }/reports/2021-06-30/reports`,
      query: cursor ? { nextToken: cursor } : { reportTypes: COMMON_REPORT_TYPES, pageSize: 100 },
      logTag: 'getReportsDictionary',
    })

    const reports = (result && result.reports) || []
    const term = search ? String(search).toLowerCase() : null

    const items = reports
      .filter(report => !term ||
        (report.reportId || '').toLowerCase().includes(term) ||
        (report.reportType || '').toLowerCase().includes(term))
      .map(report => ({
        label: `${ report.reportType } — ${ report.processingStatus }`,
        value: report.reportId,
        note: report.createdTime,
      }))

    return { items, cursor: (result && result.nextToken) || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Report Documents Dictionary
   * @description Provides finished (DONE) reports' document ids for dropdown selection in Get Report Document.
   * @route POST /get-report-documents-dictionary
   * @paramDef {"type":"getReportDocumentsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"All Active Listings (report 50000018088)","value":"amzn1.spdoc.1.4.na.abc","note":"2024-03-10T20:11:24Z"}],"cursor":null}
   */
  async getReportDocumentsDictionary(payload) {
    const { search, cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ this.#hostFor() }/reports/2021-06-30/reports`,
      query: cursor
        ? { nextToken: cursor }
        : { reportTypes: COMMON_REPORT_TYPES, processingStatuses: ['DONE'], pageSize: 100 },
      logTag: 'getReportDocumentsDictionary',
    })

    const reports = (result && result.reports) || []
    const term = search ? String(search).toLowerCase() : null

    const items = reports
      .filter(report => report.reportDocumentId)
      .filter(report => !term || (report.reportType || '').toLowerCase().includes(term))
      .map(report => ({
        label: `${ report.reportType } (report ${ report.reportId })`,
        value: report.reportDocumentId,
        note: report.createdTime,
      }))

    return { items, cursor: (result && result.nextToken) || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Feeds Dictionary
   * @description Provides recent feeds for dropdown selection in Get Feed and Cancel Feed.
   * @route POST /get-feeds-dictionary
   * @paramDef {"type":"getFeedsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Product Pricing — Done","value":"50000017291","note":"2024-03-10T20:11:24Z"}],"cursor":null}
   */
  async getFeedsDictionary(payload) {
    const { search, cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ this.#hostFor() }/feeds/2021-06-30/feeds`,
      query: cursor ? { nextToken: cursor } : { feedTypes: COMMON_FEED_TYPES, pageSize: 100 },
      logTag: 'getFeedsDictionary',
    })

    const feeds = (result && result.feeds) || []
    const term = search ? String(search).toLowerCase() : null

    const items = feeds
      .filter(feed => !term ||
        (feed.feedId || '').toLowerCase().includes(term) ||
        (feed.feedType || '').toLowerCase().includes(term))
      .map(feed => ({
        label: `${ feed.feedType } — ${ feed.processingStatus }`,
        value: feed.feedId,
        note: feed.createdTime,
      }))

    return { items, cursor: (result && result.nextToken) || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Feed Documents Dictionary
   * @description Provides finished (DONE) feeds' result-document ids for dropdown selection in Get Feed Document.
   * @route POST /get-feed-documents-dictionary
   * @paramDef {"type":"getFeedDocumentsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Product Pricing (feed 50000017291)","value":"amzn1.tortuga.3.xyz","note":"2024-03-10T20:11:24Z"}],"cursor":null}
   */
  async getFeedDocumentsDictionary(payload) {
    const { search, cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ this.#hostFor() }/feeds/2021-06-30/feeds`,
      query: cursor
        ? { nextToken: cursor }
        : { feedTypes: COMMON_FEED_TYPES, processingStatuses: ['DONE'], pageSize: 100 },
      logTag: 'getFeedDocumentsDictionary',
    })

    const feeds = (result && result.feeds) || []
    const term = search ? String(search).toLowerCase() : null

    const items = feeds
      .filter(feed => feed.resultFeedDocumentId)
      .filter(feed => !term || (feed.feedType || '').toLowerCase().includes(term))
      .map(feed => ({
        label: `${ feed.feedType } (feed ${ feed.feedId })`,
        value: feed.resultFeedDocumentId,
        note: feed.createdTime,
      }))

    return { items, cursor: (result && result.nextToken) || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Destinations Dictionary
   * @description Provides the seller's notification delivery destinations for dropdown selection in subscription/destination actions.
   * @route POST /get-destinations-dictionary
   * @paramDef {"type":"getDestinationsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"YourDestinationName (sqs)","value":"f3d4cee3-e6c7-49d4-bf0d-ff0b5f0d6d2f","note":"arn:aws:sqs:us-east-2:444455556666:queue1"}],"cursor":null}
   */
  async getDestinationsDictionary(payload) {
    const { search } = payload || {}

    const result = await this.#apiRequest({
      url: `${ this.#hostFor() }/notifications/v1/destinations`,
      grantlessScope: NOTIFICATIONS_SCOPE,
      logTag: 'getDestinationsDictionary',
    })

    const destinations = (result && result.payload) || []
    const term = search ? String(search).toLowerCase() : null

    const items = destinations
      .filter(d => !term || (d.name || '').toLowerCase().includes(term))
      .map(d => {
        const resource = d.resource || {}
        const kind = resource.sqs ? 'sqs' : (resource.eventBridge ? 'eventBridge' : 'unknown')
        const note = (resource.sqs && resource.sqs.arn) ||
          (resource.eventBridge && resource.eventBridge.accountId) || ''

        return { label: `${ d.name } (${ kind })`, value: d.destinationId, note }
      })

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Subscriptions Dictionary
   * @description Provides the active subscription for the chosen notification type for dropdown selection in Get/Delete Subscription By ID.
   * @route POST /get-subscriptions-dictionary
   * @paramDef {"type":"getSubscriptionsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor and the notification type whose subscription to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Any Offer Changed — 7fcf8c7d-2f0c-4f0a-9b8a-3c1d2e9b0f11","value":"7fcf8c7d-2f0c-4f0a-9b8a-3c1d2e9b0f11","note":"payload 1.0"}],"cursor":null}
   */
  async getSubscriptionsDictionary(payload) {
    const { criteria } = payload || {}
    const notificationType = criteria && criteria.notificationType

    if (!notificationType) {
      return { items: [], cursor: null }
    }

    // There is no "list subscriptions" endpoint - a notification type has at most one active
    // subscription per payload version. Resolve the single subscription for the chosen type (1.0).
    let result

    try {
      result = await this.#apiRequest({
        url: `${ this.#hostFor() }/notifications/v1/subscriptions/${ encodeURIComponent(notificationType) }`,
        query: { payloadVersion: '1.0' },
        grantlessScope: NOTIFICATIONS_SCOPE,
        logTag: 'getSubscriptionsDictionary',
      })
    } catch (error) {
      // No subscription for this type yet - return an empty list rather than an error.
      logger.debug(`getSubscriptionsDictionary: no subscription for ${ notificationType }: ${ error.message }`)

      return { items: [], cursor: null }
    }

    const subscription = result && result.payload

    if (!subscription || !subscription.subscriptionId) {
      return { items: [], cursor: null }
    }

    return {
      items: [{
        label: `${ notificationType } — ${ subscription.subscriptionId }`,
        value: subscription.subscriptionId,
        note: `payload ${ subscription.payloadVersion || '1.0' }`,
      }],
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Product Types Dictionary
   * @description Provides Amazon product types (searched by keyword) for dropdown selection in Get Product Type Schema.
   * @route POST /get-product-types-dictionary
   * @paramDef {"type":"getProductTypesDictionary__payload","label":"Payload","name":"payload","description":"Search keywords for product types."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Luggage","value":"LUGGAGE","note":"ATVPDKIKX0DER"}],"cursor":null}
   */
  async getProductTypesDictionary(payload) {
    const { search } = payload || {}

    // Seed from the first connected marketplace (product types are marketplace-specific).
    const marketplaceId = await this.#firstConnectedMarketplaceId()

    if (!marketplaceId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/definitions/2020-09-01/productTypes`,
      query: { marketplaceIds: marketplaceId, keywords: search ? [search] : undefined },
      logTag: 'getProductTypesDictionary',
    })

    const productTypes = (result && result.productTypes) || []

    const items = productTypes.map(pt => ({
      label: pt.displayName || pt.name,
      value: pt.name,
      note: (Array.isArray(pt.marketplaceIds) ? pt.marketplaceIds[0] : pt.marketplaceIds) || marketplaceId,
    }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Fulfillment Orders Dictionary
   * @description Provides recent Multi-Channel Fulfillment orders for dropdown selection in Get/Update/Cancel/Return actions.
   * @route POST /get-fulfillment-orders-dictionary
   * @paramDef {"type":"getFulfillmentOrdersDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"1001 (MCF-1001) — Complete","value":"MCF-1001","note":"2024-01-02T00:00:00Z"}],"cursor":null}
   */
  async getFulfillmentOrdersDictionary(payload) {
    const { search, cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ this.#hostFor() }/fba/outbound/2020-07-01/fulfillmentOrders`,
      query: cursor ? { nextToken: cursor } : {},
      logTag: 'getFulfillmentOrdersDictionary',
    })

    const orders = (result && result.payload && result.payload.fulfillmentOrders) || []
    const term = search ? String(search).toLowerCase() : null

    const items = orders
      .filter(order => !term ||
        (order.sellerFulfillmentOrderId || '').toLowerCase().includes(term) ||
        (order.displayableOrderId || '').toLowerCase().includes(term))
      .map(order => ({
        label: `${ order.displayableOrderId || order.sellerFulfillmentOrderId } (${ order.sellerFulfillmentOrderId })${ order.fulfillmentOrderStatus ? ` — ${ order.fulfillmentOrderStatus }` : '' }`,
        value: order.sellerFulfillmentOrderId,
        note: order.statusUpdatedDate || order.receivedDate,
      }))

    return { items, cursor: (result && result.payload && result.payload.nextToken) || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Return Reason Codes Dictionary
   * @description Provides the valid return reason codes for a SKU for dropdown selection in Create Fulfillment Return.
   * @route POST /get-return-reason-codes-dictionary
   * @paramDef {"type":"getReturnReasonCodesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor and the SKU whose return reasons to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Parts missing","value":"MissingParts","note":"MissingParts"}],"cursor":null}
   */
  async getReturnReasonCodesDictionary(payload) {
    const { search, criteria } = payload || {}
    const sellerSku = criteria && criteria.sellerSku
    const marketplaceId = criteria && criteria.marketplaceId

    if (!sellerSku) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      url: `${ this.#hostFor(marketplaceId) }/fba/outbound/2020-07-01/returnReasonCodes`,
      query: { sellerSku, marketplaceId },
      logTag: 'getReturnReasonCodesDictionary',
    })

    const details = (result && result.payload && result.payload.reasonCodeDetails) || []
    const term = search ? String(search).toLowerCase() : null

    const items = details
      .filter(d => !term ||
        (d.returnReasonCode || '').toLowerCase().includes(term) ||
        (d.description || '').toLowerCase().includes(term))
      .map(d => ({
        label: d.translatedDescription || d.description || d.returnReasonCode,
        value: d.returnReasonCode,
        note: d.returnReasonCode,
      }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Data Kiosk Queries Dictionary
   * @description Provides recent Data Kiosk queries for dropdown selection in Get/Cancel Data Kiosk Query.
   * @route POST /get-data-kiosk-queries-dictionary
   * @paramDef {"type":"getDataKioskQueriesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"12345678 (DONE)","value":"12345678","note":"2024-01-01T00:00:00Z"}],"cursor":null}
   */
  async getDataKioskQueriesDictionary(payload) {
    const { search, cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ this.#hostFor() }/dataKiosk/2023-11-15/queries`,
      query: cursor ? { paginationToken: cursor, pageSize: 100 } : { pageSize: 100 },
      logTag: 'getDataKioskQueriesDictionary',
    })

    const queries = (result && result.queries) || []
    const term = search ? String(search).toLowerCase() : null

    const items = queries
      .filter(q => !term ||
        (q.queryId || '').toLowerCase().includes(term) ||
        (q.processingStatus || '').toLowerCase().includes(term))
      .map(q => ({
        label: `${ q.queryId } (${ q.processingStatus })`,
        value: q.queryId,
        note: q.createdTime,
      }))

    return { items, cursor: (result && result.pagination && result.pagination.nextToken) || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Data Kiosk Documents Dictionary
   * @description Provides completed Data Kiosk queries' data document ids for dropdown selection in Get Data Kiosk Document.
   * @route POST /get-data-kiosk-documents-dictionary
   * @paramDef {"type":"getDataKioskDocumentsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Query 12345678 — Done","value":"DOCUMENT_ID","note":"2024-01-01T00:00:00Z"}],"cursor":null}
   */
  async getDataKioskDocumentsDictionary(payload) {
    const { search, cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ this.#hostFor() }/dataKiosk/2023-11-15/queries`,
      query: cursor
        ? { paginationToken: cursor, pageSize: 100 }
        : { processingStatuses: ['DONE'], pageSize: 100 },
      logTag: 'getDataKioskDocumentsDictionary',
    })

    const queries = (result && result.queries) || []
    const term = search ? String(search).toLowerCase() : null

    const items = queries
      .filter(q => q.dataDocumentId)
      .filter(q => !term || (q.queryId || '').toLowerCase().includes(term))
      .map(q => ({
        label: `Query ${ q.queryId } — ${ q.processingStatus || 'Done' }`,
        value: q.dataDocumentId,
        note: q.createdTime,
      }))

    return { items, cursor: (result && result.pagination && result.pagination.nextToken) || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Inbound Plans Dictionary
   * @description Provides the seller's FBA inbound plans for dropdown selection in the inbound actions.
   * @route POST /get-inbound-plans-dictionary
   * @paramDef {"type":"getInboundPlansDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Spring restock — ACTIVE","value":"wf1234abcd-1234-abcd-5678-1234abcd5678","note":"Updated 2024-03-21T09:00:00Z"}],"cursor":null}
   */
  async getInboundPlansDictionary(payload) {
    const { search, cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans`,
      query: { paginationToken: cursor, pageSize: 30, sortBy: 'LAST_UPDATED_TIME', sortOrder: 'DESC' },
      logTag: 'getInboundPlansDictionary',
    })

    const plans = (result && result.inboundPlans) || []
    const term = search ? String(search).toLowerCase() : null

    const items = plans
      .filter(plan => !term ||
        (plan.name || '').toLowerCase().includes(term) ||
        (plan.inboundPlanId || '').toLowerCase().includes(term))
      .map(plan => ({
        label: `${ plan.name || plan.inboundPlanId }${ plan.status ? ` — ${ plan.status }` : '' }`,
        value: plan.inboundPlanId,
        note: plan.lastUpdatedAt ? `Updated ${ plan.lastUpdatedAt }` : plan.createdAt,
      }))

    return { items, cursor: (result && result.pagination && result.pagination.nextToken) || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Inbound Shipments Dictionary
   * @description Provides the shipments of the selected inbound plan for dropdown selection in the shipment-level inbound actions.
   * @route POST /get-inbound-shipments-dictionary
   * @paramDef {"type":"getInboundShipmentsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor and the inbound plan whose shipments to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Spring restock - 1 — WORKING","value":"sh1234abcd-1234-abcd-5678-1234abcd5678","note":"FBA15D9XYZ"}],"cursor":null}
   */
  async getInboundShipmentsDictionary(payload) {
    const { search, criteria } = payload || {}
    const inboundPlanId = criteria && criteria.inboundPlanId

    if (!inboundPlanId) {
      return { items: [], cursor: null }
    }

    // Shipments only exist once a placement option is confirmed; the plan itself carries their
    // ids and statuses, and getShipment is needed for a name - keep the dictionary to one call.
    const plan = await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }`,
      logTag: 'getInboundShipmentsDictionary',
    })

    const shipments = (plan && plan.shipments) || []
    const term = search ? String(search).toLowerCase() : null

    const items = shipments
      .filter(shipment => !term || (shipment.shipmentId || '').toLowerCase().includes(term))
      .map(shipment => ({
        label: `${ shipment.shipmentId }${ shipment.status ? ` — ${ shipment.status }` : '' }`,
        value: shipment.shipmentId,
        note: shipment.status,
      }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Packing Options Dictionary
   * @description Provides the generated packing options of the selected inbound plan for dropdown selection in Confirm Packing Option.
   * @route POST /get-packing-options-dictionary
   * @paramDef {"type":"getPackingOptionsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor and the inbound plan whose packing options to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"po1234abcd-1234-abcd-5678-1234abcd5678 — OFFERED (1 packing group)","value":"po1234abcd-1234-abcd-5678-1234abcd5678","note":"Expires 2024-03-27T10:00:00.000Z"}],"cursor":null}
   */
  async getPackingOptionsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const inboundPlanId = criteria && criteria.inboundPlanId

    if (!inboundPlanId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/packingOptions`,
      query: { paginationToken: cursor },
      logTag: 'getPackingOptionsDictionary',
    })

    const options = (result && result.packingOptions) || []
    const term = search ? String(search).toLowerCase() : null

    const items = options
      .filter(option => !term ||
        (option.packingOptionId || '').toLowerCase().includes(term) ||
        (option.status || '').toLowerCase().includes(term))
      .map(option => {
        const groups = (option.packingGroups || []).length

        return {
          label: `${ option.packingOptionId }${ option.status ? ` — ${ option.status }` : '' } (${ groups } packing group${ groups === 1 ? '' : 's' })`,
          value: option.packingOptionId,
          note: option.expiration ? `Expires ${ option.expiration }` : option.status,
        }
      })

    return { items, cursor: (result && result.pagination && result.pagination.nextToken) || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Packing Groups Dictionary
   * @description Provides the packing groups of the selected inbound plan's packing options for dropdown selection in the packing-group actions.
   * @route POST /get-packing-groups-dictionary
   * @paramDef {"type":"getPackingGroupsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor and the inbound plan whose packing groups to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"pg1234abcd-1234-abcd-5678-1234abcd5678","value":"pg1234abcd-1234-abcd-5678-1234abcd5678","note":"Packing option po1234abcd-1234-abcd-5678-1234abcd5678 (ACCEPTED)"}],"cursor":null}
   */
  async getPackingGroupsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const inboundPlanId = criteria && criteria.inboundPlanId

    if (!inboundPlanId) {
      return { items: [], cursor: null }
    }

    // Packing groups are not addressable on their own - they are listed inside the packing options.
    const result = await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/packingOptions`,
      query: { paginationToken: cursor },
      logTag: 'getPackingGroupsDictionary',
    })

    const options = (result && result.packingOptions) || []
    const term = search ? String(search).toLowerCase() : null

    const items = options
      .flatMap(option => (option.packingGroups || []).map(packingGroupId => ({
        label: packingGroupId,
        value: packingGroupId,
        note: `Packing option ${ option.packingOptionId }${ option.status ? ` (${ option.status })` : '' }`,
      })))
      .filter(item => !term || (item.value || '').toLowerCase().includes(term))

    return { items, cursor: (result && result.pagination && result.pagination.nextToken) || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Placement Options Dictionary
   * @description Provides the generated placement options of the selected inbound plan for dropdown selection in Confirm Placement Option and the transportation actions.
   * @route POST /get-placement-options-dictionary
   * @paramDef {"type":"getPlacementOptionsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor and the inbound plan whose placement options to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"pl1234abcd-1234-abcd-5678-1234abcd5678 — OFFERED (1 shipment)","value":"pl1234abcd-1234-abcd-5678-1234abcd5678","note":"Expires 2024-03-27T10:00:00.000Z"}],"cursor":null}
   */
  async getPlacementOptionsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const inboundPlanId = criteria && criteria.inboundPlanId

    if (!inboundPlanId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/placementOptions`,
      query: { paginationToken: cursor },
      logTag: 'getPlacementOptionsDictionary',
    })

    const options = (result && result.placementOptions) || []
    const term = search ? String(search).toLowerCase() : null

    const items = options
      .filter(option => !term ||
        (option.placementOptionId || '').toLowerCase().includes(term) ||
        (option.status || '').toLowerCase().includes(term))
      .map(option => {
        const shipments = (option.shipmentIds || []).length

        return {
          label: `${ option.placementOptionId }${ option.status ? ` — ${ option.status }` : '' } (${ shipments } shipment${ shipments === 1 ? '' : 's' })`,
          value: option.placementOptionId,
          note: option.expiration ? `Expires ${ option.expiration }` : option.status,
        }
      })

    return { items, cursor: (result && result.pagination && result.pagination.nextToken) || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Transportation Options Dictionary
   * @description Provides the quoted carrier options of a placement option or shipment for dropdown selection when confirming transportation.
   * @route POST /get-transportation-options-dictionary
   * @paramDef {"type":"getTransportationOptionsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor and the inbound plan (plus the placement option or shipment) whose transportation options to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"UPS — GROUND_SMALL_PARCEL (42.5 USD)","value":"to1234abcd-1234-abcd-5678-1234abcd5678","note":"Shipment sh1234abcd-1234-abcd-5678-1234abcd5678"}],"cursor":null}
   */
  async getTransportationOptionsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const inboundPlanId = criteria && criteria.inboundPlanId
    const placementOptionId = criteria && criteria.placementOptionId
    const shipmentId = criteria && criteria.shipmentId

    // Amazon requires the query to be scoped to a placement option or a shipment.
    if (!inboundPlanId || (!placementOptionId && !shipmentId)) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/transportationOptions`,
      query: { placementOptionId, shipmentId, paginationToken: cursor },
      logTag: 'getTransportationOptionsDictionary',
    })

    const options = (result && result.transportationOptions) || []
    const term = search ? String(search).toLowerCase() : null

    const items = options
      .filter(option => !term ||
        (option.transportationOptionId || '').toLowerCase().includes(term) ||
        ((option.carrier && option.carrier.name) || '').toLowerCase().includes(term) ||
        (option.shippingMode || '').toLowerCase().includes(term))
      .map(option => {
        const carrier = (option.carrier && (option.carrier.name || option.carrier.alphaCode)) || 'Carrier'
        const cost = option.quote && option.quote.cost

        return {
          label: `${ carrier } — ${ option.shippingMode || option.shippingSolution }${ cost ? ` (${ cost.amount } ${ cost.code })` : '' }`,
          value: option.transportationOptionId,
          note: `Shipment ${ option.shipmentId }`,
        }
      })

    return { items, cursor: (result && result.pagination && result.pagination.nextToken) || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Delivery Window Options Dictionary
   * @description Provides the generated delivery windows of a shipment for dropdown selection in Confirm Delivery Window Options.
   * @route POST /get-delivery-window-options-dictionary
   * @paramDef {"type":"getDeliveryWindowOptionsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor and the inbound plan plus shipment whose delivery windows to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"2024-04-05T14:00:00.000Z → 2024-04-05T20:00:00.000Z — AVAILABLE","value":"dw1234abcd-1234-abcd-5678-1234abcd5678","note":"Valid until 2024-04-01T20:00:00.000Z"}],"cursor":null}
   */
  async getDeliveryWindowOptionsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const inboundPlanId = criteria && criteria.inboundPlanId
    const shipmentId = criteria && criteria.shipmentId

    if (!inboundPlanId || !shipmentId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/deliveryWindowOptions`,
      query: { paginationToken: cursor },
      logTag: 'getDeliveryWindowOptionsDictionary',
    })

    const options = (result && result.deliveryWindowOptions) || []
    const term = search ? String(search).toLowerCase() : null

    const items = options
      .filter(option => !term ||
        (option.deliveryWindowOptionId || '').toLowerCase().includes(term) ||
        (option.startDate || '').toLowerCase().includes(term) ||
        (option.availabilityType || '').toLowerCase().includes(term))
      .map(option => ({
        label: `${ option.startDate } → ${ option.endDate }${ option.availabilityType ? ` — ${ option.availabilityType }` : '' }`,
        value: option.deliveryWindowOptionId,
        note: option.validUntil ? `Valid until ${ option.validUntil }` : option.availabilityType,
      }))

    return { items, cursor: (result && result.pagination && result.pagination.nextToken) || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Self-Ship Appointment Slots Dictionary
   * @description Provides the available warehouse drop-off slots of a shipment for dropdown selection in Schedule Self-Ship Appointment.
   * @route POST /get-self-ship-appointment-slots-dictionary
   * @paramDef {"type":"getSelfShipAppointmentSlotsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor and the inbound plan plus shipment whose drop-off slots to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"2024-04-05T13:15:30Z → 2024-04-05T15:15:30Z","value":"sl1234abcd-1234-abcd-5678-1234abcd5678","note":"Offer expires 2024-04-01T12:00:00.000Z"}],"cursor":null}
   */
  async getSelfShipAppointmentSlotsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const inboundPlanId = criteria && criteria.inboundPlanId
    const shipmentId = criteria && criteria.shipmentId

    if (!inboundPlanId || !shipmentId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      url: `${ this.#hostFor() }/inbound/fba/2024-03-20/inboundPlans/${ encodeURIComponent(inboundPlanId) }/shipments/${ encodeURIComponent(shipmentId) }/selfShipAppointmentSlots`,
      query: { paginationToken: cursor },
      logTag: 'getSelfShipAppointmentSlotsDictionary',
    })

    const availability = (result && result.selfShipAppointmentSlotsAvailability) || {}
    const slots = availability.slots || []
    const term = search ? String(search).toLowerCase() : null

    const items = slots
      .filter(slot => !term ||
        (slot.slotId || '').toLowerCase().includes(term) ||
        ((slot.slotTime && slot.slotTime.startTime) || '').toLowerCase().includes(term))
      .map(slot => ({
        label: slot.slotTime ? `${ slot.slotTime.startTime } → ${ slot.slotTime.endTime }` : slot.slotId,
        value: slot.slotId,
        note: availability.expiresAt ? `Offer expires ${ availability.expiresAt }` : undefined,
      }))

    return { items, cursor: (result && result.pagination && result.pagination.nextToken) || null }
  }

  // Resolves the first connected marketplace id (for dictionaries whose lookup needs a marketplace
  // but whose param set does not carry one - product types are marketplace-specific).
  async #firstConnectedMarketplaceId() {
    try {
      const result = await this.#apiRequest({
        url: `${ SP_API_HOSTS[this.region] || SP_API_HOSTS.NA }/sellers/v1/marketplaceParticipations`,
        logTag: 'firstConnectedMarketplaceId',
      })

      const entries = (result && result.payload) || []
      const first = entries.map(e => e.marketplace).filter(Boolean)[0]

      return first && first.id
    } catch (error) {
      logger.debug(`firstConnectedMarketplaceId failed: ${ error.message }`)

      return null
    }
  }

  // ==========================================================================
  //  ACTIONS - Merchant Fulfillment (MFN, /mfn/v0) - buy Amazon-negotiated labels
  // ==========================================================================
  // Builds the shared ShipmentRequestDetails object from the flat ship-from / package / weight /
  // service-option params, matching the field names the getEligibleShipmentServices / createShipment
  // endpoints expect. Returns the API-exact (PascalCase) object.
  #mfnShipmentRequestDetails(p) {
    return {
      AmazonOrderId: p.amazonOrderId,
      ItemList: (Array.isArray(p.items) ? p.items : []).map(i => ({ OrderItemId: i.orderItemId, Quantity: i.quantity })),
      ShipFromAddress: this.#compactBody({
        Name: p.shipFromName,
        AddressLine1: p.shipFromAddressLine1,
        City: p.shipFromCity,
        StateOrProvinceCode: p.shipFromStateOrProvinceCode,
        PostalCode: p.shipFromPostalCode,
        CountryCode: p.shipFromCountryCode,
        Email: p.shipFromEmail,
        Phone: p.shipFromPhone,
      }),
      PackageDimensions: { Length: p.packageLength, Width: p.packageWidth, Height: p.packageHeight, Unit: p.dimensionUnit },
      Weight: { Value: p.weightValue, Unit: p.weightUnit },
      ShippingServiceOptions: { DeliveryExperience: p.deliveryExperience, CarrierWillPickUp: p.carrierWillPickUp === true },
    }
  }

  #requireMfnShipFrom(p) {
    if (!p.amazonOrderId) throw new Error('An Order is required — use Get Orders to pick one.')

    if (!Array.isArray(p.items) || !p.items.length) {
      throw new Error('At least one Item is required — pull item ids from Get Order Items.')
    }

    if (!p.shipFromName) throw new Error('A Ship-From Name is required.')
    if (!p.shipFromAddressLine1) throw new Error('A Ship-From Address Line 1 is required.')
    if (!p.shipFromCity) throw new Error('A Ship-From City is required.')
    if (!p.shipFromStateOrProvinceCode) throw new Error('A Ship-From State is required.')
    if (!p.shipFromPostalCode) throw new Error('A Ship-From Postal Code is required.')
    if (!p.shipFromCountryCode) throw new Error('A Ship-From Country is required.')
  }

  /**
   * @operationName Get Eligible Shipment Services
   * @category Merchant Fulfillment
   * @description Returns the Amazon-negotiated shipping services (carriers, rates and delivery estimates) eligible for a seller-fulfilled order, given the package and ship-from details. Use this before Create Shipment to choose a service.
   * @route POST /get-eligible-shipment-services
   * @paramDef {"type":"String","label":"Order","name":"amazonOrderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The seller-fulfilled order to buy shipping for. Pick from Get Orders."}
   * @paramDef {"type":"Array<MFNItem>","label":"Items","name":"items","required":true,"description":"The order items and quantities going in this package. Pull item ids from Get Order Items."}
   * @paramDef {"type":"String","label":"Ship-From Name","name":"shipFromName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Your business / sender name on the label."}
   * @paramDef {"type":"String","label":"Ship-From Address Line 1","name":"shipFromAddressLine1","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender street address."}
   * @paramDef {"type":"String","label":"Ship-From City","name":"shipFromCity","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender city."}
   * @paramDef {"type":"String","label":"Ship-From State","name":"shipFromStateOrProvinceCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender state or province code (e.g. WA)."}
   * @paramDef {"type":"String","label":"Ship-From Postal Code","name":"shipFromPostalCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender postal / ZIP code."}
   * @paramDef {"type":"String","label":"Ship-From Country","name":"shipFromCountryCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"defaultValue":"US","description":"The sender two-letter country code (e.g. US)."}
   * @paramDef {"type":"String","label":"Ship-From Email","name":"shipFromEmail","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional sender email."}
   * @paramDef {"type":"String","label":"Ship-From Phone","name":"shipFromPhone","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional sender phone number."}
   * @paramDef {"type":"Number","label":"Package Length","name":"packageLength","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"Package length."}
   * @paramDef {"type":"Number","label":"Package Width","name":"packageWidth","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"Package width."}
   * @paramDef {"type":"Number","label":"Package Height","name":"packageHeight","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"Package height."}
   * @paramDef {"type":"String","label":"Dimension Unit","name":"dimensionUnit","uiComponent":{"type":"DROPDOWN","options":{"values":["Inches","Centimeters"]}},"required":true,"defaultValue":"Inches","description":"Unit for the package dimensions."}
   * @paramDef {"type":"Number","label":"Weight","name":"weightValue","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"Package weight."}
   * @paramDef {"type":"String","label":"Weight Unit","name":"weightUnit","uiComponent":{"type":"DROPDOWN","options":{"values":["Ounces","Grams"]}},"required":true,"defaultValue":"Ounces","description":"Unit for the package weight."}
   * @paramDef {"type":"String","label":"Delivery Experience","name":"deliveryExperience","uiComponent":{"type":"DROPDOWN","options":{"values":["Adult Signature","Signature","Confirmation Without Signature","No Tracking"]}},"required":true,"defaultValue":"Confirmation Without Signature","description":"Tracking / signature level for the shipment."}
   * @paramDef {"type":"Boolean","label":"Carrier Will Pick Up","name":"carrierWillPickUp","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"Whether the carrier will pick up (vs you drop off)."}
   * @returns {Object}
   * @sampleResult {"payload":{"ShippingServiceList":[{"ShippingServiceName":"UPS Ground","CarrierName":"UPS","ShippingServiceId":"UPS_PTP_GND","ShippingServiceOfferId":"offer-1","Rate":{"Amount":8.5,"CurrencyCode":"USD"},"EarliestEstimatedDeliveryDate":"2024-01-05T00:00:00Z"}]}}
   */
  async getEligibleShipmentServices(amazonOrderId, items, shipFromName, shipFromAddressLine1, shipFromCity, shipFromStateOrProvinceCode, shipFromPostalCode, shipFromCountryCode, shipFromEmail, shipFromPhone, packageLength, packageWidth, packageHeight, dimensionUnit, weightValue, weightUnit, deliveryExperience, carrierWillPickUp) {
    dimensionUnit = this.#resolveChoice(dimensionUnit, MFN_DIMENSION_UNIT_MAP)
    weightUnit = this.#resolveChoice(weightUnit, MFN_WEIGHT_UNIT_MAP)
    deliveryExperience = this.#resolveChoice(deliveryExperience, DELIVERY_EXPERIENCE_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/geteligibleshipmentservices
    // Request body: { ShipmentRequestDetails: { AmazonOrderId, ItemList:[{OrderItemId,Quantity}],
    //   ShipFromAddress:{Name,AddressLine1,City,StateOrProvinceCode,PostalCode,CountryCode,Email?,Phone?},
    //   PackageDimensions:{Length,Width,Height,Unit}, Weight:{Value,Unit},
    //   ShippingServiceOptions:{DeliveryExperience,CarrierWillPickUp} } }
    const p = { amazonOrderId, items, shipFromName, shipFromAddressLine1, shipFromCity, shipFromStateOrProvinceCode, shipFromPostalCode, shipFromCountryCode, shipFromEmail, shipFromPhone, packageLength, packageWidth, packageHeight, dimensionUnit: dimensionUnit || 'inches', weightValue, weightUnit: weightUnit || 'ounces', deliveryExperience: deliveryExperience || 'DeliveryConfirmationWithoutSignature', carrierWillPickUp }

    this.#requireMfnShipFrom(p)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/mfn/v0/eligibleShippingServices`,
      method: 'post',
      body: { ShipmentRequestDetails: this.#mfnShipmentRequestDetails(p) },
      logTag: 'getEligibleShipmentServices',
    })
  }

  /**
   * @operationName Create Shipment
   * @category Merchant Fulfillment
   * @description Buys an Amazon-negotiated shipping label for a seller-fulfilled order using a chosen ShippingServiceId from Get Eligible Shipment Services. This charges the seller and returns the purchased label. Run Get Eligible Shipment Services first.
   * @route POST /create-shipment
   * @paramDef {"type":"String","label":"Order","name":"amazonOrderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The seller-fulfilled order to buy shipping for. Pick from Get Orders."}
   * @paramDef {"type":"Array<MFNItem>","label":"Items","name":"items","required":true,"description":"The order items and quantities going in this package. Pull item ids from Get Order Items."}
   * @paramDef {"type":"String","label":"Ship-From Name","name":"shipFromName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Your business / sender name on the label."}
   * @paramDef {"type":"String","label":"Ship-From Address Line 1","name":"shipFromAddressLine1","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender street address."}
   * @paramDef {"type":"String","label":"Ship-From City","name":"shipFromCity","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender city."}
   * @paramDef {"type":"String","label":"Ship-From State","name":"shipFromStateOrProvinceCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender state or province code (e.g. WA)."}
   * @paramDef {"type":"String","label":"Ship-From Postal Code","name":"shipFromPostalCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender postal / ZIP code."}
   * @paramDef {"type":"String","label":"Ship-From Country","name":"shipFromCountryCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"defaultValue":"US","description":"The sender two-letter country code (e.g. US)."}
   * @paramDef {"type":"String","label":"Ship-From Email","name":"shipFromEmail","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional sender email."}
   * @paramDef {"type":"String","label":"Ship-From Phone","name":"shipFromPhone","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional sender phone number."}
   * @paramDef {"type":"Number","label":"Package Length","name":"packageLength","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"Package length."}
   * @paramDef {"type":"Number","label":"Package Width","name":"packageWidth","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"Package width."}
   * @paramDef {"type":"Number","label":"Package Height","name":"packageHeight","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"Package height."}
   * @paramDef {"type":"String","label":"Dimension Unit","name":"dimensionUnit","uiComponent":{"type":"DROPDOWN","options":{"values":["Inches","Centimeters"]}},"required":true,"defaultValue":"Inches","description":"Unit for the package dimensions."}
   * @paramDef {"type":"Number","label":"Weight","name":"weightValue","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"Package weight."}
   * @paramDef {"type":"String","label":"Weight Unit","name":"weightUnit","uiComponent":{"type":"DROPDOWN","options":{"values":["Ounces","Grams"]}},"required":true,"defaultValue":"Ounces","description":"Unit for the package weight."}
   * @paramDef {"type":"String","label":"Delivery Experience","name":"deliveryExperience","uiComponent":{"type":"DROPDOWN","options":{"values":["Adult Signature","Signature","Confirmation Without Signature","No Tracking"]}},"required":true,"defaultValue":"Confirmation Without Signature","description":"Tracking / signature level for the shipment."}
   * @paramDef {"type":"Boolean","label":"Carrier Will Pick Up","name":"carrierWillPickUp","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"Whether the carrier will pick up (vs you drop off)."}
   * @paramDef {"type":"String","label":"Shipping Service","name":"shippingService","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The ShippingServiceId chosen from Get Eligible Shipment Services (e.g. UPS_PTP_GND). Copy it from that step's output."}
   * @paramDef {"type":"String","label":"Shipping Service Offer","name":"shippingServiceOffer","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The matching ShippingServiceOfferId from the eligible-services response (optional but recommended)."}
   * @paramDef {"type":"String","label":"Hazmat Type","name":"hazmatType","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Limited Quantity Hazmat"]}},"defaultValue":"None","description":"Hazardous-materials classification for the shipment."}
   * @returns {Object}
   * @sampleResult {"payload":{"ShipmentId":"9b9f9886-3e29-4f0c-9c8e-1a2b3c4d5e6f","AmazonOrderId":"903-1671087-0812628","Status":"Purchased","TrackingId":"1Z999AA10123456784","ShippingService":{"ShippingServiceName":"UPS Ground","Rate":{"Amount":8.5,"CurrencyCode":"USD"}},"Label":{"LabelFormat":"PDF","FileContents":{"Contents":"<base64>","FileType":"application/pdf","Checksum":"abc=="}}}}
   */
  async createShipment(amazonOrderId, items, shipFromName, shipFromAddressLine1, shipFromCity, shipFromStateOrProvinceCode, shipFromPostalCode, shipFromCountryCode, shipFromEmail, shipFromPhone, packageLength, packageWidth, packageHeight, dimensionUnit, weightValue, weightUnit, deliveryExperience, carrierWillPickUp, shippingService, shippingServiceOffer, hazmatType) {
    dimensionUnit = this.#resolveChoice(dimensionUnit, MFN_DIMENSION_UNIT_MAP)
    weightUnit = this.#resolveChoice(weightUnit, MFN_WEIGHT_UNIT_MAP)
    deliveryExperience = this.#resolveChoice(deliveryExperience, DELIVERY_EXPERIENCE_MAP)
    hazmatType = this.#resolveChoice(hazmatType, HAZMAT_TYPE_MAP)
    // docs: https://developer-docs.amazon.com/sp-api/reference/createshipment
    // Request body: { ShipmentRequestDetails:{...same as eligibleShippingServices...},
    //   ShippingServiceId, ShippingServiceOfferId?, HazmatType? }
    const p = { amazonOrderId, items, shipFromName, shipFromAddressLine1, shipFromCity, shipFromStateOrProvinceCode, shipFromPostalCode, shipFromCountryCode, shipFromEmail, shipFromPhone, packageLength, packageWidth, packageHeight, dimensionUnit: dimensionUnit || 'inches', weightValue, weightUnit: weightUnit || 'ounces', deliveryExperience: deliveryExperience || 'DeliveryConfirmationWithoutSignature', carrierWillPickUp }

    this.#requireMfnShipFrom(p)
    if (!shippingService) throw new Error('A Shipping Service is required — run Get Eligible Shipment Services and copy a ShippingServiceId.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/mfn/v0/shipments`,
      method: 'post',
      body: this.#compactBody({
        ShipmentRequestDetails: this.#mfnShipmentRequestDetails(p),
        ShippingServiceId: shippingService,
        ShippingServiceOfferId: shippingServiceOffer,
        HazmatType: hazmatType,
      }),
      logTag: 'createShipment',
    })
  }

  /**
   * @operationName Get Shipment
   * @category Merchant Fulfillment
   * @description Returns the details of a purchased Merchant Fulfillment shipment (status, tracking and label) by its shipment id from Create Shipment.
   * @route POST /get-shipment
   * @paramDef {"type":"String","label":"Shipment Reference","name":"shipmentReference","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The shipment id returned by Create Shipment. Copy it from that step's output."}
   * @returns {Object}
   * @sampleResult {"payload":{"ShipmentId":"9b9f9886-3e29-4f0c-9c8e-1a2b3c4d5e6f","Status":"Purchased","TrackingId":"1Z999AA10123456784"}}
   */
  async getShipment(shipmentReference) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getshipment
    if (!shipmentReference) throw new Error('A Shipment Reference is required — use the id returned by Create Shipment.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/mfn/v0/shipments/${ encodeURIComponent(shipmentReference) }`,
      logTag: 'getShipment',
    })
  }

  /**
   * @operationName Cancel Shipment
   * @category Merchant Fulfillment
   * @description Cancels (voids) a purchased Merchant Fulfillment shipment label by its shipment id. Use this to void a label you no longer need.
   * @route POST /cancel-shipment
   * @paramDef {"type":"String","label":"Shipment Reference","name":"shipmentReference","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The shipment to cancel (voids the label). Copy the id from Create Shipment's output."}
   * @returns {Object}
   * @sampleResult {"payload":{"ShipmentId":"9b9f9886-3e29-4f0c-9c8e-1a2b3c4d5e6f","Status":"Cancelled"}}
   */
  async cancelShipment(shipmentReference) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/cancelshipment
    // Request: DELETE /mfn/v0/shipments/{shipmentId} (no request body)
    if (!shipmentReference) throw new Error('A Shipment Reference is required — use the id returned by Create Shipment.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/mfn/v0/shipments/${ encodeURIComponent(shipmentReference) }`,
      method: 'delete',
      logTag: 'cancelShipment',
    })
  }

  /**
   * @operationName Get Additional Seller Inputs
   * @category Merchant Fulfillment
   * @description Returns any additional shipment- and item-level inputs a chosen shipping service requires (e.g. customs declarations) for a seller-fulfilled order, given the service and ship-from address.
   * @route POST /get-additional-seller-inputs
   * @paramDef {"type":"String","label":"Shipping Service","name":"shippingService","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The ShippingServiceId from Get Eligible Shipment Services (e.g. UPS_PTP_GND). Copy it from that step's output."}
   * @paramDef {"type":"String","label":"Order","name":"amazonOrderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","required":true,"description":"The order the shipment is for. Pick from Get Orders."}
   * @paramDef {"type":"String","label":"Ship-From Name","name":"shipFromName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Your business / sender name."}
   * @paramDef {"type":"String","label":"Ship-From Address Line 1","name":"shipFromAddressLine1","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender street address."}
   * @paramDef {"type":"String","label":"Ship-From City","name":"shipFromCity","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender city."}
   * @paramDef {"type":"String","label":"Ship-From State","name":"shipFromStateOrProvinceCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender state or province code (e.g. WA)."}
   * @paramDef {"type":"String","label":"Ship-From Postal Code","name":"shipFromPostalCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender postal / ZIP code."}
   * @paramDef {"type":"String","label":"Ship-From Country","name":"shipFromCountryCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"defaultValue":"US","description":"The sender two-letter country code (e.g. US)."}
   * @returns {Object}
   * @sampleResult {"payload":{"ShipmentLevelFields":[],"ItemLevelFieldsList":[]}}
   */
  async getAdditionalSellerInputs(shippingService, amazonOrderId, shipFromName, shipFromAddressLine1, shipFromCity, shipFromStateOrProvinceCode, shipFromPostalCode, shipFromCountryCode) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getadditionalsellerinputs
    // Request body: { ShippingServiceId, OrderId, ShipFromAddress:{Name,AddressLine1,City,StateOrProvinceCode,PostalCode,CountryCode} }
    if (!shippingService) throw new Error('A Shipping Service is required — run Get Eligible Shipment Services and copy a ShippingServiceId.')
    if (!amazonOrderId) throw new Error('An Order is required — use Get Orders to pick one.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/mfn/v0/additionalSellerInputs`,
      method: 'post',
      body: {
        ShippingServiceId: shippingService,
        OrderId: amazonOrderId,
        ShipFromAddress: this.#compactBody({
          Name: shipFromName,
          AddressLine1: shipFromAddressLine1,
          City: shipFromCity,
          StateOrProvinceCode: shipFromStateOrProvinceCode,
          PostalCode: shipFromPostalCode,
          CountryCode: shipFromCountryCode,
        }),
      },
      logTag: 'getAdditionalSellerInputs',
    })
  }

  // ==========================================================================
  //  ACTIONS - Amazon Shipping v2 (/shipping/v2) - buy labels via Amazon Shipping
  // ==========================================================================
  // Builds a flat Address object (camelCase, API-exact) from prefixed flat params, dropping empties.
  #shippingAddress(prefix, p) {
    return this.#compactBody({
      name: p[`${ prefix }Name`],
      addressLine1: p[`${ prefix }AddressLine1`],
      addressLine2: p[`${ prefix }AddressLine2`],
      city: p[`${ prefix }City`],
      stateOrRegion: p[`${ prefix }StateOrRegion`],
      postalCode: p[`${ prefix }PostalCode`],
      countryCode: p[`${ prefix }CountryCode`],
      phoneNumber: p[`${ prefix }PhoneNumber`],
    })
  }

  // Maps the documented ShippingPackage typed array to the Package shape the
  // getRates / oneClickShipment endpoints expect.
  #shippingPackages(packages) {
    return (Array.isArray(packages) ? packages : []).map(pkg => this.#compactBody({
      packageClientReferenceId: pkg.packageClientReferenceId,
      dimensions: { length: pkg.length, width: pkg.width, height: pkg.height, unit: pkg.dimensionUnit },
      weight: { value: pkg.weightValue, unit: pkg.weightUnit },
      insuredValue: (pkg.insuredValueAmount !== null && pkg.insuredValueAmount !== undefined && pkg.insuredValueAmount !== '')
        ? { value: pkg.insuredValueAmount, unit: 'USD' }
        : undefined,
      items: [this.#compactBody({ quantity: 1, description: pkg.description })],
    }))
  }

  // Decomposed requestedDocumentSpecification / labelSpecifications (format + size + dpi) -> API object.
  #shippingDocumentSpec(documentFormat, sizeWidth, sizeHeight, sizeUnit, dpi) {
    return {
      format: documentFormat || 'PDF',
      size: { width: sizeWidth, height: sizeHeight, unit: sizeUnit || 'INCH' },
      dpi: dpi || 300,
      pageLayout: 'DEFAULT',
      needFileJoining: false,
      requestedDocumentTypes: ['LABEL'],
    }
  }

  /**
   * @operationName Get Rates
   * @category Amazon Shipping
   * @description Returns available Amazon Shipping rates (carriers, services, charges and delivery promises) for one or more packages between a ship-from and ship-to address. Use this before Purchase Shipment to choose a rate.
   * @route POST /get-rates
   * @paramDef {"type":"String","label":"Ship-From Name","name":"shipFromName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender name on the label."}
   * @paramDef {"type":"String","label":"Ship-From Address Line 1","name":"shipFromAddressLine1","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender street address."}
   * @paramDef {"type":"String","label":"Ship-From Address Line 2","name":"shipFromAddressLine2","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional second sender address line."}
   * @paramDef {"type":"String","label":"Ship-From City","name":"shipFromCity","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender city."}
   * @paramDef {"type":"String","label":"Ship-From State/Region","name":"shipFromStateOrRegion","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender state or region (e.g. WA)."}
   * @paramDef {"type":"String","label":"Ship-From Postal Code","name":"shipFromPostalCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender postal / ZIP code."}
   * @paramDef {"type":"String","label":"Ship-From Country","name":"shipFromCountryCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"defaultValue":"US","description":"The sender two-letter country code."}
   * @paramDef {"type":"String","label":"Ship-From Phone","name":"shipFromPhoneNumber","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional sender phone number."}
   * @paramDef {"type":"String","label":"Ship-To Name","name":"shipToName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The recipient name (required for off-Amazon / External shipments)."}
   * @paramDef {"type":"String","label":"Ship-To Address Line 1","name":"shipToAddressLine1","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The recipient street address (required for External shipments)."}
   * @paramDef {"type":"String","label":"Ship-To Address Line 2","name":"shipToAddressLine2","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional second recipient address line."}
   * @paramDef {"type":"String","label":"Ship-To City","name":"shipToCity","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The recipient city (required for External shipments)."}
   * @paramDef {"type":"String","label":"Ship-To State/Region","name":"shipToStateOrRegion","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The recipient state or region (required for External shipments)."}
   * @paramDef {"type":"String","label":"Ship-To Postal Code","name":"shipToPostalCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The recipient postal / ZIP code (required for External shipments)."}
   * @paramDef {"type":"String","label":"Ship-To Country","name":"shipToCountryCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The recipient two-letter country code (required for External shipments)."}
   * @paramDef {"type":"String","label":"Ship-To Phone","name":"shipToPhoneNumber","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional recipient phone number."}
   * @paramDef {"type":"String","label":"Channel","name":"channelType","uiComponent":{"type":"DROPDOWN","options":{"values":["Amazon Order","External / Off-Amazon"]}},"required":true,"defaultValue":"External / Off-Amazon","description":"Whether this ships an Amazon order or an off-Amazon order."}
   * @paramDef {"type":"String","label":"Amazon Order","name":"amazonOrderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","description":"Required only when Channel is Amazon Order. Pick from Get Orders."}
   * @paramDef {"type":"Array<ShippingPackage>","label":"Packages","name":"packages","required":true,"description":"One or more packages to rate."}
   * @paramDef {"type":"String","label":"Ship Date","name":"shipDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Requested ship/pickup date (optional, ISO 8601)."}
   * @returns {Object}
   * @sampleResult {"payload":{"requestToken":"RequestTokenFromGetRates","rates":[{"rateId":"RateIdFromGetRates","carrierId":"AMZN_US","carrierName":"Amazon Shipping","serviceId":"ATS_PTP_STANDARD","serviceName":"Standard","totalCharge":{"value":7.99,"unit":"USD"},"promise":{"deliveryWindow":{"start":"2024-01-05T00:00:00Z","end":"2024-01-07T00:00:00Z"}}}]}}
   */
  async getRates(shipFromName, shipFromAddressLine1, shipFromAddressLine2, shipFromCity, shipFromStateOrRegion, shipFromPostalCode, shipFromCountryCode, shipFromPhoneNumber, shipToName, shipToAddressLine1, shipToAddressLine2, shipToCity, shipToStateOrRegion, shipToPostalCode, shipToCountryCode, shipToPhoneNumber, channelType, amazonOrderId, packages, shipDate) {
    channelType = this.#resolveChoice(channelType, SHIPPING_CHANNEL_TYPE_MAP)

    // docs: https://developer-docs.shipping.amazon.com/apis/reference/getrates
    // Request body: { shipFrom:{...Address...}, shipTo:{...Address...}, packages:[{packageClientReferenceId,
    //   dimensions:{length,width,height,unit}, weight:{value,unit}, items:[{quantity,description}]}],
    //   channelDetails:{channelType, amazonOrderDetails?:{orderId}}, shipDate? }
    if (!shipFromName || !shipFromAddressLine1 || !shipFromCity || !shipFromStateOrRegion || !shipFromPostalCode || !shipFromCountryCode) {
      throw new Error('A complete Ship-From address (name, address, city, state, postal code, country) is required.')
    }

    if (!Array.isArray(packages) || !packages.length) throw new Error('At least one Package is required.')

    const args = { shipFromName, shipFromAddressLine1, shipFromAddressLine2, shipFromCity, shipFromStateOrRegion, shipFromPostalCode, shipFromCountryCode, shipFromPhoneNumber, shipToName, shipToAddressLine1, shipToAddressLine2, shipToCity, shipToStateOrRegion, shipToPostalCode, shipToCountryCode, shipToPhoneNumber }
    const shipTo = this.#shippingAddress('shipTo', args)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/shipping/v2/shipments/rates`,
      method: 'post',
      extraHeaders: this.#shippingHeaders(),
      body: this.#compactBody({
        shipFrom: this.#shippingAddress('shipFrom', args),
        shipTo: Object.keys(shipTo).length ? shipTo : undefined,
        packages: this.#shippingPackages(packages),
        channelDetails: this.#compactBody({
          channelType: channelType || 'EXTERNAL',
          amazonOrderDetails: amazonOrderId ? { orderId: amazonOrderId } : undefined,
        }),
        shipDate,
      }),
      logTag: 'getRates',
    })
  }

  /**
   * @operationName Purchase Shipment
   * @category Amazon Shipping
   * @description Buys an Amazon Shipping label for a previously rated shipment, using the requestToken and rateId from Get Rates. This charges the seller and returns the purchased label document. Get Rates must have run within the last 10 minutes.
   * @route POST /purchase-shipment
   * @paramDef {"type":"String","label":"Request Token","name":"requestToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The requestToken returned by Get Rates (valid 10 minutes). Copy it from that step's output."}
   * @paramDef {"type":"String","label":"Rate Reference","name":"rateReference","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The rateId of the chosen rate from Get Rates. Copy it from that step's output."}
   * @paramDef {"type":"String","label":"Label Format","name":"documentFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["PDF","PNG","ZPL"]}},"required":true,"defaultValue":"PDF","description":"The label document format."}
   * @paramDef {"type":"Number","label":"Label Width","name":"sizeWidth","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"defaultValue":4,"description":"Label width."}
   * @paramDef {"type":"Number","label":"Label Height","name":"sizeHeight","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"defaultValue":6,"description":"Label height."}
   * @paramDef {"type":"String","label":"Label Size Unit","name":"sizeUnit","uiComponent":{"type":"DROPDOWN","options":{"values":["Inch","Centimeter"]}},"required":true,"defaultValue":"Inch","description":"Unit for the label size."}
   * @paramDef {"type":"Number","label":"DPI","name":"dpi","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":300,"description":"Label resolution in dots per inch."}
   * @returns {Object}
   * @sampleResult {"payload":{"shipmentId":"SHIPMENT_ID","packageDocumentDetails":[{"packageClientReferenceId":"pkg-1","trackingId":"1Z999AA10123456784","packageDocuments":[{"type":"LABEL","format":"PDF","contents":"<base64>"}]}]}}
   */
  async purchaseShipment(requestToken, rateReference, documentFormat, sizeWidth, sizeHeight, sizeUnit, dpi) {
    sizeUnit = this.#resolveChoice(sizeUnit, LABEL_SIZE_UNIT_MAP)
    // docs: https://developer-docs.shipping.amazon.com/apis/reference/purchaseshipment
    // Request body: { requestToken, rateId, requestedDocumentSpecification:{ format, size:{width,height,unit},
    //   dpi, pageLayout:"DEFAULT", needFileJoining:false, requestedDocumentTypes:["LABEL"] } }
    if (!requestToken) throw new Error('A Request Token is required — run Get Rates and copy the requestToken.')
    if (!rateReference) throw new Error('A Rate Reference is required — run Get Rates and copy a rateId.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/shipping/v2/shipments`,
      method: 'post',
      extraHeaders: this.#shippingHeaders(),
      body: {
        requestToken,
        rateId: rateReference,
        requestedDocumentSpecification: this.#shippingDocumentSpec(documentFormat, sizeWidth, sizeHeight, sizeUnit, dpi),
      },
      logTag: 'purchaseShipment',
    })
  }

  /**
   * @operationName One-Click Shipment
   * @category Amazon Shipping
   * @description Rates and buys an Amazon Shipping label in a single step, given the ship-from/ship-to addresses, packages and a chosen service id. This charges the seller and returns the purchased label.
   * @route POST /one-click-shipment
   * @paramDef {"type":"String","label":"Ship-From Name","name":"shipFromName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender name on the label."}
   * @paramDef {"type":"String","label":"Ship-From Address Line 1","name":"shipFromAddressLine1","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender street address."}
   * @paramDef {"type":"String","label":"Ship-From Address Line 2","name":"shipFromAddressLine2","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional second sender address line."}
   * @paramDef {"type":"String","label":"Ship-From City","name":"shipFromCity","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender city."}
   * @paramDef {"type":"String","label":"Ship-From State/Region","name":"shipFromStateOrRegion","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender state or region (e.g. WA)."}
   * @paramDef {"type":"String","label":"Ship-From Postal Code","name":"shipFromPostalCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The sender postal / ZIP code."}
   * @paramDef {"type":"String","label":"Ship-From Country","name":"shipFromCountryCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"defaultValue":"US","description":"The sender two-letter country code."}
   * @paramDef {"type":"String","label":"Ship-From Phone","name":"shipFromPhoneNumber","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional sender phone number."}
   * @paramDef {"type":"String","label":"Ship-To Name","name":"shipToName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The recipient name (required for off-Amazon / External shipments)."}
   * @paramDef {"type":"String","label":"Ship-To Address Line 1","name":"shipToAddressLine1","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The recipient street address (required for External shipments)."}
   * @paramDef {"type":"String","label":"Ship-To Address Line 2","name":"shipToAddressLine2","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional second recipient address line."}
   * @paramDef {"type":"String","label":"Ship-To City","name":"shipToCity","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The recipient city (required for External shipments)."}
   * @paramDef {"type":"String","label":"Ship-To State/Region","name":"shipToStateOrRegion","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The recipient state or region (required for External shipments)."}
   * @paramDef {"type":"String","label":"Ship-To Postal Code","name":"shipToPostalCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The recipient postal / ZIP code (required for External shipments)."}
   * @paramDef {"type":"String","label":"Ship-To Country","name":"shipToCountryCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The recipient two-letter country code (required for External shipments)."}
   * @paramDef {"type":"String","label":"Ship-To Phone","name":"shipToPhoneNumber","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional recipient phone number."}
   * @paramDef {"type":"String","label":"Channel","name":"channelType","uiComponent":{"type":"DROPDOWN","options":{"values":["Amazon Order","External / Off-Amazon"]}},"required":true,"defaultValue":"External / Off-Amazon","description":"Whether this ships an Amazon order or an off-Amazon order."}
   * @paramDef {"type":"String","label":"Amazon Order","name":"amazonOrderId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getOrdersDictionary","description":"Required only when Channel is Amazon Order. Pick from Get Orders."}
   * @paramDef {"type":"Array<ShippingPackage>","label":"Packages","name":"packages","required":true,"description":"One or more packages to ship."}
   * @paramDef {"type":"String","label":"Ship Date","name":"shipDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Requested ship/pickup date (optional, ISO 8601)."}
   * @paramDef {"type":"String","label":"Shipping Service","name":"shippingService","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The service id to buy, e.g. ATS_PTP_STANDARD. Copy it from Get Rates' output."}
   * @paramDef {"type":"String","label":"Label Format","name":"documentFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["PDF","PNG","ZPL"]}},"required":true,"defaultValue":"PDF","description":"The label document format."}
   * @paramDef {"type":"Number","label":"Label Width","name":"sizeWidth","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"defaultValue":4,"description":"Label width."}
   * @paramDef {"type":"Number","label":"Label Height","name":"sizeHeight","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"defaultValue":6,"description":"Label height."}
   * @paramDef {"type":"String","label":"Label Size Unit","name":"sizeUnit","uiComponent":{"type":"DROPDOWN","options":{"values":["Inch","Centimeter"]}},"required":true,"defaultValue":"Inch","description":"Unit for the label size."}
   * @paramDef {"type":"Number","label":"DPI","name":"dpi","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":300,"description":"Label resolution in dots per inch."}
   * @returns {Object}
   * @sampleResult {"payload":{"shipmentId":"SHIPMENT_ID","packageDocumentDetails":[{"packageClientReferenceId":"pkg-1","trackingId":"1Z999AA10123456784","packageDocuments":[{"type":"LABEL","format":"PDF","contents":"<base64>"}]}],"totalCharge":{"value":7.99,"unit":"USD"}}}
   */
  async oneClickShipment(shipFromName, shipFromAddressLine1, shipFromAddressLine2, shipFromCity, shipFromStateOrRegion, shipFromPostalCode, shipFromCountryCode, shipFromPhoneNumber, shipToName, shipToAddressLine1, shipToAddressLine2, shipToCity, shipToStateOrRegion, shipToPostalCode, shipToCountryCode, shipToPhoneNumber, channelType, amazonOrderId, packages, shipDate, shippingService, documentFormat, sizeWidth, sizeHeight, sizeUnit, dpi) {
    channelType = this.#resolveChoice(channelType, SHIPPING_CHANNEL_TYPE_MAP)
    sizeUnit = this.#resolveChoice(sizeUnit, LABEL_SIZE_UNIT_MAP)

    // docs: https://developer-docs.shipping.amazon.com/apis/reference/oneclickshipment
    // Request body: { shipTo:{...}, shipFrom:{...}, packages:[...], serviceSelection:{ serviceId:[serviceId] },
    //   channelDetails:{channelType}, labelSpecifications:{ format, size:{width,height,unit}, dpi, pageLayout:"DEFAULT",
    //   needFileJoining:false, requestedDocumentTypes:["LABEL"] } }
    if (!shipFromName || !shipFromAddressLine1 || !shipFromCity || !shipFromStateOrRegion || !shipFromPostalCode || !shipFromCountryCode) {
      throw new Error('A complete Ship-From address (name, address, city, state, postal code, country) is required.')
    }

    if (!Array.isArray(packages) || !packages.length) throw new Error('At least one Package is required.')
    if (!shippingService) throw new Error('A Shipping Service is required — run Get Rates and copy a serviceId (e.g. ATS_PTP_STANDARD).')

    const args = { shipFromName, shipFromAddressLine1, shipFromAddressLine2, shipFromCity, shipFromStateOrRegion, shipFromPostalCode, shipFromCountryCode, shipFromPhoneNumber, shipToName, shipToAddressLine1, shipToAddressLine2, shipToCity, shipToStateOrRegion, shipToPostalCode, shipToCountryCode, shipToPhoneNumber }
    const shipTo = this.#shippingAddress('shipTo', args)

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/shipping/v2/oneClickShipment`,
      method: 'post',
      extraHeaders: this.#shippingHeaders(),
      body: this.#compactBody({
        shipFrom: this.#shippingAddress('shipFrom', args),
        shipTo: Object.keys(shipTo).length ? shipTo : undefined,
        packages: this.#shippingPackages(packages),
        serviceSelection: { serviceId: [shippingService] },
        channelDetails: this.#compactBody({
          channelType: channelType || 'EXTERNAL',
          amazonOrderDetails: amazonOrderId ? { orderId: amazonOrderId } : undefined,
        }),
        shipDate,
        labelSpecifications: this.#shippingDocumentSpec(documentFormat, sizeWidth, sizeHeight, sizeUnit, dpi),
      }),
      logTag: 'oneClickShipment',
    })
  }

  /**
   * @operationName Get Tracking
   * @category Amazon Shipping
   * @description Returns the tracking status and event history for an Amazon Shipping package, given its tracking id and carrier id.
   * @route POST /get-tracking
   * @paramDef {"type":"String","label":"Tracking Number","name":"trackingNumber","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The tracking id from a purchased shipment. Copy it from Purchase Shipment / One-Click Shipment's output."}
   * @paramDef {"type":"String","label":"Carrier","name":"carrier","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The carrier id from the rate/shipment, e.g. AMZN_US. Copy it from Get Rates' output."}
   * @returns {Object}
   * @sampleResult {"payload":{"trackingId":"1Z999AA10123456784","summary":{"status":"IN_TRANSIT"},"promisedDeliveryDate":"2024-01-07T00:00:00Z","eventHistory":[{"eventCode":"PickupDone","eventTime":"2024-01-05T12:00:00Z"}]}}
   */
  async getTracking(trackingNumber, carrier) {
    // docs: https://developer-docs.shipping.amazon.com/apis/reference/gettracking
    if (!trackingNumber) throw new Error('A Tracking Number is required.')
    if (!carrier) throw new Error('A Carrier is required (e.g. AMZN_US).')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/shipping/v2/tracking`,
      extraHeaders: this.#shippingHeaders(),
      query: { trackingId: trackingNumber, carrierId: carrier },
      logTag: 'getTracking',
    })
  }

  /**
   * @operationName Get Shipment Documents
   * @category Amazon Shipping
   * @description Re-fetches the label and other documents for a purchased Amazon Shipping shipment, given its shipment id and a package reference.
   * @route POST /get-shipment-documents
   * @paramDef {"type":"String","label":"Shipment Reference","name":"shipmentReference","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The shipment id from Purchase Shipment / One-Click Shipment. Copy it from that step's output."}
   * @paramDef {"type":"String","label":"Package Reference","name":"packageReference","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The packageClientReferenceId of the package whose documents to fetch."}
   * @paramDef {"type":"String","label":"Format","name":"format","uiComponent":{"type":"DROPDOWN","options":{"values":["PDF","PNG","ZPL"]}},"description":"Optional document format."}
   * @returns {Object}
   * @sampleResult {"payload":{"shipmentId":"SHIPMENT_ID","packageDocumentDetail":{"packageClientReferenceId":"pkg-1","trackingId":"1Z999AA10123456784","packageDocuments":[{"type":"LABEL","format":"PDF","contents":"<base64>"}]}}}
   */
  async getShipmentDocuments(shipmentReference, packageReference, format) {
    // docs: https://developer-docs.shipping.amazon.com/apis/reference/getshipmentdocuments
    if (!shipmentReference) throw new Error('A Shipment Reference is required.')
    if (!packageReference) throw new Error('A Package Reference is required.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/shipping/v2/shipments/${ encodeURIComponent(shipmentReference) }/documents`,
      extraHeaders: this.#shippingHeaders(),
      query: { packageClientReferenceId: packageReference, format },
      logTag: 'getShipmentDocuments',
    })
  }

  /**
   * @operationName Cancel Amazon Shipment
   * @category Amazon Shipping
   * @description Cancels (voids) a purchased Amazon Shipping shipment by its shipment id.
   * @route POST /cancel-amazon-shipment
   * @paramDef {"type":"String","label":"Shipment Reference","name":"shipmentReference","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The Amazon Shipping shipment to cancel / void. Copy the id from Purchase Shipment / One-Click Shipment's output."}
   * @returns {Object}
   * @sampleResult {"payload":{"cancelled":true}}
   */
  async cancelAmazonShipment(shipmentReference) {
    // docs: https://developer-docs.shipping.amazon.com/apis/reference/cancelshipment
    // Request: PUT /shipping/v2/shipments/{shipmentId}/cancel (no request body)
    if (!shipmentReference) throw new Error('A Shipment Reference is required.')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/shipping/v2/shipments/${ encodeURIComponent(shipmentReference) }/cancel`,
      method: 'put',
      extraHeaders: this.#shippingHeaders(),
      logTag: 'cancelAmazonShipment',
    })
  }

  /**
   * @operationName Get Access Points
   * @category Amazon Shipping
   * @description Returns nearby Amazon Shipping access points (e.g. pharmacies, lockers) for a country and postal code, for the requested access point types.
   * @route POST /get-access-points
   * @paramDef {"type":"Array<String>","label":"Access Point Types","name":"accessPointTypes","required":true,"description":"Access point types to search, e.g. PHARMACY."}
   * @paramDef {"type":"String","label":"Country","name":"countryCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The two-letter country code to search in (e.g. US)."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The postal / ZIP code to search near."}
   * @returns {Object}
   * @sampleResult {"payload":{"accessPointsMap":{"PHARMACY":[{"accessPointId":"AP-1","name":"Sample Pharmacy","address":{"city":"Seattle"}}]}}}
   */
  async getAccessPoints(accessPointTypes, countryCode, postalCode) {
    // docs: https://developer-docs.shipping.amazon.com/apis/reference/getaccesspoints
    if (!countryCode) throw new Error('A Country is required (two-letter code, e.g. US).')
    if (!postalCode) throw new Error('A Postal Code is required.')

    const types = this.#toArray(accessPointTypes)

    if (!types.length) throw new Error('At least one Access Point Type is required (e.g. PHARMACY).')

    return await this.#apiRequest({
      url: `${ this.#hostFor() }/shipping/v2/accessPoints`,
      extraHeaders: this.#shippingHeaders(),
      query: { accessPointTypes: types, countryCode, postalCode },
      logTag: 'getAccessPoints',
    })
  }

  // ==========================================================================
  //  TRIGGERS (polling) - getOrders cursor is the delta source
  // ==========================================================================
  /**
   * @registerAs POLLING_TRIGGER
   * @operationName On New Order
   * @category Triggers
   * @description Fires when a new or updated order arrives in the selected marketplace. Optionally filter by order status. Polling interval can be customized (minimum 30 seconds).
   * @route POST /on-new-order
   * @paramDef {"type":"String","label":"Marketplace","name":"marketplaceId","dictionary":"getMarketplacesDictionary","required":true,"description":"The marketplace to watch for new orders."}
   * @paramDef {"type":"Array<String>","label":"Order Statuses (filter)","name":"orderStatuses","uiComponent":{"type":"DROPDOWN","options":{"values":["Pending Availability","Pending","Unshipped","Partially Shipped","Shipped","Invoice Unconfirmed","Canceled","Unfulfillable"]}},"description":"Optionally only fire for these statuses. Leave empty for all."}
   * @returns {Object}
   * @sampleResult {"AmazonOrderId":"902-1845936-5435065","OrderStatus":"Unshipped","PurchaseDate":"2024-03-10T18:00:00Z","OrderTotal":{"CurrencyCode":"USD","Amount":"49.99"},"FulfillmentChannel":"MFN","MarketplaceId":"ATVPDKIKX0DER"}
   */
  async onNewOrder(invocation) {
    // docs: https://developer-docs.amazon.com/sp-api/reference/getorders
    const triggerData = invocation.triggerData || {}
    const marketplaceId = triggerData.marketplaceId
    const statusFilter = new Set(this.#resolveChoices(triggerData.orderStatuses, ORDER_STATUS_MAP))
    const state = invocation.state || {}

    // First run: look back a bounded window so the first poll is not unbounded.
    const lastUpdatedAfter = state.cursor || new Date(Date.now() - FIRST_POLL_LOOKBACK_MS).toISOString()
    const seen = new Set(state.lastSeen || [])

    const collected = []
    let nextToken = null
    let pages = 0
    let maxLastUpdate = state.cursor || null

    // Paginate the window to NextToken EXHAUSTION (within MAX_PAGES). `truncated` is true only if
    // a NextToken still remained after the cap - meaning we did NOT drain every order in the window.
    do {
      const result = await this.#apiRequest({
        url: `${ this.#hostFor(marketplaceId) }/orders/v0/orders`,
        query: {
          MarketplaceIds: [marketplaceId],
          LastUpdatedAfter: lastUpdatedAfter,
          OrderStatuses: statusFilter.size ? [...statusFilter] : undefined,
          NextToken: nextToken,
        },
        logTag: 'onNewOrder',
      })

      const orders = (result && result.payload && result.payload.Orders) || []

      for (const order of orders) {
        if (order.LastUpdateDate && (!maxLastUpdate || order.LastUpdateDate > maxLastUpdate)) {
          maxLastUpdate = order.LastUpdateDate
        }

        collected.push(order)
      }

      nextToken = (result && result.payload && result.payload.NextToken) || null
      pages += 1
    } while (nextToken && pages < MAX_PAGES)

    const truncated = Boolean(nextToken)

    // Dedupe by AmazonOrderId against state.lastSeen.
    const fresh = collected.filter(order => order.AmazonOrderId && !seen.has(order.AmazonOrderId))
    const events = state.cursor ? fresh : []

    const collectedIds = collected.map(order => order.AmazonOrderId).filter(Boolean)

    // Advance the watermark only to a fully-consumed point. When the window was drained
    // (truncated === false) the contract advances the cursor to max(LastUpdateDate) seen.
    // When MAX_PAGES truncated the window (a NextToken still pending), SP-API does NOT guarantee
    // ascending order, so the only safe watermark is the START of this window - keep the cursor
    // there so the next poll re-fetches the whole window and the un-paged orders are never lost.
    // Carry forward the prior lastSeen alongside this cycle's ids so the re-fetch dedupes cleanly
    // (no re-emitted events for orders already delivered).
    const cursor = truncated
      ? lastUpdatedAfter
      : (maxLastUpdate || lastUpdatedAfter)

    const lastSeen = truncated
      ? [...new Set([...seen, ...collectedIds])]
      : collectedIds

    return {
      events,
      state: { cursor, lastSeen },
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }
}

Flowrunner.ServerCode.addService(AmazonSellerCentral, [
  {
    name: 'lwaClientId',
    displayName: 'LWA Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Login with Amazon (LWA) Client ID from your SP-API app in the Amazon Developer Console.',
  },
  {
    name: 'lwaClientSecret',
    displayName: 'LWA Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Login with Amazon (LWA) Client Secret from your SP-API app in the Amazon Developer Console.',
  },
  {
    name: 'applicationId',
    displayName: 'Application ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'The SP-API application id used to build the seller authorization URL.',
  },
  {
    name: 'region',
    displayName: 'Region',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    required: false,
    shared: false,
    options: ['NA', 'EU', 'FE'],
    defaultValue: 'NA',
    hint: 'Default API region (NA, EU or FE), used when the host cannot be derived from the chosen marketplace.',
  },
  {
    name: 'shippingBusinessRegion',
    displayName: 'Amazon Shipping Region',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    required: false,
    shared: false,
    options: ['AmazonShipping_US', 'AmazonShipping_IN', 'AmazonShipping_UK', 'AmazonShipping_IT', 'AmazonShipping_ES', 'AmazonShipping_FR'],
    defaultValue: 'AmazonShipping_US',
    hint: 'The Amazon Shipping (v2) business region your seller account is enrolled in. Sent as the x-amzn-shipping-business-id header on Amazon Shipping operations.',
  },
])
