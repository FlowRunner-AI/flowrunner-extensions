'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const BASE = 'https://admin.googleapis.com/admin/directory/v1'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USER_INFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

describe('Google Workspace Admin Service', () => {
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
    it('returns a correctly formed OAuth URL', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth')
      expect(url).toContain(`client_id=${encodeURIComponent(CLIENT_ID)}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('access_type=offline')
      expect(url).toContain('prompt=consent')
      expect(url).toContain('scope=')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches user info', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      })

      mock.onGet(USER_INFO_URL).reply({
        name: 'Test User',
        email: 'test@example.com',
        picture: 'https://example.com/photo.jpg',
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://redirect.example.com',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        expirationInSeconds: 3600,
        refreshToken: 'new-refresh-token',
        connectionIdentityName: 'Test User (test@example.com)',
        connectionIdentityImageURL: 'https://example.com/photo.jpg',
        overwrite: true,
        userData: {
          name: 'Test User',
          email: 'test@example.com',
          picture: 'https://example.com/photo.jpg',
        },
      })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(TOKEN_URL)
    })

    it('handles missing user name gracefully', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'token-abc',
        expires_in: 3600,
        refresh_token: 'refresh-abc',
      })

      mock.onGet(USER_INFO_URL).reply({
        email: 'noname@example.com',
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://redirect.example.com',
      })

      expect(result.connectionIdentityName).toBe('noname@example.com')
      expect(result.connectionIdentityImageURL).toBeNull()
    })

    it('falls back to default identity when user info fails', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'token-xyz',
        expires_in: 3600,
        refresh_token: 'refresh-xyz',
      })

      mock.onGet(USER_INFO_URL).replyWithError({ message: 'Unauthorized' })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://redirect.example.com',
      })

      expect(result.connectionIdentityName).toBe('Google Workspace Admin Account')
      expect(result.connectionIdentityImageURL).toBeNull()
    })
  })

  describe('refreshToken', () => {
    it('refreshes the access token', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        expirationInSeconds: 3600,
      })

      expect(mock.history[0].query).toMatchObject({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: 'old-refresh-token',
      })
    })

    it('throws a clear message on invalid_grant error', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'invalid_grant',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken('expired-token')).rejects.toThrow(
        'Refresh token expired or invalid, please re-authenticate.'
      )
    })
  })

  // ── Dictionaries ──

  describe('getUsersDictionary', () => {
    it('returns formatted user items', async () => {
      mock.onGet(`${BASE}/users`).reply({
        users: [
          { name: { fullName: 'Liz Smith' }, primaryEmail: 'liz@example.com' },
          { primaryEmail: 'noname@example.com' },
        ],
        nextPageToken: 'token123',
      })

      const result = await service.getUsersDictionary({})

      expect(result.cursor).toBe('token123')
      expect(result.items).toEqual([
        { label: 'Liz Smith', note: 'liz@example.com', value: 'liz@example.com' },
        { label: 'noname@example.com', note: 'noname@example.com', value: 'noname@example.com' },
      ])

      expect(mock.history[0].query).toMatchObject({
        customer: 'my_customer',
        maxResults: 50,
        orderBy: 'email',
      })
    })

    it('applies search query when search is provided', async () => {
      mock.onGet(`${BASE}/users`).reply({ users: [], nextPageToken: undefined })

      await service.getUsersDictionary({ search: 'liz' })

      expect(mock.history[0].query).toMatchObject({
        query: 'name:liz* email:liz*',
      })
    })

    it('handles empty response', async () => {
      mock.onGet(`${BASE}/users`).reply({})

      const result = await service.getUsersDictionary({})

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })

    it('passes cursor as pageToken', async () => {
      mock.onGet(`${BASE}/users`).reply({ users: [] })

      await service.getUsersDictionary({ cursor: 'page2' })

      expect(mock.history[0].query).toMatchObject({ pageToken: 'page2' })
    })
  })

  describe('getGroupsDictionary', () => {
    it('returns formatted group items', async () => {
      mock.onGet(`${BASE}/groups`).reply({
        groups: [
          { name: 'Sales Team', email: 'sales@example.com' },
          { email: 'unnamed@example.com' },
        ],
        nextPageToken: 'grpToken',
      })

      const result = await service.getGroupsDictionary({})

      expect(result.cursor).toBe('grpToken')
      expect(result.items).toEqual([
        { label: 'Sales Team', note: 'sales@example.com', value: 'sales@example.com' },
        { label: 'unnamed@example.com', note: 'unnamed@example.com', value: 'unnamed@example.com' },
      ])
    })

    it('filters groups locally by search string', async () => {
      mock.onGet(`${BASE}/groups`).reply({
        groups: [
          { name: 'Sales Team', email: 'sales@example.com' },
          { name: 'Engineering', email: 'eng@example.com' },
        ],
      })

      const result = await service.getGroupsDictionary({ search: 'eng' })

      expect(result.items).toEqual([
        { label: 'Engineering', note: 'eng@example.com', value: 'eng@example.com' },
      ])
    })

    it('handles empty groups response', async () => {
      mock.onGet(`${BASE}/groups`).reply({})

      const result = await service.getGroupsDictionary({})

      expect(result.items).toEqual([])
    })
  })

  // ── Users ──

  describe('listUsers', () => {
    it('sends correct defaults', async () => {
      mock.onGet(`${BASE}/users`).reply({ users: [] })

      await service.listUsers()

      expect(mock.history[0].query).toMatchObject({
        customer: 'my_customer',
        maxResults: 100,
      })
    })

    it('passes all parameters', async () => {
      mock.onGet(`${BASE}/users`).reply({ users: [] })

      await service.listUsers('example.com', 'email:sales*', 50, 'Family Name', 'Descending', true, 'pageT')

      expect(mock.history[0].query).toMatchObject({
        customer: 'my_customer',
        domain: 'example.com',
        query: 'email:sales*',
        maxResults: 50,
        orderBy: 'FAMILY_NAME',
        sortOrder: 'DESCENDING',
        showDeleted: 'true',
        pageToken: 'pageT',
      })
    })

    it('caps maxResults at 500', async () => {
      mock.onGet(`${BASE}/users`).reply({ users: [] })

      await service.listUsers(undefined, undefined, 1000)

      expect(mock.history[0].query.maxResults).toBe(500)
    })

    it('sends auth header', async () => {
      mock.onGet(`${BASE}/users`).reply({ users: [] })

      await service.listUsers()

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })
  })

  describe('getUser', () => {
    it('fetches a user by key', async () => {
      const userData = { id: '123', primaryEmail: 'liz@example.com' }

      mock.onGet(`${BASE}/users/liz%40example.com`).reply(userData)

      const result = await service.getUser('liz@example.com')

      expect(result).toEqual(userData)
    })

    it('throws when userKey is missing', async () => {
      await expect(service.getUser()).rejects.toThrow('Parameter "User" is required')
    })
  })

  describe('createUser', () => {
    it('sends correct body with required fields', async () => {
      mock.onPost(`${BASE}/users`).reply({ id: '123', primaryEmail: 'liz@example.com' })

      await service.createUser('liz@example.com', 'Liz', 'Smith', 'password123')

      expect(mock.history[0].body).toEqual({
        primaryEmail: 'liz@example.com',
        name: { givenName: 'Liz', familyName: 'Smith' },
        password: 'password123',
      })
    })

    it('includes optional fields when provided', async () => {
      mock.onPost(`${BASE}/users`).reply({ id: '123' })

      await service.createUser('liz@example.com', 'Liz', 'Smith', 'pw123', '/Sales', true)

      expect(mock.history[0].body).toMatchObject({
        orgUnitPath: '/Sales',
        changePasswordAtNextLogin: true,
      })
    })

    it('throws when required params are missing', async () => {
      await expect(service.createUser()).rejects.toThrow('Parameter "Primary Email" is required')
      await expect(service.createUser('a@b.com')).rejects.toThrow('Parameter "Given Name" is required')
      await expect(service.createUser('a@b.com', 'A')).rejects.toThrow('Parameter "Family Name" is required')
      await expect(service.createUser('a@b.com', 'A', 'B')).rejects.toThrow('Parameter "Password" is required')
    })
  })

  describe('updateUser', () => {
    it('sends only provided fields', async () => {
      mock.onPut(`${BASE}/users/liz%40example.com`).reply({ id: '123' })

      await service.updateUser('liz@example.com', undefined, 'Elizabeth')

      expect(mock.history[0].body).toEqual({
        name: { givenName: 'Elizabeth' },
      })
    })

    it('includes primaryEmail and password when provided', async () => {
      mock.onPut(`${BASE}/users/liz%40example.com`).reply({ id: '123' })

      await service.updateUser('liz@example.com', 'new@example.com', undefined, undefined, 'newpw')

      expect(mock.history[0].body).toEqual({
        primaryEmail: 'new@example.com',
        password: 'newpw',
      })
    })

    it('throws when userKey is missing', async () => {
      await expect(service.updateUser()).rejects.toThrow('Parameter "User" is required')
    })

    it('throws when no fields to update', async () => {
      await expect(service.updateUser('liz@example.com')).rejects.toThrow(
        'Provide at least one property to update'
      )
    })
  })

  describe('deleteUser', () => {
    it('deletes user and returns confirmation', async () => {
      mock.onDelete(`${BASE}/users/liz%40example.com`).reply({})

      const result = await service.deleteUser('liz@example.com')

      expect(result).toEqual({ message: 'User deleted successfully', userKey: 'liz@example.com' })
    })

    it('throws when userKey is missing', async () => {
      await expect(service.deleteUser()).rejects.toThrow('Parameter "User" is required')
    })
  })

  describe('suspendUser', () => {
    it('sends suspended: true', async () => {
      mock.onPatch(`${BASE}/users/liz%40example.com`).reply({ suspended: true })

      const result = await service.suspendUser('liz@example.com')

      expect(mock.history[0].body).toEqual({ suspended: true })
      expect(result).toMatchObject({ suspended: true })
    })

    it('throws when userKey is missing', async () => {
      await expect(service.suspendUser()).rejects.toThrow('Parameter "User" is required')
    })
  })

  describe('unsuspendUser', () => {
    it('sends suspended: false', async () => {
      mock.onPatch(`${BASE}/users/liz%40example.com`).reply({ suspended: false })

      await service.unsuspendUser('liz@example.com')

      expect(mock.history[0].body).toEqual({ suspended: false })
    })

    it('throws when userKey is missing', async () => {
      await expect(service.unsuspendUser()).rejects.toThrow('Parameter "User" is required')
    })
  })

  describe('undeleteUser', () => {
    it('sends undelete request with default orgUnitPath', async () => {
      mock.onPost(`${BASE}/users/12345/undelete`).reply({})

      const result = await service.undeleteUser('12345')

      expect(mock.history[0].body).toEqual({ orgUnitPath: '/' })
      expect(result).toEqual({ message: 'User restored successfully', userKey: '12345' })
    })

    it('sends custom orgUnitPath', async () => {
      mock.onPost(`${BASE}/users/12345/undelete`).reply({})

      await service.undeleteUser('12345', '/Sales')

      expect(mock.history[0].body).toEqual({ orgUnitPath: '/Sales' })
    })

    it('throws when userKey is missing', async () => {
      await expect(service.undeleteUser()).rejects.toThrow('Parameter "User ID" is required')
    })
  })

  describe('makeUserAdmin', () => {
    it('grants admin by default', async () => {
      mock.onPost(`${BASE}/users/liz%40example.com/makeAdmin`).reply({})

      const result = await service.makeUserAdmin('liz@example.com')

      expect(mock.history[0].body).toEqual({ status: true })
      expect(result).toEqual({
        message: 'User admin status updated successfully',
        userKey: 'liz@example.com',
        isAdmin: true,
      })
    })

    it('revokes admin when status is false', async () => {
      mock.onPost(`${BASE}/users/liz%40example.com/makeAdmin`).reply({})

      const result = await service.makeUserAdmin('liz@example.com', false)

      expect(mock.history[0].body).toEqual({ status: false })
      expect(result.isAdmin).toBe(false)
    })

    it('throws when userKey is missing', async () => {
      await expect(service.makeUserAdmin()).rejects.toThrow('Parameter "User" is required')
    })
  })

  describe('listUserAliases', () => {
    it('fetches aliases for a user', async () => {
      const aliasData = { aliases: [{ alias: 'alt@example.com' }] }

      mock.onGet(`${BASE}/users/liz%40example.com/aliases`).reply(aliasData)

      const result = await service.listUserAliases('liz@example.com')

      expect(result).toEqual(aliasData)
    })

    it('throws when userKey is missing', async () => {
      await expect(service.listUserAliases()).rejects.toThrow('Parameter "User" is required')
    })
  })

  describe('addUserAlias', () => {
    it('adds an alias', async () => {
      const aliasResp = { alias: 'alt@example.com', primaryEmail: 'liz@example.com' }

      mock.onPost(`${BASE}/users/liz%40example.com/aliases`).reply(aliasResp)

      const result = await service.addUserAlias('liz@example.com', 'alt@example.com')

      expect(mock.history[0].body).toEqual({ alias: 'alt@example.com' })
      expect(result).toEqual(aliasResp)
    })

    it('throws when userKey is missing', async () => {
      await expect(service.addUserAlias()).rejects.toThrow('Parameter "User" is required')
    })

    it('throws when alias is missing', async () => {
      await expect(service.addUserAlias('liz@example.com')).rejects.toThrow('Parameter "Alias" is required')
    })
  })

  // ── Groups ──

  describe('listGroups', () => {
    it('sends correct defaults with customer', async () => {
      mock.onGet(`${BASE}/groups`).reply({ groups: [] })

      await service.listGroups()

      expect(mock.history[0].query).toMatchObject({
        customer: 'my_customer',
        maxResults: 100,
      })
    })

    it('excludes customer when userKey is provided', async () => {
      mock.onGet(`${BASE}/groups`).reply({ groups: [] })

      await service.listGroups(undefined, undefined, 'liz@example.com')

      expect(mock.history[0].query.customer).toBeUndefined()
      expect(mock.history[0].query).toMatchObject({
        userKey: 'liz@example.com',
      })
    })

    it('caps maxResults at 200', async () => {
      mock.onGet(`${BASE}/groups`).reply({ groups: [] })

      await service.listGroups(undefined, undefined, undefined, 500)

      expect(mock.history[0].query.maxResults).toBe(200)
    })

    it('passes all parameters', async () => {
      mock.onGet(`${BASE}/groups`).reply({ groups: [] })

      await service.listGroups('example.com', 'name:Sales', undefined, 50, 'pageT')

      expect(mock.history[0].query).toMatchObject({
        domain: 'example.com',
        query: 'name:Sales',
        maxResults: 50,
        pageToken: 'pageT',
      })
    })
  })

  describe('getGroup', () => {
    it('fetches a group by key', async () => {
      const groupData = { id: 'g1', email: 'sales@example.com' }

      mock.onGet(`${BASE}/groups/sales%40example.com`).reply(groupData)

      const result = await service.getGroup('sales@example.com')

      expect(result).toEqual(groupData)
    })

    it('throws when groupKey is missing', async () => {
      await expect(service.getGroup()).rejects.toThrow('Parameter "Group" is required')
    })
  })

  describe('createGroup', () => {
    it('sends correct body with required fields', async () => {
      mock.onPost(`${BASE}/groups`).reply({ id: 'g1', email: 'sales@example.com' })

      await service.createGroup('sales@example.com')

      expect(mock.history[0].body).toEqual({ email: 'sales@example.com' })
    })

    it('includes optional name and description', async () => {
      mock.onPost(`${BASE}/groups`).reply({ id: 'g1' })

      await service.createGroup('sales@example.com', 'Sales Team', 'The sales group')

      expect(mock.history[0].body).toEqual({
        email: 'sales@example.com',
        name: 'Sales Team',
        description: 'The sales group',
      })
    })

    it('throws when email is missing', async () => {
      await expect(service.createGroup()).rejects.toThrow('Parameter "Email" is required')
    })
  })

  describe('updateGroup', () => {
    it('sends only provided fields', async () => {
      mock.onPut(`${BASE}/groups/sales%40example.com`).reply({ id: 'g1' })

      await service.updateGroup('sales@example.com', undefined, 'New Name')

      expect(mock.history[0].body).toEqual({ name: 'New Name' })
    })

    it('throws when groupKey is missing', async () => {
      await expect(service.updateGroup()).rejects.toThrow('Parameter "Group" is required')
    })

    it('throws when no fields to update', async () => {
      await expect(service.updateGroup('sales@example.com')).rejects.toThrow(
        'Provide at least one property to update'
      )
    })
  })

  describe('deleteGroup', () => {
    it('deletes group and returns confirmation', async () => {
      mock.onDelete(`${BASE}/groups/sales%40example.com`).reply({})

      const result = await service.deleteGroup('sales@example.com')

      expect(result).toEqual({ message: 'Group deleted successfully', groupKey: 'sales@example.com' })
    })

    it('throws when groupKey is missing', async () => {
      await expect(service.deleteGroup()).rejects.toThrow('Parameter "Group" is required')
    })
  })

  // ── Group Members ──

  describe('listGroupMembers', () => {
    it('sends correct defaults', async () => {
      mock.onGet(`${BASE}/groups/sales%40example.com/members`).reply({ members: [] })

      await service.listGroupMembers('sales@example.com')

      expect(mock.history[0].query).toMatchObject({ maxResults: 100 })
    })

    it('resolves role choice', async () => {
      mock.onGet(`${BASE}/groups/sales%40example.com/members`).reply({ members: [] })

      await service.listGroupMembers('sales@example.com', 'Owner', 50, 'pt')

      expect(mock.history[0].query).toMatchObject({
        roles: 'OWNER',
        maxResults: 50,
        pageToken: 'pt',
      })
    })

    it('caps maxResults at 200', async () => {
      mock.onGet(`${BASE}/groups/sales%40example.com/members`).reply({ members: [] })

      await service.listGroupMembers('sales@example.com', undefined, 999)

      expect(mock.history[0].query.maxResults).toBe(200)
    })

    it('throws when groupKey is missing', async () => {
      await expect(service.listGroupMembers()).rejects.toThrow('Parameter "Group" is required')
    })
  })

  describe('getGroupMember', () => {
    it('fetches a member', async () => {
      const memberData = { email: 'liz@example.com', role: 'MEMBER' }

      mock.onGet(`${BASE}/groups/sales%40example.com/members/liz%40example.com`).reply(memberData)

      const result = await service.getGroupMember('sales@example.com', 'liz@example.com')

      expect(result).toEqual(memberData)
    })

    it('throws when groupKey is missing', async () => {
      await expect(service.getGroupMember()).rejects.toThrow('Parameter "Group" is required')
    })

    it('throws when memberKey is missing', async () => {
      await expect(service.getGroupMember('sales@example.com')).rejects.toThrow('Parameter "Member" is required')
    })
  })

  describe('addGroupMember', () => {
    it('adds a member with default role', async () => {
      mock.onPost(`${BASE}/groups/sales%40example.com/members`).reply({ email: 'liz@example.com', role: 'MEMBER' })

      await service.addGroupMember('sales@example.com', 'liz@example.com')

      expect(mock.history[0].body).toEqual({ email: 'liz@example.com', role: 'MEMBER' })
    })

    it('resolves Manager role', async () => {
      mock.onPost(`${BASE}/groups/sales%40example.com/members`).reply({ role: 'MANAGER' })

      await service.addGroupMember('sales@example.com', 'liz@example.com', 'Manager')

      expect(mock.history[0].body).toEqual({ email: 'liz@example.com', role: 'MANAGER' })
    })

    it('throws when groupKey is missing', async () => {
      await expect(service.addGroupMember()).rejects.toThrow('Parameter "Group" is required')
    })

    it('throws when email is missing', async () => {
      await expect(service.addGroupMember('sales@example.com')).rejects.toThrow('Parameter "Email" is required')
    })
  })

  describe('updateGroupMember', () => {
    it('updates member role', async () => {
      mock.onPut(`${BASE}/groups/sales%40example.com/members/liz%40example.com`).reply({ role: 'OWNER' })

      await service.updateGroupMember('sales@example.com', 'liz@example.com', 'Owner')

      expect(mock.history[0].body).toEqual({ email: 'liz@example.com', role: 'OWNER' })
    })

    it('throws when groupKey is missing', async () => {
      await expect(service.updateGroupMember()).rejects.toThrow('Parameter "Group" is required')
    })

    it('throws when memberKey is missing', async () => {
      await expect(service.updateGroupMember('sales@example.com')).rejects.toThrow('Parameter "Member" is required')
    })

    it('throws when role is missing', async () => {
      await expect(service.updateGroupMember('sales@example.com', 'liz@example.com')).rejects.toThrow(
        'Parameter "Role" is required'
      )
    })
  })

  describe('removeGroupMember', () => {
    it('removes member and returns confirmation', async () => {
      mock.onDelete(`${BASE}/groups/sales%40example.com/members/liz%40example.com`).reply({})

      const result = await service.removeGroupMember('sales@example.com', 'liz@example.com')

      expect(result).toEqual({
        message: 'Member removed successfully',
        groupKey: 'sales@example.com',
        memberKey: 'liz@example.com',
      })
    })

    it('throws when groupKey is missing', async () => {
      await expect(service.removeGroupMember()).rejects.toThrow('Parameter "Group" is required')
    })

    it('throws when memberKey is missing', async () => {
      await expect(service.removeGroupMember('sales@example.com')).rejects.toThrow('Parameter "Member" is required')
    })
  })

  describe('checkHasMember', () => {
    it('checks membership', async () => {
      mock.onGet(`${BASE}/groups/sales%40example.com/hasMember/liz%40example.com`).reply({ isMember: true })

      const result = await service.checkHasMember('sales@example.com', 'liz@example.com')

      expect(result).toEqual({ isMember: true })
    })

    it('throws when groupKey is missing', async () => {
      await expect(service.checkHasMember()).rejects.toThrow('Parameter "Group" is required')
    })

    it('throws when memberKey is missing', async () => {
      await expect(service.checkHasMember('sales@example.com')).rejects.toThrow('Parameter "Member" is required')
    })
  })

  // ── Org Units ──

  describe('listOrgUnits', () => {
    it('sends correct defaults', async () => {
      mock.onGet(`${BASE}/customer/my_customer/orgunits`).reply({ organizationUnits: [] })

      await service.listOrgUnits()

      expect(mock.history[0].url).toBe(`${BASE}/customer/my_customer/orgunits`)
    })

    it('resolves type choices', async () => {
      mock.onGet(`${BASE}/customer/my_customer/orgunits`).reply({ organizationUnits: [] })

      await service.listOrgUnits('Children', '/Sales')

      expect(mock.history[0].query).toMatchObject({
        type: 'children',
        orgUnitPath: '/Sales',
      })
    })

    it('resolves All Including Parent type', async () => {
      mock.onGet(`${BASE}/customer/my_customer/orgunits`).reply({ organizationUnits: [] })

      await service.listOrgUnits('All Including Parent')

      expect(mock.history[0].query).toMatchObject({ type: 'allIncludingParent' })
    })
  })

  describe('getOrgUnit', () => {
    it('fetches an org unit by path', async () => {
      const orgData = { name: 'Marketing', orgUnitPath: '/Sales/Marketing' }

      mock.onGet(`${BASE}/customer/my_customer/orgunits/Sales/Marketing`).reply(orgData)

      const result = await service.getOrgUnit('Sales/Marketing')

      expect(result).toEqual(orgData)
    })

    it('strips leading slash from path', async () => {
      mock.onGet(`${BASE}/customer/my_customer/orgunits/Sales`).reply({ name: 'Sales' })

      await service.getOrgUnit('/Sales')

      expect(mock.history[0].url).toBe(`${BASE}/customer/my_customer/orgunits/Sales`)
    })

    it('throws when orgUnitPath is missing', async () => {
      await expect(service.getOrgUnit()).rejects.toThrow('Parameter "Org Unit Path" is required')
    })
  })

  describe('createOrgUnit', () => {
    it('sends correct body', async () => {
      mock.onPost(`${BASE}/customer/my_customer/orgunits`).reply({ name: 'Marketing' })

      await service.createOrgUnit('Marketing', '/Sales', 'Marketing team')

      expect(mock.history[0].body).toEqual({
        name: 'Marketing',
        parentOrgUnitPath: '/Sales',
        description: 'Marketing team',
      })
    })

    it('omits description when not provided', async () => {
      mock.onPost(`${BASE}/customer/my_customer/orgunits`).reply({ name: 'Marketing' })

      await service.createOrgUnit('Marketing', '/')

      expect(mock.history[0].body).toEqual({
        name: 'Marketing',
        parentOrgUnitPath: '/',
      })
    })

    it('throws when name is missing', async () => {
      await expect(service.createOrgUnit()).rejects.toThrow('Parameter "Name" is required')
    })

    it('throws when parentOrgUnitPath is missing', async () => {
      await expect(service.createOrgUnit('Marketing')).rejects.toThrow('Parameter "Parent Org Unit Path" is required')
    })
  })

  describe('updateOrgUnit', () => {
    it('sends only provided fields', async () => {
      mock.onPut(`${BASE}/customer/my_customer/orgunits/Sales/Marketing`).reply({ name: 'New Name' })

      await service.updateOrgUnit('Sales/Marketing', 'New Name')

      expect(mock.history[0].body).toEqual({ name: 'New Name' })
    })

    it('strips leading slash from path', async () => {
      mock.onPut(`${BASE}/customer/my_customer/orgunits/Sales`).reply({ name: 'S' })

      await service.updateOrgUnit('/Sales', 'S')

      expect(mock.history[0].url).toBe(`${BASE}/customer/my_customer/orgunits/Sales`)
    })

    it('throws when orgUnitPath is missing', async () => {
      await expect(service.updateOrgUnit()).rejects.toThrow('Parameter "Org Unit Path" is required')
    })

    it('throws when no fields to update', async () => {
      await expect(service.updateOrgUnit('Sales')).rejects.toThrow(
        'Provide at least one property to update'
      )
    })
  })

  describe('deleteOrgUnit', () => {
    it('deletes org unit and returns confirmation', async () => {
      mock.onDelete(`${BASE}/customer/my_customer/orgunits/Sales/Marketing`).reply({})

      const result = await service.deleteOrgUnit('Sales/Marketing')

      expect(result).toEqual({ message: 'Org unit deleted successfully', orgUnitPath: 'Sales/Marketing' })
    })

    it('strips leading slash', async () => {
      mock.onDelete(`${BASE}/customer/my_customer/orgunits/Sales`).reply({})

      const result = await service.deleteOrgUnit('/Sales')

      expect(result).toEqual({ message: 'Org unit deleted successfully', orgUnitPath: 'Sales' })
    })

    it('throws when orgUnitPath is missing', async () => {
      await expect(service.deleteOrgUnit()).rejects.toThrow('Parameter "Org Unit Path" is required')
    })
  })

  // ── Domains & Roles ──

  describe('listDomains', () => {
    it('fetches domains', async () => {
      const domainData = { domains: [{ domainName: 'example.com' }] }

      mock.onGet(`${BASE}/customer/my_customer/domains`).reply(domainData)

      const result = await service.listDomains()

      expect(result).toEqual(domainData)
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${ACCESS_TOKEN}` })
    })
  })

  describe('listRoles', () => {
    it('fetches roles', async () => {
      const roleData = { items: [{ roleName: '_SEED_ADMIN_ROLE' }] }

      mock.onGet(`${BASE}/customer/my_customer/roles`).reply(roleData)

      const result = await service.listRoles()

      expect(result).toEqual(roleData)
    })
  })

  describe('listRoleAssignments', () => {
    it('fetches role assignments with defaults', async () => {
      mock.onGet(`${BASE}/customer/my_customer/roleassignments`).reply({ items: [] })

      await service.listRoleAssignments()

      expect(mock.history[0].url).toBe(`${BASE}/customer/my_customer/roleassignments`)
    })

    it('passes userKey and pageToken', async () => {
      mock.onGet(`${BASE}/customer/my_customer/roleassignments`).reply({ items: [] })

      await service.listRoleAssignments('liz@example.com', 'pt')

      expect(mock.history[0].query).toMatchObject({
        userKey: 'liz@example.com',
        pageToken: 'pt',
      })
    })
  })

  // ── Devices ──

  describe('listMobileDevices', () => {
    it('sends correct defaults', async () => {
      mock.onGet(`${BASE}/customer/my_customer/devices/mobile`).reply({ mobiledevices: [] })

      await service.listMobileDevices()

      expect(mock.history[0].query).toMatchObject({ maxResults: 100 })
    })

    it('passes all parameters', async () => {
      mock.onGet(`${BASE}/customer/my_customer/devices/mobile`).reply({ mobiledevices: [] })

      await service.listMobileDevices('email:liz*', 50, 'pt')

      expect(mock.history[0].query).toMatchObject({
        query: 'email:liz*',
        maxResults: 50,
        pageToken: 'pt',
      })
    })

    it('caps maxResults at 100', async () => {
      mock.onGet(`${BASE}/customer/my_customer/devices/mobile`).reply({ mobiledevices: [] })

      await service.listMobileDevices(undefined, 500)

      expect(mock.history[0].query.maxResults).toBe(100)
    })
  })

  // ── Error handling ──

  describe('API error handling', () => {
    it('throws a formatted error with reason', async () => {
      mock.onGet(`${BASE}/users/bad%40example.com`).replyWithError({
        message: 'Not Found',
        body: {
          error: {
            message: 'Resource Not Found: userKey',
            errors: [{ reason: 'notFound' }],
          },
        },
        status: 404,
      })

      await expect(service.getUser('bad@example.com')).rejects.toThrow(
        'Google Workspace Admin API error: Resource Not Found: userKey (notFound)'
      )
    })

    it('throws a formatted error without reason', async () => {
      mock.onGet(`${BASE}/users/bad%40example.com`).replyWithError({
        message: 'Server Error',
      })

      await expect(service.getUser('bad@example.com')).rejects.toThrow(
        'Google Workspace Admin API error: Server Error'
      )
    })
  })
})
