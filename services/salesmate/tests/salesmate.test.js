'use strict'

const { createSandbox } = require('../../../service-sandbox')

const LINKNAME = 'acme'
const ACCESS_TOKEN = 'test-access-token'
const HOST = `${ LINKNAME }.salesmate.io`
const BASE = `https://${ HOST }/apis/core/v4`

const AUTH_HEADERS = {
  accessToken: ACCESS_TOKEN,
  'x-linkname': HOST,
  'Content-Type': 'application/json',
}

describe('Salesmate Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ linkname: LINKNAME, accessToken: ACCESS_TOKEN })
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

  // ── Registration & construction ──

  describe('service registration', () => {
    it('registers the required config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['linkname', 'accessToken'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'linkname', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'accessToken', required: true, shared: false, type: 'STRING' }),
        ])
      )
    })

    it('stores the workspace name and access token', () => {
      expect(service.linkname).toBe(LINKNAME)
      expect(service.accessToken).toBe(ACCESS_TOKEN)
    })

    it('accepts a full workspace host without appending the salesmate.io suffix', async () => {
      const hosted = new service.constructor({ linkname: 'acme.eu.salesmate.io', accessToken: ACCESS_TOKEN })

      mock.onGet('https://acme.eu.salesmate.io/apis/core/v4/contacts/1').reply({ Data: { id: 1 } })

      await hosted.getContact(1)

      expect(mock.history[0].url).toBe('https://acme.eu.salesmate.io/apis/core/v4/contacts/1')
      expect(mock.history[0].headers['x-linkname']).toBe('acme.eu.salesmate.io')
    })
  })

  // ── Request plumbing ──

  describe('request plumbing', () => {
    it('sends the auth headers on every call and unwraps the Data envelope', async () => {
      mock.onGet(`${ BASE }/contacts/101`).reply({ Data: { id: 101, name: 'Jane Doe' }, status: 'success' })

      const result = await service.getContact(101)

      expect(result).toEqual({ id: 101, name: 'Jane Doe' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toEqual(AUTH_HEADERS)
      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].body).toBeUndefined()
    })

    it('returns the raw response when there is no Data envelope', async () => {
      mock.onGet(`${ BASE }/contacts/102`).reply({ id: 102 })

      await expect(service.getContact(102)).resolves.toEqual({ id: 102 })
    })

    it('surfaces the nested Error.message from a failed response', async () => {
      mock.onGet(`${ BASE }/contacts/103`).replyWithError({
        message: 'Request failed',
        status: 404,
        body: { Error: { message: 'Contact not found' } },
      })

      await expect(service.getContact(103)).rejects.toThrow('Salesmate API error: Contact not found')
    })

    it('falls back to a string Error body', async () => {
      mock.onGet(`${ BASE }/contacts/104`).replyWithError({
        message: 'Request failed',
        body: { Error: 'Invalid token' },
      })

      await expect(service.getContact(104)).rejects.toThrow('Salesmate API error: Invalid token')
    })

    it('falls back to body.message', async () => {
      mock.onGet(`${ BASE }/contacts/105`).replyWithError({
        message: 'Request failed',
        body: { message: 'Rate limited' },
      })

      await expect(service.getContact(105)).rejects.toThrow('Salesmate API error: Rate limited')
    })

    it('falls back to the transport error message', async () => {
      mock.onGet(`${ BASE }/contacts/106`).replyWithError({ message: 'socket hang up' })

      await expect(service.getContact(106)).rejects.toThrow('Salesmate API error: socket hang up')
    })
  })

  // ── Contacts ──

  describe('createContact', () => {
    it('posts only the provided fields', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ Data: { id: 101 } })

      const result = await service.createContact('Jane Doe', 'jane@acme.com', '+15551234567')

      expect(result).toEqual({ id: 101 })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/contacts`)

      expect(mock.history[0].body).toEqual({
        name: 'Jane Doe',
        email: 'jane@acme.com',
        mobile: '+15551234567',
      })
    })

    it('merges additional fields and drops empty values', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ Data: { id: 102 } })

      await service.createContact('Jane Doe', '', null, undefined, 'CTO', 'Acme', 5, { tags: ['vip'] })

      expect(mock.history[0].body).toEqual({
        name: 'Jane Doe',
        designation: 'CTO',
        companyName: 'Acme',
        owner: 5,
        tags: ['vip'],
      })
    })
  })

  describe('listContacts', () => {
    it('builds the default paging body', async () => {
      mock.onPost(`${ BASE }/contacts/search`).reply({ Data: { data: [], totalRows: 0 } })

      const result = await service.listContacts()

      expect(result).toEqual({ data: [], totalRows: 0 })

      expect(mock.history[0].body).toEqual({
        fields: ['name', 'email', 'mobile', 'owner'],
        pageNo: 1,
        rows: 25,
      })
    })

    it('maps the sort order label and honours explicit paging', async () => {
      mock.onPost(`${ BASE }/contacts/search`).reply({ Data: { data: [], totalRows: 0 } })

      await service.listContacts('acme', ['name'], 'createdAt', 'Ascending', 3, 50)

      expect(mock.history[0].body).toEqual({
        query: 'acme',
        fields: ['name'],
        sortBy: 'createdAt',
        sortOrder: 'asc',
        pageNo: 3,
        rows: 50,
      })
    })

    it('passes an unmapped sort order through unchanged', async () => {
      mock.onPost(`${ BASE }/contacts/search`).reply({ Data: {} })

      await service.listContacts(undefined, [], undefined, 'desc')

      expect(mock.history[0].body.sortOrder).toBe('desc')
      expect(mock.history[0].body.fields).toEqual(['name', 'email', 'mobile', 'owner'])
    })
  })

  describe('updateContact', () => {
    it('puts only the changed fields', async () => {
      mock.onPut(`${ BASE }/contacts/101`).reply({ Data: { id: 101 } })

      const result = await service.updateContact(101, 'Jane A. Doe', undefined, undefined, undefined, 6, { title: 'CEO' })

      expect(result).toEqual({ id: 101 })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ name: 'Jane A. Doe', owner: 6, title: 'CEO' })
    })
  })

  describe('deleteContact', () => {
    it('deletes and returns a confirmation object', async () => {
      mock.onDelete(`${ BASE }/contacts/101`).reply({ Data: null })

      const result = await service.deleteContact(101)

      expect(result).toEqual({ deleted: true, id: 101 })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  // ── Companies ──

  describe('companies', () => {
    it('creates a company with only the provided fields', async () => {
      mock.onPost(`${ BASE }/companies`).reply({ Data: { id: 301 } })

      const result = await service.createCompany('Acme Inc', undefined, undefined, 'https://acme.com', 5, { industry: 'SaaS' })

      expect(result).toEqual({ id: 301 })

      expect(mock.history[0].body).toEqual({
        name: 'Acme Inc',
        website: 'https://acme.com',
        owner: 5,
        industry: 'SaaS',
      })
    })

    it('gets a company by id', async () => {
      mock.onGet(`${ BASE }/companies/301`).reply({ Data: { id: 301 } })

      await expect(service.getCompany(301)).resolves.toEqual({ id: 301 })
      expect(mock.history[0].url).toBe(`${ BASE }/companies/301`)
    })

    it('lists companies with default fields', async () => {
      mock.onPost(`${ BASE }/companies/search`).reply({ Data: { data: [], totalRows: 0 } })

      await service.listCompanies()

      expect(mock.history[0].body).toEqual({
        fields: ['name', 'website', 'owner'],
        pageNo: 1,
        rows: 25,
      })
    })

    it('updates a company', async () => {
      mock.onPut(`${ BASE }/companies/301`).reply({ Data: { id: 301 } })

      await service.updateCompany(301, 'Acme Corporation', null, '', 'https://acme.io', 6)

      expect(mock.history[0].body).toEqual({ name: 'Acme Corporation', website: 'https://acme.io', owner: 6 })
    })

    it('deletes a company', async () => {
      mock.onDelete(`${ BASE }/companies/301`).reply({ Data: null })

      await expect(service.deleteCompany(301)).resolves.toEqual({ deleted: true, id: 301 })
    })
  })

  // ── Deals ──

  describe('deals', () => {
    it('creates a deal', async () => {
      mock.onPost(`${ BASE }/deals`).reply({ Data: { id: 501 } })

      const result = await service.createDeal('Website redesign', 1, 2, 12000, 101, 301, 5, { source: 'inbound' })

      expect(result).toEqual({ id: 501 })

      expect(mock.history[0].body).toEqual({
        title: 'Website redesign',
        pipeline: 1,
        stage: 2,
        dealValue: 12000,
        primaryContact: 101,
        primaryCompany: 301,
        owner: 5,
        source: 'inbound',
      })
    })

    it('gets a deal by id', async () => {
      mock.onGet(`${ BASE }/deals/501`).reply({ Data: { id: 501 } })

      await expect(service.getDeal(501)).resolves.toEqual({ id: 501 })
    })

    it('lists deals with default fields', async () => {
      mock.onPost(`${ BASE }/deals/search`).reply({ Data: { data: [], totalRows: 0 } })

      await service.listDeals()

      expect(mock.history[0].body).toEqual({
        fields: ['title', 'dealValue', 'stage', 'owner'],
        pageNo: 1,
        rows: 25,
      })
    })

    it('maps the status label when updating a deal', async () => {
      mock.onPut(`${ BASE }/deals/501`).reply({ Data: { id: 501 } })

      await service.updateDeal(501, 'Website redesign', 3, 15000, 'Won', 6)

      expect(mock.history[0].body).toEqual({
        title: 'Website redesign',
        stage: 3,
        dealValue: 15000,
        status: 'won',
        owner: 6,
      })
    })

    it('passes an unmapped status through unchanged and omits it when absent', async () => {
      mock.onPut(`${ BASE }/deals/502`).reply({ Data: {} })

      await service.updateDeal(502, undefined, undefined, undefined, 'on_hold')

      expect(mock.history[0].body).toEqual({ status: 'on_hold' })

      mock.reset()
      mock.onPut(`${ BASE }/deals/503`).reply({ Data: {} })

      await service.updateDeal(503, 'Renamed')

      expect(mock.history[0].body).toEqual({ title: 'Renamed' })
    })

    it('deletes a deal', async () => {
      mock.onDelete(`${ BASE }/deals/501`).reply({ Data: null })

      await expect(service.deleteDeal(501)).resolves.toEqual({ deleted: true, id: 501 })
    })
  })

  // ── Activities ──

  describe('activities', () => {
    it('creates an activity with a mapped type', async () => {
      mock.onPost(`${ BASE }/activities`).reply({ Data: { id: 701 } })

      const result = await service.createActivity('Discovery call', 'Call', '2026-02-01T15:00:00Z', 5, { priority: 'High' })

      expect(result).toEqual({ id: 701 })

      expect(mock.history[0].body).toEqual({
        title: 'Discovery call',
        type: 'Call',
        dueDate: '2026-02-01T15:00:00Z',
        owner: 5,
        priority: 'High',
      })
    })

    it('passes an unmapped activity type through unchanged', async () => {
      mock.onPost(`${ BASE }/activities`).reply({ Data: {} })

      await service.createActivity('Custom', 'Webinar')

      expect(mock.history[0].body).toEqual({ title: 'Custom', type: 'Webinar' })
    })

    it('lists activities with default fields', async () => {
      mock.onPost(`${ BASE }/activities/search`).reply({ Data: { data: [], totalRows: 0 } })

      await service.listActivities()

      expect(mock.history[0].body).toEqual({
        fields: ['title', 'type', 'dueDate', 'owner'],
        pageNo: 1,
        rows: 25,
      })
    })
  })

  // ── Dictionaries ──

  describe('getUsersDictionary', () => {
    it('maps active users to dictionary items', async () => {
      mock.onGet(`${ BASE }/users/active`).reply({
        Data: [
          { id: 5, name: 'Sam Rep', email: 'sam@acme.com', role: 'Sales Rep' },
          { id: 6, name: 'Ada Boss', designation: 'Manager' },
        ],
      })

      const result = await service.getUsersDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Sam Rep (sam@acme.com)', value: '5', note: 'Sales Rep' },
          { label: 'Ada Boss', value: '6', note: 'Manager' },
        ],
        cursor: null,
      })
    })

    it('filters users case-insensitively by name or email', async () => {
      mock.onGet(`${ BASE }/users/active`).reply({
        Data: [
          { id: 5, name: 'Sam Rep', email: 'sam@acme.com' },
          { id: 6, name: 'Ada Boss', email: 'ada@acme.com' },
        ],
      })

      const result = await service.getUsersDictionary({ search: 'ADA@' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('6')
    })

    it('reads users from a data property and handles a null payload', async () => {
      mock.onGet(`${ BASE }/users/active`).reply({ Data: { data: [{ id: 7, name: 'Zed' }] } })

      const result = await service.getUsersDictionary(null)

      expect(result).toEqual({ items: [{ label: 'Zed', value: '7', note: undefined }], cursor: null })
    })

    it('returns an empty list when there are no users', async () => {
      mock.onGet(`${ BASE }/users/active`).reply({ Data: null })

      await expect(service.getUsersDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getPipelinesDictionary', () => {
    it('maps pipelines to dictionary items', async () => {
      mock.onGet(`${ BASE }/pipelines`).reply({ Data: [{ id: 1, name: 'Sales Pipeline' }] })

      const result = await service.getPipelinesDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Sales Pipeline', value: '1', note: undefined }],
        cursor: null,
      })
    })

    it('filters pipelines by search text', async () => {
      mock.onGet(`${ BASE }/pipelines`).reply({
        Data: [{ id: 1, name: 'Sales Pipeline' }, { id: 2, name: 'Partner Pipeline' }],
      })

      const result = await service.getPipelinesDictionary({ search: 'partner' })

      expect(result.items).toEqual([{ label: 'Partner Pipeline', value: '2', note: undefined }])
    })

    it('falls back to the id as the label and handles an empty payload', async () => {
      mock.onGet(`${ BASE }/pipelines`).reply({ Data: { data: [{ id: 9 }] } })

      const result = await service.getPipelinesDictionary()

      expect(result.items).toEqual([{ label: '9', value: '9', note: undefined }])
    })
  })

  describe('getStagesDictionary', () => {
    it('returns nothing when no pipeline criteria is provided', async () => {
      await expect(service.getStagesDictionary({})).resolves.toEqual({ items: [], cursor: null })
      await expect(service.getStagesDictionary(null)).resolves.toEqual({ items: [], cursor: null })
      await expect(service.getStagesDictionary({ criteria: { pipeline: '' } })).resolves.toEqual({ items: [], cursor: null })

      expect(mock.history).toHaveLength(0)
    })

    it('maps the stages of the selected pipeline', async () => {
      mock.onGet(`${ BASE }/pipelines`).reply({
        Data: [
          { id: 1, stages: [{ id: 2, name: 'Qualification' }, { id: 3, name: 'Proposal' }] },
          { id: 4, stages: [{ id: 5, name: 'Other' }] },
        ],
      })

      const result = await service.getStagesDictionary({ criteria: { pipeline: 1 } })

      expect(result).toEqual({
        items: [
          { label: 'Qualification', value: '2', note: 'Pipeline 1' },
          { label: 'Proposal', value: '3', note: 'Pipeline 1' },
        ],
        cursor: null,
      })
    })

    it('supports the dealStages alias and filters by search text', async () => {
      mock.onGet(`${ BASE }/pipelines`).reply({
        Data: [{ id: 1, dealStages: [{ id: 2, name: 'Qualification' }, { id: 3, name: 'Proposal' }] }],
      })

      const result = await service.getStagesDictionary({ search: 'propo', criteria: { pipeline: '1' } })

      expect(result.items).toEqual([{ label: 'Proposal', value: '3', note: 'Pipeline 1' }])
    })

    it('returns an empty list when the pipeline is unknown', async () => {
      mock.onGet(`${ BASE }/pipelines`).reply({ Data: [{ id: 1, stages: [{ id: 2, name: 'Qualification' }] }] })

      await expect(service.getStagesDictionary({ criteria: { pipeline: 99 } })).resolves.toEqual({ items: [], cursor: null })
    })
  })
})
