'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-ssws-token'
const ORG_URL = 'https://dev-123456.okta.com'
const BASE = `${ORG_URL}/api/v1`

// The service uses .unwrapBody(false) on every request, so the mock must return
// a response-shaped object { body, headers } instead of raw data.
const wrap = (body, headers) => ({ body, headers: headers || {} })

describe('Okta Service – Devices, Policies & More', () => {
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

  // ── Devices ──

  describe('getDevice', () => {
    it('sends GET to /devices/:id and returns body', async () => {
      const device = { id: 'dev1', status: 'ACTIVE', profile: { displayName: 'My Device' } }
      mock.onGet(`${BASE}/devices/dev1`).reply(wrap(device))

      const result = await service.getDevice('dev1')

      expect(result).toEqual(device)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${BASE}/devices/dev1`)
    })
  })

  describe('activateDevice', () => {
    it('sends POST to lifecycle/activate and returns confirmation', async () => {
      mock.onPost(`${BASE}/devices/dev1/lifecycle/activate`).reply(wrap({}))

      const result = await service.activateDevice('dev1')

      expect(result).toEqual({ activated: true, deviceId: 'dev1' })
      expect(mock.history[0].method).toBe('post')
    })
  })

  describe('deactivateDevice', () => {
    it('sends POST to lifecycle/deactivate and returns confirmation', async () => {
      mock.onPost(`${BASE}/devices/dev1/lifecycle/deactivate`).reply(wrap({}))

      const result = await service.deactivateDevice('dev1')

      expect(result).toEqual({ deactivated: true, deviceId: 'dev1' })
    })
  })

  describe('suspendDevice', () => {
    it('sends POST to lifecycle/suspend', async () => {
      mock.onPost(`${BASE}/devices/dev1/lifecycle/suspend`).reply(wrap({}))

      const result = await service.suspendDevice('dev1')

      expect(result).toEqual({ suspended: true, deviceId: 'dev1' })
    })
  })

  describe('unsuspendDevice', () => {
    it('sends POST to lifecycle/unsuspend', async () => {
      mock.onPost(`${BASE}/devices/dev1/lifecycle/unsuspend`).reply(wrap({}))

      const result = await service.unsuspendDevice('dev1')

      expect(result).toEqual({ unsuspended: true, deviceId: 'dev1' })
    })
  })

  describe('listDeviceUsers', () => {
    it('sends GET to /devices/:id/users and returns list result', async () => {
      const users = [{ managementStatus: 'NOT_MANAGED', user: { id: 'u1' } }]
      mock.onGet(`${BASE}/devices/dev1/users`).reply(wrap(users))

      const result = await service.listDeviceUsers('dev1')

      expect(result.items).toEqual(users)
      expect(result.cursor).toBeNull()
    })
  })

  describe('listUserDevices', () => {
    it('sends GET to /users/:id/devices and returns list result', async () => {
      const devices = [{ device: { id: 'dev1', status: 'ACTIVE' }, managementStatus: 'MANAGED' }]
      mock.onGet(`${BASE}/users/u1/devices`).reply(wrap(devices))

      const result = await service.listUserDevices('u1')

      expect(result.items).toEqual(devices)
    })
  })

  // ── Policies ──

  describe('createPolicy', () => {
    it('sends POST to /policies with type and name', async () => {
      const policy = { id: 'pol1', type: 'OKTA_SIGN_ON', name: 'Test Policy', status: 'ACTIVE' }
      mock.onPost(`${BASE}/policies`).reply(wrap(policy))

      const result = await service.createPolicy('Global Session (Okta Sign-On)', 'Test Policy')

      expect(result).toEqual(policy)
      expect(mock.history[0].body).toMatchObject({ type: 'OKTA_SIGN_ON', name: 'Test Policy' })
    })

    it('includes optional description, priority, and status', async () => {
      mock.onPost(`${BASE}/policies`).reply(wrap({ id: 'pol2' }))

      await service.createPolicy('Global Session (Okta Sign-On)', 'P', 'desc', 1, 'Active')

      expect(mock.history[0].body).toMatchObject({
        type: 'OKTA_SIGN_ON',
        name: 'P',
        description: 'desc',
        priority: 1,
        status: 'ACTIVE',
      })
    })
  })

  describe('getPolicy', () => {
    it('sends GET to /policies/:id', async () => {
      const policy = { id: 'pol1', type: 'OKTA_SIGN_ON', name: 'Test' }
      mock.onGet(`${BASE}/policies/pol1`).reply(wrap(policy))

      const result = await service.getPolicy('pol1')

      expect(result).toEqual(policy)
    })
  })

  describe('replacePolicy', () => {
    it('sends PUT to /policies/:id with full body', async () => {
      mock.onPut(`${BASE}/policies/pol1`).reply(wrap({ id: 'pol1', name: 'Updated' }))

      await service.replacePolicy('pol1', 'Global Session (Okta Sign-On)', 'Updated', 'desc', 2)

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toMatchObject({
        type: 'OKTA_SIGN_ON',
        name: 'Updated',
        description: 'desc',
        priority: 2,
      })
    })
  })

  describe('activatePolicy', () => {
    it('sends POST to lifecycle/activate and returns confirmation', async () => {
      mock.onPost(`${BASE}/policies/pol1/lifecycle/activate`).reply(wrap({}))

      const result = await service.activatePolicy('pol1')

      expect(result).toEqual({ activated: true, policyId: 'pol1' })
    })
  })

  describe('deactivatePolicy', () => {
    it('sends POST to lifecycle/deactivate and returns confirmation', async () => {
      mock.onPost(`${BASE}/policies/pol1/lifecycle/deactivate`).reply(wrap({}))

      const result = await service.deactivatePolicy('pol1')

      expect(result).toEqual({ deactivated: true, policyId: 'pol1' })
    })
  })

  // ── Policy Rules ──

  describe('listPolicyRules', () => {
    it('sends GET to /policies/:id/rules', async () => {
      const rules = [{ id: 'rule1', type: 'SIGN_ON', name: 'Default' }]
      mock.onGet(`${BASE}/policies/pol1/rules`).reply(wrap(rules))

      const result = await service.listPolicyRules('pol1')

      expect(result.items).toEqual(rules)
    })

    it('passes limit as query param', async () => {
      mock.onGet(`${BASE}/policies/pol1/rules`).reply(wrap([]))

      await service.listPolicyRules('pol1', 10)

      expect(mock.history[0].query).toMatchObject({ limit: 10 })
    })
  })

  describe('createPolicyRule', () => {
    it('sends POST to /policies/:id/rules with type and name', async () => {
      const rule = { id: 'rule1', type: 'SIGN_ON', name: 'My Rule' }
      mock.onPost(`${BASE}/policies/pol1/rules`).reply(wrap(rule))

      const result = await service.createPolicyRule('pol1', 'Sign-On', 'My Rule')

      expect(result).toEqual(rule)
      expect(mock.history[0].body).toMatchObject({ type: 'SIGN_ON', name: 'My Rule' })
    })

    it('includes optional priority', async () => {
      mock.onPost(`${BASE}/policies/pol1/rules`).reply(wrap({ id: 'r2' }))

      await service.createPolicyRule('pol1', 'Sign-On', 'R', 5)

      expect(mock.history[0].body).toMatchObject({ priority: 5 })
    })
  })

  describe('getPolicyRule', () => {
    it('sends GET to /policies/:policyId/rules/:ruleId', async () => {
      const rule = { id: 'rule1', type: 'SIGN_ON', name: 'Rule' }
      mock.onGet(`${BASE}/policies/pol1/rules/rule1`).reply(wrap(rule))

      const result = await service.getPolicyRule('pol1', 'rule1')

      expect(result).toEqual(rule)
    })
  })

  describe('replacePolicyRule', () => {
    it('sends PUT to /policies/:policyId/rules/:ruleId', async () => {
      mock.onPut(`${BASE}/policies/pol1/rules/rule1`).reply(wrap({ id: 'rule1', name: 'Updated' }))

      await service.replacePolicyRule('pol1', 'rule1', 'Sign-On', 'Updated', 1)

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toMatchObject({ type: 'SIGN_ON', name: 'Updated', priority: 1 })
    })
  })

  describe('deletePolicyRule', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${BASE}/policies/pol1/rules/rule1`).reply(wrap({}))

      const result = await service.deletePolicyRule('pol1', 'rule1')

      expect(result).toEqual({ deleted: true, ruleId: 'rule1' })
    })
  })

  describe('activatePolicyRule', () => {
    it('sends POST to lifecycle/activate', async () => {
      mock.onPost(`${BASE}/policies/pol1/rules/rule1/lifecycle/activate`).reply(wrap({}))

      const result = await service.activatePolicyRule('pol1', 'rule1')

      expect(result).toEqual({ activated: true, ruleId: 'rule1' })
    })
  })

  describe('deactivatePolicyRule', () => {
    it('sends POST to lifecycle/deactivate', async () => {
      mock.onPost(`${BASE}/policies/pol1/rules/rule1/lifecycle/deactivate`).reply(wrap({}))

      const result = await service.deactivatePolicyRule('pol1', 'rule1')

      expect(result).toEqual({ deactivated: true, ruleId: 'rule1' })
    })
  })

  // ── Authenticators ──

  describe('getAuthenticator', () => {
    it('sends GET to /authenticators/:id', async () => {
      const auth = { id: 'aut1', key: 'okta_email', status: 'ACTIVE', name: 'Email' }
      mock.onGet(`${BASE}/authenticators/aut1`).reply(wrap(auth))

      const result = await service.getAuthenticator('aut1')

      expect(result).toEqual(auth)
    })
  })

  describe('createAuthenticator', () => {
    it('sends POST to /authenticators with key and name', async () => {
      const response = { id: 'aut2', key: 'duo', name: 'Duo Security' }
      mock.onPost(`${BASE}/authenticators`).reply(wrap(response))

      const result = await service.createAuthenticator('Duo Security', 'Duo Security')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toMatchObject({ key: 'duo', name: 'Duo Security' })
    })
  })

  describe('replaceAuthenticator', () => {
    it('sends PUT to /authenticators/:id', async () => {
      mock.onPut(`${BASE}/authenticators/aut1`).reply(wrap({ id: 'aut1', name: 'Updated' }))

      await service.replaceAuthenticator('aut1', 'Duo Security', 'Updated')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toMatchObject({ key: 'duo', name: 'Updated' })
    })
  })

  describe('activateAuthenticator', () => {
    it('sends POST to lifecycle/activate', async () => {
      mock.onPost(`${BASE}/authenticators/aut1/lifecycle/activate`).reply(wrap({ id: 'aut1', status: 'ACTIVE' }))

      const result = await service.activateAuthenticator('aut1')

      expect(result).toEqual({ id: 'aut1', status: 'ACTIVE' })
    })
  })

  describe('deactivateAuthenticator', () => {
    it('sends POST to lifecycle/deactivate', async () => {
      mock.onPost(`${BASE}/authenticators/aut1/lifecycle/deactivate`).reply(wrap({ id: 'aut1', status: 'INACTIVE' }))

      const result = await service.deactivateAuthenticator('aut1')

      expect(result).toEqual({ id: 'aut1', status: 'INACTIVE' })
    })
  })

  describe('listAuthenticatorMethods', () => {
    it('sends GET to /authenticators/:id/methods', async () => {
      const methods = [{ type: 'sms', status: 'ACTIVE' }]
      mock.onGet(`${BASE}/authenticators/aut1/methods`).reply(wrap(methods))

      const result = await service.listAuthenticatorMethods('aut1')

      expect(result.items).toEqual(methods)
    })
  })

  describe('getAuthenticatorMethod', () => {
    it('sends GET to /authenticators/:id/methods/:type', async () => {
      mock.onGet(`${BASE}/authenticators/aut1/methods/sms`).reply(wrap({ type: 'sms', status: 'ACTIVE' }))

      const result = await service.getAuthenticatorMethod('aut1', 'SMS')

      expect(result).toEqual({ type: 'sms', status: 'ACTIVE' })
    })
  })

  describe('replaceAuthenticatorMethod', () => {
    it('sends PUT to /authenticators/:id/methods/:type', async () => {
      mock.onPut(`${BASE}/authenticators/aut1/methods/sms`).reply(wrap({ type: 'sms', status: 'ACTIVE' }))

      await service.replaceAuthenticatorMethod('aut1', 'SMS', 'Active')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toMatchObject({ type: 'sms', status: 'ACTIVE' })
    })
  })

  describe('activateAuthenticatorMethod', () => {
    it('sends POST to methods/:type/lifecycle/activate', async () => {
      mock.onPost(`${BASE}/authenticators/aut1/methods/sms/lifecycle/activate`).reply(wrap({ type: 'sms', status: 'ACTIVE' }))

      const result = await service.activateAuthenticatorMethod('aut1', 'SMS')

      expect(result).toEqual({ type: 'sms', status: 'ACTIVE' })
    })
  })

  describe('deactivateAuthenticatorMethod', () => {
    it('sends POST to methods/:type/lifecycle/deactivate', async () => {
      mock.onPost(`${BASE}/authenticators/aut1/methods/voice/lifecycle/deactivate`).reply(wrap({ type: 'voice', status: 'INACTIVE' }))

      const result = await service.deactivateAuthenticatorMethod('aut1', 'Voice Call')

      expect(result).toEqual({ type: 'voice', status: 'INACTIVE' })
    })
  })

  describe('getWellKnownAppAuthenticatorConfiguration', () => {
    it('sends GET to /.well-known/app-authenticator-configuration with oauthClientId query', async () => {
      const config = { appAuthenticatorEnrollEndpoint: 'https://example.com', supportedMethods: [{ type: 'push' }] }
      mock.onGet(`${ORG_URL}/.well-known/app-authenticator-configuration`).reply(wrap(config))

      const result = await service.getWellKnownAppAuthenticatorConfiguration('client123')

      expect(result).toEqual(config)
      expect(mock.history[0].query).toMatchObject({ oauthClientId: 'client123' })
    })
  })

  // ── Custom AAGUIDs ──

  describe('createCustomAAGUID', () => {
    it('sends POST to /authenticators/:id/aaguids', async () => {
      const aaguid = { aaguid: 'cb694-abc', name: 'My Key' }
      mock.onPost(`${BASE}/authenticators/aut1/aaguids`).reply(wrap(aaguid))

      const result = await service.createCustomAAGUID('aut1', 'cb694-abc', 'My Key')

      expect(result).toEqual(aaguid)
      expect(mock.history[0].body).toMatchObject({ aaguid: 'cb694-abc', name: 'My Key' })
    })
  })

  describe('getCustomAAGUID', () => {
    it('sends GET to /authenticators/:id/aaguids/:aaguid', async () => {
      mock.onGet(`${BASE}/authenticators/aut1/aaguids/cb694-abc`).reply(wrap({ aaguid: 'cb694-abc', name: 'Key' }))

      const result = await service.getCustomAAGUID('aut1', 'cb694-abc')

      expect(result).toEqual({ aaguid: 'cb694-abc', name: 'Key' })
    })
  })

  describe('replaceCustomAAGUID', () => {
    it('sends PUT to /authenticators/:id/aaguids/:aaguid', async () => {
      mock.onPut(`${BASE}/authenticators/aut1/aaguids/cb694-abc`).reply(wrap({ aaguid: 'cb694-abc', name: 'Key v2' }))

      const result = await service.replaceCustomAAGUID('aut1', 'cb694-abc', 'Key v2')

      expect(result).toEqual({ aaguid: 'cb694-abc', name: 'Key v2' })
      expect(mock.history[0].method).toBe('put')
    })
  })

  describe('deleteCustomAAGUID', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${BASE}/authenticators/aut1/aaguids/cb694-abc`).reply(wrap({}))

      const result = await service.deleteCustomAAGUID('aut1', 'cb694-abc')

      expect(result).toEqual({ deleted: true, aaguid: 'cb694-abc' })
    })
  })

  describe('listAllCustomAAGUIDs', () => {
    it('sends GET to /authenticators/:id/aaguids', async () => {
      const aaguids = [{ aaguid: 'a1', name: 'Key1' }]
      mock.onGet(`${BASE}/authenticators/aut1/aaguids`).reply(wrap(aaguids))

      const result = await service.listAllCustomAAGUIDs('aut1')

      expect(result.items).toEqual(aaguids)
    })
  })

  // ── User Types ──

  describe('getUserType', () => {
    it('sends GET to /meta/types/user/:id', async () => {
      const type = { id: 'type1', name: 'custom', displayName: 'Custom Type' }
      mock.onGet(`${BASE}/meta/types/user/type1`).reply(wrap(type))

      const result = await service.getUserType('type1')

      expect(result).toEqual(type)
    })
  })

  describe('updateUserType', () => {
    it('sends POST with partial body (displayName only)', async () => {
      mock.onPost(`${BASE}/meta/types/user/type1`).reply(wrap({ id: 'type1', displayName: 'New Name' }))

      await service.updateUserType('type1', 'New Name')

      expect(mock.history[0].body).toEqual({ displayName: 'New Name' })
    })

    it('sends POST with both displayName and description', async () => {
      mock.onPost(`${BASE}/meta/types/user/type1`).reply(wrap({ id: 'type1' }))

      await service.updateUserType('type1', 'Name', 'Desc')

      expect(mock.history[0].body).toEqual({ displayName: 'Name', description: 'Desc' })
    })

    it('sends empty body when no mutable fields given', async () => {
      mock.onPost(`${BASE}/meta/types/user/type1`).reply(wrap({ id: 'type1' }))

      await service.updateUserType('type1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('replaceUserType', () => {
    it('sends PUT with name, displayName, and description', async () => {
      mock.onPut(`${BASE}/meta/types/user/type1`).reply(wrap({ id: 'type1' }))

      await service.replaceUserType('type1', 'custom', 'Custom Type', 'A desc')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ name: 'custom', displayName: 'Custom Type', description: 'A desc' })
    })

    it('omits description when empty', async () => {
      mock.onPut(`${BASE}/meta/types/user/type1`).reply(wrap({ id: 'type1' }))

      await service.replaceUserType('type1', 'custom', 'Custom Type')

      expect(mock.history[0].body).toEqual({ name: 'custom', displayName: 'Custom Type' })
    })
  })

  // ── Behavior Rules ──

  describe('createBehaviorRule', () => {
    it('sends POST to /behaviors with name and type', async () => {
      const rule = { id: 'beh1', name: 'My Rule', type: 'VELOCITY', status: 'ACTIVE' }
      mock.onPost(`${BASE}/behaviors`).reply(wrap(rule))

      const result = await service.createBehaviorRule('My Rule', 'Velocity (impossible travel)')

      expect(result).toEqual(rule)
      expect(mock.history[0].body).toMatchObject({ name: 'My Rule', type: 'VELOCITY' })
    })

    it('includes optional status and settings', async () => {
      mock.onPost(`${BASE}/behaviors`).reply(wrap({ id: 'beh2' }))

      await service.createBehaviorRule('R', 'Velocity (impossible travel)', 'Inactive', { velocityKph: 500 })

      expect(mock.history[0].body).toMatchObject({
        name: 'R',
        type: 'VELOCITY',
        status: 'INACTIVE',
        settings: { velocityKph: 500 },
      })
    })
  })

  describe('getBehaviorRule', () => {
    it('sends GET to /behaviors/:id', async () => {
      const rule = { id: 'beh1', name: 'Rule', type: 'VELOCITY' }
      mock.onGet(`${BASE}/behaviors/beh1`).reply(wrap(rule))

      const result = await service.getBehaviorRule('beh1')

      expect(result).toEqual(rule)
    })
  })

  describe('updateBehaviorRule', () => {
    it('sends PUT to /behaviors/:id', async () => {
      mock.onPut(`${BASE}/behaviors/beh1`).reply(wrap({ id: 'beh1', name: 'Updated' }))

      await service.updateBehaviorRule('beh1', 'Updated', 'Velocity (impossible travel)')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toMatchObject({ name: 'Updated', type: 'VELOCITY' })
    })
  })

  describe('activateBehaviorRule', () => {
    it('sends POST to lifecycle/activate and returns body', async () => {
      mock.onPost(`${BASE}/behaviors/beh1/lifecycle/activate`).reply(wrap({ id: 'beh1', status: 'ACTIVE' }))

      const result = await service.activateBehaviorRule('beh1')

      expect(result).toEqual({ id: 'beh1', status: 'ACTIVE' })
    })
  })

  describe('deactivateBehaviorRule', () => {
    it('sends POST to lifecycle/deactivate and returns body', async () => {
      mock.onPost(`${BASE}/behaviors/beh1/lifecycle/deactivate`).reply(wrap({ id: 'beh1', status: 'INACTIVE' }))

      const result = await service.deactivateBehaviorRule('beh1')

      expect(result).toEqual({ id: 'beh1', status: 'INACTIVE' })
    })
  })

  // ── Linked Object Definitions ──

  describe('createLinkedObjectDefinition', () => {
    it('sends POST to /meta/schemas/user/linkedObjects with primary and associated', async () => {
      const def = { primary: { name: 'manager', title: 'Manager', type: 'USER' }, associated: { name: 'subordinate', title: 'Subordinate', type: 'USER' } }
      mock.onPost(`${BASE}/meta/schemas/user/linkedObjects`).reply(wrap(def))

      const result = await service.createLinkedObjectDefinition('manager', 'Manager', 'Mgr desc', 'subordinate', 'Subordinate', 'Sub desc')

      expect(result).toEqual(def)
      expect(mock.history[0].body).toEqual({
        primary: { name: 'manager', title: 'Manager', type: 'USER', description: 'Mgr desc' },
        associated: { name: 'subordinate', title: 'Subordinate', type: 'USER', description: 'Sub desc' },
      })
    })

    it('omits descriptions when not provided', async () => {
      mock.onPost(`${BASE}/meta/schemas/user/linkedObjects`).reply(wrap({ primary: {}, associated: {} }))

      await service.createLinkedObjectDefinition('mgr', 'Mgr', undefined, 'sub', 'Sub')

      expect(mock.history[0].body).toEqual({
        primary: { name: 'mgr', title: 'Mgr', type: 'USER' },
        associated: { name: 'sub', title: 'Sub', type: 'USER' },
      })
    })
  })

  describe('getLinkedObjectDefinition', () => {
    it('sends GET to /meta/schemas/user/linkedObjects/:name', async () => {
      const def = { primary: { name: 'manager' }, associated: { name: 'subordinate' } }
      mock.onGet(`${BASE}/meta/schemas/user/linkedObjects/manager`).reply(wrap(def))

      const result = await service.getLinkedObjectDefinition('manager')

      expect(result).toEqual(def)
    })
  })

  describe('deleteLinkedObjectDefinition', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${BASE}/meta/schemas/user/linkedObjects/manager`).reply(wrap({}))

      const result = await service.deleteLinkedObjectDefinition('manager')

      expect(result).toEqual({ deleted: true, linkedObjectName: 'manager' })
    })
  })

  describe('assignLinkedObjectValueForPrimary', () => {
    it('sends PUT to /users/:assocId/linkedObjects/:rel/:primaryId', async () => {
      mock.onPut(`${BASE}/users/u2/linkedObjects/manager/u1`).reply(wrap({}))

      const result = await service.assignLinkedObjectValueForPrimary('u2', 'manager', 'u1')

      expect(result).toEqual({ assigned: true, associatedUserId: 'u2', primaryUserId: 'u1', relationship: 'manager' })
      expect(mock.history[0].method).toBe('put')
    })
  })

  describe('listLinkedObjectsForUser', () => {
    it('sends GET to /users/:id/linkedObjects/:relationship', async () => {
      const links = [{ _links: { manager: { href: 'url' } } }]
      mock.onGet(`${BASE}/users/u1/linkedObjects/manager`).reply(wrap(links))

      const result = await service.listLinkedObjectsForUser('u1', 'manager')

      expect(result.items).toEqual(links)
    })
  })

  describe('deleteLinkedObjectForUser', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${BASE}/users/u1/linkedObjects/manager`).reply(wrap({}))

      const result = await service.deleteLinkedObjectForUser('u1', 'manager')

      expect(result).toEqual({ deleted: true, userId: 'u1', relationship: 'manager' })
    })
  })

  // ── Schemas ──

  describe('getUserSchema', () => {
    it('sends GET to /meta/schemas/user/default when no schema provided', async () => {
      const schema = { id: 'default', name: 'user' }
      mock.onGet(`${BASE}/meta/schemas/user/default`).reply(wrap(schema))

      const result = await service.getUserSchema()

      expect(result).toEqual(schema)
    })

    it('uses provided schema id', async () => {
      mock.onGet(`${BASE}/meta/schemas/user/osc123`).reply(wrap({ id: 'osc123' }))

      await service.getUserSchema('osc123')

      expect(mock.history[0].url).toBe(`${BASE}/meta/schemas/user/osc123`)
    })
  })

  describe('getApplicationUserSchema', () => {
    it('sends GET to /meta/schemas/apps/:appId/default', async () => {
      const schema = { id: 'appSchema', name: 'App' }
      mock.onGet(`${BASE}/meta/schemas/apps/app1/default`).reply(wrap(schema))

      const result = await service.getApplicationUserSchema('app1')

      expect(result).toEqual(schema)
    })
  })

  describe('updateGroupSchema', () => {
    it('sends POST to /meta/schemas/group/default with definitions', async () => {
      const defs = { custom: { properties: { contact: { title: 'Contact', type: 'string' } } } }
      mock.onPost(`${BASE}/meta/schemas/group/default`).reply(wrap({ definitions: defs }))

      const result = await service.updateGroupSchema(defs)

      expect(result).toEqual({ definitions: defs })
      expect(mock.history[0].body).toEqual({ definitions: defs })
    })
  })

  // ── Profile Mappings ──

  describe('getProfileMapping', () => {
    it('sends GET to /mappings/:id', async () => {
      const mapping = { id: 'prm1', source: { name: 'user' }, target: { name: 'app' } }
      mock.onGet(`${BASE}/mappings/prm1`).reply(wrap(mapping))

      const result = await service.getProfileMapping('prm1')

      expect(result).toEqual(mapping)
    })
  })

  describe('updateProfileMapping', () => {
    it('sends POST to /mappings/:id with properties', async () => {
      const props = { fullName: { expression: 'user.firstName', pushStatus: 'PUSH' } }
      mock.onPost(`${BASE}/mappings/prm1`).reply(wrap({ id: 'prm1', properties: props }))

      const result = await service.updateProfileMapping('prm1', props)

      expect(result.properties).toEqual(props)
      expect(mock.history[0].body).toEqual({ properties: props })
    })
  })

  // ── Sessions ──

  describe('refreshSession', () => {
    it('sends POST to /sessions/:id/lifecycle/refresh', async () => {
      const session = { id: 'sess1', status: 'ACTIVE', expiresAt: '2025-01-01T00:00:00Z' }
      mock.onPost(`${BASE}/sessions/sess1/lifecycle/refresh`).reply(wrap(session))

      const result = await service.refreshSession('sess1')

      expect(result).toEqual(session)
      expect(mock.history[0].method).toBe('post')
    })
  })

  // ── ThreatInsight ──

  describe('updateThreatInsightConfiguration', () => {
    it('sends POST to /threats/configuration with action', async () => {
      const config = { action: 'audit', excludeZones: [] }
      mock.onPost(`${BASE}/threats/configuration`).reply(wrap(config))

      const result = await service.updateThreatInsightConfiguration('Audit (log only)')

      expect(result).toEqual(config)
      expect(mock.history[0].body).toMatchObject({ action: 'audit' })
    })
  })

  // ── User OAuth Grants & Tokens ──

  describe('getUserGrant', () => {
    it('sends GET to /users/:id/grants/:grantId', async () => {
      const grant = { id: 'grant1', scopeId: 'okta.users.read', status: 'ACTIVE' }
      mock.onGet(`${BASE}/users/u1/grants/grant1`).reply(wrap(grant))

      const result = await service.getUserGrant('u1', 'grant1')

      expect(result).toEqual(grant)
    })
  })

  describe('revokeUserGrant', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${BASE}/users/u1/grants/grant1`).reply(wrap({}))

      const result = await service.revokeUserGrant('u1', 'grant1')

      expect(result).toEqual({ revoked: true, grantId: 'grant1' })
    })
  })

  describe('listUserClients', () => {
    it('sends GET to /users/:id/clients', async () => {
      const clients = [{ client_id: 'c1', client_name: 'App' }]
      mock.onGet(`${BASE}/users/u1/clients`).reply(wrap(clients))

      const result = await service.listUserClients('u1')

      expect(result.items).toEqual(clients)
    })
  })

  describe('listGrantsForUserAndClient', () => {
    it('sends GET to /users/:id/clients/:clientId/grants', async () => {
      const grants = [{ id: 'g1', clientId: 'c1' }]
      mock.onGet(`${BASE}/users/u1/clients/c1/grants`).reply(wrap(grants))

      const result = await service.listGrantsForUserAndClient('u1', 'c1')

      expect(result.items).toEqual(grants)
    })
  })

  describe('revokeGrantsForUserAndClient', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${BASE}/users/u1/clients/c1/grants`).reply(wrap({}))

      const result = await service.revokeGrantsForUserAndClient('u1', 'c1')

      expect(result).toEqual({ revoked: true, userId: 'u1', clientId: 'c1' })
    })
  })

  describe('listRefreshTokensForUserAndClient', () => {
    it('sends GET to /users/:id/clients/:clientId/tokens', async () => {
      const tokens = [{ id: 't1', status: 'ACTIVE' }]
      mock.onGet(`${BASE}/users/u1/clients/c1/tokens`).reply(wrap(tokens))

      const result = await service.listRefreshTokensForUserAndClient('u1', 'c1')

      expect(result.items).toEqual(tokens)
    })

    it('passes limit and after as query params', async () => {
      mock.onGet(`${BASE}/users/u1/clients/c1/tokens`).reply(wrap([]))

      await service.listRefreshTokensForUserAndClient('u1', 'c1', 10, 'cursor123')

      expect(mock.history[0].query).toMatchObject({ limit: 10, after: 'cursor123' })
    })
  })

  describe('getRefreshTokenForUserAndClient', () => {
    it('sends GET to /users/:id/clients/:clientId/tokens/:tokenId', async () => {
      const token = { id: 't1', status: 'ACTIVE', clientId: 'c1' }
      mock.onGet(`${BASE}/users/u1/clients/c1/tokens/t1`).reply(wrap(token))

      const result = await service.getRefreshTokenForUserAndClient('u1', 'c1', 't1')

      expect(result).toEqual(token)
    })
  })

  describe('revokeTokenForUserAndClient', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${BASE}/users/u1/clients/c1/tokens/t1`).reply(wrap({}))

      const result = await service.revokeTokenForUserAndClient('u1', 'c1', 't1')

      expect(result).toEqual({ revoked: true, tokenId: 't1' })
    })
  })

  describe('revokeTokensForUserAndClient', () => {
    it('sends DELETE to /users/:id/clients/:clientId/tokens', async () => {
      mock.onDelete(`${BASE}/users/u1/clients/c1/tokens`).reply(wrap({}))

      const result = await service.revokeTokensForUserAndClient('u1', 'c1')

      expect(result).toEqual({ revoked: true, userId: 'u1', clientId: 'c1', scope: 'tokens' })
    })
  })

  // ── User Blocks ──

  describe('listUserBlocks', () => {
    it('sends GET to /users/:id/blocks', async () => {
      const blocks = [{ type: 'UNKNOWN_DEVICE' }]
      mock.onGet(`${BASE}/users/u1/blocks`).reply(wrap(blocks))

      const result = await service.listUserBlocks('u1')

      expect(result.items).toEqual(blocks)
    })
  })

  // ── User Groups & App Links ──

  describe('getUserGroups', () => {
    it('sends GET to /users/:id/groups', async () => {
      const groups = [{ id: 'g1', profile: { name: 'Engineering' }, type: 'OKTA_GROUP' }]
      mock.onGet(`${BASE}/users/u1/groups`).reply(wrap(groups))

      const result = await service.getUserGroups('u1')

      expect(result.items).toEqual(groups)
    })
  })

  describe('listAssignedAppLinks', () => {
    it('sends GET to /users/:id/appLinks', async () => {
      const links = [{ appName: 'salesforce', label: 'Salesforce' }]
      mock.onGet(`${BASE}/users/u1/appLinks`).reply(wrap(links))

      const result = await service.listAssignedAppLinks('u1')

      expect(result.items).toEqual(links)
    })
  })

  // ── User Lifecycle Extras ──

  describe('reactivateUser', () => {
    it('sends POST to /users/:id/lifecycle/reactivate', async () => {
      const response = { activationUrl: 'https://example.com/activate', activationToken: 'abc123' }
      mock.onPost(`${BASE}/users/u1/lifecycle/reactivate`).reply(wrap(response))

      const result = await service.reactivateUser('u1')

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({ sendEmail: false })
    })

    it('passes sendEmail=true when specified', async () => {
      mock.onPost(`${BASE}/users/u1/lifecycle/reactivate`).reply(wrap({}))

      await service.reactivateUser('u1', true)

      expect(mock.history[0].query).toMatchObject({ sendEmail: true })
    })
  })

  describe('forgotPassword', () => {
    it('sends POST to /users/:id/credentials/forgot_password', async () => {
      const response = { resetPasswordUrl: 'https://example.com/reset' }
      mock.onPost(`${BASE}/users/u1/credentials/forgot_password`).reply(wrap(response))

      const result = await service.forgotPassword('u1')

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({ sendEmail: false })
    })
  })

  describe('forgotPasswordSetNewPassword', () => {
    it('sends POST with password and recovery question', async () => {
      mock.onPost(`${BASE}/users/u1/credentials/forgot_password_recovery_question`).reply(wrap({ password: {} }))

      const result = await service.forgotPasswordSetNewPassword('u1', 'newPass123', 'blue')

      expect(result).toEqual({ password: {} })
      expect(mock.history[0].body).toEqual({
        password: { value: 'newPass123' },
        recovery_question: { answer: 'blue' },
      })
    })
  })

  describe('changeRecoveryQuestion', () => {
    it('sends POST with current password and new question/answer', async () => {
      mock.onPost(`${BASE}/users/u1/credentials/change_recovery_question`).reply(wrap({ recovery_question: { question: 'Q?' } }))

      const result = await service.changeRecoveryQuestion('u1', 'currentPwd', 'Q?', 'A!')

      expect(result).toEqual({ recovery_question: { question: 'Q?' } })
      expect(mock.history[0].body).toEqual({
        password: { value: 'currentPwd' },
        recovery_question: { question: 'Q?', answer: 'A!' },
      })
    })
  })

  // ── MFA Factors ──

  describe('activateFactor', () => {
    it('sends POST to /users/:id/factors/:factorId/lifecycle/activate with passCode', async () => {
      const factor = { id: 'fct1', factorType: 'sms', status: 'ACTIVE' }
      mock.onPost(`${BASE}/users/u1/factors/fct1/lifecycle/activate`).reply(wrap(factor))

      const result = await service.activateFactor('u1', 'fct1', '123456')

      expect(result).toEqual(factor)
      expect(mock.history[0].body).toEqual({ passCode: '123456' })
    })

    it('sends no body when passCode is not provided', async () => {
      mock.onPost(`${BASE}/users/u1/factors/fct1/lifecycle/activate`).reply(wrap({ id: 'fct1' }))

      await service.activateFactor('u1', 'fct1')

      expect(mock.history[0].body).toBeUndefined()
    })
  })

  describe('verifyFactor', () => {
    it('sends POST to /users/:id/factors/:factorId/verify with passCode', async () => {
      mock.onPost(`${BASE}/users/u1/factors/fct1/verify`).reply(wrap({ factorResult: 'SUCCESS' }))

      const result = await service.verifyFactor('u1', 'fct1', '654321')

      expect(result).toEqual({ factorResult: 'SUCCESS' })
      expect(mock.history[0].body).toMatchObject({ passCode: '654321' })
    })

    it('sends answer for security-question factor', async () => {
      mock.onPost(`${BASE}/users/u1/factors/fct2/verify`).reply(wrap({ factorResult: 'SUCCESS' }))

      await service.verifyFactor('u1', 'fct2', undefined, 'blue')

      expect(mock.history[0].body).toMatchObject({ answer: 'blue' })
    })
  })

  describe('resendEnrollFactor', () => {
    it('sends POST to /users/:id/factors/:factorId/resend', async () => {
      mock.onPost(`${BASE}/users/u1/factors/fct1/resend`).reply(wrap({ id: 'fct1', status: 'PENDING_ACTIVATION' }))

      const result = await service.resendEnrollFactor('u1', 'fct1', 'SMS')

      expect(result).toEqual({ id: 'fct1', status: 'PENDING_ACTIVATION' })
      expect(mock.history[0].body).toMatchObject({ factorType: 'sms' })
    })
  })

  describe('listSupportedFactors', () => {
    it('sends GET to /users/:id/factors/catalog', async () => {
      const factors = [{ factorType: 'question', provider: 'OKTA' }]
      mock.onGet(`${BASE}/users/u1/factors/catalog`).reply(wrap(factors))

      const result = await service.listSupportedFactors('u1')

      expect(result.items).toEqual(factors)
    })
  })

  describe('listSupportedSecurityQuestions', () => {
    it('sends GET to /users/:id/factors/questions', async () => {
      const questions = [{ question: 'disliked_food', questionText: 'What food?' }]
      mock.onGet(`${BASE}/users/u1/factors/questions`).reply(wrap(questions))

      const result = await service.listSupportedSecurityQuestions('u1')

      expect(result.items).toEqual(questions)
    })
  })
})
