'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Wise Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('wise')
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

  // ── Reference data ──

  describe('listCurrencies', () => {
    it('returns the supported currency list', async () => {
      const result = await service.listCurrencies()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('code')
    })
  })

  describe('getExchangeRate', () => {
    it('returns a rate for a currency pair', async () => {
      const result = await service.getExchangeRate('GBP', 'EUR')

      expect(Array.isArray(result)).toBe(true)
      expect(result[0]).toHaveProperty('rate')
      expect(result[0]).toHaveProperty('source', 'GBP')
      expect(result[0]).toHaveProperty('target', 'EUR')
    })

    it('fails for an unknown currency pair', async () => {
      await expect(service.getExchangeRate('XXX', 'YYY')).rejects.toThrow(/Wise API error/)
    })
  })

  // ── Profiles ──

  describe('profiles', () => {
    let profileId

    it('lists the profiles available to the token', async () => {
      const result = await service.listProfiles()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('id')
      expect(result[0]).toHaveProperty('type')

      profileId = result[0].id
    })

    it('retrieves a single profile by id', async () => {
      if (!profileId) {
        console.log('Skipping getProfile: no profile resolved from listProfiles')

        return
      }

      const result = await service.getProfile(profileId)

      expect(result).toHaveProperty('id', profileId)
      expect(result).toHaveProperty('type')
    })

    it('returns the profiles dictionary', async () => {
      const result = await service.getProfilesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)

      if (result.items.length) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('filters the profiles dictionary by an unmatched search term', async () => {
      const result = await service.getProfilesDictionary({ search: 'zzz-no-such-profile' })

      expect(result.items).toEqual([])
    })
  })

  // ── Balances ──

  describe('getAccountBalances', () => {
    it('returns standard balances for the test profile', async () => {
      const { profileId } = testValues

      if (!profileId) {
        console.log('Skipping getAccountBalances: testValues.profileId not set')

        return
      }

      const result = await service.getAccountBalances(profileId)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Quotes ──

  describe('quotes', () => {
    let quoteId

    it('creates a quote for the test profile', async () => {
      const { profileId } = testValues

      if (!profileId) {
        console.log('Skipping createQuote: testValues.profileId not set')

        return
      }

      const result = await service.createQuote(profileId, 'GBP', 'EUR', 100, undefined, 'Bank Transfer')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('sourceCurrency', 'GBP')
      expect(result).toHaveProperty('targetCurrency', 'EUR')

      quoteId = result.id
    })

    it('retrieves the created quote', async () => {
      const { profileId } = testValues

      if (!profileId || !quoteId) {
        console.log('Skipping getQuote: no quote was created')

        return
      }

      const result = await service.getQuote(profileId, quoteId)

      expect(result).toHaveProperty('id', quoteId)
    })
  })

  // ── Recipients ──

  describe('recipient accounts', () => {
    let recipientId

    it('creates an IBAN recipient account', async () => {
      const { profileId, testIban } = testValues

      if (!profileId || !testIban) {
        console.log('Skipping createRecipientAccount: testValues.profileId or testValues.testIban not set')

        return
      }

      const result = await service.createRecipientAccount(profileId, 'EUR', 'IBAN', 'FlowRunner E2E', {
        legalType: 'PRIVATE',
        iban: testIban,
      })

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('currency', 'EUR')

      recipientId = result.id
    })

    it('lists recipient accounts for the profile', async () => {
      const { profileId } = testValues

      if (!profileId) {
        console.log('Skipping listRecipientAccounts: testValues.profileId not set')

        return
      }

      const result = await service.listRecipientAccounts(profileId, 'EUR')

      expect(result).toBeDefined()
    })

    it('returns the recipient accounts dictionary', async () => {
      const { profileId } = testValues

      if (!profileId) {
        console.log('Skipping getRecipientAccountsDictionary: testValues.profileId not set')

        return
      }

      const result = await service.getRecipientAccountsDictionary({ criteria: { profileId } })

      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })

    it('returns an empty dictionary without a profile id', async () => {
      const result = await service.getRecipientAccountsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('retrieves the created recipient account', async () => {
      if (!recipientId) {
        console.log('Skipping getRecipientAccount: no recipient was created')

        return
      }

      const result = await service.getRecipientAccount(recipientId)

      expect(result).toHaveProperty('id', recipientId)
    })

    it('deletes the created recipient account', async () => {
      if (!recipientId) {
        console.log('Skipping deleteRecipientAccount: no recipient was created')

        return
      }

      const result = await service.deleteRecipientAccount(recipientId)

      expect(result).toEqual({ success: true, accountId: recipientId })
    })
  })

  // ── Transfers ──

  describe('transfers', () => {
    it('lists transfers for the test profile', async () => {
      const { profileId } = testValues

      if (!profileId) {
        console.log('Skipping listTransfers: testValues.profileId not set')

        return
      }

      const result = await service.listTransfers(profileId, undefined, 5, 0)

      expect(Array.isArray(result)).toBe(true)
    })

    it('creates, reads and cancels a transfer', async () => {
      const { profileId, recipientAccountId } = testValues

      if (!profileId || !recipientAccountId) {
        console.log('Skipping transfer lifecycle: testValues.profileId or testValues.recipientAccountId not set')

        return
      }

      const quote = await service.createQuote(profileId, 'GBP', 'EUR', 10, undefined, 'Bank Transfer')
      const transfer = await service.createTransfer(recipientAccountId, quote.id, 'FlowRunner e2e')

      expect(transfer).toHaveProperty('id')

      const fetched = await service.getTransfer(transfer.id)

      expect(fetched).toHaveProperty('id', transfer.id)

      const cancelled = await service.cancelTransfer(transfer.id)

      expect(cancelled).toHaveProperty('status')
    })
  })
})
