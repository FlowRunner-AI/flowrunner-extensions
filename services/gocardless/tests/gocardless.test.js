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

      expect(url).toContain(`${ CONNECT_BASE }/oauth/authorize`)
      expect(url).toContain(`client_id=${ CLIENT_ID }`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=read_write')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches creditor identity', async () => {
      mock.onPost(`${ CONNECT_BASE }/oauth/access_token`).reply({
        access_token: 'new-token',
        refresh_token: 'new-refresh',
        organisation_id: 'OR123',
        scope: 'read_write',
      })

      mock.onGet(`${ API_BASE }/creditors`).reply({
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
      mock.onPost(`${ CONNECT_BASE }/oauth/access_token`).replyWithError({
        message: 'invalid_grant',
        body: { error: 'invalid_grant' },
      })

      await expect(
        service.executeCallback({ code: 'bad', redirectURI: 'https://x.com' })
      ).rejects.toThrow('OAuth token exchange failed')
    })

    it('throws when no access_token returned', async () => {
      mock.onPost(`${ CONNECT_BASE }/oauth/access_token`).reply({})

      await expect(
        service.executeCallback({ code: 'x', redirectURI: 'https://x.com' })
      ).rejects.toThrow('no access_token')
    })
  })

  describe('refreshToken', () => {
    it('exchanges refresh token successfully', async () => {
      mock.onPost(`${ CONNECT_BASE }/oauth/access_token`).reply({
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
      expect(mock.history[0].body).toContain(`client_id=${ CLIENT_ID }`)
    })

    it('throws when called without a refresh token', async () => {
      await expect(service.refreshToken()).rejects.toThrow(
        'without a refresh token'
      )
    })

    it('falls back to current token when refresh fails', async () => {
      mock
        .onPost(`${ CONNECT_BASE }/oauth/access_token`)
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
      mock.onGet(`${ API_BASE }/customers`).reply({
        customers: [{ id: 'CU1' }],
        meta: { cursors: { after: null }, limit: 50 },
      })

      const result = await service.listCustomers()

      expect(result.data).toEqual([{ id: 'CU1' }])
      expect(result.hasMore).toBe(false)
      expect(mock.history).toHaveLength(1)

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ ACCESS_TOKEN }`,
      })
    })

    it('passes cursor for manual pagination', async () => {
      mock.onGet(`${ API_BASE }/customers`).reply({
        customers: [],
        meta: { cursors: { after: null }, limit: 50 },
      })

      await service.listCustomers(null, null, null, null, false, 'cursor123')

      expect(mock.history[0].query).toMatchObject({ after: 'cursor123' })
    })

    it('fetches all pages when fetchAll is true', async () => {
      mock.onGet(`${ API_BASE }/customers`).reply({
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
      mock.onGet(`${ API_BASE }/customers/CU123`).reply({
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
      mock.onPost(`${ API_BASE }/customers`).reply({
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
      mock.onPost(`${ API_BASE }/customers`).reply({
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
      mock.onPut(`${ API_BASE }/customers/CU123`).reply({
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
      mock.onDelete(`${ API_BASE }/customers/CU123`).reply({
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
      mock.onGet(`${ API_BASE }/customer_bank_accounts`).reply({
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
      mock.onGet(`${ API_BASE }/customer_bank_accounts/BA123`).reply({
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
      mock.onPost(`${ API_BASE }/customer_bank_accounts`).reply({
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
        .onPost(`${ API_BASE }/customer_bank_accounts/BA123/actions/disable`)
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
      mock.onGet(`${ API_BASE }/mandates`).reply({
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
      mock.onGet(`${ API_BASE }/mandates/MD123`).reply({
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
      mock.onPost(`${ API_BASE }/mandates`).reply({
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
      mock.onPut(`${ API_BASE }/mandates/MD123`).reply({
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
        .onPost(`${ API_BASE }/mandates/MD123/actions/cancel`)
        .reply({ mandates: { id: 'MD123', status: 'cancelled' } })

      const result = await service.cancelMandate('MD123')

      expect(result).toMatchObject({ status: 'cancelled' })
    })
  })

  describe('reinstateMandate', () => {
    it('sends POST to reinstate action endpoint', async () => {
      mock
        .onPost(`${ API_BASE }/mandates/MD123/actions/reinstate`)
        .reply({ mandates: { id: 'MD123', status: 'active' } })

      const result = await service.reinstateMandate('MD123')

      expect(result).toMatchObject({ status: 'active' })
    })
  })

  describe('getMandatePdf', () => {
    it('sends POST with mandate link', async () => {
      mock.onPost(`${ API_BASE }/mandate_pdfs`).reply({
        mandate_pdfs: { url: 'https://pdf.example.com/test.pdf' },
      })

      const result = await service.getMandatePdf('MD123')

      expect(result).toMatchObject({ url: 'https://pdf.example.com/test.pdf' })

      expect(mock.history[0].body.mandate_pdfs).toMatchObject({
        links: { mandate: 'MD123' },
      })
    })

    it('sends POST with prefill when no mandateId', async () => {
      mock.onPost(`${ API_BASE }/mandate_pdfs`).reply({
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
      mock.onPost(`${ API_BASE }/mandate_imports`).reply({
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
      mock.onGet(`${ API_BASE }/mandate_imports/IM1`).reply({
        mandate_imports: { id: 'IM1', status: 'created' },
      })

      const result = await service.getMandateImport('IM1')

      expect(result).toMatchObject({ id: 'IM1' })
    })
  })

  describe('submitMandateImport', () => {
    it('sends POST to submit action', async () => {
      mock
        .onPost(`${ API_BASE }/mandate_imports/IM1/actions/submit`)
        .reply({ mandate_imports: { id: 'IM1', status: 'submitted' } })

      const result = await service.submitMandateImport('IM1')

      expect(result).toMatchObject({ status: 'submitted' })
    })
  })

  describe('cancelMandateImport', () => {
    it('sends POST to cancel action', async () => {
      mock
        .onPost(`${ API_BASE }/mandate_imports/IM1/actions/cancel`)
        .reply({ mandate_imports: { id: 'IM1', status: 'cancelled' } })

      const result = await service.cancelMandateImport('IM1')

      expect(result).toMatchObject({ status: 'cancelled' })
    })
  })

  describe('addMandateImportEntry', () => {
    it('sends POST with entry details', async () => {
      mock.onPost(`${ API_BASE }/mandate_import_entries`).reply({
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
      mock.onGet(`${ API_BASE }/mandate_import_entries`).reply({
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
      mock.onGet(`${ API_BASE }/creditors`).reply({
        creditors: [{ id: 'CR1', name: 'Acme' }],
        meta: { cursors: { after: null }, limit: 50 },
      })

      const result = await service.listCreditors()

      expect(result.data).toEqual([{ id: 'CR1', name: 'Acme' }])
    })
  })

  describe('getCreditor', () => {
    it('fetches a creditor by ID', async () => {
      mock.onGet(`${ API_BASE }/creditors/CR1`).reply({
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
      mock.onPut(`${ API_BASE }/creditors/CR1`).reply({
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
      mock.onGet(`${ API_BASE }/payments`).reply({
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
      mock.onGet(`${ API_BASE }/payments`).reply({
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
      mock.onGet(`${ API_BASE }/payments/PM123`).reply({
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
      mock.onPost(`${ API_BASE }/payments`).reply({
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
      mock.onPut(`${ API_BASE }/payments/PM123`).reply({
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
        .onPost(`${ API_BASE }/payments/PM123/actions/cancel`)
        .reply({ payments: { id: 'PM123', status: 'cancelled' } })

      const result = await service.cancelPayment('PM123')

      expect(result).toMatchObject({ status: 'cancelled' })
    })
  })

  describe('retryPayment', () => {
    it('sends POST to retry action', async () => {
      mock
        .onPost(`${ API_BASE }/payments/PM123/actions/retry`)
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
      mock.onGet(`${ API_BASE }/subscriptions`).reply({
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
      mock.onGet(`${ API_BASE }/subscriptions/SB123`).reply({
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
      mock.onPost(`${ API_BASE }/subscriptions`).reply({
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
      mock.onPut(`${ API_BASE }/subscriptions/SB123`).reply({
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
        .onPost(`${ API_BASE }/subscriptions/SB123/actions/pause`)
        .reply({ subscriptions: { id: 'SB123', status: 'paused' } })

      const result = await service.pauseSubscription('SB123', 3)

      expect(result).toMatchObject({ status: 'paused' })
      expect(mock.history[0].body.data).toMatchObject({ pause_cycles: 3 })
    })
  })

  describe('resumeSubscription', () => {
    it('sends POST to resume action', async () => {
      mock
        .onPost(`${ API_BASE }/subscriptions/SB123/actions/resume`)
        .reply({ subscriptions: { id: 'SB123', status: 'active' } })

      const result = await service.resumeSubscription('SB123')

      expect(result).toMatchObject({ status: 'active' })
    })
  })

  describe('cancelSubscription', () => {
    it('sends POST to cancel action', async () => {
      mock
        .onPost(`${ API_BASE }/subscriptions/SB123/actions/cancel`)
        .reply({ subscriptions: { id: 'SB123', status: 'cancelled' } })

      const result = await service.cancelSubscription('SB123')

      expect(result).toMatchObject({ status: 'cancelled' })
    })
  })

  // ── Instalment Schedules ──

  describe('listInstalmentSchedules', () => {
    it('sends correct query', async () => {
      mock.onGet(`${ API_BASE }/instalment_schedules`).reply({
        instalment_schedules: [],
        meta: { cursors: { after: null }, limit: 50 },
      })

      await service.listInstalmentSchedules('MD1')

      expect(mock.history[0].query).toMatchObject({ mandate: 'MD1' })
    })
  })

  describe('getInstalmentSchedule', () => {
    it('fetches an instalment schedule by ID', async () => {
      mock.onGet(`${ API_BASE }/instalment_schedules/IS123`).reply({
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
      mock.onPost(`${ API_BASE }/instalment_schedules`).reply({
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
        .onPost(`${ API_BASE }/instalment_schedules/IS123/actions/cancel`)
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
      mock.onGet(`${ API_BASE }/refunds`).reply({
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
      mock.onGet(`${ API_BASE }/refunds/RF123`).reply({
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
      mock.onPost(`${ API_BASE }/refunds`).reply({
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
      mock.onGet(`${ API_BASE }/payouts`).reply({
        payouts: [{ id: 'PO1' }],
        meta: { cursors: { after: null }, limit: 50 },
      })

      await service.listPayouts('CR1')

      expect(mock.history[0].query).toMatchObject({ creditor: 'CR1' })
    })
  })

  describe('getPayout', () => {
    it('fetches a payout by ID', async () => {
      mock.onGet(`${ API_BASE }/payouts/PO123`).reply({
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
      mock.onGet(`${ API_BASE }/payout_items`).reply({
        payout_items: [{ amount: '1000', type: 'payment_paid_out' }],
        meta: { cursors: { after: null }, limit: 50 },
      })

      await service.listPayoutItems('PO123')

      expect(mock.history[0].query).toMatchObject({ payout: 'PO123' })
    })

    it('includes tax breakdowns when requested', async () => {
      mock.onGet(`${ API_BASE }/payout_items`).reply({
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
      mock.onPost(`${ API_BASE }/billing_requests`).reply({
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
      mock.onPost(`${ API_BASE }/billing_requests`).reply({
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
      mock.onGet(`${ API_BASE }/billing_requests/BRQ1`).reply({
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
      mock.onPost(`${ API_BASE }/billing_request_flows`).reply({
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
        .onPost(`${ API_BASE }/billing_requests/BRQ1/actions/cancel`)
        .reply({ billing_requests: { id: 'BRQ1', status: 'cancelled' } })

      const result = await service.cancelBillingRequest('BRQ1')

      expect(result).toMatchObject({ status: 'cancelled' })
    })
  })

  describe('fulfilBillingRequest', () => {
    it('sends POST to fulfil action', async () => {
      mock
        .onPost(`${ API_BASE }/billing_requests/BRQ1/actions/fulfil`)
        .reply({ billing_requests: { id: 'BRQ1', status: 'fulfilled' } })

      const result = await service.fulfilBillingRequest('BRQ1')

      expect(result).toMatchObject({ status: 'fulfilled' })
    })
  })

  describe('collectBillingRequestCustomerDetails', () => {
    it('sends POST with customer data', async () => {
      mock
        .onPost(
          `${ API_BASE }/billing_requests/BRQ1/actions/collect_customer_details`
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
          `${ API_BASE }/billing_requests/BRQ1/actions/collect_bank_account`
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
          `${ API_BASE }/billing_requests/BRQ1/actions/confirm_payer_details`
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
      mock.onGet(`${ API_BASE }/events`).reply({
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
      mock.onGet(`${ API_BASE }/events/EV123`).reply({
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
      mock.onGet(`${ API_BASE }/creditors`).reply({
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
      mock.onGet(`${ API_BASE }/creditors`).reply({ creditors: [] })

      const result = await service.testConnection()

      expect(result.ok).toBe(false)
    })
  })

  describe('lookupBankDetails', () => {
    it('sends POST with IBAN', async () => {
      mock.onPost(`${ API_BASE }/bank_details_lookups`).reply({
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
      mock.onPost(`${ API_BASE }/bank_details_lookups`).reply({
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
          `${ API_BASE }/scenario_simulators/payment_confirmed/actions/run`
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
      mock.onGet(`${ API_BASE }/events`).reply({
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
      mock.onGet(`${ API_BASE }/events`).reply({
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
      mock.onGet(`${ API_BASE }/events`).reply({
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
      mock.onGet(`${ API_BASE }/events`).reply({
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
      mock.onGet(`${ API_BASE }/events`).reply({
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
      mock.onGet(`${ API_BASE }/events`).reply({
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
      mock.onGet(`${ API_BASE }/events`).reply({
        events: [],
        meta: { cursors: { after: null }, limit: 1 },
      })

      const result = await service.onRefundEvent({ state: null })

      expect(result.events).toEqual([])
    })
  })

  describe('onPayoutEvent', () => {
    it('delegates to shared polling logic', async () => {
      mock.onGet(`${ API_BASE }/events`).reply({
        events: [],
        meta: { cursors: { after: null }, limit: 1 },
      })

      const result = await service.onPayoutEvent({ state: null })

      expect(result.events).toEqual([])
    })
  })

  describe('onBillingRequestEvent', () => {
    it('delegates to shared polling logic', async () => {
      mock.onGet(`${ API_BASE }/events`).reply({
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
      mock.onGet(`${ API_BASE }/events`).reply({
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
      mock.onGet(`${ API_BASE }/customers`).reply({
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
      mock.onGet(`${ API_BASE }/customers`).reply({
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
      mock.onGet(`${ API_BASE }/mandates`).reply({
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
      mock.onGet(`${ API_BASE }/mandates`).reply({
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
      mock.onGet(`${ API_BASE }/creditors`).reply({
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
      mock.onGet(`${ API_BASE }/subscriptions`).reply({
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
      mock.onGet(`${ API_BASE }/payments`).reply({
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
      mock.onGet(`${ API_BASE }/payouts`).reply({
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
      mock.onGet(`${ API_BASE }/refunds`).reply({
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
      mock.onGet(`${ API_BASE }/billing_requests`).reply({
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
      mock.onGet(`${ API_BASE }/billing_request_templates`).reply({
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
      mock.onGet(`${ API_BASE }/institutions`).reply({
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
      mock.onGet(`${ API_BASE }/customer_bank_accounts`).reply({
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
      mock.onGet(`${ API_BASE }/instalment_schedules`).reply({
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
      mock.onGet(`${ API_BASE }/customers/CU1`).reply({
        customers: { id: 'CU1' },
      })

      await service.getCustomer('CU1')

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ ACCESS_TOKEN }`,
        'GoCardless-Version': '2015-07-06',
        Accept: 'application/json',
      })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('wraps API errors with friendly message', async () => {
      mock.onGet(`${ API_BASE }/customers/INVALID`).replyWithError({
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

  // ── Required-argument guards (destructive ops included) ──

  describe('required-argument guards', () => {
    // Every guard clause in the service, driven with a falsy first argument.
    // Destructive operations (cancel/disable/remove/refund/retry) are called out
    // explicitly: if one of these guards stops firing, the service would issue an
    // unscoped money-moving request.
    const cases = [
      ['getCustomer', () => service.getCustomer(), 'customerId'],
      ['updateCustomer', () => service.updateCustomer(), 'customerId'],
      ['removeCustomer', () => service.removeCustomer(''), 'customerId'],
      ['getCustomerBankAccount', () => service.getCustomerBankAccount(), 'bankAccountId'],
      ['createCustomerBankAccount (customer)', () => service.createCustomerBankAccount(), 'customerId'],
      ['createCustomerBankAccount (holder)', () => service.createCustomerBankAccount('CU1'), 'accountHolderName'],
      ['disableCustomerBankAccount', () => service.disableCustomerBankAccount(), 'bankAccountId'],
      ['getMandate', () => service.getMandate(), 'mandateId'],
      ['createMandate', () => service.createMandate(), 'customerBankAccountId'],
      ['updateMandate', () => service.updateMandate(), 'mandateId'],
      ['cancelMandate', () => service.cancelMandate(), 'mandateId'],
      ['reinstateMandate', () => service.reinstateMandate(), 'mandateId'],
      ['createMandateImport', () => service.createMandateImport(), 'scheme'],
      ['getMandateImport', () => service.getMandateImport(), 'mandateImportId'],
      ['submitMandateImport', () => service.submitMandateImport(), 'mandateImportId'],
      ['cancelMandateImport', () => service.cancelMandateImport(), 'mandateImportId'],
      ['addMandateImportEntry (import)', () => service.addMandateImportEntry(), 'mandateImportId'],
      ['addMandateImportEntry (customer)', () => service.addMandateImportEntry('IM1'), 'customer'],
      ['addMandateImportEntry (bank)', () => service.addMandateImportEntry('IM1', { given_name: 'A' }), 'bankAccount'],
      ['listMandateImportEntries', () => service.listMandateImportEntries(), 'mandateImportId'],
      ['getCreditor', () => service.getCreditor(), 'creditorId'],
      ['updateCreditor', () => service.updateCreditor(), 'creditorId'],
      ['getPayment', () => service.getPayment(), 'paymentId'],
      ['createPayment (mandate)', () => service.createPayment(), 'mandateId'],
      ['createPayment (currency)', () => service.createPayment('MD1', 100), 'currency'],
      ['updatePayment', () => service.updatePayment(), 'paymentId'],
      ['cancelPayment', () => service.cancelPayment(), 'paymentId'],
      ['retryPayment', () => service.retryPayment(), 'paymentId'],
      ['getSubscription', () => service.getSubscription(), 'subscriptionId'],
      ['createSubscription (mandate)', () => service.createSubscription(), 'mandateId'],
      ['createSubscription (currency)', () => service.createSubscription('MD1', 100), 'currency'],
      ['updateSubscription', () => service.updateSubscription(), 'subscriptionId'],
      ['pauseSubscription', () => service.pauseSubscription(), 'subscriptionId'],
      ['resumeSubscription', () => service.resumeSubscription(), 'subscriptionId'],
      ['cancelSubscription', () => service.cancelSubscription(), 'subscriptionId'],
      ['getInstalmentSchedule', () => service.getInstalmentSchedule(), 'instalmentScheduleId'],
      ['createInstalmentSchedule (mandate)', () => service.createInstalmentSchedule(), 'mandateId'],
      ['createInstalmentSchedule (currency)', () => service.createInstalmentSchedule('MD1', 'Plan'), 'currency'],
      ['cancelInstalmentSchedule', () => service.cancelInstalmentSchedule(), 'instalmentScheduleId'],
      ['getRefund', () => service.getRefund(), 'refundId'],
      ['createRefund', () => service.createRefund(), 'paymentId'],
      ['getPayout', () => service.getPayout(), 'payoutId'],
      ['listPayoutItems', () => service.listPayoutItems(), 'payoutId'],
      ['getBillingRequest', () => service.getBillingRequest(), 'billingRequestId'],
      ['createBillingRequestFlow', () => service.createBillingRequestFlow(), 'billingRequestId'],
      ['cancelBillingRequest', () => service.cancelBillingRequest(), 'billingRequestId'],
      ['fulfilBillingRequest', () => service.fulfilBillingRequest(), 'billingRequestId'],
      ['collectBillingRequestCustomerDetails (id)', () => service.collectBillingRequestCustomerDetails(), 'billingRequestId'],
      ['collectBillingRequestCustomerDetails (customer)', () => service.collectBillingRequestCustomerDetails('BRQ1'), 'customer'],
      ['collectBillingRequestBankAccount (id)', () => service.collectBillingRequestBankAccount(), 'billingRequestId'],
      ['collectBillingRequestBankAccount (holder)', () => service.collectBillingRequestBankAccount('BRQ1'), 'accountHolderName'],
      ['confirmBillingRequestPayerDetails', () => service.confirmBillingRequestPayerDetails(), 'billingRequestId'],
      ['getEvent', () => service.getEvent(), 'eventId'],
      ['runScenarioSimulator (scenario)', () => service.runScenarioSimulator(), 'scenario'],
      ['runScenarioSimulator (resource)', () => service.runScenarioSimulator('Payment Confirmed'), 'resourceId'],
    ]

    it.each(cases)('%s rejects with a "%s is required" error', async (_name, call, field) => {
      await expect(call()).rejects.toThrow(`${ field } is required`)
      expect(mock.history).toHaveLength(0)
    })

    it('createInstalmentSchedule rejects when no amounts are supplied', async () => {
      await expect(
        service.createInstalmentSchedule('MD1', 'Plan', 'GBP', 3000, [])
      ).rejects.toThrow('amounts is required')

      expect(mock.history).toHaveLength(0)
    })

    it('createInstalmentSchedule rejects when amounts contain only blanks', async () => {
      await expect(
        service.createInstalmentSchedule('MD1', 'Plan', 'GBP', 3000, ' , ')
      ).rejects.toThrow('amounts is required')
    })

    it('createInstalmentSchedule rejects a non-numeric amount', async () => {
      await expect(
        service.createInstalmentSchedule('MD1', 'Plan', 'GBP', 3000, 'abc')
      ).rejects.toThrow('Invalid amount')
    })
  })

  // ── Environment / base URL resolution ──

  describe('API base resolution', () => {
    const savedRequest = () => service.request

    afterEach(() => {
      service.request = {
        headers: {
          'oauth-access-token': ACCESS_TOKEN,
          'oauth-user-data-environment': 'live',
        },
      }
    })

    it('falls back to the configured apiBase when no environment header is present', async () => {
      expect(savedRequest()).toBeDefined()
      service.request = { headers: { 'oauth-access-token': ACCESS_TOKEN } }

      mock.onGet(`${ API_BASE }/customers/CU1`).reply({ customers: { id: 'CU1' } })

      await service.getCustomer('CU1')

      expect(mock.history[0].url).toBe(`${ API_BASE }/customers/CU1`)
    })

    it('falls back to the configured apiBase for an unknown environment header', async () => {
      service.request = {
        headers: {
          'oauth-access-token': ACCESS_TOKEN,
          'oauth-user-data-environment': 'moon',
        },
      }

      mock.onGet(`${ API_BASE }/customers/CU1`).reply({ customers: { id: 'CU1' } })

      await service.getCustomer('CU1')

      expect(mock.history[0].url).toBe(`${ API_BASE }/customers/CU1`)
    })

    it('routes to the sandbox API when the connection is a sandbox one', async () => {
      service.request = {
        headers: {
          'oauth-access-token': ACCESS_TOKEN,
          'oauth-user-data-environment': 'sandbox',
        },
      }

      const sandboxBase = 'https://api-sandbox.gocardless.com'

      mock.onGet(`${ sandboxBase }/customers/CU1`).reply({ customers: { id: 'CU1' } })

      await service.getCustomer('CU1')

      expect(mock.history[0].url).toBe(`${ sandboxBase }/customers/CU1`)
    })

    it('sends no bearer credential when the OAuth header is missing', async () => {
      service.request = { headers: {} }

      mock.onGet(`${ API_BASE }/customers/CU1`).reply({ customers: { id: 'CU1' } })

      await service.getCustomer('CU1')

      expect(mock.history[0].headers.Authorization).toBe('Bearer undefined')
    })
  })

  // ── Response unwrapping edge cases ──

  describe('response unwrapping', () => {
    it('returns null for an empty response body', async () => {
      mock.onGet(`${ API_BASE }/customers/CU1`).reply(null)

      await expect(service.getCustomer('CU1')).resolves.toBeNull()
    })

    it('converts an array payload into an items/cursors envelope', async () => {
      mock.onGet(`${ API_BASE }/customers/CU1`).reply({
        customers: [{ id: 'CU1' }, { id: 'CU2' }],
        meta: { cursors: { after: 'NEXT' }, limit: 25 },
      })

      const result = await service.getCustomer('CU1')

      expect(result).toEqual({
        items: [{ id: 'CU1' }, { id: 'CU2' }],
        cursors: { after: 'NEXT' },
        limit: 25,
      })
    })

    it('defaults cursors to an empty object when meta is absent', async () => {
      mock.onGet(`${ API_BASE }/customers/CU1`).reply({ customers: [{ id: 'CU1' }] })

      const result = await service.getCustomer('CU1')

      expect(result.cursors).toEqual({})
      expect(result.limit).toBeUndefined()
    })

    it('reports hasMore=false and empty data for a list response with no records', async () => {
      mock.onGet(`${ API_BASE }/customers`).reply({})

      const result = await service.listCustomers()

      expect(result).toMatchObject({
        data: [],
        items: [],
        cursors: {},
        hasMore: false,
      })
    })
  })

  // ── Idempotent replay recovery ──

  describe('idempotent replay recovery', () => {
    const conflictError = id => ({
      message: 'Conflict',
      status: 409,
      body: {
        error: {
          type: 'invalid_state',
          message: 'A resource has already been created with this idempotency key',
          request_id: 'REQ_REPLAY',
          errors: [
            {
              reason: 'idempotent_creation_conflict',
              message: 'A resource has already been created with this idempotency key',
              links: { conflicting_resource_id: id },
            },
          ],
        },
      },
    })

    // Regression guard: apiRequest rethrows a friendly Error that moves the GoCardless envelope
    // to `originalError.body`. extractGoCardlessError must look there too, otherwise
    // isIdempotentReplay() is always false and this whole recovery branch is dead code.
    it('recovers the original resource instead of rethrowing', async () => {
      mock.onPost(`${ API_BASE }/customers`).replyWithError(conflictError('CU_ORIG'))

      mock.onGet(`${ API_BASE }/customers/CU_ORIG`).reply({
        customers: { id: 'CU_ORIG', email: 'orig@example.com' },
      })

      const result = await service.createCustomer('dupe@example.com')

      expect(result).toEqual({ id: 'CU_ORIG', email: 'orig@example.com', _idempotentReplay: true })

      // Exactly one POST, then the recovery GET.
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[1].method).toBe('get')
      expect(mock.history[1].url).toBe(`${ API_BASE }/customers/CU_ORIG`)
    })

    it('never issues a second refund POST when GoCardless reports a replay', async () => {
      mock.onPost(`${ API_BASE }/refunds`).replyWithError(conflictError('RF_ORIG'))

      mock.onGet(`${ API_BASE }/refunds/RF_ORIG`).reply({
        refunds: { id: 'RF_ORIG', amount: 500 },
      })

      const result = await service.createRefund('PM1', 500, 500)

      expect(result).toEqual({ id: 'RF_ORIG', amount: 500, _idempotentReplay: true })

      // The money-safety property still holds: exactly one POST leaves the service.
      expect(mock.history.filter(c => c.method === 'post')).toHaveLength(1)
    })

    it('rethrows a conflict that carries no conflicting_resource_id', async () => {
      mock.onPost(`${ API_BASE }/customers`).replyWithError({
        message: 'Conflict',
        status: 409,
        body: {
          error: {
            type: 'invalid_state',
            message: 'idempotency conflict',
            errors: [{ reason: 'idempotent_creation_conflict' }],
          },
        },
      })

      await expect(service.createCustomer('x@example.com')).rejects.toThrow(
        'idempotency conflict'
      )

      expect(mock.history).toHaveLength(1)
    })

    it('rethrows unrelated create failures untouched', async () => {
      mock.onPost(`${ API_BASE }/customers`).replyWithError({
        message: 'Validation failed',
        status: 422,
        body: {
          error: {
            type: 'validation_failed',
            message: 'Validation failed',
            errors: [{ field: 'email', message: 'is not an email address' }],
          },
        },
      })

      await expect(service.createCustomer('nope')).rejects.toThrow(
        '[GoCardless][validation-failed][createCustomer] is not an email address field=email'
      )

      expect(mock.history).toHaveLength(1)
    })

    it('uses a unique idempotency key per money-moving create', async () => {
      mock.onPost(`${ API_BASE }/payments`).reply({ payments: { id: 'PM1' } })

      await service.createPayment('MD1', 1000, 'GBP')
      await service.createPayment('MD1', 1000, 'GBP')

      const [first, second] = mock.history

      expect(first.headers['Idempotency-Key']).toBeTruthy()
      expect(second.headers['Idempotency-Key']).toBeTruthy()

      expect(first.headers['Idempotency-Key']).not.toBe(
        second.headers['Idempotency-Key']
      )
    })

    it('derives a stable idempotency key for identical identity creates', async () => {
      mock.onPost(`${ API_BASE }/customers`).reply({ customers: { id: 'CU1' } })

      await service.createCustomer('same@example.com')
      await service.createCustomer('same@example.com')

      expect(mock.history[0].headers['Idempotency-Key']).toBe(
        mock.history[1].headers['Idempotency-Key']
      )
    })

    it('honours a caller-supplied idempotency key', async () => {
      mock.onPost(`${ API_BASE }/payments`).reply({ payments: { id: 'PM1' } })

      await service.createPayment(
        'MD1', 1000, 'GBP', undefined, undefined, undefined, undefined,
        undefined, undefined, 'my-own-key'
      )

      expect(mock.history[0].headers['Idempotency-Key']).toBe('my-own-key')
    })
  })

  // ── OAuth extra branches ──

  describe('OAuth edge cases', () => {
    it('still returns a token when the creditor identity lookup fails', async () => {
      mock.onPost(`${ CONNECT_BASE }/oauth/access_token`).reply({
        access_token: 'tok',
        refresh_token: 'ref',
        organisation_id: 'OR1',
      })

      mock
        .onGet(`${ API_BASE }/creditors`)
        .replyWithError({ message: 'forbidden', status: 403 })

      const result = await service.executeCallback({
        code: 'c',
        redirectURI: 'https://example.com/cb',
      })

      expect(result.token).toBe('tok')
      expect(result.connectionIdentityName).toBeDefined()
      expect(result.connectionIdentityImageURL).toBeNull()
    })

    it('leaves the identity image null when the creditor has no logo', async () => {
      mock.onPost(`${ CONNECT_BASE }/oauth/access_token`).reply({
        access_token: 'tok',
        organisation_id: 'OR1',
      })

      mock.onGet(`${ API_BASE }/creditors`).reply({
        creditors: [{ name: 'No Logo Ltd' }],
      })

      const result = await service.executeCallback({
        code: 'c',
        redirectURI: 'https://example.com/cb',
      })

      expect(result.connectionIdentityName).toBe('No Logo Ltd')
      expect(result.connectionIdentityImageURL).toBeNull()
    })

    it('ignores a creditors response with no creditors', async () => {
      mock.onPost(`${ CONNECT_BASE }/oauth/access_token`).reply({
        access_token: 'tok',
        organisation_id: 'OR1',
      })

      mock.onGet(`${ API_BASE }/creditors`).reply({ creditors: [] })

      const result = await service.executeCallback({
        code: 'c',
        redirectURI: 'https://example.com/cb',
      })

      expect(result.token).toBe('tok')
    })

    it('refreshToken returns the existing token when the response omits access_token', async () => {
      mock.onPost(`${ CONNECT_BASE }/oauth/access_token`).reply({ scope: 'read_write' })

      const result = await service.refreshToken('old-refresh')

      expect(result).toEqual({
        token: ACCESS_TOKEN,
        refreshToken: 'old-refresh',
        expirationInSeconds: 30 * 24 * 60 * 60,
      })
    })

    it('refreshToken keeps the supplied refresh token when none is returned', async () => {
      mock.onPost(`${ CONNECT_BASE }/oauth/access_token`).reply({
        access_token: 'rotated',
      })

      const result = await service.refreshToken('old-refresh')

      expect(result).toEqual({
        token: 'rotated',
        refreshToken: 'old-refresh',
        expirationInSeconds: 30 * 24 * 60 * 60,
      })
    })

    it('refreshToken falls back to the raw refresh token when no OAuth header is present', async () => {
      const saved = service.request

      service.request = { headers: {} }
      mock.onPost(`${ CONNECT_BASE }/oauth/access_token`).reply({})

      const result = await service.refreshToken('only-refresh')

      expect(result.token).toBe('only-refresh')

      service.request = saved
    })
  })

  // ── Date range presets ──

  describe('date range presets', () => {
    const runPreset = async preset => {
      mock.onGet(`${ API_BASE }/customers`).reply({ customers: [] })
      await service.listCustomers(preset)

      return mock.history[0].query
    }

    it.each([
      'Today',
      'Yesterday',
      'Last 7 Days',
      'Last 30 Days',
      'Last 90 Days',
      'Month to Date',
      'Year to Date',
    ])('translates the "%s" preset into created_at bounds', async preset => {
      const query = await runPreset(preset)

      expect(query['created_at[gte]']).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(query['created_at[lte]']).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      expect(Date.parse(query['created_at[gte]'])).toBeLessThanOrEqual(
        Date.parse(query['created_at[lte]'])
      )
    })

    it('emits no created_at bounds for the Custom Range preset', async () => {
      const query = await runPreset('Custom Range')

      expect(query['created_at[gte]']).toBeUndefined()
      expect(query['created_at[lte]']).toBeUndefined()
    })

    it('emits no created_at bounds for an unknown preset', async () => {
      const query = await runPreset('Since The Dawn Of Time')

      expect(query['created_at[gte]']).toBeUndefined()
    })

    it('lets explicit dates override the preset', async () => {
      mock.onGet(`${ API_BASE }/customers`).reply({ customers: [] })

      await service.listCustomers(
        'Last 30 Days',
        '2026-01-01T00:00:00.000Z',
        '2026-02-01T00:00:00.000Z'
      )

      expect(mock.history[0].query).toMatchObject({
        'created_at[gte]': '2026-01-01T00:00:00.000Z',
        'created_at[lte]': '2026-02-01T00:00:00.000Z',
      })
    })

    it('accepts a lone created-after bound', async () => {
      mock.onGet(`${ API_BASE }/customers`).reply({ customers: [] })

      await service.listCustomers(undefined, '2026-01-01T00:00:00.000Z')

      expect(mock.history[0].query['created_at[gte]']).toBe(
        '2026-01-01T00:00:00.000Z'
      )

      expect(mock.history[0].query['created_at[lte]']).toBeUndefined()
    })
  })

  // ── Page size clamping ──

  describe('page size clamping', () => {
    const limitFor = async limit => {
      mock.onGet(`${ API_BASE }/customers`).reply({ customers: [] })
      await service.listCustomers(undefined, undefined, undefined, limit)

      return mock.history[0].query.limit
    }

    it.each([
      [undefined, 50],
      [null, 50],
      ['not-a-number', 50],
      [0, 50],
      [-5, 50],
      [1, 1],
      [10.7, 10],
      [500, 500],
      [5000, 500],
      ['25', 25],
    ])('clamps limit %p to %p', async (input, expected) => {
      await expect(limitFor(input)).resolves.toBe(expected)
    })
  })

  // ── Polling trigger paging ──

  describe('polling trigger paging', () => {
    it('carries a residual cursor when the page cap is hit', async () => {
      let page = 0

      mock.onGet(`${ API_BASE }/events`).replyWith(() => {
        page++

        return {
          events: [
            {
              id: `EV_P${ page }`,
              created_at: `2026-05-16T10:${ String(page).padStart(2, '0') }:00.000Z`,
              resource_type: 'payments',
              links: { payment: `PM${ page }` },
            },
          ],
          meta: { cursors: { after: `cursor-${ page }` } },
        }
      })

      const result = await service.onPaymentEvent({
        state: { since: '2026-05-16T09:00:00.000Z', seenIds: [] },
      })

      expect(page).toBe(20)
      expect(result.events).toHaveLength(20)
      expect(result.state.pageCursor).toBe('cursor-20')
      expect(result.state.since).toBe('2026-05-16T09:00:00.000Z')
      expect(result.state.windowStart).toBeDefined()
      expect(result.state.pendingMax).toBe('2026-05-16T10:20:00.000Z')
    })

    it('resumes a drain from the carried cursor without moving the watermark start', async () => {
      const seen = []

      mock.onGet(`${ API_BASE }/events`).replyWith(call => {
        seen.push(call.query.after)

        return {
          events: [
            {
              id: 'EV_DRAIN',
              created_at: '2026-05-16T12:00:00.000Z',
              resource_type: 'payments',
              links: { payment: 'PM_D' },
            },
          ],
          meta: { cursors: { after: null } },
        }
      })

      const result = await service.onPaymentEvent({
        state: {
          since: '2026-05-16T09:00:00.000Z',
          windowStart: '2026-05-16T08:00:00.000Z',
          pageCursor: 'cursor-20',
          pendingMax: '2026-05-16T11:00:00.000Z',
          seenIds: [],
        },
      })

      expect(seen[0]).toBe('cursor-20')
      expect(result.state.since).toBe('2026-05-16T12:00:00.000Z')
      expect(result.state.pageCursor).toBeUndefined()
    })

    it('emits events oldest-first regardless of API order', async () => {
      mock.onGet(`${ API_BASE }/events`).reply({
        events: [
          { id: 'EV_B', created_at: '2026-05-16T12:00:00.000Z', resource_type: 'payments', links: { payment: 'PM_B' } },
          { id: 'EV_A', created_at: '2026-05-16T11:00:00.000Z', resource_type: 'payments', links: { payment: 'PM_A' } },
        ],
        meta: { cursors: { after: null } },
      })

      const result = await service.onPaymentEvent({
        state: { since: '2026-05-16T09:00:00.000Z', seenIds: [] },
      })

      expect(result.events.map(e => e.id)).toEqual(['EV_A', 'EV_B'])
    })

    it('tolerates events with no created_at when sorting', async () => {
      mock.onGet(`${ API_BASE }/events`).reply({
        events: [
          { id: 'EV_NO_DATE', resource_type: 'payments', links: { payment: 'PM_X' } },
          { id: 'EV_DATED', created_at: '2026-05-16T11:00:00.000Z', resource_type: 'payments', links: { payment: 'PM_Y' } },
        ],
        meta: { cursors: { after: null } },
      })

      const result = await service.onPaymentEvent({
        state: { since: '2026-05-16T09:00:00.000Z', seenIds: [] },
      })

      expect(result.events).toHaveLength(2)
      expect(result.state.since).toBe('2026-05-16T11:00:00.000Z')
    })

    it('copes with stored state that has no seen-id set', async () => {
      mock.onGet(`${ API_BASE }/events`).reply({
        events: [
          { id: 'EV_NOSEEN', created_at: '2026-05-16T11:00:00.000Z', resource_type: 'payments', links: { payment: 'PM1' } },
        ],
        meta: { cursors: { after: null } },
      })

      const result = await service.onPaymentEvent({
        state: { since: '2026-05-16T09:00:00.000Z' },
      })

      expect(result.events).toHaveLength(1)
      expect(result.state.seenIds).toEqual(['EV_NOSEEN'])
    })

    it('sorts a trailing event that has no created_at', async () => {
      mock.onGet(`${ API_BASE }/events`).reply({
        events: [
          { id: 'EV_DATED', created_at: '2026-05-16T11:00:00.000Z', resource_type: 'payments', links: { payment: 'PM_Y' } },
          { id: 'EV_NO_DATE', resource_type: 'payments', links: { payment: 'PM_X' } },
        ],
        meta: { cursors: { after: null } },
      })

      const result = await service.onPaymentEvent({
        state: { since: '2026-05-16T09:00:00.000Z', seenIds: [] },
      })

      expect(result.events.map(e => e.id)).toEqual(['EV_NO_DATE', 'EV_DATED'])
    })

    it('seeds with a synthetic watermark when the account has no events yet', async () => {
      mock.onGet(`${ API_BASE }/events`).reply({ events: [], meta: { cursors: {} } })

      const result = await service.onPaymentEvent({ state: {} })

      expect(result.events).toEqual([])
      expect(result.state.seenIds).toEqual([])
      expect(Date.parse(result.state.since)).not.toBeNaN()
    })

    it('drops events with no id from the emitted batch', async () => {
      mock.onGet(`${ API_BASE }/events`).reply({
        events: [
          { created_at: '2026-05-16T11:00:00.000Z', resource_type: 'payments', links: { payment: 'PM_Z' } },
        ],
        meta: { cursors: { after: null } },
      })

      const result = await service.onPaymentEvent({
        state: { since: '2026-05-16T09:00:00.000Z', seenIds: [] },
      })

      expect(result.events).toEqual([])
    })

    it('resolves resourceId to null for an unmapped resource type', async () => {
      mock.onGet(`${ API_BASE }/events`).reply({
        events: [
          { id: 'EV_UNKNOWN', created_at: '2026-05-16T11:00:00.000Z', resource_type: 'widgets', links: { widget: 'W1' } },
        ],
        meta: { cursors: { after: null } },
      })

      const result = await service.onPaymentEvent({
        state: { since: '2026-05-16T09:00:00.000Z', seenIds: [] },
      })

      expect(result.events[0].resourceId).toBeNull()
    })

    it('resolves resourceId to null when the event has no links', async () => {
      mock.onGet(`${ API_BASE }/events`).reply({
        events: [
          { id: 'EV_NOLINKS', created_at: '2026-05-16T11:00:00.000Z', resource_type: 'payments' },
        ],
        meta: { cursors: { after: null } },
      })

      const result = await service.onPaymentEvent({
        state: { since: '2026-05-16T09:00:00.000Z', seenIds: [] },
      })

      expect(result.events[0].resourceId).toBeNull()
    })

    it('filters by action when the trigger is configured with one', async () => {
      mock.onGet(`${ API_BASE }/events`).reply({ events: [], meta: { cursors: {} } })

      await service.onPaymentEvent({
        state: {},
        triggerData: { action: 'Confirmed' },
      })

      expect(mock.history[0].query).toMatchObject({ resource_type: 'payments' })
      expect(mock.history[0].query.action).toBeDefined()
    })

    it('routes handleTriggerPollingForEvent to the named trigger', async () => {
      mock.onGet(`${ API_BASE }/events`).reply({
        events: [{ id: 'EV_ROUTE', created_at: '2026-05-16T10:00:00.000Z', resource_type: 'payouts', links: { payout: 'PO1' } }],
        meta: { cursors: { after: null } },
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onPayoutEvent',
        state: null,
      })

      expect(result.state.seenIds).toContain('EV_ROUTE')
    })
  })

  // ── Sample result loaders ──

  describe('sample result loaders', () => {
    const loaders = [
      ['getCustomer_SampleResultLoader', 'CU'],
      ['getMandate_SampleResultLoader', 'MD'],
      ['getPayment_SampleResultLoader', 'PM'],
      ['getSubscription_SampleResultLoader', 'SB'],
      ['getInstalmentSchedule_SampleResultLoader', 'IS'],
      ['getRefund_SampleResultLoader', 'RF'],
      ['getPayout_SampleResultLoader', 'PO'],
      ['getEvent_SampleResultLoader', 'EV'],
      ['createBillingRequestFlow_SampleResultLoader', 'BRF'],
      ['getMandateImport_SampleResultLoader', 'IM'],
      ['getCreditor_SampleResultLoader', 'CR'],
    ]

    it.each(loaders)('%s returns a sample with an id prefixed %s', async (name, prefix) => {
      const sample = await service[name]()

      expect(sample).toBeInstanceOf(Object)
      expect(typeof sample.id).toBe('string')
      expect(sample.id.startsWith(prefix)).toBe(true)
      expect(sample.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(mock.history).toHaveLength(0)
    })

    it('returns money amounts as integer minor units', async () => {
      const payment = await service.getPayment_SampleResultLoader()
      const refund = await service.getRefund_SampleResultLoader()
      const payout = await service.getPayout_SampleResultLoader()

      for (const amount of [payment.amount, refund.amount, payout.amount]) {
        expect(Number.isInteger(amount)).toBe(true)
      }
    })
  })

  // ── apiRequest wrapper branches (driven through the service) ──

  describe('apiRequest wrapper', () => {
    it('omits the Content-Type header when there is no body', async () => {
      mock.onGet(`${ API_BASE }/customers/CU1`).reply({ customers: { id: 'CU1' } })

      await service.getCustomer('CU1')

      expect(mock.history[0].headers['Content-Type']).toBeUndefined()
    })

    it('sets Content-Type when a body is sent', async () => {
      mock.onPost(`${ API_BASE }/customers`).reply({ customers: { id: 'CU1' } })

      await service.createCustomer('a@b.com')

      expect(mock.history[0].headers['Content-Type']).toBe('application/json')
    })

    it('adds an Idempotency-Key on PUT-style updates only when one is computed', async () => {
      mock.onPut(`${ API_BASE }/customers/CU1`).reply({ customers: { id: 'CU1' } })

      await service.updateCustomer('CU1', 'a@b.com')

      // Only POSTs compute a key in this service, so PUTs must go out without one.
      expect(mock.history[0].headers['Idempotency-Key']).toBeUndefined()
    })

    it('sends no query string when every filter is empty', async () => {
      mock.onGet(`${ API_BASE }/events/EV1`).reply({ events: { id: 'EV1' } })

      await service.getEvent('EV1')

      expect(mock.history[0].query).toEqual({})
    })

    it('surfaces an error with no response body using its message', async () => {
      mock
        .onGet(`${ API_BASE }/customers/CU1`)
        .replyWithError({ message: 'socket hang up' })

      await expect(service.getCustomer('CU1')).rejects.toThrow('socket hang up')
    })

    it('tags a 401 as an auth failure', async () => {
      mock
        .onGet(`${ API_BASE }/customers/CU1`)
        .replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.getCustomer('CU1')).rejects.toThrow(
        '[GoCardless][auth-failed][getCustomer]'
      )
    })

    it('tags a 500 as an upstream failure and preserves the original error', async () => {
      mock
        .onGet(`${ API_BASE }/customers/CU1`)
        .replyWithError({ message: 'Server Error', statusCode: 503 })

      await service.getCustomer('CU1').then(
        () => {
          throw new Error('expected rejection')
        },
        error => {
          expect(error.message).toContain('[GoCardless][upstream][getCustomer]')
          expect(error.status).toBe(503)
          expect(error.originalError).toBeDefined()
        }
      )
    })

    it('surfaces the mandate-cancelled hint on a cancelled-mandate payment attempt', async () => {
      mock.onPost(`${ API_BASE }/payments`).replyWithError({
        message: 'Validation failed',
        status: 422,
        body: {
          error: {
            type: 'validation_failed',
            message: 'Validation failed',
            request_id: 'REQ_MC',
            errors: [
              { reason: 'mandate_cancelled', message: 'Mandate is cancelled' },
            ],
          },
        },
      })

      await expect(service.createPayment('MD1', 1000, 'GBP')).rejects.toThrow(
        /\[GoCardless\]\[mandate-cancelled\]\[createPayment\].*request_id=REQ_MC.*reinstateMandate/s
      )
    })
  })

  // ── Constructor / environment configuration ──

  describe('constructor', () => {
    // Re-instantiate the registered class directly so we never touch the shared sandbox.
    const build = environment =>
      new service.constructor({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        environment,
      })

    it('defaults to the live environment when none is configured', () => {
      const instance = build(undefined)

      expect(instance.environment).toBe('live')
      expect(instance.apiBase).toBe(API_BASE)
      expect(instance.connectBase).toBe(CONNECT_BASE)
    })

    it('configures the sandbox environment', () => {
      const instance = build('sandbox')

      expect(instance.environment).toBe('sandbox')
      expect(instance.apiBase).toBe('https://api-sandbox.gocardless.com')
      expect(instance.connectBase).toBe('https://connect-sandbox.gocardless.com')
    })

    it('lower-cases the configured environment', () => {
      expect(build('SANDBOX').environment).toBe('sandbox')
    })

    it('falls back to live for an unrecognised environment', () => {
      const instance = build('staging')

      expect(instance.environment).toBe('live')
      expect(instance.apiBase).toBe(API_BASE)
    })
  })

  // ── Empty-payload and optional-field branches ──

  describe('optional field handling', () => {
    it('sends an empty customers object when no fields are supplied on create', async () => {
      mock.onPost(`${ API_BASE }/customers`).reply({ customers: { id: 'CU1' } })

      await service.createCustomer()

      expect(mock.history[0].body).toEqual({ customers: {} })
    })

    it('sends an empty customers object when no fields are supplied on update', async () => {
      mock.onPut(`${ API_BASE }/customers/CU1`).reply({ customers: { id: 'CU1' } })

      await service.updateCustomer('CU1')

      expect(mock.history[0].body).toEqual({ customers: {} })
    })

    it('sends an empty metadata object when updating a mandate with none', async () => {
      mock.onPut(`${ API_BASE }/mandates/MD1`).reply({ mandates: { id: 'MD1' } })

      await service.updateMandate('MD1')

      expect(mock.history[0].body).toEqual({ mandates: { metadata: {} } })
    })

    it('sends an empty payments object when updating with no fields', async () => {
      mock.onPut(`${ API_BASE }/payments/PM1`).reply({ payments: { id: 'PM1' } })

      await service.updatePayment('PM1')

      expect(mock.history[0].body).toEqual({ payments: {} })
    })

    it('sends an empty subscriptions object when updating with no fields', async () => {
      mock.onPut(`${ API_BASE }/subscriptions/SB1`).reply({ subscriptions: { id: 'SB1' } })

      await service.updateSubscription('SB1')

      expect(mock.history[0].body).toEqual({ subscriptions: {} })
    })

    it('converts a subscription amount to minor units on update', async () => {
      mock.onPut(`${ API_BASE }/subscriptions/SB1`).reply({ subscriptions: { id: 'SB1' } })

      await service.updateSubscription('SB1', 'Plan', undefined, 1500.4)

      expect(mock.history[0].body.subscriptions.amount).toBe(1500)
    })

    it('sends an empty creditors object when updating with no fields', async () => {
      mock.onPut(`${ API_BASE }/creditors/CR1`).reply({ creditors: { id: 'CR1' } })

      await service.updateCreditor('CR1')

      expect(mock.history[0].body).toEqual({ creditors: {} })
    })

    it('omits the creditor link on a mandate import when none is given', async () => {
      mock.onPost(`${ API_BASE }/mandate_imports`).reply({
        mandate_imports: { id: 'IM1' },
      })

      await service.createMandateImport('bacs')

      expect(mock.history[0].body.mandate_imports.links).toBeUndefined()
    })

    it('links the mandate import to a creditor when one is given', async () => {
      mock.onPost(`${ API_BASE }/mandate_imports`).reply({
        mandate_imports: { id: 'IM1' },
      })

      await service.createMandateImport('bacs', 'CR1')

      expect(mock.history[0].body.mandate_imports.links).toEqual({ creditor: 'CR1' })
    })

    it('truncates a charge date to a plain calendar date', async () => {
      mock.onPost(`${ API_BASE }/payments`).reply({ payments: { id: 'PM1' } })

      await service.createPayment(
        'MD1', 1000, 'GBP', undefined, '2026-06-01T12:34:56.000Z'
      )

      expect(mock.history[0].body.payments.charge_date).toBe('2026-06-01')
    })

    it('truncates a retry charge date to a plain calendar date', async () => {
      mock.onPost(`${ API_BASE }/payments/PM1/actions/retry`).reply({
        payments: { id: 'PM1' },
      })

      await service.retryPayment('PM1', '2026-06-01T12:34:56.000Z')

      expect(JSON.stringify(mock.history[0].body)).toContain('2026-06-01')
    })

    it('truncates a subscription start date to a plain calendar date', async () => {
      mock.onPost(`${ API_BASE }/subscriptions`).reply({
        subscriptions: { id: 'SB1' },
      })

      await service.createSubscription(
        'MD1', 1500, 'GBP', undefined, undefined, undefined, undefined,
        '2026-06-15T00:00:00.000Z'
      )

      expect(JSON.stringify(mock.history[0].body)).toContain('2026-06-15')
    })

    it('truncates an instalment schedule start date to a plain calendar date', async () => {
      mock.onPost(`${ API_BASE }/instalment_schedules`).reply({
        instalment_schedules: { id: 'IS1' },
      })

      await service.createInstalmentSchedule(
        'MD1', 'Plan', 'GBP', 3000, [1000, 2000], 1, 'monthly',
        '2026-06-15T00:00:00.000Z'
      )

      expect(JSON.stringify(mock.history[0].body)).toContain('2026-06-15')
    })

    it('filters payments by charge date instead of created_at when charge dates are set', async () => {
      mock.onGet(`${ API_BASE }/payments`).reply({ payments: [] })

      await service.listPayments(
        undefined, undefined, undefined, undefined, 'Last 30 Days',
        '2026-06-01T00:00:00.000Z', '2026-06-30T00:00:00.000Z'
      )

      const query = mock.history[0].query

      expect(query['charge_date[gte]']).toBe('2026-06-01')
      expect(query['charge_date[lte]']).toBe('2026-06-30')
      expect(query['created_at[gte]']).toBeUndefined()
    })

    it('omits the customer link on a billing request when no customer is given', async () => {
      mock.onPost(`${ API_BASE }/billing_requests`).reply({
        billing_requests: { id: 'BRQ1' },
      })

      await service.createBillingRequest()

      expect(mock.history[0].body.billing_requests.links).toBeUndefined()
    })

    it('prefills the bank account IBAN on a billing request flow', async () => {
      mock.onPost(`${ API_BASE }/billing_request_flows`).reply({
        billing_request_flows: { id: 'BRF1' },
      })

      await service.createBillingRequestFlow(
        'BRQ1', undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, 'GB33BUKB20201555555555'
      )

      expect(
        JSON.stringify(mock.history[0].body)
      ).toContain('GB33BUKB20201555555555')
    })

    it('sends no created_at bounds when only a created-before date is given', async () => {
      mock.onGet(`${ API_BASE }/customers`).reply({ customers: [] })

      await service.listCustomers(undefined, undefined, '2026-02-01T00:00:00.000Z')

      expect(mock.history[0].query['created_at[lte]']).toBe(
        '2026-02-01T00:00:00.000Z'
      )

      expect(mock.history[0].query['created_at[gte]']).toBeUndefined()
    })

    it('sends no created_at bounds on an unfiltered payout list', async () => {
      mock.onGet(`${ API_BASE }/payouts`).reply({ payouts: [] })

      await service.listPayouts()

      expect(mock.history[0].query['created_at[gte]']).toBeUndefined()
    })

    it('sends no created_at bounds on an unfiltered event list', async () => {
      mock.onGet(`${ API_BASE }/events`).reply({ events: [] })

      await service.listEvents()

      expect(mock.history[0].query['created_at[gte]']).toBeUndefined()
    })

    it('tolerates a fetchAll page missing its resource key entirely', async () => {
      mock.onGet(`${ API_BASE }/customers`).reply({})

      const result = await service.listCustomers(
        undefined, undefined, undefined, undefined, true
      )

      expect(result.items).toEqual([])
    })

    it('tolerates a fetchAll payments page missing its resource key', async () => {
      mock.onGet(`${ API_BASE }/payments`).reply({})

      const result = await service.listPayments(
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, true
      )

      expect(result.items).toEqual([])
    })

    it('reports a failed connection when no creditor comes back', async () => {
      mock.onGet(`${ API_BASE }/creditors`).reply({ creditors: [] })

      const result = await service.testConnection()

      expect(result).toMatchObject({ ok: false, creditor: null })
      expect(result.environment).toBe('live')
    })

    it('falls back to the configured environment on testConnection', async () => {
      const saved = service.request

      service.request = { headers: { 'oauth-access-token': ACCESS_TOKEN } }
      mock.onGet(`${ API_BASE }/creditors`).reply({ creditors: [] })

      const result = await service.testConnection()

      expect(result.environment).toBe('live')

      service.request = saved
    })

    it('returns no learning-mode event when the account has none', async () => {
      mock.onGet(`${ API_BASE }/events`).reply({ events: [] })

      const result = await service.onPaymentEvent({ learningMode: true })

      expect(result).toEqual({ events: [], state: null })
    })

    it('reports the OAuth error description when the token exchange body carries one', async () => {
      mock.onPost(`${ CONNECT_BASE }/oauth/access_token`).replyWithError({
        message: 'bad',
        body: { error_description: 'the code expired' },
      })

      await expect(
        service.executeCallback({ code: 'c', redirectURI: 'https://x.com' })
      ).rejects.toThrow('the code expired')
    })

    it('reports the raw message when the token exchange body is empty', async () => {
      mock.onPost(`${ CONNECT_BASE }/oauth/access_token`).replyWithError({
        message: 'socket hang up',
      })

      await expect(
        service.executeCallback({ code: 'c', redirectURI: 'https://x.com' })
      ).rejects.toThrow('socket hang up')
    })

    it('nulls the organisation id when the token response omits it', async () => {
      mock.onPost(`${ CONNECT_BASE }/oauth/access_token`).reply({
        access_token: 'tok',
      })

      mock.onGet(`${ API_BASE }/creditors`).reply({ creditors: [] })

      const result = await service.executeCallback({
        code: 'c',
        redirectURI: 'https://x.com',
      })

      expect(result.userData.organisationId).toBeNull()
      expect(result.connectionIdentityName).toBe('GoCardless Org')
    })
  })

  // ── Dictionary fallbacks ──

  describe('dictionary fallbacks', () => {
    // [method, endpoint, response key]
    const dicts = [
      ['listCustomersDict', '/customers', 'customers'],
      ['listMandatesDict', '/mandates', 'mandates'],
      ['listCreditorsDict', '/creditors', 'creditors'],
      ['listSubscriptionsDict', '/subscriptions', 'subscriptions'],
      ['listPaymentsDict', '/payments', 'payments'],
      ['listPayoutsDict', '/payouts', 'payouts'],
      ['listRefundsDict', '/refunds', 'refunds'],
      ['listBillingRequestsDict', '/billing_requests', 'billing_requests'],
      ['listBillingRequestTemplatesDict', '/billing_request_templates', 'billing_request_templates'],
      ['listInstitutionsDict', '/institutions', 'institutions'],
      ['listCustomerBankAccountsDict', '/customer_bank_accounts', 'customer_bank_accounts'],
      ['listInstalmentSchedulesDict', '/instalment_schedules', 'instalment_schedules'],
    ]

    it.each(dicts)('%s returns an empty list for an empty response', async (method, endpoint) => {
      mock.onGet(`${ API_BASE }${ endpoint }`).reply({})

      await expect(service[method]()).resolves.toEqual({ items: [], cursor: null })
    })

    it.each(dicts)('%s handles a null payload', async (method, endpoint, key) => {
      mock.onGet(`${ API_BASE }${ endpoint }`).reply({ [key]: [] })

      await expect(service[method](null)).resolves.toEqual({ items: [], cursor: null })
    })

    it.each(dicts)('%s falls back to the id as label when no name field is set', async (method, endpoint, key) => {
      mock.onGet(`${ API_BASE }${ endpoint }`).reply({
        [key]: [{ id: 'ID1' }],
        meta: { cursors: { after: 'NEXT' } },
      })

      const result = await service[method]({})

      expect(result.cursor).toBe('NEXT')
      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ID1')
      expect(typeof result.items[0].label).toBe('string')
      expect(result.items[0].label.length).toBeGreaterThan(0)
    })

    it.each(dicts)('%s filters everything out for a non-matching search', async (method, endpoint, key) => {
      mock.onGet(`${ API_BASE }${ endpoint }`).reply({
        [key]: [{ id: 'ID1', name: 'Alpha', reference: 'Alpha' }],
      })

      const result = await service[method]({ search: 'zzzz-no-match' })

      expect(result.items).toEqual([])
    })

    it.each(dicts)('%s forwards the pagination cursor as ?after', async (method, endpoint, key) => {
      mock.onGet(`${ API_BASE }${ endpoint }`).reply({ [key]: [] })

      await service[method]({ cursor: 'CUR1' })

      expect(mock.history[0].query.after).toBe('CUR1')
    })

    it('builds a customer label from the company name when present', async () => {
      mock.onGet(`${ API_BASE }/customers`).reply({
        customers: [{ id: 'CU1', company_name: 'Acme Ltd', given_name: 'Jane' }],
      })

      const result = await service.listCustomersDict({})

      expect(result.items[0].label).toBe('Acme Ltd')
    })

    it('falls back to the customer email when there is no name', async () => {
      mock.onGet(`${ API_BASE }/customers`).reply({
        customers: [{ id: 'CU1', email: 'only@example.com' }],
      })

      const result = await service.listCustomersDict({})

      expect(result.items[0].label).toBe('only@example.com')
    })

    it('labels an unreferenced mandate with its scheme and id', async () => {
      mock.onGet(`${ API_BASE }/mandates`).reply({
        mandates: [{ id: 'MD1', scheme: 'sepa_core' }],
      })

      const result = await service.listMandatesDict({})

      expect(result.items[0].label).toBe('sepa_core - MD1')
    })

    it('matches dictionary search case-insensitively across fields', async () => {
      mock.onGet(`${ API_BASE }/creditors`).reply({
        creditors: [
          { id: 'CR1', name: 'Acme Ltd' },
          { id: 'CR2', name: 'Other' },
        ],
      })

      const result = await service.listCreditorsDict({ search: 'ACME' })

      expect(result.items.map(i => i.value)).toEqual(['CR1'])
    })

    it('matches on the id field when the name does not match', async () => {
      mock.onGet(`${ API_BASE }/creditors`).reply({
        creditors: [{ id: 'CR_MATCH', name: 'Nope' }],
      })

      const result = await service.listCreditorsDict({ search: 'cr_match' })

      expect(result.items).toHaveLength(1)
    })

    it('skips null-valued fields while searching', async () => {
      mock.onGet(`${ API_BASE }/creditors`).reply({
        creditors: [{ id: 'CR1', name: null }],
      })

      const result = await service.listCreditorsDict({ search: 'anything' })

      expect(result.items).toEqual([])
    })

    it('passes bank-account dictionary criteria through as a customer filter', async () => {
      mock.onGet(`${ API_BASE }/customer_bank_accounts`).reply({
        customer_bank_accounts: [],
      })

      await service.listCustomerBankAccountsDict({ criteria: { customer: 'CU9' } })

      expect(mock.history[0].query.customer).toBe('CU9')
    })
  })

  // ── apiRequest called directly (branches the service never reaches) ──

  describe('helpers/http apiRequest (direct)', () => {
    // Requires the sandbox global, so it lives inside the sandboxed suite.
    const { apiRequest } = require('../src/helpers/http')

    it('defaults to GET when no method is given', async () => {
      mock.onGet('https://api.example.com/thing').reply({ ok: true })

      const result = await apiRequest({
        url: 'https://api.example.com/thing',
        logTag: 'direct',
        accessToken: 'tok',
      })

      expect(result).toEqual({ ok: true })
      expect(mock.history[0].method).toBe('get')
    })

    it('attaches an Idempotency-Key on PUT', async () => {
      mock.onPut('https://api.example.com/thing').reply({ ok: true })

      await apiRequest({
        url: 'https://api.example.com/thing',
        method: 'PUT',
        body: { a: 1 },
        logTag: 'direct',
        accessToken: 'tok',
        idempotencyKey: 'key-1',
      })

      expect(mock.history[0].headers['Idempotency-Key']).toBe('key-1')
    })

    it('ignores an Idempotency-Key on DELETE', async () => {
      mock.onDelete('https://api.example.com/thing').reply({ ok: true })

      await apiRequest({
        url: 'https://api.example.com/thing',
        method: 'delete',
        logTag: 'direct',
        accessToken: 'tok',
        idempotencyKey: 'key-1',
      })

      expect(mock.history[0].headers['Idempotency-Key']).toBeUndefined()
    })

    it('lets caller headers override the pinned defaults', async () => {
      mock.onGet('https://api.example.com/thing').reply({ ok: true })

      await apiRequest({
        url: 'https://api.example.com/thing',
        logTag: 'direct',
        accessToken: 'tok',
        headers: { Accept: 'application/pdf', 'X-Extra': '1' },
      })

      expect(mock.history[0].headers).toMatchObject({
        Accept: 'application/pdf',
        'X-Extra': '1',
        'GoCardless-Version': '2015-07-06',
      })
    })

    it('drops empty query keys and omits the query call entirely when nothing remains', async () => {
      mock.onGet('https://api.example.com/thing').reply({ ok: true })

      await apiRequest({
        url: 'https://api.example.com/thing',
        logTag: 'direct',
        accessToken: 'tok',
        query: { a: null, b: '', c: undefined },
      })

      expect(mock.history[0].query).toEqual({})
    })

    it('sends a body of null without a Content-Type', async () => {
      mock.onPost('https://api.example.com/thing').reply({ ok: true })

      await apiRequest({
        url: 'https://api.example.com/thing',
        method: 'post',
        body: null,
        logTag: 'direct',
        accessToken: 'tok',
      })

      expect(mock.history[0].headers['Content-Type']).toBeUndefined()
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  // ── Fetch-all pagination through the service ──

  describe('fetchAll pagination', () => {
    it('walks every page and merges the results', async () => {
      let page = 0

      mock.onGet(`${ API_BASE }/customers`).replyWith(() => {
        page++

        return {
          customers: [{ id: `CU${ page }` }],
          meta: { cursors: { after: page < 3 ? `c${ page }` : null } },
        }
      })

      const result = await service.listCustomers(
        undefined, undefined, undefined, undefined, true
      )

      expect(result.items.map(c => c.id)).toEqual(['CU1', 'CU2', 'CU3'])
      expect(result.pageCount).toBe(3)
      expect(mock.history).toHaveLength(3)
      expect(mock.history[1].query.after).toBe('c1')
    })

    it('stops on the first empty page', async () => {
      mock.onGet(`${ API_BASE }/customers`).reply({ customers: [], meta: {} })

      const result = await service.listCustomers(
        undefined, undefined, undefined, undefined, true
      )

      expect(result.items).toEqual([])
      expect(result.pageCount).toBe(1)
    })
  })
})

// ── Helper modules tested directly ──

describe('helpers/utils', () => {
  const utils = require('../src/helpers/utils')

  describe('cleanupObject', () => {
    it.each([
      [undefined],
      [null],
      ['a string'],
      [42],
    ])('passes non-objects (%p) straight through', input => {
      expect(utils.cleanupObject(input)).toBe(input)
    })

    it('drops undefined, null and empty-string entries', () => {
      expect(
        utils.cleanupObject({ a: 1, b: undefined, c: null, d: '', e: false, f: 0 })
      ).toEqual({ a: 1, e: false, f: 0 })
    })

    it('returns undefined when nothing survives', () => {
      expect(utils.cleanupObject({ a: undefined, b: '' })).toBeUndefined()
      expect(utils.cleanupObject({})).toBeUndefined()
    })
  })

  describe('toArray', () => {
    it.each([
      [undefined, []],
      [null, []],
      ['', []],
      ['a,b , c', ['a', 'b', 'c']],
      ['single', ['single']],
      [['a', null, '', 'b'], ['a', 'b']],
      [123, ['123']],
    ])('normalises %p to %p', (input, expected) => {
      expect(utils.toArray(input)).toEqual(expected)
    })
  })

  describe('toCommaList', () => {
    it.each([
      [undefined, undefined],
      [[], undefined],
      [['a', 'b'], 'a,b'],
      ['x , y', 'x,y'],
    ])('joins %p to %p', (input, expected) => {
      expect(utils.toCommaList(input)).toBe(expected)
    })
  })

  describe('resolveChoice / resolveChoices', () => {
    const mapping = { Today: 'today', Yesterday: 'yesterday' }

    it('maps a known label to its wire value', () => {
      expect(utils.resolveChoice('Today', mapping)).toBe('today')
    })

    it('passes an unknown value through untouched', () => {
      expect(utils.resolveChoice('today', mapping)).toBe('today')
      expect(utils.resolveChoice('whatever', mapping)).toBe('whatever')
    })

    it.each([[undefined], [null]])('returns undefined for %p', input => {
      expect(utils.resolveChoice(input, mapping)).toBeUndefined()
    })

    it('does not resolve inherited Object.prototype keys', () => {
      expect(utils.resolveChoice('toString', mapping)).toBe('toString')
    })

    it('maps every entry of a multi-select', () => {
      expect(utils.resolveChoices('Today,Yesterday', mapping)).toEqual([
        'today',
        'yesterday',
      ])
    })

    it('returns undefined for an empty multi-select', () => {
      expect(utils.resolveChoices('', mapping)).toBeUndefined()
      expect(utils.resolveChoices(null, mapping)).toBeUndefined()
    })
  })

  describe('buildIdempotencyKey', () => {
    it('prefers an explicit override, truncated to 128 chars', () => {
      expect(utils.buildIdempotencyKey('m', {}, 'my-key')).toBe('my-key')
      expect(utils.buildIdempotencyKey('m', {}, 'x'.repeat(200))).toHaveLength(128)
    })

    it('coerces a non-string override', () => {
      expect(utils.buildIdempotencyKey('m', {}, 12345)).toBe('12345')
    })

    it('generates a fresh key each call when unique is set', () => {
      const a = utils.buildIdempotencyKey('m', { x: 1 }, undefined, true)
      const b = utils.buildIdempotencyKey('m', { x: 1 }, undefined, true)

      expect(a).not.toBe(b)
    })

    it('derives a stable 64-char hash otherwise', () => {
      const a = utils.buildIdempotencyKey('createCustomer', { x: 1 })
      const b = utils.buildIdempotencyKey('createCustomer', { x: 1 })

      expect(a).toBe(b)
      expect(a).toHaveLength(64)
      expect(utils.buildIdempotencyKey('createMandate', { x: 1 })).not.toBe(a)
      expect(utils.buildIdempotencyKey('createCustomer', { x: 2 })).not.toBe(a)
    })
  })

  describe('resolvePeriod', () => {
    const now = new Date('2026-05-16T13:45:30.500Z')

    it.each([[undefined], [null], ['custom'], ['Custom Range'], ['nonsense']])(
      'returns null for %p',
      preset => {
        expect(utils.resolvePeriod(preset, now)).toBeNull()
      }
    )

    it('resolves today to midnight UTC through now', () => {
      expect(utils.resolvePeriod('today', now)).toEqual({
        gte: '2026-05-16T00:00:00.000Z',
        lte: '2026-05-16T13:45:30.500Z',
      })
    })

    it('resolves yesterday to a full previous UTC day', () => {
      expect(utils.resolvePeriod('Yesterday', now)).toEqual({
        gte: '2026-05-15T00:00:00.000Z',
        lte: '2026-05-15T23:59:59.999Z',
      })
    })

    it('resolves monthToDate to the first of the month', () => {
      expect(utils.resolvePeriod('monthToDate', now).gte).toBe(
        '2026-05-01T00:00:00.000Z'
      )
    })

    it('resolves yearToDate to Jan 1', () => {
      expect(utils.resolvePeriod('Year to Date', now).gte).toBe(
        '2026-01-01T00:00:00.000Z'
      )
    })

    it.each([
      ['last7Days', '2026-05-09T13:45:30.500Z'],
      ['last30Days', '2026-04-16T13:45:30.500Z'],
      ['last90Days', '2026-02-15T13:45:30.500Z'],
    ])('resolves %s to a rolling window', (preset, gte) => {
      expect(utils.resolvePeriod(preset, now).gte).toBe(gte)
    })

    it('defaults to the current time when no clock is supplied', () => {
      expect(Date.parse(utils.resolvePeriod('today').lte)).not.toBeNaN()
    })
  })

  describe('buildCreatedAtFilter', () => {
    it('returns undefined when nothing is set', () => {
      expect(utils.buildCreatedAtFilter({})).toBeUndefined()
    })

    it('lets explicit bounds win over the preset', () => {
      expect(
        utils.buildCreatedAtFilter({
          period: 'today',
          createdAfter: '2020-01-01T00:00:00.000Z',
        }).gte
      ).toBe('2020-01-01T00:00:00.000Z')
    })

    it('keeps a lone upper bound', () => {
      expect(
        utils.buildCreatedAtFilter({ createdBefore: '2020-01-01T00:00:00.000Z' })
      ).toEqual({ lte: '2020-01-01T00:00:00.000Z' })
    })
  })

  describe('toIsoDateTime', () => {
    it.each([[undefined], [null], ['']])('returns undefined for %p', input => {
      expect(utils.toIsoDateTime(input)).toBeUndefined()
    })

    it('serialises a Date', () => {
      expect(utils.toIsoDateTime(new Date('2026-05-16T10:00:00.000Z'))).toBe(
        '2026-05-16T10:00:00.000Z'
      )
    })

    it('treats a number as epoch millis', () => {
      expect(utils.toIsoDateTime(0)).toBeUndefined()
      expect(utils.toIsoDateTime(1000)).toBe('1970-01-01T00:00:01.000Z')
    })

    it('passes strings through', () => {
      expect(utils.toIsoDateTime('2026-05-16')).toBe('2026-05-16')
    })
  })

  describe('toDictItem', () => {
    it('falls back to the value when no label is given', () => {
      expect(utils.toDictItem('', 'CU1')).toEqual({
        label: 'CU1',
        value: 'CU1',
        note: undefined,
      })
    })

    it('keeps label and note when supplied', () => {
      expect(utils.toDictItem('Jane', 'CU1', 'active')).toEqual({
        label: 'Jane',
        value: 'CU1',
        note: 'active',
      })
    })

    it('normalises an empty note to undefined', () => {
      expect(utils.toDictItem('Jane', 'CU1', '').note).toBeUndefined()
    })
  })

  describe('toMinorUnits', () => {
    it.each([[undefined], [null], ['']])('returns undefined for %p', input => {
      expect(utils.toMinorUnits(input)).toBeUndefined()
    })

    it.each([
      [1000, 1000],
      ['1000', 1000],
      [10.4, 10],
      [10.5, 11],
      [-10.5, -10],
      [0, 0],
    ])('coerces %p to %p', (input, expected) => {
      expect(utils.toMinorUnits(input)).toBe(expected)
    })

    it.each([['abc'], [NaN], [Infinity], [{}]])(
      'throws for the non-numeric amount %p',
      input => {
        expect(() => utils.toMinorUnits(input)).toThrow('Invalid amount')
      }
    )
  })
})

describe('helpers/errors', () => {
  const errors = require('../src/helpers/errors')

  const gcError = (overrides = {}) => ({
    status: 422,
    message: 'Validation failed',
    body: {
      error: {
        type: 'validation_failed',
        code: 422,
        message: 'Validation failed',
        request_id: 'REQ1',
        documentation_url: 'https://developer.gocardless.com/errors',
        errors: [
          {
            reason: 'mandate_cancelled',
            field: 'links.mandate',
            message: 'Mandate is cancelled',
            links: { conflicting_resource_id: 'MD_OLD' },
          },
        ],
        ...overrides,
      },
    },
  })

  describe('extractGoCardlessError', () => {
    it.each([[undefined], [null], [{}], [{ body: null }]])(
      'returns null for %p',
      input => {
        expect(errors.extractGoCardlessError(input)).toBeNull()
      }
    )

    it('reads the body off error.response.body as well', () => {
      const extracted = errors.extractGoCardlessError({
        response: { body: { error: { type: 'invalid_state', message: 'nope' } } },
      })

      expect(extracted).toMatchObject({ type: 'invalid_state', message: 'nope' })
    })

    it('treats a bare body as the envelope when there is no error wrapper', () => {
      expect(
        errors.extractGoCardlessError({ body: { message: 'flat' } })
      ).toMatchObject({ message: 'flat' })
    })

    // apiRequest rethrows a friendly Error and moves the transport error to `originalError`.
    // Everything downstream of apiRequest only ever sees this shape, so the extractor must
    // unwrap it — missing this made the whole idempotent-replay branch dead code.
    it('reads the body off a friendly error wrapped by apiRequest', () => {
      const wrapped = Object.assign(new Error('friendly'), {
        status: 422,
        originalError: gcError(),
      })

      expect(errors.extractGoCardlessError(wrapped)).toMatchObject({
        type: 'validation_failed',
        reason: 'mandate_cancelled',
        conflictingResourceId: 'MD_OLD',
      })
    })

    it('reads the body off a wrapped superagent-style nested response', () => {
      const wrapped = Object.assign(new Error('friendly'), {
        originalError: { response: { body: { error: { type: 'invalid_state', message: 'nested' } } } },
      })

      expect(errors.extractGoCardlessError(wrapped)).toMatchObject({ type: 'invalid_state', message: 'nested' })
    })

    it('flattens the first sub-error', () => {
      expect(errors.extractGoCardlessError(gcError())).toMatchObject({
        type: 'validation_failed',
        code: 422,
        requestId: 'REQ1',
        documentationUrl: 'https://developer.gocardless.com/errors',
        reason: 'mandate_cancelled',
        field: 'links.mandate',
        fieldMessage: 'Mandate is cancelled',
        conflictingResourceId: 'MD_OLD',
      })
    })

    it('copes with a missing or non-array errors list', () => {
      const extracted = errors.extractGoCardlessError({
        body: { error: { type: 'gocardless', errors: 'not-an-array' } },
      })

      expect(extracted.errors).toEqual([])
      expect(extracted.reason).toBeUndefined()
    })
  })

  describe('buildFriendlyMessage', () => {
    it('prefers the reason prefix and appends the hint', () => {
      const message = errors.buildFriendlyMessage(gcError(), 'createPayment')

      expect(message).toContain('[GoCardless][mandate-cancelled][createPayment]')
      expect(message).toContain('Mandate is cancelled')
      expect(message).toContain('field=links.mandate')
      expect(message).toContain('request_id=REQ1')
      expect(message).toContain('conflict=MD_OLD')
      expect(message).toContain('reinstateMandate')
    })

    it.each([
      ['validation_failed', '[GoCardless][validation-failed]'],
      ['invalid_api_usage', '[GoCardless][invalid-request]'],
      ['invalid_state', '[GoCardless][invalid-state]'],
      ['gocardless', '[GoCardless][upstream]'],
    ])('maps the %s type to %s', (type, prefix) => {
      const message = errors.buildFriendlyMessage(
        { body: { error: { type, message: 'boom', errors: [] } } },
        'tag'
      )

      expect(message.startsWith(`${ prefix }[tag]`)).toBe(true)
    })

    it.each([
      [401, '[GoCardless][auth-failed]'],
      [403, '[GoCardless][forbidden]'],
      [404, '[GoCardless][not-found]'],
      [409, '[GoCardless][conflict]'],
      [422, '[GoCardless][validation-failed]'],
      [429, '[GoCardless][rate-limited]'],
      [500, '[GoCardless][upstream]'],
      [502, '[GoCardless][upstream]'],
    ])('maps HTTP %p to %s when there is no typed body', (status, prefix) => {
      const message = errors.buildFriendlyMessage({ status, message: 'oops' }, 'tag')

      expect(message).toBe(`${ prefix }[tag] oops`)
    })

    it('reads the status off statusCode and response.status too', () => {
      expect(
        errors.buildFriendlyMessage({ statusCode: 404, message: 'a' }, 't')
      ).toContain('[not-found]')

      expect(
        errors.buildFriendlyMessage({ response: { status: 429 }, message: 'a' }, 't')
      ).toContain('[rate-limited]')
    })

    it('falls back to the plain prefix for an unmapped status', () => {
      expect(errors.buildFriendlyMessage({ status: 418, message: 'teapot' }, 't')).toBe(
        '[GoCardless][t] teapot'
      )
    })

    it('falls back to "Unknown error" when nothing carries a message', () => {
      expect(errors.buildFriendlyMessage({}, 't')).toBe('[GoCardless][t] Unknown error')

      expect(errors.buildFriendlyMessage(null, 't')).toBe(
        '[GoCardless][t] Unknown error'
      )
    })

    it('uses the envelope message when the sub-error has none', () => {
      const message = errors.buildFriendlyMessage(
        {
          body: {
            error: {
              type: 'invalid_state',
              message: 'envelope level',
              errors: [{ reason: 'payment_cancelled' }],
            },
          },
        },
        't'
      )

      expect(message).toContain('envelope level')
      expect(message).toContain('[payment-cancelled]')
    })

    it('omits the hint for a reason that has a prefix but no hint text', () => {
      const message = errors.buildFriendlyMessage(
        {
          body: {
            error: {
              type: 'invalid_state',
              message: 'blocked',
              errors: [{ reason: 'mandate_blocked' }],
            },
          },
        },
        't'
      )

      expect(message).toBe('[GoCardless][mandate-blocked][t] blocked')
    })

    it('falls back to the type prefix for an unknown reason', () => {
      const message = errors.buildFriendlyMessage(
        {
          body: {
            error: {
              type: 'validation_failed',
              message: 'nope',
              errors: [{ reason: 'brand_new_reason' }],
            },
          },
        },
        't'
      )

      expect(message.startsWith('[GoCardless][validation-failed][t]')).toBe(true)
    })

    it.each([
      'bank_account_disabled',
      'customer_bank_account_disabled',
      'mandate_failed',
      'mandate_expired',
      'payment_already_charged_back',
      'retry_outside_window',
      'cannot_change_currency',
      'scheme_not_supported_for_currency',
      'bank_account_exists',
      'customer_already_removed',
      'idempotent_creation_conflict',
    ])('has a dedicated prefix for the %s reason', reason => {
      const message = errors.buildFriendlyMessage(
        { body: { error: { message: 'm', errors: [{ reason }] } } },
        't'
      )

      // A dedicated reason prefix means the tag is NOT the first bracket group.
      expect(message.startsWith('[GoCardless][')).toBe(true)
      expect(message.startsWith('[GoCardless][t]')).toBe(false)
    })
  })

  describe('isIdempotentReplay / getConflictingResourceId', () => {
    const replay = id => ({
      body: {
        error: {
          type: 'invalid_state',
          errors: [
            {
              reason: 'idempotent_creation_conflict',
              links: { conflicting_resource_id: id },
            },
          ],
        },
      },
    })

    it('detects a replay carrying a conflicting resource id', () => {
      expect(errors.isIdempotentReplay(replay('CU1'))).toBe(true)
      expect(errors.getConflictingResourceId(replay('CU1'))).toBe('CU1')
    })

    it('rejects a replay with no conflicting resource id', () => {
      expect(
        errors.isIdempotentReplay({
          body: { error: { errors: [{ reason: 'idempotent_creation_conflict' }] } },
        })
      ).toBe(false)
    })

    it('rejects an unrelated error', () => {
      expect(errors.isIdempotentReplay({ body: { error: { type: 'gocardless' } } })).toBe(
        false
      )

      expect(errors.isIdempotentReplay(null)).toBe(false)
      expect(errors.getConflictingResourceId(null)).toBeNull()
    })
  })
})

describe('helpers/fetchAllPages', () => {
  const { fetchAllPages } = require('../src/helpers/http')

  it('returns an empty result when the first page is empty', async () => {
    const result = await fetchAllPages(async () => ({ items: [], cursors: {} }))

    expect(result).toEqual({ items: [], pageCount: 1, truncated: false })
  })

  it('tolerates a page callback returning nothing', async () => {
    const result = await fetchAllPages(async () => undefined)

    expect(result).toEqual({ items: [], pageCount: 1, truncated: false })
  })

  it('feeds the cursor of each page into the next call', async () => {
    const seen = []
    const pages = [
      { items: [1], cursors: { after: 'a' } },
      { items: [2], cursors: { after: 'b' } },
      { items: [3], cursors: { after: null } },
    ]
    let i = 0

    const result = await fetchAllPages(async after => {
      seen.push(after)

      return pages[i++]
    })

    expect(seen).toEqual([null, 'a', 'b'])
    expect(result).toEqual({ items: [1, 2, 3], pageCount: 3, truncated: false })
  })

  it('stops at maxPages and reports truncation', async () => {
    let calls = 0

    const result = await fetchAllPages(
      async () => {
        calls++

        return { items: [calls], cursors: { after: `c${ calls }` } }
      },
      { maxPages: 2 }
    )

    expect(calls).toBe(2)
    expect(result).toEqual({ items: [1, 2], pageCount: 2, truncated: true })
  })

  it('does not call the fetcher at all when maxPages is zero', async () => {
    const fetcher = jest.fn()
    const result = await fetchAllPages(fetcher, { maxPages: 0 })

    expect(fetcher).not.toHaveBeenCalled()
    expect(result).toEqual({ items: [], pageCount: 0, truncated: false })
  })
})

describe('helpers/logger', () => {
  const { logger } = require('../src/helpers/logger')

  it.each([
    ['info', 'log'],
    ['debug', 'log'],
    ['warn', 'warn'],
    ['error', 'error'],
  ])('%s writes through console.%s with the service prefix', (level, consoleFn) => {
    const spy = jest.spyOn(console, consoleFn).mockImplementation(() => {})

    logger[level]('hello', 42)

    expect(spy).toHaveBeenCalledWith(
      `[GoCardless Service] ${ level }:`,
      'hello',
      42
    )

    spy.mockRestore()
  })
})
