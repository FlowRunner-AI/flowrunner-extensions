'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Kit Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('kit')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  const suffix = Date.now()

  // ── Account ──

  describe('getAccount', () => {
    it('returns account with expected shape', async () => {
      const result = await service.getAccount()

      expect(result).toHaveProperty('account')
      expect(result.account).toHaveProperty('id')
      expect(result.account).toHaveProperty('name')
    })
  })

  // ── Subscribers ──

  describe('subscriber lifecycle', () => {
    let subscriberId

    it('creates a subscriber', async () => {
      const result = await service.createSubscriber(
        `e2e-test-${ suffix }@example.com`, `E2E-${ suffix }`
      )

      expect(result).toHaveProperty('subscriber')
      expect(result.subscriber).toHaveProperty('id')
      expect(result.subscriber).toHaveProperty('email_address')
      subscriberId = result.subscriber.id
    })

    it('gets the created subscriber', async () => {
      const result = await service.getSubscriber(subscriberId)

      expect(result).toHaveProperty('subscriber')
      expect(result.subscriber.id).toBe(subscriberId)
    })

    it('updates the subscriber', async () => {
      const result = await service.updateSubscriber(subscriberId, undefined, `Updated-${ suffix }`)

      expect(result).toHaveProperty('subscriber')
      expect(result.subscriber.first_name).toBe(`Updated-${ suffix }`)
    })

    it('lists subscribers and finds the created one', async () => {
      const result = await service.listSubscribers(
        `e2e-test-${ suffix }@example.com`, undefined, undefined, undefined, 10
      )

      expect(result).toHaveProperty('subscribers')
      expect(Array.isArray(result.subscribers)).toBe(true)
      expect(result).toHaveProperty('pagination')
    })

    it('unsubscribes the subscriber', async () => {
      const result = await service.unsubscribeSubscriber(subscriberId)

      expect(result).toEqual({ unsubscribed: true, subscriberId })
    })
  })

  // ── Tags ──

  describe('tag lifecycle', () => {
    let tagId

    it('creates a tag', async () => {
      const result = await service.createTag(`E2E-Tag-${ suffix }`)

      expect(result).toHaveProperty('tag')
      expect(result.tag).toHaveProperty('id')
      expect(result.tag).toHaveProperty('name')
      tagId = result.tag.id
    })

    it('lists tags', async () => {
      const result = await service.listTags(10)

      expect(result).toHaveProperty('tags')
      expect(Array.isArray(result.tags)).toBe(true)
      expect(result).toHaveProperty('pagination')
    })

    it('lists tags via dictionary', async () => {
      const result = await service.getTagsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })

    it('filters tags dictionary by search', async () => {
      const result = await service.getTagsDictionary({ search: `E2E-Tag-${ suffix }` })

      expect(result.items.length).toBeGreaterThanOrEqual(1)
      expect(result.items[0].label).toContain('E2E-Tag')
    })
  })

  // ── Forms ──

  describe('listForms', () => {
    it('returns forms with expected shape', async () => {
      const result = await service.listForms(10)

      expect(result).toHaveProperty('forms')
      expect(Array.isArray(result.forms)).toBe(true)
      expect(result).toHaveProperty('pagination')
    })
  })

  describe('getFormsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getFormsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Sequences ──

  describe('listSequences', () => {
    it('returns sequences with expected shape', async () => {
      const result = await service.listSequences(10)

      expect(result).toHaveProperty('sequences')
      expect(Array.isArray(result.sequences)).toBe(true)
      expect(result).toHaveProperty('pagination')
    })
  })

  describe('getSequencesDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getSequencesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Custom Fields ──

  describe('custom field lifecycle', () => {
    it('creates a custom field', async () => {
      const result = await service.createCustomField(`E2EField${ suffix }`)

      expect(result).toHaveProperty('custom_field')
      expect(result.custom_field).toHaveProperty('id')
      expect(result.custom_field).toHaveProperty('label')
    })

    it('lists custom fields', async () => {
      const result = await service.listCustomFields(10)

      expect(result).toHaveProperty('custom_fields')
      expect(Array.isArray(result.custom_fields)).toBe(true)
      expect(result).toHaveProperty('pagination')
    })
  })

  // ── Broadcasts ──

  describe('broadcast lifecycle', () => {
    let broadcastId

    it('creates a draft broadcast', async () => {
      const result = await service.createBroadcast(
        `E2E Broadcast ${ suffix }`, '<p>Test content</p>', 'Preview text'
      )

      expect(result).toHaveProperty('broadcast')
      expect(result.broadcast).toHaveProperty('id')
      expect(result.broadcast).toHaveProperty('subject')
      broadcastId = result.broadcast.id
    })

    it('gets the created broadcast', async () => {
      const result = await service.getBroadcast(broadcastId)

      expect(result).toHaveProperty('broadcast')
      expect(result.broadcast.id).toBe(broadcastId)
    })

    it('lists broadcasts', async () => {
      const result = await service.listBroadcasts(10)

      expect(result).toHaveProperty('broadcasts')
      expect(Array.isArray(result.broadcasts)).toBe(true)
      expect(result).toHaveProperty('pagination')
    })
  })
})
