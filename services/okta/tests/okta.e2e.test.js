'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Okta Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('okta')
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

  // ── Users ──

  describe('user CRUD lifecycle', () => {
    let createdUserId

    it('creates a user', async () => {
      const result = await service.createUser(
        'E2ETest',
        'OktaUser',
        `e2e-okta-${Date.now()}@example.com`,
        `e2e-okta-${Date.now()}@example.com`,
        null,
        null,
        false,
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('status')
      createdUserId = result.id
    })

    it('gets the created user', async () => {
      if (!createdUserId) {
        console.log('Skipping: createdUserId not set')
        return
      }

      const result = await service.getUser(createdUserId)

      expect(result).toHaveProperty('id', createdUserId)
      expect(result.profile).toHaveProperty('firstName', 'E2ETest')
    })

    it('updates the user', async () => {
      if (!createdUserId) {
        console.log('Skipping: createdUserId not set')
        return
      }

      const result = await service.updateUser(createdUserId, 'E2EUpdated')

      expect(result).toHaveProperty('id', createdUserId)
      expect(result.profile).toHaveProperty('firstName', 'E2EUpdated')
    })

    it('lists users', async () => {
      const result = await service.listUsers(null, null, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('gets user groups', async () => {
      if (!createdUserId) {
        console.log('Skipping: createdUserId not set')
        return
      }

      const result = await service.getUserGroups(createdUserId)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('deletes the created user permanently', async () => {
      if (!createdUserId) {
        console.log('Skipping: createdUserId not set')
        return
      }

      const result = await service.deleteUser(createdUserId, true)

      expect(result).toHaveProperty('deleted', true)
      expect(result).toHaveProperty('permanent', true)
    })
  })

  // ── Groups ──

  describe('group CRUD lifecycle', () => {
    let createdGroupId

    it('creates a group', async () => {
      const result = await service.createGroup(`E2E-Test-Group-${Date.now()}`, 'Created by e2e tests')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('type', 'OKTA_GROUP')
      createdGroupId = result.id
    })

    it('gets the created group', async () => {
      if (!createdGroupId) {
        console.log('Skipping: createdGroupId not set')
        return
      }

      const result = await service.getGroup(createdGroupId)

      expect(result).toHaveProperty('id', createdGroupId)
    })

    it('updates the group', async () => {
      if (!createdGroupId) {
        console.log('Skipping: createdGroupId not set')
        return
      }

      const result = await service.updateGroup(createdGroupId, `E2E-Updated-${Date.now()}`, 'Updated desc')

      expect(result).toHaveProperty('id', createdGroupId)
    })

    it('lists groups', async () => {
      const result = await service.listGroups(null, null, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('lists group members', async () => {
      if (!createdGroupId) {
        console.log('Skipping: createdGroupId not set')
        return
      }

      const result = await service.listGroupMembers(createdGroupId)

      expect(result).toHaveProperty('items')
    })

    it('deletes the created group', async () => {
      if (!createdGroupId) {
        console.log('Skipping: createdGroupId not set')
        return
      }

      const result = await service.deleteGroup(createdGroupId)

      expect(result).toHaveProperty('deleted', true)
    })
  })

  // ── Applications ──

  describe('listApplications', () => {
    it('returns a list of apps', async () => {
      const result = await service.listApplications(null, null, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── System Logs ──

  describe('getLogs', () => {
    it('returns log entries', async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const result = await service.getLogs(since, null, null, null, null, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Network Zones ──

  describe('listNetworkZones', () => {
    it('returns zones', async () => {
      const result = await service.listNetworkZones(null, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Trusted Origins ──

  describe('listTrustedOrigins', () => {
    it('returns trusted origins', async () => {
      const result = await service.listTrustedOrigins(null, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Event Hooks ──

  describe('listEventHooks', () => {
    it('returns event hooks', async () => {
      const result = await service.listEventHooks()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Authorization Servers ──

  describe('listAuthorizationServers', () => {
    it('returns auth servers', async () => {
      const result = await service.listAuthorizationServers(null, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── User Types ──

  describe('listUserTypes', () => {
    it('returns user types', async () => {
      const result = await service.listUserTypes()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Behavior Rules ──

  describe('listBehaviorRules', () => {
    it('returns behavior rules', async () => {
      const result = await service.listBehaviorRules()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Devices ──

  describe('listDevices', () => {
    it('returns devices', async () => {
      const result = await service.listDevices(null, null, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Threat Insight ──

  describe('getThreatInsightConfiguration', () => {
    it('returns threat insight config', async () => {
      const result = await service.getThreatInsightConfiguration()

      expect(result).toHaveProperty('action')
    })
  })

  // ── Authenticators ──

  describe('listAuthenticators', () => {
    it('returns authenticators', async () => {
      const result = await service.listAuthenticators()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Identity Providers ──

  describe('listIdentityProviders', () => {
    it('returns identity providers', async () => {
      const result = await service.listIdentityProviders(null, null, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Linked Object Definitions ──

  describe('listLinkedObjectDefinitions', () => {
    it('returns linked object definitions', async () => {
      const result = await service.listLinkedObjectDefinitions()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Group Rules ──

  describe('listGroupRules', () => {
    it('returns group rules', async () => {
      const result = await service.listGroupRules()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Schemas ──

  describe('getGroupSchema', () => {
    it('returns group schema', async () => {
      const result = await service.getGroupSchema()

      expect(result).toHaveProperty('definitions')
    })
  })

  // ── Policies ──

  describe('listPolicies', () => {
    it('returns policies for a type', async () => {
      const result = await service.listPolicies('Global Session (Okta Sign-On)')

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Dictionary Methods ──

  describe('getUsersDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getUsersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getGroupsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getGroupsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getApplicationsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getApplicationsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getEventTypesDictionary', () => {
    it('returns curated event types without API call', async () => {
      const result = await service.getEventTypesDictionary({})

      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })
  })

  // ── Profile Mappings ──

  describe('listProfileMappings', () => {
    it('returns profile mappings', async () => {
      const result = await service.listProfileMappings()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Inline Hooks ──

  describe('listInlineHooks', () => {
    it('returns inline hooks', async () => {
      const result = await service.listInlineHooks()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
