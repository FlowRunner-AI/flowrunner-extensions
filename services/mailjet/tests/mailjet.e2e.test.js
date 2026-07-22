'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Mailjet Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('mailjet')
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

  const suffix = Date.now()

  // ── Contacts ──

  describe('createContact + getContact + updateContact + updateContactProperties + deleteContact', () => {
    let contactEmail
    let contactId

    it('creates a contact', async () => {
      contactEmail = `e2e-mailjet-${ suffix }@example.com`

      const result = await service.createContact(contactEmail, 'E2E Tester')

      expect(result).toHaveProperty('ID')
      expect(result).toHaveProperty('Email')
      contactId = result.ID
    })

    it('retrieves the created contact by email', async () => {
      const result = await service.getContact(contactEmail)

      expect(result).toHaveProperty('ID', contactId)
      expect(result).toHaveProperty('Email')
    })

    it('retrieves the created contact by ID', async () => {
      const result = await service.getContact(String(contactId))

      expect(result).toHaveProperty('ID', contactId)
    })

    it('updates the contact name', async () => {
      const result = await service.updateContact(String(contactId), 'Updated Name')

      expect(result).toHaveProperty('ID', contactId)
    })

    it('deletes the contact', async () => {
      const result = await service.deleteContact(String(contactId))

      expect(result).toEqual({ success: true, contactId: String(contactId) })
    })
  })

  describe('listContacts', () => {
    it('returns contacts with expected shape', async () => {
      const result = await service.listContacts(5, 0)

      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Contact Lists ──

  describe('createContactList + listContactLists + manageListSubscription', () => {
    let listId
    let contactEmail

    it('creates a contact list', async () => {
      const result = await service.createContactList(`E2E List ${ suffix }`)

      expect(result).toHaveProperty('ID')
      expect(result).toHaveProperty('Name')
      listId = result.ID
    })

    it('subscribes a contact to the list', async () => {
      contactEmail = `e2e-list-member-${ suffix }@example.com`

      const result = await service.manageListSubscription(
        String(listId), contactEmail, 'Add Force', 'E2E Member'
      )

      expect(result).toHaveProperty('ContactID')
    })

    it('unsubscribes the contact from the list', async () => {
      const result = await service.manageListSubscription(
        String(listId), contactEmail, 'Unsubscribe'
      )

      expect(result).toHaveProperty('ContactID')
    })

    it('removes the contact from the list', async () => {
      const result = await service.manageListSubscription(
        String(listId), contactEmail, 'Remove'
      )

      expect(result).toHaveProperty('ContactID')
    })

    afterAll(async () => {
      // Clean up the contact created by manageListSubscription
      if (contactEmail) {
        try {
          const contact = await service.getContact(contactEmail)

          if (contact && contact.ID) {
            await service.deleteContact(String(contact.ID))
          }
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })

  describe('listContactLists', () => {
    it('returns contact lists with expected shape', async () => {
      const result = await service.listContactLists(5, 0)

      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Templates ──

  describe('listTemplates', () => {
    it('returns templates with expected shape', async () => {
      const result = await service.listTemplates(5, 0)

      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Messages & Statistics ──

  describe('listMessages', () => {
    it('returns messages with expected shape', async () => {
      const result = await service.listMessages(undefined, undefined, undefined, 5, 0)

      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('getStatCounters', () => {
    it('returns stat counters with expected shape', async () => {
      const result = await service.getStatCounters('API Key', 'Message', 'Lifetime')

      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Dictionary Methods ──

  describe('getContactListsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getContactListsDictionary({})

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

  // ── Email Sending (live send) ──

  describe('sendEmail', () => {
    const canSend = () => Boolean(testValues.senderEmail && testValues.recipientEmail)

    it('sends an email when sender and recipient are configured', async () => {
      if (!canSend()) {
        console.log('Skipping sendEmail: set testValues.senderEmail and testValues.recipientEmail')
        return
      }

      const result = await service.sendEmail(
        testValues.senderEmail,
        'E2E Sender',
        [testValues.recipientEmail],
        undefined,
        undefined,
        `E2E Mailjet test email ${ suffix }`,
        'This is an automated e2e test email.',
        '<p>This is an automated e2e test email.</p>'
      )

      expect(result).toHaveProperty('Status', 'success')
      expect(result).toHaveProperty('To')
      expect(Array.isArray(result.To)).toBe(true)
    })

    it('validates with sandbox mode without sending', async () => {
      if (!canSend()) {
        console.log('Skipping sendEmail sandbox: set testValues.senderEmail and testValues.recipientEmail')
        return
      }

      const result = await service.sendEmail(
        testValues.senderEmail,
        'E2E Sender',
        [testValues.recipientEmail],
        undefined,
        undefined,
        `E2E sandbox test ${ suffix }`,
        'Sandbox test.',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true // sandboxMode
      )

      expect(result).toHaveProperty('Status', 'success')
    })
  })

  describe('sendBulkEmails', () => {
    const canSend = () => Boolean(testValues.senderEmail && testValues.recipientEmail)

    it('sends bulk emails in sandbox mode', async () => {
      if (!canSend()) {
        console.log('Skipping sendBulkEmails: set testValues.senderEmail and testValues.recipientEmail')
        return
      }

      const result = await service.sendBulkEmails(
        [{
          From: { Email: testValues.senderEmail, Name: 'E2E Bulk' },
          To: [{ Email: testValues.recipientEmail }],
          Subject: `E2E bulk test ${ suffix }`,
          TextPart: 'Bulk test message.',
        }],
        true // sandboxMode
      )

      expect(result).toHaveProperty('Messages')
      expect(Array.isArray(result.Messages)).toBe(true)
    })
  })

  // ── getMessage / getMessageHistory ──

  describe('getMessage + getMessageHistory', () => {
    it('fetches a message by ID when testValues.messageId is set', async () => {
      if (!testValues.messageId) {
        console.log('Skipping getMessage: set testValues.messageId')
        return
      }

      const result = await service.getMessage(testValues.messageId)

      expect(result).toHaveProperty('ID')
      expect(result).toHaveProperty('Status')
    })

    it('fetches message history when testValues.messageId is set', async () => {
      if (!testValues.messageId) {
        console.log('Skipping getMessageHistory: set testValues.messageId')
        return
      }

      const result = await service.getMessageHistory(testValues.messageId)

      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })
})
