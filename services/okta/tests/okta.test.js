'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-ssws-token'
const ORG_URL = 'https://dev-123456.okta.com'
const BASE = `${ORG_URL}/api/v1`

// The service uses .unwrapBody(false) on every request, so the mock must return
// a response-shaped object { body, headers } instead of raw data.
const wrap = (body, headers) => ({ body, headers: headers || {} })

describe('Okta Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ orgUrl: ORG_URL, apiToken: API_TOKEN })
    require('../src/index.js')
    service = sandbox.getService()
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
          expect.objectContaining({ name: 'orgUrl', required: true, shared: false }),
          expect.objectContaining({ name: 'apiToken', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Auth headers ──

  describe('auth headers', () => {
    it('sends SSWS authorization header on every request', async () => {
      mock.onGet(`${BASE}/users/u1`).reply(wrap({ id: 'u1', status: 'ACTIVE' }))
      await service.getUser('u1')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `SSWS ${API_TOKEN}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws with hint on 401 error', async () => {
      mock.onGet(`${BASE}/users/u1`).replyWithError({
        message: 'Invalid token',
        status: 401,
        body: { errorSummary: 'Invalid token provided' },
      })

      await expect(service.getUser('u1')).rejects.toThrow('Authentication failed')
    })

    it('throws with hint on 403 error', async () => {
      mock.onGet(`${BASE}/users/u1`).replyWithError({
        message: 'Forbidden',
        status: 403,
        body: { errorSummary: 'Not enough permission' },
      })

      await expect(service.getUser('u1')).rejects.toThrow('Insufficient permission')
    })

    it('throws with hint on 404 error', async () => {
      mock.onGet(`${BASE}/users/u1`).replyWithError({
        message: 'Not found',
        status: 404,
        body: { errorSummary: 'Not found: Resource not found' },
      })

      await expect(service.getUser('u1')).rejects.toThrow('Not found')
    })

    it('throws with hint on 429 error', async () => {
      mock.onGet(`${BASE}/users/u1`).replyWithError({
        message: 'Rate limit exceeded',
        status: 429,
        body: { errorSummary: 'Too many requests' },
      })

      await expect(service.getUser('u1')).rejects.toThrow('rate limit')
    })

    it('throws raw message when no hint matches', async () => {
      mock.onGet(`${BASE}/users/u1`).replyWithError({
        message: 'Internal server error',
        status: 500,
        body: { errorSummary: 'Something broke' },
      })

      await expect(service.getUser('u1')).rejects.toThrow('Something broke')
    })
  })

  // ── Users CRUD ──

  describe('createUser', () => {
    it('sends correct POST with required fields', async () => {
      mock.onPost(`${BASE}/users`).reply(wrap({ id: 'u1', status: 'ACTIVE', profile: { firstName: 'Isaac', lastName: 'Brock', email: 'isaac@example.com', login: 'isaac@example.com' } }))

      const result = await service.createUser('Isaac', 'Brock', 'isaac@example.com', 'isaac@example.com')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toMatchObject({
        profile: { firstName: 'Isaac', lastName: 'Brock', email: 'isaac@example.com', login: 'isaac@example.com' },
      })
      expect(mock.history[0].query).toMatchObject({ activate: true })
      expect(result).toHaveProperty('id', 'u1')
    })

    it('includes optional mobilePhone and password', async () => {
      mock.onPost(`${BASE}/users`).reply(wrap({ id: 'u2' }))

      await service.createUser('A', 'B', 'a@b.com', 'a@b.com', '555-1234', 'P@ss1', false)

      expect(mock.history[0].body.profile.mobilePhone).toBe('555-1234')
      expect(mock.history[0].body.credentials).toEqual({ password: { value: 'P@ss1' } })
      expect(mock.history[0].query).toMatchObject({ activate: false })
    })

    it('omits mobilePhone and credentials when not provided', async () => {
      mock.onPost(`${BASE}/users`).reply(wrap({ id: 'u3' }))

      await service.createUser('A', 'B', 'a@b.com', 'a@b.com')

      expect(mock.history[0].body.profile.mobilePhone).toBeUndefined()
      expect(mock.history[0].body.credentials).toBeUndefined()
    })
  })

  describe('getUser', () => {
    it('sends GET to correct path', async () => {
      mock.onGet(`${BASE}/users/u1`).reply(wrap({ id: 'u1', status: 'ACTIVE' }))

      const result = await service.getUser('u1')

      expect(result).toEqual({ id: 'u1', status: 'ACTIVE' })
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('listUsers', () => {
    it('sends defaults when no params', async () => {
      mock.onGet(`${BASE}/users`).reply(wrap([{ id: 'u1' }]))

      const result = await service.listUsers()

      expect(mock.history[0].query).toMatchObject({ limit: 200 })
      expect(result).toEqual({ items: [{ id: 'u1' }], cursor: null })
    })

    it('passes q for quick search', async () => {
      mock.onGet(`${BASE}/users`).reply(wrap([]))

      await service.listUsers('Isaac')

      expect(mock.history[0].query).toMatchObject({ q: 'Isaac' })
    })

    it('passes search expression over q', async () => {
      mock.onGet(`${BASE}/users`).reply(wrap([]))

      await service.listUsers('ignored', 'status eq "ACTIVE"')

      expect(mock.history[0].query).toMatchObject({ search: 'status eq "ACTIVE"' })
      expect(mock.history[0].query.q).toBeUndefined()
    })

    it('includes after cursor', async () => {
      mock.onGet(`${BASE}/users`).reply(wrap([]))

      await service.listUsers(null, null, 50, 'cursor123')

      expect(mock.history[0].query).toMatchObject({ limit: 50, after: 'cursor123' })
    })
  })

  describe('updateUser', () => {
    it('sends partial profile update', async () => {
      mock.onPost(`${BASE}/users/u1`).reply(wrap({ id: 'u1' }))

      await service.updateUser('u1', 'NewFirst', null, 'new@email.com')

      expect(mock.history[0].body).toEqual({
        profile: { firstName: 'NewFirst', email: 'new@email.com' },
      })
    })

    it('omits empty fields from profile', async () => {
      mock.onPost(`${BASE}/users/u1`).reply(wrap({ id: 'u1' }))

      await service.updateUser('u1', '', '', '', '')

      expect(mock.history[0].body).toEqual({ profile: {} })
    })
  })

  describe('deleteUser', () => {
    it('deactivates only when confirmPermanentDelete is false', async () => {
      mock.onGet(`${BASE}/users/u1`).reply(wrap({ id: 'u1', status: 'ACTIVE' }))
      mock.onDelete(`${BASE}/users/u1`).reply(wrap({}))

      const result = await service.deleteUser('u1', false)

      expect(result).toEqual({ deleted: true, userId: 'u1', permanent: false })
    })

    it('deactivates then permanently deletes when confirmPermanentDelete is true', async () => {
      mock.onGet(`${BASE}/users/u1`).reply(wrap({ id: 'u1', status: 'ACTIVE' }))
      mock.onDelete(`${BASE}/users/u1`).reply(wrap({}))

      const result = await service.deleteUser('u1', true)

      expect(result).toEqual({ deleted: true, userId: 'u1', permanent: true })
    })

    it('skips deactivate for already DEPROVISIONED user', async () => {
      mock.onGet(`${BASE}/users/u1`).reply(wrap({ id: 'u1', status: 'DEPROVISIONED' }))
      mock.onDelete(`${BASE}/users/u1`).reply(wrap({}))

      const result = await service.deleteUser('u1', true)

      expect(result).toEqual({ deleted: true, userId: 'u1', permanent: true })
      // Should have: 1 GET (status check) + 1 DELETE (permanent). No deactivate DELETE.
      const deletes = mock.history.filter(h => h.method === 'delete')

      expect(deletes).toHaveLength(1)
    })

    it('returns alreadyGone when user is 404', async () => {
      mock.onGet(`${BASE}/users/u1`).replyWithError({ message: 'Not found', status: 404, body: { status: 404 } })

      const result = await service.deleteUser('u1', true)

      expect(result).toMatchObject({ deleted: true, alreadyGone: true })
    })
  })

  describe('getUserGroups', () => {
    it('returns list result', async () => {
      mock.onGet(`${BASE}/users/u1/groups`).reply(wrap([{ id: 'g1', type: 'OKTA_GROUP' }]))

      const result = await service.getUserGroups('u1')

      expect(result).toEqual({ items: [{ id: 'g1', type: 'OKTA_GROUP' }], cursor: null })
    })
  })

  describe('listAssignedAppLinks', () => {
    it('returns list result for user app links', async () => {
      mock.onGet(`${BASE}/users/u1/appLinks`).reply(wrap([{ appName: 'salesforce' }]))

      const result = await service.listAssignedAppLinks('u1')

      expect(result.items).toHaveLength(1)
    })
  })

  // ── User Lifecycle ──

  describe('activateUser', () => {
    it('sends POST to lifecycle/activate', async () => {
      mock.onPost(`${BASE}/users/u1/lifecycle/activate`).reply(wrap({ activationUrl: 'https://example.com/activate' }))

      const result = await service.activateUser('u1', false)

      expect(mock.history[0].query).toMatchObject({ sendEmail: false })
      expect(result).toHaveProperty('activationUrl')
    })

    it('defaults sendEmail to true', async () => {
      mock.onPost(`${BASE}/users/u1/lifecycle/activate`).reply(wrap({}))

      await service.activateUser('u1')

      expect(mock.history[0].query).toMatchObject({ sendEmail: true })
    })
  })

  describe('deactivateUser', () => {
    it('sends POST and returns status', async () => {
      mock.onPost(`${BASE}/users/u1/lifecycle/deactivate`).reply(wrap({}))

      const result = await service.deactivateUser('u1')

      expect(result).toEqual({ result: 'DEPROVISIONED', userId: 'u1' })
    })

    it('defaults sendEmail to false', async () => {
      mock.onPost(`${BASE}/users/u1/lifecycle/deactivate`).reply(wrap({}))

      await service.deactivateUser('u1')

      expect(mock.history[0].query).toMatchObject({ sendEmail: false })
    })
  })

  describe('suspendUser', () => {
    it('sends POST and returns SUSPENDED', async () => {
      mock.onPost(`${BASE}/users/u1/lifecycle/suspend`).reply(wrap({}))

      const result = await service.suspendUser('u1')

      expect(result).toEqual({ result: 'SUSPENDED', userId: 'u1' })
    })
  })

  describe('unsuspendUser', () => {
    it('sends POST and returns ACTIVE', async () => {
      mock.onPost(`${BASE}/users/u1/lifecycle/unsuspend`).reply(wrap({}))

      const result = await service.unsuspendUser('u1')

      expect(result).toEqual({ result: 'ACTIVE', userId: 'u1' })
    })
  })

  describe('unlockUser', () => {
    it('sends POST and returns ACTIVE', async () => {
      mock.onPost(`${BASE}/users/u1/lifecycle/unlock`).reply(wrap({}))

      const result = await service.unlockUser('u1')

      expect(result).toEqual({ result: 'ACTIVE', userId: 'u1' })
    })
  })

  describe('expirePassword', () => {
    it('sends POST to lifecycle/expire_password', async () => {
      mock.onPost(`${BASE}/users/u1/lifecycle/expire_password`).reply(wrap({ id: 'u1', status: 'PASSWORD_EXPIRED' }))

      const result = await service.expirePassword('u1')

      expect(result).toMatchObject({ status: 'PASSWORD_EXPIRED' })
    })
  })

  describe('resetPassword', () => {
    it('sends POST with sendEmail query', async () => {
      mock.onPost(`${BASE}/users/u1/lifecycle/reset_password`).reply(wrap({ resetPasswordUrl: 'https://example.com/reset' }))

      const result = await service.resetPassword('u1', false)

      expect(mock.history[0].query).toMatchObject({ sendEmail: false })
      expect(result).toHaveProperty('resetPasswordUrl')
    })
  })

  describe('resetFactors', () => {
    it('sends POST and returns RESET', async () => {
      mock.onPost(`${BASE}/users/u1/lifecycle/reset_factors`).reply(wrap({}))

      const result = await service.resetFactors('u1')

      expect(result).toEqual({ result: 'RESET', userId: 'u1' })
    })
  })

  describe('changePassword', () => {
    it('sends correct body with old and new password', async () => {
      mock.onPost(`${BASE}/users/u1/credentials/change_password`).reply(wrap({ credentials: {} }))

      await service.changePassword('u1', 'old123', 'new456', true)

      expect(mock.history[0].body).toEqual({
        oldPassword: { value: 'old123' },
        newPassword: { value: 'new456' },
        revokeSessions: true,
      })
    })

    it('defaults revokeSessions to false', async () => {
      mock.onPost(`${BASE}/users/u1/credentials/change_password`).reply(wrap({ credentials: {} }))

      await service.changePassword('u1', 'old', 'new')

      expect(mock.history[0].body.revokeSessions).toBe(false)
    })
  })

  describe('setPassword', () => {
    it('sends credential body via POST', async () => {
      mock.onPost(`${BASE}/users/u1`).reply(wrap({ id: 'u1', status: 'ACTIVE' }))

      await service.setPassword('u1', 'NewP@ss1')

      expect(mock.history[0].body).toEqual({ credentials: { password: { value: 'NewP@ss1' } } })
    })
  })

  // ── Groups ──

  describe('createGroup', () => {
    it('sends POST with name and description', async () => {
      mock.onPost(`${BASE}/groups`).reply(wrap({ id: 'g1', type: 'OKTA_GROUP', profile: { name: 'Eng' } }))

      const result = await service.createGroup('Eng', 'Engineers')

      expect(mock.history[0].body).toEqual({ profile: { name: 'Eng', description: 'Engineers' } })
      expect(result).toHaveProperty('id', 'g1')
    })

    it('omits description when not provided', async () => {
      mock.onPost(`${BASE}/groups`).reply(wrap({ id: 'g2' }))

      await service.createGroup('Sales')

      expect(mock.history[0].body).toEqual({ profile: { name: 'Sales' } })
    })
  })

  describe('getGroup', () => {
    it('fetches group by id', async () => {
      mock.onGet(`${BASE}/groups/g1`).reply(wrap({ id: 'g1', type: 'OKTA_GROUP' }))

      const result = await service.getGroup('g1')

      expect(result).toEqual({ id: 'g1', type: 'OKTA_GROUP' })
    })
  })

  describe('listGroups', () => {
    it('returns list with defaults', async () => {
      mock.onGet(`${BASE}/groups`).reply(wrap([{ id: 'g1' }]))

      const result = await service.listGroups()

      expect(mock.history[0].query).toMatchObject({ limit: 200 })
      expect(result.items).toHaveLength(1)
    })

    it('uses search expression over q', async () => {
      mock.onGet(`${BASE}/groups`).reply(wrap([]))

      await service.listGroups('ignored', 'type eq "OKTA_GROUP"')

      expect(mock.history[0].query.search).toBe('type eq "OKTA_GROUP"')
      expect(mock.history[0].query.q).toBeUndefined()
    })
  })

  describe('updateGroup', () => {
    it('sends PUT with profile', async () => {
      mock.onPut(`${BASE}/groups/g1`).reply(wrap({ id: 'g1' }))

      await service.updateGroup('g1', 'NewName', 'NewDesc')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ profile: { name: 'NewName', description: 'NewDesc' } })
    })
  })

  describe('deleteGroup', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${BASE}/groups/g1`).reply(wrap({}))

      const result = await service.deleteGroup('g1')

      expect(result).toEqual({ deleted: true, groupId: 'g1' })
    })
  })

  describe('addUserToGroup', () => {
    it('sends PUT to correct path', async () => {
      mock.onPut(`${BASE}/groups/g1/users/u1`).reply(wrap({}))

      const result = await service.addUserToGroup('g1', 'u1')

      expect(result).toEqual({ added: true, groupId: 'g1', userId: 'u1' })
    })
  })

  describe('removeUserFromGroup', () => {
    it('sends DELETE to correct path', async () => {
      mock.onDelete(`${BASE}/groups/g1/users/u1`).reply(wrap({}))

      const result = await service.removeUserFromGroup('g1', 'u1')

      expect(result).toEqual({ removed: true, groupId: 'g1', userId: 'u1' })
    })
  })

  describe('listGroupMembers', () => {
    it('sends GET with defaults', async () => {
      mock.onGet(`${BASE}/groups/g1/users`).reply(wrap([{ id: 'u1' }]))

      const result = await service.listGroupMembers('g1')

      expect(mock.history[0].query).toMatchObject({ limit: 200 })
      expect(result.items).toHaveLength(1)
    })

    it('passes limit and after', async () => {
      mock.onGet(`${BASE}/groups/g1/users`).reply(wrap([]))

      await service.listGroupMembers('g1', 10, 'cursorABC')

      expect(mock.history[0].query).toMatchObject({ limit: 10, after: 'cursorABC' })
    })
  })

  describe('listAssignedAppsForGroup', () => {
    it('returns apps for group', async () => {
      mock.onGet(`${BASE}/groups/g1/apps`).reply(wrap([{ id: 'app1', name: 'salesforce' }]))

      const result = await service.listAssignedAppsForGroup('g1')

      expect(result.items).toHaveLength(1)
    })
  })

  // ── Group Rules ──

  describe('createGroupRule', () => {
    it('sends correct body', async () => {
      mock.onPost(`${BASE}/groups/rules`).reply(wrap({ id: 'r1', status: 'INACTIVE' }))

      await service.createGroupRule('My Rule', 'user.role=="Eng"', ['g1', 'g2'], ['u99'])

      expect(mock.history[0].body).toMatchObject({
        type: 'group_rule',
        name: 'My Rule',
        conditions: {
          expression: { value: 'user.role=="Eng"', type: 'urn:okta:expression:1.0' },
          people: { users: { exclude: ['u99'] }, groups: { exclude: [] } },
        },
        actions: { assignUserToGroups: { groupIds: ['g1', 'g2'] } },
      })
    })

    it('handles comma-separated groupIds', async () => {
      mock.onPost(`${BASE}/groups/rules`).reply(wrap({ id: 'r2' }))

      await service.createGroupRule('Rule2', 'true', 'g1,g2')

      expect(mock.history[0].body.actions.assignUserToGroups.groupIds).toEqual(['g1', 'g2'])
    })
  })

  describe('listGroupRules', () => {
    it('sends GET with default limit', async () => {
      mock.onGet(`${BASE}/groups/rules`).reply(wrap([{ id: 'r1' }]))

      const result = await service.listGroupRules()

      expect(mock.history[0].query).toMatchObject({ limit: 50 })
      expect(result.items).toHaveLength(1)
    })
  })

  describe('activateGroupRule', () => {
    it('sends POST to lifecycle/activate', async () => {
      mock.onPost(`${BASE}/groups/rules/r1/lifecycle/activate`).reply(wrap({}))

      const result = await service.activateGroupRule('r1')

      expect(result).toEqual({ activated: true, ruleId: 'r1' })
    })
  })

  // ── Applications ──

  describe('listApplications', () => {
    it('returns list with defaults', async () => {
      mock.onGet(`${BASE}/apps`).reply(wrap([{ id: 'app1' }]))

      const result = await service.listApplications()

      expect(mock.history[0].query).toMatchObject({ limit: 20 })
      expect(result.items).toHaveLength(1)
    })
  })

  describe('getApplication', () => {
    it('fetches app by id', async () => {
      mock.onGet(`${BASE}/apps/app1`).reply(wrap({ id: 'app1', label: 'My App' }))

      const result = await service.getApplication('app1')

      expect(result).toMatchObject({ id: 'app1', label: 'My App' })
    })
  })

  describe('assignUserToApplication', () => {
    it('sends POST with user assignment', async () => {
      mock.onPost(`${BASE}/apps/app1/users`).reply(wrap({ id: 'au1' }))

      await service.assignUserToApplication('app1', 'u1', 'jsmith')

      expect(mock.history[0].body).toMatchObject({ id: 'u1', credentials: { userName: 'jsmith' } })
    })
  })

  describe('unassignUserFromApplication', () => {
    it('sends DELETE', async () => {
      mock.onDelete(`${BASE}/apps/app1/users/u1`).reply(wrap({}))

      const result = await service.unassignUserFromApplication('app1', 'u1')

      expect(result).toEqual({ removed: true, appId: 'app1', userId: 'u1' })
    })
  })

  describe('assignGroupToApplication', () => {
    it('sends PUT with group assignment', async () => {
      mock.onPut(`${BASE}/apps/app1/groups/g1`).reply(wrap({ id: 'ag1' }))

      await service.assignGroupToApplication('app1', 'g1', 5)

      expect(mock.history[0].body).toMatchObject({ priority: 5 })
    })
  })

  describe('removeGroupFromApplication', () => {
    it('sends DELETE', async () => {
      mock.onDelete(`${BASE}/apps/app1/groups/g1`).reply(wrap({}))

      const result = await service.removeGroupFromApplication('app1', 'g1')

      expect(result).toEqual({ removed: true, appId: 'app1', groupId: 'g1' })
    })
  })

  // ── Admin Roles ──

  describe('assignRoleToUser', () => {
    it('sends POST with role type', async () => {
      mock.onPost(`${BASE}/users/u1/roles`).reply(wrap({ id: 'ra1', type: 'SUPER_ADMIN' }))

      await service.assignRoleToUser('u1', 'Super Administrator')

      expect(mock.history[0].body).toMatchObject({ type: 'SUPER_ADMIN' })
    })
  })

  describe('listRolesAssignedToUser', () => {
    it('returns role list', async () => {
      mock.onGet(`${BASE}/users/u1/roles`).reply(wrap([{ id: 'ra1', type: 'SUPER_ADMIN' }]))

      const result = await service.listRolesAssignedToUser('u1')

      expect(result.items).toHaveLength(1)
    })
  })

  describe('removeRoleFromUser', () => {
    it('sends DELETE', async () => {
      mock.onDelete(`${BASE}/users/u1/roles/ra1`).reply(wrap({}))

      const result = await service.removeRoleFromUser('u1', 'ra1')

      expect(result).toEqual({ removed: true, userId: 'u1', roleAssignmentId: 'ra1' })
    })
  })

  // ── Factors (MFA) ──

  describe('listFactors', () => {
    it('returns enrolled factors', async () => {
      mock.onGet(`${BASE}/users/u1/factors`).reply(wrap([{ id: 'f1', factorType: 'sms' }]))

      const result = await service.listFactors('u1')

      expect(result.items).toHaveLength(1)
    })
  })

  describe('enrollFactor', () => {
    it('sends POST with sms factor', async () => {
      mock.onPost(`${BASE}/users/u1/factors`).reply(wrap({ id: 'f1', factorType: 'sms', status: 'PENDING_ACTIVATION' }))

      await service.enrollFactor('u1', 'SMS (Text Message)', 'Okta', '+15551234')

      expect(mock.history[0].body).toMatchObject({
        factorType: 'sms',
        provider: 'OKTA',
        profile: { phoneNumber: '+15551234' },
      })
    })
  })

  describe('resetFactor', () => {
    it('sends DELETE', async () => {
      mock.onDelete(`${BASE}/users/u1/factors/f1`).reply(wrap({}))

      const result = await service.resetFactor('u1', 'f1')

      expect(result).toMatchObject({ userId: 'u1', factorId: 'f1' })
    })
  })

  // ── System Logs ──

  describe('getLogs', () => {
    it('sends GET with default params', async () => {
      mock.onGet(`${BASE}/logs`).reply(wrap([{ uuid: 'ev1' }]))

      const result = await service.getLogs()

      expect(result.items).toHaveLength(1)
      // getLogs does not set a default limit
      expect(mock.history[0].query).toEqual({})
    })

    it('passes all filters', async () => {
      mock.onGet(`${BASE}/logs`).reply(wrap([]))

      await service.getLogs('2024-01-01', '2024-01-31', 'User Created', 'search', 'Newest First', 50, 'cursor1')

      expect(mock.history[0].query).toMatchObject({
        since: '2024-01-01',
        until: '2024-01-31',
        filter: 'eventType eq "User Created"',
        q: 'search',
        sortOrder: 'DESCENDING',
        limit: 50,
        after: 'cursor1',
      })
    })
  })

  // ── Network Zones ──

  describe('listNetworkZones', () => {
    it('returns zones', async () => {
      mock.onGet(`${BASE}/zones`).reply(wrap([{ id: 'z1', name: 'HQ' }]))

      const result = await service.listNetworkZones()

      expect(result.items).toHaveLength(1)
    })
  })

  describe('createNetworkZone', () => {
    it('sends POST with IP zone', async () => {
      mock.onPost(`${BASE}/zones`).reply(wrap({ id: 'z1', type: 'IP' }))

      await service.createNetworkZone('HQ', 'IP', 'Policy', 'Active', [{ type: 'CIDR', value: '1.2.3.0/24' }])

      expect(mock.history[0].body).toMatchObject({
        name: 'HQ',
        type: 'IP',
        usage: 'POLICY',
        status: 'ACTIVE',
      })
    })
  })

  describe('deleteNetworkZone', () => {
    it('sends DELETE', async () => {
      mock.onDelete(`${BASE}/zones/z1`).reply(wrap({}))

      const result = await service.deleteNetworkZone('z1')

      expect(result).toEqual({ deleted: true, zoneId: 'z1' })
    })
  })

  // ── Trusted Origins ──

  describe('listTrustedOrigins', () => {
    it('returns list', async () => {
      mock.onGet(`${BASE}/trustedOrigins`).reply(wrap([{ id: 'to1' }]))

      const result = await service.listTrustedOrigins()

      expect(result.items).toHaveLength(1)
    })
  })

  describe('createTrustedOrigin', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${BASE}/trustedOrigins`).reply(wrap({ id: 'to1' }))

      await service.createTrustedOrigin('My App', 'https://example.com', 'CORS,Redirect')

      expect(mock.history[0].body).toMatchObject({
        name: 'My App',
        origin: 'https://example.com',
        scopes: expect.arrayContaining([
          expect.objectContaining({ type: 'CORS' }),
          expect.objectContaining({ type: 'REDIRECT' }),
        ]),
      })
    })
  })

  describe('deleteTrustedOrigin', () => {
    it('sends DELETE', async () => {
      mock.onDelete(`${BASE}/trustedOrigins/to1`).reply(wrap({}))

      const result = await service.deleteTrustedOrigin('to1')

      expect(result).toEqual({ deleted: true, trustedOriginId: 'to1' })
    })
  })

  // ── Event Hooks ──

  describe('listEventHooks', () => {
    it('returns hooks list', async () => {
      mock.onGet(`${BASE}/eventHooks`).reply(wrap([{ id: 'eh1', name: 'My Hook' }]))

      const result = await service.listEventHooks()

      expect(result.items).toHaveLength(1)
    })
  })

  describe('createEventHook', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${BASE}/eventHooks`).reply(wrap({ id: 'eh1' }))

      await service.createEventHook('Hook1', ['user.lifecycle.create'], 'https://example.com/hook', 'Authorization', 'Bearer xyz')

      expect(mock.history[0].body).toMatchObject({
        name: 'Hook1',
        events: { type: 'EVENT_TYPE', items: ['user.lifecycle.create'] },
        channel: {
          type: 'HTTP',
          version: '1.0.0',
          config: {
            uri: 'https://example.com/hook',
            authScheme: { type: 'HEADER', key: 'Authorization', value: 'Bearer xyz' },
          },
        },
      })
    })
  })

  describe('deleteEventHook', () => {
    it('sends DELETE', async () => {
      mock.onDelete(`${BASE}/eventHooks/eh1`).reply(wrap({}))

      const result = await service.deleteEventHook('eh1')

      expect(result).toEqual({ deleted: true, eventHookId: 'eh1' })
    })
  })

  // ── Authorization Servers ──

  describe('listAuthorizationServers', () => {
    it('returns list', async () => {
      mock.onGet(`${BASE}/authorizationServers`).reply(wrap([{ id: 'as1' }]))

      const result = await service.listAuthorizationServers()

      expect(result.items).toHaveLength(1)
    })
  })

  describe('createAuthorizationServer', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${BASE}/authorizationServers`).reply(wrap({ id: 'as1' }))

      await service.createAuthorizationServer('My Server', 'api://default', 'desc', 'Org URL')

      expect(mock.history[0].body).toMatchObject({
        name: 'My Server',
        audiences: ['api://default'],
        description: 'desc',
        issuerMode: 'ORG_URL',
      })
    })
  })

  describe('deleteAuthorizationServer', () => {
    it('sends DELETE', async () => {
      mock.onDelete(`${BASE}/authorizationServers/as1`).reply(wrap({}))

      const result = await service.deleteAuthorizationServer('as1')

      expect(result).toEqual({ deleted: true, authServerId: 'as1' })
    })
  })

  // ── OAuth2 Scopes ──

  describe('listOAuth2Scopes', () => {
    it('returns scopes for auth server', async () => {
      mock.onGet(`${BASE}/authorizationServers/as1/scopes`).reply(wrap([{ id: 's1', name: 'read' }]))

      const result = await service.listOAuth2Scopes('as1')

      expect(result.items).toHaveLength(1)
    })
  })

  describe('createOAuth2Scope', () => {
    it('sends POST with scope data', async () => {
      mock.onPost(`${BASE}/authorizationServers/as1/scopes`).reply(wrap({ id: 's1' }))

      await service.createOAuth2Scope('as1', 'read', 'Read Access', 'Read only', 'Implicit (no dialog)', 'No Clients')

      expect(mock.history[0].body).toMatchObject({
        name: 'read',
        displayName: 'Read Access',
        description: 'Read only',
        consent: 'IMPLICIT',
        metadataPublish: 'NO_CLIENTS',
      })
    })
  })

  // ── Policies ──

  describe('listPolicies', () => {
    it('sends GET with type', async () => {
      mock.onGet(`${BASE}/policies`).reply(wrap([{ id: 'p1' }]))

      await service.listPolicies('Global Session (Okta Sign-On)')

      expect(mock.history[0].query).toMatchObject({ type: 'OKTA_SIGN_ON' })
    })
  })

  describe('deletePolicy', () => {
    it('sends DELETE', async () => {
      mock.onDelete(`${BASE}/policies/p1`).reply(wrap({}))

      const result = await service.deletePolicy('p1')

      expect(result).toEqual({ deleted: true, policyId: 'p1' })
    })
  })

  // ── Sessions ──

  describe('getSession', () => {
    it('fetches session by id', async () => {
      mock.onGet(`${BASE}/sessions/sess1`).reply(wrap({ id: 'sess1', status: 'ACTIVE' }))

      const result = await service.getSession('sess1')

      expect(result).toMatchObject({ id: 'sess1' })
    })
  })

  describe('revokeSession', () => {
    it('sends DELETE', async () => {
      mock.onDelete(`${BASE}/sessions/sess1`).reply(wrap({}))

      const result = await service.revokeSession('sess1')

      expect(result).toEqual({ revoked: true, sessionId: 'sess1' })
    })
  })

  // ── Authenticators ──

  describe('listAuthenticators', () => {
    it('returns authenticators', async () => {
      mock.onGet(`${BASE}/authenticators`).reply(wrap([{ id: 'auth1', type: 'email' }]))

      const result = await service.listAuthenticators()

      expect(result.items).toHaveLength(1)
    })
  })

  // ── Identity Providers ──

  describe('listIdentityProviders', () => {
    it('returns IdPs', async () => {
      mock.onGet(`${BASE}/idps`).reply(wrap([{ id: 'idp1', name: 'Google' }]))

      const result = await service.listIdentityProviders()

      expect(result.items).toHaveLength(1)
    })

    it('passes type filter', async () => {
      mock.onGet(`${BASE}/idps`).reply(wrap([]))

      await service.listIdentityProviders(null, 'Google')

      expect(mock.history[0].query).toMatchObject({ type: 'GOOGLE' })
    })
  })

  // ── Devices ──

  describe('listDevices', () => {
    it('returns device list', async () => {
      mock.onGet(`${BASE}/devices`).reply(wrap([{ id: 'd1' }]))

      const result = await service.listDevices()

      expect(result.items).toHaveLength(1)
    })
  })

  describe('deleteDevice', () => {
    it('sends DELETE', async () => {
      mock.onDelete(`${BASE}/devices/d1`).reply(wrap({}))

      const result = await service.deleteDevice('d1')

      expect(result).toEqual({ deleted: true, deviceId: 'd1' })
    })
  })

  // ── Threat Insight ──

  describe('getThreatInsightConfiguration', () => {
    it('fetches config', async () => {
      mock.onGet(`${BASE}/threats/configuration`).reply(wrap({ action: 'audit', excludeZones: [] }))

      const result = await service.getThreatInsightConfiguration()

      expect(result).toMatchObject({ action: 'audit' })
    })
  })

  // ── User Types ──

  describe('listUserTypes', () => {
    it('returns user types', async () => {
      mock.onGet(`${BASE}/meta/types/user`).reply(wrap([{ id: 'ut1', name: 'default' }]))

      const result = await service.listUserTypes()

      expect(result.items).toHaveLength(1)
    })
  })

  describe('createUserType', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${BASE}/meta/types/user`).reply(wrap({ id: 'ut1' }))

      await service.createUserType('contractor', 'Contractor', 'External contractors')

      expect(mock.history[0].body).toEqual({
        name: 'contractor',
        displayName: 'Contractor',
        description: 'External contractors',
      })
    })
  })

  describe('deleteUserType', () => {
    it('sends DELETE', async () => {
      mock.onDelete(`${BASE}/meta/types/user/ut1`).reply(wrap({}))

      const result = await service.deleteUserType('ut1')

      expect(result).toEqual({ deleted: true, typeId: 'ut1' })
    })
  })

  // ── Behavior Rules ──

  describe('listBehaviorRules', () => {
    it('returns rules', async () => {
      mock.onGet(`${BASE}/behaviors`).reply(wrap([{ id: 'b1' }]))

      const result = await service.listBehaviorRules()

      expect(result.items).toHaveLength(1)
    })
  })

  describe('deleteBehaviorRule', () => {
    it('sends DELETE', async () => {
      mock.onDelete(`${BASE}/behaviors/b1`).reply(wrap({}))

      const result = await service.deleteBehaviorRule('b1')

      expect(result).toEqual({ deleted: true, behaviorId: 'b1' })
    })
  })

  // ── Linked Object Definitions ──

  describe('listLinkedObjectDefinitions', () => {
    it('returns definitions', async () => {
      mock.onGet(`${BASE}/meta/schemas/user/linkedObjects`).reply(wrap([{ primary: { name: 'manager' } }]))

      const result = await service.listLinkedObjectDefinitions()

      expect(result.items).toHaveLength(1)
    })
  })

  // ── Profile Mappings ──

  describe('listProfileMappings', () => {
    it('returns mappings', async () => {
      mock.onGet(`${BASE}/mappings`).reply(wrap([{ id: 'pm1' }]))

      const result = await service.listProfileMappings()

      expect(result.items).toHaveLength(1)
    })
  })

  // ── Schemas ──

  describe('getGroupSchema', () => {
    it('fetches group schema', async () => {
      mock.onGet(`${BASE}/meta/schemas/group/default`).reply(wrap({ definitions: {} }))

      const result = await service.getGroupSchema()

      expect(result).toHaveProperty('definitions')
    })
  })

  // ── User Grants ──

  describe('listUserGrants', () => {
    it('returns grants for user', async () => {
      mock.onGet(`${BASE}/users/u1/grants`).reply(wrap([{ id: 'gr1' }]))

      const result = await service.listUserGrants('u1')

      expect(result.items).toHaveLength(1)
    })
  })

  describe('revokeUserGrants', () => {
    it('sends DELETE', async () => {
      mock.onDelete(`${BASE}/users/u1/grants`).reply(wrap({}))

      const result = await service.revokeUserGrants('u1')

      expect(result).toEqual({ revoked: true, userId: 'u1', scope: 'all' })
    })
  })

  // ── Dictionary Methods ──

  describe('getUsersDictionary', () => {
    it('returns mapped items with label and value', async () => {
      mock.onGet(`${BASE}/users`).reply(wrap([
        { id: 'u1', status: 'ACTIVE', profile: { firstName: 'John', lastName: 'Doe', email: 'john@example.com' } },
      ]))

      const result = await service.getUsersDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({
        label: expect.stringContaining('John'),
        value: 'u1',
        note: 'Status: ACTIVE',
      })
      expect(result.cursor).toBeNull()
    })

    it('passes search as q', async () => {
      mock.onGet(`${BASE}/users`).reply(wrap([]))

      await service.getUsersDictionary({ search: 'test' })

      expect(mock.history[0].query).toMatchObject({ q: 'test' })
    })

    it('passes cursor as after', async () => {
      mock.onGet(`${BASE}/users`).reply(wrap([]))

      await service.getUsersDictionary({ cursor: 'abc' })

      expect(mock.history[0].query).toMatchObject({ after: 'abc' })
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/users`).reply(wrap([{ id: 'u1', status: 'ACTIVE', profile: { firstName: 'A', lastName: 'B', email: 'a@b.com' } }]))

      const result = await service.getUsersDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('handles empty/null body', async () => {
      mock.onGet(`${BASE}/users`).reply(wrap(null))

      const result = await service.getUsersDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getGroupsDictionary', () => {
    it('returns mapped groups', async () => {
      mock.onGet(`${BASE}/groups`).reply(wrap([{ id: 'g1', type: 'OKTA_GROUP', profile: { name: 'Engineers' } }]))

      const result = await service.getGroupsDictionary({})

      expect(result.items[0]).toMatchObject({
        label: 'Engineers',
        value: 'g1',
        note: 'Type: OKTA_GROUP',
      })
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/groups`).reply(wrap([]))

      const result = await service.getGroupsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getApplicationsDictionary', () => {
    it('returns mapped apps', async () => {
      mock.onGet(`${BASE}/apps`).reply(wrap([{ id: 'app1', name: 'salesforce', label: 'Salesforce', status: 'ACTIVE' }]))

      const result = await service.getApplicationsDictionary({})

      expect(result.items[0]).toMatchObject({
        label: 'Salesforce',
        value: 'app1',
      })
    })
  })

  describe('getEventTypesDictionary', () => {
    it('returns curated event types', async () => {
      const result = await service.getEventTypesDictionary({})

      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })

    it('filters by search', async () => {
      const result = await service.getEventTypesDictionary({ search: 'user created' })

      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0].value).toBe('user.lifecycle.create')
    })

    it('returns empty for no-match search', async () => {
      const result = await service.getEventTypesDictionary({ search: 'xyznonexistent' })

      expect(result.items).toHaveLength(0)
    })
  })

  // ── Polling Trigger ──

  describe('onNewSystemLogEvent', () => {
    it('returns empty events on first poll (no state)', async () => {
      const result = await service.onNewSystemLogEvent({ triggerData: {}, state: null })

      expect(result.events).toEqual([])
      expect(result.state).toHaveProperty('since')
      expect(result.state).toHaveProperty('seenUuids')
    })

    it('fetches new events on subsequent polls', async () => {
      mock.onGet(`${BASE}/logs`).reply(wrap([
        { uuid: 'ev1', published: '2024-01-01T12:00:00Z', eventType: 'user.lifecycle.create' },
        { uuid: 'ev2', published: '2024-01-01T12:01:00Z', eventType: 'user.lifecycle.activate' },
      ]))

      const result = await service.onNewSystemLogEvent({
        triggerData: {},
        state: { since: '2024-01-01T00:00:00Z', seenUuids: [] },
      })

      expect(result.events).toHaveLength(2)
      expect(result.state.since).toBe('2024-01-01T12:01:00Z')
    })

    it('filters by event type', async () => {
      mock.onGet(`${BASE}/logs`).reply(wrap([]))

      await service.onNewSystemLogEvent({
        triggerData: { eventType: 'User Created' },
        state: { since: '2024-01-01T00:00:00Z', seenUuids: [] },
      })

      expect(mock.history[0].query).toMatchObject({
        filter: 'eventType eq "user.lifecycle.create"',
      })
    })

    it('deduplicates seen UUIDs', async () => {
      mock.onGet(`${BASE}/logs`).reply(wrap([
        { uuid: 'ev1', published: '2024-01-01T12:00:00Z', eventType: 'user.lifecycle.create' },
        { uuid: 'ev2', published: '2024-01-01T12:01:00Z', eventType: 'user.lifecycle.activate' },
      ]))

      const result = await service.onNewSystemLogEvent({
        triggerData: {},
        state: { since: '2024-01-01T00:00:00Z', seenUuids: ['ev1'] },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].uuid).toBe('ev2')
    })

    it('returns same state when no fresh events', async () => {
      mock.onGet(`${BASE}/logs`).reply(wrap([
        { uuid: 'ev1', published: '2024-01-01T12:00:00Z', eventType: 'user.lifecycle.create' },
      ]))

      const state = { since: '2024-01-01T00:00:00Z', seenUuids: ['ev1'] }
      const result = await service.onNewSystemLogEvent({ triggerData: {}, state })

      expect(result.events).toEqual([])
      expect(result.state).toBe(state)
    })
  })

  // ── handleTriggerPollingForEvent ──

  describe('handleTriggerPollingForEvent', () => {
    it('delegates to the named event method', async () => {
      mock.onGet(`${BASE}/logs`).reply(wrap([]))

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewSystemLogEvent',
        triggerData: {},
        state: { since: '2024-01-01T00:00:00Z', seenUuids: [] },
      })

      expect(result).toHaveProperty('events')
      expect(result).toHaveProperty('state')
    })
  })

  // ── Authorization Server Policies ──

  describe('listAuthorizationServerPolicies', () => {
    it('returns policies for auth server', async () => {
      mock.onGet(`${BASE}/authorizationServers/as1/policies`).reply(wrap([{ id: 'pol1' }]))

      const result = await service.listAuthorizationServerPolicies('as1')

      expect(result.items).toHaveLength(1)
    })
  })

  describe('deleteAuthorizationServerPolicy', () => {
    it('sends DELETE', async () => {
      mock.onDelete(`${BASE}/authorizationServers/as1/policies/pol1`).reply(wrap({}))

      const result = await service.deleteAuthorizationServerPolicy('as1', 'pol1')

      expect(result).toEqual({ deleted: true, policyId: 'pol1' })
    })
  })

  // ── Inline Hooks ──

  describe('listInlineHooks', () => {
    it('returns hooks', async () => {
      mock.onGet(`${BASE}/inlineHooks`).reply(wrap([{ id: 'ih1', name: 'Token Hook' }]))

      const result = await service.listInlineHooks()

      expect(result.items).toHaveLength(1)
    })
  })

  describe('deleteInlineHook', () => {
    it('sends DELETE', async () => {
      mock.onDelete(`${BASE}/inlineHooks/ih1`).reply(wrap({}))

      const result = await service.deleteInlineHook('ih1')

      expect(result).toEqual({ deleted: true, inlineHookId: 'ih1' })
    })
  })

  // ── Application Keys ──

  describe('listApplicationKeys', () => {
    it('returns key credentials', async () => {
      mock.onGet(`${BASE}/apps/app1/credentials/keys`).reply(wrap([{ kid: 'k1', use: 'sig' }]))

      const result = await service.listApplicationKeys('app1')

      expect(result.items).toHaveLength(1)
    })
  })

  // ── OAuth2 Claims ──

  describe('listOAuth2Claims', () => {
    it('returns claims for auth server', async () => {
      mock.onGet(`${BASE}/authorizationServers/as1/claims`).reply(wrap([{ id: 'c1', name: 'sub' }]))

      const result = await service.listOAuth2Claims('as1')

      expect(result.items).toHaveLength(1)
    })
  })

  // ── Revoke User Sessions ──

  describe('revokeUserSessions', () => {
    it('sends DELETE to users/{id}/sessions', async () => {
      mock.onDelete(`${BASE}/users/u1/sessions`).reply(wrap({}))

      const result = await service.revokeUserSessions('u1', true, false)

      expect(mock.history[0].query).toMatchObject({ oauthTokens: true })
      expect(result).toMatchObject({ revoked: true, userId: 'u1' })
    })
  })

  // ── unwrapBody(false) behavior ──

  describe('unwrapBody(false) for pagination', () => {
    it('passes unwrapBody false on every request', async () => {
      mock.onGet(`${BASE}/users`).reply(wrap([]))

      await service.listUsers()

      expect(mock.history[0].unwrapBody).toBe(false)
    })
  })
})
