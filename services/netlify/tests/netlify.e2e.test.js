'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Netlify Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('netlify')
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

  // ── Account ──

  describe('listAccounts', () => {
    it('returns an array of accounts', async () => {
      const result = await service.listAccounts()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('id')
      expect(result[0]).toHaveProperty('name')
    })
  })

  // ── Sites ──

  describe('listSites', () => {
    it('returns an array of sites', async () => {
      const result = await service.listSites(undefined, undefined, 1, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('filters sites by name', async () => {
      const { siteName } = testValues

      if (!siteName) {
        console.log('Skipping: testValues.siteName not set')
        return
      }

      const result = await service.listSites(siteName)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getSite', () => {
    it('returns site details', async () => {
      const { siteId } = testValues

      if (!siteId) {
        console.log('Skipping: testValues.siteId not set')
        return
      }

      const result = await service.getSite(siteId)

      expect(result).toHaveProperty('id', siteId)
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('url')
    })
  })

  describe('createSite + updateSite + deleteSite', () => {
    let createdSiteId

    it('creates a site', async () => {
      const uniqueName = `e2e-test-${Date.now()}`
      const result = await service.createSite(uniqueName)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
      createdSiteId = result.id
    })

    it('updates the created site', async () => {
      if (!createdSiteId) {
        console.log('Skipping: no site was created')
        return
      }

      const newName = `e2e-updated-${Date.now()}`
      const result = await service.updateSite(createdSiteId, newName)

      expect(result).toHaveProperty('id', createdSiteId)
    })

    it('deletes the created site', async () => {
      if (!createdSiteId) {
        console.log('Skipping: no site was created')
        return
      }

      const result = await service.deleteSite(createdSiteId)

      expect(result).toEqual({ deleted: true, site_id: createdSiteId })
    })
  })

  // ── Deploys ──

  describe('listDeploys', () => {
    it('returns deploys for a site', async () => {
      const { siteId } = testValues

      if (!siteId) {
        console.log('Skipping: testValues.siteId not set')
        return
      }

      const result = await service.listDeploys(siteId, 1, 5)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getDeploy', () => {
    it('returns deploy details', async () => {
      const { siteId } = testValues

      if (!siteId) {
        console.log('Skipping: testValues.siteId not set')
        return
      }

      const deploys = await service.listDeploys(siteId, 1, 1)

      if (!deploys.length) {
        console.log('Skipping: no deploys found for site')
        return
      }

      const result = await service.getDeploy(deploys[0].id)

      expect(result).toHaveProperty('id', deploys[0].id)
      expect(result).toHaveProperty('state')
    })
  })

  // ── Environment Variables ──

  describe('environment variables lifecycle', () => {
    const testKey = `E2E_TEST_VAR_${Date.now()}`

    it('creates an environment variable', async () => {
      const { accountId } = testValues

      if (!accountId && !service.accountId) {
        console.log('Skipping: accountId not configured')
        return
      }

      const result = await service.createEnvVar(testKey, 'test-value', 'All')

      expect(Array.isArray(result)).toBe(true)
    })

    it('gets the created environment variable', async () => {
      if (!service.accountId) {
        console.log('Skipping: accountId not configured')
        return
      }

      const result = await service.getEnvVar(testKey)

      expect(result).toHaveProperty('key', testKey)
    })

    it('updates the environment variable value', async () => {
      if (!service.accountId) {
        console.log('Skipping: accountId not configured')
        return
      }

      const result = await service.setEnvVarValue(testKey, 'updated-value', 'All')

      expect(result).toHaveProperty('key', testKey)
    })

    it('lists environment variables', async () => {
      if (!service.accountId) {
        console.log('Skipping: accountId not configured')
        return
      }

      const result = await service.listEnvVars()

      expect(Array.isArray(result)).toBe(true)
    })

    it('deletes the environment variable', async () => {
      if (!service.accountId) {
        console.log('Skipping: accountId not configured')
        return
      }

      const result = await service.deleteEnvVar(testKey)

      expect(result).toEqual({ deleted: true, key: testKey })
    })
  })

  // ── Forms ──

  describe('listForms', () => {
    it('returns forms for a site', async () => {
      const { siteId } = testValues

      if (!siteId) {
        console.log('Skipping: testValues.siteId not set')
        return
      }

      const result = await service.listForms(siteId)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── DNS ──

  describe('listDnsZones', () => {
    it('returns an array of DNS zones', async () => {
      const result = await service.listDnsZones()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('listDnsRecords', () => {
    it('returns DNS records for a zone', async () => {
      const { dnsZoneId } = testValues

      if (!dnsZoneId) {
        console.log('Skipping: testValues.dnsZoneId not set')
        return
      }

      const result = await service.listDnsRecords(dnsZoneId)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getSitesDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getSitesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('supports search', async () => {
      const result = await service.getSitesDictionary({ search: 'e2e' })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getFormsDictionary', () => {
    it('returns empty when no siteId provided', async () => {
      const result = await service.getFormsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns forms for a site', async () => {
      const { siteId } = testValues

      if (!siteId) {
        console.log('Skipping: testValues.siteId not set')
        return
      }

      const result = await service.getFormsDictionary({ criteria: { siteId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })
})
