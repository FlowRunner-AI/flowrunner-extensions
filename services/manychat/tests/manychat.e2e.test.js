'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('ManyChat Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('manychat')
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

  // ── Page ──

  describe('getPageInfo', () => {
    it('returns page info with expected shape', async () => {
      const result = await service.getPageInfo()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
    })
  })

  // ── Tags lifecycle ──

  describe('tags lifecycle', () => {
    let createdTagName

    it('lists existing tags', async () => {
      const result = await service.listTags()

      expect(Array.isArray(result)).toBe(true)
    })

    it('creates a new tag', async () => {
      createdTagName = `e2e-test-tag-${ suffix }`
      const result = await service.createTag(createdTagName)

      expect(result).toHaveProperty('tag')
      expect(result.tag).toHaveProperty('id')
      expect(result.tag).toHaveProperty('name', createdTagName)
    })

    it('deletes the created tag by name', async () => {
      const result = await service.deleteTagByName(createdTagName)

      expect(result).toEqual({ success: true })
    })
  })

  // ── Tags dictionary ──

  describe('getTagsDictionary', () => {
    it('returns dictionary items with label and value', async () => {
      const result = await service.getTagsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  // ── Custom Fields lifecycle ──

  describe('custom fields lifecycle', () => {
    it('lists existing custom fields', async () => {
      const result = await service.listCustomFields()

      expect(Array.isArray(result)).toBe(true)
    })

    it('creates a new custom field', async () => {
      const fieldName = `e2e-field-${ suffix }`
      const result = await service.createCustomField(fieldName, 'Text', 'E2E test field')

      expect(result).toHaveProperty('field')
      expect(result.field).toHaveProperty('id')
      expect(result.field).toHaveProperty('name', fieldName)
      expect(result.field).toHaveProperty('type', 'text')
    })
  })

  // ── Custom Fields dictionary ──

  describe('getCustomFieldsDictionary', () => {
    it('returns dictionary items with label, value, and note', async () => {
      const result = await service.getCustomFieldsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  // ── Bot Fields ──

  describe('bot fields', () => {
    it('lists existing bot fields', async () => {
      const result = await service.listBotFields()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getBotFieldsDictionary', () => {
    it('returns dictionary items with expected shape', async () => {
      const result = await service.getBotFieldsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  // ── Flows ──

  describe('listFlows', () => {
    it('returns flows and folders', async () => {
      const result = await service.listFlows()

      expect(result).toHaveProperty('flows')
      expect(result).toHaveProperty('folders')
      expect(Array.isArray(result.flows)).toBe(true)
      expect(Array.isArray(result.folders)).toBe(true)
    })
  })

  describe('getFlowsDictionary', () => {
    it('returns dictionary items with expected shape', async () => {
      const result = await service.getFlowsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  // ── Growth Tools ──

  describe('listGrowthTools', () => {
    it('returns growth tools array', async () => {
      const result = await service.listGrowthTools()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── OTN Topics ──

  describe('listOtnTopics', () => {
    it('returns OTN topics array', async () => {
      const result = await service.listOtnTopics()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Subscribers (requires testValues.subscriberId) ──

  describe('subscriber operations', () => {
    const hasSubscriberId = () => {
      if (!testValues.subscriberId) {
        console.log('Skipping: testValues.subscriberId not provided')
        return false
      }

      return true
    }

    it('gets subscriber info', async () => {
      if (!hasSubscriberId()) {
        return
      }

      const result = await service.getSubscriber(testValues.subscriberId)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('first_name')
    })

    it('finds subscribers by name', async () => {
      if (!testValues.subscriberName) {
        console.log('Skipping: testValues.subscriberName not provided')
        return
      }

      const result = await service.findSubscribersByName(testValues.subscriberName)

      expect(Array.isArray(result)).toBe(true)
    })

    it('finds subscriber by email', async () => {
      if (!testValues.subscriberEmail) {
        console.log('Skipping: testValues.subscriberEmail not provided')
        return
      }

      const result = await service.findSubscriberBySystemField(testValues.subscriberEmail)

      expect(result).toHaveProperty('id')
    })
  })

  // ── Send Content (requires testValues.subscriberId) ──

  describe('sendContent', () => {
    it('sends a text message to a subscriber', async () => {
      if (!testValues.subscriberId) {
        console.log('Skipping: testValues.subscriberId not provided')
        return
      }

      const result = await service.sendContent(
        testValues.subscriberId,
        `E2E test message ${ suffix }`
      )

      expect(result).toEqual({ success: true })
    })
  })
})
