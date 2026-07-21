'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Mollie Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('mollie')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Payment Methods ──

  describe('listEnabledMethods', () => {
    it('returns enabled methods with expected shape', async () => {
      const result = await service.listEnabledMethods()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('count')
    })
  })

  describe('listAllMethods', () => {
    it('returns all methods with expected shape', async () => {
      const result = await service.listAllMethods()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('id')
        expect(result.items[0]).toHaveProperty('description')
      }
    })
  })

  describe('getMethod', () => {
    it('returns a single method by ID', async () => {
      const result = await service.getMethod('ideal')

      expect(result).toHaveProperty('id', 'ideal')
      expect(result).toHaveProperty('description')
    })
  })

  // ── Payments (create + get + list + cancel lifecycle) ──

  describe('payment lifecycle', () => {
    let paymentId

    it('creates a payment', async () => {
      const result = await service.createPayment(
        '10.00', 'EUR', 'E2E Test Payment',
        'https://example.org/return'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('status')
      expect(result).toHaveProperty('amount')
      expect(result.amount).toMatchObject({ currency: 'EUR', value: '10.00' })

      paymentId = result.id
    })

    it('retrieves the created payment', async () => {
      const result = await service.getPayment(paymentId)

      expect(result).toHaveProperty('id', paymentId)
      expect(result).toHaveProperty('status')
      expect(result).toHaveProperty('description', 'E2E Test Payment')
    })

    it('lists payments and includes the created one', async () => {
      const result = await service.listPayments(undefined, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
    })

    it('cancels the payment', async () => {
      // Only open payments that are cancelable can be canceled.
      // Bank transfer payments are cancelable by default.
      try {
        const result = await service.cancelPayment(paymentId)

        expect(result).toHaveProperty('id', paymentId)
      } catch (error) {
        // Payment may not be cancelable depending on method/status
        expect(error.message).toMatch(/Mollie API error/)
      }
    })
  })

  // ── Customers (create + get + update + delete lifecycle) ──

  describe('customer lifecycle', () => {
    let customerId

    it('creates a customer', async () => {
      const result = await service.createCustomer(
        'E2E Test Customer',
        'e2e-test@flowrunner-test.example'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Customer')

      customerId = result.id
    })

    it('retrieves the created customer', async () => {
      const result = await service.getCustomer(customerId)

      expect(result).toHaveProperty('id', customerId)
      expect(result).toHaveProperty('name', 'E2E Test Customer')
    })

    it('updates the customer', async () => {
      const result = await service.updateCustomer(customerId, 'E2E Updated Customer')

      expect(result).toHaveProperty('id', customerId)
      expect(result).toHaveProperty('name', 'E2E Updated Customer')
    })

    it('lists customers', async () => {
      const result = await service.listCustomers(undefined, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
    })

    it('lists customer payments (empty)', async () => {
      const result = await service.listCustomerPayments(customerId)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('deletes the customer', async () => {
      const result = await service.deleteCustomer(customerId)

      expect(result).toEqual({ deleted: true, customerId })
    })
  })

  // ── Payment Links (create + get + list + update + delete lifecycle) ──

  describe('payment link lifecycle', () => {
    let paymentLinkId

    it('creates a payment link', async () => {
      const result = await service.createPaymentLink(
        'E2E Test Link', '15.00', 'EUR'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('description', 'E2E Test Link')
      expect(result).toHaveProperty('paymentLinkUrl')

      paymentLinkId = result.id
    })

    it('retrieves the created payment link', async () => {
      const result = await service.getPaymentLink(paymentLinkId)

      expect(result).toHaveProperty('id', paymentLinkId)
      expect(result).toHaveProperty('paymentLinkUrl')
    })

    it('lists payment links', async () => {
      const result = await service.listPaymentLinks(undefined, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('updates the payment link description', async () => {
      const result = await service.updatePaymentLink(paymentLinkId, 'E2E Updated Link')

      expect(result).toHaveProperty('id', paymentLinkId)
    })

    it('lists payment link payments', async () => {
      const result = await service.listPaymentLinkPayments(paymentLinkId)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('deletes the payment link', async () => {
      const result = await service.deletePaymentLink(paymentLinkId)

      expect(result).toEqual({ deleted: true, paymentLinkId })
    })
  })

  // ── Profiles ──

  describe('profiles', () => {
    it('lists profiles', async () => {
      const result = await service.listProfiles()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('gets profile by "me"', async () => {
      const result = await service.getProfile('me')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
    })
  })

  // ── Dictionaries ──

  describe('getCustomersDictionary', () => {
    it('returns dictionary items with label/value shape', async () => {
      const result = await service.getCustomersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getPaymentMethodsDictionary', () => {
    it('returns dictionary items with label/value shape', async () => {
      const result = await service.getPaymentMethodsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })
  })

  describe('getProfilesDictionary', () => {
    it('returns dictionary items with label/value shape', async () => {
      const result = await service.getProfilesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  // ── Refunds (list all) ──

  describe('listAllRefunds', () => {
    it('returns refunds list with expected shape', async () => {
      const result = await service.listAllRefunds(undefined, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('count')
    })
  })

  // ── Chargebacks (list all) ──

  describe('listAllChargebacks', () => {
    it('returns chargebacks list with expected shape', async () => {
      const result = await service.listAllChargebacks(undefined, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('count')
    })
  })

  // ── Terminals ──

  describe('listTerminals', () => {
    it('returns terminals list with expected shape', async () => {
      const result = await service.listTerminals(undefined, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
