'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'

const OAUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_BASE = 'https://graph.microsoft.com/v1.0'
const ONENOTE_BASE = `${API_BASE}/me/onenote`

const AUTH_HEADER = { Authorization: `Bearer ${ACCESS_TOKEN}` }

const NOTEBOOK_ID = '1-f0f09ab6-3a68-4d59-b40e-0f8254e14dd6'
const SECTION_GROUP_ID = '1-a3c5e8f0-1b2d-4c6e-9f01-23456789abcd'
const SECTION_ID = '1-b7d9f1a3-5c8e-4a2b-8d0f-13579bdf2468'
const PAGE_ID = '1-c2e4a6b8-0d1f-4e3a-9b5c-2468ace02468'

describe('Microsoft OneNote Service', () => {
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

    it('stores credentials and default scopes', () => {
      expect(service.clientId).toBe(CLIENT_ID)
      expect(service.clientSecret).toBe(CLIENT_SECRET)
      expect(service.scopes).toBe('offline_access User.Read Notes.ReadWrite Notes.Create')
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
      expect(url).toContain(encodeURIComponent('Notes.ReadWrite'))
      expect(url).toContain(encodeURIComponent('Notes.Create'))
    })
  })

  describe('executeCallback', () => {
    it('exchanges the code for tokens and loads the user profile', async () => {
      const userData = {
        displayName: 'John Doe',
        mail: 'john@test.com',
        userPrincipalName: 'john@test.com',
      }

      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })
      mock.onGet(`${API_BASE}/me`).reply(userData)

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://redirect.example.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
        connectionIdentityName: 'john@test.com (John Doe)',
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

      expect(mock.history[1].method).toBe('get')
      expect(mock.history[1].url).toBe(`${API_BASE}/me`)
      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer new-access-token',
        'Content-Type': 'application/json',
      })
    })

    it('falls back to displayName when the profile has no email', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({ access_token: 'tok', expires_in: 100 })
      mock.onGet(`${API_BASE}/me`).reply({ displayName: 'Jane Roe' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'r' })

      expect(result.connectionIdentityName).toBe('Jane Roe')
    })

    it('uses a generic identity name when the profile request fails', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({ access_token: 'tok', expires_in: 100 })
      mock.onGet(`${API_BASE}/me`).replyWithError({ message: 'Forbidden' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'r' })

      expect(result.connectionIdentityName).toBe('Microsoft OneNote Connection')
      expect(result.userData).toEqual({})
      expect(result.token).toBe('tok')
    })
  })

  describe('refreshToken', () => {
    it('requests a new token pair', async () => {
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
      expect(mock.history[0].body).toContain(encodeURIComponent('Notes.ReadWrite'))
    })

    it('rethrows the original error on failure', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).replyWithError({ message: 'invalid_grant' })

      await expect(service.refreshToken('bad')).rejects.toThrow('invalid_grant')
    })
  })

  // ── Dictionaries ──

  describe('getNotebooksDictionary', () => {
    it('maps notebooks to dictionary items', async () => {
      mock.onGet(`${ONENOTE_BASE}/notebooks`).reply({
        value: [
          { id: 'nb-1', displayName: 'Work Notebook', isDefault: true, userRole: 'Owner' },
          { id: 'nb-2', displayName: 'Personal', isDefault: false, userRole: 'Contributor' },
        ],
      })

      const result = await service.getNotebooksDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Work Notebook', note: 'Default notebook', value: 'nb-1' },
          { label: 'Personal', note: 'Role: Contributor', value: 'nb-2' },
        ],
      })

      expect(mock.history[0].headers).toMatchObject(AUTH_HEADER)
      expect(mock.history[0].query).toEqual({ $top: 20 })
    })

    it('filters locally by search string, case-insensitively', async () => {
      mock.onGet(`${ONENOTE_BASE}/notebooks`).reply({
        value: [
          { id: 'nb-1', displayName: 'Work Notebook', isDefault: true },
          { id: 'nb-2', displayName: 'Personal', isDefault: false, userRole: 'Owner' },
        ],
      })

      const result = await service.getNotebooksDictionary({ search: 'PERSON' })

      expect(result.items).toEqual([{ label: 'Personal', note: 'Role: Owner', value: 'nb-2' }])
    })

    it('handles a null payload and a missing value array', async () => {
      mock.onGet(`${ONENOTE_BASE}/notebooks`).reply({})

      const result = await service.getNotebooksDictionary(null)

      expect(result).toEqual({ cursor: null, items: [] })
    })

    it('uses the cursor as the URL without query params and returns the next link', async () => {
      const cursor = `${ONENOTE_BASE}/notebooks?$skiptoken=abc`

      mock.onGet(cursor).reply({
        value: [{ id: 'nb-3', displayName: 'Archive', isDefault: false, userRole: 'Owner' }],
        '@odata.nextLink': 'next-link',
      })

      const result = await service.getNotebooksDictionary({ cursor })

      expect(result.cursor).toBe('next-link')
      expect(mock.history[0].url).toBe(cursor)
      expect(mock.history[0].query).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ONENOTE_BASE}/notebooks`).replyWithError({
        message: 'Request failed',
        body: { error: { message: 'Access token is empty' } },
      })

      await expect(service.getNotebooksDictionary({})).rejects.toThrow(
        'Microsoft OneNote API error: Access token is empty'
      )
    })

    it('falls back to the error message when the body has no details', async () => {
      mock.onGet(`${ONENOTE_BASE}/notebooks`).replyWithError({ message: 'Network timeout' })

      await expect(service.getNotebooksDictionary({})).rejects.toThrow(
        'Microsoft OneNote API error: Network timeout'
      )
    })
  })

  describe('getSectionGroupsDictionary', () => {
    it('maps section groups with parent notebook notes', async () => {
      mock.onGet(`${ONENOTE_BASE}/sectionGroups`).reply({
        value: [
          { id: 'sg-1', displayName: 'Projects', parentNotebook: { displayName: 'Work Notebook' } },
          { id: 'sg-2', displayName: 'Orphan' },
        ],
      })

      const result = await service.getSectionGroupsDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Projects', note: 'Notebook: Work Notebook', value: 'sg-1' },
          { label: 'Orphan', note: 'ID: sg-2', value: 'sg-2' },
        ],
      })
      expect(mock.history[0].query).toEqual({ $top: 20 })
    })

    it('filters by search and follows a cursor', async () => {
      mock.onGet(`${ONENOTE_BASE}/sectionGroups`).reply({
        value: [
          { id: 'sg-1', displayName: 'Projects' },
          { id: 'sg-2', displayName: 'Research' },
        ],
      })

      const filtered = await service.getSectionGroupsDictionary({ search: 'res' })
      expect(filtered.items).toHaveLength(1)
      expect(filtered.items[0].value).toBe('sg-2')

      const cursor = `${ONENOTE_BASE}/sectionGroups?$skiptoken=x`
      mock.onGet(cursor).reply({ value: [], '@odata.nextLink': 'more' })

      const paged = await service.getSectionGroupsDictionary({ cursor })
      expect(paged).toEqual({ cursor: 'more', items: [] })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ONENOTE_BASE}/sectionGroups`).reply({ value: null })

      await expect(service.getSectionGroupsDictionary(null)).resolves.toEqual({
        cursor: null,
        items: [],
      })
    })
  })

  describe('getSectionsDictionary', () => {
    it('maps sections with parent notebook notes', async () => {
      mock.onGet(`${ONENOTE_BASE}/sections`).reply({
        value: [
          { id: 'sec-1', displayName: 'Meeting Notes', parentNotebook: { displayName: 'Work Notebook' } },
          { id: 'sec-2', displayName: 'Ideas' },
        ],
      })

      const result = await service.getSectionsDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Meeting Notes', note: 'Notebook: Work Notebook', value: 'sec-1' },
          { label: 'Ideas', note: 'ID: sec-2', value: 'sec-2' },
        ],
      })
    })

    it('filters by search and follows a cursor', async () => {
      mock.onGet(`${ONENOTE_BASE}/sections`).reply({
        value: [
          { id: 'sec-1', displayName: 'Meeting Notes' },
          { id: 'sec-2', displayName: 'Ideas' },
        ],
      })

      const filtered = await service.getSectionsDictionary({ search: 'MEETING' })
      expect(filtered.items).toEqual([
        { label: 'Meeting Notes', note: 'ID: sec-1', value: 'sec-1' },
      ])

      const cursor = `${ONENOTE_BASE}/sections?$skiptoken=y`
      mock.onGet(cursor).reply({ value: [] })

      const paged = await service.getSectionsDictionary({ cursor })
      expect(paged.cursor).toBeNull()
      expect(mock.history[1].query).toEqual({})
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ONENOTE_BASE}/sections`).reply({})

      await expect(service.getSectionsDictionary(null)).resolves.toEqual({
        cursor: null,
        items: [],
      })
    })
  })

  describe('getPagesDictionary', () => {
    it('lists pages across all notebooks when no section criteria is given', async () => {
      mock.onGet(`${ONENOTE_BASE}/pages`).reply({
        value: [
          { id: 'pg-1', title: 'Weekly sync', parentSection: { displayName: 'Meeting Notes' } },
          { id: 'pg-2', title: null },
        ],
      })

      const result = await service.getPagesDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Weekly sync', note: 'Section: Meeting Notes', value: 'pg-1' },
          { label: '(untitled page)', note: 'ID: pg-2', value: 'pg-2' },
        ],
      })
      expect(mock.history[0].query).toEqual({ $top: 20 })
    })

    it('lists pages of a section when criteria.sectionId is given', async () => {
      mock.onGet(`${ONENOTE_BASE}/sections/${SECTION_ID}/pages`).reply({
        value: [{ id: 'pg-1', title: 'Weekly sync' }],
      })

      const result = await service.getPagesDictionary({ criteria: { sectionId: SECTION_ID } })

      expect(result.items).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ONENOTE_BASE}/sections/${SECTION_ID}/pages`)
    })

    it('filters by title search', async () => {
      mock.onGet(`${ONENOTE_BASE}/pages`).reply({
        value: [
          { id: 'pg-1', title: 'Weekly sync' },
          { id: 'pg-2', title: 'Roadmap' },
        ],
      })

      const result = await service.getPagesDictionary({ search: 'road' })

      expect(result.items).toEqual([{ label: 'Roadmap', note: 'ID: pg-2', value: 'pg-2' }])
    })

    it('follows a cursor and handles a null payload', async () => {
      const cursor = `${ONENOTE_BASE}/pages?$skip=20`
      mock.onGet(cursor).reply({ value: [], '@odata.nextLink': 'next' })

      const paged = await service.getPagesDictionary({ cursor })
      expect(paged).toEqual({ cursor: 'next', items: [] })

      mock.onGet(`${ONENOTE_BASE}/pages`).reply({})
      await expect(service.getPagesDictionary(null)).resolves.toEqual({ cursor: null, items: [] })
    })
  })

  // ── Notebooks ──

  describe('listNotebooks', () => {
    it('sends OData query params', async () => {
      mock.onGet(`${ONENOTE_BASE}/notebooks`).reply({ value: [] })

      const result = await service.listNotebooks(
        'isDefault eq true',
        'displayName asc',
        'sections',
        50
      )

      expect(result).toEqual({ value: [] })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADER)
      expect(mock.history[0].query).toEqual({
        $filter: 'isDefault eq true',
        $orderby: 'displayName asc',
        $expand: 'sections',
        $top: 50,
      })
    })

    it('omits undefined query params', async () => {
      mock.onGet(`${ONENOTE_BASE}/notebooks`).reply({ value: [] })

      await service.listNotebooks()

      expect(mock.history[0].query).toEqual({})
    })

    it('uses the next page link and ignores other params', async () => {
      const nextLink = `${ONENOTE_BASE}/notebooks?$skip=20`
      mock.onGet(nextLink).reply({ value: [{ id: NOTEBOOK_ID }] })

      const result = await service.listNotebooks('f', 'o', 'e', 10, nextLink)

      expect(result.value[0].id).toBe(NOTEBOOK_ID)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(nextLink)
      expect(mock.history[0].query).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ONENOTE_BASE}/notebooks`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Invalid filter clause' } },
      })

      await expect(service.listNotebooks('bad')).rejects.toThrow(
        'Microsoft OneNote API error: Invalid filter clause'
      )
    })
  })

  describe('getNotebook', () => {
    it('requests the notebook by ID', async () => {
      mock.onGet(`${ONENOTE_BASE}/notebooks/${NOTEBOOK_ID}`).reply({ id: NOTEBOOK_ID })

      const result = await service.getNotebook(NOTEBOOK_ID)

      expect(result).toEqual({ id: NOTEBOOK_ID })
      expect(mock.history[0].method).toBe('get')
    })

    it('requires the notebook id', async () => {
      await expect(service.getNotebook()).rejects.toThrow('Parameter "Notebook" is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('createNotebook', () => {
    it('posts the display name', async () => {
      mock.onPost(`${ONENOTE_BASE}/notebooks`).reply({ id: 'nb-new', displayName: 'Project Phoenix' })

      const result = await service.createNotebook('Project Phoenix')

      expect(result.id).toBe('nb-new')
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ displayName: 'Project Phoenix' })
    })

    it('requires the notebook name', async () => {
      await expect(service.createNotebook('')).rejects.toThrow(
        'Parameter "Notebook Name" is required'
      )
    })
  })

  describe('listNotebookSections', () => {
    it('sends filter and top', async () => {
      mock.onGet(`${ONENOTE_BASE}/notebooks/${NOTEBOOK_ID}/sections`).reply({ value: [] })

      await service.listNotebookSections(NOTEBOOK_ID, "contains(displayName,'x')", 5)

      expect(mock.history[0].query).toEqual({ $filter: "contains(displayName,'x')", $top: 5 })
    })

    it('prefers the next page link over the notebook id', async () => {
      const nextLink = `${ONENOTE_BASE}/notebooks/${NOTEBOOK_ID}/sections?$skip=20`
      mock.onGet(nextLink).reply({ value: [] })

      await service.listNotebookSections(undefined, undefined, undefined, nextLink)

      expect(mock.history[0].url).toBe(nextLink)
    })

    it('requires the notebook id', async () => {
      await expect(service.listNotebookSections()).rejects.toThrow(
        'Parameter "Notebook" is required'
      )
    })
  })

  describe('createSection', () => {
    it('creates a section under a notebook', async () => {
      mock.onPost(`${ONENOTE_BASE}/notebooks/${NOTEBOOK_ID}/sections`).reply({ id: 'sec-new' })

      const result = await service.createSection(NOTEBOOK_ID, 'Sprint Planning')

      expect(result.id).toBe('sec-new')
      expect(mock.history[0].body).toEqual({ displayName: 'Sprint Planning' })
    })

    it('requires the notebook id', async () => {
      await expect(service.createSection(undefined, 'Name')).rejects.toThrow(
        'Parameter "Notebook" is required'
      )
    })

    it('requires the section name', async () => {
      await expect(service.createSection(NOTEBOOK_ID)).rejects.toThrow(
        'Parameter "Section Name" is required'
      )
    })
  })

  describe('copyNotebook', () => {
    it('starts the copy and polls until completion', async () => {
      mock.onPost(`${ONENOTE_BASE}/notebooks/${NOTEBOOK_ID}/copyNotebook`).reply({ id: 'op-1' })
      mock.onGet(`${ONENOTE_BASE}/operations/op-1`).reply({ id: 'op-1', status: 'Completed' })

      const result = await service.copyNotebook(NOTEBOOK_ID, 'Copy of Work')

      expect(result).toEqual({ id: 'op-1', status: 'Completed' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ renameAs: 'Copy of Work' })
      expect(mock.history[1].url).toBe(`${ONENOTE_BASE}/operations/op-1`)
    })

    it('sends an empty body when no rename is provided', async () => {
      mock.onPost(`${ONENOTE_BASE}/notebooks/${NOTEBOOK_ID}/copyNotebook`).reply({ id: 'op-2' })
      mock.onGet(`${ONENOTE_BASE}/operations/op-2`).reply({ status: 'completed' })

      await service.copyNotebook(NOTEBOOK_ID)

      expect(mock.history[0].body).toEqual({})
    })

    it('returns the pending operation when waiting is disabled', async () => {
      mock
        .onPost(`${ONENOTE_BASE}/notebooks/${NOTEBOOK_ID}/copyNotebook`)
        .reply({ id: 'op-3', status: 'NotStarted' })

      const result = await service.copyNotebook(NOTEBOOK_ID, undefined, false)

      expect(result).toEqual({ id: 'op-3', status: 'NotStarted' })
      expect(mock.history).toHaveLength(1)
    })

    it('returns the raw response when the operation has no id', async () => {
      mock.onPost(`${ONENOTE_BASE}/notebooks/${NOTEBOOK_ID}/copyNotebook`).reply({ status: 'Queued' })

      const result = await service.copyNotebook(NOTEBOOK_ID)

      expect(result).toEqual({ status: 'Queued' })
      expect(mock.history).toHaveLength(1)
    })

    it('throws with error details when the operation fails', async () => {
      mock.onPost(`${ONENOTE_BASE}/notebooks/${NOTEBOOK_ID}/copyNotebook`).reply({ id: 'op-4' })
      mock.onGet(`${ONENOTE_BASE}/operations/op-4`).reply({
        id: 'op-4',
        status: 'Failed',
        error: { code: '20140', message: 'Notebook not found' },
      })

      await expect(service.copyNotebook(NOTEBOOK_ID)).rejects.toThrow(
        'Microsoft OneNote copy operation op-4 failed: 20140 Notebook not found'
      )
    })

    it('throws a generic message when the failed operation has no error object', async () => {
      mock.onPost(`${ONENOTE_BASE}/notebooks/${NOTEBOOK_ID}/copyNotebook`).reply({ id: 'op-5' })
      mock.onGet(`${ONENOTE_BASE}/operations/op-5`).reply({ id: 'op-5', status: 'failed' })

      await expect(service.copyNotebook(NOTEBOOK_ID)).rejects.toThrow(
        'no error details provided'
      )
    })

    it('returns the last known operation when the polling deadline is reached', async () => {
      mock.onPost(`${ONENOTE_BASE}/notebooks/${NOTEBOOK_ID}/copyNotebook`).reply({ id: 'op-6' })
      mock.onGet(`${ONENOTE_BASE}/operations/op-6`).reply({ id: 'op-6', status: 'Running' })

      const nowSpy = jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(10 ** 9)

      try {
        const result = await service.copyNotebook(NOTEBOOK_ID)

        expect(result).toEqual({ id: 'op-6', status: 'Running' })
      } finally {
        nowSpy.mockRestore()
      }
    })

    it('requires the notebook id', async () => {
      await expect(service.copyNotebook()).rejects.toThrow('Parameter "Notebook" is required')
    })
  })

  // ── Section groups ──

  describe('listSectionGroups', () => {
    it('lists section groups across all notebooks', async () => {
      mock.onGet(`${ONENOTE_BASE}/sectionGroups`).reply({ value: [] })

      await service.listSectionGroups(undefined, 'f', 'o', 10)

      expect(mock.history[0].url).toBe(`${ONENOTE_BASE}/sectionGroups`)
      expect(mock.history[0].query).toEqual({ $filter: 'f', $orderby: 'o', $top: 10 })
    })

    it('scopes to a notebook when a notebook id is given', async () => {
      mock.onGet(`${ONENOTE_BASE}/notebooks/${NOTEBOOK_ID}/sectionGroups`).reply({ value: [] })

      await service.listSectionGroups(NOTEBOOK_ID)

      expect(mock.history[0].url).toBe(`${ONENOTE_BASE}/notebooks/${NOTEBOOK_ID}/sectionGroups`)
      expect(mock.history[0].query).toEqual({})
    })

    it('uses the next page link', async () => {
      const nextLink = `${ONENOTE_BASE}/sectionGroups?$skip=20`
      mock.onGet(nextLink).reply({ value: [] })

      await service.listSectionGroups(NOTEBOOK_ID, 'f', 'o', 10, nextLink)

      expect(mock.history[0].url).toBe(nextLink)
    })
  })

  describe('getSectionGroup', () => {
    it('requests the section group by ID', async () => {
      mock.onGet(`${ONENOTE_BASE}/sectionGroups/${SECTION_GROUP_ID}`).reply({ id: SECTION_GROUP_ID })

      const result = await service.getSectionGroup(SECTION_GROUP_ID)

      expect(result.id).toBe(SECTION_GROUP_ID)
    })

    it('requires the section group id', async () => {
      await expect(service.getSectionGroup()).rejects.toThrow(
        'Parameter "Section Group" is required'
      )
    })
  })

  describe('listSectionGroupSections', () => {
    it('sends filter and top', async () => {
      mock.onGet(`${ONENOTE_BASE}/sectionGroups/${SECTION_GROUP_ID}/sections`).reply({ value: [] })

      await service.listSectionGroupSections(SECTION_GROUP_ID, 'f', 3)

      expect(mock.history[0].query).toEqual({ $filter: 'f', $top: 3 })
    })

    it('uses the next page link', async () => {
      const nextLink = `${ONENOTE_BASE}/sectionGroups/${SECTION_GROUP_ID}/sections?$skip=20`
      mock.onGet(nextLink).reply({ value: [] })

      await service.listSectionGroupSections(undefined, undefined, undefined, nextLink)

      expect(mock.history[0].url).toBe(nextLink)
    })

    it('requires the section group id', async () => {
      await expect(service.listSectionGroupSections()).rejects.toThrow(
        'Parameter "Section Group" is required'
      )
    })
  })

  describe('createSectionInSectionGroup', () => {
    it('creates a section under a section group', async () => {
      mock.onPost(`${ONENOTE_BASE}/sectionGroups/${SECTION_GROUP_ID}/sections`).reply({ id: 'sec-x' })

      const result = await service.createSectionInSectionGroup(SECTION_GROUP_ID, 'Research')

      expect(result.id).toBe('sec-x')
      expect(mock.history[0].body).toEqual({ displayName: 'Research' })
    })

    it('requires the section group id', async () => {
      await expect(service.createSectionInSectionGroup(undefined, 'Research')).rejects.toThrow(
        'Parameter "Section Group" is required'
      )
    })

    it('requires the section name', async () => {
      await expect(service.createSectionInSectionGroup(SECTION_GROUP_ID)).rejects.toThrow(
        'Parameter "Section Name" is required'
      )
    })
  })

  // ── Sections ──

  describe('listSections', () => {
    it('sends OData query params', async () => {
      mock.onGet(`${ONENOTE_BASE}/sections`).reply({ value: [] })

      await service.listSections('f', 'o', 7)

      expect(mock.history[0].query).toEqual({ $filter: 'f', $orderby: 'o', $top: 7 })
    })

    it('uses the next page link', async () => {
      const nextLink = `${ONENOTE_BASE}/sections?$skip=20`
      mock.onGet(nextLink).reply({ value: [] })

      await service.listSections('f', 'o', 7, nextLink)

      expect(mock.history[0].url).toBe(nextLink)
      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getSection', () => {
    it('requests the section by ID', async () => {
      mock.onGet(`${ONENOTE_BASE}/sections/${SECTION_ID}`).reply({ id: SECTION_ID })

      const result = await service.getSection(SECTION_ID)

      expect(result.id).toBe(SECTION_ID)
    })

    it('requires the section id', async () => {
      await expect(service.getSection()).rejects.toThrow('Parameter "Section" is required')
    })
  })

  describe('listSectionPages', () => {
    it('sends paging params and the pagelevel flag', async () => {
      mock.onGet(`${ONENOTE_BASE}/sections/${SECTION_ID}/pages`).reply({ value: [] })

      await service.listSectionPages(SECTION_ID, 'title asc', 25, 50, true)

      expect(mock.history[0].query).toEqual({
        $orderby: 'title asc',
        $top: 25,
        $skip: 50,
        pagelevel: 'true',
      })
    })

    it('omits the pagelevel flag when disabled', async () => {
      mock.onGet(`${ONENOTE_BASE}/sections/${SECTION_ID}/pages`).reply({ value: [] })

      await service.listSectionPages(SECTION_ID)

      expect(mock.history[0].query).toEqual({})
    })

    it('uses the next page link', async () => {
      const nextLink = `${ONENOTE_BASE}/sections/${SECTION_ID}/pages?$skip=20`
      mock.onGet(nextLink).reply({ value: [] })

      await service.listSectionPages(undefined, undefined, undefined, undefined, undefined, nextLink)

      expect(mock.history[0].url).toBe(nextLink)
    })

    it('requires the section id', async () => {
      await expect(service.listSectionPages()).rejects.toThrow('Parameter "Section" is required')
    })
  })

  describe('copySectionToNotebook', () => {
    it('starts the copy and polls until completion', async () => {
      mock.onPost(`${ONENOTE_BASE}/sections/${SECTION_ID}/copyToNotebook`).reply({ id: 'op-s1' })
      mock.onGet(`${ONENOTE_BASE}/operations/op-s1`).reply({ id: 'op-s1', status: 'Completed' })

      const result = await service.copySectionToNotebook(SECTION_ID, NOTEBOOK_ID, 'Copy')

      expect(result.status).toBe('Completed')
      expect(mock.history[0].body).toEqual({ id: NOTEBOOK_ID, renameAs: 'Copy' })
    })

    it('returns immediately when waiting is disabled', async () => {
      mock
        .onPost(`${ONENOTE_BASE}/sections/${SECTION_ID}/copyToNotebook`)
        .reply({ id: 'op-s2', status: 'Running' })

      const result = await service.copySectionToNotebook(SECTION_ID, NOTEBOOK_ID, undefined, false)

      expect(result.status).toBe('Running')
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({ id: NOTEBOOK_ID })
    })

    it('requires the section id', async () => {
      await expect(service.copySectionToNotebook(undefined, NOTEBOOK_ID)).rejects.toThrow(
        'Parameter "Section" is required'
      )
    })

    it('requires the target notebook id', async () => {
      await expect(service.copySectionToNotebook(SECTION_ID)).rejects.toThrow(
        'Parameter "Target Notebook" is required'
      )
    })
  })

  describe('copySectionToSectionGroup', () => {
    it('starts the copy and polls until completion', async () => {
      mock.onPost(`${ONENOTE_BASE}/sections/${SECTION_ID}/copyToSectionGroup`).reply({ id: 'op-s3' })
      mock.onGet(`${ONENOTE_BASE}/operations/op-s3`).reply({ id: 'op-s3', status: 'Completed' })

      const result = await service.copySectionToSectionGroup(
        SECTION_ID,
        SECTION_GROUP_ID,
        'Renamed'
      )

      expect(result.status).toBe('Completed')
      expect(mock.history[0].body).toEqual({ id: SECTION_GROUP_ID, renameAs: 'Renamed' })
    })

    it('requires the section id', async () => {
      await expect(service.copySectionToSectionGroup(undefined, SECTION_GROUP_ID)).rejects.toThrow(
        'Parameter "Section" is required'
      )
    })

    it('requires the target section group id', async () => {
      await expect(service.copySectionToSectionGroup(SECTION_ID)).rejects.toThrow(
        'Parameter "Target Section Group" is required'
      )
    })
  })

  // ── Pages ──

  describe('listPages', () => {
    it('sends search, filter, order, top and skip', async () => {
      mock.onGet(`${ONENOTE_BASE}/pages`).reply({ value: [] })

      await service.listPages('quarterly', 'f', 'o', 100, 20)

      expect(mock.history[0].query).toEqual({
        search: 'quarterly',
        $filter: 'f',
        $orderby: 'o',
        $top: 100,
        $skip: 20,
      })
    })

    it('uses the next page link', async () => {
      const nextLink = `${ONENOTE_BASE}/pages?$skip=20`
      mock.onGet(nextLink).reply({ value: [] })

      await service.listPages('s', 'f', 'o', 10, 0, nextLink)

      expect(mock.history[0].url).toBe(nextLink)
      expect(mock.history[0].query).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ONENOTE_BASE}/pages`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Too many sections' } },
      })

      await expect(service.listPages()).rejects.toThrow(
        'Microsoft OneNote API error: Too many sections'
      )
    })
  })

  describe('getPage', () => {
    it('requests the page by ID and ignores the section id', async () => {
      mock.onGet(`${ONENOTE_BASE}/pages/${PAGE_ID}`).reply({ id: PAGE_ID, title: 'Weekly sync' })

      const result = await service.getPage(SECTION_ID, PAGE_ID)

      expect(result.title).toBe('Weekly sync')
      expect(mock.history[0].url).toBe(`${ONENOTE_BASE}/pages/${PAGE_ID}`)
      expect(mock.history[0].query).toEqual({})
    })

    it('requires the page id', async () => {
      await expect(service.getPage(SECTION_ID)).rejects.toThrow('Parameter "Page" is required')
    })
  })

  describe('getPageContent', () => {
    it('returns the HTML string', async () => {
      const html = '<html><body><p>Agenda</p></body></html>'
      mock.onGet(`${ONENOTE_BASE}/pages/${PAGE_ID}/content`).reply(html)

      const result = await service.getPageContent(SECTION_ID, PAGE_ID)

      expect(result).toBe(html)
      expect(mock.history[0].query).toEqual({})
    })

    it('requests generated element ids when includeIDs is enabled', async () => {
      mock.onGet(`${ONENOTE_BASE}/pages/${PAGE_ID}/content`).reply('<html></html>')

      await service.getPageContent(undefined, PAGE_ID, true)

      expect(mock.history[0].query).toEqual({ includeIDs: 'true' })
    })

    it('converts a Buffer response to a utf8 string', async () => {
      mock
        .onGet(`${ONENOTE_BASE}/pages/${PAGE_ID}/content`)
        .reply(Buffer.from('<p>binary</p>', 'utf8'))

      const result = await service.getPageContent(undefined, PAGE_ID)

      expect(result).toBe('<p>binary</p>')
    })

    it('requires the page id', async () => {
      await expect(service.getPageContent(SECTION_ID)).rejects.toThrow(
        'Parameter "Page" is required'
      )
    })
  })

  describe('createPage', () => {
    it('builds an XHTML document from title and body html', async () => {
      mock.onPost(`${ONENOTE_BASE}/sections/${SECTION_ID}/pages`).reply({ id: 'pg-new' })

      const result = await service.createPage(SECTION_ID, 'Notes & "today"', '<p>Hello</p>')

      expect(result.id).toBe('pg-new')
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({
        ...AUTH_HEADER,
        'Content-Type': 'text/html',
      })

      const body = mock.history[0].body
      expect(body).toContain('<!DOCTYPE html>')
      expect(body).toContain('<title>Notes &amp; &quot;today&quot;</title>')
      expect(body).toContain('<meta name="created"')
      expect(body).toContain('<p>Hello</p>')
    })

    it('builds a document when only the body html is given', async () => {
      mock.onPost(`${ONENOTE_BASE}/sections/${SECTION_ID}/pages`).reply({ id: 'pg-2' })

      await service.createPage(SECTION_ID, undefined, '<p>Body only</p>')

      expect(mock.history[0].body).toContain('<title></title>')
      expect(mock.history[0].body).toContain('<p>Body only</p>')
    })

    it('builds a document when only the title is given', async () => {
      mock.onPost(`${ONENOTE_BASE}/sections/${SECTION_ID}/pages`).reply({ id: 'pg-3' })

      await service.createPage(SECTION_ID, 'Title only')

      expect(mock.history[0].body).toContain('<title>Title only</title>')
    })

    it('sends raw XHTML as-is when provided', async () => {
      const raw = '<!DOCTYPE html><html><head><title>Raw</title></head><body><p>x</p></body></html>'
      mock.onPost(`${ONENOTE_BASE}/sections/${SECTION_ID}/pages`).reply({ id: 'pg-4' })

      await service.createPage(SECTION_ID, 'Ignored', '<p>ignored</p>', raw)

      expect(mock.history[0].body).toBe(raw)
    })

    it('requires the section id', async () => {
      await expect(service.createPage(undefined, 'Title')).rejects.toThrow(
        'Parameter "Section" is required'
      )
    })

    it('requires some content', async () => {
      await expect(service.createPage(SECTION_ID)).rejects.toThrow(
        'Provide "Title", "Body HTML", or "Raw XHTML Document"'
      )
    })
  })

  describe('updatePageContent', () => {
    it('normalizes command action and position labels', async () => {
      mock.onPatch(`${ONENOTE_BASE}/pages/${PAGE_ID}/content`).reply({})

      const result = await service.updatePageContent(SECTION_ID, PAGE_ID, undefined, [
        { target: '#intro', action: 'Replace', position: 'Before', content: '<p>New</p>' },
        { target: 'body', action: 'Prepend', content: '<p>Top</p>' },
      ])

      expect(result).toEqual({ message: 'Page content updated successfully' })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].headers).toMatchObject({
        ...AUTH_HEADER,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toEqual([
        { target: '#intro', action: 'replace', position: 'before', content: '<p>New</p>' },
        { target: 'body', action: 'prepend', content: '<p>Top</p>' },
      ])
    })

    it('passes through unknown action values unchanged', async () => {
      mock.onPatch(`${ONENOTE_BASE}/pages/${PAGE_ID}/content`).reply({})

      await service.updatePageContent(undefined, PAGE_ID, undefined, [
        { target: 'title', action: 'append', position: 'after', content: 'New title' },
      ])

      expect(mock.history[0].body[0]).toEqual({
        target: 'title',
        action: 'append',
        position: 'after',
        content: 'New title',
      })
    })

    it('appends the shortcut html command', async () => {
      mock.onPatch(`${ONENOTE_BASE}/pages/${PAGE_ID}/content`).reply({})

      await service.updatePageContent(undefined, PAGE_ID, '<p>Follow-up</p>')

      expect(mock.history[0].body).toEqual([
        { target: 'body', action: 'append', position: 'after', content: '<p>Follow-up</p>' },
      ])
    })

    it('combines structured commands with the append shortcut', async () => {
      mock.onPatch(`${ONENOTE_BASE}/pages/${PAGE_ID}/content`).reply({})

      await service.updatePageContent(undefined, PAGE_ID, '<p>Last</p>', [
        { target: '#intro', action: 'Insert', content: '<p>First</p>' },
      ])

      expect(mock.history[0].body).toHaveLength(2)
      expect(mock.history[0].body[0].action).toBe('insert')
      expect(mock.history[0].body[1].content).toBe('<p>Last</p>')
    })

    it('requires the page id', async () => {
      await expect(service.updatePageContent(SECTION_ID)).rejects.toThrow(
        'Parameter "Page" is required'
      )
    })

    it('requires at least one command', async () => {
      await expect(service.updatePageContent(undefined, PAGE_ID)).rejects.toThrow(
        'Provide "Append HTML" or at least one entry in "Commands"'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${ONENOTE_BASE}/pages/${PAGE_ID}/content`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Invalid target' } },
      })

      await expect(
        service.updatePageContent(undefined, PAGE_ID, '<p>x</p>')
      ).rejects.toThrow('Microsoft OneNote API error: Invalid target')
    })
  })

  describe('copyPageToSection', () => {
    it('starts the copy and polls until completion', async () => {
      mock.onPost(`${ONENOTE_BASE}/pages/${PAGE_ID}/copyToSection`).reply({ id: 'op-p1' })
      mock.onGet(`${ONENOTE_BASE}/operations/op-p1`).reply({ id: 'op-p1', status: 'Completed' })

      const result = await service.copyPageToSection(undefined, PAGE_ID, SECTION_ID)

      expect(result.status).toBe('Completed')
      expect(mock.history[0].body).toEqual({ id: SECTION_ID })
    })

    it('returns immediately when waiting is disabled', async () => {
      mock
        .onPost(`${ONENOTE_BASE}/pages/${PAGE_ID}/copyToSection`)
        .reply({ id: 'op-p2', status: 'NotStarted' })

      const result = await service.copyPageToSection(SECTION_ID, PAGE_ID, SECTION_ID, false)

      expect(result.status).toBe('NotStarted')
      expect(mock.history).toHaveLength(1)
    })

    it('requires the page id', async () => {
      await expect(service.copyPageToSection(SECTION_ID)).rejects.toThrow(
        'Parameter "Page" is required'
      )
    })

    it('requires the target section id', async () => {
      await expect(service.copyPageToSection(SECTION_ID, PAGE_ID)).rejects.toThrow(
        'Parameter "Target Section" is required'
      )
    })
  })

  describe('deletePage', () => {
    it('deletes the page and returns a confirmation message', async () => {
      mock.onDelete(`${ONENOTE_BASE}/pages/${PAGE_ID}`).reply({})

      const result = await service.deletePage(SECTION_ID, PAGE_ID)

      expect(result).toEqual({ message: 'Page deleted successfully' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ONENOTE_BASE}/pages/${PAGE_ID}`)
    })

    it('requires the page id', async () => {
      await expect(service.deletePage(SECTION_ID)).rejects.toThrow('Parameter "Page" is required')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ONENOTE_BASE}/pages/${PAGE_ID}`).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'The requested page was not found' } },
      })

      await expect(service.deletePage(undefined, PAGE_ID)).rejects.toThrow(
        'Microsoft OneNote API error: The requested page was not found'
      )
    })
  })

  // ── Operations ──

  describe('getOperationStatus', () => {
    it('requests the operation by ID', async () => {
      mock.onGet(`${ONENOTE_BASE}/operations/op-9`).reply({ id: 'op-9', status: 'Running' })

      const result = await service.getOperationStatus('op-9')

      expect(result).toEqual({ id: 'op-9', status: 'Running' })
    })

    it('requires the operation id', async () => {
      await expect(service.getOperationStatus()).rejects.toThrow(
        'Parameter "Operation ID" is required'
      )
    })
  })
})
