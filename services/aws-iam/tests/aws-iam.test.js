'use strict'

const { EventEmitter } = require('events')
const crypto = require('crypto')

jest.mock('https')
jest.mock('http')

const https = require('https')
const http = require('http')

const { createSandbox } = require('../../../service-sandbox')

// Mock the iam-client module since the service uses native HTTP, not Flowrunner.Request
const mockIamRequest = jest.fn()
const mockStsAssumeRole = jest.fn()

jest.mock('../src/iam-client', () => {
  const actual = jest.requireActual('../src/iam-client')

  return {
    ...actual,
    iamRequest: mockIamRequest,
    stsAssumeRole: mockStsAssumeRole,
  }
})

// The unmocked modules, exercised directly by the helper-module suites below.
const iamClient = jest.requireActual('../src/iam-client')

const {
  httpRequest,
  parseXmlTag: awsParseXmlTag,
  parseXmlTags,
  stsAssumeRole,
  buildAwsJsonRequest,
  parseJsonResponse,
  jsonRequest,
} = require('../src/aws-client')

const { signRequest, generatePresignedUrl } = require('../src/sigv4')
const { awsConfigItems } = require('../src/config-items')

const CREDS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'SECRETEXAMPLE' }

/**
 * Drives the mocked node transport with a canned response (or a transport error)
 * and records the options/body the module under test produced.
 */
function stubTransport(transport, { statusCode = 200, body = '', error = null } = {}) {
  const captured = { options: null, written: [], timeout: null }

  transport.request.mockImplementation((options, callback) => {
    captured.options = options

    const req = new EventEmitter()

    req.write = chunk => captured.written.push(chunk)

    req.setTimeout = (ms, handler) => {
      captured.timeout = { ms, handler }
    }

    req.destroy = jest.fn()

    req.end = () => {
      process.nextTick(() => {
        if (error) {
          req.emit('error', error)

          return
        }

        const res = new EventEmitter()

        res.statusCode = statusCode
        res.headers = { 'content-type': 'text/xml' }

        callback(res)
        res.emit('data', Buffer.from(body))
        res.emit('end')
      })
    }

    return req
  })

  return captured
}

const stubHttps = options => stubTransport(https, options)

const ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE'
const SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'

