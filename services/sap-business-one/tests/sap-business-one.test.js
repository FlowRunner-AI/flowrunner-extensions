'use strict'

const { createSandbox } = require('../../../service-sandbox')

const BASE_URL = 'https://b1.example.com:50000'
const BASE = `${ BASE_URL }/b1s/v1`
const COMPANY_DB = 'SBODEMOUS'
const USERNAME = 'manager'
const PASSWORD = 'secret'
const COOKIE = 'B1SESSION=abc123; ROUTEID=.node1'

const AUTH_HEADERS = { 'Content-Type': 'application/json', Cookie: COOKIE }

const LINES = [
  { ItemCode: 'i1', Quantity: 2, UnitPrice: 10, TaxCode: 'T1', WarehouseCode: '01', DiscountPercent: 5, Ignored: 'x' },
]

const MAPPED_LINES = [
  { ItemCode: 'i1', Quantity: 2, UnitPrice: 10, TaxCode: 'T1', WarehouseCode: '01', DiscountPercent: 5 },
]

describe('SAP Business One Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ baseUrl: `${ BASE_URL }/`, companyDB: COMPANY_DB, username: USERNAME, password: PASSWORD })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  beforeEach(() => {
    // Most tests exercise Service Layer calls, not the login handshake, so start with a live
    // session. The login flow itself is covered in its own describe below (which clears it).
    service.session = { cookie: COOKIE, sessionId: 'abc123' }
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration & construction ──

  describe('service registration', () => {
    it('registers the required config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['baseUrl', 'companyDB', 'username', 'password'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'baseUrl', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'companyDB', required: true, shared: false }),
          expect.objectContaining({ name: 'username', required: true, shared: false }),
          expect.objectContaining({ name: 'password', required: true, shared: false }),
        ])
      )
    })

    it('strips trailing slashes from the base URL', () => {
      expect(service.baseUrl).toBe(BASE_URL)
      expect(service.companyDB).toBe(COMPANY_DB)
    })

    it('tolerates a missing config object', () => {
      const bare = new service.constructor()

      expect(bare.baseUrl).toBe('')
      expect(bare.session).toBeNull()
    })
  })

  // ── Session handling ──

  describe('session handling', () => {
    beforeEach(() => {
      service.session = null
    })

    it('logs in once and reuses the cookie for later calls', async () => {
      mock.onPost(`${ BASE }/Login`).reply({
        headers: { 'set-cookie': ['B1SESSION=abc123; path=/; HttpOnly', 'ROUTEID=.node1; path=/'] },
        body: { SessionId: 'abc123' },
      })

      mock.onGet(`${ BASE }/Items`).reply({ value: [] })

      await service.listItems()

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/Login`)
      expect(mock.history[0].unwrapBody).toBe(false)
      expect(mock.history[0].body).toEqual({ CompanyDB: COMPANY_DB, UserName: USERNAME, Password: PASSWORD })
      expect(mock.history[1].headers).toEqual(AUTH_HEADERS)

      expect(service.session).toEqual({ cookie: COOKIE, sessionId: 'abc123' })

      await service.listItems()

      expect(mock.history.filter(call => call.url.endsWith('/Login'))).toHaveLength(1)
    })

    it('accepts a single set-cookie string', async () => {
      mock.onPost(`${ BASE }/Login`).reply({ headers: { 'Set-Cookie': 'B1SESSION=solo; path=/' }, body: {} })
      mock.onGet(`${ BASE }/Items`).reply({ value: [] })

      await service.listItems()

      expect(service.session).toEqual({ cookie: 'B1SESSION=solo', sessionId: null })
    })

    it('throws when the login response carries no cookie', async () => {
      mock.onPost(`${ BASE }/Login`).reply({ headers: {}, body: {} })

      await expect(service.listItems()).rejects.toThrow(/login did not return a session cookie/)
    })

    it('throws when the service is not configured', async () => {
      const unconfigured = new service.constructor({ baseUrl: BASE_URL })

      await expect(unconfigured.listItems()).rejects.toThrow(/SAP Business One is not configured/)
      expect(mock.history).toHaveLength(0)
    })

    it('re-authenticates once and retries after a 401', async () => {
      let attempts = 0

      mock.onPost(`${ BASE }/Login`).reply({
        headers: { 'set-cookie': ['B1SESSION=abc123', 'ROUTEID=.node1'] },
        body: { SessionId: 'abc123' },
      })

      mock.onGet(`${ BASE }/Items`).replyWith(() => {
        attempts += 1

        if (attempts === 1) {
          throw Object.assign(new Error('Unauthorized'), { status: 401 })
        }

        return { value: [{ ItemCode: 'i1' }] }
      })

      const result = await service.listItems()

      expect(result).toEqual({ value: [{ ItemCode: 'i1' }], count: 1, pagesFollowed: 1 })
      expect(mock.history.filter(call => call.url.endsWith('/Login'))).toHaveLength(2)
    })

    it('gives up after a second 401', async () => {
      mock.onPost(`${ BASE }/Login`).reply({ headers: { 'set-cookie': ['B1SESSION=abc123'] }, body: {} })
      mock.onGet(`${ BASE }/Items`).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.listItems()).rejects.toThrow('Unauthorized')
    })
  })

  // ── Error mapping ──

  describe('error handling', () => {
    it('surfaces the OData error message value', async () => {
      mock.onGet(`${ BASE }/Items`).replyWithError({
        message: 'Request failed',
        status: 400,
        body: { error: { message: { value: 'Invalid field' } } },
      })

      await expect(service.listItems()).rejects.toThrow('Invalid field')
    })

    it('adds guidance for a 404', async () => {
      mock.onGet(`${ BASE }/Items('missing')`).replyWithError({
        message: 'Request failed',
        status: 404,
        body: { error: { message: 'Item not found' } },
      })

      await expect(service.getItem('missing')).rejects.toThrow(/Not found — the record may not exist.*Item not found/)
    })

    it('falls back to body.message and then the raw error message', async () => {
      mock.onGet(`${ BASE }/Items('a')`).replyWithError({ message: 'boom', body: { message: 'server exploded' } })

      await expect(service.getItem('a')).rejects.toThrow('server exploded')

      mock.reset()
      mock.onGet(`${ BASE }/Items('b')`).replyWithError({ message: 'network down' })

      await expect(service.getItem('b')).rejects.toThrow('network down')
    })
  })

  // ── Pagination ──

  describe('pagination', () => {
    it('follows odata.nextLink until it is absent', async () => {
      mock.onGet(`${ BASE }/Orders`).reply({ value: [{ DocEntry: 1 }], 'odata.nextLink': '/b1s/v1/Orders?$skip=20' })
      mock.onGet(`${ BASE }/Orders?$skip=20`).reply({ value: [{ DocEntry: 2 }] })

      const result = await service.listOrders()

      expect(result).toEqual({ value: [{ DocEntry: 1 }, { DocEntry: 2 }], count: 2, pagesFollowed: 2 })
    })

    it('accepts a relative nextLink without the service path prefix', async () => {
      mock.onGet(`${ BASE }/Orders`).reply({ value: [{ DocEntry: 1 }], 'odata.nextLink': 'Orders?$skip=20' })
      mock.onGet(`${ BASE }/Orders?$skip=20`).reply({ value: [{ DocEntry: 2 }] })

      const result = await service.listOrders()

      expect(result.count).toBe(2)
    })

    it('stops once maxResults is reached and truncates the rows', async () => {
      mock.onGet(`${ BASE }/Orders`).reply({
        value: [{ DocEntry: 1 }, { DocEntry: 2 }, { DocEntry: 3 }],
        'odata.nextLink': 'Orders?$skip=20',
      })

      const result = await service.listOrders(undefined, undefined, 2)

      expect(result).toEqual({ value: [{ DocEntry: 1 }, { DocEntry: 2 }], count: 2, pagesFollowed: 1 })
      expect(mock.history).toHaveLength(1)
    })

    it('handles a response without a value array', async () => {
      mock.onGet(`${ BASE }/Orders`).reply({})

      await expect(service.listOrders()).resolves.toEqual({ value: [], count: 0, pagesFollowed: 1 })
    })
  })

  // ── Business partners ──

  describe('business partners', () => {
    it('creates a partner, mapping the type label', async () => {
      mock.onPost(`${ BASE }/BusinessPartners`).reply({ CardCode: 'c1' })

      const result = await service.createBusinessPartner('Acme', 'Customer', 'c1', 100, '555', 'hi@acme.com')

      expect(result).toEqual({ CardCode: 'c1' })

      expect(mock.history[0].body).toEqual({
        CardName: 'Acme',
        CardType: 'cCustomer',
        CardCode: 'c1',
        GroupCode: 100,
        Phone1: '555',
        EmailAddress: 'hi@acme.com',
      })
    })

    it.each([
      ['Customer', 'cCustomer'],
      ['Vendor / Supplier', 'cSupplier'],
      ['Lead', 'cLead'],
      ['cSupplier', 'cSupplier'],
    ])('maps the %s card type', async (input, expected) => {
      mock.onPost(`${ BASE }/BusinessPartners`).reply({})

      await service.createBusinessPartner('Acme', input)

      expect(mock.history[0].body).toEqual({ CardName: 'Acme', CardType: expected })
    })

    it('requires a name', async () => {
      await expect(service.createBusinessPartner()).rejects.toThrow('Name is required to create a business partner.')
      expect(mock.history).toHaveLength(0)
    })

    it('gets a partner by code', async () => {
      mock.onGet(`${ BASE }/BusinessPartners('c1')`).reply({ CardCode: 'c1' })

      await expect(service.getBusinessPartner('c1')).resolves.toEqual({ CardCode: 'c1' })
      await expect(service.getBusinessPartner('')).rejects.toThrow('Business Partner code is required.')
    })

    it('lists partners filtered by type and search text', async () => {
      mock.onGet(`${ BASE }/BusinessPartners`).reply({ value: [{ CardCode: 'c1' }] })

      const result = await service.listBusinessPartners('Customer', "O'Brien", 10)

      expect(result).toEqual({ value: [{ CardCode: 'c1' }], count: 1, pagesFollowed: 1 })

      expect(mock.history[0].query).toEqual({
        $filter: "CardType eq 'cCustomer' and (contains(CardName,'O''Brien') or contains(CardCode,'O''Brien'))",
      })
    })

    it('lists partners without any filter', async () => {
      mock.onGet(`${ BASE }/BusinessPartners`).reply({ value: [] })

      await service.listBusinessPartners()

      expect(mock.history[0].query).toEqual({})
    })

    it('updates a partner with only the supplied fields', async () => {
      mock.onPatch(`${ BASE }/BusinessPartners('c1')`).reply({})

      const result = await service.updateBusinessPartner('c1', 'Acme Ltd', undefined, 'new@acme.com')

      expect(result).toEqual({ CardCode: 'c1', updated: true })
      expect(mock.history[0].body).toEqual({ CardName: 'Acme Ltd', EmailAddress: 'new@acme.com' })
      await expect(service.updateBusinessPartner('')).rejects.toThrow('Business Partner code is required.')
    })

    it('deletes a partner', async () => {
      mock.onDelete(`${ BASE }/BusinessPartners('c1')`).reply({})

      await expect(service.deleteBusinessPartner('c1')).resolves.toEqual({ CardCode: 'c1', deleted: true })
      await expect(service.deleteBusinessPartner()).rejects.toThrow('Business Partner code is required.')
    })
  })

  // ── Contacts ──

  describe('contacts', () => {
    it('adds a contact by patching the partner', async () => {
      mock.onPatch(`${ BASE }/BusinessPartners('c1')`).reply({})

      const result = await service.createContact('c1', 'Jane Doe', 'Jane', 'Doe', '555', 'jane@acme.com')

      expect(result).toEqual({ CardCode: 'c1', contactAdded: 'Jane Doe' })

      expect(mock.history[0].body).toEqual({
        ContactEmployees: [{ Name: 'Jane Doe', FirstName: 'Jane', LastName: 'Doe', Phone1: '555', E_Mail: 'jane@acme.com' }],
      })
    })

    it('validates the contact arguments', async () => {
      await expect(service.createContact('', 'Jane')).rejects.toThrow('Business Partner code is required.')
      await expect(service.createContact('c1')).rejects.toThrow('Contact Name is required.')
      expect(mock.history).toHaveLength(0)
    })

    it('gets the contacts of a partner', async () => {
      mock.onGet(`${ BASE }/BusinessPartners('c1')`).reply({ CardCode: 'c1', ContactEmployees: [] })

      await service.getContacts('c1')

      expect(mock.history[0].query).toEqual({ $select: 'CardCode,ContactEmployees' })
      await expect(service.getContacts()).rejects.toThrow('Business Partner code is required.')
    })

    it('lists partners with their contacts', async () => {
      mock.onGet(`${ BASE }/BusinessPartners`).reply({ value: [{ CardCode: 'c1' }] })

      await service.listContacts('acme', 5)

      expect(mock.history[0].query).toEqual({
        $select: 'CardCode,CardName,ContactEmployees',
        $filter: "contains(CardName,'acme') or contains(CardCode,'acme')",
      })
    })

    it('updates a contact by internal code', async () => {
      mock.onPatch(`${ BASE }/BusinessPartners('c1')`).reply({})

      const result = await service.updateContact('c1', 1, '555', 'jane@acme.com')

      expect(result).toEqual({ CardCode: 'c1', internalCode: 1, updated: true })
      expect(mock.history[0].body).toEqual({ ContactEmployees: [{ InternalCode: 1, Phone1: '555', E_Mail: 'jane@acme.com' }] })

      await expect(service.updateContact('', 1)).rejects.toThrow('Business Partner code is required.')
      await expect(service.updateContact('c1')).rejects.toThrow('Contact Internal Code is required.')
    })
  })

  // ── Items, warehouses, price lists ──

  describe('items', () => {
    it('creates an item with tYES/tNO flags', async () => {
      mock.onPost(`${ BASE }/Items`).reply({ ItemCode: 'i1' })

      await service.createItem('i1', 'Widget', 100, true, false, true)

      expect(mock.history[0].body).toEqual({
        ItemCode: 'i1',
        ItemName: 'Widget',
        ItemsGroupCode: 100,
        InventoryItem: 'tYES',
        SalesItem: 'tNO',
        PurchaseItem: 'tYES',
      })
    })

    it('omits optional item flags when not supplied', async () => {
      mock.onPost(`${ BASE }/Items`).reply({})

      await service.createItem('i1', 'Widget')

      expect(mock.history[0].body).toEqual({ ItemCode: 'i1', ItemName: 'Widget' })
    })

    it('validates the item arguments', async () => {
      await expect(service.createItem('', 'Widget')).rejects.toThrow('Item Code is required.')
      await expect(service.createItem('i1')).rejects.toThrow('Item Name is required.')
      await expect(service.getItem()).rejects.toThrow('Item Code is required.')
      await expect(service.updateItem()).rejects.toThrow('Item Code is required.')
      await expect(service.deleteItem()).rejects.toThrow('Item Code is required.')
    })

    it('gets, lists, updates and deletes an item', async () => {
      mock.onGet(`${ BASE }/Items('i1')`).reply({ ItemCode: 'i1' })
      mock.onGet(`${ BASE }/Items`).reply({ value: [{ ItemCode: 'i1' }] })
      mock.onPatch(`${ BASE }/Items('i1')`).reply({})
      mock.onDelete(`${ BASE }/Items('i1')`).reply({})

      await expect(service.getItem('i1')).resolves.toEqual({ ItemCode: 'i1' })
      await expect(service.listItems('widget', 5)).resolves.toMatchObject({ count: 1 })
      expect(mock.history[1].query).toEqual({ $filter: "contains(ItemName,'widget') or contains(ItemCode,'widget')" })

      await expect(service.updateItem('i1', 'New name')).resolves.toEqual({ ItemCode: 'i1', updated: true })
      expect(mock.history[2].body).toEqual({ ItemName: 'New name' })

      await expect(service.deleteItem('i1')).resolves.toEqual({ ItemCode: 'i1', deleted: true })
    })
  })

  describe('warehouses', () => {
    it('creates, gets, lists and updates a warehouse', async () => {
      mock.onPost(`${ BASE }/Warehouses`).reply({ WarehouseCode: '02' })
      mock.onGet(`${ BASE }/Warehouses('01')`).reply({ WarehouseCode: '01' })
      mock.onGet(`${ BASE }/Warehouses`).reply({ value: [{ WarehouseCode: '01' }] })
      mock.onPatch(`${ BASE }/Warehouses('01')`).reply({})

      await service.createWarehouse('02', 'East Warehouse')
      expect(mock.history[0].body).toEqual({ WarehouseCode: '02', WarehouseName: 'East Warehouse' })

      await expect(service.getWarehouse('01')).resolves.toEqual({ WarehouseCode: '01' })
      await expect(service.listWarehouses('east')).resolves.toMatchObject({ count: 1 })
      await expect(service.updateWarehouse('01', 'Main')).resolves.toEqual({ WarehouseCode: '01', updated: true })
      expect(mock.history[3].body).toEqual({ WarehouseName: 'Main' })
    })

    it('validates the warehouse arguments', async () => {
      await expect(service.createWarehouse('', 'x')).rejects.toThrow('Warehouse Code is required.')
      await expect(service.createWarehouse('02')).rejects.toThrow('Warehouse Name is required.')
      await expect(service.getWarehouse()).rejects.toThrow('Warehouse Code is required.')
      await expect(service.updateWarehouse()).rejects.toThrow('Warehouse Code is required.')
    })
  })

  describe('price lists', () => {
    it('gets, lists and updates a price list by number', async () => {
      mock.onGet(`${ BASE }/PriceLists(1)`).reply({ PriceListNo: 1 })
      mock.onGet(`${ BASE }/PriceLists`).reply({ value: [{ PriceListNo: 1 }] })
      mock.onPatch(`${ BASE }/PriceLists(1)`).reply({})

      await expect(service.getPriceList('1')).resolves.toEqual({ PriceListNo: 1 })
      await expect(service.listPriceLists(10)).resolves.toMatchObject({ count: 1 })
      await expect(service.updatePriceList(1, 'Base Price', 1.5)).resolves.toEqual({ PriceListNo: 1, updated: true })
      expect(mock.history[2].body).toEqual({ PriceListName: 'Base Price', Factor: 1.5 })
    })

    it('validates the price list number', async () => {
      await expect(service.getPriceList('')).rejects.toThrow('Price List number is required.')
      await expect(service.updatePriceList(null)).rejects.toThrow('Price List number is required.')
    })
  })

  // ── Sales & purchasing documents ──

  const DOC_FAMILIES = [
    {
      label: 'Quotations',
      entity: 'Quotations',
      create: () => service.createQuotation('c1', LINES, '2026-01-01', '2026-02-01', 'hello'),
      createBody: { CardCode: 'c1', DocumentLines: MAPPED_LINES, DocDate: '2026-01-01', DocDueDate: '2026-02-01', Comments: 'hello' },
      createMissingCard: () => service.createQuotation(undefined, LINES),
      createMissingLines: () => service.createQuotation('c1', []),
      get: () => service.getQuotation(12),
      getMissing: () => service.getQuotation(''),
      list: () => service.listQuotations('c1', 'Open', 5),
      update: () => service.updateQuotation(12, 'note', '2026-03-01'),
      updateBody: { Comments: 'note', DocDueDate: '2026-03-01' },
      updateMissing: () => service.updateQuotation(),
      actions: [['Close', 'closed', () => service.closeQuotation(12)]],
    },
    {
      label: 'Orders',
      entity: 'Orders',
      create: () => service.createOrder('c1', LINES, '2026-01-01', '2026-02-01', 'hello'),
      createBody: { CardCode: 'c1', DocumentLines: MAPPED_LINES, DocDate: '2026-01-01', DocDueDate: '2026-02-01', Comments: 'hello' },
      createMissingCard: () => service.createOrder(undefined, LINES),
      createMissingLines: () => service.createOrder('c1', null),
      get: () => service.getOrder(12),
      getMissing: () => service.getOrder(null),
      list: () => service.listOrders('c1', 'Open', 5),
      update: () => service.updateOrder(12, 'note', '2026-03-01'),
      updateBody: { Comments: 'note', DocDueDate: '2026-03-01' },
      updateMissing: () => service.updateOrder(undefined),
      actions: [
        ['Close', 'closed', () => service.closeOrder(12)],
        ['Cancel', 'cancelled', () => service.cancelOrder(12)],
      ],
    },
    {
      label: 'Delivery Notes',
      entity: 'DeliveryNotes',
      create: () => service.createDeliveryNote('c1', LINES, '2026-01-01', '2026-02-01', 'hello'),
      createBody: { CardCode: 'c1', DocumentLines: MAPPED_LINES, DocDate: '2026-01-01', DocDueDate: '2026-02-01', Comments: 'hello' },
      createMissingCard: () => service.createDeliveryNote('', LINES),
      createMissingLines: () => service.createDeliveryNote('c1', 'nope'),
      get: () => service.getDeliveryNote(12),
      getMissing: () => service.getDeliveryNote(undefined),
      list: () => service.listDeliveryNotes('c1', 'Closed', 5),
      update: () => service.updateDeliveryNote(12, 'note'),
      updateBody: { Comments: 'note' },
      updateMissing: () => service.updateDeliveryNote(''),
      actions: [['Close', 'closed', () => service.closeDeliveryNote(12)]],
    },
    {
      label: 'A/R Invoices',
      entity: 'Invoices',
      create: () => service.createARInvoice('c1', LINES, '2026-01-01', '2026-02-01', 'hello'),
      createBody: { CardCode: 'c1', DocumentLines: MAPPED_LINES, DocDate: '2026-01-01', DocDueDate: '2026-02-01', Comments: 'hello' },
      createMissingCard: () => service.createARInvoice('', LINES),
      createMissingLines: () => service.createARInvoice('c1', []),
      get: () => service.getARInvoice(12),
      getMissing: () => service.getARInvoice(''),
      list: () => service.listARInvoices('c1', 'Open', 5),
      update: () => service.updateARInvoice(12, 'note'),
      updateBody: { Comments: 'note' },
      updateMissing: () => service.updateARInvoice(),
      actions: [['Cancel', 'cancelled', () => service.cancelARInvoice(12)]],
    },
    {
      label: 'A/R Credit Memos',
      entity: 'CreditNotes',
      create: () => service.createARCreditMemo('c1', LINES, '2026-01-01', 'hello'),
      createBody: { CardCode: 'c1', DocumentLines: MAPPED_LINES, DocDate: '2026-01-01', Comments: 'hello' },
      createMissingCard: () => service.createARCreditMemo('', LINES),
      createMissingLines: () => service.createARCreditMemo('c1', []),
      get: () => service.getARCreditMemo(12),
      getMissing: () => service.getARCreditMemo(''),
      list: () => service.listARCreditMemos('c1', 'Open', 5),
      update: () => service.updateARCreditMemo(12, 'note'),
      updateBody: { Comments: 'note' },
      updateMissing: () => service.updateARCreditMemo(),
      actions: [['Cancel', 'cancelled', () => service.cancelARCreditMemo(12)]],
    },
    {
      label: 'Returns',
      entity: 'Returns',
      create: () => service.createReturn('c1', LINES, '2026-01-01', 'hello'),
      createBody: { CardCode: 'c1', DocumentLines: MAPPED_LINES, DocDate: '2026-01-01', Comments: 'hello' },
      createMissingCard: () => service.createReturn('', LINES),
      createMissingLines: () => service.createReturn('c1', []),
      get: () => service.getReturn(12),
      getMissing: () => service.getReturn(''),
      list: () => service.listReturns('c1', 'Open', 5),
      update: () => service.updateReturn(12, 'note'),
      updateBody: { Comments: 'note' },
      updateMissing: () => service.updateReturn(),
      actions: [],
    },
    {
      label: 'Purchase Quotations',
      entity: 'PurchaseQuotations',
      create: () => service.createPurchaseQuotation('v1', LINES, '2026-01-01', '2026-02-01'),
      createBody: { CardCode: 'v1', DocumentLines: MAPPED_LINES, DocDate: '2026-01-01', DocDueDate: '2026-02-01' },
      createMissingCard: () => service.createPurchaseQuotation('', LINES),
      createMissingLines: () => service.createPurchaseQuotation('v1', []),
      get: () => service.getPurchaseQuotation(12),
      getMissing: () => service.getPurchaseQuotation(''),
      list: () => service.listPurchaseQuotations('v1', 'Open', 5),
      update: () => service.updatePurchaseQuotation(12, 'note'),
      updateBody: { Comments: 'note' },
      updateMissing: () => service.updatePurchaseQuotation(),
      actions: [['Close', 'closed', () => service.closePurchaseQuotation(12)]],
    },
    {
      label: 'Purchase Orders',
      entity: 'PurchaseOrders',
      create: () => service.createPurchaseOrder('v1', LINES, '2026-01-01', '2026-02-01', 'hello'),
      createBody: { CardCode: 'v1', DocumentLines: MAPPED_LINES, DocDate: '2026-01-01', DocDueDate: '2026-02-01', Comments: 'hello' },
      createMissingCard: () => service.createPurchaseOrder('', LINES),
      createMissingLines: () => service.createPurchaseOrder('v1', []),
      get: () => service.getPurchaseOrder(12),
      getMissing: () => service.getPurchaseOrder(''),
      list: () => service.listPurchaseOrders('v1', 'Open', 5),
      update: () => service.updatePurchaseOrder(12, 'note', '2026-03-01'),
      updateBody: { Comments: 'note', DocDueDate: '2026-03-01' },
      updateMissing: () => service.updatePurchaseOrder(),
      actions: [
        ['Close', 'closed', () => service.closePurchaseOrder(12)],
        ['Cancel', 'cancelled', () => service.cancelPurchaseOrder(12)],
      ],
    },
    {
      label: 'Goods Receipt POs',
      entity: 'PurchaseDeliveryNotes',
      create: () => service.createGoodsReceiptPO('v1', LINES, '2026-01-01', 'hello'),
      createBody: { CardCode: 'v1', DocumentLines: MAPPED_LINES, DocDate: '2026-01-01', Comments: 'hello' },
      createMissingCard: () => service.createGoodsReceiptPO('', LINES),
      createMissingLines: () => service.createGoodsReceiptPO('v1', []),
      get: () => service.getGoodsReceiptPO(12),
      getMissing: () => service.getGoodsReceiptPO(''),
      list: () => service.listGoodsReceiptPOs('v1', 'Open', 5),
      update: () => service.updateGoodsReceiptPO(12, 'note'),
      updateBody: { Comments: 'note' },
      updateMissing: () => service.updateGoodsReceiptPO(),
      actions: [],
    },
    {
      label: 'A/P Invoices',
      entity: 'PurchaseInvoices',
      create: () => service.createAPInvoice('v1', LINES, '2026-01-01', '2026-02-01', 'hello'),
      createBody: { CardCode: 'v1', DocumentLines: MAPPED_LINES, DocDate: '2026-01-01', DocDueDate: '2026-02-01', Comments: 'hello' },
      createMissingCard: () => service.createAPInvoice('', LINES),
      createMissingLines: () => service.createAPInvoice('v1', []),
      get: () => service.getAPInvoice(12),
      getMissing: () => service.getAPInvoice(''),
      list: () => service.listAPInvoices('v1', 'Open', 5),
      update: () => service.updateAPInvoice(12, 'note'),
      updateBody: { Comments: 'note' },
      updateMissing: () => service.updateAPInvoice(),
      actions: [],
    },
    {
      label: 'A/P Credit Memos',
      entity: 'PurchaseCreditNotes',
      create: () => service.createAPCreditMemo('v1', LINES, '2026-01-01', 'hello'),
      createBody: { CardCode: 'v1', DocumentLines: MAPPED_LINES, DocDate: '2026-01-01', Comments: 'hello' },
      createMissingCard: () => service.createAPCreditMemo('', LINES),
      createMissingLines: () => service.createAPCreditMemo('v1', []),
      get: () => service.getAPCreditMemo(12),
      getMissing: () => service.getAPCreditMemo(''),
      list: () => service.listAPCreditMemos('v1', 'Open', 5),
      update: () => service.updateAPCreditMemo(12, 'note'),
      updateBody: { Comments: 'note' },
      updateMissing: () => service.updateAPCreditMemo(),
      actions: [],
    },
  ]

  DOC_FAMILIES.forEach(family => {
    describe(`documents — ${ family.label }`, () => {
      it('creates the document with mapped lines', async () => {
        mock.onPost(`${ BASE }/${ family.entity }`).reply({ DocEntry: 12 })

        await expect(family.create()).resolves.toEqual({ DocEntry: 12 })
        expect(mock.history[0].url).toBe(`${ BASE }/${ family.entity }`)
        expect(mock.history[0].headers).toEqual(AUTH_HEADERS)
        expect(mock.history[0].body).toEqual(family.createBody)
      })

      it('validates the customer/vendor and lines', async () => {
        await expect(family.createMissingCard()).rejects.toThrow('Customer/Vendor (CardCode) is required.')
        await expect(family.createMissingLines()).rejects.toThrow('At least one line item is required (each needs an Item and Quantity).')
        expect(mock.history).toHaveLength(0)
      })

      it('reads the document by DocEntry', async () => {
        mock.onGet(`${ BASE }/${ family.entity }(12)`).reply({ DocEntry: 12 })

        await expect(family.get()).resolves.toEqual({ DocEntry: 12 })
        await expect(family.getMissing()).rejects.toThrow('Document number (DocEntry) is required.')
      })

      it('lists the documents with a card code and status filter', async () => {
        mock.onGet(`${ BASE }/${ family.entity }`).reply({ value: [{ DocEntry: 12 }] })

        await expect(family.list()).resolves.toEqual({ value: [{ DocEntry: 12 }], count: 1, pagesFollowed: 1 })
        expect(mock.history[0].query.$filter).toMatch(/^CardCode eq '(c1|v1)' and DocumentStatus eq 'bost_(Open|Close)'$/)
      })

      it('patches the document header', async () => {
        mock.onPatch(`${ BASE }/${ family.entity }(12)`).reply({})

        await expect(family.update()).resolves.toEqual({ DocEntry: 12, updated: true })
        expect(mock.history[0].body).toEqual(family.updateBody)
        await expect(family.updateMissing()).rejects.toThrow('Document number (DocEntry) is required.')
      })

      family.actions.forEach(([action, resultKey, call]) => {
        it(`posts the bound ${ action } action`, async () => {
          mock.onPost(`${ BASE }/${ family.entity }(12)/${ action }`).reply({})

          await expect(call()).resolves.toEqual({ DocEntry: 12, [resultKey]: true })
          expect(mock.history[0].body).toBeUndefined()
        })
      })
    })
  })

  describe('document helpers', () => {
    it('drops empty line fields and keeps zero values', async () => {
      mock.onPost(`${ BASE }/Orders`).reply({})

      await service.createOrder('c1', [
        { ItemCode: 'i1', Quantity: 0, UnitPrice: '', TaxCode: null, WarehouseCode: undefined, DiscountPercent: 0 },
      ])

      expect(mock.history[0].body.DocumentLines).toEqual([{ ItemCode: 'i1', Quantity: 0, DiscountPercent: 0 }])
    })

    it('omits optional header fields that were not supplied', async () => {
      mock.onPost(`${ BASE }/Orders`).reply({})

      await service.createOrder('c1', LINES)

      expect(mock.history[0].body).toEqual({ CardCode: 'c1', DocumentLines: MAPPED_LINES })
    })

    it('escapes quotes in the card code filter and passes raw status values through', async () => {
      mock.onGet(`${ BASE }/Orders`).reply({ value: [] })

      await service.listOrders("O'Brien", 'bost_Close')

      expect(mock.history[0].query.$filter).toBe("CardCode eq 'O''Brien' and DocumentStatus eq 'bost_Close'")
    })
  })

  // ── Payments ──

  describe('payments', () => {
    it('creates an incoming payment with invoice links', async () => {
      mock.onPost(`${ BASE }/IncomingPayments`).reply({ DocEntry: 5 })

      const result = await service.createIncomingPayment(
        'c1',
        [{ DocEntry: 5, SumApplied: 1960, InvoiceType: 'it_Invoice' }, { DocEntry: '', SumApplied: null }],
        1960,
        undefined,
        undefined,
        '2026-01-01'
      )

      expect(result).toEqual({ DocEntry: 5 })

      expect(mock.history[0].body).toEqual({
        CardCode: 'c1',
        PaymentInvoices: [{ DocEntry: 5, SumApplied: 1960, InvoiceType: 'it_Invoice' }, {}],
        CashSum: 1960,
        DocDate: '2026-01-01',
      })
    })

    it('creates an outgoing payment with a transfer', async () => {
      mock.onPost(`${ BASE }/VendorPayments`).reply({ DocEntry: 7 })

      await service.createOutgoingPayment('v1', [], undefined, 500, '10000')

      expect(mock.history[0].body).toEqual({ CardCode: 'v1', TransferSum: 500, TransferAccount: '10000' })
    })

    it('requires a card code on payments', async () => {
      await expect(service.createIncomingPayment()).rejects.toThrow('Customer/Vendor (CardCode) is required.')
      await expect(service.createOutgoingPayment('')).rejects.toThrow('Customer/Vendor (CardCode) is required.')
    })

    it('gets, lists and cancels payments', async () => {
      mock.onGet(`${ BASE }/IncomingPayments(5)`).reply({ DocEntry: 5 })
      mock.onGet(`${ BASE }/IncomingPayments`).reply({ value: [{ DocEntry: 5 }] })
      mock.onPost(`${ BASE }/IncomingPayments(5)/Cancel`).reply({})
      mock.onGet(`${ BASE }/VendorPayments(7)`).reply({ DocEntry: 7 })
      mock.onGet(`${ BASE }/VendorPayments`).reply({ value: [{ DocEntry: 7 }] })
      mock.onPost(`${ BASE }/VendorPayments(7)/Cancel`).reply({})

      await expect(service.getIncomingPayment(5)).resolves.toEqual({ DocEntry: 5 })
      await expect(service.listIncomingPayments('c1', 5)).resolves.toMatchObject({ count: 1 })
      expect(mock.history[1].query).toEqual({ $filter: "CardCode eq 'c1'" })
      await expect(service.cancelIncomingPayment(5)).resolves.toEqual({ DocEntry: 5, cancelled: true })

      await expect(service.getOutgoingPayment(7)).resolves.toEqual({ DocEntry: 7 })
      await expect(service.listOutgoingPayments()).resolves.toMatchObject({ count: 1 })
      await expect(service.cancelOutgoingPayment(7)).resolves.toEqual({ DocEntry: 7, cancelled: true })
    })
  })

  // ── Inventory transactions ──

  describe('inventory transactions', () => {
    it('creates a stock transfer', async () => {
      mock.onPost(`${ BASE }/StockTransfers`).reply({ DocEntry: 16 })

      const result = await service.createStockTransfer('01', '02', LINES, '2026-01-01')

      expect(result).toEqual({ DocEntry: 16 })

      expect(mock.history[0].body).toEqual({
        FromWarehouse: '01',
        ToWarehouse: '02',
        StockTransferLines: MAPPED_LINES,
        DocDate: '2026-01-01',
      })
    })

    it('validates the stock transfer arguments', async () => {
      await expect(service.createStockTransfer('', '02', LINES)).rejects.toThrow('From Warehouse is required.')
      await expect(service.createStockTransfer('01', '', LINES)).rejects.toThrow('To Warehouse is required.')
      await expect(service.createStockTransfer('01', '02', [])).rejects.toThrow('At least one stock transfer line is required.')
    })

    it('gets, lists and updates stock transfers', async () => {
      mock.onGet(`${ BASE }/StockTransfers(16)`).reply({ DocEntry: 16 })
      mock.onGet(`${ BASE }/StockTransfers`).reply({ value: [{ DocEntry: 16 }] })
      mock.onPatch(`${ BASE }/StockTransfers(16)`).reply({})

      await expect(service.getStockTransfer(16)).resolves.toEqual({ DocEntry: 16 })
      await expect(service.listStockTransfers(10)).resolves.toMatchObject({ count: 1 })
      await expect(service.updateStockTransfer(16, 'note')).resolves.toEqual({ DocEntry: 16, updated: true })
      expect(mock.history[2].body).toEqual({ Comments: 'note' })
    })

    it('creates, gets and lists goods issues', async () => {
      mock.onPost(`${ BASE }/InventoryGenExits`).reply({ DocEntry: 12 })
      mock.onGet(`${ BASE }/InventoryGenExits(12)`).reply({ DocEntry: 12 })
      mock.onGet(`${ BASE }/InventoryGenExits`).reply({ value: [{ DocEntry: 12 }] })

      await service.createGoodsIssue(LINES, '2026-01-01', 'scrap')
      expect(mock.history[0].body).toEqual({ DocumentLines: MAPPED_LINES, DocDate: '2026-01-01', Comments: 'scrap' })

      await expect(service.getGoodsIssue(12)).resolves.toEqual({ DocEntry: 12 })
      await expect(service.listGoodsIssues(5)).resolves.toMatchObject({ count: 1 })
      await expect(service.createGoodsIssue([])).rejects.toThrow('At least one line item is required.')
    })

    it('creates, gets and lists goods receipts', async () => {
      mock.onPost(`${ BASE }/InventoryGenEntries`).reply({ DocEntry: 13 })
      mock.onGet(`${ BASE }/InventoryGenEntries(13)`).reply({ DocEntry: 13 })
      mock.onGet(`${ BASE }/InventoryGenEntries`).reply({ value: [{ DocEntry: 13 }] })

      await service.createGoodsReceipt(LINES)
      expect(mock.history[0].body).toEqual({ DocumentLines: MAPPED_LINES })

      await expect(service.getGoodsReceipt(13)).resolves.toEqual({ DocEntry: 13 })
      await expect(service.listGoodsReceipts()).resolves.toMatchObject({ count: 1 })
      await expect(service.createGoodsReceipt(null)).rejects.toThrow('At least one line item is required.')
    })
  })

  // ── Financials ──

  describe('financials', () => {
    it('creates a journal entry from balanced lines', async () => {
      mock.onPost(`${ BASE }/JournalEntries`).reply({ JdtNum: 101 })

      await service.createJournalEntry(
        [
          { AccountCode: '40000', Debit: 100, LineMemo: 'debit side' },
          { AccountCode: '10000', Credit: 100, Debit: '' },
        ],
        '2026-01-01',
        'Accrual'
      )

      expect(mock.history[0].body).toEqual({
        JournalEntryLines: [
          { AccountCode: '40000', Debit: 100, LineMemo: 'debit side' },
          { AccountCode: '10000', Credit: 100 },
        ],
        ReferenceDate: '2026-01-01',
        Memo: 'Accrual',
      })
    })

    it('validates and updates journal entries', async () => {
      mock.onGet(`${ BASE }/JournalEntries(101)`).reply({ JdtNum: 101 })
      mock.onGet(`${ BASE }/JournalEntries`).reply({ value: [{ JdtNum: 101 }] })
      mock.onPatch(`${ BASE }/JournalEntries(101)`).reply({})

      await expect(service.createJournalEntry([])).rejects.toThrow('At least one journal line is required.')
      await expect(service.getJournalEntry('')).rejects.toThrow('Journal Entry number (JdtNum) is required.')
      await expect(service.updateJournalEntry(null)).rejects.toThrow('Journal Entry number (JdtNum) is required.')

      await expect(service.getJournalEntry(101)).resolves.toEqual({ JdtNum: 101 })
      await expect(service.listJournalEntries(5)).resolves.toMatchObject({ count: 1 })
      await expect(service.updateJournalEntry('101', 'New memo')).resolves.toEqual({ JdtNum: 101, updated: true })
      expect(mock.history[2].body).toEqual({ Memo: 'New memo' })
    })

    it('gets and lists chart of accounts entries', async () => {
      mock.onGet(`${ BASE }/ChartOfAccounts('40000')`).reply({ Code: '40000' })
      mock.onGet(`${ BASE }/ChartOfAccounts`).reply({ value: [{ Code: '40000' }] })

      await expect(service.getAccount('40000')).resolves.toEqual({ Code: '40000' })
      await expect(service.getAccount('')).rejects.toThrow('Account code is required.')

      await expect(service.listAccounts("Rev'enue", 5)).resolves.toMatchObject({ count: 1 })
      expect(mock.history[1].query).toEqual({ $filter: "contains(Name,'Rev''enue')" })

      await service.listAccounts()
      expect(mock.history[2].query).toEqual({})
    })
  })

  // ── CRM ──

  describe('activities', () => {
    it.each([
      ['Conversation', 'cn_Conversation'],
      ['Meeting', 'cn_Meeting'],
      ['Task', 'cn_Task'],
      ['Note', 'cn_Note'],
      ['Phone Call', 'cn_PhoneCall'],
      ['cn_Task', 'cn_Task'],
    ])('maps the %s activity type', async (input, expected) => {
      mock.onPost(`${ BASE }/Activities`).reply({ ActivityCode: 1 })

      await service.createActivity('c1', input, 'Follow-up call', '2026-01-01')

      expect(mock.history[0].body).toEqual({
        CardCode: 'c1',
        Activity: expected,
        Notes: 'Follow-up call',
        ActivityDate: '2026-01-01',
      })
    })

    it('creates a minimal activity and validates the card code', async () => {
      mock.onPost(`${ BASE }/Activities`).reply({})

      await service.createActivity('c1')
      expect(mock.history[0].body).toEqual({ CardCode: 'c1' })

      await expect(service.createActivity('')).rejects.toThrow('Business Partner code is required.')
    })

    it('gets, lists, updates and deletes activities', async () => {
      mock.onGet(`${ BASE }/Activities(1)`).reply({ ActivityCode: 1 })
      mock.onGet(`${ BASE }/Activities`).reply({ value: [{ ActivityCode: 1 }] })
      mock.onPatch(`${ BASE }/Activities(1)`).reply({})
      mock.onDelete(`${ BASE }/Activities(1)`).reply({})

      await expect(service.getActivity(1)).resolves.toEqual({ ActivityCode: 1 })
      await expect(service.listActivities("O'Brien", 5)).resolves.toMatchObject({ count: 1 })
      expect(mock.history[1].query).toEqual({ $filter: "CardCode eq 'O''Brien'" })

      await expect(service.updateActivity('1', 'Updated')).resolves.toEqual({ ActivityCode: 1, updated: true })
      expect(mock.history[2].body).toEqual({ Notes: 'Updated' })

      await expect(service.deleteActivity(1)).resolves.toEqual({ ActivityCode: 1, deleted: true })

      await service.listActivities()
      expect(mock.history[4].query).toEqual({})
    })

    it('validates the activity code', async () => {
      await expect(service.getActivity('')).rejects.toThrow('ActivityCode is required.')
      await expect(service.updateActivity(null)).rejects.toThrow('ActivityCode is required.')
      await expect(service.deleteActivity(undefined)).rejects.toThrow('ActivityCode is required.')
    })
  })

  // ── Generic query ──

  describe('queryEntities', () => {
    it('passes the OData options through', async () => {
      mock.onGet(`${ BASE }/Orders`).reply({ value: [{ DocEntry: 22 }] })

      const result = await service.queryEntities('Orders', 'DocTotal gt 3000', 'DocEntry,DocNum', 'DocTotal asc', 10)

      expect(result).toEqual({ value: [{ DocEntry: 22 }], count: 1, pagesFollowed: 1 })

      expect(mock.history[0].query).toEqual({
        $filter: 'DocTotal gt 3000',
        $select: 'DocEntry,DocNum',
        $orderby: 'DocTotal asc',
      })
    })

    it('requires an entity set', async () => {
      await expect(service.queryEntities('')).rejects.toThrow('Entity Set is required (e.g. Orders, BusinessPartners, Items).')
    })
  })

  // ── Dictionaries ──

  describe('getBusinessPartnersDictionary', () => {
    it('maps partners and resolves the type label', async () => {
      mock.onGet(`${ BASE }/BusinessPartners`).reply({
        value: [
          { CardCode: 'c1', CardName: 'Customer c1', CardType: 'cCustomer' },
          { CardCode: 'v1', CardName: 'Vendor v1', CardType: 'cSupplier' },
          { CardCode: 'l1', CardName: 'Lead l1', CardType: 'cLead' },
          { CardCode: 'x1', CardName: 'No type' },
        ],
      })

      const result = await service.getBusinessPartnersDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Customer c1 (c1)', value: 'c1', note: 'Customer' },
          { label: 'Vendor v1 (v1)', value: 'v1', note: 'Vendor / Supplier' },
          { label: 'Lead l1 (l1)', value: 'l1', note: 'Lead' },
          { label: 'No type (x1)', value: 'x1', note: '' },
        ],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ $select: 'CardCode,CardName,CardType', $top: 20 })
    })

    it('applies the search text and the card type criteria', async () => {
      mock.onGet(`${ BASE }/BusinessPartners`).reply({ value: [] })

      await service.getBusinessPartnersDictionary({ search: 'acme', criteria: { cardType: 'cCustomer' }, cursor: 20 })

      expect(mock.history[0].query).toEqual({
        $select: 'CardCode,CardName,CardType',
        $filter: "CardType eq 'cCustomer' and (contains(CardName,'acme') or contains(CardCode,'acme'))",
        $top: 20,
        $skip: 20,
      })
    })

    it('advances the cursor while a next link is returned', async () => {
      mock.onGet(`${ BASE }/BusinessPartners`).reply({ value: [], 'odata.nextLink': 'BusinessPartners?$skip=40' })

      await expect(service.getBusinessPartnersDictionary({ cursor: 20 })).resolves.toMatchObject({ cursor: 40 })

      mock.reset()
      mock.onGet(`${ BASE }/BusinessPartners`).reply({ value: [], 'odata.nextLink': 'BusinessPartners?$skip=20' })

      await expect(service.getBusinessPartnersDictionary()).resolves.toMatchObject({ cursor: 20 })
    })
  })

  describe('entity dictionaries', () => {
    it('maps items', async () => {
      mock.onGet(`${ BASE }/Items`).reply({ value: [{ ItemCode: 'i1', ItemName: 'Widget' }] })

      await expect(service.getItemsDictionary({ search: 'wid' })).resolves.toEqual({
        items: [{ label: 'Widget (i1)', value: 'i1', note: 'ID: i1' }],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({
        $select: 'ItemCode,ItemName',
        $filter: "contains(ItemName,'wid') or contains(ItemCode,'wid')",
        $top: 20,
      })
    })

    it('maps warehouses', async () => {
      mock.onGet(`${ BASE }/Warehouses`).reply({ value: [{ WarehouseCode: '01', WarehouseName: 'General Warehouse' }] })

      await expect(service.getWarehousesDictionary()).resolves.toEqual({
        items: [{ label: 'General Warehouse (01)', value: '01', note: 'Warehouse 01' }],
        cursor: null,
      })
    })

    it('maps price lists', async () => {
      mock.onGet(`${ BASE }/PriceLists`).reply({ value: [{ PriceListNo: 1, PriceListName: 'Base Price' }] })

      await expect(service.getPriceListsDictionary({ search: "Base's" })).resolves.toEqual({
        items: [{ label: 'Base Price', value: '1', note: 'List #1' }],
        cursor: null,
      })

      expect(mock.history[0].query.$filter).toBe("contains(PriceListName,'Base''s')")
    })

    it('maps chart of accounts entries', async () => {
      mock.onGet(`${ BASE }/ChartOfAccounts`).reply({ value: [{ Code: '40000', Name: 'Sales Revenue' }] })

      await expect(service.getChartOfAccountsDictionary({ search: 'sales' })).resolves.toEqual({
        items: [{ label: 'Sales Revenue (40000)', value: '40000', note: 'Account 40000' }],
        cursor: null,
      })

      expect(mock.history[0].query.$filter).toBe("contains(Name,'sales')")
    })

    it('maps activities', async () => {
      mock.onGet(`${ BASE }/Activities`).reply({ value: [{ ActivityCode: 1, CardCode: 'c1' }] })

      await expect(service.getActivitiesDictionary({ search: "O'Brien" })).resolves.toEqual({
        items: [{ label: 'Activity 1 (c1)', value: 1, note: 'ActivityCode 1' }],
        cursor: null,
      })

      expect(mock.history[0].query.$filter).toBe("contains(CardCode,'O''Brien')")
    })

    it('maps journal entries', async () => {
      mock.onGet(`${ BASE }/JournalEntries`).reply({ value: [{ JdtNum: 101, Memo: 'Accrual' }] })

      await expect(service.getJournalEntriesDictionary({ search: 'accr' })).resolves.toEqual({
        items: [{ label: 'JE #101', value: 101, note: 'JdtNum 101' }],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ $select: 'JdtNum,Memo', $filter: "contains(Memo,'accr')", $top: 20 })
    })

    it('returns empty dictionaries when nothing comes back', async () => {
      mock.onGet(`${ BASE }/Items`).reply(undefined)
      mock.onGet(`${ BASE }/JournalEntries`).reply({})

      await expect(service.getItemsDictionary({})).resolves.toEqual({ items: [], cursor: null })
      await expect(service.getJournalEntriesDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('document dictionaries', () => {
    const DOCUMENT_DICTIONARIES = [
      ['getOrdersDictionary', 'Orders'],
      ['getQuotationsDictionary', 'Quotations'],
      ['getDeliveryNotesDictionary', 'DeliveryNotes'],
      ['getInvoicesDictionary', 'Invoices'],
      ['getCreditNotesDictionary', 'CreditNotes'],
      ['getReturnsDictionary', 'Returns'],
      ['getPurchaseOrdersDictionary', 'PurchaseOrders'],
      ['getPurchaseQuotationsDictionary', 'PurchaseQuotations'],
      ['getPurchaseDeliveryNotesDictionary', 'PurchaseDeliveryNotes'],
      ['getPurchaseInvoicesDictionary', 'PurchaseInvoices'],
      ['getPurchaseCreditNotesDictionary', 'PurchaseCreditNotes'],
      ['getIncomingPaymentsDictionary', 'IncomingPayments'],
      ['getVendorPaymentsDictionary', 'VendorPayments'],
      ['getStockTransfersDictionary', 'StockTransfers'],
    ]

    it.each(DOCUMENT_DICTIONARIES)('%s reads %s', async (method, entity) => {
      mock.onGet(`${ BASE }/${ entity }`).reply({ value: [{ DocEntry: 22, DocNum: 11, CardCode: 'c1' }] })

      await expect(service[method]({})).resolves.toEqual({
        items: [{ label: '#11 (c1)', value: 22, note: 'DocEntry 22' }],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ $select: 'DocEntry,DocNum,CardCode', $top: 20 })
    })

    it('filters by card code and pages with a cursor', async () => {
      mock.onGet(`${ BASE }/Orders`).reply({ value: [], 'odata.nextLink': 'Orders?$skip=40' })

      const result = await service.getOrdersDictionary({ search: "O'Brien", cursor: 20 })

      expect(result).toEqual({ items: [], cursor: 40 })

      expect(mock.history[0].query).toEqual({
        $select: 'DocEntry,DocNum,CardCode',
        $filter: "contains(CardCode,'O''Brien')",
        $top: 20,
        $skip: 20,
      })
    })
  })

  // ── Polling triggers ──

  describe('polling triggers', () => {
    it('dispatches a polling invocation to the named event handler', async () => {
      mock.onGet(`${ BASE }/Orders`).reply({ value: [{ DocEntry: 22 }] })

      const result = await service.handleTriggerPollingForEvent({ eventName: 'onNewSalesOrder', state: null })

      expect(result).toEqual({ events: [], state: { lastDocEntry: 22 } })
    })

    it('seeds the sales order cursor on the first cycle without emitting the backlog', async () => {
      mock.onGet(`${ BASE }/Orders`).reply({ value: [{ DocEntry: 21 }, { DocEntry: 22 }] })

      const result = await service.onNewSalesOrder({})

      expect(result).toEqual({ events: [], state: { lastDocEntry: 22 } })

      expect(mock.history[0].query).toEqual({
        $select: 'DocEntry,DocNum,CardCode,CardName,DocTotal,DocDate',
        $orderby: 'DocEntry asc',
      })
    })

    it('emits only sales orders newer than the cursor', async () => {
      mock.onGet(`${ BASE }/Orders`).reply({ value: [{ DocEntry: 23 }, { DocEntry: 24 }] })

      const result = await service.onNewSalesOrder({ state: { lastDocEntry: 22 } })

      expect(result).toEqual({ events: [{ DocEntry: 23 }, { DocEntry: 24 }], state: { lastDocEntry: 24 } })
      expect(mock.history[0].query.$filter).toBe('DocEntry gt 22')
    })

    it('keeps the cursor when a cycle returns nothing', async () => {
      mock.onGet(`${ BASE }/Orders`).reply({ value: [] })

      await expect(service.onNewSalesOrder({ state: { lastDocEntry: 22 } })).resolves.toEqual({
        events: [],
        state: { lastDocEntry: 22 },
      })
    })

    it('seeds the business partner cursor from the newest create date', async () => {
      mock.onGet(`${ BASE }/BusinessPartners`).reply({
        value: [
          { CardCode: 'c2', CreateDate: '2026-06-02' },
          { CardCode: 'c3', CreateDate: '2026-06-02' },
          { CardCode: 'c1', CreateDate: '2026-06-01' },
        ],
      })

      const result = await service.onNewBusinessPartner({})

      expect(result).toEqual({ events: [], state: { cursorDate: '2026-06-02', seen: ['c2', 'c3'] } })
      expect(mock.history[0].query).toEqual({ $select: 'CardCode,CreateDate', $orderby: 'CreateDate desc' })
    })

    it('emits new business partners and dedups the boundary date', async () => {
      mock.onGet(`${ BASE }/BusinessPartners`).reply({
        value: [
          { CardCode: 'c2', CreateDate: '2026-06-02' },
          { CardCode: 'c4', CreateDate: '2026-06-02' },
          { CardCode: 'c5', CreateDate: '2026-06-03' },
        ],
      })

      const result = await service.onNewBusinessPartner({ state: { cursorDate: '2026-06-02', seen: ['c2'] } })

      expect(result).toEqual({
        events: [{ CardCode: 'c4', CreateDate: '2026-06-02' }, { CardCode: 'c5', CreateDate: '2026-06-03' }],
        state: { cursorDate: '2026-06-03', seen: ['c5'] },
      })

      expect(mock.history[0].query).toEqual({
        $select: 'CardCode,CardName,CardType,EmailAddress,CreateDate',
        $filter: "CreateDate ge '2026-06-02'",
        $orderby: 'CreateDate asc',
      })
    })

    it('tolerates a state without a seen list', async () => {
      mock.onGet(`${ BASE }/BusinessPartners`).reply({ value: [{ CardCode: 'c9', CreateDate: '2026-06-04' }] })

      const result = await service.onNewBusinessPartner({ state: { cursorDate: '2026-06-04' } })

      expect(result.events).toEqual([{ CardCode: 'c9', CreateDate: '2026-06-04' }])
      expect(result.state).toEqual({ cursorDate: '2026-06-04', seen: ['c9'] })
    })
  })
})
