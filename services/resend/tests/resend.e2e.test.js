'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Resend Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('resend')
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

  // ── Domains ──

  describe('listDomains', () => {
    it('returns domains list with expected shape', async () => {
      const result = await service.listDomains()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('getDomain', () => {
    it('retrieves a domain by ID', async () => {
      const { domainId } = testValues

      if (!domainId) {
        console.log('Skipping getDomain: testValues.domainId not set')
        return
      }

      const result = await service.getDomain(domainId)

      expect(result).toHaveProperty('id', domainId)
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('status')
    })
  })

  // ── API Keys ──

  describe('listApiKeys', () => {
    it('returns API keys list with expected shape', async () => {
      const result = await service.listApiKeys()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Audiences lifecycle ──

  describe('audience + contact lifecycle', () => {
    let audienceId
    let contactId

    it('creates an audience', async () => {
      const result = await service.createAudience('E2E Test Audience')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Audience')
      audienceId = result.id
    })

    it('lists audiences', async () => {
      const result = await service.listAudiences()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('gets the created audience', async () => {
      if (!audienceId) {
        console.log('Skipping getAudience: audience was not created')
        return
      }

      const result = await service.getAudience(audienceId)

      expect(result).toHaveProperty('id', audienceId)
      expect(result).toHaveProperty('name', 'E2E Test Audience')
    })

    it('creates a contact in the audience', async () => {
      if (!audienceId) {
        console.log('Skipping createContact: audience was not created')
        return
      }

      const result = await service.createContact(audienceId, 'e2e-test@example.com', 'E2E', 'Test')

      expect(result).toHaveProperty('id')
      contactId = result.id
    })

    it('lists contacts in the audience', async () => {
      if (!audienceId) {
        console.log('Skipping listContacts: audience was not created')
        return
      }

      const result = await service.listContacts(audienceId)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('gets the created contact', async () => {
      if (!audienceId || !contactId) {
        console.log('Skipping getContact: audience or contact was not created')
        return
      }

      const result = await service.getContact(audienceId, contactId)

      expect(result).toHaveProperty('id', contactId)
      expect(result).toHaveProperty('email', 'e2e-test@example.com')
    })

    it('updates the contact', async () => {
      if (!audienceId || !contactId) {
        console.log('Skipping updateContact: audience or contact was not created')
        return
      }

      const result = await service.updateContact(audienceId, contactId, 'Updated', 'Name')

      expect(result).toHaveProperty('id')
    })

    it('deletes the contact', async () => {
      if (!audienceId || !contactId) {
        console.log('Skipping deleteContact: audience or contact was not created')
        return
      }

      const result = await service.deleteContact(audienceId, contactId)

      expect(result).toHaveProperty('deleted', true)
    })

    it('deletes the audience', async () => {
      if (!audienceId) {
        console.log('Skipping deleteAudience: audience was not created')
        return
      }

      const result = await service.deleteAudience(audienceId)

      expect(result).toHaveProperty('deleted', true)
    })
  })

  // ── Emails ──

  describe('sendEmail + getEmail', () => {
    it('sends an email and retrieves it', async () => {
      const { senderEmail } = testValues

      if (!senderEmail) {
        console.log('Skipping sendEmail: testValues.senderEmail not set')
        return
      }

      const sendResult = await service.sendEmail(
        senderEmail, ['delivered@resend.dev'], 'E2E Test Email',
        '<p>This is a test email from e2e tests.</p>', 'E2E test plain text'
      )

      expect(sendResult).toHaveProperty('id')

      const getResult = await service.getEmail(sendResult.id)

      expect(getResult).toHaveProperty('id', sendResult.id)
      expect(getResult).toHaveProperty('subject', 'E2E Test Email')
    })
  })

  describe('sendBatchEmails', () => {
    it('sends a batch of emails', async () => {
      const { senderEmail } = testValues

      if (!senderEmail) {
        console.log('Skipping sendBatchEmails: testValues.senderEmail not set')
        return
      }

      const result = await service.sendBatchEmails([
        {
          from: senderEmail,
          to: ['delivered@resend.dev'],
          subject: 'E2E Batch 1',
          html: '<p>Batch email 1</p>',
        },
        {
          from: senderEmail,
          to: ['delivered@resend.dev'],
          subject: 'E2E Batch 2',
          text: 'Batch email 2',
        },
      ])

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveLength(2)
      expect(result.data[0]).toHaveProperty('id')
    })
  })

  // ── Broadcasts lifecycle ──

  describe('broadcast lifecycle', () => {
    let broadcastId
    let tempAudienceId

    it('creates a temporary audience for broadcast', async () => {
      const result = await service.createAudience('E2E Broadcast Audience')

      expect(result).toHaveProperty('id')
      tempAudienceId = result.id
    })

    it('creates a broadcast', async () => {
      const { senderEmail } = testValues

      if (!tempAudienceId || !senderEmail) {
        console.log('Skipping createBroadcast: audience not created or testValues.senderEmail not set')
        return
      }

      const result = await service.createBroadcast(
        tempAudienceId, senderEmail, 'E2E Broadcast Test',
        '<p>E2E broadcast content</p>', null, 'E2E Test Broadcast'
      )

      expect(result).toHaveProperty('id')
      broadcastId = result.id
    })

    it('lists broadcasts', async () => {
      const result = await service.listBroadcasts()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('gets the created broadcast', async () => {
      if (!broadcastId) {
        console.log('Skipping getBroadcast: broadcast was not created')
        return
      }

      const result = await service.getBroadcast(broadcastId)

      expect(result).toHaveProperty('id', broadcastId)
      expect(result).toHaveProperty('status')
    })

    it('updates the broadcast', async () => {
      if (!broadcastId) {
        console.log('Skipping updateBroadcast: broadcast was not created')
        return
      }

      const result = await service.updateBroadcast(broadcastId, null, null, 'Updated Subject')

      expect(result).toHaveProperty('id')
    })

    it('deletes the broadcast', async () => {
      if (!broadcastId) {
        console.log('Skipping deleteBroadcast: broadcast was not created')
        return
      }

      const result = await service.deleteBroadcast(broadcastId)

      expect(result).toHaveProperty('deleted', true)
    })

    it('cleans up temporary audience', async () => {
      if (!tempAudienceId) {
        console.log('Skipping cleanup: temp audience was not created')
        return
      }

      const result = await service.deleteAudience(tempAudienceId)

      expect(result).toHaveProperty('deleted', true)
    })
  })

  // ── Dictionaries ──

  describe('getDomainsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getDomainsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  describe('getAudiencesDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getAudiencesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  describe('getBroadcastsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getBroadcastsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  describe('getContactsDictionary', () => {
    it('returns empty when no audienceId', async () => {
      const result = await service.getContactsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})
