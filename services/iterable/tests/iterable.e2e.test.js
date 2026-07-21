'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Iterable Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('iterable')
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
  const testEmail = `e2e-user-${ suffix }@example.com`

  // ── Users ──

  describe('getUserFields', () => {
    it('returns the user field schema', async () => {
      const response = await service.getUserFields()

      expect(response).toHaveProperty('fields')
      expect(typeof response.fields).toBe('object')
    })
  })

  describe('updateUser + getUser + trackEvent + updateSubscriptions + deleteUser', () => {
    it('creates/updates a user', async () => {
      const response = await service.updateUser(testEmail, undefined, {
        firstName: 'E2E',
        plan: 'test',
      })

      expect(response).toHaveProperty('code', 'Success')
    })

    it('retrieves the created user', async () => {
      const response = await service.getUser(testEmail)

      expect(response).toHaveProperty('user')
      expect(response.user).toHaveProperty('email', testEmail)
    })

    it('tracks a custom event for the user', async () => {
      const response = await service.trackEvent('e2e_test_event', testEmail, undefined, {
        source: 'e2e',
      })

      expect(response).toHaveProperty('code', 'Success')
    })

    it('updates the user subscriptions', async () => {
      const response = await service.updateSubscriptions(testEmail, undefined, [])

      expect(response).toHaveProperty('code', 'Success')
    })

    it('deletes the user', async () => {
      const response = await service.deleteUser(testEmail)

      expect(response).toHaveProperty('code', 'Success')
    })
  })

  describe('bulkUpdateUsers', () => {
    let bulkEmail

    it('bulk creates a user then cleans it up', async () => {
      bulkEmail = `e2e-bulk-${ suffix }@example.com`

      const response = await service.bulkUpdateUsers([
        { email: bulkEmail, dataFields: { plan: 'bulk' } },
      ])

      expect(response).toHaveProperty('successCount')
    })

    afterAll(async () => {
      if (bulkEmail) {
        try {
          await service.deleteUser(bulkEmail)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })

  describe('trackBulkEvents', () => {
    it('tracks a batch of events', async () => {
      const response = await service.trackBulkEvents([
        { email: testEmail, eventName: 'e2e_bulk_event', dataFields: { source: 'e2e' } },
      ])

      expect(response).toHaveProperty('successCount')
    })
  })

  // ── Lists ──

  describe('getLists', () => {
    it('returns lists with expected shape', async () => {
      const response = await service.getLists()

      expect(response).toHaveProperty('lists')
      expect(Array.isArray(response.lists)).toBe(true)
    })
  })

  describe('getListsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getListsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  describe('createList + subscribe + size/users + unsubscribe + deleteList', () => {
    let listId
    const subscriberEmail = `e2e-list-member-${ suffix }@example.com`

    it('creates a list', async () => {
      const response = await service.createList(`E2E List ${ suffix }`)

      expect(response).toHaveProperty('listId')
      listId = response.listId
    })

    it('subscribes a user to the list', async () => {
      const response = await service.subscribeToList(listId, [{ email: subscriberEmail }])

      expect(response).toHaveProperty('successCount')
    })

    it('returns the list size', async () => {
      const response = await service.getListSize(listId)

      expect(response).toHaveProperty('size')
      expect(typeof response.size).toBe('number')
    })

    it('returns the list users', async () => {
      const response = await service.getListUsers(listId)

      expect(response).toHaveProperty('emails')
    })

    it('unsubscribes the user from the list', async () => {
      const response = await service.unsubscribeFromList(listId, [{ email: subscriberEmail }])

      expect(response).toHaveProperty('successCount')
    })

    it('deletes the list', async () => {
      const response = await service.deleteList(listId)

      expect(response).toHaveProperty('code', 'Success')
    })

    afterAll(async () => {
      // Clean up the list even if an assertion above failed before deletion.
      if (listId) {
        try {
          await service.deleteList(listId)
        } catch (e) {
          // ignore cleanup errors (already deleted)
        }
      }

      try {
        await service.deleteUser(subscriberEmail)
      } catch (e) {
        // ignore cleanup errors
      }
    })
  })

  // ── Campaigns ──

  describe('listCampaigns', () => {
    it('returns campaigns with expected shape', async () => {
      const response = await service.listCampaigns()

      expect(response).toHaveProperty('campaigns')
      expect(Array.isArray(response.campaigns)).toBe(true)
    })
  })

  describe('getCampaignsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getCampaignsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  describe('getCampaignMetrics', () => {
    // Needs a real campaign ID; runs only when testValues.campaignId is set.
    it('returns metrics for a campaign', async () => {
      if (!testValues.campaignId) {
        console.log('Skipping getCampaignMetrics: set testValues.campaignId')
        return
      }

      const response = await service.getCampaignMetrics([Number(testValues.campaignId)])

      expect(response).toHaveProperty('metrics')
    })
  })

  // ── Templates ──

  describe('listEmailTemplates', () => {
    it('returns email templates with expected shape', async () => {
      const response = await service.listEmailTemplates(undefined, 'Email')

      expect(response).toHaveProperty('templates')
      expect(Array.isArray(response.templates)).toBe(true)
    })
  })

  describe('getEmailTemplate', () => {
    // Needs a real template ID; runs only when testValues.templateId is set.
    it('returns a single email template', async () => {
      if (!testValues.templateId) {
        console.log('Skipping getEmailTemplate: set testValues.templateId')
        return
      }

      const response = await service.getEmailTemplate(Number(testValues.templateId))

      expect(response).toHaveProperty('templateId')
    })
  })

  // ── Messaging (live send) ──

  describe('sendEmail', () => {
    // Sending needs a real triggered email campaign + recipient, so this only
    // runs when the developer supplies testValues.emailCampaignId + recipientEmail.
    const canSend = () => Boolean(testValues.emailCampaignId && testValues.recipientEmail)

    it('sends a triggered email when configured', async () => {
      if (!canSend()) {
        console.log('Skipping sendEmail: set testValues.emailCampaignId and testValues.recipientEmail')
        return
      }

      const response = await service.sendEmail(
        Number(testValues.emailCampaignId),
        testValues.recipientEmail,
        { source: 'e2e' }
      )

      expect(response).toHaveProperty('code', 'Success')
    })
  })

  describe('sendPush', () => {
    // Sending needs a real triggered push campaign + recipient, so this only
    // runs when the developer supplies testValues.pushCampaignId + recipientEmail.
    const canSend = () => Boolean(testValues.pushCampaignId && testValues.recipientEmail)

    it('sends a triggered push when configured', async () => {
      if (!canSend()) {
        console.log('Skipping sendPush: set testValues.pushCampaignId and testValues.recipientEmail')
        return
      }

      const response = await service.sendPush(
        Number(testValues.pushCampaignId),
        testValues.recipientEmail
      )

      expect(response).toHaveProperty('code', 'Success')
    })
  })
})
