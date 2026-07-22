'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('RampService (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('ramp-service')
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

  // ── Dictionaries ──

  describe('getUsersDictionary', () => {
    it('returns items with expected shape', async () => {
      const result = await service.getUsersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })

    it('handles null payload', async () => {
      const result = await service.getUsersDictionary(null)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getDepartmentsDictionary', () => {
    it('returns items with expected shape', async () => {
      const result = await service.getDepartmentsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })
  })

  describe('getLocationsDictionary', () => {
    it('returns items with expected shape', async () => {
      const result = await service.getLocationsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })
  })

  describe('getVendorsDictionary', () => {
    it('returns items with expected shape', async () => {
      const result = await service.getVendorsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })
  })

  describe('getCardsDictionary', () => {
    it('returns items with expected shape', async () => {
      const result = await service.getCardsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })
  })

  // ── Transactions ──

  describe('listTransactions', () => {
    it('returns paginated transaction list', async () => {
      const result = await service.listTransactions()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('page')
    })

    it('returns transactions with limit', async () => {
      const result = await service.listTransactions(null, null, null, null, null, null, 5)

      expect(result).toHaveProperty('data')
      expect(result.data.length).toBeLessThanOrEqual(5)
    })
  })

  describe('getTransaction', () => {
    it('retrieves a single transaction by ID', async () => {
      const { transactionId } = testValues

      if (!transactionId) {
        console.log('Skipping getTransaction: testValues.transactionId not set')
        return
      }

      const result = await service.getTransaction(transactionId)

      expect(result).toHaveProperty('id', transactionId)
    })
  })

  // ── Cards ──

  describe('listCards', () => {
    it('returns paginated card list', async () => {
      const result = await service.listCards()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('page')
    })
  })

  describe('getCard', () => {
    it('retrieves a single card by ID', async () => {
      const { cardId } = testValues

      if (!cardId) {
        console.log('Skipping getCard: testValues.cardId not set')
        return
      }

      const result = await service.getCard(cardId)

      expect(result).toHaveProperty('id', cardId)
    })
  })

  // ── Users ──

  describe('listUsers', () => {
    it('returns paginated user list', async () => {
      const result = await service.listUsers()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('page')
    })
  })

  describe('getUser', () => {
    it('retrieves a single user by ID', async () => {
      const { userId } = testValues

      if (!userId) {
        console.log('Skipping getUser: testValues.userId not set')
        return
      }

      const result = await service.getUser(userId)

      expect(result).toHaveProperty('id', userId)
    })
  })

  // ── Organization ──

  describe('listDepartments', () => {
    it('returns paginated department list', async () => {
      const result = await service.listDepartments()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('page')
    })
  })

  describe('listLocations', () => {
    it('returns paginated location list', async () => {
      const result = await service.listLocations()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('page')
    })
  })

  // ── Vendors ──

  describe('listVendors', () => {
    it('returns paginated vendor list', async () => {
      const result = await service.listVendors()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('page')
    })
  })

  describe('getVendor', () => {
    it('retrieves a single vendor by ID', async () => {
      const { vendorId } = testValues

      if (!vendorId) {
        console.log('Skipping getVendor: testValues.vendorId not set')
        return
      }

      const result = await service.getVendor(vendorId)

      expect(result).toHaveProperty('id', vendorId)
    })
  })

  // ── Bills ──

  describe('listBills', () => {
    it('returns paginated bill list', async () => {
      const result = await service.listBills()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('page')
    })
  })

  describe('getBill', () => {
    it('retrieves a single bill by ID', async () => {
      const { billId } = testValues

      if (!billId) {
        console.log('Skipping getBill: testValues.billId not set')
        return
      }

      const result = await service.getBill(billId)

      expect(result).toHaveProperty('id', billId)
    })
  })

  // ── Reimbursements ──

  describe('listReimbursements', () => {
    it('returns paginated reimbursement list', async () => {
      const result = await service.listReimbursements()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('page')
    })
  })

  describe('getReimbursement', () => {
    it('retrieves a single reimbursement by ID', async () => {
      const { reimbursementId } = testValues

      if (!reimbursementId) {
        console.log('Skipping getReimbursement: testValues.reimbursementId not set')
        return
      }

      const result = await service.getReimbursement(reimbursementId)

      expect(result).toHaveProperty('id', reimbursementId)
    })
  })

  // ── Triggers ──

  describe('onNewTransaction (polling trigger)', () => {
    it('returns events and state in learning mode', async () => {
      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewTransaction',
        triggerData: {},
        learningMode: true,
      })

      expect(result).toHaveProperty('events')
      expect(Array.isArray(result.events)).toBe(true)
      expect(result).toHaveProperty('state')
    })
  })
})
