'use strict'

const { createSandbox } = require('../../../service-sandbox')

const AUTH_TOKEN = 'test-auth-token'
const ORG = 'acme'
const BASE_URL = 'https://sentry.example.com'
const BASE = `${ BASE_URL }/api/0`

const AUTH_HEADERS = {
  'Authorization': `Bearer ${ AUTH_TOKEN }`,
  'Content-Type': 'application/json',
}

describe('Sentry Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      authToken: AUTH_TOKEN,
      organizationSlug: ORG,
      baseUrl: `${ BASE_URL }//`,
    })

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

  // ── Registration & construction ──

  describe('service registration', () => {
    it('registers the expected config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['authToken', 'organizationSlug', 'baseUrl'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'authToken', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'organizationSlug', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({
            name: 'baseUrl',
            required: false,
            shared: false,
            type: 'STRING',
            defaultValue: 'https://sentry.io',
          }),
        ])
      )
    })

    it('strips trailing slashes and appends the API path', () => {
      expect(service.authToken).toBe(AUTH_TOKEN)
      expect(service.organizationSlug).toBe(ORG)
      expect(service.apiBaseUrl).toBe(BASE)
    })

  })

  // ── Projects ──

  describe('listProjects', () => {
    it('lists the organization projects', async () => {
      mock.onGet(`${ BASE }/organizations/${ ORG }/projects/`).reply([{ slug: 'backend' }])

      const result = await service.listProjects()

      expect(result).toEqual([{ slug: 'backend' }])
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes the pagination cursor', async () => {
      mock.onGet(`${ BASE }/organizations/${ ORG }/projects/`).reply([])

      await service.listProjects('cursor-1')

      expect(mock.history[0].query).toEqual({ cursor: 'cursor-1' })
    })

    it('wraps API errors using the detail field', async () => {
      mock.onGet(`${ BASE }/organizations/${ ORG }/projects/`).replyWithError({
        message: 'Forbidden',
        status: 403,
        body: { detail: 'You do not have permission' },
      })

      await expect(service.listProjects()).rejects.toThrow('Sentry API error: You do not have permission')
    })

    it('falls back to the message field and then to the error message', async () => {
      mock.onGet(`${ BASE }/organizations/${ ORG }/projects/`).replyWithError({
        message: 'Bad Request',
        body: { message: 'bad things' },
      })

      await expect(service.listProjects()).rejects.toThrow('Sentry API error: bad things')

      mock.reset()
      mock.onGet(`${ BASE }/organizations/${ ORG }/projects/`).replyWithError({ message: 'Network down' })

      await expect(service.listProjects()).rejects.toThrow('Sentry API error: Network down')
    })
  })

  describe('getProject', () => {
    it('requests a project by slug', async () => {
      mock.onGet(`${ BASE }/projects/${ ORG }/backend/`).reply({ slug: 'backend', name: 'Backend' })

      const result = await service.getProject('backend')

      expect(result).toEqual({ slug: 'backend', name: 'Backend' })
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  describe('createProject', () => {
    it('posts the project to the team endpoint', async () => {
      mock.onPost(`${ BASE }/teams/${ ORG }/backend-team/projects/`).reply({ slug: 'new-service' })

      const result = await service.createProject('backend-team', 'New Service', 'node')

      expect(result).toEqual({ slug: 'new-service' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ name: 'New Service', platform: 'node' })
    })

    it('omits the platform when it is not provided', async () => {
      mock.onPost(`${ BASE }/teams/${ ORG }/backend-team/projects/`).reply({ slug: 'new-service' })

      await service.createProject('backend-team', 'New Service')

      expect(mock.history[0].body).toEqual({ name: 'New Service' })
    })
  })

  describe('updateProject', () => {
    it('maps the new slug onto the slug field', async () => {
      mock.onPut(`${ BASE }/projects/${ ORG }/backend/`).reply({ slug: 'backend-2' })

      const result = await service.updateProject('backend', 'Backend Renamed', 'backend-2', 'python')

      expect(result).toEqual({ slug: 'backend-2' })
      expect(mock.history[0].method).toBe('put')

      expect(mock.history[0].body).toEqual({
        name: 'Backend Renamed',
        slug: 'backend-2',
        platform: 'python',
      })
    })

    it('sends an empty body when nothing changes', async () => {
      mock.onPut(`${ BASE }/projects/${ ORG }/backend/`).reply({ slug: 'backend' })

      await service.updateProject('backend')

      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Issues ──

  describe('listIssues', () => {
    it('applies the default query, stats period and no sort', async () => {
      mock.onGet(`${ BASE }/projects/${ ORG }/backend/issues/`).reply([{ id: '1' }])

      const result = await service.listIssues('backend')

      expect(result).toEqual([{ id: '1' }])
      expect(mock.history[0].query).toEqual({ query: 'is:unresolved', statsPeriod: '24h' })
    })

    it('maps the sort label to the API value and passes the cursor', async () => {
      mock.onGet(`${ BASE }/projects/${ ORG }/backend/issues/`).reply([])

      await service.listIssues('backend', 'is:assigned', '14d', 'Frequency', 'cursor-1')

      expect(mock.history[0].query).toEqual({
        query: 'is:assigned',
        statsPeriod: '14d',
        sort: 'freq',
        cursor: 'cursor-1',
      })
    })

    it('passes an unmapped sort value through unchanged', async () => {
      mock.onGet(`${ BASE }/projects/${ ORG }/backend/issues/`).reply([])

      await service.listIssues('backend', null, null, 'freq')

      expect(mock.history[0].query).toMatchObject({ sort: 'freq' })
    })
  })

  describe('getIssue', () => {
    it('requests an issue by id', async () => {
      mock.onGet(`${ BASE }/issues/98765/`).reply({ id: '98765', status: 'unresolved' })

      const result = await service.getIssue('98765')

      expect(result).toEqual({ id: '98765', status: 'unresolved' })
    })

    it('throws when the issue is missing', async () => {
      mock.onGet(`${ BASE }/issues/404/`).replyWithError({
        message: 'Not Found',
        body: { detail: 'The requested resource does not exist' },
      })

      await expect(service.getIssue('404'))
        .rejects.toThrow('Sentry API error: The requested resource does not exist')
    })
  })

  describe('updateIssue', () => {
    it('maps the status label and sends the assignee', async () => {
      mock.onPut(`${ BASE }/issues/98765/`).reply({ id: '98765', status: 'resolved' })

      const result = await service.updateIssue('98765', 'Resolved', 'user:123')

      expect(result).toEqual({ id: '98765', status: 'resolved' })
      expect(mock.history[0].body).toEqual({ status: 'resolved', assignedTo: 'user:123' })
    })

    it('maps Ignored and Unresolved statuses', async () => {
      mock.onPut(`${ BASE }/issues/98765/`).reply({})

      await service.updateIssue('98765', 'Ignored')

      expect(mock.history[0].body).toEqual({ status: 'ignored' })

      await service.updateIssue('98765', 'Unresolved')

      expect(mock.history[1].body).toEqual({ status: 'unresolved' })
    })

    it('sends an empty body when neither status nor assignee is provided', async () => {
      mock.onPut(`${ BASE }/issues/98765/`).reply({})

      await service.updateIssue('98765')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteIssue', () => {
    it('deletes the issue and returns a success flag', async () => {
      mock.onDelete(`${ BASE }/issues/98765/`).reply('')

      const result = await service.deleteIssue('98765')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })

    it('propagates delete failures', async () => {
      mock.onDelete(`${ BASE }/issues/98765/`).replyWithError({
        message: 'Forbidden',
        body: { detail: 'insufficient scope' },
      })

      await expect(service.deleteIssue('98765')).rejects.toThrow('Sentry API error: insufficient scope')
    })
  })

  describe('listIssueEvents', () => {
    it('lists issue events with an optional cursor', async () => {
      mock.onGet(`${ BASE }/issues/98765/events/`).reply([{ eventID: 'abc' }])

      const result = await service.listIssueEvents('98765')

      expect(result).toEqual([{ eventID: 'abc' }])
      expect(mock.history[0].query).toEqual({})

      await service.listIssueEvents('98765', 'cursor-1')

      expect(mock.history[1].query).toEqual({ cursor: 'cursor-1' })
    })
  })

  describe('getLatestEvent', () => {
    it('requests the latest event for an issue', async () => {
      mock.onGet(`${ BASE }/issues/98765/events/latest/`).reply({ eventID: 'abc' })

      const result = await service.getLatestEvent('98765')

      expect(result).toEqual({ eventID: 'abc' })
    })
  })

  // ── Events ──

  describe('listProjectEvents', () => {
    it('lists events for a project', async () => {
      mock.onGet(`${ BASE }/projects/${ ORG }/backend/events/`).reply([{ eventID: 'abc' }])

      const result = await service.listProjectEvents('backend', 'cursor-1')

      expect(result).toEqual([{ eventID: 'abc' }])
      expect(mock.history[0].query).toEqual({ cursor: 'cursor-1' })
    })
  })

  describe('getEvent', () => {
    it('requests a single project event', async () => {
      mock.onGet(`${ BASE }/projects/${ ORG }/backend/events/abc123/`).reply({ eventID: 'abc123' })

      const result = await service.getEvent('backend', 'abc123')

      expect(result).toEqual({ eventID: 'abc123' })
    })
  })

  // ── Releases ──

  describe('listReleases', () => {
    it('lists releases without filters', async () => {
      mock.onGet(`${ BASE }/organizations/${ ORG }/releases/`).reply([{ version: '1.2.3' }])

      const result = await service.listReleases()

      expect(result).toEqual([{ version: '1.2.3' }])
      expect(mock.history[0].query).toEqual({})
    })

    it('passes the query and cursor', async () => {
      mock.onGet(`${ BASE }/organizations/${ ORG }/releases/`).reply([])

      await service.listReleases('1.2', 'cursor-1')

      expect(mock.history[0].query).toEqual({ query: '1.2', cursor: 'cursor-1' })
    })
  })

  describe('createRelease', () => {
    it('posts the version and projects', async () => {
      mock.onPost(`${ BASE }/organizations/${ ORG }/releases/`).reply({ version: '1.2.3' })

      const result = await service.createRelease('1.2.3', ['backend'])

      expect(result).toEqual({ version: '1.2.3' })
      expect(mock.history[0].body).toEqual({ version: '1.2.3', projects: ['backend'] })
    })

    it('includes the optional ref and url', async () => {
      mock.onPost(`${ BASE }/organizations/${ ORG }/releases/`).reply({ version: '1.2.3' })

      await service.createRelease('1.2.3', ['backend'], 'a1b2c3d', 'https://ci.example.com/42')

      expect(mock.history[0].body).toEqual({
        version: '1.2.3',
        projects: ['backend'],
        ref: 'a1b2c3d',
        url: 'https://ci.example.com/42',
      })
    })
  })

  describe('getRelease', () => {
    it('url-encodes the version', async () => {
      mock.onGet(`${ BASE }/organizations/${ ORG }/releases/1.2.3%2Bbuild/`).reply({ version: '1.2.3+build' })

      const result = await service.getRelease('1.2.3+build')

      expect(result).toEqual({ version: '1.2.3+build' })
    })
  })

  describe('deleteRelease', () => {
    it('deletes the release and returns a success flag', async () => {
      mock.onDelete(`${ BASE }/organizations/${ ORG }/releases/1.2.3/`).reply('')

      const result = await service.deleteRelease('1.2.3')

      expect(result).toEqual({ success: true })
    })

    it('propagates delete failures', async () => {
      mock.onDelete(`${ BASE }/organizations/${ ORG }/releases/1.2.3/`).replyWithError({
        message: 'Bad Request',
        body: { detail: 'Release has events' },
      })

      await expect(service.deleteRelease('1.2.3')).rejects.toThrow('Sentry API error: Release has events')
    })
  })

  describe('createDeploy', () => {
    it('posts the deploy to the release deploys endpoint', async () => {
      mock.onPost(`${ BASE }/organizations/${ ORG }/releases/1.2.3/deploys/`).reply({ id: '55' })

      const result = await service.createDeploy('1.2.3', 'production', 'CI deploy')

      expect(result).toEqual({ id: '55' })
      expect(mock.history[0].body).toEqual({ environment: 'production', name: 'CI deploy' })
    })

    it('omits the optional name', async () => {
      mock.onPost(`${ BASE }/organizations/${ ORG }/releases/1.2.3/deploys/`).reply({ id: '56' })

      await service.createDeploy('1.2.3', 'staging')

      expect(mock.history[0].body).toEqual({ environment: 'staging' })
    })
  })

  // ── Teams ──

  describe('listTeams', () => {
    it('lists the organization teams', async () => {
      mock.onGet(`${ BASE }/organizations/${ ORG }/teams/`).reply([{ slug: 'backend-team' }])

      const result = await service.listTeams('cursor-1')

      expect(result).toEqual([{ slug: 'backend-team' }])
      expect(mock.history[0].query).toEqual({ cursor: 'cursor-1' })
    })
  })

  // ── Dictionaries ──

  describe('getProjectsDictionary', () => {
    it('maps projects to dictionary items and forwards the search as a query', async () => {
      mock.onGet(`${ BASE }/organizations/${ ORG }/projects/`).reply([
        { slug: 'backend', name: 'Backend', platform: 'python' },
      ])

      const result = await service.getProjectsDictionary({ search: 'back', cursor: 'cursor-1' })

      expect(result).toEqual({
        items: [{ label: 'Backend', value: 'backend', note: 'python' }],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ query: 'back', cursor: 'cursor-1' })
    })

    it('falls back to the slug as the label and omits an empty platform note', async () => {
      mock.onGet(`${ BASE }/organizations/${ ORG }/projects/`).reply([{ slug: 'backend' }])

      const result = await service.getProjectsDictionary(null)

      expect(result.items).toEqual([{ label: 'backend', value: 'backend', note: undefined }])
      expect(mock.history[0].query).toEqual({})
    })

    it('returns an empty list when the response is not an array', async () => {
      mock.onGet(`${ BASE }/organizations/${ ORG }/projects/`).reply({ detail: 'nope' })

      const result = await service.getProjectsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getTeamsDictionary', () => {
    it('maps teams to dictionary items with a member-count note', async () => {
      mock.onGet(`${ BASE }/organizations/${ ORG }/teams/`).reply([
        { slug: 'backend-team', name: 'Backend Team', memberCount: 5 },
      ])

      const result = await service.getTeamsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Backend Team', value: 'backend-team', note: '5 members' }],
        cursor: null,
      })
    })

    it('filters teams client-side by name or slug', async () => {
      mock.onGet(`${ BASE }/organizations/${ ORG }/teams/`).reply([
        { slug: 'backend-team', name: 'Backend Team' },
        { slug: 'frontend-team', name: 'Frontend Team' },
      ])

      const result = await service.getTeamsDictionary({ search: 'FRONT' })

      expect(result.items).toEqual([{ label: 'Frontend Team', value: 'frontend-team', note: undefined }])
    })

    it('does not send the search term as a query parameter', async () => {
      mock.onGet(`${ BASE }/organizations/${ ORG }/teams/`).reply([])

      await service.getTeamsDictionary({ search: 'x', cursor: 'cursor-1' })

      expect(mock.history[0].query).toEqual({ cursor: 'cursor-1' })
    })

    it('returns an empty list when the response is not an array', async () => {
      mock.onGet(`${ BASE }/organizations/${ ORG }/teams/`).reply(null)

      const result = await service.getTeamsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── Base URL fallback (runs last: it replaces the shared sandbox) ──

  describe('base URL fallback', () => {
    it('defaults to the Sentry SaaS API base URL when no base URL is configured', () => {
      jest.resetModules()

      const defaultSandbox = createSandbox({ authToken: AUTH_TOKEN, organizationSlug: ORG })

      require('../src/index.js')

      expect(defaultSandbox.getService().apiBaseUrl).toBe('https://sentry.io/api/0')

      defaultSandbox.cleanup()
    })
  })
})
