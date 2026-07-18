const logger = {
  info: (...args) => console.log('[PrestaShop] info:', ...args),
  debug: (...args) => console.log('[PrestaShop] debug:', ...args),
  error: (...args) => console.log('[PrestaShop] error:', ...args),
  warn: (...args) => console.log('[PrestaShop] warn:', ...args),
}

const DEFAULT_PAGE_SIZE = 50
const DICTIONARY_PAGE_SIZE = 50

// Multilanguage fields of the products resource. Values arrive from JSON as either a plain string
// (single-language shops / language-filtered reads) or an array of { id, value } objects.
const PRODUCT_MULTILANG_FIELDS = [
  'name', 'description', 'description_short', 'link_rewrite', 'meta_title', 'meta_description',
  'meta_keywords', 'available_now', 'available_later', 'delivery_in_stock', 'delivery_out_stock',
]

// Fields the PrestaShop webservice rejects (or manages itself) on product PUT. Verified against
// devdocs.prestashop-project.org products resource reference (writable column).
const PRODUCT_READ_ONLY_FIELDS = [
  'manufacturer_name', 'quantity', 'position_in_category', 'id_default_image',
  'id_default_combination', 'type', 'new', 'date_add', 'date_upd',
]

// Customer fields with no webservice setter (read-only) plus system timestamps. passwd is kept
// intentionally: PrestaShop's setWsPasswd only re-hashes the value when it differs from the stored
// hash, so echoing the fetched hash back on PUT leaves the password unchanged.
const CUSTOMER_READ_ONLY_FIELDS = [
  'last_passwd_gen', 'secure_key', 'reset_password_token', 'reset_password_validity',
  'date_add', 'date_upd',
]

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
 * @integrationName PrestaShop
 * @integrationIcon /icon.png
 */
class PrestaShopService {
  constructor(config) {
    this.storeUrl = String(config.storeUrl || '').trim().replace(/\/+$/, '')
    this.apiKey = config.apiKey
    this.languageId = String(config.languageId || '1').trim() || '1'
    this.apiBaseUrl = `${ this.storeUrl }/api`
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Single gateway for all webservice calls. Reads are returned as parsed JSON
   * (output_format=JSON is appended to every request); writes send a raw XML body.
   */
  async #apiRequest({ path, method = 'get', query, xmlBody, logTag }) {
    const url = `${ this.apiBaseUrl }${ path }`

    try {
      const cleanedQuery = clean({ ...query, output_format: 'JSON' })

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const headers = { Authorization: `Basic ${ Buffer.from(`${ this.apiKey }:`).toString('base64') }` }

      if (xmlBody !== undefined) {
        headers['Content-Type'] = 'text/xml'
      }

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(headers)
        .query(cleanedQuery)

      return xmlBody !== undefined ? await request.send(xmlBody) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      let message = this.#extractErrorMessage(error)

      if (status === 401) {
        message += ' Hint: verify the webservice key is correct and the webservice is enabled ' +
          '(Advanced Parameters -> Webservice in the PrestaShop back office).'
      } else if (status === 404) {
        message += ' Hint: PrestaShop returns 404 both for missing records and for resources the key ' +
          'cannot access - make sure the permission for this resource and HTTP method is ticked on ' +
          'your webservice key.'
      }

      logger.error(`${ logTag } - request failed (${ status || 'no status' }): ${ message }`)

      throw new Error(`PrestaShop API error: ${ message }`)
    }
  }

  #extractErrorMessage(error) {
    const body = error.body

    if (body) {
      if (typeof body === 'string') {
        const match = body.match(/<message>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/message>/)

        if (match && match[1].trim()) {
          return match[1].trim()
        }
      } else if (Array.isArray(body.errors) && body.errors.length) {
        const messages = body.errors.map(item => item && item.message).filter(Boolean)

        if (messages.length) {
          return messages.join('; ')
        }
      } else if (body.message) {
        return body.message
      }
    }

