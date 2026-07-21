'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('ClickSend Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('clicksend')
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

  // ── Static Dictionaries (no HTTP) ──

  describe('getSenderIDgroupsDictionary', () => {
    it('returns the static sender ID groups', () => {
      const result = service.getSenderIDgroupsDictionary()

      expect(result).toHaveProperty('items')
      expect(result.items.map(i => i.value)).toEqual(
        expect.arrayContaining(['Dedicated Numbers', 'Alpha Tags', 'Own numbers'])
      )
    })
  })

  describe('getHttpMethodsDictionary', () => {
    it('returns the static HTTP methods', () => {
      const result = service.getHttpMethodsDictionary()

      expect(result.items.map(i => i.value)).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
    })
  })

  // ── Dynamic Dictionaries ──

  describe('getVoiceLanguagesDictionary', () => {
    it('returns voice language items with expected shape', async () => {
      const result = await service.getVoiceLanguagesDictionary()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      if (result.items.length) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getContactListsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getContactListsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getReturnAddressesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getReturnAddressesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getSenderContactsDictionary', () => {
    it('returns dedicated numbers items array', async () => {
      const result = await service.getSenderContactsDictionary({
        criteria: { senderIDgroup: 'Dedicated Numbers' },
      })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('returns alpha tags items array', async () => {
      const result = await service.getSenderContactsDictionary({
        criteria: { senderIDgroup: 'Alpha Tags' },
      })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('returns own numbers items array', async () => {
      const result = await service.getSenderContactsDictionary({
        criteria: { senderIDgroup: 'Own numbers' },
      })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Raw request ──

  describe('clickSendApiRequest', () => {
    it('performs a raw GET request against the account endpoint', async () => {
      const result = await service.clickSendApiRequest('GET', '/account', '', 'null')

      // ClickSend wraps account data in an object; just confirm we got a response.
      expect(result).toBeDefined()
    })
  })

  // ── Contact Lifecycle (create list, contact, search, update, delete) ──

  describe('contact list + contact lifecycle', () => {
    let listId
    let contactId

    it('creates a contact list', async () => {
      const result = await service.createContactList(`E2E List ${ suffix }`)

      expect(result).toHaveProperty('list_id')
      listId = result.list_id
    })

    it('finds the created list by name', async () => {
      const result = await service.searchContactListByName(`E2E List ${ suffix }`)

      expect(result).toHaveProperty('contactListFound', true)
      expect(result).toHaveProperty('list_id', listId)
    })

    it('lists contacts (dictionary) in the empty list', async () => {
      const result = await service.getListContactsDictionary({
        criteria: { list_id: listId },
      })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('creates a contact in the list', async () => {
      const email = `e2e-${ suffix }@example.com`
      const result = await service.createContact(
        listId,
        undefined,
        email,
        undefined,
        'E2E',
        'Tester'
      )

      expect(result).toHaveProperty('contact_id')
      contactId = result.contact_id
    })

    it('reads contact details (dictionary)', async () => {
      const result = await service.getContactDetailsDictionary({
        criteria: { list_id: listId, contact_id: contactId },
      })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('searches the contact by email', async () => {
      const result = await service.searchContactByEmail(listId, `e2e-${ suffix }@example.com`)

      expect(result).toHaveProperty('contactFound', true)
      expect(result).toHaveProperty('contact_id', contactId)
    })

    it('updates the contact', async () => {
      const result = await service.updateContact(
        listId,
        contactId,
        undefined,
        `e2e-${ suffix }@example.com`,
        undefined,
        'Updated',
        'Name'
      )

      expect(result).toHaveProperty('contact_id', contactId)
      expect(result).toHaveProperty('first_name', 'Updated')
    })

    it('deletes the contact', async () => {
      const result = await service.deleteContact(listId, contactId)

      expect(result).toBe(contactId)
    })

    it('deletes the contact list', async () => {
      const result = await service.deleteContactList(listId)

      expect(result).toBe(listId)
    })
  })

  // ── SMS (live send — consumes credits) ──

  describe('sendSms', () => {
    // Sending real SMS consumes credits and needs a real recipient, so this
    // only runs when the developer supplies testValues.smsRecipient.
    it('sends an SMS when a recipient is configured', async () => {
      if (!testValues.smsRecipient) {
        console.log('Skipping sendSms: set testValues.smsRecipient (and optionally smsFrom)')
        return
      }

      const result = await service.sendSms(
        testValues.smsRecipient,
        `E2E test SMS ${ suffix }`,
        undefined,
        testValues.smsFrom
      )

      expect(result).toHaveProperty('status')
    })
  })

  // ── Voice (live send — consumes credits) ──

  describe('sendVoiceMessage', () => {
    it('sends a voice message when a recipient is configured', async () => {
      if (!testValues.voiceRecipient) {
        console.log('Skipping sendVoiceMessage: set testValues.voiceRecipient')
        return
      }

      const result = await service.sendVoiceMessage(
        testValues.voiceRecipient,
        undefined,
        testValues.smsFrom,
        `E2E test voice message ${ suffix }`,
        'Female',
        'en-us'
      )

      expect(result).toHaveProperty('status')
    })
  })

  // ── Fax (live send — consumes credits) ──

  describe('sendFax', () => {
    it('sends a fax when recipient, sender and a PDF URL are configured', async () => {
      const canSend = testValues.faxTo && testValues.faxFrom && testValues.pdfUrl

      if (!canSend) {
        console.log('Skipping sendFax: set testValues.faxTo, faxFrom and pdfUrl')
        return
      }

      const result = await service.sendFax(
        undefined,
        undefined,
        testValues.faxTo,
        testValues.faxFrom,
        testValues.pdfUrl
      )

      expect(result).toHaveProperty('status')
    })
  })
})
