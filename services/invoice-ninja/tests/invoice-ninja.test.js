'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-api-token'
const URL = 'https://invoicing.co'
const BASE = `${ URL }/api/v1`

describe('Invoice Ninja Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ url: URL, apiToken: API_TOKEN })
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
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'url',
          displayName: 'URL',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiToken',
          displayName: 'API Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the auth and content headers on every request', async () => {
      mock.onGet(`${ BASE }/clients`).reply({ data: [] })

      await service.listClients()

      expect(mock.history[0].headers).toEqual({
        'X-Api-Token': API_TOKEN,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      })
    })

    it('builds the base URL as {url}/api/v1 and strips trailing slashes', async () => {
      // Preserve the shared global; the isolated sandbox below replaces it.
      const savedFlowrunner = global.Flowrunner

      // Use an isolated module registry so re-requiring the service re-runs
      // addService() against a fresh sandbox without disturbing the shared one.
      await jest.isolateModulesAsync(async () => {
        const { createSandbox: createIsolated } = require('../../../service-sandbox')
        const trailingSandbox = createIsolated({ url: 'https://self-hosted.example.com///', apiToken: 'tok' })
        require('../src/index.js')
        const trailingService = trailingSandbox.getService()
        const trailingMock = trailingSandbox.getRequestMock()

        trailingMock.onGet('https://self-hosted.example.com/api/v1/clients').reply({ data: [] })

        await trailingService.listClients()

        expect(trailingMock.history[0].url).toBe('https://self-hosted.example.com/api/v1/clients')
      })

      // Restore the shared global so the remaining tests keep using the main sandbox.
      global.Flowrunner = savedFlowrunner
    })
  })

  // ── Clients ──

  describe('listClients', () => {
    it('sends a bare GET when no params are provided', async () => {
      mock.onGet(`${ BASE }/clients`).reply({ data: [], meta: {} })

      const result = await service.listClients()

      expect(result).toEqual({ data: [], meta: {} })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/clients`)
      expect(mock.history[0].query).toEqual({})
    })

    it('includes all params and maps the status choice', async () => {
      mock.onGet(`${ BASE }/clients`).reply({ data: [] })

      await service.listClients('acme', 'Archived', 10, 2, 'name|asc', 'contacts,documents')

      expect(mock.history[0].query).toEqual({
        filter: 'acme',
        status: 'archived',
        per_page: 10,
        page: 2,
        sort: 'name|asc',
        include: 'contacts,documents',
      })
    })

    it('passes an unknown status value through unchanged', async () => {
      mock.onGet(`${ BASE }/clients`).reply({ data: [] })

      await service.listClients(undefined, 'weird')

      expect(mock.history[0].query).toEqual({ status: 'weird' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/clients`).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.listClients()).rejects.toThrow(
        'Invoice Ninja API error: Unauthorized [status 401]'
      )
    })
  })

  describe('getClient', () => {
    it('fetches a single client by id', async () => {
      mock.onGet(`${ BASE }/clients/Wpmbk5ezJn`).reply({ data: { id: 'Wpmbk5ezJn' } })

      const result = await service.getClient('Wpmbk5ezJn')

      expect(result).toEqual({ data: { id: 'Wpmbk5ezJn' } })
      expect(mock.history[0].url).toBe(`${ BASE }/clients/Wpmbk5ezJn`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes the include param when provided', async () => {
      mock.onGet(`${ BASE }/clients/Wpmbk5ezJn`).reply({ data: {} })

      await service.getClient('Wpmbk5ezJn', 'invoices')

      expect(mock.history[0].query).toEqual({ include: 'invoices' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/clients/bad`).replyWithError({ message: 'Not found', status: 404 })

      await expect(service.getClient('bad')).rejects.toThrow(
        'Invoice Ninja API error: Not found [status 404]'
      )
    })
  })

  describe('createClient', () => {
    it('sends a POST with only the name when nothing else is provided', async () => {
      mock.onPost(`${ BASE }/clients`).reply({ data: { id: 'c1', name: 'Acme Inc' } })

      const result = await service.createClient('Acme Inc')

      expect(result).toEqual({ data: { id: 'c1', name: 'Acme Inc' } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/clients`)
      expect(mock.history[0].body).toEqual({ name: 'Acme Inc' })
    })

    it('includes address fields, contacts and additional fields', async () => {
      mock.onPost(`${ BASE }/clients`).reply({ data: { id: 'c2' } })

      const contacts = [{ first_name: 'Jane', email: 'jane@acme.com' }]

      await service.createClient(
        'Acme Inc',
        contacts,
        '1 Main St',
        'Suite 2',
        'Springfield',
        'IL',
        '62701',
        '840',
        '+15550001',
        'https://acme.com',
        { id_number: 'A-100' }
      )

      expect(mock.history[0].body).toEqual({
        name: 'Acme Inc',
        address1: '1 Main St',
        address2: 'Suite 2',
        city: 'Springfield',
        state: 'IL',
        postal_code: '62701',
        country_id: '840',
        phone: '+15550001',
        website: 'https://acme.com',
        id_number: 'A-100',
        contacts,
      })
    })

    it('omits contacts when the array is empty', async () => {
      mock.onPost(`${ BASE }/clients`).reply({ data: {} })

      await service.createClient('Acme Inc', [])

      expect(mock.history[0].body).toEqual({ name: 'Acme Inc' })
      expect(mock.history[0].body).not.toHaveProperty('contacts')
    })

    it('throws a wrapped error with field errors on validation failure', async () => {
      mock.onPost(`${ BASE }/clients`).replyWithError({
        message: 'The given data was invalid.',
        status: 422,
        body: {
          message: 'The given data was invalid.',
          errors: { name: ['The name field is required.'] },
        },
      })

      await expect(service.createClient('')).rejects.toThrow(
        'Invoice Ninja API error: The given data was invalid. (name: The name field is required.) [status 422]'
      )
    })
  })

  describe('updateClient', () => {
    it('sends a PUT with only the changed fields', async () => {
      mock.onPut(`${ BASE }/clients/c1`).reply({ data: { id: 'c1', name: 'Acme (Updated)' } })

      const result = await service.updateClient('c1', 'Acme (Updated)')

      expect(result).toEqual({ data: { id: 'c1', name: 'Acme (Updated)' } })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/clients/c1`)
      expect(mock.history[0].body).toEqual({ name: 'Acme (Updated)' })
    })

    it('includes all optional fields, contacts and additional fields', async () => {
      mock.onPut(`${ BASE }/clients/c1`).reply({ data: {} })

      const contacts = [{ first_name: 'John' }]

      await service.updateClient(
        'c1',
        'Acme',
        contacts,
        '9 Elm St',
        'Metropolis',
        'NY',
        '10001',
        '+15550002',
        'https://acme.io',
        { vat_number: 'VAT-1' }
      )

      expect(mock.history[0].body).toEqual({
        name: 'Acme',
        address1: '9 Elm St',
        city: 'Metropolis',
        state: 'NY',
        postal_code: '10001',
        phone: '+15550002',
        website: 'https://acme.io',
        vat_number: 'VAT-1',
        contacts,
      })
    })

    it('sends an empty body when no fields are provided', async () => {
      mock.onPut(`${ BASE }/clients/c1`).reply({ data: {} })

      await service.updateClient('c1')

      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPut(`${ BASE }/clients/c1`).replyWithError({ message: 'Boom' })

      await expect(service.updateClient('c1', 'Name')).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  describe('deleteClient', () => {
    it('sends a DELETE with no body', async () => {
      mock.onDelete(`${ BASE }/clients/c1`).reply({ data: { id: 'c1', is_deleted: true } })

      const result = await service.deleteClient('c1')

      expect(result).toEqual({ data: { id: 'c1', is_deleted: true } })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/clients/c1`)
      expect(mock.history[0].body).toBeUndefined()
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/clients/c1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteClient('c1')).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  // ── Invoices ──

  describe('listInvoices', () => {
    it('sends a bare GET when no params are provided', async () => {
      mock.onGet(`${ BASE }/invoices`).reply({ data: [] })

      await service.listInvoices()

      expect(mock.history[0].query).toEqual({})
    })

    it('includes all params and maps the status to client_status', async () => {
      mock.onGet(`${ BASE }/invoices`).reply({ data: [] })

      await service.listInvoices('c1', 'Paid', 'inv-1', 25, 3, 'client,payments')

      expect(mock.history[0].query).toEqual({
        client_id: 'c1',
        client_status: 'paid',
        filter: 'inv-1',
        per_page: 25,
        page: 3,
        include: 'client,payments',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/invoices`).replyWithError({ message: 'Boom' })

      await expect(service.listInvoices()).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  describe('getInvoice', () => {
    it('fetches a single invoice by id', async () => {
      mock.onGet(`${ BASE }/invoices/inv1`).reply({ data: { id: 'inv1' } })

      const result = await service.getInvoice('inv1')

      expect(result).toEqual({ data: { id: 'inv1' } })
      expect(mock.history[0].url).toBe(`${ BASE }/invoices/inv1`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes the include param when provided', async () => {
      mock.onGet(`${ BASE }/invoices/inv1`).reply({ data: {} })

      await service.getInvoice('inv1', 'client')

      expect(mock.history[0].query).toEqual({ include: 'client' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/invoices/inv1`).replyWithError({ message: 'Boom' })

      await expect(service.getInvoice('inv1')).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  describe('createInvoice', () => {
    it('sends a POST with client id and line items only', async () => {
      mock.onPost(`${ BASE }/invoices`).reply({ data: { id: 'inv1' } })

      const lineItems = [{ product_key: 'Design', cost: 150, quantity: 1 }]

      const result = await service.createInvoice('c1', lineItems)

      expect(result).toEqual({ data: { id: 'inv1' } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        client_id: 'c1',
        line_items: lineItems,
      })
    })

    it('includes all optional header fields', async () => {
      mock.onPost(`${ BASE }/invoices`).reply({ data: {} })

      const lineItems = [{ product_key: 'Design', cost: 150, quantity: 1 }]

      await service.createInvoice(
        'c1',
        lineItems,
        '2025-01-01',
        '2025-02-01',
        'PO-9',
        10,
        true,
        'Thanks for your business',
        { custom_value1: 'X' }
      )

      expect(mock.history[0].body).toEqual({
        client_id: 'c1',
        date: '2025-01-01',
        due_date: '2025-02-01',
        po_number: 'PO-9',
        discount: 10,
        is_amount_discount: true,
        public_notes: 'Thanks for your business',
        custom_value1: 'X',
        line_items: lineItems,
      })
    })

    it('defaults line_items to an empty array when not an array', async () => {
      mock.onPost(`${ BASE }/invoices`).reply({ data: {} })

      await service.createInvoice('c1', undefined)

      expect(mock.history[0].body).toEqual({ client_id: 'c1', line_items: [] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/invoices`).replyWithError({ message: 'Boom' })

      await expect(service.createInvoice('c1', [])).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  describe('updateInvoice', () => {
    it('sends a PUT with only the changed fields', async () => {
      mock.onPut(`${ BASE }/invoices/inv1`).reply({ data: { id: 'inv1' } })

      await service.updateInvoice('inv1', undefined, '2025-03-01')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/invoices/inv1`)
      expect(mock.history[0].body).toEqual({ date: '2025-03-01' })
    })

    it('includes line items and all optional fields', async () => {
      mock.onPut(`${ BASE }/invoices/inv1`).reply({ data: {} })

      const lineItems = [{ product_key: 'Dev', cost: 200, quantity: 1 }]

      await service.updateInvoice(
        'inv1',
        lineItems,
        '2025-03-01',
        '2025-04-01',
        'PO-10',
        'Updated notes',
        { footer: 'F' }
      )

      expect(mock.history[0].body).toEqual({
        date: '2025-03-01',
        due_date: '2025-04-01',
        po_number: 'PO-10',
        public_notes: 'Updated notes',
        footer: 'F',
        line_items: lineItems,
      })
    })

    it('omits line_items when the array is empty', async () => {
      mock.onPut(`${ BASE }/invoices/inv1`).reply({ data: {} })

      await service.updateInvoice('inv1', [], '2025-03-01')

      expect(mock.history[0].body).toEqual({ date: '2025-03-01' })
      expect(mock.history[0].body).not.toHaveProperty('line_items')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPut(`${ BASE }/invoices/inv1`).replyWithError({ message: 'Boom' })

      await expect(service.updateInvoice('inv1')).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  describe('deleteInvoice', () => {
    it('sends a DELETE with no body', async () => {
      mock.onDelete(`${ BASE }/invoices/inv1`).reply({ data: { id: 'inv1', is_deleted: true } })

      const result = await service.deleteInvoice('inv1')

      expect(result).toEqual({ data: { id: 'inv1', is_deleted: true } })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toBeUndefined()
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/invoices/inv1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteInvoice('inv1')).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  describe('invoiceAction', () => {
    it('maps the action choice and wraps the id in an array', async () => {
      mock.onPost(`${ BASE }/invoices/bulk`).reply({ data: [{ id: 'inv1' }] })

      const result = await service.invoiceAction('inv1', 'Mark Paid')

      expect(result).toEqual({ data: [{ id: 'inv1' }] })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/invoices/bulk`)
      expect(mock.history[0].body).toEqual({ action: 'mark_paid', ids: ['inv1'] })
    })

    it('maps the Email action', async () => {
      mock.onPost(`${ BASE }/invoices/bulk`).reply({ data: [] })

      await service.invoiceAction('inv1', 'Email')

      expect(mock.history[0].body).toEqual({ action: 'email', ids: ['inv1'] })
    })

    it('passes an unknown action through unchanged', async () => {
      mock.onPost(`${ BASE }/invoices/bulk`).reply({ data: [] })

      await service.invoiceAction('inv1', 'custom_action')

      expect(mock.history[0].body).toEqual({ action: 'custom_action', ids: ['inv1'] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/invoices/bulk`).replyWithError({ message: 'Boom' })

      await expect(service.invoiceAction('inv1', 'Archive')).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  // ── Payments ──

  describe('listPayments', () => {
    it('sends a bare GET when no params are provided', async () => {
      mock.onGet(`${ BASE }/payments`).reply({ data: [] })

      await service.listPayments()

      expect(mock.history[0].query).toEqual({})
    })

    it('includes all params', async () => {
      mock.onGet(`${ BASE }/payments`).reply({ data: [] })

      await service.listPayments('c1', 'ref-1', 15, 4, 'client,invoices')

      expect(mock.history[0].query).toEqual({
        client_id: 'c1',
        filter: 'ref-1',
        per_page: 15,
        page: 4,
        include: 'client,invoices',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/payments`).replyWithError({ message: 'Boom' })

      await expect(service.listPayments()).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  describe('getPayment', () => {
    it('fetches a single payment by id', async () => {
      mock.onGet(`${ BASE }/payments/p1`).reply({ data: { id: 'p1' } })

      const result = await service.getPayment('p1')

      expect(result).toEqual({ data: { id: 'p1' } })
      expect(mock.history[0].url).toBe(`${ BASE }/payments/p1`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes the include param when provided', async () => {
      mock.onGet(`${ BASE }/payments/p1`).reply({ data: {} })

      await service.getPayment('p1', 'invoices')

      expect(mock.history[0].query).toEqual({ include: 'invoices' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/payments/p1`).replyWithError({ message: 'Boom' })

      await expect(service.getPayment('p1')).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  describe('createPayment', () => {
    it('sends a POST with client id and amount only', async () => {
      mock.onPost(`${ BASE }/payments`).reply({ data: { id: 'p1' } })

      const result = await service.createPayment('c1', 150)

      expect(result).toEqual({ data: { id: 'p1' } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ client_id: 'c1', amount: 150 })
    })

    it('includes applied invoices and optional fields', async () => {
      mock.onPost(`${ BASE }/payments`).reply({ data: {} })

      const invoices = [{ invoice_id: 'inv1', amount: 150 }]

      await service.createPayment('c1', 150, invoices, '2025-01-05', 'chk-100', { type_id: '1' })

      expect(mock.history[0].body).toEqual({
        client_id: 'c1',
        amount: 150,
        date: '2025-01-05',
        transaction_reference: 'chk-100',
        type_id: '1',
        invoices,
      })
    })

    it('omits invoices when the array is empty', async () => {
      mock.onPost(`${ BASE }/payments`).reply({ data: {} })

      await service.createPayment('c1', 150, [])

      expect(mock.history[0].body).toEqual({ client_id: 'c1', amount: 150 })
      expect(mock.history[0].body).not.toHaveProperty('invoices')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/payments`).replyWithError({ message: 'Boom' })

      await expect(service.createPayment('c1', 150)).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  // ── Products ──

  describe('listProducts', () => {
    it('sends a bare GET when no params are provided', async () => {
      mock.onGet(`${ BASE }/products`).reply({ data: [] })

      await service.listProducts()

      expect(mock.history[0].query).toEqual({})
    })

    it('includes all params', async () => {
      mock.onGet(`${ BASE }/products`).reply({ data: [] })

      await service.listProducts('design', 30, 2, 'documents')

      expect(mock.history[0].query).toEqual({
        filter: 'design',
        per_page: 30,
        page: 2,
        include: 'documents',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/products`).replyWithError({ message: 'Boom' })

      await expect(service.listProducts()).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  describe('getProduct', () => {
    it('fetches a single product by id', async () => {
      mock.onGet(`${ BASE }/products/pr1`).reply({ data: { id: 'pr1' } })

      const result = await service.getProduct('pr1')

      expect(result).toEqual({ data: { id: 'pr1' } })
      expect(mock.history[0].url).toBe(`${ BASE }/products/pr1`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes the include param when provided', async () => {
      mock.onGet(`${ BASE }/products/pr1`).reply({ data: {} })

      await service.getProduct('pr1', 'documents')

      expect(mock.history[0].query).toEqual({ include: 'documents' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/products/pr1`).replyWithError({ message: 'Boom' })

      await expect(service.getProduct('pr1')).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  describe('createProduct', () => {
    it('sends a POST with the product key only', async () => {
      mock.onPost(`${ BASE }/products`).reply({ data: { id: 'pr1' } })

      const result = await service.createProduct('Design')

      expect(result).toEqual({ data: { id: 'pr1' } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ product_key: 'Design' })
    })

    it('includes all optional fields', async () => {
      mock.onPost(`${ BASE }/products`).reply({ data: {} })

      await service.createProduct('Design', 'Design work', 150, 1, { tax_name1: 'VAT' })

      expect(mock.history[0].body).toEqual({
        product_key: 'Design',
        notes: 'Design work',
        price: 150,
        quantity: 1,
        tax_name1: 'VAT',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/products`).replyWithError({ message: 'Boom' })

      await expect(service.createProduct('Design')).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  describe('updateProduct', () => {
    it('sends a PUT with only the changed fields', async () => {
      mock.onPut(`${ BASE }/products/pr1`).reply({ data: { id: 'pr1' } })

      await service.updateProduct('pr1', undefined, undefined, 175)

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/products/pr1`)
      expect(mock.history[0].body).toEqual({ price: 175 })
    })

    it('includes all optional fields', async () => {
      mock.onPut(`${ BASE }/products/pr1`).reply({ data: {} })

      await service.updateProduct('pr1', 'Design v2', 'New notes', 200, 2, { tax_rate1: 20 })

      expect(mock.history[0].body).toEqual({
        product_key: 'Design v2',
        notes: 'New notes',
        price: 200,
        quantity: 2,
        tax_rate1: 20,
      })
    })

    it('sends an empty body when no fields are provided', async () => {
      mock.onPut(`${ BASE }/products/pr1`).reply({ data: {} })

      await service.updateProduct('pr1')

      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPut(`${ BASE }/products/pr1`).replyWithError({ message: 'Boom' })

      await expect(service.updateProduct('pr1', 'X')).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  // ── Quotes ──

  describe('listQuotes', () => {
    it('sends a bare GET when no params are provided', async () => {
      mock.onGet(`${ BASE }/quotes`).reply({ data: [] })

      await service.listQuotes()

      expect(mock.history[0].query).toEqual({})
    })

    it('includes all params', async () => {
      mock.onGet(`${ BASE }/quotes`).reply({ data: [] })

      await service.listQuotes('c1', 'q-1', 20, 1, 'client')

      expect(mock.history[0].query).toEqual({
        client_id: 'c1',
        filter: 'q-1',
        per_page: 20,
        page: 1,
        include: 'client',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/quotes`).replyWithError({ message: 'Boom' })

      await expect(service.listQuotes()).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  describe('createQuote', () => {
    it('sends a POST with client id and line items only', async () => {
      mock.onPost(`${ BASE }/quotes`).reply({ data: { id: 'q1' } })

      const lineItems = [{ product_key: 'Design', cost: 150, quantity: 1 }]

      const result = await service.createQuote('c1', lineItems)

      expect(result).toEqual({ data: { id: 'q1' } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ client_id: 'c1', line_items: lineItems })
    })

    it('includes all optional header fields', async () => {
      mock.onPost(`${ BASE }/quotes`).reply({ data: {} })

      const lineItems = [{ product_key: 'Design', cost: 150, quantity: 1 }]

      await service.createQuote(
        'c1',
        lineItems,
        '2025-01-01',
        '2025-01-31',
        'PO-3',
        'Valid for 30 days',
        { custom_value1: 'Y' }
      )

      expect(mock.history[0].body).toEqual({
        client_id: 'c1',
        date: '2025-01-01',
        due_date: '2025-01-31',
        po_number: 'PO-3',
        public_notes: 'Valid for 30 days',
        custom_value1: 'Y',
        line_items: lineItems,
      })
    })

    it('defaults line_items to an empty array when not an array', async () => {
      mock.onPost(`${ BASE }/quotes`).reply({ data: {} })

      await service.createQuote('c1')

      expect(mock.history[0].body).toEqual({ client_id: 'c1', line_items: [] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/quotes`).replyWithError({ message: 'Boom' })

      await expect(service.createQuote('c1', [])).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  describe('approveQuote', () => {
    it('posts the approve action with the id wrapped in an array', async () => {
      mock.onPost(`${ BASE }/quotes/bulk`).reply({ data: [{ id: 'q1' }] })

      const result = await service.approveQuote('q1')

      expect(result).toEqual({ data: [{ id: 'q1' }] })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/quotes/bulk`)
      expect(mock.history[0].body).toEqual({ action: 'approve', ids: ['q1'] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/quotes/bulk`).replyWithError({ message: 'Boom' })

      await expect(service.approveQuote('q1')).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  // ── Recurring Invoices ──

  describe('listRecurringInvoices', () => {
    it('sends a bare GET when no params are provided', async () => {
      mock.onGet(`${ BASE }/recurring_invoices`).reply({ data: [] })

      await service.listRecurringInvoices()

      expect(mock.history[0].query).toEqual({})
    })

    it('includes all params', async () => {
      mock.onGet(`${ BASE }/recurring_invoices`).reply({ data: [] })

      await service.listRecurringInvoices('c1', 'r-1', 10, 2, 'client')

      expect(mock.history[0].query).toEqual({
        client_id: 'c1',
        filter: 'r-1',
        per_page: 10,
        page: 2,
        include: 'client',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/recurring_invoices`).replyWithError({ message: 'Boom' })

      await expect(service.listRecurringInvoices()).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })

  // ── Dictionary ──

  describe('getClientsDictionary', () => {
    it('maps clients to items and queries the active-clients endpoint', async () => {
      mock.onGet(`${ BASE }/clients`).reply({
        data: [
          {
            id: 'c1',
            name: 'Acme Inc',
            contacts: [{ id: 'ct1', email: 'jane@acme.com' }],
          },
          {
            id: 'c2',
            name: 'Beta LLC',
            contacts: [],
          },
        ],
        meta: { pagination: { current_page: 1, total_pages: 1 } },
      })

      const result = await service.getClientsDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ BASE }/clients`)
      expect(mock.history[0].query).toEqual({ per_page: 50, page: 1, status: 'active' })
      expect(result.items).toEqual([
        { label: 'Acme Inc', value: 'c1', note: 'jane@acme.com' },
        { label: 'Beta LLC', value: 'c2', note: undefined },
      ])
      expect(result.cursor).toBeUndefined()
    })

    it('passes the search term as the filter query', async () => {
      mock.onGet(`${ BASE }/clients`).reply({ data: [] })

      await service.getClientsDictionary({ search: 'acme' })

      expect(mock.history[0].query).toEqual({ filter: 'acme', per_page: 50, page: 1, status: 'active' })
    })

    it('uses the cursor as the page number and returns the next cursor', async () => {
      mock.onGet(`${ BASE }/clients`).reply({
        data: [{ id: 'c9', name: 'Client 9', contacts: [] }],
        meta: { pagination: { current_page: 2, total_pages: 5 } },
      })

      const result = await service.getClientsDictionary({ cursor: '2' })

      expect(mock.history[0].query).toEqual({ per_page: 50, page: 2, status: 'active' })
      expect(result.cursor).toBe('3')
    })

    it('falls back to the primary contact email when the client has no name', async () => {
      mock.onGet(`${ BASE }/clients`).reply({
        data: [{ id: 'c3', contacts: [{ email: 'noname@acme.com' }] }],
        meta: {},
      })

      const result = await service.getClientsDictionary({})

      expect(result.items[0]).toEqual({
        label: 'noname@acme.com',
        value: 'c3',
        note: 'noname@acme.com',
      })
    })

    it('falls back to the client id when there is no name or contact', async () => {
      mock.onGet(`${ BASE }/clients`).reply({
        data: [{ id: 'c4', contacts: [] }],
        meta: {},
      })

      const result = await service.getClientsDictionary({})

      expect(result.items[0]).toEqual({ label: 'c4', value: 'c4', note: undefined })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/clients`).reply({ data: [] })

      const result = await service.getClientsDictionary(null)

      expect(result).toEqual({ items: [], cursor: undefined })
      expect(mock.history[0].query).toEqual({ per_page: 50, page: 1, status: 'active' })
    })

    it('handles a non-array data response', async () => {
      mock.onGet(`${ BASE }/clients`).reply({ data: null })

      const result = await service.getClientsDictionary({})

      expect(result.items).toEqual([])
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/clients`).replyWithError({ message: 'Boom' })

      await expect(service.getClientsDictionary({})).rejects.toThrow('Invoice Ninja API error: Boom')
    })
  })
})
