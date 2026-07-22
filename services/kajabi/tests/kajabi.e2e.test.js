'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Kajabi Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('kajabi')
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

  // ── Sites ──

  describe('listSites', () => {
    it('returns sites with expected shape', async () => {
      const result = await service.listSites(1, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('nextPage')
      expect(result).toHaveProperty('meta')

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('id')
        expect(result.items[0]).toHaveProperty('type', 'sites')
      }
    })
  })

  describe('getSite', () => {
    it('returns a single site by ID', async () => {
      const sites = await service.listSites(1, 1)

      if (sites.items.length === 0) {
        console.log('No sites found -- skipping getSite')
        return
      }

      const siteId = sites.items[0].id
      const result = await service.getSite(siteId)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id', siteId)
      expect(result.data).toHaveProperty('type', 'sites')
      expect(result.data).toHaveProperty('attributes')
    })
  })

  // ── Contacts ──

  describe('listContacts', () => {
    it('returns contacts with expected shape', async () => {
      const result = await service.listContacts(undefined, undefined, undefined, undefined, undefined, undefined, undefined, 1, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('meta')
    })
  })

  describe('contact CRUD', () => {
    let siteId
    let createdContactId

    beforeAll(async () => {
      const sites = await service.listSites(1, 1)

      if (sites.items.length === 0) {
        throw new Error('No sites found -- cannot run contact CRUD tests. Create at least one site in Kajabi.')
      }

      siteId = sites.items[0].id
    })

    it('creates a contact', async () => {
      const email = `e2e-test-${Date.now()}@flowrunner-test.com`
      const result = await service.createContact(siteId, email, 'E2E Test Contact')

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      expect(result.data).toHaveProperty('type', 'contacts')
      expect(result.data.attributes).toHaveProperty('email', email)

      createdContactId = result.data.id
    })

    it('gets the created contact', async () => {
      if (!createdContactId) {
        return
      }

      const result = await service.getContact(createdContactId)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id', createdContactId)
    })

    it('updates the created contact', async () => {
      if (!createdContactId) {
        return
      }

      const result = await service.updateContact(createdContactId, 'Updated E2E Name')

      expect(result).toHaveProperty('data')
      expect(result.data.attributes).toHaveProperty('name', 'Updated E2E Name')
    })

    it('deletes the created contact', async () => {
      if (!createdContactId) {
        return
      }

      const result = await service.deleteContact(createdContactId)

      expect(result).toEqual({ deleted: true, contactId: createdContactId })
    })
  })

  // ── Products ──

  describe('listProducts', () => {
    it('returns products with expected shape', async () => {
      const result = await service.listProducts(undefined, 1, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('meta')
    })
  })

  describe('getProduct', () => {
    it('returns a single product by ID', async () => {
      const products = await service.listProducts(undefined, 1, 1)

      if (products.items.length === 0) {
        console.log('No products found -- skipping getProduct')
        return
      }

      const productId = products.items[0].id
      const result = await service.getProduct(productId)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id', productId)
      expect(result.data).toHaveProperty('type', 'products')
    })
  })

  // ── Offers ──

  describe('listOffers', () => {
    it('returns offers with expected shape', async () => {
      const result = await service.listOffers(undefined, undefined, 1, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('meta')
    })
  })

  describe('getOffer', () => {
    it('returns a single offer by ID', async () => {
      const offers = await service.listOffers(undefined, undefined, 1, 1)

      if (offers.items.length === 0) {
        console.log('No offers found -- skipping getOffer')
        return
      }

      const offerId = offers.items[0].id
      const result = await service.getOffer(offerId)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id', offerId)
    })
  })

  // ── Courses ──

  describe('listCourses', () => {
    it('returns courses with expected shape', async () => {
      const result = await service.listCourses(undefined, undefined, undefined, undefined, 1, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getCourse', () => {
    it('returns a single course by ID', async () => {
      const courses = await service.listCourses(undefined, undefined, undefined, undefined, 1, 1)

      if (courses.items.length === 0) {
        console.log('No courses found -- skipping getCourse')
        return
      }

      const courseId = courses.items[0].id
      const result = await service.getCourse(courseId)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id', courseId)
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('returns tags with expected shape', async () => {
      const result = await service.listTags(undefined, undefined, undefined, 1, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getTag', () => {
    it('returns a single tag by ID', async () => {
      const tags = await service.listTags(undefined, undefined, undefined, 1, 1)

      if (tags.items.length === 0) {
        console.log('No tags found -- skipping getTag')
        return
      }

      const tagId = tags.items[0].id
      const result = await service.getTag(tagId)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id', tagId)
    })
  })

  // ── Commerce ──

  describe('listPurchases', () => {
    it('returns purchases with expected shape', async () => {
      const result = await service.listPurchases(undefined, undefined, undefined, undefined, 1, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('listOrders', () => {
    it('returns orders with expected shape', async () => {
      const result = await service.listOrders(undefined, undefined, undefined, 1, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Forms ──

  describe('listForms', () => {
    it('returns forms with expected shape', async () => {
      const result = await service.listForms(undefined, undefined, 1, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Webhooks ──

  describe('listWebhooks', () => {
    it('returns webhooks with expected shape', async () => {
      const result = await service.listWebhooks(1, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('sitesDictionary', () => {
    it('returns dictionary items with label/value', async () => {
      const result = await service.sitesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('offersDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.offersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('productsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.productsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('tagsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.tagsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
