'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Bitly Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('bitly')
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

  // The long URL to shorten during the create/read/update lifecycle. Falls back
  // to a stable default so the suite can run with only an access token.
  const LONG_URL = () => testValues.longUrl || 'https://example.com/flowrunner-bitly-e2e'
  // Optional group GUID; when omitted, Bitly uses the account's default group.
  const GROUP_GUID = () => testValues.groupGuid

  // ── Organization ──

  describe('getUser', () => {
    it('returns the authenticated user profile', async () => {
      const response = await service.getUser()

      expect(response).toHaveProperty('login')
      expect(response).toHaveProperty('default_group_guid')
    })
  })

  describe('getOrganizations', () => {
    it('returns the organizations list', async () => {
      const response = await service.getOrganizations()

      expect(response).toHaveProperty('organizations')
      expect(Array.isArray(response.organizations)).toBe(true)
    })
  })

  describe('listGroups', () => {
    it('returns the groups list', async () => {
      const response = await service.listGroups()

      expect(response).toHaveProperty('groups')
      expect(Array.isArray(response.groups)).toBe(true)
    })
  })

  describe('getGroup', () => {
    it('returns a single group by guid', async () => {
      const groups = (await service.listGroups()).groups
      const guid = GROUP_GUID() || (groups[0] && groups[0].guid)

      if (!guid) {
        console.log('No group available to test getGroup')
        return
      }

      const response = await service.getGroup(guid)

      expect(response).toHaveProperty('guid', guid)
      expect(response).toHaveProperty('name')
    })
  })

  // ── Dictionary ──

  describe('getGroupsDictionary', () => {
    it('returns dictionary items and a null cursor', async () => {
      const result = await service.getGroupsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor', null)
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  // ── Links lifecycle ──

  describe('createBitlink + getBitlink + updateBitlink + expandBitlink + archive', () => {
    let bitlinkId

    it('creates a Bitlink', async () => {
      const response = await service.createBitlink(
        LONG_URL(),
        'FlowRunner E2E Bitlink',
        ['flowrunner-e2e'],
        undefined,
        undefined,
        GROUP_GUID()
      )

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('link')
      expect(response).toHaveProperty('long_url')
      bitlinkId = response.id
    })

    it('gets the created Bitlink', async () => {
      const response = await service.getBitlink(bitlinkId)

      expect(response).toHaveProperty('id', bitlinkId)
      expect(response).toHaveProperty('long_url')
    })

    it('updates the Bitlink title and tags', async () => {
      const response = await service.updateBitlink(bitlinkId, 'FlowRunner E2E Bitlink (updated)', ['flowrunner-e2e', 'updated'])

      expect(response).toHaveProperty('id', bitlinkId)
      expect(response).toHaveProperty('title', 'FlowRunner E2E Bitlink (updated)')
    })

    it('expands the Bitlink back to its long URL', async () => {
      const response = await service.expandBitlink(bitlinkId)

      expect(response).toHaveProperty('id', bitlinkId)
      expect(response).toHaveProperty('long_url')
    })

    // Bitly has no hard delete for Bitlinks; archiving is the cleanup step.
    afterAll(async () => {
      if (bitlinkId) {
        await service.updateBitlink(bitlinkId, undefined, undefined, true)
      }
    })
  })

  describe('shortenLink', () => {
    let bitlinkId

    it('shortens a long URL', async () => {
      const response = await service.shortenLink(LONG_URL(), undefined, GROUP_GUID())

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('link')
      bitlinkId = response.id
    })

    afterAll(async () => {
      if (bitlinkId) {
        await service.updateBitlink(bitlinkId, undefined, undefined, true)
      }
    })
  })

  // ── Metrics ──

  describe('metrics', () => {
    let bitlinkId

    beforeAll(async () => {
      const response = await service.shortenLink(LONG_URL(), undefined, GROUP_GUID())
      bitlinkId = response.id
    })

    afterAll(async () => {
      if (bitlinkId) {
        await service.updateBitlink(bitlinkId, undefined, undefined, true)
      }
    })

    it('returns a clicks summary', async () => {
      const response = await service.getClicksSummary(bitlinkId)

      expect(response).toHaveProperty('total_clicks')
      expect(response).toHaveProperty('unit')
    })

    it('returns a clicks time series', async () => {
      const response = await service.getClicks(bitlinkId)

      expect(response).toHaveProperty('link_clicks')
      expect(Array.isArray(response.link_clicks)).toBe(true)
    })

    it('returns clicks by country', async () => {
      const response = await service.getClicksByCountry(bitlinkId)

      expect(response).toHaveProperty('metrics')
      expect(Array.isArray(response.metrics)).toBe(true)
    })

    it('returns clicks by referrer', async () => {
      const response = await service.getClicksByReferrer(bitlinkId)

      expect(response).toHaveProperty('metrics')
      expect(Array.isArray(response.metrics)).toBe(true)
    })
  })

  // ── List ──

  describe('listBitlinksByGroup', () => {
    it('lists Bitlinks for a group', async () => {
      const groups = (await service.listGroups()).groups
      const guid = GROUP_GUID() || (groups[0] && groups[0].guid)

      if (!guid) {
        console.log('No group available to test listBitlinksByGroup')
        return
      }

      const response = await service.listBitlinksByGroup(guid, 5, 1)

      expect(response).toHaveProperty('links')
      expect(Array.isArray(response.links)).toBe(true)
      expect(response).toHaveProperty('pagination')
    })
  })
})
