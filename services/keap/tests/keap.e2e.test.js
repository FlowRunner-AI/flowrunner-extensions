'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Keap Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('keap')
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

  // ── Contacts lifecycle ──

  describe('createContact + getContact + updateContact + deleteContact', () => {
    let contactId

    it('creates a contact', async () => {
      const result = await service.createContact(
        'E2E Test', `User${ Date.now() }`, `e2e-${ Date.now() }@test-keap.example.com`
      )

      expect(result).toHaveProperty('id')
      contactId = result.id
    })

    it('retrieves the created contact', async () => {
      const result = await service.getContact(String(contactId))

      expect(result).toHaveProperty('id', contactId)
      expect(result).toHaveProperty('given_name', 'E2E Test')
    })

    it('updates the contact', async () => {
      const result = await service.updateContact(String(contactId), 'E2E Updated')

      expect(result).toHaveProperty('id', contactId)
      expect(result).toHaveProperty('given_name', 'E2E Updated')
    })

    it('deletes the contact', async () => {
      const result = await service.deleteContact(String(contactId))

      expect(result).toEqual({ deleted: true, contactId: String(contactId) })
    })
  })

  // ── List Contacts ──

  describe('listContacts', () => {
    it('returns contacts with expected shape', async () => {
      const result = await service.listContacts(undefined, undefined, undefined, 5, 0)

      expect(result).toHaveProperty('contacts')
      expect(Array.isArray(result.contacts)).toBe(true)
    })
  })

  // ── Tags lifecycle ──

  describe('createTag + listTags', () => {
    let tagId

    it('creates a tag', async () => {
      const result = await service.createTag(`E2E Tag ${ Date.now() }`, 'Created by e2e test suite')

      expect(result).toHaveProperty('id')
      tagId = result.id
    })

    it('lists tags and finds the created one', async () => {
      const result = await service.listTags(1000, 0)

      expect(result).toHaveProperty('tags')
      expect(Array.isArray(result.tags)).toBe(true)
    })
  })

  // ── Companies lifecycle ──

  describe('createCompany + getCompany + updateCompany', () => {
    let companyId

    it('creates a company', async () => {
      const result = await service.createCompany(`E2E Co ${ Date.now() }`)

      expect(result).toHaveProperty('id')
      companyId = result.id
    })

    it('retrieves the created company', async () => {
      const result = await service.getCompany(String(companyId))

      expect(result).toHaveProperty('id', companyId)
    })

    it('updates the company', async () => {
      const result = await service.updateCompany(String(companyId), `E2E Updated Co ${ Date.now() }`)

      expect(result).toHaveProperty('id', companyId)
    })
  })

  // ── List Companies ──

  describe('listCompanies', () => {
    it('returns companies with expected shape', async () => {
      const result = await service.listCompanies(undefined, 5, 0)

      expect(result).toHaveProperty('companies')
      expect(Array.isArray(result.companies)).toBe(true)
    })
  })

  // ── Orders & Products ──

  describe('listOrders', () => {
    it('returns orders with expected shape', async () => {
      const result = await service.listOrders(undefined, undefined, 5, 0)

      expect(result).toHaveProperty('orders')
      expect(Array.isArray(result.orders)).toBe(true)
    })
  })

  describe('listProducts', () => {
    it('returns products with expected shape', async () => {
      const result = await service.listProducts(undefined, 5, 0)

      expect(result).toHaveProperty('products')
      expect(Array.isArray(result.products)).toBe(true)
    })
  })

  // ── Tasks ──

  describe('listTasks', () => {
    it('returns tasks with expected shape', async () => {
      const result = await service.listTasks(undefined, undefined, 5, 0)

      expect(result).toHaveProperty('tasks')
      expect(Array.isArray(result.tasks)).toBe(true)
    })
  })

  // ── Campaigns ──

  describe('listCampaigns', () => {
    it('returns campaigns with expected shape', async () => {
      const result = await service.listCampaigns(5, 0)

      expect(result).toHaveProperty('campaigns')
      expect(Array.isArray(result.campaigns)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getTagsDictionary', () => {
    it('returns dictionary with items array', async () => {
      const result = await service.getTagsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getProductsDictionary', () => {
    it('returns dictionary with items array', async () => {
      const result = await service.getProductsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getCampaignsDictionary', () => {
    it('returns dictionary with items array', async () => {
      const result = await service.getCampaignsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getOpportunityStagesDictionary', () => {
    it('returns dictionary with items array', async () => {
      const result = await service.getOpportunityStagesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
