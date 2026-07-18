const logger = {
  info: (...args) => console.log('[Printful] info:', ...args),
  debug: (...args) => console.log('[Printful] debug:', ...args),
  error: (...args) => console.log('[Printful] error:', ...args),
  warn: (...args) => console.log('[Printful] warn:', ...args),
}

const API_BASE_URL = 'https://api.printful.com'

const DICTIONARY_PAGE_SIZE = 100

const ORDER_STATUS_MAP = {
  'Draft': 'draft',
  'Pending': 'pending',
  'Failed': 'failed',
  'Canceled': 'canceled',
  'In Process': 'inprocess',
  'On Hold': 'onhold',
  'Partial': 'partial',
  'Fulfilled': 'fulfilled',
}

const WEBHOOK_TYPE_MAP = {
  'Package Shipped': 'package_shipped',
  'Package Returned': 'package_returned',
  'Order Failed': 'order_failed',
  'Order Canceled': 'order_canceled',
  'Product Synced': 'product_synced',
  'Stock Updated': 'stock_updated',
}

function clean(obj) {
  if (!obj) {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * @integrationName Printful
 * @integrationIcon /icon.png
 */
class PrintfulService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.storeId = config.storeId
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const headers = {
        'Authorization': `Bearer ${ this.apiKey }`,
        'Content-Type': 'application/json',
      }

      if (this.storeId) {
        headers['X-PF-Store-Id'] = String(this.storeId)
      }

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(headers)
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error?.message ||
        (typeof error.body?.result === 'string' ? error.body.result : undefined) ||
        error.message

      logger.error(`${ logTag } - request failed: ${ message }`)

      throw new Error(`Printful API error: ${ message }`)
    }
  }

  #unwrapList(response) {
    const items = response?.result || []

    return { items, total: response?.paging?.total ?? items.length }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ---------------------------------------------------------------------------
  // Stores
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Stores
   * @category Stores
   * @description Lists all Printful stores the API token can access. Account-level tokens may see multiple stores; store-level tokens see one. Use a store's id as the Store ID configuration value (sent as the X-PF-Store-Id header) when the token covers more than one store. Returns items with total count and supports offset/limit pagination.
   * @route GET /stores
   *
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of stores to skip before collecting the result set. Default 0."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of stores to return. Default 20, maximum 100."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":10,"name":"My Print Store","type":"native","website":"https://example.com","currency":"USD","created":1602846658}],"total":1}
   */
  async listStores(offset, limit) {
    const logTag = '[listStores]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/stores`,
      method: 'get',
      query: { offset, limit },
    })

    return this.#unwrapList(response)
  }

  /**
   * @operationName Get Store Info
   * @category Stores
   * @description Returns basic information about the current store: id, name, type (native, shopify, etsy, woocommerce, etc.), website, currency and creation time. The current store is determined by the API token, or by the Store ID configuration value for account-level tokens with multiple stores.
   * @route GET /store
   *
   * @returns {Object}
   * @sampleResult {"id":10,"name":"My Print Store","type":"native","website":"https://example.com","currency":"USD","created":1602846658}
   */
  async getStoreInfo() {
    const logTag = '[getStoreInfo]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/store`,
      method: 'get',
    })

    return response.result
  }

  // ---------------------------------------------------------------------------
  // Catalog
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Catalog Products
   * @category Catalog
   * @description Lists blank products from the Printful catalog (t-shirts, mugs, posters, etc.) that can be used to build store products. Each product includes its type, brand, model, image and variant count. Optionally filter by catalog category id (see List Categories). Use Get Catalog Product to load the variants of a product.
   * @route GET /catalog/products
   *
   * @paramDef {"type":"Number","label":"Category ID","name":"categoryId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional catalog category id to filter products by. Get category ids from List Categories."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of products to skip before collecting the result set. Default 0."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of products to return. Default 20, maximum 100."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":71,"main_category_id":24,"type":"T-SHIRT","type_name":"T-Shirt","brand":"Bella + Canvas","model":"3001 Unisex Short Sleeve Jersey T-Shirt","image":"https://files.cdn.printful.com/products/71/product_1581412541.jpg","variant_count":289,"currency":"USD","is_discontinued":false}],"total":1}
   */
  async listCatalogProducts(categoryId, offset, limit) {
    const logTag = '[listCatalogProducts]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/products`,
      method: 'get',
      query: { category_id: categoryId, offset, limit },
    })

    return this.#unwrapList(response)
  }

  /**
   * @operationName Get Catalog Product
   * @category Catalog
   * @description Returns a single blank product from the Printful catalog together with the full list of its variants (size/color combinations). Each variant's id is the catalog variant id required when creating sync products or ordering catalog items directly.
   * @route GET /catalog/products/{productId}
   *
   * @paramDef {"type":"Number","label":"Catalog Product ID","name":"productId","required":true,"dictionary":"getCatalogProductsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Id of the catalog product. Select one or get ids from List Catalog Products."}
   *
   * @returns {Object}
   * @sampleResult {"product":{"id":71,"type":"T-SHIRT","type_name":"T-Shirt","brand":"Bella + Canvas","model":"3001 Unisex Short Sleeve Jersey T-Shirt","variant_count":289,"currency":"USD"},"variants":[{"id":4012,"product_id":71,"name":"Bella + Canvas 3001 (White / M)","size":"M","color":"White","color_code":"#ffffff","price":"9.25","in_stock":true}]}
   */
  async getCatalogProduct(productId) {
    const logTag = '[getCatalogProduct]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/products/${ encodeURIComponent(productId) }`,
      method: 'get',
    })

    return response.result
  }

  /**
   * @operationName Get Catalog Variant
   * @category Catalog
   * @description Returns a single catalog variant (a specific size/color of a blank product) together with information about its parent product. Useful for checking price, stock availability and attributes of the exact variant referenced by variant_id in sync products and orders.
   * @route GET /catalog/variants/{variantId}
   *
   * @paramDef {"type":"Number","label":"Catalog Variant ID","name":"variantId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Id of the catalog variant. Get variant ids from Get Catalog Product."}
   *
   * @returns {Object}
   * @sampleResult {"product":{"id":71,"type_name":"T-Shirt","brand":"Bella + Canvas","model":"3001 Unisex Short Sleeve Jersey T-Shirt"},"variant":{"id":4012,"product_id":71,"name":"Bella + Canvas 3001 (White / M)","size":"M","color":"White","color_code":"#ffffff","price":"9.25","in_stock":true}}
   */
  async getCatalogVariant(variantId) {
    const logTag = '[getCatalogVariant]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/products/variant/${ encodeURIComponent(variantId) }`,
      method: 'get',
    })

    return response.result
  }

  /**
   * @operationName List Categories
   * @category Catalog
   * @description Lists all categories of the Printful catalog (e.g. Men's clothing, Home & living). Use a category's id with List Catalog Products to browse blank products by category.
   * @route GET /catalog/categories
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":24,"parent_id":0,"image_url":"https://files.cdn.printful.com/upload/catalog_category/6a3/category.png","catalog_position":1,"size":"large","title":"Men's clothing"}],"total":1}
   */
  async listCategories() {
    const logTag = '[listCategories]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/categories`,
      method: 'get',
    })

    const categories = response.result?.categories || []

    return { items: categories, total: categories.length }
  }

  // ---------------------------------------------------------------------------
  // Sync Products
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Sync Products
   * @category Sync Products
   * @description Lists the products of your store (sync products) with their name, thumbnail and variant counts. Optionally filter by a search term matched against product names. Use Get Sync Product to load a product's variants. Supports offset/limit pagination.
   * @route GET /store/products
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search term to filter products by name."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of products to skip before collecting the result set. Default 0."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of products to return. Default 20, maximum 100."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":123456789,"external_id":"6a5cb9d5c22d4","name":"Summer Tee","variants":4,"synced":4,"thumbnail_url":"https://files.cdn.printful.com/files/6a3/thumbnail.png","is_ignored":false}],"total":1}
   */
  async listSyncProducts(search, offset, limit) {
    const logTag = '[listSyncProducts]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/store/products`,
      method: 'get',
      query: { search, offset, limit },
    })

    return this.#unwrapList(response)
  }

  /**
   * @operationName Get Sync Product
   * @category Sync Products
   * @description Returns a single store product (sync_product) together with all of its variants (sync_variants), including retail prices, mapped catalog variant ids, SKUs and attached print files. Accepts the numeric Printful product id or the external id prefixed with @ (e.g. @my-external-id).
   * @route GET /store/products/{productId}
   *
   * @paramDef {"type":"String","label":"Sync Product ID","name":"productId","required":true,"dictionary":"getSyncProductsDictionary","description":"Printful sync product id, or the external id prefixed with @ (e.g. @6a5cb9d5c22d4)."}
   *
   * @returns {Object}
   * @sampleResult {"sync_product":{"id":123456789,"external_id":"6a5cb9d5c22d4","name":"Summer Tee","variants":1,"synced":1,"thumbnail_url":"https://files.cdn.printful.com/files/6a3/thumbnail.png"},"sync_variants":[{"id":987654321,"external_id":"6a5cb9d5c22d8","sync_product_id":123456789,"name":"Summer Tee - M","synced":true,"variant_id":4012,"retail_price":"24.00","currency":"USD","sku":"TEE-M","files":[{"id":555,"type":"default","preview_url":"https://files.cdn.printful.com/files/6a3/preview.png","status":"ok"}]}]}
   */
  async getSyncProduct(productId) {
    const logTag = '[getSyncProduct]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/store/products/${ encodeURIComponent(productId) }`,
      method: 'get',
    })

    return response.result
  }

  /**
   * @operationName Create Sync Product
   * @category Sync Products
   * @description Creates a new product in your store with one or more variants. Each variant maps a Printful catalog variant (variant_id from Get Catalog Product / Get Catalog Variant) to a retail price and the print file(s) to produce it with. Printful generates mockups asynchronously after creation.
   * @route POST /store/products
   *
   * @paramDef {"type":"String","label":"Product Name","name":"name","required":true,"description":"Display name of the product in your store."}
   * @paramDef {"type":"Array<SyncVariantInput>","label":"Sync Variants","name":"syncVariants","required":true,"description":"Variants to create. Each entry maps a catalog variant id (a specific size/color of a Printful blank product, found via Get Catalog Product) to a retail price and print files."}
   * @paramDef {"type":"String","label":"Thumbnail URL","name":"thumbnailUrl","description":"Publicly accessible URL of the product thumbnail image."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","description":"Optional product id from your own system. It can later be used to reference the product as @external-id."}
   *
   * @returns {Object}
   * @sampleResult {"id":123456789,"external_id":"6a5cb9d5c22d4","name":"Summer Tee","variants":1,"synced":1}
   */
  async createSyncProduct(name, syncVariants, thumbnailUrl, externalId) {
    const logTag = '[createSyncProduct]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/store/products`,
      method: 'post',
      body: {
        sync_product: clean({ name, thumbnail: thumbnailUrl, external_id: externalId }),
        sync_variants: syncVariants,
      },
    })

    return response.result
  }

  /**
   * @operationName Update Sync Product
   * @category Sync Products
   * @description Updates an existing store product. IMPORTANT: when Sync Variants are provided they fully REPLACE the existing variant list - variants missing from the request are deleted, variants with an id are updated, and variants without an id are created. Omit Sync Variants to update only the product name/thumbnail. Accepts the numeric product id or @external-id.
   * @route PUT /store/products/{productId}
   *
   * @paramDef {"type":"String","label":"Sync Product ID","name":"productId","required":true,"dictionary":"getSyncProductsDictionary","description":"Printful sync product id, or the external id prefixed with @ (e.g. @6a5cb9d5c22d4)."}
   * @paramDef {"type":"String","label":"Product Name","name":"name","description":"New display name of the product."}
   * @paramDef {"type":"String","label":"Thumbnail URL","name":"thumbnailUrl","description":"Publicly accessible URL of the new product thumbnail image."}
   * @paramDef {"type":"Array<SyncVariantInput>","label":"Sync Variants","name":"syncVariants","description":"Full replacement list of variants. Existing variants not present here are DELETED. Leave empty to keep the current variants unchanged."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","description":"New external product id from your own system."}
   *
   * @returns {Object}
   * @sampleResult {"id":123456789,"external_id":"6a5cb9d5c22d4","name":"Summer Tee (Updated)","variants":2,"synced":2}
   */
  async updateSyncProduct(productId, name, thumbnailUrl, syncVariants, externalId) {
    const logTag = '[updateSyncProduct]'

    const body = {
      sync_product: clean({ name, thumbnail: thumbnailUrl, external_id: externalId }),
    }

    if (syncVariants && syncVariants.length) {
      body.sync_variants = syncVariants
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/store/products/${ encodeURIComponent(productId) }`,
      method: 'put',
      body,
    })

    return response.result
  }

  /**
   * @operationName Delete Sync Product
   * @category Sync Products
   * @description Deletes a store product and all of its variants from Printful. This does not remove the product from an external e-commerce platform - it only removes the Printful side of the sync. Accepts the numeric product id or @external-id. This action cannot be undone.
   * @route DELETE /store/products/{productId}
   *
   * @paramDef {"type":"String","label":"Sync Product ID","name":"productId","required":true,"dictionary":"getSyncProductsDictionary","description":"Printful sync product id, or the external id prefixed with @ (e.g. @6a5cb9d5c22d4)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteSyncProduct(productId) {
    const logTag = '[deleteSyncProduct]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/store/products/${ encodeURIComponent(productId) }`,
      method: 'delete',
    })

    return { success: true }
  }

  /**
   * @operationName Get Sync Variant
   * @category Sync Products
   * @description Returns a single store product variant (sync variant) with its retail price, SKU, mapped catalog variant id and attached print files. Accepts the numeric sync variant id or the external id prefixed with @.
   * @route GET /store/variants/{syncVariantId}
   *
   * @paramDef {"type":"String","label":"Sync Variant ID","name":"syncVariantId","required":true,"description":"Printful sync variant id, or the external id prefixed with @ (e.g. @6a5cb9d5c22d8). Get ids from Get Sync Product."}
   *
   * @returns {Object}
   * @sampleResult {"id":987654321,"external_id":"6a5cb9d5c22d8","sync_product_id":123456789,"name":"Summer Tee - M","synced":true,"variant_id":4012,"retail_price":"24.00","currency":"USD","sku":"TEE-M","files":[{"id":555,"type":"default","preview_url":"https://files.cdn.printful.com/files/6a3/preview.png","status":"ok"}],"product":{"variant_id":4012,"product_id":71,"name":"Bella + Canvas 3001 (White / M)"}}
   */
  async getSyncVariant(syncVariantId) {
    const logTag = '[getSyncVariant]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/store/variants/${ encodeURIComponent(syncVariantId) }`,
      method: 'get',
    })

    return response.result
  }

  /**
   * @operationName Update Sync Variant
   * @category Sync Products
   * @description Updates a single store product variant: retail price, SKU, the mapped catalog variant or its print files. Providing Print Files replaces the variant's existing file list. Accepts the numeric sync variant id or @external-id.
   * @route PUT /store/variants/{syncVariantId}
   *
   * @paramDef {"type":"String","label":"Sync Variant ID","name":"syncVariantId","required":true,"description":"Printful sync variant id, or the external id prefixed with @ (e.g. @6a5cb9d5c22d8). Get ids from Get Sync Product."}
   * @paramDef {"type":"String","label":"Retail Price","name":"retailPrice","description":"New retail price as a decimal string in the store currency, e.g. 24.00."}
   * @paramDef {"type":"Array<PrintFileInput>","label":"Print Files","name":"files","description":"Replacement list of print files for this variant. Leave empty to keep the current files."}
   * @paramDef {"type":"Number","label":"Catalog Variant ID","name":"catalogVariantId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New catalog variant id (size/color of the Printful blank product) to map this sync variant to."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","description":"New SKU of this variant."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","description":"New external variant id from your own system."}
   *
   * @returns {Object}
   * @sampleResult {"id":987654321,"external_id":"6a5cb9d5c22d8","sync_product_id":123456789,"name":"Summer Tee - M","synced":true,"variant_id":4012,"retail_price":"26.00","currency":"USD","sku":"TEE-M"}
   */
  async updateSyncVariant(syncVariantId, retailPrice, files, catalogVariantId, sku, externalId) {
    const logTag = '[updateSyncVariant]'

    const body = clean({
      retail_price: retailPrice,
      variant_id: catalogVariantId,
      sku,
      external_id: externalId,
    })

    if (files && files.length) {
      body.files = files
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/store/variants/${ encodeURIComponent(syncVariantId) }`,
      method: 'put',
      body,
    })

    return response.result
  }

  /**
   * @operationName Delete Sync Variant
   * @category Sync Products
   * @description Deletes a single variant from a store product. Accepts the numeric sync variant id or the external id prefixed with @. This action cannot be undone.
   * @route DELETE /store/variants/{syncVariantId}
   *
   * @paramDef {"type":"String","label":"Sync Variant ID","name":"syncVariantId","required":true,"description":"Printful sync variant id, or the external id prefixed with @ (e.g. @6a5cb9d5c22d8)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteSyncVariant(syncVariantId) {
    const logTag = '[deleteSyncVariant]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/store/variants/${ encodeURIComponent(syncVariantId) }`,
      method: 'delete',
    })

    return { success: true }
  }

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Orders
   * @category Orders
   * @description Lists orders of the store, optionally filtered by fulfillment status. Each order includes the recipient, items, costs and current status (draft, pending, inprocess, fulfilled, etc.). Supports offset/limit pagination.
   * @route GET /orders
   *
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Pending","Failed","Canceled","In Process","On Hold","Partial","Fulfilled"]}},"description":"Optional fulfillment status to filter orders by. Leave empty to return orders of any status."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of orders to skip before collecting the result set. Default 0."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of orders to return. Default 20, maximum 100."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":13,"external_id":"4235234213","status":"draft","shipping":"STANDARD","created":1602846658,"recipient":{"name":"John Smith","city":"Chicago","state_code":"IL","country_code":"US","zip":"60618"},"items":[{"id":1,"sync_variant_id":987654321,"quantity":1,"name":"Summer Tee - M","retail_price":"24.00"}],"costs":{"currency":"USD","subtotal":"9.25","shipping":"3.99","tax":"0.00","total":"13.24"}}],"total":1}
   */
  async listOrders(status, offset, limit) {
    const logTag = '[listOrders]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/orders`,
      method: 'get',
      query: {
        status: this.#resolveChoice(status, ORDER_STATUS_MAP),
        offset,
        limit,
      },
    })

    return this.#unwrapList(response)
  }

  /**
   * @operationName Get Order
   * @category Orders
   * @description Returns a single order with full details: recipient address, items, print files, costs, shipments and current fulfillment status. Accepts the numeric Printful order id or the external order id prefixed with @ (e.g. @my-order-1).
   * @route GET /orders/{orderId}
   *
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"Printful order id, or the external order id prefixed with @ (e.g. @4235234213)."}
   *
   * @returns {Object}
   * @sampleResult {"id":13,"external_id":"4235234213","status":"pending","shipping":"STANDARD","shipping_service_name":"Flat Rate (3-4 business days after fulfillment)","created":1602846658,"recipient":{"name":"John Smith","address1":"19749 Dearborn St","city":"Chicago","state_code":"IL","country_code":"US","zip":"60618"},"items":[{"id":1,"sync_variant_id":987654321,"quantity":1,"name":"Summer Tee - M","retail_price":"24.00"}],"costs":{"currency":"USD","subtotal":"9.25","shipping":"3.99","tax":"0.00","total":"13.24"},"shipments":[]}
   */
  async getOrder(orderId) {
    const logTag = '[getOrder]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/orders/${ encodeURIComponent(orderId) }`,
      method: 'get',
    })

    return response.result
  }

  /**
   * @operationName Create Order
   * @category Orders
   * @description Creates a new order. By default the order is created as an editable DRAFT and is not fulfilled or billed; enable Confirm for Fulfillment to submit it immediately (sent as the confirm=true query parameter). Items can reference an existing store variant (sync_variant_id), an external variant (external_variant_id), or a raw catalog variant (variant_id plus print files).
   * @route POST /orders
   *
   * @paramDef {"type":"OrderRecipient","label":"Recipient","name":"recipient","required":true,"description":"Shipping recipient of the order (name and address)."}
   * @paramDef {"type":"Array<OrderItem>","label":"Items","name":"items","required":true,"description":"Order line items. Each item needs a quantity and exactly one variant reference: sync_variant_id (store variant), external_variant_id, or variant_id (catalog variant, requires print files)."}
   * @paramDef {"type":"Boolean","label":"Confirm for Fulfillment","name":"confirm","uiComponent":{"type":"TOGGLE"},"description":"Enable to immediately submit the order for fulfillment and billing. Leave disabled (default) to create an editable draft that can later be submitted with Confirm Order."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","description":"Optional order id from your own system. The order can later be referenced as @external-id."}
   * @paramDef {"type":"String","label":"Shipping Method","name":"shipping","description":"Shipping method id, e.g. STANDARD. Get available ids from Get Shipping Rates. Defaults to the cheapest available method."}
   * @paramDef {"type":"OrderRetailCosts","label":"Retail Costs","name":"retailCosts","description":"Optional retail costs shown on the packing slip and used for customs declarations instead of Printful's prices."}
   *
   * @returns {Object}
   * @sampleResult {"id":13,"external_id":"4235234213","status":"draft","shipping":"STANDARD","created":1602846658,"recipient":{"name":"John Smith","city":"Chicago","state_code":"IL","country_code":"US","zip":"60618"},"items":[{"id":1,"sync_variant_id":987654321,"quantity":1,"name":"Summer Tee - M","retail_price":"24.00"}],"costs":{"currency":"USD","subtotal":"9.25","shipping":"3.99","tax":"0.00","total":"13.24"}}
   */
  async createOrder(recipient, items, confirm, externalId, shipping, retailCosts) {
    const logTag = '[createOrder]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/orders`,
      method: 'post',
      query: { confirm: confirm ? 'true' : undefined },
      body: clean({
        recipient,
        items,
        external_id: externalId,
        shipping,
        retail_costs: retailCosts && Object.keys(clean(retailCosts)).length ? clean(retailCosts) : undefined,
      }),
    })

    return response.result
  }

  /**
   * @operationName Update Order
   * @category Orders
   * @description Updates an unsubmitted (draft or failed) order. Provided fields replace the corresponding order data - for example, a provided Items list replaces all existing items. Optionally submits the order for fulfillment in the same call via Confirm for Fulfillment. Accepts the numeric order id or @external-id. Orders already in fulfillment cannot be updated.
   * @route PUT /orders/{orderId}
   *
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"Printful order id, or the external order id prefixed with @ (e.g. @4235234213). The order must not be submitted for fulfillment yet."}
   * @paramDef {"type":"OrderRecipient","label":"Recipient","name":"recipient","description":"New shipping recipient of the order. Leave empty to keep the current recipient."}
   * @paramDef {"type":"Array<OrderItem>","label":"Items","name":"items","description":"Replacement list of order line items. Leave empty to keep the current items."}
   * @paramDef {"type":"Boolean","label":"Confirm for Fulfillment","name":"confirm","uiComponent":{"type":"TOGGLE"},"description":"Enable to submit the updated order for fulfillment and billing in the same call (sent as the confirm=true query parameter)."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","description":"New external order id from your own system."}
   * @paramDef {"type":"String","label":"Shipping Method","name":"shipping","description":"Shipping method id, e.g. STANDARD. Get available ids from Get Shipping Rates."}
   * @paramDef {"type":"OrderRetailCosts","label":"Retail Costs","name":"retailCosts","description":"Optional retail costs shown on the packing slip and used for customs declarations instead of Printful's prices."}
   *
   * @returns {Object}
   * @sampleResult {"id":13,"external_id":"4235234213","status":"draft","shipping":"STANDARD","created":1602846658,"recipient":{"name":"John Smith","city":"Chicago","state_code":"IL","country_code":"US","zip":"60618"},"items":[{"id":1,"sync_variant_id":987654321,"quantity":2,"name":"Summer Tee - M","retail_price":"24.00"}],"costs":{"currency":"USD","subtotal":"18.50","shipping":"3.99","tax":"0.00","total":"22.49"}}
   */
  async updateOrder(orderId, recipient, items, confirm, externalId, shipping, retailCosts) {
    const logTag = '[updateOrder]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/orders/${ encodeURIComponent(orderId) }`,
      method: 'put',
      query: { confirm: confirm ? 'true' : undefined },
      body: clean({
        recipient,
        items: items && items.length ? items : undefined,
        external_id: externalId,
        shipping,
        retail_costs: retailCosts && Object.keys(clean(retailCosts)).length ? clean(retailCosts) : undefined,
      }),
    })

    return response.result
  }

  /**
   * @operationName Confirm Order
   * @category Orders
   * @description Submits a draft or failed order for fulfillment. Billing happens at this point and the order status changes to pending. Accepts the numeric order id or the external order id prefixed with @.
   * @route POST /orders/{orderId}/confirm
   *
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"Printful order id, or the external order id prefixed with @ (e.g. @4235234213)."}
   *
   * @returns {Object}
   * @sampleResult {"id":13,"external_id":"4235234213","status":"pending","shipping":"STANDARD","created":1602846658,"recipient":{"name":"John Smith","city":"Chicago","state_code":"IL","country_code":"US","zip":"60618"},"costs":{"currency":"USD","subtotal":"9.25","shipping":"3.99","tax":"0.00","total":"13.24"}}
   */
  async confirmOrder(orderId) {
    const logTag = '[confirmOrder]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/orders/${ encodeURIComponent(orderId) }/confirm`,
      method: 'post',
      body: {},
    })

    return response.result
  }

  /**
   * @operationName Cancel Order
   * @category Orders
   * @description Cancels a pending order or deletes a draft order. If the order was already charged, the amount is returned to your Printful Wallet. Orders already being fulfilled cannot be canceled. Accepts the numeric order id or @external-id. Returns the canceled order.
   * @route DELETE /orders/{orderId}
   *
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"Printful order id, or the external order id prefixed with @ (e.g. @4235234213)."}
   *
   * @returns {Object}
   * @sampleResult {"id":13,"external_id":"4235234213","status":"canceled","shipping":"STANDARD","created":1602846658,"recipient":{"name":"John Smith","city":"Chicago","state_code":"IL","country_code":"US","zip":"60618"},"costs":{"currency":"USD","total":"13.24"}}
   */
  async cancelOrder(orderId) {
    const logTag = '[cancelOrder]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/orders/${ encodeURIComponent(orderId) }`,
      method: 'delete',
    })

    return response.result
  }

  /**
   * @operationName Estimate Order Costs
   * @category Orders
   * @description Calculates the estimated fulfillment costs of an order without creating it: product subtotal, discount, shipping, digitization, tax/VAT and total, plus retail costs when retail prices are set on the items. Useful for showing a price preview before placing the order.
   * @route POST /orders/estimate-costs
   *
   * @paramDef {"type":"OrderRecipient","label":"Recipient","name":"recipient","required":true,"description":"Shipping recipient the order would be sent to (address determines shipping and tax)."}
   * @paramDef {"type":"Array<OrderItem>","label":"Items","name":"items","required":true,"description":"Order line items to estimate. Each item needs a quantity and one variant reference: sync_variant_id, external_variant_id, or variant_id (catalog variant with print files)."}
   *
   * @returns {Object}
   * @sampleResult {"costs":{"currency":"USD","subtotal":9.25,"discount":0,"shipping":3.99,"digitization":0,"tax":0.61,"vat":0,"total":13.85},"retail_costs":{"currency":"USD","subtotal":24,"discount":0,"shipping":3.99,"tax":null,"vat":null,"total":null}}
   */
  async estimateOrderCosts(recipient, items) {
    const logTag = '[estimateOrderCosts]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/orders/estimate-costs`,
      method: 'post',
      body: { recipient, items },
    })

    return response.result
  }

  // ---------------------------------------------------------------------------
  // Shipping & Tax
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Shipping Rates
   * @category Shipping & Tax
   * @description Calculates available shipping options and rates for a destination address and a set of items. Returns each shipping method's id (usable as the Shipping Method of an order, e.g. STANDARD), display name, price and estimated delivery days. Items are referenced by catalog variant_id, external_variant_id or warehouse_product_variant_id.
   * @route POST /shipping/rates
   *
   * @paramDef {"type":"ShippingAddress","label":"Recipient Address","name":"recipient","required":true,"description":"Destination address. Country code is required; state code and ZIP are required for some countries (e.g. US, CA)."}
   * @paramDef {"type":"Array<ShippingRateItem>","label":"Items","name":"items","required":true,"description":"Items to quote shipping for. Each item needs a quantity and one variant reference: variant_id (catalog variant), external_variant_id, or warehouse_product_variant_id."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"Optional 3-letter currency code for the returned rates (e.g. USD, EUR). Defaults to the store currency."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"STANDARD","name":"Flat Rate (3-4 business days after fulfillment)","rate":"3.99","currency":"USD","minDeliveryDays":3,"maxDeliveryDays":5}]
   */
  async getShippingRates(recipient, items, currency) {
    const logTag = '[getShippingRates]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/shipping/rates`,
      method: 'post',
      body: clean({ recipient, items, currency }),
    })

    return response.result
  }

  /**
   * @operationName Get Tax Rate
   * @category Shipping & Tax
   * @description Calculates the sales tax rate for a destination address. Indicates whether Printful is required to collect tax for that destination, the tax rate to apply, and whether shipping is taxable. Printful currently calculates tax for destinations such as US and Canadian states.
   * @route POST /tax/rates
   *
   * @paramDef {"type":"String","label":"Country Code","name":"countryCode","required":true,"dictionary":"getCountriesDictionary","description":"Two-letter ISO country code of the destination, e.g. US."}
   * @paramDef {"type":"String","label":"State Code","name":"stateCode","required":true,"description":"State/province code of the destination, e.g. CA. Get codes from List Countries."}
   * @paramDef {"type":"String","label":"City","name":"city","required":true,"description":"Destination city name."}
   * @paramDef {"type":"String","label":"ZIP / Postal Code","name":"zip","description":"Destination ZIP or postal code. Required for precise US tax calculation."}
   *
   * @returns {Object}
   * @sampleResult {"required":true,"rate":0.0975,"shipping_taxable":true}
   */
  async getTaxRate(countryCode, stateCode, city, zip) {
    const logTag = '[getTaxRate]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tax/rates`,
      method: 'post',
      body: {
        recipient: clean({
          country_code: countryCode,
          state_code: stateCode,
          city,
          zip,
        }),
      },
    })

    return response.result
  }

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Files
   * @category Files
   * @description Lists files in the store's Printful file library (uploaded print files and previews) with their processing status, dimensions and thumbnails. Supports offset/limit pagination.
   * @route GET /files
   *
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of files to skip before collecting the result set. Default 0."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of files to return. Default 20, maximum 100."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":555,"type":"default","hash":"ea44330b887dfec278dbc4626a759547","filename":"shirt-design.png","mime_type":"image/png","size":1048576,"width":3000,"height":3000,"dpi":300,"status":"ok","created":1602846658,"thumbnail_url":"https://files.cdn.printful.com/files/6a3/thumbnail.png","preview_url":"https://files.cdn.printful.com/files/6a3/preview.png","visible":true}],"total":1}
   */
  async listFiles(offset, limit) {
    const logTag = '[listFiles]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/files`,
      method: 'get',
      query: { offset, limit },
    })

    return this.#unwrapList(response)
  }

  /**
   * @operationName Add File
   * @category Files
   * @description Registers a file in the store's Printful file library by URL. Printful downloads and processes the file asynchronously (status starts as waiting); the returned file id can then be referenced in sync variants and order items instead of repeating the URL. Use Get File to check processing status.
   * @route POST /files
   *
   * @paramDef {"type":"String","label":"File URL","name":"url","required":true,"description":"Publicly accessible URL of the file to add. For print files prefer high-resolution PNG (300 DPI)."}
   * @paramDef {"type":"String","label":"File Type","name":"type","description":"Role of the file, e.g. default (front print), back, label_outside, embroidery_chest_left. Defaults to default."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Optional filename to store the file under. Defaults to the filename from the URL."}
   *
   * @returns {Object}
   * @sampleResult {"id":555,"type":"default","hash":null,"url":"https://example.com/files/shirt-design.png","filename":"shirt-design.png","mime_type":null,"size":0,"status":"waiting","created":1602846658,"visible":true}
   */
  async addFile(url, type, filename) {
    const logTag = '[addFile]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/files`,
      method: 'post',
      body: clean({ url, type, filename }),
    })

    return response.result
  }

  /**
   * @operationName Get File
   * @category Files
   * @description Returns information about a file in the store's Printful file library, including its processing status (waiting, ok, failed), dimensions, DPI, thumbnail and preview URLs.
   * @route GET /files/{fileId}
   *
   * @paramDef {"type":"Number","label":"File ID","name":"fileId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Printful file id, as returned by Add File or List Files."}
   *
   * @returns {Object}
   * @sampleResult {"id":555,"type":"default","hash":"ea44330b887dfec278dbc4626a759547","filename":"shirt-design.png","mime_type":"image/png","size":1048576,"width":3000,"height":3000,"dpi":300,"status":"ok","created":1602846658,"thumbnail_url":"https://files.cdn.printful.com/files/6a3/thumbnail.png","preview_url":"https://files.cdn.printful.com/files/6a3/preview.png","visible":true}
   */
  async getFile(fileId) {
    const logTag = '[getFile]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(fileId) }`,
      method: 'get',
    })

    return response.result
  }

  // ---------------------------------------------------------------------------
  // Countries
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Countries
   * @category Countries
   * @description Lists all countries Printful ships to, with their two-letter ISO codes and, where applicable, their states/provinces with codes. Use these codes for recipient country_code and state_code values in orders, shipping rate and tax rate calculations.
   * @route GET /countries
   *
   * @returns {Object}
   * @sampleResult {"items":[{"code":"US","name":"United States","states":[{"code":"CA","name":"California"},{"code":"IL","name":"Illinois"}]}],"total":1}
   */
  async listCountries() {
    const logTag = '[listCountries]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/countries`,
      method: 'get',
    })

    const countries = response.result || []

    return { items: countries, total: countries.length }
  }

  // ---------------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Webhook Config
   * @category Webhooks
   * @description Returns the current webhook configuration of the store: the callback URL and the list of event types Printful sends to it. An empty URL means webhooks are disabled.
   * @route GET /webhooks
   *
   * @returns {Object}
   * @sampleResult {"url":"https://example.com/printful-webhook","types":["package_shipped","order_failed"],"params":{}}
   */
  async getWebhookConfig() {
    const logTag = '[getWebhookConfig]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/webhooks`,
      method: 'get',
    })

    return response.result
  }

  /**
   * @operationName Set Webhook Config
   * @category Webhooks
   * @description Enables webhooks for the store by setting a callback URL and the event types to be notified about. This replaces any previously configured URL and event types. Printful sends a POST request to the URL each time one of the selected events occurs.
   * @route POST /webhooks
   *
   * @paramDef {"type":"String","label":"Webhook URL","name":"url","required":true,"description":"Publicly accessible HTTPS URL that Printful will POST event payloads to."}
   * @paramDef {"type":"Array<String>","label":"Event Types","name":"types","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Package Shipped","Package Returned","Order Failed","Order Canceled","Product Synced","Stock Updated"],"multiple":true}},"description":"Event types to subscribe to. At least one is required."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://example.com/printful-webhook","types":["package_shipped","order_failed"],"params":{}}
   */
  async setWebhookConfig(url, types) {
    const logTag = '[setWebhookConfig]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/webhooks`,
      method: 'post',
      body: {
        url,
        types: (types || []).map(type => this.#resolveChoice(type, WEBHOOK_TYPE_MAP)),
      },
    })

    return response.result
  }

  /**
   * @operationName Disable Webhooks
   * @category Webhooks
   * @description Disables webhook notifications for the store by removing the configured callback URL and all subscribed event types. Returns the cleared webhook configuration.
   * @route DELETE /webhooks
   *
   * @returns {Object}
   * @sampleResult {"url":null,"types":[]}
   */
  async disableWebhooks() {
    const logTag = '[disableWebhooks]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/webhooks`,
      method: 'delete',
    })

    return response.result
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getStoresDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search string to filter stores by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset of the next page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Stores Dictionary
   * @description Provides a selectable list of Printful stores accessible to the API token. The option value is the store id, usable as the Store ID configuration value or for reference.
   * @route POST /get-stores-dictionary
   * @paramDef {"type":"getStoresDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My Print Store","value":"10","note":"native - USD"}],"cursor":null}
   */
  async getStoresDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getStoresDictionary]'

    const offset = cursor ? parseInt(cursor, 10) || 0 : 0

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/stores`,
      method: 'get',
      query: { offset, limit: DICTIONARY_PAGE_SIZE },
    })

    const stores = response.result || []
    const total = response.paging?.total ?? stores.length
    const nextOffset = offset + stores.length

    const searchLower = (search || '').toLowerCase()
    const filtered = searchLower
      ? stores.filter(store => (store.name || '').toLowerCase().includes(searchLower))
      : stores

    return {
      items: filtered.map(store => ({
        label: store.name || `Store ${ store.id }`,
        value: String(store.id),
        note: [store.type, store.currency].filter(Boolean).join(' - ') || undefined,
      })),
      cursor: nextOffset < total ? String(nextOffset) : null,
    }
  }

  /**
   * @typedef {Object} getSyncProductsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search string to filter store products by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset of the next page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sync Products Dictionary
   * @description Provides a searchable list of the store's products (sync products) for selection in product operations. The option value is the sync product id.
   * @route POST /get-sync-products-dictionary
   * @paramDef {"type":"getSyncProductsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Summer Tee","value":"123456789","note":"4 variants, 4 synced"}],"cursor":null}
   */
  async getSyncProductsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getSyncProductsDictionary]'

    const offset = cursor ? parseInt(cursor, 10) || 0 : 0

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/store/products`,
      method: 'get',
      query: { search, offset, limit: DICTIONARY_PAGE_SIZE },
    })

    const products = response.result || []
    const total = response.paging?.total ?? products.length
    const nextOffset = offset + products.length

    return {
      items: products.map(product => ({
        label: product.name || `Product ${ product.id }`,
        value: String(product.id),
        note: `${ product.variants ?? 0 } variants, ${ product.synced ?? 0 } synced`,
      })),
      cursor: nextOffset < total ? String(nextOffset) : null,
    }
  }

  /**
   * @typedef {Object} getCatalogProductsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search string to filter catalog products by brand, model or product type."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The catalog is filtered in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Catalog Products Dictionary
   * @description Provides a searchable list of blank products from the Printful catalog. The search string is matched against brand, model and product type. The option value is the catalog product id.
   * @route POST /get-catalog-products-dictionary
   * @paramDef {"type":"getCatalogProductsDictionary__payload","label":"Payload","name":"payload","description":"Search input used to filter the Printful catalog."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Bella + Canvas 3001 Unisex Short Sleeve Jersey T-Shirt","value":"71","note":"T-Shirt - 289 variants"}],"cursor":null}
   */
  async getCatalogProductsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getCatalogProductsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/products`,
      method: 'get',
    })

    const products = response.result || []
    const searchLower = (search || '').toLowerCase()

    const filtered = searchLower
      ? products.filter(product =>
        [product.brand, product.model, product.type_name]
          .filter(Boolean)
          .some(field => field.toLowerCase().includes(searchLower)))
      : products

    return {
      items: filtered.slice(0, DICTIONARY_PAGE_SIZE).map(product => ({
        label: [product.brand, product.model].filter(Boolean).join(' ') || `Product ${ product.id }`,
        value: String(product.id),
        note: [product.type_name, product.variant_count ? `${ product.variant_count } variants` : null]
          .filter(Boolean)
          .join(' - ') || undefined,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getCountriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search string to filter countries by name or ISO code."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Countries are returned in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Countries Dictionary
   * @description Provides a selectable list of countries Printful ships to. The option value is the two-letter ISO country code, usable as country_code in recipients, shipping rate and tax rate calculations.
   * @route POST /get-countries-dictionary
   * @paramDef {"type":"getCountriesDictionary__payload","label":"Payload","name":"payload","description":"Search input used to filter countries by name or code."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"United States (US)","value":"US","note":"57 states"}],"cursor":null}
   */
  async getCountriesDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getCountriesDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/countries`,
      method: 'get',
    })

    const countries = response.result || []
    const searchLower = (search || '').toLowerCase()

    const filtered = searchLower
      ? countries.filter(country =>
        (country.name || '').toLowerCase().includes(searchLower) ||
        (country.code || '').toLowerCase() === searchLower)
      : countries

    return {
      items: filtered.map(country => ({
        label: `${ country.name } (${ country.code })`,
        value: country.code,
        note: country.states?.length ? `${ country.states.length } states` : undefined,
      })),
      cursor: null,
    }
  }

  // ---------------------------------------------------------------------------
  // Typedefs
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} PrintFileInput
   * @paramDef {"type":"String","label":"File URL","name":"url","required":true,"description":"Publicly accessible URL of the print file. For best quality use high-resolution PNG (300 DPI)."}
   * @paramDef {"type":"String","label":"File Type","name":"type","description":"Print area placement of the file, e.g. default (front print), back, label_outside, sleeve_left, embroidery_chest_left. Defaults to default."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Optional filename to store the file under in the Printful file library."}
   */

  /**
   * @typedef {Object} SyncVariantInput
   * @paramDef {"type":"Number","label":"Catalog Variant ID","name":"variant_id","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Id of the Printful catalog variant (a specific size/color of a blank product). Find it via Get Catalog Product or Get Catalog Variant - it is NOT a sync variant id."}
   * @paramDef {"type":"String","label":"Retail Price","name":"retail_price","description":"Retail price as a decimal string in the store currency, e.g. 24.00. Shown on packing slips and used for retail cost calculations."}
   * @paramDef {"type":"Array<PrintFileInput>","label":"Print Files","name":"files","required":true,"description":"Print files used to produce this variant. At least one file (type default) is required."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","description":"Optional SKU of this variant in your store."}
   * @paramDef {"type":"String","label":"External ID","name":"external_id","description":"Optional variant id from your own system."}
   */

  /**
   * @typedef {Object} OrderRecipient
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Full name of the recipient."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"address1","required":true,"description":"Street address, first line."}
   * @paramDef {"type":"String","label":"City","name":"city","required":true,"description":"City name."}
   * @paramDef {"type":"String","label":"Country Code","name":"country_code","required":true,"dictionary":"getCountriesDictionary","description":"Two-letter ISO country code, e.g. US. See List Countries."}
   * @paramDef {"type":"String","label":"State Code","name":"state_code","description":"State/province code, e.g. CA. Required for US, Canada and some other countries."}
   * @paramDef {"type":"String","label":"ZIP / Postal Code","name":"zip","description":"ZIP or postal code. Required for most countries."}
   * @paramDef {"type":"String","label":"Address Line 2","name":"address2","description":"Street address, second line (apartment, suite, etc.)."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"Company name of the recipient."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Phone number of the recipient. Required by some carriers."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address of the recipient. Used for shipping notifications and customs."}
   */

  /**
   * @typedef {Object} OrderItem
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of units to order."}
   * @paramDef {"type":"Number","label":"Sync Variant ID","name":"sync_variant_id","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Id of an existing store product variant (from Get Sync Product). Use this OR external_variant_id OR variant_id."}
   * @paramDef {"type":"String","label":"External Variant ID","name":"external_variant_id","description":"External id of an existing store product variant from your e-commerce platform. Use this OR sync_variant_id OR variant_id."}
   * @paramDef {"type":"Number","label":"Catalog Variant ID","name":"variant_id","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Id of a raw Printful catalog variant (from Get Catalog Product). When used, Print Files are required so Printful knows what to print."}
   * @paramDef {"type":"Array<PrintFileInput>","label":"Print Files","name":"files","description":"Print files for this item. Required when ordering by catalog variant_id; ignored for sync variants (their stored files are used)."}
   * @paramDef {"type":"String","label":"Retail Price","name":"retail_price","description":"Retail price as a decimal string, e.g. 24.00. Shown on the packing slip and used for customs declarations."}
   * @paramDef {"type":"String","label":"Item Name","name":"name","description":"Display name of the item on the packing slip. Defaults to the product name."}
   */

  /**
   * @typedef {Object} OrderRetailCosts
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"Three-letter currency code of the retail costs, e.g. USD."}
   * @paramDef {"type":"String","label":"Discount","name":"discount","description":"Discount amount as a decimal string, e.g. 5.00."}
   * @paramDef {"type":"String","label":"Shipping","name":"shipping","description":"Retail shipping cost as a decimal string, e.g. 3.99."}
   * @paramDef {"type":"String","label":"Tax","name":"tax","description":"Retail tax amount as a decimal string, e.g. 1.25."}
   */

  /**
   * @typedef {Object} ShippingAddress
   * @paramDef {"type":"String","label":"Address Line 1","name":"address1","description":"Street address, first line."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"City name."}
   * @paramDef {"type":"String","label":"Country Code","name":"country_code","required":true,"dictionary":"getCountriesDictionary","description":"Two-letter ISO country code of the destination, e.g. US."}
   * @paramDef {"type":"String","label":"State Code","name":"state_code","description":"State/province code, e.g. CA. Required for US, Canada and some other countries."}
   * @paramDef {"type":"String","label":"ZIP / Postal Code","name":"zip","description":"ZIP or postal code of the destination. Required for precise rates in some countries."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Phone number of the recipient."}
   */

  /**
   * @typedef {Object} ShippingRateItem
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of units of this item."}
   * @paramDef {"type":"Number","label":"Catalog Variant ID","name":"variant_id","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Id of a Printful catalog variant (from Get Catalog Product). Use this OR external_variant_id OR warehouse_product_variant_id."}
   * @paramDef {"type":"String","label":"External Variant ID","name":"external_variant_id","description":"External id of an existing store product variant. Use this OR variant_id OR warehouse_product_variant_id."}
   * @paramDef {"type":"Number","label":"Warehouse Product Variant ID","name":"warehouse_product_variant_id","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Id of a warehoused product variant. Use this OR variant_id OR external_variant_id."}
   * @paramDef {"type":"String","label":"Declared Value","name":"value","description":"Declared retail value per item as a decimal string, used for customs estimation, e.g. 24.00."}
   */
}

Flowrunner.ServerCode.addService(PrintfulService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Printful private token, sent as a Bearer token. Create it in the Printful Dashboard under Settings -> API (or at developers.printful.com).',
  },
  {
    name: 'storeId',
    displayName: 'Store ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional. Needed when the token is account-level and covers multiple stores; sent as the X-PF-Store-Id header. Find store ids with List Stores.',
  },
])
