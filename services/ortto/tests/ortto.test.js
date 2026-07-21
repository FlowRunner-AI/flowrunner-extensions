'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-ortto-api-key'
const BASE = 'https://api.ap3api.com/v1'

describe('Ortto Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, region: 'Global (Default)' })
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
      const configItems = sandbox.getConfigItems()

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
          expect.objectContaining({ name: 'region', required: false, shared: false }),
        ])
      )
    })

    it('registers region as CHOICE type with correct options', () => {
      const configItems = sandbox.getConfigItems()
      const regionItem = configItems.find(c => c.name === 'region')

      expect(regionItem).toBeDefined()
      expect(regionItem.options).toEqual(['Global (Default)', 'Australia', 'Europe'])
      expect(regionItem.defaultValue).toBe('Global (Default)')
    })
  })

  // ── mergeOrCreatePerson ──

  describe('mergeOrCreatePerson', () => {
    it('sends correct request with email only', async () => {
      mock.onPost(`${BASE}/person/merge`).reply({ people: [{ person_id: 'abc123', status: 'merged' }] })

      const result = await service.mergeOrCreatePerson('jane@example.com')

      expect(result).toEqual({ people: [{ person_id: 'abc123', status: 'merged' }] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'X-Api-Key': API_KEY })
      expect(mock.history[0].body).toMatchObject({
        async: true,
        merge_by: ['str::email'],
        merge_strategy: 2,
        people: [{ fields: { 'str::email': 'jane@example.com' } }],
      })
    })

    it('includes all convenience fields', async () => {
      mock.onPost(`${BASE}/person/merge`).reply({ people: [{ person_id: 'abc123', status: 'merged' }] })

      await service.mergeOrCreatePerson('jane@example.com', 'Jane', 'Doe', '+14155552671')

      const body = mock.history[0].body
      expect(body.people[0].fields).toMatchObject({
        'str::email': 'jane@example.com',
        'str::first': 'Jane',
        'str::last': 'Doe',
        'phn::phone': { phone: '+14155552671', parse_with_country_code: true },
      })
    })

    it('merges rawFields on top of convenience fields', async () => {
      mock.onPost(`${BASE}/person/merge`).reply({ people: [{ person_id: 'abc123', status: 'merged' }] })

      await service.mergeOrCreatePerson('jane@example.com', 'Jane', null, null, { 'str:cm:company': 'Acme' })

      const fields = mock.history[0].body.people[0].fields
      expect(fields['str::email']).toBe('jane@example.com')
      expect(fields['str::first']).toBe('Jane')
      expect(fields['str:cm:company']).toBe('Acme')
      // null/empty fields should be omitted by clean()
      expect(fields).not.toHaveProperty('str::last')
      expect(fields).not.toHaveProperty('phn::phone')
    })

    it('resolves merge strategy from label - Append only', async () => {
      mock.onPost(`${BASE}/person/merge`).reply({ people: [] })

      await service.mergeOrCreatePerson('jane@example.com', null, null, null, null, 'Append only (keep existing values)')

      expect(mock.history[0].body.merge_strategy).toBe(1)
    })

    it('resolves merge strategy from label - Ignore', async () => {
      mock.onPost(`${BASE}/person/merge`).reply({ people: [] })

      await service.mergeOrCreatePerson('jane@example.com', null, null, null, null, 'Ignore (create only, never update)')

      expect(mock.history[0].body.merge_strategy).toBe(3)
    })

    it('defaults merge_strategy to 2 when not provided', async () => {
      mock.onPost(`${BASE}/person/merge`).reply({ people: [] })

      await service.mergeOrCreatePerson('jane@example.com')

      expect(mock.history[0].body.merge_strategy).toBe(2)
    })

    it('sets async to true by default', async () => {
      mock.onPost(`${BASE}/person/merge`).reply({ people: [] })

      await service.mergeOrCreatePerson('jane@example.com')

      expect(mock.history[0].body.async).toBe(true)
    })

    it('sets async to false when explicitly passed false', async () => {
      mock.onPost(`${BASE}/person/merge`).reply({ people: [] })

      await service.mergeOrCreatePerson('jane@example.com', null, null, null, null, null, false)

      expect(mock.history[0].body.async).toBe(false)
    })

    it('omits phone field when phone is empty string', async () => {
      mock.onPost(`${BASE}/person/merge`).reply({ people: [] })

      await service.mergeOrCreatePerson('jane@example.com', null, null, '')

      const fields = mock.history[0].body.people[0].fields
      expect(fields).not.toHaveProperty('phn::phone')
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/person/merge`).replyWithError({
        message: 'Bad Request',
        body: { error: 'Invalid email format' },
        status: 400,
      })

      await expect(service.mergeOrCreatePerson('bad')).rejects.toThrow('Ortto API error (400): Invalid email format')
    })
  })

  // ── getPeople ──

  describe('getPeople', () => {
    it('sends correct request with defaults', async () => {
      mock.onPost(`${BASE}/person/get`).reply({
        contacts: [{ id: '001', fields: { 'str::email': 'jane@example.com' } }],
        has_more: false,
      })

      const result = await service.getPeople()

      expect(result).toHaveProperty('contacts')
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toMatchObject({
        fields: ['str::email', 'str::first', 'str::last'],
        limit: 50,
        offset: 0,
      })
    })

    it('uses custom fields array', async () => {
      mock.onPost(`${BASE}/person/get`).reply({ contacts: [], has_more: false })

      await service.getPeople(['str::email', 'str:cm:company'])

      expect(mock.history[0].body.fields).toEqual(['str::email', 'str:cm:company'])
    })

    it('uses default fields when fields is empty array', async () => {
      mock.onPost(`${BASE}/person/get`).reply({ contacts: [], has_more: false })

      await service.getPeople([])

      expect(mock.history[0].body.fields).toEqual(['str::email', 'str::first', 'str::last'])
    })

    it('passes filter object', async () => {
      const filter = { '$str::is': { field_id: 'str::email', value: 'jane@example.com' } }
      mock.onPost(`${BASE}/person/get`).reply({ contacts: [], has_more: false })

      await service.getPeople(null, filter)

      expect(mock.history[0].body.filter).toEqual(filter)
    })

    it('resolves sort order Descending', async () => {
      mock.onPost(`${BASE}/person/get`).reply({ contacts: [], has_more: false })

      await service.getPeople(null, null, 'str::last', 'Descending')

      expect(mock.history[0].body.sort_by_field_id).toBe('str::last')
      expect(mock.history[0].body.sort_order).toBe('desc')
    })

    it('resolves sort order Ascending', async () => {
      mock.onPost(`${BASE}/person/get`).reply({ contacts: [], has_more: false })

      await service.getPeople(null, null, 'str::first', 'Ascending')

      expect(mock.history[0].body.sort_order).toBe('asc')
    })

    it('uses custom limit and offset', async () => {
      mock.onPost(`${BASE}/person/get`).reply({ contacts: [], has_more: false })

      await service.getPeople(null, null, null, null, 10, 20)

      expect(mock.history[0].body.limit).toBe(10)
      expect(mock.history[0].body.offset).toBe(20)
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/person/get`).replyWithError({
        message: 'Unauthorized',
        body: { message: 'Invalid API key' },
        status: 401,
      })

      await expect(service.getPeople()).rejects.toThrow('Ortto API error (401): Invalid API key')
    })
  })

  // ── getPersonByEmail ──

  describe('getPersonByEmail', () => {
    it('sends email filter and returns first contact', async () => {
      mock.onPost(`${BASE}/person/get`).reply({
        contacts: [{ id: '001', fields: { 'str::email': 'jane@example.com', 'str::first': 'Jane' } }],
      })

      const result = await service.getPersonByEmail('jane@example.com')

      expect(result).toEqual({
        contact: { id: '001', fields: { 'str::email': 'jane@example.com', 'str::first': 'Jane' } },
      })
      expect(mock.history[0].body).toMatchObject({
        filter: {
          '$str::is': { field_id: 'str::email', value: 'jane@example.com' },
        },
        limit: 1,
        offset: 0,
      })
    })

    it('uses custom fields when provided', async () => {
      mock.onPost(`${BASE}/person/get`).reply({ contacts: [{ id: '001' }] })

      await service.getPersonByEmail('jane@example.com', ['str::email', 'str:cm:company'])

      expect(mock.history[0].body.fields).toEqual(['str::email', 'str:cm:company'])
    })

    it('uses default fields when not provided', async () => {
      mock.onPost(`${BASE}/person/get`).reply({ contacts: [] })

      await service.getPersonByEmail('jane@example.com')

      expect(mock.history[0].body.fields).toEqual(['str::email', 'str::first', 'str::last'])
    })

    it('returns null contact when no match found', async () => {
      mock.onPost(`${BASE}/person/get`).reply({ contacts: [] })

      const result = await service.getPersonByEmail('nobody@example.com')

      expect(result).toEqual({ contact: null })
    })

    it('handles response with people key instead of contacts', async () => {
      mock.onPost(`${BASE}/person/get`).reply({
        people: [{ id: '002', fields: { 'str::email': 'alt@example.com' } }],
      })

      const result = await service.getPersonByEmail('alt@example.com')

      expect(result.contact).toEqual({ id: '002', fields: { 'str::email': 'alt@example.com' } })
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/person/get`).replyWithError({
        message: 'Server Error',
        status: 500,
      })

      await expect(service.getPersonByEmail('jane@example.com')).rejects.toThrow('Ortto API error (500): Server Error')
    })
  })

  // ── createCustomActivity ──

  describe('createCustomActivity', () => {
    it('sends correct request with required params', async () => {
      mock.onPost(`${BASE}/activities/create`).reply({
        activities: [{ person_id: 'abc123', status: 'ingested' }],
      })

      const result = await service.createCustomActivity(
        'act:cm:flight-booked',
        { 'str::email': 'jane@example.com' }
      )

      expect(result).toEqual({ activities: [{ person_id: 'abc123', status: 'ingested' }] })
      expect(mock.history[0].body).toEqual({
        activities: [
          {
            activity_id: 'act:cm:flight-booked',
            fields: { 'str::email': 'jane@example.com' },
            attributes: {},
          },
        ],
        merge_by: ['str::email'],
      })
    })

    it('includes attributes when provided', async () => {
      mock.onPost(`${BASE}/activities/create`).reply({ activities: [] })

      await service.createCustomActivity(
        'act:cm:purchase',
        { 'str::email': 'jane@example.com' },
        { 'int::v': 9900, 'str:cm:product': 'Widget' }
      )

      expect(mock.history[0].body.activities[0].attributes).toEqual({
        'int::v': 9900,
        'str:cm:product': 'Widget',
      })
    })

    it('uses custom mergeBy when provided', async () => {
      mock.onPost(`${BASE}/activities/create`).reply({ activities: [] })

      await service.createCustomActivity(
        'act:cm:login',
        { 'str::email': 'jane@example.com' },
        null,
        ['str::email', 'str::first']
      )

      expect(mock.history[0].body.merge_by).toEqual(['str::email', 'str::first'])
    })

    it('defaults mergeBy to email when not provided', async () => {
      mock.onPost(`${BASE}/activities/create`).reply({ activities: [] })

      await service.createCustomActivity('act:cm:test', { 'str::email': 'a@b.com' })

      expect(mock.history[0].body.merge_by).toEqual(['str::email'])
    })

    it('defaults personFields to empty object when null', async () => {
      mock.onPost(`${BASE}/activities/create`).reply({ activities: [] })

      await service.createCustomActivity('act:cm:test', null)

      expect(mock.history[0].body.activities[0].fields).toEqual({})
    })

    it('defaults attributes to empty object when null', async () => {
      mock.onPost(`${BASE}/activities/create`).reply({ activities: [] })

      await service.createCustomActivity('act:cm:test', { 'str::email': 'a@b.com' }, null)

      expect(mock.history[0].body.activities[0].attributes).toEqual({})
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/activities/create`).replyWithError({
        message: 'Bad Request',
        body: { error: 'Unknown activity_id' },
        status: 400,
      })

      await expect(
        service.createCustomActivity('act:cm:unknown', { 'str::email': 'a@b.com' })
      ).rejects.toThrow('Ortto API error (400): Unknown activity_id')
    })
  })

  // ── getCustomFields ──

  describe('getCustomFields', () => {
    it('sends POST with empty body and returns fields', async () => {
      const fieldsResponse = {
        fields: [
          { field: { id: 'str::company', name: 'Company', type: 'text' } },
          { field: { id: 'bol::subscribed', name: 'Subscribed', type: 'boolean' } },
        ],
      }
      mock.onPost(`${BASE}/person/custom-field/get`).reply(fieldsResponse)

      const result = await service.getCustomFields()

      expect(result).toEqual(fieldsResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'X-Api-Key': API_KEY })
      expect(mock.history[0].body).toEqual({})
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/person/custom-field/get`).replyWithError({
        message: 'Forbidden',
        status: 403,
      })

      await expect(service.getCustomFields()).rejects.toThrow('Ortto API error (403): Forbidden')
    })
  })

  // ── getFieldsDictionary ──

  describe('getFieldsDictionary', () => {
    const fieldsResponse = {
      fields: [
        { field: { id: 'str::email', name: 'Email', type: 'text' } },
        { field: { id: 'str::first', name: 'First Name', type: 'text' } },
        { field: { id: 'str:cm:company', name: 'Company', type: 'text' } },
      ],
    }

    it('returns mapped items with label and value', async () => {
      mock.onPost(`${BASE}/person/custom-field/get`).reply(fieldsResponse)

      const result = await service.getFieldsDictionary({})

      expect(result.items).toHaveLength(3)
      expect(result.items[0]).toEqual({ label: 'Email (str::email)', value: 'str::email', note: 'text' })
      expect(result.cursor).toBeNull()
    })

    it('filters by case-insensitive search on label', async () => {
      mock.onPost(`${BASE}/person/custom-field/get`).reply(fieldsResponse)

      const result = await service.getFieldsDictionary({ search: 'comp' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('str:cm:company')
    })

    it('filters by search on value (field id)', async () => {
      mock.onPost(`${BASE}/person/custom-field/get`).reply(fieldsResponse)

      const result = await service.getFieldsDictionary({ search: 'str::first' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('str::first')
    })

    it('handles null payload', async () => {
      mock.onPost(`${BASE}/person/custom-field/get`).reply(fieldsResponse)

      const result = await service.getFieldsDictionary(null)

      expect(result.items).toHaveLength(3)
      expect(result.cursor).toBeNull()
    })

    it('handles empty or null fields array', async () => {
      mock.onPost(`${BASE}/person/custom-field/get`).reply({ fields: null })

      const result = await service.getFieldsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles missing fields key in response', async () => {
      mock.onPost(`${BASE}/person/custom-field/get`).reply({})

      const result = await service.getFieldsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('skips entries without an id', async () => {
      mock.onPost(`${BASE}/person/custom-field/get`).reply({
        fields: [
          { field: { id: 'str::email', name: 'Email', type: 'text' } },
          { field: { name: 'NoId' } },
        ],
      })

      const result = await service.getFieldsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('str::email')
    })

    it('handles field_id fallback for id', async () => {
      mock.onPost(`${BASE}/person/custom-field/get`).reply({
        fields: [{ field: { field_id: 'str::alt', name: 'Alt Field', type: 'text' } }],
      })

      const result = await service.getFieldsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('str::alt')
      expect(result.items[0].label).toBe('Alt Field (str::alt)')
    })

    it('uses id as name fallback when name is missing', async () => {
      mock.onPost(`${BASE}/person/custom-field/get`).reply({
        fields: [{ field: { id: 'str::noname', type: 'text' } }],
      })

      const result = await service.getFieldsDictionary({})

      expect(result.items[0].label).toBe('str::noname (str::noname)')
    })

    it('handles entry without nested field object', async () => {
      mock.onPost(`${BASE}/person/custom-field/get`).reply({
        fields: [{ id: 'str::flat', name: 'Flat', type: 'text' }],
      })

      const result = await service.getFieldsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('str::flat')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('uses error.body.error when available', async () => {
      mock.onPost(`${BASE}/person/custom-field/get`).replyWithError({
        message: 'Fallback',
        body: { error: 'Specific error from body' },
        status: 422,
      })

      await expect(service.getCustomFields()).rejects.toThrow('Specific error from body')
    })

    it('uses error.body.message when error field is missing', async () => {
      mock.onPost(`${BASE}/person/custom-field/get`).replyWithError({
        message: 'Fallback',
        body: { message: 'Message from body' },
        status: 422,
      })

      await expect(service.getCustomFields()).rejects.toThrow('Message from body')
    })

    it('falls back to error.message when body has no error or message', async () => {
      mock.onPost(`${BASE}/person/custom-field/get`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.getCustomFields()).rejects.toThrow('Network timeout')
    })

    it('omits status from error when not present', async () => {
      mock.onPost(`${BASE}/person/custom-field/get`).replyWithError({
        message: 'Connection refused',
      })

      await expect(service.getCustomFields()).rejects.toThrow('Ortto API error: Connection refused')
    })

    it('uses statusCode as fallback for status', async () => {
      mock.onPost(`${BASE}/person/custom-field/get`).replyWithError({
        message: 'Bad Gateway',
        statusCode: 502,
      })

      await expect(service.getCustomFields()).rejects.toThrow('Ortto API error (502): Bad Gateway')
    })
  })
})
