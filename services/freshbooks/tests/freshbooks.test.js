'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const ACCOUNT_ID = 'ZykWor'
const BUSINESS_ID = '14691043'

const API_BASE = 'https://api.freshbooks.com'
const TOKEN_URL = `${API_BASE}/auth/oauth/token`
const IDENTITY_URL = `${API_BASE}/auth/api/v1/users/me`

function accountingUrl(path) {
  return `${API_BASE}/accounting/account/${ACCOUNT_ID}/${path}`
}

function projectsUrl(path) {
  return `${API_BASE}/projects/business/${BUSINESS_ID}/${path}`
}

function timeUrl(path) {
  return `${API_BASE}/timetracking/business/${BUSINESS_ID}/${path}`
}

function commentsUrl(path) {
  return `${API_BASE}/comments/business/${BUSINESS_ID}/${path}`
}

function eventsUrl(path) {
  return `${API_BASE}/events/account/${ACCOUNT_ID}/${path}`
}

function accountingReply(key, data, extra) {
  return {
    response: {
      result: {
        [key]: data,
        ...extra,
      },
    },
  }
}

function accountingListReply(key, items, page, pages, total) {
  return {
    response: {
      result: {
        [key]: items,
        page: page || 1,
        pages: pages || 1,
        total: total || items.length,
      },
    },
  }
}

