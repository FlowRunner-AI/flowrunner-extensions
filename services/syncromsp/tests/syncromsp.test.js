'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SUBDOMAIN = 'acme'
const API_KEY = 'test-api-key'
const BASE = `https://${ SUBDOMAIN }.syncromsp.com/api/v1`

const AUTH_HEADERS = {
  'Authorization': `Bearer ${ API_KEY }`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
}

describe('SyncroMSP Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ subdomain: SUBDOMAIN, apiKey: API_KEY })
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

  // ── Registration ──

  describe('service registration', () => {
    it('registers the required config items in order', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['subdomain', 'apiKey'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'subdomain',
            displayName: 'Subdomain',
            type: 'STRING',
            required: true,
            shared: false,
          }),
          expect.objectContaining({
            name: 'apiKey',
            displayName: 'API Key',
            type: 'STRING',
            required: true,
            shared: false,
          }),
        ])
      )
    })

    it('reads the subdomain and api key from config', () => {
      expect(service.subdomain).toBe(SUBDOMAIN)
      expect(service.apiKey).toBe(API_KEY)
    })
  })

  // ── Tickets ──

  describe('listTickets', () => {
    it('sends a GET with auth headers and no query when nothing is provided', async () => {
      mock.onGet(`${ BASE }/tickets`).reply({ tickets: [], meta: { page: 1 } })

      const result = await service.listTickets()

      expect(result).toEqual({ tickets: [], meta: { page: 1 } })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/tickets`)
      expect(mock.history[0].headers).toEqual(AUTH_HEADERS)
      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].body).toBeUndefined()
    })

    it('passes every filter through', async () => {
      mock.onGet(`${ BASE }/tickets`).reply({ tickets: [] })

      await service.listTickets(2, 'boot', 456, 'New')

      expect(mock.history[0].query).toEqual({
        page: 2,
        query: 'boot',
        customer_id: 456,
        status: 'New',
      })
    })

    it('drops empty-string filters', async () => {
      mock.onGet(`${ BASE }/tickets`).reply({ tickets: [] })

      await service.listTickets(undefined, '', null, '')

      expect(mock.history[0].query).toEqual({})
    })

    it('throws a wrapped error including the HTTP status', async () => {
      mock.onGet(`${ BASE }/tickets`).replyWithError({
        message: 'Request failed',
        status: 401,
        body: { error: 'Invalid token' },
      })

      await expect(service.listTickets()).rejects.toThrow('SyncroMSP API error: Invalid token (HTTP 401)')
    })

    it('joins an errors array from the response body', async () => {
      mock.onGet(`${ BASE }/tickets`).replyWithError({
        message: 'Request failed',
        statusCode: 422,
        body: { errors: ['Subject is required', 'Customer is missing'] },
      })

      await expect(service.listTickets()).rejects.toThrow(
        'SyncroMSP API error: Subject is required, Customer is missing (HTTP 422)'
      )
    })

    it('uses a non-array errors value as-is', async () => {
      mock.onGet(`${ BASE }/tickets`).replyWithError({
        message: 'Request failed',
        status: 400,
        body: { errors: 'Something is wrong' },
      })

      await expect(service.listTickets()).rejects.toThrow('SyncroMSP API error: Something is wrong (HTTP 400)')
    })

    it('falls back to the body message', async () => {
      mock.onGet(`${ BASE }/tickets`).replyWithError({
        message: 'Request failed',
        status: 500,
        body: { message: 'Server exploded' },
      })

      await expect(service.listTickets()).rejects.toThrow('SyncroMSP API error: Server exploded (HTTP 500)')
    })

    it('falls back to the transport error message and omits the status when unknown', async () => {
      mock.onGet(`${ BASE }/tickets`).replyWithError({ message: 'Network timeout' })

      await expect(service.listTickets()).rejects.toThrow('SyncroMSP API error: Network timeout')
    })
  })

  describe('getTicket', () => {
    it('requests the ticket by id', async () => {
      mock.onGet(`${ BASE }/tickets/123`).reply({ ticket: { id: 123 } })

      const result = await service.getTicket(123)

      expect(result).toEqual({ ticket: { id: 123 } })
      expect(mock.history[0].url).toBe(`${ BASE }/tickets/123`)
    })
  })

  describe('createTicket', () => {
    it('sends only the required fields when optionals are omitted', async () => {
      mock.onPost(`${ BASE }/tickets`).reply({ ticket: { id: 123 } })

      const result = await service.createTicket("Laptop won't boot", 456)

      expect(result).toEqual({ ticket: { id: 123 } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ subject: "Laptop won't boot", customer_id: 456 })
    })

    it('maps the priority label and sends every optional field', async () => {
      mock.onPost(`${ BASE }/tickets`).reply({ ticket: { id: 124 } })

      await service.createTicket('Subject', 456, 'Hardware', 'New', 'High', 'Details')

      expect(mock.history[0].body).toEqual({
        subject: 'Subject',
        customer_id: 456,
        problem_type: 'Hardware',
        status: 'New',
        priority: '1 High',
        description: 'Details',
      })
    })

    it('maps every supported priority label', async () => {
      mock.onPost(`${ BASE }/tickets`).reply({ ticket: {} })

      await service.createTicket('S', 1, undefined, undefined, 'Urgent')
      await service.createTicket('S', 1, undefined, undefined, 'Normal')
      await service.createTicket('S', 1, undefined, undefined, 'Low')

      expect(mock.history.map(call => call.body.priority)).toEqual(['0 Urgent', '2 Normal', '3 Low'])
    })

    it('passes an unknown priority through unchanged', async () => {
      mock.onPost(`${ BASE }/tickets`).reply({ ticket: {} })

      await service.createTicket('S', 1, undefined, undefined, '4 Custom')

      expect(mock.history[0].body.priority).toBe('4 Custom')
    })

    it('omits an empty-string priority', async () => {
      mock.onPost(`${ BASE }/tickets`).reply({ ticket: {} })

      await service.createTicket('S', 1, undefined, undefined, '')

      expect(mock.history[0].body).toEqual({ subject: 'S', customer_id: 1 })
    })
  })

  describe('updateTicket', () => {
    it('sends a PUT with only the provided fields', async () => {
      mock.onPut(`${ BASE }/tickets/123`).reply({ ticket: { id: 123 } })

      const result = await service.updateTicket(123, undefined, 'In Progress')

      expect(result).toEqual({ ticket: { id: 123 } })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/tickets/123`)
      expect(mock.history[0].body).toEqual({ status: 'In Progress' })
    })

    it('maps the priority and sends all fields', async () => {
      mock.onPut(`${ BASE }/tickets/123`).reply({ ticket: {} })

      await service.updateTicket(123, 'New subject', 'Resolved', 'Urgent', 'Software')

      expect(mock.history[0].body).toEqual({
        subject: 'New subject',
        status: 'Resolved',
        priority: '0 Urgent',
        problem_type: 'Software',
      })
    })

    it('sends an empty body when nothing is provided', async () => {
      mock.onPut(`${ BASE }/tickets/123`).reply({ ticket: {} })

      await service.updateTicket(123)

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteTicket', () => {
    it('sends a DELETE to the ticket URL', async () => {
      mock.onDelete(`${ BASE }/tickets/123`).reply({ success: true })

      const result = await service.deleteTicket(123)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  describe('createTicketComment', () => {
    it('sends only the body when optionals are omitted', async () => {
      mock.onPost(`${ BASE }/tickets/123/comment`).reply({ comment: { id: 789 } })

      const result = await service.createTicketComment(123, 'Replaced the RAM.')

      expect(result).toEqual({ comment: { id: 789 } })
      expect(mock.history[0].url).toBe(`${ BASE }/tickets/123/comment`)
      expect(mock.history[0].body).toEqual({ body: 'Replaced the RAM.' })
    })

    it('coerces the boolean flags when provided as truthy values', async () => {
      mock.onPost(`${ BASE }/tickets/123/comment`).reply({ comment: {} })

      await service.createTicketComment(123, 'text', 'Update', 'yes', 1)

      expect(mock.history[0].body).toEqual({
        subject: 'Update',
        body: 'text',
        hidden: true,
        do_not_email: true,
      })
    })

    it('keeps explicitly false flags in the payload', async () => {
      mock.onPost(`${ BASE }/tickets/123/comment`).reply({ comment: {} })

      await service.createTicketComment(123, 'text', undefined, false, false)

      // clean() strips undefined/null/'' only, so explicit false is preserved.
      expect(mock.history[0].body).toEqual({ body: 'text', hidden: false, do_not_email: false })
    })
  })

  // ── Customers ──

  describe('listCustomers', () => {
    it('requests customers with pagination and search', async () => {
      mock.onGet(`${ BASE }/customers`).reply({ customers: [] })

      await service.listCustomers(2, 'acme')

      expect(mock.history[0].url).toBe(`${ BASE }/customers`)
      expect(mock.history[0].query).toEqual({ page: 2, query: 'acme' })
    })

    it('sends no query params when nothing is provided', async () => {
      mock.onGet(`${ BASE }/customers`).reply({ customers: [] })

      await service.listCustomers()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getCustomer', () => {
    it('requests the customer by id', async () => {
      mock.onGet(`${ BASE }/customers/456`).reply({ customer: { id: 456 } })

      const result = await service.getCustomer(456)

      expect(result).toEqual({ customer: { id: 456 } })
    })
  })

  describe('createCustomer', () => {
    it('sends only the provided fields', async () => {
      mock.onPost(`${ BASE }/customers`).reply({ customer: { id: 456 } })

      const result = await service.createCustomer('Acme Inc')

      expect(result).toEqual({ customer: { id: 456 } })
      expect(mock.history[0].body).toEqual({ business_name: 'Acme Inc' })
    })

    it('sends every field when provided', async () => {
      mock.onPost(`${ BASE }/customers`).reply({ customer: {} })

      await service.createCustomer('Acme Inc', 'Jane', 'Doe', 'jane@acme.com', '555-0100', '1 Main St')

      expect(mock.history[0].body).toEqual({
        business_name: 'Acme Inc',
        firstname: 'Jane',
        lastname: 'Doe',
        email: 'jane@acme.com',
        phone: '555-0100',
        address: '1 Main St',
      })
    })
  })

  describe('updateCustomer', () => {
    it('sends a PUT with only the changed fields', async () => {
      mock.onPut(`${ BASE }/customers/456`).reply({ customer: { id: 456 } })

      const result = await service.updateCustomer(456, 'Acme Corp')

      expect(result).toEqual({ customer: { id: 456 } })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ business_name: 'Acme Corp' })
    })
  })

  describe('deleteCustomer', () => {
    it('sends a DELETE to the customer URL', async () => {
      mock.onDelete(`${ BASE }/customers/456`).reply({ success: true })

      const result = await service.deleteCustomer(456)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].url).toBe(`${ BASE }/customers/456`)
    })
  })

  // ── Contacts ──

  describe('listContacts', () => {
    it('scopes contacts to a customer', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ contacts: [] })

      await service.listContacts(456, 2)

      expect(mock.history[0].query).toEqual({ customer_id: 456, page: 2 })
    })

    it('omits the customer filter when not provided', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ contacts: [] })

      await service.listContacts()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getContact', () => {
    it('requests the contact by id', async () => {
      mock.onGet(`${ BASE }/contacts/321`).reply({ contact: { id: 321 } })

      const result = await service.getContact(321)

      expect(result).toEqual({ contact: { id: 321 } })
    })
  })

  describe('createContact', () => {
    it('sends the customer id and provided fields', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ contact: { id: 321 } })

      const result = await service.createContact(456, 'Bob Smith', 'bob@acme.com', '555-0111', 'VIP')

      expect(result).toEqual({ contact: { id: 321 } })

      expect(mock.history[0].body).toEqual({
        customer_id: 456,
        name: 'Bob Smith',
        email: 'bob@acme.com',
        phone: '555-0111',
        notes: 'VIP',
      })
    })

    it('omits optional fields', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ contact: {} })

      await service.createContact(456)

      expect(mock.history[0].body).toEqual({ customer_id: 456 })
    })
  })

  describe('updateContact', () => {
    it('sends a PUT with only the changed fields', async () => {
      mock.onPut(`${ BASE }/contacts/321`).reply({ contact: { id: 321 } })

      const result = await service.updateContact(321, undefined, 'bob@new.com')

      expect(result).toEqual({ contact: { id: 321 } })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ email: 'bob@new.com' })
    })
  })

  // ── Assets ──

  describe('listAssets', () => {
    it('requests customer assets with all filters', async () => {
      mock.onGet(`${ BASE }/customer_assets`).reply({ assets: [] })

      await service.listAssets(456, 'WS', 2)

      expect(mock.history[0].url).toBe(`${ BASE }/customer_assets`)
      expect(mock.history[0].query).toEqual({ customer_id: 456, query: 'WS', page: 2 })
    })
  })

  describe('getAsset', () => {
    it('requests the asset by id', async () => {
      mock.onGet(`${ BASE }/customer_assets/654`).reply({ asset: { id: 654 } })

      const result = await service.getAsset(654)

      expect(result).toEqual({ asset: { id: 654 } })
    })
  })

  describe('createAsset', () => {
    it('sends the name, customer id and asset type', async () => {
      mock.onPost(`${ BASE }/customer_assets`).reply({ asset: { id: 654 } })

      const result = await service.createAsset('WS-01', 456, 'Workstation')

      expect(result).toEqual({ asset: { id: 654 } })

      expect(mock.history[0].body).toEqual({
        name: 'WS-01',
        customer_id: 456,
        asset_type: 'Workstation',
      })
    })

    it('omits the asset type when not provided', async () => {
      mock.onPost(`${ BASE }/customer_assets`).reply({ asset: {} })

      await service.createAsset('WS-02', 456)

      expect(mock.history[0].body).toEqual({ name: 'WS-02', customer_id: 456 })
    })
  })

  // ── Invoices ──

  describe('listInvoices', () => {
    it('scopes invoices to a customer', async () => {
      mock.onGet(`${ BASE }/invoices`).reply({ invoices: [] })

      await service.listInvoices(456, 1)

      expect(mock.history[0].query).toEqual({ customer_id: 456, page: 1 })
    })
  })

  describe('getInvoice', () => {
    it('requests the invoice by id', async () => {
      mock.onGet(`${ BASE }/invoices/987`).reply({ invoice: { id: 987 } })

      const result = await service.getInvoice(987)

      expect(result).toEqual({ invoice: { id: 987 } })
    })
  })

  describe('createInvoice', () => {
    it('sends the customer id and line items', async () => {
      mock.onPost(`${ BASE }/invoices`).reply({ invoice: { id: 987 } })

      const lineItems = [{ name: 'Labor', quantity: 1, price: 250 }]
      const result = await service.createInvoice(456, lineItems)

      expect(result).toEqual({ invoice: { id: 987 } })
      expect(mock.history[0].body).toEqual({ customer_id: 456, line_items: lineItems })
    })

    it('omits the line items when not provided', async () => {
      mock.onPost(`${ BASE }/invoices`).reply({ invoice: {} })

      await service.createInvoice(456)

      expect(mock.history[0].body).toEqual({ customer_id: 456 })
    })
  })

  // ── RMM Alerts ──

  describe('listRmmAlerts', () => {
    it('omits the resolved filter when undefined', async () => {
      mock.onGet(`${ BASE }/rmm_alerts`).reply({ rmm_alerts: [] })

      await service.listRmmAlerts()

      expect(mock.history[0].query).toEqual({})
    })

    it('sends resolved=true with the page', async () => {
      mock.onGet(`${ BASE }/rmm_alerts`).reply({ rmm_alerts: [] })

      await service.listRmmAlerts(true, 2)

      expect(mock.history[0].query).toEqual({ resolved: true, page: 2 })
    })

    it('sends resolved=false when explicitly requested', async () => {
      mock.onGet(`${ BASE }/rmm_alerts`).reply({ rmm_alerts: [] })

      await service.listRmmAlerts(false)

      expect(mock.history[0].query).toEqual({ resolved: false })
    })
  })

  describe('updateRmmAlert', () => {
    it('sends the resolved and muted flags', async () => {
      mock.onPut(`${ BASE }/rmm_alerts/555`).reply({ rmm_alert: { id: 555 } })

      const result = await service.updateRmmAlert(555, true, false)

      expect(result).toEqual({ rmm_alert: { id: 555 } })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ resolved: true, muted: false })
    })

    it('sends an empty body when neither flag is provided', async () => {
      mock.onPut(`${ BASE }/rmm_alerts/555`).reply({ rmm_alert: {} })

      await service.updateRmmAlert(555)

      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Products ──

  describe('listProducts', () => {
    it('requests products with a search query and page', async () => {
      mock.onGet(`${ BASE }/products`).reply({ products: [] })

      await service.listProducts('labor', 1)

      expect(mock.history[0].url).toBe(`${ BASE }/products`)
      expect(mock.history[0].query).toEqual({ query: 'labor', page: 1 })
    })
  })

  // ── Dictionaries ──

  describe('getCustomersDictionary', () => {
    it('maps customers to dictionary items using the business name', async () => {
      mock.onGet(`${ BASE }/customers`).reply({
        customers: [{ id: 456, business_name: 'Acme Inc', email: 'jane@acme.com' }],
        meta: { total_pages: 1 },
      })

      const result = await service.getCustomersDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Acme Inc', value: 456, note: 'jane@acme.com' }],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ page: 1 })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/customers`).reply({ customers: [] })

      const result = await service.getCustomersDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('falls back to the full name and then to a generated label', async () => {
      mock.onGet(`${ BASE }/customers`).reply({
        customers: [
          { id: 1, firstname: 'Jane', lastname: 'Doe' },
          { id: 2 },
        ],
      })

      const result = await service.getCustomersDictionary({})

      expect(result.items).toEqual([
        { label: 'Jane Doe', value: 1, note: 'Jane Doe' },
        { label: 'Customer 2', value: 2, note: undefined },
      ])
    })

    it('passes the search text as a query filter', async () => {
      mock.onGet(`${ BASE }/customers`).reply({ customers: [] })

      await service.getCustomersDictionary({ search: 'acme' })

      expect(mock.history[0].query).toEqual({ page: 1, query: 'acme' })
    })

    it('uses the cursor as the page number and returns the next cursor', async () => {
      mock.onGet(`${ BASE }/customers`).reply({
        customers: [],
        meta: { total_pages: 5 },
      })

      const result = await service.getCustomersDictionary({ cursor: '2' })

      expect(mock.history[0].query.page).toBe(2)
      expect(result.cursor).toBe('3')
    })

    it('returns a null cursor on the last page', async () => {
      mock.onGet(`${ BASE }/customers`).reply({ customers: [], meta: { total_pages: 3 } })

      const result = await service.getCustomersDictionary({ cursor: '3' })

      expect(result.cursor).toBeNull()
    })

    it('returns an empty item list when the request fails', async () => {
      mock.onGet(`${ BASE }/customers`).replyWithError({ message: 'Unauthorized', status: 401 })

      const result = await service.getCustomersDictionary({})

      expect(result).toEqual({ items: [] })
    })
  })
})
