'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = String(Date.now()).slice(-6)

describe('SAP Business One Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('sap-business-one')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Connection ──

  describe('session', () => {
    it('logs in and reads the chart of accounts', async () => {
      const result = await service.listAccounts(undefined, 5)

      expect(result).toHaveProperty('value')
      expect(Array.isArray(result.value)).toBe(true)
      expect(service.session).toHaveProperty('cookie')
    })
  })

  // ── Dictionaries ──

  describe('dictionaries', () => {
    it.each([
      ['getBusinessPartnersDictionary'],
      ['getItemsDictionary'],
      ['getWarehousesDictionary'],
      ['getPriceListsDictionary'],
      ['getChartOfAccountsDictionary'],
      ['getOrdersDictionary'],
      ['getQuotationsDictionary'],
      ['getInvoicesDictionary'],
      ['getPurchaseOrdersDictionary'],
      ['getActivitiesDictionary'],
      ['getJournalEntriesDictionary'],
    ])('%s returns dictionary items', async method => {
      const result = await service[method]({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')

      if (result.items.length) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('filters business partners by type criteria', async () => {
      const result = await service.getBusinessPartnersDictionary({ criteria: { cardType: 'cCustomer' } })

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Read-only listings ──

  describe('listings', () => {
    it.each([
      ['listBusinessPartners', s => s.listBusinessPartners(undefined, undefined, 5)],
      ['listItems', s => s.listItems(undefined, 5)],
      ['listWarehouses', s => s.listWarehouses(undefined, 5)],
      ['listPriceLists', s => s.listPriceLists(5)],
      ['listContacts', s => s.listContacts(undefined, 5)],
      ['listQuotations', s => s.listQuotations(undefined, undefined, 5)],
      ['listOrders', s => s.listOrders(undefined, undefined, 5)],
      ['listDeliveryNotes', s => s.listDeliveryNotes(undefined, undefined, 5)],
      ['listARInvoices', s => s.listARInvoices(undefined, undefined, 5)],
      ['listARCreditMemos', s => s.listARCreditMemos(undefined, undefined, 5)],
      ['listReturns', s => s.listReturns(undefined, undefined, 5)],
      ['listPurchaseQuotations', s => s.listPurchaseQuotations(undefined, undefined, 5)],
      ['listPurchaseOrders', s => s.listPurchaseOrders(undefined, undefined, 5)],
      ['listGoodsReceiptPOs', s => s.listGoodsReceiptPOs(undefined, undefined, 5)],
      ['listAPInvoices', s => s.listAPInvoices(undefined, undefined, 5)],
      ['listAPCreditMemos', s => s.listAPCreditMemos(undefined, undefined, 5)],
      ['listIncomingPayments', s => s.listIncomingPayments(undefined, 5)],
      ['listOutgoingPayments', s => s.listOutgoingPayments(undefined, 5)],
      ['listStockTransfers', s => s.listStockTransfers(5)],
      ['listGoodsIssues', s => s.listGoodsIssues(5)],
      ['listGoodsReceipts', s => s.listGoodsReceipts(5)],
      ['listJournalEntries', s => s.listJournalEntries(5)],
      ['listActivities', s => s.listActivities(undefined, 5)],
    ])('%s returns a capped result set', async (_name, call) => {
      const result = await call(service)

      expect(Array.isArray(result.value)).toBe(true)
      expect(result.value.length).toBeLessThanOrEqual(5)
      expect(result).toHaveProperty('count', result.value.length)
    })
  })

  describe('queryEntities', () => {
    it('runs a generic OData query', async () => {
      const result = await service.queryEntities('Items', undefined, 'ItemCode,ItemName', 'ItemCode asc', 5)

      expect(Array.isArray(result.value)).toBe(true)
      expect(result).toHaveProperty('pagesFollowed')
    })

    it('requires an entity set', async () => {
      await expect(service.queryEntities('')).rejects.toThrow('Entity Set is required (e.g. Orders, BusinessPartners, Items).')
    })
  })

  // ── Business partner lifecycle ──

  describe('business partner lifecycle', () => {
    const cardCode = `FRE2E${ SUFFIX }`
    let created = false

    it('creates a business partner', async () => {
      const result = await service.createBusinessPartner(`Flowrunner E2E ${ SUFFIX }`, 'Customer', cardCode)

      expect(result).toHaveProperty('CardCode', cardCode)

      created = true
    })

    it('reads it back', async () => {
      if (!created) {
        console.log('Skipping getBusinessPartner: partner was not created')

        return
      }

      await expect(service.getBusinessPartner(cardCode)).resolves.toHaveProperty('CardCode', cardCode)
    })

    it('updates it', async () => {
      if (!created) {
        console.log('Skipping updateBusinessPartner: partner was not created')

        return
      }

      await expect(service.updateBusinessPartner(cardCode, undefined, '555-0100', 'e2e@example.com')).resolves.toEqual({
        CardCode: cardCode,
        updated: true,
      })
    })

    it('adds and reads a contact person', async () => {
      if (!created) {
        console.log('Skipping createContact/getContacts: partner was not created')

        return
      }

      await expect(service.createContact(cardCode, `E2E Contact ${ SUFFIX }`, 'E2E', 'Contact')).resolves.toEqual({
        CardCode: cardCode,
        contactAdded: `E2E Contact ${ SUFFIX }`,
      })

      const contacts = await service.getContacts(cardCode)

      expect(contacts).toHaveProperty('ContactEmployees')
    })

    it('creates, updates and deletes an activity for the partner', async () => {
      if (!created) {
        console.log('Skipping activity lifecycle: partner was not created')

        return
      }

      const activity = await service.createActivity(cardCode, 'Task', `E2E activity ${ SUFFIX }`)

      expect(activity).toHaveProperty('ActivityCode')

      const code = activity.ActivityCode

      await expect(service.getActivity(code)).resolves.toHaveProperty('ActivityCode', code)
      await expect(service.updateActivity(code, 'Updated by e2e')).resolves.toEqual({ ActivityCode: code, updated: true })
      await expect(service.deleteActivity(code)).resolves.toEqual({ ActivityCode: code, deleted: true })
    })

    it('deletes the business partner', async () => {
      if (!created) {
        console.log('Skipping deleteBusinessPartner: partner was not created')

        return
      }

      await expect(service.deleteBusinessPartner(cardCode)).resolves.toEqual({ CardCode: cardCode, deleted: true })
    })
  })

  // ── Item lifecycle ──

  describe('item lifecycle', () => {
    const itemCode = `FRE2E${ SUFFIX }`
    let created = false

    it('creates an item', async () => {
      const result = await service.createItem(itemCode, `Flowrunner E2E Item ${ SUFFIX }`, undefined, true, true, true)

      expect(result).toHaveProperty('ItemCode', itemCode)

      created = true
    })

    it('reads and updates the item', async () => {
      if (!created) {
        console.log('Skipping getItem/updateItem: item was not created')

        return
      }

      await expect(service.getItem(itemCode)).resolves.toHaveProperty('ItemCode', itemCode)

      await expect(service.updateItem(itemCode, `Flowrunner E2E Item ${ SUFFIX } v2`)).resolves.toEqual({
        ItemCode: itemCode,
        updated: true,
      })
    })

    it('deletes the item', async () => {
      if (!created) {
        console.log('Skipping deleteItem: item was not created')

        return
      }

      await expect(service.deleteItem(itemCode)).resolves.toEqual({ ItemCode: itemCode, deleted: true })
    })
  })

  // ── Sales documents ──

  describe('sales documents', () => {
    it('creates, reads, updates and closes a quotation', async () => {
      const { cardCode, itemCode } = testValues

      if (!cardCode || !itemCode) {
        console.log('Skipping quotation lifecycle: testValues.cardCode or testValues.itemCode not set')

        return
      }

      const created = await service.createQuotation(
        cardCode,
        [{ ItemCode: itemCode, Quantity: 1 }],
        undefined,
        undefined,
        `Flowrunner e2e ${ SUFFIX }`
      )

      expect(created).toHaveProperty('DocEntry')

      const docEntry = created.DocEntry

      await expect(service.getQuotation(docEntry)).resolves.toHaveProperty('DocEntry', docEntry)
      await expect(service.updateQuotation(docEntry, `Updated ${ SUFFIX }`)).resolves.toEqual({ DocEntry: docEntry, updated: true })
      await expect(service.closeQuotation(docEntry)).resolves.toEqual({ DocEntry: docEntry, closed: true })
    })

    it('creates, reads and cancels a sales order', async () => {
      const { cardCode, itemCode } = testValues

      if (!cardCode || !itemCode) {
        console.log('Skipping order lifecycle: testValues.cardCode or testValues.itemCode not set')

        return
      }

      const created = await service.createOrder(cardCode, [{ ItemCode: itemCode, Quantity: 1 }])

      expect(created).toHaveProperty('DocEntry')

      const docEntry = created.DocEntry

      await expect(service.getOrder(docEntry)).resolves.toHaveProperty('DocEntry', docEntry)
      await expect(service.updateOrder(docEntry, `Updated ${ SUFFIX }`)).resolves.toEqual({ DocEntry: docEntry, updated: true })
      await expect(service.cancelOrder(docEntry)).resolves.toEqual({ DocEntry: docEntry, cancelled: true })
    })
  })

  // ── Purchasing documents ──

  describe('purchasing documents', () => {
    it('creates, reads and cancels a purchase order', async () => {
      const { vendorCode, itemCode } = testValues

      if (!vendorCode || !itemCode) {
        console.log('Skipping purchase order lifecycle: testValues.vendorCode or testValues.itemCode not set')

        return
      }

      const created = await service.createPurchaseOrder(vendorCode, [{ ItemCode: itemCode, Quantity: 1 }])

      expect(created).toHaveProperty('DocEntry')

      const docEntry = created.DocEntry

      await expect(service.getPurchaseOrder(docEntry)).resolves.toHaveProperty('DocEntry', docEntry)
      await expect(service.cancelPurchaseOrder(docEntry)).resolves.toEqual({ DocEntry: docEntry, cancelled: true })
    })
  })

  // ── Polling triggers ──

  describe('polling triggers', () => {
    it('seeds and then polls new sales orders', async () => {
      const seed = await service.onNewSalesOrder({ state: null })

      expect(seed.events).toEqual([])
      expect(seed.state).toHaveProperty('lastDocEntry')

      const next = await service.handleTriggerPollingForEvent({ eventName: 'onNewSalesOrder', state: seed.state })

      expect(Array.isArray(next.events)).toBe(true)
      expect(next.state.lastDocEntry).toBeGreaterThanOrEqual(seed.state.lastDocEntry)
    })

    it('seeds and then polls new business partners', async () => {
      const seed = await service.onNewBusinessPartner({ state: null })

      expect(seed.events).toEqual([])
      expect(seed.state).toHaveProperty('cursorDate')

      const next = await service.handleTriggerPollingForEvent({ eventName: 'onNewBusinessPartner', state: seed.state })

      expect(Array.isArray(next.events)).toBe(true)
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('reports a missing record with guidance', async () => {
      await expect(service.getBusinessPartner('FR-DOES-NOT-EXIST')).rejects.toThrow(/Not found|not exist/)
    })
  })
})
