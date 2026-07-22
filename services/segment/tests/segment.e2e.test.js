'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

/**
 * Required e2e-config.json entry:
 *
 * "segment": {
 *   "configs": {
 *     "apiToken": "<Segment Public API token>",
 *     "writeKey": "<Source Write Key>"        // optional; enables the Tracking API tests
 *   },
 *   "testValues": {
 *     "sourceId": "<an existing source id>",       // optional, enables source-scoped reads
 *     "destinationId": "<a destination id>",        // optional, enables destination-scoped reads
 *     "spaceId": "<an Engage space id>",            // optional, enables Engage reads
 *     "audienceId": "<an audience id>",             // optional, enables audience-scoped reads
 *     "warehouseId": "<a warehouse id>",            // optional, enables warehouse reads
 *     "userId": "<an IAM user id>",                 // optional, enables IAM user reads
 *     "userGroupId": "<an IAM group id>",           // optional, enables IAM group reads
 *     "period": "2026-07-01",                        // optional, enables the usage reads
 *     "runWriteTests": false                         // set true to run the create/update/delete lifecycle
 *   }
 * }
 *
 * The suite is read-only by default: every management action that creates or mutates workspace
 * resources is skipped unless testValues.runWriteTests is true.
 */
describe('Segment Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('segment')
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

  const skipUnless = (value, label) => {
    if (!value) {
      console.log(`Skipping ${ label }: required testValue not set`)

      return true
    }

    return false
  }

  // ── Workspace ──

  describe('getWorkspace', () => {
    it('returns the workspace', async () => {
      const result = await service.getWorkspace()

      expect(result).toHaveProperty('data')
    })
  })

  // ── Read-only listings ──

  describe('list endpoints', () => {
    const LISTS = [
      ['listSources', () => [2]],
      ['listDestinations', () => [2]],
      ['listTrackingPlans', () => [undefined, 2]],
      ['listWarehouses', () => [2]],
      ['listFunctions', () => [undefined, 2]],
      ['listSpaces', () => [2]],
      ['listReverseEtlModels', () => [2]],
      ['listTransformations', () => [2]],
      ['listWorkspaceRegulations', () => [undefined, undefined, 2]],
      ['listSuppressions', () => [2]],
      ['listUsers', () => [2]],
      ['listInvites', () => [2]],
      ['listUserGroups', () => [2]],
      ['listRoles', () => [2]],
      ['listLabels', () => []],
      ['listAuditEvents', () => [undefined, undefined, undefined, undefined, 2]],
    ]

    it.each(LISTS)('%s returns a data envelope', async (name, args) => {
      const result = await service[name](...args())

      expect(result).toHaveProperty('data')
    })
  })

  // ── Dictionaries ──

  describe('dictionaries', () => {
    const WORKSPACE_DICTIONARIES = [
      'getSourcesDictionary',
      'getDestinationsDictionary',
      'getTrackingPlansDictionary',
      'getWarehousesDictionary',
      'getFunctionsDictionary',
      'getSourceCatalogDictionary',
      'getDestinationCatalogDictionary',
      'getWarehouseCatalogDictionary',
      'getSpacesDictionary',
      'getReverseEtlModelsDictionary',
      'getTransformationsDictionary',
      'getUsersDictionary',
      'getUserGroupsDictionary',
      'getRolesDictionary',
      'getRegulationsDictionary',
    ]

    it.each(WORKSPACE_DICTIONARIES)('%s returns dictionary items', async name => {
      const result = await service[name]({})

      expect(Array.isArray(result.items)).toBe(true)

      for (const item of result.items) {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
      }
    })

    it('getDestinationFiltersDictionary returns items for a destination', async () => {
      if (skipUnless(testValues.destinationId, 'getDestinationFiltersDictionary')) return

      const result = await service.getDestinationFiltersDictionary({
        criteria: { destinationId: testValues.destinationId },
      })

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('getAudiencesDictionary returns items for a space', async () => {
      if (skipUnless(testValues.spaceId, 'getAudiencesDictionary')) return

      const result = await service.getAudiencesDictionary({
        criteria: { spaceId: testValues.spaceId },
      })

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('getComputedTraitsDictionary returns items for a space', async () => {
      if (skipUnless(testValues.spaceId, 'getComputedTraitsDictionary')) return

      const result = await service.getComputedTraitsDictionary({
        criteria: { spaceId: testValues.spaceId },
      })

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('getProfilesWarehousesDictionary returns items for a space', async () => {
      if (skipUnless(testValues.spaceId, 'getProfilesWarehousesDictionary')) return

      const result = await service.getProfilesWarehousesDictionary({
        criteria: { spaceId: testValues.spaceId },
      })

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('getAudienceSchedulesDictionary returns items for an audience', async () => {
      if (skipUnless(testValues.spaceId && testValues.audienceId, 'getAudienceSchedulesDictionary')) return

      const result = await service.getAudienceSchedulesDictionary({
        criteria: { spaceId: testValues.spaceId, audienceId: testValues.audienceId },
      })

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('getAudienceDestinationsDictionary returns items for an audience', async () => {
      if (skipUnless(testValues.spaceId && testValues.audienceId, 'getAudienceDestinationsDictionary')) return

      const result = await service.getAudienceDestinationsDictionary({
        criteria: { spaceId: testValues.spaceId, audienceId: testValues.audienceId },
      })

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('getSupportedActionsDictionary returns items for a space', async () => {
      if (skipUnless(testValues.spaceId, 'getSupportedActionsDictionary')) return

      const result = await service.getSupportedActionsDictionary({
        criteria: { spaceId: testValues.spaceId, audienceType: 'Users' },
      })

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('getSpaceFiltersDictionary returns items for a space', async () => {
      if (skipUnless(testValues.spaceId, 'getSpaceFiltersDictionary')) return

      const result = await service.getSpaceFiltersDictionary({
        criteria: { integrationId: testValues.spaceId },
      })

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Resource-scoped reads ──

  describe('source-scoped reads', () => {
    it('getSource returns the source', async () => {
      if (skipUnless(testValues.sourceId, 'getSource')) return

      const result = await service.getSource(testValues.sourceId)

      expect(result).toHaveProperty('data')
    })

    it('listSourceRegulations returns regulations', async () => {
      if (skipUnless(testValues.sourceId, 'listSourceRegulations')) return

      const result = await service.listSourceRegulations(testValues.sourceId)

      expect(result).toHaveProperty('data')
    })

    it('getLatestLivePlugin returns the latest plugin or throws a mapped error', async () => {
      if (skipUnless(testValues.sourceId, 'getLatestLivePlugin')) return

      await expect(service.getLatestLivePlugin(testValues.sourceId)).resolves.toBeDefined()
    })
  })

  describe('destination-scoped reads', () => {
    it('getDestination returns the destination', async () => {
      if (skipUnless(testValues.destinationId, 'getDestination')) return

      const result = await service.getDestination(testValues.destinationId)

      expect(result).toHaveProperty('data')
    })

    it('listDestinationFilters returns filters', async () => {
      if (skipUnless(testValues.destinationId, 'listDestinationFilters')) return

      const result = await service.listDestinationFilters(testValues.destinationId)

      expect(result).toHaveProperty('data')
    })
  })

  describe('space-scoped reads', () => {
    it('getSpace returns the space', async () => {
      if (skipUnless(testValues.spaceId, 'getSpace')) return

      const result = await service.getSpace(testValues.spaceId)

      expect(result).toHaveProperty('data')
    })

    it('listAudiences returns audiences', async () => {
      if (skipUnless(testValues.spaceId, 'listAudiences')) return

      const result = await service.listAudiences(testValues.spaceId, undefined, 2)

      expect(result).toHaveProperty('data')
    })

    it('listComputedTraits returns computed traits', async () => {
      if (skipUnless(testValues.spaceId, 'listComputedTraits')) return

      const result = await service.listComputedTraits(testValues.spaceId, 2)

      expect(result).toHaveProperty('data')
    })

    it('listProfilesWarehouses returns profiles warehouses', async () => {
      if (skipUnless(testValues.spaceId, 'listProfilesWarehouses')) return

      const result = await service.listProfilesWarehouses(testValues.spaceId, 2)

      expect(result).toHaveProperty('data')
    })

    it('listSpaceFilters returns space filters', async () => {
      if (skipUnless(testValues.spaceId, 'listSpaceFilters')) return

      const result = await service.listSpaceFilters(testValues.spaceId, 2)

      expect(result).toHaveProperty('data')
    })

    it('listAudienceSchedules returns schedules', async () => {
      if (skipUnless(testValues.spaceId && testValues.audienceId, 'listAudienceSchedules')) return

      const result = await service.listAudienceSchedules(testValues.spaceId, testValues.audienceId)

      expect(result).toHaveProperty('data')
    })

    it('listActivations returns activations', async () => {
      if (skipUnless(testValues.spaceId && testValues.audienceId, 'listActivations')) return

      const result = await service.listActivations(testValues.spaceId, testValues.audienceId, 2)

      expect(result).toHaveProperty('data')
    })

    it('listAudienceDestinations returns destination connections', async () => {
      if (skipUnless(testValues.spaceId && testValues.audienceId, 'listAudienceDestinations')) return

      const result = await service.listAudienceDestinations(
        testValues.spaceId,
        testValues.audienceId,
        2
      )

      expect(result).toHaveProperty('data')
    })
  })

  describe('warehouse-scoped reads', () => {
    it('getWarehouse returns the warehouse', async () => {
      if (skipUnless(testValues.warehouseId, 'getWarehouse')) return

      const result = await service.getWarehouse(testValues.warehouseId)

      expect(result).toHaveProperty('data')
    })

    it('listWarehouseSyncs returns syncs', async () => {
      if (skipUnless(testValues.warehouseId, 'listWarehouseSyncs')) return

      const result = await service.listWarehouseSyncs(testValues.warehouseId, 2)

      expect(result).toHaveProperty('data')
    })

    it('getAdvancedSyncSchedule returns the schedule', async () => {
      if (skipUnless(testValues.warehouseId, 'getAdvancedSyncSchedule')) return

      await expect(service.getAdvancedSyncSchedule(testValues.warehouseId)).resolves.toBeDefined()
    })
  })

  describe('IAM reads', () => {
    it('getUser returns the user', async () => {
      if (skipUnless(testValues.userId, 'getUser')) return

      const result = await service.getUser(testValues.userId)

      expect(result).toHaveProperty('data')
    })

    it('listUserGroupsFromUser returns the groups of the user', async () => {
      if (skipUnless(testValues.userId, 'listUserGroupsFromUser')) return

      const result = await service.listUserGroupsFromUser(testValues.userId, 2)

      expect(result).toHaveProperty('data')
    })

    it('getUserGroup returns the group', async () => {
      if (skipUnless(testValues.userGroupId, 'getUserGroup')) return

      const result = await service.getUserGroup(testValues.userGroupId)

      expect(result).toHaveProperty('data')
    })

    it('listUsersFromUserGroup returns the members', async () => {
      if (skipUnless(testValues.userGroupId, 'listUsersFromUserGroup')) return

      const result = await service.listUsersFromUserGroup(testValues.userGroupId, 2)

      expect(result).toHaveProperty('data')
    })

    it('listInvitesFromUserGroup returns the invites', async () => {
      if (skipUnless(testValues.userGroupId, 'listInvitesFromUserGroup')) return

      const result = await service.listInvitesFromUserGroup(testValues.userGroupId, 2)

      expect(result).toHaveProperty('data')
    })
  })

  describe('usage reads', () => {
    it('getDailyWorkspaceApiCalls returns usage', async () => {
      if (skipUnless(testValues.period, 'getDailyWorkspaceApiCalls')) return

      const result = await service.getDailyWorkspaceApiCalls(testValues.period, 2)

      expect(result).toHaveProperty('data')
    })

    it('getDailyPerSourceApiCalls returns usage', async () => {
      if (skipUnless(testValues.period, 'getDailyPerSourceApiCalls')) return

      const result = await service.getDailyPerSourceApiCalls(testValues.period, 2)

      expect(result).toHaveProperty('data')
    })
  })

  // ── Tracking API (data plane) ──

  describe('tracking API', () => {
    const hasWriteKey = () => Boolean(sandbox.getService().writeKey)

    it('track sends an event', async () => {
      if (skipUnless(hasWriteKey(), 'track')) return

      const result = await service.track('flowrunner-e2e-user', undefined, 'FlowRunner E2E Event', {
        source: 'jest',
      })

      expect(result).toBeDefined()
    })

    it('identify sends traits', async () => {
      if (skipUnless(hasWriteKey(), 'identify')) return

      await expect(
        service.identify('flowrunner-e2e-user', undefined, { plan: 'test' })
      ).resolves.toBeDefined()
    })

    it('group associates the user with a group', async () => {
      if (skipUnless(hasWriteKey(), 'group')) return

      await expect(
        service.group('flowrunner-e2e-user', undefined, 'flowrunner-e2e-group', { name: 'E2E' })
      ).resolves.toBeDefined()
    })

    it('page sends a page view', async () => {
      if (skipUnless(hasWriteKey(), 'page')) return

      await expect(
        service.page('flowrunner-e2e-user', undefined, 'E2E Page', 'Docs')
      ).resolves.toBeDefined()
    })

    it('screen sends a screen view', async () => {
      if (skipUnless(hasWriteKey(), 'screen')) return

      await expect(
        service.screen('flowrunner-e2e-user', undefined, 'E2E Screen')
      ).resolves.toBeDefined()
    })

    it('alias merges two ids', async () => {
      if (skipUnless(hasWriteKey(), 'alias')) return

      await expect(
        service.alias('flowrunner-e2e-user', 'flowrunner-e2e-anon')
      ).resolves.toBeDefined()
    })

    it('batch sends several calls at once', async () => {
      if (skipUnless(hasWriteKey(), 'batch')) return

      await expect(
        service.batch([
          { type: 'track', userId: 'flowrunner-e2e-user', event: 'FlowRunner E2E Batch' },
        ])
      ).resolves.toBeDefined()
    })
  })

  // ── Polling trigger ──

  describe('onNewAuditEvent', () => {
    it('returns events and a state cursor', async () => {
      const result = await service.onNewAuditEvent({ triggerData: {}, state: {} })

      expect(Array.isArray(result.events)).toBe(true)
      expect(result).toHaveProperty('state')
    })

    it('is reachable through handleTriggerPollingForEvent', async () => {
      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewAuditEvent',
        triggerData: {},
        state: {},
      })

      expect(result).toHaveProperty('state')
    })
  })

  // ── Write lifecycle (opt-in) ──

  describe('label lifecycle', () => {
    it('creates and deletes a label', async () => {
      if (skipUnless(testValues.runWriteTests, 'label lifecycle')) return

      const value = `e2e-${ Date.now() }`

      await expect(
        service.createLabel('flowrunner', value, 'Created by the FlowRunner e2e suite')
      ).resolves.toBeDefined()

      await expect(service.deleteLabel('flowrunner', value)).resolves.toBeDefined()
    })
  })

  describe('user group lifecycle', () => {
    it('creates, renames and deletes a user group', async () => {
      if (skipUnless(testValues.runWriteTests, 'user group lifecycle')) return

      const created = await service.createUserGroup(`FlowRunner E2E ${ Date.now() }`)
      const groupId = created?.data?.userGroup?.id

      expect(groupId).toBeTruthy()

      await expect(service.updateUserGroup(groupId, 'FlowRunner E2E renamed')).resolves.toBeDefined()
      await expect(service.deleteUserGroup(groupId)).resolves.toBeDefined()
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('maps a 404 to a remediating message', async () => {
      await expect(service.getSource('flowrunner-missing-source')).rejects.toThrow(/Not found|404/)
    })

    it('rejects missing required parameters without calling the API', async () => {
      await expect(service.getSource()).rejects.toThrow(/Source is required/)
    })
  })
})
