'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const OAUTH_TOKEN = 'test-oauth-access-token'

const OAUTH_BASE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const OAUTH_TOKEN_URL = `${ OAUTH_BASE_URL }/token`
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0'
const API_BASE = `${ GRAPH_BASE_URL }/security`

const AUTH_HEADER = { Authorization: `Bearer ${ OAUTH_TOKEN }` }

describe('Microsoft Graph Security Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate the OAuth access token header available at runtime
    service.request = { headers: { 'oauth-access-token': OAUTH_TOKEN } }
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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({ name: 'clientId', displayName: 'Client ID', required: true, shared: true, type: 'STRING' }),
        expect.objectContaining({ name: 'clientSecret', displayName: 'Client Secret', required: true, shared: true, type: 'STRING' }),
      ])
    })

    it('reads only registered config keys', () => {
      expect(service.clientId).toBe(CLIENT_ID)
      expect(service.clientSecret).toBe(CLIENT_SECRET)
    })
  })

  // ── OAuth: getOAuth2ConnectionURL ──

  describe('getOAuth2ConnectionURL', () => {
    it('builds the authorize URL with client id, response type and mode', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url.startsWith(`${ OAUTH_BASE_URL }/authorize?`)).toBe(true)

      const params = new URLSearchParams(url.split('?')[1])

      expect(params.get('client_id')).toBe(CLIENT_ID)
      expect(params.get('response_type')).toBe('code')
      expect(params.get('response_mode')).toBe('query')
    })

    it('requests the default scope list', async () => {
      const url = await service.getOAuth2ConnectionURL()
      const params = new URLSearchParams(url.split('?')[1])

      expect(params.get('scope').split(' ')).toEqual([
        'openid',
        'offline_access',
        'SecurityEvents.ReadWrite.All',
        'SecurityIncident.ReadWrite.All',
        'SecurityAlert.ReadWrite.All',
        'ThreatIndicators.ReadWrite.OwnedBy',
      ])
    })
  })

  // ── OAuth: executeCallback ──

  describe('executeCallback', () => {
    const TOKEN_RESPONSE = {
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3599,
    }

    it('exchanges the code for tokens and resolves the identity', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply(TOKEN_RESPONSE)

      mock.onGet(`${ GRAPH_BASE_URL }/me`).reply({
        id: 'user-1',
        mail: 'secops@contoso.com',
        displayName: 'Sec Ops',
      })

      const result = await service.executeCallback({ code: 'auth-code', redirectURI: 'https://example.com/cb' })

      expect(result).toEqual({
        token: 'new-access',
        refreshToken: 'new-refresh',
        expirationInSeconds: 3599,
        connectionIdentityName: 'secops@contoso.com (Sec Ops)',
        overwrite: true,
        userData: { id: 'user-1', mail: 'secops@contoso.com', displayName: 'Sec Ops' },
      })
    })

    it('posts a form-encoded authorization_code grant', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply(TOKEN_RESPONSE)
      mock.onGet(`${ GRAPH_BASE_URL }/me`).reply({})

      await service.executeCallback({ code: 'auth-code', redirectURI: 'https://example.com/cb' })

      const tokenCall = mock.history[0]

      expect(tokenCall.method).toBe('post')
      expect(tokenCall.url).toBe(OAUTH_TOKEN_URL)
      expect(tokenCall.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' })

      const body = new URLSearchParams(tokenCall.body)

      expect(body.get('client_id')).toBe(CLIENT_ID)
      expect(body.get('client_secret')).toBe(CLIENT_SECRET)
      expect(body.get('code')).toBe('auth-code')
      expect(body.get('redirect_uri')).toBe('https://example.com/cb')
      expect(body.get('grant_type')).toBe('authorization_code')
    })

    it('sends the fresh access token to the /me profile lookup', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply(TOKEN_RESPONSE)
      mock.onGet(`${ GRAPH_BASE_URL }/me`).reply({ userPrincipalName: 'a@contoso.com' })

      await service.executeCallback({ code: 'auth-code', redirectURI: 'https://example.com/cb' })

      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer new-access',
        'Content-Type': 'application/json',
      })
    })

    it.each([
      [
        'mail and displayName',
        { mail: 'a@contoso.com', displayName: 'Ann' },
        'a@contoso.com (Ann)',
      ],
      [
        'userPrincipalName fallback with displayName',
        { userPrincipalName: 'upn@contoso.com', displayName: 'Ann' },
        'upn@contoso.com (Ann)',
      ],
      [
        'email only',
        { mail: 'a@contoso.com' },
        'a@contoso.com',
      ],
      [
        'displayName only',
        { displayName: 'Ann' },
        'Ann',
      ],
      [
        'neither email nor displayName',
        {},
        'Microsoft Graph Security Connection',
      ],
    ])('derives connectionIdentityName from %s', async (_label, profile, expected) => {
      mock.onPost(OAUTH_TOKEN_URL).reply(TOKEN_RESPONSE)
      mock.onGet(`${ GRAPH_BASE_URL }/me`).reply(profile)

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://example.com/cb' })

      expect(result.connectionIdentityName).toBe(expected)
    })

    it('tolerates a failing profile lookup and falls back to a generic identity', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply(TOKEN_RESPONSE)
      mock.onGet(`${ GRAPH_BASE_URL }/me`).replyWithError({ message: 'Insufficient privileges' })

      const result = await service.executeCallback({ code: 'auth-code', redirectURI: 'https://example.com/cb' })

      expect(result.token).toBe('new-access')
      expect(result.userData).toEqual({})
      expect(result.connectionIdentityName).toBe('Microsoft Graph Security Connection')
    })

    it('propagates a failed token exchange', async () => {
      mock.onPost(OAUTH_TOKEN_URL).replyWithError({ message: 'invalid_grant' })

      await expect(service.executeCallback({ code: 'bad', redirectURI: 'https://example.com/cb' }))
        .rejects.toThrow('invalid_grant')
    })
  })

  // ── OAuth: refreshToken ──

  describe('refreshToken', () => {
    it('exchanges the refresh token and returns the rotated credentials', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply({
        access_token: 'refreshed-access',
        refresh_token: 'rotated-refresh',
        expires_in: 3599,
      })

      const result = await service.refreshToken('old-refresh')

      expect(result).toEqual({
        token: 'refreshed-access',
        refreshToken: 'rotated-refresh',
        expirationInSeconds: 3599,
      })

      const body = new URLSearchParams(mock.history[0].body)

      expect(body.get('grant_type')).toBe('refresh_token')
      expect(body.get('refresh_token')).toBe('old-refresh')
      expect(body.get('client_id')).toBe(CLIENT_ID)
      expect(body.get('client_secret')).toBe(CLIENT_SECRET)
      expect(body.get('scope')).toContain('SecurityIncident.ReadWrite.All')
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' })
    })

    it('returns an undefined refresh token when the response does not rotate one', async () => {
      // Microsoft normally always rotates the refresh token; when it does not, the
      // service does NOT fall back to the incoming token (see report notes).
      mock.onPost(OAUTH_TOKEN_URL).reply({ access_token: 'refreshed-access', expires_in: 3599 })

      const result = await service.refreshToken('keep-this')

      expect(result).toEqual({
        token: 'refreshed-access',
        refreshToken: undefined,
        expirationInSeconds: 3599,
      })
    })

    it('rethrows the original error when the refresh fails', async () => {
      mock.onPost(OAUTH_TOKEN_URL).replyWithError({ message: 'AADSTS70008: expired' })

      await expect(service.refreshToken('old-refresh')).rejects.toThrow('AADSTS70008: expired')
    })

    it('rethrows an error without a message', async () => {
      const bare = new Error()

      mock.onPost(OAUTH_TOKEN_URL).replyWithError(bare)

      await expect(service.refreshToken('old-refresh')).rejects.toBe(bare)
    })
  })

  // ── Auth header / error shaping (shared #apiRequest) ──

  describe('access token header', () => {
    it('sends the live oauth-access-token as a bearer token', async () => {
      mock.onGet(`${ API_BASE }/alerts_v2`).reply({ value: [] })

      await service.listAlerts()

      expect(mock.history[0].headers).toEqual(AUTH_HEADER)
    })

    it('fails when the request context carries no access token', async () => {
      const original = service.request

      service.request = undefined
      mock.onGet(`${ API_BASE }/alerts_v2`).reply({ value: [] })

      await expect(service.listAlerts()).rejects.toThrow('Microsoft Graph Security API error:')

      service.request = original
    })
  })

  describe('Graph error envelope handling', () => {
    it('prefixes the Graph error code and uses the Graph message', async () => {
      mock.onGet(`${ API_BASE }/alerts_v2`).replyWithError({
        message: 'Forbidden',
        status: 403,
        body: {
          error: {
            code: 'Authorization_RequestDenied',
            message: 'Insufficient privileges to complete the operation.',
            innerError: { 'request-id': 'abc-123', date: '2026-07-22T00:00:00' },
          },
        },
      })

      await expect(service.listAlerts()).rejects.toThrow(
        'Microsoft Graph Security API error: Authorization_RequestDenied: Insufficient privileges to complete the operation.'
      )
    })

    it('omits the code prefix when the envelope has no code', async () => {
      mock.onGet(`${ API_BASE }/alerts_v2`).replyWithError({
        message: 'Bad Request',
        statusCode: 400,
        body: { error: { message: 'Invalid filter clause' } },
      })

      await expect(service.listAlerts()).rejects.toThrow('Microsoft Graph Security API error: Invalid filter clause')
    })

    it('falls back to the transport error message when there is no envelope', async () => {
      mock.onGet(`${ API_BASE }/alerts_v2`).replyWithError({ message: 'socket hang up' })

      await expect(service.listAlerts()).rejects.toThrow('Microsoft Graph Security API error: socket hang up')
    })

    it('handles an error body that is not a Graph envelope', async () => {
      mock.onGet(`${ API_BASE }/alerts_v2`).replyWithError({ message: 'Gateway Timeout', body: {}, status: 504 })

      await expect(service.listAlerts()).rejects.toThrow('Microsoft Graph Security API error: Gateway Timeout')
    })
  })

  // ── Paginated list methods (shared shape) ──

  describe('paginated list methods', () => {
    const LISTS = [
      ['listAlerts', 'alerts_v2', () => service.listAlerts(), link => service.listAlerts(null, null, null, link)],
      ['listLegacyAlerts', 'alerts', () => service.listLegacyAlerts(), link => service.listLegacyAlerts(null, null, link)],
      ['listIncidents', 'incidents', () => service.listIncidents(), link => service.listIncidents(null, null, null, link)],
      ['listSecureScores', 'secureScores', () => service.listSecureScores(), link => service.listSecureScores(null, link)],
      [
        'listSecureScoreControlProfiles',
        'secureScoreControlProfiles',
        () => service.listSecureScoreControlProfiles(),
        link => service.listSecureScoreControlProfiles(null, null, link),
      ],
      ['listTiIndicators', 'tiIndicators', () => service.listTiIndicators(), link => service.listTiIndicators(null, link)],
    ]

    it.each(LISTS)('%s issues GET /%s with the default page size', async (_name, path, call) => {
      mock.onGet(`${ API_BASE }/${ path }`).reply({ value: [] })

      const result = await call()

      expect(result).toEqual({ value: [] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ API_BASE }/${ path }`)
      expect(mock.history[0].query).toEqual({ $top: 50 })
      expect(mock.history[0].headers).toEqual(AUTH_HEADER)
    })

    it.each(LISTS)('%s follows @odata.nextLink verbatim and drops other params', async (_name, path, _call, callWithLink) => {
      const nextLink = `${ API_BASE }/${ path }?$skiptoken=OPAQUE%20TOKEN`

      mock.onGet(nextLink).reply({ value: [{ id: 'page-2' }] })

      const result = await callWithLink(nextLink)

      expect(result.value[0].id).toBe('page-2')
      expect(mock.history[0].url).toBe(nextLink)
      expect(mock.history[0].query).toEqual({})
    })
  })

  // ── Alerts ──

  describe('listAlerts', () => {
    it('passes $filter, $orderby and $top', async () => {
      mock.onGet(`${ API_BASE }/alerts_v2`).reply({ value: [] })

      await service.listAlerts("status eq 'new'", 'createdDateTime desc', 10)

      expect(mock.history[0].query).toEqual({
        $filter: "status eq 'new'",
        $orderby: 'createdDateTime desc',
        $top: 10,
      })
    })

    it('omits unset OData params', async () => {
      mock.onGet(`${ API_BASE }/alerts_v2`).reply({ value: [] })

      await service.listAlerts(null, undefined, 5)

      expect(mock.history[0].query).toEqual({ $top: 5 })
    })
  })

  describe('getAlert', () => {
    it('fetches a single alert', async () => {
      mock.onGet(`${ API_BASE }/alerts_v2/da637_-961444813`).reply({ id: 'da637_-961444813', status: 'new' })

      const result = await service.getAlert('da637_-961444813')

      expect(result).toMatchObject({ id: 'da637_-961444813' })
      expect(mock.history[0].query).toEqual({})
    })

    it('URL-encodes the alert id', async () => {
      mock.onGet(`${ API_BASE }/alerts_v2/a%2Fb%20c`).reply({ id: 'a/b c' })

      await service.getAlert('a/b c')

      expect(mock.history[0].url).toBe(`${ API_BASE }/alerts_v2/a%2Fb%20c`)
    })
  })

  describe('updateAlert', () => {
    it('maps the status, classification and determination labels to API values', async () => {
      mock.onPatch(`${ API_BASE }/alerts_v2/alert-1`).reply({ id: 'alert-1' })

      await service.updateAlert('alert-1', 'In Progress', 'secops@contoso.com', 'True Positive', 'Malware')

      expect(mock.history[0].method).toBe('patch')

      expect(mock.history[0].body).toEqual({
        status: 'inProgress',
        assignedTo: 'secops@contoso.com',
        classification: 'truePositive',
        determination: 'malware',
      })
    })

    it.each([
      ['New', 'new'],
      ['In Progress', 'inProgress'],
      ['Resolved', 'resolved'],
    ])('maps alert status %s to %s', async (label, apiValue) => {
      mock.onPatch(`${ API_BASE }/alerts_v2/alert-1`).reply({})

      await service.updateAlert('alert-1', label)

      expect(mock.history[0].body).toEqual({ status: apiValue })
    })

    it.each([
      ['Unknown', 'unknown'],
      ['True Positive', 'truePositive'],
      ['False Positive', 'falsePositive'],
      ['Informational Expected Activity', 'informationalExpectedActivity'],
    ])('maps classification %s to %s', async (label, apiValue) => {
      mock.onPatch(`${ API_BASE }/alerts_v2/alert-1`).reply({})

      await service.updateAlert('alert-1', null, null, label)

      expect(mock.history[0].body).toEqual({ classification: apiValue })
    })

    it.each([
      ['Unknown', 'unknown'],
      ['Advanced Persistent Threat (APT)', 'apt'],
      ['Malware', 'malware'],
      ['Security Personnel', 'securityPersonnel'],
      ['Security Testing', 'securityTesting'],
      ['Unwanted Software', 'unwantedSoftware'],
      ['Multi-Staged Attack', 'multiStagedAttack'],
      ['Compromised Account', 'compromisedAccount'],
      ['Phishing', 'phishing'],
      ['Malicious User Activity', 'maliciousUserActivity'],
      ['Not Malicious', 'notMalicious'],
      ['Not Enough Data to Validate', 'notEnoughDataToValidate'],
      ['Confirmed User Activity', 'confirmedUserActivity'],
      ['Line of Business Application', 'lineOfBusinessApplication'],
      ['Other', 'other'],
    ])('maps determination %s to %s', async (label, apiValue) => {
      mock.onPatch(`${ API_BASE }/alerts_v2/alert-1`).reply({})

      await service.updateAlert('alert-1', null, null, null, label)

      expect(mock.history[0].body).toEqual({ determination: apiValue })
    })

    it('passes through an unmapped raw API value', async () => {
      mock.onPatch(`${ API_BASE }/alerts_v2/alert-1`).reply({})

      await service.updateAlert('alert-1', 'inProgress')

      expect(mock.history[0].body).toEqual({ status: 'inProgress' })
    })

    it('treats an empty-string choice as unset', async () => {
      await expect(service.updateAlert('alert-1', '', null, '', '')).rejects.toThrow('Provide at least one property to update')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when no updatable property is supplied', async () => {
      await expect(service.updateAlert('alert-1')).rejects.toThrow('Provide at least one property to update')
    })
  })

  describe('listLegacyAlerts', () => {
    it('passes $filter and $top only', async () => {
      mock.onGet(`${ API_BASE }/alerts`).reply({ value: [] })

      await service.listLegacyAlerts("severity eq 'high'", 25)

      expect(mock.history[0].query).toEqual({ $filter: "severity eq 'high'", $top: 25 })
    })
  })

  // ── Incidents ──

  describe('listIncidents', () => {
    it('adds $expand=alerts when expandAlerts is enabled', async () => {
      mock.onGet(`${ API_BASE }/incidents`).reply({ value: [] })

      await service.listIncidents("status eq 'active'", true, 5)

      expect(mock.history[0].query).toEqual({
        $filter: "status eq 'active'",
        $expand: 'alerts',
        $top: 5,
      })
    })

    it('omits $expand when expandAlerts is falsy', async () => {
      mock.onGet(`${ API_BASE }/incidents`).reply({ value: [] })

      await service.listIncidents(null, false)

      expect(mock.history[0].query).toEqual({ $top: 50 })
    })
  })

  describe('getIncident', () => {
    it('fetches a single incident without $expand', async () => {
      mock.onGet(`${ API_BASE }/incidents/29`).reply({ id: '29', status: 'active' })

      const result = await service.getIncident('29')

      expect(result).toMatchObject({ id: '29' })
      expect(mock.history[0].query).toEqual({})
    })

    it('expands alerts when requested and encodes the id', async () => {
      mock.onGet(`${ API_BASE }/incidents/29%2F1`).reply({ id: '29/1' })

      await service.getIncident('29/1', true)

      expect(mock.history[0].url).toBe(`${ API_BASE }/incidents/29%2F1`)
      expect(mock.history[0].query).toEqual({ $expand: 'alerts' })
    })
  })

  describe('updateIncident', () => {
    it('maps labels and forwards custom tags', async () => {
      mock.onPatch(`${ API_BASE }/incidents/29`).reply({ id: '29' })

      await service.updateIncident('29', 'Redirected', 'admin@contoso.com', 'False Positive', 'Phishing', ['Demo', 'Prod'])

      expect(mock.history[0].method).toBe('patch')

      expect(mock.history[0].body).toEqual({
        status: 'redirected',
        assignedTo: 'admin@contoso.com',
        classification: 'falsePositive',
        determination: 'phishing',
        customTags: ['Demo', 'Prod'],
      })
    })

    it.each([
      ['Active', 'active'],
      ['Resolved', 'resolved'],
      ['Redirected', 'redirected'],
    ])('maps incident status %s to %s', async (label, apiValue) => {
      mock.onPatch(`${ API_BASE }/incidents/29`).reply({})

      await service.updateIncident('29', label)

      expect(mock.history[0].body).toEqual({ status: apiValue })
    })

    it.each([
      ['an empty array', []],
      ['a non-array value', 'Demo'],
      ['null', null],
    ])('drops customTags when given %s', async (_label, tags) => {
      mock.onPatch(`${ API_BASE }/incidents/29`).reply({})

      await service.updateIncident('29', 'Active', null, null, null, tags)

      expect(mock.history[0].body).toEqual({ status: 'active' })
    })

    it('throws when no updatable property is supplied', async () => {
      await expect(service.updateIncident('29')).rejects.toThrow('Provide at least one property to update')
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Secure Score ──

  describe('getSecureScore', () => {
    it('fetches a single secure score snapshot', async () => {
      mock.onGet(`${ API_BASE }/secureScores/tenant_2021-01-01`).reply({ id: 'tenant_2021-01-01', currentScore: 22 })

      const result = await service.getSecureScore('tenant_2021-01-01')

      expect(result).toMatchObject({ currentScore: 22 })
    })
  })

  describe('listSecureScoreControlProfiles', () => {
    it('passes $filter and $top', async () => {
      mock.onGet(`${ API_BASE }/secureScoreControlProfiles`).reply({ value: [] })

      await service.listSecureScoreControlProfiles("controlCategory eq 'Identity'", 10)

      expect(mock.history[0].query).toEqual({ $filter: "controlCategory eq 'Identity'", $top: 10 })
    })
  })

  describe('updateSecureScoreControlProfile', () => {
    it('sends the vendor block plus a control state update with the mapped state', async () => {
      mock.onPatch(`${ API_BASE }/secureScoreControlProfiles/NonOwnerAccess`).reply({ id: 'NonOwnerAccess' })

      await service.updateSecureScoreControlProfile('NonOwnerAccess', 'Third Party', 'admin@contoso.com', 'Covered elsewhere')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].headers).toEqual({ ...AUTH_HEADER, Prefer: 'return=representation' })

      expect(mock.history[0].body).toEqual({
        vendorInformation: { provider: 'SecureScore', vendor: 'Microsoft' },
        controlStateUpdates: [{
          assignedTo: 'admin@contoso.com',
          comment: 'Covered elsewhere',
          state: 'ThirdParty',
        }],
      })
    })

    it.each([
      ['Default', 'Default'],
      ['Ignored', 'Ignored'],
      ['Third Party', 'ThirdParty'],
      ['Reviewed', 'Reviewed'],
    ])('maps state %s to %s', async (label, apiValue) => {
      mock.onPatch(`${ API_BASE }/secureScoreControlProfiles/NonOwnerAccess`).reply({})

      await service.updateSecureScoreControlProfile('NonOwnerAccess', label)

      expect(mock.history[0].body.controlStateUpdates).toEqual([{ state: apiValue }])
    })

    it('sends only the vendor block when no state fields are supplied', async () => {
      mock.onPatch(`${ API_BASE }/secureScoreControlProfiles/NonOwnerAccess`).reply({ id: 'NonOwnerAccess' })

      await service.updateSecureScoreControlProfile('NonOwnerAccess')

      expect(mock.history[0].body).toEqual({
        vendorInformation: { provider: 'SecureScore', vendor: 'Microsoft' },
      })
    })

    it('encodes the control profile id', async () => {
      mock.onPatch(`${ API_BASE }/secureScoreControlProfiles/a%2Fb`).reply({})

      await service.updateSecureScoreControlProfile('a/b', 'Ignored')

      expect(mock.history[0].url).toBe(`${ API_BASE }/secureScoreControlProfiles/a%2Fb`)
    })
  })

  // ── Threat Intelligence ──

  describe('createTiIndicator', () => {
    const REQUIRED = ['Alert', 'Azure Sentinel', 'WatchList', 'Green', 'Suspicious domain', '2026-08-01T00:00:00Z']

    it('creates an indicator with the mapped action and TLP level', async () => {
      mock.onPost(`${ API_BASE }/tiIndicators`).reply({ id: 'ti-1' })

      const result = await service.createTiIndicator(
        ...REQUIRED,
        'baddomain.example.net', null, null, null, null, 4, ['apt', 'campaign-x']
      )

      expect(result).toMatchObject({ id: 'ti-1' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ API_BASE }/tiIndicators`)

      expect(mock.history[0].body).toEqual({
        action: 'alert',
        targetProduct: 'Azure Sentinel',
        threatType: 'WatchList',
        tlpLevel: 'green',
        description: 'Suspicious domain',
        expirationDateTime: '2026-08-01T00:00:00Z',
        domainName: 'baddomain.example.net',
        severity: 4,
        tags: ['apt', 'campaign-x'],
      })
    })

    it.each([
      ['Alert', 'alert'],
      ['Allow', 'allow'],
      ['Block', 'block'],
      ['Unknown', 'unknown'],
    ])('maps action %s to %s', async (label, apiValue) => {
      mock.onPost(`${ API_BASE }/tiIndicators`).reply({})

      await service.createTiIndicator(
        label, 'Azure Sentinel', 'WatchList', 'Green', 'd', '2026-08-01T00:00:00Z', 'x.example.net'
      )

      expect(mock.history[0].body.action).toBe(apiValue)
    })

    it.each([
      ['White', 'white'],
      ['Green', 'green'],
      ['Amber', 'amber'],
      ['Red', 'red'],
    ])('maps TLP level %s to %s', async (label, apiValue) => {
      mock.onPost(`${ API_BASE }/tiIndicators`).reply({})

      await service.createTiIndicator(
        'Alert', 'Azure Sentinel', 'WatchList', label, 'd', '2026-08-01T00:00:00Z', 'x.example.net'
      )

      expect(mock.history[0].body.tlpLevel).toBe(apiValue)
    })

    it.each([
      ['url', 7, 'https://bad.example.net/path'],
      ['networkDestinationIPv4', 8, '10.0.0.1'],
    ])('accepts %s as the sole observable', async (field, index, value) => {
      mock.onPost(`${ API_BASE }/tiIndicators`).reply({})

      const args = [...REQUIRED]

      args[index] = value

      await service.createTiIndicator(...args)

      expect(mock.history[0].body[field]).toBe(value)
    })

    it('accepts a file hash observable together with its type', async () => {
      mock.onPost(`${ API_BASE }/tiIndicators`).reply({})

      await service.createTiIndicator(
        ...REQUIRED, null, null, null, 'abc123', 'sha256'
      )

      expect(mock.history[0].body).toMatchObject({ fileHashValue: 'abc123', fileHashType: 'sha256' })
    })

    it('drops empty tag arrays and non-array tags', async () => {
      mock.onPost(`${ API_BASE }/tiIndicators`).reply({})

      await service.createTiIndicator(...REQUIRED, 'x.example.net', null, null, null, null, null, [])

      expect(mock.history[0].body.tags).toBeUndefined()

      mock.reset()
      mock.onPost(`${ API_BASE }/tiIndicators`).reply({})

      await service.createTiIndicator(...REQUIRED, 'x.example.net', null, null, null, null, null, 'apt')

      expect(mock.history[0].body.tags).toBeUndefined()
    })

    it.each([
      ['Action', [null, 'Azure Sentinel', 'WatchList', 'Green', 'd', '2026-08-01T00:00:00Z', 'x.example.net']],
      ['Target Product', ['Alert', null, 'WatchList', 'Green', 'd', '2026-08-01T00:00:00Z', 'x.example.net']],
      ['Threat Type', ['Alert', 'Azure Sentinel', null, 'Green', 'd', '2026-08-01T00:00:00Z', 'x.example.net']],
      ['TLP Level', ['Alert', 'Azure Sentinel', 'WatchList', null, 'd', '2026-08-01T00:00:00Z', 'x.example.net']],
      ['Description', ['Alert', 'Azure Sentinel', 'WatchList', 'Green', null, '2026-08-01T00:00:00Z', 'x.example.net']],
      ['Expiration Date/Time', ['Alert', 'Azure Sentinel', 'WatchList', 'Green', 'd', null, 'x.example.net']],
    ])('throws when %s is missing', async (paramLabel, args) => {
      await expect(service.createTiIndicator(...args)).rejects.toThrow(`Parameter "${ paramLabel }" is required`)
      expect(mock.history).toHaveLength(0)
    })

    it('throws when a file hash value has no hash type', async () => {
      await expect(service.createTiIndicator(...REQUIRED, null, null, null, 'abc123'))
        .rejects.toThrow('Parameter "File Hash Type" is required when a File Hash Value is provided')
    })

    it('throws when no observable is provided', async () => {
      await expect(service.createTiIndicator(...REQUIRED))
        .rejects.toThrow('Provide at least one observable: Domain Name, URL, Destination IPv4, or File Hash Value')
    })
  })

  describe('deleteTiIndicator', () => {
    it('deletes the indicator and returns a confirmation', async () => {
      mock.onDelete(`${ API_BASE }/tiIndicators/ti-1`).reply('')

      const result = await service.deleteTiIndicator('ti-1')

      expect(result).toEqual({
        message: 'Threat intelligence indicator deleted successfully',
        indicatorId: 'ti-1',
      })

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].headers).toEqual(AUTH_HEADER)
    })

    it('surfaces a Graph error instead of a false confirmation', async () => {
      mock.onDelete(`${ API_BASE }/tiIndicators/ti-1`).replyWithError({
        message: 'Not Found',
        body: { error: { code: 'ResourceNotFound', message: 'Indicator not found' } },
      })

      await expect(service.deleteTiIndicator('ti-1'))
        .rejects.toThrow('Microsoft Graph Security API error: ResourceNotFound: Indicator not found')
    })
  })

  // ── Required parameter guards ──

  describe('required parameter validation', () => {
    it.each([
      ['getAlert', 'Alert ID', () => service.getAlert()],
      ['updateAlert', 'Alert ID', () => service.updateAlert(null, 'New')],
      ['getIncident', 'Incident ID', () => service.getIncident()],
      ['updateIncident', 'Incident ID', () => service.updateIncident('', 'Active')],
      ['getSecureScore', 'Secure Score ID', () => service.getSecureScore()],
      ['updateSecureScoreControlProfile', 'Control Profile ID', () => service.updateSecureScoreControlProfile()],
      ['deleteTiIndicator', 'Indicator ID', () => service.deleteTiIndicator()],
    ])('%s throws when %s is missing', async (_name, paramLabel, call) => {
      await expect(call()).rejects.toThrow(`Parameter "${ paramLabel }" is required`)
      expect(mock.history).toHaveLength(0)
    })
  })
})
