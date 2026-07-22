'use strict'

const crypto = require('crypto')
const { EventEmitter } = require('events')

const { createSandbox } = require('../../../service-sandbox')

// ── Transport stub ─────────────────────────────────────────────────────────
// The AWS helper modules sign and send their own requests through node's
// `https`/`http` modules instead of Flowrunner.Request, so both transports are
// replaced with an EventEmitter-based stub. That keeps the suite offline and
// lets every branch (success, socket error, response-stream error, timeout) be
// driven explicitly.

let mockCalls = []
let mockResponse = { statusCode: 200, body: '{}', headers: {} }
let mockSocketError = null
let mockResponseError = null
let mockHang = false

function mockCreateTransport(protocol) {
  return {
    request(options, callback) {
      const req = new EventEmitter()
      const call = { protocol, options, written: [], req }

      mockCalls.push(call)

      req.write = chunk => {
        call.written.push(chunk)

        return true
      }

      req.setTimeout = (ms, handler) => {
        call.timeoutMs = ms
        call.fireTimeout = handler

        return req
      }

      req.destroy = error => {
        call.destroyedWith = error
        req.emit('error', error)
      }

      req.end = () => {
        if (mockHang) {
          return
        }

        if (mockSocketError) {
          req.emit('error', mockSocketError)

          return
        }

        const res = new EventEmitter()

        res.statusCode = mockResponse.statusCode
        res.headers = mockResponse.headers || {}

        callback(res)

        if (mockResponseError) {
          res.emit('error', mockResponseError)

          return
        }

        res.emit('data', Buffer.from(mockResponse.body || ''))
        res.emit('end')
      }

      return req
    },
  }
}

jest.mock('https', () => mockCreateTransport('https:'))
jest.mock('http', () => mockCreateTransport('http:'))

const { signRequest, generatePresignedUrl } = require('../src/sigv4')

const {
  httpRequest,
  parseXmlTag,
  parseXmlTags,
  stsAssumeRole,
  buildAwsJsonRequest,
  parseJsonResponse,
  jsonRequest,
} = require('../src/aws-client')

