'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SITE_URL = 'https://mycompany.erpnext.com'
const API_KEY = 'test-api-key'
const API_SECRET = 'test-api-secret'
const BASE = `${SITE_URL}/api`
const AUTH_HEADER = `token ${API_KEY}:${API_SECRET}`

describe('ERPNext Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      siteUrl: SITE_URL,
      apiKey: API_KEY,
      apiSecret: API_SECRET,
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

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'siteUrl', required: true, shared: false }),
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
          expect.objectContaining({ name: 'apiSecret', required: true, shared: false }),
        ])
      )
    })

    it('registers exactly 3 config items', () => {
      expect(sandbox.getConfigItems()).toHaveLength(3)
    })
  })

  // ── listDocuments ──

  describe('listDocuments', () => {
    it('sends GET with correct URL and auth header', async () => {
      mock.onGet(`${BASE}/resource/Sales%20Order`).reply({ data: [] })

      await service.listDocuments('Sales Order')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE}/resource/Sales%20Order`)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: AUTH_HEADER,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      })
    })

    it('sends empty query when no optional params provided', async () => {
      mock.onGet(`${BASE}/resource/Customer`).reply({ data: [] })

      await service.listDocuments('Customer')

      expect(mock.history[0].query).toEqual({})
    })

    it('passes filters as JSON-encoded string', async () => {
      mock.onGet(`${BASE}/resource/Customer`).reply({ data: [] })

      await service.listDocuments('Customer', [['status', '=', 'Open']])

      expect(mock.history[0].query).toMatchObject({
        filters: JSON.stringify([['status', '=', 'Open']]),
      })
    })

    it('passes filters when provided as a JSON string', async () => {
      mock.onGet(`${BASE}/resource/Customer`).reply({ data: [] })

      await service.listDocuments('Customer', '[["status","=","Open"]]')

      expect(mock.history[0].query).toMatchObject({
        filters: '[["status","=","Open"]]',
      })
    })

    it('passes fields as JSON-encoded string', async () => {
      mock.onGet(`${BASE}/resource/Item`).reply({ data: [] })

      await service.listDocuments('Item', undefined, ['name', 'item_name'])

      expect(mock.history[0].query).toMatchObject({
        fields: JSON.stringify(['name', 'item_name']),
      })
    })

    it('passes pagination and sorting params', async () => {
      mock.onGet(`${BASE}/resource/Item`).reply({ data: [] })

      await service.listDocuments('Item', undefined, undefined, 10, 20, 'modified desc')

      expect(mock.history[0].query).toMatchObject({
        limit_page_length: 10,
        limit_start: 20,
        order_by: 'modified desc',
      })
    })

    it('returns the response data', async () => {
      const mockData = { data: [{ name: 'CUST-001' }, { name: 'CUST-002' }] }

      mock.onGet(`${BASE}/resource/Customer`).reply(mockData)

      const result = await service.listDocuments('Customer')

      expect(result).toEqual(mockData)
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/resource/Customer`).replyWithError({
        message: 'Unauthorized',
        body: { message: 'Invalid API key' },
        status: 401,
      })

      await expect(service.listDocuments('Customer')).rejects.toThrow('ERPNext API error (401)')
    })
  })

  // ── getDocument ──

  describe('getDocument', () => {
    it('sends GET with correct URL for doctype and name', async () => {
      mock.onGet(`${BASE}/resource/Customer/CUST-00001`).reply({ data: { name: 'CUST-00001' } })

      await service.getDocument('Customer', 'CUST-00001')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE}/resource/Customer/CUST-00001`)
      expect(mock.history[0].headers).toMatchObject({ Authorization: AUTH_HEADER })
    })

    it('URL-encodes doctype and name', async () => {
      mock.onGet(`${BASE}/resource/Sales%20Order/SAL-ORD-2024%2F001`).reply({ data: {} })

      await service.getDocument('Sales Order', 'SAL-ORD-2024/001')

      expect(mock.history[0].url).toBe(`${BASE}/resource/Sales%20Order/SAL-ORD-2024%2F001`)
    })

    it('returns document data', async () => {
      const mockData = { data: { name: 'CUST-00001', customer_name: 'Acme Inc' } }

      mock.onGet(`${BASE}/resource/Customer/CUST-00001`).reply(mockData)

      const result = await service.getDocument('Customer', 'CUST-00001')

      expect(result).toEqual(mockData)
    })

    it('throws on not found', async () => {
      mock.onGet(`${BASE}/resource/Customer/MISSING`).replyWithError({
        message: 'Not Found',
        status: 404,
      })

      await expect(service.getDocument('Customer', 'MISSING')).rejects.toThrow('ERPNext API error (404)')
    })
  })

  // ── createDocument ──

  describe('createDocument', () => {
    it('sends POST with correct URL and body', async () => {
      const fields = { customer_name: 'Acme Inc', customer_group: 'Commercial' }

      mock.onPost(`${BASE}/resource/Customer`).reply({ data: { name: 'CUST-00042', ...fields } })

      await service.createDocument('Customer', fields)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${BASE}/resource/Customer`)
      expect(mock.history[0].body).toEqual(fields)
      expect(mock.history[0].headers).toMatchObject({ Authorization: AUTH_HEADER })
    })

    it('parses JSON string fields', async () => {
      mock.onPost(`${BASE}/resource/Customer`).reply({ data: { name: 'CUST-00043' } })

      await service.createDocument('Customer', '{"customer_name":"Test"}')

      expect(mock.history[0].body).toEqual({ customer_name: 'Test' })
    })

    it('sends empty object when fields is null', async () => {
      mock.onPost(`${BASE}/resource/ToDo`).reply({ data: { name: 'TODO-001' } })

      await service.createDocument('ToDo', null)

      expect(mock.history[0].body).toEqual({})
    })

    it('returns created document', async () => {
      const response = { data: { name: 'CUST-00042', customer_name: 'Acme Inc' } }

      mock.onPost(`${BASE}/resource/Customer`).reply(response)

      const result = await service.createDocument('Customer', { customer_name: 'Acme Inc' })

      expect(result).toEqual(response)
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/resource/Customer`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { exc_type: 'ValidationError', message: 'customer_name is required' },
      })

      await expect(service.createDocument('Customer', {})).rejects.toThrow('ERPNext API error (400)')
    })
  })

  // ── updateDocument ──

  describe('updateDocument', () => {
    it('sends PUT with correct URL and body', async () => {
      const fields = { customer_group: 'Individual' }

      mock.onPut(`${BASE}/resource/Customer/CUST-00042`).reply({ data: { name: 'CUST-00042' } })

      await service.updateDocument('Customer', 'CUST-00042', fields)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${BASE}/resource/Customer/CUST-00042`)
      expect(mock.history[0].body).toEqual(fields)
    })

    it('parses JSON string fields', async () => {
      mock.onPut(`${BASE}/resource/Customer/CUST-00042`).reply({ data: {} })

      await service.updateDocument('Customer', 'CUST-00042', '{"territory":"India"}')

      expect(mock.history[0].body).toEqual({ territory: 'India' })
    })

    it('sends empty object when fields is null', async () => {
      mock.onPut(`${BASE}/resource/Customer/CUST-00042`).reply({ data: {} })

      await service.updateDocument('Customer', 'CUST-00042', null)

      expect(mock.history[0].body).toEqual({})
    })

    it('returns updated document', async () => {
      const response = { data: { name: 'CUST-00042', customer_group: 'Individual' } }

      mock.onPut(`${BASE}/resource/Customer/CUST-00042`).reply(response)

      const result = await service.updateDocument('Customer', 'CUST-00042', { customer_group: 'Individual' })

      expect(result).toEqual(response)
    })
  })

  // ── deleteDocument ──

  describe('deleteDocument', () => {
    it('sends DELETE with correct URL', async () => {
      mock.onDelete(`${BASE}/resource/Customer/CUST-00042`).reply({ message: 'ok' })

      await service.deleteDocument('Customer', 'CUST-00042')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${BASE}/resource/Customer/CUST-00042`)
      expect(mock.history[0].headers).toMatchObject({ Authorization: AUTH_HEADER })
    })

    it('returns confirmation', async () => {
      mock.onDelete(`${BASE}/resource/Customer/CUST-00042`).reply({ message: 'ok' })

      const result = await service.deleteDocument('Customer', 'CUST-00042')

      expect(result).toEqual({ message: 'ok' })
    })

    it('throws on not found', async () => {
      mock.onDelete(`${BASE}/resource/Customer/MISSING`).replyWithError({
        message: 'Not Found',
        status: 404,
      })

      await expect(service.deleteDocument('Customer', 'MISSING')).rejects.toThrow('ERPNext API error (404)')
    })
  })

  // ── countDocuments ──

  describe('countDocuments', () => {
    it('sends GET to frappe.client.get_count with doctype', async () => {
      mock.onGet(`${BASE}/method/frappe.client.get_count`).reply({ message: 42 })

      await service.countDocuments('Customer')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE}/method/frappe.client.get_count`)
      expect(mock.history[0].query).toMatchObject({ doctype: 'Customer' })
    })

    it('passes filters when provided', async () => {
      mock.onGet(`${BASE}/method/frappe.client.get_count`).reply({ message: 5 })

      await service.countDocuments('Customer', [['status', '=', 'Active']])

      expect(mock.history[0].query).toMatchObject({
        doctype: 'Customer',
        filters: JSON.stringify([['status', '=', 'Active']]),
      })
    })

    it('omits filters when not provided', async () => {
      mock.onGet(`${BASE}/method/frappe.client.get_count`).reply({ message: 100 })

      await service.countDocuments('Item')

      expect(mock.history[0].query).toEqual({ doctype: 'Item' })
    })

    it('returns the count', async () => {
      mock.onGet(`${BASE}/method/frappe.client.get_count`).reply({ message: 128 })

      const result = await service.countDocuments('Customer')

      expect(result).toEqual({ message: 128 })
    })
  })

  // ── getValue ──

  describe('getValue', () => {
    it('sends GET to frappe.client.get_value with array fieldname', async () => {
      mock.onGet(`${BASE}/method/frappe.client.get_value`).reply({ message: { customer_group: 'Commercial' } })

      await service.getValue('Customer', ['customer_group'], [['customer_name', '=', 'Acme Inc']])

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE}/method/frappe.client.get_value`)
      expect(mock.history[0].query).toMatchObject({
        doctype: 'Customer',
        fieldname: JSON.stringify(['customer_group']),
        filters: JSON.stringify([['customer_name', '=', 'Acme Inc']]),
      })
    })

    it('passes multiple fieldnames as JSON-encoded array', async () => {
      mock.onGet(`${BASE}/method/frappe.client.get_value`).reply({ message: {} })

      await service.getValue('Customer', ['customer_group', 'territory'])

      expect(mock.history[0].query).toMatchObject({
        fieldname: JSON.stringify(['customer_group', 'territory']),
      })
    })

    it('passes fieldname as JSON string when provided as JSON array string', async () => {
      mock.onGet(`${BASE}/method/frappe.client.get_value`).reply({ message: {} })

      await service.getValue('Customer', '["customer_group","territory"]')

      expect(mock.history[0].query).toMatchObject({
        fieldname: '["customer_group","territory"]',
      })
    })

    it('returns the value', async () => {
      const response = { message: { customer_group: 'Commercial', territory: 'US' } }

      mock.onGet(`${BASE}/method/frappe.client.get_value`).reply(response)

      const result = await service.getValue('Customer', ['customer_group', 'territory'])

      expect(result).toEqual(response)
    })

    // NOTE: Passing a plain string fieldname (e.g. 'customer_group') throws because
    // parseJsonParam tries JSON.parse on it and fails. The fallback `|| fieldname`
    // on the same line never executes since parseJsonParam throws rather than returning
    // undefined. This is a potential service bug — fieldname should support plain strings.
  })

  // ── submitDocument ──

  describe('submitDocument', () => {
    it('sends POST to frappe.client.submit with doc in body', async () => {
      const doc = { doctype: 'Sales Order', name: 'SAL-ORD-001' }

      mock.onPost(`${BASE}/method/frappe.client.submit`).reply({ message: { ...doc, docstatus: 1 } })

      await service.submitDocument(doc)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${BASE}/method/frappe.client.submit`)
      expect(mock.history[0].body).toEqual({ doc })
    })

    it('parses JSON string doc', async () => {
      mock.onPost(`${BASE}/method/frappe.client.submit`).reply({ message: {} })

      await service.submitDocument('{"doctype":"Sales Order","name":"SAL-ORD-001"}')

      expect(mock.history[0].body).toEqual({
        doc: { doctype: 'Sales Order', name: 'SAL-ORD-001' },
      })
    })

    it('sends empty doc when null', async () => {
      mock.onPost(`${BASE}/method/frappe.client.submit`).reply({ message: {} })

      await service.submitDocument(null)

      expect(mock.history[0].body).toEqual({ doc: {} })
    })

    it('returns submitted document', async () => {
      const response = { message: { name: 'SAL-ORD-001', docstatus: 1 } }

      mock.onPost(`${BASE}/method/frappe.client.submit`).reply(response)

      const result = await service.submitDocument({ doctype: 'Sales Order', name: 'SAL-ORD-001' })

      expect(result).toEqual(response)
    })
  })

  // ── cancelDocument ──

  describe('cancelDocument', () => {
    it('sends POST to frappe.client.cancel with doctype and name', async () => {
      mock.onPost(`${BASE}/method/frappe.client.cancel`).reply({ message: { docstatus: 2 } })

      await service.cancelDocument('Sales Order', 'SAL-ORD-001')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${BASE}/method/frappe.client.cancel`)
      expect(mock.history[0].body).toEqual({ doctype: 'Sales Order', name: 'SAL-ORD-001' })
    })

    it('returns cancelled document', async () => {
      const response = { message: { name: 'SAL-ORD-001', docstatus: 2 } }

      mock.onPost(`${BASE}/method/frappe.client.cancel`).reply(response)

      const result = await service.cancelDocument('Sales Order', 'SAL-ORD-001')

      expect(result).toEqual(response)
    })
  })

  // ── runMethod ──

  describe('runMethod', () => {
    it('sends POST to the method path with params as body', async () => {
      const params = { doctype: 'Customer', limit_page_length: 5 }

      mock.onPost(`${BASE}/method/frappe.client.get_list`).reply({ message: [] })

      await service.runMethod('frappe.client.get_list', params)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${BASE}/method/frappe.client.get_list`)
      expect(mock.history[0].body).toEqual(params)
    })

    it('parses JSON string params', async () => {
      mock.onPost(`${BASE}/method/frappe.client.get_list`).reply({ message: [] })

      await service.runMethod('frappe.client.get_list', '{"doctype":"Customer"}')

      expect(mock.history[0].body).toEqual({ doctype: 'Customer' })
    })

    it('sends empty object when params not provided', async () => {
      mock.onPost(`${BASE}/method/myapp.api.ping`).reply({ message: 'pong' })

      await service.runMethod('myapp.api.ping')

      expect(mock.history[0].body).toEqual({})
    })

    it('URL-encodes method path segments', async () => {
      mock.onPost(`${BASE}/method/myapp.api.do_something`).reply({ message: 'ok' })

      await service.runMethod('myapp.api.do_something')

      expect(mock.history[0].url).toBe(`${BASE}/method/myapp.api.do_something`)
    })

    it('returns the method response', async () => {
      const response = { message: [{ name: 'CUST-00001' }] }

      mock.onPost(`${BASE}/method/frappe.client.get_list`).reply(response)

      const result = await service.runMethod('frappe.client.get_list', { doctype: 'Customer' })

      expect(result).toEqual(response)
    })

    it('throws on error', async () => {
      mock.onPost(`${BASE}/method/frappe.client.get_list`).replyWithError({
        message: 'Internal Server Error',
        status: 500,
        body: { exc_type: 'ValidationError', message: 'Something went wrong' },
      })

      await expect(service.runMethod('frappe.client.get_list', {})).rejects.toThrow('ERPNext API error (500)')
    })
  })

  // ── Error extraction ──

  describe('error extraction', () => {
    it('extracts _server_messages from Frappe error response', async () => {
      const serverMessages = JSON.stringify([
        JSON.stringify({ message: 'Field is required' }),
      ])

      mock.onGet(`${BASE}/resource/Customer`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { _server_messages: serverMessages },
      })

      await expect(service.listDocuments('Customer')).rejects.toThrow('Field is required')
    })

    it('extracts exc_type and message from error body', async () => {
      mock.onGet(`${BASE}/resource/Customer`).replyWithError({
        message: 'Server Error',
        status: 500,
        body: { exc_type: 'ValidationError', message: 'Missing value' },
      })

      await expect(service.listDocuments('Customer')).rejects.toThrow('ValidationError: Missing value')
    })

    it('handles HTML string error body', async () => {
      mock.onGet(`${BASE}/resource/Customer`).replyWithError({
        message: 'Server Error',
        status: 500,
        body: '<html><body>Internal Server Error</body></html>',
      })

      await expect(service.listDocuments('Customer')).rejects.toThrow('Internal Server Error')
    })

    it('falls back to error.message when body is absent', async () => {
      mock.onGet(`${BASE}/resource/Customer`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.listDocuments('Customer')).rejects.toThrow('Network timeout')
    })
  })

  // ── Invalid JSON handling ──

  describe('invalid JSON parameter handling', () => {
    it('throws descriptive error for invalid filters JSON', async () => {
      await expect(service.listDocuments('Customer', 'not-valid-json'))
        .rejects.toThrow('ERPNext API error: invalid JSON for filters')
    })

    it('throws descriptive error for invalid fields JSON string in createDocument', async () => {
      await expect(service.createDocument('Customer', '{bad json}'))
        .rejects.toThrow('ERPNext API error: invalid JSON for fields')
    })
  })
})
