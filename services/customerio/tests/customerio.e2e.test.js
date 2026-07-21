'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Customer.io Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('customerio')
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

  // A unique-ish suffix so repeated e2e runs don't collide, plus a deterministic
  // person id derived from it so create -> read -> delete can share the identity.
  const suffix = Date.now()
  const personId = `e2e-person-${ suffix }`

  const hasAppKey = () => Boolean(sandbox.getConfigItems().find(i => i.name === 'appApiKey') && testValues.hasAppApiKey !== false)

  // ── People + Events (Track API — always available) ──

  describe('identifyPerson + trackEvent + deletePerson', () => {
    it('identifies (upserts) a person', async () => {
      const response = await service.identifyPerson(personId, {
        email: `${ personId }@example.com`,
        first_name: 'E2E',
        plan: 'pro',
      })

      expect(response).toEqual({ success: true, identifier: personId })
    })

    it('tracks an event for the person', async () => {
      const response = await service.trackEvent(personId, 'e2e_purchase', { amount: 99 })

      expect(response).toEqual({ success: true, personId, eventName: 'e2e_purchase' })
    })

    it('deletes the person', async () => {
      const response = await service.deletePerson(personId)

      expect(response).toEqual({ success: true, personId })
    })
  })

  describe('suppressPerson + unsuppressPerson', () => {
    const suppressId = `e2e-suppress-${ suffix }`

    it('identifies a person to suppress', async () => {
      const response = await service.identifyPerson(suppressId, { email: `${ suppressId }@example.com` })

      expect(response).toEqual({ success: true, identifier: suppressId })
    })

    it('suppresses the person', async () => {
      const response = await service.suppressPerson(suppressId)

      expect(response).toEqual({ success: true, personId: suppressId })
    })

    it('unsuppresses the person', async () => {
      const response = await service.unsuppressPerson(suppressId)

      expect(response).toEqual({ success: true, personId: suppressId })
    })

    afterAll(async () => {
      try {
        await service.deletePerson(suppressId)
      } catch (e) {
        // ignore cleanup errors
      }
    })
  })

  describe('trackAnonymousEvent', () => {
    it('tracks an anonymous event', async () => {
      const response = await service.trackAnonymousEvent(
        'e2e_invite_sent',
        { recipient: `anon-${ suffix }@example.com` },
        `anon-${ suffix }`
      )

      expect(response).toEqual({ success: true, eventName: 'e2e_invite_sent' })
    })
  })

  // ── Segments (Track write requires an existing manual segment) ──

  describe('addToManualSegment + removeFromManualSegment', () => {
    const canRun = () => Boolean(testValues.manualSegmentId)

    it('adds a person to a manual segment when a segment id is configured', async () => {
      if (!canRun()) {
        console.log('Skipping addToManualSegment: set testValues.manualSegmentId')
        return
      }

      const response = await service.addToManualSegment(testValues.manualSegmentId, [personId])

      expect(response).toMatchObject({ success: true, segmentId: testValues.manualSegmentId })
    })

    it('removes a person from a manual segment when a segment id is configured', async () => {
      if (!canRun()) {
        console.log('Skipping removeFromManualSegment: set testValues.manualSegmentId')
        return
      }

      const response = await service.removeFromManualSegment(testValues.manualSegmentId, [personId])

      expect(response).toMatchObject({ success: true, segmentId: testValues.manualSegmentId })
    })
  })

  // ── App API reads (require appApiKey) ──

  describe('listSegments', () => {
    it('returns segments with expected shape', async () => {
      if (!hasAppKey()) {
        console.log('Skipping listSegments: App API key not configured')
        return
      }

      const response = await service.listSegments()

      expect(response).toHaveProperty('segments')
      expect(Array.isArray(response.segments)).toBe(true)
    })
  })

  describe('listTransactionalMessages', () => {
    it('returns transactional messages with expected shape', async () => {
      if (!hasAppKey()) {
        console.log('Skipping listTransactionalMessages: App API key not configured')
        return
      }

      const response = await service.listTransactionalMessages()

      expect(response).toHaveProperty('messages')
      expect(Array.isArray(response.messages)).toBe(true)
    })
  })

  describe('listCampaigns', () => {
    it('returns campaigns with expected shape', async () => {
      if (!hasAppKey()) {
        console.log('Skipping listCampaigns: App API key not configured')
        return
      }

      const response = await service.listCampaigns()

      expect(response).toHaveProperty('campaigns')
      expect(Array.isArray(response.campaigns)).toBe(true)
    })
  })

  describe('getCampaignMetrics', () => {
    it('returns metrics for a configured campaign', async () => {
      if (!hasAppKey() || !testValues.campaignId) {
        console.log('Skipping getCampaignMetrics: set testValues.campaignId (and configure App API key)')
        return
      }

      const response = await service.getCampaignMetrics(testValues.campaignId, 'Days', 7)

      expect(response).toHaveProperty('metric')
    })
  })

  describe('searchCustomers', () => {
    it('searches customers by attribute and returns identifiers', async () => {
      if (!hasAppKey()) {
        console.log('Skipping searchCustomers: App API key not configured')
        return
      }

      const response = await service.searchCustomers('email', `${ personId }@example.com`, undefined, 5)

      expect(response).toHaveProperty('identifiers')
      expect(Array.isArray(response.identifiers)).toBe(true)
    })
  })

  describe('getCustomerAttributes', () => {
    it('returns attributes for a known person', async () => {
      if (!hasAppKey()) {
        console.log('Skipping getCustomerAttributes: App API key not configured')
        return
      }

      // Re-identify so the person exists for the read, then clean up.
      const readId = `e2e-attrs-${ suffix }`
      await service.identifyPerson(readId, { email: `${ readId }@example.com`, plan: 'pro' })

      const response = await service.getCustomerAttributes(readId)

      expect(response).toHaveProperty('customer')

      try {
        await service.deletePerson(readId)
      } catch (e) {
        // ignore cleanup errors
      }
    })
  })

  describe('listCustomerActivities', () => {
    it('returns an activities array for a known person', async () => {
      if (!hasAppKey()) {
        console.log('Skipping listCustomerActivities: App API key not configured')
        return
      }

      const readId = `e2e-activities-${ suffix }`
      await service.identifyPerson(readId, { email: `${ readId }@example.com` })

      const response = await service.listCustomerActivities(readId, undefined, undefined, 10)

      expect(response).toHaveProperty('activities')
      expect(Array.isArray(response.activities)).toBe(true)

      try {
        await service.deletePerson(readId)
      } catch (e) {
        // ignore cleanup errors
      }
    })
  })

  // ── Dictionaries (require appApiKey) ──

  describe('getSegmentsDictionary', () => {
    it('returns dictionary items array', async () => {
      if (!hasAppKey()) {
        console.log('Skipping getSegmentsDictionary: App API key not configured')
        return
      }

      const result = await service.getSegmentsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  describe('getTransactionalMessagesDictionary', () => {
    it('returns dictionary items array', async () => {
      if (!hasAppKey()) {
        console.log('Skipping getTransactionalMessagesDictionary: App API key not configured')
        return
      }

      const result = await service.getTransactionalMessagesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getBroadcastsDictionary', () => {
    it('returns dictionary items array', async () => {
      if (!hasAppKey()) {
        console.log('Skipping getBroadcastsDictionary: App API key not configured')
        return
      }

      const result = await service.getBroadcastsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Messaging live-writes (require appApiKey + real message/recipient) ──

  describe('sendTransactionalEmail', () => {
    // Sending a real email needs a real transactional message template and a
    // recipient, so this only runs when the developer supplies both.
    const canSend = () => Boolean(hasAppKey() && testValues.transactionalMessageId && testValues.recipientEmail)

    it('sends a transactional email when a message id and recipient are configured', async () => {
      if (!canSend()) {
        console.log(
          'Skipping sendTransactionalEmail: set testValues.transactionalMessageId and testValues.recipientEmail'
        )
        return
      }

      const response = await service.sendTransactionalEmail(
        testValues.transactionalMessageId,
        testValues.recipientEmail,
        testValues.recipientEmail,
        undefined,
        { subject_line: `E2E test ${ suffix }` }
      )

      expect(response).toHaveProperty('delivery_id')
    })
  })

  describe('triggerBroadcast', () => {
    // Triggering a broadcast needs a real API-triggered broadcast id.
    const canSend = () => Boolean(hasAppKey() && testValues.broadcastId)

    it('triggers a broadcast when a broadcast id is configured', async () => {
      if (!canSend()) {
        console.log('Skipping triggerBroadcast: set testValues.broadcastId')
        return
      }

      const response = await service.triggerBroadcast(testValues.broadcastId, { headline: `E2E ${ suffix }` })

      expect(response).toHaveProperty('id')
    })
  })
})
