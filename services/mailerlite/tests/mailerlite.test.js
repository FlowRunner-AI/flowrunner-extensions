'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://connect.mailerlite.com/api'

describe('MailerLite Service', () => {
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

    it('sends the Authorization Bearer header on requests', async () => {
      mock.onGet(`${ BASE }/fields`).reply({ data: [] })

      await service.listFields()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      })
    })
  })

  // ── Subscribers ──

  describe('upsertSubscriber', () => {
    it('sends POST with required params only', async () => {
      mock.onPost(`${ BASE }/subscribers`).reply({ data: { id: '123', email: 'john@example.com', status: 'active' } })

      const result = await service.upsertSubscriber('john@example.com')

      expect(result).toEqual({ id: '123', email: 'john@example.com', status: 'active' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ email: 'john@example.com' })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/subscribers`).reply({ data: { id: '124' } })

      await service.upsertSubscriber(
        'john@example.com',
        { name: 'John', last_name: 'Doe' },
        ['group1', 'group2'],
        'Active'
      )

      expect(mock.history[0].body).toEqual({
        email: 'john@example.com',
        fields: { name: 'John', last_name: 'Doe' },
        groups: ['group1', 'group2'],
        status: 'active',
      })
    })

    it('passes unknown status values through unchanged', async () => {
      mock.onPost(`${ BASE }/subscribers`).reply({ data: { id: '125' } })

      await service.upsertSubscriber('john@example.com', undefined, undefined, 'custom_status')

      expect(mock.history[0].body).toEqual({
        email: 'john@example.com',
        status: 'custom_status',
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/subscribers`).replyWithError({ message: 'Bad Request' })

      await expect(service.upsertSubscriber('bad@example.com')).rejects.toThrow('MailerLite API error')
    })
  })

  describe('getSubscriber', () => {
    it('fetches subscriber by ID', async () => {
      mock.onGet(`${ BASE }/subscribers/123`).reply({ data: { id: '123', email: 'john@example.com' } })

      const result = await service.getSubscriber('123')

      expect(result).toEqual({ id: '123', email: 'john@example.com' })
      expect(mock.history[0].url).toBe(`${ BASE }/subscribers/123`)
    })

    it('fetches subscriber by email with URL encoding', async () => {
      mock.onGet(`${ BASE }/subscribers/john%40example.com`).reply({ data: { id: '123' } })

      const result = await service.getSubscriber('john@example.com')

      expect(result).toEqual({ id: '123' })
      expect(mock.history[0].url).toBe(`${ BASE }/subscribers/john%40example.com`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/subscribers/999`).replyWithError({ message: 'Not found' })

      await expect(service.getSubscriber('999')).rejects.toThrow('MailerLite API error')
    })
  })

  describe('listSubscribers', () => {
    it('sends GET with no filters when no params provided', async () => {
      mock.onGet(`${ BASE }/subscribers`).reply({ data: [{ id: '1' }], meta: { next_cursor: 'abc', prev_cursor: null } })

      const result = await service.listSubscribers()

      expect(result).toEqual({
        subscribers: [{ id: '1' }],
        nextCursor: 'abc',
        prevCursor: null,
      })
      expect(mock.history[0].query).toEqual({})
    })

    it('includes status filter and pagination params', async () => {
      mock.onGet(`${ BASE }/subscribers`).reply({ data: [], meta: {} })

      await service.listSubscribers('Active', 10, 'cursor123')

      expect(mock.history[0].query).toMatchObject({
        'filter[status]': 'active',
        limit: 10,
        cursor: 'cursor123',
      })
    })

    it('resolves Bounced status correctly', async () => {
      mock.onGet(`${ BASE }/subscribers`).reply({ data: [], meta: {} })

      await service.listSubscribers('Bounced')

      expect(mock.history[0].query).toMatchObject({
        'filter[status]': 'bounced',
      })
    })

    it('returns empty subscribers when data is missing', async () => {
      mock.onGet(`${ BASE }/subscribers`).reply({ meta: {} })

      const result = await service.listSubscribers()

      expect(result.subscribers).toEqual([])
      expect(result.nextCursor).toBeNull()
      expect(result.prevCursor).toBeNull()
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/subscribers`).replyWithError({ message: 'Unauthorized' })

      await expect(service.listSubscribers()).rejects.toThrow('MailerLite API error')
    })
  })

  describe('updateSubscriber', () => {
    it('sends PUT with fields', async () => {
      mock.onPut(`${ BASE }/subscribers/123`).reply({ data: { id: '123', fields: { name: 'Updated' } } })

      const result = await service.updateSubscriber('123', { name: 'Updated' })

      expect(result).toEqual({ id: '123', fields: { name: 'Updated' } })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ fields: { name: 'Updated' } })
    })

    it('includes groups and status', async () => {
      mock.onPut(`${ BASE }/subscribers/123`).reply({ data: { id: '123' } })

      await service.updateSubscriber('123', undefined, ['g1'], 'Unsubscribed')

      expect(mock.history[0].body).toEqual({
        groups: ['g1'],
        status: 'unsubscribed',
      })
    })

    it('throws on API error', async () => {
      mock.onPut(`${ BASE }/subscribers/123`).replyWithError({ message: 'Boom' })

      await expect(service.updateSubscriber('123')).rejects.toThrow('MailerLite API error')
    })
  })

  describe('deleteSubscriber', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/subscribers/123`).reply(undefined)

      const result = await service.deleteSubscriber('123')

      expect(result).toEqual({ deleted: true, subscriberId: '123' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/subscribers/999`).replyWithError({ message: 'Not found' })

      await expect(service.deleteSubscriber('999')).rejects.toThrow('MailerLite API error')
    })
  })

  describe('forgetSubscriber', () => {
    it('sends POST to forget endpoint', async () => {
      mock.onPost(`${ BASE }/subscribers/123/forget`).reply({
        message: 'Data will be deleted',
        data: { id: '123', email: 'john@example.com', status: 'unsubscribed' },
      })

      const result = await service.forgetSubscriber('123')

      expect(result).toEqual({
        message: 'Data will be deleted',
        subscriber: { id: '123', email: 'john@example.com', status: 'unsubscribed' },
      })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({})
    })

    it('provides default message when API returns none', async () => {
      mock.onPost(`${ BASE }/subscribers/123/forget`).reply({ data: null })

      const result = await service.forgetSubscriber('123')

      expect(result.message).toBe('Subscriber data will be completely deleted and forgotten')
      expect(result.subscriber).toBeNull()
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/subscribers/123/forget`).replyWithError({ message: 'Boom' })

      await expect(service.forgetSubscriber('123')).rejects.toThrow('MailerLite API error')
    })
  })

  // ── Groups ──

  describe('createGroup', () => {
    it('sends POST with group name', async () => {
      mock.onPost(`${ BASE }/groups`).reply({ data: { id: '1', name: 'Newsletter' } })

      const result = await service.createGroup('Newsletter')

      expect(result).toEqual({ id: '1', name: 'Newsletter' })
      expect(mock.history[0].body).toEqual({ name: 'Newsletter' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/groups`).replyWithError({ message: 'Boom' })

      await expect(service.createGroup('Test')).rejects.toThrow('MailerLite API error')
    })
  })

  describe('listGroups', () => {
    it('sends GET with no filters by default', async () => {
      mock.onGet(`${ BASE }/groups`).reply({
        data: [{ id: '1', name: 'Newsletter', active_count: 100 }],
        meta: { total: 1, current_page: 1, last_page: 1 },
      })

      const result = await service.listGroups()

      expect(result).toEqual({
        groups: [{ id: '1', name: 'Newsletter', active_count: 100 }],
        total: 1,
        currentPage: 1,
        lastPage: 1,
      })
      expect(mock.history[0].query).toEqual({})
    })

    it('includes name filter and pagination params', async () => {
      mock.onGet(`${ BASE }/groups`).reply({ data: [], meta: {} })

      await service.listGroups('News', 10, 2)

      expect(mock.history[0].query).toMatchObject({
        'filter[name]': 'News',
        limit: 10,
        page: 2,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/groups`).replyWithError({ message: 'Boom' })

      await expect(service.listGroups()).rejects.toThrow('MailerLite API error')
    })
  })

  describe('deleteGroup', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/groups/1`).reply(undefined)

      const result = await service.deleteGroup('1')

      expect(result).toEqual({ deleted: true, groupId: '1' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/groups/1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteGroup('1')).rejects.toThrow('MailerLite API error')
    })
  })

  describe('assignSubscriberToGroup', () => {
    it('sends POST to subscriber/group endpoint', async () => {
      mock.onPost(`${ BASE }/subscribers/123/groups/g1`).reply({ data: { id: 'g1', name: 'Newsletter' } })

      const result = await service.assignSubscriberToGroup('123', 'g1')

      expect(result).toEqual({ id: 'g1', name: 'Newsletter' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({})
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/subscribers/123/groups/g1`).replyWithError({ message: 'Boom' })

      await expect(service.assignSubscriberToGroup('123', 'g1')).rejects.toThrow('MailerLite API error')
    })
  })

  describe('removeSubscriberFromGroup', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/subscribers/123/groups/g1`).reply(undefined)

      const result = await service.removeSubscriberFromGroup('123', 'g1')

      expect(result).toEqual({ removed: true, subscriberId: '123', groupId: 'g1' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/subscribers/123/groups/g1`).replyWithError({ message: 'Boom' })

      await expect(service.removeSubscriberFromGroup('123', 'g1')).rejects.toThrow('MailerLite API error')
    })
  })

  // ── Fields ──

  describe('listFields', () => {
    it('returns fields from the API', async () => {
      mock.onGet(`${ BASE }/fields`).reply({
        data: [
          { id: '1', name: 'Email', key: 'email', type: 'text' },
          { id: '2', name: 'Name', key: 'name', type: 'text' },
        ],
      })

      const result = await service.listFields()

      expect(result).toEqual({
        fields: [
          { id: '1', name: 'Email', key: 'email', type: 'text' },
          { id: '2', name: 'Name', key: 'name', type: 'text' },
        ],
      })
    })

    it('returns empty array when data is missing', async () => {
      mock.onGet(`${ BASE }/fields`).reply({})

      const result = await service.listFields()

      expect(result).toEqual({ fields: [] })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/fields`).replyWithError({ message: 'Boom' })

      await expect(service.listFields()).rejects.toThrow('MailerLite API error')
    })
  })

  // ── Campaigns ──

  describe('listCampaigns', () => {
    it('sends GET with no filters by default', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({
        data: [{ id: '1', name: 'Newsletter', status: 'sent' }],
        meta: { total: 1, current_page: 1, last_page: 1 },
      })

      const result = await service.listCampaigns()

      expect(result).toEqual({
        campaigns: [{ id: '1', name: 'Newsletter', status: 'sent' }],
        total: 1,
        currentPage: 1,
        lastPage: 1,
      })
      expect(mock.history[0].query).toEqual({})
    })

    it('resolves status filter and passes pagination', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({ data: [], meta: {} })

      await service.listCampaigns('Draft', 10, 2)

      expect(mock.history[0].query).toMatchObject({
        'filter[status]': 'draft',
        limit: 10,
        page: 2,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/campaigns`).replyWithError({ message: 'Boom' })

      await expect(service.listCampaigns()).rejects.toThrow('MailerLite API error')
    })
  })

  describe('getCampaign', () => {
    it('fetches a campaign by ID', async () => {
      mock.onGet(`${ BASE }/campaigns/1`).reply({ data: { id: '1', name: 'Newsletter' } })

      const result = await service.getCampaign('1')

      expect(result).toEqual({ id: '1', name: 'Newsletter' })
      expect(mock.history[0].url).toBe(`${ BASE }/campaigns/1`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/campaigns/999`).replyWithError({ message: 'Not found' })

      await expect(service.getCampaign('999')).rejects.toThrow('MailerLite API error')
    })
  })

  describe('createCampaign', () => {
    it('sends POST with required params only', async () => {
      mock.onPost(`${ BASE }/campaigns`).reply({ data: { id: '1', name: 'Test Campaign' } })

      const result = await service.createCampaign('Test Campaign', 'Subject', 'Acme', 'news@example.com')

      expect(result).toEqual({ id: '1', name: 'Test Campaign' })
      expect(mock.history[0].body).toEqual({
        name: 'Test Campaign',
        type: 'regular',
        emails: [{
          subject: 'Subject',
          from_name: 'Acme',
          from: 'news@example.com',
        }],
      })
    })

    it('includes content and groups when provided', async () => {
      mock.onPost(`${ BASE }/campaigns`).reply({ data: { id: '2' } })

      await service.createCampaign('Campaign', 'Subject', 'Acme', 'news@acme.com', '<p>Hello</p>', ['g1', 'g2'])

      expect(mock.history[0].body).toEqual({
        name: 'Campaign',
        type: 'regular',
        emails: [{
          subject: 'Subject',
          from_name: 'Acme',
          from: 'news@acme.com',
          content: '<p>Hello</p>',
        }],
        groups: ['g1', 'g2'],
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/campaigns`).replyWithError({ message: 'Boom' })

      await expect(service.createCampaign('Test', 'Sub', 'Name', 'e@e.com')).rejects.toThrow('MailerLite API error')
    })
  })

  describe('scheduleCampaign', () => {
    it('sends instant delivery', async () => {
      mock.onPost(`${ BASE }/campaigns/1/schedule`).reply({ data: { id: '1', status: 'ready' } })

      const result = await service.scheduleCampaign('1', 'Instant')

      expect(result).toEqual({ id: '1', status: 'ready' })
      expect(mock.history[0].body).toEqual({ delivery: 'instant' })
    })

    it('sends scheduled delivery with schedule details', async () => {
      mock.onPost(`${ BASE }/campaigns/1/schedule`).reply({ data: { id: '1', status: 'ready' } })

      await service.scheduleCampaign('1', 'Scheduled', '2026-07-20', '09', '30', 123)

      expect(mock.history[0].body).toEqual({
        delivery: 'scheduled',
        schedule: {
          date: '2026-07-20',
          hours: '09',
          minutes: '30',
          timezone_id: 123,
        },
      })
    })

    it('omits schedule block for instant delivery even with extra params', async () => {
      mock.onPost(`${ BASE }/campaigns/1/schedule`).reply({ data: { id: '1' } })

      await service.scheduleCampaign('1', 'Instant', '2026-07-20', '09', '30')

      expect(mock.history[0].body).toEqual({ delivery: 'instant' })
      expect(mock.history[0].body.schedule).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/campaigns/1/schedule`).replyWithError({ message: 'Boom' })

      await expect(service.scheduleCampaign('1', 'Instant')).rejects.toThrow('MailerLite API error')
    })
  })

  describe('deleteCampaign', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/campaigns/1`).reply(undefined)

      const result = await service.deleteCampaign('1')

      expect(result).toEqual({ deleted: true, campaignId: '1' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/campaigns/1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteCampaign('1')).rejects.toThrow('MailerLite API error')
    })
  })

  // ── Dictionaries ──

  describe('getGroupsDictionary', () => {
    it('maps groups to dictionary items', async () => {
      mock.onGet(`${ BASE }/groups`).reply({
        data: [
          { id: 1, name: 'Newsletter', active_count: 100 },
          { id: 2, name: 'Promos', active_count: 0 },
        ],
        meta: { current_page: 1, last_page: 1 },
      })

      const result = await service.getGroupsDictionary({})

      expect(result.items).toEqual([
        { label: 'Newsletter', value: '1', note: '100 active subscribers' },
        { label: 'Promos', value: '2', note: '0 active subscribers' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('passes search as filter[name] and cursor as page', async () => {
      mock.onGet(`${ BASE }/groups`).reply({ data: [], meta: { current_page: 2, last_page: 3 } })

      const result = await service.getGroupsDictionary({ search: 'News', cursor: '2' })

      expect(mock.history[0].query).toMatchObject({
        'filter[name]': 'News',
        limit: 50,
        page: '2',
      })
      expect(result.cursor).toBe('3')
    })

    it('returns null cursor when on the last page', async () => {
      mock.onGet(`${ BASE }/groups`).reply({ data: [], meta: { current_page: 3, last_page: 3 } })

      const result = await service.getGroupsDictionary({ cursor: '3' })

      expect(result.cursor).toBeNull()
    })

    it('handles null payload', async () => {
      mock.onGet(`${ BASE }/groups`).reply({ data: [], meta: {} })

      const result = await service.getGroupsDictionary(null)

      expect(result.items).toEqual([])
    })

    it('handles active_count being undefined', async () => {
      mock.onGet(`${ BASE }/groups`).reply({
        data: [{ id: 1, name: 'NoCount' }],
        meta: {},
      })

      const result = await service.getGroupsDictionary({})

      expect(result.items[0].note).toBe('0 active subscribers')
    })
  })

  describe('getCampaignsDictionary', () => {
    it('maps draft campaigns to dictionary items', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({
        data: [
          { id: 1, name: 'July Newsletter', status: 'draft', emails: [{ subject: 'Our July news' }] },
        ],
        meta: { current_page: 1, last_page: 1 },
      })

      const result = await service.getCampaignsDictionary({})

      expect(result.items).toEqual([
        { label: 'July Newsletter', value: '1', note: 'draft - Our July news' },
      ])
      expect(mock.history[0].query).toMatchObject({
        'filter[status]': 'draft',
        limit: 50,
      })
    })

    it('filters campaigns by search term (client-side)', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({
        data: [
          { id: 1, name: 'July Newsletter', status: 'draft', emails: [] },
          { id: 2, name: 'August Promo', status: 'draft', emails: [] },
        ],
        meta: { current_page: 1, last_page: 1 },
      })

      const result = await service.getCampaignsDictionary({ search: 'august' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('2')
    })

    it('returns cursor when more pages exist', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({
        data: [],
        meta: { current_page: 1, last_page: 3 },
      })

      const result = await service.getCampaignsDictionary({})

      expect(result.cursor).toBe('2')
    })

    it('handles campaign without emails gracefully', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({
        data: [{ id: 1, name: 'No Emails', status: 'draft' }],
        meta: {},
      })

      const result = await service.getCampaignsDictionary({})

      expect(result.items[0].note).toBe('draft')
    })

    it('handles null payload', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({ data: [], meta: {} })

      const result = await service.getCampaignsDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  // ── Triggers ──

  describe('onSubscriberEvent', () => {
    it('shapes an event (SHAPE_EVENT)', () => {
      const rawEvent = { event: 'subscriber.created', id: '123', email: 'john@example.com' }

      const result = service.onSubscriberEvent('SHAPE_EVENT', rawEvent)

      expect(result).toEqual([{
        name: 'onSubscriberEvent',
        data: { event: 'subscriber.created', id: '123', email: 'john@example.com' },
      }])
    })

    it('falls back to type property when event is missing (SHAPE_EVENT)', () => {
      const rawEvent = { type: 'subscriber.updated', id: '456' }

      const result = service.onSubscriberEvent('SHAPE_EVENT', rawEvent)

      expect(result[0].data.event).toBe('subscriber.updated')
    })

    it('filters matching triggers (FILTER_TRIGGER)', () => {
      const payload = {
        eventData: { event: 'subscriber.created' },
        triggers: [
          { id: 'trigger1', data: { event: 'Subscriber Created' } },
          { id: 'trigger2', data: { event: 'Subscriber Updated' } },
          { id: 'trigger3', data: { event: 'Subscriber Created' } },
        ],
      }

      const result = service.onSubscriberEvent('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['trigger1', 'trigger3'] })
    })

    it('returns empty ids when no triggers match (FILTER_TRIGGER)', () => {
      const payload = {
        eventData: { event: 'subscriber.bounced' },
        triggers: [
          { id: 'trigger1', data: { event: 'Subscriber Created' } },
        ],
      }

      const result = service.onSubscriberEvent('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: [] })
    })
  })

  describe('handleTriggerUpsertWebhook', () => {
    it('creates webhooks for each event', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ data: { id: 'wh_1' } })

      const invocation = {
        callbackUrl: 'https://flow.example.com/callback',
        connectionId: 'conn_1',
        events: [
          { id: 'trigger1', triggerData: { event: 'Subscriber Created' } },
        ],
      }

      const result = await service.handleTriggerUpsertWebhook(invocation)

      expect(result.connectionId).toBe('conn_1')
      expect(result.webhookData.webhooks).toEqual([
        { triggerId: 'trigger1', webhookId: 'wh_1', event: 'subscriber.created' },
      ])
      expect(mock.history[0].body).toEqual({
        name: 'FlowRunner trigger trigger1',
        events: ['subscriber.created'],
        url: 'https://flow.example.com/callback?connectionId=conn_1',
      })
    })

    it('appends connectionId with & when callbackUrl has query params', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ data: { id: 'wh_2' } })

      const invocation = {
        callbackUrl: 'https://flow.example.com/callback?token=abc',
        connectionId: 'conn_2',
        events: [{ id: 'trigger2', triggerData: { event: 'Subscriber Updated' } }],
      }

      await service.handleTriggerUpsertWebhook(invocation)

      expect(mock.history[0].body.url).toBe('https://flow.example.com/callback?token=abc&connectionId=conn_2')
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('returns handshake response for empty body', async () => {
      const result = await service.handleTriggerResolveEvents({ body: null, queryParams: {} })

      expect(result).toEqual({ handshake: true, responseToExternalService: {} })
    })

    it('returns handshake for null invocation', async () => {
      const result = await service.handleTriggerResolveEvents(null)

      expect(result).toEqual({ handshake: true, responseToExternalService: {} })
    })

    it('resolves a single event from webhook body', async () => {
      const invocation = {
        body: { event: 'subscriber.created', id: '123', email: 'john@example.com' },
        queryParams: { connectionId: 'conn_1' },
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.connectionId).toBe('conn_1')
      expect(result.events).toHaveLength(1)
      expect(result.events[0].name).toBe('onSubscriberEvent')
      expect(result.events[0].data.event).toBe('subscriber.created')
    })

    it('resolves batch events from webhook body', async () => {
      const invocation = {
        body: {
          events: [
            { event: 'subscriber.created', id: '1' },
            { event: 'subscriber.updated', id: '2' },
          ],
        },
        queryParams: { connectionId: 'conn_1' },
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.events).toHaveLength(2)
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('delegates to the named event method', async () => {
      const invocation = {
        eventName: 'onSubscriberEvent',
        eventData: { event: 'subscriber.created' },
        triggers: [{ id: 'trigger1', data: { event: 'Subscriber Created' } }],
      }

      const result = await service.handleTriggerSelectMatched(invocation)

      expect(result).toEqual({ ids: ['trigger1'] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes webhooks by ID', async () => {
      mock.onDelete(`${ BASE }/webhooks/wh_1`).reply(undefined)
      mock.onDelete(`${ BASE }/webhooks/wh_2`).reply(undefined)

      const invocation = {
        webhookData: {
          webhooks: [
            { triggerId: 'trigger1', webhookId: 'wh_1' },
            { triggerId: 'trigger2', webhookId: 'wh_2' },
          ],
        },
      }

      const result = await service.handleTriggerDeleteWebhook(invocation)

      expect(result).toEqual({ webhookData: {} })
      expect(mock.history).toHaveLength(2)
    })

    it('skips webhooks without a webhookId', async () => {
      const invocation = {
        webhookData: {
          webhooks: [{ triggerId: 'trigger1', webhookId: null }],
        },
      }

      const result = await service.handleTriggerDeleteWebhook(invocation)

      expect(result).toEqual({ webhookData: {} })
      expect(mock.history).toHaveLength(0)
    })

    it('handles missing webhookData gracefully', async () => {
      const result = await service.handleTriggerDeleteWebhook({})

      expect(result).toEqual({ webhookData: {} })
    })

    it('continues even if a delete fails', async () => {
      mock.onDelete(`${ BASE }/webhooks/wh_1`).replyWithError({ message: 'Not found' })
      mock.onDelete(`${ BASE }/webhooks/wh_2`).reply(undefined)

      const invocation = {
        webhookData: {
          webhooks: [
            { triggerId: 'trigger1', webhookId: 'wh_1' },
            { triggerId: 'trigger2', webhookId: 'wh_2' },
          ],
        },
      }

      const result = await service.handleTriggerDeleteWebhook(invocation)

      expect(result).toEqual({ webhookData: {} })
      expect(mock.history).toHaveLength(2)
    })
  })
})
