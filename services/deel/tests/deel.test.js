'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const PROD_API = 'https://api.letsdeel.com/rest/v2'
const PROD_OAUTH = 'https://app.deel.com'
const SANDBOX_API = 'https://api-sandbox.demo.deel.com/rest/v2'
const SANDBOX_OAUTH = 'https://demo.deel.com'

describe('Deel Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      environment: 'Production',
    })

    require('../src/index.js')

    service = sandbox.getService()
    service.request = { headers: { 'oauth-access-token': ACCESS_TOKEN } }
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
      const items = sandbox.getConfigItems()

      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
          expect.objectContaining({ name: 'environment', required: true, shared: false, type: 'CHOICE' }),
        ])
      )
    })
  })

  // ── OAuth2 System Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns production authorization URL with correct params', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`${PROD_OAUTH}/oauth2/authorize`)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches profile', async () => {
      mock.onPost(`${PROD_OAUTH}/oauth2/tokens`).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      })

      mock.onGet(`${PROD_API}/people/me`).reply({
        data: { first_name: 'Jane', last_name: 'Doe', email: 'jane@acme.com' },
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://app.flowrunner.com/callback',
      })

      expect(result.token).toBe('new-access-token')
      expect(result.expirationInSeconds).toBe(3600)
      expect(result.refreshToken).toBe('new-refresh-token')
      expect(result.connectionIdentityName).toContain('Jane')
      expect(result.overwrite).toBe(true)

      // Verify token exchange request
      const tokenCall = mock.history.find(c => c.url === `${PROD_OAUTH}/oauth2/tokens`)

      expect(tokenCall).toBeDefined()
      expect(tokenCall.headers).toHaveProperty('Authorization')
      expect(tokenCall.headers.Authorization).toContain('Basic ')
    })

    it('falls back to Deel User when profile fetch fails', async () => {
      mock.onPost(`${PROD_OAUTH}/oauth2/tokens`).reply({
        access_token: 'tok',
        expires_in: 3600,
        refresh_token: 'rtok',
      })

      mock.onGet(`${PROD_API}/people/me`).replyWithError({ message: 'Forbidden' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://x.com/cb' })

      expect(result.token).toBe('tok')
      expect(result.connectionIdentityName).toBe('Deel User')
    })
  })

  describe('refreshToken', () => {
    it('refreshes token successfully', async () => {
      mock.onPost(`${PROD_OAUTH}/oauth2/tokens`).reply({
        access_token: 'refreshed-token',
        expires_in: 7200,
        refresh_token: 'new-refresh',
      })

      const result = await service.refreshToken('old-refresh')

      expect(result.token).toBe('refreshed-token')
      expect(result.expirationInSeconds).toBe(7200)
      expect(result.refreshToken).toBe('new-refresh')
    })

    it('keeps original refresh token when API does not return new one', async () => {
      mock.onPost(`${PROD_OAUTH}/oauth2/tokens`).reply({
        access_token: 'tok',
        expires_in: 3600,
      })

      const result = await service.refreshToken('original-refresh')

      expect(result.refreshToken).toBe('original-refresh')
    })

    it('throws friendly error on invalid_grant', async () => {
      mock.onPost(`${PROD_OAUTH}/oauth2/tokens`).replyWithError({
        message: 'invalid_grant',
        body: { error_description: 'invalid_grant' },
      })

      await expect(service.refreshToken('expired')).rejects.toThrow(/reconnect Deel/)
    })
  })

  // ── Smoke test / Profile / Org ──

  describe('testConnection', () => {
    it('returns ok with profile and org info', async () => {
      mock.onGet(`${PROD_API}/people/me`).reply({
        data: { first_name: 'Jane', last_name: 'Doe', email: 'jane@acme.com' },
      })

      mock.onGet(`${PROD_API}/organizations`).reply({
        data: { id: 'org_abc', name: 'Acme Inc' },
      })

      const result = await service.testConnection()

      expect(result.ok).toBe(true)
      expect(result.connectedAs.name).toBe('Jane Doe')
      expect(result.connectedAs.email).toBe('jane@acme.com')
      expect(result.organization).toEqual({ id: 'org_abc', name: 'Acme Inc' })
    })
  })

  describe('getMyProfile', () => {
    it('sends GET to /people/me and unwraps data', async () => {
      mock.onGet(`${PROD_API}/people/me`).reply({
        data: { id: 'per_1', first_name: 'Jane' },
      })

      const result = await service.getMyProfile()

      expect(result).toEqual({ id: 'per_1', first_name: 'Jane' })
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'x-client-id': CLIENT_ID,
      })
    })
  })

  describe('getOrganization', () => {
    it('sends GET to /organizations', async () => {
      mock.onGet(`${PROD_API}/organizations`).reply({
        data: { id: 'org_1', name: 'Acme' },
      })

      const result = await service.getOrganization()

      expect(result).toEqual({ id: 'org_1', name: 'Acme' })
    })
  })

  // ── Dictionaries ──

  describe('getCountriesDictionary', () => {
    it('returns filtered country items', async () => {
      mock.onGet(`${PROD_API}/lookups/countries`).reply({
        data: [
          { name: 'United States', code: 'US' },
          { name: 'Germany', code: 'DE' },
        ],
      })

      const result = await service.getCountriesDictionary({ search: 'Germany' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({ label: 'Germany', value: 'DE', note: 'DE' })
    })

    it('returns all items when no search', async () => {
      mock.onGet(`${PROD_API}/lookups/countries`).reply({
        data: [
          { name: 'US', code: 'US' },
          { name: 'DE', code: 'DE' },
        ],
      })

      const result = await service.getCountriesDictionary({})

      expect(result.items).toHaveLength(2)
    })
  })

  describe('getCurrenciesDictionary', () => {
    it('formats currency items with name and code', async () => {
      mock.onGet(`${PROD_API}/lookups/currencies`).reply({
        data: [{ name: 'US Dollar', code: 'USD' }],
      })

      const result = await service.getCurrenciesDictionary({})

      expect(result.items[0]).toEqual({ label: 'US Dollar (USD)', value: 'USD', note: 'USD' })
    })
  })

  describe('getContractsDictionary', () => {
    it('sends types[] query when criteria.type is provided', async () => {
      mock.onGet(`${PROD_API}/contracts`).reply({
        data: [{ id: 'c1', title: 'Engineer', worker: { full_name: 'Jane' } }],
      })

      await service.getContractsDictionary({ criteria: { type: 'Contractor (IC)' } })

      expect(mock.history[0].query).toMatchObject({ 'types[]': 'ongoing_time_based' })
    })
  })

  describe('getPeopleDictionary', () => {
    it('passes search param to API and maps items', async () => {
      mock.onGet(`${PROD_API}/people`).reply({
        data: [{ id: 'p1', first_name: 'Jane', last_name: 'Doe', email: 'jane@acme.com' }],
      })

      const result = await service.getPeopleDictionary({ search: 'Jane' })

      expect(mock.history[0].query).toMatchObject({ search: 'Jane', limit: 100 })
      expect(result.items[0].label).toBe('Jane Doe')
      expect(result.items[0].value).toBe('p1')
    })
  })

  describe('getContractStatusesDictionary', () => {
    it('returns static statuses without API call', async () => {
      const result = await service.getContractStatusesDictionary({})

      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })

    it('filters statuses by search', async () => {
      const result = await service.getContractStatusesDictionary({ search: 'active' })

      expect(result.items.length).toBe(1)
      expect(result.items[0].value).toBe('active')
    })
  })

  describe('getMilestonesDictionary', () => {
    it('returns empty when no contractId', async () => {
      const result = await service.getMilestonesDictionary({})

      expect(result).toEqual({ items: [] })
      expect(mock.history).toHaveLength(0)
    })

    it('fetches milestones for given contract', async () => {
      mock.onGet(`${PROD_API}/contracts/c1/milestones`).reply({
        data: [{ id: 'm1', title: 'Phase 1', status: 'pending' }],
      })

      const result = await service.getMilestonesDictionary({ criteria: { contractId: 'c1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Phase 1')
    })
  })

  describe('getWebhookEventTypesDictionary', () => {
    it('falls back to curated events on API error', async () => {
      mock.onGet(`${PROD_API}/webhooks/events/types`).replyWithError({ message: 'Forbidden' })

      const result = await service.getWebhookEventTypesDictionary({})

      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
    })

    it('returns live events when API succeeds', async () => {
      mock.onGet(`${PROD_API}/webhooks/events/types`).reply({
        data: [{ name: 'contract.signed', description: 'Fired when...' }],
      })

      const result = await service.getWebhookEventTypesDictionary({})

      expect(result.items[0].value).toBe('contract.signed')
    })
  })

  describe('getInterviewStagesDictionary', () => {
    it('always returns empty items', async () => {
      const result = await service.getInterviewStagesDictionary({})

      expect(result).toEqual({ items: [] })
    })
  })

  // ── People & HRIS ──

  describe('listPeople', () => {
    it('sends GET with correct query params', async () => {
      mock.onGet(`${PROD_API}/people`).reply({ data: [] })

      await service.listPeople('Active', 'US', 'Jane', 25)

      expect(mock.history[0].query).toMatchObject({
        hiring_status: 'active',
        country: 'US',
        search: 'Jane',
        limit: 25,
      })
    })

    it('uses defaults when params are omitted', async () => {
      mock.onGet(`${PROD_API}/people`).reply({ data: [] })

      await service.listPeople()

      expect(mock.history[0].query).toMatchObject({ limit: 50 })
    })
  })

  describe('getPerson', () => {
    it('fetches by person ID', async () => {
      mock.onGet(`${PROD_API}/people/per_1`).reply({ data: { id: 'per_1' } })

      const result = await service.getPerson('per_1')

      expect(result).toEqual({ id: 'per_1' })
    })

    it('fetches by external ID', async () => {
      mock.onGet(`${PROD_API}/people/external_id/EMP-001`).reply({ data: { id: 'per_2' } })

      const result = await service.getPerson(null, 'EMP-001')

      expect(result).toEqual({ id: 'per_2' })
    })

    it('throws when neither ID provided', async () => {
      await expect(service.getPerson()).rejects.toThrow(/Provide either/)
    })
  })

  describe('updatePerson', () => {
    it('sends PATCH with cleaned body', async () => {
      mock.onPatch(`${PROD_API}/people/per_1/personal`).reply({ data: { id: 'per_1' } })

      await service.updatePerson('per_1', 'Jane', 'Doe', 'jane@acme.com')

      expect(mock.history[0].body).toEqual({
        data: {
          legal_first_name: 'Jane',
          legal_last_name: 'Doe',
          work_email: 'jane@acme.com',
        },
      })
    })

    it('includes phone when provided', async () => {
      mock.onPatch(`${PROD_API}/people/per_1/personal`).reply({ data: {} })

      await service.updatePerson('per_1', null, null, null, '+44', '123456')

      expect(mock.history[0].body.data).toHaveProperty('phone_numbers')
      expect(mock.history[0].body.data.phone_numbers[0]).toMatchObject({
        type: 'WORK',
        dial_code: '+44',
        phone_number: '123456',
      })
    })

    it('throws when no fields provided', async () => {
      await expect(service.updatePerson('per_1')).rejects.toThrow(/at least one field/)
    })
  })

  describe('updateWorkingLocation', () => {
    it('sends PUT with country and city', async () => {
      mock.onPut(`${PROD_API}/people/per_1/working-location`).reply({ data: {} })

      await service.updateWorkingLocation('per_1', 'DE', 'Berlin', '2026-07-01')

      expect(mock.history[0].body).toEqual({
        data: { country: 'DE', city: 'Berlin', effective_date: '2026-07-01' },
      })
    })
  })

  describe('createPersonWithoutContract', () => {
    it('sends POST to /pwac with correct body', async () => {
      mock.onPost(`${PROD_API}/pwac`).reply({ data: { id: 'per_new' } })

      await service.createPersonWithoutContract('Jane', 'Doe', 'jane@acme.com', 'le_1', 'team_1', '2026-07-01', 'US', 'Engineer')

      const body = mock.history[0].body.data

      expect(body.client.team.id).toBe('team_1')
      expect(body.client.legal_entity.id).toBe('le_1')
      expect(body.person.email).toBe('jane@acme.com')
      expect(body.person.first_name).toBe('Jane')
    })
  })

  // ── Org Structure ──

  describe('listOrgStructure', () => {
    it('sends GET to /hris/organization_structures', async () => {
      mock.onGet(`${PROD_API}/hris/organization_structures`).reply({ data: [] })

      await service.listOrgStructure()

      expect(mock.history).toHaveLength(1)
    })
  })

  describe('getOrgStructure', () => {
    it('fetches by structure ID', async () => {
      mock.onGet(`${PROD_API}/hris/organization_structures/s1`).reply({ data: { id: 's1' } })

      await service.getOrgStructure('s1')

      expect(mock.history).toHaveLength(1)
    })

    it('fetches by external ref', async () => {
      mock.onGet(`${PROD_API}/hris/organization_structures/external/ext1`).reply({ data: {} })

      await service.getOrgStructure(null, 'ext1')

      expect(mock.history[0].url).toContain('/external/ext1')
    })

    it('throws when neither provided', async () => {
      await expect(service.getOrgStructure()).rejects.toThrow()
    })
  })

  describe('createOrgStructure', () => {
    it('sends POST with name and teams array', async () => {
      mock.onPost(`${PROD_API}/hris/organization_structures`).reply({ data: { id: 'new' } })

      await service.createOrgStructure('Engineering', 'parent_1', 'ext-1')

      const body = mock.history[0].body.data

      expect(body.name).toBe('Engineering')
      expect(body.teams).toEqual([{ name: 'Engineering', parent_id: 'parent_1' }])
      expect(body.external_id).toBe('ext-1')
    })
  })

  describe('deleteOrgStructure', () => {
    it('sends DELETE and returns ok', async () => {
      mock.onDelete(`${PROD_API}/hris/organization_structures/s1`).reply({})

      const result = await service.deleteOrgStructure('s1')

      expect(result).toEqual({ ok: true })
    })
  })

  // ── Custom Fields ──

  describe('getCustomFields', () => {
    it('fetches person custom fields with resource ID', async () => {
      mock.onGet(`${PROD_API}/people/per_1/custom-fields`).reply({ data: [] })

      await service.getCustomFields('Person', 'per_1')

      expect(mock.history).toHaveLength(1)
    })

    it('fetches contract custom fields with resource ID', async () => {
      mock.onGet(`${PROD_API}/contracts/c1/custom_fields`).reply({ data: [] })

      await service.getCustomFields('Contract', 'c1')

      expect(mock.history).toHaveLength(1)
    })

    it('throws for organization without resource ID', async () => {
      await expect(service.getCustomFields('Organization')).rejects.toThrow(/requires/)
    })

    it('throws for invalid scope', async () => {
      await expect(service.getCustomFields('Invalid')).rejects.toThrow(/Person, Contract, or Organization/)
    })
  })

  describe('setCustomField', () => {
    it('sends PATCH for person custom field', async () => {
      mock.onPatch(`${PROD_API}/people/per_1/custom-fields/slack`).reply({ data: {} })

      await service.setCustomField('Person', 'per_1', 'slack', '@jane')

      expect(mock.history[0].body).toEqual({ data: { value: '@jane' } })
    })

    it('sends PATCH for contract custom field', async () => {
      mock.onPatch(`${PROD_API}/contracts/c1/custom_fields/tier`).reply({ data: {} })

      await service.setCustomField('Contract', 'c1', 'tier', 'gold')

      expect(mock.history[0].body).toEqual({ data: { value: 'gold' } })
    })
  })

  describe('deleteCustomField', () => {
    it('sends DELETE and returns ok', async () => {
      mock.onDelete(`${PROD_API}/people/per_1/custom-fields/slack`).reply({})

      const result = await service.deleteCustomField('Person', 'per_1', 'slack')

      expect(result).toEqual({ ok: true })
    })
  })

  // ── Contracts ──

  describe('listContracts', () => {
    it('sends GET with filters', async () => {
      mock.onGet(`${PROD_API}/contracts`).reply({ data: [] })

      await service.listContracts('active', 'US', 'Contractor (IC)', null, 10)

      expect(mock.history[0].query).toMatchObject({
        status: 'active',
        country_code: 'US',
        'types[]': 'ongoing_time_based',
        limit: 10,
      })
    })

    it('fetches by external ID when provided', async () => {
      mock.onGet(`${PROD_API}/contracts/external_id/CON-001`).reply({ data: {} })

      await service.listContracts(null, null, null, 'CON-001')

      expect(mock.history[0].url).toContain('/external_id/CON-001')
    })
  })

  describe('getContract', () => {
    it('sends GET to contract path', async () => {
      mock.onGet(`${PROD_API}/contracts/c1`).reply({ data: { id: 'c1' } })

      await service.getContract('c1')

      expect(mock.history).toHaveLength(1)
    })
  })

  describe('createContractorContract', () => {
    it('sends POST with correct body for hourly contractor', async () => {
      mock.onPost(`${PROD_API}/contracts`).reply({ data: { id: 'new' } })

      await service.createContractorContract(
        'Engineer', 'US', 'le_1', 'team_1', 'Jane', 'jane@acme.com',
        'Hourly', 50, 'USD', '2026-07-01', 'Build stuff', 'EXT-1'
      )

      const body = mock.history[0].body.data

      expect(body.type).toBe('pay_as_you_go_time_based')
      expect(body.title).toBe('Engineer')
      expect(body.worker).toEqual({ first_name: 'Jane', expected_email: 'jane@acme.com' })
      expect(body.compensation_details.amount).toBe(50)
      expect(body.compensation_details.scale).toBe('hourly')
      expect(body.compensation_details.currency_code).toBe('USD')
      expect(body.external_id).toBe('EXT-1')
    })

    it('creates task-based contract type', async () => {
      mock.onPost(`${PROD_API}/contracts`).reply({ data: {} })

      await service.createContractorContract(
        'Task Worker', 'US', 'le_1', 'team_1', 'Bob', 'bob@acme.com',
        'Task-based', 100, 'USD', '2026-07-01'
      )

      expect(mock.history[0].body.data.type).toBe('payg_tasks')
    })
  })

  describe('sendContractToWorker', () => {
    it('sends POST with email to invitations', async () => {
      mock.onPost(`${PROD_API}/contracts/c1/invitations`).reply({ data: {} })

      await service.sendContractToWorker('c1', 'jane@acme.com')

      expect(mock.history[0].body).toEqual({ data: { email: 'jane@acme.com' } })
    })
  })

  describe('signContract', () => {
    it('sends POST with signature to signatures', async () => {
      mock.onPost(`${PROD_API}/contracts/c1/signatures`).reply({ data: {} })

      await service.signContract('c1', 'Jane Doe')

      expect(mock.history[0].body).toEqual({ data: { client_signature: 'Jane Doe' } })
    })
  })

  describe('terminateContract', () => {
    it('sends POST with termination details', async () => {
      mock.onPost(`${PROD_API}/contracts/c1/terminations`).reply({ data: {} })

      await service.terminateContract('c1', '2026-08-01', 'Project done', 'Thanks')

      expect(mock.history[0].body).toEqual({
        data: {
          completion_date: '2026-08-01',
          termination_reason_description: 'Project done',
          message: 'Thanks',
        },
      })
    })
  })

  describe('amendContract', () => {
    it('sends POST with amendment fields', async () => {
      mock.onPost(`${PROD_API}/contracts/c1/amendments`).reply({ data: {} })

      await service.amendContract('c1', '2026-08-01', 'Lead Engineer', 60, 'USD', 'Promotion')

      const body = mock.history[0].body.data

      expect(body.effective_date).toBe('2026-08-01')
      expect(body.job_title_name).toBe('Lead Engineer')
      expect(body.compensation_details).toEqual({ amount: 60, currency_code: 'USD' })
      expect(body.reason).toBe('Promotion')
    })
  })

  describe('removeWorkerInvite', () => {
    it('sends DELETE and returns ok', async () => {
      mock.onDelete(`${PROD_API}/contracts/c1/invite`).reply({})

      const result = await service.removeWorkerInvite('c1')

      expect(result).toEqual({ ok: true })
    })
  })

  // ── Milestones ──

  describe('createMilestone', () => {
    it('sends POST with milestone data', async () => {
      mock.onPost(`${PROD_API}/contracts/c1/milestones`).reply({ data: { id: 'm1' } })

      await service.createMilestone('c1', 'Design Phase', 2500, 'Deliver designs', 'USD', '2026-08-01')

      expect(mock.history[0].body.data).toMatchObject({
        title: 'Design Phase',
        amount: 2500,
        description: 'Deliver designs',
        currency_code: 'USD',
        due_date: '2026-08-01',
      })
    })
  })

  describe('deleteMilestone', () => {
    it('sends DELETE and returns ok', async () => {
      mock.onDelete(`${PROD_API}/contracts/c1/milestones/m1`).reply({})

      const result = await service.deleteMilestone('c1', 'm1')

      expect(result).toEqual({ ok: true })
    })
  })

  // ── Tasks ──

  describe('createTask', () => {
    it('sends POST with task data', async () => {
      mock.onPost(`${PROD_API}/contracts/c1/tasks`).reply({ data: { id: 't1' } })

      await service.createTask('c1', 'Review', 250, 'Code review', '2026-07-15')

      expect(mock.history[0].body.data).toMatchObject({
        title: 'Review',
        amount: '250',
        description: 'Code review',
        date_submitted: '2026-07-15',
      })
    })
  })

  describe('reviewTask', () => {
    it('approves a task', async () => {
      mock.onPost(`${PROD_API}/contracts/c1/tasks/t1/reviews`).reply({ data: {} })

      await service.reviewTask('c1', 't1', 'Approve')

      expect(mock.history[0].body).toEqual({ data: { status: 'approved', reason: 'Approved' } })
    })

    it('rejects a task with reason', async () => {
      mock.onPost(`${PROD_API}/contracts/c1/tasks/t1/reviews`).reply({ data: {} })

      await service.reviewTask('c1', 't1', 'Reject', 'Needs more detail')

      expect(mock.history[0].body).toEqual({ data: { status: 'rejected', reason: 'Needs more detail' } })
    })
  })

  // ── Timesheets ──

  describe('listTimesheets', () => {
    it('uses contract-specific path when contractId provided', async () => {
      mock.onGet(`${PROD_API}/contracts/c1/timesheets`).reply({ data: [] })

      await service.listTimesheets('c1')

      expect(mock.history[0].url).toContain('/contracts/c1/timesheets')
    })

    it('uses global path when no contractId', async () => {
      mock.onGet(`${PROD_API}/timesheets`).reply({ data: [] })

      await service.listTimesheets()

      expect(mock.history[0].url).toBe(`${PROD_API}/timesheets`)
    })
  })

  describe('createTimesheetEntry', () => {
    it('sends POST to /timesheets with correct body', async () => {
      mock.onPost(`${PROD_API}/timesheets`).reply({ data: { id: 'ts_1' } })

      await service.createTimesheetEntry('c1', 8, '2026-07-15', 'Development')

      expect(mock.history[0].body.data).toMatchObject({
        contract_id: 'c1',
        quantity: 8,
        date_submitted: '2026-07-15',
        description: 'Development',
      })
    })
  })

  describe('deleteTimesheetEntry', () => {
    it('sends DELETE and returns ok', async () => {
      mock.onDelete(`${PROD_API}/timesheets/ts_1`).reply({})

      const result = await service.deleteTimesheetEntry(null, 'ts_1')

      expect(result).toEqual({ ok: true })
    })
  })

  describe('reviewTimesheet', () => {
    it('approves a timesheet', async () => {
      mock.onPost(`${PROD_API}/timesheets/ts_1/reviews`).reply({ data: {} })

      await service.reviewTimesheet(null, 'ts_1', 'Approve')

      expect(mock.history[0].body).toEqual({ data: { status: 'approved', reason: 'Approved' } })
    })
  })

  // ── Invoice Adjustments ──

  describe('listInvoiceAdjustments', () => {
    it('uses contract path when provided', async () => {
      mock.onGet(`${PROD_API}/contracts/c1/invoice-adjustments`).reply({ data: [] })

      await service.listInvoiceAdjustments('c1')

      expect(mock.history[0].url).toContain('/contracts/c1/invoice-adjustments')
    })

    it('uses global path when no contract', async () => {
      mock.onGet(`${PROD_API}/invoice-adjustments`).reply({ data: [] })

      await service.listInvoiceAdjustments()

      expect(mock.history[0].url).toBe(`${PROD_API}/invoice-adjustments`)
    })
  })

  describe('createInvoiceAdjustment', () => {
    it('maps type and sends POST', async () => {
      mock.onPost(`${PROD_API}/invoice-adjustments`).reply({ data: { id: 'adj_1' } })

      await service.createInvoiceAdjustment('c1', 'Bonus', 500, 'Q2 bonus', '2026-07-01')

      expect(mock.history[0].body.data).toMatchObject({
        type: 'bonus',
        amount: 500,
        contract_id: 'c1',
        description: 'Q2 bonus',
        date_submitted: '2026-07-01',
      })
    })
  })

  describe('deleteInvoiceAdjustment', () => {
    it('sends DELETE and returns ok', async () => {
      mock.onDelete(`${PROD_API}/invoice-adjustments/adj_1`).reply({})

      const result = await service.deleteInvoiceAdjustment(null, 'adj_1')

      expect(result).toEqual({ ok: true })
    })
  })

  // ── Off-Cycle Payments ──

  describe('createOffCyclePayment', () => {
    it('sends POST with payment data', async () => {
      mock.onPost(`${PROD_API}/contracts/c1/off-cycle-payments`).reply({ data: {} })

      await service.createOffCyclePayment('c1', 1000, 'USD', 'Project bonus', '2026-07-01')

      expect(mock.history[0].body.data).toMatchObject({
        amount: 1000,
        currency_code: 'USD',
        description: 'Project bonus',
        date_submitted: '2026-07-01',
      })
    })
  })

  // ── EOR ──

  describe('calculateEmployeeCost', () => {
    it('looks up country name and sends POST', async () => {
      mock.onGet(`${PROD_API}/lookups/countries`).reply({
        data: [{ name: 'Germany', code: 'DE' }],
      })

      mock.onPost(`${PROD_API}/eor/employment_cost`).reply({
        data: { total_cost: 93600 },
      })

      await service.calculateEmployeeCost('DE', 75000, 'EUR')

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body.data).toMatchObject({
        country: 'Germany',
        country_code: 'DE',
        salary: 75000,
        currency: 'EUR',
      })
    })
  })

  describe('getHiringGuide', () => {
    it('sends GET to /eor/validations/{country}', async () => {
      mock.onGet(`${PROD_API}/eor/validations/DE`).reply({ data: {} })

      await service.getHiringGuide('DE')

      expect(mock.history).toHaveLength(1)
    })
  })

  describe('acceptEORQuote', () => {
    it('sends POST to accept-quote', async () => {
      mock.onPost(`${PROD_API}/eor/c1/accept-quote`).reply({ data: {} })

      await service.acceptEORQuote('c1')

      expect(mock.history).toHaveLength(1)
    })
  })

  describe('cancelEORContract', () => {
    it('maps reason and sends POST', async () => {
      mock.onPost(`${PROD_API}/eor/contract/c1/cancel`).reply({ data: {} })

      await service.cancelEORContract('c1', 'Internal Decision', 'Changed plans')

      expect(mock.history[0].body.data).toMatchObject({
        cancellation_reason: 'INTERNAL_DECISION',
        cancellation_message: 'Changed plans',
      })
    })
  })

  describe('delayEOROnboarding', () => {
    it('sends PATCH with delayed true by default', async () => {
      mock.onPatch(`${PROD_API}/eor/contract/c1/delay-onboarding`).reply({ data: {} })

      await service.delayEOROnboarding('c1')

      expect(mock.history[0].body).toEqual({ data: { is_employee_onboarding_delayed: true } })
    })

    it('sends false when explicitly set', async () => {
      mock.onPatch(`${PROD_API}/eor/contract/c1/delay-onboarding`).reply({ data: {} })

      await service.delayEOROnboarding('c1', false)

      expect(mock.history[0].body).toEqual({ data: { is_employee_onboarding_delayed: false } })
    })
  })

  // ── Time Off ──

  describe('listTimeOffRequests', () => {
    it('sends GET with filters', async () => {
      mock.onGet(`${PROD_API}/time_offs`).reply({ data: [] })

      await service.listTimeOffRequests('per_1', 'Approved', '2026-07-01', '2026-07-31')

      expect(mock.history[0].query).toMatchObject({
        profile_id: 'per_1',
        status: 'approved',
        from_date: '2026-07-01',
        to_date: '2026-07-31',
      })
    })
  })

  describe('createTimeOffRequest', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${PROD_API}/time_offs`).reply({ data: { id: 'to_1' } })

      await service.createTimeOffRequest('per_1', 'type_vac', '2026-07-01', '2026-07-05', 'Summer break')

      expect(mock.history[0].body.data).toMatchObject({
        recipient_profile_id: 'per_1',
        time_off_type_id: 'type_vac',
        start_date: '2026-07-01',
        end_date: '2026-07-05',
        reason: 'Summer break',
      })
    })
  })

  describe('reviewTimeOffRequest', () => {
    it('approves request', async () => {
      mock.onPost(`${PROD_API}/time_offs/review`).reply({ data: {} })

      await service.reviewTimeOffRequest('to_1', 'Approve', 'Enjoy!')

      expect(mock.history[0].body.data).toEqual([{ id: 'to_1', status: 'APPROVED', reason: 'Enjoy!' }])
    })

    it('rejects request', async () => {
      mock.onPost(`${PROD_API}/time_offs/review`).reply({ data: {} })

      await service.reviewTimeOffRequest('to_1', 'Reject', 'Deadline')

      expect(mock.history[0].body.data).toEqual([{ id: 'to_1', status: 'REJECTED', reason: 'Deadline' }])
    })
  })

  describe('cancelTimeOffRequest', () => {
    it('sends POST to cancel endpoint', async () => {
      mock.onPost(`${PROD_API}/time_offs/to_1/cancel`).reply({ data: {} })

      await service.cancelTimeOffRequest('to_1', 'Plans changed')

      expect(mock.history[0].body.data).toMatchObject({ reason: 'Plans changed' })
    })
  })

  describe('validateTimeOffRequest', () => {
    it('sends POST to validate endpoint', async () => {
      mock.onPost(`${PROD_API}/time_offs/validate`).reply({ data: { valid: true } })

      await service.validateTimeOffRequest('per_1', 'type_vac', '2026-07-01', '2026-07-05')

      expect(mock.history[0].body.data).toMatchObject({
        recipient_profile_id: 'per_1',
        time_off_type_id: 'type_vac',
        start_date: '2026-07-01',
        end_date: '2026-07-05',
      })
    })
  })

  // ── Adjustments (org-side) ──

  describe('listAdjustments', () => {
    it('sends GET with date filters', async () => {
      mock.onGet(`${PROD_API}/contracts/c1/adjustments`).reply({ data: [] })

      await service.listAdjustments('c1', '2026-01-01', '2026-12-31')

      expect(mock.history[0].query).toMatchObject({
        from_date: '2026-01-01',
        to_date: '2026-12-31',
      })
    })
  })

  describe('updateAdjustment', () => {
    it('sends PATCH with updated fields', async () => {
      mock.onPatch(`${PROD_API}/adjustments/adj_1`).reply({ data: {} })

      await service.updateAdjustment(null, 'adj_1', 1500, 'Updated bonus', '2026-08-01')

      expect(mock.history[0].body.data).toMatchObject({
        amount: 1500,
        description: 'Updated bonus',
        effective_date: '2026-08-01',
      })
    })
  })

  describe('deleteAdjustment', () => {
    it('sends DELETE and returns ok', async () => {
      mock.onDelete(`${PROD_API}/adjustments/adj_1`).reply({})

      const result = await service.deleteAdjustment(null, 'adj_1')

      expect(result).toEqual({ ok: true })
    })
  })

  // ── Global Payroll ──

  describe('listGPEmployees', () => {
    it('sends GET with types[] filter', async () => {
      mock.onGet(`${PROD_API}/contracts`).reply({ data: [] })

      await service.listGPEmployees('le_1')

      expect(mock.history[0].query).toMatchObject({
        'types[]': 'global_payroll',
        limit: 100,
        legal_entity_id: 'le_1',
      })
    })
  })

  describe('updateGPCompensation', () => {
    it('maps scale and sends PATCH', async () => {
      mock.onPatch(`${PROD_API}/gp/workers/w1/compensation`).reply({ data: {} })

      await service.updateGPCompensation('w1', 85000, 'Year', '2026-08-01')

      expect(mock.history[0].body.data).toMatchObject({
        salary: 85000,
        scale: 'YEAR',
        effective_date: '2026-08-01',
      })
    })
  })

  describe('requestGPTermination', () => {
    it('sends POST with termination data', async () => {
      mock.onPost(`${PROD_API}/gp/contracts/c1/terminations`).reply({ data: {} })

      await service.requestGPTermination('c1', '2026-08-01', 'End of project')

      expect(mock.history[0].body.data).toMatchObject({
        termination_date: '2026-08-01',
        reason: 'End of project',
      })
    })
  })

  describe('listGPPayslips', () => {
    it('sends GET for worker payslips', async () => {
      mock.onGet(`${PROD_API}/gp/workers/w1/payslips`).reply({ data: [] })

      await service.listGPPayslips('w1')

      expect(mock.history).toHaveLength(1)
    })

    it('throws when no worker ID', async () => {
      await expect(service.listGPPayslips()).rejects.toThrow(/Provide a Worker/)
    })
  })

  // ── Shifts ──

  describe('listShifts', () => {
    it('sends GET with filters', async () => {
      mock.onGet(`${PROD_API}/time_tracking/shifts`).reply({ data: [] })

      await service.listShifts('c1', '2026-07-01', '2026-07-31')

      expect(mock.history[0].query).toMatchObject({
        contract_id: 'c1',
        from_date: '2026-07-01',
        to_date: '2026-07-31',
      })
    })
  })

  describe('deleteShift', () => {
    it('deletes by Deel ID', async () => {
      mock.onDelete(`${PROD_API}/time_tracking/shifts/sh_1`).reply({})

      const result = await service.deleteShift(null, 'sh_1')

      expect(result).toEqual({ ok: true })
    })

    it('deletes by external ID', async () => {
      mock.onDelete(`${PROD_API}/time_tracking/shifts/external_id/ext_1`).reply({})

      const result = await service.deleteShift(null, 'ext_1', true)

      expect(result).toEqual({ ok: true })
    })
  })

  // ── ATS ──

  describe('listJobs', () => {
    it('sends GET with status and department filters', async () => {
      mock.onGet(`${PROD_API}/ats/jobs`).reply({ data: [] })

      await service.listJobs('Open', 'dept_1', 10)

      expect(mock.history[0].query).toMatchObject({
        status: 'OPEN',
        department_id: 'dept_1',
        limit: 10,
      })
    })
  })

  describe('createJob', () => {
    it('sends POST with job data', async () => {
      mock.onPost(`${PROD_API}/ats/jobs`).reply({ data: { id: 'job_1' } })

      await service.createJob('Engineer', ['t1'], ['l1'], ['et1'], ['d1'], '<p>Join us</p>')

      expect(mock.history[0].body.data).toMatchObject({
        title: 'Engineer',
        team_ids: ['t1'],
        location_ids: ['l1'],
        employment_type_ids: ['et1'],
        department_ids: ['d1'],
        richtext_description: '<p>Join us</p>',
      })
    })
  })

  describe('createCandidate', () => {
    it('sends POST with candidate data', async () => {
      mock.onPost(`${PROD_API}/ats/candidates`).reply({ data: { id: 'cand_1' } })

      await service.createCandidate('Jane', 'Doe', 'jane@candidate.com', '+1 555', 'https://linkedin.com/in/jane')

      expect(mock.history[0].body.data).toMatchObject({
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@candidate.com',
        phone_number: '+1 555',
        linkedin_profile_url: 'https://linkedin.com/in/jane',
      })
    })
  })

  describe('createApplication', () => {
    it('sends POST with application data', async () => {
      mock.onPost(`${PROD_API}/ats/applications`).reply({ data: { id: 'app_1' } })

      await service.createApplication('job_1', 'cand_1', 'et_1')

      expect(mock.history[0].body.data).toMatchObject({
        job_id: 'job_1',
        candidate_id: 'cand_1',
        job_employment_type_id: 'et_1',
      })
    })
  })

  describe('addApplicationNote', () => {
    it('sends POST with note data', async () => {
      mock.onPost(`${PROD_API}/ats/applications/app_1/notes`).reply({ data: {} })

      await service.addApplicationNote('app_1', 'author_1', 'Great candidate')

      expect(mock.history[0].body.data).toMatchObject({
        author_id: 'author_1',
        richtext_content: 'Great candidate',
      })
    })
  })

  describe('moveApplicationToStage', () => {
    it('sends POST with stage data, defaults isCurrentStage to true', async () => {
      mock.onPost(`${PROD_API}/ats/applications/app_1/interview-plan-stages`).reply({ data: {} })

      await service.moveApplicationToStage('app_1', 'stage_1', 'creator_1')

      expect(mock.history[0].body.data).toMatchObject({
        interview_plan_stage_id: 'stage_1',
        creator_id: 'creator_1',
        is_current_stage: true,
      })
    })
  })

  // ── Immigration ──

  describe('checkVisaRequirements', () => {
    it('maps reason and sends GET', async () => {
      mock.onGet(`${PROD_API}/immigration/visa-requirement/business`).reply({ data: {} })

      await service.checkVisaRequirements('DE', 'DE', 'US', '2026-08-01', '2026-08-15', 'Internal business (no client work)')

      expect(mock.history[0].query).toMatchObject({
        nationality: 'DE',
        residence_country: 'DE',
        destination_country: 'US',
        trip_reason: 'INTERNAL_BUSINESS_WITHOUT_WORK_FOR_CLIENT',
      })
    })
  })

  // ── Invoices ──

  describe('listInvoices', () => {
    it('sends GET with filters', async () => {
      mock.onGet(`${PROD_API}/invoices`).reply({ data: [] })

      await service.listInvoices('Paid', '2026-01-01', '2026-12-31')

      expect(mock.history[0].query).toMatchObject({
        status: 'paid',
        from_date: '2026-01-01',
        to_date: '2026-12-31',
      })
    })
  })

  describe('getInvoice', () => {
    it('sends GET to invoice path', async () => {
      mock.onGet(`${PROD_API}/invoices/inv_1`).reply({ data: {} })

      await service.getInvoice('inv_1')

      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Niche modules ──

  describe('getWorkerKYC', () => {
    it('sends GET to screenings/kyc path', async () => {
      mock.onGet(`${PROD_API}/screenings/kyc/w1`).reply({ data: {} })

      await service.getWorkerKYC('w1')

      expect(mock.history).toHaveLength(1)
    })
  })

  describe('createVeriffSession', () => {
    it('sends POST with worker_id', async () => {
      mock.onPost(`${PROD_API}/veriff/sessions`).reply({ data: {} })

      await service.createVeriffSession('w1')

      expect(mock.history[0].body).toEqual({ data: { worker_id: 'w1' } })
    })
  })

  describe('createMagicLink', () => {
    it('sends POST with email', async () => {
      mock.onPost(`${PROD_API}/magic-link`).reply({ data: {} })

      await service.createMagicLink('manager@acme.com')

      expect(mock.history[0].body).toEqual({ data: { email: 'manager@acme.com' } })
    })
  })

  // ── Webhook Trigger Methods ──

  describe('handleTriggerUpsertWebhook', () => {
    it('creates new webhook when no existing webhook', async () => {
      mock.onPost(`${PROD_API}/webhooks`).reply({
        data: { id: 'wh_1', secret: 'sec_abc' },
      })

      mock.onGet(`${PROD_API}/organizations`).reply({
        data: { id: 'org_1' },
      })

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://flowrunner.com/webhook/123',
      })

      expect(result.webhookData.id).toBe('wh_1')
      expect(result.webhookData.secret).toBe('sec_abc')
      expect(result.eventScopeId).toBe('org_1')
    })

    it('patches existing webhook', async () => {
      mock.onPatch(`${PROD_API}/webhooks/wh_1`).reply({
        data: { id: 'wh_1' },
      })

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://flowrunner.com/webhook/123',
        webhookData: { id: 'wh_1', secret: 'sec_old', eventScopeId: 'org_1' },
      })

      expect(result.webhookData.secret).toBe('sec_old')
    })

    it('throws when no callbackUrl', async () => {
      await expect(service.handleTriggerUpsertWebhook({})).rejects.toThrow(/callback URL/)
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('matches triggers by eventType', async () => {
      const result = await service.handleTriggerSelectMatched({
        event: { data: { eventType: 'contract.signed' } },
        triggers: [
          { id: 't1', data: { eventType: 'contract.signed' } },
          { id: 't2', data: { eventType: 'contract.created' } },
          { id: 't3', params: { eventType: 'contract.signed' } },
        ],
      })

      expect(result.ids).toEqual(['t1', 't3'])
    })

    it('matches all triggers when no eventType filter', async () => {
      const result = await service.handleTriggerSelectMatched({
        event: { data: { eventType: 'contract.signed' } },
        triggers: [
          { id: 't1', data: {} },
          { id: 't2' },
        ],
      })

      expect(result.ids).toEqual(['t1', 't2'])
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes webhook by ID', async () => {
      mock.onDelete(`${PROD_API}/webhooks/wh_1`).reply({})

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { id: 'wh_1' },
      })

      expect(result).toEqual({})
      expect(mock.history).toHaveLength(1)
    })

    it('returns empty object when no webhook ID', async () => {
      const result = await service.handleTriggerDeleteWebhook({})

      expect(result).toEqual({})
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('onDeelEvent', () => {
    it('returns null (metadata-only trigger registration)', () => {
      expect(service.onDeelEvent()).toBeNull()
    })
  })

  // ── Auth validation ──

  describe('auth validation', () => {
    it('throws when no access token', async () => {
      const origRequest = service.request

      service.request = { headers: {} }

      try {
        await expect(service.getMyProfile()).rejects.toThrow(/not connected/)
      } finally {
        service.request = origRequest
      }
    })
  })

  // ── Data envelope auto-wrapping ──

  describe('#deelRequest data envelope', () => {
    it('wraps POST body in {data: ...} automatically', async () => {
      mock.onPost(`${PROD_API}/contracts/c1/invitations`).reply({ data: {} })

      await service.sendContractToWorker('c1', 'test@example.com')

      expect(mock.history[0].body).toEqual({ data: { email: 'test@example.com' } })
    })

    it('sends {data: {}} for POST with no body', async () => {
      mock.onPost(`${PROD_API}/eor/c1/accept-quote`).reply({ data: {} })

      await service.acceptEORQuote('c1')

      expect(mock.history[0].body).toEqual({ data: {} })
    })
  })

  // ── Worker Relations ──

  describe('listWorkerRelations', () => {
    it('reads relations from person record', async () => {
      mock.onGet(`${PROD_API}/people/per_1`).reply({
        data: { id: 'per_1', worker_relations: [{ type: 'manager', target: { id: 'per_2' } }] },
      })

      const result = await service.listWorkerRelations('per_1')

      expect(result.data).toHaveLength(1)
      expect(result.data[0].type).toBe('manager')
    })
  })

  // ── Direct Employee ──

  describe('createDirectEmployee', () => {
    it('resolves seniority name and sends POST', async () => {
      mock.onGet(`${PROD_API}/lookups/seniorities`).reply({
        data: [{ id: 5, name: 'Senior' }],
      })

      mock.onPost(`${PROD_API}/people`).reply({ data: { id: 'emp_1' } })

      await service.createDirectEmployee(
        'Jane', 'Doe', 'jane@acme.com', 'US', 'US',
        'le_1', 'team_1', 'Engineer', '5', '2026-07-01', 80000, 'USD'
      )

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body.data.employment.seniority).toBe('Senior')
      expect(postCall.body.data.compensation_details).toMatchObject({ salary: 80000, currency: 'USD' })
    })
  })

  // ── Untested Dictionaries ──

  describe('getJobTitlesDictionary', () => {
    it('returns formatted items from lookups', async () => {
      mock.onGet(`${PROD_API}/lookups/job-titles`).reply({ data: [{ id: 'jt1', name: 'Engineer' }] })
      const result = await service.getJobTitlesDictionary({})
      expect(result.items[0]).toMatchObject({ label: 'Engineer', value: 'jt1' })
    })
  })

  describe('getSeniorityLevelsDictionary', () => {
    it('returns formatted items', async () => {
      mock.onGet(`${PROD_API}/lookups/seniorities`).reply({ data: [{ id: '5', name: 'Senior' }] })
      const result = await service.getSeniorityLevelsDictionary({})
      expect(result.items[0]).toMatchObject({ label: 'Senior', value: '5' })
    })
  })

  describe('getTimeOffTypesDictionary', () => {
    it('returns time off types', async () => {
      mock.onGet(`${PROD_API}/lookups/time-off-types`).reply({ data: [{ id: 'tot_1', name: 'Vacation', type: 'vacation' }] })
      const result = await service.getTimeOffTypesDictionary({})
      expect(result.items[0]).toMatchObject({ label: 'Vacation', value: 'tot_1' })
    })
  })

  describe('getLegalEntitiesDictionary', () => {
    it('returns legal entities', async () => {
      mock.onGet(`${PROD_API}/legal-entities`).reply({ data: [{ id: 'le_1', name: 'Acme Inc', country: 'US' }] })
      const result = await service.getLegalEntitiesDictionary({})
      expect(result.items[0]).toMatchObject({ label: 'Acme Inc', value: 'le_1', note: 'US' })
    })
  })

  describe('getDepartmentsDictionary', () => {
    it('returns departments', async () => {
      mock.onGet(`${PROD_API}/departments`).reply({ data: [{ id: 'd1', name: 'Engineering' }] })
      const result = await service.getDepartmentsDictionary({})
      expect(result.items[0]).toMatchObject({ label: 'Engineering', value: 'd1' })
    })
  })

  describe('getGroupsDictionary', () => {
    it('returns groups', async () => {
      mock.onGet(`${PROD_API}/groups`).reply({ data: [{ id: 'g1', name: 'Core Team' }] })
      const result = await service.getGroupsDictionary({})
      expect(result.items[0]).toMatchObject({ label: 'Core Team', value: 'g1' })
    })
  })

  describe('getAdjustmentCategoriesDictionary', () => {
    it('returns categories', async () => {
      mock.onGet(`${PROD_API}/adjustments/categories`).reply({ data: [{ id: 'cat_1', name: 'Bonus', type: 'bonus' }] })
      const result = await service.getAdjustmentCategoriesDictionary({})
      expect(result.items[0]).toMatchObject({ label: 'Bonus' })
    })
  })

  describe('getATSJobsDictionary', () => {
    it('returns ATS jobs', async () => {
      mock.onGet(`${PROD_API}/ats/jobs`).reply({ data: [{ id: 'job_1', title: 'Engineer', status: 'OPEN' }] })
      const result = await service.getATSJobsDictionary({})
      expect(result.items[0]).toMatchObject({ label: 'Engineer', value: 'job_1', note: 'OPEN' })
    })
  })

  describe('getTeamsDictionary', () => {
    it('returns teams', async () => {
      mock.onGet(`${PROD_API}/teams`).reply({ data: [{ id: 't1', name: 'Backend' }] })
      const result = await service.getTeamsDictionary({})
      expect(result.items[0]).toMatchObject({ label: 'Backend', value: 't1' })
    })
  })

  describe('getATSEmploymentTypesDictionary', () => {
    it('returns employment types', async () => {
      mock.onGet(`${PROD_API}/ats/employment-types`).reply({ data: [{ id: 'et1', name: 'Full-time' }] })
      const result = await service.getATSEmploymentTypesDictionary({})
      expect(result.items[0]).toMatchObject({ label: 'Full-time', value: 'et1' })
    })
  })

  describe('getATSLocationsDictionary', () => {
    it('returns locations', async () => {
      mock.onGet(`${PROD_API}/ats/locations`).reply({ data: [{ id: 'loc1', name: 'Berlin', country: 'DE' }] })
      const result = await service.getATSLocationsDictionary({})
      expect(result.items[0]).toMatchObject({ label: 'Berlin', value: 'loc1' })
    })
  })

  describe('getATSDepartmentsDictionary', () => {
    it('returns ATS departments', async () => {
      mock.onGet(`${PROD_API}/ats/departments`).reply({ data: [{ id: 'dep1', name: 'Product' }] })
      const result = await service.getATSDepartmentsDictionary({})
      expect(result.items[0]).toMatchObject({ label: 'Product', value: 'dep1' })
    })
  })

  describe('getATSHiringMembersDictionary', () => {
    it('returns hiring members', async () => {
      mock.onGet(`${PROD_API}/ats/hiring-members`).reply({ data: [{ id: 'hm1', first_name: 'Jane', last_name: 'Doe', email: 'jane@acme.com' }] })
      const result = await service.getATSHiringMembersDictionary({})
      expect(result.items[0]).toMatchObject({ label: 'Jane Doe', value: 'hm1' })
    })
  })

  describe('getOrgStructuresDictionary', () => {
    it('returns org structures', async () => {
      mock.onGet(`${PROD_API}/hris/organization_structures`).reply({ data: [{ id: 's1', name: 'Engineering' }] })
      const result = await service.getOrgStructuresDictionary({})
      expect(result.items[0]).toMatchObject({ label: 'Engineering', value: 's1' })
    })
  })

  describe('getInvoicesDictionary', () => {
    it('returns invoices', async () => {
      mock.onGet(`${PROD_API}/invoices`).reply({ data: [{ id: 'inv_1', total: 4500, status: 'paid' }] })
      const result = await service.getInvoicesDictionary({})
      expect(result.items[0]).toMatchObject({ value: 'inv_1' })
    })
  })

  describe('getImmigrationCasesDictionary', () => {
    it('returns cases', async () => {
      mock.onGet(`${PROD_API}/immigration/client/cases`).reply({ data: [{ id: 'imm_1', status: 'in_progress' }] })
      const result = await service.getImmigrationCasesDictionary({})
      expect(result.items[0]).toMatchObject({ value: 'imm_1' })
    })
  })

  describe('getTimeOffRequestsDictionary', () => {
    it('returns time off requests', async () => {
      mock.onGet(`${PROD_API}/time_offs`).reply({ data: [{ id: 'to_1', status: 'pending' }] })
      const result = await service.getTimeOffRequestsDictionary({})
      expect(result.items[0]).toMatchObject({ value: 'to_1' })
    })
  })

  describe('getATSCandidatesDictionary', () => {
    it('returns candidates', async () => {
      mock.onGet(`${PROD_API}/ats/candidates`).reply({ data: [{ id: 'cand_1', first_name: 'Jane', last_name: 'Doe' }] })
      const result = await service.getATSCandidatesDictionary({})
      expect(result.items[0]).toMatchObject({ value: 'cand_1' })
    })
  })

  describe('getATSApplicationsDictionary', () => {
    it('returns applications', async () => {
      mock.onGet(`${PROD_API}/ats/applications`).reply({ data: [{ id: 'app_1', candidate_id: 'cand_1' }] })
      const result = await service.getATSApplicationsDictionary({})
      expect(result.items[0]).toMatchObject({ value: 'app_1' })
    })
  })

  describe('getTasksDictionary', () => {
    it('returns empty when no contractId', async () => {
      const result = await service.getTasksDictionary({})
      expect(result).toEqual({ items: [] })
    })
  })

  describe('getTimesheetsDictionary', () => {
    it('returns empty when no contractId', async () => {
      const result = await service.getTimesheetsDictionary({})
      expect(result).toEqual({ items: [] })
    })
  })

  describe('getInvoiceAdjustmentsDictionary', () => {
    it('returns empty when no contractId', async () => {
      const result = await service.getInvoiceAdjustmentsDictionary({})
      expect(result).toEqual({ items: [] })
    })
  })

  describe('getAdjustmentsDictionary', () => {
    it('returns empty when no contractId', async () => {
      const result = await service.getAdjustmentsDictionary({})
      expect(result).toEqual({ items: [] })
    })
  })

  describe('getPayrollCyclesDictionary', () => {
    it('returns empty when no legalEntityId', async () => {
      const result = await service.getPayrollCyclesDictionary({})
      expect(result).toEqual({ items: [] })
    })
  })

  describe('getShiftsDictionary', () => {
    it('returns empty when no contractId', async () => {
      const result = await service.getShiftsDictionary({})
      expect(result).toEqual({ items: [] })
    })
  })

  describe('getPayslipsDictionary', () => {
    it('returns empty when no workerId', async () => {
      const result = await service.getPayslipsDictionary({})
      expect(result).toEqual({ items: [] })
    })
  })

  describe('getCustomFieldResourcesDictionary', () => {
    it('returns empty when no scope', async () => {
      const result = await service.getCustomFieldResourcesDictionary({})
      expect(result).toEqual({ items: [] })
    })
  })

  // ── Untested HRIS ──

  describe('updateOrgStructure', () => {
    it('sends PATCH with name and teams', async () => {
      mock.onPatch(`${PROD_API}/hris/organization_structures/s1`).reply({ data: {} })
      await service.updateOrgStructure('s1', 'New Name', 'parent_1')
      expect(mock.history[0].body).toMatchObject({ data: { name: 'New Name', teams: [{ name: 'New Name' }], parent_id: 'parent_1' } })
    })
  })

  // ── Untested Contracts ──

  describe('previewContractAgreement', () => {
    it('sends GET to preview path', async () => {
      mock.onGet(`${PROD_API}/contracts/c1/preview`).reply({ data: {} })
      await service.previewContractAgreement('c1')
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('getWorkerInviteLink', () => {
    it('sends GET to invite path', async () => {
      mock.onGet(`${PROD_API}/contracts/c1/invite`).reply({ data: { invite_link: 'https://app.deel.com/onboarding/abc' } })
      const result = await service.getWorkerInviteLink('c1')
      expect(result.data.invite_link).toContain('deel.com')
    })
  })

  describe('listAmendments', () => {
    it('sends GET to amendments path', async () => {
      mock.onGet(`${PROD_API}/contracts/c1/amendments`).reply({ data: [] })
      await service.listAmendments('c1')
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('listMilestones', () => {
    it('sends GET to milestones path', async () => {
      mock.onGet(`${PROD_API}/contracts/c1/milestones`).reply({ data: [] })
      await service.listMilestones('c1')
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('listTasks', () => {
    it('sends GET to tasks path', async () => {
      mock.onGet(`${PROD_API}/contracts/c1/tasks`).reply({ data: [] })
      await service.listTasks('c1')
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('updateTimesheetEntry', () => {
    it('sends PATCH with updated fields', async () => {
      mock.onPatch(`${PROD_API}/timesheets/ts_1`).reply({ data: {} })
      await service.updateTimesheetEntry(null, 'ts_1', 7, '2026-07-16', 'Updated')
      expect(mock.history[0].body).toMatchObject({ data: { quantity: 7, date_submitted: '2026-07-16', description: 'Updated' } })
    })
  })

  describe('reviewInvoiceAdjustment', () => {
    it('approves an invoice adjustment', async () => {
      mock.onPost(`${PROD_API}/invoice-adjustments/adj_1/reviews`).reply({ data: {} })
      await service.reviewInvoiceAdjustment(null, 'adj_1', 'Approve')
      expect(mock.history[0].body).toEqual({ data: { status: 'approved', reason: 'Approved' } })
    })
  })

  describe('listOffCyclePayments', () => {
    it('sends GET to off-cycle-payments path', async () => {
      mock.onGet(`${PROD_API}/contracts/c1/off-cycle-payments`).reply({ data: [] })
      await service.listOffCyclePayments('c1')
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Untested EOR ──

  describe('getEORStartDate', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${PROD_API}/eor/start-date`).reply({ data: { earliest: '2026-09-01' } })
      await service.getEORStartDate('DE', 'team_1', 'DE', false)
      expect(mock.history[0].query).toMatchObject({ employment_country: 'DE', team_id: 'team_1' })
    })
  })

  describe('listEORBenefits', () => {
    it('sends GET to benefits path', async () => {
      mock.onGet(`${PROD_API}/eor/c1/benefits`).reply({ data: [] })
      await service.listEORBenefits('c1')
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('listJobScopeTemplates', () => {
    it('sends GET with team filter', async () => {
      mock.onGet(`${PROD_API}/eor/job-scopes`).reply({ data: [] })
      await service.listJobScopeTemplates('team_1')
      expect(mock.history[0].query).toMatchObject({ team: 'team_1' })
    })
  })

  describe('validateJobScope', () => {
    it('sends POST with scope data', async () => {
      mock.onPost(`${PROD_API}/eor/job-scopes/validate`).reply({ data: { valid: true } })
      await service.validateJobScope('DE', 'Engineer', 'Build stuff', 'team_1', 'le_1', 'Jane')
      expect(mock.history[0].body).toMatchObject({ data: { employment_country: 'DE', job_title: 'Engineer' } })
    })
  })

  describe('createEORContract', () => {
    it('sends POST with EOR contract data', async () => {
      mock.onPost(`${PROD_API}/eor`).reply({ data: { id: 'eor_new' } })
      await service.createEORContract('Jane', 'Doe', 'jane@acme.com', 'DE', 'DE', 'le_1', 'team_1', 'Engineer', '5', 75000, 'EUR', '2026-08-01', 'Build software')
      const body = mock.history[0].body.data
      expect(body.employee).toMatchObject({ first_name: 'Jane', last_name: 'Doe', email: 'jane@acme.com' })
      expect(body.compensation_details).toMatchObject({ salary: 75000, currency: 'EUR' })
    })
  })

  describe('signEORContract', () => {
    it('sends POST to sign endpoint', async () => {
      mock.onPost(`${PROD_API}/eor/contracts/c1/documents/FRAMEWORK_AGREEMENT/sign`).reply({ data: {} })
      await service.signEORContract('c1', 'Jane Doe', 'CEO')
      expect(mock.history[0].body).toEqual({ data: { signature: 'Jane Doe', client_job_title: 'CEO' } })
    })
  })

  describe('fetchEORContractDocument', () => {
    it('sends GET to hrx-documents path', async () => {
      mock.onGet(`${PROD_API}/eor/contracts/c1/hrx-documents`).reply({ data: {} })
      await service.fetchEORContractDocument('c1')
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('requestEORTermination', () => {
    it('sends POST with termination data', async () => {
      mock.onPost(`${PROD_API}/eor/c1/terminations/regular`).reply({ data: {} })
      await service.requestEORTermination('c1', '2026-08-01', 'Performance', 'x'.repeat(100))
      expect(mock.history[0].body.data).toMatchObject({ reason: 'PERFORMANCE', desired_end_date: '2026-08-01' })
    })
  })

  describe('getTerminationDetails', () => {
    it('sends GET to terminations path', async () => {
      mock.onGet(`${PROD_API}/eor/c1/terminations`).reply({ data: {} })
      await service.getTerminationDetails('c1')
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('listEORPayslips', () => {
    it('sends GET with date filters', async () => {
      mock.onGet(`${PROD_API}/eor/c1/payslips`).reply({ data: [] })
      await service.listEORPayslips('c1', '2026-01-01', '2026-12-31')
      expect(mock.history[0].query).toMatchObject({ from: '2026-01-01', to: '2026-12-31' })
    })
  })

  describe('downloadPayslipPDF', () => {
    it('sends GET to download path', async () => {
      mock.onGet(`${PROD_API}/payslips/ps_1/download`).reply({ data: { url: 'https://deel.com/ps.pdf' } })
      await service.downloadPayslipPDF('w1', 'ps_1')
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('listEmployeeComplianceDocs', () => {
    it('sends GET to compliance-documents path', async () => {
      mock.onGet(`${PROD_API}/people/w1/compliance-documents`).reply({ data: [] })
      await service.listEmployeeComplianceDocs('w1')
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Untested Time Off ──

  describe('updateTimeOffRequest', () => {
    it('sends PATCH with updated fields', async () => {
      mock.onPatch(`${PROD_API}/time_offs/to_1`).reply({ data: {} })
      await service.updateTimeOffRequest('to_1', '2026-07-02', '2026-07-06', 'Extended')
      expect(mock.history[0].body).toMatchObject({ data: { start_date: '2026-07-02', end_date: '2026-07-06', reason: 'Extended' } })
    })
  })

  describe('listTimeOffPolicies', () => {
    it('sends GET to policies path', async () => {
      mock.onGet(`${PROD_API}/time_offs/profile/per_1/policies`).reply({ data: [] })
      await service.listTimeOffPolicies('per_1')
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('getEntitlements', () => {
    it('sends GET to entitlements path', async () => {
      mock.onGet(`${PROD_API}/time_offs/profile/per_1/entitlements`).reply({ data: [] })
      await service.getEntitlements('per_1')
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('getWorkScheduleAndHolidays', () => {
    it('sends GET with date window', async () => {
      mock.onGet(`${PROD_API}/time_offs/dailies`).reply({ data: [] })
      await service.getWorkScheduleAndHolidays('per_1', '2026-07-01', '2026-09-30')
      expect(mock.history[0].query).toMatchObject({ 'hris_profile_ids[]': 'per_1', start_date: '2026-07-01', end_date: '2026-09-30' })
    })
  })

  // ── Untested Adjustments ──

  describe('getAdjustment', () => {
    it('sends GET to adjustment path', async () => {
      mock.onGet(`${PROD_API}/adjustments/adj_1`).reply({ data: { id: 'adj_1' } })
      const result = await service.getAdjustment(null, 'adj_1')
      expect(result.data.id).toBe('adj_1')
    })
  })

  // ── Untested GP ──

  describe('updateGPEmployeeInfo', () => {
    it('sends PATCH with updated fields', async () => {
      mock.onPatch(`${PROD_API}/gp/workers/w1`).reply({ data: {} })
      await service.updateGPEmployeeInfo('w1', 'Jane', 'Doe', 'jane@acme.com', '+1555')
      expect(mock.history[0].body).toMatchObject({ data: { first_name: 'Jane', last_name: 'Doe', email: 'jane@acme.com', phone: '+1555' } })
    })
  })

  describe('updateGPAddress', () => {
    it('sends PATCH with address data', async () => {
      mock.onPatch(`${PROD_API}/gp/workers/w1/address`).reply({ data: {} })
      await service.updateGPAddress('w1', '123 Main St', 'Berlin', null, '10115', 'DE')
      expect(mock.history[0].body).toMatchObject({ data: { street: '123 Main St', city: 'Berlin', postal_code: '10115', country: 'DE' } })
    })
  })

  describe('listPayrollCycles', () => {
    it('sends GET to cycles path', async () => {
      mock.onGet(`${PROD_API}/gp/legal-entities/le_1/cycles`).reply({ data: [] })
      await service.listPayrollCycles('le_1')
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('getGrossToNetReport', () => {
    it('sends GET to report path', async () => {
      mock.onGet(`${PROD_API}/gp/reports/gross-to-net/cyc_1`).reply({ data: [] })
      await service.getGrossToNetReport('le_1', 'cyc_1')
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('createShifts', () => {
    it('sends POST with shifts data', async () => {
      mock.onPost(`${PROD_API}/time_tracking/shifts`).reply({ data: { created: 1 } })
      const shifts = [{ external_id: 'sh-1', date_of_work: '2026-07-20', description: 'Regular' }]
      await service.createShifts('c1', shifts)
      expect(mock.history[0].body).toEqual({ data: { contract_id: 'c1', shifts } })
    })
  })

  // ── Untested ATS ──

  describe('getJob', () => {
    it('sends GET to job path', async () => {
      mock.onGet(`${PROD_API}/ats/jobs/job_1`).reply({ data: { id: 'job_1' } })
      await service.getJob('job_1')
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('listCandidates', () => {
    it('sends GET with filters', async () => {
      mock.onGet(`${PROD_API}/ats/candidates`).reply({ data: [] })
      await service.listCandidates('job_1', 'Jane', 10)
      expect(mock.history[0].query).toMatchObject({ job_id: 'job_1', search: 'Jane', limit: 10 })
    })
  })

  describe('addCandidateTags', () => {
    it('sends POST with tags', async () => {
      mock.onPost(`${PROD_API}/ats/candidates/cand_1/tags`).reply({ data: {} })
      await service.addCandidateTags('cand_1', ['Top Pick', 'Referral'])
      expect(mock.history[0].body).toEqual({ data: { tags: ['Top Pick', 'Referral'] } })
    })
  })

  describe('listApplications', () => {
    it('sends GET with filters', async () => {
      mock.onGet(`${PROD_API}/ats/applications`).reply({ data: [] })
      await service.listApplications('job_1', 'cand_1')
      expect(mock.history[0].query).toMatchObject({ job_id: 'job_1', candidate_id: 'cand_1' })
    })
  })

  describe('getApplication', () => {
    it('sends GET to application path', async () => {
      mock.onGet(`${PROD_API}/ats/applications/app_1`).reply({ data: { id: 'app_1' } })
      await service.getApplication('app_1')
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('listOffers', () => {
    it('sends GET with job filter', async () => {
      mock.onGet(`${PROD_API}/ats/offers`).reply({ data: [] })
      await service.listOffers('job_1')
      expect(mock.history[0].query).toMatchObject({ job_id: 'job_1' })
    })
  })

  // ── Untested Immigration / Niche ──

  describe('getVisaTypes', () => {
    it('sends GET to visa-types path', async () => {
      mock.onGet(`${PROD_API}/immigration/visa-types/DE`).reply({ data: [] })
      await service.getVisaTypes('DE')
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('listImmigrationCases', () => {
    it('sends GET with worker filter', async () => {
      mock.onGet(`${PROD_API}/immigration/client/cases`).reply({ data: [] })
      await service.listImmigrationCases('w1')
      expect(mock.history[0].query).toMatchObject({ worker_id: 'w1' })
    })
  })

  describe('getImmigrationCase', () => {
    it('sends GET to case path', async () => {
      mock.onGet(`${PROD_API}/immigration/client/cases/imm_1`).reply({ data: {} })
      await service.getImmigrationCase('imm_1')
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('listITOrders', () => {
    it('sends GET with worker filter', async () => {
      mock.onGet(`${PROD_API}/it/orders`).reply({ data: [] })
      await service.listITOrders('w1')
      expect(mock.history[0].query).toMatchObject({ worker_id: 'w1' })
    })
  })

  describe('listITAssets', () => {
    it('sends GET with worker filter', async () => {
      mock.onGet(`${PROD_API}/it/assets`).reply({ data: [] })
      await service.listITAssets('w1')
      expect(mock.history[0].query).toMatchObject({ worker_id: 'w1' })
    })
  })

  describe('listITHardwarePolicies', () => {
    it('sends GET to policies path', async () => {
      mock.onGet(`${PROD_API}/it/policies`).reply({ data: [] })
      await service.listITHardwarePolicies()
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('getCountryHiringGuide', () => {
    it('sends GET to country guide path', async () => {
      mock.onGet(`${PROD_API}/knowledge-hub/country-guide/DE`).reply({ data: {} })
      await service.getCountryHiringGuide('DE')
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Untested Invoices / Misc ──

  describe('downloadInvoicePDF', () => {
    it('sends GET to download path', async () => {
      mock.onGet(`${PROD_API}/invoices/inv_1/download`).reply({ data: { url: 'https://deel.com/inv.pdf' } })
      await service.downloadInvoicePDF('inv_1')
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('listRefundStatements', () => {
    it('sends GET to refund-statements', async () => {
      mock.onGet(`${PROD_API}/refund-statements`).reply({ data: [] })
      await service.listRefundStatements()
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('listManagers', () => {
    it('sends GET to managers', async () => {
      mock.onGet(`${PROD_API}/managers`).reply({ data: [] })
      await service.listManagers()
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Untested Trigger: handleTriggerResolveEvents ──

  describe('handleTriggerResolveEvents', () => {
    it('returns null when body has no data', async () => {
      const result = await service.handleTriggerResolveEvents({ body: {} })
      expect(result).toBeNull()
    })

    it('throws when secret is missing', async () => {
      await expect(service.handleTriggerResolveEvents({
        body: { data: { meta: {}, resource: {} } },
        headers: { 'x-deel-signature': 'abc' },
      })).rejects.toThrow(/secret/)
    })

    it('throws when signature header is missing', async () => {
      await expect(service.handleTriggerResolveEvents({
        body: { data: { meta: {}, resource: {} } },
        webhookData: { secret: 'sec' },
        headers: {},
      })).rejects.toThrow(/signature/)
    })

    it('verifies valid HMAC and returns event', async () => {
      const crypto = require('crypto')
      const secret = 'test-secret'
      const rawBody = JSON.stringify({ data: { meta: { event_type: 'contract.signed', event_id: 'e1', occurred_at: '2026-07-20', organization_id: 'org_1' }, resource: { id: 'c1' } } })
      const sig = crypto.createHmac('sha256', secret).update(`POST${rawBody}`).digest('hex')

      const result = await service.handleTriggerResolveEvents({
        body: JSON.parse(rawBody),
        rawBody,
        headers: { 'x-deel-signature': sig },
        webhookData: { secret },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].data.eventType).toBe('contract.signed')
      expect(result.eventScopeId).toBe('org_1')
    })

    it('throws on invalid signature', async () => {
      const rawBody = JSON.stringify({ data: { meta: {}, resource: {} } })

      await expect(service.handleTriggerResolveEvents({
        body: JSON.parse(rawBody),
        rawBody,
        headers: { 'x-deel-signature': 'invalid-signature-value-here-00' },
        webhookData: { secret: 'sec' },
      })).rejects.toThrow()
    })
  })
})
