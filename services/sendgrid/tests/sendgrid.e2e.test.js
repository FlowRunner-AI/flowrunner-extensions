'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('SendGrid Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('sendgrid')
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

  // ── Senders ──

  describe('getVerifiedSenders', () => {
    it('returns the verified sender identities', async () => {
      const result = await service.getVerifiedSenders(10)

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })
  })

  describe('getVerifiedSendersDictionary', () => {
    it('returns dictionary items keyed by sender email', async () => {
      const result = await service.getVerifiedSendersDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()

      result.items.forEach(item => {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
      })
    })
  })

  // ── Lists ──

  describe('list lifecycle', () => {
    let listId

    it('creates a list', async () => {
      const result = await service.createList(`flowrunner-e2e-${ SUFFIX }`)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', `flowrunner-e2e-${ SUFFIX }`)

      listId = result.id
    })

    it('finds the list among all lists', async () => {
      const result = await service.getLists(100)

      expect(Array.isArray(result.result)).toBe(true)
      expect(result.result.some(list => list.id === listId)).toBe(true)
    })

    it('exposes the list through the lists dictionary', async () => {
      const result = await service.getListsDictionary({ search: `flowrunner-e2e-${ SUFFIX }` })

      expect(result.items.some(item => item.value === listId)).toBe(true)
    })

    it('deletes the list', async () => {
      const result = await service.deleteList(listId)

      expect(result).toBeDefined()
    })
  })

  // ── Templates ──

  describe('templates', () => {
    it('lists dynamic templates', async () => {
      const result = await service.listDynamicTemplates(10)

      expect(result).toHaveProperty('result')
      expect(Array.isArray(result.result)).toBe(true)
    })

    it('returns templates as dictionary items', async () => {
      const result = await service.getTemplatesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Suppressions ──

  describe('suppressions', () => {
    const email = `flowrunner-e2e-${ SUFFIX }@example.com`

    it('lists global unsubscribes', async () => {
      const result = await service.listGlobalUnsubscribes(undefined, undefined, 10, 0)

      expect(Array.isArray(result)).toBe(true)
    })

    it('adds and removes a global unsubscribe', async () => {
      const added = await service.addGlobalUnsubscribes([email])

      expect(added).toHaveProperty('recipient_emails')

      const removed = await service.deleteGlobalUnsubscribe(email)

      expect(removed).toEqual({ deleted: true, email })
    })

    it('lists bounces', async () => {
      const result = await service.listBounces()

      expect(Array.isArray(result)).toBe(true)
    })

    it('removes a non-existent address from the bounce list', async () => {
      const result = await service.deleteBounces([email])

      expect(result).toEqual({ deleted: true })
    })

    it('rejects a delete with neither emails nor the delete-all flag', async () => {
      await expect(service.deleteBounces()).rejects.toThrow(/provide Emails or enable Delete All/)
    })
  })

  // ── Statistics ──

  describe('getEmailStats', () => {
    it('returns statistics for a date range', async () => {
      const result = await service.getEmailStats('2026-01-01', undefined, 'Month')

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Contacts ──

  describe('contacts', () => {
    it('upserts and searches a contact when a test email is configured', async () => {
      const { contactEmail } = testValues

      if (!contactEmail) {
        console.log('Skipping upsertContacts/searchContacts: testValues.contactEmail not set')

        return
      }

      const upserted = await service.upsertContacts([{ email: contactEmail, first_name: 'FlowRunner' }])

      expect(upserted).toHaveProperty('job_id')

      const searched = await service.searchContacts(`email = '${ contactEmail }'`)

      expect(searched).toHaveProperty('contact_count')
    })

    it('rejects a delete with neither ids nor the delete-all flag', async () => {
      await expect(service.deleteContacts([])).rejects.toThrow(/provide Contact IDs or enable Delete All/)
    })
  })

  // ── Email ──

  describe('sendEmail', () => {
    it('queues a plain-text email when sender and recipient are configured', async () => {
      const { fromEmail, recipientEmail } = testValues

      if (!fromEmail || !recipientEmail) {
        console.log('Skipping sendEmail: testValues.fromEmail or testValues.recipientEmail not set')

        return
      }

      const result = await service.sendEmail(
        fromEmail,
        'FlowRunner E2E',
        recipientEmail,
        null,
        null,
        `FlowRunner e2e ${ SUFFIX }`,
        'Sent by the FlowRunner e2e suite.',
        '<p>Sent by the FlowRunner e2e suite.</p>'
      )

      expect(result).toEqual({ queued: true })
    })

    it('rejects when no content is provided', async () => {
      await expect(
        service.sendEmail('from@example.com', null, 'to@example.com', null, null, 'Subject')
      ).rejects.toThrow(/provide Text Content, HTML Content, or both/)
    })
  })

  describe('sendTemplatedEmail', () => {
    it('queues a templated email when a template is configured', async () => {
      const { fromEmail, recipientEmail, templateId } = testValues

      if (!fromEmail || !recipientEmail || !templateId) {
        console.log('Skipping sendTemplatedEmail: testValues.fromEmail, recipientEmail or templateId not set')

        return
      }

      const result = await service.sendTemplatedEmail(
        fromEmail,
        'FlowRunner E2E',
        recipientEmail,
        null,
        null,
        templateId,
        { firstName: 'FlowRunner' }
      )

      expect(result).toEqual({ queued: true })
    })
  })

  // ── Validation ──

  describe('validateEmail', () => {
    it('validates an address when the account has Email Validation enabled', async () => {
      const { validationEnabled } = testValues

      if (!validationEnabled) {
        console.log('Skipping validateEmail: testValues.validationEnabled not set to true')

        return
      }

      const result = await service.validateEmail('jane@example.com', 'signup')

      expect(result).toHaveProperty('result')
      expect(result.result).toHaveProperty('verdict')
    })
  })
})
