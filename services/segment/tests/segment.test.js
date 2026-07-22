'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-api-token'
const WRITE_KEY = 'test-write-key'
const B = 'https://api.segmentapis.com'
const T = 'https://api.segment.io/v1'

const BASIC = `Basic ${ Buffer.from(`${ WRITE_KEY }:`).toString('base64') }`

describe('Segment Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiToken: API_TOKEN, writeKey: WRITE_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  const lastCall = () => mock.history[mock.history.length - 1]

  // ── Registration ──

  describe('service registration', () => {
    it('registers the API token and the optional write key', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiToken',
          displayName: 'API Token',
          type: 'STRING',
          required: true,
          shared: false,
        }),
        expect.objectContaining({
          name: 'writeKey',
          displayName: 'Source Write Key',
          type: 'STRING',
          required: false,
          shared: false,
        }),
      ])
    })
  })

  // ── Tracking API (data plane) ──

  describe('tracking API', () => {
    beforeEach(() => {
      mock.onAny().reply({ success: true })
    })

    it('track posts to the tracking host with basic auth and strips empty fields', async () => {
      const result = await service.track('u1', undefined, 'Order Completed', { revenue: 19.99 })

      expect(result).toEqual({ success: true })
      expect(lastCall().method).toBe('post')
      expect(lastCall().url).toBe(`${ T }/track`)

      expect(lastCall().headers).toMatchObject({
        Authorization: BASIC,
        'Content-Type': 'application/json',
      })

      expect(lastCall().body).toEqual({
        userId: 'u1',
        event: 'Order Completed',
        properties: { revenue: 19.99 },
      })
    })

    it('track sends every optional field when provided', async () => {
      await service.track(
        'u1',
        'anon-1',
        'Order Completed',
        { revenue: 1 },
        { ip: '8.8.8.8' },
        '2026-07-01T00:00:00Z',
        { All: false }
      )

      expect(lastCall().body).toEqual({
        userId: 'u1',
        anonymousId: 'anon-1',
        event: 'Order Completed',
        properties: { revenue: 1 },
        context: { ip: '8.8.8.8' },
        timestamp: '2026-07-01T00:00:00Z',
        integrations: { All: false },
      })
    })

    it('track requires an event name', async () => {
      await expect(service.track('u1', undefined, '')).rejects.toThrow(/Event is required/)
    })

    it('track requires an identity', async () => {
      await expect(service.track(undefined, undefined, 'Ordered')).rejects.toThrow(
        /Either User ID or Anonymous ID is required/
      )
    })

    it('identify posts traits', async () => {
      await service.identify('u1', undefined, { email: 'a@b.c' }, undefined, '2026-07-01')

      expect(lastCall().url).toBe(`${ T }/identify`)

      expect(lastCall().body).toEqual({
        userId: 'u1',
        traits: { email: 'a@b.c' },
        timestamp: '2026-07-01',
      })
    })

    it('identify requires an identity', async () => {
      await expect(service.identify()).rejects.toThrow(/Either User ID or Anonymous ID is required/)
    })

    it('group posts the group id', async () => {
      await service.group('u1', undefined, 'g1', { name: 'Acme' }, { ip: '1.1.1.1' })

      expect(lastCall().url).toBe(`${ T }/group`)

      expect(lastCall().body).toEqual({
        userId: 'u1',
        groupId: 'g1',
        traits: { name: 'Acme' },
        context: { ip: '1.1.1.1' },
      })
    })

    it('group requires a group id', async () => {
      await expect(service.group('u1', undefined, undefined)).rejects.toThrow(/Group ID is required/)
    })

    it('page posts the page name and category', async () => {
      await service.page(undefined, 'anon-1', 'Home', 'Docs', { path: '/' })

      expect(lastCall().url).toBe(`${ T }/page`)

      expect(lastCall().body).toEqual({
        anonymousId: 'anon-1',
        name: 'Home',
        category: 'Docs',
        properties: { path: '/' },
      })
    })

    it('page requires an identity', async () => {
      await expect(service.page()).rejects.toThrow(/Either User ID or Anonymous ID is required/)
    })

    it('screen posts the screen name', async () => {
      await service.screen('u1', undefined, 'Main', { variant: 'a' })

      expect(lastCall().url).toBe(`${ T }/screen`)
      expect(lastCall().body).toEqual({ userId: 'u1', name: 'Main', properties: { variant: 'a' } })
    })

    it('screen requires an identity', async () => {
      await expect(service.screen()).rejects.toThrow(/Either User ID or Anonymous ID is required/)
    })

    it('alias posts both ids', async () => {
      await service.alias('u1', 'anon-1')

      expect(lastCall().url).toBe(`${ T }/alias`)
      expect(lastCall().body).toEqual({ userId: 'u1', previousId: 'anon-1' })
    })

    it('alias requires a user id', async () => {
      await expect(service.alias(undefined, 'anon-1')).rejects.toThrow(/User ID is required/)
    })

    it('alias requires a previous id', async () => {
      await expect(service.alias('u1')).rejects.toThrow(/Previous ID is required/)
    })

    it('batch posts the array of calls', async () => {
      const payload = [{ type: 'track', userId: 'u1', event: 'A' }]

      await service.batch(payload, { app: 'test' })

      expect(lastCall().url).toBe(`${ T }/batch`)
      expect(lastCall().body).toEqual({ batch: payload, context: { app: 'test' } })
    })

    it('batch rejects an empty array', async () => {
      await expect(service.batch([])).rejects.toThrow(/Batch is required/)
    })

    it('wraps tracking API failures', async () => {
      mock.reset()

      mock.onPost(`${ T }/track`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { message: 'Invalid event' },
      })

      await expect(service.track('u1', undefined, 'A')).rejects.toThrow('Invalid event')
    })
  })

  describe('tracking API without a write key', () => {
    let noKeySandbox
    let noKeyService

    beforeAll(() => {
      jest.resetModules()
      noKeySandbox = createSandbox({ apiToken: API_TOKEN })
      require('../src/index.js')
      noKeyService = noKeySandbox.getService()
    })

    afterAll(() => {
      noKeySandbox.cleanup()
      jest.resetModules()
    })

    it('throws a remediating error before making a request', async () => {
      await expect(noKeyService.track('u1', undefined, 'A')).rejects.toThrow(
        /Source Write Key is required/
      )
    })
  })
})

