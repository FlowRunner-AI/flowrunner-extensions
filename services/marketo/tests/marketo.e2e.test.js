'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Marketo Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('marketo')
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

  // ── Leads ──

  describe('describeLeadFields', () => {
    it('returns lead field schema', async () => {
      const result = await service.describeLeadFields()

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
      expect(Array.isArray(result.result)).toBe(true)

      if (result.result.length > 0) {
        expect(result.result[0]).toHaveProperty('displayName')
      }
    })
  })

  describe('syncLeads + getLeads + deleteLeads', () => {
    let createdLeadId

    it('creates a lead via syncLeads', async () => {
      const email = `e2e-marketo-${ Date.now() }@flowrunner-test.com`
      const result = await service.syncLeads([{ email, firstName: 'E2E', lastName: 'Test' }])

      expect(result).toHaveProperty('success', true)
      expect(result.result).toHaveLength(1)
      expect(result.result[0]).toHaveProperty('id')

      createdLeadId = result.result[0].id
    })

    it('retrieves the lead via getLeads', async () => {
      if (!createdLeadId) {
        return
      }

      const result = await service.getLeads('Marketo ID', [String(createdLeadId)])

      expect(result).toHaveProperty('success', true)
      expect(result.result).toHaveLength(1)
      expect(result.result[0]).toHaveProperty('id', createdLeadId)
    })

    it('retrieves the lead via getLeadById', async () => {
      if (!createdLeadId) {
        return
      }

      const result = await service.getLeadById(String(createdLeadId))

      expect(result).toHaveProperty('success', true)
      expect(result.result[0]).toHaveProperty('id', createdLeadId)
    })

    it('deletes the lead', async () => {
      if (!createdLeadId) {
        return
      }

      const result = await service.deleteLeads([String(createdLeadId)])

      expect(result).toHaveProperty('success', true)
    })
  })

  // ── Lists ──

  describe('getLists', () => {
    it('returns lists with expected shape', async () => {
      const result = await service.getLists(undefined, undefined, 5)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
      expect(Array.isArray(result.result)).toBe(true)
    })
  })

  describe('getListById', () => {
    it('retrieves a list when testValues.listId is set', async () => {
      if (!testValues.listId) {
        console.log('Skipping getListById: set testValues.listId')
        return
      }

      const result = await service.getListById(testValues.listId)

      expect(result).toHaveProperty('success', true)
      expect(result.result).toHaveLength(1)
    })
  })

  // ── Campaigns ──

  describe('getCampaigns', () => {
    it('returns campaigns with expected shape', async () => {
      const result = await service.getCampaigns(undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
    })
  })

  // ── Activities ──

  describe('getActivityTypes', () => {
    it('returns activity types', async () => {
      const result = await service.getActivityTypes()

      expect(result).toHaveProperty('success', true)
      expect(Array.isArray(result.result)).toBe(true)

      if (result.result.length > 0) {
        expect(result.result[0]).toHaveProperty('name')
        expect(result.result[0]).toHaveProperty('id')
      }
    })
  })

  describe('getPagingToken', () => {
    it('returns a paging token', async () => {
      const result = await service.getPagingToken(new Date(Date.now() - 3600000).toISOString())

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('nextPageToken')
    })
  })

  // ── Asset API - Programs ──

  describe('browsePrograms', () => {
    it('returns programs with expected shape', async () => {
      const result = await service.browsePrograms(undefined, 5)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
    })
  })

  // ── Asset API - Emails ──

  describe('browseEmails', () => {
    it('returns emails with expected shape', async () => {
      const result = await service.browseEmails(undefined, undefined, 5)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
    })
  })

  // ── Asset API - Forms ──

  describe('browseForms', () => {
    it('returns forms with expected shape', async () => {
      const result = await service.browseForms(undefined, 5)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
    })
  })

  // ── Asset API - Folders ──

  describe('browseFolders', () => {
    it('browses folders when testValues.rootFolderId is set', async () => {
      const rootId = testValues.rootFolderId

      if (!rootId) {
        console.log('Skipping browseFolders: set testValues.rootFolderId')
        return
      }

      const result = await service.browseFolders(rootId, 2, 5)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
    })
  })

  // ── Dictionaries ──

  describe('getListsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getListsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  describe('getCampaignsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getCampaignsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getActivityTypesDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getActivityTypesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getProgramsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getProgramsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getFoldersDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getFoldersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getEmailsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getEmailsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getFormsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getFormsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
