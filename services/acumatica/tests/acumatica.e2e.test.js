'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Acumatica Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('acumatica')
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

  // ── Vendor Methods ──

  describe('listVendors', () => {
    it('returns an array of vendors', async () => {
      const result = await service.listVendors(null, null, 5)

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('VendorID')
        expect(result[0].VendorID).toHaveProperty('value')
      }
    })

    it('applies filter and select params', async () => {
      const result = await service.listVendors("Status eq 'Active'", 'VendorID,VendorName,Status', 3)

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('VendorID')
        expect(result[0]).toHaveProperty('Status')
        expect(result[0].Status.value).toBe('Active')
      }
    })
  })

  describe('getVendor', () => {
    it('retrieves a vendor by ID', async () => {
      if (!testValues.vendorId) {
        console.log('Skipping: testValues.vendorId not set')
        return
      }

      const result = await service.getVendor(testValues.vendorId)

      expect(result).toHaveProperty('VendorID')
      expect(result.VendorID.value).toBe(testValues.vendorId)
      expect(result).toHaveProperty('VendorName')
    })
  })

  describe('validateVendor', () => {
    it('validates an existing vendor', async () => {
      if (!testValues.vendorId) {
        console.log('Skipping: testValues.vendorId not set')
        return
      }

      const result = await service.validateVendor(testValues.vendorId)

      expect(result).toHaveProperty('VendorID')
      expect(result.VendorID.value).toBe(testValues.vendorId)
    })
  })

  // ── Bill Methods ──

  describe('listBills', () => {
    it('returns an array of bills', async () => {
      const result = await service.listBills(null, null, 5)

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('ReferenceNbr')
        expect(result[0]).toHaveProperty('Vendor')
        expect(result[0]).toHaveProperty('Status')
      }
    })
  })

  describe('getBillByReferenceNbr', () => {
    it('retrieves a bill by reference number', async () => {
      if (!testValues.billReferenceNbr) {
        console.log('Skipping: testValues.billReferenceNbr not set')
        return
      }

      const result = await service.getBillByReferenceNbr(testValues.billReferenceNbr)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].ReferenceNbr.value).toBe(testValues.billReferenceNbr)
    })
  })

  describe('searchBillsByDescription', () => {
    it('searches bills by keyword', async () => {
      // Use a generic keyword that is likely to match at least something
      const result = await service.searchBillsByDescription('a', 5)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('checkDuplicateBill', () => {
    it('returns an array (empty or with matches)', async () => {
      if (!testValues.vendorId) {
        console.log('Skipping: testValues.vendorId not set')
        return
      }

      const result = await service.checkDuplicateBill(testValues.vendorId, 'NONEXISTENT-REF-E2E')

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(0)
    })
  })

  // ── Bill CRUD lifecycle ──

  describe('create, get, and delete bill', () => {
    let createdRefNbr

    it('creates a new bill', async () => {
      if (!testValues.vendorId) {
        console.log('Skipping: testValues.vendorId not set')
        return
      }

      const vendorRef = `E2E-TEST-${Date.now()}`

      const result = await service.createBill(
        testValues.vendorId,
        vendorRef,
        null, null, null,
        'E2E test bill - safe to delete'
      )

      expect(result).toHaveProperty('ReferenceNbr')
      expect(result.ReferenceNbr).toHaveProperty('value')

      createdRefNbr = result.ReferenceNbr.value
    })

    it('retrieves the created bill by vendor ref', async () => {
      if (!createdRefNbr) {
        console.log('Skipping: no bill was created')
        return
      }

      const result = await service.getBillByReferenceNbr(createdRefNbr)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('lists files on the created bill (expect empty)', async () => {
      if (!createdRefNbr) {
        console.log('Skipping: no bill was created')
        return
      }

      const result = await service.getBillFiles(createdRefNbr)

      expect(Array.isArray(result)).toBe(true)
    })

    it('deletes the created bill', async () => {
      if (!createdRefNbr) {
        console.log('Skipping: no bill was created')
        return
      }

      const result = await service.deleteBill(createdRefNbr)

      expect(result).toEqual({ deleted: true, referenceNbr: createdRefNbr })
    })
  })

  // ── Reference Data Methods ──

  describe('listGLAccounts', () => {
    it('returns an array of GL accounts', async () => {
      const result = await service.listGLAccounts(null, null, 5)

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('AccountCD')
      }
    })
  })

  describe('listCreditTerms', () => {
    it('returns an array of credit terms', async () => {
      const result = await service.listCreditTerms(null, null, 5)

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('TermsID')
      }
    })
  })

  // ── Report Methods ──

  describe('getAPAccountBalance', () => {
    it('returns AP aging report data', async () => {
      const result = await service.getAPAccountBalance()

      expect(result).toBeDefined()
    })

    it('filters by vendor ID when provided', async () => {
      if (!testValues.vendorId) {
        console.log('Skipping: testValues.vendorId not set')
        return
      }

      const result = await service.getAPAccountBalance(testValues.vendorId)

      expect(result).toBeDefined()
    })
  })
})