// The sandbox instance used by the tracking-without-write-key block replaces the global, so the
// rest of the suite is set up in its own sandbox below.
describe('Segment Service (Public API)', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    jest.resetModules()
    sandbox = createSandbox({ apiToken: API_TOKEN, writeKey: WRITE_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  const lastCall = () => mock.history[mock.history.length - 1]

  // ── Request shape, method by method ──

  describe('request shapes', () => {
    beforeEach(() => {
      mock.onAny().reply({ data: {} })
    })

    const CASES = [
      // Workspace
      ['getWorkspace', [], 'get', `${ B }/`, {}, undefined],

      // Sources
      ['listSources', [3, 'Mw=='], 'get', `${ B }/sources`, { 'pagination.count': 3, 'pagination.cursor': 'Mw==' }, undefined],
      ['getSource', ['s1'], 'get', `${ B }/sources/s1`, {}, undefined],
      ['createSource', ['my-slug', 'md1'], 'post', `${ B }/sources`, {}, { slug: 'my-slug', metadataId: 'md1', enabled: true }],
      ['createSource', ['my-slug', 'md1', false, { a: 1 }], 'post', `${ B }/sources`, {}, { slug: 'my-slug', metadataId: 'md1', enabled: false, settings: { a: 1 } }],
      ['updateSource', ['s1', 'New', true, 'new-slug', { a: 1 }], 'patch', `${ B }/sources/s1`, {}, { name: 'New', enabled: true, slug: 'new-slug', settings: { a: 1 } }],
      ['updateSource', ['s1'], 'patch', `${ B }/sources/s1`, {}, {}],
      ['deleteSource', ['s1'], 'delete', `${ B }/sources/s1`, {}, undefined],

      // Destinations
      ['listDestinations', [], 'get', `${ B }/destinations`, {}, undefined],
      ['getDestination', ['d1'], 'get', `${ B }/destinations/d1`, {}, undefined],
      ['createDestination', ['s1', 'md1'], 'post', `${ B }/destinations`, {}, { sourceId: 's1', metadataId: 'md1', settings: {} }],
      ['createDestination', ['s1', 'md1', 'Name', true, { a: 1 }], 'post', `${ B }/destinations`, {}, { sourceId: 's1', metadataId: 'md1', settings: { a: 1 }, name: 'Name', enabled: true }],
      ['updateDestination', ['d1', 'Name', false, { a: 1 }], 'patch', `${ B }/destinations/d1`, {}, { name: 'Name', enabled: false, settings: { a: 1 } }],
      ['deleteDestination', ['d1'], 'delete', `${ B }/destinations/d1`, {}, undefined],

      // Destination filters
      ['listDestinationFilters', ['d1'], 'get', `${ B }/destination/d1/filters`, {}, undefined],
      ['getDestinationFilter', ['d1', 'f1'], 'get', `${ B }/destination/d1/filters/f1`, {}, undefined],
      ['createDestinationFilter', ['d1', 's1', 'T', 'type = "identify"', [{ type: 'DROP' }]], 'post', `${ B }/destination/d1/filters`, {}, { sourceId: 's1', title: 'T', if: 'type = "identify"', actions: [{ type: 'DROP' }], enabled: true }],
      ['createDestinationFilter', ['d1', 's1', 'T', 'type = "identify"', [{ type: 'DROP' }], false, 'desc'], 'post', `${ B }/destination/d1/filters`, {}, { sourceId: 's1', title: 'T', if: 'type = "identify"', actions: [{ type: 'DROP' }], enabled: false, description: 'desc' }],
      ['updateDestinationFilter', ['d1', 'f1', 'T2', 'type = "track"', [{ type: 'DROP' }], true, 'd'], 'patch', `${ B }/destination/d1/filters/f1`, {}, { title: 'T2', if: 'type = "track"', actions: [{ type: 'DROP' }], enabled: true, description: 'd' }],
      ['deleteDestinationFilter', ['d1', 'f1'], 'delete', `${ B }/destination/d1/filters/f1`, {}, undefined],

      // Tracking plans
      ['listTrackingPlans', ['Live', 5], 'get', `${ B }/tracking-plans`, { 'pagination.count': 5, type: 'LIVE' }, undefined],
      ['listTrackingPlans', ['CUSTOM_VALUE'], 'get', `${ B }/tracking-plans`, { type: 'CUSTOM_VALUE' }, undefined],
      ['getTrackingPlan', ['tp1'], 'get', `${ B }/tracking-plans/tp1`, {}, undefined],
      ['createTrackingPlan', ['Plan', 'Engage', 'desc'], 'post', `${ B }/tracking-plans`, {}, { name: 'Plan', type: 'ENGAGE', description: 'desc' }],
      ['updateTrackingPlan', ['tp1', 'Plan 2'], 'patch', `${ B }/tracking-plans/tp1`, {}, { name: 'Plan 2' }],
      ['deleteTrackingPlan', ['tp1'], 'delete', `${ B }/tracking-plans/tp1`, {}, undefined],

      // Warehouses
      ['listWarehouses', [], 'get', `${ B }/warehouses`, {}, undefined],
      ['getWarehouse', ['w1'], 'get', `${ B }/warehouses/w1`, {}, undefined],
      ['createWarehouse', ['md1', { host: 'h' }, 'WH', true], 'post', `${ B }/warehouses`, {}, { metadataId: 'md1', settings: { host: 'h' }, name: 'WH', enabled: true }],
      ['updateWarehouse', ['w1', { host: 'h' }], 'patch', `${ B }/warehouses/w1`, {}, { settings: { host: 'h' } }],
      ['deleteWarehouse', ['w1'], 'delete', `${ B }/warehouses/w1`, {}, undefined],

      // Functions
      ['listFunctions', ['Source', 2], 'get', `${ B }/functions`, { 'pagination.count': 2, resourceType: 'SOURCE' }, undefined],
      ['getFunction', ['fn1'], 'get', `${ B }/functions/fn1`, {}, undefined],
      ['createFunction', ['Fn', 'Destination', 'code()'], 'post', `${ B }/functions`, {}, { code: 'code()', displayName: 'Fn', resourceType: 'DESTINATION' }],
      ['createFunction', ['Fn', 'Destination', 'code()', [{ name: 'x' }], 'https://logo', 'desc'], 'post', `${ B }/functions`, {}, { code: 'code()', displayName: 'Fn', resourceType: 'DESTINATION', settings: [{ name: 'x' }], logoUrl: 'https://logo', description: 'desc' }],
      ['updateFunction', ['fn1', 'Fn2', 'code2()', [{ name: 'y' }], 'https://logo2', 'd'], 'patch', `${ B }/functions/fn1`, {}, { displayName: 'Fn2', code: 'code2()', settings: [{ name: 'y' }], logoUrl: 'https://logo2', description: 'd' }],
      ['deleteFunction', ['fn1'], 'delete', `${ B }/functions/fn1`, {}, undefined],

      // Spaces
      ['listSpaces', [10], 'get', `${ B }/spaces`, { 'pagination.count': 10 }, undefined],
      ['getSpace', ['sp1'], 'get', `${ B }/spaces/sp1`, {}, undefined],

      // Audiences
      ['listAudiences', ['sp1', 'Schedules', 5, 'c'], 'get', `${ B }/spaces/sp1/audiences`, { 'pagination.count': 5, 'pagination.cursor': 'c', include: 'schedules' }, undefined],
      ['getAudience', ['sp1', 'a1', 'Schedules'], 'get', `${ B }/spaces/sp1/audiences/a1`, { include: 'schedules' }, undefined],
      ['getAudience', ['sp1', 'a1'], 'get', `${ B }/spaces/sp1/audiences/a1`, {}, undefined],
      ['createAudience', ['sp1', 'A', 'Users', { query: 'x' }], 'post', `${ B }/spaces/sp1/audiences`, {}, { name: 'A', audienceType: 'USERS', definition: { query: 'x' }, enabled: true }],
      ['createAudience', ['sp1', 'A', 'Accounts', { query: 'x' }, false, 'desc', { o: 1 }], 'post', `${ B }/spaces/sp1/audiences`, {}, { name: 'A', audienceType: 'ACCOUNTS', definition: { query: 'x' }, enabled: false, description: 'desc', options: { o: 1 } }],
      ['updateAudience', ['sp1', 'a1', 'A2', true, 'd', { query: 'y' }, { o: 2 }], 'patch', `${ B }/spaces/sp1/audiences/a1`, {}, { name: 'A2', enabled: true, description: 'd', definition: { query: 'y' }, options: { o: 2 } }],
      ['deleteAudience', ['sp1', 'a1'], 'delete', `${ B }/spaces/sp1/audiences/a1`, {}, undefined],
      ['executeAudienceRun', ['sp1', 'a1'], 'post', `${ B }/spaces/sp1/audiences/a1/runs`, {}, undefined],

      // Audience schedules
      ['listAudienceSchedules', ['sp1', 'a1'], 'get', `${ B }/spaces/sp1/audiences/a1/schedules`, {}, undefined],
      ['getAudienceSchedule', ['sp1', 'a1', 'sc1'], 'get', `${ B }/spaces/sp1/audiences/a1/schedules/sc1`, {}, undefined],
      ['addAudienceSchedule', ['sp1', 'a1', 'Periodic', { hours: 1 }], 'post', `${ B }/spaces/sp1/audiences/a1/schedules`, {}, { strategy: 'PERIODIC', config: { hours: 1 } }],
      ['updateAudienceSchedule', ['sp1', 'a1', 'sc1', 'Specific Days', { days: [1] }], 'patch', `${ B }/spaces/sp1/audiences/a1/schedules/sc1`, {}, { strategy: 'SPECIFIC_DAYS', config: { days: [1] } }],
      ['deleteAudienceSchedule', ['sp1', 'a1', 'sc1'], 'delete', `${ B }/spaces/sp1/audiences/a1/schedules/sc1`, {}, undefined],

      // Audience previews
      ['createAudiencePreview', ['sp1', { query: 'x' }, 'Linked'], 'post', `${ B }/spaces/sp1/audiences/previews`, {}, { definition: { query: 'x' }, audienceType: 'LINKED' }],
      ['createAudiencePreview', ['sp1', { query: 'x' }, 'Users', { o: 1 }], 'post', `${ B }/spaces/sp1/audiences/previews`, {}, { definition: { query: 'x' }, audienceType: 'USERS', options: { o: 1 } }],
      ['getAudiencePreview', ['sp1', 'pr1'], 'get', `${ B }/spaces/sp1/audiences/previews/pr1`, {}, undefined],

      // Audience destinations & activations
      ['addDestinationToAudience', ['sp1', 'a1', { id: 'md1' }], 'post', `${ B }/spaces/sp1/audiences/a1/destination-connections`, {}, { destination: { id: 'md1' } }],
      ['addDestinationToAudience', ['sp1', 'a1', { id: 'md1' }, { sync: true }, { s: 1 }], 'post', `${ B }/spaces/sp1/audiences/a1/destination-connections`, {}, { destination: { id: 'md1' }, idSyncConfiguration: { sync: true }, connectionSettings: { s: 1 } }],
      ['listAudienceDestinations', ['sp1', 'a1', 5], 'get', `${ B }/spaces/sp1/audiences/a1/destination-connections`, { 'pagination.count': 5 }, undefined],
      ['updateAudienceDestination', ['sp1', 'a1', 'dc1', { sync: true }, { s: 1 }], 'patch', `${ B }/spaces/sp1/audiences/a1/destination-connections/dc1`, {}, { idSyncConfiguration: { sync: true }, connectionSettings: { s: 1 } }],
      ['removeAudienceDestination', ['sp1', 'a1', 'dc1'], 'delete', `${ B }/spaces/sp1/audiences/a1/destination-connections/dc1`, {}, undefined],
      ['addActivation', ['sp1', 'a1', 'dc1', 'AUDIENCE_ENTERED', 'Act', true, { map: 1 }], 'post', `${ B }/spaces/sp1/audiences/a1/destination-connections/dc1/activations`, {}, { activationType: 'AUDIENCE_ENTERED', activationName: 'Act', performResync: true, personalization: { map: 1 } }],
      ['addActivation', ['sp1', 'a1', 'dc1', 'AUDIENCE_ENTERED', 'Act', false, { map: 1 }, true, 'Display', { m: 1 }], 'post', `${ B }/spaces/sp1/audiences/a1/destination-connections/dc1/activations`, {}, { activationType: 'AUDIENCE_ENTERED', activationName: 'Act', performResync: false, personalization: { map: 1 }, enabled: true, displayName: 'Display', destinationMapping: { m: 1 } }],
      ['listActivations', ['sp1', 'a1'], 'get', `${ B }/spaces/sp1/audiences/a1/activations`, {}, undefined],
      ['getActivation', ['sp1', 'a1', 'ac1'], 'get', `${ B }/spaces/sp1/audiences/a1/activations/ac1`, {}, undefined],
      ['updateActivation', ['sp1', 'a1', 'ac1', true, 'Act2', 'Disp', false, { p: 1 }, { m: 1 }], 'patch', `${ B }/spaces/sp1/audiences/a1/activations/ac1`, {}, { enabled: true, activationName: 'Act2', displayName: 'Disp', performResync: false, personalization: { p: 1 }, destinationMapping: { m: 1 } }],
      ['removeActivation', ['sp1', 'a1', 'ac1'], 'delete', `${ B }/spaces/sp1/audiences/a1/activations/ac1`, {}, undefined],
      ['listSupportedDestinations', ['sp1', 'Users', 'slack', 'act1'], 'get', `${ B }/spaces/sp1/audienceType/USERS/supported-destinations`, { slug: 'slack', actionId: 'act1' }, undefined],
      ['listSupportedDestinations', ['sp1', 'Users'], 'get', `${ B }/spaces/sp1/audienceType/USERS/supported-destinations`, {}, undefined],

      // Computed traits
      ['listComputedTraits', ['sp1', 5, 'c'], 'get', `${ B }/spaces/sp1/computed-traits`, { 'pagination.count': 5, 'pagination.cursor': 'c' }, undefined],
      ['getComputedTrait', ['sp1', 'ct1'], 'get', `${ B }/spaces/sp1/computed-traits/ct1`, {}, undefined],
      ['createComputedTrait', ['sp1', 'CT', { query: 'x' }], 'post', `${ B }/spaces/sp1/computed-traits`, {}, { name: 'CT', definition: { query: 'x' }, enabled: true }],
      ['createComputedTrait', ['sp1', 'CT', { query: 'x' }, false, 'd', { o: 1 }], 'post', `${ B }/spaces/sp1/computed-traits`, {}, { name: 'CT', definition: { query: 'x' }, enabled: false, description: 'd', options: { o: 1 } }],
      ['updateComputedTrait', ['sp1', 'ct1', 'CT2', true, 'd', { query: 'y' }], 'patch', `${ B }/spaces/sp1/computed-traits/ct1`, {}, { name: 'CT2', enabled: true, description: 'd', definition: { query: 'y' } }],
      ['deleteComputedTrait', ['sp1', 'ct1'], 'delete', `${ B }/spaces/sp1/computed-traits/ct1`, {}, undefined],

      // Space filters
      ['listSpaceFilters', ['sp1', 5], 'get', `${ B }/filters`, { 'pagination.count': 5, integrationId: 'sp1' }, undefined],
      ['getSpaceFilter', ['sp1', 'f1'], 'get', `${ B }/filters/f1`, {}, undefined],
      ['createSpaceFilter', ['sp1', 'F', 'type = "track"'], 'post', `${ B }/filters`, {}, { integrationId: 'sp1', name: 'F', if: 'type = "track"' }],
      ['createSpaceFilter', ['sp1', 'F', 'type = "track"', true, 'd', false], 'post', `${ B }/filters`, {}, { integrationId: 'sp1', name: 'F', if: 'type = "track"', enabled: true, description: 'd', drop: false }],
      ['updateSpaceFilter', ['sp1', 'f1', 'F2', 'd', 'type = "page"', true, false], 'patch', `${ B }/filters/f1`, {}, { integrationId: 'sp1', name: 'F2', description: 'd', if: 'type = "page"', enabled: true, drop: false }],
      ['deleteSpaceFilter', ['sp1', 'f1'], 'delete', `${ B }/filters/f1`, {}, undefined],

      // Reverse ETL
      ['listReverseEtlModels', [], 'get', `${ B }/reverse-etl-models`, {}, undefined],
      ['getReverseEtlModel', ['m1'], 'get', `${ B }/reverse-etl-models/m1`, {}, undefined],
      ['createReverseEtlModel', ['s1', 'M', 'd', true, 'select 1', 'id'], 'post', `${ B }/reverse-etl-models`, {}, { sourceId: 's1', name: 'M', description: 'd', enabled: true, query: 'select 1', queryIdentifierColumn: 'id' }],
      ['updateReverseEtlModel', ['m1', 'M2', 'd2', false, 'select 2', 'id2'], 'patch', `${ B }/reverse-etl-models/m1`, {}, { name: 'M2', description: 'd2', enabled: false, query: 'select 2', queryIdentifierColumn: 'id2' }],
      ['deleteReverseEtlModel', ['m1'], 'delete', `${ B }/reverse-etl-models/m1`, {}, undefined],
      ['createReverseEtlSync', ['s1', 'm1', 'sub1'], 'post', `${ B }/reverse-etl-syncs`, {}, { sourceId: 's1', modelId: 'm1', subscriptionId: 'sub1' }],
      ['getReverseEtlSyncStatus', ['m1', 'sy1'], 'get', `${ B }/reverse-etl-models/m1/syncs/sy1`, {}, undefined],
      ['listReverseEtlSyncStatuses', ['m1', 'sub1', 5, 'c'], 'get', `${ B }/reverse-etl-models/m1/subscriptionId/sub1/syncs`, { count: 5, cursor: 'c' }, undefined],
      ['cancelReverseEtlSync', ['m1', 'sy1', 'Incorrect Keys'], 'post', `${ B }/reverse-etl-models/m1/syncs/sy1/cancel`, {}, { reasonForCanceling: 2 }],

      // Profiles Sync
      ['listProfilesWarehouses', ['sp1', 5], 'get', `${ B }/spaces/sp1/profiles-warehouses`, { 'pagination.count': 5 }, undefined],
      ['createProfilesWarehouse', ['sp1', 'md1', { host: 'h' }], 'post', `${ B }/spaces/sp1/profiles-warehouses`, {}, { metadataId: 'md1', settings: { host: 'h' } }],
      ['createProfilesWarehouse', ['sp1', 'md1', { host: 'h' }, 'WH', true, 'schema'], 'post', `${ B }/spaces/sp1/profiles-warehouses`, {}, { metadataId: 'md1', settings: { host: 'h' }, name: 'WH', enabled: true, schemaName: 'schema' }],
      ['updateProfilesWarehouse', ['sp1', 'w1', { host: 'h' }, 'WH', false, 'schema'], 'patch', `${ B }/spaces/sp1/profiles-warehouses/w1`, {}, { settings: { host: 'h' }, name: 'WH', enabled: false, schemaName: 'schema' }],
      ['deleteProfilesWarehouse', ['sp1', 'w1'], 'delete', `${ B }/spaces/sp1/profiles-warehouses/w1`, {}, undefined],
      ['listProfilesSelectiveSyncs', ['sp1', 'w1'], 'get', `${ B }/spaces/sp1/profiles-warehouses/w1/selective-syncs`, {}, undefined],
      ['updateProfilesSelectiveSync', ['sp1', 'w1', { s: 1 }, [{ o: 1 }], true], 'patch', `${ B }/spaces/sp1/profiles-warehouses/w1/selective-syncs`, {}, { settings: { s: 1 }, syncOverrides: [{ o: 1 }], enableEventTables: true }],

      // Selective sync
      ['getAdvancedSyncSchedule', ['w1'], 'get', `${ B }/warehouses/w1/advanced-sync-schedule`, {}, undefined],
      ['replaceAdvancedSyncSchedule', ['w1', true, [{ time: '01:00' }]], 'put', `${ B }/warehouses/w1/advanced-sync-schedule`, {}, { enabled: true, schedule: [{ time: '01:00' }] }],
      ['listWarehouseSelectiveSyncs', ['w1', 's1'], 'get', `${ B }/warehouses/w1/connected-sources/s1/selective-syncs`, {}, undefined],
      ['listWarehouseSyncs', ['w1', 5], 'get', `${ B }/warehouses/w1/syncs`, { 'pagination.count': 5 }, undefined],
      ['listWarehouseSourceSyncs', ['w1', 's1'], 'get', `${ B }/warehouses/w1/connected-sources/s1/syncs`, {}, undefined],
      ['updateWarehouseSelectiveSync', ['w1', [{ o: 1 }]], 'patch', `${ B }/warehouses/w1/selective-sync`, {}, { syncOverrides: [{ o: 1 }] }],

      // Live plugins
      ['createLivePlugin', ['s1', 'code()'], 'post', `${ B }/sources/s1/live-plugins/create`, {}, { code: 'code()' }],
      ['getLatestLivePlugin', ['s1'], 'get', `${ B }/sources/s1/live-plugins/latest`, {}, undefined],
      ['deleteLivePluginCode', ['s1'], 'delete', `${ B }/sources/s1/live-plugins/delete-code`, {}, undefined],

      // dbt
      ['createDbtModelSync', ['s1', 'dbt1'], 'post', `${ B }/dbt-models/dbt1/sync`, {}, { sourceId: 's1' }],

      // Transformations
      ['listTransformations', [], 'get', `${ B }/transformations`, {}, undefined],
      ['getTransformation', ['t1'], 'get', `${ B }/transformations/t1`, {}, undefined],
      ['createTransformation', ['T', 's1', true, 'type = "track"'], 'post', `${ B }/transformations`, {}, { name: 'T', sourceId: 's1', enabled: true, if: 'type = "track"' }],
      ['createTransformation', ['T', 's1', true, 'type = "track"', 'dmd1', false, 'New', [{ a: 1 }], [{ b: 1 }], [{ c: 1 }], ['x'], { h: 1 }], 'post', `${ B }/transformations`, {}, { name: 'T', sourceId: 's1', enabled: true, if: 'type = "track"', destinationMetadataId: 'dmd1', drop: false, newEventName: 'New', propertyRenames: [{ a: 1 }], propertyValueTransformations: [{ b: 1 }], fqlDefinedProperties: [{ c: 1 }], allowProperties: ['x'], hashPropertiesConfiguration: { h: 1 } }],
      ['updateTransformation', ['t1', 'T2', 's2', false, 'type = "page"', 'dmd1', true, 'New', [{ a: 1 }], [{ b: 1 }], [{ c: 1 }], ['x'], { h: 1 }], 'patch', `${ B }/transformations/t1`, {}, { name: 'T2', sourceId: 's2', enabled: false, if: 'type = "page"', destinationMetadataId: 'dmd1', drop: true, newEventName: 'New', propertyRenames: [{ a: 1 }], propertyValueTransformations: [{ b: 1 }], fqlDefinedProperties: [{ c: 1 }], allowProperties: ['x'], hashPropertiesConfiguration: { h: 1 } }],
      ['updateTransformation', ['t1'], 'patch', `${ B }/transformations/t1`, {}, {}],
      ['deleteTransformation', ['t1'], 'delete', `${ B }/transformations/t1`, {}, undefined],

      // Regulations
      ['createWorkspaceRegulation', ['Delete Only', 'User ID', ['u1']], 'post', `${ B }/regulations`, {}, { regulationType: 'DELETE_ONLY', subjectType: 'USER_ID', subjectIds: ['u1'] }],
      ['createSourceRegulation', ['s1', 'Delete Archive Only', 'Anonymous ID', ['a1']], 'post', `${ B }/regulations/sources/s1`, {}, { regulationType: 'DELETE_ARCHIVE_ONLY', subjectType: 'ANONYMOUS_ID', subjectIds: ['a1'] }],
      ['createCloudSourceRegulation', ['s1', 'Suppress Only', 'Object ID', ['o1'], 'coll'], 'post', `${ B }/regulations/cloudsources/s1`, {}, { regulationType: 'SUPPRESS_ONLY', subjectType: 'OBJECT_ID', subjectIds: ['o1'], collection: 'coll' }],
      ['listWorkspaceRegulations', ['Finished', ['DELETE_ONLY'], 5], 'get', `${ B }/regulations`, { 'pagination.count': 5, status: 'FINISHED', regulationTypes: ['DELETE_ONLY'] }, undefined],
      ['listSourceRegulations', ['s1', 'Running'], 'get', `${ B }/regulations/sources/s1`, { status: 'RUNNING' }, undefined],
      ['getRegulation', ['r1'], 'get', `${ B }/regulations/r1`, {}, undefined],
      ['listSuppressions', [3], 'get', `${ B }/suppressions`, { 'pagination.count': 3 }, undefined],

      // Delivery overview
      ['getEgressSuccessMetrics', ['s1', 'dc1', 'start', 'end', 'Day', ['a'], 'f', 5, 'c'], 'get', `${ B }/delivery-overview/successful-delivery`, { 'pagination.count': 5, 'pagination.cursor': 'c', sourceId: 's1', destinationConfigId: 'dc1', startTime: 'start', endTime: 'end', granularity: 'DAY', groupBy: ['a'], filter: 'f' }, undefined],
      ['getEgressFailedMetrics', ['s1', 'dc1', 'start', 'end', 'Hour'], 'get', `${ B }/delivery-overview/failed-delivery`, { sourceId: 's1', destinationConfigId: 'dc1', startTime: 'start', endTime: 'end', granularity: 'HOUR' }, undefined],
      ['getFilteredAtDestination', ['s1', 'dc1', 'start', 'end', 'Minute'], 'get', `${ B }/delivery-overview/filtered-at-destination`, { sourceId: 's1', destinationConfigId: 'dc1', startTime: 'start', endTime: 'end', granularity: 'MINUTE' }, undefined],
      ['getFilteredAtSource', ['s1', 'start', 'end', 'Day'], 'get', `${ B }/delivery-overview/filtered-at-source`, { sourceId: 's1', startTime: 'start', endTime: 'end', granularity: 'DAY' }, undefined],
      ['getIngressFailedMetrics', ['s1', 'start', 'end', 'Day'], 'get', `${ B }/delivery-overview/failed-on-ingest`, { sourceId: 's1', startTime: 'start', endTime: 'end', granularity: 'DAY' }, undefined],
      ['getIngressSuccessMetrics', ['s1', 'start', 'end', 'Day'], 'get', `${ B }/delivery-overview/successfully-received`, { sourceId: 's1', startTime: 'start', endTime: 'end', granularity: 'DAY' }, undefined],

      // IAM - users
      ['listUsers', [5], 'get', `${ B }/users`, { 'pagination.count': 5 }, undefined],
      ['getUser', ['u1'], 'get', `${ B }/users/u1`, {}, undefined],
      ['deleteUsers', [['u1', 'u2']], 'delete', `${ B }/users`, { userIds: ['u1', 'u2'] }, undefined],
      ['listUserGroupsFromUser', ['u1'], 'get', `${ B }/users/u1/groups`, {}, undefined],
      ['addUserPermissions', ['u1', [{ roleId: 'r1' }]], 'post', `${ B }/users/u1/permissions`, {}, { permissions: [{ roleId: 'r1' }] }],
      ['replaceUserPermissions', ['u1', [{ roleId: 'r1' }]], 'put', `${ B }/users/u1/permissions`, {}, { permissions: [{ roleId: 'r1' }] }],

      // IAM - invites
      ['createInvites', [[{ email: 'a@b.c' }]], 'post', `${ B }/invites`, {}, { invites: [{ email: 'a@b.c' }] }],
      ['listInvites', [], 'get', `${ B }/invites`, {}, undefined],
      ['deleteInvites', [['a@b.c']], 'delete', `${ B }/invites`, { emails: ['a@b.c'] }, undefined],

      // IAM - user groups
      ['listUserGroups', [], 'get', `${ B }/groups`, {}, undefined],
      ['getUserGroup', ['g1'], 'get', `${ B }/groups/g1`, {}, undefined],
      ['createUserGroup', ['G'], 'post', `${ B }/groups`, {}, { name: 'G' }],
      ['updateUserGroup', ['g1', 'G2'], 'patch', `${ B }/groups/g1`, {}, { name: 'G2' }],
      ['deleteUserGroup', ['g1'], 'delete', `${ B }/groups/g1`, {}, undefined],
      ['addUsersToUserGroup', ['g1', ['a@b.c']], 'post', `${ B }/groups/g1/users`, {}, { emails: ['a@b.c'] }],
      ['listUsersFromUserGroup', ['g1'], 'get', `${ B }/groups/g1/users`, {}, undefined],
      ['replaceUsersInUserGroup', ['g1', ['a@b.c']], 'put', `${ B }/group/g1/users`, {}, { emails: ['a@b.c'] }],
      ['removeUsersFromUserGroup', ['g1', ['a@b.c']], 'delete', `${ B }/group/g1/users`, { emails: ['a@b.c'] }, undefined],
      ['listInvitesFromUserGroup', ['g1'], 'get', `${ B }/groups/g1/invites`, {}, undefined],
      ['addUserGroupPermissions', ['g1', [{ roleId: 'r1' }]], 'post', `${ B }/groups/g1/permissions`, {}, { permissions: [{ roleId: 'r1' }] }],
      ['replaceUserGroupPermissions', ['g1', [{ roleId: 'r1' }]], 'put', `${ B }/groups/g1/permissions`, {}, { permissions: [{ roleId: 'r1' }] }],

      // IAM - roles
      ['listRoles', [], 'get', `${ B }/roles`, {}, undefined],

      // Labels
      ['listLabels', [], 'get', `${ B }/labels`, {}, undefined],
      ['createLabel', ['env', 'prod'], 'post', `${ B }/labels`, {}, { label: { key: 'env', value: 'prod' } }],
      ['createLabel', ['env', 'prod', 'desc'], 'post', `${ B }/labels`, {}, { label: { key: 'env', value: 'prod', description: 'desc' } }],
      ['deleteLabel', ['env', 'prod'], 'delete', `${ B }/labels/env/prod`, {}, undefined],

      // Audit trail
      ['listAuditEvents', ['start', 'end', 'res1', 'SOURCE', 5, 'c'], 'get', `${ B }/audit-events`, { 'pagination.count': 5, 'pagination.cursor': 'c', startTime: 'start', endTime: 'end', resourceId: 'res1', resourceType: 'SOURCE' }, undefined],
      ['listAuditEvents', [], 'get', `${ B }/audit-events`, {}, undefined],

      // Usage
      ['getDailyWorkspaceApiCalls', ['2026-07-01', 5], 'get', `${ B }/usage/api-calls/daily`, { 'pagination.count': 5, period: '2026-07-01' }, undefined],
      ['getDailyPerSourceApiCalls', ['2026-07-01'], 'get', `${ B }/usage/api-calls/sources/daily`, { period: '2026-07-01' }, undefined],

      // Customer insights
      ['createCustomerInsightsDownload', ['coll1', '2026-07-01T10'], 'post', `${ B }/customer-insights/download`, {}, { collectionId: 'coll1', hour: '2026-07-01T10' }],
    ]

    it.each(CASES)('%s builds the expected request', async (name, args, method, url, query, body) => {
      await service[name](...args)

      expect(lastCall().method).toBe(method)
      expect(lastCall().url).toBe(url)
      expect(lastCall().query).toEqual(query)
      expect(lastCall().body).toEqual(body)

      expect(lastCall().headers).toMatchObject({
        Authorization: `Bearer ${ API_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Required-parameter validation ──

  describe('required parameter validation', () => {
    const CASES = [
      ['getSource', [], /Source is required/],
      ['createSource', [undefined, 'md1'], /Slug is required/],
      ['createSource', ['slug'], /Source Type is required/],
      ['updateSource', [], /Source is required/],
      ['deleteSource', [''], /Source is required/],
      ['getDestination', [], /Destination is required/],
      ['createDestination', [undefined, 'md1'], /Source is required/],
      ['createDestination', ['s1'], /Destination Type is required/],
      ['updateDestination', [], /Destination is required/],
      ['deleteDestination', [], /Destination is required/],
      ['listDestinationFilters', [], /Destination is required/],
      ['getDestinationFilter', ['d1'], /Filter is required/],
      ['createDestinationFilter', ['d1', 's1', 'T', 'if', []], /Actions is required/],
      ['createDestinationFilter', ['d1', 's1', 'T'], /Condition \(FQL\) is required/],
      ['createDestinationFilter', ['d1', 's1'], /Title is required/],
      ['updateDestinationFilter', ['d1'], /Filter is required/],
      ['deleteDestinationFilter', ['d1'], /Filter is required/],
      ['getTrackingPlan', [], /Tracking Plan is required/],
      ['createTrackingPlan', ['Name'], /Type is required/],
      ['createTrackingPlan', [], /Name is required/],
      ['updateTrackingPlan', [], /Tracking Plan is required/],
      ['deleteTrackingPlan', [], /Tracking Plan is required/],
      ['getWarehouse', [], /Warehouse is required/],
      ['createWarehouse', ['md1'], /Settings is required/],
      ['createWarehouse', [], /Warehouse Type is required/],
      ['updateWarehouse', ['w1'], /Settings is required/],
      ['deleteWarehouse', [], /Warehouse is required/],
      ['getFunction', [], /Function is required/],
      ['createFunction', ['Fn', 'Source'], /Code is required/],
      ['createFunction', ['Fn'], /Function Type is required/],
      ['createFunction', [], /Display Name is required/],
      ['updateFunction', [], /Function is required/],
      ['deleteFunction', [], /Function is required/],
      ['getSpace', [], /Space is required/],
      ['listAudiences', [], /Space is required/],
      ['getAudience', ['sp1'], /Audience is required/],
      ['createAudience', ['sp1', 'A', 'Users'], /Definition is required/],
      ['createAudience', ['sp1', 'A'], /Audience Type is required/],
      ['createAudience', ['sp1'], /Name is required/],
      ['updateAudience', ['sp1'], /Audience is required/],
      ['deleteAudience', ['sp1'], /Audience is required/],
      ['executeAudienceRun', ['sp1'], /Audience is required/],
      ['listAudienceSchedules', ['sp1'], /Audience is required/],
      ['getAudienceSchedule', ['sp1', 'a1'], /Schedule ID is required/],
      ['addAudienceSchedule', ['sp1', 'a1', 'Periodic'], /Config is required/],
      ['addAudienceSchedule', ['sp1', 'a1'], /Strategy is required/],
      ['updateAudienceSchedule', ['sp1', 'a1', 'sc1', 'Periodic'], /Config is required/],
      ['deleteAudienceSchedule', ['sp1', 'a1'], /Schedule ID is required/],
      ['createAudiencePreview', ['sp1', { query: 'x' }], /Audience Type is required/],
      ['createAudiencePreview', ['sp1'], /Definition is required/],
      ['getAudiencePreview', ['sp1'], /Preview ID is required/],
      ['addDestinationToAudience', ['sp1', 'a1'], /Destination is required/],
      ['listAudienceDestinations', ['sp1'], /Audience is required/],
      ['updateAudienceDestination', ['sp1', 'a1'], /Destination Connection ID is required/],
      ['removeAudienceDestination', ['sp1', 'a1'], /Destination Connection ID is required/],
      ['addActivation', ['sp1', 'a1', 'dc1', 'T', 'Name'], /Personalization is required/],
      ['addActivation', ['sp1', 'a1', 'dc1', 'T'], /Activation Name is required/],
      ['addActivation', ['sp1', 'a1', 'dc1'], /Activation Type is required/],
      ['addActivation', ['sp1', 'a1'], /Destination Connection is required/],
      ['listActivations', ['sp1'], /Audience is required/],
      ['getActivation', ['sp1', 'a1'], /Activation ID is required/],
      ['updateActivation', ['sp1', 'a1'], /Activation ID is required/],
      ['removeActivation', ['sp1', 'a1'], /Activation ID is required/],
      ['listSupportedDestinations', ['sp1'], /Audience Type is required/],
      ['listComputedTraits', [], /Space is required/],
      ['getComputedTrait', ['sp1'], /Computed Trait is required/],
      ['createComputedTrait', ['sp1', 'CT'], /Definition is required/],
      ['createComputedTrait', ['sp1'], /Name is required/],
      ['updateComputedTrait', ['sp1'], /Computed Trait is required/],
      ['deleteComputedTrait', ['sp1'], /Computed Trait is required/],
      ['listSpaceFilters', [], /Space is required/],
      ['getSpaceFilter', ['sp1'], /Space Filter is required/],
      ['createSpaceFilter', ['sp1', 'F'], /Condition \(FQL\) is required/],
      ['createSpaceFilter', ['sp1'], /Name is required/],
      ['updateSpaceFilter', ['sp1'], /Space Filter is required/],
      ['deleteSpaceFilter', ['sp1'], /Space Filter is required/],
      ['getReverseEtlModel', [], /Model is required/],
      ['createReverseEtlModel', ['s1', 'M', 'd', true, 'select 1'], /Identifier Column is required/],
      ['createReverseEtlModel', ['s1', 'M', 'd', true], /SQL Query is required/],
      ['createReverseEtlModel', ['s1', 'M', 'd'], /Enabled is required/],
      ['createReverseEtlModel', ['s1', 'M'], /Description is required/],
      ['createReverseEtlModel', ['s1'], /Name is required/],
      ['updateReverseEtlModel', [], /Model is required/],
      ['deleteReverseEtlModel', [], /Model is required/],
      ['createReverseEtlSync', ['s1', 'm1'], /Subscription \(Mapping\) ID is required/],
      ['getReverseEtlSyncStatus', ['m1'], /Sync ID is required/],
      ['listReverseEtlSyncStatuses', ['m1'], /Subscription \(Mapping\) ID is required/],
      ['cancelReverseEtlSync', ['m1', 'sy1'], /Reason is required/],
      ['listProfilesWarehouses', [], /Space is required/],
      ['createProfilesWarehouse', ['sp1', 'md1'], /Settings is required/],
      ['createProfilesWarehouse', ['sp1'], /Warehouse Type is required/],
      ['updateProfilesWarehouse', ['sp1', 'w1'], /Settings is required/],
      ['deleteProfilesWarehouse', ['sp1'], /Profiles Warehouse ID is required/],
      ['listProfilesSelectiveSyncs', ['sp1'], /Profiles Warehouse ID is required/],
      ['updateProfilesSelectiveSync', ['sp1', 'w1'], /Settings is required/],
      ['getAdvancedSyncSchedule', [], /Warehouse is required/],
      ['replaceAdvancedSyncSchedule', ['w1', true], /Schedule is required/],
      ['replaceAdvancedSyncSchedule', ['w1'], /Enabled is required/],
      ['listWarehouseSelectiveSyncs', ['w1'], /Source is required/],
      ['listWarehouseSyncs', [], /Warehouse is required/],
      ['listWarehouseSourceSyncs', ['w1'], /Source is required/],
      ['updateWarehouseSelectiveSync', ['w1'], /Sync Overrides is required/],
      ['createLivePlugin', ['s1'], /Code is required/],
      ['getLatestLivePlugin', [], /Source is required/],
      ['deleteLivePluginCode', [], /Source is required/],
      ['createDbtModelSync', ['s1'], /dbt Model ID is required/],
      ['getTransformation', [], /Transformation is required/],
      ['createTransformation', ['T', 's1', true], /Condition \(FQL\) is required/],
      ['createTransformation', ['T', 's1'], /Enabled is required/],
      ['createTransformation', ['T'], /Source is required/],
      ['createTransformation', [], /Name is required/],
      ['updateTransformation', [], /Transformation is required/],
      ['deleteTransformation', [], /Transformation is required/],
      ['createWorkspaceRegulation', ['Delete Only', 'User ID', []], /Subject IDs is required/],
      ['createWorkspaceRegulation', ['Delete Only'], /Subject Type is required/],
      ['createWorkspaceRegulation', [], /Regulation Type is required/],
      ['createSourceRegulation', ['s1', 'Delete Only', 'User ID'], /Subject IDs is required/],
      ['createSourceRegulation', [], /Source is required/],
      ['createCloudSourceRegulation', ['s1', 'Delete Only', 'Object ID', ['o1']], /Collection is required/],
      ['listSourceRegulations', [], /Source is required/],
      ['getRegulation', [], /Regulate ID is required/],
      ['getEgressSuccessMetrics', ['s1', 'dc1', 'start', 'end'], /Granularity is required/],
      ['getEgressSuccessMetrics', ['s1', 'dc1', 'start'], /End Time is required/],
      ['getEgressSuccessMetrics', ['s1', 'dc1'], /Start Time is required/],
      ['getEgressSuccessMetrics', ['s1'], /Destination is required/],
      ['getEgressSuccessMetrics', [], /Source is required/],
      ['getFilteredAtSource', [], /Source is required/],
      ['getUser', [], /User is required/],
      ['deleteUsers', [[]], /User IDs is required/],
      ['listUserGroupsFromUser', [], /User is required/],
      ['addUserPermissions', ['u1'], /Permissions is required/],
      ['replaceUserPermissions', ['u1'], /Permissions is required/],
      ['createInvites', [[]], /Invites is required/],
      ['deleteInvites', [[]], /Emails is required/],
      ['getUserGroup', [], /User Group is required/],
      ['createUserGroup', [], /Name is required/],
      ['updateUserGroup', ['g1'], /Name is required/],
      ['deleteUserGroup', [], /User Group is required/],
      ['addUsersToUserGroup', ['g1'], /Emails is required/],
      ['listUsersFromUserGroup', [], /User Group is required/],
      ['replaceUsersInUserGroup', ['g1'], /Emails is required/],
      ['removeUsersFromUserGroup', ['g1'], /Emails is required/],
      ['listInvitesFromUserGroup', [], /User Group is required/],
      ['addUserGroupPermissions', ['g1'], /Permissions is required/],
      ['replaceUserGroupPermissions', ['g1'], /Permissions is required/],
      ['createLabel', ['env'], /Value is required/],
      ['createLabel', [], /Key is required/],
      ['deleteLabel', ['env'], /Value is required/],
      ['getDailyWorkspaceApiCalls', [], /Period is required/],
      ['getDailyPerSourceApiCalls', [], /Period is required/],
      ['createCustomerInsightsDownload', ['coll1'], /Hour is required/],
      ['createCustomerInsightsDownload', [], /Collection ID is required/],
    ]

    it.each(CASES)('%s rejects when a required argument is missing', async (name, args, message) => {
      await expect(service[name](...args)).rejects.toThrow(message)
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('prefixes a 401 with the authentication hint', async () => {
      mock.onGet(`${ B }/sources`).replyWithError({ status: 401, body: { message: 'no token' } })

      await expect(service.listSources()).rejects.toThrow(
        'Authentication failed — check the API Token config item. (no token)'
      )
    })

    it('prefixes a 403 with the permission hint', async () => {
      mock.onGet(`${ B }/sources`).replyWithError({ status: 403, message: 'nope' })

      await expect(service.listSources()).rejects.toThrow(/Permission denied/)
    })

    it('prefixes a 404 with the not-found hint', async () => {
      mock.onGet(`${ B }/sources/s1`).replyWithError({ status: 404, message: 'missing' })

      await expect(service.getSource('s1')).rejects.toThrow(/Not found/)
    })

    it('prefixes a 429 with the rate limit hint', async () => {
      mock.onGet(`${ B }/sources`).replyWithError({ status: 429, message: 'slow down' })

      await expect(service.listSources()).rejects.toThrow(/Rate limit hit/)
    })

    it('reads a nested error message', async () => {
      mock.onGet(`${ B }/sources`).replyWithError({
        status: 400,
        body: { error: { message: 'invalid cursor' } },
      })

      await expect(service.listSources()).rejects.toThrow('invalid cursor')
    })

    it('falls back to a generic message', async () => {
      mock.onGet(`${ B }/sources`).replyWithError({ message: '' })

      await expect(service.listSources()).rejects.toThrow('Request failed')
    })
  })

  // ── Pagination helper ──

  describe('pagination', () => {
    beforeEach(() => {
      mock.onAny().reply({ data: {} })
    })

    it('omits pagination params when unset', async () => {
      await service.listSources()

      expect(lastCall().query).toEqual({})
    })

    it('omits an empty count', async () => {
      await service.listSources('', '')

      expect(lastCall().query).toEqual({})
    })

    it('keeps a zero count', async () => {
      await service.listSources(0)

      expect(lastCall().query).toEqual({ 'pagination.count': 0 })
    })
  })

  // ── Polling trigger ──

  describe('onNewAuditEvent', () => {
    const auditPage = (events, next) => ({ data: { events, pagination: next ? { next } : {} } })

    it('returns an empty result when there are no events', async () => {
      mock.onGet(`${ B }/audit-events`).reply(auditPage([]))

      const result = await service.onNewAuditEvent({ triggerData: {}, state: {} })

      expect(result).toEqual({ events: [], state: { lastSeen: undefined, seenIds: [] } })
    })

    it('establishes a baseline on the first poll without emitting events', async () => {
      mock.onGet(`${ B }/audit-events`).reply(
        auditPage([
          { id: 'e1', timestamp: '2026-07-01T10:00:00Z' },
          { id: 'e2', timestamp: '2026-07-01T12:00:00Z' },
        ])
      )

      const result = await service.onNewAuditEvent({ triggerData: {}, state: {} })

      expect(result.events).toEqual([])
      expect(result.state).toEqual({ lastSeen: '2026-07-01T12:00:00Z', seenIds: ['e2'] })
    })

    it('emits a single sample in learning mode', async () => {
      mock.onGet(`${ B }/audit-events`).reply(
        auditPage([
          { id: 'e1', timestamp: '2026-07-01T10:00:00Z' },
          { id: 'e2', timestamp: '2026-07-01T12:00:00Z' },
        ])
      )

      const result = await service.onNewAuditEvent({ triggerData: {}, state: {}, learningMode: true })

      expect(result.events).toEqual([{ id: 'e1', timestamp: '2026-07-01T10:00:00Z' }])
      expect(result.state.lastSeen).toBe('2026-07-01T12:00:00Z')
    })

    it('emits only events newer than the stored cursor', async () => {
      mock.onGet(`${ B }/audit-events`).reply(
        auditPage([
          { id: 'e1', timestamp: '2026-07-01T10:00:00Z' },
          { id: 'e2', timestamp: '2026-07-01T12:00:00Z' },
        ])
      )

      const result = await service.onNewAuditEvent({
        triggerData: {},
        state: { lastSeen: '2026-07-01T10:00:00Z', seenIds: ['e1'] },
      })

      expect(result.events).toEqual([{ id: 'e2', timestamp: '2026-07-01T12:00:00Z' }])
      expect(result.state).toEqual({ lastSeen: '2026-07-01T12:00:00Z', seenIds: ['e2'] })
    })

    it('emits unseen events sharing the boundary timestamp and merges the seen ids', async () => {
      mock.onGet(`${ B }/audit-events`).reply(
        auditPage([
          { id: 'e1', timestamp: '2026-07-01T10:00:00Z' },
          { id: 'e2', timestamp: '2026-07-01T10:00:00Z' },
        ])
      )

      const result = await service.onNewAuditEvent({
        triggerData: {},
        state: { lastSeen: '2026-07-01T10:00:00Z', seenIds: ['e1'] },
      })

      expect(result.events).toEqual([{ id: 'e2', timestamp: '2026-07-01T10:00:00Z' }])
      expect(result.state.lastSeen).toBe('2026-07-01T10:00:00Z')
      expect(result.state.seenIds.sort()).toEqual(['e1', 'e2'])
    })

    it('passes trigger data as query filters', async () => {
      mock.onGet(`${ B }/audit-events`).reply(auditPage([]))

      await service.onNewAuditEvent({
        triggerData: { resourceType: 'SOURCE', resourceId: 'res1' },
        state: { lastSeen: '2026-07-01T10:00:00Z' },
      })

      expect(lastCall().query).toMatchObject({
        startTime: '2026-07-01T10:00:00Z',
        resourceId: 'res1',
        resourceType: 'SOURCE',
      })
    })

    it('pages through every result in one cycle', async () => {
      let page = 0

      mock.onGet(`${ B }/audit-events`).replyWith(() => {
        page += 1

        if (page === 1) {
          return auditPage([{ id: 'e1', timestamp: '2026-07-01T10:00:00Z' }], 'cursor-2')
        }

        return auditPage([{ id: 'e2', timestamp: '2026-07-01T11:00:00Z' }])
      })

      const result = await service.onNewAuditEvent({
        triggerData: {},
        state: { lastSeen: '2026-07-01T09:00:00Z', seenIds: [] },
      })

      expect(page).toBe(2)
      expect(result.events.map(event => event.id)).toEqual(['e1', 'e2'])
      expect(result.state.lastSeen).toBe('2026-07-01T11:00:00Z')
    })

    it('stops at the 20-page cap', async () => {
      let page = 0

      mock.onGet(`${ B }/audit-events`).replyWith(() => {
        page += 1

        return auditPage([{ id: `e${ page }`, timestamp: '2026-07-01T10:00:00Z' }], 'next')
      })

      await service.onNewAuditEvent({ triggerData: {}, state: {} })

      expect(page).toBe(20)
    })
  })

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the named event handler', async () => {
      mock.onGet(`${ B }/audit-events`).reply({ data: { events: [], pagination: {} } })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewAuditEvent',
        triggerData: {},
        state: {},
      })

      expect(result).toEqual({ events: [], state: { lastSeen: undefined, seenIds: [] } })
    })
  })

  // ── Dictionaries ──

  describe('dictionaries', () => {
    const page = (key, items, next) => ({
      data: { [key]: items, pagination: next ? { next } : {} },
    })

    it('getSourcesDictionary maps sources', async () => {
      mock.onGet(`${ B }/sources`).reply(
        page('sources', [{ id: 's1', name: 'Web', slug: 'web' }, { id: 's2', slug: 'ios' }], 'nx')
      )

      const result = await service.getSourcesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Web', value: 's1', note: 'Slug: web' },
          { label: 'ios', value: 's2', note: 'Slug: ios' },
        ],
        cursor: 'nx',
      })
    })

    it('getSourcesDictionary filters by search and passes the cursor', async () => {
      mock.onGet(`${ B }/sources`).reply(
        page('sources', [{ id: 's1', name: 'Web', slug: 'web' }, { id: 's2', name: 'iOS', slug: 'ios' }])
      )

      const result = await service.getSourcesDictionary({ search: 'IOS', cursor: 'c1' })

      expect(result.items).toEqual([{ label: 'iOS', value: 's2', note: 'Slug: ios' }])
      expect(result.cursor).toBeNull()
      expect(lastCall().query).toEqual({ 'pagination.cursor': 'c1' })
    })

    it('getSourcesDictionary handles a null payload and an empty response', async () => {
      mock.onGet(`${ B }/sources`).reply({})

      await expect(service.getSourcesDictionary(null)).resolves.toEqual({ items: [], cursor: null })
    })

    it('getDestinationsDictionary maps destinations', async () => {
      mock.onGet(`${ B }/destinations`).reply(
        page('destinations', [{ id: 'd1', name: 'Slack', metadata: { slug: 'slack' } }, { id: 'd2', name: 'X' }])
      )

      const result = await service.getDestinationsDictionary({ search: 'sla' })

      expect(result.items).toEqual([{ label: 'Slack', value: 'd1', note: 'Type: slack' }])
    })

    it('getDestinationsDictionary notes unknown types', async () => {
      mock.onGet(`${ B }/destinations`).reply(page('destinations', [{ id: 'd2', name: 'X' }]))

      const result = await service.getDestinationsDictionary({})

      expect(result.items).toEqual([{ label: 'X', value: 'd2', note: 'Type: unknown' }])
    })

    it('getDestinationFiltersDictionary returns an empty list without criteria', async () => {
      await expect(service.getDestinationFiltersDictionary({})).resolves.toEqual({
        items: [],
        cursor: null,
      })

      expect(mock.history).toHaveLength(0)
    })

    it('getDestinationFiltersDictionary maps filters', async () => {
      mock.onGet(`${ B }/destination/d1/filters`).reply(
        page('filters', [{ id: 'f1', title: 'Drop', if: 'type = "track"' }])
      )

      const result = await service.getDestinationFiltersDictionary({
        criteria: { destinationId: 'd1' },
      })

      expect(result.items).toEqual([{ label: 'Drop', value: 'f1', note: 'Condition: type = "track"' }])
    })

    it('getTrackingPlansDictionary maps plans', async () => {
      mock.onGet(`${ B }/tracking-plans`).reply(
        page('trackingPlans', [{ id: 'tp1', name: 'Plan', type: 'LIVE' }])
      )

      const result = await service.getTrackingPlansDictionary({})

      expect(result.items).toEqual([{ label: 'Plan', value: 'tp1', note: 'Type: LIVE' }])
    })

    it('getWarehousesDictionary maps warehouses', async () => {
      mock.onGet(`${ B }/warehouses`).reply(
        page('warehouses', [{ id: 'w1', metadata: { name: 'Snowflake', slug: 'snowflake' } }, { id: 'w2' }])
      )

      const result = await service.getWarehousesDictionary({})

      expect(result.items).toEqual([
        { label: 'Snowflake', value: 'w1', note: 'Type: snowflake' },
        { label: 'w2', value: 'w2', note: 'Type: w2' },
      ])
    })

    it('getFunctionsDictionary maps functions', async () => {
      mock.onGet(`${ B }/functions`).reply(
        page('functions', [{ id: 'fn1', displayName: 'Fn', resourceType: 'SOURCE' }])
      )

      const result = await service.getFunctionsDictionary({})

      expect(result.items).toEqual([{ label: 'Fn', value: 'fn1', note: 'Type: SOURCE' }])
    })

    it('getSourceCatalogDictionary reads the catalog endpoint', async () => {
      mock.onGet(`${ B }/catalog/sources`).reply(
        page('sourcesCatalog', [{ id: 'c1', name: 'HTTP API', slug: 'http' }])
      )

      const result = await service.getSourceCatalogDictionary({ cursor: 'c1' })

      expect(result.items).toEqual([{ label: 'HTTP API', value: 'c1', note: 'Slug: http' }])
      expect(lastCall().query).toEqual({ 'pagination.cursor': 'c1' })
    })

    it('getDestinationCatalogDictionary reads the catalog endpoint', async () => {
      mock.onGet(`${ B }/catalog/destinations`).reply(
        page('destinationsCatalog', [{ id: 'c1', name: 'Slack', slug: 'slack' }])
      )

      await expect(service.getDestinationCatalogDictionary({})).resolves.toEqual({
        items: [{ label: 'Slack', value: 'c1', note: 'Slug: slack' }],
        cursor: null,
      })
    })

    it('getWarehouseCatalogDictionary reads the catalog endpoint', async () => {
      mock.onGet(`${ B }/catalog/warehouses`).reply(
        page('warehousesCatalog', [{ id: 'c1', name: 'Snowflake', slug: 'snowflake' }])
      )

      await expect(service.getWarehouseCatalogDictionary({})).resolves.toEqual({
        items: [{ label: 'Snowflake', value: 'c1', note: 'Slug: snowflake' }],
        cursor: null,
      })
    })

    it('getSpacesDictionary maps spaces', async () => {
      mock.onGet(`${ B }/spaces`).reply(page('spaces', [{ id: 'sp1', name: 'Engage', slug: 'engage' }]))

      await expect(service.getSpacesDictionary({})).resolves.toEqual({
        items: [{ label: 'Engage', value: 'sp1', note: 'Slug: engage' }],
        cursor: null,
      })
    })

    it('getAudiencesDictionary requires a space', async () => {
      await expect(service.getAudiencesDictionary({ criteria: {} })).resolves.toEqual({
        items: [],
        cursor: null,
      })
    })

    it('getAudiencesDictionary maps audiences', async () => {
      mock.onGet(`${ B }/spaces/sp1/audiences`).reply(
        page('audiences', [{ id: 'a1', name: 'Buyers', audienceType: 'USERS' }])
      )

      const result = await service.getAudiencesDictionary({ criteria: { spaceId: 'sp1' } })

      expect(result.items).toEqual([{ label: 'Buyers', value: 'a1', note: 'Type: USERS' }])
    })

    it('getComputedTraitsDictionary requires a space', async () => {
      await expect(service.getComputedTraitsDictionary(null)).resolves.toEqual({
        items: [],
        cursor: null,
      })
    })

    it('getComputedTraitsDictionary maps traits', async () => {
      mock.onGet(`${ B }/spaces/sp1/computed-traits`).reply(
        page('computedTraits', [{ id: 'ct1', name: 'LTV', key: 'ltv' }])
      )

      const result = await service.getComputedTraitsDictionary({ criteria: { spaceId: 'sp1' } })

      expect(result.items).toEqual([{ label: 'LTV', value: 'ct1', note: 'Key: ltv' }])
    })

    it('getSpaceFiltersDictionary requires an integration id', async () => {
      await expect(service.getSpaceFiltersDictionary({ criteria: {} })).resolves.toEqual({
        items: [],
        cursor: null,
      })
    })

    it('getSpaceFiltersDictionary maps filters', async () => {
      mock.onGet(`${ B }/filters`).reply(
        page('filters', [{ id: 'f1', name: 'Drop', if: 'type = "track"' }])
      )

      const result = await service.getSpaceFiltersDictionary({ criteria: { integrationId: 'sp1' } })

      expect(result.items).toEqual([{ label: 'Drop', value: 'f1', note: 'Condition: type = "track"' }])
    })

    it('getAudienceSchedulesDictionary requires a space and an audience', async () => {
      await expect(
        service.getAudienceSchedulesDictionary({ criteria: { spaceId: 'sp1' } })
      ).resolves.toEqual({ items: [], cursor: null })
    })

    it('getAudienceSchedulesDictionary maps schedules', async () => {
      mock.onGet(`${ B }/spaces/sp1/audiences/a1/schedules`).reply(
        page('audienceSchedules', [{ id: 'sc1', strategy: 'PERIODIC', nextExecution: 'tomorrow' }, { id: 'sc2' }])
      )

      const result = await service.getAudienceSchedulesDictionary({
        criteria: { spaceId: 'sp1', audienceId: 'a1' },
      })

      expect(result).toEqual({
        items: [
          { label: 'PERIODIC', value: 'sc1', note: 'Next run: tomorrow' },
          { label: 'sc2', value: 'sc2', note: 'Next run: n/a' },
        ],
        cursor: null,
      })
    })

    it('getAudienceDestinationsDictionary requires a space and an audience', async () => {
      await expect(service.getAudienceDestinationsDictionary({})).resolves.toEqual({
        items: [],
        cursor: null,
      })
    })

    it('getAudienceDestinationsDictionary maps connections', async () => {
      mock.onGet(`${ B }/spaces/sp1/audiences/a1/destination-connections`).reply(
        page('connections', [{ id: 'dc1', name: 'Slack', destinationId: 'd1' }, { id: 'dc2' }])
      )

      const result = await service.getAudienceDestinationsDictionary({
        criteria: { spaceId: 'sp1', audienceId: 'a1' },
      })

      expect(result.items).toEqual([
        { label: 'Slack', value: 'dc1', note: 'Destination: d1' },
        { label: 'dc2', value: 'dc2', note: 'Destination: unknown' },
      ])
    })

    it('getSupportedActionsDictionary requires a space and audience type', async () => {
      await expect(
        service.getSupportedActionsDictionary({ criteria: { spaceId: 'sp1' } })
      ).resolves.toEqual({ items: [], cursor: null })
    })

    it('getSupportedActionsDictionary flattens destination actions', async () => {
      mock.onGet(`${ B }/spaces/sp1/audienceType/USERS/supported-destinations`).reply({
        data: {
          destinations: {
            slack: { slug: 'slack', actions: [{ actionId: 'a1', actionName: 'Post Message' }] },
            braze: { actions: [{ actionId: 'a2' }] },
          },
        },
      })

      const result = await service.getSupportedActionsDictionary({
        criteria: { spaceId: 'sp1', audienceType: 'Users' },
      })

      expect(result).toEqual({
        items: [
          { label: 'Post Message', value: 'a1', note: 'Destination: slack' },
          { label: 'a2', value: 'a2', note: 'Destination: braze' },
        ],
        cursor: null,
      })
    })

    it('getSupportedActionsDictionary filters flattened actions by search', async () => {
      mock.onGet(`${ B }/spaces/sp1/audienceType/USERS/supported-destinations`).reply({
        data: {
          destinations: {
            slack: { slug: 'slack', actions: [{ actionId: 'a1', actionName: 'Post Message' }, { actionId: 'a2', actionName: 'Send Email' }] },
          },
        },
      })

      const result = await service.getSupportedActionsDictionary({
        search: 'email',
        criteria: { spaceId: 'sp1', audienceType: 'Users' },
      })

      expect(result.items).toEqual([{ label: 'Send Email', value: 'a2', note: 'Destination: slack' }])
    })

    it('getReverseEtlModelsDictionary maps models', async () => {
      mock.onGet(`${ B }/reverse-etl-models`).reply(
        page('models', [{ id: 'm1', name: 'Model', sourceId: 's1' }])
      )

      await expect(service.getReverseEtlModelsDictionary({})).resolves.toEqual({
        items: [{ label: 'Model', value: 'm1', note: 'Source: s1' }],
        cursor: null,
      })
    })

    it('getTransformationsDictionary maps transformations', async () => {
      mock.onGet(`${ B }/transformations`).reply(
        page('transformations', [{ id: 't1', name: 'T', sourceId: 's1' }])
      )

      await expect(service.getTransformationsDictionary({})).resolves.toEqual({
        items: [{ label: 'T', value: 't1', note: 'Source: s1' }],
        cursor: null,
      })
    })

    it('getUsersDictionary maps users', async () => {
      mock.onGet(`${ B }/users`).reply(
        page('users', [{ id: 'u1', name: 'Ann', email: 'ann@x.io' }, { id: 'u2', email: 'bob@x.io' }])
      )

      const result = await service.getUsersDictionary({ search: 'bob' })

      expect(result.items).toEqual([{ label: 'bob@x.io', value: 'u2', note: 'bob@x.io' }])
    })

    it('getUserGroupsDictionary maps groups', async () => {
      mock.onGet(`${ B }/groups`).reply(page('userGroups', [{ id: 'g1', name: 'Admins', memberCount: 3 }]))

      await expect(service.getUserGroupsDictionary({})).resolves.toEqual({
        items: [{ label: 'Admins', value: 'g1', note: 'Members: 3' }],
        cursor: null,
      })
    })

    it('getRolesDictionary maps roles', async () => {
      mock.onGet(`${ B }/roles`).reply(
        page('roles', [{ id: 'r1', name: 'Workspace Owner', description: 'Full access' }])
      )

      await expect(service.getRolesDictionary({})).resolves.toEqual({
        items: [{ label: 'Workspace Owner', value: 'r1', note: 'Full access' }],
        cursor: null,
      })
    })

    it('getProfilesWarehousesDictionary requires a space', async () => {
      await expect(service.getProfilesWarehousesDictionary({ criteria: {} })).resolves.toEqual({
        items: [],
        cursor: null,
      })
    })

    it('getProfilesWarehousesDictionary maps profiles warehouses', async () => {
      mock.onGet(`${ B }/spaces/sp1/profiles-warehouses`).reply(
        page('profilesWarehouses', [{ id: 'w1', name: 'WH', enabled: true }, { id: 'w2', enabled: false }])
      )

      const result = await service.getProfilesWarehousesDictionary({ criteria: { spaceId: 'sp1' } })

      expect(result.items).toEqual([
        { label: 'WH', value: 'w1', note: 'Enabled: true' },
        { label: 'w2', value: 'w2', note: 'Enabled: false' },
      ])
    })

    it('getRegulationsDictionary maps regulations', async () => {
      mock.onGet(`${ B }/regulations`).reply(
        page('regulations', [
          { id: 'r1', regulationType: 'DELETE_ONLY', status: 'FINISHED', subjects: ['u1'] },
          { id: 'r2' },
        ])
      )

      const result = await service.getRegulationsDictionary({})

      expect(result.items).toEqual([
        { label: 'DELETE_ONLY — FINISHED', value: 'r1', note: 'Subjects: 1' },
        { label: 'Regulation —', value: 'r2', note: 'Subjects: 0' },
      ])
    })

    it('getRegulationsDictionary filters by id, type or status', async () => {
      mock.onGet(`${ B }/regulations`).reply(
        page('regulations', [
          { id: 'r1', regulationType: 'DELETE_ONLY', status: 'FINISHED' },
          { id: 'r2', regulationType: 'SUPPRESS_ONLY', status: 'RUNNING' },
        ])
      )

      const result = await service.getRegulationsDictionary({ search: 'running' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('r2')
    })
  })
})
