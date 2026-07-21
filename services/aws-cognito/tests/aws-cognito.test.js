'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE'
const SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
const REGION = 'us-east-1'
const POOL_ID = 'us-east-1_TestPool'

describe('AWS Cognito Service', () => {
  let sandbox
  let service
  let jsonRequestMock

  beforeAll(() => {
    sandbox = createSandbox({
      authenticationMethod: 'API Key',
      region: REGION,
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
    })

    require('../src/index.js')
    service = sandbox.getService()
  })

  beforeEach(() => {
    jsonRequestMock = jest.fn()
    service.deps.jsonRequest = jsonRequestMock
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // Helper to assert the Cognito JSON request shape
  function expectSendJson(operation, body) {
    expect(jsonRequestMock).toHaveBeenCalledTimes(1)

    const [opts, creds] = jsonRequestMock.mock.calls[0]

    expect(opts).toMatchObject({
      region: REGION,
      service: 'cognito-idp',
      target: `AWSCognitoIdentityProviderService.${operation}`,
      contentType: 'application/x-amz-json-1.1',
      body,
    })

    expect(creds).toMatchObject({
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
    })
  }

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const items = sandbox.getConfigItems()

      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'authenticationMethod', type: 'CHOICE', required: true, shared: false }),
          expect.objectContaining({ name: 'region', type: 'STRING', required: true, shared: false }),
          expect.objectContaining({ name: 'accessKeyId', type: 'STRING', shared: false }),
          expect.objectContaining({ name: 'secretAccessKey', type: 'STRING', shared: false }),
          expect.objectContaining({ name: 'roleArn', type: 'STRING', shared: false }),
          expect.objectContaining({ name: 'externalId', type: 'STRING', shared: false }),
        ])
      )
    })
  })

  // ── User Management ──

  describe('adminCreateUser', () => {
    it('sends correct request with required params only', async () => {
      jsonRequestMock.mockResolvedValue({ User: { Username: 'ada', Attributes: [{ Name: 'sub', Value: '1234' }], UserStatus: 'FORCE_CHANGE_PASSWORD', Enabled: true } })

      const result = await service.adminCreateUser(POOL_ID, 'ada')

      expectSendJson('AdminCreateUser', { UserPoolId: POOL_ID, Username: 'ada' })
      expect(result).toEqual({
        user: {
          Username: 'ada',
          Attributes: { sub: '1234' },
          UserStatus: 'FORCE_CHANGE_PASSWORD',
          Enabled: true,
        },
      })
    })

    it('sends all optional params when provided', async () => {
      jsonRequestMock.mockResolvedValue({ User: { Username: 'ada', Attributes: [], UserStatus: 'FORCE_CHANGE_PASSWORD', Enabled: true } })

      await service.adminCreateUser(POOL_ID, 'ada', { email: 'a@b.com' }, 'TempPass1!', 'Suppress', ['EMAIL'])

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).toMatchObject({
        UserPoolId: POOL_ID,
        Username: 'ada',
        UserAttributes: [{ Name: 'email', Value: 'a@b.com' }],
        TemporaryPassword: 'TempPass1!',
        MessageAction: 'SUPPRESS',
        DesiredDeliveryMediums: ['EMAIL'],
      })
    })

    it('maps "Resend" message action correctly', async () => {
      jsonRequestMock.mockResolvedValue({ User: { Username: 'ada', Attributes: [] } })

      await service.adminCreateUser(POOL_ID, 'ada', undefined, undefined, 'Resend')

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body.MessageAction).toBe('RESEND')
    })

    it('converts null attribute values to empty strings', async () => {
      jsonRequestMock.mockResolvedValue({ User: { Username: 'ada', Attributes: [] } })

      await service.adminCreateUser(POOL_ID, 'ada', { phone_number: null })

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body.UserAttributes).toEqual([{ Name: 'phone_number', Value: '' }])
    })

    it('throws when userPoolId is missing', async () => {
      await expect(service.adminCreateUser(null, 'ada')).rejects.toThrow('userPoolId is required.')
    })

    it('throws when username is missing', async () => {
      await expect(service.adminCreateUser(POOL_ID, '')).rejects.toThrow('username is required.')
    })

    it('throws on API error', async () => {
      const err = new Error('User already exists')

      err.name = 'UsernameExistsException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.adminCreateUser(POOL_ID, 'ada')).rejects.toThrow('Username already exists')
    })
  })

  describe('adminGetUser', () => {
    it('sends correct request and maps response', async () => {
      jsonRequestMock.mockResolvedValue({
        Username: 'ada',
        UserStatus: 'CONFIRMED',
        Enabled: true,
        UserAttributes: [{ Name: 'email', Value: 'a@b.com' }, { Name: 'sub', Value: '1234' }],
        MFAOptions: [],
        PreferredMfaSetting: null,
        UserMFASettingList: [],
        UserCreateDate: 1700000000,
        UserLastModifiedDate: 1700000000,
      })

      const result = await service.adminGetUser(POOL_ID, 'ada')

      expectSendJson('AdminGetUser', { UserPoolId: POOL_ID, Username: 'ada' })
      expect(result).toEqual({
        username: 'ada',
        userStatus: 'CONFIRMED',
        enabled: true,
        attributes: { email: 'a@b.com', sub: '1234' },
        mfaOptions: [],
        preferredMfaSetting: null,
        userMFASettingList: [],
        createDate: 1700000000,
        lastModifiedDate: 1700000000,
      })
    })

    it('throws when userPoolId is missing', async () => {
      await expect(service.adminGetUser(null, 'ada')).rejects.toThrow('userPoolId is required.')
    })

    it('throws when username is missing', async () => {
      await expect(service.adminGetUser(POOL_ID, '')).rejects.toThrow('username is required.')
    })

    it('throws mapped error for UserNotFoundException', async () => {
      const err = new Error('User does not exist.')

      err.name = 'UserNotFoundException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.adminGetUser(POOL_ID, 'unknown')).rejects.toThrow('User not found')
    })
  })

  describe('listUsers', () => {
    it('sends correct request with required params only', async () => {
      jsonRequestMock.mockResolvedValue({ Users: [{ Username: 'ada', Attributes: [{ Name: 'email', Value: 'a@b.com' }], UserStatus: 'CONFIRMED', Enabled: true }], PaginationToken: null })

      const result = await service.listUsers(POOL_ID)

      expectSendJson('ListUsers', { UserPoolId: POOL_ID })
      expect(result.users).toHaveLength(1)
      expect(result.users[0].Attributes).toEqual({ email: 'a@b.com' })
      expect(result.paginationToken).toBeNull()
    })

    it('passes optional filter, limit, attributesToGet, and paginationToken', async () => {
      jsonRequestMock.mockResolvedValue({ Users: [], PaginationToken: 'next123' })

      const result = await service.listUsers(POOL_ID, 'email = "a@b.com"', 10, ['email'], 'token1')

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).toMatchObject({
        UserPoolId: POOL_ID,
        Filter: 'email = "a@b.com"',
        Limit: 10,
        AttributesToGet: ['email'],
        PaginationToken: 'token1',
      })

      expect(result.paginationToken).toBe('next123')
    })

    it('returns empty array when no users', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.listUsers(POOL_ID)

      expect(result.users).toEqual([])
      expect(result.paginationToken).toBeNull()
    })

    it('throws when userPoolId is missing', async () => {
      await expect(service.listUsers(null)).rejects.toThrow('userPoolId is required.')
    })
  })

  describe('adminUpdateUserAttributes', () => {
    it('sends correct request with attributes', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.adminUpdateUserAttributes(POOL_ID, 'ada', { email: 'new@b.com', name: 'Ada L' })

      expectSendJson('AdminUpdateUserAttributes', {
        UserPoolId: POOL_ID,
        Username: 'ada',
        UserAttributes: [{ Name: 'email', Value: 'new@b.com' }, { Name: 'name', Value: 'Ada L' }],
      })

      expect(result).toEqual({ success: true })
    })

    it('throws when attributes is empty', async () => {
      await expect(service.adminUpdateUserAttributes(POOL_ID, 'ada', {})).rejects.toThrow('attributes must contain at least one attribute')
    })

    it('throws when userPoolId is missing', async () => {
      await expect(service.adminUpdateUserAttributes(null, 'ada', { email: 'x' })).rejects.toThrow('userPoolId is required.')
    })

    it('throws when username is missing', async () => {
      await expect(service.adminUpdateUserAttributes(POOL_ID, '', { email: 'x' })).rejects.toThrow('username is required.')
    })
  })

  describe('adminDeleteUser', () => {
    it('sends correct request', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.adminDeleteUser(POOL_ID, 'ada')

      expectSendJson('AdminDeleteUser', { UserPoolId: POOL_ID, Username: 'ada' })
      expect(result).toEqual({ success: true })
    })

    it('throws when userPoolId is missing', async () => {
      await expect(service.adminDeleteUser(null, 'ada')).rejects.toThrow('userPoolId is required.')
    })

    it('throws when username is missing', async () => {
      await expect(service.adminDeleteUser(POOL_ID, '')).rejects.toThrow('username is required.')
    })
  })

  describe('adminEnableUser', () => {
    it('sends correct request', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.adminEnableUser(POOL_ID, 'ada')

      expectSendJson('AdminEnableUser', { UserPoolId: POOL_ID, Username: 'ada' })
      expect(result).toEqual({ success: true })
    })

    it('throws when userPoolId is missing', async () => {
      await expect(service.adminEnableUser(null, 'ada')).rejects.toThrow('userPoolId is required.')
    })
  })

  describe('adminDisableUser', () => {
    it('sends correct request', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.adminDisableUser(POOL_ID, 'ada')

      expectSendJson('AdminDisableUser', { UserPoolId: POOL_ID, Username: 'ada' })
      expect(result).toEqual({ success: true })
    })

    it('throws when userPoolId is missing', async () => {
      await expect(service.adminDisableUser(null, 'ada')).rejects.toThrow('userPoolId is required.')
    })
  })

  describe('adminResetUserPassword', () => {
    it('sends correct request', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.adminResetUserPassword(POOL_ID, 'ada')

      expectSendJson('AdminResetUserPassword', { UserPoolId: POOL_ID, Username: 'ada' })
      expect(result).toEqual({ success: true })
    })

    it('throws when userPoolId is missing', async () => {
      await expect(service.adminResetUserPassword(null, 'ada')).rejects.toThrow('userPoolId is required.')
    })
  })

  describe('adminSetUserPassword', () => {
    it('sends correct request with permanent=true', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.adminSetUserPassword(POOL_ID, 'ada', 'NewPass1!', true)

      expectSendJson('AdminSetUserPassword', {
        UserPoolId: POOL_ID,
        Username: 'ada',
        Password: 'NewPass1!',
        Permanent: true,
      })

      expect(result).toEqual({ success: true })
    })

    it('defaults permanent to false', async () => {
      jsonRequestMock.mockResolvedValue({})

      await service.adminSetUserPassword(POOL_ID, 'ada', 'NewPass1!')

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body.Permanent).toBe(false)
    })

    it('throws when password is missing', async () => {
      await expect(service.adminSetUserPassword(POOL_ID, 'ada', '')).rejects.toThrow('password is required.')
    })

    it('throws mapped error for InvalidPasswordException', async () => {
      const err = new Error('Password does not meet policy')

      err.name = 'InvalidPasswordException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.adminSetUserPassword(POOL_ID, 'ada', 'weak')).rejects.toThrow('Invalid password')
    })
  })

  describe('adminConfirmSignUp', () => {
    it('sends correct request', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.adminConfirmSignUp(POOL_ID, 'ada')

      expectSendJson('AdminConfirmSignUp', { UserPoolId: POOL_ID, Username: 'ada' })
      expect(result).toEqual({ success: true })
    })

    it('throws when userPoolId is missing', async () => {
      await expect(service.adminConfirmSignUp(null, 'ada')).rejects.toThrow('userPoolId is required.')
    })
  })

  // ── Group Management ──

  describe('createGroup', () => {
    it('sends correct request with required params only', async () => {
      jsonRequestMock.mockResolvedValue({ Group: { GroupName: 'admins', UserPoolId: POOL_ID } })

      const result = await service.createGroup(POOL_ID, 'admins')

      expectSendJson('CreateGroup', { UserPoolId: POOL_ID, GroupName: 'admins' })
      expect(result).toEqual({ group: { GroupName: 'admins', UserPoolId: POOL_ID } })
    })

    it('sends all optional params when provided', async () => {
      jsonRequestMock.mockResolvedValue({ Group: { GroupName: 'admins' } })

      await service.createGroup(POOL_ID, 'admins', 'Admin group', 1, 'arn:aws:iam::123:role/Admin')

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).toMatchObject({
        UserPoolId: POOL_ID,
        GroupName: 'admins',
        Description: 'Admin group',
        Precedence: 1,
        RoleArn: 'arn:aws:iam::123:role/Admin',
      })
    })

    it('includes precedence 0', async () => {
      jsonRequestMock.mockResolvedValue({ Group: {} })

      await service.createGroup(POOL_ID, 'admins', undefined, 0)

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body.Precedence).toBe(0)
    })

    it('throws when groupName is missing', async () => {
      await expect(service.createGroup(POOL_ID, '')).rejects.toThrow('groupName is required.')
    })

    it('throws mapped error for GroupExistsException', async () => {
      const err = new Error('A group with this name already exists')

      err.name = 'GroupExistsException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.createGroup(POOL_ID, 'admins')).rejects.toThrow('Group already exists')
    })
  })

  describe('listGroups', () => {
    it('sends correct request with required params only', async () => {
      jsonRequestMock.mockResolvedValue({ Groups: [{ GroupName: 'admins' }], NextToken: null })

      const result = await service.listGroups(POOL_ID)

      expectSendJson('ListGroups', { UserPoolId: POOL_ID })
      expect(result).toEqual({ groups: [{ GroupName: 'admins' }], nextToken: null })
    })

    it('passes optional limit and nextToken', async () => {
      jsonRequestMock.mockResolvedValue({ Groups: [], NextToken: 'tok2' })

      const result = await service.listGroups(POOL_ID, 10, 'tok1')

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).toMatchObject({ UserPoolId: POOL_ID, Limit: 10, NextToken: 'tok1' })
      expect(result.nextToken).toBe('tok2')
    })

    it('returns empty array when no groups', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.listGroups(POOL_ID)

      expect(result.groups).toEqual([])
    })
  })

  describe('getGroup', () => {
    it('sends correct request', async () => {
      jsonRequestMock.mockResolvedValue({ Group: { GroupName: 'admins', Description: 'Admins' } })

      const result = await service.getGroup(POOL_ID, 'admins')

      expectSendJson('GetGroup', { UserPoolId: POOL_ID, GroupName: 'admins' })
      expect(result).toEqual({ group: { GroupName: 'admins', Description: 'Admins' } })
    })

    it('throws when groupName is missing', async () => {
      await expect(service.getGroup(POOL_ID, '')).rejects.toThrow('groupName is required.')
    })

    it('throws mapped error for ResourceNotFoundException', async () => {
      const err = new Error('Group does not exist')

      err.name = 'ResourceNotFoundException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.getGroup(POOL_ID, 'nope')).rejects.toThrow('Resource not found')
    })
  })

  describe('deleteGroup', () => {
    it('sends correct request', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.deleteGroup(POOL_ID, 'admins')

      expectSendJson('DeleteGroup', { UserPoolId: POOL_ID, GroupName: 'admins' })
      expect(result).toEqual({ success: true })
    })

    it('throws when groupName is missing', async () => {
      await expect(service.deleteGroup(POOL_ID, '')).rejects.toThrow('groupName is required.')
    })
  })

  describe('adminAddUserToGroup', () => {
    it('sends correct request', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.adminAddUserToGroup(POOL_ID, 'ada', 'admins')

      expectSendJson('AdminAddUserToGroup', { UserPoolId: POOL_ID, Username: 'ada', GroupName: 'admins' })
      expect(result).toEqual({ success: true })
    })

    it('throws when groupName is missing', async () => {
      await expect(service.adminAddUserToGroup(POOL_ID, 'ada', '')).rejects.toThrow('groupName is required.')
    })
  })

  describe('adminRemoveUserFromGroup', () => {
    it('sends correct request', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.adminRemoveUserFromGroup(POOL_ID, 'ada', 'admins')

      expectSendJson('AdminRemoveUserFromGroup', { UserPoolId: POOL_ID, Username: 'ada', GroupName: 'admins' })
      expect(result).toEqual({ success: true })
    })

    it('throws when username is missing', async () => {
      await expect(service.adminRemoveUserFromGroup(POOL_ID, '', 'admins')).rejects.toThrow('username is required.')
    })
  })

  describe('adminListGroupsForUser', () => {
    it('sends correct request with required params only', async () => {
      jsonRequestMock.mockResolvedValue({ Groups: [{ GroupName: 'admins' }], NextToken: null })

      const result = await service.adminListGroupsForUser(POOL_ID, 'ada')

      expectSendJson('AdminListGroupsForUser', { UserPoolId: POOL_ID, Username: 'ada' })
      expect(result).toEqual({ groups: [{ GroupName: 'admins' }], nextToken: null })
    })

    it('passes optional limit and nextToken', async () => {
      jsonRequestMock.mockResolvedValue({ Groups: [], NextToken: 'tok2' })

      await service.adminListGroupsForUser(POOL_ID, 'ada', 10, 'tok1')

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).toMatchObject({ Limit: 10, NextToken: 'tok1' })
    })
  })

  // ── User Pools ──

  describe('listUserPools', () => {
    it('sends correct request with defaults', async () => {
      jsonRequestMock.mockResolvedValue({ UserPools: [{ Id: POOL_ID, Name: 'MyPool' }], NextToken: null })

      const result = await service.listUserPools()

      expectSendJson('ListUserPools', { MaxResults: 60 })
      expect(result).toEqual({ userPools: [{ Id: POOL_ID, Name: 'MyPool' }], nextToken: null })
    })

    it('passes custom maxResults and nextToken', async () => {
      jsonRequestMock.mockResolvedValue({ UserPools: [], NextToken: 'tok2' })

      await service.listUserPools(10, 'tok1')

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).toMatchObject({ MaxResults: 10, NextToken: 'tok1' })
    })

    it('returns empty array when no pools', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.listUserPools()

      expect(result.userPools).toEqual([])
    })
  })

  describe('describeUserPool', () => {
    it('sends correct request', async () => {
      jsonRequestMock.mockResolvedValue({ UserPool: { Id: POOL_ID, Name: 'MyPool', Status: 'Enabled' } })

      const result = await service.describeUserPool(POOL_ID)

      expectSendJson('DescribeUserPool', { UserPoolId: POOL_ID })
      expect(result).toEqual({ userPool: { Id: POOL_ID, Name: 'MyPool', Status: 'Enabled' } })
    })

    it('throws when userPoolId is missing', async () => {
      await expect(service.describeUserPool(null)).rejects.toThrow('userPoolId is required.')
    })
  })

  describe('createUserPool', () => {
    it('sends correct request with poolName only', async () => {
      jsonRequestMock.mockResolvedValue({ UserPool: { Id: 'us-east-1_new', Name: 'NewPool' } })

      const result = await service.createUserPool('NewPool')

      expectSendJson('CreateUserPool', { PoolName: 'NewPool' })
      expect(result).toEqual({ userPool: { Id: 'us-east-1_new', Name: 'NewPool' } })
    })

    it('sends policies and additionalSettings when provided', async () => {
      jsonRequestMock.mockResolvedValue({ UserPool: { Id: 'us-east-1_new', Name: 'NewPool' } })

      const policies = { PasswordPolicy: { MinimumLength: 8 } }
      const additional = { AutoVerifiedAttributes: ['email'], MfaConfiguration: 'OFF' }

      await service.createUserPool('NewPool', policies, additional)

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).toMatchObject({
        PoolName: 'NewPool',
        Policies: { PasswordPolicy: { MinimumLength: 8 } },
        AutoVerifiedAttributes: ['email'],
        MfaConfiguration: 'OFF',
      })
    })

    it('throws when poolName is missing', async () => {
      await expect(service.createUserPool('')).rejects.toThrow('poolName is required.')
    })
  })

  // ── App Clients ──

  describe('listUserPoolClients', () => {
    it('sends correct request with required params only', async () => {
      jsonRequestMock.mockResolvedValue({ UserPoolClients: [{ ClientId: 'abc', ClientName: 'web' }], NextToken: null })

      const result = await service.listUserPoolClients(POOL_ID)

      expectSendJson('ListUserPoolClients', { UserPoolId: POOL_ID })
      expect(result).toEqual({ userPoolClients: [{ ClientId: 'abc', ClientName: 'web' }], nextToken: null })
    })

    it('passes optional maxResults and nextToken', async () => {
      jsonRequestMock.mockResolvedValue({ UserPoolClients: [], NextToken: 'tok2' })

      await service.listUserPoolClients(POOL_ID, 10, 'tok1')

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).toMatchObject({ MaxResults: 10, NextToken: 'tok1' })
    })

    it('throws when userPoolId is missing', async () => {
      await expect(service.listUserPoolClients(null)).rejects.toThrow('userPoolId is required.')
    })
  })

  describe('describeUserPoolClient', () => {
    it('sends correct request', async () => {
      jsonRequestMock.mockResolvedValue({ UserPoolClient: { ClientId: 'abc', ClientName: 'web', UserPoolId: POOL_ID } })

      const result = await service.describeUserPoolClient(POOL_ID, 'abc')

      expectSendJson('DescribeUserPoolClient', { UserPoolId: POOL_ID, ClientId: 'abc' })
      expect(result).toEqual({ userPoolClient: { ClientId: 'abc', ClientName: 'web', UserPoolId: POOL_ID } })
    })

    it('throws when clientId is missing', async () => {
      await expect(service.describeUserPoolClient(POOL_ID, '')).rejects.toThrow('clientId is required.')
    })
  })

  // ── Dictionaries ──

  describe('getUserPoolsDictionary', () => {
    it('returns formatted items', async () => {
      jsonRequestMock.mockResolvedValue({ UserPools: [{ Id: POOL_ID, Name: 'MyPool' }], NextToken: null })

      const result = await service.getUserPoolsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'MyPool', value: POOL_ID, note: POOL_ID }],
        cursor: null,
      })
    })

    it('filters by search string (name)', async () => {
      jsonRequestMock.mockResolvedValue({ UserPools: [{ Id: 'p1', Name: 'MyPool' }, { Id: 'p2', Name: 'Other' }] })

      const result = await service.getUserPoolsDictionary({ search: 'my' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('p1')
    })

    it('filters by search string (id)', async () => {
      jsonRequestMock.mockResolvedValue({ UserPools: [{ Id: 'us-east-1_abc', Name: 'Pool1' }] })

      const result = await service.getUserPoolsDictionary({ search: 'abc' })

      expect(result.items).toHaveLength(1)
    })

    it('passes cursor as NextToken', async () => {
      jsonRequestMock.mockResolvedValue({ UserPools: [], NextToken: 'nextCursor' })

      const result = await service.getUserPoolsDictionary({ cursor: 'prevCursor' })

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body.NextToken).toBe('prevCursor')
      expect(result.cursor).toBe('nextCursor')
    })

    it('handles empty payload', async () => {
      jsonRequestMock.mockResolvedValue({ UserPools: [] })

      const result = await service.getUserPoolsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getGroupsDictionary', () => {
    it('returns formatted items when userPoolId is provided', async () => {
      jsonRequestMock.mockResolvedValue({ Groups: [{ GroupName: 'admins', Description: 'Admin group' }], NextToken: null })

      const result = await service.getGroupsDictionary({ criteria: { userPoolId: POOL_ID } })

      expect(result).toEqual({
        items: [{ label: 'admins', value: 'admins', note: 'Admin group' }],
        cursor: null,
      })
    })

    it('returns empty when no userPoolId in criteria', async () => {
      const result = await service.getGroupsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(jsonRequestMock).not.toHaveBeenCalled()
    })

    it('returns empty when payload is null', async () => {
      const result = await service.getGroupsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('filters by search string', async () => {
      jsonRequestMock.mockResolvedValue({ Groups: [{ GroupName: 'admins' }, { GroupName: 'users' }] })

      const result = await service.getGroupsDictionary({ criteria: { userPoolId: POOL_ID }, search: 'admin' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('admins')
    })

    it('omits note when group has no description', async () => {
      jsonRequestMock.mockResolvedValue({ Groups: [{ GroupName: 'basic' }] })

      const result = await service.getGroupsDictionary({ criteria: { userPoolId: POOL_ID } })

      expect(result.items[0].note).toBeUndefined()
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('maps InvalidParameterException', async () => {
      const err = new Error('Invalid param')

      err.name = 'InvalidParameterException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.adminGetUser(POOL_ID, 'ada')).rejects.toThrow('Invalid request')
    })

    it('maps NotAuthorizedException', async () => {
      const err = new Error('Not authorized')

      err.name = 'NotAuthorizedException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.adminGetUser(POOL_ID, 'ada')).rejects.toThrow('Not authorized')
    })

    it('falls through to mapAwsError for unknown errors', async () => {
      const err = new Error('Something went wrong')

      err.name = 'ThrottlingException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.adminGetUser(POOL_ID, 'ada')).rejects.toThrow('throttled by AWS')
    })
  })
})
