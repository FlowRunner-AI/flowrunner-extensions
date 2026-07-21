'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('OneSignal Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('onesignal')
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

  // ── App ──

  describe('viewAppDetails', () => {
    it('returns app details with expected shape', async () => {
      const result = await service.viewAppDetails()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
    })
  })

  describe('viewOutcomes', () => {
    it('returns outcomes data', async () => {
      const result = await service.viewOutcomes('os__click.count', 'Last 24 Hours')

      expect(result).toHaveProperty('outcomes')
      expect(Array.isArray(result.outcomes)).toBe(true)
    })
  })

  // ── Segments ──

  describe('listSegments', () => {
    it('returns segments list', async () => {
      const result = await service.listSegments()

      expect(result).toHaveProperty('segments')
      expect(Array.isArray(result.segments)).toBe(true)
      expect(result.segments.length).toBeGreaterThan(0)
    })
  })

  describe('createSegment + deleteSegment', () => {
    let createdSegmentId

    it('creates a segment', async () => {
      const filters = [{ field: 'session_count', relation: '>', value: '0' }]
      const result = await service.createSegment('E2E Test Segment', filters)

      expect(result).toHaveProperty('id')
      createdSegmentId = result.id
    })

    it('deletes the created segment', async () => {
      if (!createdSegmentId) {
        console.log('Skipping: segment was not created')
        return
      }

      const result = await service.deleteSegment(createdSegmentId)

      expect(result).toHaveProperty('success', true)
    })
  })

  // ── Users ──

  describe('createUser + getUser + updateUser + deleteUser', () => {
    const testExternalId = `e2e-test-user-${Date.now()}`

    it('creates a user', async () => {
      const result = await service.createUser(
        testExternalId,
        { e2e_test: 'true' },
        'en'
      )

      expect(result).toHaveProperty('identity')
      expect(result.identity).toHaveProperty('external_id', testExternalId)
    })

    it('gets the created user', async () => {
      const result = await service.getUser(testExternalId)

      expect(result).toHaveProperty('identity')
      expect(result.identity.external_id).toBe(testExternalId)
    })

    it('updates the user tags', async () => {
      const result = await service.updateUser(testExternalId, null, { e2e_test: 'updated' })

      expect(result).toHaveProperty('properties')
    })

    it('creates and deletes an alias', async () => {
      const aliasResult = await service.createAlias(testExternalId, null, 'e2e_alias', 'alias-val')

      expect(aliasResult).toHaveProperty('identity')
      expect(aliasResult.identity).toHaveProperty('e2e_alias', 'alias-val')

      const deleteResult = await service.deleteAlias(testExternalId, null, 'e2e_alias')

      expect(deleteResult).toHaveProperty('identity')
    })

    it('deletes the user', async () => {
      const result = await service.deleteUser(testExternalId)

      expect(result).toHaveProperty('success', true)
    })
  })

  // ── Subscriptions ──

  describe('createSubscription + updateSubscription + deleteSubscription', () => {
    const testExternalId = `e2e-sub-test-${Date.now()}`
    let subscriptionId

    it('creates a user for subscription tests', async () => {
      const result = await service.createUser(testExternalId)

      expect(result).toHaveProperty('identity')
    })

    it('creates an email subscription', async () => {
      const result = await service.createSubscription(
        testExternalId, null, 'Email', `e2e-${Date.now()}@example.com`
      )

      expect(result).toHaveProperty('subscription')
      expect(result.subscription).toHaveProperty('id')
      subscriptionId = result.subscription.id
    })

    it('updates the subscription', async () => {
      if (!subscriptionId) {
        console.log('Skipping: subscription was not created')
        return
      }

      const result = await service.updateSubscription(
        subscriptionId, `e2e-updated-${Date.now()}@example.com`, true
      )

      expect(result).toBeDefined()
    })

    it('deletes the subscription', async () => {
      if (!subscriptionId) {
        console.log('Skipping: subscription was not created')
        return
      }

      const result = await service.deleteSubscription(subscriptionId)

      expect(result).toBeDefined()
    })

    it('cleans up the test user', async () => {
      await service.deleteUser(testExternalId)
    })
  })

  // ── Messages ──

  describe('listMessages', () => {
    it('returns messages list', async () => {
      const result = await service.listMessages(5, 0)

      expect(result).toHaveProperty('notifications')
      expect(Array.isArray(result.notifications)).toBe(true)
    })
  })

  describe('getMessage', () => {
    it('gets a message by ID if messageId is provided', async () => {
      const { messageId } = testValues

      if (!messageId) {
        console.log('Skipping getMessage: testValues.messageId not set')
        return
      }

      const result = await service.getMessage(messageId)

      expect(result).toHaveProperty('id', messageId)
    })
  })

  // ── Templates ──

  describe('listTemplates', () => {
    it('returns templates list', async () => {
      const result = await service.listTemplates()

      expect(result).toHaveProperty('templates')
      expect(Array.isArray(result.templates)).toBe(true)
    })
  })

  describe('getTemplate', () => {
    it('gets a template by ID if templateId is provided', async () => {
      const { templateId } = testValues

      if (!templateId) {
        console.log('Skipping getTemplate: testValues.templateId not set')
        return
      }

      const result = await service.getTemplate(templateId)

      expect(result).toHaveProperty('id', templateId)
      expect(result).toHaveProperty('name')
    })
  })

  // ── Dictionaries ──

  describe('getSegmentsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getSegmentsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getTemplatesDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getTemplatesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
