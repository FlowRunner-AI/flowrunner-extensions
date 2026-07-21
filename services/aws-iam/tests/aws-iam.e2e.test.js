'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('AWS IAM Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('aws-iam')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Account ──

  describe('getAccountSummary', () => {
    it('returns summary with expected keys', async () => {
      const result = await service.getAccountSummary()

      expect(result).toHaveProperty('summary')
      expect(typeof result.summary).toBe('object')
      expect(result.summary).toHaveProperty('Users')
      expect(typeof result.summary.Users).toBe('number')
    })
  })

  describe('listAccountAliases', () => {
    it('returns account aliases array', async () => {
      const result = await service.listAccountAliases()

      expect(result).toHaveProperty('accountAliases')
      expect(Array.isArray(result.accountAliases)).toBe(true)
    })
  })

  // ── Users ──

  describe('listUsers', () => {
    it('returns users with expected shape', async () => {
      const result = await service.listUsers(undefined, 5)

      expect(result).toHaveProperty('users')
      expect(Array.isArray(result.users)).toBe(true)
      expect(result).toHaveProperty('isTruncated')
      expect(typeof result.isTruncated).toBe('boolean')
    })
  })

  describe('user lifecycle: create, get, list access keys, delete', () => {
    const testUserName = `flowrunner-e2e-test-${Date.now()}`

    it('creates a user', async () => {
      const result = await service.createUser(testUserName, '/', [{ key: 'env', value: 'test' }])

      expect(result).toHaveProperty('userId')
      expect(result.userName).toBe(testUserName)
      expect(result).toHaveProperty('arn')
    })

    it('gets the created user', async () => {
      const result = await service.getUser(testUserName)

      expect(result.userName).toBe(testUserName)
      expect(result).toHaveProperty('userId')
      expect(result).toHaveProperty('arn')
    })

    it('lists access keys for the user (should be empty)', async () => {
      const result = await service.listAccessKeys(testUserName)

      expect(result).toHaveProperty('accessKeys')
      expect(Array.isArray(result.accessKeys)).toBe(true)
      expect(result.accessKeys).toHaveLength(0)
    })

    it('lists groups for user (should be empty)', async () => {
      const result = await service.listGroupsForUser(testUserName)

      expect(result).toHaveProperty('groups')
      expect(result.groups).toHaveLength(0)
    })

    it('deletes the created user', async () => {
      const result = await service.deleteUser(testUserName)

      expect(result).toEqual({ success: true, userName: testUserName })
    })
  })

  // ── Groups ──

  describe('listGroups', () => {
    it('returns groups with expected shape', async () => {
      const result = await service.listGroups(undefined, 5)

      expect(result).toHaveProperty('groups')
      expect(Array.isArray(result.groups)).toBe(true)
      expect(result).toHaveProperty('isTruncated')
    })
  })

  describe('group lifecycle: create, get, add user, remove user, delete', () => {
    const testGroupName = `flowrunner-e2e-group-${Date.now()}`
    const testUserName = `flowrunner-e2e-grpuser-${Date.now()}`

    it('creates a group', async () => {
      const result = await service.createGroup(testGroupName)

      expect(result).toHaveProperty('groupId')
      expect(result.groupName).toBe(testGroupName)
    })

    it('gets the created group', async () => {
      const result = await service.getGroup(testGroupName)

      expect(result.group).toHaveProperty('groupId')
      expect(result.group.groupName).toBe(testGroupName)
      expect(result.users).toHaveLength(0)
    })

    it('creates a test user for group membership', async () => {
      const result = await service.createUser(testUserName)

      expect(result.userName).toBe(testUserName)
    })

    it('adds user to group', async () => {
      const result = await service.addUserToGroup(testGroupName, testUserName)

      expect(result).toEqual({ success: true, groupName: testGroupName, userName: testUserName })
    })

    it('verifies user is in group', async () => {
      const result = await service.getGroup(testGroupName)

      expect(result.users).toHaveLength(1)
      expect(result.users[0].userName).toBe(testUserName)
    })

    it('lists groups for user includes the group', async () => {
      const result = await service.listGroupsForUser(testUserName)

      expect(result.groups.some(g => g.groupName === testGroupName)).toBe(true)
    })

    it('removes user from group', async () => {
      const result = await service.removeUserFromGroup(testGroupName, testUserName)

      expect(result).toEqual({ success: true, groupName: testGroupName, userName: testUserName })
    })

    it('cleans up: deletes user', async () => {
      await expect(service.deleteUser(testUserName)).resolves.toEqual({ success: true, userName: testUserName })
    })

    it('cleans up: deletes group', async () => {
      await expect(service.deleteGroup(testGroupName)).resolves.toEqual({ success: true, groupName: testGroupName })
    })
  })

  // ── Roles ──

  describe('listRoles', () => {
    it('returns roles with expected shape', async () => {
      const result = await service.listRoles(undefined, 5)

      expect(result).toHaveProperty('roles')
      expect(Array.isArray(result.roles)).toBe(true)
      expect(result).toHaveProperty('isTruncated')
    })
  })

  describe('role lifecycle: create, get, list attached policies, delete', () => {
    const testRoleName = `flowrunner-e2e-role-${Date.now()}`
    const trustPolicy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [{
        Effect: 'Allow',
        Principal: { Service: 'ec2.amazonaws.com' },
        Action: 'sts:AssumeRole',
      }],
    })

    it('creates a role', async () => {
      const result = await service.createRole(testRoleName, trustPolicy, undefined, 'E2E test role')

      expect(result).toHaveProperty('roleId')
      expect(result.roleName).toBe(testRoleName)
    })

    it('gets the created role', async () => {
      const result = await service.getRole(testRoleName)

      expect(result.roleName).toBe(testRoleName)
      expect(result).toHaveProperty('arn')
      expect(result).toHaveProperty('maxSessionDuration')
    })

    it('lists attached role policies (should be empty)', async () => {
      const result = await service.listAttachedRolePolicies(testRoleName)

      expect(result).toHaveProperty('attachedPolicies')
      expect(result.attachedPolicies).toHaveLength(0)
    })

    it('deletes the created role', async () => {
      const result = await service.deleteRole(testRoleName)

      expect(result).toEqual({ success: true, roleName: testRoleName })
    })
  })

  // ── Policies ──

  describe('listPolicies', () => {
    it('returns policies with expected shape', async () => {
      const result = await service.listPolicies('Customer Managed', false, 5)

      expect(result).toHaveProperty('policies')
      expect(Array.isArray(result.policies)).toBe(true)
      expect(result).toHaveProperty('isTruncated')
    })
  })

  describe('policy lifecycle: create, get, attach to user, detach, delete', () => {
    const testPolicyName = `flowrunner-e2e-policy-${Date.now()}`
    const testUserName = `flowrunner-e2e-poluser-${Date.now()}`
    let policyArn

    const policyDoc = JSON.stringify({
      Version: '2012-10-17',
      Statement: [{
        Effect: 'Allow',
        Action: 's3:ListBucket',
        Resource: '*',
      }],
    })

    it('creates a policy', async () => {
      const result = await service.createPolicy(testPolicyName, policyDoc, 'E2E test policy')

      expect(result).toHaveProperty('policyId')
      expect(result.policyName).toBe(testPolicyName)
      expect(result).toHaveProperty('arn')
      policyArn = result.arn
    })

    it('gets the created policy', async () => {
      const result = await service.getPolicy(policyArn)

      expect(result.policyName).toBe(testPolicyName)
      expect(result.isAttachable).toBe(true)
    })

    it('creates a test user for policy attachment', async () => {
      const result = await service.createUser(testUserName)

      expect(result.userName).toBe(testUserName)
    })

    it('attaches policy to user', async () => {
      const result = await service.attachUserPolicy(testUserName, policyArn)

      expect(result).toEqual({ success: true, userName: testUserName, policyArn })
    })

    it('detaches policy from user', async () => {
      const result = await service.detachUserPolicy(testUserName, policyArn)

      expect(result).toEqual({ success: true, userName: testUserName, policyArn })
    })

    it('cleans up: deletes user', async () => {
      await expect(service.deleteUser(testUserName)).resolves.toEqual({ success: true, userName: testUserName })
    })

    it('cleans up: deletes policy', async () => {
      await expect(service.deletePolicy(policyArn)).resolves.toEqual({ success: true, policyArn })
    })
  })

  // ── Dictionaries ──

  describe('getUsersDictionary', () => {
    it('returns dictionary items with expected shape', async () => {
      const result = await service.getUsersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getRolesDictionary', () => {
    it('returns dictionary items with expected shape', async () => {
      const result = await service.getRolesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getPoliciesDictionary', () => {
    it('returns dictionary items with expected shape', async () => {
      const result = await service.getPoliciesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
