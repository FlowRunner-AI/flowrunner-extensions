'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-ssws-token'
const ORG_URL = 'https://dev-123456.okta.com'
const BASE = `${ORG_URL}/api/v1`

// The service uses .unwrapBody(false) on every request, so the mock must return
// a response-shaped object { body, headers } instead of raw data.
const wrap = (body, headers) => ({ body, headers: headers || {} })

describe('Okta Service — AuthZ Servers, Scopes, Claims, Policies, IdPs, Keys', () => {
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

  // ── Authorization Servers ──

  describe('listAuthorizationServers', () => {
    it('lists servers with no filters', async () => {
      mock.onGet(`${BASE}/authorizationServers`).reply(wrap([{ id: 'aus1', name: 'My AS' }]))
      const result = await service.listAuthorizationServers()

      expect(result).toHaveProperty('items')
      expect(result.items).toHaveLength(1)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes q, limit, and after', async () => {
      mock.onGet(`${BASE}/authorizationServers`).reply(wrap([]))
      await service.listAuthorizationServers('test', 10, 'cursor1')

      expect(mock.history[0].query).toMatchObject({ q: 'test', limit: 10, after: 'cursor1' })
    })
  })

  describe('createAuthorizationServer', () => {
    it('sends POST with name and audiences', async () => {
      mock.onPost(`${BASE}/authorizationServers`).reply(wrap({ id: 'aus1', name: 'New AS' }))
      const result = await service.createAuthorizationServer('New AS', ['api://default'], 'Desc', 'Org URL')

      expect(result).toMatchObject({ id: 'aus1', name: 'New AS' })
      expect(mock.history[0].body).toMatchObject({
        name: 'New AS',
        audiences: ['api://default'],
        description: 'Desc',
        issuerMode: 'ORG_URL',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/authorizationServers`).reply(wrap({ id: 'aus2' }))
      await service.createAuthorizationServer('AS2', ['api://test'])

      expect(mock.history[0].body).toEqual({ name: 'AS2', audiences: ['api://test'] })
    })
  })

  describe('getAuthorizationServer', () => {
    it('sends GET to correct path', async () => {
      mock.onGet(`${BASE}/authorizationServers/aus1`).reply(wrap({ id: 'aus1', name: 'AS' }))
      const result = await service.getAuthorizationServer('aus1')

      expect(result).toMatchObject({ id: 'aus1' })
    })
  })

  describe('replaceAuthorizationServer', () => {
    it('sends PUT with body', async () => {
      mock.onPut(`${BASE}/authorizationServers/aus1`).reply(wrap({ id: 'aus1' }))
      await service.replaceAuthorizationServer('aus1', 'Updated', ['api://new'], 'New desc', 'Custom URL')

      expect(mock.history[0].body).toMatchObject({
        name: 'Updated',
        audiences: ['api://new'],
        description: 'New desc',
        issuerMode: 'CUSTOM_URL',
      })
    })
  })

  describe('deleteAuthorizationServer', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${BASE}/authorizationServers/aus1`).reply(wrap(null))
      const result = await service.deleteAuthorizationServer('aus1')

      expect(result).toEqual({ deleted: true, authServerId: 'aus1' })
    })
  })

  describe('activateAuthorizationServer', () => {
    it('sends POST to lifecycle/activate', async () => {
      mock.onPost(`${BASE}/authorizationServers/aus1/lifecycle/activate`).reply(wrap(null))
      const result = await service.activateAuthorizationServer('aus1')

      expect(result).toEqual({ activated: true, authServerId: 'aus1' })
    })
  })

  describe('deactivateAuthorizationServer', () => {
    it('sends POST to lifecycle/deactivate', async () => {
      mock.onPost(`${BASE}/authorizationServers/aus1/lifecycle/deactivate`).reply(wrap(null))
      const result = await service.deactivateAuthorizationServer('aus1')

      expect(result).toEqual({ deactivated: true, authServerId: 'aus1' })
    })
  })

  // ── Authorization Server Keys ──

  describe('listAuthorizationServerKeys', () => {
    it('lists signing keys', async () => {
      mock.onGet(`${BASE}/authorizationServers/aus1/credentials/keys`).reply(wrap([{ kid: 'k1', use: 'sig' }]))
      const result = await service.listAuthorizationServerKeys('aus1')

      expect(result.items).toHaveLength(1)
      expect(result.items[0].kid).toBe('k1')
    })
  })

  describe('getAuthorizationServerKey', () => {
    it('retrieves a single key by kid', async () => {
      mock.onGet(`${BASE}/authorizationServers/aus1/credentials/keys/k1`).reply(wrap({ kid: 'k1' }))
      const result = await service.getAuthorizationServerKey('aus1', 'k1')

      expect(result).toMatchObject({ kid: 'k1' })
    })
  })

  describe('rotateAuthorizationServerKeys', () => {
    it('sends POST with use:sig', async () => {
      mock.onPost(`${BASE}/authorizationServers/aus1/credentials/lifecycle/keyRotate`).reply(wrap([{ kid: 'new', status: 'ACTIVE' }]))
      const result = await service.rotateAuthorizationServerKeys('aus1', 'Signing')

      expect(mock.history[0].body).toEqual({ use: 'sig' })
      expect(result.items).toHaveLength(1)
    })
  })

  // ── Authorization Server Policies ──

  describe('listAuthorizationServerPolicies', () => {
    it('lists policies for an auth server', async () => {
      mock.onGet(`${BASE}/authorizationServers/aus1/policies`).reply(wrap([{ id: 'pol1', name: 'Default' }]))
      const result = await service.listAuthorizationServerPolicies('aus1')

      expect(result.items).toHaveLength(1)
    })
  })

  describe('createAuthorizationServerPolicy', () => {
    it('sends POST with policy body', async () => {
      mock.onPost(`${BASE}/authorizationServers/aus1/policies`).reply(wrap({ id: 'pol1', name: 'Test Policy' }))
      const result = await service.createAuthorizationServerPolicy('aus1', 'Test Policy', 'Desc', 'Active', 1)

      expect(result).toMatchObject({ id: 'pol1' })
      expect(mock.history[0].body).toMatchObject({
        type: 'OAUTH_AUTHORIZATION_POLICY',
        name: 'Test Policy',
        description: 'Desc',
        status: 'ACTIVE',
        priority: 1,
        conditions: { clients: { include: ['ALL_CLIENTS'] } },
      })
    })

    it('uses custom conditions when provided', async () => {
      mock.onPost(`${BASE}/authorizationServers/aus1/policies`).reply(wrap({ id: 'pol2' }))
      await service.createAuthorizationServerPolicy('aus1', 'Custom', undefined, undefined, undefined, { clients: { include: ['c1'] } })

      expect(mock.history[0].body.conditions).toEqual({ clients: { include: ['c1'] } })
    })
  })

  describe('getAuthorizationServerPolicy', () => {
    it('retrieves a policy', async () => {
      mock.onGet(`${BASE}/authorizationServers/aus1/policies/pol1`).reply(wrap({ id: 'pol1' }))
      const result = await service.getAuthorizationServerPolicy('aus1', 'pol1')

      expect(result).toMatchObject({ id: 'pol1' })
    })
  })

  describe('replaceAuthorizationServerPolicy', () => {
    it('sends PUT with full policy body', async () => {
      mock.onPut(`${BASE}/authorizationServers/aus1/policies/pol1`).reply(wrap({ id: 'pol1' }))
      await service.replaceAuthorizationServerPolicy('aus1', 'pol1', 'Updated', 'Desc', 'Active', 2)

      expect(mock.history[0].body).toMatchObject({
        type: 'OAUTH_AUTHORIZATION_POLICY',
        name: 'Updated',
        description: 'Desc',
        status: 'ACTIVE',
        priority: 2,
      })
    })
  })

  describe('deleteAuthorizationServerPolicy', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${BASE}/authorizationServers/aus1/policies/pol1`).reply(wrap(null))
      const result = await service.deleteAuthorizationServerPolicy('aus1', 'pol1')

      expect(result).toEqual({ deleted: true, policyId: 'pol1' })
    })
  })

  describe('activateAuthorizationServerPolicy', () => {
    it('sends POST to activate', async () => {
      mock.onPost(`${BASE}/authorizationServers/aus1/policies/pol1/lifecycle/activate`).reply(wrap(null))
      const result = await service.activateAuthorizationServerPolicy('aus1', 'pol1')

      expect(result).toEqual({ activated: true, policyId: 'pol1' })
    })
  })

  describe('deactivateAuthorizationServerPolicy', () => {
    it('sends POST to deactivate', async () => {
      mock.onPost(`${BASE}/authorizationServers/aus1/policies/pol1/lifecycle/deactivate`).reply(wrap(null))
      const result = await service.deactivateAuthorizationServerPolicy('aus1', 'pol1')

      expect(result).toEqual({ deactivated: true, policyId: 'pol1' })
    })
  })

  // ── Authorization Server Policy Rules ──

  describe('listAuthorizationServerPolicyRules', () => {
    it('lists rules for a policy', async () => {
      mock.onGet(`${BASE}/authorizationServers/aus1/policies/pol1/rules`).reply(wrap([{ id: 'rul1', name: 'Default Rule' }]))
      const result = await service.listAuthorizationServerPolicyRules('aus1', 'pol1')

      expect(result.items).toHaveLength(1)
    })
  })

  describe('createAuthorizationServerPolicyRule', () => {
    it('sends POST with conditions and actions', async () => {
      const conditions = { people: { groups: { include: ['EVERYONE'] } }, grantTypes: { include: ['authorization_code'] }, scopes: { include: ['*'] } }
      const actions = { token: { accessTokenLifetimeMinutes: 60 } }

      mock.onPost(`${BASE}/authorizationServers/aus1/policies/pol1/rules`).reply(wrap({ id: 'rul1' }))
      const result = await service.createAuthorizationServerPolicyRule('aus1', 'pol1', 'Test Rule', 1, conditions, actions)

      expect(result).toMatchObject({ id: 'rul1' })
      expect(mock.history[0].body).toMatchObject({
        type: 'RESOURCE_ACCESS',
        name: 'Test Rule',
        priority: 1,
        conditions,
        actions,
      })
    })
  })

  describe('getAuthorizationServerPolicyRule', () => {
    it('retrieves a rule', async () => {
      mock.onGet(`${BASE}/authorizationServers/aus1/policies/pol1/rules/rul1`).reply(wrap({ id: 'rul1' }))
      const result = await service.getAuthorizationServerPolicyRule('aus1', 'pol1', 'rul1')

      expect(result).toMatchObject({ id: 'rul1' })
    })
  })

  describe('replaceAuthorizationServerPolicyRule', () => {
    it('sends PUT with full rule body', async () => {
      const conditions = { people: { groups: { include: ['EVERYONE'] } } }
      const actions = { token: { accessTokenLifetimeMinutes: 120 } }

      mock.onPut(`${BASE}/authorizationServers/aus1/policies/pol1/rules/rul1`).reply(wrap({ id: 'rul1' }))
      await service.replaceAuthorizationServerPolicyRule('aus1', 'pol1', 'rul1', 'Updated Rule', 2, conditions, actions)

      expect(mock.history[0].body).toMatchObject({
        type: 'RESOURCE_ACCESS',
        name: 'Updated Rule',
        priority: 2,
      })
    })
  })

  describe('deleteAuthorizationServerPolicyRule', () => {
    it('deletes a rule', async () => {
      mock.onDelete(`${BASE}/authorizationServers/aus1/policies/pol1/rules/rul1`).reply(wrap(null))
      const result = await service.deleteAuthorizationServerPolicyRule('aus1', 'pol1', 'rul1')

      expect(result).toEqual({ deleted: true, ruleId: 'rul1' })
    })
  })

  describe('activateAuthorizationServerPolicyRule', () => {
    it('activates a rule', async () => {
      mock.onPost(`${BASE}/authorizationServers/aus1/policies/pol1/rules/rul1/lifecycle/activate`).reply(wrap(null))
      const result = await service.activateAuthorizationServerPolicyRule('aus1', 'pol1', 'rul1')

      expect(result).toEqual({ activated: true, ruleId: 'rul1' })
    })
  })

  describe('deactivateAuthorizationServerPolicyRule', () => {
    it('deactivates a rule', async () => {
      mock.onPost(`${BASE}/authorizationServers/aus1/policies/pol1/rules/rul1/lifecycle/deactivate`).reply(wrap(null))
      const result = await service.deactivateAuthorizationServerPolicyRule('aus1', 'pol1', 'rul1')

      expect(result).toEqual({ deactivated: true, ruleId: 'rul1' })
    })
  })

  // ── OAuth2 Scopes ──

  describe('listOAuth2Scopes', () => {
    it('lists scopes for an auth server', async () => {
      mock.onGet(`${BASE}/authorizationServers/aus1/scopes`).reply(wrap([{ id: 'scp1', name: 'car:drive' }]))
      const result = await service.listOAuth2Scopes('aus1')

      expect(result.items).toHaveLength(1)
    })

    it('passes limit and after', async () => {
      mock.onGet(`${BASE}/authorizationServers/aus1/scopes`).reply(wrap([]))
      await service.listOAuth2Scopes('aus1', 25, 'cur')

      expect(mock.history[0].query).toMatchObject({ limit: 25, after: 'cur' })
    })
  })

  describe('createOAuth2Scope', () => {
    it('sends POST with scope body', async () => {
      mock.onPost(`${BASE}/authorizationServers/aus1/scopes`).reply(wrap({ id: 'scp1', name: 'car:drive' }))
      const result = await service.createOAuth2Scope('aus1', 'car:drive', 'Drive', 'Permission to drive', 'Required', 'All Clients')

      expect(result).toMatchObject({ id: 'scp1' })
      expect(mock.history[0].body).toMatchObject({
        name: 'car:drive',
        displayName: 'Drive',
        description: 'Permission to drive',
        consent: 'REQUIRED',
        metadataPublish: 'ALL_CLIENTS',
      })
    })

    it('omits optional fields', async () => {
      mock.onPost(`${BASE}/authorizationServers/aus1/scopes`).reply(wrap({ id: 'scp2' }))
      await service.createOAuth2Scope('aus1', 'read')

      expect(mock.history[0].body).toEqual({ name: 'read' })
    })
  })

  describe('getOAuth2Scope', () => {
    it('retrieves a scope', async () => {
      mock.onGet(`${BASE}/authorizationServers/aus1/scopes/scp1`).reply(wrap({ id: 'scp1' }))
      const result = await service.getOAuth2Scope('aus1', 'scp1')

      expect(result).toMatchObject({ id: 'scp1' })
    })
  })

  describe('replaceOAuth2Scope', () => {
    it('sends PUT with full scope body', async () => {
      mock.onPut(`${BASE}/authorizationServers/aus1/scopes/scp1`).reply(wrap({ id: 'scp1' }))
      await service.replaceOAuth2Scope('aus1', 'scp1', 'car:drive', 'Drive', 'Updated', 'Implicit (no dialog)', 'No Clients')

      expect(mock.history[0].body).toMatchObject({
        name: 'car:drive',
        consent: 'IMPLICIT',
        metadataPublish: 'NO_CLIENTS',
      })
    })
  })

  describe('deleteOAuth2Scope', () => {
    it('deletes a scope', async () => {
      mock.onDelete(`${BASE}/authorizationServers/aus1/scopes/scp1`).reply(wrap(null))
      const result = await service.deleteOAuth2Scope('aus1', 'scp1')

      expect(result).toEqual({ deleted: true, scopeId: 'scp1' })
    })
  })

  // ── OAuth2 Claims ──

  describe('listOAuth2Claims', () => {
    it('lists claims for an auth server', async () => {
      mock.onGet(`${BASE}/authorizationServers/aus1/claims`).reply(wrap([{ id: 'clm1', name: 'Support' }]))
      const result = await service.listOAuth2Claims('aus1')

      expect(result.items).toHaveLength(1)
    })
  })

  describe('createOAuth2Claim', () => {
    it('sends POST with claim body', async () => {
      mock.onPost(`${BASE}/authorizationServers/aus1/claims`).reply(wrap({ id: 'clm1' }))
      const result = await service.createOAuth2Claim(
        'aus1', 'Support', 'ID Token (Identity)', 'Groups', 'Support', true, ['profile'], 'Contains'
      )

      expect(result).toMatchObject({ id: 'clm1' })
      expect(mock.history[0].body).toMatchObject({
        name: 'Support',
        claimType: 'IDENTITY',
        valueType: 'GROUPS',
        value: 'Support',
        alwaysIncludeInToken: true,
        conditions: { scopes: ['profile'] },
        group_filter_type: 'CONTAINS',
      })
    })

    it('omits optional fields', async () => {
      mock.onPost(`${BASE}/authorizationServers/aus1/claims`).reply(wrap({ id: 'clm2' }))
      await service.createOAuth2Claim('aus1', 'email', 'Access Token (Resource)', 'Expression (Okta EL)', 'user.email')

      const body = mock.history[0].body
      expect(body).toMatchObject({ name: 'email', claimType: 'RESOURCE', valueType: 'EXPRESSION', value: 'user.email' })
      expect(body).not.toHaveProperty('alwaysIncludeInToken')
      expect(body).not.toHaveProperty('conditions')
      expect(body).not.toHaveProperty('group_filter_type')
    })
  })

  describe('getOAuth2Claim', () => {
    it('retrieves a claim', async () => {
      mock.onGet(`${BASE}/authorizationServers/aus1/claims/clm1`).reply(wrap({ id: 'clm1' }))
      const result = await service.getOAuth2Claim('aus1', 'clm1')

      expect(result).toMatchObject({ id: 'clm1' })
    })
  })

  describe('replaceOAuth2Claim', () => {
    it('sends PUT with full claim body', async () => {
      mock.onPut(`${BASE}/authorizationServers/aus1/claims/clm1`).reply(wrap({ id: 'clm1' }))
      await service.replaceOAuth2Claim('aus1', 'clm1', 'Support', 'ID Token (Identity)', 'Groups', 'Eng*', false, [], 'Starts With')

      expect(mock.history[0].body).toMatchObject({
        name: 'Support',
        claimType: 'IDENTITY',
        valueType: 'GROUPS',
        value: 'Eng*',
        alwaysIncludeInToken: false,
        group_filter_type: 'STARTS_WITH',
      })
    })
  })

  describe('deleteOAuth2Claim', () => {
    it('deletes a claim', async () => {
      mock.onDelete(`${BASE}/authorizationServers/aus1/claims/clm1`).reply(wrap(null))
      const result = await service.deleteOAuth2Claim('aus1', 'clm1')

      expect(result).toEqual({ deleted: true, claimId: 'clm1' })
    })
  })

  // ── OAuth2 Client Secrets ──

  describe('listOAuth2ClientSecrets', () => {
    it('lists secrets for an app', async () => {
      mock.onGet(`${BASE}/apps/app1/credentials/secrets`).reply(wrap([{ id: 'ocs1', status: 'ACTIVE' }]))
      const result = await service.listOAuth2ClientSecrets('app1')

      expect(result.items).toHaveLength(1)
    })
  })

  describe('createOAuth2ClientSecret', () => {
    it('sends POST with empty body when no secret provided', async () => {
      mock.onPost(`${BASE}/apps/app1/credentials/secrets`).reply(wrap({ id: 'ocs1', client_secret: 'generated' }))
      const result = await service.createOAuth2ClientSecret('app1')

      expect(result).toMatchObject({ id: 'ocs1' })
      expect(mock.history[0].body).toEqual({})
    })

    it('includes client_secret and status when provided', async () => {
      mock.onPost(`${BASE}/apps/app1/credentials/secrets`).reply(wrap({ id: 'ocs2' }))
      await service.createOAuth2ClientSecret('app1', 'my-custom-secret', 'Inactive')

      expect(mock.history[0].body).toEqual({ client_secret: 'my-custom-secret', status: 'INACTIVE' })
    })
  })

  describe('getOAuth2ClientSecret', () => {
    it('retrieves a secret', async () => {
      mock.onGet(`${BASE}/apps/app1/credentials/secrets/ocs1`).reply(wrap({ id: 'ocs1' }))
      const result = await service.getOAuth2ClientSecret('app1', 'ocs1')

      expect(result).toMatchObject({ id: 'ocs1' })
    })
  })

  describe('deleteOAuth2ClientSecret', () => {
    it('deletes a secret', async () => {
      mock.onDelete(`${BASE}/apps/app1/credentials/secrets/ocs1`).reply(wrap(null))
      const result = await service.deleteOAuth2ClientSecret('app1', 'ocs1')

      expect(result).toEqual({ deleted: true, secretId: 'ocs1' })
    })
  })

  describe('activateOAuth2ClientSecret', () => {
    it('activates a secret', async () => {
      mock.onPost(`${BASE}/apps/app1/credentials/secrets/ocs1/lifecycle/activate`).reply(wrap({ id: 'ocs1', status: 'ACTIVE' }))
      const result = await service.activateOAuth2ClientSecret('app1', 'ocs1')

      expect(result).toMatchObject({ id: 'ocs1', status: 'ACTIVE' })
    })
  })

  describe('deactivateOAuth2ClientSecret', () => {
    it('deactivates a secret', async () => {
      mock.onPost(`${BASE}/apps/app1/credentials/secrets/ocs1/lifecycle/deactivate`).reply(wrap({ id: 'ocs1', status: 'INACTIVE' }))
      const result = await service.deactivateOAuth2ClientSecret('app1', 'ocs1')

      expect(result).toMatchObject({ id: 'ocs1', status: 'INACTIVE' })
    })
  })

  // ── OAuth2 Resource Server JWKs ──

  describe('listOAuth2ResourceServerJsonWebKeys', () => {
    it('lists resource server keys', async () => {
      mock.onGet(`${BASE}/authorizationServers/aus1/resourceservercredentials/keys`).reply(wrap([{ id: 'apk1', kid: 'k1' }]))
      const result = await service.listOAuth2ResourceServerJsonWebKeys('aus1')

      expect(result.items).toHaveLength(1)
    })
  })

  describe('addOAuth2ResourceServerJsonWebKey', () => {
    it('sends POST with RSA key body', async () => {
      mock.onPost(`${BASE}/authorizationServers/aus1/resourceservercredentials/keys`).reply(wrap({ id: 'apk1' }))
      const result = await service.addOAuth2ResourceServerJsonWebKey('aus1', 'my-kid', 'RSA', 'Encryption', 'AQAB', 'modulus-value', 'Inactive')

      expect(result).toMatchObject({ id: 'apk1' })
      expect(mock.history[0].body).toMatchObject({
        kid: 'my-kid',
        kty: 'RSA',
        use: 'enc',
        e: 'AQAB',
        n: 'modulus-value',
        status: 'INACTIVE',
      })
    })

    it('omits status when not provided', async () => {
      mock.onPost(`${BASE}/authorizationServers/aus1/resourceservercredentials/keys`).reply(wrap({ id: 'apk2' }))
      await service.addOAuth2ResourceServerJsonWebKey('aus1', 'kid2', 'RSA', 'Signing', 'AQAB', 'n2')

      expect(mock.history[0].body).not.toHaveProperty('status')
    })
  })

  describe('getOAuth2ResourceServerJsonWebKey', () => {
    it('retrieves a resource server key', async () => {
      mock.onGet(`${BASE}/authorizationServers/aus1/resourceservercredentials/keys/apk1`).reply(wrap({ id: 'apk1' }))
      const result = await service.getOAuth2ResourceServerJsonWebKey('aus1', 'apk1')

      expect(result).toMatchObject({ id: 'apk1' })
    })
  })

  describe('deleteOAuth2ResourceServerJsonWebKey', () => {
    it('deletes a resource server key', async () => {
      mock.onDelete(`${BASE}/authorizationServers/aus1/resourceservercredentials/keys/apk1`).reply(wrap(null))
      const result = await service.deleteOAuth2ResourceServerJsonWebKey('aus1', 'apk1')

      expect(result).toEqual({ deleted: true, keyId: 'apk1' })
    })
  })

  describe('activateResourceServerKey', () => {
    it('activates a resource server key', async () => {
      mock.onPost(`${BASE}/authorizationServers/aus1/resourceservercredentials/keys/apk1/lifecycle/activate`).reply(wrap({ id: 'apk1', status: 'ACTIVE' }))
      const result = await service.activateResourceServerKey('aus1', 'apk1')

      expect(result).toMatchObject({ id: 'apk1', status: 'ACTIVE' })
    })
  })

  describe('deactivateResourceServerKey', () => {
    it('deactivates a resource server key', async () => {
      mock.onPost(`${BASE}/authorizationServers/aus1/resourceservercredentials/keys/apk1/lifecycle/deactivate`).reply(wrap({ id: 'apk1', status: 'INACTIVE' }))
      const result = await service.deactivateResourceServerKey('aus1', 'apk1')

      expect(result).toMatchObject({ id: 'apk1', status: 'INACTIVE' })
    })
  })

  // ── Identity Providers ──

  describe('listIdentityProviders', () => {
    it('lists IdPs with no filters', async () => {
      mock.onGet(`${BASE}/idps`).reply(wrap([{ id: 'idp1', name: 'Google' }]))
      const result = await service.listIdentityProviders()

      expect(result.items).toHaveLength(1)
    })

    it('passes q, type, limit, after', async () => {
      mock.onGet(`${BASE}/idps`).reply(wrap([]))
      await service.listIdentityProviders('goo', 'Google', 5, 'cur1')

      expect(mock.history[0].query).toMatchObject({ q: 'goo', type: 'GOOGLE', limit: 5, after: 'cur1' })
    })
  })

  describe('createIdentityProvider', () => {
    it('sends POST with OIDC IdP body', async () => {
      const protocol = {
        clientId: 'cid',
        clientSecret: 'csecret',
        issuerUrl: 'https://issuer.example.com',
        authorizationUrl: 'https://auth.example.com',
        tokenUrl: 'https://token.example.com',
      }
      const policy = { accountLinkAction: 'AUTO', provisioningAction: 'AUTO' }

      mock.onPost(`${BASE}/idps`).reply(wrap({ id: 'idp1', type: 'OIDC' }))
      const result = await service.createIdentityProvider('Generic OpenID Connect', 'My OIDC', protocol, policy)

      expect(result).toMatchObject({ id: 'idp1' })
      expect(mock.history[0].body).toMatchObject({
        type: 'OIDC',
        name: 'My OIDC',
      })
      expect(mock.history[0].body.protocol.type).toBe('OIDC')
      expect(mock.history[0].body.protocol.credentials.client.client_id).toBe('cid')
    })
  })

  describe('getIdentityProvider', () => {
    it('retrieves an IdP', async () => {
      mock.onGet(`${BASE}/idps/idp1`).reply(wrap({ id: 'idp1' }))
      const result = await service.getIdentityProvider('idp1')

      expect(result).toMatchObject({ id: 'idp1' })
    })
  })

  describe('replaceIdentityProvider', () => {
    it('sends PUT with IdP body', async () => {
      const protocol = {
        clientId: 'cid',
        clientSecret: 'csecret',
        issuerUrl: 'https://issuer.example.com',
        authorizationUrl: 'https://auth.example.com',
        tokenUrl: 'https://token.example.com',
      }
      const policy = {}

      mock.onPut(`${BASE}/idps/idp1`).reply(wrap({ id: 'idp1' }))
      await service.replaceIdentityProvider('idp1', 'Generic OpenID Connect', 'Updated', protocol, policy)

      expect(mock.history[0].body).toMatchObject({ type: 'OIDC', name: 'Updated' })
    })
  })

  describe('deleteIdentityProvider', () => {
    it('deletes an IdP', async () => {
      mock.onDelete(`${BASE}/idps/idp1`).reply(wrap(null))
      const result = await service.deleteIdentityProvider('idp1')

      expect(result).toEqual({ deleted: true, idpId: 'idp1' })
    })
  })

  describe('activateIdentityProvider', () => {
    it('activates an IdP', async () => {
      mock.onPost(`${BASE}/idps/idp1/lifecycle/activate`).reply(wrap({ id: 'idp1', status: 'ACTIVE' }))
      const result = await service.activateIdentityProvider('idp1')

      expect(result).toMatchObject({ id: 'idp1', status: 'ACTIVE' })
    })
  })

  describe('deactivateIdentityProvider', () => {
    it('deactivates an IdP', async () => {
      mock.onPost(`${BASE}/idps/idp1/lifecycle/deactivate`).reply(wrap({ id: 'idp1', status: 'INACTIVE' }))
      const result = await service.deactivateIdentityProvider('idp1')

      expect(result).toMatchObject({ id: 'idp1', status: 'INACTIVE' })
    })
  })

  // ── Identity Provider Users ──

  describe('listIdentityProviderUsers', () => {
    it('lists linked users', async () => {
      mock.onGet(`${BASE}/idps/idp1/users`).reply(wrap([{ id: 'u1', externalId: 'ext1' }]))
      const result = await service.listIdentityProviderUsers('idp1')

      expect(result.items).toHaveLength(1)
    })

    it('passes filter, limit, after', async () => {
      mock.onGet(`${BASE}/idps/idp1/users`).reply(wrap([]))
      await service.listIdentityProviderUsers('idp1', 'status eq "ACTIVE"', 10, 'cur1')

      expect(mock.history[0].query).toMatchObject({ filter: 'status eq "ACTIVE"', limit: 10, after: 'cur1' })
    })
  })

  describe('getIdentityProviderUser', () => {
    it('retrieves a linked user', async () => {
      mock.onGet(`${BASE}/idps/idp1/users/u1`).reply(wrap({ id: 'u1', externalId: 'ext1' }))
      const result = await service.getIdentityProviderUser('idp1', 'u1')

      expect(result).toMatchObject({ id: 'u1' })
    })
  })

  describe('linkUserToIdentityProvider', () => {
    it('links a user with externalId', async () => {
      mock.onPost(`${BASE}/idps/idp1/users/u1`).reply(wrap({ id: 'u1', externalId: 'ext123' }))
      const result = await service.linkUserToIdentityProvider('idp1', 'u1', 'ext123')

      expect(result).toMatchObject({ id: 'u1' })
      expect(mock.history[0].body).toEqual({ externalId: 'ext123' })
    })
  })

  describe('unlinkUserFromIdentityProvider', () => {
    it('unlinks a user', async () => {
      mock.onDelete(`${BASE}/idps/idp1/users/u1`).reply(wrap(null))
      const result = await service.unlinkUserFromIdentityProvider('idp1', 'u1')

      expect(result).toEqual({ unlinked: true, idpId: 'idp1', userId: 'u1' })
    })
  })

  describe('listSocialAuthTokens', () => {
    it('lists social tokens', async () => {
      mock.onGet(`${BASE}/idps/idp1/users/u1/credentials/tokens`).reply(wrap([{ id: 'tok1', tokenType: 'access_token' }]))
      const result = await service.listSocialAuthTokens('idp1', 'u1')

      expect(result.items).toHaveLength(1)
    })
  })

  // ── Identity Provider Keys (Org-level) ──

  describe('createIdentityProviderKey', () => {
    it('sends POST with x5c array', async () => {
      mock.onPost(`${BASE}/idps/credentials/keys`).reply(wrap({ kid: 'key1' }))
      const result = await service.createIdentityProviderKey('MIIDnjCC...')

      expect(result).toMatchObject({ kid: 'key1' })
      expect(mock.history[0].body).toEqual({ x5c: ['MIIDnjCC...'] })
    })
  })

  describe('getIdentityProviderKey', () => {
    it('retrieves an org IdP key', async () => {
      mock.onGet(`${BASE}/idps/credentials/keys/key1`).reply(wrap({ kid: 'key1' }))
      const result = await service.getIdentityProviderKey('key1')

      expect(result).toMatchObject({ kid: 'key1' })
    })
  })

  describe('replaceIdentityProviderKey', () => {
    it('sends PUT with new cert', async () => {
      mock.onPut(`${BASE}/idps/credentials/keys/key1`).reply(wrap({ kid: 'key1' }))
      await service.replaceIdentityProviderKey('key1', 'MIIDnew...', 'AQAB', 'modulus')

      expect(mock.history[0].body).toEqual({ x5c: ['MIIDnew...'], e: 'AQAB', n: 'modulus' })
    })

    it('omits e and n when not provided', async () => {
      mock.onPut(`${BASE}/idps/credentials/keys/key1`).reply(wrap({ kid: 'key1' }))
      await service.replaceIdentityProviderKey('key1', 'MIIDnew...')

      expect(mock.history[0].body).toEqual({ x5c: ['MIIDnew...'] })
    })
  })

  describe('deleteIdentityProviderKey', () => {
    it('deletes an org IdP key', async () => {
      mock.onDelete(`${BASE}/idps/credentials/keys/key1`).reply(wrap(null))
      const result = await service.deleteIdentityProviderKey('key1')

      expect(result).toEqual({ deleted: true, kid: 'key1' })
    })
  })

  describe('listIdentityProviderKeys', () => {
    it('auto-paginates through all keys', async () => {
      let callCount = 0
      mock.onGet(`${BASE}/idps/credentials/keys`).replyWith(() => {
        callCount++
        if (callCount === 1) {
          return { body: [{ kid: 'k1' }], headers: { link: `<${BASE}/idps/credentials/keys?after=page2>; rel="next"` } }
        }
        return { body: [{ kid: 'k2' }], headers: {} }
      })

      const result = await service.listIdentityProviderKeys()

      expect(result.items).toHaveLength(2)
      expect(result.cursor).toBeNull()
    })
  })

  // ── Identity Provider Signing Keys ──

  describe('listIdentityProviderSigningKeys', () => {
    it('lists signing keys for an IdP', async () => {
      mock.onGet(`${BASE}/idps/idp1/credentials/keys`).reply(wrap([{ kid: 'sk1' }]))
      const result = await service.listIdentityProviderSigningKeys('idp1')

      expect(result.items).toHaveLength(1)
    })
  })

  describe('listActiveIdentityProviderSigningKey', () => {
    it('lists active signing keys', async () => {
      mock.onGet(`${BASE}/idps/idp1/credentials/keys/active`).reply(wrap([{ kid: 'sk1', status: 'ACTIVE' }]))
      const result = await service.listActiveIdentityProviderSigningKey('idp1')

      expect(result.items).toHaveLength(1)
    })
  })

  describe('generateIdentityProviderSigningKey', () => {
    it('sends POST with validityYears query', async () => {
      mock.onPost(`${BASE}/idps/idp1/credentials/keys/generate`).reply(wrap({ kid: 'sk-new' }))
      const result = await service.generateIdentityProviderSigningKey('idp1', 5)

      expect(result).toMatchObject({ kid: 'sk-new' })
      expect(mock.history[0].query).toMatchObject({ validityYears: 5 })
    })
  })

  describe('getIdentityProviderSigningKey', () => {
    it('retrieves a signing key', async () => {
      mock.onGet(`${BASE}/idps/idp1/credentials/keys/sk1`).reply(wrap({ kid: 'sk1' }))
      const result = await service.getIdentityProviderSigningKey('idp1', 'sk1')

      expect(result).toMatchObject({ kid: 'sk1' })
    })
  })

  describe('cloneIdentityProviderKey', () => {
    it('sends POST with targetIdpId query', async () => {
      mock.onPost(`${BASE}/idps/idp1/credentials/keys/sk1/clone`).reply(wrap({ kid: 'sk1' }))
      const result = await service.cloneIdentityProviderKey('idp1', 'sk1', 'idp2')

      expect(result).toMatchObject({ kid: 'sk1' })
      expect(mock.history[0].query).toMatchObject({ targetIdpId: 'idp2' })
    })
  })

  // ── Identity Provider CSRs ──

  describe('listCsrsForIdentityProvider', () => {
    it('lists CSRs for an IdP', async () => {
      mock.onGet(`${BASE}/idps/idp1/credentials/csrs`).reply(wrap([{ id: 'csr1' }]))
      const result = await service.listCsrsForIdentityProvider('idp1')

      expect(result.items).toHaveLength(1)
    })
  })

  describe('generateCsrForIdentityProvider', () => {
    it('sends POST with CSR metadata', async () => {
      mock.onPost(`${BASE}/idps/idp1/credentials/csrs`).reply(wrap({ id: 'csr-new' }))
      const result = await service.generateCsrForIdentityProvider('idp1', 'example.com', 'Org', 'OU', 'City', 'State', 'US', ['alt.example.com'])

      expect(result).toMatchObject({ id: 'csr-new' })
      expect(mock.history[0].body).toMatchObject({
        subject: {
          commonName: 'example.com',
          organizationName: 'Org',
          organizationalUnitName: 'OU',
          localityName: 'City',
          stateOrProvinceName: 'State',
          countryName: 'US',
        },
        subjectAltNames: { dnsNames: ['alt.example.com'] },
      })
    })

    it('omits optional subject fields', async () => {
      mock.onPost(`${BASE}/idps/idp1/credentials/csrs`).reply(wrap({ id: 'csr2' }))
      await service.generateCsrForIdentityProvider('idp1', 'example.com')

      expect(mock.history[0].body).toEqual({ subject: { commonName: 'example.com' } })
    })
  })

  describe('getCsrForIdentityProvider', () => {
    it('retrieves a CSR', async () => {
      mock.onGet(`${BASE}/idps/idp1/credentials/csrs/csr1`).reply(wrap({ id: 'csr1' }))
      const result = await service.getCsrForIdentityProvider('idp1', 'csr1')

      expect(result).toMatchObject({ id: 'csr1' })
    })
  })

  describe('revokeCsrForIdentityProvider', () => {
    it('revokes a CSR', async () => {
      mock.onDelete(`${BASE}/idps/idp1/credentials/csrs/csr1`).reply(wrap(null))
      const result = await service.revokeCsrForIdentityProvider('idp1', 'csr1')

      expect(result).toEqual({ revoked: true, idpCsrId: 'csr1' })
    })
  })

  describe('publishCsrForIdentityProvider', () => {
    it('publishes a signed cert against a CSR', async () => {
      mock.onPost(`${BASE}/idps/idp1/credentials/csrs/csr1/lifecycle/publish`).reply(wrap({ kid: 'sk-published' }))
      const result = await service.publishCsrForIdentityProvider('idp1', 'csr1', '-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----')

      expect(result).toMatchObject({ kid: 'sk-published' })
      expect(mock.history[0].body).toBe('-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----')
    })
  })

  // ── Auth Server Clients ──

  describe('listOAuth2ClientsForAuthorizationServer', () => {
    it('lists clients for an auth server', async () => {
      mock.onGet(`${BASE}/authorizationServers/aus1/clients`).reply(wrap([{ client_id: 'c1' }]))
      const result = await service.listOAuth2ClientsForAuthorizationServer('aus1')

      expect(result.items).toHaveLength(1)
    })
  })

  // ── Error handling (applies to all methods) ──

  describe('error handling', () => {
    it('throws on API error for auth server methods', async () => {
      mock.onGet(`${BASE}/authorizationServers/bad`).replyWithError({
        message: 'Not found',
        status: 404,
        body: { errorSummary: 'Not found: Resource not found' },
      })

      await expect(service.getAuthorizationServer('bad')).rejects.toThrow('Not found')
    })

    it('throws on API error for IdP methods', async () => {
      mock.onGet(`${BASE}/idps/bad`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { errorSummary: 'Invalid token' },
      })

      await expect(service.getIdentityProvider('bad')).rejects.toThrow('Authentication failed')
    })
  })
})
