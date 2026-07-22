'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('PayPal Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('paypal')
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

  // ── Orders ──

  describe('orders', () => {
    let orderId

    it('creates an order with the simple amount form', async () => {
      const result = await service.createOrder('Capture', '19.99', 'USD', 'FlowRunner e2e order')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('status', 'CREATED')
      expect(Array.isArray(result.links)).toBe(true)

      orderId = result.id
    })

    it('retrieves the created order', async () => {
      const result = await service.getOrder(orderId)

      expect(result).toHaveProperty('id', orderId)
      expect(result).toHaveProperty('purchase_units')
    })

    it('creates an order from a raw purchase units array', async () => {
      const result = await service.createOrder('Authorize', undefined, undefined, undefined, [
        { amount: { currency_code: 'USD', value: '5.00' }, description: 'Raw unit' },
      ])

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('status', 'CREATED')
    })

    it('fails to capture an order that was never approved', async () => {
      await expect(service.captureOrder(orderId)).rejects.toThrow(/PayPal API error/)
    })

    it('reports a descriptive error for an unknown order', async () => {
      await expect(service.getOrder('NON-EXISTENT-ORDER')).rejects.toThrow(/PayPal API error/)
    })
  })

  // ── Payments ──

  describe('payments', () => {
    it('reports a descriptive error for an unknown capture', async () => {
      await expect(service.getCapturedPayment('0000000000000000')).rejects.toThrow(/PayPal API error/)
    })

    it('reports a descriptive error for an unknown authorization', async () => {
      await expect(service.getAuthorizedPayment('0000000000000000')).rejects.toThrow(/PayPal API error/)
    })

    it('retrieves a captured payment when a capture id is configured', async () => {
      const { captureId } = testValues

      if (!captureId) {
        console.log('Skipping getCapturedPayment: testValues.captureId not set')

        return
      }

      const result = await service.getCapturedPayment(captureId)

      expect(result).toHaveProperty('id', captureId)
      expect(result).toHaveProperty('status')
    })

    it('refunds a captured payment when a refundable capture id is configured', async () => {
      const { refundableCaptureId } = testValues

      if (!refundableCaptureId) {
        console.log('Skipping refundCapturedPayment: testValues.refundableCaptureId not set')

        return
      }

      const result = await service.refundCapturedPayment(refundableCaptureId, '1.00', 'USD', 'e2e refund')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('status')
    })

    it('captures and voids an authorization when an authorization id is configured', async () => {
      const { authorizationId } = testValues

      if (!authorizationId) {
        console.log('Skipping authorization flow: testValues.authorizationId not set')

        return
      }

      const authorization = await service.getAuthorizedPayment(authorizationId)

      expect(authorization).toHaveProperty('id', authorizationId)

      await expect(service.voidAuthorizedPayment(authorizationId)).resolves.toBeDefined()
    })
  })

  // ── Invoicing ──

  describe('invoicing', () => {
    let invoiceId

    it('generates the next invoice number', async () => {
      const result = await service.generateInvoiceNumber()

      expect(result).toHaveProperty('invoice_number')
    })

    it('lists invoices with pagination', async () => {
      const result = await service.listInvoices(1, 5, true)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('total_items')
    })

    it('creates a draft invoice', async () => {
      const result = await service.createDraftInvoice({
        detail: {
          currency_code: 'USD',
          invoice_number: `FR-${ SUFFIX }`,
          note: 'FlowRunner e2e draft invoice',
        },
        items: [
          { name: 'E2E item', quantity: '1', unit_amount: { currency_code: 'USD', value: '9.99' } },
        ],
      })

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('status', 'DRAFT')

      invoiceId = result.id
    })

    it('retrieves the created draft invoice', async () => {
      const result = await service.getInvoice(invoiceId)

      expect(result).toHaveProperty('id', invoiceId)
      expect(result).toHaveProperty('detail')
    })

    it('deletes the created draft invoice', async () => {
      await expect(service.deleteInvoice(invoiceId)).resolves.toEqual({ success: true })
    })

    it('reports a descriptive error for an unknown invoice', async () => {
      await expect(service.getInvoice('INV2-0000-0000-0000-0000')).rejects.toThrow(/PayPal API error/)
    })
  })

  // ── Subscriptions ──

  describe('subscriptions', () => {
    it('lists billing plans', async () => {
      const result = await service.listPlans(undefined, 1, 5, true)

      expect(result).toHaveProperty('plans')
      expect(Array.isArray(result.plans)).toBe(true)
    })

    it('retrieves a plan when a plan id is configured', async () => {
      const { planId } = testValues

      if (!planId) {
        console.log('Skipping getPlan: testValues.planId not set')

        return
      }

      const result = await service.getPlan(planId)

      expect(result).toHaveProperty('id', planId)
      expect(result).toHaveProperty('status')
    })

    it('creates a subscription when a plan id is configured', async () => {
      const { planId } = testValues

      if (!planId) {
        console.log('Skipping createSubscription: testValues.planId not set')

        return
      }

      const created = await service.createSubscription(
        planId,
        'e2e-subscriber@example.com',
        'Flow',
        'Runner'
      )

      expect(created).toHaveProperty('id')
      expect(created).toHaveProperty('status')

      const fetched = await service.getSubscription(created.id)

      expect(fetched).toHaveProperty('id', created.id)
    })

    it('reports a descriptive error for an unknown subscription', async () => {
      await expect(service.getSubscription('I-0000000000')).rejects.toThrow(/PayPal API error/)
    })
  })

  // ── Payouts ──

  describe('payouts', () => {
    it('reports a descriptive error for an unknown payout batch', async () => {
      await expect(service.getPayoutBatch('0000000000000')).rejects.toThrow(/PayPal API error/)
    })

    it('creates a batch payout when a receiver is configured', async () => {
      const { payoutReceiverEmail } = testValues

      if (!payoutReceiverEmail) {
        console.log('Skipping createBatchPayout: testValues.payoutReceiverEmail not set')

        return
      }

      const created = await service.createBatchPayout(
        `fr-e2e-${ SUFFIX }`,
        'FlowRunner e2e payout',
        'Email',
        [{ receiver: payoutReceiverEmail, amount: '1.00', currency: 'USD', note: 'e2e' }]
      )

      expect(created).toHaveProperty('batch_header')

      const batchId = created.batch_header.payout_batch_id
      const fetched = await service.getPayoutBatch(batchId)

      expect(fetched.batch_header).toHaveProperty('payout_batch_id', batchId)
    })
  })
})