describe('AWS IAM Service', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createSandbox({
      authenticationMethod: 'API Key',
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      region: 'us-east-1',
    })

    require('../src/index.js')
    service = sandbox.getService()
  })

  afterEach(() => {
    mockIamRequest.mockReset()
    mockStsAssumeRole.mockReset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'authenticationMethod', type: 'CHOICE', required: true, shared: false }),
          expect.objectContaining({ name: 'accessKeyId', type: 'STRING', shared: false }),
          expect.objectContaining({ name: 'secretAccessKey', type: 'STRING', shared: false }),
          expect.objectContaining({ name: 'region', type: 'STRING', required: true, shared: false }),
          expect.objectContaining({ name: 'roleArn', type: 'STRING', shared: false }),
          expect.objectContaining({ name: 'externalId', type: 'STRING', shared: false }),
        ])
      )
    })
  })

  // ── Users ──

  describe('listUsers', () => {
    const usersXml = `
      <ListUsersResponse>
        <ListUsersResult>
          <IsTruncated>false</IsTruncated>
          <Users>
            <member>
              <UserId>AIDA111</UserId>
              <UserName>alice</UserName>
              <Arn>arn:aws:iam::123456789012:user/alice</Arn>
              <Path>/</Path>
              <CreateDate>2024-01-15T10:30:00Z</CreateDate>
            </member>
          </Users>
        </ListUsersResult>
      </ListUsersResponse>`

    it('returns parsed users with defaults', async () => {
      mockIamRequest.mockResolvedValue(usersXml)

      const result = await service.listUsers()

      expect(mockIamRequest).toHaveBeenCalledWith(
        'ListUsers',
        { PathPrefix: undefined, MaxItems: undefined, Marker: undefined },
        expect.objectContaining({ accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY })
      )

      expect(result.users).toHaveLength(1)

      expect(result.users[0]).toMatchObject({
        userId: 'AIDA111',
        userName: 'alice',
        arn: 'arn:aws:iam::123456789012:user/alice',
        path: '/',
        createDate: '2024-01-15T10:30:00Z',
      })

      expect(result.isTruncated).toBe(false)
      expect(result.marker).toBeNull()
    })

    it('passes custom parameters', async () => {
      mockIamRequest.mockResolvedValue(usersXml)

      await service.listUsers('/dev/', 10, 'abc')

      expect(mockIamRequest).toHaveBeenCalledWith(
        'ListUsers',
        { PathPrefix: '/dev/', MaxItems: 10, Marker: 'abc' },
        expect.any(Object)
      )
    })

    it('returns marker when truncated', async () => {
      const truncatedXml = `
        <ListUsersResponse>
          <ListUsersResult>
            <IsTruncated>true</IsTruncated>
            <Marker>nextpage123</Marker>
            <Users><member><UserId>AIDA111</UserId><UserName>alice</UserName><Arn>arn</Arn><Path>/</Path></member></Users>
          </ListUsersResult>
        </ListUsersResponse>`

      mockIamRequest.mockResolvedValue(truncatedXml)

      const result = await service.listUsers()

      expect(result.isTruncated).toBe(true)
      expect(result.marker).toBe('nextpage123')
    })

    it('throws on API error', async () => {
      const err = new Error('Access Denied')

      err.code = 'AccessDenied'
      mockIamRequest.mockRejectedValue(err)

      await expect(service.listUsers()).rejects.toThrow('authentication or permission failure')
    })
  })

  describe('getUser', () => {
    it('returns parsed user', async () => {
      const xml = `
        <GetUserResponse>
          <GetUserResult>
            <User>
              <UserId>AIDA111</UserId>
              <UserName>alice</UserName>
              <Arn>arn:aws:iam::123456789012:user/alice</Arn>
              <Path>/</Path>
              <CreateDate>2024-01-15T10:30:00Z</CreateDate>
              <PasswordLastUsed>2024-06-01T08:00:00Z</PasswordLastUsed>
            </User>
          </GetUserResult>
        </GetUserResponse>`

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.getUser('alice')

      expect(mockIamRequest).toHaveBeenCalledWith(
        'GetUser',
        { UserName: 'alice' },
        expect.any(Object)
      )

      expect(result).toMatchObject({
        userId: 'AIDA111',
        userName: 'alice',
        passwordLastUsed: '2024-06-01T08:00:00Z',
      })
    })

    it('calls without userName when not provided', async () => {
      const xml = '<GetUserResponse><GetUserResult><User><UserId>AIDA111</UserId><UserName>caller</UserName><Arn>arn</Arn><Path>/</Path></User></GetUserResult></GetUserResponse>'

      mockIamRequest.mockResolvedValue(xml)

      await service.getUser()

      expect(mockIamRequest).toHaveBeenCalledWith(
        'GetUser',
        { UserName: undefined },
        expect.any(Object)
      )
    })

    it('throws NoSuchEntity error', async () => {
      const err = new Error('User not found')

      err.code = 'NoSuchEntity'
      mockIamRequest.mockRejectedValue(err)

      await expect(service.getUser('nonexistent')).rejects.toThrow('the requested entity does not exist')
    })
  })

  describe('createUser', () => {
    const createUserXml = `
      <CreateUserResponse>
        <CreateUserResult>
          <User>
            <UserId>AIDA222</UserId>
            <UserName>bob</UserName>
            <Arn>arn:aws:iam::123456789012:user/bob</Arn>
            <Path>/</Path>
            <CreateDate>2024-07-01T12:00:00Z</CreateDate>
          </User>
        </CreateUserResult>
      </CreateUserResponse>`

    it('creates user with required params only', async () => {
      mockIamRequest.mockResolvedValue(createUserXml)

      const result = await service.createUser('bob')

      expect(mockIamRequest).toHaveBeenCalledWith(
        'CreateUser',
        { UserName: 'bob', Path: undefined, Tags: undefined },
        expect.any(Object)
      )

      expect(result.userName).toBe('bob')
    })

    it('creates user with path and tags', async () => {
      mockIamRequest.mockResolvedValue(createUserXml)

      await service.createUser('bob', '/dev/', [{ key: 'team', value: 'backend' }])

      expect(mockIamRequest).toHaveBeenCalledWith(
        'CreateUser',
        {
          UserName: 'bob',
          Path: '/dev/',
          Tags: [{ Key: 'team', Value: 'backend' }],
        },
        expect.any(Object)
      )
    })

    it('throws when user name is empty', async () => {
      await expect(service.createUser('')).rejects.toThrow('User name is required.')
    })

    it('throws EntityAlreadyExists error', async () => {
      const err = new Error('User already exists')

      err.code = 'EntityAlreadyExists'
      mockIamRequest.mockRejectedValue(err)

      await expect(service.createUser('existing')).rejects.toThrow('the entity already exists')
    })
  })

  describe('deleteUser', () => {
    it('deletes user and returns success', async () => {
      mockIamRequest.mockResolvedValue('<DeleteUserResponse/>')

      const result = await service.deleteUser('alice')

      expect(mockIamRequest).toHaveBeenCalledWith(
        'DeleteUser',
        { UserName: 'alice' },
        expect.any(Object)
      )

      expect(result).toEqual({ success: true, userName: 'alice' })
    })

    it('throws when user name is empty', async () => {
      await expect(service.deleteUser('')).rejects.toThrow('User name is required.')
    })

    it('throws DeleteConflict error', async () => {
      const err = new Error('Cannot delete user with attached resources')

      err.code = 'DeleteConflict'
      mockIamRequest.mockRejectedValue(err)

      await expect(service.deleteUser('alice')).rejects.toThrow('cannot be deleted because it still has attached resources')
    })
  })

  // ── Access Keys ──

  describe('listAccessKeys', () => {
    it('returns parsed access keys', async () => {
      const xml = `
        <ListAccessKeysResponse>
          <ListAccessKeysResult>
            <AccessKeyMetadata>
              <member>
                <UserName>alice</UserName>
                <AccessKeyId>AKIA111</AccessKeyId>
                <Status>Active</Status>
                <CreateDate>2024-01-15T10:30:00Z</CreateDate>
              </member>
            </AccessKeyMetadata>
          </ListAccessKeysResult>
        </ListAccessKeysResponse>`

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.listAccessKeys('alice')

      expect(result.accessKeys).toHaveLength(1)

      expect(result.accessKeys[0]).toMatchObject({
        userName: 'alice',
        accessKeyId: 'AKIA111',
        status: 'Active',
      })
    })

    it('throws when user name is empty', async () => {
      await expect(service.listAccessKeys('')).rejects.toThrow('User name is required.')
    })
  })

  describe('createAccessKey', () => {
    it('returns access key with secret', async () => {
      const xml = `
        <CreateAccessKeyResponse>
          <CreateAccessKeyResult>
            <AccessKey>
              <UserName>alice</UserName>
              <AccessKeyId>AKIA222</AccessKeyId>
              <SecretAccessKey>wJalrXUtnFEMI123</SecretAccessKey>
              <Status>Active</Status>
              <CreateDate>2024-07-01T12:00:00Z</CreateDate>
            </AccessKey>
          </CreateAccessKeyResult>
        </CreateAccessKeyResponse>`

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.createAccessKey('alice')

      expect(result).toMatchObject({
        userName: 'alice',
        accessKeyId: 'AKIA222',
        secretAccessKey: 'wJalrXUtnFEMI123',
        status: 'Active',
      })

      expect(result.warning).toContain('shown only once')
    })

    it('throws when user name is empty', async () => {
      await expect(service.createAccessKey('')).rejects.toThrow('User name is required.')
    })
  })

  describe('updateAccessKey', () => {
    it('updates access key status', async () => {
      mockIamRequest.mockResolvedValue('<UpdateAccessKeyResponse/>')

      const result = await service.updateAccessKey('alice', 'AKIA111', 'Inactive')

      expect(mockIamRequest).toHaveBeenCalledWith(
        'UpdateAccessKey',
        { UserName: 'alice', AccessKeyId: 'AKIA111', Status: 'Inactive' },
        expect.any(Object)
      )

      expect(result).toEqual({ success: true, userName: 'alice', accessKeyId: 'AKIA111', status: 'Inactive' })
    })

    it('throws when user name is empty', async () => {
      await expect(service.updateAccessKey('', 'AKIA111', 'Active')).rejects.toThrow('User name is required.')
    })

    it('throws when access key ID is empty', async () => {
      await expect(service.updateAccessKey('alice', '', 'Active')).rejects.toThrow('Access key ID is required.')
    })

    it('throws when status is invalid', async () => {
      await expect(service.updateAccessKey('alice', 'AKIA111', 'Bad')).rejects.toThrow("Status must be either 'Active' or 'Inactive'.")
    })
  })

  describe('deleteAccessKey', () => {
    it('deletes access key and returns success', async () => {
      mockIamRequest.mockResolvedValue('<DeleteAccessKeyResponse/>')

      const result = await service.deleteAccessKey('alice', 'AKIA111')

      expect(mockIamRequest).toHaveBeenCalledWith(
        'DeleteAccessKey',
        { UserName: 'alice', AccessKeyId: 'AKIA111' },
        expect.any(Object)
      )

      expect(result).toEqual({ success: true, userName: 'alice', accessKeyId: 'AKIA111' })
    })

    it('throws when user name is empty', async () => {
      await expect(service.deleteAccessKey('', 'AKIA111')).rejects.toThrow('User name is required.')
    })

    it('throws when access key ID is empty', async () => {
      await expect(service.deleteAccessKey('alice', '')).rejects.toThrow('Access key ID is required.')
    })
  })

  // ── Groups ──

  describe('listGroups', () => {
    it('returns parsed groups', async () => {
      const xml = `
        <ListGroupsResponse>
          <ListGroupsResult>
            <IsTruncated>false</IsTruncated>
            <Groups>
              <member>
                <GroupId>AGPA111</GroupId>
                <GroupName>Admins</GroupName>
                <Arn>arn:aws:iam::123456789012:group/Admins</Arn>
                <Path>/</Path>
                <CreateDate>2024-01-15T10:30:00Z</CreateDate>
              </member>
            </Groups>
          </ListGroupsResult>
        </ListGroupsResponse>`

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.listGroups()

      expect(result.groups).toHaveLength(1)

      expect(result.groups[0]).toMatchObject({
        groupId: 'AGPA111',
        groupName: 'Admins',
      })

      expect(result.isTruncated).toBe(false)
      expect(result.marker).toBeNull()
    })

    it('passes custom parameters', async () => {
      mockIamRequest.mockResolvedValue('<ListGroupsResponse><ListGroupsResult><IsTruncated>false</IsTruncated></ListGroupsResult></ListGroupsResponse>')

      await service.listGroups('/dev/', 10, 'marker1')

      expect(mockIamRequest).toHaveBeenCalledWith(
        'ListGroups',
        { PathPrefix: '/dev/', MaxItems: 10, Marker: 'marker1' },
        expect.any(Object)
      )
    })
  })

  describe('getGroup', () => {
    it('returns group with users', async () => {
      const xml = `
        <GetGroupResponse>
          <GetGroupResult>
            <Group>
              <GroupId>AGPA111</GroupId>
              <GroupName>Admins</GroupName>
              <Arn>arn:aws:iam::123456789012:group/Admins</Arn>
              <Path>/</Path>
              <CreateDate>2024-01-15T10:30:00Z</CreateDate>
            </Group>
            <Users>
              <member>
                <UserId>AIDA111</UserId>
                <UserName>alice</UserName>
                <Arn>arn:aws:iam::123456789012:user/alice</Arn>
                <Path>/</Path>
              </member>
            </Users>
          </GetGroupResult>
        </GetGroupResponse>`

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.getGroup('Admins')

      expect(result.group).toMatchObject({ groupName: 'Admins' })
      expect(result.users).toHaveLength(1)
      expect(result.users[0]).toMatchObject({ userName: 'alice' })
    })

    it('throws when group name is empty', async () => {
      await expect(service.getGroup('')).rejects.toThrow('Group name is required.')
    })
  })

  describe('createGroup', () => {
    it('creates group with required params', async () => {
      const xml = `
        <CreateGroupResponse>
          <CreateGroupResult>
            <Group>
              <GroupId>AGPA222</GroupId>
              <GroupName>Developers</GroupName>
              <Arn>arn:aws:iam::123456789012:group/Developers</Arn>
              <Path>/</Path>
              <CreateDate>2024-07-01T12:00:00Z</CreateDate>
            </Group>
          </CreateGroupResult>
        </CreateGroupResponse>`

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.createGroup('Developers')

      expect(mockIamRequest).toHaveBeenCalledWith(
        'CreateGroup',
        { GroupName: 'Developers', Path: undefined },
        expect.any(Object)
      )

      expect(result.groupName).toBe('Developers')
    })

    it('creates group with path', async () => {
      mockIamRequest.mockResolvedValue('<CreateGroupResponse><CreateGroupResult><Group><GroupId>AGPA222</GroupId><GroupName>Dev</GroupName><Arn>arn</Arn><Path>/dev/</Path></Group></CreateGroupResult></CreateGroupResponse>')

      await service.createGroup('Dev', '/dev/')

      expect(mockIamRequest).toHaveBeenCalledWith(
        'CreateGroup',
        { GroupName: 'Dev', Path: '/dev/' },
        expect.any(Object)
      )
    })

    it('throws when group name is empty', async () => {
      await expect(service.createGroup('')).rejects.toThrow('Group name is required.')
    })
  })

  describe('deleteGroup', () => {
    it('deletes group and returns success', async () => {
      mockIamRequest.mockResolvedValue('<DeleteGroupResponse/>')

      const result = await service.deleteGroup('Admins')

      expect(result).toEqual({ success: true, groupName: 'Admins' })
    })

    it('throws when group name is empty', async () => {
      await expect(service.deleteGroup('')).rejects.toThrow('Group name is required.')
    })
  })

  describe('addUserToGroup', () => {
    it('adds user to group', async () => {
      mockIamRequest.mockResolvedValue('<AddUserToGroupResponse/>')

      const result = await service.addUserToGroup('Admins', 'alice')

      expect(mockIamRequest).toHaveBeenCalledWith(
        'AddUserToGroup',
        { GroupName: 'Admins', UserName: 'alice' },
        expect.any(Object)
      )

      expect(result).toEqual({ success: true, groupName: 'Admins', userName: 'alice' })
    })

    it('throws when group name is empty', async () => {
      await expect(service.addUserToGroup('', 'alice')).rejects.toThrow('Group name is required.')
    })

    it('throws when user name is empty', async () => {
      await expect(service.addUserToGroup('Admins', '')).rejects.toThrow('User name is required.')
    })
  })

  describe('removeUserFromGroup', () => {
    it('removes user from group', async () => {
      mockIamRequest.mockResolvedValue('<RemoveUserFromGroupResponse/>')

      const result = await service.removeUserFromGroup('Admins', 'alice')

      expect(result).toEqual({ success: true, groupName: 'Admins', userName: 'alice' })
    })

    it('throws when group name is empty', async () => {
      await expect(service.removeUserFromGroup('', 'alice')).rejects.toThrow('Group name is required.')
    })

    it('throws when user name is empty', async () => {
      await expect(service.removeUserFromGroup('Admins', '')).rejects.toThrow('User name is required.')
    })
  })

  describe('listGroupsForUser', () => {
    it('returns groups for user', async () => {
      const xml = `
        <ListGroupsForUserResponse>
          <ListGroupsForUserResult>
            <Groups>
              <member>
                <GroupId>AGPA111</GroupId>
                <GroupName>Admins</GroupName>
                <Arn>arn:aws:iam::123456789012:group/Admins</Arn>
                <Path>/</Path>
              </member>
            </Groups>
          </ListGroupsForUserResult>
        </ListGroupsForUserResponse>`

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.listGroupsForUser('alice')

      expect(result.groups).toHaveLength(1)
      expect(result.groups[0]).toMatchObject({ groupName: 'Admins' })
    })

    it('throws when user name is empty', async () => {
      await expect(service.listGroupsForUser('')).rejects.toThrow('User name is required.')
    })
  })

  // ── Roles ──

  describe('listRoles', () => {
    it('returns parsed roles', async () => {
      const xml = `
        <ListRolesResponse>
          <ListRolesResult>
            <IsTruncated>false</IsTruncated>
            <Roles>
              <member>
                <RoleId>AROA111</RoleId>
                <RoleName>AppRole</RoleName>
                <Arn>arn:aws:iam::123456789012:role/AppRole</Arn>
                <Path>/</Path>
                <Description>App execution role</Description>
                <CreateDate>2024-01-15T10:30:00Z</CreateDate>
                <MaxSessionDuration>3600</MaxSessionDuration>
                <AssumeRolePolicyDocument>{"Version":"2012-10-17","Statement":[]}</AssumeRolePolicyDocument>
              </member>
            </Roles>
          </ListRolesResult>
        </ListRolesResponse>`

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.listRoles()

      expect(result.roles).toHaveLength(1)

      expect(result.roles[0]).toMatchObject({
        roleId: 'AROA111',
        roleName: 'AppRole',
        description: 'App execution role',
        maxSessionDuration: 3600,
      })

      expect(result.roles[0].assumeRolePolicyDocument).toEqual({ Version: '2012-10-17', Statement: [] })
      expect(result.isTruncated).toBe(false)
    })
  })

  describe('getRole', () => {
    it('returns parsed role', async () => {
      const xml = `
        <GetRoleResponse>
          <GetRoleResult>
            <Role>
              <RoleId>AROA111</RoleId>
              <RoleName>AppRole</RoleName>
              <Arn>arn:aws:iam::123456789012:role/AppRole</Arn>
              <Path>/</Path>
              <MaxSessionDuration>3600</MaxSessionDuration>
            </Role>
          </GetRoleResult>
        </GetRoleResponse>`

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.getRole('AppRole')

      expect(mockIamRequest).toHaveBeenCalledWith(
        'GetRole',
        { RoleName: 'AppRole' },
        expect.any(Object)
      )

      expect(result.roleName).toBe('AppRole')
      expect(result.maxSessionDuration).toBe(3600)
    })

    it('throws when role name is empty', async () => {
      await expect(service.getRole('')).rejects.toThrow('Role name is required.')
    })
  })

  describe('createRole', () => {
    const trustPolicy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }],
    })

    it('creates role with required params', async () => {
      const xml = `
        <CreateRoleResponse>
          <CreateRoleResult>
            <Role>
              <RoleId>AROA222</RoleId>
              <RoleName>NewRole</RoleName>
              <Arn>arn:aws:iam::123456789012:role/NewRole</Arn>
              <Path>/</Path>
            </Role>
          </CreateRoleResult>
        </CreateRoleResponse>`

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.createRole('NewRole', trustPolicy)

      expect(mockIamRequest).toHaveBeenCalledWith(
        'CreateRole',
        {
          RoleName: 'NewRole',
          AssumeRolePolicyDocument: trustPolicy,
          Path: undefined,
          Description: undefined,
        },
        expect.any(Object)
      )

      expect(result.roleName).toBe('NewRole')
    })

    it('creates role with all params', async () => {
      mockIamRequest.mockResolvedValue('<CreateRoleResponse><CreateRoleResult><Role><RoleId>AROA222</RoleId><RoleName>NewRole</RoleName><Arn>arn</Arn><Path>/svc/</Path></Role></CreateRoleResult></CreateRoleResponse>')

      await service.createRole('NewRole', trustPolicy, '/svc/', 'A test role')

      expect(mockIamRequest).toHaveBeenCalledWith(
        'CreateRole',
        {
          RoleName: 'NewRole',
          AssumeRolePolicyDocument: trustPolicy,
          Path: '/svc/',
          Description: 'A test role',
        },
        expect.any(Object)
      )
    })

    it('throws when role name is empty', async () => {
      await expect(service.createRole('', trustPolicy)).rejects.toThrow('Role name is required.')
    })

    it('throws when assume role policy document is empty', async () => {
      await expect(service.createRole('NewRole', '')).rejects.toThrow('Assume role policy document is required.')
    })

    it('throws when assume role policy document is invalid JSON', async () => {
      await expect(service.createRole('NewRole', 'not-json')).rejects.toThrow('must be a valid JSON string')
    })
  })

  describe('deleteRole', () => {
    it('deletes role and returns success', async () => {
      mockIamRequest.mockResolvedValue('<DeleteRoleResponse/>')

      const result = await service.deleteRole('AppRole')

      expect(result).toEqual({ success: true, roleName: 'AppRole' })
    })

    it('throws when role name is empty', async () => {
      await expect(service.deleteRole('')).rejects.toThrow('Role name is required.')
    })
  })

  describe('listAttachedRolePolicies', () => {
    it('returns attached policies', async () => {
      const xml = `
        <ListAttachedRolePoliciesResponse>
          <ListAttachedRolePoliciesResult>
            <AttachedPolicies>
              <member>
                <PolicyName>AmazonS3ReadOnlyAccess</PolicyName>
                <PolicyArn>arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess</PolicyArn>
              </member>
            </AttachedPolicies>
          </ListAttachedRolePoliciesResult>
        </ListAttachedRolePoliciesResponse>`

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.listAttachedRolePolicies('AppRole')

      expect(result.attachedPolicies).toHaveLength(1)

      expect(result.attachedPolicies[0]).toEqual({
        policyName: 'AmazonS3ReadOnlyAccess',
        policyArn: 'arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess',
      })
    })

    it('throws when role name is empty', async () => {
      await expect(service.listAttachedRolePolicies('')).rejects.toThrow('Role name is required.')
    })
  })

  // ── Policies ──

  describe('listPolicies', () => {
    it('returns parsed policies with defaults', async () => {
      const xml = `
        <ListPoliciesResponse>
          <ListPoliciesResult>
            <IsTruncated>false</IsTruncated>
            <Policies>
              <member>
                <PolicyId>ANPA111</PolicyId>
                <PolicyName>MyPolicy</PolicyName>
                <Arn>arn:aws:iam::123456789012:policy/MyPolicy</Arn>
                <Path>/</Path>
                <DefaultVersionId>v1</DefaultVersionId>
                <AttachmentCount>2</AttachmentCount>
                <IsAttachable>true</IsAttachable>
                <CreateDate>2024-01-15T10:30:00Z</CreateDate>
                <UpdateDate>2024-01-15T10:30:00Z</UpdateDate>
              </member>
            </Policies>
          </ListPoliciesResult>
        </ListPoliciesResponse>`

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.listPolicies()

      expect(result.policies).toHaveLength(1)

      expect(result.policies[0]).toMatchObject({
        policyId: 'ANPA111',
        policyName: 'MyPolicy',
        attachmentCount: 2,
        isAttachable: true,
      })

      expect(result.isTruncated).toBe(false)
    })

    it('resolves scope dropdown values', async () => {
      mockIamRequest.mockResolvedValue('<ListPoliciesResponse><ListPoliciesResult><IsTruncated>false</IsTruncated></ListPoliciesResult></ListPoliciesResponse>')

      await service.listPolicies('Customer Managed', true, 10, 'marker1')

      expect(mockIamRequest).toHaveBeenCalledWith(
        'ListPolicies',
        { Scope: 'Local', OnlyAttached: 'true', MaxItems: 10, Marker: 'marker1' },
        expect.any(Object)
      )
    })

    it('resolves AWS Managed scope', async () => {
      mockIamRequest.mockResolvedValue('<ListPoliciesResponse><ListPoliciesResult><IsTruncated>false</IsTruncated></ListPoliciesResult></ListPoliciesResponse>')

      await service.listPolicies('AWS Managed')

      expect(mockIamRequest).toHaveBeenCalledWith(
        'ListPolicies',
        expect.objectContaining({ Scope: 'AWS' }),
        expect.any(Object)
      )
    })
  })

  describe('getPolicy', () => {
    it('returns parsed policy', async () => {
      const xml = `
        <GetPolicyResponse>
          <GetPolicyResult>
            <Policy>
              <PolicyId>ANPA111</PolicyId>
              <PolicyName>MyPolicy</PolicyName>
              <Arn>arn:aws:iam::123456789012:policy/MyPolicy</Arn>
              <Path>/</Path>
              <DefaultVersionId>v1</DefaultVersionId>
              <AttachmentCount>2</AttachmentCount>
              <IsAttachable>true</IsAttachable>
            </Policy>
          </GetPolicyResult>
        </GetPolicyResponse>`

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.getPolicy('arn:aws:iam::123456789012:policy/MyPolicy')

      expect(result.policyName).toBe('MyPolicy')
      expect(result.isAttachable).toBe(true)
    })

    it('throws when policy ARN is empty', async () => {
      await expect(service.getPolicy('')).rejects.toThrow('Policy ARN is required.')
    })
  })

  describe('createPolicy', () => {
    const policyDoc = JSON.stringify({
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' }],
    })

    it('creates policy with required params', async () => {
      const xml = `
        <CreatePolicyResponse>
          <CreatePolicyResult>
            <Policy>
              <PolicyId>ANPA222</PolicyId>
              <PolicyName>NewPolicy</PolicyName>
              <Arn>arn:aws:iam::123456789012:policy/NewPolicy</Arn>
              <Path>/</Path>
              <DefaultVersionId>v1</DefaultVersionId>
              <AttachmentCount>0</AttachmentCount>
              <IsAttachable>true</IsAttachable>
            </Policy>
          </CreatePolicyResult>
        </CreatePolicyResponse>`

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.createPolicy('NewPolicy', policyDoc)

      expect(mockIamRequest).toHaveBeenCalledWith(
        'CreatePolicy',
        { PolicyName: 'NewPolicy', PolicyDocument: policyDoc, Description: undefined },
        expect.any(Object)
      )

      expect(result.policyName).toBe('NewPolicy')
    })

    it('creates policy with description', async () => {
      mockIamRequest.mockResolvedValue('<CreatePolicyResponse><CreatePolicyResult><Policy><PolicyId>ANPA222</PolicyId><PolicyName>NewPolicy</PolicyName><Arn>arn</Arn><Path>/</Path><DefaultVersionId>v1</DefaultVersionId><AttachmentCount>0</AttachmentCount><IsAttachable>true</IsAttachable></Policy></CreatePolicyResult></CreatePolicyResponse>')

      await service.createPolicy('NewPolicy', policyDoc, 'Read-only S3')

      expect(mockIamRequest).toHaveBeenCalledWith(
        'CreatePolicy',
        { PolicyName: 'NewPolicy', PolicyDocument: policyDoc, Description: 'Read-only S3' },
        expect.any(Object)
      )
    })

    it('throws when policy name is empty', async () => {
      await expect(service.createPolicy('', policyDoc)).rejects.toThrow('Policy name is required.')
    })

    it('throws when policy document is empty', async () => {
      await expect(service.createPolicy('Test', '')).rejects.toThrow('Policy document is required.')
    })

    it('throws when policy document is invalid JSON', async () => {
      await expect(service.createPolicy('Test', '{bad}')).rejects.toThrow('must be a valid JSON string')
    })
  })

  describe('deletePolicy', () => {
    it('deletes policy and returns success', async () => {
      mockIamRequest.mockResolvedValue('<DeletePolicyResponse/>')

      const result = await service.deletePolicy('arn:aws:iam::123456789012:policy/MyPolicy')

      expect(result).toEqual({ success: true, policyArn: 'arn:aws:iam::123456789012:policy/MyPolicy' })
    })

    it('throws when policy ARN is empty', async () => {
      await expect(service.deletePolicy('')).rejects.toThrow('Policy ARN is required.')
    })
  })

  // ── Policy Attachments ──

  describe('attachUserPolicy', () => {
    it('attaches policy to user', async () => {
      mockIamRequest.mockResolvedValue('<AttachUserPolicyResponse/>')

      const result = await service.attachUserPolicy('alice', 'arn:aws:iam::aws:policy/ReadOnly')

      expect(mockIamRequest).toHaveBeenCalledWith(
        'AttachUserPolicy',
        { UserName: 'alice', PolicyArn: 'arn:aws:iam::aws:policy/ReadOnly' },
        expect.any(Object)
      )

      expect(result).toEqual({ success: true, userName: 'alice', policyArn: 'arn:aws:iam::aws:policy/ReadOnly' })
    })

    it('throws when user name is empty', async () => {
      await expect(service.attachUserPolicy('', 'arn')).rejects.toThrow('User name is required.')
    })

    it('throws when policy ARN is empty', async () => {
      await expect(service.attachUserPolicy('alice', '')).rejects.toThrow('Policy ARN is required.')
    })
  })

  describe('detachUserPolicy', () => {
    it('detaches policy from user', async () => {
      mockIamRequest.mockResolvedValue('<DetachUserPolicyResponse/>')

      const result = await service.detachUserPolicy('alice', 'arn:aws:iam::aws:policy/ReadOnly')

      expect(result).toEqual({ success: true, userName: 'alice', policyArn: 'arn:aws:iam::aws:policy/ReadOnly' })
    })

    it('throws when user name is empty', async () => {
      await expect(service.detachUserPolicy('', 'arn')).rejects.toThrow('User name is required.')
    })

    it('throws when policy ARN is empty', async () => {
      await expect(service.detachUserPolicy('alice', '')).rejects.toThrow('Policy ARN is required.')
    })
  })

  describe('attachRolePolicy', () => {
    it('attaches policy to role', async () => {
      mockIamRequest.mockResolvedValue('<AttachRolePolicyResponse/>')

      const result = await service.attachRolePolicy('AppRole', 'arn:aws:iam::aws:policy/ReadOnly')

      expect(mockIamRequest).toHaveBeenCalledWith(
        'AttachRolePolicy',
        { RoleName: 'AppRole', PolicyArn: 'arn:aws:iam::aws:policy/ReadOnly' },
        expect.any(Object)
      )

      expect(result).toEqual({ success: true, roleName: 'AppRole', policyArn: 'arn:aws:iam::aws:policy/ReadOnly' })
    })

    it('throws when role name is empty', async () => {
      await expect(service.attachRolePolicy('', 'arn')).rejects.toThrow('Role name is required.')
    })

    it('throws when policy ARN is empty', async () => {
      await expect(service.attachRolePolicy('AppRole', '')).rejects.toThrow('Policy ARN is required.')
    })
  })

  describe('detachRolePolicy', () => {
    it('detaches policy from role', async () => {
      mockIamRequest.mockResolvedValue('<DetachRolePolicyResponse/>')

      const result = await service.detachRolePolicy('AppRole', 'arn:aws:iam::aws:policy/ReadOnly')

      expect(result).toEqual({ success: true, roleName: 'AppRole', policyArn: 'arn:aws:iam::aws:policy/ReadOnly' })
    })

    it('throws when role name is empty', async () => {
      await expect(service.detachRolePolicy('', 'arn')).rejects.toThrow('Role name is required.')
    })

    it('throws when policy ARN is empty', async () => {
      await expect(service.detachRolePolicy('AppRole', '')).rejects.toThrow('Policy ARN is required.')
    })
  })

  // ── Account ──

  describe('getAccountSummary', () => {
    it('returns parsed summary map', async () => {
      const xml = `
        <GetAccountSummaryResponse>
          <GetAccountSummaryResult>
            <SummaryMap>
              <entry><key>Users</key><value>32</value></entry>
              <entry><key>UsersQuota</key><value>150</value></entry>
              <entry><key>Groups</key><value>7</value></entry>
              <entry><key>AccountMFAEnabled</key><value>1</value></entry>
            </SummaryMap>
          </GetAccountSummaryResult>
        </GetAccountSummaryResponse>`

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.getAccountSummary()

      expect(result.summary).toEqual({
        Users: 32,
        UsersQuota: 150,
        Groups: 7,
        AccountMFAEnabled: 1,
      })
    })
  })

  describe('listAccountAliases', () => {
    it('returns account aliases', async () => {
      const xml = `
        <ListAccountAliasesResponse>
          <ListAccountAliasesResult>
            <AccountAliases>
              <member>my-company</member>
            </AccountAliases>
          </ListAccountAliasesResult>
        </ListAccountAliasesResponse>`

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.listAccountAliases()

      expect(result.accountAliases).toEqual(['my-company'])
    })

    it('returns empty array when no alias set', async () => {
      const xml = '<ListAccountAliasesResponse><ListAccountAliasesResult><AccountAliases></AccountAliases></ListAccountAliasesResult></ListAccountAliasesResponse>'

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.listAccountAliases()

      expect(result.accountAliases).toEqual([])
    })
  })

  // ── Dictionaries ──

  describe('getUsersDictionary', () => {
    const usersXml = `
      <ListUsersResponse>
        <ListUsersResult>
          <IsTruncated>false</IsTruncated>
          <Users>
            <member>
              <UserId>AIDA111</UserId>
              <UserName>alice</UserName>
              <Arn>arn:aws:iam::123456789012:user/alice</Arn>
              <Path>/</Path>
            </member>
            <member>
              <UserId>AIDA222</UserId>
              <UserName>bob</UserName>
              <Arn>arn:aws:iam::123456789012:user/bob</Arn>
              <Path>/</Path>
            </member>
          </Users>
        </ListUsersResult>
      </ListUsersResponse>`

    it('returns dictionary items', async () => {
      mockIamRequest.mockResolvedValue(usersXml)

      const result = await service.getUsersDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({ label: 'alice', value: 'alice', note: 'arn:aws:iam::123456789012:user/alice' })
      expect(result.cursor).toBeNull()
    })

    it('filters by search text', async () => {
      mockIamRequest.mockResolvedValue(usersXml)

      const result = await service.getUsersDictionary({ search: 'ali' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('alice')
    })

    it('handles null payload', async () => {
      mockIamRequest.mockResolvedValue(usersXml)

      const result = await service.getUsersDictionary(null)

      expect(result.items).toHaveLength(2)
    })
  })

  describe('getRolesDictionary', () => {
    it('returns dictionary items for roles', async () => {
      const xml = `
        <ListRolesResponse>
          <ListRolesResult>
            <IsTruncated>false</IsTruncated>
            <Roles>
              <member>
                <RoleId>AROA111</RoleId>
                <RoleName>AppRole</RoleName>
                <Arn>arn:aws:iam::123456789012:role/AppRole</Arn>
                <Path>/</Path>
              </member>
            </Roles>
          </ListRolesResult>
        </ListRolesResponse>`

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.getRolesDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({ label: 'AppRole', value: 'AppRole', note: 'arn:aws:iam::123456789012:role/AppRole' })
    })
  })

  describe('getPoliciesDictionary', () => {
    it('returns dictionary items for policies', async () => {
      const xml = `
        <ListPoliciesResponse>
          <ListPoliciesResult>
            <IsTruncated>false</IsTruncated>
            <Policies>
              <member>
                <PolicyId>ANPA111</PolicyId>
                <PolicyName>MyPolicy</PolicyName>
                <Arn>arn:aws:iam::123456789012:policy/MyPolicy</Arn>
                <Path>/</Path>
                <AttachmentCount>2</AttachmentCount>
                <IsAttachable>true</IsAttachable>
              </member>
            </Policies>
          </ListPoliciesResult>
        </ListPoliciesResponse>`

      mockIamRequest.mockResolvedValue(xml)

      const result = await service.getPoliciesDictionary({})

      expect(result.items).toHaveLength(1)

      expect(result.items[0]).toEqual({
        label: 'MyPolicy',
        value: 'arn:aws:iam::123456789012:policy/MyPolicy',
        note: 'Attachments: 2',
      })
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('handles InvalidInput error', async () => {
      const err = new Error('Invalid input provided')

      err.code = 'InvalidInput'
      mockIamRequest.mockRejectedValue(err)

      await expect(service.listUsers()).rejects.toThrow('invalid input')
    })

    it('handles MalformedPolicyDocument error', async () => {
      const err = new Error('Malformed policy')

      err.code = 'MalformedPolicyDocument'
      mockIamRequest.mockRejectedValue(err)

      await expect(service.listUsers()).rejects.toThrow('invalid input')
    })

    it('handles SignatureDoesNotMatch error', async () => {
      const err = new Error('Signature mismatch')

      err.code = 'SignatureDoesNotMatch'
      mockIamRequest.mockRejectedValue(err)

      await expect(service.listUsers()).rejects.toThrow('authentication or permission failure')
    })

    it('handles unknown error codes', async () => {
      const err = new Error('Something unexpected')

      err.code = 'UnknownError'
      mockIamRequest.mockRejectedValue(err)

      await expect(service.listUsers()).rejects.toThrow('AWS IAM error (UnknownError)')
    })

    it('handles errors without code', async () => {
      const err = new Error('Network failure')

      err.code = undefined
      err.name = undefined
      mockIamRequest.mockRejectedValue(err)

      await expect(service.listUsers()).rejects.toThrow('AWS IAM error (Unknown)')
    })
  })

  // ── Every operation funnels transport failures through #handleError ──

  describe('error propagation across operations', () => {
    const POLICY_DOC = '{"Version":"2012-10-17","Statement":[]}'

    const OPERATIONS = [
      ['getUsersDictionary', [{}]],
      ['getRolesDictionary', [{}]],
      ['getPoliciesDictionary', [{}]],
      ['listUsers', []],
      ['getUser', ['alice']],
      ['createUser', ['alice']],
      ['deleteUser', ['alice']],
      ['listAccessKeys', ['alice']],
      ['createAccessKey', ['alice']],
      ['updateAccessKey', ['alice', 'AKIAEXAMPLE', 'Active']],
      ['deleteAccessKey', ['alice', 'AKIAEXAMPLE']],
      ['listGroups', []],
      ['getGroup', ['devs']],
      ['createGroup', ['devs']],
      ['deleteGroup', ['devs']],
      ['addUserToGroup', ['devs', 'alice']],
      ['removeUserFromGroup', ['devs', 'alice']],
      ['listGroupsForUser', ['alice']],
      ['listRoles', []],
      ['getRole', ['AppRole']],
      ['createRole', ['AppRole', POLICY_DOC]],
      ['deleteRole', ['AppRole']],
      ['listAttachedRolePolicies', ['AppRole']],
      ['listPolicies', []],
      ['getPolicy', ['arn:aws:iam::1:policy/P']],
      ['createPolicy', ['P', POLICY_DOC]],
      ['deletePolicy', ['arn:aws:iam::1:policy/P']],
      ['attachUserPolicy', ['alice', 'arn:aws:iam::1:policy/P']],
      ['detachUserPolicy', ['alice', 'arn:aws:iam::1:policy/P']],
      ['attachRolePolicy', ['AppRole', 'arn:aws:iam::1:policy/P']],
      ['detachRolePolicy', ['AppRole', 'arn:aws:iam::1:policy/P']],
      ['getAccountSummary', []],
      ['listAccountAliases', []],
    ]

    it.each(OPERATIONS)('%s surfaces a NoSuchEntity failure', async (method, args) => {
      const error = new Error('entity gone')

      error.code = 'NoSuchEntity'
      mockIamRequest.mockRejectedValue(error)

      await expect(service[method](...args)).rejects.toThrow(
        'AWS IAM error: the requested entity does not exist. entity gone'
      )

      expect(mockIamRequest).toHaveBeenCalled()
    })

    it.each(OPERATIONS)('%s surfaces an unclassified failure', async (method, args) => {
      const error = new Error('boom')

      error.code = 'SomeOtherError'
      mockIamRequest.mockRejectedValue(error)

      await expect(service[method](...args)).rejects.toThrow('AWS IAM error (SomeOtherError): boom')
    })

    it('maps the remaining IAM error codes', async () => {
      const cases = [
        ['EntityAlreadyExists', 'the entity already exists'],
        ['DeleteConflict', 'it still has attached resources'],
        ['InvalidInput', 'invalid input'],
        ['MalformedPolicyDocument', 'invalid input'],
        ['AccessDenied', 'authentication or permission failure'],
        ['InvalidClientTokenId', 'authentication or permission failure'],
      ]

      for (const [code, expected] of cases) {
        const error = new Error('details')

        error.code = code
        mockIamRequest.mockRejectedValue(error)

        await expect(service.listUsers()).rejects.toThrow(expected)
      }
    })

    it('falls back to error.name when there is no code', async () => {
      const error = new Error('missing')

      error.name = 'NoSuchEntity'
      mockIamRequest.mockRejectedValue(error)

      await expect(service.getUser('alice')).rejects.toThrow('the requested entity does not exist')
    })
  })

  // ── Dictionary search filtering ──

  describe('dictionary search filtering', () => {
    const ROLES_XML =
      '<ListRolesResponse><ListRolesResult><IsTruncated>false</IsTruncated><Roles>' +
      '<member><RoleName>AppRole</RoleName><Arn>arn:aws:iam::1:role/AppRole</Arn></member>' +
      '<member><RoleName>BuildRole</RoleName><Arn>arn:aws:iam::1:role/BuildRole</Arn></member>' +
      '</Roles></ListRolesResult></ListRolesResponse>'

    const POLICIES_XML =
      '<ListPoliciesResponse><ListPoliciesResult><IsTruncated>false</IsTruncated><Policies>' +
      '<member><PolicyName>Alpha</PolicyName><Arn>arn:aws:iam::1:policy/Alpha</Arn><AttachmentCount>2</AttachmentCount></member>' +
      '<member><PolicyName>Beta</PolicyName><Arn>arn:aws:iam::1:policy/Beta</Arn></member>' +
      '</Policies></ListPoliciesResult></ListPoliciesResponse>'

    it('filters roles case-insensitively', async () => {
      mockIamRequest.mockResolvedValue(ROLES_XML)

      const result = await service.getRolesDictionary({ search: 'BUILD' })

      expect(result).toEqual({
        items: [{ label: 'BuildRole', value: 'BuildRole', note: 'arn:aws:iam::1:role/BuildRole' }],
        cursor: null,
      })
    })

    it('returns every role when no search is given', async () => {
      mockIamRequest.mockResolvedValue(ROLES_XML)

      await expect(service.getRolesDictionary()).resolves.toMatchObject({ items: expect.any(Array) })
      expect((await service.getRolesDictionary(null)).items).toHaveLength(2)
    })

    it('filters policies case-insensitively and notes the attachment count', async () => {
      mockIamRequest.mockResolvedValue(POLICIES_XML)

      const all = await service.getPoliciesDictionary({})

      expect(all.items).toEqual([
        { label: 'Alpha', value: 'arn:aws:iam::1:policy/Alpha', note: 'Attachments: 2' },
        { label: 'Beta', value: 'arn:aws:iam::1:policy/Beta', note: '' },
      ])

      const filtered = await service.getPoliciesDictionary({ search: 'bet' })

      expect(filtered.items).toHaveLength(1)
      expect(filtered.items[0].label).toBe('Beta')
    })

    it('keeps a non-JSON assume-role policy document as a raw string', async () => {
      mockIamRequest.mockResolvedValue(
        '<ListRolesResponse><ListRolesResult><Roles><member>' +
        '<RoleName>Legacy</RoleName><Arn>arn:r</Arn>' +
        '<AssumeRolePolicyDocument>not-json</AssumeRolePolicyDocument>' +
        '<MaxSessionDuration>3600</MaxSessionDuration>' +
        '</member></Roles></ListRolesResult></ListRolesResponse>'
      )

      const result = await service.listRoles()

      expect(result.roles[0]).toMatchObject({
        roleName: 'Legacy',
        assumeRolePolicyDocument: 'not-json',
        maxSessionDuration: 3600,
      })
    })

    it('passes the cursor as a Marker and returns the next marker when truncated', async () => {
      mockIamRequest.mockResolvedValue(
        '<ListRolesResponse><ListRolesResult><IsTruncated>true</IsTruncated><Marker>tok-2</Marker>' +
        '<Roles><member><RoleName>R</RoleName><Arn>arn:r</Arn></member></Roles>' +
        '</ListRolesResult></ListRolesResponse>'
      )

      const result = await service.getRolesDictionary({ cursor: 'tok-1' })

      expect(mockIamRequest).toHaveBeenCalledWith('ListRoles', { MaxItems: 200, Marker: 'tok-1' }, expect.any(Object))
      expect(result.cursor).toBe('tok-2')
    })
  })

  // ── Credential resolution ──

  describe('credential resolution', () => {
    const AwsIam = () => service.constructor

    it('rejects when API key credentials are incomplete', async () => {
      const bare = new (AwsIam())({})

      expect(bare.region).toBe('us-east-1')
      expect(bare.authenticationMethod).toBe('API Key')

      await expect(bare.listUsers()).rejects.toThrow(
        'Access Key and Secret Key are required for API Key authentication.'
      )

      expect(mockIamRequest).not.toHaveBeenCalled()
    })

    it('assumes the configured role, caches it and refreshes past the expiry buffer', async () => {
      const roleService = new (AwsIam())({
        authenticationMethod: 'IAM Role',
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET_KEY,
        region: 'eu-west-1',
        roleArn: 'arn:aws:iam::1:role/R',
        externalId: 'ext',
      })

      mockStsAssumeRole.mockResolvedValue({
        accessKeyId: 'ASIA',
        secretAccessKey: 'S',
        sessionToken: 'T',
        expiration: new Date(Date.now() + 3600000),
      })

      mockIamRequest.mockResolvedValue('<ListUsersResponse><ListUsersResult></ListUsersResult></ListUsersResponse>')

      await roleService.listUsers()

      expect(mockStsAssumeRole).toHaveBeenCalledWith(
        { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
        'eu-west-1',
        'arn:aws:iam::1:role/R',
        expect.stringMatching(/^flowrunner-iam-\d+$/),
        'ext'
      )

      expect(mockIamRequest.mock.calls[0][2]).toEqual({ accessKeyId: 'ASIA', secretAccessKey: 'S', sessionToken: 'T' })

      // Cached — no second AssumeRole call.
      await roleService.listUsers()
      expect(mockStsAssumeRole).toHaveBeenCalledTimes(1)

      // Force the cached credentials past the 5 minute refresh buffer.
      roleService.stsCredentialsExpiry = Date.now() + 1000
      await roleService.listUsers()
      expect(mockStsAssumeRole).toHaveBeenCalledTimes(2)
    })

    it('requires a role ARN and static keys for IAM Role authentication', async () => {
      const noArn = new (AwsIam())({
        authenticationMethod: 'IAM Role',
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET_KEY,
      })

      await expect(noArn.listUsers()).rejects.toThrow('IAM Role ARN is required for IAM Role authentication.')

      const noKeys = new (AwsIam())({ authenticationMethod: 'IAM Role', roleArn: 'arn:aws:iam::1:role/R' })

      await expect(noKeys.listUsers()).rejects.toThrow(
        'Access Key and Secret Key are required for IAM Role authentication to call STS AssumeRole.'
      )
    })
  })
})

// ── iam-client.js: query building ──

describe('iam-client flattenQueryParams', () => {
  it('emits scalar pairs in insertion order', () => {
    expect(iamClient.flattenQueryParams({ UserName: 'alice', MaxItems: 10 })).toEqual([
      ['UserName', 'alice'],
      ['MaxItems', '10'],
    ])
  })

  it('flattens arrays into member syntax', () => {
    expect(iamClient.flattenQueryParams({ Keys: ['a', 'b'] })).toEqual([
      ['Keys.member.1', 'a'],
      ['Keys.member.2', 'b'],
    ])
  })

  it('flattens arrays of objects', () => {
    expect(iamClient.flattenQueryParams({ Tags: [{ Key: 'env', Value: 'prod' }] })).toEqual([
      ['Tags.member.1.Key', 'env'],
      ['Tags.member.1.Value', 'prod'],
    ])
  })

  it('flattens nested objects and nested arrays', () => {
    expect(iamClient.flattenQueryParams({ Filter: { Scope: 'Local', Names: ['a'] } })).toEqual([
      ['Filter.Scope', 'Local'],
      ['Filter.Names.member.1', 'a'],
    ])
  })

  it('skips undefined and null values but keeps falsy scalars', () => {
    expect(iamClient.flattenQueryParams({ A: undefined, B: null, C: 0, D: false, E: '' })).toEqual([
      ['C', '0'],
      ['D', 'false'],
      ['E', ''],
    ])
  })

  it('handles a missing params object', () => {
    expect(iamClient.flattenQueryParams()).toEqual([])
    expect(iamClient.flattenQueryParams(null)).toEqual([])
  })
})

describe('iam-client buildQuery', () => {
  it('prepends Action and Version and percent-encodes the pairs', () => {
    expect(iamClient.buildQuery('ListUsers', {})).toBe(
      `Action=ListUsers&Version=${ iamClient.IAM_API_VERSION }`
    )

    expect(iamClient.buildQuery('CreateUser', { UserName: 'a b/c' })).toBe(
      `Action=CreateUser&Version=${ iamClient.IAM_API_VERSION }&UserName=a%20b%2Fc`
    )
  })

  it('exposes the global IAM endpoint constants', () => {
    expect(iamClient.IAM_ENDPOINT).toBe('https://iam.amazonaws.com/')
    expect(iamClient.IAM_API_VERSION).toBe('2010-05-08')
    expect(iamClient.IAM_SIGNING_REGION).toBe('us-east-1')
    expect(iamClient.IAM_SERVICE).toBe('iam')
  })
})

// ── iam-client.js: XML helpers ──

describe('iam-client XML helpers', () => {
  const XML = '<R><Name>alice</Name><Name>bob</Name><Doc attr="x">wrapped</Doc></R>'

  it('extracts the first matching tag, including tags with attributes', () => {
    expect(iamClient.parseXmlTag(XML, 'Name')).toBe('alice')
    expect(iamClient.parseXmlTag(XML, 'Doc')).toBe('wrapped')
  })

  it('returns null for a missing tag or a missing document', () => {
    expect(iamClient.parseXmlTag(XML, 'Nope')).toBeNull()
    expect(iamClient.parseXmlTag('', 'Name')).toBeNull()
    expect(iamClient.parseXmlTag(null, 'Name')).toBeNull()
  })

  it('extracts every matching block', () => {
    expect(iamClient.parseXmlBlocks(XML, 'Name')).toEqual(['alice', 'bob'])
    expect(iamClient.parseXmlBlocks(XML, 'Nope')).toEqual([])
    expect(iamClient.parseXmlBlocks('', 'Name')).toEqual([])
    expect(iamClient.parseXmlBlocks(null, 'Name')).toEqual([])
  })

  it('captures multi-line member blocks', () => {
    expect(iamClient.parseXmlBlocks('<L><member>\n  a\n</member></L>', 'member')).toEqual(['\n  a\n'])
  })

  it('decodes the entity set IAM emits', () => {
    expect(iamClient.decodeXmlEntities('&lt;a&gt; &quot;b&quot; &#39;c&#039; &apos;d&apos; e&amp;f')).toBe(
      '<a> "b" \'c\' \'d\' e&f'
    )
  })

  it('passes null and undefined through decodeXmlEntities', () => {
    expect(iamClient.decodeXmlEntities(null)).toBeNull()
    expect(iamClient.decodeXmlEntities(undefined)).toBeUndefined()
  })

  it('decodes an embedded JSON policy document via getTag', () => {
    const xml = '<R><AssumeRolePolicyDocument>{&quot;Version&quot;:&quot;2012-10-17&quot;}</AssumeRolePolicyDocument></R>'

    expect(iamClient.getTag(xml, 'AssumeRolePolicyDocument')).toBe('{"Version":"2012-10-17"}')
    expect(iamClient.getTag(xml, 'Missing')).toBeNull()
  })

  it('re-exports stsAssumeRole from aws-client', () => {
    expect(iamClient.stsAssumeRole).toBe(stsAssumeRole)
  })
})

// ── iam-client.js: iamRequest ──

describe('iam-client iamRequest', () => {
  afterEach(() => {
    https.request.mockReset()
  })

  it('signs for us-east-1/iam and posts to the global endpoint', async () => {
    const captured = stubHttps({
      statusCode: 200,
      body: '<ListUsersResponse><ListUsersResult/></ListUsersResponse>',
    })

    const body = await iamClient.iamRequest('ListUsers', { MaxItems: 100 }, CREDS)

    expect(captured.options).toMatchObject({
      hostname: 'iam.amazonaws.com',
      port: 443,
      path: '/',
      method: 'POST',
    })

    expect(captured.options.headers['content-type']).toBe('application/x-www-form-urlencoded')

    expect(captured.options.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/iam\/aws4_request, /
    )

    expect(captured.written[0]).toBe(`Action=ListUsers&Version=${ iamClient.IAM_API_VERSION }&MaxItems=100`)
    expect(body).toBe('<ListUsersResponse><ListUsersResult/></ListUsersResponse>')
  })

  it('signs for us-east-1 even when the caller is configured for another region', async () => {
    const captured = stubHttps({ statusCode: 200, body: '<ok/>' })

    await iamClient.iamRequest('ListUsers', {}, CREDS)

    expect(captured.options.headers.authorization).toContain('/us-east-1/iam/aws4_request')
  })

  it('throws a named error carrying the IAM Code, decoded Message and status', async () => {
    stubHttps({
      statusCode: 404,
      body:
        '<ErrorResponse><Error><Type>Sender</Type><Code>NoSuchEntity</Code>' +
        '<Message>The user with name &quot;ghost&quot; cannot be found.</Message></Error></ErrorResponse>',
    })

    await expect(iamClient.iamRequest('GetUser', { UserName: 'ghost' }, CREDS)).rejects.toMatchObject({
      name: 'NoSuchEntity',
      code: 'NoSuchEntity',
      message: 'The user with name "ghost" cannot be found.',
      statusCode: 404,
    })
  })

  it('falls back to a generic error when the body has no Code or Message', async () => {
    stubHttps({ statusCode: 503, body: '<html>gateway</html>' })

    await expect(iamClient.iamRequest('ListUsers', {}, CREDS)).rejects.toMatchObject({
      name: 'IAMError',
      message: 'IAM request failed with status 503',
      statusCode: 503,
    })
  })

  it('rejects when the socket errors', async () => {
    stubHttps({ error: new Error('socket hang up') })

    await expect(iamClient.iamRequest('ListUsers', {}, CREDS)).rejects.toThrow('socket hang up')
  })
})

// ── aws-client.js ──

describe('aws-client XML helpers', () => {
  it('extracts the first matching tag and all matching tags', () => {
    expect(awsParseXmlTag('<a><b>one</b><b>two</b></a>', 'b')).toBe('one')
    expect(awsParseXmlTag('<a/>', 'b')).toBeNull()
    expect(parseXmlTags('<a><b>one</b><b>two\nlines</b></a>', 'b')).toEqual(['one', 'two\nlines'])
    expect(parseXmlTags('<a/>', 'b')).toEqual([])
  })
})

describe('aws-client httpRequest', () => {
  afterEach(() => {
    https.request.mockReset()
    http.request.mockReset()
  })

  it('sends the body, sets content-length and resolves with the response', async () => {
    const captured = stubHttps({ statusCode: 200, body: '<ok/>' })

    const response = await httpRequest('POST', 'https://iam.amazonaws.com/?a=1', { 'content-type': 'text/plain' }, 'hello')

    expect(captured.options).toMatchObject({
      hostname: 'iam.amazonaws.com',
      port: 443,
      path: '/?a=1',
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'content-length': 5 },
    })

    expect(captured.written).toEqual(['hello'])
    expect(response).toEqual({ statusCode: 200, headers: { 'content-type': 'text/xml' }, body: '<ok/>' })
  })

  it('omits content-length and the write when there is no body', async () => {
    const captured = stubHttps({ statusCode: 204, body: '' })

    await httpRequest('GET', 'https://iam.amazonaws.com/', {})

    expect(captured.options.headers).not.toHaveProperty('content-length')
    expect(captured.written).toEqual([])
  })

  it('uses the plain http transport and port 80 for http:// URLs', async () => {
    const captured = stubTransport(http, { statusCode: 200, body: 'ok' })

    const response = await httpRequest('GET', 'http://localhost/path', {})

    expect(https.request).not.toHaveBeenCalled()
    expect(captured.options).toMatchObject({ port: 80, path: '/path' })
    expect(response.body).toBe('ok')
  })

  it('honours an explicit port', async () => {
    const captured = stubHttps({ statusCode: 200, body: '' })

    await httpRequest('GET', 'https://localhost:4566/', {})

    expect(captured.options.port).toBe('4566')
  })

  it('destroys the request after the 30s timeout', async () => {
    let destroyedWith = null

    https.request.mockImplementation(() => {
      const req = new EventEmitter()

      req.write = jest.fn()

      req.setTimeout = (ms, handler) => {
        expect(ms).toBe(30000)
        handler()
      }

      req.destroy = error => {
        destroyedWith = error
        process.nextTick(() => req.emit('error', error))
      }

      req.end = jest.fn()

      return req
    })

    await expect(httpRequest('GET', 'https://iam.amazonaws.com/', {})).rejects.toThrow('Request timed out')
    expect(destroyedWith).toBeInstanceOf(Error)
  })

  it('rejects on a transport error', async () => {
    stubHttps({ error: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })

    await expect(httpRequest('GET', 'https://iam.amazonaws.com/', {})).rejects.toThrow('connect ECONNREFUSED')
  })

  it('rejects when the response stream errors', async () => {
    https.request.mockImplementation((options, callback) => {
      const req = new EventEmitter()

      req.write = jest.fn()
      req.setTimeout = jest.fn()
      req.destroy = jest.fn()

      req.end = () => {
        process.nextTick(() => {
          const res = new EventEmitter()

          res.statusCode = 200
          res.headers = {}

          callback(res)
          res.emit('error', new Error('stream broke'))
        })
      }

      return req
    })

    await expect(httpRequest('GET', 'https://iam.amazonaws.com/', {})).rejects.toThrow('stream broke')
  })
})

describe('aws-client stsAssumeRole', () => {
  afterEach(() => {
    https.request.mockReset()
  })

  const OK_BODY =
    '<AssumeRoleResponse><AssumeRoleResult><Credentials>' +
    '<AccessKeyId>ASIA123</AccessKeyId>' +
    '<SecretAccessKey>secret123</SecretAccessKey>' +
    '<SessionToken>token123</SessionToken>' +
    '<Expiration>2030-01-01T00:00:00Z</Expiration>' +
    '</Credentials></AssumeRoleResult></AssumeRoleResponse>'

  it('assumes a role and returns the temporary credentials', async () => {
    const captured = stubHttps({ statusCode: 200, body: OK_BODY })

    const result = await stsAssumeRole(CREDS, 'eu-west-1', 'arn:aws:iam::1:role/R', 'session-1', 'ext-1')

    expect(captured.options.hostname).toBe('sts.eu-west-1.amazonaws.com')

    expect(captured.written[0]).toBe(
      'Action=AssumeRole&Version=2011-06-15' +
      '&RoleArn=arn%3Aaws%3Aiam%3A%3A1%3Arole%2FR' +
      '&RoleSessionName=session-1' +
      '&ExternalId=ext-1'
    )

    expect(result).toEqual({
      accessKeyId: 'ASIA123',
      secretAccessKey: 'secret123',
      sessionToken: 'token123',
      expiration: new Date('2030-01-01T00:00:00Z'),
    })
  })

  it('omits the external id when it is not provided', async () => {
    const captured = stubHttps({ statusCode: 200, body: OK_BODY })

    await stsAssumeRole(CREDS, 'us-east-1', 'arn:role', 'session-2')

    expect(captured.written[0]).not.toContain('ExternalId')
  })

  it('throws a named error when STS rejects the request', async () => {
    stubHttps({
      statusCode: 403,
      body: '<ErrorResponse><Error><Code>AccessDenied</Code><Message>Not authorized</Message></Error></ErrorResponse>',
    })

    await expect(stsAssumeRole(CREDS, 'us-east-1', 'arn:role', 's')).rejects.toMatchObject({
      name: 'AccessDenied',
      message: 'Not authorized',
      statusCode: 403,
    })
  })

  it('falls back to a generic STS error name and message', async () => {
    stubHttps({ statusCode: 500, body: '<html/>' })

    await expect(stsAssumeRole(CREDS, 'us-east-1', 'arn:role', 's')).rejects.toMatchObject({
      name: 'STSError',
      message: 'STS AssumeRole failed',
    })
  })

  it('throws a parse error when credential fields are missing', async () => {
    stubHttps({ statusCode: 200, body: '<AssumeRoleResponse><AccessKeyId>only</AccessKeyId></AssumeRoleResponse>' })

    await expect(stsAssumeRole(CREDS, 'us-east-1', 'arn:role', 's')).rejects.toMatchObject({
      name: 'STSParseError',
    })
  })
})

describe('aws-client JSON helpers', () => {
  it('builds an AWS JSON request with a target header', () => {
    expect(buildAwsJsonRequest({
      region: 'us-east-1',
      service: 'dynamodb',
      target: 'DynamoDB_20120810.ListTables',
      body: { Limit: 1 },
      contentType: 'application/x-amz-json-1.0',
    })).toEqual({
      method: 'POST',
      url: 'https://dynamodb.us-east-1.amazonaws.com/',
      headers: {
        'content-type': 'application/x-amz-json-1.0',
        'x-amz-target': 'DynamoDB_20120810.ListTables',
      },
      body: '{"Limit":1}',
    })
  })

  it('passes a string body through, omits the target header and defaults the body', () => {
    const asString = buildAwsJsonRequest({ region: 'us-east-1', service: 'x', body: '{"a":1}', contentType: 'application/json' })

    expect(asString.body).toBe('{"a":1}')
    expect(asString.headers).not.toHaveProperty('x-amz-target')

    expect(buildAwsJsonRequest({ region: 'us-east-1', service: 'x', contentType: 'application/json' }).body).toBe('{}')
  })

  it('parses successful and empty JSON bodies', () => {
    expect(parseJsonResponse({ statusCode: 200, body: '{"a":1}' })).toEqual({ a: 1 })
    expect(parseJsonResponse({ statusCode: 200, body: '  ' })).toEqual({})
    expect(parseJsonResponse({ statusCode: 200 })).toEqual({})
  })

  it('throws a named error for an error status', () => {
    expect.assertions(4)

    try {
      parseJsonResponse({ statusCode: 400, body: '{"__type":"com.amazon.coral#ValidationException","message":"bad input"}' })
    } catch (error) {
      expect(error.name).toBe('ValidationException')
      expect(error.message).toBe('bad input')
      expect(error.statusCode).toBe(400)
    }

    try {
      parseJsonResponse({ statusCode: 403, body: '{"code":"AccessDenied","Message":"nope"}' })
    } catch (error) {
      expect(error.name).toBe('AccessDenied')
    }
  })

  it('falls back to a generic name and message', () => {
    expect.assertions(2)

    try {
      parseJsonResponse({ statusCode: 500, body: '{}' })
    } catch (error) {
      expect(error.name).toBe('AwsError')
      expect(error.message).toBe('Request failed with status 500')
    }
  })

  it('signs and sends a JSON request with an injected transport', async () => {
    const sign = jest.fn()
    const send = jest.fn().mockResolvedValue({ statusCode: 200, body: '{"TableNames":[]}' })

    const result = await jsonRequest(
      { region: 'us-east-1', service: 'dynamodb', target: 'X.Y', body: {}, contentType: 'application/x-amz-json-1.0' },
      CREDS,
      { signRequest: sign, httpRequest: send }
    )

    expect(result).toEqual({ TableNames: [] })

    expect(sign).toHaveBeenCalledWith(
      'POST',
      'https://dynamodb.us-east-1.amazonaws.com/',
      { 'content-type': 'application/x-amz-json-1.0', 'x-amz-target': 'X.Y' },
      '{}',
      CREDS,
      'us-east-1',
      'dynamodb'
    )
  })

  it('uses the real signer and transport when no deps are injected', async () => {
    const captured = stubHttps({ statusCode: 200, body: '{"ok":true}' })

    const result = await jsonRequest(
      { region: 'us-east-1', service: 'dynamodb', target: 'X.Y', body: { a: 1 }, contentType: 'application/x-amz-json-1.0' },
      CREDS
    )

    expect(result).toEqual({ ok: true })
    expect(captured.options.headers.authorization).toContain('AWS4-HMAC-SHA256')

    https.request.mockReset()
  })
})

// ── config-items.js ──

describe('config-items', () => {
  it('declares the AWS config items in display order and never shares them', () => {
    expect(awsConfigItems.map(item => item.name)).toEqual([
      'authenticationMethod', 'region', 'accessKeyId', 'secretAccessKey', 'roleArn', 'externalId',
    ])

    expect(awsConfigItems.every(item => item.shared === false)).toBe(true)
    expect(awsConfigItems.every(item => !('order' in item))).toBe(true)

    expect(awsConfigItems[0]).toMatchObject({
      type: 'CHOICE',
      required: true,
      defaultValue: 'API Key',
      options: ['API Key', 'IAM Role'],
    })

    expect(awsConfigItems[1]).toMatchObject({ type: 'STRING', required: true, defaultValue: 'us-east-1' })
  })
})

// ── sigv4.js ──

/**
 * An independently written SigV4 signer, transcribed from the published AWS
 * "Signature Version 4 signing process" steps rather than from the service's
 * sigv4.js. It only supports the simple request shape used below (root path, no
 * query string), which keeps URI canonicalization out of the comparison while
 * still checking the canonical request, string-to-sign and key derivation.
 */
function referenceAuthorization({ method, url, headers, body, credentials, region, service, amzDate }) {
  const dateStamp = amzDate.slice(0, 8)
  const hash = value => crypto.createHash('sha256').update(value).digest('hex')
  const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest()

  const normalized = new Map()

  Object.keys(headers).forEach(key => normalized.set(key.toLowerCase(), String(headers[key]).trim()))

  const names = [...normalized.keys()].sort()
  const canonicalHeaders = names.map(name => `${ name }:${ normalized.get(name) }\n`).join('')
  const signedHeaders = names.join(';')

  const canonicalRequest = [
    method,
    new URL(url).pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    hash(body),
  ].join('\n')

  const scope = `${ dateStamp }/${ region }/${ service }/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash(canonicalRequest)].join('\n')

  let key = hmac(`AWS4${ credentials.secretAccessKey }`, dateStamp)

  for (const part of [region, service, 'aws4_request']) {
    key = hmac(key, part)
  }

  return `AWS4-HMAC-SHA256 Credential=${ credentials.accessKeyId }/${ scope }, ` +
    `SignedHeaders=${ signedHeaders }, Signature=${ hmac(key, stringToSign).toString('hex') }`
}

describe('sigv4 signRequest', () => {
  const FIXED_ISO = '2024-01-15T12:30:45.123Z'
  const ENDPOINT = 'https://iam.amazonaws.com/'
  const BODY = 'Action=ListUsers&Version=2010-05-08'

  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    jest.setSystemTime(new Date(FIXED_ISO))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  function sign(overrides = {}) {
    const headers = { 'content-type': 'application/x-www-form-urlencoded', ...(overrides.headers || {}) }

    signRequest(
      overrides.method || 'POST',
      overrides.url || ENDPOINT,
      headers,
      overrides.body !== undefined ? overrides.body : BODY,
      overrides.credentials || CREDS,
      overrides.region || 'us-east-1',
      overrides.service || 'iam'
    )

    return headers
  }

  it('sets the deterministic SigV4 headers', () => {
    const headers = sign()

    expect(headers['x-amz-date']).toBe('20240115T123045Z')
    expect(headers.host).toBe('iam.amazonaws.com')
    expect(headers['x-amz-content-sha256']).toBe(crypto.createHash('sha256').update(BODY).digest('hex'))

    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20240115\/us-east-1\/iam\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
    )
  })

  it('matches an independently derived signature', () => {
    const headers = sign()
    const { authorization, ...signedInputs } = headers

    expect(authorization).toBe(referenceAuthorization({
      method: 'POST',
      url: ENDPOINT,
      headers: signedInputs,
      body: BODY,
      credentials: CREDS,
      region: 'us-east-1',
      service: 'iam',
      amzDate: headers['x-amz-date'],
    }))
  })

  it('matches the independent reference for temporary credentials too', () => {
    const credentials = { ...CREDS, sessionToken: 'SESSION' }
    const headers = sign({ credentials })
    const { authorization, ...signedInputs } = headers

    expect(headers['x-amz-security-token']).toBe('SESSION')

    expect(authorization).toBe(referenceAuthorization({
      method: 'POST',
      url: ENDPOINT,
      headers: signedInputs,
      body: BODY,
      credentials,
      region: 'us-east-1',
      service: 'iam',
      amzDate: headers['x-amz-date'],
    }))

    expect(authorization).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
    )
  })

  it('produces a stable signature for identical input', () => {
    expect(sign().authorization).toBe(sign().authorization)
  })

  it('changes the signature when the payload, secret, region, service or method change', () => {
    const baseline = sign().authorization

    expect(sign({ body: `${ BODY }&MaxItems=1` }).authorization).not.toBe(baseline)
    expect(sign({ credentials: { ...CREDS, secretAccessKey: 'OTHER' } }).authorization).not.toBe(baseline)
    expect(sign({ region: 'eu-west-1' }).authorization).not.toBe(baseline)
    expect(sign({ service: 'sts' }).authorization).not.toBe(baseline)
    expect(sign({ method: 'GET' }).authorization).not.toBe(baseline)
  })

  it('hashes an empty payload when no body is given', () => {
    expect(sign({ body: '' })['x-amz-content-sha256']).toBe(crypto.createHash('sha256').update('').digest('hex'))
    expect(sign({ body: null })['x-amz-content-sha256']).toBe(crypto.createHash('sha256').update('').digest('hex'))
  })

  it('keeps an existing host header and includes a non-standard port', () => {
    const explicit = sign({ headers: { Host: 'custom.example.com' } })

    expect(explicit.host).toBeUndefined()
    expect(explicit.Host).toBe('custom.example.com')

    expect(sign({ url: 'https://localhost:4566/' }).host).toBe('localhost:4566')
    expect(sign({ url: 'https://localhost:443/' }).host).toBe('localhost')
  })

  it('sorts the canonical query string so parameter order does not matter', () => {
    const a = sign({ method: 'GET', url: 'https://s3.amazonaws.com/bucket/key?b=2&a=1', body: '', service: 's3' })
    const b = sign({ method: 'GET', url: 'https://s3.amazonaws.com/bucket/key?a=1&b=2', body: '', service: 's3' })

    expect(a.authorization).toBe(b.authorization)
  })

  it('canonicalizes path segments, repeated query keys and non-ASCII characters', () => {
    expect(sign({
      method: 'GET',
      url: 'https://s3.us-east-1.amazonaws.com/my bucket/a+b?a=2&a=1',
      body: '',
      service: 's3',
    }).authorization).toMatch(/Signature=[0-9a-f]{64}$/)

    expect(sign({
      method: 'GET',
      url: 'https://s3.amazonaws.com/b/ünïcodé',
      body: '',
      service: 's3',
    }).authorization).toMatch(/Signature=[0-9a-f]{64}$/)
  })
})

describe('sigv4 generatePresignedUrl', () => {
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    jest.setSystemTime(new Date('2024-01-15T12:30:45.123Z'))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  it('adds the SigV4 query parameters and a signature', () => {
    const url = new URL(
      generatePresignedUrl('GET', 'https://my-bucket.s3.us-east-1.amazonaws.com/some file.txt', CREDS, 'us-east-1', 's3', 900)
    )

    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(url.searchParams.get('X-Amz-Credential')).toBe('AKIDEXAMPLE/20240115/us-east-1/s3/aws4_request')
    expect(url.searchParams.get('X-Amz-Date')).toBe('20240115T123045Z')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(url.searchParams.get('X-Amz-Security-Token')).toBeNull()
  })

  it('includes the session token and reacts to a non-standard port', () => {
    const withToken = new URL(
      generatePresignedUrl('PUT', 'https://localhost:4566/bucket/key', { ...CREDS, sessionToken: 'SESSION' }, 'us-east-1', 's3', 60)
    )

    expect(withToken.searchParams.get('X-Amz-Security-Token')).toBe('SESSION')
    expect(withToken.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces a stable signature that reacts to the expiry window', () => {
    const first = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', CREDS, 'us-east-1', 's3', 60)
    const second = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', CREDS, 'us-east-1', 's3', 60)

    expect(first).toBe(second)

    expect(generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', CREDS, 'us-east-1', 's3', 120)).not.toBe(first)
  })
})
