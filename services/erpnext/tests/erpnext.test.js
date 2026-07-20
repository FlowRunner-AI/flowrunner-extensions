'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SITE_URL = 'https://mycompany.erpnext.com'
const API_KEY = 'test-api-key'
const API_SECRET = 'test-api-secret'
const AUTH = `token ${ API_KEY }:${ API_SECRET }`

describe('ERPNext Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ siteUrl: SITE_URL, apiKey: API_KEY, apiSecret: API_SECRET })
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

  // Convenience for the generic /api/resource path.
  const resource = (doctype, name) =>
    name === undefined
      ? `${ SITE_URL }/api/resource/${ encodeURIComponent(doctype) }`
      : `${ SITE_URL }/api/resource/${ encodeURIComponent(doctype) }/${ encodeURIComponent(name) }`

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items in order', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'siteUrl',
          displayName: 'Site URL',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiSecret',
          displayName: 'API Secret',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('has exactly three config items and none are shared', () => {
      const items = sandbox.getConfigItems()

      expect(items).toHaveLength(3)
      expect(items.every(item => item.shared === false)).toBe(true)
    })

    it('sends the token auth header and JSON headers on requests', async () => {
      mock.onGet(resource('Customer')).reply({ data: [] })

      await service.listDocuments('Customer')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': AUTH,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      })
    })

    it('strips a trailing slash from the configured site URL', async () => {
      // Build an isolated sandbox with a trailing-slash site URL. Re-requiring the
      // module re-runs addService() against whichever global is currently set, so
      // we snapshot and restore the primary sandbox's global around this check.
      const savedGlobal = global.Flowrunner
      jest.resetModules()

      const trailingSandbox = createSandbox({
        siteUrl: 'https://trailing.erpnext.com/',
        apiKey: API_KEY,
        apiSecret: API_SECRET,
      })

      require('../src/index.js')
      const trailingService = trailingSandbox.getService()
      const trailingMock = trailingSandbox.getRequestMock()

      trailingMock.onGet('https://trailing.erpnext.com/api/resource/Item').reply({ data: [] })

      await trailingService.listDocuments('Item')

      expect(trailingMock.history[0].url).toBe('https://trailing.erpnext.com/api/resource/Item')

      trailingSandbox.cleanup()
      jest.resetModules()
      global.Flowrunner = savedGlobal
    })
  })

  // ── listDocuments ──

  describe('listDocuments', () => {
    it('lists a doctype with no optional params (empty query)', async () => {
      mock.onGet(resource('Customer')).reply({ data: [{ name: 'CUST-00001' }] })

      const result = await service.listDocuments('Customer')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(resource('Customer'))
      // clean() strips undefined values, so no query keys are sent.
      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ data: [{ name: 'CUST-00001' }] })
    })

    it('URL-encodes doctypes containing spaces', async () => {
      mock.onGet(resource('Sales Order')).reply({ data: [] })

      await service.listDocuments('Sales Order')

      expect(mock.history[0].url).toBe(`${ SITE_URL }/api/resource/Sales%20Order`)
    })

    it('passes all params, JSON-encoding filters and fields', async () => {
      mock.onGet(resource('Sales Order')).reply({ data: [] })

      const filters = [['status', '=', 'Open'], ['grand_total', '>', 1000]]
      const fields = ['name', 'customer_name', 'grand_total']

      await service.listDocuments('Sales Order', filters, fields, 10, 20, 'modified desc')

      expect(mock.history[0].query).toEqual({
        filters: JSON.stringify(filters),
        fields: JSON.stringify(fields),
        limit_page_length: 10,
        limit_start: 20,
        order_by: 'modified desc',
      })
    })

    it('accepts filters and fields passed as JSON strings', async () => {
      mock.onGet(resource('Item')).reply({ data: [] })

      const filtersStr = '[["item_group","=","Products"]]'
      const fieldsStr = '["name","item_name"]'

      await service.listDocuments('Item', filtersStr, fieldsStr)

      // Parsed then re-encoded back to a canonical JSON string.
      expect(mock.history[0].query).toEqual({
        filters: JSON.stringify([['item_group', '=', 'Products']]),
        fields: JSON.stringify(['name', 'item_name']),
      })
    })

    it('sends limit_page_length when set to 0 (no limit)', async () => {
      mock.onGet(resource('Item')).reply({ data: [] })

      await service.listDocuments('Item', undefined, undefined, 0)

      // 0 is falsy but must still be sent; clean() only strips undefined/null/''.
      expect(mock.history[0].query).toEqual({ limit_page_length: 0 })
    })

    it('throws a wrapped error with invalid JSON filters', async () => {
      await expect(service.listDocuments('Customer', '{not json')).rejects.toThrow(
        /invalid JSON for filters/
      )
    })

    it('throws a wrapped ERPNext error on API failure', async () => {
      mock.onGet(resource('Customer')).replyWithError({
        message: 'Forbidden',
        status: 403,
        body: { exc_type: 'PermissionError', message: 'Not permitted' },
      })

      await expect(service.listDocuments('Customer')).rejects.toThrow(
        'ERPNext API error (403): PermissionError: Not permitted'
      )
    })
  })

  // ── getDocument ──

  describe('getDocument', () => {
    it('gets a single document by doctype and name', async () => {
      mock.onGet(resource('Customer', 'CUST-00001')).reply({
        data: { name: 'CUST-00001', customer_name: 'Acme Inc' },
      })

      const result = await service.getDocument('Customer', 'CUST-00001')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(resource('Customer', 'CUST-00001'))
      expect(result).toEqual({ data: { name: 'CUST-00001', customer_name: 'Acme Inc' } })
    })

    it('URL-encodes doctype and name segments', async () => {
      mock.onGet(resource('Sales Order', 'SAL-ORD/2024')).reply({ data: {} })

      await service.getDocument('Sales Order', 'SAL-ORD/2024')

      expect(mock.history[0].url).toBe(
        `${ SITE_URL }/api/resource/Sales%20Order/SAL-ORD%2F2024`
      )
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(resource('Customer', 'MISSING')).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { exc_type: 'DoesNotExistError' },
      })

      await expect(service.getDocument('Customer', 'MISSING')).rejects.toThrow(
        'ERPNext API error (404): DoesNotExistError'
      )
    })
  })

  // ── createDocument ──

  describe('createDocument', () => {
    it('posts field values to the doctype collection', async () => {
      mock.onPost(resource('Customer')).reply({ data: { name: 'CUST-00042' } })

      const fields = { customer_name: 'Acme Inc', customer_group: 'Commercial' }
      const result = await service.createDocument('Customer', fields)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(resource('Customer'))
      expect(mock.history[0].body).toEqual(fields)
      expect(result).toEqual({ data: { name: 'CUST-00042' } })
    })

    it('accepts a JSON string for fields', async () => {
      mock.onPost(resource('Contact')).reply({ data: { name: 'CT-01' } })

      await service.createDocument('Contact', '{"first_name":"Jane"}')

      expect(mock.history[0].body).toEqual({ first_name: 'Jane' })
    })

    it('sends an empty object body when fields are omitted', async () => {
      mock.onPost(resource('ToDo')).reply({ data: { name: 'TODO-01' } })

      await service.createDocument('ToDo')

      expect(mock.history[0].body).toEqual({})
    })

    it('throws on invalid JSON fields', async () => {
      await expect(service.createDocument('Customer', '{bad')).rejects.toThrow(
        /invalid JSON for fields/
      )
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(resource('Customer')).replyWithError({
        message: 'Bad Request',
        status: 417,
        body: { _server_messages: JSON.stringify([JSON.stringify({ message: 'Customer already exists' })]) },
      })

      await expect(service.createDocument('Customer', {})).rejects.toThrow(
        'ERPNext API error (417): Customer already exists'
      )
    })
  })

  // ── updateDocument ──

  describe('updateDocument', () => {
    it('puts partial fields to the document', async () => {
      mock.onPut(resource('Customer', 'CUST-00042')).reply({
        data: { name: 'CUST-00042', customer_group: 'Individual' },
      })

      const result = await service.updateDocument('Customer', 'CUST-00042', {
        customer_group: 'Individual',
      })

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(resource('Customer', 'CUST-00042'))
      expect(mock.history[0].body).toEqual({ customer_group: 'Individual' })
      expect(result).toEqual({ data: { name: 'CUST-00042', customer_group: 'Individual' } })
    })

    it('accepts a JSON string for fields', async () => {
      mock.onPut(resource('Item', 'ITEM-1')).reply({ data: {} })

      await service.updateDocument('Item', 'ITEM-1', '{"item_name":"Widget"}')

      expect(mock.history[0].body).toEqual({ item_name: 'Widget' })
    })

    it('sends an empty object body when fields are omitted', async () => {
      mock.onPut(resource('Item', 'ITEM-1')).reply({ data: {} })

      await service.updateDocument('Item', 'ITEM-1')

      expect(mock.history[0].body).toEqual({})
    })

    it('throws on invalid JSON fields', async () => {
      await expect(service.updateDocument('Item', 'ITEM-1', 'nope')).rejects.toThrow(
        /invalid JSON for fields/
      )
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPut(resource('Item', 'ITEM-1')).replyWithError({
        message: 'Server Error',
        status: 500,
        body: { exc_type: 'ValidationError', message: 'Invalid field' },
      })

      await expect(service.updateDocument('Item', 'ITEM-1', {})).rejects.toThrow(
        'ERPNext API error (500): ValidationError: Invalid field'
      )
    })
  })

  // ── deleteDocument ──

  describe('deleteDocument', () => {
    it('deletes a document by doctype and name', async () => {
      mock.onDelete(resource('Customer', 'CUST-00042')).reply({ message: 'ok' })

      const result = await service.deleteDocument('Customer', 'CUST-00042')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(resource('Customer', 'CUST-00042'))
      expect(mock.history[0].body).toBeUndefined()
      expect(result).toEqual({ message: 'ok' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(resource('Customer', 'LINKED')).replyWithError({
        message: 'Conflict',
        status: 409,
        body: { exc_type: 'LinkExistsError', message: 'Cannot delete linked document' },
      })

      await expect(service.deleteDocument('Customer', 'LINKED')).rejects.toThrow(
        'ERPNext API error (409): LinkExistsError: Cannot delete linked document'
      )
    })
  })

  // ── countDocuments ──

  describe('countDocuments', () => {
    const COUNT_URL = `${ SITE_URL }/api/method/frappe.client.get_count`

    it('counts all documents of a doctype (no filters)', async () => {
      mock.onGet(COUNT_URL).reply({ message: 128 })

      const result = await service.countDocuments('Sales Order')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(COUNT_URL)
      expect(mock.history[0].query).toEqual({ doctype: 'Sales Order' })
      expect(result).toEqual({ message: 128 })
    })

    it('counts with JSON-encoded filters', async () => {
      mock.onGet(COUNT_URL).reply({ message: 5 })

      const filters = [['status', '=', 'Open']]
      await service.countDocuments('Sales Order', filters)

      expect(mock.history[0].query).toEqual({
        doctype: 'Sales Order',
        filters: JSON.stringify(filters),
      })
    })

    it('accepts a JSON string filter', async () => {
      mock.onGet(COUNT_URL).reply({ message: 3 })

      await service.countDocuments('Item', '[["disabled","=",0]]')

      expect(mock.history[0].query).toEqual({
        doctype: 'Item',
        filters: JSON.stringify([['disabled', '=', 0]]),
      })
    })

    it('throws on invalid JSON filters', async () => {
      await expect(service.countDocuments('Item', '{bad')).rejects.toThrow(
        /invalid JSON for filters/
      )
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(COUNT_URL).replyWithError({ message: 'Boom', status: 500 })

      await expect(service.countDocuments('Item')).rejects.toThrow(
        'ERPNext API error (500): Boom'
      )
    })
  })

  // ── getValue ──

  describe('getValue', () => {
    const VALUE_URL = `${ SITE_URL }/api/method/frappe.client.get_value`

    // NOTE: getValue runs the fieldname through parseJsonParam(), which calls
    // JSON.parse(). A plain field name like "customer_group" is NOT valid JSON,
    // so the documented single-field usage throws. See the bug report in the
    // final summary. The tests below pin the ACTUAL current behavior.

    it('reads a single field passed as a JSON-quoted string', async () => {
      mock.onGet(VALUE_URL).reply({ message: { customer_group: 'Commercial' } })

      // A JSON-quoted string parses to a plain string, which re-encodes as-is.
      const result = await service.getValue('Customer', '"customer_group"', [
        ['customer_name', '=', 'Acme Inc'],
      ])

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(VALUE_URL)
      expect(mock.history[0].query).toEqual({
        doctype: 'Customer',
        fieldname: 'customer_group',
        filters: JSON.stringify([['customer_name', '=', 'Acme Inc']]),
      })
      expect(result).toEqual({ message: { customer_group: 'Commercial' } })
    })

    it('JSON-encodes a fieldname array', async () => {
      mock.onGet(VALUE_URL).reply({ message: {} })

      await service.getValue('Customer', '["customer_group","territory"]')

      expect(mock.history[0].query).toEqual({
        doctype: 'Customer',
        fieldname: JSON.stringify(['customer_group', 'territory']),
      })
    })

    it('accepts a fieldname array passed as a real array', async () => {
      mock.onGet(VALUE_URL).reply({ message: {} })

      await service.getValue('Customer', ['customer_group', 'territory'])

      expect(mock.history[0].query).toEqual({
        doctype: 'Customer',
        fieldname: JSON.stringify(['customer_group', 'territory']),
      })
    })

    it('BUG: a plain (non-JSON) fieldname throws instead of being sent as-is', async () => {
      mock.onGet(VALUE_URL).reply({ message: {} })

      await expect(service.getValue('Customer', 'customer_group')).rejects.toThrow(
        /invalid JSON for fieldname/
      )
    })

    it('throws a wrapped error on API failure (using a JSON-quoted fieldname)', async () => {
      mock.onGet(VALUE_URL).replyWithError({ message: 'No such field', status: 500 })

      await expect(service.getValue('Customer', '"nope"')).rejects.toThrow(
        'ERPNext API error (500): No such field'
      )
    })
  })

  // ── submitDocument ──

  describe('submitDocument', () => {
    const SUBMIT_URL = `${ SITE_URL }/api/method/frappe.client.submit`

    it('wraps the document in a doc body', async () => {
      mock.onPost(SUBMIT_URL).reply({
        message: { name: 'SAL-ORD-2024-00001', docstatus: 1 },
      })

      const doc = { doctype: 'Sales Order', name: 'SAL-ORD-2024-00001' }
      const result = await service.submitDocument(doc)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(SUBMIT_URL)
      expect(mock.history[0].body).toEqual({ doc })
      expect(result).toEqual({ message: { name: 'SAL-ORD-2024-00001', docstatus: 1 } })
    })

    it('accepts a JSON string document', async () => {
      mock.onPost(SUBMIT_URL).reply({ message: {} })

      await service.submitDocument('{"doctype":"Sales Order","name":"SO-1"}')

      expect(mock.history[0].body).toEqual({
        doc: { doctype: 'Sales Order', name: 'SO-1' },
      })
    })

    it('sends an empty doc object when doc is omitted', async () => {
      mock.onPost(SUBMIT_URL).reply({ message: {} })

      await service.submitDocument()

      expect(mock.history[0].body).toEqual({ doc: {} })
    })

    it('throws on invalid JSON document', async () => {
      await expect(service.submitDocument('{bad')).rejects.toThrow(/invalid JSON for doc/)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(SUBMIT_URL).replyWithError({
        message: 'Cannot submit',
        status: 500,
        body: { exc_type: 'ValidationError' },
      })

      await expect(service.submitDocument({ doctype: 'Sales Order', name: 'SO-1' })).rejects.toThrow(
        'ERPNext API error (500): ValidationError'
      )
    })
  })

  // ── cancelDocument ──

  describe('cancelDocument', () => {
    const CANCEL_URL = `${ SITE_URL }/api/method/frappe.client.cancel`

    it('posts doctype and name to cancel', async () => {
      mock.onPost(CANCEL_URL).reply({
        message: { name: 'SAL-ORD-2024-00001', docstatus: 2 },
      })

      const result = await service.cancelDocument('Sales Order', 'SAL-ORD-2024-00001')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(CANCEL_URL)
      expect(mock.history[0].body).toEqual({
        doctype: 'Sales Order',
        name: 'SAL-ORD-2024-00001',
      })
      expect(result).toEqual({ message: { name: 'SAL-ORD-2024-00001', docstatus: 2 } })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(CANCEL_URL).replyWithError({
        message: 'Cannot cancel',
        status: 500,
        body: { exc_type: 'ValidationError', message: 'Already cancelled' },
      })

      await expect(service.cancelDocument('Sales Order', 'SO-1')).rejects.toThrow(
        'ERPNext API error (500): ValidationError: Already cancelled'
      )
    })
  })

  // ── runMethod ──

  describe('runMethod', () => {
    it('posts params to the dotted method path', async () => {
      const url = `${ SITE_URL }/api/method/frappe.client.get_list`
      mock.onPost(url).reply({ message: [{ name: 'CUST-00001' }] })

      const params = { doctype: 'Customer', limit_page_length: 5 }
      const result = await service.runMethod('frappe.client.get_list', params)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].body).toEqual(params)
      expect(result).toEqual({ message: [{ name: 'CUST-00001' }] })
    })

    it('accepts a JSON string for params', async () => {
      const url = `${ SITE_URL }/api/method/myapp.api.do_something`
      mock.onPost(url).reply({ message: 'ok' })

      await service.runMethod('myapp.api.do_something', '{"x":1}')

      expect(mock.history[0].body).toEqual({ x: 1 })
    })

    it('sends an empty body when params are omitted', async () => {
      const url = `${ SITE_URL }/api/method/frappe.ping`
      mock.onPost(url).reply({ message: 'pong' })

      await service.runMethod('frappe.ping')

      expect(mock.history[0].body).toEqual({})
    })

    it('encodes each path segment but preserves slashes', async () => {
      const url = `${ SITE_URL }/api/method/my%20app/do%20it`
      mock.onPost(url).reply({ message: 'ok' })

      await service.runMethod('my app/do it')

      expect(mock.history[0].url).toBe(url)
    })

    it('throws on invalid JSON params', async () => {
      await expect(service.runMethod('frappe.ping', '{bad')).rejects.toThrow(
        /invalid JSON for params/
      )
    })

    it('throws a wrapped error on API failure', async () => {
      const url = `${ SITE_URL }/api/method/frappe.client.get_list`
      mock.onPost(url).replyWithError({
        message: 'Method not whitelisted',
        status: 403,
      })

      await expect(service.runMethod('frappe.client.get_list', {})).rejects.toThrow(
        'ERPNext API error (403): Method not whitelisted'
      )
    })
  })

  // ── error extraction edge cases ──

  describe('error message extraction', () => {
    it('parses _server_messages and strips HTML', async () => {
      mock.onGet(resource('Customer')).replyWithError({
        message: 'Bad Request',
        status: 417,
        body: {
          _server_messages: JSON.stringify([
            JSON.stringify({ message: '<b>Mandatory</b> field missing' }),
          ]),
        },
      })

      await expect(service.listDocuments('Customer')).rejects.toThrow(
        'ERPNext API error (417): Mandatory field missing'
      )
    })

    it('collapses an HTML string body into a short message', async () => {
      mock.onGet(resource('Customer')).replyWithError({
        message: 'Server Error',
        status: 500,
        body: '<html><body><h1>Internal Server Error</h1></body></html>',
      })

      await expect(service.listDocuments('Customer')).rejects.toThrow(
        'ERPNext API error (500): Internal Server Error'
      )
    })

    it('falls back to error.message when no body is present', async () => {
      mock.onGet(resource('Customer')).replyWithError({
        message: 'Network down',
      })

      // No status attached, so no status suffix.
      await expect(service.listDocuments('Customer')).rejects.toThrow(
        'ERPNext API error: Network down'
      )
    })
  })
})
