'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('ActiveCampaign Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('activecampaign')
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

  // ── Contacts ──

  describe('syncContact + getContact + updateContact + deleteContact', () => {
    let contactId
    const testEmail = `e2e-test-${ Date.now() }@flowrunner-test.com`

    it('creates a contact via sync', async () => {
      const result = await service.syncContact(testEmail, 'E2E', 'Test', '+15550001111')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('email', testEmail)
      contactId = result.id
    })

    it('retrieves the created contact', async () => {
      const result = await service.getContact(contactId)

      expect(result).toHaveProperty('id', contactId)
      expect(result).toHaveProperty('email', testEmail)
    })

    it('updates the contact', async () => {
      const result = await service.updateContact(contactId, undefined, 'Updated', 'Name')

      expect(result).toHaveProperty('id', contactId)
    })

    it('lists contacts filtering by email', async () => {
      const result = await service.listContacts(testEmail)

      expect(result).toHaveProperty('contacts')
      expect(result).toHaveProperty('total')
      expect(result.contacts.length).toBeGreaterThanOrEqual(1)
    })

    it('deletes the created contact', async () => {
      const result = await service.deleteContact(contactId)

      expect(result).toEqual({ deleted: true, contactId })
    })
  })

  // ── Tags ──

  describe('createTag + listTags', () => {
    const tagName = `e2e-tag-${ Date.now() }`

    it('creates a tag', async () => {
      const result = await service.createTag(tagName, 'E2E test tag')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('tag', tagName)
    })

    it('lists tags with search', async () => {
      const result = await service.listTags(tagName)

      expect(result).toHaveProperty('tags')
      expect(result.tags.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ── Lists ──

  describe('listLists', () => {
    it('returns lists with expected shape', async () => {
      const result = await service.listLists()

      expect(result).toHaveProperty('lists')
      expect(result).toHaveProperty('total')
      expect(Array.isArray(result.lists)).toBe(true)
    })
  })

  // ── Custom Fields ──

  describe('listFields', () => {
    it('returns fields with expected shape', async () => {
      const result = await service.listFields()

      expect(result).toHaveProperty('fields')
      expect(result).toHaveProperty('total')
      expect(Array.isArray(result.fields)).toBe(true)
    })
  })

  // ── Deals ──

  describe('listPipelines', () => {
    it('returns pipelines with expected shape', async () => {
      const result = await service.listPipelines()

      expect(result).toHaveProperty('pipelines')
      expect(result).toHaveProperty('total')
      expect(Array.isArray(result.pipelines)).toBe(true)
    })
  })

  describe('listDeals', () => {
    it('returns deals with expected shape', async () => {
      const result = await service.listDeals()

      expect(result).toHaveProperty('deals')
      expect(result).toHaveProperty('total')
      expect(Array.isArray(result.deals)).toBe(true)
    })
  })

  // ── Automations ──

  describe('listAutomations', () => {
    it('returns automations with expected shape', async () => {
      const result = await service.listAutomations()

      expect(result).toHaveProperty('automations')
      expect(result).toHaveProperty('total')
      expect(Array.isArray(result.automations)).toBe(true)
    })
  })

  // ── Campaigns ──

  describe('listCampaigns', () => {
    it('returns campaigns with expected shape', async () => {
      const result = await service.listCampaigns()

      expect(result).toHaveProperty('campaigns')
      expect(result).toHaveProperty('total')
      expect(Array.isArray(result.campaigns)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getTagsDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getTagsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  describe('getListsDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getListsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getFieldsDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getFieldsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getPipelinesDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getPipelinesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getStagesDictionary', () => {
    it('returns empty items when no pipeline specified', async () => {
      const result = await service.getStagesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getAutomationsDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getAutomationsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
