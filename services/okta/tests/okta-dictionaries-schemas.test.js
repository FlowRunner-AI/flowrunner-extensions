'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-ssws-token'
const ORG_URL = 'https://dev-123456.okta.com'
const BASE = `${ORG_URL}/api/v1`

const wrap = (body, headers) => ({ body, headers: headers || {} })

describe('Okta Service — Dictionaries & Schemas', () => {
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

  // ── Dictionary Methods — Top-level (no criteria deps) ──

  describe('getAuthServersDictionary', () => {
    it('returns mapped items', async () => {
      mock.onGet(`${BASE}/authorizationServers`).reply(wrap([
        { id: 'aus1', name: 'Default', status: 'ACTIVE', audiences: ['api://default'] },
      ]))

      const result = await service.getAuthServersDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'Default', value: 'aus1' })
      expect(result.items[0].note).toContain('ACTIVE')
    })

    it('passes search as q', async () => {
      mock.onGet(`${BASE}/authorizationServers`).reply(wrap([]))
      await service.getAuthServersDictionary({ search: 'test' })

      expect(mock.history[0].query).toMatchObject({ q: 'test' })
    })

    it('passes cursor as after', async () => {
      mock.onGet(`${BASE}/authorizationServers`).reply(wrap([]))
      await service.getAuthServersDictionary({ cursor: 'cur1' })

      expect(mock.history[0].query).toMatchObject({ after: 'cur1' })
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/authorizationServers`).reply(wrap([{ id: 'aus1', name: 'A', status: 'ACTIVE', audiences: [] }]))
      const result = await service.getAuthServersDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('handles null body', async () => {
      mock.onGet(`${BASE}/authorizationServers`).reply(wrap(null))
      const result = await service.getAuthServersDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getAuthenticatorsDictionary', () => {
    it('returns mapped items', async () => {
      mock.onGet(`${BASE}/authenticators`).reply(wrap([
        { id: 'aut1', name: 'Email', key: 'okta_email', status: 'ACTIVE' },
      ]))

      const result = await service.getAuthenticatorsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'Email', value: 'aut1' })
      expect(result.items[0].note).toContain('okta_email')
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/authenticators`).reply(wrap([
        { id: 'aut1', name: 'Email', key: 'okta_email', status: 'ACTIVE' },
        { id: 'aut2', name: 'Password', key: 'okta_password', status: 'ACTIVE' },
      ]))

      const result = await service.getAuthenticatorsDictionary({ search: 'pass' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('aut2')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/authenticators`).reply(wrap([]))
      const result = await service.getAuthenticatorsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getIdpsDictionary', () => {
    it('returns mapped items', async () => {
      mock.onGet(`${BASE}/idps`).reply(wrap([
        { id: 'idp1', name: 'OIDC IdP', type: 'OIDC', status: 'ACTIVE' },
      ]))

      const result = await service.getIdpsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'OIDC IdP', value: 'idp1' })
    })

    it('passes search as q', async () => {
      mock.onGet(`${BASE}/idps`).reply(wrap([]))
      await service.getIdpsDictionary({ search: 'test' })

      expect(mock.history[0].query).toMatchObject({ q: 'test' })
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/idps`).reply(wrap([]))
      const result = await service.getIdpsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getDevicesDictionary', () => {
    it('returns mapped devices', async () => {
      mock.onGet(`${BASE}/devices`).reply(wrap([
        { id: 'dev1', status: 'ACTIVE', profile: { displayName: 'DESKTOP-1', platform: 'WINDOWS' } },
      ]))

      const result = await service.getDevicesDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ value: 'dev1' })
      expect(result.items[0].label).toContain('DESKTOP-1')
    })

    it('passes search as search query param', async () => {
      mock.onGet(`${BASE}/devices`).reply(wrap([]))
      await service.getDevicesDictionary({ search: 'mac' })

      expect(mock.history[0].query).toMatchObject({ search: 'mac' })
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/devices`).reply(wrap([]))
      const result = await service.getDevicesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getBehaviorRulesDictionary', () => {
    it('returns mapped rules', async () => {
      mock.onGet(`${BASE}/behaviors`).reply(wrap([
        { id: 'beh1', name: 'VelocityRule', type: 'VELOCITY', status: 'ACTIVE' },
      ]))

      const result = await service.getBehaviorRulesDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toContain('VelocityRule')
      expect(result.items[0].label).toContain('VELOCITY')
      expect(result.items[0].value).toBe('beh1')
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/behaviors`).reply(wrap([
        { id: 'b1', name: 'VelocityRule', type: 'VELOCITY', status: 'ACTIVE' },
        { id: 'b2', name: 'AnomalousIP', type: 'ANOMALOUS_IP', status: 'ACTIVE' },
      ]))

      const result = await service.getBehaviorRulesDictionary({ search: 'anomalous' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('b2')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/behaviors`).reply(wrap([]))
      const result = await service.getBehaviorRulesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getLinkedObjectsDictionary', () => {
    it('returns mapped definitions', async () => {
      mock.onGet(`${BASE}/meta/schemas/user/linkedObjects`).reply(wrap([
        { primary: { name: 'manager', title: 'Manager' }, associated: { name: 'subordinate', title: 'Subordinate' } },
      ]))

      const result = await service.getLinkedObjectsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ value: 'manager', note: 'subordinate' })
      expect(result.items[0].label).toContain('Manager')
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/meta/schemas/user/linkedObjects`).reply(wrap([
        { primary: { name: 'manager', title: 'Manager' }, associated: { name: 'subordinate', title: 'Subordinate' } },
        { primary: { name: 'ceo', title: 'CEO' }, associated: { name: 'company', title: 'Company' } },
      ]))

      const result = await service.getLinkedObjectsDictionary({ search: 'ceo' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ceo')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/meta/schemas/user/linkedObjects`).reply(wrap([]))
      const result = await service.getLinkedObjectsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getUserTypesDictionary', () => {
    it('returns mapped user types', async () => {
      mock.onGet(`${BASE}/meta/types/user`).reply(wrap([
        { id: 'ut1', name: 'default', displayName: 'Default', default: true },
      ]))

      const result = await service.getUserTypesDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ value: 'ut1', note: 'default' })
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/meta/types/user`).reply(wrap([
        { id: 'ut1', name: 'default', displayName: 'Default', default: true },
        { id: 'ut2', name: 'contractor', displayName: 'Contractor', default: false },
      ]))

      const result = await service.getUserTypesDictionary({ search: 'contract' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ut2')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/meta/types/user`).reply(wrap([]))
      const result = await service.getUserTypesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getProfileMappingsDictionary', () => {
    it('returns mapped profile mappings', async () => {
      mock.onGet(`${BASE}/mappings`).reply(wrap([
        { id: 'prm1', source: { name: 'user', type: 'user' }, target: { name: 'salesforce', type: 'appuser' } },
      ]))

      const result = await service.getProfileMappingsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toContain('user')
      expect(result.items[0].label).toContain('salesforce')
      expect(result.items[0].value).toBe('prm1')
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/mappings`).reply(wrap([
        { id: 'prm1', source: { name: 'user', type: 'user' }, target: { name: 'salesforce', type: 'appuser' } },
        { id: 'prm2', source: { name: 'user', type: 'user' }, target: { name: 'slack', type: 'appuser' } },
      ]))

      const result = await service.getProfileMappingsDictionary({ search: 'slack' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('prm2')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/mappings`).reply(wrap([]))
      const result = await service.getProfileMappingsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getNetworkZonesDictionary', () => {
    it('returns mapped zones', async () => {
      mock.onGet(`${BASE}/zones`).reply(wrap([
        { id: 'nz1', name: 'OfficeNet', type: 'IP', status: 'ACTIVE', usage: 'POLICY' },
      ]))

      const result = await service.getNetworkZonesDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toContain('OfficeNet')
      expect(result.items[0].value).toBe('nz1')
      expect(result.items[0].note).toBe('POLICY')
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/zones`).reply(wrap([
        { id: 'nz1', name: 'OfficeNet', type: 'IP', status: 'ACTIVE', usage: 'POLICY' },
        { id: 'nz2', name: 'VPN', type: 'IP', status: 'ACTIVE', usage: 'BLOCKLIST' },
      ]))

      const result = await service.getNetworkZonesDictionary({ search: 'vpn' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('nz2')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/zones`).reply(wrap([]))
      const result = await service.getNetworkZonesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getTrustedOriginsDictionary', () => {
    it('returns mapped origins', async () => {
      mock.onGet(`${BASE}/trustedOrigins`).reply(wrap([
        { id: 'tos1', name: 'My Origin', origin: 'http://example.com', status: 'ACTIVE' },
      ]))

      const result = await service.getTrustedOriginsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toContain('My Origin')
      expect(result.items[0].label).toContain('http://example.com')
      expect(result.items[0].value).toBe('tos1')
    })

    it('passes search as q', async () => {
      mock.onGet(`${BASE}/trustedOrigins`).reply(wrap([]))
      await service.getTrustedOriginsDictionary({ search: 'example' })

      expect(mock.history[0].query).toMatchObject({ q: 'example' })
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/trustedOrigins`).reply(wrap([]))
      const result = await service.getTrustedOriginsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getEventHooksDictionary', () => {
    it('returns mapped hooks', async () => {
      mock.onGet(`${BASE}/eventHooks`).reply(wrap([
        { id: 'eh1', name: 'My Event Hook', status: 'ACTIVE', verificationStatus: 'VERIFIED' },
      ]))

      const result = await service.getEventHooksDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'My Event Hook', value: 'eh1' })
      expect(result.items[0].note).toContain('ACTIVE')
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/eventHooks`).reply(wrap([
        { id: 'eh1', name: 'Hook A', status: 'ACTIVE', verificationStatus: 'VERIFIED' },
        { id: 'eh2', name: 'Hook B', status: 'INACTIVE', verificationStatus: 'UNVERIFIED' },
      ]))

      const result = await service.getEventHooksDictionary({ search: 'hook b' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('eh2')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/eventHooks`).reply(wrap([]))
      const result = await service.getEventHooksDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getInlineHooksDictionary', () => {
    it('returns mapped hooks', async () => {
      mock.onGet(`${BASE}/inlineHooks`).reply(wrap([
        { id: 'ih1', name: 'Token Hook', type: 'com.okta.oauth2.tokens.transform' },
      ]))

      const result = await service.getInlineHooksDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'Token Hook', value: 'ih1' })
      expect(result.items[0].note).toBe('com.okta.oauth2.tokens.transform')
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/inlineHooks`).reply(wrap([
        { id: 'ih1', name: 'Token Hook', type: 'com.okta.oauth2.tokens.transform' },
        { id: 'ih2', name: 'Import Hook', type: 'com.okta.import.transform' },
      ]))

      const result = await service.getInlineHooksDictionary({ search: 'import' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ih2')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/inlineHooks`).reply(wrap([]))
      const result = await service.getInlineHooksDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getGroupRulesDictionary', () => {
    it('returns mapped rules', async () => {
      mock.onGet(`${BASE}/groups/rules`).reply(wrap([
        { id: 'gr1', name: 'Auto Engineers', status: 'ACTIVE' },
      ]))

      const result = await service.getGroupRulesDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'Auto Engineers', value: 'gr1', note: 'Status: ACTIVE' })
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/groups/rules`).reply(wrap([
        { id: 'gr1', name: 'Auto Engineers', status: 'ACTIVE' },
        { id: 'gr2', name: 'Sales Rule', status: 'INACTIVE' },
      ]))

      const result = await service.getGroupRulesDictionary({ search: 'sales' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('gr2')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/groups/rules`).reply(wrap([]))
      const result = await service.getGroupRulesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getOrgIdpKeysDictionary', () => {
    it('returns mapped keys', async () => {
      mock.onGet(`${BASE}/idps/credentials/keys`).reply(wrap([
        { kid: 'k1', use: 'sig', expiresAt: '2026-01-01T00:00:00.000Z' },
      ]))

      const result = await service.getOrgIdpKeysDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'k1', value: 'k1' })
      expect(result.items[0].note).toContain('sig')
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/idps/credentials/keys`).reply(wrap([
        { kid: 'key-abc', use: 'sig' },
        { kid: 'key-xyz', use: 'enc' },
      ]))

      const result = await service.getOrgIdpKeysDictionary({ search: 'xyz' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('key-xyz')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/idps/credentials/keys`).reply(wrap([]))
      const result = await service.getOrgIdpKeysDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── Dictionary Methods — Criteria-dependent (dependsOn) ──

  describe('getPoliciesDictionary', () => {
    it('returns mapped policies with default type', async () => {
      mock.onGet(`${BASE}/policies`).reply(wrap([
        { id: 'pol1', name: 'Global Session', type: 'OKTA_SIGN_ON', status: 'ACTIVE' },
      ]))

      const result = await service.getPoliciesDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toContain('Global Session')
      expect(result.items[0].value).toBe('pol1')
      expect(mock.history[0].query).toMatchObject({ type: 'OKTA_SIGN_ON' })
    })

    it('uses criteria type when provided', async () => {
      mock.onGet(`${BASE}/policies`).reply(wrap([]))
      await service.getPoliciesDictionary({ criteria: { type: 'PASSWORD' } })

      expect(mock.history[0].query).toMatchObject({ type: 'PASSWORD' })
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/policies`).reply(wrap([
        { id: 'p1', name: 'Default', type: 'OKTA_SIGN_ON', status: 'ACTIVE' },
        { id: 'p2', name: 'Strict', type: 'OKTA_SIGN_ON', status: 'ACTIVE' },
      ]))

      const result = await service.getPoliciesDictionary({ search: 'strict' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('p2')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/policies`).reply(wrap([]))
      const result = await service.getPoliciesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getPolicyRulesDictionary', () => {
    it('returns mapped rules', async () => {
      mock.onGet(`${BASE}/policies/pol1/rules`).reply(wrap([
        { id: 'r1', name: 'Default Rule', type: 'SIGN_ON', status: 'ACTIVE' },
      ]))

      const result = await service.getPolicyRulesDictionary({ criteria: { policyId: 'pol1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'Default Rule', value: 'r1' })
      expect(result.items[0].note).toContain('SIGN_ON')
    })

    it('returns empty when no policyId', async () => {
      const result = await service.getPolicyRulesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/policies/pol1/rules`).reply(wrap([
        { id: 'r1', name: 'Default', type: 'SIGN_ON', status: 'ACTIVE' },
        { id: 'r2', name: 'MFA Rule', type: 'SIGN_ON', status: 'ACTIVE' },
      ]))

      const result = await service.getPolicyRulesDictionary({ search: 'mfa', criteria: { policyId: 'pol1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('r2')
    })

    it('handles null payload', async () => {
      const result = await service.getPolicyRulesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getAuthServerPoliciesDictionary', () => {
    it('returns mapped policies', async () => {
      mock.onGet(`${BASE}/authorizationServers/as1/policies`).reply(wrap([
        { id: 'asp1', name: 'Default Policy', status: 'ACTIVE', priority: 1 },
      ]))

      const result = await service.getAuthServerPoliciesDictionary({ criteria: { authServerId: 'as1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'Default Policy', value: 'asp1' })
      expect(result.items[0].note).toContain('ACTIVE')
    })

    it('returns empty when no authServerId', async () => {
      const result = await service.getAuthServerPoliciesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/authorizationServers/as1/policies`).reply(wrap([
        { id: 'asp1', name: 'Default', status: 'ACTIVE', priority: 1 },
        { id: 'asp2', name: 'Custom', status: 'INACTIVE', priority: 2 },
      ]))

      const result = await service.getAuthServerPoliciesDictionary({ search: 'custom', criteria: { authServerId: 'as1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('asp2')
    })

    it('handles null payload', async () => {
      const result = await service.getAuthServerPoliciesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getAuthServerPolicyRulesDictionary', () => {
    it('returns mapped rules', async () => {
      mock.onGet(`${BASE}/authorizationServers/as1/policies/pol1/rules`).reply(wrap([
        { id: 'asr1', name: 'Default Rule', status: 'ACTIVE' },
      ]))

      const result = await service.getAuthServerPolicyRulesDictionary({ criteria: { authServerId: 'as1', policyId: 'pol1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'Default Rule', value: 'asr1', note: 'ACTIVE' })
    })

    it('returns empty when missing authServerId', async () => {
      const result = await service.getAuthServerPolicyRulesDictionary({ criteria: { policyId: 'pol1' } })

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns empty when missing policyId', async () => {
      const result = await service.getAuthServerPolicyRulesDictionary({ criteria: { authServerId: 'as1' } })

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/authorizationServers/as1/policies/pol1/rules`).reply(wrap([
        { id: 'r1', name: 'Default', status: 'ACTIVE' },
        { id: 'r2', name: 'Custom', status: 'ACTIVE' },
      ]))

      const result = await service.getAuthServerPolicyRulesDictionary({ search: 'custom', criteria: { authServerId: 'as1', policyId: 'pol1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('r2')
    })

    it('handles null payload', async () => {
      const result = await service.getAuthServerPolicyRulesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getScopesDictionary', () => {
    it('returns mapped scopes', async () => {
      mock.onGet(`${BASE}/authorizationServers/as1/scopes`).reply(wrap([
        { id: 'scp1', name: 'car:drive', consent: 'REQUIRED' },
      ]))

      const result = await service.getScopesDictionary({ criteria: { authServerId: 'as1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'car:drive', value: 'scp1', note: 'REQUIRED' })
    })

    it('returns empty when no authServerId', async () => {
      const result = await service.getScopesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/authorizationServers/as1/scopes`).reply(wrap([
        { id: 's1', name: 'read', consent: 'REQUIRED' },
        { id: 's2', name: 'write', consent: 'IMPLICIT' },
      ]))

      const result = await service.getScopesDictionary({ search: 'write', criteria: { authServerId: 'as1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('s2')
    })

    it('handles null payload', async () => {
      const result = await service.getScopesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getClaimsDictionary', () => {
    it('returns mapped claims', async () => {
      mock.onGet(`${BASE}/authorizationServers/as1/claims`).reply(wrap([
        { id: 'clm1', name: 'Support', claimType: 'IDENTITY', valueType: 'GROUPS' },
      ]))

      const result = await service.getClaimsDictionary({ criteria: { authServerId: 'as1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'Support', value: 'clm1' })
      expect(result.items[0].note).toContain('IDENTITY')
    })

    it('returns empty when no authServerId', async () => {
      const result = await service.getClaimsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/authorizationServers/as1/claims`).reply(wrap([
        { id: 'c1', name: 'email', claimType: 'RESOURCE', valueType: 'EXPRESSION' },
        { id: 'c2', name: 'groups', claimType: 'IDENTITY', valueType: 'GROUPS' },
      ]))

      const result = await service.getClaimsDictionary({ search: 'groups', criteria: { authServerId: 'as1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('c2')
    })

    it('handles null payload', async () => {
      const result = await service.getClaimsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getResourceServerKeysDictionary', () => {
    it('returns mapped keys', async () => {
      mock.onGet(`${BASE}/authorizationServers/as1/resourceservercredentials/keys`).reply(wrap([
        { id: 'rsk1', kid: 'kid1', use: 'enc', status: 'ACTIVE' },
      ]))

      const result = await service.getResourceServerKeysDictionary({ criteria: { authServerId: 'as1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'kid1', value: 'rsk1' })
    })

    it('returns empty when no authServerId', async () => {
      const result = await service.getResourceServerKeysDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles null payload', async () => {
      const result = await service.getResourceServerKeysDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getApplicationKeysDictionary', () => {
    it('returns mapped keys', async () => {
      mock.onGet(`${BASE}/apps/app1/credentials/keys`).reply(wrap([
        { kid: 'kid1', use: 'sig', kty: 'RSA', expiresAt: '2026-12-10T00:00:00.000Z' },
      ]))

      const result = await service.getApplicationKeysDictionary({ criteria: { appId: 'app1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toContain('kid1')
      expect(result.items[0].label).toContain('expires')
      expect(result.items[0].value).toBe('kid1')
    })

    it('returns empty when no appId', async () => {
      const result = await service.getApplicationKeysDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/apps/app1/credentials/keys`).reply(wrap([
        { kid: 'key-abc', use: 'sig', kty: 'RSA' },
        { kid: 'key-xyz', use: 'sig', kty: 'RSA' },
      ]))

      const result = await service.getApplicationKeysDictionary({ search: 'xyz', criteria: { appId: 'app1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('key-xyz')
    })

    it('handles null payload', async () => {
      const result = await service.getApplicationKeysDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getAppCsrsDictionary', () => {
    it('returns mapped CSRs', async () => {
      mock.onGet(`${BASE}/apps/app1/credentials/csrs`).reply(wrap([
        { id: 'csrId12345678rest', created: '2017-03-28T01:11:10.000Z', kty: 'RSA' },
      ]))

      const result = await service.getAppCsrsDictionary({ criteria: { appId: 'app1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toContain('CSR csrId123')
      expect(result.items[0].value).toBe('csrId12345678rest')
      expect(result.items[0].note).toBe('RSA')
    })

    it('returns empty when no appId', async () => {
      const result = await service.getAppCsrsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles null payload', async () => {
      const result = await service.getAppCsrsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getAppJwksDictionary', () => {
    it('returns mapped JWKs', async () => {
      mock.onGet(`${BASE}/apps/app1/credentials/jwks`).reply(wrap({
        jwks: { keys: [{ id: 'pks1', kid: 'kid1', use: 'sig', status: 'ACTIVE' }] },
      }))

      const result = await service.getAppJwksDictionary({ criteria: { appId: 'app1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'kid1', value: 'pks1' })
    })

    it('returns empty when no appId', async () => {
      const result = await service.getAppJwksDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles null payload', async () => {
      const result = await service.getAppJwksDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles missing jwks structure', async () => {
      mock.onGet(`${BASE}/apps/app1/credentials/jwks`).reply(wrap({}))

      const result = await service.getAppJwksDictionary({ criteria: { appId: 'app1' } })

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getAppSecretsDictionary', () => {
    it('returns mapped secrets', async () => {
      mock.onGet(`${BASE}/apps/app1/credentials/secrets`).reply(wrap([
        { id: 'ocs12345678rest', status: 'ACTIVE', secret_hash: 'abc123' },
      ]))

      const result = await service.getAppSecretsDictionary({ criteria: { appId: 'app1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toContain('Secret ocs12345')
      expect(result.items[0].label).toContain('ACTIVE')
      expect(result.items[0].value).toBe('ocs12345678rest')
      expect(result.items[0].note).toBe('abc123')
    })

    it('returns empty when no appId', async () => {
      const result = await service.getAppSecretsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles null payload', async () => {
      const result = await service.getAppSecretsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getIdpSigningKeysDictionary', () => {
    it('returns mapped keys', async () => {
      mock.onGet(`${BASE}/idps/idp1/credentials/keys`).reply(wrap([
        { kid: 'kid1', use: 'sig', kty: 'RSA', expiresAt: '2026-12-10T00:00:00.000Z' },
      ]))

      const result = await service.getIdpSigningKeysDictionary({ criteria: { idpId: 'idp1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toContain('kid1')
      expect(result.items[0].label).toContain('expires')
      expect(result.items[0].value).toBe('kid1')
    })

    it('returns empty when no idpId', async () => {
      const result = await service.getIdpSigningKeysDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles null payload', async () => {
      const result = await service.getIdpSigningKeysDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getIdpCsrsDictionary', () => {
    it('returns mapped CSRs', async () => {
      mock.onGet(`${BASE}/idps/idp1/credentials/csrs`).reply(wrap([
        { id: 'csrABCDEFGHrest', created: '2017-03-28T01:11:10.000Z' },
      ]))

      const result = await service.getIdpCsrsDictionary({ criteria: { idpId: 'idp1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toContain('CSR csrABCDE')
      expect(result.items[0].value).toBe('csrABCDEFGHrest')
      expect(result.items[0].note).toBe('')
    })

    it('returns empty when no idpId', async () => {
      const result = await service.getIdpCsrsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles null payload', async () => {
      const result = await service.getIdpCsrsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── Dictionary Methods — User-dependent (criteria.userId) ──

  describe('getUserClientsDictionary', () => {
    it('returns mapped clients', async () => {
      mock.onGet(`${BASE}/users/u1/clients`).reply(wrap([
        { client_id: 'c1', client_name: 'My App' },
      ]))

      const result = await service.getUserClientsDictionary({ criteria: { userId: 'u1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'My App', value: 'c1' })
    })

    it('returns empty when no userId', async () => {
      const result = await service.getUserClientsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/users/u1/clients`).reply(wrap([
        { client_id: 'c1', client_name: 'My App' },
        { client_id: 'c2', client_name: 'Other App' },
      ]))

      const result = await service.getUserClientsDictionary({ search: 'other', criteria: { userId: 'u1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('c2')
    })

    it('handles null payload', async () => {
      const result = await service.getUserClientsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getUserGrantsDictionary', () => {
    it('returns mapped grants', async () => {
      mock.onGet(`${BASE}/users/u1/grants`).reply(wrap([
        { id: 'g1', scopeId: 'okta.users.read', status: 'ACTIVE', clientId: 'c1' },
      ]))

      const result = await service.getUserGrantsDictionary({ criteria: { userId: 'u1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'okta.users.read', value: 'g1' })
    })

    it('returns empty when no userId', async () => {
      const result = await service.getUserGrantsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/users/u1/grants`).reply(wrap([
        { id: 'g1', scopeId: 'okta.users.read', status: 'ACTIVE', clientId: 'c1' },
        { id: 'g2', scopeId: 'okta.groups.manage', status: 'ACTIVE', clientId: 'c1' },
      ]))

      const result = await service.getUserGrantsDictionary({ search: 'groups', criteria: { userId: 'u1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('g2')
    })

    it('handles null payload', async () => {
      const result = await service.getUserGrantsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getUserTokensDictionary', () => {
    it('returns mapped tokens', async () => {
      mock.onGet(`${BASE}/users/u1/clients/c1/tokens`).reply(wrap([
        { id: 'tok1', status: 'ACTIVE', scopes: ['openid', 'offline_access'] },
      ]))

      const result = await service.getUserTokensDictionary({ criteria: { userId: 'u1', clientId: 'c1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'tok1', value: 'tok1' })
      expect(result.items[0].note).toContain('openid')
    })

    it('returns empty when no userId', async () => {
      const result = await service.getUserTokensDictionary({ criteria: { clientId: 'c1' } })

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns empty when no clientId', async () => {
      const result = await service.getUserTokensDictionary({ criteria: { userId: 'u1' } })

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles null payload', async () => {
      const result = await service.getUserTokensDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getUserFactorsDictionary', () => {
    it('returns mapped factors', async () => {
      mock.onGet(`${BASE}/users/u1/factors`).reply(wrap([
        { id: 'f1', factorType: 'sms', provider: 'OKTA', status: 'ACTIVE' },
      ]))

      const result = await service.getUserFactorsDictionary({ criteria: { userId: 'u1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'sms (OKTA)', value: 'f1', note: 'Status: ACTIVE' })
    })

    it('returns empty when no userId', async () => {
      const result = await service.getUserFactorsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/users/u1/factors`).reply(wrap([
        { id: 'f1', factorType: 'sms', provider: 'OKTA', status: 'ACTIVE' },
        { id: 'f2', factorType: 'token:software:totp', provider: 'GOOGLE', status: 'ACTIVE' },
      ]))

      const result = await service.getUserFactorsDictionary({ search: 'google', criteria: { userId: 'u1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('f2')
    })

    it('handles null payload', async () => {
      const result = await service.getUserFactorsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getUserRoleAssignmentsDictionary', () => {
    it('returns mapped roles', async () => {
      mock.onGet(`${BASE}/users/u1/roles`).reply(wrap([
        { id: 'ra1', label: 'Application Administrator', type: 'APP_ADMIN' },
      ]))

      const result = await service.getUserRoleAssignmentsDictionary({ criteria: { userId: 'u1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'Application Administrator', value: 'ra1', note: 'Type: APP_ADMIN' })
    })

    it('returns empty when no userId', async () => {
      const result = await service.getUserRoleAssignmentsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('filters by search locally', async () => {
      mock.onGet(`${BASE}/users/u1/roles`).reply(wrap([
        { id: 'ra1', label: 'Application Administrator', type: 'APP_ADMIN' },
        { id: 'ra2', label: 'Super Administrator', type: 'SUPER_ADMIN' },
      ]))

      const result = await service.getUserRoleAssignmentsDictionary({ search: 'super', criteria: { userId: 'u1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ra2')
    })

    it('handles null payload', async () => {
      const result = await service.getUserRoleAssignmentsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── PARAM_SCHEMA_DEFINITION Methods ──

  describe('hookHeaderSchema', () => {
    it('returns array with key and value fields', async () => {
      const result = await service.hookHeaderSchema()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(2)
      expect(result[0]).toMatchObject({ type: 'String', name: 'key' })
      expect(result[1]).toMatchObject({ type: 'String', name: 'value' })
    })
  })

  describe('networkZoneAddressSchema', () => {
    it('returns array with type and value fields', async () => {
      const result = await service.networkZoneAddressSchema()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(2)
      expect(result[0]).toMatchObject({ type: 'String', name: 'type' })
      expect(result[1]).toMatchObject({ type: 'String', name: 'value' })
    })
  })

  describe('jsonPatchOpSchema', () => {
    it('returns array with op, path, value fields', async () => {
      const result = await service.jsonPatchOpSchema()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(3)
      expect(result[0]).toMatchObject({ type: 'String', name: 'op', required: true })
      expect(result[1]).toMatchObject({ type: 'String', name: 'path', required: true })
      expect(result[2]).toMatchObject({ type: 'String', name: 'value', required: false })
    })
  })

  describe('aaguidCharacteristicsSchema', () => {
    it('returns array with boolean fields', async () => {
      const result = await service.aaguidCharacteristicsSchema()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(3)
      expect(result[0]).toMatchObject({ type: 'Boolean', name: 'platformAttached' })
      expect(result[1]).toMatchObject({ type: 'Boolean', name: 'fipsCompliant' })
      expect(result[2]).toMatchObject({ type: 'Boolean', name: 'hardwareProtected' })
    })
  })

  describe('idpPolicySchema', () => {
    it('returns array with account link and provisioning fields', async () => {
      const result = await service.idpPolicySchema()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThanOrEqual(4)
      expect(result[0]).toMatchObject({ name: 'accountLinkAction' })
      expect(result[1]).toMatchObject({ name: 'provisioningAction' })
    })
  })

  describe('idpProtocolSchema', () => {
    it('returns SAML2 fields when type is SAML2', async () => {
      const result = await service.idpProtocolSchema({ criteria: { type: 'SAML2' } })

      expect(Array.isArray(result)).toBe(true)
      expect(result[0]).toMatchObject({ name: 'issuerUrl' })
      expect(result[1]).toMatchObject({ name: 'ssoUrl' })
    })

    it('returns OIDC fields for non-SAML types', async () => {
      const result = await service.idpProtocolSchema({ criteria: { type: 'OIDC' } })

      expect(Array.isArray(result)).toBe(true)
      expect(result[0]).toMatchObject({ name: 'clientId' })
      expect(result[1]).toMatchObject({ name: 'clientSecret' })
    })

    it('returns OIDC fields when no criteria', async () => {
      const result = await service.idpProtocolSchema()

      expect(Array.isArray(result)).toBe(true)
      expect(result[0]).toMatchObject({ name: 'clientId' })
    })
  })

  describe('policyConditionsSchema', () => {
    it('returns array with groups include field', async () => {
      const result = await service.policyConditionsSchema()

      expect(Array.isArray(result)).toBe(true)
      expect(result[0]).toMatchObject({ name: 'peopleGroupsInclude' })
    })
  })

  describe('policyActionsSchema', () => {
    it('returns empty array', async () => {
      const result = await service.policyActionsSchema()

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(0)
    })
  })

  describe('policyRuleConditionsSchema', () => {
    it('returns array with network, risk, group, user fields', async () => {
      const result = await service.policyRuleConditionsSchema()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(4)
      expect(result[0]).toMatchObject({ name: 'networkConnection' })
      expect(result[1]).toMatchObject({ name: 'riskScoreLevel' })
      expect(result[2]).toMatchObject({ name: 'peopleGroupsInclude' })
      expect(result[3]).toMatchObject({ name: 'peopleUsersExclude' })
    })
  })

  describe('policyRuleActionsSchema', () => {
    it('returns array with signon action fields', async () => {
      const result = await service.policyRuleActionsSchema()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThanOrEqual(5)
      expect(result[0]).toMatchObject({ name: 'signonAccess' })
      expect(result[1]).toMatchObject({ name: 'requireFactor', type: 'Boolean' })
    })
  })

  describe('behaviorRuleSettingsSchema', () => {
    it('returns velocity field for VELOCITY type', async () => {
      const result = await service.behaviorRuleSettingsSchema({ criteria: { type: 'VELOCITY' } })

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ name: 'velocityKph', type: 'Number' })
    })

    it('returns location fields for ANOMALOUS_LOCATION type', async () => {
      const result = await service.behaviorRuleSettingsSchema({ criteria: { type: 'ANOMALOUS_LOCATION' } })

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(4)
      expect(result[0]).toMatchObject({ name: 'granularity' })
    })

    it('returns history-based fields for other types', async () => {
      const result = await service.behaviorRuleSettingsSchema({ criteria: { type: 'ANOMALOUS_IP' } })

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(2)
      expect(result[0]).toMatchObject({ name: 'maxEventsUsedForEvaluation' })
    })

    it('returns history-based fields when no criteria', async () => {
      const result = await service.behaviorRuleSettingsSchema()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(2)
    })
  })

  describe('authenticatorProviderSchema', () => {
    it('returns duo fields for duo key', async () => {
      const result = await service.authenticatorProviderSchema({ criteria: { key: 'duo' } })

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(4)
      expect(result[0]).toMatchObject({ name: 'integrationKey' })
    })

    it('returns tac fields for tac key', async () => {
      const result = await service.authenticatorProviderSchema({ criteria: { key: 'tac' } })

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(8)
      expect(result[0]).toMatchObject({ name: 'minTtl' })
    })

    it('returns empty array for other keys', async () => {
      const result = await service.authenticatorProviderSchema({ criteria: { key: 'webauthn' } })

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(0)
    })

    it('returns empty array when no criteria', async () => {
      const result = await service.authenticatorProviderSchema()

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(0)
    })
  })

  describe('authenticatorMethodSettingsSchema', () => {
    it('returns webauthn fields for webauthn method', async () => {
      const result = await service.authenticatorMethodSettingsSchema({ criteria: { methodType: 'webauthn' } })

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(2)
      expect(result[0]).toMatchObject({ name: 'userVerification' })
      expect(result[1]).toMatchObject({ name: 'attachment' })
    })

    it('returns empty array for other method types', async () => {
      const result = await service.authenticatorMethodSettingsSchema({ criteria: { methodType: 'sms' } })

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(0)
    })

    it('returns empty array when no criteria', async () => {
      const result = await service.authenticatorMethodSettingsSchema()

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(0)
    })
  })

  describe('appSettingsSchema', () => {
    it('returns bookmark field for BOOKMARK sign-on mode', async () => {
      const result = await service.appSettingsSchema({ criteria: { signOnMode: 'BOOKMARK' } })

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ name: 'url', label: 'Bookmark URL' })
    })

    it('returns auto-login fields for AUTO_LOGIN sign-on mode', async () => {
      const result = await service.appSettingsSchema({ criteria: { signOnMode: 'AUTO_LOGIN' } })

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ name: 'loginUrl' })
      expect(result[1]).toMatchObject({ name: 'redirectUrl' })
    })

    it('returns null for unsupported sign-on mode', async () => {
      const result = await service.appSettingsSchema({ criteria: { signOnMode: 'SAML' } })

      expect(result).toBeNull()
    })

    it('returns null when no criteria', async () => {
      const result = await service.appSettingsSchema()

      expect(result).toBeNull()
    })
  })

  describe('appUserProfileSchema', () => {
    it('returns fields from app schema', async () => {
      mock.onGet(`${BASE}/meta/schemas/apps/app1/default`).reply(wrap({
        definitions: {
          base: {
            properties: {
              userName: { type: 'string', title: 'Username', required: true, mutability: 'READ_WRITE' },
              readOnlyField: { type: 'string', title: 'Read Only', mutability: 'READ_ONLY' },
            },
          },
          custom: {
            properties: {
              department: { type: 'string', title: 'Department', mutability: 'READ_WRITE' },
            },
          },
        },
      }))

      const result = await service.appUserProfileSchema({ criteria: { appId: 'app1' } })

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(2)
      expect(result.find(f => f.name === 'userName')).toBeDefined()
      expect(result.find(f => f.name === 'department')).toBeDefined()
      expect(result.find(f => f.name === 'readOnlyField')).toBeUndefined()
    })

    it('returns null when no appId', async () => {
      const result = await service.appUserProfileSchema({ criteria: {} })

      expect(result).toBeNull()
    })

    it('returns null when no criteria', async () => {
      const result = await service.appUserProfileSchema()

      expect(result).toBeNull()
    })

    it('returns null when API call fails', async () => {
      mock.onGet(`${BASE}/meta/schemas/apps/app1/default`).replyWithError({ message: 'Not Found' })

      const result = await service.appUserProfileSchema({ criteria: { appId: 'app1' } })

      expect(result).toBeNull()
    })
  })
})
