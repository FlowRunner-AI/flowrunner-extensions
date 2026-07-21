'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key-123'
const BASE = 'https://actionnetwork.org/api/v2'

describe('Action Network Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── People ──

  describe('listPeople', () => {
    it('sends correct request with defaults', async () => {
      const responseData = { total_pages: 1, per_page: 25, page: 1, total_records: 0, _embedded: { 'osdi:people': [] } }
      mock.onGet(`${BASE}/people`).reply(responseData)

      const result = await service.listPeople()

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'OSDI-API-Token': API_KEY })
      expect(mock.history[0].query).toEqual({})
    })

    it('passes page and filter parameters', async () => {
      mock.onGet(`${BASE}/people`).reply({ total_pages: 1, page: 2 })

      await service.listPeople(2, "email_address eq 'test@example.com'")

      expect(mock.history[0].query).toMatchObject({
        page: 2,
        filter: "email_address eq 'test@example.com'",
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/people`).replyWithError({
        message: 'Unauthorized',
        status: 401,
      })

      await expect(service.listPeople()).rejects.toThrow('Action Network API error')
    })
  })

  describe('getPerson', () => {
    it('sends correct request', async () => {
      const personData = { identifiers: ['action_network:abc123'], given_name: 'John' }
      mock.onGet(`${BASE}/people/abc123`).reply(personData)

      const result = await service.getPerson('abc123')

      expect(result).toEqual(personData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${BASE}/people/abc123`)
      expect(mock.history[0].headers).toMatchObject({ 'OSDI-API-Token': API_KEY })
    })

    it('encodes personId in URL', async () => {
      mock.onGet(`${BASE}/people/id%20with%20spaces`).reply({ given_name: 'Test' })

      await service.getPerson('id with spaces')

      expect(mock.history[0].url).toBe(`${BASE}/people/id%20with%20spaces`)
    })
  })

  describe('upsertPerson', () => {
    it('sends POST with email only', async () => {
      const responseData = { identifiers: ['action_network:abc123'] }
      mock.onPost(`${BASE}/people`).reply(responseData)

      const result = await service.upsertPerson('test@example.com')

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({
        person: {
          email_addresses: [{ address: 'test@example.com' }],
        },
      })
    })

    it('includes all person fields when provided', async () => {
      mock.onPost(`${BASE}/people`).reply({ identifiers: ['action_network:abc123'] })

      await service.upsertPerson(
        'test@example.com',
        'John',
        'Smith',
        '12025551234',
        [{ postal_code: '20009', country: 'US' }],
        { occupation: 'teacher' },
      )

      expect(mock.history[0].body).toEqual({
        person: {
          given_name: 'John',
          family_name: 'Smith',
          email_addresses: [{ address: 'test@example.com' }],
          phone_numbers: [{ number: '12025551234' }],
          postal_addresses: [{ postal_code: '20009', country: 'US' }],
          custom_fields: { occupation: 'teacher' },
        },
      })
    })

    it('includes add_tags and remove_tags when provided as arrays', async () => {
      mock.onPost(`${BASE}/people`).reply({ identifiers: ['action_network:abc123'] })

      await service.upsertPerson(
        'test@example.com',
        undefined, undefined, undefined, undefined, undefined,
        ['Volunteers', 'Donors'],
        ['Old Tag'],
      )

      expect(mock.history[0].body).toMatchObject({
        add_tags: ['Volunteers', 'Donors'],
        remove_tags: ['Old Tag'],
      })
    })

    it('parses comma-separated tag strings', async () => {
      mock.onPost(`${BASE}/people`).reply({ identifiers: ['action_network:abc123'] })

      await service.upsertPerson(
        'test@example.com',
        undefined, undefined, undefined, undefined, undefined,
        'Volunteers, Donors',
        'Old Tag',
      )

      expect(mock.history[0].body).toMatchObject({
        add_tags: ['Volunteers', 'Donors'],
        remove_tags: ['Old Tag'],
      })
    })

    it('omits tags when not provided', async () => {
      mock.onPost(`${BASE}/people`).reply({ identifiers: ['action_network:abc123'] })

      await service.upsertPerson('test@example.com')

      expect(mock.history[0].body).not.toHaveProperty('add_tags')
      expect(mock.history[0].body).not.toHaveProperty('remove_tags')
    })

    it('sends phone number without email', async () => {
      mock.onPost(`${BASE}/people`).reply({ identifiers: ['action_network:abc123'] })

      await service.upsertPerson(undefined, 'Jane', undefined, '12025559999')

      const body = mock.history[0].body
      expect(body.person).not.toHaveProperty('email_addresses')
      expect(body.person.phone_numbers).toEqual([{ number: '12025559999' }])
      expect(body.person.given_name).toBe('Jane')
    })

    it('omits empty postal addresses', async () => {
      mock.onPost(`${BASE}/people`).reply({ identifiers: ['action_network:abc123'] })

      await service.upsertPerson('test@example.com', undefined, undefined, undefined, [])

      expect(mock.history[0].body.person).not.toHaveProperty('postal_addresses')
    })
  })

  describe('updatePerson', () => {
    it('sends PUT with person fields', async () => {
      const responseData = { identifiers: ['action_network:abc123'], given_name: 'Jane' }
      mock.onPut(`${BASE}/people/abc123`).reply(responseData)

      const result = await service.updatePerson('abc123', { given_name: 'Jane' })

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ given_name: 'Jane' })
    })

    it('sends empty object when personFields is null', async () => {
      mock.onPut(`${BASE}/people/abc123`).reply({ identifiers: ['action_network:abc123'] })

      await service.updatePerson('abc123', null)

      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Events ──

  describe('listEvents', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${BASE}/events`).reply({ total_pages: 1, _embedded: { 'osdi:events': [] } })

      await service.listEvents()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].headers).toMatchObject({ 'OSDI-API-Token': API_KEY })
    })

    it('passes page and filter', async () => {
      mock.onGet(`${BASE}/events`).reply({ total_pages: 1 })

      await service.listEvents(3, "modified_date gt '2023-01-01'")

      expect(mock.history[0].query).toMatchObject({ page: 3, filter: "modified_date gt '2023-01-01'" })
    })
  })

  describe('getEvent', () => {
    it('sends correct request', async () => {
      const eventData = { identifiers: ['action_network:evt123'], title: 'Meeting' }
      mock.onGet(`${BASE}/events/evt123`).reply(eventData)

      const result = await service.getEvent('evt123')

      expect(result).toEqual(eventData)
      expect(mock.history[0].url).toBe(`${BASE}/events/evt123`)
    })
  })

  describe('createEvent', () => {
    it('sends POST with required title only', async () => {
      const responseData = { identifiers: ['action_network:evt123'], title: 'Meeting' }
      mock.onPost(`${BASE}/events`).reply(responseData)

      const result = await service.createEvent('Meeting')

      expect(result).toEqual(responseData)
      expect(mock.history[0].body).toEqual({ title: 'Meeting' })
    })

    it('includes all optional fields when provided', async () => {
      mock.onPost(`${BASE}/events`).reply({ identifiers: ['action_network:evt123'] })

      const location = { venue: 'Town Hall', locality: 'Washington', region: 'DC' }
      await service.createEvent('Meeting', '2023-06-01T18:00:00Z', '<p>Join us.</p>', location)

      expect(mock.history[0].body).toEqual({
        title: 'Meeting',
        start_date: '2023-06-01T18:00:00Z',
        description: '<p>Join us.</p>',
        location,
      })
    })

    it('omits location when not provided', async () => {
      mock.onPost(`${BASE}/events`).reply({ identifiers: ['action_network:evt123'] })

      await service.createEvent('Meeting', '2023-06-01T18:00:00Z')

      expect(mock.history[0].body).not.toHaveProperty('location')
    })
  })

  // ── Action Pages ──

  describe('listForms', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/forms`).reply({ total_pages: 1, _embedded: { 'osdi:forms': [] } })

      await service.listForms(2)

      expect(mock.history[0].url).toBe(`${BASE}/forms`)
      expect(mock.history[0].query).toMatchObject({ page: 2 })
    })
  })

  describe('listPetitions', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/petitions`).reply({ total_pages: 1 })

      await service.listPetitions(1)

      expect(mock.history[0].url).toBe(`${BASE}/petitions`)
      expect(mock.history[0].query).toMatchObject({ page: 1 })
    })
  })

  describe('listFundraisingPages', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/fundraising_pages`).reply({ total_pages: 1 })

      await service.listFundraisingPages()

      expect(mock.history[0].url).toBe(`${BASE}/fundraising_pages`)
    })
  })

  describe('listAdvocacyCampaigns', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/advocacy_campaigns`).reply({ total_pages: 1 })

      await service.listAdvocacyCampaigns()

      expect(mock.history[0].url).toBe(`${BASE}/advocacy_campaigns`)
    })
  })

  // ── Tags & Taggings ──

  describe('listTags', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/tags`).reply({ total_pages: 1, _embedded: { 'osdi:tags': [] } })

      await service.listTags(1)

      expect(mock.history[0].url).toBe(`${BASE}/tags`)
      expect(mock.history[0].query).toMatchObject({ page: 1 })
    })
  })

  describe('getTag', () => {
    it('sends correct request', async () => {
      const tagData = { identifiers: ['action_network:tag123'], name: 'Volunteers' }
      mock.onGet(`${BASE}/tags/tag123`).reply(tagData)

      const result = await service.getTag('tag123')

      expect(result).toEqual(tagData)
      expect(mock.history[0].url).toBe(`${BASE}/tags/tag123`)
    })
  })

  describe('addTagging', () => {
    it('sends POST with correct _links body', async () => {
      const responseData = { identifiers: ['action_network:tagging123'] }
      mock.onPost(`${BASE}/tags/tag123/taggings`).reply(responseData)

      const result = await service.addTagging('tag123', 'person456')

      expect(result).toEqual(responseData)
      expect(mock.history[0].url).toBe(`${BASE}/tags/tag123/taggings`)
      expect(mock.history[0].body).toEqual({
        _links: {
          'osdi:person': {
            href: `${BASE}/people/person456`,
          },
        },
      })
    })
  })

  // ── Messages ──

  describe('listMessages', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/messages`).reply({ total_pages: 1, _embedded: { 'osdi:messages': [] } })

      await service.listMessages(1)

      expect(mock.history[0].url).toBe(`${BASE}/messages`)
      expect(mock.history[0].query).toMatchObject({ page: 1 })
    })
  })

  describe('getMessage', () => {
    it('sends correct request', async () => {
      const messageData = { identifiers: ['action_network:msg123'], subject: 'Newsletter' }
      mock.onGet(`${BASE}/messages/msg123`).reply(messageData)

      const result = await service.getMessage('msg123')

      expect(result).toEqual(messageData)
      expect(mock.history[0].url).toBe(`${BASE}/messages/msg123`)
    })
  })

  // ── Responses (Submissions & Signatures) ──

  describe('listFormSubmissions', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/forms/form123/submissions`).reply({ total_pages: 1, _embedded: { 'osdi:submissions': [] } })

      await service.listFormSubmissions('form123', 2)

      expect(mock.history[0].url).toBe(`${BASE}/forms/form123/submissions`)
      expect(mock.history[0].query).toMatchObject({ page: 2 })
    })
  })

  describe('listPetitionSignatures', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/petitions/pet123/signatures`).reply({ total_pages: 1, _embedded: { 'osdi:signatures': [] } })

      await service.listPetitionSignatures('pet123', 1)

      expect(mock.history[0].url).toBe(`${BASE}/petitions/pet123/signatures`)
      expect(mock.history[0].query).toMatchObject({ page: 1 })
    })
  })

  // ── Dictionary ──

  describe('getTagsDictionary', () => {
    it('returns formatted items from tags response', async () => {
      mock.onGet(`${BASE}/tags`).reply({
        _embedded: {
          'osdi:tags': [
            {
              name: 'Volunteers',
              identifiers: ['action_network:tag-uuid-1'],
              _links: { self: { href: `${BASE}/tags/tag-uuid-1` } },
            },
            {
              name: 'Donors',
              identifiers: ['action_network:tag-uuid-2'],
              _links: { self: { href: `${BASE}/tags/tag-uuid-2` } },
            },
          ],
        },
        _links: {},
      })

      const result = await service.getTagsDictionary({})

      expect(result.items).toEqual([
        { label: 'Volunteers', value: 'tag-uuid-1', note: 'action_network:tag-uuid-1' },
        { label: 'Donors', value: 'tag-uuid-2', note: 'action_network:tag-uuid-2' },
      ])
      expect(result.cursor).toBeUndefined()
    })

    it('filters by search term (case-insensitive)', async () => {
      mock.onGet(`${BASE}/tags`).reply({
        _embedded: {
          'osdi:tags': [
            { name: 'Volunteers', identifiers: ['action_network:t1'], _links: { self: { href: `${BASE}/tags/t1` } } },
            { name: 'Donors', identifiers: ['action_network:t2'], _links: { self: { href: `${BASE}/tags/t2` } } },
          ],
        },
        _links: {},
      })

      const result = await service.getTagsDictionary({ search: 'vol' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Volunteers')
    })

    it('returns cursor when next page exists', async () => {
      mock.onGet(`${BASE}/tags`).reply({
        _embedded: { 'osdi:tags': [] },
        _links: { next: { href: `${BASE}/tags?page=2` } },
      })

      const result = await service.getTagsDictionary({})

      expect(result.cursor).toBe('2')
    })

    it('uses cursor as page number', async () => {
      mock.onGet(`${BASE}/tags`).reply({
        _embedded: { 'osdi:tags': [] },
        _links: {},
      })

      await service.getTagsDictionary({ cursor: '3' })

      expect(mock.history[0].query).toMatchObject({ page: 3 })
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/tags`).reply({
        _embedded: { 'osdi:tags': [] },
        _links: {},
      })

      const result = await service.getTagsDictionary(null)

      expect(result.items).toEqual([])
    })

    it('falls back to identifier when no self link', async () => {
      mock.onGet(`${BASE}/tags`).reply({
        _embedded: {
          'osdi:tags': [
            { name: 'NoLink', identifiers: ['action_network:fallback-id'] },
          ],
        },
        _links: {},
      })

      const result = await service.getTagsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('fallback-id')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('includes status code in error message', async () => {
      mock.onGet(`${BASE}/people/bad-id`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { error: 'Person not found' },
      })

      await expect(service.getPerson('bad-id')).rejects.toThrow('Action Network API error (404): Person not found')
    })

    it('uses request_status when error and message are absent', async () => {
      mock.onGet(`${BASE}/events/bad-id`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { request_status: 'error' },
      })

      await expect(service.getEvent('bad-id')).rejects.toThrow('Action Network API error (400): error')
    })

    it('falls back to error.message when no body fields match', async () => {
      mock.onGet(`${BASE}/tags/bad-id`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.getTag('bad-id')).rejects.toThrow('Network timeout')
    })
  })
})
