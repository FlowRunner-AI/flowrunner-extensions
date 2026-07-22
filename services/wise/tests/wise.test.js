'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-api-token'
const SANDBOX_BASE = 'https://api.sandbox.transferwise.tech'
const LIVE_BASE = 'https://api.wise.com'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('Wise Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiToken: API_TOKEN, environment: 'Sandbox' })
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

      expect(configItems.map(item => item.name)).toEqual(['apiToken', 'environment'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiToken', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({
            name: 'environment',
            required: true,
            shared: false,
            type: 'CHOICE',
            defaultValue: 'Sandbox',
            options: ['Sandbox', 'Live'],
          }),
        ])
      )
    })

    it('uses the sandbox base URL by default', () => {
      expect(service.baseUrl).toBe(SANDBOX_BASE)
      expect(service.environment).toBe('Sandbox')
    })
  })

  // ── Profiles ──

  describe('listProfiles', () => {
    it('requests the profiles endpoint with bearer auth', async () => {
      const profiles = [{ id: 12345, type: 'personal' }]

      mock.onGet(`${ SANDBOX_BASE }/v1/profiles`).reply(profiles)

      const result = await service.listProfiles()

      expect(result).toEqual(profiles)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_TOKEN }`,
        'Content-Type': 'application/json',
      })

      expect(mock.history[0].body).toBeUndefined()
    })

    it('surfaces the Wise error message from an errors array', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/profiles`).replyWithError({
        message: 'Request failed',
        body: { errors: [{ message: 'Token is invalid' }] },
      })

      await expect(service.listProfiles()).rejects.toThrow('Wise API error: Token is invalid')
    })

    it('falls back to the body message', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/profiles`).replyWithError({
        message: 'Request failed',
        body: { message: 'Forbidden' },
      })

      await expect(service.listProfiles()).rejects.toThrow('Wise API error: Forbidden')
    })

    it('falls back to the body error field', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/profiles`).replyWithError({
        message: 'Request failed',
        body: { error: 'invalid_grant' },
      })

      await expect(service.listProfiles()).rejects.toThrow('Wise API error: invalid_grant')
    })

    it('falls back to the transport error message when no body is present', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/profiles`).replyWithError({ message: 'Network timeout' })

      await expect(service.listProfiles()).rejects.toThrow('Wise API error: Network timeout')
    })
  })

  describe('getProfile', () => {
    it('requests a single profile by id', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/profiles/12345`).reply({ id: 12345, type: 'personal' })

      const result = await service.getProfile(12345)

      expect(result).toEqual({ id: 12345, type: 'personal' })
      expect(mock.history[0].url).toBe(`${ SANDBOX_BASE }/v1/profiles/12345`)
    })
  })

  // ── Quotes ──

  describe('createQuote', () => {
    it('creates a quote from a source amount and maps the pay out label', async () => {
      const quote = { id: 'quote-uuid', rate: 1.16 }

      mock.onPost(`${ SANDBOX_BASE }/v3/profiles/12345/quotes`).reply(quote)

      const result = await service.createQuote(12345, 'GBP', 'EUR', 100, undefined, 'Bank Transfer')

      expect(result).toEqual(quote)
      expect(mock.history[0].method).toBe('post')

      expect(mock.history[0].body).toEqual({
        sourceCurrency: 'GBP',
        targetCurrency: 'EUR',
        sourceAmount: 100,
        payOut: 'BANK_TRANSFER',
      })
    })

    it('creates a quote from a target amount without a pay out method', async () => {
      mock.onPost(`${ SANDBOX_BASE }/v3/profiles/12345/quotes`).reply({ id: 'quote-uuid' })

      await service.createQuote(12345, 'GBP', 'EUR', undefined, 250)

      expect(mock.history[0].body).toEqual({
        sourceCurrency: 'GBP',
        targetCurrency: 'EUR',
        targetAmount: 250,
      })
    })

    it('passes an unmapped pay out value straight through', async () => {
      mock.onPost(`${ SANDBOX_BASE }/v3/profiles/12345/quotes`).reply({ id: 'quote-uuid' })

      await service.createQuote(12345, 'GBP', 'EUR', 100, undefined, 'SWIFT')

      expect(mock.history[0].body.payOut).toBe('SWIFT')
    })

    it('maps every pay out option', async () => {
      mock.onPost(`${ SANDBOX_BASE }/v3/profiles/12345/quotes`).reply({ id: 'quote-uuid' })

      await service.createQuote(12345, 'GBP', 'EUR', 100, undefined, 'Balance')
      await service.createQuote(12345, 'GBP', 'EUR', 100, undefined, 'Swift')
      await service.createQuote(12345, 'GBP', 'CAD', 100, undefined, 'Interac')

      expect(mock.history.map(call => call.body.payOut)).toEqual(['BALANCE', 'SWIFT', 'INTERAC'])
    })

    it('wraps quote failures', async () => {
      mock.onPost(`${ SANDBOX_BASE }/v3/profiles/12345/quotes`).replyWithError({
        body: { errors: [{ message: 'sourceAmount is required' }] },
      })

      await expect(service.createQuote(12345, 'GBP', 'EUR')).rejects.toThrow(
        'Wise API error: sourceAmount is required'
      )
    })
  })

  describe('getQuote', () => {
    it('requests a quote by id', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v3/profiles/12345/quotes/quote-uuid`).reply({ id: 'quote-uuid' })

      const result = await service.getQuote(12345, 'quote-uuid')

      expect(result).toEqual({ id: 'quote-uuid' })
      expect(mock.history[0].url).toBe(`${ SANDBOX_BASE }/v3/profiles/12345/quotes/quote-uuid`)
    })
  })

  // ── Recipients ──

  describe('createRecipientAccount', () => {
    it('creates an IBAN recipient with mapped account type', async () => {
      mock.onPost(`${ SANDBOX_BASE }/v1/accounts`).reply({ id: 40000000 })

      const result = await service.createRecipientAccount(12345, 'EUR', 'IBAN', 'Jane Doe', {
        iban: 'DE89370400440532013000',
        legalType: 'PRIVATE',
      })

      expect(result).toEqual({ id: 40000000 })

      expect(mock.history[0].body).toEqual({
        profile: 12345,
        currency: 'EUR',
        type: 'iban',
        accountHolderName: 'Jane Doe',
        details: { iban: 'DE89370400440532013000', legalType: 'PRIVATE' },
      })
    })

    it('maps each account type label', async () => {
      mock.onPost(`${ SANDBOX_BASE }/v1/accounts`).reply({ id: 1 })

      const labels = ['Email', 'Sort Code', 'ABA (US)', 'Aba', 'Canadian', 'Australian', 'Interac']

      for (const label of labels) {
        await service.createRecipientAccount(1, 'USD', label, 'Jane', { email: 'a@b.com' })
      }

      expect(mock.history.map(call => call.body.type)).toEqual([
        'email',
        'sort_code',
        'aba',
        'aba',
        'canadian',
        'australian',
        'interac',
      ])
    })

    it('omits details when not provided', async () => {
      mock.onPost(`${ SANDBOX_BASE }/v1/accounts`).reply({ id: 1 })

      await service.createRecipientAccount(1, 'EUR', 'iban', 'Jane')

      expect(mock.history[0].body).not.toHaveProperty('details')
    })
  })

  describe('listRecipientAccounts', () => {
    it('lists recipients filtered by currency', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/accounts`).reply({ content: [{ id: 40000000 }] })

      const result = await service.listRecipientAccounts(12345, 'EUR')

      expect(result).toEqual({ content: [{ id: 40000000 }] })
      expect(mock.history[0].query).toEqual({ profile: 12345, currency: 'EUR' })
    })

    it('drops an empty currency filter', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/accounts`).reply({ content: [] })

      await service.listRecipientAccounts(12345)

      expect(mock.history[0].query).toEqual({ profile: 12345 })
    })
  })

  describe('getRecipientAccount', () => {
    it('requests a recipient by id', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/accounts/40000000`).reply({ id: 40000000 })

      const result = await service.getRecipientAccount(40000000)

      expect(result).toEqual({ id: 40000000 })
    })
  })

  describe('deleteRecipientAccount', () => {
    it('deletes a recipient and returns a confirmation', async () => {
      mock.onDelete(`${ SANDBOX_BASE }/v1/accounts/40000000`).reply({})

      const result = await service.deleteRecipientAccount(40000000)

      expect(result).toEqual({ success: true, accountId: 40000000 })
      expect(mock.history[0].method).toBe('delete')
    })

    it('wraps delete failures', async () => {
      mock.onDelete(`${ SANDBOX_BASE }/v1/accounts/1`).replyWithError({ message: 'Not found' })

      await expect(service.deleteRecipientAccount(1)).rejects.toThrow('Wise API error: Not found')
    })
  })

  // ── Transfers ──

  describe('createTransfer', () => {
    it('creates a transfer with a supplied idempotency key and reference', async () => {
      mock.onPost(`${ SANDBOX_BASE }/v1/transfers`).reply({ id: 16521632 })

      const result = await service.createTransfer(
        40000000,
        'quote-uuid',
        'Invoice 42',
        '6d0d81f6-cb15-42fb-9d09-a1c4e3f4d000'
      )

      expect(result).toEqual({ id: 16521632 })

      expect(mock.history[0].body).toEqual({
        targetAccount: 40000000,
        quoteUuid: 'quote-uuid',
        customerTransactionId: '6d0d81f6-cb15-42fb-9d09-a1c4e3f4d000',
        details: { reference: 'Invoice 42' },
      })
    })

    it('generates a UUID v4 idempotency key when none is supplied', async () => {
      mock.onPost(`${ SANDBOX_BASE }/v1/transfers`).reply({ id: 1 })

      await service.createTransfer(40000000, 'quote-uuid')

      const body = mock.history[0].body

      expect(body).not.toHaveProperty('details')
      expect(body.customerTransactionId).toMatch(UUID_PATTERN)
    })

    it('generates a distinct key on each call', async () => {
      mock.onPost(`${ SANDBOX_BASE }/v1/transfers`).reply({ id: 1 })

      await service.createTransfer(40000000, 'quote-a')
      await service.createTransfer(40000000, 'quote-b')

      expect(mock.history[0].body.customerTransactionId)
        .not.toBe(mock.history[1].body.customerTransactionId)
    })
  })

  describe('getTransfer', () => {
    it('requests a transfer by id', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/transfers/16521632`).reply({ id: 16521632 })

      const result = await service.getTransfer(16521632)

      expect(result).toEqual({ id: 16521632 })
    })
  })

  describe('listTransfers', () => {
    it('applies the default limit and maps the status label', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/transfers`).reply([{ id: 1 }])

      const result = await service.listTransfers(12345, 'Outgoing Payment Sent')

      expect(result).toEqual([{ id: 1 }])

      expect(mock.history[0].query).toEqual({
        profile: 12345,
        status: 'outgoing_payment_sent',
        limit: 100,
      })
    })

    it('honours explicit limit and offset', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/transfers`).reply([])

      await service.listTransfers(12345, undefined, 10, 20)

      expect(mock.history[0].query).toEqual({ profile: 12345, limit: 10, offset: 20 })
    })

    it('maps every status label', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/transfers`).reply([])

      const labels = [
        'Incoming Payment Waiting',
        'Processing',
        'Funds Converted',
        'Cancelled',
        'Funds Refunded',
        'Bounced Back',
      ]

      for (const label of labels) {
        await service.listTransfers(12345, label)
      }

      expect(mock.history.map(call => call.query.status)).toEqual([
        'incoming_payment_waiting',
        'processing',
        'funds_converted',
        'cancelled',
        'funds_refunded',
        'bounced_back',
      ])
    })

    it('passes an unmapped status straight through', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/transfers`).reply([])

      await service.listTransfers(12345, 'processing')

      expect(mock.history[0].query.status).toBe('processing')
    })
  })

  describe('cancelTransfer', () => {
    it('issues a PUT to the cancel endpoint', async () => {
      mock.onPut(`${ SANDBOX_BASE }/v1/transfers/16521632/cancel`).reply({ id: 16521632, status: 'cancelled' })

      const result = await service.cancelTransfer(16521632)

      expect(result).toEqual({ id: 16521632, status: 'cancelled' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  describe('fundTransfer', () => {
    it('funds a transfer from the balance', async () => {
      mock.onPost(`${ SANDBOX_BASE }/v3/profiles/12345/transfers/16521632/payments`)
        .reply({ type: 'BALANCE', status: 'COMPLETED' })

      const result = await service.fundTransfer(12345, 16521632)

      expect(result).toEqual({ type: 'BALANCE', status: 'COMPLETED' })
      expect(mock.history[0].body).toEqual({ type: 'BALANCE' })
    })
  })

  // ── Balances, rates, currencies ──

  describe('getAccountBalances', () => {
    it('defaults to standard balances', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v4/profiles/12345/balances`).reply([{ id: 100000 }])

      const result = await service.getAccountBalances(12345)

      expect(result).toEqual([{ id: 100000 }])
      expect(mock.history[0].query).toEqual({ types: 'STANDARD' })
    })

    it('maps the savings balance label', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v4/profiles/12345/balances`).reply([])

      await service.getAccountBalances(12345, 'Savings')

      expect(mock.history[0].query).toEqual({ types: 'SAVINGS' })
    })
  })

  describe('getExchangeRate', () => {
    it('requests a currency pair rate', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/rates`).reply([{ rate: 1.1642 }])

      const result = await service.getExchangeRate('GBP', 'EUR')

      expect(result).toEqual([{ rate: 1.1642 }])
      expect(mock.history[0].query).toEqual({ source: 'GBP', target: 'EUR' })
    })
  })

  describe('listCurrencies', () => {
    it('requests the currency list', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/currencies`).reply([{ code: 'GBP' }])

      const result = await service.listCurrencies()

      expect(result).toEqual([{ code: 'GBP' }])
    })
  })

  // ── Dictionaries ──

  describe('getProfilesDictionary', () => {
    it('maps business and personal profiles to dictionary items', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/profiles`).reply([
        { id: 12345, type: 'personal', details: { firstName: 'Jane', lastName: 'Doe' } },
        { id: 67890, type: 'business', details: { name: 'Acme Ltd' } },
      ])

      const result = await service.getProfilesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Jane Doe (personal)', value: '12345', note: 'personal' },
          { label: 'Acme Ltd (business)', value: '67890', note: 'business' },
        ],
        cursor: null,
      })
    })

    it('falls back to a generic label when no details are present', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/profiles`).reply([{ id: 12345, type: 'personal' }])

      const result = await service.getProfilesDictionary(null)

      expect(result.items).toEqual([
        { label: 'Profile 12345 (personal)', value: '12345', note: 'personal' },
      ])
    })

    it('filters profiles by a case-insensitive search term', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/profiles`).reply([
        { id: 12345, type: 'personal', details: { firstName: 'Jane', lastName: 'Doe' } },
        { id: 67890, type: 'business', details: { name: 'Acme Ltd' } },
      ])

      const result = await service.getProfilesDictionary({ search: 'acme' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('67890')
    })

    it('handles a non-array response', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/profiles`).reply({ unexpected: true })

      const result = await service.getProfilesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getRecipientAccountsDictionary', () => {
    it('returns an empty list without a profile id in criteria', async () => {
      const result = await service.getRecipientAccountsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns an empty list for a null payload', async () => {
      const result = await service.getRecipientAccountsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('maps recipients from a content wrapper', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/accounts`).reply({
        content: [{ id: 40000000, accountHolderName: 'Jane Doe', currency: 'EUR', type: 'iban' }],
      })

      const result = await service.getRecipientAccountsDictionary({ criteria: { profileId: 12345 } })

      expect(result).toEqual({
        items: [{ label: 'Jane Doe - EUR', value: '40000000', note: 'iban' }],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ profile: 12345 })
    })

    it('maps recipients from a bare array and falls back to a default holder name', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/accounts`).reply([
        { id: 1, currency: 'GBP', type: 'sort_code' },
      ])

      const result = await service.getRecipientAccountsDictionary({ criteria: { profileId: 12345 } })

      expect(result.items).toEqual([{ label: 'Recipient - GBP', value: '1', note: 'sort_code' }])
    })

    it('filters recipients by search term', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/accounts`).reply({
        content: [
          { id: 1, accountHolderName: 'Jane Doe', currency: 'EUR', type: 'iban' },
          { id: 2, accountHolderName: 'John Smith', currency: 'GBP', type: 'sort_code' },
        ],
      })

      const result = await service.getRecipientAccountsDictionary({
        search: 'smith',
        criteria: { profileId: 12345 },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('2')
    })

    it('handles an empty content list', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/accounts`).reply({})

      const result = await service.getRecipientAccountsDictionary({ criteria: { profileId: 12345 } })

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})

describe('Wise Service in the live environment', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    jest.resetModules()
    sandbox = createSandbox({ apiToken: API_TOKEN, environment: 'Live' })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  it('targets the live API host', async () => {
    expect(service.baseUrl).toBe(LIVE_BASE)

    mock.onGet(`${ LIVE_BASE }/v1/currencies`).reply([{ code: 'EUR' }])

    const result = await service.listCurrencies()

    expect(result).toEqual([{ code: 'EUR' }])
    expect(mock.history[0].url).toBe(`${ LIVE_BASE }/v1/currencies`)
  })
})

describe('Wise Service without an explicit environment', () => {
  let sandbox
  let service

  beforeAll(() => {
    jest.resetModules()
    sandbox = createSandbox({ apiToken: API_TOKEN })
    require('../src/index.js')
    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  it('defaults to the sandbox environment', () => {
    expect(service.environment).toBe('Sandbox')
    expect(service.baseUrl).toBe(SANDBOX_BASE)
  })
})
