'use strict'

const { createSandbox } = require('../../../service-sandbox')

const STORE_URL = 'https://mystore.example.com'
const API_KEY = 'test-api-key'
const LANGUAGE_ID = '1'

const API = `${ STORE_URL }/api`
const AUTH_HEADER = `Basic ${ Buffer.from(`${ API_KEY }:`).toString('base64') }`

const XML_PROLOG = '<?xml version="1.0" encoding="UTF-8"?><prestashop xmlns:xlink="http://www.w3.org/1999/xlink">'

describe('PrestaShop Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      storeUrl: `  ${ STORE_URL }//  `,
      apiKey: API_KEY,
      languageId: LANGUAGE_ID,
    })

    require('../src/index.js')

    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration & construction ──

  describe('service registration', () => {
    it('registers the expected config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['storeUrl', 'apiKey', 'languageId'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'storeUrl', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'apiKey', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'languageId', required: false, shared: false, defaultValue: '1' }),
        ])
      )
    })

    it('trims and normalizes the store URL', () => {
      expect(service.storeUrl).toBe(STORE_URL)
      expect(service.apiBaseUrl).toBe(API)
      expect(service.languageId).toBe('1')
    })
  })

  // ── Request plumbing & error handling ──

  describe('request plumbing', () => {
    it('sends basic auth and forces the JSON output format', async () => {
      mock.onGet(`${ API }/languages`).reply({ languages: [] })

      await service.listLanguages()

      expect(mock.history[0].headers).toEqual({ Authorization: AUTH_HEADER })
      expect(mock.history[0].query).toMatchObject({ output_format: 'JSON', display: 'full' })
      expect(mock.history[0].body).toBeUndefined()
    })

    it('extracts the message from an XML error body and adds the 404 hint', async () => {
      mock.onGet(`${ API }/products/999`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: '<?xml version="1.0"?><prestashop><errors><error><message><![CDATA[Invalid ID]]></message></error></errors></prestashop>',
      })

      await expect(service.getProduct(999)).rejects.toThrow(/PrestaShop API error: Invalid ID/)
      await expect(service.getProduct(999)).rejects.toThrow(/Hint: PrestaShop returns 404/)
    })

    it('adds the 401 hint about the webservice key', async () => {
      mock.onGet(`${ API }/products/1`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { message: 'Invalid authentication key' },
      })

      await expect(service.getProduct(1)).rejects.toThrow(/Invalid authentication key/)
      await expect(service.getProduct(1)).rejects.toThrow(/Hint: verify the webservice key/)
    })

    it('joins multiple structured error messages', async () => {
      mock.onGet(`${ API }/products/1`).replyWithError({
        message: 'Bad Request',
        statusCode: 400,
        body: { errors: [{ message: 'first problem' }, { message: 'second problem' }] },
      })

      await expect(service.getProduct(1)).rejects.toThrow('PrestaShop API error: first problem; second problem')
    })

    it('falls back to the transport error message', async () => {
      mock.onGet(`${ API }/products/1`).replyWithError({ message: 'socket hang up' })

      await expect(service.getProduct(1)).rejects.toThrow('PrestaShop API error: socket hang up')
    })

    it('falls back to Unknown error when nothing is available', async () => {
      mock.onGet(`${ API }/products/1`).replyWithError({ message: '' })

      await expect(service.getProduct(1)).rejects.toThrow('PrestaShop API error: Unknown error')
    })
  })

  // ── Products ──

  describe('listProducts', () => {
    it('applies the defaults', async () => {
      mock.onGet(`${ API }/products`).reply({ products: [{ id: 1 }] })

      const result = await service.listProducts()

      expect(result).toEqual([{ id: 1 }])

      expect(mock.history[0].query).toEqual({
        output_format: 'JSON',
        display: 'full',
        language: '1',
        limit: '50',
        sort: '[id_ASC]',
      })
    })

    it('builds the filter, sort and pagination parameters', async () => {
      mock.onGet(`${ API }/products`).reply({ products: [] })

      await service.listProducts('shirt', 'demo_1', 'Active', 10, 20, 'Date Added', 'Descending')

      expect(mock.history[0].query).toEqual({
        output_format: 'JSON',
        display: 'full',
        language: '1',
        'filter[name]': '%[shirt]%',
        'filter[reference]': '[demo_1]',
        'filter[active]': '[1]',
        limit: '20,10',
        sort: '[date_add_DESC]',
        date: 1,
      })
    })

    it('maps the Inactive status filter', async () => {
      mock.onGet(`${ API }/products`).reply({ products: [] })

      await service.listProducts(undefined, undefined, 'Inactive')

      expect(mock.history[0].query['filter[active]']).toBe('[0]')
    })

    it('returns an empty array when PrestaShop responds with an array', async () => {
      mock.onGet(`${ API }/products`).reply([])

      const result = await service.listProducts()

      expect(result).toEqual([])
    })
  })

  describe('getProduct', () => {
    it('unwraps the product envelope', async () => {
      mock.onGet(`${ API }/products/22`).reply({ product: { id: 22, name: 'Red T-Shirt' } })

      const result = await service.getProduct(22)

      expect(result).toEqual({ id: 22, name: 'Red T-Shirt' })
      expect(mock.history[0].query).toEqual({ output_format: 'JSON', language: '1' })
    })

    it('returns the raw response when there is no envelope', async () => {
      mock.onGet(`${ API }/products/22`).reply({ id: 22 })

      const result = await service.getProduct(22)

      expect(result).toEqual({ id: 22 })
    })
  })

  describe('createProduct', () => {
    it('builds the minimal XML document with an auto-generated slug', async () => {
      mock.onPost(`${ API }/products`).reply({ product: { id: 22 } })

      const result = await service.createProduct('Red T-Shirt', '19.99')

      expect(result).toEqual({ id: 22 })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'text/xml' })

      expect(mock.history[0].body).toBe(
        `${ XML_PROLOG }<product>` +
        '<name><language id="1"><![CDATA[Red T-Shirt]]></language></name>' +
        '<link_rewrite><language id="1"><![CDATA[red-t-shirt]]></language></link_rewrite>' +
        '<price>19.99</price>' +
        '<active>1</active>' +
        '<state>1</state>' +
        '</product></prestashop>'
      )
    })

    it('includes descriptions, references, weight and category associations', async () => {
      mock.onPost(`${ API }/products`).reply({ product: { id: 23 } })

      await service.createProduct(
        'Blue T-Shirt',
        '24.50',
        'TSHIRT-BLUE',
        false,
        '<p>Full</p>',
        'Short',
        '2',
        ['3', '2', '4'],
        '5',
        0.3,
        'custom-slug'
      )

      const xml = mock.history[0].body

      expect(xml).toContain('<reference>TSHIRT-BLUE</reference>')
      expect(xml).toContain('<active>0</active>')
      expect(xml).toContain('<id_category_default>2</id_category_default>')
      expect(xml).toContain('<id_manufacturer>5</id_manufacturer>')
      expect(xml).toContain('<weight>0.3</weight>')
      expect(xml).toContain('<description><language id="1"><![CDATA[<p>Full</p>]]></language></description>')
      expect(xml).toContain('<description_short><language id="1"><![CDATA[Short]]></language></description_short>')
      expect(xml).toContain('<link_rewrite><language id="1"><![CDATA[custom-slug]]></language></link_rewrite>')

      expect(xml).toContain(
        '<associations><categories>' +
        '<category><id>2</id></category>' +
        '<category><id>3</id></category>' +
        '<category><id>4</id></category>' +
        '</categories></associations>'
      )
    })

    it('escapes XML special characters in scalar fields', async () => {
      mock.onPost(`${ API }/products`).reply({ product: { id: 24 } })

      await service.createProduct('Widget', '1.00', 'A&B<C>"D\'E')

      expect(mock.history[0].body).toContain('<reference>A&amp;B&lt;C&gt;&quot;D&apos;E</reference>')
    })

    it('escapes CDATA terminators in multilanguage values', async () => {
      mock.onPost(`${ API }/products`).reply({ product: { id: 25 } })

      await service.createProduct('End ]]> here', '1.00')

      expect(mock.history[0].body).toContain('<![CDATA[End ]]]]><![CDATA[> here]]>')
    })

    it('parses the id out of an XML write response', async () => {
      mock.onPost(`${ API }/products`).reply('<?xml version="1.0"?><prestashop><product><id><![CDATA[ 42]]></id></product></prestashop>')

      const result = await service.createProduct('X', '1.00')

      expect(result).toEqual({ id: 42 })
    })

    it('falls back to a success marker for unparsable write responses', async () => {
      mock.onPost(`${ API }/products`).reply('OK')

      const result = await service.createProduct('X', '1.00')

      expect(result).toEqual({ success: true })
    })
  })

  describe('updateProduct', () => {
    const currentProduct = {
      id: 22,
      reference: 'OLD-REF',
      price: '10.000000',
      active: '1',
      id_category_default: '2',
      name: 'Old Name',
      link_rewrite: 'old-name',
      manufacturer_name: 'Studio Design',
      quantity: 5,
      type: 'simple',
      date_add: '2026-01-05 11:02:37',
      date_upd: '2026-02-05 11:02:37',
      associations: { categories: [{ id: '2' }] },
      meta: { nested: true },
    }

    it('merges the fetched product, strips read-only fields and PUTs XML', async () => {
      mock.onGet(`${ API }/products/22`).reply({ product: currentProduct })
      mock.onPut(`${ API }/products/22`).reply({ product: { id: 22, price: '24.990000' } })

      const result = await service.updateProduct(22, 'New Name', '24.99')

      expect(result).toEqual({ id: 22, price: '24.990000' })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[1].method).toBe('put')

      const xml = mock.history[1].body

      expect(xml).toContain('<id>22</id>')
      expect(xml).toContain('<name><language id="1"><![CDATA[New Name]]></language></name>')
      expect(xml).toContain('<price>24.99</price>')
      expect(xml).toContain('<reference>OLD-REF</reference>')

      expect(xml).not.toContain('manufacturer_name')
      expect(xml).not.toContain('<quantity>')
      expect(xml).not.toContain('date_add')
      expect(xml).not.toContain('date_upd')
      expect(xml).not.toContain('<type>')
      expect(xml).not.toContain('associations')
      expect(xml).not.toContain('nested')
    })

    it('updates every optional field and replaces the category associations', async () => {
      mock.onGet(`${ API }/products/22`).reply({ product: currentProduct })
      mock.onPut(`${ API }/products/22`).reply({ product: { id: 22 } })

      await service.updateProduct(
        22,
        undefined,
        undefined,
        'NEW-REF',
        'Inactive',
        '<p>New full</p>',
        'New short',
        '7',
        ['8', '9'],
        '3',
        1.5,
        'New Slug Value'
      )

      const xml = mock.history[1].body

      expect(xml).toContain('<reference>NEW-REF</reference>')
      expect(xml).toContain('<active>0</active>')
      expect(xml).toContain('<description><language id="1"><![CDATA[<p>New full</p>]]></language></description>')
      expect(xml).toContain('<description_short><language id="1"><![CDATA[New short]]></language></description_short>')
      expect(xml).toContain('<link_rewrite><language id="1"><![CDATA[new-slug-value]]></language></link_rewrite>')
      expect(xml).toContain('<id_category_default>7</id_category_default>')
      expect(xml).toContain('<id_manufacturer>3</id_manufacturer>')
      expect(xml).toContain('<weight>1.5</weight>')

      expect(xml).toContain(
        '<associations><categories>' +
        '<category><id>7</id></category>' +
        '<category><id>8</id></category>' +
        '<category><id>9</id></category>' +
        '</categories></associations>'
      )
    })

    it('preserves other languages when the field arrives as a language array', async () => {
      mock.onGet(`${ API }/products/22`).reply({
        product: {
          id: 22,
          name: [{ id: '1', value: 'English' }, { id: '2', value: 'Français' }],
        },
      })

      mock.onPut(`${ API }/products/22`).reply({ product: { id: 22 } })

      await service.updateProduct(22, 'Updated English')

      expect(mock.history[1].body).toContain(
        '<name>' +
        '<language id="1"><![CDATA[Updated English]]></language>' +
        '<language id="2"><![CDATA[Français]]></language>' +
        '</name>'
      )
    })

    it('appends the configured language when it is missing from the language array', async () => {
      mock.onGet(`${ API }/products/22`).reply({
        product: { id: 22, name: [{ id: '2', value: 'Français' }] },
      })

      mock.onPut(`${ API }/products/22`).reply({ product: { id: 22 } })

      await service.updateProduct(22, 'English value')

      expect(mock.history[1].body).toContain(
        '<name>' +
        '<language id="2"><![CDATA[Français]]></language>' +
        '<language id="1"><![CDATA[English value]]></language>' +
        '</name>'
      )
    })

    it('handles a missing product envelope gracefully', async () => {
      mock.onGet(`${ API }/products/22`).reply({})
      mock.onPut(`${ API }/products/22`).reply({ product: { id: 22 } })

      await service.updateProduct(22)

      expect(mock.history[1].body).toBe(`${ XML_PROLOG }<product><id>22</id></product></prestashop>`)
    })
  })

  describe('deleteProduct', () => {
    it('deletes the product and returns a confirmation', async () => {
      mock.onDelete(`${ API }/products/22`).reply('')

      const result = await service.deleteProduct(22)

      expect(result).toEqual({ success: true, id: 22 })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Stock ──

  describe('listStockAvailables', () => {
    it('lists without a product filter', async () => {
      mock.onGet(`${ API }/stock_availables`).reply({ stock_availables: [{ id: 1 }] })

      const result = await service.listStockAvailables()

      expect(result).toEqual([{ id: 1 }])
      expect(mock.history[0].query).toEqual({ output_format: 'JSON', display: 'full', limit: '50' })
    })

    it('filters by product id and paginates', async () => {
      mock.onGet(`${ API }/stock_availables`).reply({ stock_availables: [] })

      await service.listStockAvailables(1, 5, 10)

      expect(mock.history[0].query).toMatchObject({
        'filter[id_product]': '[1]',
        limit: '10,5',
      })
    })
  })

  describe('getStockAvailable', () => {
    it('unwraps the stock_available envelope', async () => {
      mock.onGet(`${ API }/stock_availables/1`).reply({ stock_available: { id: 1, quantity: 300 } })

      const result = await service.getStockAvailable(1)

      expect(result).toEqual({ id: 1, quantity: 300 })
    })
  })

  describe('updateStockQuantity', () => {
    it('merges the current record with the new quantity', async () => {
      mock.onGet(`${ API }/stock_availables/1`).reply({
        stock_available: {
          id: 1,
          id_product: '1',
          id_product_attribute: '0',
          id_shop: '1',
          id_shop_group: '0',
          quantity: 300,
          depends_on_stock: '0',
          out_of_stock: '2',
          location: 'A1',
        },
      })

      mock.onPut(`${ API }/stock_availables/1`).reply({ stock_available: { id: 1, quantity: 150 } })

      const result = await service.updateStockQuantity(1, 150)

      expect(result).toEqual({ id: 1, quantity: 150 })

      expect(mock.history[1].body).toBe(
        `${ XML_PROLOG }<stock_available>` +
        '<id>1</id>' +
        '<id_product>1</id_product>' +
        '<id_product_attribute>0</id_product_attribute>' +
        '<id_shop>1</id_shop>' +
        '<id_shop_group>0</id_shop_group>' +
        '<quantity>150</quantity>' +
        '<depends_on_stock>0</depends_on_stock>' +
        '<out_of_stock>2</out_of_stock>' +
        '<location>A1</location>' +
        '</stock_available></prestashop>'
      )
    })

    it('maps the out-of-stock behavior and applies defaults for a sparse record', async () => {
      mock.onGet(`${ API }/stock_availables/2`).reply({})
      mock.onPut(`${ API }/stock_availables/2`).reply({ stock_available: { id: 2 } })

      await service.updateStockQuantity(2, 5, 'Allow Backorders')

      expect(mock.history[1].body).toBe(
        `${ XML_PROLOG }<stock_available>` +
        '<id>2</id>' +
        '<id_product_attribute>0</id_product_attribute>' +
        '<quantity>5</quantity>' +
        '<depends_on_stock>0</depends_on_stock>' +
        '<out_of_stock>1</out_of_stock>' +
        '</stock_available></prestashop>'
      )
    })
  })

  // ── Categories ──

  describe('listCategories', () => {
    it('applies the defaults', async () => {
      mock.onGet(`${ API }/categories`).reply({ categories: [{ id: 3 }] })

      const result = await service.listCategories()

      expect(result).toEqual([{ id: 3 }])

      expect(mock.history[0].query).toEqual({
        output_format: 'JSON',
        display: 'full',
        language: '1',
        limit: '50',
      })
    })

    it('applies the name and active filters', async () => {
      mock.onGet(`${ API }/categories`).reply({ categories: [] })

      await service.listCategories('clothes', 'Inactive', 5, 5)

      expect(mock.history[0].query).toMatchObject({
        'filter[name]': '%[clothes]%',
        'filter[active]': '[0]',
        limit: '5,5',
      })
    })
  })

  describe('getCategory', () => {
    it('unwraps the category envelope', async () => {
      mock.onGet(`${ API }/categories/3`).reply({ category: { id: 3, name: 'Clothes' } })

      const result = await service.getCategory(3)

      expect(result).toEqual({ id: 3, name: 'Clothes' })
    })
  })

  describe('createCategory', () => {
    it('builds the category XML with a slug derived from the name', async () => {
      mock.onPost(`${ API }/categories`).reply({ category: { id: 12 } })

      const result = await service.createCategory('Accessories & More', '2')

      expect(result).toEqual({ id: 12 })

      expect(mock.history[0].body).toBe(
        `${ XML_PROLOG }<category>` +
        '<name><language id="1"><![CDATA[Accessories & More]]></language></name>' +
        '<link_rewrite><language id="1"><![CDATA[accessories-more]]></language></link_rewrite>' +
        '<id_parent>2</id_parent>' +
        '<active>1</active>' +
        '</category></prestashop>'
      )
    })

    it('includes the description and honours an explicit inactive flag', async () => {
      mock.onPost(`${ API }/categories`).reply({ category: { id: 13 } })

      await service.createCategory('Shoes', '2', false, 'Nice shoes', 'shoes-slug')

      const xml = mock.history[0].body

      expect(xml).toContain('<active>0</active>')
      expect(xml).toContain('<description><language id="1"><![CDATA[Nice shoes]]></language></description>')
      expect(xml).toContain('<link_rewrite><language id="1"><![CDATA[shoes-slug]]></language></link_rewrite>')
    })
  })

  // ── Customers ──

  describe('listCustomers', () => {
    it('applies the defaults', async () => {
      mock.onGet(`${ API }/customers`).reply({ customers: [{ id: 2 }] })

      const result = await service.listCustomers()

      expect(result).toEqual([{ id: 2 }])
      expect(mock.history[0].query).toEqual({ output_format: 'JSON', display: 'full', limit: '50' })
    })

    it('applies the contains filters', async () => {
      mock.onGet(`${ API }/customers`).reply({ customers: [] })

      await service.listCustomers('john', 'John', 'Doe', 10)

      expect(mock.history[0].query).toMatchObject({
        'filter[email]': '%[john]%',
        'filter[firstname]': '%[John]%',
        'filter[lastname]': '%[Doe]%',
        limit: '10',
      })
    })
  })

  describe('getCustomer', () => {
    it('unwraps the customer envelope', async () => {
      mock.onGet(`${ API }/customers/2`).reply({ customer: { id: 2, email: 'john@example.com' } })

      const result = await service.getCustomer(2)

      expect(result).toEqual({ id: 2, email: 'john@example.com' })
    })
  })

  describe('createCustomer', () => {
    it('builds the customer XML with the default flags', async () => {
      mock.onPost(`${ API }/customers`).reply({ customer: { id: 15 } })

      const result = await service.createCustomer('Jane', 'Smith', 'jane@example.com', 'secret123')

      expect(result).toEqual({ id: 15 })

      expect(mock.history[0].body).toBe(
        `${ XML_PROLOG }<customer>` +
        '<firstname>Jane</firstname>' +
        '<lastname>Smith</lastname>' +
        '<email>jane@example.com</email>' +
        '<passwd>secret123</passwd>' +
        '<active>1</active>' +
        '<newsletter>0</newsletter>' +
        '<optin>0</optin>' +
        '</customer></prestashop>'
      )
    })

    it('honours the boolean-ish flags and the default group', async () => {
      mock.onPost(`${ API }/customers`).reply({ customer: { id: 16 } })

      await service.createCustomer('Jane', 'Smith', 'jane@example.com', 'secret123', false, '1', true, '3')

      const xml = mock.history[0].body

      expect(xml).toContain('<active>0</active>')
      expect(xml).toContain('<newsletter>1</newsletter>')
      expect(xml).toContain('<optin>1</optin>')
      expect(xml).toContain('<id_default_group>3</id_default_group>')
    })
  })

  describe('updateCustomer', () => {
    const currentCustomer = {
      id: 15,
      firstname: 'Jane',
      lastname: 'Smith',
      email: 'jane@example.com',
      passwd: '$2y$hashed',
      active: '1',
      newsletter: '0',
      optin: '0',
      secure_key: 'abc',
      last_passwd_gen: '2026-01-01',
      reset_password_token: 'tok',
      reset_password_validity: '0',
      date_add: '2026-01-05 11:02:41',
      date_upd: '2026-02-05 11:02:41',
      associations: { groups: [{ id: '3' }] },
    }

    it('merges the fetched customer and strips read-only fields', async () => {
      mock.onGet(`${ API }/customers/15`).reply({ customer: currentCustomer })
      mock.onPut(`${ API }/customers/15`).reply({ customer: { id: 15 } })

      const result = await service.updateCustomer(15, 'Janet')

      expect(result).toEqual({ id: 15 })

      const xml = mock.history[1].body

      expect(xml).toContain('<firstname>Janet</firstname>')
      expect(xml).toContain('<passwd>$2y$hashed</passwd>')

      expect(xml).not.toContain('secure_key')
      expect(xml).not.toContain('last_passwd_gen')
      expect(xml).not.toContain('reset_password_token')
      expect(xml).not.toContain('date_add')
      expect(xml).not.toContain('associations')
    })

    it('maps every status dropdown', async () => {
      mock.onGet(`${ API }/customers/15`).reply({ customer: currentCustomer })
      mock.onPut(`${ API }/customers/15`).reply({ customer: { id: 15 } })

      await service.updateCustomer(15, undefined, 'Smith-Jones', 'new@example.com', 'Inactive', 'Subscribed', 'Opted In')

      const xml = mock.history[1].body

      expect(xml).toContain('<lastname>Smith-Jones</lastname>')
      expect(xml).toContain('<email>new@example.com</email>')
      expect(xml).toContain('<active>0</active>')
      expect(xml).toContain('<newsletter>1</newsletter>')
      expect(xml).toContain('<optin>1</optin>')
    })

    it('maps the negative status dropdowns', async () => {
      mock.onGet(`${ API }/customers/15`).reply({ customer: currentCustomer })
      mock.onPut(`${ API }/customers/15`).reply({ customer: { id: 15 } })

      await service.updateCustomer(15, undefined, undefined, undefined, 'Active', 'Unsubscribed', 'Opted Out')

      const xml = mock.history[1].body

      expect(xml).toContain('<active>1</active>')
      expect(xml).toContain('<newsletter>0</newsletter>')
      expect(xml).toContain('<optin>0</optin>')
    })

    it('handles a missing customer envelope', async () => {
      mock.onGet(`${ API }/customers/15`).reply({})
      mock.onPut(`${ API }/customers/15`).reply({ customer: { id: 15 } })

      await service.updateCustomer(15)

      expect(mock.history[1].body).toBe(`${ XML_PROLOG }<customer><id>15</id></customer></prestashop>`)
    })
  })

  describe('deleteCustomer', () => {
    it('deletes the customer and returns a confirmation', async () => {
      mock.onDelete(`${ API }/customers/15`).reply('')

      const result = await service.deleteCustomer(15)

      expect(result).toEqual({ success: true, id: 15 })
    })
  })

  // ── Orders ──

  describe('listOrders', () => {
    it('defaults to newest first', async () => {
      mock.onGet(`${ API }/orders`).reply({ orders: [{ id: 5 }] })

      const result = await service.listOrders()

      expect(result).toEqual([{ id: 5 }])

      expect(mock.history[0].query).toEqual({
        output_format: 'JSON',
        display: 'full',
        limit: '50',
        sort: '[id_DESC]',
      })
    })

    it('applies the state, reference and sort direction filters', async () => {
      mock.onGet(`${ API }/orders`).reply({ orders: [] })

      await service.listOrders('2', 'XKBKNABJK', undefined, undefined, 10, 5, 'Ascending')

      expect(mock.history[0].query).toMatchObject({
        'filter[current_state]': '[2]',
        'filter[reference]': '[XKBKNABJK]',
        limit: '5,10',
        sort: '[id_ASC]',
      })
    })

    it('normalizes a date-only range', async () => {
      mock.onGet(`${ API }/orders`).reply({ orders: [] })

      await service.listOrders(undefined, undefined, '2026-07-01', '2026-07-13')

      expect(mock.history[0].query['filter[date_add]']).toBe('[2026-07-01 00:00:00,2026-07-13 23:59:59]')
      expect(mock.history[0].query.date).toBe(1)
    })

    it('normalizes epoch milliseconds and passes full datetimes through', async () => {
      mock.onGet(`${ API }/orders`).reply({ orders: [] })

      await service.listOrders(undefined, undefined, '1767225600000', '2026-07-13 12:30:00')

      expect(mock.history[0].query['filter[date_add]'])
        .toBe(`[${ new Date(1767225600000).toISOString().slice(0, 19).replace('T', ' ') },2026-07-13 12:30:00]`)
    })

    it('fills in open-ended bounds when only one date is given', async () => {
      mock.onGet(`${ API }/orders`).reply({ orders: [] })

      await service.listOrders(undefined, undefined, undefined, '2026-07-13')

      expect(mock.history[0].query['filter[date_add]']).toBe('[1970-01-01 00:00:00,2026-07-13 23:59:59]')
    })
  })

  describe('getOrder', () => {
    it('unwraps the order envelope', async () => {
      mock.onGet(`${ API }/orders/5`).reply({ order: { id: 5, reference: 'XKBKNABJK' } })

      const result = await service.getOrder(5)

      expect(result).toEqual({ id: 5, reference: 'XKBKNABJK' })
    })
  })

  describe('updateOrderStatus', () => {
    it('creates an order history record', async () => {
      mock.onPost(`${ API }/order_histories`).reply({ order_history: { id: 31, id_order: '5' } })

      const result = await service.updateOrderStatus(5, '4')

      expect(result).toEqual({ id: 31, id_order: '5' })

      expect(mock.history[0].body).toBe(
        `${ XML_PROLOG }<order_history>` +
        '<id_order>5</id_order>' +
        '<id_order_state>4</id_order_state>' +
        '</order_history></prestashop>'
      )
    })
  })

  describe('listOrderStates', () => {
    it('lists the configured order states', async () => {
      mock.onGet(`${ API }/order_states`).reply({ order_states: [{ id: 2, name: 'Payment accepted' }] })

      const result = await service.listOrderStates()

      expect(result).toEqual([{ id: 2, name: 'Payment accepted' }])
      expect(mock.history[0].query).toEqual({ output_format: 'JSON', display: 'full', language: '1' })
    })
  })

  // ── Addresses & carts ──

  describe('listAddresses', () => {
    it('lists without a filter', async () => {
      mock.onGet(`${ API }/addresses`).reply({ addresses: [{ id: 4 }] })

      const result = await service.listAddresses()

      expect(result).toEqual([{ id: 4 }])
      expect(mock.history[0].query).toEqual({ output_format: 'JSON', display: 'full', limit: '50' })
    })

    it('filters by customer id', async () => {
      mock.onGet(`${ API }/addresses`).reply({ addresses: [] })

      await service.listAddresses(2, 5, 5)

      expect(mock.history[0].query).toMatchObject({ 'filter[id_customer]': '[2]', limit: '5,5' })
    })
  })

  describe('getAddress', () => {
    it('unwraps the address envelope', async () => {
      mock.onGet(`${ API }/addresses/4`).reply({ address: { id: 4, city: 'Paris' } })

      const result = await service.getAddress(4)

      expect(result).toEqual({ id: 4, city: 'Paris' })
    })
  })

  describe('listCarts', () => {
    it('filters by customer id', async () => {
      mock.onGet(`${ API }/carts`).reply({ carts: [{ id: 5 }] })

      const result = await service.listCarts(2)

      expect(result).toEqual([{ id: 5 }])
      expect(mock.history[0].query).toMatchObject({ 'filter[id_customer]': '[2]' })
    })
  })

  describe('getCart', () => {
    it('unwraps the cart envelope', async () => {
      mock.onGet(`${ API }/carts/5`).reply({ cart: { id: 5 } })

      const result = await service.getCart(5)

      expect(result).toEqual({ id: 5 })
    })
  })

  // ── Store reference ──

  describe('listManufacturers', () => {
    it('applies the name filter', async () => {
      mock.onGet(`${ API }/manufacturers`).reply({ manufacturers: [{ id: 1 }] })

      const result = await service.listManufacturers('studio', 10, 10)

      expect(result).toEqual([{ id: 1 }])

      expect(mock.history[0].query).toMatchObject({
        'filter[name]': '%[studio]%',
        limit: '10,10',
        language: '1',
      })
    })
  })

  describe('listLanguages', () => {
    it('lists installed languages', async () => {
      mock.onGet(`${ API }/languages`).reply({ languages: [{ id: 1, iso_code: 'en' }] })

      const result = await service.listLanguages()

      expect(result).toEqual([{ id: 1, iso_code: 'en' }])
    })
  })

  describe('listCurrencies', () => {
    it('lists currencies with the default limit', async () => {
      mock.onGet(`${ API }/currencies`).reply({ currencies: [{ id: 1, iso_code: 'EUR' }] })

      const result = await service.listCurrencies()

      expect(result).toEqual([{ id: 1, iso_code: 'EUR' }])
      expect(mock.history[0].query).toMatchObject({ limit: '50', language: '1' })
    })

    it('honours a custom limit', async () => {
      mock.onGet(`${ API }/currencies`).reply({ currencies: [] })

      await service.listCurrencies(3)

      expect(mock.history[0].query.limit).toBe('3')
    })
  })

  // ── Advanced ──

  describe('callWebserviceResource', () => {
    it('normalizes the resource path and merges query params', async () => {
      mock.onGet(`${ API }/combinations`).reply({ combinations: [{ id: 1 }] })

      const result = await service.callWebserviceResource('/api/combinations', 'GET', {
        display: 'full',
        'filter[id_product]': '[1]',
      })

      expect(result).toEqual({ combinations: [{ id: 1 }] })

      expect(mock.history[0].query).toEqual({
        output_format: 'JSON',
        display: 'full',
        'filter[id_product]': '[1]',
      })
    })

    it('defaults to GET and ignores an XML body for reads', async () => {
      mock.onGet(`${ API }/taxes`).reply({ taxes: [] })

      await service.callWebserviceResource('taxes', undefined, undefined, '<xml/>')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].body).toBeUndefined()
      expect(mock.history[0].headers).not.toHaveProperty('Content-Type')
    })

    it('sends the XML body for writes', async () => {
      mock.onPost(`${ API }/specific_prices`).reply({ specific_price: { id: 3 } })

      const result = await service.callWebserviceResource(
        'specific_prices',
        'POST',
        {},
        '<?xml version="1.0"?><prestashop></prestashop>'
      )

      expect(result).toEqual({ specific_price: { id: 3 } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toBe('<?xml version="1.0"?><prestashop></prestashop>')
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'text/xml' })
    })

    it('returns a success marker for an empty response', async () => {
      mock.onDelete(`${ API }/taxes/9`).reply('')

      const result = await service.callWebserviceResource('taxes/9', 'DELETE')

      expect(result).toEqual({ success: true })
    })

    it('wraps a non-object response under raw', async () => {
      mock.onGet(`${ API }/zones`).reply('<prestashop/>')

      const result = await service.callWebserviceResource('zones', 'GET')

      expect(result).toEqual({ raw: '<prestashop/>' })
    })
  })

  // ── Dictionaries ──

  describe('getOrderStatesDictionary', () => {
    it('maps states with their flags', async () => {
      mock.onGet(`${ API }/order_states`).reply({
        order_states: [
          { id: 2, name: 'Payment accepted', paid: '1', shipped: '0', delivery: '0' },
          { id: 4, name: 'Shipped', paid: '0', shipped: '1', delivery: '1' },
          { id: 6, name: 'Canceled', paid: '0', shipped: '0', delivery: '0' },
        ],
      })

      const result = await service.getOrderStatesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Payment accepted', value: '2', note: 'paid' },
          { label: 'Shipped', value: '4', note: 'shipped, delivery' },
          { label: 'Canceled', value: '6', note: undefined },
        ],
        cursor: null,
      })

      expect(mock.history[0].query).toMatchObject({ limit: '0,50', display: 'full', language: '1' })
    })

    it('applies the search filter and paginates on a full page', async () => {
      mock.onGet(`${ API }/order_states`).reply({
        order_states: Array.from({ length: 50 }, (_, index) => ({ id: index + 1, name: `State ${ index + 1 }` })),
      })

      const result = await service.getOrderStatesDictionary({ search: 'ship', cursor: '50' })

      expect(mock.history[0].query).toMatchObject({ 'filter[name]': '%[ship]%', limit: '50,50' })
      expect(result.cursor).toBe('100')
      expect(result.items).toHaveLength(50)
    })

    it('handles a null payload and an empty array response', async () => {
      mock.onGet(`${ API }/order_states`).reply([])

      const result = await service.getOrderStatesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getCategoriesDictionary', () => {
    it('maps categories to dictionary items', async () => {
      mock.onGet(`${ API }/categories`).reply({ categories: [{ id: 3, name: 'Clothes' }] })

      const result = await service.getCategoriesDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Clothes', value: '3', note: 'ID 3' }],
        cursor: null,
      })

      expect(mock.history[0].query).toMatchObject({
        display: '[id,name]',
        language: '1',
        limit: '0,50',
        sort: '[id_ASC]',
      })
    })

    it('applies the search filter', async () => {
      mock.onGet(`${ API }/categories`).reply({ categories: [] })

      await service.getCategoriesDictionary({ search: 'cloth' })

      expect(mock.history[0].query['filter[name]']).toBe('%[cloth]%')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ API }/categories`).reply([])

      const result = await service.getCategoriesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getManufacturersDictionary', () => {
    it('maps manufacturers to dictionary items sorted by name', async () => {
      mock.onGet(`${ API }/manufacturers`).reply({ manufacturers: [{ id: 1, name: 'Studio Design' }] })

      const result = await service.getManufacturersDictionary({ search: 'studio' })

      expect(result).toEqual({
        items: [{ label: 'Studio Design', value: '1', note: 'ID 1' }],
        cursor: null,
      })

      expect(mock.history[0].query).toMatchObject({
        display: '[id,name]',
        'filter[name]': '%[studio]%',
        sort: '[name_ASC]',
        limit: '0,50',
      })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ API }/manufacturers`).reply([])

      const result = await service.getManufacturersDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getLanguagesDictionary', () => {
    it('maps languages with the ISO code as the note', async () => {
      mock.onGet(`${ API }/languages`).reply({
        languages: [
          { id: 1, name: 'English (English)', iso_code: 'en' },
          { id: 2, name: 'Français', iso_code: '' },
        ],
      })

      const result = await service.getLanguagesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'English (English)', value: '1', note: 'en' },
          { label: 'Français', value: '2', note: undefined },
        ],
        cursor: null,
      })
    })

    it('applies the search filter and handles a null payload', async () => {
      mock.onGet(`${ API }/languages`).reply({ languages: [] })

      await service.getLanguagesDictionary({ search: 'eng' })

      expect(mock.history[0].query['filter[name]']).toBe('%[eng]%')

      mock.reset()
      mock.onGet(`${ API }/languages`).reply([])

      const result = await service.getLanguagesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})

// ── Alternate configuration ──

describe('PrestaShop Service (alternate configuration)', () => {
  let previousFlowrunner
  let altSandbox
  let altService
  let altMock

  beforeAll(() => {
    previousFlowrunner = global.Flowrunner

    jest.resetModules()

    altSandbox = createSandbox({ storeUrl: STORE_URL, apiKey: API_KEY })

    require('../src/index.js')

    altService = altSandbox.getService()
    altMock = altSandbox.getRequestMock()
  })

  afterEach(() => {
    altMock.reset()
  })

  afterAll(() => {
    altSandbox.cleanup()
    jest.resetModules()
    global.Flowrunner = previousFlowrunner
  })

  it('defaults the language id to 1', () => {
    expect(altService.languageId).toBe('1')
  })

  it('uses the default language id in multilanguage writes', async () => {
    altMock.onPost(`${ API }/categories`).reply({ category: { id: 12 } })

    await altService.createCategory('Accessories', '2')

    expect(altMock.history[0].body).toContain('<language id="1">')
  })
})
