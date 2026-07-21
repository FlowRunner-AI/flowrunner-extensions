'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.getresponse.com/v3'

describe('GetResponse Service', () => {
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
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the X-Auth-Token header on requests', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply([])

      await service.listCampaigns()

      expect(mock.history[0].headers).toMatchObject({
        'X-Auth-Token': `api-key ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Dictionary Methods ──

  describe('getCampaignsDictionary', () => {
    it('maps campaigns to items and sends perPage', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply([
        { campaignId: 'V', name: 'Newsletter' },
        { campaignId: 'W', name: 'Promos' },
      ])

      const result = await service.getCampaignsDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ BASE }/campaigns`)
      expect(mock.history[0].query).toEqual({ perPage: 1000 })
      expect(result.items).toEqual([
        { label: 'Newsletter', value: 'V', note: 'ID: V' },
        { label: 'Promos', value: 'W', note: 'ID: W' },
      ])
    })

    it('adds a query[name] filter when search is provided', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply([{ campaignId: 'V', name: 'Newsletter' }])

      await service.getCampaignsDictionary({ search: 'news' })

      expect(mock.history[0].query).toEqual({ perPage: 1000, 'query[name]': 'news' })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply([])

      const result = await service.getCampaignsDictionary(null)

      expect(result).toEqual({ items: [] })
    })

    it('returns empty items on API error', async () => {
      mock.onGet(`${ BASE }/campaigns`).replyWithError({ message: 'Unauthorized' })

      const result = await service.getCampaignsDictionary({})

      expect(result).toEqual({ items: [] })
    })
  })

  describe('getTagsDictionary', () => {
    it('maps tags to items and sends perPage', async () => {
      mock.onGet(`${ BASE }/tags`).reply([
        { tagId: 'abc', name: 'VIP' },
        { tagId: 'def', name: 'Lead' },
      ])

      const result = await service.getTagsDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/tags`)
      expect(mock.history[0].query).toEqual({ perPage: 1000 })
      expect(result.items).toEqual([
        { label: 'VIP', value: 'abc', note: 'ID: abc' },
        { label: 'Lead', value: 'def', note: 'ID: def' },
      ])
    })

    it('adds a query[name] filter when search is provided', async () => {
      mock.onGet(`${ BASE }/tags`).reply([{ tagId: 'abc', name: 'VIP' }])

      await service.getTagsDictionary({ search: 'vip' })

      expect(mock.history[0].query).toEqual({ perPage: 1000, 'query[name]': 'vip' })
    })

    it('returns empty items on API error', async () => {
      mock.onGet(`${ BASE }/tags`).replyWithError({ message: 'Boom' })

      const result = await service.getTagsDictionary({})

      expect(result).toEqual({ items: [] })
    })
  })

  describe('getCustomFieldsDictionary', () => {
    it('maps custom fields to items with type note', async () => {
      mock.onGet(`${ BASE }/custom-fields`).reply([
        { customFieldId: 'xyz', name: 'Birthday', type: 'date' },
        { customFieldId: 'uvw', name: 'City', type: 'text' },
      ])

      const result = await service.getCustomFieldsDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/custom-fields`)
      expect(mock.history[0].query).toEqual({ perPage: 1000 })
      expect(result.items).toEqual([
        { label: 'Birthday', value: 'xyz', note: 'Type: date' },
        { label: 'City', value: 'uvw', note: 'Type: text' },
      ])
    })

    it('filters client-side by search term (no query[name])', async () => {
      mock.onGet(`${ BASE }/custom-fields`).reply([
        { customFieldId: 'xyz', name: 'Birthday', type: 'date' },
        { customFieldId: 'uvw', name: 'City', type: 'text' },
      ])

      const result = await service.getCustomFieldsDictionary({ search: 'birth' })

      expect(mock.history[0].query).toEqual({ perPage: 1000 })
      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('xyz')
    })

    it('returns empty items on API error', async () => {
      mock.onGet(`${ BASE }/custom-fields`).replyWithError({ message: 'Boom' })

      const result = await service.getCustomFieldsDictionary({})

      expect(result).toEqual({ items: [] })
    })
  })

  describe('getFromFieldsDictionary', () => {
    it('maps from-fields to labelled items', async () => {
      mock.onGet(`${ BASE }/from-fields`).reply([
        { fromFieldId: 'f1', name: 'John Doe', email: 'john@example.com' },
        { fromFieldId: 'f2', name: 'Jane Roe', email: 'jane@example.com' },
      ])

      const result = await service.getFromFieldsDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/from-fields`)
      expect(mock.history[0].query).toEqual({ perPage: 1000 })
      expect(result.items).toEqual([
        { label: 'John Doe <john@example.com>', value: 'f1', note: 'john@example.com' },
        { label: 'Jane Roe <jane@example.com>', value: 'f2', note: 'jane@example.com' },
      ])
    })

    it('filters client-side by search term over the label', async () => {
      mock.onGet(`${ BASE }/from-fields`).reply([
        { fromFieldId: 'f1', name: 'John Doe', email: 'john@example.com' },
        { fromFieldId: 'f2', name: 'Jane Roe', email: 'jane@example.com' },
      ])

      const result = await service.getFromFieldsDictionary({ search: 'jane' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('f2')
    })

    it('returns empty items on API error', async () => {
      mock.onGet(`${ BASE }/from-fields`).replyWithError({ message: 'Boom' })

      const result = await service.getFromFieldsDictionary({})

      expect(result).toEqual({ items: [] })
    })
  })

  // ── Contacts ──

  describe('createContact', () => {
    it('sends with required params only', async () => {
      mock.onPost(`${ BASE }/contacts`).reply(undefined)

      const result = await service.createContact('john@example.com', 'V')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/contacts`)
      expect(mock.history[0].body).toEqual({
        email: 'john@example.com',
        campaign: { campaignId: 'V' },
      })
      // Empty 202 body falls back to a synthetic success object.
      expect(result).toEqual({ httpStatus: 202, code: 1, message: 'Queued for processing' })
    })

    it('includes all optional params and maps tag ids and dayOfCycle', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ ok: true })

      const result = await service.createContact(
        'john@example.com',
        'V',
        'John Doe',
        0,
        [{ customFieldId: 'abc', value: ['1990-01-01'] }],
        ['t1', 't2']
      )

      expect(mock.history[0].body).toEqual({
        email: 'john@example.com',
        name: 'John Doe',
        campaign: { campaignId: 'V' },
        dayOfCycle: '0',
        customFieldValues: [{ customFieldId: 'abc', value: ['1990-01-01'] }],
        tags: [{ tagId: 't1' }, { tagId: 't2' }],
      })
      expect(result).toEqual({ ok: true })
    })

    it('omits empty custom fields and tags arrays', async () => {
      mock.onPost(`${ BASE }/contacts`).reply(undefined)

      await service.createContact('john@example.com', 'V', undefined, undefined, [], [])

      expect(mock.history[0].body).toEqual({
        email: 'john@example.com',
        campaign: { campaignId: 'V' },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/contacts`).replyWithError({ message: 'Conflict' })

      await expect(service.createContact('john@example.com', 'V')).rejects.toThrow(
        'Failed to create contact: GetResponse API error: Conflict'
      )
    })

    it('builds an error message from the response body fields', async () => {
      mock.onPost(`${ BASE }/contacts`).replyWithError({
        message: 'ignored surface message',
        body: { message: 'Validation failed', code: 1001, context: { field: 'email' } },
      })

      await expect(service.createContact('john@example.com', 'V')).rejects.toThrow(
        'Failed to create contact: GetResponse API error: Validation failed | code 1001 | context: {"field":"email"}'
      )
    })
  })

  describe('getContact', () => {
    it('fetches a contact by id', async () => {
      mock.onGet(`${ BASE }/contacts/xyz`).reply({ contactId: 'xyz', email: 'jane@example.com' })

      const result = await service.getContact('xyz')

      expect(result).toEqual({ contactId: 'xyz', email: 'jane@example.com' })
      expect(mock.history[0].url).toBe(`${ BASE }/contacts/xyz`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/contacts/xyz`).replyWithError({ message: 'Not found' })

      await expect(service.getContact('xyz')).rejects.toThrow(
        'Failed to get contact: GetResponse API error: Not found'
      )
    })
  })

  describe('listContacts', () => {
    it('uses default pagination and default sort (Newest First)', async () => {
      mock.onGet(`${ BASE }/contacts`).reply([])

      await service.listContacts()

      expect(mock.history[0].query).toEqual({
        perPage: 100,
        page: 1,
        'sort[createdOn]': 'desc',
      })
    })

    it('applies email and campaign filters plus a mapped sort choice', async () => {
      mock.onGet(`${ BASE }/contacts`).reply([])

      await service.listContacts('john@example.com', 'V', 'Email Ascending', 25, 2)

      expect(mock.history[0].query).toEqual({
        perPage: 25,
        page: 2,
        'query[email]': 'john@example.com',
        'query[campaignId]': 'V',
        'sort[email]': 'asc',
      })
    })

    it('mangles an unknown sort label into per-character sort keys (documents current behavior)', async () => {
      mock.onGet(`${ BASE }/contacts`).reply([])

      await service.listContacts(undefined, undefined, 'Newest')

      // KNOWN SERVICE BUG: #resolveChoice passes an unmapped label through as a raw
      // string, so `sort` stays a string. Object.entries then iterates its characters,
      // yielding sort[0]=N, sort[1]=e, ... instead of a valid sort field. A valid,
      // mapped label ("Newest First") or omitting the arg both behave correctly; only
      // an out-of-list free-text label triggers this. Asserted here to lock in current
      // behavior and surface it in the report.
      expect(mock.history[0].query).toMatchObject({
        perPage: 100,
        page: 1,
        'sort[0]': 'N',
        'sort[1]': 'e',
        'sort[5]': 't',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/contacts`).replyWithError({ message: 'Boom' })

      await expect(service.listContacts()).rejects.toThrow(
        'Failed to list contacts: GetResponse API error: Boom'
      )
    })
  })

  describe('searchContacts', () => {
    it('searches by exact email', async () => {
      mock.onGet(`${ BASE }/contacts`).reply([{ contactId: 'xyz', email: 'jane@example.com' }])

      const result = await service.searchContacts('jane@example.com')

      expect(mock.history[0].query).toEqual({
        'query[email]': 'jane@example.com',
        perPage: 1000,
      })
      expect(result).toEqual([{ contactId: 'xyz', email: 'jane@example.com' }])
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/contacts`).replyWithError({ message: 'Boom' })

      await expect(service.searchContacts('jane@example.com')).rejects.toThrow(
        'Failed to search contacts: GetResponse API error: Boom'
      )
    })
  })

  describe('updateContact', () => {
    it('sends post to the contact id with only provided fields', async () => {
      mock.onPost(`${ BASE }/contacts/xyz`).reply({ contactId: 'xyz', name: 'New Name' })

      const result = await service.updateContact('xyz', 'New Name')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/contacts/xyz`)
      expect(mock.history[0].body).toEqual({ name: 'New Name' })
      expect(result).toEqual({ contactId: 'xyz', name: 'New Name' })
    })

    it('sends an empty body when no fields change', async () => {
      mock.onPost(`${ BASE }/contacts/xyz`).reply(undefined)

      await service.updateContact('xyz')

      expect(mock.history[0].body).toEqual({})
    })

    it('includes dayOfCycle, custom fields and tags', async () => {
      mock.onPost(`${ BASE }/contacts/xyz`).reply(undefined)

      await service.updateContact(
        'xyz',
        undefined,
        3,
        [{ customFieldId: 'abc', value: ['new'] }],
        ['t1']
      )

      expect(mock.history[0].body).toEqual({
        dayOfCycle: '3',
        customFieldValues: [{ customFieldId: 'abc', value: ['new'] }],
        tags: [{ tagId: 't1' }],
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/contacts/xyz`).replyWithError({ message: 'Boom' })

      await expect(service.updateContact('xyz', 'Name')).rejects.toThrow(
        'Failed to update contact: GetResponse API error: Boom'
      )
    })
  })

  describe('deleteContact', () => {
    it('sends delete and returns success', async () => {
      mock.onDelete(`${ BASE }/contacts/xyz`).reply(undefined)

      const result = await service.deleteContact('xyz')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/contacts/xyz`)
      expect(result).toEqual({ success: true, contactId: 'xyz' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/contacts/xyz`).replyWithError({ message: 'Boom' })

      await expect(service.deleteContact('xyz')).rejects.toThrow(
        'Failed to delete contact: GetResponse API error: Boom'
      )
    })
  })

  // ── Campaigns (Lists) ──

  describe('listCampaigns', () => {
    it('lists campaigns with default perPage', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply([{ campaignId: 'V', name: 'Newsletter' }])

      const result = await service.listCampaigns()

      expect(mock.history[0].query).toEqual({ perPage: 1000 })
      expect(result).toEqual([{ campaignId: 'V', name: 'Newsletter' }])
    })

    it('adds a name filter when provided', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply([])

      await service.listCampaigns('news')

      expect(mock.history[0].query).toEqual({ perPage: 1000, 'query[name]': 'news' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/campaigns`).replyWithError({ message: 'Boom' })

      await expect(service.listCampaigns()).rejects.toThrow(
        'Failed to list campaigns: GetResponse API error: Boom'
      )
    })
  })

  describe('getCampaign', () => {
    it('fetches a campaign by id', async () => {
      mock.onGet(`${ BASE }/campaigns/V`).reply({ campaignId: 'V', name: 'Newsletter' })

      const result = await service.getCampaign('V')

      expect(result).toEqual({ campaignId: 'V', name: 'Newsletter' })
      expect(mock.history[0].url).toBe(`${ BASE }/campaigns/V`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/campaigns/V`).replyWithError({ message: 'Boom' })

      await expect(service.getCampaign('V')).rejects.toThrow(
        'Failed to get campaign: GetResponse API error: Boom'
      )
    })
  })

  describe('createCampaign', () => {
    it('sends with the name only', async () => {
      mock.onPost(`${ BASE }/campaigns`).reply({ campaignId: 'W', name: 'my-list' })

      const result = await service.createCampaign('my-list')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ name: 'my-list' })
      expect(result).toEqual({ campaignId: 'W', name: 'my-list' })
    })

    it('includes the language code when provided', async () => {
      mock.onPost(`${ BASE }/campaigns`).reply({ campaignId: 'W' })

      await service.createCampaign('my-list', 'en')

      expect(mock.history[0].body).toEqual({ name: 'my-list', languageCode: 'en' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/campaigns`).replyWithError({ message: 'Boom' })

      await expect(service.createCampaign('my-list')).rejects.toThrow(
        'Failed to create campaign: GetResponse API error: Boom'
      )
    })
  })

  // ── Newsletters ──

  describe('createNewsletter', () => {
    it('sends with required params and immediate send (no sendSettings)', async () => {
      mock.onPost(`${ BASE }/newsletters`).reply({ newsletterId: 'n1' })

      const result = await service.createNewsletter('Weekly', 'f1', 'V', '<p>Hi</p>')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/newsletters`)
      expect(mock.history[0].body).toEqual({
        subject: 'Weekly',
        fromField: { fromFieldId: 'f1' },
        campaign: { campaignId: 'V' },
        content: { html: '<p>Hi</p>' },
      })
      expect(result).toEqual({ newsletterId: 'n1' })
    })

    it('includes plain content, reply-to, and scheduled sendSettings', async () => {
      mock.onPost(`${ BASE }/newsletters`).reply({ newsletterId: 'n2' })

      await service.createNewsletter(
        'Weekly',
        'f1',
        'V',
        '<p>Hi</p>',
        'Hi',
        'f2',
        '2025-01-15T10:00:00Z'
      )

      expect(mock.history[0].body).toEqual({
        subject: 'Weekly',
        fromField: { fromFieldId: 'f1' },
        replyTo: { fromFieldId: 'f2' },
        campaign: { campaignId: 'V' },
        content: { html: '<p>Hi</p>', plain: 'Hi' },
        sendSettings: {
          selectedCampaigns: ['V'],
          timeTravel: 'false',
          perfectTiming: 'false',
        },
        sendOn: '2025-01-15T10:00:00Z',
      })
    })

    it('omits content when neither html nor plain is provided', async () => {
      mock.onPost(`${ BASE }/newsletters`).reply({ newsletterId: 'n3' })

      await service.createNewsletter('Weekly', 'f1', 'V')

      expect(mock.history[0].body).toEqual({
        subject: 'Weekly',
        fromField: { fromFieldId: 'f1' },
        campaign: { campaignId: 'V' },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/newsletters`).replyWithError({ message: 'Boom' })

      await expect(service.createNewsletter('Weekly', 'f1', 'V', '<p>Hi</p>')).rejects.toThrow(
        'Failed to create newsletter: GetResponse API error: Boom'
      )
    })
  })

  describe('listNewsletters', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/newsletters`).reply([])

      await service.listNewsletters()

      expect(mock.history[0].query).toEqual({ perPage: 100, page: 1 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/newsletters`).reply([])

      await service.listNewsletters(10, 3)

      expect(mock.history[0].query).toEqual({ perPage: 10, page: 3 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/newsletters`).replyWithError({ message: 'Boom' })

      await expect(service.listNewsletters()).rejects.toThrow(
        'Failed to list newsletters: GetResponse API error: Boom'
      )
    })
  })

  describe('getNewsletter', () => {
    it('fetches a newsletter by id', async () => {
      mock.onGet(`${ BASE }/newsletters/n1`).reply({ newsletterId: 'n1', subject: 'Weekly' })

      const result = await service.getNewsletter('n1')

      expect(result).toEqual({ newsletterId: 'n1', subject: 'Weekly' })
      expect(mock.history[0].url).toBe(`${ BASE }/newsletters/n1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/newsletters/n1`).replyWithError({ message: 'Boom' })

      await expect(service.getNewsletter('n1')).rejects.toThrow(
        'Failed to get newsletter: GetResponse API error: Boom'
      )
    })
  })

  // ── Autoresponders ──

  describe('listAutoresponders', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/autoresponders`).reply([])

      await service.listAutoresponders()

      expect(mock.history[0].query).toEqual({ perPage: 100, page: 1 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/autoresponders`).reply([])

      await service.listAutoresponders(20, 4)

      expect(mock.history[0].query).toEqual({ perPage: 20, page: 4 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/autoresponders`).replyWithError({ message: 'Boom' })

      await expect(service.listAutoresponders()).rejects.toThrow(
        'Failed to list autoresponders: GetResponse API error: Boom'
      )
    })
  })

  describe('getAutoresponder', () => {
    it('fetches an autoresponder by id', async () => {
      mock.onGet(`${ BASE }/autoresponders/a1`).reply({ autoresponderId: 'a1', name: 'Welcome' })

      const result = await service.getAutoresponder('a1')

      expect(result).toEqual({ autoresponderId: 'a1', name: 'Welcome' })
      expect(mock.history[0].url).toBe(`${ BASE }/autoresponders/a1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/autoresponders/a1`).replyWithError({ message: 'Boom' })

      await expect(service.getAutoresponder('a1')).rejects.toThrow(
        'Failed to get autoresponder: GetResponse API error: Boom'
      )
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('lists tags with default perPage', async () => {
      mock.onGet(`${ BASE }/tags`).reply([{ tagId: 'abc', name: 'VIP' }])

      const result = await service.listTags()

      expect(mock.history[0].query).toEqual({ perPage: 1000 })
      expect(result).toEqual([{ tagId: 'abc', name: 'VIP' }])
    })

    it('adds a name filter when provided', async () => {
      mock.onGet(`${ BASE }/tags`).reply([])

      await service.listTags('vip')

      expect(mock.history[0].query).toEqual({ perPage: 1000, 'query[name]': 'vip' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/tags`).replyWithError({ message: 'Boom' })

      await expect(service.listTags()).rejects.toThrow(
        'Failed to list tags: GetResponse API error: Boom'
      )
    })
  })

  describe('createTag', () => {
    it('sends with the name only', async () => {
      mock.onPost(`${ BASE }/tags`).reply({ tagId: 'abc', name: 'VIP' })

      const result = await service.createTag('VIP')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ name: 'VIP' })
      expect(result).toEqual({ tagId: 'abc', name: 'VIP' })
    })

    it('maps a friendly color label to the API value', async () => {
      mock.onPost(`${ BASE }/tags`).reply({ tagId: 'abc' })

      await service.createTag('VIP', 'Blue')

      expect(mock.history[0].body).toEqual({ name: 'VIP', color: 'BLUE' })
    })

    it('passes through an unknown color unchanged', async () => {
      mock.onPost(`${ BASE }/tags`).reply({ tagId: 'abc' })

      await service.createTag('VIP', 'CYAN')

      expect(mock.history[0].body).toEqual({ name: 'VIP', color: 'CYAN' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/tags`).replyWithError({ message: 'Boom' })

      await expect(service.createTag('VIP')).rejects.toThrow(
        'Failed to create tag: GetResponse API error: Boom'
      )
    })
  })

  describe('deleteTag', () => {
    it('sends delete and returns success', async () => {
      mock.onDelete(`${ BASE }/tags/abc`).reply(undefined)

      const result = await service.deleteTag('abc')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/tags/abc`)
      expect(result).toEqual({ success: true, tagId: 'abc' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/tags/abc`).replyWithError({ message: 'Boom' })

      await expect(service.deleteTag('abc')).rejects.toThrow(
        'Failed to delete tag: GetResponse API error: Boom'
      )
    })
  })

  // ── Custom Fields ──

  describe('listCustomFields', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/custom-fields`).reply([])

      await service.listCustomFields()

      expect(mock.history[0].query).toEqual({ perPage: 100, page: 1 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/custom-fields`).reply([])

      await service.listCustomFields(50, 2)

      expect(mock.history[0].query).toEqual({ perPage: 50, page: 2 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/custom-fields`).replyWithError({ message: 'Boom' })

      await expect(service.listCustomFields()).rejects.toThrow(
        'Failed to list custom fields: GetResponse API error: Boom'
      )
    })
  })

  describe('createCustomField', () => {
    it('sends with required params, mapping the type and defaulting hidden to false', async () => {
      mock.onPost(`${ BASE }/custom-fields`).reply({ customFieldId: 'xyz' })

      const result = await service.createCustomField('birthday', 'Date')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        name: 'birthday',
        type: 'date',
        hidden: 'false',
      })
      expect(result).toEqual({ customFieldId: 'xyz' })
    })

    it('includes values and maps a multi-select type with hidden true', async () => {
      mock.onPost(`${ BASE }/custom-fields`).reply({ customFieldId: 'xyz' })

      await service.createCustomField('color', 'Single Select', true, ['red', 'green'])

      expect(mock.history[0].body).toEqual({
        name: 'color',
        type: 'single_select',
        hidden: 'true',
        values: ['red', 'green'],
      })
    })

    it('omits an empty values array', async () => {
      mock.onPost(`${ BASE }/custom-fields`).reply({ customFieldId: 'xyz' })

      await service.createCustomField('note', 'Text', false, [])

      expect(mock.history[0].body).toEqual({
        name: 'note',
        type: 'text',
        hidden: 'false',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/custom-fields`).replyWithError({ message: 'Boom' })

      await expect(service.createCustomField('birthday', 'Date')).rejects.toThrow(
        'Failed to create custom field: GetResponse API error: Boom'
      )
    })
  })

  // ── From Fields ──

  describe('listFromFields', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/from-fields`).reply([])

      await service.listFromFields()

      expect(mock.history[0].query).toEqual({ perPage: 100, page: 1 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/from-fields`).reply([])

      await service.listFromFields(10, 5)

      expect(mock.history[0].query).toEqual({ perPage: 10, page: 5 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/from-fields`).replyWithError({ message: 'Boom' })

      await expect(service.listFromFields()).rejects.toThrow(
        'Failed to list from-fields: GetResponse API error: Boom'
      )
    })
  })
})
