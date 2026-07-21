'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'

const API_BASE = 'https://people.googleapis.com/v1'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

const PERSON_FIELDS = 'names,emailAddresses,phoneNumbers,organizations,biographies,addresses'

const MOCK_PERSON = {
  resourceName: 'people/c123',
  etag: '%EgU=',
  names: [{ displayName: 'Ada Lovelace', givenName: 'Ada', familyName: 'Lovelace' }],
  emailAddresses: [{ value: 'ada@example.com' }],
  phoneNumbers: [{ value: '+1 555 123 4567' }],
  organizations: [{ name: 'Analytical Engines', title: 'Engineer' }],
  biographies: [{ value: 'Notes here' }],
  addresses: [{ formattedValue: '1 Main St' }],
}

describe('Google Contacts Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })

    require('../src/index.js')

    service = sandbox.getService()
    service.request = { headers: { 'oauth-access-token': ACCESS_TOKEN } }
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
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })
  })

  // ── OAuth ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a correctly composed authorization URL', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(OAUTH_URL)
      expect(url).toContain(`client_id=${ encodeURIComponent(CLIENT_ID) }`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('access_type=offline')
      expect(url).toContain('prompt=consent')
      expect(url).toContain(encodeURIComponent('https://www.googleapis.com/auth/contacts'))
    })
  })

  describe('executeCallback', () => {
    const callbackObject = {
      code: 'auth-code-123',
      redirectURI: 'https://app.example.com/callback',
    }

    it('exchanges code for tokens and fetches user info', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      })

      mock.onGet(USER_INFO_URL).reply({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        picture: 'https://photo.example.com/ada.jpg',
      })

      const result = await service.executeCallback(callbackObject)

      expect(result).toEqual({
        token: 'new-access-token',
        expirationInSeconds: 3600,
        refreshToken: 'new-refresh-token',
        connectionIdentityName: 'Ada Lovelace (ada@example.com)',
        connectionIdentityImageURL: 'https://photo.example.com/ada.jpg',
        overwrite: true,
        userData: expect.objectContaining({ name: 'Ada Lovelace', email: 'ada@example.com' }),
      })

      // Verify token exchange request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(TOKEN_URL)
      expect(mock.history[0].body).toContain(`code=${ callbackObject.code }`)
      expect(mock.history[0].body).toContain(`client_id=${ CLIENT_ID }`)
      expect(mock.history[0].body).toContain(`client_secret=${ CLIENT_SECRET }`)

      // Verify user info request uses the new access token
      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer new-access-token',
      })
    })

    it('falls back to email when user name is missing', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'token',
        expires_in: 3600,
      })

      mock.onGet(USER_INFO_URL).reply({
        email: 'ada@example.com',
      })

      const result = await service.executeCallback(callbackObject)

      expect(result.connectionIdentityName).toBe('ada@example.com')
    })

    it('uses default identity name when user info fetch fails', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'token',
        expires_in: 3600,
      })

      mock.onGet(USER_INFO_URL).replyWithError({ message: 'Unauthorized' })

      const result = await service.executeCallback(callbackObject)

      expect(result.connectionIdentityName).toBe('Google Contacts Account')
      expect(result.connectionIdentityImageURL).toBeNull()
    })
  })

  describe('refreshToken', () => {
    it('refreshes the access token', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('my-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        expirationInSeconds: 3600,
      })

      expect(mock.history[0].query).toMatchObject({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: 'my-refresh-token',
      })
    })

    it('throws a friendly message on invalid_grant error', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Token expired',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken('bad-token'))
        .rejects.toThrow('Refresh token expired or invalid, please re-authenticate.')
    })

    it('re-throws other errors as-is', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Server error',
        body: { error: 'server_error' },
      })

      await expect(service.refreshToken('token')).rejects.toThrow('Server error')
    })
  })

  // ── Dictionaries ──

  describe('getContactGroupsDictionary', () => {
    const groupsUrl = `${ API_BASE }/contactGroups`

    it('returns dictionary items from contact groups', async () => {
      mock.onGet(groupsUrl).reply({
        contactGroups: [
          { resourceName: 'contactGroups/abc', formattedName: 'Clients', groupType: 'USER_CONTACT_GROUP', memberCount: 5 },
          { resourceName: 'contactGroups/def', name: 'starred', formattedName: 'Starred', groupType: 'SYSTEM_CONTACT_GROUP' },
        ],
        nextPageToken: 'page2',
      })

      const result = await service.getContactGroupsDictionary({})

      expect(result.cursor).toBe('page2')
      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: 'Clients',
        value: 'contactGroups/abc',
        note: 'USER_CONTACT_GROUP (5 members)',
      })
      expect(result.items[1]).toEqual({
        label: 'Starred',
        value: 'contactGroups/def',
        note: 'SYSTEM_CONTACT_GROUP',
      })
    })

    it('filters by search text', async () => {
      mock.onGet(groupsUrl).reply({
        contactGroups: [
          { resourceName: 'contactGroups/abc', formattedName: 'Clients', groupType: 'USER_CONTACT_GROUP', memberCount: 5 },
          { resourceName: 'contactGroups/def', formattedName: 'Partners', groupType: 'USER_CONTACT_GROUP', memberCount: 3 },
        ],
      })

      const result = await service.getContactGroupsDictionary({ search: 'cli' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Clients')
    })

    it('passes cursor as pageToken', async () => {
      mock.onGet(groupsUrl).reply({ contactGroups: [] })

      await service.getContactGroupsDictionary({ cursor: 'token123' })

      expect(mock.history[0].query).toMatchObject({ pageToken: 'token123' })
    })

    it('handles empty payload', async () => {
      mock.onGet(groupsUrl).reply({ contactGroups: [] })

      const result = await service.getContactGroupsDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getContactsDictionary', () => {
    const connectionsUrl = `${ API_BASE }/people/me/connections`
    const searchUrl = `${ API_BASE }/people:searchContacts`

    it('lists contacts without search', async () => {
      mock.onGet(connectionsUrl).reply({
        connections: [
          { resourceName: 'people/c1', names: [{ displayName: 'Ada' }], emailAddresses: [{ value: 'ada@test.com' }] },
        ],
        nextPageToken: 'next',
      })

      const result = await service.getContactsDictionary({})

      expect(result.cursor).toBe('next')
      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({
        label: 'Ada',
        value: 'people/c1',
        note: 'ada@test.com',
      })

      expect(mock.history[0].query).toMatchObject({
        sortOrder: 'FIRST_NAME_ASCENDING',
        pageSize: 100,
      })
    })

    it('searches contacts when search is provided', async () => {
      let callCount = 0

      mock.onGet(searchUrl).replyWith(() => {
        callCount++

        if (callCount === 1) {
          return { results: [] }
        }

        return {
          results: [
            { person: { resourceName: 'people/c2', names: [{ displayName: 'Bob' }], emailAddresses: [{ value: 'bob@test.com' }] } },
          ],
        }
      })

      const result = await service.getContactsDictionary({ search: 'bob' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Bob')

      // Warmup request + actual search
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].query).toMatchObject({ query: '', readMask: 'names' })
      expect(mock.history[1].query).toMatchObject({ query: 'bob', pageSize: 30 })
    })

    it('uses resourceName as label when no name or email', async () => {
      mock.onGet(connectionsUrl).reply({
        connections: [
          { resourceName: 'people/c3' },
        ],
      })

      const result = await service.getContactsDictionary({})

      expect(result.items[0].label).toBe('people/c3')
      expect(result.items[0].note).toBe('')
    })
  })

  // ── Contacts ──

  describe('createContact', () => {
    const createUrl = `${ API_BASE }/people:createContact`

    it('sends POST with person body from simple fields', async () => {
      mock.onPost(createUrl).reply(MOCK_PERSON)

      const result = await service.createContact('Ada', 'Lovelace', 'ada@example.com', '+1 555', 'Engines', 'Engineer', 'Notes')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toMatchObject({
        names: [{ givenName: 'Ada', familyName: 'Lovelace' }],
        emailAddresses: [{ value: 'ada@example.com' }],
        phoneNumbers: [{ value: '+1 555' }],
        organizations: [{ name: 'Engines', title: 'Engineer' }],
        biographies: [{ value: 'Notes', contentType: 'TEXT_PLAIN' }],
      })
      expect(mock.history[0].query).toMatchObject({ personFields: PERSON_FIELDS })

      // Verify simplified response
      expect(result).toMatchObject({
        resourceName: 'people/c123',
        firstName: 'Ada',
        lastName: 'Lovelace',
        emails: ['ada@example.com'],
        phones: ['+1 555 123 4567'],
        company: 'Analytical Engines',
        jobTitle: 'Engineer',
      })
    })

    it('merges rawPerson over simple fields', async () => {
      mock.onPost(createUrl).reply(MOCK_PERSON)

      await service.createContact('Ada', null, null, null, null, null, null, {
        emailAddresses: [{ value: 'override@test.com' }],
      })

      expect(mock.history[0].body.emailAddresses).toEqual([{ value: 'override@test.com' }])
      expect(mock.history[0].body.names).toEqual([{ givenName: 'Ada' }])
    })

    it('throws when no fields are provided', async () => {
      await expect(service.createContact()).rejects.toThrow('At least one contact field must be provided')
    })

    it('omits empty fields from body', async () => {
      mock.onPost(createUrl).reply(MOCK_PERSON)

      await service.createContact('Ada')

      const body = mock.history[0].body

      expect(body.names).toBeDefined()
      expect(body.emailAddresses).toBeUndefined()
      expect(body.phoneNumbers).toBeUndefined()
      expect(body.organizations).toBeUndefined()
      expect(body.biographies).toBeUndefined()
    })
  })

  describe('getContact', () => {
    it('fetches a contact by resource name', async () => {
      mock.onGet(`${ API_BASE }/people/c123`).reply(MOCK_PERSON)

      const result = await service.getContact('people/c123')

      expect(result.resourceName).toBe('people/c123')
      expect(result.displayName).toBe('Ada Lovelace')
      expect(mock.history[0].query).toMatchObject({ personFields: PERSON_FIELDS })
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${ ACCESS_TOKEN }` })
    })

    it('normalizes resource name without people/ prefix', async () => {
      mock.onGet(`${ API_BASE }/people/c123`).reply(MOCK_PERSON)

      await service.getContact('c123')

      expect(mock.history[0].url).toBe(`${ API_BASE }/people/c123`)
    })

    it('throws when resource name is missing', async () => {
      await expect(service.getContact()).rejects.toThrow('"Contact" is required')
    })
  })

  describe('listContacts', () => {
    const connectionsUrl = `${ API_BASE }/people/me/connections`

    it('lists contacts with defaults', async () => {
      mock.onGet(connectionsUrl).reply({
        connections: [MOCK_PERSON],
        nextPageToken: 'page2',
        totalItems: 50,
      })

      const result = await service.listContacts()

      expect(result.contacts).toHaveLength(1)
      expect(result.contacts[0].displayName).toBe('Ada Lovelace')
      expect(result.nextPageToken).toBe('page2')
      expect(result.totalItems).toBe(50)
      expect(mock.history[0].query).toMatchObject({ pageSize: 100 })
    })

    it('passes custom pageSize and pageToken', async () => {
      mock.onGet(connectionsUrl).reply({ connections: [] })

      await service.listContacts(10, 'myToken')

      expect(mock.history[0].query).toMatchObject({ pageSize: 10, pageToken: 'myToken' })
    })

    it('resolves sortOrder from display name to API value', async () => {
      mock.onGet(connectionsUrl).reply({ connections: [] })

      await service.listContacts(null, null, 'First Name')

      expect(mock.history[0].query).toMatchObject({ sortOrder: 'FIRST_NAME_ASCENDING' })
    })

    it('resolves Last Modified sort order', async () => {
      mock.onGet(connectionsUrl).reply({ connections: [] })

      await service.listContacts(null, null, 'Last Modified')

      expect(mock.history[0].query).toMatchObject({ sortOrder: 'LAST_MODIFIED_DESCENDING' })
    })

    it('handles empty connections', async () => {
      mock.onGet(connectionsUrl).reply({ totalItems: 0 })

      const result = await service.listContacts()

      expect(result.contacts).toEqual([])
    })
  })

  describe('updateContact', () => {
    const fetchUrl = `${ API_BASE }/people/c123`
    const updateUrl = `${ API_BASE }/people/c123:updateContact`

    it('fetches current contact then sends PATCH with updated fields', async () => {
      mock.onGet(fetchUrl).reply(MOCK_PERSON)

      const updatedPerson = { ...MOCK_PERSON, names: [{ givenName: 'Ada', familyName: 'King' }] }
      mock.onPatch(updateUrl).reply(updatedPerson)

      const result = await service.updateContact('people/c123', null, 'King')

      // Should have fetched first
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(fetchUrl)

      // Then patched
      expect(mock.history[1].method).toBe('patch')
      expect(mock.history[1].body).toMatchObject({
        etag: '%EgU=',
        names: [{ givenName: 'Ada', familyName: 'King' }],
      })
      expect(mock.history[1].query).toMatchObject({
        updatePersonFields: 'names',
        personFields: PERSON_FIELDS,
      })

      expect(result.resourceName).toBe('people/c123')
    })

    it('includes multiple update fields when several are changed', async () => {
      mock.onGet(fetchUrl).reply(MOCK_PERSON)
      mock.onPatch(updateUrl).reply(MOCK_PERSON)

      await service.updateContact('people/c123', 'NewFirst', null, 'new@email.com', '+1 999', null, null, 'New notes')

      const body = mock.history[1].body

      expect(body.names).toBeDefined()
      expect(body.emailAddresses).toEqual([{ value: 'new@email.com' }])
      expect(body.phoneNumbers).toEqual([{ value: '+1 999' }])
      expect(body.biographies).toEqual([{ value: 'New notes', contentType: 'TEXT_PLAIN' }])

      expect(mock.history[1].query.updatePersonFields).toBe('names,emailAddresses,phoneNumbers,biographies')
    })

    it('preserves current name fields when only one name part is updated', async () => {
      mock.onGet(fetchUrl).reply(MOCK_PERSON)
      mock.onPatch(updateUrl).reply(MOCK_PERSON)

      await service.updateContact('people/c123', 'NewFirst')

      expect(mock.history[1].body.names).toEqual([{
        givenName: 'NewFirst',
        familyName: 'Lovelace',
      }])
    })

    it('preserves current organization fields when only company is updated', async () => {
      mock.onGet(fetchUrl).reply(MOCK_PERSON)
      mock.onPatch(updateUrl).reply(MOCK_PERSON)

      await service.updateContact('people/c123', null, null, null, null, 'NewCo')

      expect(mock.history[1].body.organizations).toEqual([{
        name: 'NewCo',
        title: 'Engineer',
      }])
    })

    it('throws when no update fields are provided', async () => {
      mock.onGet(fetchUrl).reply(MOCK_PERSON)

      await expect(service.updateContact('people/c123'))
        .rejects.toThrow('At least one field to update must be provided')
    })

    it('throws when resource name is missing', async () => {
      await expect(service.updateContact())
        .rejects.toThrow('"Contact" is required')
    })
  })

  describe('deleteContact', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${ API_BASE }/people/c123:deleteContact`).reply({})

      const result = await service.deleteContact('people/c123')

      expect(result).toEqual({
        success: true,
        message: 'Contact deleted successfully',
        resourceName: 'people/c123',
      })
      expect(mock.history[0].method).toBe('delete')
    })

    it('normalizes resource name', async () => {
      mock.onDelete(`${ API_BASE }/people/c123:deleteContact`).reply({})

      await service.deleteContact('c123')

      expect(mock.history[0].url).toBe(`${ API_BASE }/people/c123:deleteContact`)
    })

    it('throws when resource name is missing', async () => {
      await expect(service.deleteContact()).rejects.toThrow('"Contact" is required')
    })
  })

  describe('searchContacts', () => {
    const searchUrl = `${ API_BASE }/people:searchContacts`

    it('warms up cache then searches', async () => {
      let callCount = 0

      mock.onGet(searchUrl).replyWith(() => {
        callCount++

        if (callCount === 1) {
          return {}
        }

        return {
          results: [
            { person: MOCK_PERSON },
          ],
        }
      })

      const result = await service.searchContacts('ada')

      expect(mock.history).toHaveLength(2)
      // Warmup request
      expect(mock.history[0].query).toMatchObject({ query: '', readMask: 'names' })
      // Search request
      expect(mock.history[1].query).toMatchObject({
        query: 'ada',
        readMask: PERSON_FIELDS,
      })

      expect(result.contacts).toHaveLength(1)
      expect(result.contacts[0].displayName).toBe('Ada Lovelace')
      expect(result.totalMatches).toBe(1)
    })

    it('caps pageSize at 30', async () => {
      let callCount = 0

      mock.onGet(searchUrl).replyWith(() => {
        callCount++
        return callCount === 1 ? {} : { results: [] }
      })

      await service.searchContacts('test', 50)

      expect(mock.history[1].query).toMatchObject({ pageSize: 30 })
    })

    it('omits pageSize when not provided', async () => {
      let callCount = 0

      mock.onGet(searchUrl).replyWith(() => {
        callCount++
        return callCount === 1 ? {} : { results: [] }
      })

      await service.searchContacts('test')

      expect(mock.history[1].query.pageSize).toBeUndefined()
    })

    it('throws when query is missing', async () => {
      await expect(service.searchContacts()).rejects.toThrow('"Query" is required')
    })

    it('handles empty results', async () => {
      mock.onGet(searchUrl).replyWith(() => ({}))

      const result = await service.searchContacts('nonexistent')

      expect(result.contacts).toEqual([])
      expect(result.totalMatches).toBe(0)
    })
  })

  // ── Contact Groups ──

  describe('listContactGroups', () => {
    const groupsUrl = `${ API_BASE }/contactGroups`

    it('sends GET with pageSize and pageToken', async () => {
      const mockResponse = {
        contactGroups: [{ resourceName: 'contactGroups/abc', name: 'Clients' }],
        nextPageToken: 'page2',
        totalItems: 5,
      }

      mock.onGet(groupsUrl).reply(mockResponse)

      const result = await service.listContactGroups(10, 'page1')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].query).toMatchObject({ pageSize: 10, pageToken: 'page1' })
    })
  })

  describe('createContactGroup', () => {
    const groupsUrl = `${ API_BASE }/contactGroups`

    it('sends POST with group name in body', async () => {
      const mockResponse = { resourceName: 'contactGroups/new', name: 'Partners' }

      mock.onPost(groupsUrl).reply(mockResponse)

      const result = await service.createContactGroup('Partners')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].body).toEqual({ contactGroup: { name: 'Partners' } })
    })

    it('throws when name is missing', async () => {
      await expect(service.createContactGroup()).rejects.toThrow('"Name" is required')
    })
  })

  describe('addContactsToGroup', () => {
    const modifyUrl = `${ API_BASE }/contactGroups/abc/members:modify`

    it('sends POST with resource names to add', async () => {
      mock.onPost(modifyUrl).reply({ notFoundResourceNames: [] })

      const result = await service.addContactsToGroup('contactGroups/abc', ['people/c1', 'people/c2'])

      expect(result).toEqual({
        success: true,
        groupResourceName: 'contactGroups/abc',
        addedCount: 2,
        notFoundResourceNames: [],
      })
      expect(mock.history[0].body).toEqual({
        resourceNamesToAdd: ['people/c1', 'people/c2'],
      })
    })

    it('normalizes group and contact resource names', async () => {
      mock.onPost(modifyUrl).reply({})

      await service.addContactsToGroup('abc', ['c1'])

      expect(mock.history[0].url).toBe(modifyUrl)
      expect(mock.history[0].body).toEqual({
        resourceNamesToAdd: ['people/c1'],
      })
    })

    it('reports not-found contacts', async () => {
      mock.onPost(modifyUrl).reply({ notFoundResourceNames: ['people/c2'] })

      const result = await service.addContactsToGroup('contactGroups/abc', ['people/c1', 'people/c2'])

      expect(result.addedCount).toBe(1)
      expect(result.notFoundResourceNames).toEqual(['people/c2'])
    })

    it('throws when group is missing', async () => {
      await expect(service.addContactsToGroup(null, ['people/c1']))
        .rejects.toThrow('"Contact Group" is required')
    })

    it('throws when contacts list is empty', async () => {
      await expect(service.addContactsToGroup('contactGroups/abc', []))
        .rejects.toThrow('"Contacts" must contain at least one contact resource name')
    })
  })

  describe('removeContactsFromGroup', () => {
    const modifyUrl = `${ API_BASE }/contactGroups/abc/members:modify`

    it('sends POST with resource names to remove', async () => {
      mock.onPost(modifyUrl).reply({
        notFoundResourceNames: [],
        canNotRemoveLastContactGroupResourceNames: [],
      })

      const result = await service.removeContactsFromGroup('contactGroups/abc', ['people/c1'])

      expect(result).toEqual({
        success: true,
        groupResourceName: 'contactGroups/abc',
        removedCount: 1,
        notFoundResourceNames: [],
        canNotRemoveLastContactGroupResourceNames: [],
      })
      expect(mock.history[0].body).toEqual({
        resourceNamesToRemove: ['people/c1'],
      })
    })

    it('accounts for not-found and cannot-remove contacts in removedCount', async () => {
      mock.onPost(modifyUrl).reply({
        notFoundResourceNames: ['people/c2'],
        canNotRemoveLastContactGroupResourceNames: ['people/c3'],
      })

      const result = await service.removeContactsFromGroup('contactGroups/abc', ['people/c1', 'people/c2', 'people/c3'])

      expect(result.removedCount).toBe(1)
      expect(result.notFoundResourceNames).toEqual(['people/c2'])
      expect(result.canNotRemoveLastContactGroupResourceNames).toEqual(['people/c3'])
    })

    it('handles single contact as non-array input', async () => {
      mock.onPost(modifyUrl).reply({})

      await service.removeContactsFromGroup('contactGroups/abc', 'people/c1')

      expect(mock.history[0].body).toEqual({
        resourceNamesToRemove: ['people/c1'],
      })
    })
  })

  // ── Error handling ──

  describe('API error handling', () => {
    it('wraps API errors with Google Contacts prefix', async () => {
      mock.onGet(`${ API_BASE }/people/c999`).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'Contact not found' } },
      })

      await expect(service.getContact('people/c999'))
        .rejects.toThrow('Google Contacts API error: Contact not found')
    })

    it('falls back to error.message when body.error.message is missing', async () => {
      mock.onGet(`${ API_BASE }/people/c999`).replyWithError({
        message: 'Network error',
      })

      await expect(service.getContact('people/c999'))
        .rejects.toThrow('Google Contacts API error: Network error')
    })
  })

  // ── #simplifyPerson edge cases ──

  describe('simplifyPerson edge cases', () => {
    it('handles person with no optional fields', async () => {
      mock.onGet(`${ API_BASE }/people/cMinimal`).reply({
        resourceName: 'people/cMinimal',
        etag: '%tag',
      })

      const result = await service.getContact('people/cMinimal')

      expect(result).toMatchObject({
        resourceName: 'people/cMinimal',
        displayName: null,
        firstName: null,
        lastName: null,
        emails: [],
        phones: [],
        company: null,
        jobTitle: null,
        notes: null,
        addresses: [],
      })
    })

    it('builds displayName from givenName and familyName when displayName is missing', async () => {
      mock.onGet(`${ API_BASE }/people/c5`).reply({
        resourceName: 'people/c5',
        names: [{ givenName: 'First', familyName: 'Last' }],
      })

      const result = await service.getContact('people/c5')

      expect(result.displayName).toBe('First Last')
    })
  })
})
