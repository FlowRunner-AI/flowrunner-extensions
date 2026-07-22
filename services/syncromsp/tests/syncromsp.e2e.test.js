'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('SyncroMSP Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('syncromsp')
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

  // ── Customers ──

  describe('listCustomers', () => {
    it('returns a paginated list of customers', async () => {
      const result = await service.listCustomers(1)

      expect(result).toHaveProperty('customers')
      expect(Array.isArray(result.customers)).toBe(true)
      expect(result).toHaveProperty('meta')
    })

    it('accepts a search query', async () => {
      const result = await service.listCustomers(1, 'zzz-unlikely-name')

      expect(Array.isArray(result.customers)).toBe(true)
    })
  })

  // ── Customer lifecycle (create → read → update → contacts/assets/tickets → delete) ──

  describe('customer lifecycle', () => {
    let customerId
    let contactId
    let assetId
    let ticketId

    it('creates a customer', async () => {
      const result = await service.createCustomer(
        `FlowRunner E2E ${ SUFFIX }`,
        'Test',
        'User',
        `e2e+${ SUFFIX }@example.com`,
        '555-0100',
        '1 Main St'
      )

      expect(result).toHaveProperty('customer')
      expect(result.customer).toHaveProperty('id')
      customerId = result.customer.id
    })

    it('gets the created customer', async () => {
      if (!customerId) {
        console.log('Skipping getCustomer: customer was not created')

        return
      }

      const result = await service.getCustomer(customerId)

      expect(result.customer).toHaveProperty('id', customerId)
    })

    it('updates the created customer', async () => {
      if (!customerId) {
        console.log('Skipping updateCustomer: customer was not created')

        return
      }

      const result = await service.updateCustomer(customerId, `FlowRunner E2E ${ SUFFIX } Updated`)

      expect(result).toHaveProperty('customer')
    })

    it('creates and reads a contact for the customer', async () => {
      if (!customerId) {
        console.log('Skipping createContact: customer was not created')

        return
      }

      const created = await service.createContact(
        customerId,
        `E2E Contact ${ SUFFIX }`,
        `contact+${ SUFFIX }@example.com`,
        '555-0111',
        'Created by e2e test'
      )

      expect(created).toHaveProperty('contact')
      contactId = created.contact.id

      const fetched = await service.getContact(contactId)

      expect(fetched.contact).toHaveProperty('id', contactId)
    })

    it('updates the contact', async () => {
      if (!contactId) {
        console.log('Skipping updateContact: contact was not created')

        return
      }

      const result = await service.updateContact(contactId, undefined, `updated+${ SUFFIX }@example.com`)

      expect(result).toHaveProperty('contact')
    })

    it('lists contacts scoped to the customer', async () => {
      if (!customerId) {
        console.log('Skipping listContacts: customer was not created')

        return
      }

      const result = await service.listContacts(customerId, 1)

      expect(Array.isArray(result.contacts)).toBe(true)
    })

    it('creates and reads an asset for the customer', async () => {
      if (!customerId) {
        console.log('Skipping createAsset: customer was not created')

        return
      }

      const created = await service.createAsset(`E2E-WS-${ SUFFIX }`, customerId, testValues.assetType)

      expect(created).toHaveProperty('asset')
      assetId = created.asset.id

      const fetched = await service.getAsset(assetId)

      expect(fetched.asset).toHaveProperty('id', assetId)
    })

    it('lists assets scoped to the customer', async () => {
      if (!customerId) {
        console.log('Skipping listAssets: customer was not created')

        return
      }

      const result = await service.listAssets(customerId, undefined, 1)

      expect(Array.isArray(result.assets)).toBe(true)
    })

    it('creates a ticket for the customer', async () => {
      if (!customerId) {
        console.log('Skipping createTicket: customer was not created')

        return
      }

      const result = await service.createTicket(
        `E2E Ticket ${ SUFFIX }`,
        customerId,
        testValues.problemType,
        undefined,
        'Normal',
        'Created by the FlowRunner e2e test suite.'
      )

      expect(result).toHaveProperty('ticket')
      ticketId = result.ticket.id
    })

    it('gets the created ticket', async () => {
      if (!ticketId) {
        console.log('Skipping getTicket: ticket was not created')

        return
      }

      const result = await service.getTicket(ticketId)

      expect(result.ticket).toHaveProperty('id', ticketId)
    })

    it('updates the created ticket', async () => {
      if (!ticketId) {
        console.log('Skipping updateTicket: ticket was not created')

        return
      }

      const result = await service.updateTicket(ticketId, `E2E Ticket ${ SUFFIX } Updated`, undefined, 'High')

      expect(result).toHaveProperty('ticket')
    })

    it('adds a hidden comment to the ticket', async () => {
      if (!ticketId) {
        console.log('Skipping createTicketComment: ticket was not created')

        return
      }

      const result = await service.createTicketComment(
        ticketId,
        'Internal note from the e2e test.',
        'E2E Update',
        true,
        true
      )

      expect(result).toBeDefined()
    })

    it('lists tickets scoped to the customer', async () => {
      if (!customerId) {
        console.log('Skipping listTickets: customer was not created')

        return
      }

      const result = await service.listTickets(1, undefined, customerId)

      expect(Array.isArray(result.tickets)).toBe(true)
    })

    it('creates and reads an invoice for the customer', async () => {
      if (!customerId) {
        console.log('Skipping createInvoice: customer was not created')

        return
      }

      const created = await service.createInvoice(customerId, [
        { name: 'E2E Labor', quantity: 1, price: 1 },
      ])

      expect(created).toHaveProperty('invoice')

      const invoiceId = created.invoice.id
      const fetched = await service.getInvoice(invoiceId)

      expect(fetched.invoice).toHaveProperty('id', invoiceId)
    })

    it('lists invoices scoped to the customer', async () => {
      if (!customerId) {
        console.log('Skipping listInvoices: customer was not created')

        return
      }

      const result = await service.listInvoices(customerId, 1)

      expect(Array.isArray(result.invoices)).toBe(true)
    })

    it('deletes the created ticket', async () => {
      if (!ticketId) {
        console.log('Skipping deleteTicket: ticket was not created')

        return
      }

      await expect(service.deleteTicket(ticketId)).resolves.toBeDefined()
    })

    it('deletes the created customer', async () => {
      if (!customerId) {
        console.log('Skipping deleteCustomer: customer was not created')

        return
      }

      await expect(service.deleteCustomer(customerId)).resolves.toBeDefined()
    })
  })

  // ── RMM Alerts ──

  describe('listRmmAlerts', () => {
    it('lists all alerts', async () => {
      const result = await service.listRmmAlerts(undefined, 1)

      expect(result).toHaveProperty('meta')
    })

    it('lists only unresolved alerts', async () => {
      const result = await service.listRmmAlerts(false, 1)

      expect(result).toHaveProperty('meta')
    })
  })

  describe('updateRmmAlert', () => {
    it('mutes an alert provided via testValues', async () => {
      const { rmmAlertId } = testValues

      if (!rmmAlertId) {
        console.log('Skipping updateRmmAlert: testValues.rmmAlertId not set')

        return
      }

      const result = await service.updateRmmAlert(rmmAlertId, undefined, true)

      expect(result).toBeDefined()
    })
  })

  // ── Products ──

  describe('listProducts', () => {
    it('returns a paginated list of products', async () => {
      const result = await service.listProducts(undefined, 1)

      expect(result).toHaveProperty('meta')
    })
  })

  // ── Dictionaries ──

  describe('getCustomersDictionary', () => {
    it('returns dictionary items for customers', async () => {
      const result = await service.getCustomersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      result.items.forEach(item => {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
      })
    })

    it('accepts a search term and returns an array', async () => {
      const result = await service.getCustomersDictionary({ search: 'zzz-unlikely-name' })

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a wrapped error for an unknown ticket', async () => {
      await expect(service.getTicket(999999999)).rejects.toThrow(/SyncroMSP API error/)
    })
  })
})
