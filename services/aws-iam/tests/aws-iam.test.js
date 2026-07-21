'use strict'

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
})