describe('FreshBooks Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Set OAuth headers on every request context
    service.request = {
      headers: {
        'oauth-access-token': ACCESS_TOKEN,
        'oauth-user-data-accountid': ACCOUNT_ID,
        'oauth-user-data-businessid': BUSINESS_ID,
      },
    }
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
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })
  })

  // ── OAuth2 ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns the correct authorization URL', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain('https://auth.freshbooks.com/oauth/authorize/')
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and resolves identity', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      mock.onGet(IDENTITY_URL).reply({
        response: {
          business_memberships: [
            {
              business: {
                id: 14691043,
                account_id: 'ZykWor',
                name: 'My Business',
              },
            },
          ],
        },
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://example.com/callback',
      })

      expect(result.token).toBe('new-access-token')
      expect(result.refreshToken).toBe('new-refresh-token')
      expect(result.expirationInSeconds).toBe(3600)
      expect(result.connectionIdentityName).toBe('My Business')
      expect(result.overwrite).toBe(true)
      expect(result.userData).toMatchObject({
        accountId: 'ZykWor',
        businessId: '14691043',
        businessName: 'My Business',
      })

      // Verify token exchange request
      expect(mock.history[0].url).toBe(TOKEN_URL)
      expect(mock.history[0].method).toBe('post')
    })
  })

  describe('refreshToken', () => {
    it('refreshes the token and returns new credentials', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'refreshed-access-token',
        refresh_token: 'rotated-refresh-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result.token).toBe('refreshed-access-token')
      expect(result.refreshToken).toBe('rotated-refresh-token')
      expect(result.expirationInSeconds).toBe(3600)
    })

    it('falls back to the original refresh token if none returned', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 7200,
      })

      const result = await service.refreshToken('original-refresh-token')

      expect(result.refreshToken).toBe('original-refresh-token')
    })
  })

  // ── Dictionaries ──

  describe('getClientsDictionary', () => {
    it('returns formatted client items', async () => {
      mock.onGet(accountingUrl('users/clients')).reply(
        accountingListReply('clients', [
          { id: 1, organization: 'Acme Corp', fname: 'Jane', lname: 'Doe', email: 'jane@acme.com' },
          { id: 2, fname: 'Bob', lname: 'Smith', email: 'bob@test.com' },
        ])
      )

      const result = await service.getClientsDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toMatchObject({
        label: 'Acme Corp',
        value: '1',
        note: 'jane@acme.com',
      })
      expect(result.items[1]).toMatchObject({
        label: 'Bob Smith',
        value: '2',
      })
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onGet(accountingUrl('users/clients')).reply(
        accountingListReply('clients', [
          { id: 1, organization: 'Acme Corp', email: 'a@acme.com' },
          { id: 2, organization: 'Beta Inc', email: 'b@beta.com' },
        ])
      )

      const result = await service.getClientsDictionary({ search: 'acme' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Acme Corp')
    })

    it('returns cursor for multi-page results', async () => {
      mock.onGet(accountingUrl('users/clients')).reply(
        accountingListReply('clients', [{ id: 1, organization: 'A' }], 1, 3)
      )

      const result = await service.getClientsDictionary({})

      expect(result.cursor).toBe('2')
    })

    it('uses cursor for pagination', async () => {
      mock.onGet(accountingUrl('users/clients')).reply(
        accountingListReply('clients', [{ id: 2, organization: 'B' }], 2, 3)
      )

      const result = await service.getClientsDictionary({ cursor: '2' })

      expect(mock.history[0].query).toMatchObject({ page: 2 })
      expect(result.cursor).toBe('3')
    })
  })

  describe('getInvoicesDictionary', () => {
    it('returns formatted invoice items', async () => {
      mock.onGet(accountingUrl('invoices/invoices')).reply(
        accountingListReply('invoices', [
          {
            invoiceid: 987,
            invoice_number: '0001',
            current_organization: 'Acme',
            amount: { amount: '1500.00', code: 'USD' },
            v3_status: 'paid',
          },
        ])
      )

      const result = await service.getInvoicesDictionary({})

      expect(result.items[0].label).toContain('#0001')
      expect(result.items[0].label).toContain('Acme')
      expect(result.items[0].value).toBe('987')
      expect(result.items[0].note).toContain('paid')
    })
  })

  describe('getItemsDictionary', () => {
    it('returns formatted item entries', async () => {
      mock.onGet(accountingUrl('items/items')).reply(
        accountingListReply('items', [
          { itemid: 55, name: 'Design', unit_cost: { amount: '120.00', code: 'USD' } },
        ])
      )

      const result = await service.getItemsDictionary({})

      expect(result.items[0]).toMatchObject({
        label: 'Design',
        value: '55',
        note: 'USD 120.00',
      })
    })
  })

  describe('getTaxesDictionary', () => {
    it('returns formatted tax entries', async () => {
      mock.onGet(accountingUrl('taxes/taxes')).reply(
        accountingListReply('taxes', [{ name: 'GST', amount: '5' }])
      )

      const result = await service.getTaxesDictionary({})

      expect(result.items[0]).toMatchObject({
        label: 'GST (5%)',
        value: 'GST',
        note: '5%',
      })
    })
  })

  describe('getExpenseCategoriesDictionary', () => {
    it('returns formatted categories', async () => {
      mock.onGet(accountingUrl('expenses/categories')).reply(
        accountingListReply('categories', [
          { categoryid: 100, category: 'Meals & Entertainment' },
        ])
      )

      const result = await service.getExpenseCategoriesDictionary({})

      expect(result.items[0]).toMatchObject({
        label: 'Meals & Entertainment',
        value: '100',
      })
    })
  })

  describe('getVendorsDictionary', () => {
    it('returns formatted vendor entries', async () => {
      mock.onGet(accountingUrl('bill_vendors/bill_vendors')).reply(
        accountingListReply('bill_vendors', [
          { vendorid: 1562, vendor_name: 'Supplies Co', primary_contact_email: 'a@b.com' },
        ])
      )

      const result = await service.getVendorsDictionary({})

      expect(result.items[0]).toMatchObject({
        label: 'Supplies Co',
        value: '1562',
        note: 'a@b.com',
      })
    })
  })

  describe('getProjectsDictionary', () => {
    it('returns formatted project entries', async () => {
      mock.onGet(projectsUrl('projects')).reply({
        projects: [{ id: 100, title: 'Website', project_type: 'fixed_price' }],
        meta: { pages: 1 },
      })

      const result = await service.getProjectsDictionary({})

      expect(result.items[0]).toMatchObject({
        label: 'Website',
        value: '100',
        note: 'fixed price',
      })
    })
  })

  describe('getCurrenciesDictionary', () => {
    it('returns common currencies without search', async () => {
      const result = await service.getCurrenciesDictionary({})

      expect(result.items.length).toBeGreaterThan(10)
      expect(result.items[0]).toMatchObject({
        label: 'US Dollar (USD)',
        value: 'USD',
      })
      expect(result.cursor).toBeNull()
    })

    it('filters currencies by search term', async () => {
      const result = await service.getCurrenciesDictionary({ search: 'euro' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('EUR')
    })
  })

  describe('getServicesDictionary', () => {
    it('returns formatted service entries', async () => {
      mock.onGet(commentsUrl('services')).reply({
        services: [{ id: 123, name: 'Consulting', billable: true }],
      })

      const result = await service.getServicesDictionary({})

      expect(result.items[0]).toMatchObject({
        label: 'Consulting',
        value: '123',
        note: 'billable',
      })
    })
  })

  // ── Clients ──

  describe('findClients', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(accountingUrl('users/clients')).reply(
        accountingListReply('clients', [{ id: 1, organization: 'Acme' }])
      )

      const result = await service.findClients()

      expect(result).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ per_page: 100, page: 1 })
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        Accept: 'application/json',
        'Api-Version': 'alpha',
      })
    })

    it('applies search filter client-side', async () => {
      mock.onGet(accountingUrl('users/clients')).reply(
        accountingListReply('clients', [
          { id: 1, organization: 'Acme Corp' },
          { id: 2, organization: 'Beta Inc' },
        ])
      )

      const result = await service.findClients('acme')

      expect(result).toHaveLength(1)
      expect(result[0].organization).toBe('Acme Corp')
    })

    it('passes onlyWithOutstanding filter', async () => {
      mock.onGet(accountingUrl('users/clients')).reply(
        accountingListReply('clients', [])
      )

      await service.findClients(undefined, true)

      expect(mock.history[0].query).toMatchObject({ 'search[has_outstanding]': true })
    })

    it('respects maxResults', async () => {
      mock.onGet(accountingUrl('users/clients')).reply(
        accountingListReply('clients', [])
      )

      await service.findClients(undefined, undefined, 10)

      expect(mock.history[0].query).toMatchObject({ per_page: 10 })
    })
  })

  describe('getClient', () => {
    it('returns the client', async () => {
      mock.onGet(accountingUrl('users/clients/123')).reply(
        accountingReply('client', { id: 123, organization: 'Test' })
      )

      const result = await service.getClient('123')

      expect(result).toMatchObject({ id: 123, organization: 'Test' })
    })

    it('throws when clientId is missing', async () => {
      await expect(service.getClient()).rejects.toThrow('"Client" is required.')
    })
  })

  describe('createClient', () => {
    it('sends correct body with all fields', async () => {
      mock.onPost(accountingUrl('users/clients')).reply(
        accountingReply('client', { id: 1 })
      )

      await service.createClient(
        'Jane', 'Doe', 'Acme', 'jane@acme.com', '555-1234',
        'USD', '123 Main St', 'Suite 4', 'NYC', 'NY', '10001', 'US', 'VIP client'
      )

      expect(mock.history[0].body).toMatchObject({
        client: {
          fname: 'Jane',
          lname: 'Doe',
          organization: 'Acme',
          email: 'jane@acme.com',
          mob_phone: '555-1234',
          currency_code: 'USD',
          p_street: '123 Main St',
          p_street2: 'Suite 4',
          p_city: 'NYC',
          p_province: 'NY',
          p_code: '10001',
          p_country: 'US',
          note: 'VIP client',
        },
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(accountingUrl('users/clients')).reply(
        accountingReply('client', { id: 2 })
      )

      await service.createClient('Bob')

      const body = mock.history[0].body
      expect(body.client).toMatchObject({ fname: 'Bob' })
      expect(body.client.lname).toBeUndefined()
    })
  })

  describe('updateClient', () => {
    it('sends PUT with correct body', async () => {
      mock.onPut(accountingUrl('users/clients/123')).reply(
        accountingReply('client', { id: 123 })
      )

      await service.updateClient('123', 'Jane', 'Doe', 'Acme Updated')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body.client).toMatchObject({
        fname: 'Jane',
        lname: 'Doe',
        organization: 'Acme Updated',
      })
    })

    it('throws when clientId is missing', async () => {
      await expect(service.updateClient()).rejects.toThrow('"Client" is required.')
    })
  })

  describe('deleteClient', () => {
    it('deletes by default (vis_state 1)', async () => {
      mock.onPut(accountingUrl('users/clients/123')).reply(
        accountingReply('client', {})
      )

      const result = await service.deleteClient('123')

      expect(mock.history[0].body).toMatchObject({ client: { vis_state: 1 } })
      expect(result).toMatchObject({ id: '123', deleted: true, archived: false })
    })

    it('archives when archiveInstead is true', async () => {
      mock.onPut(accountingUrl('users/clients/123')).reply(
        accountingReply('client', {})
      )

      const result = await service.deleteClient('123', true)

      expect(mock.history[0].body).toMatchObject({ client: { vis_state: 2 } })
      expect(result).toMatchObject({ id: '123', deleted: false, archived: true })
    })

    it('throws when clientId is missing', async () => {
      await expect(service.deleteClient()).rejects.toThrow('"Client" is required.')
    })
  })

  // ── Invoices ──

  describe('findInvoices', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(accountingUrl('invoices/invoices')).reply(
        accountingListReply('invoices', [{ invoiceid: 1 }])
      )

      const result = await service.findInvoices()

      expect(result).toHaveLength(1)
    })

    it('applies client, date, and status filters', async () => {
      mock.onGet(accountingUrl('invoices/invoices')).reply(
        accountingListReply('invoices', [
          { invoiceid: 1, v3_status: 'paid' },
          { invoiceid: 2, v3_status: 'draft' },
        ])
      )

      const result = await service.findInvoices('999', 'Paid', '2026-01-01', '2026-12-31')

      expect(mock.history[0].query).toMatchObject({
        'search[customerid]': '999',
        'search[date_min]': '2026-01-01',
        'search[date_max]': '2026-12-31',
      })
      expect(result).toHaveLength(1)
      expect(result[0].v3_status).toBe('paid')
    })
  })

  describe('getInvoice', () => {
    it('returns the invoice with lines included', async () => {
      mock.onGet(accountingUrl('invoices/invoices/987')).reply(
        accountingReply('invoice', { invoiceid: 987, lines: [] })
      )

      const result = await service.getInvoice('987')

      expect(result).toMatchObject({ invoiceid: 987 })
      expect(mock.history[0].query).toMatchObject({ 'include[]': 'lines' })
    })

    it('throws when invoiceId is missing', async () => {
      await expect(service.getInvoice()).rejects.toThrow('"Invoice" is required.')
    })
  })

  describe('createInvoice', () => {
    it('sends correct body with line items', async () => {
      // For tax lookup (line items have no tax, so no tax map call)
      mock.onPost(accountingUrl('invoices/invoices')).reply(
        accountingReply('invoice', { invoiceid: 100 })
      )

      await service.createInvoice(
        '999',
        [{ description: 'Design', quantity: 10, unitPrice: 120 }],
        '2026-06-01',
        '2026-07-01',
        'USD',
        'INV-001',
        'PO-555',
        10,
        'Thank you',
        'Net 30'
      )

      const body = mock.history[0].body
      expect(body.invoice.customerid).toBe('999')
      expect(body.invoice.currency_code).toBe('USD')
      expect(body.invoice.invoice_number).toBe('INV-001')
      expect(body.invoice.po_number).toBe('PO-555')
      expect(body.invoice.discount_value).toBe(10)
      expect(body.invoice.notes).toBe('Thank you')
      expect(body.invoice.terms).toBe('Net 30')
      expect(body.invoice.lines).toHaveLength(1)
      expect(body.invoice.lines[0]).toMatchObject({
        name: 'Design',
        qty: 10,
        unit_cost: { amount: '120', code: 'USD' },
      })
    })

    it('throws when clientId is missing', async () => {
      await expect(service.createInvoice(undefined, [{ description: 'x', quantity: 1, unitPrice: 1 }]))
        .rejects.toThrow('"Client" is required.')
    })

    it('throws when lineItems is empty', async () => {
      await expect(service.createInvoice('999', []))
        .rejects.toThrow('"Line Items" is required')
    })

    it('looks up tax map when line items have tax', async () => {
      mock.onGet(accountingUrl('taxes/taxes')).reply(
        accountingListReply('taxes', [{ name: 'GST', amount: '5' }])
      )
      mock.onPost(accountingUrl('invoices/invoices')).reply(
        accountingReply('invoice', { invoiceid: 101 })
      )

      await service.createInvoice(
        '999',
        [{ description: 'Work', quantity: 1, unitPrice: 100, tax: 'GST' }]
      )

      const lines = mock.history[1].body.invoice.lines
      expect(lines[0].taxName1).toBe('GST')
      expect(lines[0].taxAmount1).toBe('5')
    })
  })

  describe('updateInvoice', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(accountingUrl('invoices/invoices/987')).reply(
        accountingReply('invoice', { invoiceid: 987 })
      )

      await service.updateInvoice('987', '999', undefined, undefined, undefined, 'PO-NEW')

      expect(mock.history[0].body.invoice).toMatchObject({
        customerid: '999',
        po_number: 'PO-NEW',
      })
    })

    it('throws when invoiceId is missing', async () => {
      await expect(service.updateInvoice()).rejects.toThrow('"Invoice" is required.')
    })
  })

  describe('sendInvoice', () => {
    it('sends email to client by default', async () => {
      mock.onPut(accountingUrl('invoices/invoices/987')).reply(
        accountingReply('invoice', { v3_status: 'sent' })
      )

      const result = await service.sendInvoice('987', 'Email to client', ['test@x.com'], 'Subject', 'Body', true)

      expect(mock.history[0].body.invoice).toMatchObject({
        action_email: true,
        email_recipients: ['test@x.com'],
        email_include_pdf: true,
      })
      expect(result).toMatchObject({ id: '987', sent: true, status: 'sent' })
    })

    it('marks as sent only', async () => {
      mock.onPut(accountingUrl('invoices/invoices/987')).reply(
        accountingReply('invoice', { v3_status: 'sent' })
      )

      await service.sendInvoice('987', 'Mark as sent only')

      expect(mock.history[0].body.invoice).toMatchObject({
        action_mark_as_sent: true,
      })
    })

    it('throws when invoiceId is missing', async () => {
      await expect(service.sendInvoice()).rejects.toThrow('"Invoice" is required.')
    })
  })

  describe('deleteInvoice', () => {
    it('deletes by default', async () => {
      mock.onPut(accountingUrl('invoices/invoices/987')).reply(
        accountingReply('invoice', {})
      )

      const result = await service.deleteInvoice('987')

      expect(mock.history[0].body).toMatchObject({ invoice: { vis_state: 1 } })
      expect(result).toMatchObject({ id: '987', deleted: true, archived: false })
    })

    it('archives when toggled', async () => {
      mock.onPut(accountingUrl('invoices/invoices/987')).reply(
        accountingReply('invoice', {})
      )

      const result = await service.deleteInvoice('987', true)

      expect(result).toMatchObject({ deleted: false, archived: true })
    })
  })

  // ── Estimates ──

  describe('findEstimates', () => {
    it('sends correct request with filters', async () => {
      mock.onGet(accountingUrl('estimates/estimates')).reply(
        accountingListReply('estimates', [{ estimateid: 55 }])
      )

      const result = await service.findEstimates('999', '2026-01-01', '2026-12-31', 50)

      expect(result).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        'search[customerid]': '999',
        'search[date_min]': '2026-01-01',
        'search[date_max]': '2026-12-31',
        per_page: 50,
      })
    })
  })

  describe('getEstimate', () => {
    it('returns estimate with lines', async () => {
      mock.onGet(accountingUrl('estimates/estimates/55')).reply(
        accountingReply('estimate', { estimateid: 55 })
      )

      const result = await service.getEstimate('55')

      expect(result).toMatchObject({ estimateid: 55 })
      expect(mock.history[0].query).toMatchObject({ 'include[]': 'lines' })
    })

    it('throws when estimateId is missing', async () => {
      await expect(service.getEstimate()).rejects.toThrow('"Estimate" is required.')
    })
  })

  describe('createEstimate', () => {
    it('sends correct body', async () => {
      mock.onPost(accountingUrl('estimates/estimates')).reply(
        accountingReply('estimate', { estimateid: 56 })
      )

      await service.createEstimate(
        '999',
        [{ description: 'Consulting', quantity: 8, unitPrice: 100 }],
        '2026-06-01', 'USD', 'PO-99', 'Notes', 'Terms'
      )

      expect(mock.history[0].body.estimate).toMatchObject({
        customerid: '999',
        currency_code: 'USD',
        po_number: 'PO-99',
      })
    })

    it('throws when lineItems is empty', async () => {
      await expect(service.createEstimate('999', []))
        .rejects.toThrow('"Line Items" is required')
    })
  })

  describe('updateEstimate', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(accountingUrl('estimates/estimates/55')).reply(
        accountingReply('estimate', { estimateid: 55 })
      )

      await service.updateEstimate('55', undefined, 'CAD', 'PO-UPD', 'New notes', 'New terms')

      expect(mock.history[0].body.estimate).toMatchObject({
        currency_code: 'CAD',
        po_number: 'PO-UPD',
      })
    })

    it('throws when estimateId is missing', async () => {
      await expect(service.updateEstimate()).rejects.toThrow('"Estimate" is required.')
    })
  })

  describe('sendEstimate', () => {
    it('sends email by default', async () => {
      mock.onPut(accountingUrl('estimates/estimates/55')).reply(
        accountingReply('estimate', { ui_status: 'sent' })
      )

      const result = await service.sendEstimate('55', 'Email to client', ['a@b.com'], 'Subj', 'Msg')

      expect(mock.history[0].body.estimate).toMatchObject({ action_email: true })
      expect(result).toMatchObject({ id: '55', sent: true, status: 'sent' })
    })

    it('marks as sent only', async () => {
      mock.onPut(accountingUrl('estimates/estimates/55')).reply(
        accountingReply('estimate', { ui_status: 'sent' })
      )

      await service.sendEstimate('55', 'Mark as sent only')

      expect(mock.history[0].body.estimate).toMatchObject({ action_mark_as_sent: true })
    })
  })

  describe('convertEstimateToInvoice', () => {
    it('fetches estimate then creates invoice', async () => {
      mock.onGet(accountingUrl('estimates/estimates/55')).reply(
        accountingReply('estimate', {
          estimateid: 55,
          customerid: 999,
          currency_code: 'USD',
          lines: [{ name: 'Work', qty: '5', unit_cost: { amount: '100.00', code: 'USD' } }],
        })
      )
      mock.onPost(accountingUrl('invoices/invoices')).reply(
        accountingReply('invoice', { invoiceid: 988 })
      )

      const result = await service.convertEstimateToInvoice('55')

      expect(result).toMatchObject({ invoiceid: 988 })
      expect(mock.history[1].body.invoice).toMatchObject({
        customerid: 999,
        estimateid: '55',
      })
    })

    it('throws when estimateId is missing', async () => {
      await expect(service.convertEstimateToInvoice()).rejects.toThrow('"Estimate" is required.')
    })
  })

  describe('deleteEstimate', () => {
    it('deletes by default', async () => {
      mock.onPut(accountingUrl('estimates/estimates/55')).reply(
        accountingReply('estimate', {})
      )

      const result = await service.deleteEstimate('55')

      expect(result).toMatchObject({ id: '55', deleted: true, archived: false })
    })
  })

  // ── Expenses ──

  describe('findExpenses', () => {
    it('sends correct query params', async () => {
      mock.onGet(accountingUrl('expenses/expenses')).reply(
        accountingListReply('expenses', [{ expenseid: 1 }])
      )

      const result = await service.findExpenses('100', '999', '2026-01-01', '2026-12-31', 25)

      expect(result).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        'search[categoryid]': '100',
        'search[clientid]': '999',
        'search[date_min]': '2026-01-01',
        'search[date_max]': '2026-12-31',
        per_page: 25,
      })
    })
  })

  describe('getExpense', () => {
    it('returns the expense', async () => {
      mock.onGet(accountingUrl('expenses/expenses/1569533')).reply(
        accountingReply('expense', { expenseid: 1569533 })
      )

      const result = await service.getExpense('1569533')

      expect(result).toMatchObject({ expenseid: 1569533 })
    })

    it('throws when expenseId is missing', async () => {
      await expect(service.getExpense()).rejects.toThrow('"Expense" is required.')
    })
  })

  describe('createExpense', () => {
    it('sends correct body', async () => {
      // getDefaultStaffId call
      mock.onGet(accountingUrl('users/staffs')).reply(
        accountingListReply('staff', [{ id: 5, userid: 5 }])
      )
      mock.onPost(accountingUrl('expenses/expenses')).reply(
        accountingReply('expense', { expenseid: 100 })
      )

      await service.createExpense(42, 'USD', '100', '2026-05-10', 'Staples', '999', '153', 'Paper')

      const body = mock.history[1].body
      expect(body.expense).toMatchObject({
        amount: { amount: '42', code: 'USD' },
        categoryid: '100',
        vendor: 'Staples',
        notes: 'Paper',
      })
    })

    it('throws when amount is missing', async () => {
      await expect(service.createExpense(undefined, 'USD', '100'))
        .rejects.toThrow('"Amount" is required.')
    })

    it('throws when categoryId is missing', async () => {
      await expect(service.createExpense(42, 'USD'))
        .rejects.toThrow('"Category" is required.')
    })
  })

  describe('updateExpense', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(accountingUrl('expenses/expenses/100')).reply(
        accountingReply('expense', { expenseid: 100 })
      )

      await service.updateExpense('100', 50, 'CAD', '200', '2026-06-01', 'NewVendor', 'Updated')

      expect(mock.history[0].body.expense).toMatchObject({
        amount: { amount: '50', code: 'CAD' },
        categoryid: '200',
        vendor: 'NewVendor',
        notes: 'Updated',
      })
    })
  })

  describe('deleteExpense', () => {
    it('deletes by default', async () => {
      mock.onPut(accountingUrl('expenses/expenses/100')).reply(
        accountingReply('expense', {})
      )

      const result = await service.deleteExpense('100')

      expect(result).toMatchObject({ id: '100', deleted: true, archived: false })
    })
  })

  // ── Payments ──

  describe('findPayments', () => {
    it('sends correct query params', async () => {
      mock.onGet(accountingUrl('payments/payments')).reply(
        accountingListReply('payments', [{ id: 42 }])
      )

      const result = await service.findPayments('999', '2026-01-01', '2026-12-31')

      expect(result).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        'search[clientid]': '999',
      })
    })
  })

  describe('getPayment', () => {
    it('returns the payment', async () => {
      mock.onGet(accountingUrl('payments/payments/42')).reply(
        accountingReply('payment', { id: 42 })
      )

      const result = await service.getPayment('42')

      expect(result).toMatchObject({ id: 42 })
    })

    it('throws when paymentId is missing', async () => {
      await expect(service.getPayment()).rejects.toThrow('"Payment" is required.')
    })
  })

  describe('recordPayment', () => {
    it('sends correct body', async () => {
      mock.onPost(accountingUrl('payments/payments')).reply(
        accountingReply('payment', { id: 43 })
      )

      await service.recordPayment('987', 1500, 'USD', '2026-05-12', 'Check', true, 'Thanks')

      const body = mock.history[0].body
      expect(body.payment).toMatchObject({
        invoiceid: '987',
        amount: { amount: '1500', code: 'USD' },
        type: 'Check',
        send_client_notification: true,
        note: 'Thanks',
      })
    })

    it('throws when invoiceId is missing', async () => {
      await expect(service.recordPayment(undefined, 100))
        .rejects.toThrow('"Invoice" is required.')
    })

    it('throws when amount is missing', async () => {
      await expect(service.recordPayment('987'))
        .rejects.toThrow('"Amount" is required.')
    })
  })

  describe('updatePayment', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(accountingUrl('payments/payments/42')).reply(
        accountingReply('payment', { id: 42 })
      )

      await service.updatePayment('42', 1000, 'CAD', '2026-06-01', 'Cash', 'Updated note')

      expect(mock.history[0].body.payment).toMatchObject({
        amount: { amount: '1000', code: 'CAD' },
        type: 'Cash',
        note: 'Updated note',
      })
    })
  })

  describe('deletePayment', () => {
    it('deletes (vis_state 1)', async () => {
      mock.onPut(accountingUrl('payments/payments/42')).reply(
        accountingReply('payment', {})
      )

      const result = await service.deletePayment('42')

      expect(mock.history[0].body).toMatchObject({ payment: { vis_state: 1 } })
      expect(result).toMatchObject({ id: '42', deleted: true })
    })
  })

  // ── Items ──

  describe('findItems', () => {
    it('returns items with search filter', async () => {
      mock.onGet(accountingUrl('items/items')).reply(
        accountingListReply('items', [
          { itemid: 55, name: 'Design', sku: 'DSGN' },
          { itemid: 56, name: 'Dev', sku: 'DEV' },
        ])
      )

      const result = await service.findItems('design')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Design')
    })
  })

  describe('getItem', () => {
    it('returns the item', async () => {
      mock.onGet(accountingUrl('items/items/55')).reply(
        accountingReply('item', { itemid: 55, name: 'Design' })
      )

      const result = await service.getItem('55')

      expect(result).toMatchObject({ itemid: 55 })
    })

    it('throws when itemId is missing', async () => {
      await expect(service.getItem()).rejects.toThrow('"Item" is required.')
    })
  })

  describe('createItem', () => {
    it('sends correct body', async () => {
      mock.onPost(accountingUrl('items/items')).reply(
        accountingReply('item', { itemid: 55 })
      )

      await service.createItem('Design', 120, 'USD', 'DSGN', 'Hourly design work')

      expect(mock.history[0].body.item).toMatchObject({
        name: 'Design',
        description: 'Hourly design work',
        sku: 'DSGN',
        unit_cost: { amount: '120', code: 'USD' },
      })
    })

    it('omits unit_cost when unitPrice not provided', async () => {
      mock.onPost(accountingUrl('items/items')).reply(
        accountingReply('item', { itemid: 56 })
      )

      await service.createItem('Simple Item')

      expect(mock.history[0].body.item.unit_cost).toBeUndefined()
    })

    it('throws when name is missing', async () => {
      await expect(service.createItem()).rejects.toThrow('"Name" is required.')
    })
  })

  describe('updateItem', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(accountingUrl('items/items/55')).reply(
        accountingReply('item', { itemid: 55 })
      )

      await service.updateItem('55', 'Updated Name', 130, 'CAD')

      expect(mock.history[0].body.item).toMatchObject({
        name: 'Updated Name',
        unit_cost: { amount: '130', code: 'CAD' },
      })
    })
  })

  describe('deleteItem', () => {
    it('deletes by default', async () => {
      mock.onPut(accountingUrl('items/items/55')).reply(
        accountingReply('item', {})
      )

      const result = await service.deleteItem('55')

      expect(result).toMatchObject({ id: '55', deleted: true, archived: false })
    })
  })

  // ── Taxes ──

  describe('findTaxes', () => {
    it('returns taxes with search filter', async () => {
      mock.onGet(accountingUrl('taxes/taxes')).reply(
        accountingListReply('taxes', [
          { taxid: 3, name: 'GST', amount: '5' },
          { taxid: 4, name: 'VAT', amount: '20' },
        ])
      )

      const result = await service.findTaxes('gst')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('GST')
    })
  })

  describe('createTax', () => {
    it('sends correct body', async () => {
      mock.onPost(accountingUrl('taxes/taxes')).reply(
        accountingReply('tax', { taxid: 3 })
      )

      await service.createTax('GST', 5, 'R123', true)

      expect(mock.history[0].body.tax).toMatchObject({
        name: 'GST',
        amount: '5',
        number: 'R123',
        compound: true,
      })
    })

    it('throws when name is missing', async () => {
      await expect(service.createTax()).rejects.toThrow('"Name" is required.')
    })
  })

  describe('updateTax', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(accountingUrl('taxes/taxes/3')).reply(
        accountingReply('tax', { taxid: 3 })
      )

      await service.updateTax('3', 'GST Updated', 7)

      expect(mock.history[0].body.tax).toMatchObject({
        name: 'GST Updated',
        amount: '7',
      })
    })
  })

  describe('deleteTax', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(accountingUrl('taxes/taxes/3')).reply({})

      const result = await service.deleteTax('3')

      expect(mock.history[0].method).toBe('delete')
      expect(result).toMatchObject({ id: '3', deleted: true })
    })
  })

  // ── Other Income ──

  describe('findOtherIncome', () => {
    it('returns other income entries', async () => {
      mock.onGet(accountingUrl('other_incomes/other_incomes')).reply(
        accountingListReply('other_incomes', [{ incomeid: 12 }])
      )

      const result = await service.findOtherIncome()

      expect(result).toHaveLength(1)
    })
  })

  describe('recordOtherIncome', () => {
    it('sends correct body with category mapping', async () => {
      mock.onPost(accountingUrl('other_incomes/other_incomes')).reply(
        accountingReply('other_income', { incomeid: 13 })
      )

      await service.recordOtherIncome(250, 'USD', 'Online Sales', '2026-05-10', 'Shopify', 'Sales')

      expect(mock.history[0].body.other_income).toMatchObject({
        amount: { amount: '250', code: 'USD' },
        category_name: 'online_sales',
        source: 'Shopify',
        note: 'Sales',
      })
    })

    it('throws when amount is missing', async () => {
      await expect(service.recordOtherIncome()).rejects.toThrow('"Amount" is required.')
    })
  })

  describe('updateOtherIncome', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(accountingUrl('other_incomes/other_incomes/12')).reply(
        accountingReply('other_income', { incomeid: 12 })
      )

      await service.updateOtherIncome('12', 300, 'CAD', 'Rentals')

      expect(mock.history[0].body.other_income).toMatchObject({
        amount: { amount: '300', code: 'CAD' },
        category_name: 'rentals',
      })
    })
  })

  describe('deleteOtherIncome', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(accountingUrl('other_incomes/other_incomes/12')).reply({})

      const result = await service.deleteOtherIncome('12')

      expect(result).toMatchObject({ id: '12', deleted: true })
    })
  })

  // ── Tasks ──

  describe('findTasks', () => {
    it('returns tasks with search filter', async () => {
      mock.onGet(accountingUrl('projects/tasks')).reply(
        accountingListReply('tasks', [
          { taskid: 8, name: 'Consulting' },
          { taskid: 9, name: 'Development' },
        ])
      )

      const result = await service.findTasks('consult')

      expect(result).toHaveLength(1)
    })
  })

  describe('createTask', () => {
    it('sends correct body', async () => {
      mock.onPost(accountingUrl('projects/tasks')).reply(
        accountingReply('task', { taskid: 8 })
      )

      await service.createTask('Consulting', 150, 'USD', true, 'Expert consulting')

      expect(mock.history[0].body.task).toMatchObject({
        name: 'Consulting',
        rate: { amount: '150', code: 'USD' },
        billable: true,
        description: 'Expert consulting',
      })
    })
  })

  describe('updateTask', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(accountingUrl('projects/tasks/8')).reply(
        accountingReply('task', { taskid: 8 })
      )

      await service.updateTask('8', 'Updated Task', 160, 'CAD', 'Updated desc')

      expect(mock.history[0].body.task).toMatchObject({
        name: 'Updated Task',
        rate: { amount: '160', code: 'CAD' },
      })
    })
  })

  describe('deleteTask', () => {
    it('deletes by default', async () => {
      mock.onPut(accountingUrl('projects/tasks/8')).reply(
        accountingReply('task', {})
      )

      const result = await service.deleteTask('8')

      expect(result).toMatchObject({ id: '8', deleted: true, archived: false })
    })
  })

  // ── Credit Notes ──

  describe('findCreditNotes', () => {
    it('sends correct query params', async () => {
      mock.onGet(accountingUrl('credit_notes/credit_notes')).reply(
        accountingListReply('credit_notes', [{ creditid: 7 }])
      )

      const result = await service.findCreditNotes('999', 50)

      expect(result).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        'search[clientid]': '999',
        per_page: 50,
      })
    })
  })

  describe('getCreditNote', () => {
    it('returns credit note with lines', async () => {
      mock.onGet(accountingUrl('credit_notes/credit_notes/7')).reply(
        accountingReply('credit_note', { creditid: 7 })
      )

      const result = await service.getCreditNote('7')

      expect(result).toMatchObject({ creditid: 7 })
      expect(mock.history[0].query).toMatchObject({ 'include[]': 'lines' })
    })
  })

  describe('createCreditNote', () => {
    it('sends correct body', async () => {
      mock.onPost(accountingUrl('credit_notes/credit_notes')).reply(
        accountingReply('credit_note', { creditid: 8 })
      )

      await service.createCreditNote(
        '999',
        [{ description: 'Refund', quantity: 1, unitPrice: 50 }],
        '2026-06-01', 'USD', 'Credit note'
      )

      expect(mock.history[0].body.credit_note).toMatchObject({
        clientid: '999',
        currency_code: 'USD',
        notes: 'Credit note',
      })
    })
  })

  describe('updateCreditNote', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(accountingUrl('credit_notes/credit_notes/7')).reply(
        accountingReply('credit_note', { creditid: 7 })
      )

      await service.updateCreditNote('7', undefined, 'CAD', 'Updated notes')

      expect(mock.history[0].body.credit_note).toMatchObject({
        currency_code: 'CAD',
        notes: 'Updated notes',
      })
    })
  })

  describe('deleteCreditNote', () => {
    it('deletes by default', async () => {
      mock.onPut(accountingUrl('credit_notes/credit_notes/7')).reply(
        accountingReply('credit_note', {})
      )

      const result = await service.deleteCreditNote('7')

      expect(result).toMatchObject({ id: '7', deleted: true, archived: false })
    })
  })

  // ── Recurring Invoices ──

  describe('findRecurringInvoices', () => {
    it('sends correct query params', async () => {
      mock.onGet(accountingUrl('invoice_profiles/invoice_profiles')).reply(
        accountingListReply('invoice_profiles', [{ id: 4 }])
      )

      const result = await service.findRecurringInvoices('999')

      expect(result).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ 'search[customerid]': '999' })
    })
  })

  describe('getRecurringInvoice', () => {
    it('returns the profile', async () => {
      mock.onGet(accountingUrl('invoice_profiles/invoice_profiles/4')).reply(
        accountingReply('invoice_profile', { id: 4 })
      )

      const result = await service.getRecurringInvoice('4')

      expect(result).toMatchObject({ id: 4 })
    })
  })

  describe('createRecurringInvoice', () => {
    it('sends correct body with frequency mapping', async () => {
      mock.onPost(accountingUrl('invoice_profiles/invoice_profiles')).reply(
        accountingReply('invoice_profile', { id: 5 })
      )

      await service.createRecurringInvoice(
        '999',
        [{ description: 'Subscription', quantity: 1, unitPrice: 99 }],
        'Monthly', '2026-06-01', 'USD', 12, 'Monthly sub'
      )

      expect(mock.history[0].body.invoice_profile).toMatchObject({
        customerid: '999',
        frequency: 'm',
        currency_code: 'USD',
        numberRecurring: 12,
        notes: 'Monthly sub',
      })
    })
  })

  describe('updateRecurringInvoice', () => {
    it('sends PUT with updated frequency', async () => {
      mock.onPut(accountingUrl('invoice_profiles/invoice_profiles/4')).reply(
        accountingReply('invoice_profile', { id: 4 })
      )

      await service.updateRecurringInvoice('4', undefined, 'Every 3 Months', 'CAD')

      expect(mock.history[0].body.invoice_profile).toMatchObject({
        frequency: '3m',
        currency_code: 'CAD',
      })
    })
  })

  describe('deleteRecurringInvoice', () => {
    it('deletes by default', async () => {
      mock.onPut(accountingUrl('invoice_profiles/invoice_profiles/4')).reply(
        accountingReply('invoice_profile', {})
      )

      const result = await service.deleteRecurringInvoice('4')

      expect(result).toMatchObject({ id: '4', deleted: true, archived: false })
    })
  })

  // ── Vendors ──

  describe('findVendors', () => {
    it('returns vendors with search filter', async () => {
      mock.onGet(accountingUrl('bill_vendors/bill_vendors')).reply(
        accountingListReply('bill_vendors', [
          { vendorid: 1, vendor_name: 'Office Supplies' },
          { vendorid: 2, vendor_name: 'Tech Corp' },
        ])
      )

      const result = await service.findVendors('office')

      expect(result).toHaveLength(1)
      expect(result[0].vendor_name).toBe('Office Supplies')
    })
  })

  describe('createVendor', () => {
    it('sends correct body', async () => {
      mock.onPost(accountingUrl('bill_vendors/bill_vendors')).reply(
        accountingReply('bill_vendor', { vendorid: 1 })
      )

      await service.createVendor('Supplies Co', 'John', 'Smith', 'john@supplies.co', '555-5555', 'USD', 'NYC', 'US', 'Good vendor')

      expect(mock.history[0].body.bill_vendor).toMatchObject({
        vendor_name: 'Supplies Co',
        primary_contact_first_name: 'John',
        primary_contact_last_name: 'Smith',
        primary_contact_email: 'john@supplies.co',
        language: 'en',
      })
    })

    it('throws when vendorName is missing', async () => {
      await expect(service.createVendor()).rejects.toThrow('"Vendor Name" is required.')
    })
  })

  describe('updateVendor', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(accountingUrl('bill_vendors/bill_vendors/1')).reply(
        accountingReply('bill_vendor', { vendorid: 1 })
      )

      await service.updateVendor('1', 'Updated Vendor', 'new@email.com')

      expect(mock.history[0].body.bill_vendor).toMatchObject({
        vendor_name: 'Updated Vendor',
        primary_contact_email: 'new@email.com',
      })
    })
  })

  describe('deleteVendor', () => {
    it('deletes by default', async () => {
      mock.onPut(accountingUrl('bill_vendors/bill_vendors/1')).reply(
        accountingReply('bill_vendor', {})
      )

      const result = await service.deleteVendor('1')

      expect(result).toMatchObject({ id: '1', deleted: true, archived: false })
    })
  })

  // ── Bills ──

  describe('findBills', () => {
    it('sends correct query params', async () => {
      mock.onGet(accountingUrl('bills/bills')).reply(
        accountingListReply('bills', [{ id: 33 }])
      )

      const result = await service.findBills('1562')

      expect(result).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ 'search[vendorid]': '1562' })
    })
  })

  describe('getBill', () => {
    it('returns the bill', async () => {
      mock.onGet(accountingUrl('bills/bills/33')).reply(
        accountingReply('bill', { id: 33 })
      )

      const result = await service.getBill('33')

      expect(result).toMatchObject({ id: 33 })
    })
  })

  describe('createBill', () => {
    it('sends correct body with bill lines', async () => {
      mock.onPost(accountingUrl('bills/bills')).reply(
        accountingReply('bill', { id: 34 })
      )

      await service.createBill(
        '1562',
        [{ category: '100', description: 'Supplies', quantity: 1, unitPrice: 600 }],
        '2026-06-01', 30, 'USD'
      )

      const body = mock.history[0].body
      expect(body.bill).toMatchObject({
        vendorid: '1562',
        currency_code: 'USD',
        due_offset_days: 30,
        language: 'en',
      })
      expect(body.bill.lines[0]).toMatchObject({
        categoryid: '100',
        description: 'Supplies',
        quantity: 1,
        unit_cost: { amount: '600', code: 'USD' },
      })
    })

    it('throws when billLines is empty', async () => {
      await expect(service.createBill('1562', []))
        .rejects.toThrow('"Line Items" is required')
    })
  })

  describe('updateBill', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(accountingUrl('bills/bills/33')).reply(
        accountingReply('bill', { id: 33 })
      )

      await service.updateBill('33', undefined, 'CAD')

      expect(mock.history[0].body.bill).toMatchObject({ currency_code: 'CAD' })
    })
  })

  describe('deleteBill', () => {
    it('deletes by default', async () => {
      mock.onPut(accountingUrl('bills/bills/33')).reply(
        accountingReply('bill', {})
      )

      const result = await service.deleteBill('33')

      expect(result).toMatchObject({ id: '33', deleted: true, archived: false })
    })
  })

  // ── Bill Payments ──

  describe('findBillPayments', () => {
    it('returns bill payments', async () => {
      mock.onGet(accountingUrl('bill_payments/bill_payments')).reply(
        accountingListReply('bill_payments', [{ id: 9 }])
      )

      const result = await service.findBillPayments()

      expect(result).toHaveLength(1)
    })
  })

  describe('recordBillPayment', () => {
    it('sends correct body', async () => {
      mock.onPost(accountingUrl('bill_payments/bill_payments')).reply(
        accountingReply('bill_payment', { id: 10 })
      )

      await service.recordBillPayment('33', 600, 'USD', '2026-06-10', 'Check', 'Paid')

      expect(mock.history[0].body.bill_payment).toMatchObject({
        billid: '33',
        amount: { amount: '600', code: 'USD' },
        payment_type: 'Check',
        note: 'Paid',
      })
    })
  })

  describe('updateBillPayment', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(accountingUrl('bill_payments/bill_payments/9')).reply(
        accountingReply('bill_payment', { id: 9 })
      )

      await service.updateBillPayment('9', 300, 'CAD', 'Cash', 'Updated')

      expect(mock.history[0].body.bill_payment).toMatchObject({
        amount: { amount: '300', code: 'CAD' },
        payment_type: 'Cash',
        note: 'Updated',
      })
    })
  })

  describe('deleteBillPayment', () => {
    it('deletes (vis_state 1)', async () => {
      mock.onPut(accountingUrl('bill_payments/bill_payments/9')).reply(
        accountingReply('bill_payment', {})
      )

      const result = await service.deleteBillPayment('9')

      expect(result).toMatchObject({ id: '9', deleted: true })
    })
  })

  // ── Reports & Account ──

  describe('getFinancialReport', () => {
    it('sends correct request for Profit & Loss', async () => {
      mock.onGet(accountingUrl('reports/accounting/profitloss')).reply({
        response: {
          result: { profitloss: { currency_code: 'USD' } },
        },
      })

      const result = await service.getFinancialReport('Profit & Loss', '2026-01-01', '2026-12-31', 'USD')

      expect(result).toMatchObject({ profitloss: { currency_code: 'USD' } })
      expect(mock.history[0].query).toMatchObject({
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        currency_code: 'USD',
      })
    })

    it('throws for invalid report name', async () => {
      await expect(service.getFinancialReport('Invalid Report'))
        .rejects.toThrow('Please choose a valid report.')
    })
  })

  describe('getAccountInfo', () => {
    it('returns formatted account info', async () => {
      mock.onGet(IDENTITY_URL).reply({
        response: {
          email: 'owner@example.com',
          first_name: 'John',
          last_name: 'Doe',
          business_memberships: [
            {
              role: 'owner',
              business: {
                id: 14691043,
                account_id: ACCOUNT_ID,
                name: 'My Company',
                address: { street: '123 Main' },
              },
            },
          ],
        },
      })

      const result = await service.getAccountInfo()

      expect(result).toMatchObject({
        businessName: 'My Company',
        accountId: ACCOUNT_ID,
        businessId: 14691043,
        email: 'owner@example.com',
        ownerName: 'John Doe',
        role: 'owner',
      })
    })
  })

  // ── Projects ──

  describe('findProjects', () => {
    it('returns projects with search filter', async () => {
      mock.onGet(projectsUrl('projects')).reply({
        projects: [
          { id: 1, title: 'Website Redesign' },
          { id: 2, title: 'Mobile App' },
        ],
      })

      const result = await service.findProjects('website')

      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Website Redesign')
    })
  })

  describe('getProject', () => {
    it('returns the project', async () => {
      mock.onGet(projectsUrl('project/100')).reply({
        project: { id: 100, title: 'Test Project' },
      })

      const result = await service.getProject('100')

      expect(result).toMatchObject({ id: 100, title: 'Test Project' })
    })

    it('throws when projectId is missing', async () => {
      await expect(service.getProject()).rejects.toThrow('"Project" is required.')
    })
  })

  describe('createProject', () => {
    it('sends correct body for fixed price project', async () => {
      mock.onPost(projectsUrl('project')).reply({
        project: { id: 101, title: 'New Project' },
      })

      await service.createProject('New Project', '999', 'Fixed Price', 5000, 40, '2026-12-31', 'A project')

      expect(mock.history[0].body.project).toMatchObject({
        title: 'New Project',
        client_id: 999,
        project_type: 'fixed_price',
        fixed_price: '5000',
        budget: 2400, // 40 hours * 60 minutes
        description: 'A project',
      })
    })

    it('sends correct body for hourly rate project', async () => {
      mock.onPost(projectsUrl('project')).reply({
        project: { id: 102 },
      })

      await service.createProject('Hourly Project', '999', 'Hourly Rate', 150)

      expect(mock.history[0].body.project).toMatchObject({
        project_type: 'hourly_rate',
        rate: '150',
      })
      expect(mock.history[0].body.project.fixed_price).toBeUndefined()
    })

    it('throws when title is missing', async () => {
      await expect(service.createProject(undefined, '999'))
        .rejects.toThrow('"Title" is required.')
    })
  })

  describe('updateProject', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(projectsUrl('project/100')).reply({
        project: { id: 100 },
      })

      await service.updateProject('100', 'Updated Title', 6000, '2026-12-31', true, 'Updated desc')

      expect(mock.history[0].body.project).toMatchObject({
        title: 'Updated Title',
        fixed_price: '6000',
        complete: true,
        description: 'Updated desc',
      })
    })
  })

  describe('deleteProject', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(projectsUrl('project/100')).reply({})

      const result = await service.deleteProject('100')

      expect(mock.history[0].method).toBe('delete')
      expect(result).toMatchObject({ id: '100', deleted: true })
    })
  })

  // ── Time Tracking ──

  describe('findTimeEntries', () => {
    it('sends correct query params', async () => {
      mock.onGet(timeUrl('time_entries')).reply({
        time_entries: [{ id: 5095, duration: 7200 }],
      })

      const result = await service.findTimeEntries('999', '100', '2026-01-01', '2026-12-31', 25)

      expect(result).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        client_id: '999',
        project_id: '100',
        started_from: '2026-01-01T00:00:00Z',
        started_to: '2026-12-31T23:59:59Z',
        per_page: 25,
      })
    })
  })

  describe('getTimeEntry', () => {
    it('returns the time entry', async () => {
      mock.onGet(timeUrl('time_entries/5095')).reply({
        time_entry: { id: 5095, duration: 7200 },
      })

      const result = await service.getTimeEntry('5095')

      expect(result).toMatchObject({ id: 5095, duration: 7200 })
    })

    it('throws when timeEntryId is missing', async () => {
      await expect(service.getTimeEntry()).rejects.toThrow('"Time Entry" is required.')
    })
  })

  describe('logTime', () => {
    it('sends correct body', async () => {
      // getIdentityId call
      mock.onGet(IDENTITY_URL).reply({
        response: { id: 42 },
      })
      mock.onPost(timeUrl('time_entries')).reply({
        time_entry: { id: 5096 },
      })

      await service.logTime(1.5, '2026-05-10', '999', '100', true, 'Design work')

      const body = mock.history[1].body
      expect(body.time_entry).toMatchObject({
        is_logged: true,
        duration: 5400, // 1.5 * 3600
        client_id: 999,
        project_id: 100,
        billable: true,
        note: 'Design work',
      })
      expect(body.time_entry.started_at).toContain('2026-05-10')
    })

    it('throws when hours is missing', async () => {
      await expect(service.logTime()).rejects.toThrow('"Hours" is required.')
    })
  })

  describe('updateTimeEntry', () => {
    it('fetches existing entry and sends PUT', async () => {
      mock.onGet(timeUrl('time_entries/5095')).reply({
        time_entry: { id: 5095, duration: 7200, started_at: '2026-05-10T12:00:00Z', billable: true, note: 'Old' },
      })
      mock.onPut(timeUrl('time_entries/5095')).reply({
        time_entry: { id: 5095, duration: 3600 },
      })

      const result = await service.updateTimeEntry('5095', 1, false, 'New note')

      expect(mock.history[1].body.time_entry).toMatchObject({
        is_logged: true,
        started_at: '2026-05-10T12:00:00Z',
        duration: 3600,
        billable: false,
        note: 'New note',
      })
      expect(result).toMatchObject({ id: 5095 })
    })
  })

  describe('deleteTimeEntry', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(timeUrl('time_entries/5095')).reply({})

      const result = await service.deleteTimeEntry('5095')

      expect(result).toMatchObject({ id: '5095', deleted: true })
    })
  })

  // ── Services ──

  describe('findServices', () => {
    it('returns services with search filter', async () => {
      mock.onGet(commentsUrl('services')).reply({
        services: [
          { id: 1, name: 'Consulting' },
          { id: 2, name: 'Development' },
        ],
      })

      const result = await service.findServices('consult')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Consulting')
    })
  })

  describe('createService', () => {
    it('sends correct body', async () => {
      mock.onPost(commentsUrl('service')).reply({
        service: { id: 3, name: 'Testing', billable: true },
      })

      const result = await service.createService('Testing', true)

      expect(mock.history[0].body.service).toMatchObject({
        name: 'Testing',
        billable: true,
      })
      expect(result).toMatchObject({ id: 3, name: 'Testing' })
    })

    it('throws when name is missing', async () => {
      await expect(service.createService()).rejects.toThrow('"Name" is required.')
    })
  })

  describe('setServiceRate', () => {
    it('sends correct body', async () => {
      mock.onPost(commentsUrl('service/123/rate')).reply({
        service_rate: { service_id: 123, rate: '100.00' },
      })

      const result = await service.setServiceRate('123', 100)

      expect(mock.history[0].body).toMatchObject({
        service_rate: { rate: '100' },
      })
      expect(result).toMatchObject({ service_id: 123 })
    })

    it('throws when serviceId is missing', async () => {
      await expect(service.setServiceRate(undefined, 100))
        .rejects.toThrow('"Service" is required.')
    })

    it('throws when hourlyRate is missing', async () => {
      await expect(service.setServiceRate('123'))
        .rejects.toThrow('"Hourly Rate" is required.')
    })
  })

  // ── Triggers ──

  describe('handleTriggerUpsertWebhook', () => {
    it('creates new webhook callbacks', async () => {
      mock.onPost(eventsUrl('events/callbacks')).reply(
        accountingReply('callback', { callbackid: 'cb-1' })
      )

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://hook.example.com',
        connectionId: 'conn-1',
        events: [
          { triggerData: { event: 'New Invoice' } },
        ],
        webhookData: {},
      })

      expect(result.webhookData.accountId).toBe(ACCOUNT_ID)
      expect(result.webhookData.callbacks).toHaveLength(1)
      expect(mock.history[0].body.callback).toMatchObject({
        event: 'invoice.create',
      })
    })

    it('removes unwanted callbacks and keeps wanted ones', async () => {
      mock.onDelete(`${API_BASE}/events/account/${ACCOUNT_ID}/events/callbacks/old-cb`).reply({})
      mock.onPost(eventsUrl('events/callbacks')).reply(
        accountingReply('callback', { callbackid: 'new-cb' })
      )

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://hook.example.com',
        events: [
          { triggerData: { event: 'New Payment' } },
        ],
        webhookData: {
          callbacks: [
            { event: 'invoice.create', callbackid: 'old-cb' },
          ],
        },
      })

      // old callback deleted, new one created
      expect(result.webhookData.callbacks).toHaveLength(1)
      expect(result.webhookData.callbacks[0].event).toBe('payment.create')
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('returns handshake response for verification requests', async () => {
      mock.onPut(`${API_BASE}/events/account/${ACCOUNT_ID}/events/callbacks/123`).reply({})

      const result = await service.handleTriggerResolveEvents({
        body: { verifier: 'abc123', object_id: '123', account_id: ACCOUNT_ID },
        webhookData: { accountId: ACCOUNT_ID },
      })

      expect(result).toMatchObject({ handshake: true })
    })

    it('returns resolved events for real webhook data', async () => {
      const result = await service.handleTriggerResolveEvents({
        body: {
          name: 'invoice.create',
          object_id: '987',
          account_id: ACCOUNT_ID,
          business_id: BUSINESS_ID,
        },
        connectionId: 'conn-1',
        webhookData: {},
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toMatchObject({
        name: 'onRecordEvent',
        data: {
          event: 'invoice.create',
          objectId: '987',
          accountId: ACCOUNT_ID,
        },
      })
    })

    it('returns null for empty body', async () => {
      const result = await service.handleTriggerResolveEvents({
        body: {},
        webhookData: {},
      })

      expect(result).toBeNull()
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('returns matching trigger ids', async () => {
      const result = await service.handleTriggerSelectMatched({
        eventData: { event: 'invoice.create' },
        triggers: [
          { id: 't1', data: { event: 'New Invoice' } },
          { id: 't2', data: { event: 'New Payment' } },
          { id: 't3', data: {} },
        ],
      })

      expect(result.ids).toContain('t1')
      expect(result.ids).toContain('t3') // no event filter matches all
      expect(result.ids).not.toContain('t2')
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes all callbacks', async () => {
      mock.onDelete(`${API_BASE}/events/account/${ACCOUNT_ID}/events/callbacks/cb-1`).reply({})
      mock.onDelete(`${API_BASE}/events/account/${ACCOUNT_ID}/events/callbacks/cb-2`).reply({})

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: {
          accountId: ACCOUNT_ID,
          callbacks: [
            { callbackid: 'cb-1', event: 'invoice.create' },
            { callbackid: 'cb-2', event: 'payment.create' },
          ],
        },
      })

      expect(result).toMatchObject({ webhookData: {} })
      expect(mock.history).toHaveLength(2)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws descriptive error on API failure', async () => {
      mock.onGet(accountingUrl('users/clients/999')).replyWithError({
        message: 'Not Found',
        body: {
          response: {
            errors: [{ message: 'Client not found' }],
          },
        },
      })

      await expect(service.getClient('999')).rejects.toThrow('Client not found')
    })

    it('handles error with error_description', async () => {
      mock.onGet(accountingUrl('users/clients/999')).replyWithError({
        message: 'Auth Error',
        body: {
          error_description: 'Token expired',
        },
      })

      await expect(service.getClient('999')).rejects.toThrow('Token expired')
    })
  })
})