const { CredentialProvider } = require('../src/credentials')
const { createLogger, mapAwsError } = require('../src/errors')

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
      target: `AWSCognitoIdentityProviderService.${ operation }`,
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


  // ── Argument validation ──

  describe('argument validation', () => {
    it.each([
      ['adminEnableUser without a pool', svc => svc.adminEnableUser('', 'ada'), 'userPoolId is required.'],
      ['adminEnableUser without a username', svc => svc.adminEnableUser(POOL_ID, ''), 'username is required.'],
      ['adminDisableUser without a pool', svc => svc.adminDisableUser('', 'ada'), 'userPoolId is required.'],
      ['adminDisableUser without a username', svc => svc.adminDisableUser(POOL_ID, ''), 'username is required.'],
      ['adminResetUserPassword without a pool', svc => svc.adminResetUserPassword('', 'ada'), 'userPoolId is required.'],
      ['adminResetUserPassword without a username', svc => svc.adminResetUserPassword(POOL_ID, ''), 'username is required.'],
      ['adminSetUserPassword without a username', svc => svc.adminSetUserPassword(POOL_ID, '', 'p'), 'username is required.'],
      ['adminSetUserPassword without a password', svc => svc.adminSetUserPassword(POOL_ID, 'ada', ''), 'password is required.'],
      ['adminConfirmSignUp without a pool', svc => svc.adminConfirmSignUp('', 'ada'), 'userPoolId is required.'],
      ['adminConfirmSignUp without a username', svc => svc.adminConfirmSignUp(POOL_ID, ''), 'username is required.'],
      ['createGroup without a group name', svc => svc.createGroup(POOL_ID, ''), 'groupName is required.'],
      ['listGroups without a pool', svc => svc.listGroups(''), 'userPoolId is required.'],
      ['getGroup without a pool', svc => svc.getGroup('', 'admins'), 'userPoolId is required.'],
      ['getGroup without a group name', svc => svc.getGroup(POOL_ID, ''), 'groupName is required.'],
      ['deleteGroup without a pool', svc => svc.deleteGroup('', 'admins'), 'userPoolId is required.'],
      ['deleteGroup without a group name', svc => svc.deleteGroup(POOL_ID, ''), 'groupName is required.'],
      ['adminAddUserToGroup without a pool', svc => svc.adminAddUserToGroup('', 'ada', 'g'), 'userPoolId is required.'],
      ['adminAddUserToGroup without a username', svc => svc.adminAddUserToGroup(POOL_ID, '', 'g'), 'username is required.'],
      ['adminAddUserToGroup without a group name', svc => svc.adminAddUserToGroup(POOL_ID, 'ada', ''), 'groupName is required.'],
      ['adminRemoveUserFromGroup without a pool', svc => svc.adminRemoveUserFromGroup('', 'ada', 'g'), 'userPoolId is required.'],
      ['adminRemoveUserFromGroup without a username', svc => svc.adminRemoveUserFromGroup(POOL_ID, '', 'g'), 'username is required.'],
      ['adminRemoveUserFromGroup without a group name', svc => svc.adminRemoveUserFromGroup(POOL_ID, 'ada', ''), 'groupName is required.'],
      ['adminListGroupsForUser without a pool', svc => svc.adminListGroupsForUser('', 'ada'), 'userPoolId is required.'],
      ['adminListGroupsForUser without a username', svc => svc.adminListGroupsForUser(POOL_ID, ''), 'username is required.'],
      ['describeUserPoolClient without a pool', svc => svc.describeUserPoolClient('', 'c'), 'userPoolId is required.'],
      ['describeUserPoolClient without a client id', svc => svc.describeUserPoolClient(POOL_ID, ''), 'clientId is required.'],
    ])('rejects %s', async (name, invoke, expected) => {
      await expect(invoke(service)).rejects.toThrow(expected)

      expect(jsonRequestMock).not.toHaveBeenCalled()
    })
  })

  describe('getGroupsDictionary pagination', () => {
    it('forwards the cursor as the NextToken', async () => {
      jsonRequestMock.mockResolvedValue({ Groups: [], NextToken: 'page-2' })

      const result = await service.getGroupsDictionary({
        criteria: { userPoolId: POOL_ID },
        cursor: 'page-1',
      })

      expect(result.cursor).toBe('page-2')

      expect(jsonRequestMock.mock.calls[0][0].body).toEqual({
        UserPoolId: POOL_ID,
        Limit: 60,
        NextToken: 'page-1',
      })
    })
  })

  // ── Error propagation from every remaining operation ──

  describe('error propagation across operations', () => {
    // Each operation funnels transport failures through #handleError; this
    // covers the catch branch of the operations not exercised above.
    const operations = [
      ['listUsers', svc => svc.listUsers(POOL_ID)],
      ['adminUpdateUserAttributes', svc => svc.adminUpdateUserAttributes(POOL_ID, 'ada', { email: 'a@b.c' })],
      ['adminDeleteUser', svc => svc.adminDeleteUser(POOL_ID, 'ada')],
      ['adminEnableUser', svc => svc.adminEnableUser(POOL_ID, 'ada')],
      ['adminDisableUser', svc => svc.adminDisableUser(POOL_ID, 'ada')],
      ['adminResetUserPassword', svc => svc.adminResetUserPassword(POOL_ID, 'ada')],
      ['adminSetUserPassword', svc => svc.adminSetUserPassword(POOL_ID, 'ada', 'Str0ng!Pass')],
      ['adminConfirmSignUp', svc => svc.adminConfirmSignUp(POOL_ID, 'ada')],
      ['createGroup', svc => svc.createGroup(POOL_ID, 'admins')],
      ['listGroups', svc => svc.listGroups(POOL_ID)],
      ['getGroup', svc => svc.getGroup(POOL_ID, 'admins')],
      ['deleteGroup', svc => svc.deleteGroup(POOL_ID, 'admins')],
      ['adminAddUserToGroup', svc => svc.adminAddUserToGroup(POOL_ID, 'ada', 'admins')],
      ['adminRemoveUserFromGroup', svc => svc.adminRemoveUserFromGroup(POOL_ID, 'ada', 'admins')],
      ['adminListGroupsForUser', svc => svc.adminListGroupsForUser(POOL_ID, 'ada')],
      ['listUserPools', svc => svc.listUserPools()],
      ['describeUserPool', svc => svc.describeUserPool(POOL_ID)],
      ['createUserPool', svc => svc.createUserPool('NewPool')],
      ['listUserPoolClients', svc => svc.listUserPoolClients(POOL_ID)],
      ['describeUserPoolClient', svc => svc.describeUserPoolClient(POOL_ID, 'client-1')],
      ['getUserPoolsDictionary', svc => svc.getUserPoolsDictionary({})],
      ['getGroupsDictionary', svc => svc.getGroupsDictionary({ criteria: { userPoolId: POOL_ID } })],
      ['adminCreateUser', svc => svc.adminCreateUser(POOL_ID, 'ada')],
      ['adminGetUser', svc => svc.adminGetUser(POOL_ID, 'ada')],
    ]

    it.each(operations)('%s maps a ResourceNotFoundException', async (name, invoke) => {
      const error = new Error('no such pool')

      error.name = 'ResourceNotFoundException'
      jsonRequestMock.mockRejectedValue(error)

      await expect(invoke(service)).rejects.toThrow('Resource not found: no such pool.')
    })

    it.each(operations)('%s falls through to the generic AWS mapping', async (name, invoke) => {
      const error = new Error('slow down')

      error.name = 'ThrottlingException'
      jsonRequestMock.mockRejectedValue(error)

      await expect(invoke(service)).rejects.toThrow(/^Request was throttled by AWS/)
    })
  })

})

// ═══════════════════════════════════════════════════════════════════════════
// Helper modules (src/sigv4.js, src/aws-client.js, src/credentials.js,
// src/errors.js). These are exercised directly because index.js stubs the
// transport through `service.deps.jsonRequest`.
// ═══════════════════════════════════════════════════════════════════════════

const AWS_SERVICE = 'cognito-idp'
const ENDPOINT = `https://${ AWS_SERVICE }.us-east-1.amazonaws.com/`

const SIG_CREDENTIALS = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
}

/** A fixed instant so every signature in this suite is reproducible. */
const FIXED_NOW = Date.UTC(2015, 7, 30, 12, 36, 0)
const AMZ_DATE = '20150830T123600Z'
const DATE_STAMP = '20150830'

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data || '').digest('hex')
}

