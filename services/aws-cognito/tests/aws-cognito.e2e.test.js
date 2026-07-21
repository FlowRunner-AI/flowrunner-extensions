'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('AWS Cognito Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('aws-cognito')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── User Pools ──

  describe('listUserPools', () => {
    it('returns user pools with expected shape', async () => {
      const result = await service.listUserPools(5)

      expect(result).toHaveProperty('userPools')
      expect(Array.isArray(result.userPools)).toBe(true)
      expect(result).toHaveProperty('nextToken')
    })
  })

  describe('describeUserPool', () => {
    it('returns user pool details', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) {
        console.log('Skipping describeUserPool: no userPoolId in testValues')

        return
      }

      const result = await service.describeUserPool(poolId)

      expect(result).toHaveProperty('userPool')
      expect(result.userPool).toHaveProperty('Id', poolId)
      expect(result.userPool).toHaveProperty('Name')
    })
  })

  // ── App Clients ──

  describe('listUserPoolClients', () => {
    it('returns app clients with expected shape', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) {
        console.log('Skipping listUserPoolClients: no userPoolId in testValues')

        return
      }

      const result = await service.listUserPoolClients(poolId, 5)

      expect(result).toHaveProperty('userPoolClients')
      expect(Array.isArray(result.userPoolClients)).toBe(true)
      expect(result).toHaveProperty('nextToken')
    })
  })

  // ── Users lifecycle: create, get, update, enable/disable, delete ──

  describe('user lifecycle', () => {
    const testUsername = `e2e-test-user-${Date.now()}`

    it('creates a user with suppressed invitation', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) {
        console.log('Skipping user lifecycle: no userPoolId in testValues')

        return
      }

      const result = await service.adminCreateUser(
        poolId,
        testUsername,
        { email: `${testUsername}@example.com`, email_verified: 'true' },
        'TempPass1!',
        'Suppress'
      )

      expect(result).toHaveProperty('user')
      expect(result.user).toHaveProperty('Username')
      expect(result.user).toHaveProperty('Attributes')
      expect(result.user.Attributes).toHaveProperty('email')
    })

    it('gets the created user', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) return

      const result = await service.adminGetUser(poolId, testUsername)

      expect(result).toHaveProperty('username')
      expect(result).toHaveProperty('userStatus')
      expect(result).toHaveProperty('enabled', true)
      expect(result).toHaveProperty('attributes')
      expect(result.attributes).toHaveProperty('email')
    })

    it('lists users and finds the created user', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) return

      const result = await service.listUsers(poolId, `username = "${testUsername}"`, 10)

      expect(result).toHaveProperty('users')
      expect(result.users.length).toBeGreaterThanOrEqual(1)
    })

    it('updates user attributes', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) return

      const result = await service.adminUpdateUserAttributes(poolId, testUsername, { 'custom:note': 'e2e-test' })

      expect(result).toEqual({ success: true })
    })

    it('sets user password permanently', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) return

      const result = await service.adminSetUserPassword(poolId, testUsername, 'Permanent1!', true)

      expect(result).toEqual({ success: true })
    })

    it('disables the user', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) return

      const result = await service.adminDisableUser(poolId, testUsername)

      expect(result).toEqual({ success: true })
    })

    it('enables the user', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) return

      const result = await service.adminEnableUser(poolId, testUsername)

      expect(result).toEqual({ success: true })
    })

    it('deletes the created user', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) return

      const result = await service.adminDeleteUser(poolId, testUsername)

      expect(result).toEqual({ success: true })
    })
  })

  // ── Groups lifecycle: create, get, list, add/remove user, delete ──

  describe('group lifecycle', () => {
    const testGroupName = `e2e-test-group-${Date.now()}`
    const testUsername = `e2e-grp-user-${Date.now()}`

    it('creates a group', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) {
        console.log('Skipping group lifecycle: no userPoolId in testValues')

        return
      }

      const result = await service.createGroup(poolId, testGroupName, 'E2E test group', 99)

      expect(result).toHaveProperty('group')
      expect(result.group).toHaveProperty('GroupName', testGroupName)
    })

    it('gets the created group', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) return

      const result = await service.getGroup(poolId, testGroupName)

      expect(result).toHaveProperty('group')
      expect(result.group).toHaveProperty('GroupName', testGroupName)
      expect(result.group).toHaveProperty('Description', 'E2E test group')
    })

    it('lists groups and finds the created group', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) return

      const result = await service.listGroups(poolId, 60)

      expect(result).toHaveProperty('groups')
      expect(result.groups.some(g => g.GroupName === testGroupName)).toBe(true)
    })

    it('creates a user for group membership tests', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) return

      await service.adminCreateUser(poolId, testUsername, { email: `${testUsername}@example.com`, email_verified: 'true' }, 'TempPass1!', 'Suppress')
    })

    it('adds user to group', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) return

      const result = await service.adminAddUserToGroup(poolId, testUsername, testGroupName)

      expect(result).toEqual({ success: true })
    })

    it('lists groups for user', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) return

      const result = await service.adminListGroupsForUser(poolId, testUsername)

      expect(result).toHaveProperty('groups')
      expect(result.groups.some(g => g.GroupName === testGroupName)).toBe(true)
    })

    it('removes user from group', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) return

      const result = await service.adminRemoveUserFromGroup(poolId, testUsername, testGroupName)

      expect(result).toEqual({ success: true })
    })

    it('cleans up: deletes the test user', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) return

      await service.adminDeleteUser(poolId, testUsername)
    })

    it('deletes the created group', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) return

      const result = await service.deleteGroup(poolId, testGroupName)

      expect(result).toEqual({ success: true })
    })
  })

  // ── Dictionaries ──

  describe('getUserPoolsDictionary', () => {
    it('returns items with expected shape', async () => {
      const result = await service.getUserPoolsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  describe('getGroupsDictionary', () => {
    it('returns items when userPoolId is provided', async () => {
      const poolId = testValues.userPoolId

      if (!poolId) {
        console.log('Skipping getGroupsDictionary: no userPoolId in testValues')

        return
      }

      const result = await service.getGroupsDictionary({ criteria: { userPoolId: poolId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })

    it('returns empty items when no criteria', async () => {
      const result = await service.getGroupsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})
