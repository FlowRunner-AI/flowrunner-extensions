'use strict'

const { createSandbox } = require('../../../service-sandbox')

const AUTH_TOKEN = 'test-auth-token'
const USERNAME = 'alice'
const BASE = 'https://www.beeminder.com/api/v1'
const USER_BASE = `${ BASE }/users/${ USERNAME }`

describe('Beeminder Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ authToken: AUTH_TOKEN, username: USERNAME })
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

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items in order', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'authToken',
          displayName: 'Auth Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'username',
          displayName: 'Username',
          required: false,
          shared: false,
          type: 'STRING',
          defaultValue: 'me',
        }),
      ])
    })

    it('never marks a config item as shared', () => {
      for (const item of sandbox.getConfigItems()) {
        expect(item.shared).toBe(false)
      }
    })

    it('sends Content-Type header and auth_token query on every request', async () => {
      mock.onGet(`${ USER_BASE }.json`).reply({ username: USERNAME })

      await service.getUser()

      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })
      expect(mock.history[0].query).toMatchObject({ auth_token: AUTH_TOKEN })
    })
  })

  // ── User ──

  describe('getUser', () => {
    it('fetches the user with only the auth token when associations is falsy', async () => {
      mock.onGet(`${ USER_BASE }.json`).reply({ username: USERNAME, deadbeat: false })

      const result = await service.getUser()

      expect(result).toEqual({ username: USERNAME, deadbeat: false })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ USER_BASE }.json`)
      // associations is stripped by clean() when undefined
      expect(mock.history[0].query).toEqual({ auth_token: AUTH_TOKEN })
    })

    it('sends associations=true when requested', async () => {
      mock.onGet(`${ USER_BASE }.json`).reply({ username: USERNAME, goals: [] })

      await service.getUser(true)

      expect(mock.history[0].query).toEqual({ auth_token: AUTH_TOKEN, associations: 'true' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ USER_BASE }.json`).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.getUser()).rejects.toThrow('Beeminder API error (401): Unauthorized')
    })
  })

  // ── Goals ──

  describe('listGoals', () => {
    it('lists goals for the user', async () => {
      mock.onGet(`${ USER_BASE }/goals.json`).reply([{ slug: 'read', title: 'Read More' }])

      const result = await service.listGoals()

      expect(result).toEqual([{ slug: 'read', title: 'Read More' }])
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ USER_BASE }/goals.json`)
      expect(mock.history[0].query).toEqual({ auth_token: AUTH_TOKEN })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ USER_BASE }/goals.json`).replyWithError({ message: 'Boom', status: 500 })

      await expect(service.listGoals()).rejects.toThrow('Beeminder API error (500): Boom')
    })
  })

  describe('getGoal', () => {
    it('fetches a goal without datapoints by default', async () => {
      mock.onGet(`${ USER_BASE }/goals/read.json`).reply({ slug: 'read', title: 'Read More' })

      const result = await service.getGoal('read')

      expect(result).toEqual({ slug: 'read', title: 'Read More' })
      expect(mock.history[0].url).toBe(`${ USER_BASE }/goals/read.json`)
      expect(mock.history[0].query).toEqual({ auth_token: AUTH_TOKEN })
    })

    it('includes datapoints=true when requested', async () => {
      mock.onGet(`${ USER_BASE }/goals/read.json`).reply({ slug: 'read', datapoints: [] })

      await service.getGoal('read', true)

      expect(mock.history[0].query).toEqual({ auth_token: AUTH_TOKEN, datapoints: 'true' })
    })

    it('url-encodes the goal slug', async () => {
      mock.onGet(`${ USER_BASE }/goals/my%20goal.json`).reply({ slug: 'my goal' })

      await service.getGoal('my goal')

      expect(mock.history[0].url).toBe(`${ USER_BASE }/goals/my%20goal.json`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ USER_BASE }/goals/read.json`).replyWithError({ message: 'Not found', status: 404 })

      await expect(service.getGoal('read')).rejects.toThrow('Beeminder API error (404): Not found')
    })
  })

  describe('createGoal', () => {
    it('sends required params with the goal type resolved from the label', async () => {
      mock.onPost(`${ USER_BASE }/goals.json`).reply({ slug: 'read-more' })

      const result = await service.createGoal('read-more', 'Read More', 'Do More (hustler)', 'pages')

      expect(result).toEqual({ slug: 'read-more' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ USER_BASE }/goals.json`)
      // clean() strips the undefined goaldate/goalval/rate
      expect(mock.history[0].body).toEqual({
        slug: 'read-more',
        title: 'Read More',
        goal_type: 'hustler',
        gunits: 'pages',
      })
    })

    it('includes goaldate/goalval/rate when provided', async () => {
      mock.onPost(`${ USER_BASE }/goals.json`).reply({ slug: 'read-more' })

      await service.createGoal('read-more', 'Read More', 'Odometer (biker)', 'pages', 1672531200, 500, 10)

      expect(mock.history[0].body).toEqual({
        slug: 'read-more',
        title: 'Read More',
        goal_type: 'biker',
        gunits: 'pages',
        goaldate: 1672531200,
        goalval: 500,
        rate: 10,
      })
    })

    it('passes through an already-resolved goal type value unchanged', async () => {
      mock.onPost(`${ USER_BASE }/goals.json`).reply({ slug: 'g' })

      await service.createGoal('g', 'G', 'hustler', 'pages')

      expect(mock.history[0].body.goal_type).toBe('hustler')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ USER_BASE }/goals.json`).replyWithError({
        status: 422,
        body: { errors: 'slug already taken' },
      })

      await expect(
        service.createGoal('read-more', 'Read More', 'Do More (hustler)', 'pages')
      ).rejects.toThrow('Beeminder API error (422): slug already taken')
    })
  })

  describe('updateGoal', () => {
    it('sends put with only the provided fields', async () => {
      mock.onPut(`${ USER_BASE }/goals/read.json`).reply({ slug: 'read' })

      const result = await service.updateGoal('read', 'Read Even More')

      expect(result).toEqual({ slug: 'read' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ USER_BASE }/goals/read.json`)
      // clean() strips undefined yaxis/secret/datapublic
      expect(mock.history[0].body).toEqual({ title: 'Read Even More' })
    })

    it('includes all optional params, including boolean false', async () => {
      mock.onPut(`${ USER_BASE }/goals/read.json`).reply({ slug: 'read' })

      await service.updateGoal('read', 'Title', 'pages read', false, true)

      expect(mock.history[0].body).toEqual({
        title: 'Title',
        yaxis: 'pages read',
        secret: false,
        datapublic: true,
      })
    })

    it('sends an empty body when no fields are provided', async () => {
      mock.onPut(`${ USER_BASE }/goals/read.json`).reply({ slug: 'read' })

      await service.updateGoal('read')

      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPut(`${ USER_BASE }/goals/read.json`).replyWithError({ message: 'Boom', status: 500 })

      await expect(service.updateGoal('read', 'X')).rejects.toThrow('Beeminder API error (500): Boom')
    })
  })

  describe('refreshGoalGraph', () => {
    it('sends a get to the refresh_graph endpoint', async () => {
      mock.onGet(`${ USER_BASE }/goals/read/refresh_graph.json`).reply(true)

      const result = await service.refreshGoalGraph('read')

      expect(result).toBe(true)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ USER_BASE }/goals/read/refresh_graph.json`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ USER_BASE }/goals/read/refresh_graph.json`).replyWithError({ message: 'Boom' })

      await expect(service.refreshGoalGraph('read')).rejects.toThrow('Beeminder API error: Boom')
    })
  })

  // ── Datapoints ──

  describe('createDatapoint', () => {
    it('sends only the value when nothing else is provided', async () => {
      mock.onPost(`${ USER_BASE }/goals/read/datapoints.json`).reply({ id: '5678', value: 12 })

      const result = await service.createDatapoint('read', 12)

      expect(result).toEqual({ id: '5678', value: 12 })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ USER_BASE }/goals/read/datapoints.json`)
      expect(mock.history[0].body).toEqual({ value: 12 })
    })

    it('includes all optional fields when provided', async () => {
      mock.onPost(`${ USER_BASE }/goals/read/datapoints.json`).reply({ id: '5678' })

      await service.createDatapoint('read', 12, 1652500000, '20220514', 'chapter 3', 'abc-123')

      expect(mock.history[0].body).toEqual({
        value: 12,
        timestamp: 1652500000,
        daystamp: '20220514',
        comment: 'chapter 3',
        requestid: 'abc-123',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ USER_BASE }/goals/read/datapoints.json`).replyWithError({ message: 'Boom', status: 400 })

      await expect(service.createDatapoint('read', 12)).rejects.toThrow('Beeminder API error (400): Boom')
    })
  })

  describe('listDatapoints', () => {
    it('lists datapoints with only the auth token when no sort/count given', async () => {
      mock.onGet(`${ USER_BASE }/goals/read/datapoints.json`).reply([{ id: '5678', value: 12 }])

      const result = await service.listDatapoints('read')

      expect(result).toEqual([{ id: '5678', value: 12 }])
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({ auth_token: AUTH_TOKEN })
    })

    it('includes sort and count when provided', async () => {
      mock.onGet(`${ USER_BASE }/goals/read/datapoints.json`).reply([])

      await service.listDatapoints('read', 'daystamp', 10)

      expect(mock.history[0].query).toEqual({ auth_token: AUTH_TOKEN, sort: 'daystamp', count: 10 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ USER_BASE }/goals/read/datapoints.json`).replyWithError({ message: 'Boom' })

      await expect(service.listDatapoints('read')).rejects.toThrow('Beeminder API error: Boom')
    })
  })

  describe('updateDatapoint', () => {
    it('sends put with only the provided fields', async () => {
      mock.onPut(`${ USER_BASE }/goals/read/datapoints/5678.json`).reply({ id: '5678', value: 15 })

      const result = await service.updateDatapoint('read', '5678', 15)

      expect(result).toEqual({ id: '5678', value: 15 })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ USER_BASE }/goals/read/datapoints/5678.json`)
      expect(mock.history[0].body).toEqual({ value: 15 })
    })

    it('includes all optional fields when provided', async () => {
      mock.onPut(`${ USER_BASE }/goals/read/datapoints/5678.json`).reply({ id: '5678' })

      await service.updateDatapoint('read', '5678', 15, 1652500000, 'chapter 4')

      expect(mock.history[0].body).toEqual({
        value: 15,
        timestamp: 1652500000,
        comment: 'chapter 4',
      })
    })

    it('sends an empty body when no fields are provided', async () => {
      mock.onPut(`${ USER_BASE }/goals/read/datapoints/5678.json`).reply({ id: '5678' })

      await service.updateDatapoint('read', '5678')

      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPut(`${ USER_BASE }/goals/read/datapoints/5678.json`).replyWithError({ message: 'Boom' })

      await expect(service.updateDatapoint('read', '5678', 15)).rejects.toThrow('Beeminder API error: Boom')
    })
  })

  describe('deleteDatapoint', () => {
    it('sends delete to the datapoint endpoint', async () => {
      mock.onDelete(`${ USER_BASE }/goals/read/datapoints/5678.json`).reply({ id: '5678', value: 12 })

      const result = await service.deleteDatapoint('read', '5678')

      expect(result).toEqual({ id: '5678', value: 12 })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ USER_BASE }/goals/read/datapoints/5678.json`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ USER_BASE }/goals/read/datapoints/5678.json`).replyWithError({ message: 'Boom' })

      await expect(service.deleteDatapoint('read', '5678')).rejects.toThrow('Beeminder API error: Boom')
    })
  })

  describe('createDatapointsBatch', () => {
    it('sends the datapoints array JSON-stringified to create_all', async () => {
      mock.onPost(`${ USER_BASE }/goals/read/datapoints/create_all.json`).reply([{ id: '1' }, { id: '2' }])

      const datapoints = [{ value: 10, comment: 'day 1' }, { value: 12, daystamp: '20220515' }]
      const result = await service.createDatapointsBatch('read', datapoints)

      expect(result).toEqual([{ id: '1' }, { id: '2' }])
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ USER_BASE }/goals/read/datapoints/create_all.json`)
      expect(mock.history[0].body).toEqual({ datapoints: JSON.stringify(datapoints) })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ USER_BASE }/goals/read/datapoints/create_all.json`).replyWithError({ message: 'Boom' })

      await expect(service.createDatapointsBatch('read', [{ value: 1 }])).rejects.toThrow(
        'Beeminder API error: Boom'
      )
    })
  })

  // ── Charges ──

  describe('chargeUser', () => {
    it('sends required params with the username as user_id', async () => {
      mock.onPost(`${ BASE }/charges.json`).reply({ id: '9012', amount: 5 })

      const result = await service.chargeUser(5, 'Missed goal deadline')

      expect(result).toEqual({ id: '9012', amount: 5 })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/charges.json`)
      // dryrun is undefined so clean() strips it
      expect(mock.history[0].body).toEqual({
        user_id: USERNAME,
        amount: 5,
        note: 'Missed goal deadline',
      })
    })

    it('sends dryrun=true when requested', async () => {
      mock.onPost(`${ BASE }/charges.json`).reply({ id: '9012', amount: 5 })

      await service.chargeUser(5, 'Test charge', true)

      expect(mock.history[0].body).toEqual({
        user_id: USERNAME,
        amount: 5,
        note: 'Test charge',
        dryrun: 'true',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/charges.json`).replyWithError({ message: 'Boom', status: 402 })

      await expect(service.chargeUser(5, 'note')).rejects.toThrow('Beeminder API error (402): Boom')
    })
  })

  // ── Dictionary ──

  describe('getGoalsDictionary', () => {
    it('maps goals to items with type/units note', async () => {
      mock.onGet(`${ USER_BASE }/goals.json`).reply([
        { slug: 'read', title: 'Read More', goal_type: 'hustler', gunits: 'pages' },
        { slug: 'weight', title: 'Lose Weight', goal_type: 'fatloser', gunits: 'kg' },
      ])

      const result = await service.getGoalsDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ USER_BASE }/goals.json`)
      expect(result).toEqual({
        items: [
          { label: 'Read More', value: 'read', note: 'hustler - pages' },
          { label: 'Lose Weight', value: 'weight', note: 'fatloser - kg' },
        ],
        cursor: null,
      })
    })

    it('falls back to the slug as label and omits an empty note', async () => {
      mock.onGet(`${ USER_BASE }/goals.json`).reply([{ slug: 'read' }])

      const result = await service.getGoalsDictionary({})

      expect(result.items).toEqual([{ label: 'read', value: 'read', note: undefined }])
    })

    it('filters by search over slug and title', async () => {
      mock.onGet(`${ USER_BASE }/goals.json`).reply([
        { slug: 'read', title: 'Read More', goal_type: 'hustler', gunits: 'pages' },
        { slug: 'weight', title: 'Lose Weight', goal_type: 'fatloser', gunits: 'kg' },
      ])

      const result = await service.getGoalsDictionary({ search: 'weight' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('weight')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ USER_BASE }/goals.json`).reply([{ slug: 'read', title: 'Read More' }])

      const result = await service.getGoalsDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('returns an empty item list when the API returns a non-array', async () => {
      mock.onGet(`${ USER_BASE }/goals.json`).reply({ notAnArray: true })

      const result = await service.getGoalsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ USER_BASE }/goals.json`).replyWithError({ message: 'Boom', status: 500 })

      await expect(service.getGoalsDictionary({})).rejects.toThrow('Beeminder API error (500): Boom')
    })
  })
})

// ── Default username handling ──

describe('Beeminder Service (default username)', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    // Re-require the service so addService() runs again against this fresh sandbox
    // (the module caches its registration on first require).
    jest.resetModules()
    sandbox = createSandbox({ authToken: AUTH_TOKEN })
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

  it("defaults the username to 'me' when none is configured", async () => {
    mock.onGet(`${ BASE }/users/me.json`).reply({ username: 'me' })

    await service.getUser()

    expect(mock.history[0].url).toBe(`${ BASE }/users/me.json`)
  })

  it("uses 'me' as the charge user_id when no username is configured", async () => {
    mock.onPost(`${ BASE }/charges.json`).reply({ id: '1' })

    await service.chargeUser(1, 'note')

    expect(mock.history[0].body.user_id).toBe('me')
  })
})
