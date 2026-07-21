'use strict'

const { EventEmitter } = require('events')
const { createSandbox } = require('../../../service-sandbox')

const INSTANCE_URL = 'https://mycompany.acumatica.com'
const USERNAME = 'test-user'
const PASSWORD = 'test-pass'
const API_VERSION = '24.200.001'
const BASE = `${INSTANCE_URL}/entity/Default/${API_VERSION}`

// ── Helpers to mock the native http/https login call ──

/**
 * Installs a mock on the `https` module so that the native login call succeeds.
 * The mock fires the response callback and its data/end events via setImmediate
 * so that the Promise inside #login() resolves properly.
 * Returns a cleanup function.
 */
function mockLogin(statusCode = 204, cookies = ['session=abc123; Path=/']) {
  const https = require('https')
  const originalRequest = https.request

  https.request = jest.fn((options, callback) => {
    const req = new EventEmitter()

    req.write = jest.fn()
    req.end = jest.fn().mockImplementation(() => {
      // Fire the response after req.end() is called (matching real behaviour)
      const res = new EventEmitter()

      res.statusCode = statusCode
      res.headers = { 'set-cookie': cookies }

      if (callback) {
        callback(res)
      }

      // Emit data + end on the next tick so listeners attached in the callback run first
      setImmediate(() => {
        res.emit('data', '')
        res.emit('end')
      })
    })

    return req
  })

  return () => {
    https.request = originalRequest
  }
}

