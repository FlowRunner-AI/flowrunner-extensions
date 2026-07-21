'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'

const OAUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_BASE = 'https://graph.microsoft.com/v1.0'

describe('Microsoft Entra ID Service', () => {
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })
  })

  // ── OAuth Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns authorization URL with correct parameters', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`${OAUTH_BASE}/authorize`)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('response_mode=query')
      expect(url).toContain('scope=')
      expect(url).toContain('openid')
      expect(url).toContain('offline_access')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for tokens and fetches user profile', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      mock.onGet(`${API_BASE}/me`).reply({
        displayName: 'Test User',
        mail: 'test@contoso.com',
        userPrincipalName: 'test@contoso.com',
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://example.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
        connectionIdentityName: 'test@contoso.com (Test User)',
        overwrite: true,
        userData: expect.objectContaining({ displayName: 'Test User' }),
      })

      // Verify token request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${OAUTH_BASE}/token`)
      const tokenBody = mock.history[0].body
      expect(tokenBody).toContain(`client_id=${CLIENT_ID}`)
      expect(tokenBody).toContain('code=auth-code')
      expect(tokenBody).toContain('grant_type=authorization_code')
      expect(tokenBody).toContain(`client_secret=${CLIENT_SECRET}`)
      expect(tokenBody).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback')
    })

    it('handles user profile fetch failure gracefully', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      mock.onGet(`${API_BASE}/me`).replyWithError({ message: 'Forbidden' })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://example.com/callback',
      })

      expect(result.token).toBe('new-access-token')
      expect(result.refreshToken).toBe('new-refresh-token')
      // Identity name falls back when user data fetch fails
      expect(result.connectionIdentityName).toBe('Microsoft Entra ID Connection')
    })
  })

  describe('refreshToken', () => {
    it('sends refresh token request and returns new tokens', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'refreshed-access-token',
        refresh_token: 'refreshed-refresh-token',
        expires_in: 7200,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-access-token',
        refreshToken: 'refreshed-refresh-token',
        expirationInSeconds: 7200,
      })

      const body = mock.history[0].body
      expect(body).toContain(`client_id=${CLIENT_ID}`)
      expect(body).toContain('refresh_token=old-refresh-token')
      expect(body).toContain('grant_type=refresh_token')
      expect(body).toContain(`client_secret=${CLIENT_SECRET}`)
    })

    it('throws on API error', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).replyWithError({ message: 'Invalid grant' })

      await expect(service.refreshToken('bad-token')).rejects.toThrow()
    })
  })

  // ── Dictionary Methods ──

  describe('getUsersDictionary', () => {
    it('returns users with correct shape', async () => {
      mock.onGet(`${API_BASE}/users`).reply({
        value: [
          { id: 'user-1', displayName: 'Adele Vance', userPrincipalName: 'adele@contoso.com' },
        ],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?$skiptoken=abc',
      })

      const result = await service.getUsersDictionary({})

      expect(result).toEqual({
        cursor: 'https://graph.microsoft.com/v1.0/users?$skiptoken=abc',
        items: [
          { label: 'Adele Vance', value: 'user-1', note: 'adele@contoso.com' },
        ],
      })

      expect(mock.history[0].query).toMatchObject({
        $top: 25,
        $select: 'id,displayName,userPrincipalName',
      })
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })

    it('applies search with ConsistencyLevel header', async () => {
      mock.onGet(`${API_BASE}/users`).reply({ value: [] })

      await service.getUsersDictionary({ search: 'John' })

      expect(mock.history[0].query).toMatchObject({
        $search: '"displayName:John"',
      })
      expect(mock.history[0].headers).toMatchObject({
        ConsistencyLevel: 'eventual',
      })
    })

    it('uses cursor URL directly when provided', async () => {
      const cursorUrl = 'https://graph.microsoft.com/v1.0/users?$skiptoken=abc'
      mock.onGet(cursorUrl).reply({ value: [] })

      await service.getUsersDictionary({ cursor: cursorUrl })

      expect(mock.history[0].url).toBe(cursorUrl)
    })

    it('returns null cursor when no nextLink', async () => {
      mock.onGet(`${API_BASE}/users`).reply({ value: [] })

      const result = await service.getUsersDictionary({})

      expect(result.cursor).toBeNull()
    })

    it('handles null payload', async () => {
      mock.onGet(`${API_BASE}/users`).reply({ value: [] })

      const result = await service.getUsersDictionary(null)

      expect(result).toEqual({ cursor: null, items: [] })
    })
  })

  describe('getGroupsDictionary', () => {
    it('returns groups with correct shape', async () => {
      mock.onGet(`${API_BASE}/groups`).reply({
        value: [
          { id: 'group-1', displayName: 'Library Assist', mail: 'library@contoso.com' },
        ],
      })

      const result = await service.getGroupsDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Library Assist', value: 'group-1', note: 'library@contoso.com' },
        ],
      })

      expect(mock.history[0].query).toMatchObject({
        $top: 25,
        $select: 'id,displayName,mail',
      })
    })

    it('applies search with ConsistencyLevel header', async () => {
      mock.onGet(`${API_BASE}/groups`).reply({ value: [] })

      await service.getGroupsDictionary({ search: 'Sales' })

      expect(mock.history[0].query).toMatchObject({
        $search: '"displayName:Sales"',
      })
      expect(mock.history[0].headers).toMatchObject({
        ConsistencyLevel: 'eventual',
      })
    })

    it('falls back to ID when displayName and mail are missing', async () => {
      mock.onGet(`${API_BASE}/groups`).reply({
        value: [{ id: 'group-x', displayName: null, mail: null }],
      })

      const result = await service.getGroupsDictionary({})

      expect(result.items[0]).toEqual({
        label: 'group-x',
        value: 'group-x',
        note: 'ID: group-x',
      })
    })
  })

  // ── Directory Methods ──

  describe('getMyProfile', () => {
    it('sends GET to /me with auth header', async () => {
      const profile = { id: 'user-1', displayName: 'Test User', mail: 'test@contoso.com' }
      mock.onGet(`${API_BASE}/me`).reply(profile)

      const result = await service.getMyProfile()

      expect(result).toEqual(profile)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })
  })

  // ── User Methods ──

  describe('listUsers', () => {
    it('sends request with default parameters', async () => {
      mock.onGet(`${API_BASE}/users`).reply({ value: [] })

      await service.listUsers()

      expect(mock.history[0].url).toBe(`${API_BASE}/users`)
      expect(mock.history[0].query).toMatchObject({ $top: 25 })
    })

    it('passes filter and select parameters', async () => {
      mock.onGet(`${API_BASE}/users`).reply({ value: [] })

      await service.listUsers('accountEnabled eq true', undefined, 'id,displayName', 10)

      expect(mock.history[0].query).toMatchObject({
        $filter: 'accountEnabled eq true',
        $select: 'id,displayName',
        $top: 10,
      })
    })

    it('caps top at 999', async () => {
      mock.onGet(`${API_BASE}/users`).reply({ value: [] })

      await service.listUsers(undefined, undefined, undefined, 5000)

      expect(mock.history[0].query).toMatchObject({ $top: 999 })
    })

    it('applies search with ConsistencyLevel header', async () => {
      mock.onGet(`${API_BASE}/users`).reply({ value: [] })

      await service.listUsers(undefined, 'John')

      expect(mock.history[0].query).toMatchObject({
        $search: '"displayName:John"',
      })
      expect(mock.history[0].headers).toMatchObject({
        ConsistencyLevel: 'eventual',
      })
    })

    it('passes raw search containing colon as-is', async () => {
      mock.onGet(`${API_BASE}/users`).reply({ value: [] })

      await service.listUsers(undefined, '"mail:test@contoso.com"')

      expect(mock.history[0].query).toMatchObject({
        $search: '"mail:test@contoso.com"',
      })
    })

    it('uses nextLink URL directly and ignores other params', async () => {
      const nextLink = 'https://graph.microsoft.com/v1.0/users?$skiptoken=xyz'
      mock.onGet(nextLink).reply({ value: [] })

      await service.listUsers('ignored-filter', 'ignored-search', 'ignored', 100, nextLink)

      expect(mock.history[0].url).toBe(nextLink)
    })
  })

  describe('getUser', () => {
    it('sends GET to /users/{userId}', async () => {
      mock.onGet(`${API_BASE}/users/user-1`).reply({ id: 'user-1', displayName: 'User' })

      const result = await service.getUser('user-1')

      expect(result).toEqual({ id: 'user-1', displayName: 'User' })
    })

    it('passes select query parameter', async () => {
      mock.onGet(`${API_BASE}/users/user-1`).reply({ id: 'user-1' })

      await service.getUser('user-1', 'id,displayName')

      expect(mock.history[0].query).toMatchObject({ $select: 'id,displayName' })
    })

    it('throws when userId is missing', async () => {
      await expect(service.getUser()).rejects.toThrow('Parameter "User" is required')
    })

    it('throws on API error', async () => {
      mock.onGet(`${API_BASE}/users/bad-id`).replyWithError({
        message: 'Not Found',
        body: { error: { code: 'Request_ResourceNotFound', message: 'Resource not found' } },
      })

      await expect(service.getUser('bad-id')).rejects.toThrow('Microsoft Entra ID API error')
    })
  })

  describe('createUser', () => {
    it('sends POST with all required fields', async () => {
      mock.onPost(`${API_BASE}/users`).reply({ id: 'new-user', displayName: 'Adele Vance' })

      const result = await service.createUser('Adele Vance', 'AdeleV', 'AdeleV@contoso.com', 'P@ssw0rd!')

      expect(result).toEqual({ id: 'new-user', displayName: 'Adele Vance' })
      expect(mock.history[0].body).toEqual({
        accountEnabled: true,
        displayName: 'Adele Vance',
        mailNickname: 'AdeleV',
        userPrincipalName: 'AdeleV@contoso.com',
        passwordProfile: {
          password: 'P@ssw0rd!',
          forceChangePasswordNextSignIn: true,
        },
      })
    })

    it('respects explicit accountEnabled and forceChangePasswordNextSignIn', async () => {
      mock.onPost(`${API_BASE}/users`).reply({ id: 'new-user' })

      await service.createUser('User', 'user', 'user@contoso.com', 'pass', false, false)

      expect(mock.history[0].body).toMatchObject({
        accountEnabled: false,
        passwordProfile: {
          forceChangePasswordNextSignIn: false,
        },
      })
    })

    it('throws when displayName is missing', async () => {
      await expect(service.createUser(null, 'nick', 'upn@c.com', 'pass'))
        .rejects.toThrow('Parameter "Display Name" is required')
    })

    it('throws when mailNickname is missing', async () => {
      await expect(service.createUser('Name', null, 'upn@c.com', 'pass'))
        .rejects.toThrow('Parameter "Mail Nickname" is required')
    })

    it('throws when userPrincipalName is missing', async () => {
      await expect(service.createUser('Name', 'nick', null, 'pass'))
        .rejects.toThrow('Parameter "User Principal Name" is required')
    })

    it('throws when password is missing', async () => {
      await expect(service.createUser('Name', 'nick', 'upn@c.com', null))
        .rejects.toThrow('Parameter "Password" is required')
    })
  })

  describe('updateUser', () => {
    it('sends PATCH with provided fields and returns confirmation', async () => {
      mock.onPatch(`${API_BASE}/users/user-1`).reply('')

      const result = await service.updateUser('user-1', 'New Name', 'Engineer')

      expect(result).toEqual({ message: 'User updated successfully', userId: 'user-1' })
      expect(mock.history[0].body).toEqual({
        displayName: 'New Name',
        jobTitle: 'Engineer',
      })
    })

    it('omits undefined optional fields', async () => {
      mock.onPatch(`${API_BASE}/users/user-1`).reply('')

      await service.updateUser('user-1', undefined, undefined, 'Sales')

      expect(mock.history[0].body).toEqual({ department: 'Sales' })
    })

    it('throws when userId is missing', async () => {
      await expect(service.updateUser(null, 'Name')).rejects.toThrow('Parameter "User" is required')
    })

    it('throws when no properties to update', async () => {
      await expect(service.updateUser('user-1')).rejects.toThrow('Provide at least one property to update')
    })
  })

  describe('deleteUser', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${API_BASE}/users/user-1`).reply('')

      const result = await service.deleteUser('user-1')

      expect(result).toEqual({ message: 'User deleted successfully', userId: 'user-1' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws when userId is missing', async () => {
      await expect(service.deleteUser()).rejects.toThrow('Parameter "User" is required')
    })
  })

  describe('resetUserPassword', () => {
    it('sends PATCH with password profile', async () => {
      mock.onPatch(`${API_BASE}/users/user-1`).reply('')

      const result = await service.resetUserPassword('user-1', 'NewP@ss!')

      expect(result).toEqual({ message: 'Password reset successfully', userId: 'user-1' })
      expect(mock.history[0].body).toEqual({
        passwordProfile: {
          password: 'NewP@ss!',
          forceChangePasswordNextSignIn: true,
        },
      })
    })

    it('respects explicit forceChangePasswordNextSignIn=false', async () => {
      mock.onPatch(`${API_BASE}/users/user-1`).reply('')

      await service.resetUserPassword('user-1', 'NewP@ss!', false)

      expect(mock.history[0].body.passwordProfile.forceChangePasswordNextSignIn).toBe(false)
    })

    it('throws when userId is missing', async () => {
      await expect(service.resetUserPassword(null, 'pass')).rejects.toThrow('Parameter "User" is required')
    })

    it('throws when password is missing', async () => {
      await expect(service.resetUserPassword('user-1')).rejects.toThrow('Parameter "New Password" is required')
    })
  })

  describe('revokeSignInSessions', () => {
    it('sends POST and returns result', async () => {
      mock.onPost(`${API_BASE}/users/user-1/revokeSignInSessions`).reply({ value: true })

      const result = await service.revokeSignInSessions('user-1')

      expect(result).toEqual({ value: true })
      expect(mock.history[0].method).toBe('post')
    })

    it('throws when userId is missing', async () => {
      await expect(service.revokeSignInSessions()).rejects.toThrow('Parameter "User" is required')
    })
  })

  describe('listUserGroups', () => {
    it('sends GET to /users/{userId}/memberOf', async () => {
      mock.onGet(`${API_BASE}/users/user-1/memberOf`).reply({
        value: [{ id: 'group-1', displayName: 'Group A' }],
      })

      const result = await service.listUserGroups('user-1')

      expect(result.value).toHaveLength(1)
    })

    it('uses nextLink URL directly', async () => {
      const nextLink = 'https://graph.microsoft.com/v1.0/users/user-1/memberOf?$skiptoken=x'
      mock.onGet(nextLink).reply({ value: [] })

      await service.listUserGroups('ignored', nextLink)

      expect(mock.history[0].url).toBe(nextLink)
    })

    it('throws when userId is missing and no nextLink', async () => {
      await expect(service.listUserGroups()).rejects.toThrow('Parameter "User" is required')
    })
  })

  // ── Group Methods ──

  describe('listGroups', () => {
    it('sends request with default parameters', async () => {
      mock.onGet(`${API_BASE}/groups`).reply({ value: [] })

      await service.listGroups()

      expect(mock.history[0].query).toMatchObject({ $top: 25 })
    })

    it('passes filter and caps top at 999', async () => {
      mock.onGet(`${API_BASE}/groups`).reply({ value: [] })

      await service.listGroups('securityEnabled eq true', undefined, undefined, 2000)

      expect(mock.history[0].query).toMatchObject({
        $filter: 'securityEnabled eq true',
        $top: 999,
      })
    })

    it('applies search with ConsistencyLevel header', async () => {
      mock.onGet(`${API_BASE}/groups`).reply({ value: [] })

      await service.listGroups(undefined, 'Sales')

      expect(mock.history[0].query).toMatchObject({ $search: '"displayName:Sales"' })
      expect(mock.history[0].headers).toMatchObject({ ConsistencyLevel: 'eventual' })
    })

    it('uses nextLink URL directly', async () => {
      const nextLink = 'https://graph.microsoft.com/v1.0/groups?$skiptoken=abc'
      mock.onGet(nextLink).reply({ value: [] })

      await service.listGroups('ignored', 'ignored', 'ignored', 100, nextLink)

      expect(mock.history[0].url).toBe(nextLink)
    })
  })

  describe('getGroup', () => {
    it('sends GET to /groups/{groupId}', async () => {
      mock.onGet(`${API_BASE}/groups/group-1`).reply({ id: 'group-1', displayName: 'Group' })

      const result = await service.getGroup('group-1')

      expect(result).toEqual({ id: 'group-1', displayName: 'Group' })
    })

    it('passes select query parameter', async () => {
      mock.onGet(`${API_BASE}/groups/group-1`).reply({ id: 'group-1' })

      await service.getGroup('group-1', 'id,displayName')

      expect(mock.history[0].query).toMatchObject({ $select: 'id,displayName' })
    })

    it('throws when groupId is missing', async () => {
      await expect(service.getGroup()).rejects.toThrow('Parameter "Group" is required')
    })
  })

  describe('createGroup', () => {
    it('creates a security group by default', async () => {
      mock.onPost(`${API_BASE}/groups`).reply({ id: 'new-group' })

      await service.createGroup('My Group', 'mygroup', 'Security')

      expect(mock.history[0].body).toEqual({
        displayName: 'My Group',
        mailNickname: 'mygroup',
        groupTypes: [],
        mailEnabled: false,
        securityEnabled: true,
      })
    })

    it('creates a Microsoft 365 (unified) group', async () => {
      mock.onPost(`${API_BASE}/groups`).reply({ id: 'new-group' })

      await service.createGroup('M365 Group', 'm365', 'Microsoft 365', 'A description')

      expect(mock.history[0].body).toEqual({
        displayName: 'M365 Group',
        mailNickname: 'm365',
        description: 'A description',
        groupTypes: ['Unified'],
        mailEnabled: true,
        securityEnabled: false,
      })
    })

    it('throws when displayName is missing', async () => {
      await expect(service.createGroup(null, 'nick'))
        .rejects.toThrow('Parameter "Display Name" is required')
    })

    it('throws when mailNickname is missing', async () => {
      await expect(service.createGroup('Name', null))
        .rejects.toThrow('Parameter "Mail Nickname" is required')
    })
  })

  describe('updateGroup', () => {
    it('sends PATCH with provided fields', async () => {
      mock.onPatch(`${API_BASE}/groups/group-1`).reply('')

      const result = await service.updateGroup('group-1', 'Updated Name', 'New desc')

      expect(result).toEqual({ message: 'Group updated successfully', groupId: 'group-1' })
      expect(mock.history[0].body).toEqual({
        displayName: 'Updated Name',
        description: 'New desc',
      })
    })

    it('throws when groupId is missing', async () => {
      await expect(service.updateGroup(null, 'Name')).rejects.toThrow('Parameter "Group" is required')
    })

    it('throws when no properties to update', async () => {
      await expect(service.updateGroup('group-1')).rejects.toThrow('Provide at least one property to update')
    })
  })

  describe('deleteGroup', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${API_BASE}/groups/group-1`).reply('')

      const result = await service.deleteGroup('group-1')

      expect(result).toEqual({ message: 'Group deleted successfully', groupId: 'group-1' })
    })

    it('throws when groupId is missing', async () => {
      await expect(service.deleteGroup()).rejects.toThrow('Parameter "Group" is required')
    })
  })

  describe('listGroupMembers', () => {
    it('sends GET to /groups/{groupId}/members', async () => {
      mock.onGet(`${API_BASE}/groups/group-1/members`).reply({
        value: [{ id: 'user-1', displayName: 'Adele' }],
      })

      const result = await service.listGroupMembers('group-1')

      expect(result.value).toHaveLength(1)
    })

    it('uses nextLink URL directly', async () => {
      const nextLink = 'https://graph.microsoft.com/v1.0/groups/group-1/members?$skiptoken=x'
      mock.onGet(nextLink).reply({ value: [] })

      await service.listGroupMembers('ignored', nextLink)

      expect(mock.history[0].url).toBe(nextLink)
    })

    it('throws when groupId is missing and no nextLink', async () => {
      await expect(service.listGroupMembers()).rejects.toThrow('Parameter "Group" is required')
    })
  })

  describe('addGroupMember', () => {
    it('sends POST with @odata.id reference', async () => {
      mock.onPost(`${API_BASE}/groups/group-1/members/$ref`).reply('')

      const result = await service.addGroupMember('group-1', 'user-1')

      expect(result).toEqual({
        message: 'Member added successfully',
        groupId: 'group-1',
        userId: 'user-1',
      })
      expect(mock.history[0].body).toEqual({
        '@odata.id': `${API_BASE}/directoryObjects/user-1`,
      })
    })

    it('throws when groupId is missing', async () => {
      await expect(service.addGroupMember(null, 'user-1')).rejects.toThrow('Parameter "Group" is required')
    })

    it('throws when userId is missing', async () => {
      await expect(service.addGroupMember('group-1')).rejects.toThrow('Parameter "User" is required')
    })
  })

  describe('removeGroupMember', () => {
    it('sends DELETE with correct URL', async () => {
      mock.onDelete(`${API_BASE}/groups/group-1/members/user-1/$ref`).reply('')

      const result = await service.removeGroupMember('group-1', 'user-1')

      expect(result).toEqual({
        message: 'Member removed successfully',
        groupId: 'group-1',
        userId: 'user-1',
      })
    })

    it('throws when groupId is missing', async () => {
      await expect(service.removeGroupMember(null, 'user-1')).rejects.toThrow('Parameter "Group" is required')
    })

    it('throws when userId is missing', async () => {
      await expect(service.removeGroupMember('group-1')).rejects.toThrow('Parameter "User" is required')
    })
  })

  describe('addGroupOwner', () => {
    it('sends POST with @odata.id user reference', async () => {
      mock.onPost(`${API_BASE}/groups/group-1/owners/$ref`).reply('')

      const result = await service.addGroupOwner('group-1', 'user-1')

      expect(result).toEqual({
        message: 'Owner added successfully',
        groupId: 'group-1',
        userId: 'user-1',
      })
      expect(mock.history[0].body).toEqual({
        '@odata.id': `${API_BASE}/users/user-1`,
      })
    })

    it('throws when groupId is missing', async () => {
      await expect(service.addGroupOwner(null, 'user-1')).rejects.toThrow('Parameter "Group" is required')
    })

    it('throws when userId is missing', async () => {
      await expect(service.addGroupOwner('group-1')).rejects.toThrow('Parameter "User" is required')
    })
  })

  // ── Directory Roles ──

  describe('listDirectoryRoles', () => {
    it('sends GET to /directoryRoles', async () => {
      mock.onGet(`${API_BASE}/directoryRoles`).reply({
        value: [{ id: 'role-1', displayName: 'Global Administrator' }],
      })

      const result = await service.listDirectoryRoles()

      expect(result.value).toHaveLength(1)
      expect(result.value[0].displayName).toBe('Global Administrator')
    })
  })

  describe('listDirectoryRoleMembers', () => {
    it('sends GET to /directoryRoles/{roleId}/members', async () => {
      mock.onGet(`${API_BASE}/directoryRoles/role-1/members`).reply({
        value: [{ id: 'user-1' }],
      })

      const result = await service.listDirectoryRoleMembers('role-1')

      expect(result.value).toHaveLength(1)
    })

    it('uses nextLink URL directly', async () => {
      const nextLink = 'https://graph.microsoft.com/v1.0/directoryRoles/role-1/members?$skiptoken=x'
      mock.onGet(nextLink).reply({ value: [] })

      await service.listDirectoryRoleMembers('ignored', nextLink)

      expect(mock.history[0].url).toBe(nextLink)
    })

    it('throws when roleId is missing and no nextLink', async () => {
      await expect(service.listDirectoryRoleMembers()).rejects.toThrow('Parameter "Role ID" is required')
    })
  })

  // ── Invitations ──

  describe('inviteGuestUser', () => {
    it('sends POST with invitation body', async () => {
      mock.onPost(`${API_BASE}/invitations`).reply({
        id: 'inv-1',
        invitedUserEmailAddress: 'guest@external.com',
        status: 'PendingAcceptance',
      })

      const result = await service.inviteGuestUser(
        'guest@external.com',
        'https://myapps.microsoft.com',
        'Guest User',
      )

      expect(result.status).toBe('PendingAcceptance')
      expect(mock.history[0].body).toEqual({
        invitedUserEmailAddress: 'guest@external.com',
        inviteRedirectUrl: 'https://myapps.microsoft.com',
        invitedUserDisplayName: 'Guest User',
        sendInvitationMessage: true,
      })
    })

    it('respects explicit sendInvitationMessage=false', async () => {
      mock.onPost(`${API_BASE}/invitations`).reply({ id: 'inv-1' })

      await service.inviteGuestUser('guest@external.com', 'https://example.com', undefined, false)

      expect(mock.history[0].body).toMatchObject({
        sendInvitationMessage: false,
      })
      // invitedUserDisplayName should be omitted when undefined
      expect(mock.history[0].body).not.toHaveProperty('invitedUserDisplayName')
    })

    it('throws when email is missing', async () => {
      await expect(service.inviteGuestUser(null, 'https://example.com'))
        .rejects.toThrow('Parameter "Guest Email" is required')
    })

    it('throws when redirectUrl is missing', async () => {
      await expect(service.inviteGuestUser('guest@external.com'))
        .rejects.toThrow('Parameter "Redirect URL" is required')
    })
  })

  // ── Applications ──

  describe('listApplications', () => {
    it('sends GET to /applications with defaults', async () => {
      mock.onGet(`${API_BASE}/applications`).reply({ value: [] })

      await service.listApplications()

      expect(mock.history[0].query).toMatchObject({ $top: 25 })
    })

    it('passes filter and top', async () => {
      mock.onGet(`${API_BASE}/applications`).reply({ value: [] })

      await service.listApplications("startsWith(displayName,'Contoso')", 10)

      expect(mock.history[0].query).toMatchObject({
        $filter: "startsWith(displayName,'Contoso')",
        $top: 10,
      })
    })

    it('caps top at 999', async () => {
      mock.onGet(`${API_BASE}/applications`).reply({ value: [] })

      await service.listApplications(undefined, 5000)

      expect(mock.history[0].query).toMatchObject({ $top: 999 })
    })

    it('uses nextLink URL directly', async () => {
      const nextLink = 'https://graph.microsoft.com/v1.0/applications?$skiptoken=abc'
      mock.onGet(nextLink).reply({ value: [] })

      await service.listApplications('ignored', 100, nextLink)

      expect(mock.history[0].url).toBe(nextLink)
    })
  })

  describe('listServicePrincipals', () => {
    it('sends GET to /servicePrincipals with defaults', async () => {
      mock.onGet(`${API_BASE}/servicePrincipals`).reply({ value: [] })

      await service.listServicePrincipals()

      expect(mock.history[0].query).toMatchObject({ $top: 25 })
    })

    it('passes filter and top', async () => {
      mock.onGet(`${API_BASE}/servicePrincipals`).reply({ value: [] })

      await service.listServicePrincipals("startsWith(displayName,'App')", 50)

      expect(mock.history[0].query).toMatchObject({
        $filter: "startsWith(displayName,'App')",
        $top: 50,
      })
    })

    it('uses nextLink URL directly', async () => {
      const nextLink = 'https://graph.microsoft.com/v1.0/servicePrincipals?$skiptoken=abc'
      mock.onGet(nextLink).reply({ value: [] })

      await service.listServicePrincipals('ignored', 100, nextLink)

      expect(mock.history[0].url).toBe(nextLink)
    })
  })
})
