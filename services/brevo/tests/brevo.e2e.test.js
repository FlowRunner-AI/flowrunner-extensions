'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Brevo Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('brevo')
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

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // ── Account ──

  describe('getAccountInfo', () => {
    it('returns account info with expected shape', async () => {
      const response = await service.getAccountInfo()

      expect(response).toHaveProperty('email')
      expect(response).toHaveProperty('plan')
      expect(Array.isArray(response.plan)).toBe(true)
    })
  })

  // ── Email Sending ──

  describe('getSenders', () => {
    it('returns senders with expected shape', async () => {
      const response = await service.getSenders()

      expect(response).toHaveProperty('senders')
      expect(Array.isArray(response.senders)).toBe(true)
    })
  })

  describe('getEmailTemplates', () => {
    it('returns templates with expected shape', async () => {
      const response = await service.getEmailTemplates(5, 0)

      expect(response).toHaveProperty('templates')
      expect(Array.isArray(response.templates)).toBe(true)
    })
  })

  describe('getTransactionalEmails', () => {
    it('returns transactional emails with expected shape', async () => {
      const response = await service.getTransactionalEmails(undefined, undefined, 5, 0)

      expect(response).toHaveProperty('transactionalEmails')
      expect(Array.isArray(response.transactionalEmails)).toBe(true)
    })
  })

  describe('getEmailStatistics', () => {
    it('returns aggregated email statistics', async () => {
      const response = await service.getEmailStatistics(undefined, undefined, 7)

      expect(response).toHaveProperty('requests')
      expect(response).toHaveProperty('delivered')
    })
  })

  // ── Contacts ──

  describe('createContact + getContact + updateContact + deleteContact', () => {
    let email

    it('creates a contact', async () => {
      email = `e2e-contact-${ suffix }@example.com`

      const response = await service.createContact(email, 'E2E', 'Tester')

      expect(response).toHaveProperty('id')
    })

    it('retrieves the created contact', async () => {
      const response = await service.getContact(email)

      expect(response).toHaveProperty('email', email.toLowerCase())
      expect(response).toHaveProperty('id')
    })

    it('updates the contact', async () => {
      const response = await service.updateContact(email, undefined, 'Updated', 'Name')

      expect(response).toEqual({ success: true })
    })

    it('deletes the contact', async () => {
      const response = await service.deleteContact(email)

      expect(response).toEqual({ success: true })
    })
  })

  describe('getContacts', () => {
    it('returns contacts with expected shape', async () => {
      const response = await service.getContacts(5, 0)

      expect(response).toHaveProperty('contacts')
      expect(Array.isArray(response.contacts)).toBe(true)
    })
  })

  describe('getContactsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getContactsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Contact Lists ──

  describe('createList + getListContacts + add/remove contacts', () => {
    let listId
    let contactEmail

    it('creates a list', async () => {
      const response = await service.createList(`E2E List ${ suffix }`)

      expect(response).toHaveProperty('id')
      listId = response.id
    })

    it('lists contacts in the (empty) list', async () => {
      const response = await service.getListContacts(listId, 5, 0)

      expect(response).toHaveProperty('contacts')
      expect(Array.isArray(response.contacts)).toBe(true)
    })

    it('adds a contact to the list', async () => {
      contactEmail = `e2e-list-member-${ suffix }@example.com`
      await service.createContact(contactEmail, 'List', 'Member')

      const response = await service.addContactsToList(listId, contactEmail)

      expect(response).toHaveProperty('contacts')
    })

    it('removes the contact from the list', async () => {
      const response = await service.removeContactsFromList(listId, contactEmail)

      expect(response).toHaveProperty('contacts')
    })

    afterAll(async () => {
      if (contactEmail) {
        try {
          await service.deleteContact(contactEmail)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })

  describe('getLists', () => {
    it('returns lists with expected shape', async () => {
      const response = await service.getLists(5, 0)

      expect(response).toHaveProperty('lists')
      expect(Array.isArray(response.lists)).toBe(true)
    })
  })

  describe('getListsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getListsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getSendersDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getSendersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getTemplatesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getTemplatesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── CRM - Deals ──

  describe('createDeal + getDeal + updateDeal + deleteDeal', () => {
    let dealId

    it('creates a deal', async () => {
      const response = await service.createDeal(`E2E Deal ${ suffix }`)

      expect(response).toHaveProperty('id')
      dealId = response.id
    })

    it('retrieves the created deal', async () => {
      const response = await service.getDeal(dealId)

      expect(response).toHaveProperty('id', dealId)
      expect(response).toHaveProperty('attributes')
    })

    it('updates the deal', async () => {
      const response = await service.updateDeal(dealId, `E2E Deal Updated ${ suffix }`)

      expect(response).toEqual({ success: true })
    })

    it('deletes the deal', async () => {
      const response = await service.deleteDeal(dealId)

      expect(response).toEqual({ success: true })
    })
  })

  describe('getDeals', () => {
    it('returns deals with expected shape', async () => {
      const response = await service.getDeals(5, 0)

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  describe('getPipelinesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getPipelinesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── CRM - Companies ──

  describe('createCompany + getCompany + updateCompany + deleteCompany', () => {
    let companyId

    it('creates a company', async () => {
      const response = await service.createCompany(`E2E Company ${ suffix }`)

      expect(response).toHaveProperty('id')
      companyId = response.id
    })

    it('retrieves the created company', async () => {
      const response = await service.getCompany(companyId)

      expect(response).toHaveProperty('id', companyId)
      expect(response).toHaveProperty('attributes')
    })

    it('updates the company', async () => {
      const response = await service.updateCompany(companyId, `E2E Company Updated ${ suffix }`)

      expect(response).toEqual({ success: true })
    })

    it('deletes the company', async () => {
      const response = await service.deleteCompany(companyId)

      expect(response).toEqual({ success: true })
    })
  })

  describe('getCompanies', () => {
    it('returns companies with expected shape', async () => {
      const response = await service.getCompanies(5, 0)

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  // ── CRM - Tasks ──

  describe('createTask + getTask + updateTask + deleteTask', () => {
    let taskId

    it('creates a task', async () => {
      // taskTypeId is optional but a valid task type may be required by the API.
      // testValues.taskTypeId lets the developer supply a real one if needed.
      const response = await service.createTask(
        `E2E Task ${ suffix }`,
        testValues.taskTypeId,
        new Date().toISOString()
      )

      expect(response).toHaveProperty('id')
      taskId = response.id
    })

    it('retrieves the created task', async () => {
      const response = await service.getTask(taskId)

      expect(response).toHaveProperty('id', taskId)
    })

    it('updates the task', async () => {
      const response = await service.updateTask(taskId, `E2E Task Updated ${ suffix }`, true)

      expect(response).toEqual({ success: true })
    })

    it('deletes the task', async () => {
      const response = await service.deleteTask(taskId)

      expect(response).toEqual({ success: true })
    })
  })

  describe('getTasks', () => {
    it('returns tasks with expected shape', async () => {
      const response = await service.getTasks(5, 0)

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  // ── CRM - Notes ──

  describe('createNote + getNote + updateNote + deleteNote', () => {
    let noteId

    it('creates a note', async () => {
      const response = await service.createNote(`E2E note ${ suffix }`)

      expect(response).toHaveProperty('id')
      noteId = response.id
    })

    it('retrieves the created note', async () => {
      const response = await service.getNote(noteId)

      expect(response).toHaveProperty('id', noteId)
    })

    it('updates the note', async () => {
      const response = await service.updateNote(noteId, `E2E note updated ${ suffix }`)

      expect(response).toEqual({ success: true })
    })

    it('deletes the note', async () => {
      const response = await service.deleteNote(noteId)

      expect(response).toEqual({ success: true })
    })
  })

  // ── SMS ──

  describe('getSMSStatistics', () => {
    it('returns aggregated SMS statistics', async () => {
      const response = await service.getSMSStatistics(undefined, undefined, 7)

      expect(response).toHaveProperty('requests')
    })
  })

  describe('sendTransactionalSMS', () => {
    // Sending real SMS consumes credits and needs a real recipient, so this
    // only runs when the developer supplies testValues.smsSender + smsRecipient.
    const canSend = () => Boolean(testValues.smsSender && testValues.smsRecipient)

    it('sends an SMS when sender and recipient are configured', async () => {
      if (!canSend()) {
        console.log('Skipping sendTransactionalSMS: set testValues.smsSender and testValues.smsRecipient')
        return
      }

      const response = await service.sendTransactionalSMS(
        testValues.smsSender,
        testValues.smsRecipient,
        `E2E test SMS ${ suffix }`
      )

      expect(response).toHaveProperty('messageId')
    })
  })

  // ── Email Sending (live send) ──

  describe('sendTransactionalEmail', () => {
    // Sending a real email needs a verified sender and a recipient, so this
    // only runs when the developer supplies testValues.senderEmail + recipientEmail.
    const canSend = () => Boolean(testValues.senderEmail && testValues.recipientEmail)

    it('sends a transactional email when sender and recipient are configured', async () => {
      if (!canSend()) {
        console.log(
          'Skipping sendTransactionalEmail: set testValues.senderEmail and testValues.recipientEmail'
        )
        return
      }

      const response = await service.sendTransactionalEmail(
        testValues.senderEmail,
        'E2E Sender',
        testValues.recipientEmail,
        'E2E Recipient',
        `E2E test email ${ suffix }`,
        '<p>This is an automated e2e test email.</p>'
      )

      expect(response).toHaveProperty('messageId')
    })
  })
})
