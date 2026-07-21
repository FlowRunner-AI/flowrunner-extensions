'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const CONNECT_BASE = 'https://connect.gocardless.com'
const API_BASE = 'https://api.gocardless.com'

describe('GoCardless Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      environment: 'live',
    })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate OAuth access token header for all tests
    service.request = {
      headers: {
        'oauth-access-token': ACCESS_TOKEN,
        'oauth-user-data-environment': 'live',
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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'clientId',
          required: true,
          shared: true,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'clientSecret',
          required: true,
          shared: true,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'environment',
          required: true,
          shared: false,
          type: 'CHOICE',
        }),
      ])
    })
  })

  // ── OAuth System Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns the authorization URL with correct params', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`${CONNECT_BASE}/oauth/authorize`)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=read_write')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches creditor identity', async () => {
      mock.onPost(`${CONNECT_BASE}/oauth/access_token`).reply({
        access_token: 'new-token',
        refresh_token: 'new-refresh',
        organisation_id: 'OR123',
        scope: 'read_write',
      })
      mock.onGet(`${API_BASE}/creditors`).reply({
        creditors: [{ name: 'Acme Ltd', logo_url: 'https://logo.png' }],
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://example.com/callback',
      })

      expect(result).toMatchObject({
        token: 'new-token',
        refreshToken: 'new-refresh',
        connectionIdentityName: 'Acme Ltd',
        connectionIdentityImageURL: 'https://logo.png',
        overwrite: true,
      })
      expect(result.expirationInSeconds).toBe(30 * 24 * 60 * 60)
      expect(result.userData).toMatchObject({
        organisationId: 'OR123',
        environment: 'live',
      })
    })

    it('throws when token exchange fails', async () => {
      mock.onPost(`${CONNECT_BASE}/oauth/access_token`).replyWithError({
        message: 'invalid_grant',
        body: { error: 'invalid_grant' },
      })

      await expect(
        service.executeCallback({ code: 'bad', redirectURI: 'https://x.com' })
      ).rejects.toThrow('OAuth token exchange failed')
    })

    it('throws when no access_token returned', async () => {
      mock.onPost(`${CONNECT_BASE}/oauth/access_token`).reply({})

      await expect(
        service.executeCallback({ code: 'x', redirectURI: 'https://x.com' })
      ).rejects.toThrow('no access_token')
    })
  })

  describe('refreshToken', () => {
    it('exchanges refresh token successfully', async () => {
      mock.onPost(`${CONNECT_BASE}/oauth/access_token`).reply({
        access_token: 'refreshed-token',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      })

      const result = await service.refreshToken('old-refresh')

      expect(result).toEqual({
        token: 'refreshed-token',
        refreshToken: 'new-refresh',
        expirationInSeconds: 3600,
      })
      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
    })

    it('throws when called without a refresh token', async () => {
      await expect(service.refreshToken()).rejects.toThrow(
        'without a refresh token'
      )
    })

    it('falls back to current token when refresh fails', async () => {
      mock
        .onPost(`${CONNECT_BASE}/oauth/access_token`)
        .replyWithError({ message: 'server error' })

      const result = await service.refreshToken('old-refresh')

      expect(result.token).toBe(ACCESS_TOKEN)
      expect(result.refreshToken).toBe('old-refresh')
      expect(result.expirationInSeconds).toBe(30 * 24 * 60 * 60)
    })
  })

  // ── Customers ──

  describe('listCustomers', () => {
    it('sends GET with default params', async () => {
      mock.onGet(`${API_BASE}/customers`).reply({
        customers: [{ id: 'CU1' }],
        meta: { cursors: { after: null }, limit: 50 },
      })

      const result = await service.listCustomers()

      expect(result.data).toEqual([{ id: 'CU1' }])
      expect(result.hasMore).toBe(false)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })

    it('passes cursor for manual pagination', async () => {
      mock.onGet(`${API_BASE}/customers`).reply({
        customers: [],
        meta: { cursors: { after: null }, limit: 50 },
      })

      await service.listCustomers(null, null, null, null, false, 'cursor123')

      expect(mock.history[0].query).toMatchObject({ after: 'cursor123' })
    })

    it('fetches all pages when fetchAll is true', async () => {
      mock.onGet(`${API_BASE}/customers`).reply({
        customers: [{ id: 'CU1' }],
        meta: { cursors: { after: null }, limit: 50 },
      })

      const result = await service.listCustomers(
        null,
        null,
        null,
        null,
        true
      )

      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('pageCount')
      expect(result).toHaveProperty('truncated')
    })
  })

  describe('getCustomer', () => {
    it('fetches a customer by ID', async () => {
      mock.onGet(`${API_BASE}/customers/CU123`).reply({
        customers: {
          id: 'CU123',
          email: 'jane@example.com',
          given_name: 'Jane',
        },
      })

      const result = await service.getCustomer('CU123')

      expect(result).toEqual({
        id: 'CU123',
        email: 'jane@example.com',
        given_name: 'Jane',
      })
    })

    it('throws when customerId is missing', async () => {
      await expect(service.getCustomer()).rejects.toThrow(
        'customerId is required'
      )
    })
  })

  describe('createCustomer', () => {
    it('sends POST with correct body and unwraps response', async () => {
      mock.onPost(`${API_BASE}/customers`).reply({
        customers: { id: 'CU_NEW', email: 'test@example.com' },
      })

      const result = await service.createCustomer('test@example.com', 'Jane', 'Doe')

      expect(result).toMatchObject({ id: 'CU_NEW' })
      expect(mock.history[0].body).toMatchObject({
        customers: expect.objectContaining({
          email: 'test@example.com',
          given_name: 'Jane',
          family_name: 'Doe',
        }),
      })
      // POST requests should have an idempotency key
      expect(mock.history[0].headers).toHaveProperty('Idempotency-Key')
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${API_BASE}/customers`).reply({
        customers: { id: 'CU_NEW2' },
      })

      await service.createCustomer('test@example.com')

      const body = mock.history[0].body.customers
      expect(body.email).toBe('test@example.com')
      expect(body.given_name).toBeUndefined()
      expect(body.phone_number).toBeUndefined()
    })
  })

  describe('updateCustomer', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(`${API_BASE}/customers/CU123`).reply({
        customers: { id: 'CU123', email: 'new@example.com' },
      })

      const result = await service.updateCustomer('CU123', 'new@example.com')

      expect(result).toMatchObject({ id: 'CU123', email: 'new@example.com' })
      expect(mock.history[0].body).toMatchObject({
        customers: expect.objectContaining({ email: 'new@example.com' }),
      })
    })

    it('throws when customerId is missing', async () => {
      await expect(service.updateCustomer()).rejects.toThrow(
        'customerId is required'
      )
    })
  })

  describe('removeCustomer', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${API_BASE}/customers/CU123`).reply({
        customers: { id: 'CU123' },
      })

      const result = await service.removeCustomer('CU123')

      expect(result).toMatchObject({ id: 'CU123' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws when customerId is missing', async () => {
      await expect(service.removeCustomer()).rejects.toThrow(
        'customerId is required'
      )
    })
  })

  // ── Customer Bank Accounts ──

  describe('listCustomerBankAccounts', () => {
    it('sends correct query params', async () => {
      mock.onGet(`${API_BASE}/customer_bank_accounts`).reply({
        customer_bank_accounts: [{ id: 'BA1' }],
        meta: { cursors: { after: null }, limit: 50 },
      })

      await service.listCustomerBankAccounts('CU123', true, 10)

      expect(mock.history[0].query).toMatchObject({
        customer: 'CU123',
        enabled: true,
        limit: 10,
      })
    })
  })

  describe('getCustomerBankAccount', () => {
    it('fetches a bank account by ID', async () => {
      mock.onGet(`${API_BASE}/customer_bank_accounts/BA123`).reply({
        customer_bank_accounts: { id: 'BA123', bank_name: 'Monzo' },
      })

      const result = await service.getCustomerBankAccount('BA123')

      expect(result).toMatchObject({ id: 'BA123', bank_name: 'Monzo' })
    })

    it('throws when bankAccountId is missing', async () => {
      await expect(service.getCustomerBankAccount()).rejects.toThrow(
        'bankAccountId is required'
      )
    })
  })

  describe('createCustomerBankAccount', () => {
    it('sends POST with bank account details', async () => {
      mock.onPost(`${API_BASE}/customer_bank_accounts`).reply({
        customer_bank_accounts: { id: 'BA_NEW' },
      })

      const result = await service.createCustomerBankAccount(
        'CU123',
        'Jane Doe',
        'United Kingdom',
        null,
        'GB82WEST12345698765432'
      )

      expect(result).toMatchObject({ id: 'BA_NEW' })
      expect(mock.history[0].body.customer_bank_accounts).toMatchObject({
        account_holder_name: 'Jane Doe',
        iban: 'GB82WEST12345698765432',
        links: { customer: 'CU123' },
      })
    })

    it('throws when required params are missing', async () => {
      await expect(
        service.createCustomerBankAccount()
      ).rejects.toThrow('customerId is required')

      await expect(
        service.createCustomerBankAccount('CU123')
      ).rejects.toThrow('accountHolderName is required')
    })
  })

  describe('disableCustomerBankAccount', () => {
    it('sends POST to disable action endpoint', async () => {
      mock
        .onPost(`${API_BASE}/customer_bank_accounts/BA123/actions/disable`)
        .reply({
          customer_bank_accounts: { id: 'BA123', enabled: false },
        })

      const result = await service.disableCustomerBankAccount('BA123')

      expect(result).toMatchObject({ id: 'BA123', enabled: false })
    })

    it('throws when bankAccountId is missing', async () => {
      await expect(service.disableCustomerBankAccount()).rejects.toThrow(
        'bankAccountId is required'
      )
    })
  })

  // ── Mandates ──

  describe('listMandates', () => {
    it('sends correct query with filters', async () => {
      mock.onGet(`${API_BASE}/mandates`).reply({
        mandates: [{ id: 'MD1' }],
        meta: { cursors: { after: null }, limit: 50 },
      })

      await service.listMandates('CU1', 'BA1')

      expect(mock.history[0].query).toMatchObject({
        customer: 'CU1',
        customer_bank_account: 'BA1',
      })
    })
  })

  describe('getMandate', () => {
    it('fetches a mandate by ID', async () => {
      mock.onGet(`${API_BASE}/mandates/MD123`).reply({
        mandates: { id: 'MD123', status: 'active', scheme: 'bacs' },
      })

      const result = await service.getMandate('MD123')

      expect(result).toMatchObject({
        id: 'MD123',
        status: 'active',
        scheme: 'bacs',
      })
    })

    it('throws when mandateId is missing', async () => {
      await expect(service.getMandate()).rejects.toThrow(
        'mandateId is required'
      )
    })
  })

  describe('createMandate', () => {
    it('sends POST with bank account link', async () => {
      mock.onPost(`${API_BASE}/mandates`).reply({
        mandates: { id: 'MD_NEW', status: 'pending_submission' },
      })

      const result = await service.createMandate('BA123')

      expect(result).toMatchObject({ id: 'MD_NEW' })
      expect(mock.history[0].body.mandates).toMatchObject({
        links: { customer_bank_account: 'BA123' },
      })
    })

    it('throws when customerBankAccountId is missing', async () => {
      await expect(service.createMandate()).rejects.toThrow(
        'customerBankAccountId is required'
      )
    })
  })

  describe('updateMandate', () => {
    it('sends PUT with metadata', async () => {
      mock.onPut(`${API_BASE}/mandates/MD123`).reply({
        mandates: { id: 'MD123', metadata: { key: 'val' } },
      })

      const result = await service.updateMandate('MD123', { key: 'val' })

      expect(result).toMatchObject({ metadata: { key: 'val' } })
      expect(mock.history[0].body).toEqual({
        mandates: { metadata: { key: 'val' } },
      })
    })

    it('throws when mandateId is missing', async () => {
      await expect(service.updateMandate()).rejects.toThrow(
        'mandateId is required'
      )
    })
  })

  describe('cancelMandate', () => {
    it('sends POST to cancel action endpoint', async () => {
      mock
        .onPost(`${API_BASE}/mandates/MD123/actions/cancel`)
        .reply({ mandates: { id: 'MD123', status: 'cancelled' } })

      const result = await service.cancelMandate('MD123')

      expect(result).toMatchObject({ status: 'cancelled' })
    })
  })

  describe('reinstateMandate', () => {
    it('sends POST to reinstate action endpoint', async () => {
      mock
        .onPost(`${API_BASE}/mandates/MD123/actions/reinstate`)
        .reply({ mandates: { id: 'MD123', status: 'active' } })

      const result = await service.reinstateMandate('MD123')

      expect(result).toMatchObject({ status: 'active' })
    })
  })

  describe('getMandatePdf', () => {
    it('sends POST with mandate link', async () => {
      mock.onPost(`${API_BASE}/mandate_pdfs`).reply({
        mandate_pdfs: { url: 'https://pdf.example.com/test.pdf' },
      })

      const result = await service.getMandatePdf('MD123')

      expect(result).toMatchObject({ url: 'https://pdf.example.com/test.pdf' })
      expect(mock.history[0].body.mandate_pdfs).toMatchObject({
        links: { mandate: 'MD123' },
      })
    })

    it('sends POST with prefill when no mandateId', async () => {
      mock.onPost(`${API_BASE}/mandate_pdfs`).reply({
        mandate_pdfs: { url: 'https://pdf.example.com/unsigned.pdf' },
      })

      await service.getMandatePdf(null, { account_holder_name: 'Jane' })

      expect(mock.history[0].body.mandate_pdfs).toMatchObject({
        account_holder_name: 'Jane',
      })
      expect(
        mock.history[0].body.mandate_pdfs.links
      ).toBeUndefined()
    })
  })

  // ── Mandate Imports ──

  describe('createMandateImport', () => {
    it('sends POST with scheme', async () => {
      mock.onPost(`${API_BASE}/mandate_imports`).reply({
        mandate_imports: { id: 'IM1', scheme: 'bacs', status: 'created' },
      })

      const result = await service.createMandateImport('Bacs (UK)')

      expect(result).toMatchObject({ id: 'IM1', scheme: 'bacs' })
    })

    it('throws when scheme is missing', async () => {
      await expect(service.createMandateImport()).rejects.toThrow(
        'scheme is required'
      )
    })
  })

  describe('getMandateImport', () => {
    it('fetches a mandate import', async () => {
      mock.onGet(`${API_BASE}/mandate_imports/IM1`).reply({
        mandate_imports: { id: 'IM1', status: 'created' },
      })

      const result = await service.getMandateImport('IM1')

      expect(result).toMatchObject({ id: 'IM1' })
    })
  })

  describe('submitMandateImport', () => {
    it('sends POST to submit action', async () => {
      mock
        .onPost(`${API_BASE}/mandate_imports/IM1/actions/submit`)
        .reply({ mandate_imports: { id: 'IM1', status: 'submitted' } })

      const result = await service.submitMandateImport('IM1')

      expect(result).toMatchObject({ status: 'submitted' })
    })
  })

  describe('cancelMandateImport', () => {
    it('sends POST to cancel action', async () => {
      mock
        .onPost(`${API_BASE}/mandate_imports/IM1/actions/cancel`)
        .reply({ mandate_imports: { id: 'IM1', status: 'cancelled' } })

      const result = await service.cancelMandateImport('IM1')

      expect(result).toMatchObject({ status: 'cancelled' })
    })
  })

  describe('addMandateImportEntry', () => {
    it('sends POST with entry details', async () => {
      mock.onPost(`${API_BASE}/mandate_import_entries`).reply({
        mandate_import_entries: {
          record_identifier: 'row-1',
          links: { mandate_import: 'IM1' },
        },
      })

      const result = await service.addMandateImportEntry(
        'IM1',
        { given_name: 'Jane', family_name: 'Doe' },
        { account_holder_name: 'Jane Doe', iban: 'GB82WEST12345698765432' }
      )

      expect(result).toMatchObject({ record_identifier: 'row-1' })
      expect(mock.history[0].body.mandate_import_entries).toMatchObject({
        links: { mandate_import: 'IM1' },
      })
    })

    it('throws when required params are missing', async () => {
      await expect(service.addMandateImportEntry()).rejects.toThrow(
        'mandateImportId is required'
      )
      await expect(
        service.addMandateImportEntry('IM1')
      ).rejects.toThrow('customer is required')
      await expect(
        service.addMandateImportEntry('IM1', { name: 'x' })
      ).rejects.toThrow('bankAccount is required')
    })
  })

  describe('listMandateImportEntries', () => {
    it('sends GET with mandate import filter', async () => {
      mock.onGet(`${API_BASE}/mandate_import_entries`).reply({
        mandate_import_entries: [],
        meta: { cursors: { after: null }, limit: 50 },
      })

      await service.listMandateImportEntries('IM1')

      expect(mock.history[0].query).toMatchObject({ mandate_import: 'IM1' })
    })
  })

  // ── Creditors ──

  describe('listCreditors', () => {
    it('returns creditor list', async () => {
      mock.onGet(`${API_BASE}/creditors`).reply({
        creditors: [{ id: 'CR1', name: 'Acme' }],
        meta: { cursors: { after: null }, limit: 50 },
      })

      const result = await service.listCreditors()

      expect(result.data).toEqual([{ id: 'CR1', name: 'Acme' }])
    })
  })

  describe('getCreditor', () => {
    it('fetches a creditor by ID', async () => {
      mock.onGet(`${API_BASE}/creditors/CR1`).reply({
        creditors: { id: 'CR1', name: 'Acme' },
      })

      const result = await service.getCreditor('CR1')

      expect(result).toMatchObject({ id: 'CR1', name: 'Acme' })
    })

    it('throws when creditorId is missing', async () => {
      await expect(service.getCreditor()).rejects.toThrow(
        'creditorId is required'
      )
    })
  })

  describe('updateCreditor', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(`${API_BASE}/creditors/CR1`).reply({
        creditors: { id: 'CR1', name: 'Acme Updated' },
      })

      const result = await service.updateCreditor('CR1', 'Acme Updated')

      expect(result).toMatchObject({ name: 'Acme Updated' })
      expect(mock.history[0].body.creditors).toMatchObject({
        name: 'Acme Updated',
      })
    })
  })

  // ── Payments ──

  describe('listPayments', () => {
    it('sends correct query with filters', async () => {
      mock.onGet(`${API_BASE}/payments`).reply({
        payments: [],
        meta: { cursors: { after: null }, limit: 50 },
      })

      await service.listPayments('MD1', 'CU1', 'SB1')

      expect(mock.history[0].query).toMatchObject({
        mandate: 'MD1',
        customer: 'CU1',
        subscription: 'SB1',
      })
    })

    it('fetches all pages when fetchAll is true', async () => {
      mock.onGet(`${API_BASE}/payments`).reply({
        payments: [{ id: 'PM1' }],
        meta: { cursors: { after: null }, limit: 50 },
      })

      const result = await service.listPayments(
        null, null, null, null, null, null, null, null, true
      )

      expect(result).toHaveProperty('pageCount')
      expect(result).toHaveProperty('truncated')
    })
  })

  describe('getPayment', () => {
    it('fetches a payment by ID', async () => {
      mock.onGet(`${API_BASE}/payments/PM123`).reply({
        payments: { id: 'PM123', amount: 1000, currency: 'GBP' },
      })

      const result = await service.getPayment('PM123')

      expect(result).toMatchObject({ id: 'PM123', amount: 1000 })
    })

    it('throws when paymentId is missing', async () => {
      await expect(service.getPayment()).rejects.toThrow(
        'paymentId is required'
      )
    })
  })

  describe('createPayment', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${API_BASE}/payments`).reply({
        payments: { id: 'PM_NEW', amount: 1000, currency: 'GBP' },
      })

      const result = await service.createPayment(
        'MD123',
        1000,
        'British Pound',
        'Test payment'
      )

      expect(result).toMatchObject({ id: 'PM_NEW' })
      expect(mock.history[0].body.payments).toMatchObject({
        amount: 1000,
        currency: 'GBP',
        description: 'Test payment',
        links: { mandate: 'MD123' },
      })
    })

    it('throws when required params are missing', async () => {
      await expect(service.createPayment()).rejects.toThrow(
        'mandateId is required'
      )
      await expect(service.createPayment('MD1')).rejects.toThrow(
        'amount is required'
      )
      await expect(service.createPayment('MD1', 1000)).rejects.toThrow(
        'currency is required'
      )
    })
  })

  describe('updatePayment', () => {
    it('sends PUT with metadata', async () => {
      mock.onPut(`${API_BASE}/payments/PM123`).reply({
        payments: { id: 'PM123', metadata: { key: 'val' } },
      })

      const result = await service.updatePayment('PM123', { key: 'val' })

      expect(result).toMatchObject({ metadata: { key: 'val' } })
    })

    it('throws when paymentId is missing', async () => {
      await expect(service.updatePayment()).rejects.toThrow(
        'paymentId is required'
      )
    })
  })

  describe('cancelPayment', () => {
    it('sends POST to cancel action', async () => {
      mock
        .onPost(`${API_BASE}/payments/PM123/actions/cancel`)
        .reply({ payments: { id: 'PM123', status: 'cancelled' } })

      const result = await service.cancelPayment('PM123')

      expect(result).toMatchObject({ status: 'cancelled' })
    })
  })

  describe('retryPayment', () => {
    it('sends POST to retry action', async () => {
      mock
        .onPost(`${API_BASE}/payments/PM123/actions/retry`)
        .reply({ payments: { id: 'PM123', status: 'pending_submission' } })

      const result = await service.retryPayment('PM123')

      expect(result).toMatchObject({ status: 'pending_submission' })
    })

    it('throws when paymentId is missing', async () => {
      await expect(service.retryPayment()).rejects.toThrow(
        'paymentId is required'
      )
    })
  })

  // ── Subscriptions ──

  describe('listSubscriptions', () => {
    it('sends correct query with filters', async () => {
      mock.onGet(`${API_BASE}/subscriptions`).reply({
        subscriptions: [{ id: 'SB1' }],
        meta: { cursors: { after: null }, limit: 50 },
      })

      await service.listSubscriptions('MD1', 'CU1')

      expect(mock.history[0].query).toMatchObject({
        mandate: 'MD1',
        customer: 'CU1',
      })
    })
  })

  describe('getSubscription', () => {
    it('fetches a subscription by ID', async () => {
      mock.onGet(`${API_BASE}/subscriptions/SB123`).reply({
        subscriptions: { id: 'SB123', name: 'Pro Plan', status: 'active' },
      })

      const result = await service.getSubscription('SB123')

      expect(result).toMatchObject({ id: 'SB123', name: 'Pro Plan' })
    })

    it('throws when subscriptionId is missing', async () => {
      await expect(service.getSubscription()).rejects.toThrow(
        'subscriptionId is required'
      )
    })
  })

  describe('createSubscription', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${API_BASE}/subscriptions`).reply({
        subscriptions: { id: 'SB_NEW', status: 'active' },
      })

      const result = await service.createSubscription(
        'MD123',
        1500,
        'British Pound',
        1,
        'Monthly',
        'Pro Plan'
      )

      expect(result).toMatchObject({ id: 'SB_NEW' })
      expect(mock.history[0].body.subscriptions).toMatchObject({
        amount: 1500,
        currency: 'GBP',
        interval: 1,
        interval_unit: 'monthly',
        name: 'Pro Plan',
        links: { mandate: 'MD123' },
      })
    })

    it('throws when required params are missing', async () => {
      await expect(service.createSubscription()).rejects.toThrow(
        'mandateId is required'
      )
      await expect(
        service.createSubscription('MD1', 1000)
      ).rejects.toThrow('currency is required')
    })
  })

  describe('updateSubscription', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(`${API_BASE}/subscriptions/SB123`).reply({
        subscriptions: { id: 'SB123', name: 'New Name' },
      })

      const result = await service.updateSubscription('SB123', 'New Name')

      expect(result).toMatchObject({ name: 'New Name' })
    })

    it('throws when subscriptionId is missing', async () => {
      await expect(service.updateSubscription()).rejects.toThrow(
        'subscriptionId is required'
      )
    })
  })

  describe('pauseSubscription', () => {
    it('sends POST to pause action', async () => {
      mock
        .onPost(`${API_BASE}/subscriptions/SB123/actions/pause`)
        .reply({ subscriptions: { id: 'SB123', status: 'paused' } })

      const result = await service.pauseSubscription('SB123', 3)

      expect(result).toMatchObject({ status: 'paused' })
      expect(mock.history[0].body.data).toMatchObject({ pause_cycles: 3 })
    })
  })

  describe('resumeSubscription', () => {
    it('sends POST to resume action', async () => {
      mock
        .onPost(`${API_BASE}/subscriptions/SB123/actions/resume`)
        .reply({ subscriptions: { id: 'SB123', status: 'active' } })

      const result = await service.resumeSubscription('SB123')

      expect(result).toMatchObject({ status: 'active' })
    })
  })

  describe('cancelSubscription', () => {
    it('sends POST to cancel action', async () => {
      mock
        .onPost(`${API_BASE}/subscriptions/SB123/actions/cancel`)
        .reply({ subscriptions: { id: 'SB123', status: 'cancelled' } })

      const result = await service.cancelSubscription('SB123')

      expect(result).toMatchObject({ status: 'cancelled' })
    })
  })

  // ── Instalment Schedules ──

  describe('listInstalmentSchedules', () => {
    it('sends correct query', async () => {
      mock.onGet(`${API_BASE}/instalment_schedules`).reply({
        instalment_schedules: [],
        meta: { cursors: { after: null }, limit: 50 },
      })

      await service.listInstalmentSchedules('MD1')

      expect(mock.history[0].query).toMatchObject({ mandate: 'MD1' })
    })
  })

  describe('getInstalmentSchedule', () => {
    it('fetches an instalment schedule by ID', async () => {
      mock.onGet(`${API_BASE}/instalment_schedules/IS123`).reply({
        instalment_schedules: { id: 'IS123', name: 'Plan A' },
      })

      const result = await service.getInstalmentSchedule('IS123')

      expect(result).toMatchObject({ id: 'IS123', name: 'Plan A' })
    })

    it('throws when instalmentScheduleId is missing', async () => {
      await expect(service.getInstalmentSchedule()).rejects.toThrow(
        'instalmentScheduleId is required'
      )
    })
  })

  describe('createInstalmentSchedule', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${API_BASE}/instalment_schedules`).reply({
        instalment_schedules: { id: 'IS_NEW', status: 'active' },
      })

      const result = await service.createInstalmentSchedule(
        'MD123',
        'Invoice 1234',
        'British Pound',
        3000,
        [1000, 1000, 1000],
        1,
        'Monthly'
      )

      expect(result).toMatchObject({ id: 'IS_NEW' })
      expect(mock.history[0].body.instalment_schedules).toMatchObject({
        name: 'Invoice 1234',
        currency: 'GBP',
        total_amount: 3000,
        links: { mandate: 'MD123' },
      })
    })

    it('throws when required params are missing', async () => {
      await expect(service.createInstalmentSchedule()).rejects.toThrow(
        'mandateId is required'
      )
    })
  })

  describe('cancelInstalmentSchedule', () => {
    it('sends POST to cancel action', async () => {
      mock
        .onPost(`${API_BASE}/instalment_schedules/IS123/actions/cancel`)
        .reply({ instalment_schedules: { id: 'IS123', status: 'cancelled' } })

      const result = await service.cancelInstalmentSchedule('IS123')

      expect(result).toMatchObject({ status: 'cancelled' })
    })

    it('throws when instalmentScheduleId is missing', async () => {
      await expect(service.cancelInstalmentSchedule()).rejects.toThrow(
        'instalmentScheduleId is required'
      )
    })
  })

  // ── Refunds ──

  describe('listRefunds', () => {
    it('sends correct query with filters', async () => {
      mock.onGet(`${API_BASE}/refunds`).reply({
        refunds: [],
        meta: { cursors: { after: null }, limit: 50 },
      })

      await service.listRefunds('PM1', 'MD1')

      expect(mock.history[0].query).toMatchObject({
        payment: 'PM1',
        mandate: 'MD1',
      })
    })
  })

  describe('getRefund', () => {
    it('fetches a refund by ID', async () => {
      mock.onGet(`${API_BASE}/refunds/RF123`).reply({
        refunds: { id: 'RF123', amount: 500 },
      })

      const result = await service.getRefund('RF123')

      expect(result).toMatchObject({ id: 'RF123', amount: 500 })
    })

    it('throws when refundId is missing', async () => {
      await expect(service.getRefund()).rejects.toThrow(
        'refundId is required'
      )
    })
  })

  describe('createRefund', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${API_BASE}/refunds`).reply({
        refunds: { id: 'RF_NEW', amount: 500 },
      })

      const result = await service.createRefund('PM123', 500, 500)

      expect(result).toMatchObject({ id: 'RF_NEW' })
      expect(mock.history[0].body.refunds).toMatchObject({
        amount: 500,
        total_amount_confirmation: 500,
        links: { payment: 'PM123' },
      })
    })

    it('throws when paymentId is missing', async () => {
      await expect(service.createRefund()).rejects.toThrow(
        'paymentId is required'
      )
    })
  })

  // ── Payouts ──

  describe('listPayouts', () => {
    it('sends correct query', async () => {
      mock.onGet(`${API_BASE}/payouts`).reply({
        payouts: [{ id: 'PO1' }],
        meta: { cursors: { after: null }, limit: 50 },
      })

      await service.listPayouts('CR1')

      expect(mock.history[0].query).toMatchObject({ creditor: 'CR1' })
    })
  })

  describe('getPayout', () => {
    it('fetches a payout by ID', async () => {
      mock.onGet(`${API_BASE}/payouts/PO123`).reply({
        payouts: { id: 'PO123', amount: 25000 },
      })

      const result = await service.getPayout('PO123')

      expect(result).toMatchObject({ id: 'PO123', amount: 25000 })
    })

    it('throws when payoutId is missing', async () => {
      await expect(service.getPayout()).rejects.toThrow(
        'payoutId is required'
      )
    })
  })

  describe('listPayoutItems', () => {
    it('sends correct query', async () => {
      mock.onGet(`${API_BASE}/payout_items`).reply({
        payout_items: [{ amount: '1000', type: 'payment_paid_out' }],
        meta: { cursors: { after: null }, limit: 50 },
      })

      await service.listPayoutItems('PO123')

      expect(mock.history[0].query).toMatchObject({ payout: 'PO123' })
    })

    it('includes tax breakdowns when requested', async () => {
      mock.onGet(`${API_BASE}/payout_items`).reply({
        payout_items: [],
        meta: { cursors: { after: null }, limit: 50 },
      })

      await service.listPayoutItems('PO123', true)

      expect(mock.history[0].query).toMatchObject({
        payout: 'PO123',
        include: 'tax_breakdowns',
      })
    })

    it('throws when payoutId is missing', async () => {
      await expect(service.listPayoutItems()).rejects.toThrow(
        'payoutId is required'
      )
    })
  })

  // ── Billing Requests ──

  describe('createBillingRequest', () => {
    it('sends POST with mandate request when collectMandate is true', async () => {
      mock.onPost(`${API_BASE}/billing_requests`).reply({
        billing_requests: { id: 'BRQ1', status: 'pending' },
      })

      const result = await service.createBillingRequest(
        true,
        false,
        'British Pound',
        'Bacs (UK)'
      )

      expect(result).toMatchObject({ id: 'BRQ1' })
      expect(
        mock.history[0].body.billing_requests.mandate_request
      ).toMatchObject({ currency: 'GBP', scheme: 'bacs' })
      expect(
        mock.history[0].body.billing_requests.payment_request
      ).toBeUndefined()
    })

    it('sends POST with payment request when collectPayment is true', async () => {
      mock.onPost(`${API_BASE}/billing_requests`).reply({
        billing_requests: { id: 'BRQ2', status: 'pending' },
      })

      await service.createBillingRequest(
        false,
        true,
        'British Pound',
        null,
        null,
        null,
        2000,
        'Test payment'
      )

      expect(
        mock.history[0].body.billing_requests.payment_request
      ).toMatchObject({ amount: 2000, currency: 'GBP' })
      expect(
        mock.history[0].body.billing_requests.mandate_request
      ).toBeUndefined()
    })
  })

  describe('getBillingRequest', () => {
    it('fetches a billing request by ID', async () => {
      mock.onGet(`${API_BASE}/billing_requests/BRQ1`).reply({
        billing_requests: { id: 'BRQ1', status: 'pending' },
      })

      const result = await service.getBillingRequest('BRQ1')

      expect(result).toMatchObject({ id: 'BRQ1', status: 'pending' })
    })

    it('throws when billingRequestId is missing', async () => {
      await expect(service.getBillingRequest()).rejects.toThrow(
        'billingRequestId is required'
      )
    })
  })

  describe('createBillingRequestFlow', () => {
    it('sends POST with flow config', async () => {
      mock.onPost(`${API_BASE}/billing_request_flows`).reply({
        billing_request_flows: {
          id: 'BRF1',
          authorisation_url: 'https://pay.gocardless.com/flow/BRF1',
        },
      })

      const result = await service.createBillingRequestFlow(
        'BRQ1',
        'https://example.com/return',
        'https://example.com/exit',
        true
      )

      expect(result).toMatchObject({ id: 'BRF1' })
      expect(mock.history[0].body.billing_request_flows).toMatchObject({
        redirect_uri: 'https://example.com/return',
        exit_uri: 'https://example.com/exit',
        auto_fulfil: true,
        links: { billing_request: 'BRQ1' },
      })
    })

    it('throws when billingRequestId is missing', async () => {
      await expect(service.createBillingRequestFlow()).rejects.toThrow(
        'billingRequestId is required'
      )
    })
  })

  describe('cancelBillingRequest', () => {
    it('sends POST to cancel action', async () => {
      mock
        .onPost(`${API_BASE}/billing_requests/BRQ1/actions/cancel`)
        .reply({ billing_requests: { id: 'BRQ1', status: 'cancelled' } })

      const result = await service.cancelBillingRequest('BRQ1')

      expect(result).toMatchObject({ status: 'cancelled' })
    })
  })

  describe('fulfilBillingRequest', () => {
    it('sends POST to fulfil action', async () => {
      mock
        .onPost(`${API_BASE}/billing_requests/BRQ1/actions/fulfil`)
        .reply({ billing_requests: { id: 'BRQ1', status: 'fulfilled' } })

      const result = await service.fulfilBillingRequest('BRQ1')

      expect(result).toMatchObject({ status: 'fulfilled' })
    })
  })

  describe('collectBillingRequestCustomerDetails', () => {
    it('sends POST with customer data', async () => {
      mock
        .onPost(
          `${API_BASE}/billing_requests/BRQ1/actions/collect_customer_details`
        )
        .reply({ billing_requests: { id: 'BRQ1', status: 'pending' } })

      const result = await service.collectBillingRequestCustomerDetails(
        'BRQ1',
        { given_name: 'Jane', family_name: 'Doe', email: 'jane@x.com' }
      )

      expect(result).toMatchObject({ id: 'BRQ1' })
      expect(mock.history[0].body.data.customer).toMatchObject({
        given_name: 'Jane',
        email: 'jane@x.com',
      })
    })

    it('throws when required params are missing', async () => {
      await expect(
        service.collectBillingRequestCustomerDetails()
      ).rejects.toThrow('billingRequestId is required')
      await expect(
        service.collectBillingRequestCustomerDetails('BRQ1')
      ).rejects.toThrow('customer is required')
    })
  })

  describe('collectBillingRequestBankAccount', () => {
    it('sends POST with bank account data', async () => {
      mock
        .onPost(
          `${API_BASE}/billing_requests/BRQ1/actions/collect_bank_account`
        )
        .reply({ billing_requests: { id: 'BRQ1' } })

      await service.collectBillingRequestBankAccount(
        'BRQ1',
        'Jane Doe',
        'United Kingdom',
        null,
        'GB82WEST12345698765432'
      )

      expect(mock.history[0].body.data).toMatchObject({
        account_holder_name: 'Jane Doe',
        country_code: 'GB',
        iban: 'GB82WEST12345698765432',
      })
    })

    it('throws when required params are missing', async () => {
      await expect(
        service.collectBillingRequestBankAccount()
      ).rejects.toThrow('billingRequestId is required')
      await expect(
        service.collectBillingRequestBankAccount('BRQ1')
      ).rejects.toThrow('accountHolderName is required')
    })
  })

  describe('confirmBillingRequestPayerDetails', () => {
    it('sends POST to confirm action', async () => {
      mock
        .onPost(
          `${API_BASE}/billing_requests/BRQ1/actions/confirm_payer_details`
        )
        .reply({
          billing_requests: { id: 'BRQ1', status: 'ready_to_fulfil' },
        })

      const result = await service.confirmBillingRequestPayerDetails('BRQ1')

      expect(result).toMatchObject({ status: 'ready_to_fulfil' })
    })
  })

  // ── Events ──

  describe('listEvents', () => {
    it('sends correct query with filters', async () => {
      mock.onGet(`${API_BASE}/events`).reply({
        events: [{ id: 'EV1' }],
        meta: { cursors: { after: null }, limit: 50 },
      })

      await service.listEvents('Payments')

      expect(mock.history[0].query).toMatchObject({
        resource_type: 'payments',
      })
    })
  })

  describe('getEvent', () => {
    it('fetches an event by ID', async () => {
      mock.onGet(`${API_BASE}/events/EV123`).reply({
        events: { id: 'EV123', resource_type: 'payments', action: 'confirmed' },
      })

      const result = await service.getEvent('EV123')

      expect(result).toMatchObject({ id: 'EV123', action: 'confirmed' })
    })

    it('throws when eventId is missing', async () => {
      await expect(service.getEvent()).rejects.toThrow(
        'eventId is required'
      )
    })
  })

  // ── Utility ──

  describe('testConnection', () => {
    it('returns ok status with creditor info', async () => {
      mock.onGet(`${API_BASE}/creditors`).reply({
        creditors: [{ id: 'CR1', name: 'Acme' }],
      })

      const result = await service.testConnection()

      expect(result).toMatchObject({
        ok: true,
        environment: 'live',
        creditor: { id: 'CR1', name: 'Acme' },
      })
    })

    it('returns ok=false when no creditors', async () => {
      mock.onGet(`${API_BASE}/creditors`).reply({ creditors: [] })

      const result = await service.testConnection()

      expect(result.ok).toBe(false)
    })
  })

  describe('lookupBankDetails', () => {
    it('sends POST with IBAN', async () => {
      mock.onPost(`${API_BASE}/bank_details_lookups`).reply({
        bank_details_lookups: {
          bank_name: 'MONZO',
          bic: 'MONZGB2L',
          available_debit_schemes: ['bacs'],
        },
      })

      const result = await service.lookupBankDetails('GB82WEST12345698765432')

      expect(result).toMatchObject({ bank_name: 'MONZO' })
      expect(mock.history[0].body.bank_details_lookups).toMatchObject({
        iban: 'GB82WEST12345698765432',
      })
    })

    it('sends POST with account number and branch code', async () => {
      mock.onPost(`${API_BASE}/bank_details_lookups`).reply({
        bank_details_lookups: { bank_name: 'NatWest' },
      })

      await service.lookupBankDetails(null, '12345678', '200000')

      expect(mock.history[0].body.bank_details_lookups).toMatchObject({
        account_number: '12345678',
        branch_code: '200000',
      })
    })

    it('throws when neither iban nor accountNumber is given', async () => {
      await expect(service.lookupBankDetails()).rejects.toThrow(
        'Either iban or accountNumber'
      )
    })
  })

  describe('runScenarioSimulator', () => {
    it('sends POST to correct simulator endpoint', async () => {
      mock
        .onPost(
          `${API_BASE}/scenario_simulators/payment_confirmed/actions/run`
        )
        .reply({ scenario_simulators: { id: 'payment_confirmed' } })

      const result = await service.runScenarioSimulator(
        'Payment Confirmed',
        'PM123'
      )

      expect(result).toMatchObject({
        scenario_simulators: { id: 'payment_confirmed' },
      })
      expect(mock.history[0].body).toEqual({
        data: { links: { resource: 'PM123' } },
      })
    })

    it('throws when scenario is missing', async () => {
      await expect(service.runScenarioSimulator()).rejects.toThrow(
        'scenario is required'
      )
    })

    it('throws when resourceId is missing', async () => {
      await expect(
        service.runScenarioSimulator('Payment Confirmed')
      ).rejects.toThrow('resourceId is required')
    })

    it('throws for unknown scenario', async () => {
      await expect(
        service.runScenarioSimulator('Nonexistent Scenario', 'PM1')
      ).rejects.toThrow('Unknown scenario')
    })
  })

  // ── Polling Triggers ──

  describe('onPaymentEvent', () => {
    it('seeds state on first poll and emits no events', async () => {
      mock.onGet(`${API_BASE}/events`).reply({
        events: [
          { id: 'EV1', created_at: '2026-05-16T10:00:00.000Z', resource_type: 'payments', action: 'confirmed', links: { payment: 'PM1' } },
        ],
        meta: { cursors: { after: null }, limit: 1 },
      })

      const result = await service.onPaymentEvent({ state: null })

      expect(result.events).toEqual([])
      expect(result.state).toMatchObject({
        since: '2026-05-16T10:00:00.000Z',
        seenIds: ['EV1'],
      })
    })

    it('emits new events on subsequent polls', async () => {
      mock.onGet(`${API_BASE}/events`).reply({
        events: [
          { id: 'EV2', created_at: '2026-05-16T11:00:00.000Z', resource_type: 'payments', action: 'paid_out', links: { payment: 'PM2' } },
        ],
        meta: { cursors: { after: null }, limit: 500 },
      })

      const result = await service.onPaymentEvent({
        state: {
          since: '2026-05-16T10:00:00.000Z',
          seenIds: ['EV1'],
        },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toMatchObject({
        id: 'EV2',
        action: 'paid_out',
        resourceId: 'PM2',
      })
    })

    it('de-duplicates seen events', async () => {
      mock.onGet(`${API_BASE}/events`).reply({
        events: [
          { id: 'EV1', created_at: '2026-05-16T10:00:00.000Z', resource_type: 'payments', action: 'confirmed', links: { payment: 'PM1' } },
        ],
        meta: { cursors: { after: null }, limit: 500 },
      })

      const result = await service.onPaymentEvent({
        state: {
          since: '2026-05-16T09:00:00.000Z',
          seenIds: ['EV1'],
        },
      })

      expect(result.events).toEqual([])
    })

    it('returns sample event in learning mode', async () => {
      mock.onGet(`${API_BASE}/events`).reply({
        events: [
          { id: 'EV_LEARN', created_at: '2026-05-16T10:00:00.000Z', resource_type: 'payments', action: 'confirmed', links: { payment: 'PM1' } },
        ],
        meta: { cursors: { after: null }, limit: 1 },
      })

      const result = await service.onPaymentEvent({ learningMode: true })

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toMatchObject({
        id: 'EV_LEARN',
        resourceId: 'PM1',
      })
      expect(result.state).toBeNull()
    })
  })

  describe('onMandateEvent', () => {
    it('seeds state on first poll', async () => {
      mock.onGet(`${API_BASE}/events`).reply({
        events: [{ id: 'EV_M1', created_at: '2026-05-16T10:00:00.000Z', resource_type: 'mandates', action: 'active', links: { mandate: 'MD1' } }],
        meta: { cursors: { after: null }, limit: 1 },
      })

      const result = await service.onMandateEvent({ state: null })

      expect(result.events).toEqual([])
      expect(result.state.seenIds).toContain('EV_M1')
    })
  })

  describe('onSubscriptionEvent', () => {
    it('seeds state on first poll', async () => {
      mock.onGet(`${API_BASE}/events`).reply({
        events: [],
        meta: { cursors: { after: null }, limit: 1 },
      })

      const result = await service.onSubscriptionEvent({ state: null })

      expect(result.events).toEqual([])
      expect(result.state).toHaveProperty('since')
    })
  })

  describe('onRefundEvent', () => {
    it('delegates to shared polling logic', async () => {
      mock.onGet(`${API_BASE}/events`).reply({
        events: [],
        meta: { cursors: { after: null }, limit: 1 },
      })

      const result = await service.onRefundEvent({ state: null })

      expect(result.events).toEqual([])
    })
  })

  describe('onPayoutEvent', () => {
    it('delegates to shared polling logic', async () => {
      mock.onGet(`${API_BASE}/events`).reply({
        events: [],
        meta: { cursors: { after: null }, limit: 1 },
      })

      const result = await service.onPayoutEvent({ state: null })

      expect(result.events).toEqual([])
    })
  })

  describe('onBillingRequestEvent', () => {
    it('delegates to shared polling logic', async () => {
      mock.onGet(`${API_BASE}/events`).reply({
        events: [],
        meta: { cursors: { after: null }, limit: 1 },
      })

      const result = await service.onBillingRequestEvent({ state: null })

      expect(result.events).toEqual([])
    })
  })

  // ── handleTriggerPollingForEvent ──

  describe('handleTriggerPollingForEvent', () => {
    it('routes to the correct event handler', async () => {
      mock.onGet(`${API_BASE}/events`).reply({
        events: [],
        meta: { cursors: { after: null }, limit: 1 },
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onPaymentEvent',
        state: null,
      })

      expect(result).toHaveProperty('events')
      expect(result).toHaveProperty('state')
    })
  })

  // ── Dictionaries ──

  describe('listCustomersDict', () => {
    it('returns formatted dictionary items', async () => {
      mock.onGet(`${API_BASE}/customers`).reply({
        customers: [
          { id: 'CU1', given_name: 'Jane', family_name: 'Doe', email: 'jane@x.com', country_code: 'GB' },
        ],
        meta: { cursors: { after: null } },
      })

      const result = await service.listCustomersDict()

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({
        label: 'Jane Doe',
        value: 'CU1',
      })
      expect(result.cursor).toBeNull()
    })

    it('filters by search text', async () => {
      mock.onGet(`${API_BASE}/customers`).reply({
        customers: [
          { id: 'CU1', given_name: 'Jane', family_name: 'Doe', email: 'jane@x.com' },
          { id: 'CU2', given_name: 'John', family_name: 'Smith', email: 'john@x.com' },
        ],
        meta: { cursors: { after: null } },
      })

      const result = await service.listCustomersDict({ search: 'jane' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('CU1')
    })
  })

  describe('listMandatesDict', () => {
    it('returns formatted dictionary items', async () => {
      mock.onGet(`${API_BASE}/mandates`).reply({
        mandates: [
          { id: 'MD1', reference: 'REF-1', status: 'active', scheme: 'bacs', links: { customer: 'CU1' } },
        ],
        meta: { cursors: { after: null } },
      })

      const result = await service.listMandatesDict()

      expect(result.items[0]).toMatchObject({
        label: 'REF-1',
        value: 'MD1',
      })
    })

    it('passes criteria filters', async () => {
      mock.onGet(`${API_BASE}/mandates`).reply({
        mandates: [],
        meta: { cursors: { after: null } },
      })

      await service.listMandatesDict({
        criteria: { customer: 'CU1', status: 'active' },
      })

      expect(mock.history[0].query).toMatchObject({
        customer: 'CU1',
        status: 'active',
      })
    })
  })

  describe('listCreditorsDict', () => {
    it('returns formatted dictionary items', async () => {
      mock.onGet(`${API_BASE}/creditors`).reply({
        creditors: [{ id: 'CR1', name: 'Acme', verification_status: 'successful' }],
        meta: { cursors: { after: null } },
      })

      const result = await service.listCreditorsDict()

      expect(result.items[0]).toMatchObject({
        label: 'Acme',
        value: 'CR1',
        note: 'successful',
      })
    })
  })

  describe('listSubscriptionsDict', () => {
    it('returns formatted dictionary items', async () => {
      mock.onGet(`${API_BASE}/subscriptions`).reply({
        subscriptions: [
          { id: 'SB1', name: 'Pro Plan', status: 'active', amount: 1500, currency: 'GBP', interval_unit: 'monthly' },
        ],
        meta: { cursors: { after: null } },
      })

      const result = await service.listSubscriptionsDict()

      expect(result.items[0]).toMatchObject({
        label: 'Pro Plan',
        value: 'SB1',
      })
    })
  })

  describe('listPaymentsDict', () => {
    it('returns formatted dictionary items', async () => {
      mock.onGet(`${API_BASE}/payments`).reply({
        payments: [
          { id: 'PM1', reference: 'INV-42', status: 'confirmed', amount: 1000, currency: 'GBP', charge_date: '2026-05-19' },
        ],
        meta: { cursors: { after: null } },
      })

      const result = await service.listPaymentsDict()

      expect(result.items[0]).toMatchObject({
        label: 'INV-42',
        value: 'PM1',
      })
    })
  })

  describe('listPayoutsDict', () => {
    it('returns formatted dictionary items', async () => {
      mock.onGet(`${API_BASE}/payouts`).reply({
        payouts: [
          { id: 'PO1', amount: 25000, currency: 'GBP', arrival_date: '2026-05-18', status: 'paid', payout_type: 'merchant' },
        ],
        meta: { cursors: { after: null } },
      })

      const result = await service.listPayoutsDict()

      expect(result.items[0]).toMatchObject({ value: 'PO1' })
    })
  })

  describe('listRefundsDict', () => {
    it('returns formatted dictionary items', async () => {
      mock.onGet(`${API_BASE}/refunds`).reply({
        refunds: [
          { id: 'RF1', reference: 'REFUND-1', created_at: '2026-05-16T10:00:00.000Z', links: { payment: 'PM1' } },
        ],
        meta: { cursors: { after: null } },
      })

      const result = await service.listRefundsDict()

      expect(result.items[0]).toMatchObject({
        label: 'REFUND-1',
        value: 'RF1',
      })
    })
  })

  describe('listBillingRequestsDict', () => {
    it('returns formatted dictionary items', async () => {
      mock.onGet(`${API_BASE}/billing_requests`).reply({
        billing_requests: [
          { id: 'BRQ1', status: 'pending', created_at: '2026-05-16T10:00:00.000Z' },
        ],
        meta: { cursors: { after: null } },
      })

      const result = await service.listBillingRequestsDict()

      expect(result.items[0]).toMatchObject({
        label: 'BRQ1',
        value: 'BRQ1',
      })
    })
  })

  describe('listBillingRequestTemplatesDict', () => {
    it('returns formatted dictionary items', async () => {
      mock.onGet(`${API_BASE}/billing_request_templates`).reply({
        billing_request_templates: [
          { id: 'BRT1', name: 'Standard', payment_request_currency: 'GBP' },
        ],
        meta: { cursors: { after: null } },
      })

      const result = await service.listBillingRequestTemplatesDict()

      expect(result.items[0]).toMatchObject({
        label: 'Standard',
        value: 'BRT1',
        note: 'GBP',
      })
    })
  })

  describe('listInstitutionsDict', () => {
    it('returns formatted dictionary items', async () => {
      mock.onGet(`${API_BASE}/institutions`).reply({
        institutions: [{ id: 'MONZO_MONZGB2L', name: 'Monzo Bank', bic: 'MONZGB2L' }],
        meta: { cursors: { after: null } },
      })

      const result = await service.listInstitutionsDict()

      expect(result.items[0]).toMatchObject({
        label: 'Monzo Bank',
        value: 'MONZO_MONZGB2L',
      })
      // Default country is GB
      expect(mock.history[0].query).toMatchObject({ country_code: 'GB' })
    })
  })

  describe('listCustomerBankAccountsDict', () => {
    it('returns formatted dictionary items', async () => {
      mock.onGet(`${API_BASE}/customer_bank_accounts`).reply({
        customer_bank_accounts: [
          { id: 'BA1', account_holder_name: 'Jane', bank_name: 'Monzo', account_number_ending: '56', currency: 'GBP' },
        ],
        meta: { cursors: { after: null } },
      })

      const result = await service.listCustomerBankAccountsDict()

      expect(result.items[0]).toMatchObject({
        label: 'Jane',
        value: 'BA1',
      })
    })
  })

  describe('listInstalmentSchedulesDict', () => {
    it('returns formatted dictionary items', async () => {
      mock.onGet(`${API_BASE}/instalment_schedules`).reply({
        instalment_schedules: [
          { id: 'IS1', name: 'Invoice 1234', status: 'active', total_amount: 3000, currency: 'GBP' },
        ],
        meta: { cursors: { after: null } },
      })

      const result = await service.listInstalmentSchedulesDict()

      expect(result.items[0]).toMatchObject({
        label: 'Invoice 1234',
        value: 'IS1',
      })
    })
  })

  // ── Schema Loaders ──

  describe('prefilledCustomerSchema', () => {
    it('returns 9 fields with correct names', async () => {
      const result = await service.prefilledCustomerSchema()

      expect(result).toHaveLength(9)
      expect(result.map(f => f.name)).toEqual([
        'email', 'given_name', 'family_name', 'company_name',
        'address_line1', 'city', 'postal_code', 'country_code', 'language',
      ])
      result.forEach(f => {
        expect(f).toHaveProperty('label')
        expect(f).toHaveProperty('description')
        expect(f.type).toBe('String')
        expect(f.required).toBe(false)
      })
    })
  })

  describe('mandatePdfPrefillSchema', () => {
    it('returns 6 fields all optional', async () => {
      const result = await service.mandatePdfPrefillSchema()

      expect(result).toHaveLength(6)
      expect(result.map(f => f.name)).toEqual([
        'account_holder_name', 'iban', 'account_number',
        'branch_code', 'country_code', 'scheme',
      ])
      result.forEach(f => expect(f.required).toBe(false))
    })
  })

  describe('mandateImportEntryCustomerSchema', () => {
    it('returns 15 fields', async () => {
      const result = await service.mandateImportEntryCustomerSchema()

      expect(result).toHaveLength(15)
      expect(result[0].name).toBe('given_name')
      expect(result[14].name).toBe('danish_identity_number')
    })
  })

  describe('mandateImportEntryBankAccountSchema', () => {
    it('returns 7 fields', async () => {
      const result = await service.mandateImportEntryBankAccountSchema()

      expect(result).toHaveLength(7)
      expect(result.map(f => f.name)).toEqual([
        'account_holder_name', 'iban', 'account_number',
        'branch_code', 'bank_code', 'account_type', 'country_code',
      ])
    })
  })

  describe('mandateImportEntryAmendmentSchema', () => {
    it('returns 3 optional fields', async () => {
      const result = await service.mandateImportEntryAmendmentSchema()

      expect(result).toHaveLength(3)
      expect(result.map(f => f.name)).toEqual([
        'original_mandate_reference', 'original_creditor_id', 'original_creditor_name',
      ])
      result.forEach(f => expect(f.required).toBe(false))
    })
  })

  describe('billingRequestCustomerSchema', () => {
    it('returns 6 fields', async () => {
      const result = await service.billingRequestCustomerSchema()

      expect(result).toHaveLength(6)
      expect(result.map(f => f.name)).toEqual([
        'given_name', 'family_name', 'company_name',
        'email', 'phone_number', 'language',
      ])
    })
  })

  describe('billingRequestBillingDetailSchema', () => {
    it('returns 10 optional fields', async () => {
      const result = await service.billingRequestBillingDetailSchema()

      expect(result).toHaveLength(10)
      expect(result[0].name).toBe('address_line1')
      expect(result[9].name).toBe('danish_identity_number')
      result.forEach(f => expect(f.required).toBe(false))
    })
  })

  describe('creditorPayoutAccountsSchema', () => {
    it('returns 8 currency payout account fields', async () => {
      const result = await service.creditorPayoutAccountsSchema()

      expect(result).toHaveLength(8)
      expect(result.map(f => f.name)).toEqual([
        'default_gbp_payout_account', 'default_eur_payout_account',
        'default_usd_payout_account', 'default_aud_payout_account',
        'default_nzd_payout_account', 'default_cad_payout_account',
        'default_sek_payout_account', 'default_dkk_payout_account',
      ])
      result.forEach(f => expect(f.required).toBe(false))
    })
  })

  // ── API Headers ──

  describe('API request headers', () => {
    it('includes GoCardless-Version and Authorization headers', async () => {
      mock.onGet(`${API_BASE}/customers/CU1`).reply({
        customers: { id: 'CU1' },
      })

      await service.getCustomer('CU1')

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'GoCardless-Version': '2015-07-06',
        Accept: 'application/json',
      })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('wraps API errors with friendly message', async () => {
      mock.onGet(`${API_BASE}/customers/INVALID`).replyWithError({
        message: 'not found',
        status: 404,
        body: {
          error: {
            type: 'invalid_api_usage',
            message: 'resource not found',
            request_id: 'REQ123',
            errors: [],
          },
        },
      })

      await expect(service.getCustomer('INVALID')).rejects.toThrow(
        'resource not found'
      )
    })
  })
})