    return error.message || 'Unknown error'
  }

  #escapeXml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }

  #cdataSafe(value) {
    return String(value).split(']]>').join(']]]]><![CDATA[>')
  }

  /** Marks a value as multilanguage for the configured language id. */
  #ml(value) {
    return { __multilang: [{ id: this.languageId, value }] }
  }

  /**
   * Renders one field as XML. Arrays repeat the key per element, plain objects nest,
   * and the { __multilang: [{ id, value }] } marker renders <language> nodes with CDATA.
   */
  #fieldXml(key, value) {
    if (value === undefined || value === null) {
      return ''
    }

    if (Array.isArray(value)) {
      return value.map(item => this.#fieldXml(key, item)).join('')
    }

    if (typeof value === 'object') {
      if (value.__multilang) {
        const languages = value.__multilang
          .map(lang => `<language id="${ this.#escapeXml(lang.id) }"><![CDATA[${ this.#cdataSafe(lang.value ?? '') }]]></language>`)
          .join('')

        return `<${ key }>${ languages }</${ key }>`
      }

      const inner = Object.entries(value).map(([childKey, childValue]) => this.#fieldXml(childKey, childValue)).join('')

      return `<${ key }>${ inner }</${ key }>`
    }

    return `<${ key }>${ this.#escapeXml(value) }</${ key }>`
  }

  /** Builds the full XML document the PrestaShop webservice expects for POST/PUT bodies. */
  #buildXml(resource, fields) {
    const body = Object.entries(fields)
      .map(([key, value]) => this.#fieldXml(key, value))
      .join('')

    return '<?xml version="1.0" encoding="UTF-8"?>' +
      '<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">' +
      `<${ resource }>${ body }</${ resource }>` +
      '</prestashop>'
  }

  /**
   * Converts a resource fetched as JSON back into XML-ready fields for a full-replace PUT.
   * Skips read-only fields and associations; coerces known multilanguage fields into the
   * { __multilang } marker whether they arrived as strings or as [{ id, value }] arrays.
   */
  #jsonToXmlFields(resource, { readOnlyFields = [], multilangFields = [] } = {}) {
    const fields = {}

    for (const [key, value] of Object.entries(resource || {})) {
      if (key === 'associations' || readOnlyFields.includes(key)) {
        continue
      }

      if (multilangFields.includes(key)) {
        if (Array.isArray(value)) {
          fields[key] = { __multilang: value.map(lang => ({ id: lang.id, value: lang.value })) }
        } else if (value !== null && value !== undefined) {
          fields[key] = { __multilang: [{ id: this.languageId, value }] }
        }
      } else if (value !== null && typeof value === 'object') {
        continue
      } else {
        fields[key] = value
      }
    }

    return fields
  }

  /** Sets a multilanguage field value for the configured language, preserving other languages. */
  #setMultilang(fields, key, value) {
    const existing = fields[key] && fields[key].__multilang

    if (Array.isArray(existing)) {
      const entry = existing.find(lang => String(lang.id) === String(this.languageId))

      if (entry) {
        entry.value = value
      } else {
        existing.push({ id: this.languageId, value })
      }
    } else {
      fields[key] = this.#ml(value)
    }
  }

  #slugify(value) {
    return String(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #limitParam(limit, offset) {
    const count = limit || DEFAULT_PAGE_SIZE

    return offset ? `${ offset },${ count }` : String(count)
  }

  /** PrestaShop returns an empty ARRAY (instead of an object) when a list has no results. */
  #unwrapList(response, plural) {
    if (Array.isArray(response)) {
      return []
    }

    return (response && response[plural]) || []
  }

  /** Write responses normally come back as JSON ({ product: {...} }); falls back to XML id parsing. */
  #unwrapWriteResponse(response, singular) {
    if (response && typeof response === 'object') {
      return response[singular] || response
    }

    if (typeof response === 'string') {
      const match = response.match(/<id>(?:<!\[CDATA\[)?\s*(\d+)/)

      if (match) {
        return { id: Number(match[1]) }
      }
    }

    return { success: true }
  }

  /** Normalizes a user-supplied date (epoch millis, YYYY-MM-DD or full datetime) to PrestaShop format. */
  #toPsDate(value, endOfDay = false) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    const raw = String(value).trim()

    if (/^\d{10,}$/.test(raw)) {
      return new Date(Number(raw)).toISOString().slice(0, 19).replace('T', ' ')
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return `${ raw } ${ endOfDay ? '23:59:59' : '00:00:00' }`
    }

    return raw
  }

  #boolFlag(value, defaultValue) {
    if (value === undefined || value === null) {
      return defaultValue
    }

    return value === true || value === 'true' || value === 1 || value === '1' ? '1' : '0'
  }

  // ---------------------------------------------------------------------------
  // Products
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Products
   * @category Products
   * @description Lists products from the store catalog with full field data. Supports filtering by name (contains match), reference/SKU (exact match) and active status, plus pagination (limit/offset) and sorting. Multilanguage fields are returned in the configured language. Product stock lives in stock_availables - use the Stock operations to read or change quantities.
   * @route GET /products
   * @paramDef {"type":"String","label":"Name Contains","name":"nameFilter","description":"Filters products whose name contains this text (case-insensitive)."}
   * @paramDef {"type":"String","label":"Reference","name":"referenceFilter","description":"Filters by exact product reference (SKU)."}
   * @paramDef {"type":"String","label":"Active Status","name":"activeFilter","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Filters by active status. Leave empty to return both active and inactive products."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of products to return. Defaults to 50."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of products to skip, for pagination."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortField","uiComponent":{"type":"DROPDOWN","options":{"values":["ID","Name","Price","Reference","Date Added","Date Updated"]}},"description":"Field to sort results by. Defaults to ID."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDirection","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction. Defaults to Ascending."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"id_manufacturer":"1","id_category_default":"2","reference":"demo_1","type":"simple","state":"1","price":"23.900000","active":"1","name":"Hummingbird printed t-shirt","link_rewrite":"hummingbird-printed-t-shirt","description_short":"<p>100% cotton</p>","weight":"0.30","date_add":"2026-01-05 11:02:37","associations":{"categories":[{"id":"2"},{"id":"3"}],"stock_availables":[{"id":"1","id_product_attribute":"0"}]}}]
   */
  async listProducts(nameFilter, referenceFilter, activeFilter, limit, offset, sortField, sortDirection) {
    const logTag = '[listProducts]'

    const field = this.#resolveChoice(sortField, {
      'ID': 'id',
      'Name': 'name',
      'Price': 'price',
      'Reference': 'reference',
      'Date Added': 'date_add',
      'Date Updated': 'date_upd',
    }) || 'id'

    const direction = this.#resolveChoice(sortDirection, { 'Ascending': 'ASC', 'Descending': 'DESC' }) || 'ASC'
    const active = this.#resolveChoice(activeFilter, { 'Active': '1', 'Inactive': '0' })

    const response = await this.#apiRequest({
      logTag,
      path: '/products',
      query: {
        display: 'full',
        language: this.languageId,
        'filter[name]': nameFilter ? `%[${ nameFilter }]%` : undefined,
        'filter[reference]': referenceFilter ? `[${ referenceFilter }]` : undefined,
        'filter[active]': active !== undefined ? `[${ active }]` : undefined,
        limit: this.#limitParam(limit, offset),
        sort: `[${ field }_${ direction }]`,
        date: field === 'date_add' || field === 'date_upd' ? 1 : undefined,
      },
    })

    return this.#unwrapList(response, 'products')
  }

  /**
   * @operationName Get Product
   * @category Products
   * @description Retrieves a single product by its numeric id, including prices, SEO fields and associations (categories, images, combinations, stock_availables). Multilanguage fields are returned in the configured language. The stock_availables association contains the id needed by Update Stock Quantity.
   * @route GET /product
   * @paramDef {"type":"Number","label":"Product ID","name":"productId","required":true,"description":"Numeric id of the product to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":1,"id_manufacturer":"1","id_category_default":"2","reference":"demo_1","type":"simple","state":"1","price":"23.900000","active":"1","name":"Hummingbird printed t-shirt","link_rewrite":"hummingbird-printed-t-shirt","description":"<p>Regular fit t-shirt.</p>","description_short":"<p>100% cotton</p>","weight":"0.30","date_add":"2026-01-05 11:02:37","associations":{"categories":[{"id":"2"},{"id":"3"}],"stock_availables":[{"id":"1","id_product_attribute":"0"}]}}
   */
  async getProduct(productId) {
    const logTag = '[getProduct]'

    const response = await this.#apiRequest({
      logTag,
      path: `/products/${ productId }`,
      query: { language: this.languageId },
    })

    return (response && response.product) || response
  }

  /**
   * @operationName Create Product
   * @category Products
   * @description Creates a product in the catalog. Sends an XML body as required by the PrestaShop webservice; multilanguage fields (name, descriptions, URL slug) are written for the configured language. The URL slug (link_rewrite) is auto-generated from the name when not provided, and state is set to 1 (published). Stock quantity cannot be set here - after creation use Update Stock Quantity on the product's stock_available record.
   * @route POST /product
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Product name (written for the configured language)."}
   * @paramDef {"type":"String","label":"Price","name":"price","required":true,"description":"Tax-excluded price as a decimal string, e.g. 19.99."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Product reference / SKU."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Whether the product is visible in the shop. Defaults to true."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Full product description. HTML is allowed."}
   * @paramDef {"type":"String","label":"Short Description","name":"descriptionShort","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Short summary shown in listings. HTML is allowed."}
   * @paramDef {"type":"String","label":"Default Category","name":"defaultCategoryId","dictionary":"getCategoriesDictionary","description":"Category id used as the product's default category (id_category_default). Also added to the category associations."}
   * @paramDef {"type":"Array<String>","label":"Category IDs","name":"categoryIds","description":"Additional category ids to associate the product with."}
   * @paramDef {"type":"String","label":"Manufacturer","name":"manufacturerId","dictionary":"getManufacturersDictionary","description":"Manufacturer (brand) id to assign to the product."}
   * @paramDef {"type":"Number","label":"Weight","name":"weight","description":"Product weight in the store's weight unit, e.g. 0.5."}
   * @paramDef {"type":"String","label":"URL Slug","name":"linkRewrite","description":"SEO-friendly URL slug (link_rewrite). Auto-generated from the name when empty."}
   * @returns {Object}
   * @sampleResult {"id":22,"id_category_default":"2","reference":"TSHIRT-RED-M","type":"simple","state":"1","price":"19.990000","active":"1","name":"Red T-Shirt","link_rewrite":"red-t-shirt","weight":"0.30","date_add":"2026-03-01 10:15:00"}
   */
  async createProduct(name, price, reference, active, description, descriptionShort, defaultCategoryId, categoryIds, manufacturerId, weight, linkRewrite) {
    const logTag = '[createProduct]'

    const fields = clean({
      name: this.#ml(name),
      link_rewrite: this.#ml(linkRewrite || this.#slugify(name)),
      price: String(price),
      reference,
      active: this.#boolFlag(active, '1'),
      state: '1',
      id_category_default: defaultCategoryId,
      id_manufacturer: manufacturerId,
      weight,
      description: description ? this.#ml(description) : undefined,
      description_short: descriptionShort ? this.#ml(descriptionShort) : undefined,
    })

    const associatedCategoryIds = [...new Set([defaultCategoryId, ...(categoryIds || [])].filter(Boolean))]

    if (associatedCategoryIds.length) {
      fields.associations = { categories: { category: associatedCategoryIds.map(id => ({ id })) } }
    }

    const response = await this.#apiRequest({
      logTag,
      path: '/products',
      method: 'post',
      query: { language: this.languageId },
      xmlBody: this.#buildXml('product', fields),
    })

    return this.#unwrapWriteResponse(response, 'product')
  }

  /**
   * @operationName Update Product
   * @category Products
   * @description Updates a product. Because the PrestaShop webservice PUT is a full replace, this operation first fetches the current product as JSON, merges your changes into it, strips read-only fields (manufacturer_name, quantity, position_in_category, id_default_image, id_default_combination, type, new, date_add, date_upd) and sends the merged XML back. Multilanguage fields are updated only for the configured language; other languages are preserved. Category associations are only rewritten when Category IDs is provided; when changing the default category make sure it is included there (or already associated).
   * @route PUT /product
   * @paramDef {"type":"Number","label":"Product ID","name":"productId","required":true,"description":"Numeric id of the product to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New product name for the configured language. Leave empty to keep the current name."}
   * @paramDef {"type":"String","label":"Price","name":"price","description":"New tax-excluded price as a decimal string, e.g. 24.99."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"New product reference / SKU."}
   * @paramDef {"type":"String","label":"Active Status","name":"activeStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Set the product visibility. Leave empty to keep the current status."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New full description for the configured language. HTML is allowed."}
   * @paramDef {"type":"String","label":"Short Description","name":"descriptionShort","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New short description for the configured language. HTML is allowed."}
   * @paramDef {"type":"String","label":"Default Category","name":"defaultCategoryId","dictionary":"getCategoriesDictionary","description":"New default category id (id_category_default)."}
   * @paramDef {"type":"Array<String>","label":"Category IDs","name":"categoryIds","description":"Full list of category ids to associate. When provided it REPLACES the current category associations; when empty the current associations are kept."}
   * @paramDef {"type":"String","label":"Manufacturer","name":"manufacturerId","dictionary":"getManufacturersDictionary","description":"New manufacturer (brand) id."}
   * @paramDef {"type":"Number","label":"Weight","name":"weight","description":"New product weight in the store's weight unit."}
   * @paramDef {"type":"String","label":"URL Slug","name":"linkRewrite","description":"New SEO-friendly URL slug for the configured language. Leave empty to keep the current slug."}
   * @returns {Object}
   * @sampleResult {"id":22,"id_category_default":"2","reference":"TSHIRT-RED-M","type":"simple","state":"1","price":"24.990000","active":"1","name":"Red T-Shirt v2","link_rewrite":"red-t-shirt","weight":"0.30","date_upd":"2026-03-02 09:30:00"}
   */
  async updateProduct(productId, name, price, reference, activeStatus, description, descriptionShort, defaultCategoryId, categoryIds, manufacturerId, weight, linkRewrite) {
    const logTag = '[updateProduct]'

    const current = await this.#apiRequest({ logTag, path: `/products/${ productId }` })
    const product = (current && current.product) || {}

    const fields = this.#jsonToXmlFields(product, {
      readOnlyFields: PRODUCT_READ_ONLY_FIELDS,
      multilangFields: PRODUCT_MULTILANG_FIELDS,
    })

    fields.id = productId

    if (name !== undefined && name !== null && name !== '') {
      this.#setMultilang(fields, 'name', name)
    }

    if (description !== undefined && description !== null && description !== '') {
      this.#setMultilang(fields, 'description', description)
    }

    if (descriptionShort !== undefined && descriptionShort !== null && descriptionShort !== '') {
      this.#setMultilang(fields, 'description_short', descriptionShort)
    }

    if (linkRewrite !== undefined && linkRewrite !== null && linkRewrite !== '') {
      this.#setMultilang(fields, 'link_rewrite', this.#slugify(linkRewrite))
    }

    if (price !== undefined && price !== null && price !== '') {
      fields.price = String(price)
    }

    if (reference !== undefined && reference !== null && reference !== '') {
      fields.reference = reference
    }

    const active = this.#resolveChoice(activeStatus, { 'Active': '1', 'Inactive': '0' })

    if (active !== undefined) {
      fields.active = active
    }

    if (defaultCategoryId !== undefined && defaultCategoryId !== null && defaultCategoryId !== '') {
      fields.id_category_default = defaultCategoryId
    }

    if (manufacturerId !== undefined && manufacturerId !== null && manufacturerId !== '') {
      fields.id_manufacturer = manufacturerId
    }

    if (weight !== undefined && weight !== null && weight !== '') {
      fields.weight = weight
    }

    if (Array.isArray(categoryIds) && categoryIds.length) {
      const associatedCategoryIds = [...new Set([fields.id_category_default, ...categoryIds].filter(Boolean))]

      fields.associations = { categories: { category: associatedCategoryIds.map(id => ({ id })) } }
    }

    const response = await this.#apiRequest({
      logTag,
      path: `/products/${ productId }`,
      method: 'put',
      query: { language: this.languageId },
      xmlBody: this.#buildXml('product', fields),
    })

    return this.#unwrapWriteResponse(response, 'product')
  }

  /**
   * @operationName Delete Product
   * @category Products
   * @description Permanently deletes a product from the catalog by its numeric id. This cannot be undone; associated combinations, images and stock records are removed by PrestaShop.
   * @route DELETE /product
   * @paramDef {"type":"Number","label":"Product ID","name":"productId","required":true,"description":"Numeric id of the product to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"id":22}
   */
  async deleteProduct(productId) {
    const logTag = '[deleteProduct]'

    await this.#apiRequest({
      logTag,
      path: `/products/${ productId }`,
      method: 'delete',
    })

    return { success: true, id: productId }
  }

  // ---------------------------------------------------------------------------
  // Stock
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Stock Availables
   * @category Stock
   * @description Lists stock_available records (PrestaShop's per-product/per-combination stock rows). Filter by product id to find the stock record(s) of a specific product: simple products have one row with id_product_attribute 0, products with combinations have one row per combination plus an aggregate row. Use the returned id with Update Stock Quantity.
   * @route GET /stock-availables
   * @paramDef {"type":"Number","label":"Product ID","name":"productId","description":"Filters stock records for a specific product id. Leave empty to list all stock records."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of records to return. Defaults to 50."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip, for pagination."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"id_product":"1","id_product_attribute":"0","id_shop":"1","id_shop_group":"0","quantity":300,"depends_on_stock":"0","out_of_stock":"2","location":""}]
   */
  async listStockAvailables(productId, limit, offset) {
    const logTag = '[listStockAvailables]'

    const response = await this.#apiRequest({
      logTag,
      path: '/stock_availables',
      query: {
        display: 'full',
        'filter[id_product]': productId !== undefined && productId !== null && productId !== '' ? `[${ productId }]` : undefined,
        limit: this.#limitParam(limit, offset),
      },
    })

    return this.#unwrapList(response, 'stock_availables')
  }

  /**
   * @operationName Get Stock Available
   * @category Stock
   * @description Retrieves a single stock_available record by its id, including the current quantity, the product and combination it belongs to, and the out-of-stock behavior.
   * @route GET /stock-available
   * @paramDef {"type":"Number","label":"Stock Available ID","name":"stockAvailableId","required":true,"description":"Numeric id of the stock_available record (find it via List Stock Availables or a product's stock_availables association)."}
   * @returns {Object}
   * @sampleResult {"id":1,"id_product":"1","id_product_attribute":"0","id_shop":"1","id_shop_group":"0","quantity":300,"depends_on_stock":"0","out_of_stock":"2","location":""}
   */
  async getStockAvailable(stockAvailableId) {
    const logTag = '[getStockAvailable]'

    const response = await this.#apiRequest({
      logTag,
      path: `/stock_availables/${ stockAvailableId }`,
    })

    return (response && response.stock_available) || response
  }

  /**
   * @operationName Update Stock Quantity
   * @category Stock
   * @description Sets the available quantity of a stock_available record. The webservice PUT is a full replace, so the current record is fetched first and merged with the new quantity (and optionally the out-of-stock behavior) before being sent back as XML. Stock records cannot be created or deleted via the webservice - only updated.
   * @route PUT /stock-available
   * @paramDef {"type":"Number","label":"Stock Available ID","name":"stockAvailableId","required":true,"description":"Numeric id of the stock_available record to update (find it via List Stock Availables)."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"description":"New available quantity."}
   * @paramDef {"type":"String","label":"Out Of Stock Behavior","name":"outOfStockBehavior","uiComponent":{"type":"DROPDOWN","options":{"values":["Deny Backorders","Allow Backorders","Use Store Default"]}},"description":"What happens when the product is out of stock. Leave empty to keep the current behavior."}
   * @returns {Object}
   * @sampleResult {"id":1,"id_product":"1","id_product_attribute":"0","id_shop":"1","id_shop_group":"0","quantity":150,"depends_on_stock":"0","out_of_stock":"2","location":""}
   */
  async updateStockQuantity(stockAvailableId, quantity, outOfStockBehavior) {
    const logTag = '[updateStockQuantity]'

    const current = await this.#apiRequest({ logTag, path: `/stock_availables/${ stockAvailableId }` })
    const stock = (current && current.stock_available) || {}

    const outOfStock = this.#resolveChoice(outOfStockBehavior, {
      'Deny Backorders': '0',
      'Allow Backorders': '1',
      'Use Store Default': '2',
    })

    const fields = clean({
      id: stockAvailableId,
      id_product: stock.id_product,
      id_product_attribute: stock.id_product_attribute ?? '0',
      id_shop: stock.id_shop,
      id_shop_group: stock.id_shop_group,
      quantity,
      depends_on_stock: stock.depends_on_stock ?? '0',
      out_of_stock: outOfStock ?? stock.out_of_stock ?? '2',
      location: stock.location,
    })

    const response = await this.#apiRequest({
      logTag,
      path: `/stock_availables/${ stockAvailableId }`,
      method: 'put',
      xmlBody: this.#buildXml('stock_available', fields),
    })

    return this.#unwrapWriteResponse(response, 'stock_available')
  }

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Categories
   * @category Categories
   * @description Lists catalog categories with full field data, including parent relationships and depth. Supports filtering by name (contains match) and active status, plus pagination. In a default store, category 1 is Root and category 2 is Home (the usual parent for new categories).
   * @route GET /categories
   * @paramDef {"type":"String","label":"Name Contains","name":"nameFilter","description":"Filters categories whose name contains this text (case-insensitive)."}
   * @paramDef {"type":"String","label":"Active Status","name":"activeFilter","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Filters by active status. Leave empty to return both."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of categories to return. Defaults to 50."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of categories to skip, for pagination."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":3,"id_parent":"2","active":"1","level_depth":"2","name":"Clothes","link_rewrite":"clothes","description":"","date_add":"2026-01-05 11:02:35","associations":{"categories":[{"id":"4"},{"id":"5"}],"products":[{"id":"1"}]}}]
   */
  async listCategories(nameFilter, activeFilter, limit, offset) {
    const logTag = '[listCategories]'

    const active = this.#resolveChoice(activeFilter, { 'Active': '1', 'Inactive': '0' })

    const response = await this.#apiRequest({
      logTag,
      path: '/categories',
      query: {
        display: 'full',
        language: this.languageId,
        'filter[name]': nameFilter ? `%[${ nameFilter }]%` : undefined,
        'filter[active]': active !== undefined ? `[${ active }]` : undefined,
        limit: this.#limitParam(limit, offset),
      },
    })

    return this.#unwrapList(response, 'categories')
  }

  /**
   * @operationName Get Category
   * @category Categories
   * @description Retrieves a single category by its numeric id, including its parent, level, SEO fields and associations (child categories and products).
   * @route GET /category
   * @paramDef {"type":"Number","label":"Category ID","name":"categoryId","required":true,"description":"Numeric id of the category to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":3,"id_parent":"2","active":"1","level_depth":"2","name":"Clothes","link_rewrite":"clothes","description":"","meta_title":"","date_add":"2026-01-05 11:02:35","associations":{"categories":[{"id":"4"},{"id":"5"}],"products":[{"id":"1"}]}}
   */
  async getCategory(categoryId) {
    const logTag = '[getCategory]'

    const response = await this.#apiRequest({
      logTag,
      path: `/categories/${ categoryId }`,
      query: { language: this.languageId },
    })

    return (response && response.category) || response
  }

  /**
   * @operationName Create Category
   * @category Categories
   * @description Creates a catalog category under the given parent. Sends an XML body; the name, description and URL slug are written for the configured language, and the slug (link_rewrite) is auto-generated from the name when not provided. In a default store use parent id 2 (Home) for top-level categories.
   * @route POST /category
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Category name (written for the configured language)."}
   * @paramDef {"type":"String","label":"Parent Category","name":"parentCategoryId","required":true,"dictionary":"getCategoriesDictionary","description":"Id of the parent category. Use 2 (Home) for top-level categories in a default store."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Whether the category is visible in the shop. Defaults to true."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Category description. HTML is allowed."}
   * @paramDef {"type":"String","label":"URL Slug","name":"linkRewrite","description":"SEO-friendly URL slug (link_rewrite). Auto-generated from the name when empty."}
   * @returns {Object}
   * @sampleResult {"id":12,"id_parent":"2","active":"1","level_depth":"2","name":"Accessories","link_rewrite":"accessories","description":"","date_add":"2026-03-01 10:20:00"}
   */
  async createCategory(name, parentCategoryId, active, description, linkRewrite) {
    const logTag = '[createCategory]'

    const fields = clean({
      name: this.#ml(name),
      link_rewrite: this.#ml(this.#slugify(linkRewrite || name)),
      id_parent: parentCategoryId,
      active: this.#boolFlag(active, '1'),
      description: description ? this.#ml(description) : undefined,
    })

    const response = await this.#apiRequest({
      logTag,
      path: '/categories',
      method: 'post',
      query: { language: this.languageId },
      xmlBody: this.#buildXml('category', fields),
    })

    return this.#unwrapWriteResponse(response, 'category')
  }

  // ---------------------------------------------------------------------------
  // Customers
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Customers
   * @category Customers
   * @description Lists customer accounts with full field data. Supports filtering by email, first name and last name (contains match) plus pagination. Password hashes are included in the raw records - avoid exposing them downstream.
   * @route GET /customers
   * @paramDef {"type":"String","label":"Email Contains","name":"emailFilter","description":"Filters customers whose email contains this text."}
   * @paramDef {"type":"String","label":"First Name Contains","name":"firstNameFilter","description":"Filters customers whose first name contains this text."}
   * @paramDef {"type":"String","label":"Last Name Contains","name":"lastNameFilter","description":"Filters customers whose last name contains this text."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of customers to return. Defaults to 50."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of customers to skip, for pagination."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":2,"id_default_group":"3","id_lang":"1","firstname":"John","lastname":"Doe","email":"john.doe@example.com","active":"1","newsletter":"1","optin":"0","date_add":"2026-01-05 11:02:41"}]
   */
  async listCustomers(emailFilter, firstNameFilter, lastNameFilter, limit, offset) {
    const logTag = '[listCustomers]'

    const response = await this.#apiRequest({
      logTag,
      path: '/customers',
      query: {
        display: 'full',
        'filter[email]': emailFilter ? `%[${ emailFilter }]%` : undefined,
        'filter[firstname]': firstNameFilter ? `%[${ firstNameFilter }]%` : undefined,
        'filter[lastname]': lastNameFilter ? `%[${ lastNameFilter }]%` : undefined,
        limit: this.#limitParam(limit, offset),
      },
    })

    return this.#unwrapList(response, 'customers')
  }

  /**
   * @operationName Get Customer
   * @category Customers
   * @description Retrieves a single customer account by its numeric id, including contact details, group, newsletter/opt-in flags and the groups association.
   * @route GET /customer
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","required":true,"description":"Numeric id of the customer to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":2,"id_default_group":"3","id_lang":"1","firstname":"John","lastname":"Doe","email":"john.doe@example.com","active":"1","newsletter":"1","optin":"0","birthday":"1990-04-12","date_add":"2026-01-05 11:02:41","associations":{"groups":[{"id":"3"}]}}
   */
  async getCustomer(customerId) {
    const logTag = '[getCustomer]'

    const response = await this.#apiRequest({
      logTag,
      path: `/customers/${ customerId }`,
    })

    return (response && response.customer) || response
  }

  /**
   * @operationName Create Customer
   * @category Customers
   * @description Creates a customer account. The password is sent in plain text over your store's HTTPS connection and hashed by PrestaShop on save (the webservice passwd setter hashes incoming values). The email must be unique in the store.
   * @route POST /customer
   * @paramDef {"type":"String","label":"First Name","name":"firstname","required":true,"description":"Customer first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastname","required":true,"description":"Customer last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Customer email address. Must be unique in the store."}
   * @paramDef {"type":"String","label":"Password","name":"password","required":true,"description":"Plain-text password (at least 5 characters). PrestaShop hashes it on save."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Whether the account is enabled. Defaults to true."}
   * @paramDef {"type":"Boolean","label":"Newsletter","name":"newsletter","uiComponent":{"type":"TOGGLE"},"description":"Whether the customer is subscribed to the newsletter. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Partner Offers Opt-In","name":"optin","uiComponent":{"type":"TOGGLE"},"description":"Whether the customer opted in to partner offers. Defaults to false."}
   * @paramDef {"type":"Number","label":"Default Group ID","name":"defaultGroupId","description":"Customer group id (id_default_group). In a default store 3 is the Customer group. Leave empty for the store default."}
   * @returns {Object}
   * @sampleResult {"id":15,"id_default_group":"3","firstname":"Jane","lastname":"Smith","email":"jane.smith@example.com","active":"1","newsletter":"0","optin":"0","date_add":"2026-03-01 10:25:00"}
   */
  async createCustomer(firstname, lastname, email, password, active, newsletter, optin, defaultGroupId) {
    const logTag = '[createCustomer]'

    const fields = clean({
      firstname,
      lastname,
      email,
      passwd: password,
      active: this.#boolFlag(active, '1'),
      newsletter: this.#boolFlag(newsletter, '0'),
      optin: this.#boolFlag(optin, '0'),
      id_default_group: defaultGroupId,
    })

    const response = await this.#apiRequest({
      logTag,
      path: '/customers',
      method: 'post',
      xmlBody: this.#buildXml('customer', fields),
    })

    return this.#unwrapWriteResponse(response, 'customer')
  }

  /**
   * @operationName Update Customer
   * @category Customers
   * @description Updates a customer account. The webservice PUT is a full replace, so the current record is fetched, merged with your changes and sent back as XML with read-only fields stripped (last_passwd_gen, secure_key, reset password fields, timestamps). The stored password hash is echoed back unchanged - PrestaShop only re-hashes the passwd field when its value differs - so this operation never alters the customer's password.
   * @route PUT /customer
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","required":true,"description":"Numeric id of the customer to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstname","description":"New first name. Leave empty to keep the current value."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastname","description":"New last name. Leave empty to keep the current value."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address. Must be unique in the store. Leave empty to keep the current value."}
   * @paramDef {"type":"String","label":"Active Status","name":"activeStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Enable or disable the account. Leave empty to keep the current status."}
   * @paramDef {"type":"String","label":"Newsletter","name":"newsletterStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Subscribed","Unsubscribed"]}},"description":"Change the newsletter subscription. Leave empty to keep the current value."}
   * @paramDef {"type":"String","label":"Partner Offers","name":"optinStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Opted In","Opted Out"]}},"description":"Change the partner-offers opt-in. Leave empty to keep the current value."}
   * @returns {Object}
   * @sampleResult {"id":15,"id_default_group":"3","firstname":"Jane","lastname":"Smith-Jones","email":"jane.smith@example.com","active":"1","newsletter":"1","optin":"0","date_upd":"2026-03-02 09:40:00"}
   */
  async updateCustomer(customerId, firstname, lastname, email, activeStatus, newsletterStatus, optinStatus) {
    const logTag = '[updateCustomer]'

    const current = await this.#apiRequest({ logTag, path: `/customers/${ customerId }` })
    const customer = (current && current.customer) || {}

    const fields = this.#jsonToXmlFields(customer, { readOnlyFields: CUSTOMER_READ_ONLY_FIELDS })

    fields.id = customerId

    if (firstname !== undefined && firstname !== null && firstname !== '') {
      fields.firstname = firstname
    }

    if (lastname !== undefined && lastname !== null && lastname !== '') {
      fields.lastname = lastname
    }

    if (email !== undefined && email !== null && email !== '') {
      fields.email = email
    }

    const active = this.#resolveChoice(activeStatus, { 'Active': '1', 'Inactive': '0' })

    if (active !== undefined) {
      fields.active = active
    }

    const newsletter = this.#resolveChoice(newsletterStatus, { 'Subscribed': '1', 'Unsubscribed': '0' })

    if (newsletter !== undefined) {
      fields.newsletter = newsletter
    }

    const optin = this.#resolveChoice(optinStatus, { 'Opted In': '1', 'Opted Out': '0' })

    if (optin !== undefined) {
      fields.optin = optin
    }

    const response = await this.#apiRequest({
      logTag,
      path: `/customers/${ customerId }`,
      method: 'put',
      xmlBody: this.#buildXml('customer', fields),
    })

    return this.#unwrapWriteResponse(response, 'customer')
  }

  /**
   * @operationName Delete Customer
   * @category Customers
   * @description Permanently deletes a customer account by its numeric id. This cannot be undone. The customer's orders remain in the store but are no longer linked to an account.
   * @route DELETE /customer
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","required":true,"description":"Numeric id of the customer to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"id":15}
   */
  async deleteCustomer(customerId) {
    const logTag = '[deleteCustomer]'

    await this.#apiRequest({
      logTag,
      path: `/customers/${ customerId }`,
      method: 'delete',
    })

    return { success: true, id: customerId }
  }

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Orders
   * @category Orders
   * @description Lists orders with full field data, including totals, payment method and current state. Supports filtering by order state, reference and creation date range, plus pagination. Sorted by id, newest first by default. Each order's line items are in its associations.order_rows.
   * @route GET /orders
   * @paramDef {"type":"String","label":"Order State","name":"orderStateId","dictionary":"getOrderStatesDictionary","description":"Filters orders by their current state (current_state), e.g. Payment accepted or Shipped."}
   * @paramDef {"type":"String","label":"Reference","name":"referenceFilter","description":"Filters by exact order reference, e.g. XKBKNABJK."}
   * @paramDef {"type":"String","label":"Created After","name":"dateFrom","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the creation date range (date_add). Accepts YYYY-MM-DD, YYYY-MM-DD HH:MM:SS or an epoch-milliseconds timestamp."}
   * @paramDef {"type":"String","label":"Created Before","name":"dateTo","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the creation date range (date_add). Accepts YYYY-MM-DD, YYYY-MM-DD HH:MM:SS or an epoch-milliseconds timestamp."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of orders to return. Defaults to 50."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of orders to skip, for pagination."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDirection","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction by order id. Defaults to Descending (newest first)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":5,"reference":"XKBKNABJK","id_customer":"2","id_cart":"5","current_state":"2","payment":"Bank wire","module":"ps_wirepayment","total_paid":"55.200000","total_products":"46.000000","date_add":"2026-02-11 09:14:22","associations":{"order_rows":[{"id":"5","product_id":"1","product_quantity":"2","product_name":"Hummingbird printed t-shirt","unit_price_tax_incl":"23.900000"}]}}]
   */
  async listOrders(orderStateId, referenceFilter, dateFrom, dateTo, limit, offset, sortDirection) {
    const logTag = '[listOrders]'

    const direction = this.#resolveChoice(sortDirection, { 'Ascending': 'ASC', 'Descending': 'DESC' }) || 'DESC'

    const query = {
      display: 'full',
      'filter[current_state]': orderStateId ? `[${ orderStateId }]` : undefined,
      'filter[reference]': referenceFilter ? `[${ referenceFilter }]` : undefined,
      limit: this.#limitParam(limit, offset),
      sort: `[id_${ direction }]`,
    }

    if (dateFrom || dateTo) {
      const from = this.#toPsDate(dateFrom) || '1970-01-01 00:00:00'
      const to = this.#toPsDate(dateTo, true) || '2099-12-31 23:59:59'

      query['filter[date_add]'] = `[${ from },${ to }]`
      query.date = 1
    }

    const response = await this.#apiRequest({ logTag, path: '/orders', query })

    return this.#unwrapList(response, 'orders')
  }

  /**
   * @operationName Get Order
   * @category Orders
   * @description Retrieves a single order by its numeric id, including totals, payment details, delivery/invoice address ids and the current state. The line items (products, quantities, unit prices) are included in associations.order_rows - no separate call is needed.
   * @route GET /order
   * @paramDef {"type":"Number","label":"Order ID","name":"orderId","required":true,"description":"Numeric id of the order to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":5,"reference":"XKBKNABJK","id_customer":"2","id_cart":"5","id_address_delivery":"4","id_address_invoice":"4","current_state":"2","payment":"Bank wire","module":"ps_wirepayment","total_paid":"55.200000","total_paid_real":"55.200000","total_products":"46.000000","total_shipping":"9.200000","date_add":"2026-02-11 09:14:22","associations":{"order_rows":[{"id":"5","product_id":"1","product_attribute_id":"1","product_quantity":"2","product_name":"Hummingbird printed t-shirt","product_reference":"demo_1","unit_price_tax_incl":"23.900000","unit_price_tax_excl":"19.900000"}]}}
   */
  async getOrder(orderId) {
    const logTag = '[getOrder]'

    const response = await this.#apiRequest({
      logTag,
      path: `/orders/${ orderId }`,
    })

    return (response && response.order) || response
  }

  /**
   * @operationName Update Order Status
   * @category Orders
   * @description Changes an order's status the way PrestaShop documents it: by creating an order_history record (POST /api/order_histories) linking the order to the new order state. Depending on the store's state configuration this can trigger customer emails, invoice generation or stock movements. Requires POST permission on the order_histories resource for the webservice key.
   * @route POST /order-status
   * @paramDef {"type":"Number","label":"Order ID","name":"orderId","required":true,"description":"Numeric id of the order to update."}
   * @paramDef {"type":"String","label":"New Order State","name":"orderStateId","required":true,"dictionary":"getOrderStatesDictionary","description":"Id of the order state to apply, e.g. Payment accepted or Shipped."}
   * @returns {Object}
   * @sampleResult {"id":31,"id_order":"5","id_order_state":"4","id_employee":"0","date_add":"2026-03-02 10:00:00"}
   */
  async updateOrderStatus(orderId, orderStateId) {
    const logTag = '[updateOrderStatus]'

    const fields = {
      id_order: orderId,
      id_order_state: orderStateId,
    }

    const response = await this.#apiRequest({
      logTag,
      path: '/order_histories',
      method: 'post',
      xmlBody: this.#buildXml('order_history', fields),
    })

    return this.#unwrapWriteResponse(response, 'order_history')
  }

  /**
   * @operationName List Order States
   * @category Orders
   * @description Lists all order states configured in the store (e.g. Awaiting payment, Payment accepted, Shipped, Delivered, Canceled) with their flags: paid, logable, shipped, delivery, invoice and the display color. Use the state id with List Orders (filter) or Update Order Status.
   * @route GET /order-states
   * @returns {Array<Object>}
   * @sampleResult [{"id":2,"name":"Payment accepted","paid":"1","logable":"1","shipped":"0","delivery":"0","invoice":"1","color":"#32CD32","send_email":"1"}]
   */
  async listOrderStates() {
    const logTag = '[listOrderStates]'

    const response = await this.#apiRequest({
      logTag,
      path: '/order_states',
      query: {
        display: 'full',
        language: this.languageId,
      },
    })

    return this.#unwrapList(response, 'order_states')
  }

  // ---------------------------------------------------------------------------
  // Addresses
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Addresses
   * @category Addresses
   * @description Lists addresses stored in the store's address book with full field data. Filter by customer id to get a specific customer's delivery and invoice addresses. Orders reference these records via id_address_delivery and id_address_invoice.
   * @route GET /addresses
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","description":"Filters addresses belonging to a specific customer id. Leave empty to list all addresses."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of addresses to return. Defaults to 50."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of addresses to skip, for pagination."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":4,"id_customer":"2","id_country":"8","alias":"My address","firstname":"John","lastname":"Doe","address1":"16 Main Street","postcode":"75002","city":"Paris","phone":"0102030405"}]
   */
  async listAddresses(customerId, limit, offset) {
    const logTag = '[listAddresses]'

    const response = await this.#apiRequest({
      logTag,
      path: '/addresses',
      query: {
        display: 'full',
        'filter[id_customer]': customerId !== undefined && customerId !== null && customerId !== '' ? `[${ customerId }]` : undefined,
        limit: this.#limitParam(limit, offset),
      },
    })

    return this.#unwrapList(response, 'addresses')
  }

  /**
   * @operationName Get Address
   * @category Addresses
   * @description Retrieves a single address by its numeric id, including the owner (id_customer), country, street, postcode, city and phone numbers.
   * @route GET /address
   * @paramDef {"type":"Number","label":"Address ID","name":"addressId","required":true,"description":"Numeric id of the address to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":4,"id_customer":"2","id_country":"8","id_state":"0","alias":"My address","firstname":"John","lastname":"Doe","company":"","address1":"16 Main Street","address2":"","postcode":"75002","city":"Paris","phone":"0102030405","phone_mobile":"","date_add":"2026-01-05 11:02:42"}
   */
  async getAddress(addressId) {
    const logTag = '[getAddress]'

    const response = await this.#apiRequest({
      logTag,
      path: `/addresses/${ addressId }`,
    })

    return (response && response.address) || response
  }

  // ---------------------------------------------------------------------------
  // Carts
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Carts
   * @category Carts
   * @description Lists shopping carts with full field data, including abandoned carts. Filter by customer id to inspect a specific customer's carts. Cart line items are in each cart's associations.cart_rows. A cart that resulted in an order is referenced by that order's id_cart.
   * @route GET /carts
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","description":"Filters carts belonging to a specific customer id. Leave empty to list all carts."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of carts to return. Defaults to 50."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of carts to skip, for pagination."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":5,"id_customer":"2","id_currency":"1","id_lang":"1","id_carrier":"2","date_add":"2026-02-11 09:10:11","associations":{"cart_rows":[{"id_product":"1","id_product_attribute":"1","id_address_delivery":"4","quantity":"2"}]}}]
   */
  async listCarts(customerId, limit, offset) {
    const logTag = '[listCarts]'

    const response = await this.#apiRequest({
      logTag,
      path: '/carts',
      query: {
        display: 'full',
        'filter[id_customer]': customerId !== undefined && customerId !== null && customerId !== '' ? `[${ customerId }]` : undefined,
        limit: this.#limitParam(limit, offset),
      },
    })

    return this.#unwrapList(response, 'carts')
  }

  /**
   * @operationName Get Cart
   * @category Carts
   * @description Retrieves a single shopping cart by its numeric id. The products in the cart (product id, combination id, delivery address and quantity) are included in associations.cart_rows.
   * @route GET /cart
   * @paramDef {"type":"Number","label":"Cart ID","name":"cartId","required":true,"description":"Numeric id of the cart to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":5,"id_customer":"2","id_currency":"1","id_lang":"1","id_carrier":"2","id_address_delivery":"4","id_address_invoice":"4","date_add":"2026-02-11 09:10:11","associations":{"cart_rows":[{"id_product":"1","id_product_attribute":"1","id_address_delivery":"4","quantity":"2"}]}}
   */
  async getCart(cartId) {
    const logTag = '[getCart]'

    const response = await this.#apiRequest({
      logTag,
      path: `/carts/${ cartId }`,
    })

    return (response && response.cart) || response
  }

  // ---------------------------------------------------------------------------
  // Store reference
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Manufacturers
   * @category Store Reference
   * @description Lists manufacturers (brands) with full field data. Supports filtering by name (contains match) and pagination. Use a manufacturer id when creating or updating products.
   * @route GET /manufacturers
   * @paramDef {"type":"String","label":"Name Contains","name":"nameFilter","description":"Filters manufacturers whose name contains this text (case-insensitive)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of manufacturers to return. Defaults to 50."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of manufacturers to skip, for pagination."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"name":"Studio Design","active":"1","description":"","short_description":"","date_add":"2026-01-05 11:02:39","associations":{"addresses":[{"id":"5"}]}}]
   */
  async listManufacturers(nameFilter, limit, offset) {
    const logTag = '[listManufacturers]'

    const response = await this.#apiRequest({
      logTag,
      path: '/manufacturers',
      query: {
        display: 'full',
        language: this.languageId,
        'filter[name]': nameFilter ? `%[${ nameFilter }]%` : undefined,
        limit: this.#limitParam(limit, offset),
      },
    })

    return this.#unwrapList(response, 'manufacturers')
  }

  /**
   * @operationName List Languages
   * @category Store Reference
   * @description Lists the languages installed in the store with their numeric ids, ISO codes and locales. Use a language id in the service's Language ID configuration to control which language multilanguage fields are read and written in.
   * @route GET /languages
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"name":"English (English)","iso_code":"en","locale":"en-US","language_code":"en-us","active":"1","is_rtl":"0","date_format_lite":"m/d/Y","date_format_full":"m/d/Y H:i:s"}]
   */
  async listLanguages() {
    const logTag = '[listLanguages]'

    const response = await this.#apiRequest({
      logTag,
      path: '/languages',
      query: { display: 'full' },
    })

    return this.#unwrapList(response, 'languages')
  }

  /**
   * @operationName List Currencies
   * @category Store Reference
   * @description Lists the currencies configured in the store with their ISO codes, conversion rates and active status. Order and product monetary amounts are expressed in the store's default currency unless stated otherwise.
   * @route GET /currencies
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of currencies to return. Defaults to 50."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"names":"Euro","name":"Euro","iso_code":"EUR","symbol":"€","conversion_rate":"1.000000","active":"1","precision":"2"}]
   */
  async listCurrencies(limit) {
    const logTag = '[listCurrencies]'

    const response = await this.#apiRequest({
      logTag,
      path: '/currencies',
      query: {
        display: 'full',
        language: this.languageId,
        limit: this.#limitParam(limit),
      },
    })

    return this.#unwrapList(response, 'currencies')
  }

  // ---------------------------------------------------------------------------
  // Advanced
  // ---------------------------------------------------------------------------

  /**
   * @operationName Call Webservice Resource
   * @category Advanced
   * @description Escape hatch for the 60+ PrestaShop webservice resources not covered by dedicated operations (e.g. combinations, order_carriers, specific_prices, taxes, zones). Sends an authenticated request to {storeUrl}/api/{resource path}. Reads are returned as JSON (output_format=JSON is appended automatically); for POST and PUT provide a full PrestaShop XML body (<?xml version="1.0" encoding="UTF-8"?><prestashop>...</prestashop>). The webservice key must have the matching permission ticked for the resource.
   * @route POST /call-webservice-resource
   * @paramDef {"type":"String","label":"Resource Path","name":"resourcePath","required":true,"description":"Path after /api, e.g. combinations, specific_prices/3 or order_carriers."}
   * @paramDef {"type":"String","label":"Method","name":"method","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["GET","POST","PUT","DELETE"]}},"defaultValue":"GET","description":"HTTP method to use."}
   * @paramDef {"type":"Object","label":"Query Parameters","name":"queryParams","freeform":true,"description":"Extra query parameters as a JSON object, e.g. {\"display\":\"full\",\"filter[id_product]\":\"[1]\",\"limit\":\"10\"}."}
   * @paramDef {"type":"String","label":"XML Body","name":"xmlBody","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"XML request body for POST/PUT calls. Ignored for GET and DELETE."}
   * @returns {Object}
   * @sampleResult {"combinations":[{"id":1,"id_product":"1","reference":"demo_1_s","price":"0.000000","minimal_quantity":"1"}]}
   */
  async callWebserviceResource(resourcePath, method, queryParams, xmlBody) {
    const logTag = '[callWebserviceResource]'

    const normalizedPath = `/${ String(resourcePath || '').replace(/^\/+/, '').replace(/^api\//, '') }`
    const normalizedMethod = String(method || 'GET').toLowerCase()
    const isWrite = normalizedMethod === 'post' || normalizedMethod === 'put'

    const response = await this.#apiRequest({
      logTag,
      path: normalizedPath,
      method: normalizedMethod,
      query: queryParams || {},
      xmlBody: isWrite && xmlBody ? xmlBody : undefined,
    })

    if (response === undefined || response === null || response === '') {
      return { success: true }
    }

    return typeof response === 'object' ? response : { raw: String(response) }
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  #dictionaryPage(items, offset) {
    return {
      items,
      cursor: items.length === DICTIONARY_PAGE_SIZE ? String(offset + DICTIONARY_PAGE_SIZE) : null,
    }
  }

  /**
   * @typedef {Object} getOrderStatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter order states by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric offset) returned by the previous page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Order States Dictionary
   * @description Provides the store's order states (e.g. Payment accepted, Shipped) for selection in order operations. The option value is the numeric order state id.
   * @route POST /get-order-states-dictionary
   * @paramDef {"type":"getOrderStatesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Payment accepted","value":"2","note":"paid"}],"cursor":null}
   */
  async getOrderStatesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getOrderStatesDictionary]'
    const offset = Number(cursor) || 0

    const response = await this.#apiRequest({
      logTag,
      path: '/order_states',
      query: {
        display: 'full',
        language: this.languageId,
        'filter[name]': search ? `%[${ search }]%` : undefined,
        limit: `${ offset },${ DICTIONARY_PAGE_SIZE }`,
      },
    })

    const states = this.#unwrapList(response, 'order_states')

    const items = states.map(state => {
      const flags = [
        state.paid === '1' ? 'paid' : null,
        state.shipped === '1' ? 'shipped' : null,
        state.delivery === '1' ? 'delivery' : null,
      ].filter(Boolean)

      return {
        label: String(state.name),
        value: String(state.id),
        note: flags.join(', ') || undefined,
      }
    })

    return this.#dictionaryPage(items, offset)
  }

  /**
   * @typedef {Object} getCategoriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter categories by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric offset) returned by the previous page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Categories Dictionary
   * @description Provides the store's catalog categories for selection in product and category operations. The option value is the numeric category id.
   * @route POST /get-categories-dictionary
   * @paramDef {"type":"getCategoriesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Clothes","value":"3","note":"ID 3"}],"cursor":null}
   */
  async getCategoriesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getCategoriesDictionary]'
    const offset = Number(cursor) || 0

    const response = await this.#apiRequest({
      logTag,
      path: '/categories',
      query: {
        display: '[id,name]',
        language: this.languageId,
        'filter[name]': search ? `%[${ search }]%` : undefined,
        limit: `${ offset },${ DICTIONARY_PAGE_SIZE }`,
        sort: '[id_ASC]',
      },
    })

    const categories = this.#unwrapList(response, 'categories')

    const items = categories.map(category => ({
      label: String(category.name),
      value: String(category.id),
      note: `ID ${ category.id }`,
    }))

    return this.#dictionaryPage(items, offset)
  }

  /**
   * @typedef {Object} getManufacturersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter manufacturers by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric offset) returned by the previous page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Manufacturers Dictionary
   * @description Provides the store's manufacturers (brands) for selection in product operations. The option value is the numeric manufacturer id.
   * @route POST /get-manufacturers-dictionary
   * @paramDef {"type":"getManufacturersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Studio Design","value":"1","note":"ID 1"}],"cursor":null}
   */
  async getManufacturersDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getManufacturersDictionary]'
    const offset = Number(cursor) || 0

    const response = await this.#apiRequest({
      logTag,
      path: '/manufacturers',
      query: {
        display: '[id,name]',
        'filter[name]': search ? `%[${ search }]%` : undefined,
        limit: `${ offset },${ DICTIONARY_PAGE_SIZE }`,
        sort: '[name_ASC]',
      },
    })

    const manufacturers = this.#unwrapList(response, 'manufacturers')

    const items = manufacturers.map(manufacturer => ({
      label: String(manufacturer.name),
      value: String(manufacturer.id),
      note: `ID ${ manufacturer.id }`,
    }))

    return this.#dictionaryPage(items, offset)
  }

  /**
   * @typedef {Object} getLanguagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter languages by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric offset) returned by the previous page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Languages Dictionary
   * @description Provides the store's installed languages for selection. The option value is the numeric language id, as used by the service's Language ID configuration.
   * @route POST /get-languages-dictionary
   * @paramDef {"type":"getLanguagesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"English (English)","value":"1","note":"en"}],"cursor":null}
   */
  async getLanguagesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getLanguagesDictionary]'
    const offset = Number(cursor) || 0

    const response = await this.#apiRequest({
      logTag,
      path: '/languages',
      query: {
        display: 'full',
        'filter[name]': search ? `%[${ search }]%` : undefined,
        limit: `${ offset },${ DICTIONARY_PAGE_SIZE }`,
      },
    })

    const languages = this.#unwrapList(response, 'languages')

    const items = languages.map(language => ({
      label: String(language.name),
      value: String(language.id),
      note: language.iso_code || undefined,
    }))

    return this.#dictionaryPage(items, offset)
  }
}

Flowrunner.ServerCode.addService(PrestaShopService, [
  {
    name: 'storeUrl',
    displayName: 'Store URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your shop base URL, e.g. https://mystore.com. The webservice must be enabled in Advanced Parameters -> Webservice.',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Webservice key created in Advanced Parameters -> Webservice. Each resource the service uses needs its permissions ticked on the key.',
  },
  {
    name: 'languageId',
    displayName: 'Language ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    defaultValue: '1',
    shared: false,
    hint: 'Numeric language id used for multilanguage fields (name, description, slug). Use the List Languages operation to find ids. Defaults to 1.',
  },
])