describe('Acumatica Service', () => {
  let sandbox
  let service
  let mock
  let restoreLogin

  beforeAll(() => {
    sandbox = createSandbox({
      instanceUrl: INSTANCE_URL,
      username: USERNAME,
      password: PASSWORD,
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  beforeEach(() => {
    restoreLogin = mockLogin()
  })

  afterEach(() => {
    mock.reset()
    restoreLogin()
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
          expect.objectContaining({ name: 'instanceUrl', required: true }),
          expect.objectContaining({ name: 'username', required: true }),
          expect.objectContaining({ name: 'password', required: true }),
          expect.objectContaining({ name: 'apiVersion', required: false }),
        ])
      )
    })
  })

  // ── Vendor Methods ──

  describe('validateVendor', () => {
    it('sends GET to the correct URL', async () => {
      mock.onGet(`${BASE}/Vendor/V000001`).reply({ VendorID: { value: 'V000001' } })
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const result = await service.validateVendor('V000001')

      expect(result).toEqual({ VendorID: { value: 'V000001' } })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE}/Vendor/V000001`)
      expect(mock.history[0].headers).toMatchObject({
        Cookie: expect.stringContaining('session=abc123'),
        'Content-Type': 'application/json',
      })
    })

    it('encodes vendor ID in URL', async () => {
      mock.onGet(`${BASE}/Vendor/V%20001`).reply({ VendorID: { value: 'V 001' } })
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      await service.validateVendor('V 001')

      expect(mock.history[0].url).toBe(`${BASE}/Vendor/V%20001`)
    })

    it('throws when vendorId is not provided', async () => {
      await expect(service.validateVendor()).rejects.toThrow('"Vendor ID" is required')
    })
  })

  describe('listVendors', () => {
    it('sends GET with no query when no params provided', async () => {
      mock.onGet(`${BASE}/Vendor`).reply([])
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const result = await service.listVendors()

      expect(result).toEqual([])
      expect(mock.history[0].query).toEqual({})
    })

    it('sends filter, select, and top query params', async () => {
      mock.onGet(`${BASE}/Vendor`).reply([{ VendorID: { value: 'V000001' } }])
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      await service.listVendors("Status eq 'Active'", 'VendorID,VendorName', 10)

      expect(mock.history[0].query).toMatchObject({
        '$filter': "Status eq 'Active'",
        '$select': 'VendorID,VendorName',
        '$top': 10,
      })
    })
  })

  describe('getVendor', () => {
    it('sends GET to vendor URL', async () => {
      mock.onGet(`${BASE}/Vendor/V000001`).reply({ VendorID: { value: 'V000001' } })
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const result = await service.getVendor('V000001')

      expect(result).toEqual({ VendorID: { value: 'V000001' } })
    })

    it('throws when vendorId is not provided', async () => {
      await expect(service.getVendor()).rejects.toThrow('"Vendor ID" is required')
    })
  })

  describe('createVendor', () => {
    it('sends PUT with required fields only', async () => {
      mock.onPut(`${BASE}/Vendor`).reply({ VendorID: { value: 'PACBEV' } })
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const result = await service.createVendor('PACBEV', 'Pacific Beverages LLC')

      expect(result).toEqual({ VendorID: { value: 'PACBEV' } })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({
        VendorID: { value: 'PACBEV' },
        VendorName: { value: 'Pacific Beverages LLC' },
      })
    })

    it('includes optional fields when provided', async () => {
      mock.onPut(`${BASE}/Vendor`).reply({ VendorID: { value: 'PACBEV' } })
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      await service.createVendor('PACBEV', 'Pacific Beverages LLC', 'DOMESTIC', 'NET30', 'USD')

      expect(mock.history[0].body).toEqual({
        VendorID: { value: 'PACBEV' },
        VendorName: { value: 'Pacific Beverages LLC' },
        VendorClass: { value: 'DOMESTIC' },
        Terms: { value: 'NET30' },
        CurrencyID: { value: 'USD' },
      })
    })

    it('throws when vendorId is not provided', async () => {
      await expect(service.createVendor()).rejects.toThrow('"Vendor ID" is required')
    })

    it('throws when vendorName is not provided', async () => {
      await expect(service.createVendor('V001')).rejects.toThrow('"Vendor Name" is required')
    })
  })

  // ── Bill Methods ──

  describe('checkDuplicateBill', () => {
    it('sends GET with correct filter', async () => {
      mock.onGet(`${BASE}/Bill`).reply([])
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const result = await service.checkDuplicateBill('V000001', 'INV-2025-001')

      expect(result).toEqual([])
      expect(mock.history[0].query).toMatchObject({
        '$filter': "VendorID eq 'V000001' and VendorRef eq 'INV-2025-001'",
      })
    })

    it('throws when vendorId is not provided', async () => {
      await expect(service.checkDuplicateBill()).rejects.toThrow('"Vendor ID" is required')
    })

    it('throws when vendorRef is not provided', async () => {
      await expect(service.checkDuplicateBill('V000001')).rejects.toThrow('"Vendor Reference" is required')
    })
  })

  describe('createBill', () => {
    it('sends PUT with required fields only', async () => {
      mock.onPut(`${BASE}/Bill`).reply({ ReferenceNbr: { value: '000043' } })
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const result = await service.createBill('V000001', 'INV-2025-001')

      expect(result).toEqual({ ReferenceNbr: { value: '000043' } })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({
        Vendor: { value: 'V000001' },
        VendorRef: { value: 'INV-2025-001' },
        Type: { value: 'Bill' },
      })
    })

    it('includes optional fields when provided', async () => {
      mock.onPut(`${BASE}/Bill`).reply({ ReferenceNbr: { value: '000043' } })
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      await service.createBill(
        'V000001', 'INV-2025-001',
        '2025-01-15', '2025-02-15',
        '012025', 'Test bill', 'MAIN', 'NET30'
      )

      const body = mock.history[0].body

      expect(body.Vendor).toEqual({ value: 'V000001' })
      expect(body.VendorRef).toEqual({ value: 'INV-2025-001' })
      expect(body.Type).toEqual({ value: 'Bill' })
      expect(body.Date).toEqual({ value: expect.any(String) })
      expect(body.DueDate).toEqual({ value: expect.any(String) })
      expect(body.PostPeriod).toEqual({ value: '012025' })
      expect(body.Description).toEqual({ value: 'Test bill' })
      expect(body.LocationID).toEqual({ value: 'MAIN' })
      expect(body.Terms).toEqual({ value: 'NET30' })
    })

    it('wraps detail lines and computes total amount', async () => {
      mock.onPut(`${BASE}/Bill`).reply({ ReferenceNbr: { value: '000044' } })
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const detailLines = [
        { Description: 'Line 1', ExtendedCost: 100, Account: '5100' },
        { Description: 'Line 2', ExtendedCost: 200, Account: '6000', Qty: 2, UnitCost: 100 },
      ]

      await service.createBill('V000001', 'INV-001', null, null, null, null, null, null, detailLines)

      const body = mock.history[0].body

      expect(body.Amount).toEqual({ value: 300 })
      expect(body.Details).toHaveLength(2)
      expect(body.Details[0]).toEqual({
        Description: { value: 'Line 1' },
        ExtendedCost: { value: 100 },
        Account: { value: '5100' },
      })
      expect(body.Details[1]).toMatchObject({
        Description: { value: 'Line 2' },
        ExtendedCost: { value: 200 },
        Account: { value: '6000' },
        Qty: { value: 2 },
        UnitCost: { value: 100 },
      })
    })

    it('omits Amount when detail lines have zero total', async () => {
      mock.onPut(`${BASE}/Bill`).reply({ ReferenceNbr: { value: '000045' } })
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const detailLines = [{ Description: 'No cost line', Account: '5100' }]

      await service.createBill('V000001', 'INV-002', null, null, null, null, null, null, detailLines)

      const body = mock.history[0].body

      expect(body.Amount).toBeUndefined()
      expect(body.Details).toHaveLength(1)
    })

    it('throws when vendor is not provided', async () => {
      await expect(service.createBill()).rejects.toThrow('"Vendor" is required')
    })

    it('throws when vendorRef is not provided', async () => {
      await expect(service.createBill('V000001')).rejects.toThrow('"Vendor Reference" is required')
    })
  })

  describe('releaseBillFromHold', () => {
    it('sends POST with correct action body', async () => {
      mock.onPost(`${BASE}/Bill/ReleaseFromHold`).reply({ ReferenceNbr: { value: '000043' }, Hold: { value: false } })
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const result = await service.releaseBillFromHold('000043')

      expect(result).toMatchObject({ Hold: { value: false } })
      expect(mock.history[0].body).toEqual({
        entity: {
          Type: { value: 'Bill' },
          ReferenceNbr: { value: '000043' },
        },
        parameters: {},
      })
    })

    it('throws when referenceNbr is not provided', async () => {
      await expect(service.releaseBillFromHold()).rejects.toThrow('"Reference Number" is required')
    })
  })

  describe('getBill', () => {
    it('sends GET with filter and expand', async () => {
      mock.onGet(`${BASE}/Bill`).reply([{ ReferenceNbr: { value: '000043' } }])
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const result = await service.getBill('INV-2025-001')

      expect(result).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        '$filter': "VendorRef eq 'INV-2025-001'",
        '$expand': 'Details',
      })
    })

    it('throws when vendorRef is not provided', async () => {
      await expect(service.getBill()).rejects.toThrow('"Vendor Reference" is required')
    })
  })

  describe('searchBillsByDescription', () => {
    it('sends GET with description filter', async () => {
      mock.onGet(`${BASE}/Bill`).reply([])
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      await service.searchBillsByDescription('Office')

      expect(mock.history[0].query).toMatchObject({
        '$filter': "Description contains 'Office'",
      })
    })

    it('includes top param when provided', async () => {
      mock.onGet(`${BASE}/Bill`).reply([])
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      await service.searchBillsByDescription('Office', 5)

      expect(mock.history[0].query).toMatchObject({
        '$filter': "Description contains 'Office'",
        '$top': 5,
      })
    })

    it('throws when keyword is not provided', async () => {
      await expect(service.searchBillsByDescription()).rejects.toThrow('"Keyword" is required')
    })
  })

  describe('listBills', () => {
    it('sends GET with no query when no params', async () => {
      mock.onGet(`${BASE}/Bill`).reply([])
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      await service.listBills()

      expect(mock.history[0].query).toEqual({})
    })

    it('sends filter, select, and top query params', async () => {
      mock.onGet(`${BASE}/Bill`).reply([])
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      await service.listBills("Status eq 'Open'", 'ReferenceNbr,Amount', 20)

      expect(mock.history[0].query).toMatchObject({
        '$filter': "Status eq 'Open'",
        '$select': 'ReferenceNbr,Amount',
        '$top': 20,
      })
    })
  })

  describe('getBillByReferenceNbr', () => {
    it('sends GET with reference number filter', async () => {
      mock.onGet(`${BASE}/Bill`).reply([{ ReferenceNbr: { value: '000043' } }])
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const result = await service.getBillByReferenceNbr('000043')

      expect(result).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        '$filter': "ReferenceNbr eq '000043'",
      })
    })

    it('throws when referenceNbr is not provided', async () => {
      await expect(service.getBillByReferenceNbr()).rejects.toThrow('"Reference Number" is required')
    })
  })

  describe('deleteBill', () => {
    it('sends DELETE and returns success object', async () => {
      mock.onDelete(`${BASE}/Bill/Bill/000043`).reply({})
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const result = await service.deleteBill('000043')

      expect(result).toEqual({ deleted: true, referenceNbr: '000043' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws when referenceNbr is not provided', async () => {
      await expect(service.deleteBill()).rejects.toThrow('"Reference Number" is required')
    })
  })

  describe('attachFileToBill', () => {
    it('downloads file and uploads to Acumatica', async () => {
      const fileBuffer = Buffer.from('pdf-content')

      mock.onGet('https://example.com/invoice.pdf').reply(fileBuffer)
      mock.onPut(`${BASE}/Bill/Bill/000043/files/invoice.pdf`).reply({})
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const result = await service.attachFileToBill('000043', 'invoice.pdf', 'https://example.com/invoice.pdf')

      expect(result).toEqual({
        attached: true,
        referenceNbr: '000043',
        fileName: 'invoice.pdf',
      })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].encoding).toBeNull()
      expect(mock.history[1].method).toBe('put')
      expect(mock.history[1].headers).toMatchObject({
        Cookie: expect.stringContaining('session=abc123'),
        'Content-Type': 'application/octet-stream',
      })
    })

    it('throws when referenceNbr is not provided', async () => {
      await expect(service.attachFileToBill()).rejects.toThrow('"Reference Number" is required')
    })

    it('throws when fileName is not provided', async () => {
      await expect(service.attachFileToBill('000043')).rejects.toThrow('"File Name" is required')
    })

    it('throws when fileUrl is not provided', async () => {
      await expect(service.attachFileToBill('000043', 'file.pdf')).rejects.toThrow('"File URL" is required')
    })
  })

  describe('getBillFiles', () => {
    it('sends GET with filter and expand=files, returns mapped files', async () => {
      mock.onGet(`${BASE}/Bill`).reply([{
        ReferenceNbr: { value: '000043' },
        files: [
          { id: 'file-1', filename: 'invoice.pdf', href: '/entity/Default/24.200.001/files/file-1' },
        ],
      }])
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const result = await service.getBillFiles('000043')

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: 'file-1',
        filename: 'invoice.pdf',
        url: `${INSTANCE_URL}/entity/Default/24.200.001/files/file-1`,
      })
      expect(mock.history[0].query).toMatchObject({
        '$filter': "ReferenceNbr eq '000043'",
        '$expand': 'files',
      })
    })

    it('returns empty array when bill has no files', async () => {
      mock.onGet(`${BASE}/Bill`).reply([{ ReferenceNbr: { value: '000043' } }])
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const result = await service.getBillFiles('000043')

      expect(result).toEqual([])
    })

    it('throws when referenceNbr is not provided', async () => {
      await expect(service.getBillFiles()).rejects.toThrow('"Reference Number" is required')
    })
  })

  describe('downloadBillFile', () => {
    it('downloads file and uploads to FlowRunner storage', async () => {
      const fileBuffer = Buffer.from('pdf-content')
      const fileUrl = `${INSTANCE_URL}/entity/Default/24.200.001/files/file-1`

      mock.onGet(fileUrl).reply(fileBuffer)
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      // Mock the flowrunner.Files.uploadFile
      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({
            url: 'https://storage.example.com/files/invoice.pdf',
          }),
        },
      }

      const result = await service.downloadBillFile(fileUrl, 'Bill (Bill, 000043)/invoice.pdf')

      expect(result).toEqual({
        url: 'https://storage.example.com/files/invoice.pdf',
        filename: 'invoice.pdf',
      })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].encoding).toBeNull()
      expect(mock.history[0].headers).toMatchObject({
        Cookie: expect.stringContaining('session=abc123'),
      })
      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          filename: 'invoice.pdf',
          generateUrl: true,
          overwrite: true,
        })
      )
    })

    it('handles relative href by prepending instance URL', async () => {
      const relativeHref = '/entity/Default/24.200.001/files/file-1'
      const fullUrl = `${INSTANCE_URL}${relativeHref}`

      mock.onGet(fullUrl).reply(Buffer.from('data'))
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://storage.example.com/f.pdf' }),
        },
      }

      await service.downloadBillFile(relativeHref, 'test.pdf')

      expect(mock.history[0].url).toBe(fullUrl)
    })

    it('sanitizes filename by stripping path and special chars', async () => {
      mock.onGet(`${INSTANCE_URL}/entity/Default/24.200.001/files/file-1`).reply(Buffer.from('data'))
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://storage.example.com/f.pdf' }),
        },
      }

      await service.downloadBillFile(
        `${INSTANCE_URL}/entity/Default/24.200.001/files/file-1`,
        'Bill (Bill, 000043)\\Invoice #123..Shoprite.pdf'
      )

      const uploadCall = service.flowrunner.Files.uploadFile.mock.calls[0]

      // Should strip directory prefix, replace special chars, collapse dots
      expect(uploadCall[1].filename).toBe('Invoice_123.Shoprite.pdf')
    })

    it('throws when fileUrl is not provided', async () => {
      await expect(service.downloadBillFile()).rejects.toThrow('"File URL" is required')
    })
  })

  // ── Reference Data Methods ──

  describe('listGLAccounts', () => {
    it('sends GET to Account endpoint', async () => {
      mock.onGet(`${BASE}/Account`).reply([])
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const result = await service.listGLAccounts()

      expect(result).toEqual([])
      expect(mock.history[0].url).toBe(`${BASE}/Account`)
    })

    it('sends filter, select, and top query params', async () => {
      mock.onGet(`${BASE}/Account`).reply([])
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      await service.listGLAccounts("Type eq 'Expense'", 'AccountCD,Description', 5)

      expect(mock.history[0].query).toMatchObject({
        '$filter': "Type eq 'Expense'",
        '$select': 'AccountCD,Description',
        '$top': 5,
      })
    })
  })

  describe('listCreditTerms', () => {
    it('sends GET to Terms endpoint', async () => {
      mock.onGet(`${BASE}/Terms`).reply([])
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const result = await service.listCreditTerms()

      expect(result).toEqual([])
      expect(mock.history[0].url).toBe(`${BASE}/Terms`)
    })

    it('sends filter, select, and top query params', async () => {
      mock.onGet(`${BASE}/Terms`).reply([])
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      await service.listCreditTerms("TermsID eq 'NET30'", 'TermsID,Description', 10)

      expect(mock.history[0].query).toMatchObject({
        '$filter': "TermsID eq 'NET30'",
        '$select': 'TermsID,Description',
        '$top': 10,
      })
    })
  })

  // ── Shipment Methods ──

  describe('getShipmentVolumes', () => {
    it('sends GET with filter and expand, aggregates volumes', async () => {
      const shipmentUrl = expect.stringContaining(`${BASE}/Shipment`)

      mock.onAny().replyWith((callRecord) => {
        if (callRecord.url.includes('/Shipment')) {
          return [
            {
              Details: [
                { InventoryID: { value: 'SKU-A' }, ShippedQty: { value: 100 }, Description: { value: 'Item A' } },
                { InventoryID: { value: 'SKU-B' }, ShippedQty: { value: 50 }, Description: { value: 'Item B' } },
              ],
            },
            {
              Details: [
                { InventoryID: { value: 'SKU-A' }, ShippedQty: { value: 200 }, Description: { value: 'Item A' } },
              ],
            },
          ]
        }

        return {}
      })

      const result = await service.getShipmentVolumes('CUST001', '2025-01-01', '2025-02-01')

      expect(result.customerID).toBe('CUST001')
      expect(result.shipments_found).toBe(2)
      expect(result.volumes).toEqual(
        expect.arrayContaining([
          { sku: 'SKU-A', description: 'Item A', total_cases_shipped: 300 },
          { sku: 'SKU-B', description: 'Item B', total_cases_shipped: 50 },
        ])
      )
    })

    it('returns zero volumes when no shipments found', async () => {
      mock.onAny().reply([])

      const result = await service.getShipmentVolumes('CUST001', '2025-01-01', '2025-02-01')

      expect(result.shipments_found).toBe(0)
      expect(result.volumes).toEqual([])
    })

    it('includes status filter when provided', async () => {
      mock.onAny().reply([])

      await service.getShipmentVolumes('CUST001', '2025-01-01', '2025-02-01', 'Completed')

      // The URL includes encoded filter parts including status
      expect(mock.history[0].url).toContain(encodeURIComponent("Status eq 'Completed'"))
    })

    it('throws when customerID is not provided', async () => {
      await expect(service.getShipmentVolumes()).rejects.toThrow('"Customer ID" is required')
    })

    it('throws when startDate is not provided', async () => {
      await expect(service.getShipmentVolumes('CUST001')).rejects.toThrow('"Start Date" is required')
    })

    it('throws when endDate is not provided', async () => {
      await expect(service.getShipmentVolumes('CUST001', '2025-01-01')).rejects.toThrow('"End Date" is required')
    })
  })

  // ── Report Methods ──

  describe('getAPAccountBalance', () => {
    it('sends POST to report endpoint without vendor filter', async () => {
      mock.onPost(`${BASE}/Report/AP632000`).reply({ ReportResults: [] })
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const result = await service.getAPAccountBalance()

      expect(result).toEqual({ ReportResults: [] })
      expect(mock.history[0].body).toEqual({
        entity: {},
        parameters: {},
      })
    })

    it('includes vendor filter when vendorId provided', async () => {
      mock.onPost(`${BASE}/Report/AP632000`).reply({ ReportResults: [] })
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      await service.getAPAccountBalance('PACBEV')

      expect(mock.history[0].body).toEqual({
        entity: {},
        parameters: {
          VendorID: { value: 'PACBEV' },
        },
      })
    })
  })

  // ── Session Management ──

  describe('session management', () => {
    it('logs in before API call and logs out after', async () => {
      const https = require('https')

      mock.onGet(`${BASE}/Vendor`).reply([])
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      await service.listVendors()

      // login was called (via https.request mock)
      expect(https.request).toHaveBeenCalled()
      const loginCall = https.request.mock.calls[0][0]

      expect(loginCall.hostname).toBe('mycompany.acumatica.com')
      expect(loginCall.path).toBe('/entity/auth/login')
      expect(loginCall.method).toBe('POST')

      // logout was called (via Flowrunner.Request.post)
      const logoutCall = mock.history.find(h => h.url.includes('/entity/auth/logout'))

      expect(logoutCall).toBeDefined()
    })

    it('retries on 401 by re-authenticating', async () => {
      const https = require('https')

      // First call returns 401, second succeeds
      let callCount = 0

      mock.onGet(`${BASE}/Vendor/V001`).replyWith(() => {
        callCount++

        if (callCount === 1) {
          const err = new Error('Unauthorized')

          err.statusCode = 401
          throw err
        }

        return { VendorID: { value: 'V001' } }
      })
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      const result = await service.validateVendor('V001')

      expect(result).toEqual({ VendorID: { value: 'V001' } })
      // https.request should have been called twice (initial login + re-login on 401)
      expect(https.request.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('login failure throws with HTTP status', async () => {
      restoreLogin()
      restoreLogin = mockLogin(403)

      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      await expect(service.listVendors()).rejects.toThrow('Login failed (HTTP 403)')
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('extracts exceptionMessage from error body', async () => {
      mock.onGet(`${BASE}/Bill`).replyWithError({
        message: 'Server Error',
        statusCode: 500,
        body: { exceptionMessage: 'Entity not found' },
      })
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      await expect(service.listBills()).rejects.toThrow('Entity not found')
    })

    it('extracts nested innerException message', async () => {
      mock.onGet(`${BASE}/Bill`).replyWithError({
        message: 'Server Error',
        statusCode: 500,
        body: {
          innerException: {
            innerException: {
              exceptionMessage: 'Deep nested error',
            },
          },
        },
      })
      mock.onPost(`${INSTANCE_URL}/entity/auth/logout`).reply({})

      await expect(service.listBills()).rejects.toThrow('Deep nested error')
    })
  })
})