/**
 * Percent-encoding per RFC 3986, written from the spec (encodeURIComponent
 * leaves ! ' ( ) * unescaped, so those are patched up).
 */
function rfc3986(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase()
  )
}

/**
 * An independent reference implementation of the AWS Signature Version 4
 * "Authorization header" calculation, written from the published AWS signing
 * specification rather than derived from src/sigv4.js. Golden values in this
 * suite come from here so the tests do not merely restate the implementation.
 *
 * @param {Object} input
 * @param {string} input.method
 * @param {string} input.url
 * @param {Object} input.headers every header that must be signed
 * @param {string} input.payload payload hash, or UNSIGNED-PAYLOAD
 * @param {string} input.secretAccessKey
 * @param {string} input.region
 * @param {string} input.service
 * @param {string} input.amzDate YYYYMMDD'T'HHmmss'Z'
 * @returns {{signature: string, signedHeaders: string, scope: string}}
 */
function referenceSigV4({ method, url, headers, payload, secretAccessKey, region, service, amzDate }) {
  const parsed = new URL(url)
  const dateStamp = amzDate.slice(0, 8)

  const canonicalQueryString = Array.from(parsed.searchParams.entries())
    .map(([key, value]) => [rfc3986(key), rfc3986(value)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(pair => pair.join('='))
    .join('&')

  const lowered = {}

  Object.keys(headers).forEach(key => {
    lowered[key.toLowerCase()] = String(headers[key]).trim()
  })

  const names = Object.keys(lowered).sort()
  const canonicalHeaders = names.map(name => `${ name }:${ lowered[name] }\n`).join('')
  const signedHeaders = names.join(';')

  const canonicalRequest = [
    method,
    parsed.pathname || '/',
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payload,
  ].join('\n')

  const scope = `${ dateStamp }/${ region }/${ service }/aws4_request`

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')

  let key = Buffer.from(`AWS4${ secretAccessKey }`, 'utf8')

  for (const part of [dateStamp, region, service, 'aws4_request']) {
    key = crypto.createHmac('sha256', key).update(part).digest()
  }

  return {
    signature: crypto.createHmac('sha256', key).update(stringToSign).digest('hex'),
    signedHeaders,
    scope,
  }
}

// ── sigv4.js ──

describe('AWS Cognito sigv4', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('signRequest', () => {
    it('matches an independently computed SigV4 authorization header', () => {
      const headers = { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Svc.Op' }

      const returned = signRequest('POST', ENDPOINT, headers, '{}', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE)

      expect(returned).toBe(headers)
      expect(headers['x-amz-date']).toBe(AMZ_DATE)
      expect(headers['x-amz-content-sha256']).toBe(sha256Hex('{}'))
      expect(headers.host).toBe(`${ AWS_SERVICE }.us-east-1.amazonaws.com`)

      // The exact set of headers that must have been signed, stated up front.
      const expectedSignedHeaders = {
        'content-type': 'application/x-amz-json-1.1',
        'host': `${ AWS_SERVICE }.us-east-1.amazonaws.com`,
        'x-amz-content-sha256': sha256Hex('{}'),
        'x-amz-date': AMZ_DATE,
        'x-amz-target': 'Svc.Op',
      }

      const actualSignedHeaders = { ...headers }

      delete actualSignedHeaders.authorization

      expect(actualSignedHeaders).toEqual(expectedSignedHeaders)

      const reference = referenceSigV4({
        method: 'POST',
        url: ENDPOINT,
        headers: expectedSignedHeaders,
        payload: sha256Hex('{}'),
        secretAccessKey: SIG_CREDENTIALS.secretAccessKey,
        region: 'us-east-1',
        service: AWS_SERVICE,
        amzDate: AMZ_DATE,
      })

      expect(reference.signedHeaders).toBe('content-type;host;x-amz-content-sha256;x-amz-date;x-amz-target')

      expect(headers.authorization).toBe(
        `AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/${ DATE_STAMP }/us-east-1/${ AWS_SERVICE }/aws4_request, ` +
          `SignedHeaders=${ reference.signedHeaders }, ` +
          `Signature=${ reference.signature }`
      )
    })

    it('is stable for a fixed clock and sensitive to body, secret, region and service', () => {
      function sign(overrides = {}) {
        const headers = { 'content-type': 'application/x-amz-json-1.1' }

        signRequest(
          'POST',
          overrides.url || ENDPOINT,
          headers,
          overrides.body === undefined ? '{}' : overrides.body,
          overrides.credentials || SIG_CREDENTIALS,
          overrides.region || 'us-east-1',
          overrides.service || AWS_SERVICE
        )

        return headers.authorization
      }

      const baseline = sign()

      expect(sign()).toBe(baseline)
      expect(sign({ body: '{"a":1}' })).not.toBe(baseline)
      expect(sign({ credentials: { ...SIG_CREDENTIALS, secretAccessKey: 'other' } })).not.toBe(baseline)
      expect(sign({ region: 'eu-west-1' })).not.toBe(baseline)
      expect(sign({ service: 'sts' })).not.toBe(baseline)
    })

    it('signs the security token for temporary credentials', () => {
      const headers = {}

      signRequest(
        'POST',
        ENDPOINT,
        headers,
        '',
        { ...SIG_CREDENTIALS, sessionToken: 'SESSION' },
        'us-east-1',
        AWS_SERVICE
      )

      expect(headers['x-amz-security-token']).toBe('SESSION')

      expect(headers.authorization).toContain(
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
      )

      const reference = referenceSigV4({
        method: 'POST',
        url: ENDPOINT,
        headers: {
          'host': `${ AWS_SERVICE }.us-east-1.amazonaws.com`,
          'x-amz-content-sha256': sha256Hex(''),
          'x-amz-date': AMZ_DATE,
          'x-amz-security-token': 'SESSION',
        },
        payload: sha256Hex(''),
        secretAccessKey: SIG_CREDENTIALS.secretAccessKey,
        region: 'us-east-1',
        service: AWS_SERVICE,
        amzDate: AMZ_DATE,
      })

      expect(headers.authorization).toContain(`Signature=${ reference.signature }`)
    })

    it('keeps a caller supplied host header and appends non-standard ports', () => {
      const provided = { Host: 'custom.example.com' }

      signRequest('POST', ENDPOINT, provided, '', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE)

      expect(provided.host).toBeUndefined()
      expect(provided.Host).toBe('custom.example.com')
      expect(provided.authorization).toContain('SignedHeaders=host;')

      const ported = {}

      signRequest('POST', 'https://localhost:4566/', ported, '', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE)

      expect(ported.host).toBe('localhost:4566')

      const standard = {}

      signRequest('POST', 'https://example.com:443/', standard, '', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE)

      expect(standard.host).toBe('example.com')
    })

    it('canonicalizes the path and sorts the query string', () => {
      const unsorted = {}
      const sorted = {}

      signRequest('GET', `${ ENDPOINT }a?b=2&a=1`, unsorted, '', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE)
      signRequest('GET', `${ ENDPOINT }a?a=1&b=2`, sorted, '', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE)

      // Query ordering must not change the signature.
      expect(unsorted.authorization).toBe(sorted.authorization)

      const dupes = {}

      signRequest('GET', `${ ENDPOINT }x?a=2&a=1`, dupes, '', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE)

      expect(dupes.authorization).toMatch(/Signature=[0-9a-f]{64}$/)

      // A space in the path is percent-encoded as %20, never '+'.
      const spaced = {}

      signRequest('GET', `${ ENDPOINT }my folder/a b.txt`, spaced, '', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE)

      const reference = referenceSigV4({
        method: 'GET',
        url: `${ ENDPOINT }my%20folder/a%20b.txt`,
        headers: {
          'host': `${ AWS_SERVICE }.us-east-1.amazonaws.com`,
          'x-amz-content-sha256': sha256Hex(''),
          'x-amz-date': AMZ_DATE,
        },
        payload: sha256Hex(''),
        secretAccessKey: SIG_CREDENTIALS.secretAccessKey,
        region: 'us-east-1',
        service: AWS_SERVICE,
        amzDate: AMZ_DATE,
      })

      expect(spaced.authorization).toContain(`Signature=${ reference.signature }`)
    })

    it('encodes multi-byte characters byte by byte', () => {
      const headers = {}

      signRequest('GET', `${ ENDPOINT }caf%C3%A9`, headers, '', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE)

      const reference = referenceSigV4({
        method: 'GET',
        url: `${ ENDPOINT }caf%C3%A9`,
        headers: {
          'host': `${ AWS_SERVICE }.us-east-1.amazonaws.com`,
          'x-amz-content-sha256': sha256Hex(''),
          'x-amz-date': AMZ_DATE,
        },
        payload: sha256Hex(''),
        secretAccessKey: SIG_CREDENTIALS.secretAccessKey,
        region: 'us-east-1',
        service: AWS_SERVICE,
        amzDate: AMZ_DATE,
      })

      expect(headers.authorization).toContain(`Signature=${ reference.signature }`)
    })
  })

  describe('generatePresignedUrl', () => {
    it('adds every SigV4 query parameter and an independently computed signature', () => {
      const url = new URL(
        generatePresignedUrl('GET', `${ ENDPOINT }object.txt`, SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE, 900)
      )

      expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')

      expect(url.searchParams.get('X-Amz-Credential')).toBe(
        `AKIDEXAMPLE/${ DATE_STAMP }/us-east-1/${ AWS_SERVICE }/aws4_request`
      )

      expect(url.searchParams.get('X-Amz-Date')).toBe(AMZ_DATE)
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
      expect(url.searchParams.get('X-Amz-Security-Token')).toBeNull()

      // Rebuild the canonical URL exactly as the spec prescribes: every SigV4
      // query parameter except the signature itself, host as the only signed
      // header, and UNSIGNED-PAYLOAD in place of the payload hash.
      const canonical = new URL(`${ ENDPOINT }object.txt`)

      canonical.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')

      canonical.searchParams.set(
        'X-Amz-Credential',
        `AKIDEXAMPLE/${ DATE_STAMP }/us-east-1/${ AWS_SERVICE }/aws4_request`
      )

      canonical.searchParams.set('X-Amz-Date', AMZ_DATE)
      canonical.searchParams.set('X-Amz-Expires', '900')
      canonical.searchParams.set('X-Amz-SignedHeaders', 'host')

      const reference = referenceSigV4({
        method: 'GET',
        url: canonical.toString(),
        headers: { host: `${ AWS_SERVICE }.us-east-1.amazonaws.com` },
        payload: 'UNSIGNED-PAYLOAD',
        secretAccessKey: SIG_CREDENTIALS.secretAccessKey,
        region: 'us-east-1',
        service: AWS_SERVICE,
        amzDate: AMZ_DATE,
      })

      expect(url.searchParams.get('X-Amz-Signature')).toBe(reference.signature)
    })

    it('includes the session token and reacts to the expiry window and the port', () => {
      const withToken = generatePresignedUrl(
        'GET',
        `${ ENDPOINT }object.txt`,
        { ...SIG_CREDENTIALS, sessionToken: 'SESSION' },
        'us-east-1',
        AWS_SERVICE,
        900
      )

      expect(new URL(withToken).searchParams.get('X-Amz-Security-Token')).toBe('SESSION')

      const short = generatePresignedUrl('GET', `${ ENDPOINT }o`, SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE, 60)
      const long = generatePresignedUrl('GET', `${ ENDPOINT }o`, SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE, 3600)

      expect(new URL(short).searchParams.get('X-Amz-Signature')).not.toBe(
        new URL(long).searchParams.get('X-Amz-Signature')
      )

      // A non-standard port is part of the signed host value, so the signature
      // differs from the same path served on the default port.
      const ported = generatePresignedUrl('GET', 'https://localhost:4566/o', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE, 60)
      const plain = generatePresignedUrl('GET', 'https://localhost/o', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE, 60)

      expect(new URL(ported).searchParams.get('X-Amz-Signature')).not.toBe(
        new URL(plain).searchParams.get('X-Amz-Signature')
      )
    })
  })
})

// ── aws-client.js ──

describe('AWS Cognito aws-client', () => {
  beforeEach(() => {
    mockCalls = []
    mockSocketError = null
    mockResponseError = null
    mockHang = false
    mockResponse = { statusCode: 200, body: '{}', headers: {} }
  })

  describe('XML helpers', () => {
    it('extracts single and repeated tags', () => {
      const xml = '<Root><Code>Denied</Code><Item>a</Item><Item>b</Item></Root>'

      expect(parseXmlTag(xml, 'Code')).toBe('Denied')
      expect(parseXmlTag(xml, 'Missing')).toBeNull()
      expect(parseXmlTags(xml, 'Item')).toEqual(['a', 'b'])
      expect(parseXmlTags(xml, 'Missing')).toEqual([])
    })

    it('matches across newlines', () => {
      expect(parseXmlTag('<A>\nline\n</A>', 'A')).toBe('\nline\n')
    })
  })

  describe('buildAwsJsonRequest', () => {
    it('builds a POST for the regional endpoint', () => {
      expect(
        buildAwsJsonRequest({
          region: 'eu-west-1',
          service: AWS_SERVICE,
          target: 'Svc.Op',
          contentType: 'application/x-amz-json-1.1',
          body: { A: 1 },
        })
      ).toEqual({
        method: 'POST',
        url: `https://${ AWS_SERVICE }.eu-west-1.amazonaws.com/`,
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Svc.Op' },
        body: '{"A":1}',
      })
    })

    it('keeps a pre-serialized body and omits the target when absent', () => {
      const built = buildAwsJsonRequest({
        region: 'us-east-1',
        service: AWS_SERVICE,
        contentType: 'application/json',
        body: '{"raw":true}',
      })

      expect(built.body).toBe('{"raw":true}')
      expect(built.headers).toEqual({ 'content-type': 'application/json' })
    })

    it('serializes a missing body as an empty object', () => {
      expect(buildAwsJsonRequest({ region: 'us-east-1', service: AWS_SERVICE }).body).toBe('{}')
    })
  })

  describe('parseJsonResponse', () => {
    it('parses a successful body', () => {
      expect(parseJsonResponse({ statusCode: 200, body: '{"a":1}' })).toEqual({ a: 1 })
    })

    it('treats an empty or absent body as an empty object', () => {
      expect(parseJsonResponse({ statusCode: 200, body: '   ' })).toEqual({})
      expect(parseJsonResponse({ statusCode: 200 })).toEqual({})
    })

    it('throws a named error for an AWS __type error body', () => {
      const response = {
        statusCode: 400,
        body: '{"__type":"com.amazonaws.svc#InvalidParameterException","message":"bad input"}',
      }

      expect(() => parseJsonResponse(response)).toThrow('bad input')

      try {
        parseJsonResponse(response)
      } catch (error) {
        expect(error.name).toBe('InvalidParameterException')
        expect(error.statusCode).toBe(400)
      }
    })

    it('falls back to code, Message and a generic message', () => {
      expect.assertions(4)

      try {
        parseJsonResponse({ statusCode: 403, body: '{"code":"AccessDenied","Message":"nope"}' })
      } catch (error) {
        expect(error.name).toBe('AccessDenied')
        expect(error.message).toBe('nope')
      }

      try {
        parseJsonResponse({ statusCode: 500, body: '{}' })
      } catch (error) {
        expect(error.name).toBe('AwsError')
        expect(error.message).toBe('Request failed with status 500')
      }
    })
  })

  describe('httpRequest', () => {
    it('sends the body over https and resolves the raw response', async () => {
      mockResponse = { statusCode: 200, body: '{"ok":true}', headers: { 'x-amzn-requestid': 'r-1' } }

      const result = await httpRequest(
        'POST',
        `${ ENDPOINT }?a=1`,
        { 'content-type': 'application/json' },
        '{"a":1}'
      )

      expect(result).toEqual({
        statusCode: 200,
        headers: { 'x-amzn-requestid': 'r-1' },
        body: '{"ok":true}',
      })

      expect(mockCalls).toHaveLength(1)
      expect(mockCalls[0].protocol).toBe('https:')

      expect(mockCalls[0].options).toMatchObject({
        hostname: `${ AWS_SERVICE }.us-east-1.amazonaws.com`,
        port: 443,
        path: '/?a=1',
        method: 'POST',
      })

      expect(mockCalls[0].options.headers['content-length']).toBe(Buffer.byteLength('{"a":1}'))
      expect(mockCalls[0].written.join('')).toBe('{"a":1}')
      expect(mockCalls[0].timeoutMs).toBe(30000)
    })

    it('omits the body and the content-length for a bodyless request', async () => {
      await httpRequest('GET', ENDPOINT, {})

      expect(mockCalls[0].options.headers['content-length']).toBeUndefined()
      expect(mockCalls[0].written).toEqual([])
    })

    it('uses the http transport and port 80 for plain http URLs', async () => {
      await httpRequest('GET', 'http://localhost/path', {})

      expect(mockCalls[0].protocol).toBe('http:')
      expect(mockCalls[0].options.port).toBe(80)
    })

    it('honours an explicit port', async () => {
      await httpRequest('GET', 'http://localhost:4566/path', {})

      expect(mockCalls[0].options.port).toBe('4566')
    })

    it('rejects when the socket errors', async () => {
      mockSocketError = new Error('socket hang up')

      await expect(httpRequest('GET', ENDPOINT, {})).rejects.toThrow('socket hang up')
    })

    it('rejects when the response stream errors', async () => {
      mockResponseError = new Error('stream aborted')

      await expect(httpRequest('GET', ENDPOINT, {})).rejects.toThrow('stream aborted')
    })

    it('rejects with a timeout error when the request stalls', async () => {
      mockHang = true

      const pending = httpRequest('GET', ENDPOINT, {})

      mockCalls[0].fireTimeout()

      await expect(pending).rejects.toThrow('Request timed out')
      expect(mockCalls[0].destroyedWith.message).toBe('Request timed out')
    })
  })

  describe('jsonRequest', () => {
    it('signs and sends the built request through the injected transport', async () => {
      const sent = []

      const httpRequestMock = jest.fn(async (method, url, headers, body) => {
        sent.push({ method, url, headers, body })

        return { statusCode: 200, body: '{"Result":[]}' }
      })

      const signRequestMock = jest.fn((method, url, headers) => {
        headers.authorization = 'AWS4-HMAC-SHA256 signed'
      })

      const result = await jsonRequest(
        {
          region: 'us-east-1',
          service: AWS_SERVICE,
          target: 'Svc.Op',
          contentType: 'application/x-amz-json-1.1',
          body: { A: 1 },
        },
        SIG_CREDENTIALS,
        { signRequest: signRequestMock, httpRequest: httpRequestMock }
      )

      expect(result).toEqual({ Result: [] })

      expect(signRequestMock).toHaveBeenCalledWith(
        'POST',
        ENDPOINT,
        expect.any(Object),
        '{"A":1}',
        SIG_CREDENTIALS,
        'us-east-1',
        AWS_SERVICE
      )

      expect(sent[0].headers).toMatchObject({
        'authorization': 'AWS4-HMAC-SHA256 signed',
        'x-amz-target': 'Svc.Op',
      })
    })

    it('throws the parsed AWS error for a failed response', async () => {
      await expect(
        jsonRequest(
          { region: 'us-east-1', service: AWS_SERVICE, contentType: 'application/x-amz-json-1.1' },
          SIG_CREDENTIALS,
          {
            signRequest: () => {},
            httpRequest: async () => ({
              statusCode: 400,
              body: '{"__type":"x#ThrottlingException","message":"slow down"}',
            }),
          }
        )
      ).rejects.toThrow('slow down')
    })

    it('falls back to the real signer and transport when no deps are injected', async () => {
      mockResponse = { statusCode: 200, body: '{"Ok":1}', headers: {} }

      const result = await jsonRequest(
        {
          region: 'us-east-1',
          service: AWS_SERVICE,
          target: 'Svc.Op',
          contentType: 'application/x-amz-json-1.1',
          body: { A: 1 },
        },
        SIG_CREDENTIALS
      )

      expect(result).toEqual({ Ok: 1 })

      expect(mockCalls[0].options.headers.authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//
      )
    })
  })

  describe('stsAssumeRole', () => {
    const ROLE_ARN = 'arn:aws:iam::123456789012:role/MyRole'

    it('signs the STS call and returns the temporary credentials', async () => {
      mockResponse = {
        statusCode: 200,
        body: `<AssumeRoleResponse><Credentials>
                 <AccessKeyId>ASIA1</AccessKeyId>
                 <SecretAccessKey>SECRET1</SecretAccessKey>
                 <SessionToken>TOKEN1</SessionToken>
                 <Expiration>2026-01-01T00:00:00Z</Expiration>
               </Credentials></AssumeRoleResponse>`,
        headers: {},
      }

      const result = await stsAssumeRole(SIG_CREDENTIALS, 'eu-west-1', ROLE_ARN, 'session-1', 'ext-1')

      expect(result).toEqual({
        accessKeyId: 'ASIA1',
        secretAccessKey: 'SECRET1',
        sessionToken: 'TOKEN1',
        expiration: new Date('2026-01-01T00:00:00Z'),
      })

      expect(mockCalls).toHaveLength(1)

      expect(mockCalls[0].options).toMatchObject({
        hostname: 'sts.eu-west-1.amazonaws.com',
        port: 443,
        path: '/',
        method: 'POST',
      })

      expect(mockCalls[0].options.headers['content-type']).toBe('application/x-www-form-urlencoded')

      expect(mockCalls[0].options.headers.authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-west-1\/sts\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/
      )

      expect(mockCalls[0].written.join('')).toBe(
        'Action=AssumeRole&Version=2011-06-15' +
          `&RoleArn=${ encodeURIComponent(ROLE_ARN) }` +
          '&RoleSessionName=session-1' +
          '&ExternalId=ext-1'
      )
    })

    it('omits the external id when not provided', async () => {
      mockResponse = {
        statusCode: 200,
        body:
          '<r><AccessKeyId>A</AccessKeyId><SecretAccessKey>S</SecretAccessKey>' +
          '<SessionToken>T</SessionToken><Expiration>2026-01-01T00:00:00Z</Expiration></r>',
        headers: {},
      }

      await stsAssumeRole(SIG_CREDENTIALS, 'us-east-1', ROLE_ARN, 'session-2')

      expect(mockCalls[0].written.join('')).not.toContain('ExternalId')
    })

    it('throws a named error for an STS error response', async () => {
      mockResponse = {
        statusCode: 403,
        body: '<ErrorResponse><Error><Code>AccessDenied</Code><Message>not allowed</Message></Error></ErrorResponse>',
        headers: {},
      }

      await expect(stsAssumeRole(SIG_CREDENTIALS, 'us-east-1', ROLE_ARN, 's')).rejects.toMatchObject({
        name: 'AccessDenied',
        message: 'not allowed',
        statusCode: 403,
      })
    })

    it('falls back to a generic STS error when the body carries no code', async () => {
      mockResponse = { statusCode: 500, body: '<html>oops</html>', headers: {} }

      await expect(stsAssumeRole(SIG_CREDENTIALS, 'us-east-1', ROLE_ARN, 's')).rejects.toMatchObject({
        name: 'STSError',
        message: 'STS AssumeRole failed',
      })
    })

    it('throws when the response is missing credential fields', async () => {
      mockResponse = { statusCode: 200, body: '<r><AccessKeyId>A</AccessKeyId></r>', headers: {} }

      await expect(stsAssumeRole(SIG_CREDENTIALS, 'us-east-1', ROLE_ARN, 's')).rejects.toMatchObject({
        name: 'STSParseError',
        message: 'Failed to parse STS AssumeRole response: missing credential fields',
      })
    })

    it('rejects when the socket errors', async () => {
      mockSocketError = new Error('socket hang up')

      await expect(stsAssumeRole(SIG_CREDENTIALS, 'us-east-1', ROLE_ARN, 's')).rejects.toThrow('socket hang up')
    })
  })
})

// ── credentials.js ──

describe('AWS Cognito CredentialProvider', () => {
  it('returns the static keys for API Key authentication', async () => {
    const provider = new CredentialProvider({ accessKeyId: 'AK', secretAccessKey: 'SK' })

    expect(provider.authenticationMethod).toBe('API Key')
    expect(provider.region).toBe('us-east-1')

    await expect(provider.resolve()).resolves.toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK' })
  })

  it('requires both keys for API Key authentication', async () => {
    await expect(new CredentialProvider({ accessKeyId: 'AK' }).resolve()).rejects.toThrow(
      'Access Key and Secret Key are required for API Key authentication.'
    )

    await expect(new CredentialProvider({ secretAccessKey: 'SK' }).resolve()).rejects.toThrow(
      'Access Key and Secret Key are required for API Key authentication.'
    )

    await expect(new CredentialProvider().resolve()).rejects.toThrow(
      'Access Key and Secret Key are required for API Key authentication.'
    )
  })

  it('requires a role ARN and base keys for IAM Role authentication', async () => {
    await expect(new CredentialProvider({ authenticationMethod: 'IAM Role' }).resolve()).rejects.toThrow(
      'IAM Role ARN is required for IAM Role authentication.'
    )

    await expect(
      new CredentialProvider({ authenticationMethod: 'IAM Role', roleArn: 'arn:role' }).resolve()
    ).rejects.toThrow('Access Key and Secret Key are required to assume an IAM Role.')

    await expect(
      new CredentialProvider({
        authenticationMethod: 'IAM Role',
        roleArn: 'arn:role',
        accessKeyId: 'AK',
      }).resolve()
    ).rejects.toThrow('Access Key and Secret Key are required to assume an IAM Role.')
  })

  it('assumes the role, caches the result and refreshes inside the expiry buffer', async () => {
    let now = 1000000
    let call = 0

    const stsAssumeRoleMock = jest.fn(async () => {
      call += 1

      return {
        accessKeyId: `AK${ call }`,
        secretAccessKey: `SK${ call }`,
        sessionToken: `ST${ call }`,
        expiration: new Date(now + 3600000),
      }
    })

    const provider = new CredentialProvider(
      {
        authenticationMethod: 'IAM Role',
        accessKeyId: 'BASE_AK',
        secretAccessKey: 'BASE_SK',
        region: 'eu-west-1',
        roleArn: 'arn:aws:iam::123456789012:role/MyRole',
        externalId: 'ext-1',
      },
      { stsAssumeRole: stsAssumeRoleMock, now: () => now }
    )

    const first = await provider.resolve()

    expect(first).toEqual({ accessKeyId: 'AK1', secretAccessKey: 'SK1', sessionToken: 'ST1' })

    expect(stsAssumeRoleMock).toHaveBeenCalledWith(
      { accessKeyId: 'BASE_AK', secretAccessKey: 'BASE_SK' },
      'eu-west-1',
      'arn:aws:iam::123456789012:role/MyRole',
      'flowrunner-cognito-1000000',
      'ext-1'
    )

    // Well inside the validity window: served from cache.
    now += 60000
    await expect(provider.resolve()).resolves.toBe(first)
    expect(stsAssumeRoleMock).toHaveBeenCalledTimes(1)

    // Inside the 5 minute expiry buffer: a fresh session is requested.
    now += 3400000
    const second = await provider.resolve()

    expect(second.accessKeyId).toBe('AK2')
    expect(stsAssumeRoleMock).toHaveBeenCalledTimes(2)
  })

  it('defaults its clock to Date.now and delegates to the real stsAssumeRole', async () => {
    mockCalls = []
    mockSocketError = null
    mockResponseError = null
    mockHang = false

    mockResponse = {
      statusCode: 200,
      body:
        '<r><AccessKeyId>ASIA</AccessKeyId><SecretAccessKey>SEC</SecretAccessKey>' +
        '<SessionToken>TOK</SessionToken><Expiration>2999-01-01T00:00:00Z</Expiration></r>',
      headers: {},
    }

    const provider = new CredentialProvider({
      authenticationMethod: 'IAM Role',
      accessKeyId: 'BASE_AK',
      secretAccessKey: 'BASE_SK',
      region: 'us-east-1',
      roleArn: 'arn:aws:iam::123456789012:role/MyRole',
    })

    await expect(provider.resolve()).resolves.toEqual({
      accessKeyId: 'ASIA',
      secretAccessKey: 'SEC',
      sessionToken: 'TOK',
    })

    expect(mockCalls[0].written.join('')).toContain('RoleSessionName=flowrunner-cognito-')
  })
})

// ── errors.js ──

describe('AWS Cognito errors', () => {
  describe('createLogger', () => {
    it('prefixes every level with the service name', () => {
      const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
      const logger = createLogger('Demo')

      spy.mockClear()

      logger.info('a')
      logger.debug('b')
      logger.warn('c')
      logger.error('d')

      expect(spy.mock.calls).toEqual([
        ['[Demo Service]', 'info:', 'a'],
        ['[Demo Service]', 'debug:', 'b'],
        ['[Demo Service]', 'warn:', 'c'],
        ['[Demo Service]', 'error:', 'd'],
      ])

      spy.mockRestore()
    })
  })

  describe('mapAwsError', () => {
    it.each([
      ['ThrottlingException', 'slow down', /^Request was throttled by AWS/],
      ['Throttling', 'slow down', /^Request was throttled by AWS/],
      ['ProvisionedThroughputExceededException', 'slow down', /^Request was throttled by AWS/],
      ['InvalidSignatureException', 'bad sig', /^Invalid AWS credentials/],
      ['UnrecognizedClientException', 'bad sig', /^Invalid AWS credentials/],
      ['InvalidClientTokenId', 'bad sig', /^Invalid AWS credentials/],
      ['SomethingElse', 'the credential is wrong', /^Invalid AWS credentials/],
      ['AccessDeniedException', 'nope', /^Access denied/],
      ['AccessDenied', 'nope', /^Access denied/],
      ['Whatever', 'Request timed out', /^Connection to AWS failed/],
    ])('maps %s into guidance', (name, message, expected) => {
      expect(mapAwsError(Object.assign(new Error(message), { name })).message).toMatch(expected)
    })

    it.each(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'])('maps the %s socket code', code => {
      expect(mapAwsError(Object.assign(new Error('socket'), { code })).message).toMatch(
        /^Connection to AWS failed/
      )
    })

    it('passes unknown errors through with the original as cause', () => {
      const original = new Error('mystery')
      const mapped = mapAwsError(original)

      expect(mapped.message).toBe('mystery')
      expect(mapped.cause).toBe(original)
    })

    it('defaults an empty error to "Unknown error"', () => {
      expect(mapAwsError({}).message).toBe('Unknown error')
    })
  })
})
