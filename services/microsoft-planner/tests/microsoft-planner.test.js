'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'

const OAUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_BASE = 'https://graph.microsoft.com/v1.0'
const PLANNER_BASE = `${API_BASE}/planner`

const AUTH_HEADER = { Authorization: `Bearer ${ACCESS_TOKEN}` }

const PLAN_ID = 'xqQg5FS2LkCp935s-FIFm2QAFkHM'
const BUCKET_ID = 'hsOf2dhOJkqyYYZEtdzDe2QAIUCR'
const TASK_ID = '01gzSlKkIUSUl6DF_EilrmQAKKQZ'
const GROUP_ID = 'ebf3b108-5234-4e22-b93d-656d7dae5874'
const USER_ID = 'fbab97d0-4932-4511-b675-204639209557'
const ETAG = 'W/"JzEtVGFzayAgQEBAQEBAQEBAQEBAQEBAWCc="'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('Microsoft Planner Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    service.request = { headers: { 'oauth-access-token': ACCESS_TOKEN } }
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  /** Registers the GET used by the etag pre-fetch of every Planner write. */
  const mockEtag = (url, extra = {}) => {
    mock.onGet(url).reply({ '@odata.etag': ETAG, ...extra })
  }

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems).toHaveLength(2)
      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })

    it('stores credentials and default scopes from config', () => {
      expect(service.clientId).toBe(CLIENT_ID)
      expect(service.clientSecret).toBe(CLIENT_SECRET)
      expect(service.scopes).toBe(
        'offline_access User.Read User.ReadBasic.All Tasks.ReadWrite Group.ReadWrite.All'
      )
    })
  })

  // ── OAuth system methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns the authorization URL with client id, scopes and response mode', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`${OAUTH_BASE}/authorize?`)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('response_mode=query')
      expect(url).toContain(encodeURIComponent('offline_access'))
      expect(url).toContain(encodeURIComponent('Tasks.ReadWrite'))
    })
  })

  describe('executeCallback', () => {
    it('exchanges the code for tokens and resolves the identity name', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      const userData = {
        id: 'user-1',
        displayName: 'Adele Vance',
        mail: 'adelev@contoso.com',
        userPrincipalName: 'adelev@contoso.com',
      }

      mock.onGet(`${API_BASE}/me`).reply(userData)

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://redirect.example.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
        connectionIdentityName: 'adelev@contoso.com (Adele Vance)',
        overwrite: true,
        userData,
      })

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${OAUTH_BASE}/token`)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain('code=auth-code-123')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[0].body).toContain(`client_secret=${CLIENT_SECRET}`)
      expect(mock.history[0].body).toContain(
        `redirect_uri=${encodeURIComponent('https://redirect.example.com/callback')}`
      )

      expect(mock.history[1].url).toBe(`${API_BASE}/me`)
      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer new-access-token',
      })
    })

    it('falls back to userPrincipalName when mail is missing', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'tok',
        refresh_token: 'ref',
        expires_in: 100,
      })
      mock.onGet(`${API_BASE}/me`).reply({ userPrincipalName: 'user@contoso.com' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://cb' })

      expect(result.connectionIdentityName).toBe('user@contoso.com')
    })

    it('falls back to displayName when no email is available', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'tok',
        refresh_token: 'ref',
        expires_in: 100,
      })
      mock.onGet(`${API_BASE}/me`).reply({ displayName: 'Adele Vance' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://cb' })

      expect(result.connectionIdentityName).toBe('Adele Vance')
    })

    it('tolerates a failing profile request and uses the default identity name', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'tok',
        refresh_token: 'ref',
        expires_in: 100,
      })
      mock.onGet(`${API_BASE}/me`).replyWithError({ message: 'Forbidden' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://cb' })

      expect(result.connectionIdentityName).toBe('Microsoft Planner Connection')
      expect(result.userData).toEqual({})
      expect(result.token).toBe('tok')
    })
  })

  describe('refreshToken', () => {
    it('exchanges the refresh token for a new access token', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'refreshed-token',
        refresh_token: 'refreshed-refresh-token',
        expires_in: 7200,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        refreshToken: 'refreshed-refresh-token',
        expirationInSeconds: 7200,
      })

      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
    })

    it('rethrows errors from the token endpoint', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).replyWithError({ message: 'invalid_grant' })

      await expect(service.refreshToken('bad')).rejects.toThrow('invalid_grant')
    })
  })

  // ── Dictionaries ──

  describe('getGroupsDictionary', () => {
    const url = `${API_BASE}/me/memberOf/microsoft.graph.group`

    it('lists only unified groups with query and auth header', async () => {
      mock.onGet(url).reply({
        value: [
          { id: 'g1', displayName: 'Marketing', mail: 'marketing@contoso.com', groupTypes: ['Unified'] },
          { id: 'g2', displayName: 'Security', groupTypes: [] },
        ],
      })

      const result = await service.getGroupsDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [{ label: 'Marketing', note: 'marketing@contoso.com', value: 'g1' }],
      })

      expect(mock.history[0].headers).toMatchObject(AUTH_HEADER)
      expect(mock.history[0].query).toEqual({
        $top: 100,
        $select: 'id,displayName,description,mail,groupTypes',
      })
    })

    it('falls back to description then id for the note', async () => {
      mock.onGet(url).reply({
        value: [
          { id: 'g1', displayName: 'A', description: 'desc', groupTypes: ['Unified'] },
          { id: 'g2', displayName: 'B', groupTypes: ['Unified'] },
        ],
      })

      const result = await service.getGroupsDictionary(null)

      expect(result.items).toEqual([
        { label: 'A', note: 'desc', value: 'g1' },
        { label: 'B', note: 'ID: g2', value: 'g2' },
      ])
    })

    it('filters case-insensitively by display name and mail', async () => {
      mock.onGet(url).reply({
        value: [
          { id: 'g1', displayName: 'Marketing', mail: 'marketing@contoso.com', groupTypes: ['Unified'] },
          { id: 'g2', displayName: 'Engineering', mail: 'eng@contoso.com', groupTypes: ['Unified'] },
        ],
      })

      const result = await service.getGroupsDictionary({ search: 'MARKET' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('g1')
    })

    it('uses the cursor as the request URL and returns the next link', async () => {
      const cursor = `${url}?$skiptoken=abc`

      mock.onGet(cursor).reply({ value: [], '@odata.nextLink': 'next-page' })

      const result = await service.getGroupsDictionary({ cursor })

      expect(result).toEqual({ cursor: 'next-page', items: [] })
      expect(mock.history[0].url).toBe(cursor)
      expect(mock.history[0].query).toEqual({})
    })

    it('handles a missing value array', async () => {
      mock.onGet(url).reply({})

      await expect(service.getGroupsDictionary({})).resolves.toEqual({ cursor: null, items: [] })
    })
  })

  describe('getPlansDictionary', () => {
    it('lists plans of a group when criteria provides a group id', async () => {
      mock.onGet(`${API_BASE}/groups/${GROUP_ID}/planner/plans`).reply({
        value: [{ id: PLAN_ID, title: 'Product Launch', container: { containerId: GROUP_ID } }],
      })

      const result = await service.getPlansDictionary({ criteria: { groupId: GROUP_ID } })

      expect(result).toEqual({
        cursor: null,
        items: [{ label: 'Product Launch', note: `Group: ${GROUP_ID}`, value: PLAN_ID }],
      })
    })

    it('lists the signed-in user plans when no group is provided', async () => {
      mock.onGet(`${API_BASE}/me/planner/plans`).reply({
        value: [
          { id: 'p1', title: 'Alpha', owner: 'owner-1' },
          { id: 'p2', title: 'Beta' },
        ],
      })

      const result = await service.getPlansDictionary({})

      expect(result.items).toEqual([
        { label: 'Alpha', note: 'Group: owner-1', value: 'p1' },
        { label: 'Beta', note: 'Group: unknown', value: 'p2' },
      ])
    })

    it('filters plans by title', async () => {
      mock.onGet(`${API_BASE}/me/planner/plans`).reply({
        value: [
          { id: 'p1', title: 'Alpha' },
          { id: 'p2', title: 'Beta' },
        ],
      })

      const result = await service.getPlansDictionary({ search: 'bet' })

      expect(result.items).toEqual([{ label: 'Beta', note: 'Group: unknown', value: 'p2' }])
    })

    it('follows the cursor', async () => {
      mock.onGet('https://cursor/plans').reply({ value: [] })

      await service.getPlansDictionary({ cursor: 'https://cursor/plans' })

      expect(mock.history[0].url).toBe('https://cursor/plans')
    })
  })

  describe('getBucketsDictionary', () => {
    it('returns an empty result without a plan id', async () => {
      const result = await service.getBucketsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns an empty result for a null payload', async () => {
      await expect(service.getBucketsDictionary(null)).resolves.toEqual({ items: [], cursor: null })
    })

    it('maps buckets of the selected plan', async () => {
      mock.onGet(`${PLANNER_BASE}/plans/${PLAN_ID}/buckets`).reply({
        value: [
          { id: BUCKET_ID, name: 'To do' },
          { id: 'b2', name: 'Done' },
        ],
        '@odata.nextLink': 'next',
      })

      const result = await service.getBucketsDictionary({ criteria: { planId: PLAN_ID } })

      expect(result).toEqual({
        cursor: 'next',
        items: [
          { label: 'To do', note: `ID: ${BUCKET_ID}`, value: BUCKET_ID },
          { label: 'Done', note: 'ID: b2', value: 'b2' },
        ],
      })
    })

    it('filters buckets by name', async () => {
      mock.onGet(`${PLANNER_BASE}/plans/${PLAN_ID}/buckets`).reply({
        value: [
          { id: 'b1', name: 'To do' },
          { id: 'b2', name: 'Done' },
        ],
      })

      const result = await service.getBucketsDictionary({
        search: 'DON',
        criteria: { planId: PLAN_ID },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('b2')
    })

    it('follows the cursor when a plan id is present', async () => {
      mock.onGet('https://cursor/buckets').reply({ value: [] })

      await service.getBucketsDictionary({ cursor: 'https://cursor/buckets', criteria: { planId: PLAN_ID } })

      expect(mock.history[0].url).toBe('https://cursor/buckets')
    })
  })

  describe('getTasksDictionary', () => {
    it('lists tasks of a plan and reports completion', async () => {
      mock.onGet(`${PLANNER_BASE}/plans/${PLAN_ID}/tasks`).reply({
        value: [
          { id: TASK_ID, title: 'Update client list', percentComplete: 50 },
          { id: 't2', title: 'Draft brief' },
        ],
      })

      const result = await service.getTasksDictionary({ criteria: { planId: PLAN_ID } })

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Update client list', note: '50% complete', value: TASK_ID },
          { label: 'Draft brief', note: '0% complete', value: 't2' },
        ],
      })
    })

    it('lists my tasks when no plan is provided', async () => {
      mock.onGet(`${API_BASE}/me/planner/tasks`).reply({ value: [] })

      const result = await service.getTasksDictionary({})

      expect(mock.history[0].url).toBe(`${API_BASE}/me/planner/tasks`)
      expect(result.items).toEqual([])
    })

    it('filters tasks by title', async () => {
      mock.onGet(`${API_BASE}/me/planner/tasks`).reply({
        value: [
          { id: 't1', title: 'Alpha', percentComplete: 10 },
          { id: 't2', title: 'Beta', percentComplete: 20 },
        ],
      })

      const result = await service.getTasksDictionary({ search: 'alp' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('t1')
    })

    it('follows the cursor', async () => {
      mock.onGet('https://cursor/tasks').reply({ value: [] })

      await service.getTasksDictionary({ cursor: 'https://cursor/tasks' })

      expect(mock.history[0].url).toBe('https://cursor/tasks')
    })
  })

  describe('getUsersDictionary', () => {
    it('lists directory users with select and top query', async () => {
      mock.onGet(`${API_BASE}/users`).reply({
        value: [{ id: USER_ID, displayName: 'Adele Vance', mail: 'adelev@contoso.com' }],
      })

      const result = await service.getUsersDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [{ label: 'Adele Vance', note: 'adelev@contoso.com', value: USER_ID }],
      })

      expect(mock.history[0].query).toEqual({
        $top: 50,
        $select: 'id,displayName,mail,userPrincipalName',
      })
    })

    it('lists group members when a group id is provided', async () => {
      mock.onGet(`${API_BASE}/groups/${GROUP_ID}/members/microsoft.graph.user`).reply({ value: [] })

      await service.getUsersDictionary({ criteria: { groupId: GROUP_ID } })

      expect(mock.history[0].url).toBe(`${API_BASE}/groups/${GROUP_ID}/members/microsoft.graph.user`)
    })

    it('falls back through mail, principal name and id for label and note', async () => {
      mock.onGet(`${API_BASE}/users`).reply({
        value: [
          { id: 'u1', mail: 'a@contoso.com' },
          { id: 'u2', userPrincipalName: 'b@contoso.com' },
          { id: 'u3', displayName: 'No Contact' },
        ],
      })

      const result = await service.getUsersDictionary({})

      expect(result.items).toEqual([
        { label: 'a@contoso.com', note: 'a@contoso.com', value: 'u1' },
        { label: 'b@contoso.com', note: 'b@contoso.com', value: 'u2' },
        { label: 'No Contact', note: 'ID: u3', value: 'u3' },
      ])
    })

    it('filters users by display name, mail or principal name', async () => {
      mock.onGet(`${API_BASE}/users`).reply({
        value: [
          { id: 'u1', displayName: 'Adele Vance', mail: 'adelev@contoso.com' },
          { id: 'u2', displayName: 'Alex Wilber', userPrincipalName: 'alexw@contoso.com' },
        ],
      })

      const result = await service.getUsersDictionary({ search: 'alexw@' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('u2')
    })

    it('follows the cursor without a query', async () => {
      mock.onGet('https://cursor/users').reply({ value: [] })

      await service.getUsersDictionary({ cursor: 'https://cursor/users' })

      expect(mock.history[0].url).toBe('https://cursor/users')
      expect(mock.history[0].query).toEqual({})
    })
  })

  // ── Plans ──

  describe('listPlans', () => {
    it('requests the plans of a group', async () => {
      const response = { value: [{ id: PLAN_ID, title: 'Product Launch' }] }

      mock.onGet(`${API_BASE}/groups/${GROUP_ID}/planner/plans`).reply(response)

      await expect(service.listPlans(GROUP_ID)).resolves.toEqual(response)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADER)
    })

    it('throws when the group is missing', async () => {
      await expect(service.listPlans()).rejects.toThrow('Parameter "Group" is required')
      expect(mock.history).toHaveLength(0)
    })

    it('wraps Graph API errors', async () => {
      mock.onGet(`${API_BASE}/groups/${GROUP_ID}/planner/plans`).replyWithError({
        message: 'Request failed',
        status: 403,
        body: { error: { message: 'Insufficient privileges' } },
      })

      await expect(service.listPlans(GROUP_ID)).rejects.toThrow(
        'Microsoft Planner API error: Insufficient privileges'
      )
    })

    it('falls back to the raw error message when no error body is present', async () => {
      mock.onGet(`${API_BASE}/groups/${GROUP_ID}/planner/plans`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.listPlans(GROUP_ID)).rejects.toThrow(
        'Microsoft Planner API error: Network timeout'
      )
    })

    it('preserves the HTTP status on the wrapped error', async () => {
      mock.onGet(`${API_BASE}/groups/${GROUP_ID}/planner/plans`).replyWithError({
        message: 'Not found',
        statusCode: 404,
      })

      await expect(service.listPlans(GROUP_ID)).rejects.toMatchObject({ status: 404 })
    })
  })

  describe('getPlan', () => {
    it('requests a single plan', async () => {
      mock.onGet(`${PLANNER_BASE}/plans/${PLAN_ID}`).reply({ id: PLAN_ID, title: 'Product Launch' })

      const result = await service.getPlan(PLAN_ID)

      expect(result.id).toBe(PLAN_ID)
      expect(mock.history[0].url).toBe(`${PLANNER_BASE}/plans/${PLAN_ID}`)
    })

    it('throws when the plan is missing', async () => {
      await expect(service.getPlan()).rejects.toThrow('Parameter "Plan" is required')
    })
  })

  describe('createPlan', () => {
    it('posts the container url and title', async () => {
      mock.onPost(`${PLANNER_BASE}/plans`).reply({ id: PLAN_ID, title: 'Product Launch' })

      const result = await service.createPlan(GROUP_ID, 'Product Launch')

      expect(result.id).toBe(PLAN_ID)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        container: { url: `${API_BASE}/groups/${GROUP_ID}` },
        title: 'Product Launch',
      })
    })

    it('throws when the group is missing', async () => {
      await expect(service.createPlan(null, 'Title')).rejects.toThrow('Parameter "Group" is required')
    })

    it('throws when the title is missing', async () => {
      await expect(service.createPlan(GROUP_ID)).rejects.toThrow('Parameter "Title" is required')
    })
  })

  describe('updatePlan', () => {
    const url = `${PLANNER_BASE}/plans/${PLAN_ID}`

    it('fetches the etag and patches with If-Match and Prefer headers', async () => {
      mockEtag(url)
      mock.onPatch(url).reply({ id: PLAN_ID, title: 'Product Launch 2.0' })

      const result = await service.updatePlan(PLAN_ID, 'Product Launch 2.0')

      expect(result).toEqual({ id: PLAN_ID, title: 'Product Launch 2.0' })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[1].method).toBe('patch')
      expect(mock.history[1].headers).toMatchObject({
        'If-Match': ETAG,
        Prefer: 'return=representation',
        ...AUTH_HEADER,
      })
      expect(mock.history[1].body).toEqual({ title: 'Product Launch 2.0' })
    })

    it('re-fetches the object when the patch returns no representation', async () => {
      mock.onGet(url).reply({ '@odata.etag': ETAG, id: PLAN_ID, title: 'Renamed' })
      mock.onPatch(url).reply(undefined)

      const result = await service.updatePlan(PLAN_ID, 'Renamed')

      expect(result).toMatchObject({ id: PLAN_ID, title: 'Renamed' })
      expect(mock.history.map(call => call.method)).toEqual(['get', 'patch', 'get'])
    })

    it('retries once with a fresh etag on a 409 version conflict', async () => {
      let attempts = 0

      mockEtag(url)
      mock.onPatch(url).replyWith(() => {
        attempts += 1

        if (attempts === 1) {
          throw Object.assign(new Error('Conflict'), { status: 409 })
        }

        return { id: PLAN_ID, title: 'Renamed' }
      })

      const result = await service.updatePlan(PLAN_ID, 'Renamed')

      expect(result).toEqual({ id: PLAN_ID, title: 'Renamed' })
      expect(attempts).toBe(2)
      expect(mock.history.map(call => call.method)).toEqual(['get', 'patch', 'get', 'patch'])
    })

    it('retries once on a 412 precondition failure', async () => {
      let attempts = 0

      mockEtag(url)
      mock.onPatch(url).replyWith(() => {
        attempts += 1

        if (attempts === 1) {
          throw Object.assign(new Error('Precondition Failed'), { statusCode: 412 })
        }

        return { id: PLAN_ID }
      })

      await expect(service.updatePlan(PLAN_ID, 'Renamed')).resolves.toEqual({ id: PLAN_ID })
      expect(attempts).toBe(2)
    })

    it('does not retry on other errors', async () => {
      let attempts = 0

      mockEtag(url)
      mock.onPatch(url).replyWith(() => {
        attempts += 1
        throw Object.assign(new Error('Forbidden'), { status: 403 })
      })

      await expect(service.updatePlan(PLAN_ID, 'Renamed')).rejects.toThrow(
        'Microsoft Planner API error: Forbidden'
      )
      expect(attempts).toBe(1)
    })

    it('throws when the object has no etag', async () => {
      mock.onGet(url).reply({ id: PLAN_ID })

      await expect(service.updatePlan(PLAN_ID, 'Renamed')).rejects.toThrow(
        'Unable to determine the current version (etag) of the Planner object to modify'
      )
    })

    it('throws when the plan is missing', async () => {
      await expect(service.updatePlan(null, 'Renamed')).rejects.toThrow('Parameter "Plan" is required')
    })

    it('throws when the title is missing', async () => {
      await expect(service.updatePlan(PLAN_ID)).rejects.toThrow('Parameter "Title" is required')
    })
  })

  describe('deletePlan', () => {
    const url = `${PLANNER_BASE}/plans/${PLAN_ID}`

    it('deletes with the fetched etag and returns a confirmation', async () => {
      mockEtag(url)
      mock.onDelete(url).reply('')

      const result = await service.deletePlan(PLAN_ID)

      expect(result).toEqual({ message: 'Plan deleted successfully' })
      expect(mock.history.map(call => call.method)).toEqual(['get', 'delete'])
      expect(mock.history[1].headers).toMatchObject({ 'If-Match': ETAG })
      expect(mock.history[1].headers.Prefer).toBeUndefined()
    })

    it('throws when the plan is missing', async () => {
      await expect(service.deletePlan()).rejects.toThrow('Parameter "Plan" is required')
    })
  })

  describe('getPlanDetails', () => {
    it('requests the plan details object', async () => {
      mock.onGet(`${PLANNER_BASE}/plans/${PLAN_ID}/details`).reply({ id: PLAN_ID, sharedWith: {} })

      await expect(service.getPlanDetails(PLAN_ID)).resolves.toEqual({ id: PLAN_ID, sharedWith: {} })
    })

    it('throws when the plan is missing', async () => {
      await expect(service.getPlanDetails()).rejects.toThrow('Parameter "Plan" is required')
    })
  })

  describe('updatePlanDetails', () => {
    const url = `${PLANNER_BASE}/plans/${PLAN_ID}/details`

    it('sends only the provided fields', async () => {
      mockEtag(url)
      mock.onPatch(url).reply({ id: PLAN_ID })

      await service.updatePlanDetails(PLAN_ID, { category1: 'Design' })

      expect(mock.history[1].body).toEqual({ categoryDescriptions: { category1: 'Design' } })
    })

    it('sends both category descriptions and sharing changes', async () => {
      mockEtag(url)
      mock.onPatch(url).reply({ id: PLAN_ID })

      await service.updatePlanDetails(PLAN_ID, { category1: 'Design' }, { [USER_ID]: true })

      expect(mock.history[1].body).toEqual({
        categoryDescriptions: { category1: 'Design' },
        sharedWith: { [USER_ID]: true },
      })
    })

    it('throws when no updatable field is provided', async () => {
      await expect(service.updatePlanDetails(PLAN_ID)).rejects.toThrow(
        'At least one of "Category Descriptions" or "Shared With" must be provided'
      )
    })

    it('throws when the plan is missing', async () => {
      await expect(service.updatePlanDetails()).rejects.toThrow('Parameter "Plan" is required')
    })
  })

  // ── Buckets ──

  describe('listBuckets', () => {
    it('requests the buckets of a plan', async () => {
      mock.onGet(`${PLANNER_BASE}/plans/${PLAN_ID}/buckets`).reply({ value: [] })

      await expect(service.listBuckets(PLAN_ID)).resolves.toEqual({ value: [] })
    })

    it('throws when the plan is missing', async () => {
      await expect(service.listBuckets()).rejects.toThrow('Parameter "Plan" is required')
    })
  })

  describe('getBucket', () => {
    it('requests a bucket by id and ignores the plan id', async () => {
      mock.onGet(`${PLANNER_BASE}/buckets/${BUCKET_ID}`).reply({ id: BUCKET_ID, name: 'To do' })

      const result = await service.getBucket(PLAN_ID, BUCKET_ID)

      expect(result.name).toBe('To do')
      expect(mock.history[0].url).toBe(`${PLANNER_BASE}/buckets/${BUCKET_ID}`)
    })

    it('throws when the bucket is missing', async () => {
      await expect(service.getBucket(PLAN_ID)).rejects.toThrow('Parameter "Bucket" is required')
    })
  })

  describe('createBucket', () => {
    it('creates a bucket with the default order hint', async () => {
      mock.onPost(`${PLANNER_BASE}/buckets`).reply({ id: BUCKET_ID, name: 'Backlog' })

      await service.createBucket(PLAN_ID, 'Backlog')

      expect(mock.history[0].body).toEqual({
        name: 'Backlog',
        planId: PLAN_ID,
        orderHint: ' !',
      })
    })

    it('uses a custom order hint when provided', async () => {
      mock.onPost(`${PLANNER_BASE}/buckets`).reply({ id: BUCKET_ID })

      await service.createBucket(PLAN_ID, 'Backlog', '85752723360752+')

      expect(mock.history[0].body.orderHint).toBe('85752723360752+')
    })

    it('throws when the plan is missing', async () => {
      await expect(service.createBucket(null, 'Backlog')).rejects.toThrow('Parameter "Plan" is required')
    })

    it('throws when the name is missing', async () => {
      await expect(service.createBucket(PLAN_ID)).rejects.toThrow('Parameter "Name" is required')
    })
  })

  describe('updateBucket', () => {
    const url = `${PLANNER_BASE}/buckets/${BUCKET_ID}`

    it('renames a bucket using the fetched etag', async () => {
      mockEtag(url)
      mock.onPatch(url).reply({ id: BUCKET_ID, name: 'Ready for review' })

      const result = await service.updateBucket(PLAN_ID, BUCKET_ID, 'Ready for review')

      expect(result.name).toBe('Ready for review')
      expect(mock.history[1].body).toEqual({ name: 'Ready for review' })
      expect(mock.history[1].headers).toMatchObject({ 'If-Match': ETAG })
    })

    it('throws when the bucket is missing', async () => {
      await expect(service.updateBucket(PLAN_ID, null, 'Name')).rejects.toThrow(
        'Parameter "Bucket" is required'
      )
    })

    it('throws when the name is missing', async () => {
      await expect(service.updateBucket(PLAN_ID, BUCKET_ID)).rejects.toThrow(
        'Parameter "Name" is required'
      )
    })
  })

  describe('deleteBucket', () => {
    const url = `${PLANNER_BASE}/buckets/${BUCKET_ID}`

    it('deletes the bucket and returns a confirmation', async () => {
      mockEtag(url)
      mock.onDelete(url).reply('')

      await expect(service.deleteBucket(PLAN_ID, BUCKET_ID)).resolves.toEqual({
        message: 'Bucket deleted successfully',
      })

      expect(mock.history.map(call => call.method)).toEqual(['get', 'delete'])
    })

    it('throws when the bucket is missing', async () => {
      await expect(service.deleteBucket(PLAN_ID)).rejects.toThrow('Parameter "Bucket" is required')
    })
  })

  // ── Tasks ──

  describe('listPlanTasks', () => {
    it('requests the tasks of a plan', async () => {
      mock.onGet(`${PLANNER_BASE}/plans/${PLAN_ID}/tasks`).reply({ value: [] })

      await expect(service.listPlanTasks(PLAN_ID)).resolves.toEqual({ value: [] })
    })

    it('prefers the next page link over the plan id', async () => {
      mock.onGet('https://next/page').reply({ value: [{ id: TASK_ID }] })

      await service.listPlanTasks(PLAN_ID, 'https://next/page')

      expect(mock.history[0].url).toBe('https://next/page')
    })

    it('throws when neither plan nor next link is provided', async () => {
      await expect(service.listPlanTasks()).rejects.toThrow('Parameter "Plan" is required')
    })
  })

  describe('listBucketTasks', () => {
    it('requests the tasks of a bucket', async () => {
      mock.onGet(`${PLANNER_BASE}/buckets/${BUCKET_ID}/tasks`).reply({ value: [] })

      await expect(service.listBucketTasks(PLAN_ID, BUCKET_ID)).resolves.toEqual({ value: [] })
    })

    it('prefers the next page link over the bucket id', async () => {
      mock.onGet('https://next/bucket-tasks').reply({ value: [] })

      await service.listBucketTasks(PLAN_ID, BUCKET_ID, 'https://next/bucket-tasks')

      expect(mock.history[0].url).toBe('https://next/bucket-tasks')
    })

    it('throws when neither bucket nor next link is provided', async () => {
      await expect(service.listBucketTasks(PLAN_ID)).rejects.toThrow('Parameter "Bucket" is required')
    })
  })

  describe('listMyTasks', () => {
    it('requests the tasks assigned to the signed-in user', async () => {
      mock.onGet(`${API_BASE}/me/planner/tasks`).reply({ value: [] })

      await expect(service.listMyTasks()).resolves.toEqual({ value: [] })
      expect(mock.history[0].url).toBe(`${API_BASE}/me/planner/tasks`)
    })

    it('follows the next page link when provided', async () => {
      mock.onGet('https://next/my-tasks').reply({ value: [] })

      await service.listMyTasks('https://next/my-tasks')

      expect(mock.history[0].url).toBe('https://next/my-tasks')
    })
  })

  describe('getTask', () => {
    it('requests a task by id', async () => {
      mock.onGet(`${PLANNER_BASE}/tasks/${TASK_ID}`).reply({ id: TASK_ID })

      await expect(service.getTask(PLAN_ID, TASK_ID)).resolves.toEqual({ id: TASK_ID })
    })

    it('throws when the task is missing', async () => {
      await expect(service.getTask(PLAN_ID)).rejects.toThrow('Parameter "Task" is required')
    })
  })

  describe('createTask', () => {
    const url = `${PLANNER_BASE}/tasks`

    it('sends only the required fields when nothing else is provided', async () => {
      mock.onPost(url).reply({ id: TASK_ID })

      await service.createTask(PLAN_ID, 'Update client list')

      expect(mock.history[0].body).toEqual({ planId: PLAN_ID, title: 'Update client list' })
    })

    it('builds assignments, normalizes dates and maps the priority', async () => {
      mock.onPost(url).reply({ id: TASK_ID })

      await service.createTask(
        PLAN_ID,
        'Update client list',
        BUCKET_ID,
        [USER_ID],
        '2026-08-01',
        '2026-07-01T09:30:00Z',
        'Urgent',
        0,
        { category1: true }
      )

      expect(mock.history[0].body).toEqual({
        planId: PLAN_ID,
        title: 'Update client list',
        bucketId: BUCKET_ID,
        assignments: {
          [USER_ID]: {
            '@odata.type': '#microsoft.graph.plannerAssignment',
            orderHint: ' !',
          },
        },
        dueDateTime: '2026-08-01T00:00:00Z',
        startDateTime: '2026-07-01T09:30:00Z',
        priority: 1,
        percentComplete: 0,
        appliedCategories: { category1: true },
      })
    })

    it('keeps an explicit time zone offset unchanged', async () => {
      mock.onPost(url).reply({ id: TASK_ID })

      await service.createTask(PLAN_ID, 'T', null, null, '2026-08-01T10:00:00+02:00')

      expect(mock.history[0].body.dueDateTime).toBe('2026-08-01T10:00:00+02:00')
    })

    it('accepts a numeric priority', async () => {
      mock.onPost(url).reply({ id: TASK_ID })

      await service.createTask(PLAN_ID, 'T', null, null, null, null, 7)

      expect(mock.history[0].body.priority).toBe(7)
    })

    it('ignores an empty assignee list', async () => {
      mock.onPost(url).reply({ id: TASK_ID })

      await service.createTask(PLAN_ID, 'T', null, [])

      expect(mock.history[0].body.assignments).toBeUndefined()
    })

    it('throws for an out-of-range priority', async () => {
      await expect(service.createTask(PLAN_ID, 'T', null, null, null, null, 42)).rejects.toThrow(
        'Parameter "Priority" must be Urgent, Important, Medium, Low, or a number between 0 and 10'
      )
    })

    it('throws for a non-numeric priority', async () => {
      await expect(service.createTask(PLAN_ID, 'T', null, null, null, null, 'Critical')).rejects.toThrow(
        'Parameter "Priority" must be Urgent, Important, Medium, Low, or a number between 0 and 10'
      )
    })

    it('throws when the plan is missing', async () => {
      await expect(service.createTask(null, 'T')).rejects.toThrow('Parameter "Plan" is required')
    })

    it('throws when the title is missing', async () => {
      await expect(service.createTask(PLAN_ID)).rejects.toThrow('Parameter "Title" is required')
    })
  })

  describe('updateTask', () => {
    const url = `${PLANNER_BASE}/tasks/${TASK_ID}`

    it('patches only the provided fields', async () => {
      mockEtag(url)
      mock.onPatch(url).reply({ id: TASK_ID, percentComplete: 100 })

      const result = await service.updateTask(PLAN_ID, TASK_ID, null, null, null, null, null, 100)

      expect(result).toEqual({ id: TASK_ID, percentComplete: 100 })
      expect(mock.history[1].body).toEqual({ percentComplete: 100 })
    })

    it('maps named priorities and normalizes dates', async () => {
      mockEtag(url)
      mock.onPatch(url).reply({ id: TASK_ID })

      await service.updateTask(
        PLAN_ID,
        TASK_ID,
        'New title',
        BUCKET_ID,
        '2026-09-01',
        null,
        'Low',
        null,
        { category3: false },
        { [USER_ID]: null }
      )

      expect(mock.history[1].body).toEqual({
        title: 'New title',
        bucketId: BUCKET_ID,
        dueDateTime: '2026-09-01T00:00:00Z',
        priority: 9,
        appliedCategories: { category3: false },
        assignments: { [USER_ID]: null },
      })
    })

    it('throws when no field to update is provided', async () => {
      await expect(service.updateTask(PLAN_ID, TASK_ID)).rejects.toThrow(
        'At least one field to update must be provided'
      )
    })

    it('throws when the task is missing', async () => {
      await expect(service.updateTask(PLAN_ID)).rejects.toThrow('Parameter "Task" is required')
    })
  })

  describe('deleteTask', () => {
    const url = `${PLANNER_BASE}/tasks/${TASK_ID}`

    it('deletes the task and returns a confirmation', async () => {
      mockEtag(url)
      mock.onDelete(url).reply('')

      await expect(service.deleteTask(PLAN_ID, TASK_ID)).resolves.toEqual({
        message: 'Task deleted successfully',
      })

      expect(mock.history.map(call => call.method)).toEqual(['get', 'delete'])
    })

    it('throws when the task is missing', async () => {
      await expect(service.deleteTask(PLAN_ID)).rejects.toThrow('Parameter "Task" is required')
    })
  })

  // ── Task details ──

  describe('getTaskDetails', () => {
    it('requests the task details object', async () => {
      mock.onGet(`${PLANNER_BASE}/tasks/${TASK_ID}/details`).reply({ id: TASK_ID, checklist: {} })

      await expect(service.getTaskDetails(PLAN_ID, TASK_ID)).resolves.toEqual({
        id: TASK_ID,
        checklist: {},
      })
    })

    it('throws when the task is missing', async () => {
      await expect(service.getTaskDetails(PLAN_ID)).rejects.toThrow('Parameter "Task" is required')
    })
  })

  describe('updateTaskDetails', () => {
    const url = `${PLANNER_BASE}/tasks/${TASK_ID}/details`

    it('maps the preview type label to the Graph value', async () => {
      mockEtag(url)
      mock.onPatch(url).reply({ id: TASK_ID })

      await service.updateTaskDetails(PLAN_ID, TASK_ID, 'Notes', 'No Preview')

      expect(mock.history[1].body).toEqual({ description: 'Notes', previewType: 'noPreview' })
    })

    it('passes through an already-valid preview type', async () => {
      mockEtag(url)
      mock.onPatch(url).reply({ id: TASK_ID })

      await service.updateTaskDetails(PLAN_ID, TASK_ID, null, 'reference')

      expect(mock.history[1].body).toEqual({ previewType: 'reference' })
    })

    it('sends checklist and reference changes', async () => {
      mockEtag(url)
      mock.onPatch(url).reply({ id: TASK_ID })

      const checklist = { 'guid-1': null }
      const references = { 'https%3A//contoso': null }

      await service.updateTaskDetails(PLAN_ID, TASK_ID, null, null, checklist, references)

      expect(mock.history[1].body).toEqual({ checklist, references })
    })

    it('throws when no field to update is provided', async () => {
      await expect(service.updateTaskDetails(PLAN_ID, TASK_ID)).rejects.toThrow(
        'At least one field to update must be provided'
      )
    })

    it('throws when the task is missing', async () => {
      await expect(service.updateTaskDetails(PLAN_ID)).rejects.toThrow('Parameter "Task" is required')
    })
  })

  describe('addChecklistItems', () => {
    const url = `${PLANNER_BASE}/tasks/${TASK_ID}/details`

    it('generates a GUID keyed unchecked item per title', async () => {
      mockEtag(url)
      mock.onPatch(url).reply({ id: TASK_ID })

      await service.addChecklistItems(PLAN_ID, TASK_ID, ['Export current list', 'Verify addresses'])

      const { checklist } = mock.history[1].body
      const keys = Object.keys(checklist)

      expect(keys).toHaveLength(2)
      keys.forEach(key => expect(key).toMatch(UUID_RE))

      expect(Object.values(checklist)).toEqual([
        {
          '@odata.type': 'microsoft.graph.plannerChecklistItem',
          title: 'Export current list',
          isChecked: false,
        },
        {
          '@odata.type': 'microsoft.graph.plannerChecklistItem',
          title: 'Verify addresses',
          isChecked: false,
        },
      ])
    })

    it('throws when the item titles are missing', async () => {
      await expect(service.addChecklistItems(PLAN_ID, TASK_ID)).rejects.toThrow(
        'Parameter "Item Titles" is required'
      )
    })

    it('throws for an empty item titles array', async () => {
      await expect(service.addChecklistItems(PLAN_ID, TASK_ID, [])).rejects.toThrow(
        'Parameter "Item Titles" is required'
      )
    })

    it('throws when the task is missing', async () => {
      await expect(service.addChecklistItems(PLAN_ID, null, ['a'])).rejects.toThrow(
        'Parameter "Task" is required'
      )
    })
  })

  describe('updateChecklistItem', () => {
    const url = `${PLANNER_BASE}/tasks/${TASK_ID}/details`
    const ITEM_ID = '95e27074-6c4a-447a-aa24-9d718a0b86fa'

    it('patches the single checklist item with the provided changes', async () => {
      mockEtag(url)
      mock.onPatch(url).reply({ id: TASK_ID })

      await service.updateChecklistItem(PLAN_ID, TASK_ID, ITEM_ID, 'Renamed', true)

      expect(mock.history[1].body).toEqual({
        checklist: {
          [ITEM_ID]: {
            '@odata.type': 'microsoft.graph.plannerChecklistItem',
            title: 'Renamed',
            isChecked: true,
          },
        },
      })
    })

    it('keeps isChecked false as a real change', async () => {
      mockEtag(url)
      mock.onPatch(url).reply({ id: TASK_ID })

      await service.updateChecklistItem(PLAN_ID, TASK_ID, ITEM_ID, null, false)

      expect(mock.history[1].body.checklist[ITEM_ID]).toEqual({
        '@odata.type': 'microsoft.graph.plannerChecklistItem',
        isChecked: false,
      })
    })

    it('throws when neither title nor checked state is provided', async () => {
      await expect(service.updateChecklistItem(PLAN_ID, TASK_ID, ITEM_ID)).rejects.toThrow(
        'At least one of "New Title" or "Checked" must be provided'
      )
    })

    it('throws when the checklist item id is missing', async () => {
      await expect(service.updateChecklistItem(PLAN_ID, TASK_ID)).rejects.toThrow(
        'Parameter "Checklist Item ID" is required'
      )
    })

    it('throws when the task is missing', async () => {
      await expect(service.updateChecklistItem(PLAN_ID)).rejects.toThrow('Parameter "Task" is required')
    })
  })

  describe('deleteChecklistItem', () => {
    const url = `${PLANNER_BASE}/tasks/${TASK_ID}/details`
    const ITEM_ID = '95e27074-6c4a-447a-aa24-9d718a0b86fa'

    it('nulls the checklist item and returns a confirmation', async () => {
      mockEtag(url)
      mock.onPatch(url).reply({ id: TASK_ID })

      const result = await service.deleteChecklistItem(PLAN_ID, TASK_ID, ITEM_ID)

      expect(result).toEqual({ message: 'Checklist item deleted successfully' })
      expect(mock.history[1].body).toEqual({ checklist: { [ITEM_ID]: null } })
    })

    it('throws when the checklist item id is missing', async () => {
      await expect(service.deleteChecklistItem(PLAN_ID, TASK_ID)).rejects.toThrow(
        'Parameter "Checklist Item ID" is required'
      )
    })

    it('throws when the task is missing', async () => {
      await expect(service.deleteChecklistItem(PLAN_ID)).rejects.toThrow('Parameter "Task" is required')
    })
  })

  // ── Assignments ──

  describe('assignUserToTask', () => {
    const url = `${PLANNER_BASE}/tasks/${TASK_ID}`

    it('patches the task with a Planner assignment for the user', async () => {
      mockEtag(url)
      mock.onPatch(url).reply({ id: TASK_ID })

      await service.assignUserToTask(PLAN_ID, TASK_ID, USER_ID)

      expect(mock.history[1].body).toEqual({
        assignments: {
          [USER_ID]: {
            '@odata.type': '#microsoft.graph.plannerAssignment',
            orderHint: ' !',
          },
        },
      })
    })

    it('throws when the user is missing', async () => {
      await expect(service.assignUserToTask(PLAN_ID, TASK_ID)).rejects.toThrow(
        'Parameter "User" is required'
      )
    })

    it('throws when the task is missing', async () => {
      await expect(service.assignUserToTask(PLAN_ID)).rejects.toThrow('Parameter "Task" is required')
    })
  })

  describe('unassignUserFromTask', () => {
    const url = `${PLANNER_BASE}/tasks/${TASK_ID}`

    it('patches the task with a null assignment for the user', async () => {
      mockEtag(url)
      mock.onPatch(url).reply({ id: TASK_ID, assignments: {} })

      const result = await service.unassignUserFromTask(PLAN_ID, TASK_ID, USER_ID)

      expect(result).toEqual({ id: TASK_ID, assignments: {} })
      expect(mock.history[1].body).toEqual({ assignments: { [USER_ID]: null } })
    })

    it('throws when the user is missing', async () => {
      await expect(service.unassignUserFromTask(PLAN_ID, TASK_ID)).rejects.toThrow(
        'Parameter "User" is required'
      )
    })

    it('throws when the task is missing', async () => {
      await expect(service.unassignUserFromTask(PLAN_ID)).rejects.toThrow('Parameter "Task" is required')
    })
  })
})
