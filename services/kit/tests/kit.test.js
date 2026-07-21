'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.kit.com/v4'

describe('Kit Service', () => {
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

    it('sends the X-Kit-Api-Key header on requests', async () => {
      mock.onGet(`${ BASE }/account`).reply({ account: { id: 1 } })

      await service.getAccount()

      expect(mock.history[0].headers).toMatchObject({
        'X-Kit-Api-Key': API_KEY,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Account ──

  describe('getAccount', () => {
    it('sends GET to /account', async () => {
      const response = { account: { id: 12345, name: 'Acme Newsletter' } }
      mock.onGet(`${ BASE }/account`).reply(response)

      const result = await service.getAccount()

      expect(result).toEqual(response)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/account`)
    })
  })

  // ── Subscribers ──

  describe('createSubscriber', () => {
    it('sends POST with required params only', async () => {
      const response = { subscriber: { id: 1, email_address: 'alice@example.com' } }
      mock.onPost(`${ BASE }/subscribers`).reply(response)

      const result = await service.createSubscriber('alice@example.com')

      expect(result).toEqual(response)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ email_address: 'alice@example.com' })
    })

    it('sends POST with all params', async () => {
      mock.onPost(`${ BASE }/subscribers`).reply({ subscriber: { id: 1 } })

      await service.createSubscriber('alice@example.com', 'Alice', 'Active', { Company: 'Acme' })

      expect(mock.history[0].body).toEqual({
        email_address: 'alice@example.com',
        first_name: 'Alice',
        state: 'active',
        fields: { Company: 'Acme' },
      })
    })

    it('maps Inactive state correctly', async () => {
      mock.onPost(`${ BASE }/subscribers`).reply({ subscriber: { id: 1 } })

      await service.createSubscriber('bob@example.com', undefined, 'Inactive')

      expect(mock.history[0].body).toEqual({
        email_address: 'bob@example.com',
        state: 'inactive',
      })
    })

    it('omits undefined optional fields', async () => {
      mock.onPost(`${ BASE }/subscribers`).reply({ subscriber: { id: 1 } })

      await service.createSubscriber('test@example.com', undefined, undefined, undefined)

      expect(mock.history[0].body).toEqual({ email_address: 'test@example.com' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/subscribers`).replyWithError({
        message: 'Bad Request',
        body: { errors: ['Email is invalid'] },
      })

      await expect(service.createSubscriber('bad')).rejects.toThrow('Kit API error')
    })
  })

  describe('getSubscriber', () => {
    it('sends GET to /subscribers/:id', async () => {
      const response = { subscriber: { id: 987, email_address: 'alice@example.com' } }
      mock.onGet(`${ BASE }/subscribers/987`).reply(response)

      const result = await service.getSubscriber('987')

      expect(result).toEqual(response)
      expect(mock.history[0].url).toBe(`${ BASE }/subscribers/987`)
    })
  })

  describe('listSubscribers', () => {
    it('sends GET with no filters', async () => {
      const response = { subscribers: [], pagination: {} }
      mock.onGet(`${ BASE }/subscribers`).reply(response)

      const result = await service.listSubscribers()

      expect(result).toEqual(response)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })

    it('sends query params for all filters', async () => {
      mock.onGet(`${ BASE }/subscribers`).reply({ subscribers: [], pagination: {} })

      await service.listSubscribers(
        'alice@example.com', 'Active', '2026-01-01', '2026-12-31', 10, 'cursor-abc', 'cursor-xyz'
      )

      expect(mock.history[0].query).toMatchObject({
        email_address: 'alice@example.com',
        status: 'active',
        created_after: '2026-01-01',
        created_before: '2026-12-31',
        per_page: 10,
        after: 'cursor-abc',
        before: 'cursor-xyz',
      })
    })

    it('maps status dropdown values correctly', async () => {
      mock.onGet(`${ BASE }/subscribers`).reply({ subscribers: [], pagination: {} })

      await service.listSubscribers(undefined, 'Bounced')

      expect(mock.history[0].query).toMatchObject({ status: 'bounced' })
    })

    it('maps All status correctly', async () => {
      mock.onGet(`${ BASE }/subscribers`).reply({ subscribers: [], pagination: {} })

      await service.listSubscribers(undefined, 'All')

      expect(mock.history[0].query).toMatchObject({ status: 'all' })
    })
  })

  describe('updateSubscriber', () => {
    it('sends PUT to /subscribers/:id with body', async () => {
      const response = { subscriber: { id: 987, first_name: 'Bob' } }
      mock.onPut(`${ BASE }/subscribers/987`).reply(response)

      const result = await service.updateSubscriber('987', 'bob@example.com', 'Bob', { Company: 'Acme' })

      expect(result).toEqual(response)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/subscribers/987`)
      expect(mock.history[0].body).toEqual({
        email_address: 'bob@example.com',
        first_name: 'Bob',
        fields: { Company: 'Acme' },
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPut(`${ BASE }/subscribers/987`).reply({ subscriber: { id: 987 } })

      await service.updateSubscriber('987')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('unsubscribeSubscriber', () => {
    it('sends POST to /subscribers/:id/unsubscribe and returns confirmation', async () => {
      mock.onPost(`${ BASE }/subscribers/987/unsubscribe`).reply({})

      const result = await service.unsubscribeSubscriber('987')

      expect(result).toEqual({ unsubscribed: true, subscriberId: '987' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/subscribers/987/unsubscribe`)
    })
  })

  // ── Tags ──

  describe('createTag', () => {
    it('sends POST to /tags with name', async () => {
      const response = { tag: { id: 54321, name: 'Newsletter' } }
      mock.onPost(`${ BASE }/tags`).reply(response)

      const result = await service.createTag('Newsletter')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ name: 'Newsletter' })
    })
  })

  describe('listTags', () => {
    it('sends GET to /tags with pagination', async () => {
      const response = { tags: [{ id: 1, name: 'Tag1' }], pagination: {} }
      mock.onGet(`${ BASE }/tags`).reply(response)

      const result = await service.listTags(10, 'cursor-abc')

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({ per_page: 10, after: 'cursor-abc' })
    })

    it('sends GET with no pagination params when not provided', async () => {
      mock.onGet(`${ BASE }/tags`).reply({ tags: [], pagination: {} })

      await service.listTags()

      expect(mock.history).toHaveLength(1)
    })
  })

  describe('tagSubscriber', () => {
    it('sends POST to /tags/:tagId/subscribers/:subscriberId', async () => {
      const response = { subscriber: { id: 987, tagged_at: '2026-01-15T09:30:00Z' } }
      mock.onPost(`${ BASE }/tags/54321/subscribers/987`).reply(response)

      const result = await service.tagSubscriber('54321', '987')

      expect(result).toEqual(response)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/tags/54321/subscribers/987`)
    })
  })

  describe('tagSubscriberByEmail', () => {
    it('sends POST to /tags/:tagId/subscribers with email body', async () => {
      const response = { subscriber: { id: 987 } }
      mock.onPost(`${ BASE }/tags/54321/subscribers`).reply(response)

      const result = await service.tagSubscriberByEmail('54321', 'alice@example.com')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ email_address: 'alice@example.com' })
    })
  })

  describe('removeTagFromSubscriber', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/tags/54321/subscribers/987`).reply({})

      const result = await service.removeTagFromSubscriber('54321', '987')

      expect(result).toEqual({ removed: true, tagId: '54321', subscriberId: '987' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/tags/54321/subscribers/987`)
    })
  })

  describe('listSubscribersForTag', () => {
    it('sends GET to /tags/:tagId/subscribers with filters', async () => {
      const response = { subscribers: [], pagination: {} }
      mock.onGet(`${ BASE }/tags/54321/subscribers`).reply(response)

      const result = await service.listSubscribersForTag(
        '54321', 'Active', '2026-01-01', '2026-12-31', 10, 'cursor-abc'
      )

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({
        status: 'active',
        created_after: '2026-01-01',
        created_before: '2026-12-31',
        per_page: 10,
        after: 'cursor-abc',
      })
    })

    it('sends GET with no optional filters', async () => {
      mock.onGet(`${ BASE }/tags/54321/subscribers`).reply({ subscribers: [], pagination: {} })

      await service.listSubscribersForTag('54321')

      expect(mock.history[0].url).toBe(`${ BASE }/tags/54321/subscribers`)
    })
  })

  // ── Forms ──

  describe('listForms', () => {
    it('sends GET to /forms with pagination', async () => {
      const response = { forms: [{ id: 1, name: 'Signup' }], pagination: {} }
      mock.onGet(`${ BASE }/forms`).reply(response)

      const result = await service.listForms(10, 'cursor-abc')

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({ per_page: 10, after: 'cursor-abc' })
    })
  })

  describe('addSubscriberToForm', () => {
    it('sends POST by subscriber ID', async () => {
      const response = { subscriber: { id: 987 } }
      mock.onPost(`${ BASE }/forms/23456/subscribers/987`).reply(response)

      const result = await service.addSubscriberToForm('23456', '987')

      expect(result).toEqual(response)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/forms/23456/subscribers/987`)
    })

    it('sends POST by email when subscriber ID is not provided', async () => {
      const response = { subscriber: { id: 987 } }
      mock.onPost(`${ BASE }/forms/23456/subscribers`).reply(response)

      const result = await service.addSubscriberToForm('23456', undefined, 'alice@example.com')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ email_address: 'alice@example.com' })
    })

    it('throws when neither subscriber ID nor email is provided', async () => {
      await expect(service.addSubscriberToForm('23456')).rejects.toThrow(
        'Provide a Subscriber ID or an Email Address to add to the form.'
      )
    })
  })

  // ── Sequences ──

  describe('listSequences', () => {
    it('sends GET to /sequences with pagination', async () => {
      const response = { sequences: [{ id: 1, name: 'Welcome' }], pagination: {} }
      mock.onGet(`${ BASE }/sequences`).reply(response)

      const result = await service.listSequences(10, 'cursor-abc')

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({ per_page: 10, after: 'cursor-abc' })
    })
  })

  describe('addSubscriberToSequence', () => {
    it('sends POST by subscriber ID', async () => {
      const response = { subscriber: { id: 987 } }
      mock.onPost(`${ BASE }/sequences/34567/subscribers/987`).reply(response)

      const result = await service.addSubscriberToSequence('34567', '987')

      expect(result).toEqual(response)
      expect(mock.history[0].url).toBe(`${ BASE }/sequences/34567/subscribers/987`)
    })

    it('sends POST by email when subscriber ID is not provided', async () => {
      const response = { subscriber: { id: 987 } }
      mock.onPost(`${ BASE }/sequences/34567/subscribers`).reply(response)

      const result = await service.addSubscriberToSequence('34567', undefined, 'alice@example.com')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ email_address: 'alice@example.com' })
    })

    it('throws when neither subscriber ID nor email is provided', async () => {
      await expect(service.addSubscriberToSequence('34567')).rejects.toThrow(
        'Provide a Subscriber ID or an Email Address to add to the sequence.'
      )
    })
  })

  // ── Custom Fields ──

  describe('listCustomFields', () => {
    it('sends GET to /custom_fields with pagination', async () => {
      const response = { custom_fields: [{ id: 1, label: 'Company' }], pagination: {} }
      mock.onGet(`${ BASE }/custom_fields`).reply(response)

      const result = await service.listCustomFields(10, 'cursor-abc')

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({ per_page: 10, after: 'cursor-abc' })
    })
  })

  describe('createCustomField', () => {
    it('sends POST to /custom_fields with label', async () => {
      const response = { custom_field: { id: 45678, label: 'Company' } }
      mock.onPost(`${ BASE }/custom_fields`).reply(response)

      const result = await service.createCustomField('Company')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ label: 'Company' })
    })
  })

  // ── Broadcasts ──

  describe('listBroadcasts', () => {
    it('sends GET to /broadcasts with pagination', async () => {
      const response = { broadcasts: [{ id: 1, subject: 'News' }], pagination: {} }
      mock.onGet(`${ BASE }/broadcasts`).reply(response)

      const result = await service.listBroadcasts(10, 'cursor-abc')

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({ per_page: 10, after: 'cursor-abc' })
    })
  })

  describe('createBroadcast', () => {
    it('sends POST with required params only', async () => {
      const response = { broadcast: { id: 67890, subject: 'Newsletter' } }
      mock.onPost(`${ BASE }/broadcasts`).reply(response)

      const result = await service.createBroadcast('Newsletter', '<p>Hello</p>')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ subject: 'Newsletter', content: '<p>Hello</p>' })
    })

    it('sends POST with all params', async () => {
      mock.onPost(`${ BASE }/broadcasts`).reply({ broadcast: { id: 67890 } })

      await service.createBroadcast(
        'Newsletter', '<p>Hello</p>', 'Preview', 'Internal desc', '999', '2026-06-01T15:00:00Z', true
      )

      expect(mock.history[0].body).toEqual({
        subject: 'Newsletter',
        content: '<p>Hello</p>',
        preview_text: 'Preview',
        description: 'Internal desc',
        email_template_id: 999,
        send_at: '2026-06-01T15:00:00Z',
        public: true,
      })
    })

    it('handles isPublic false', async () => {
      mock.onPost(`${ BASE }/broadcasts`).reply({ broadcast: { id: 67890 } })

      await service.createBroadcast('Subject', 'Content', undefined, undefined, undefined, undefined, false)

      expect(mock.history[0].body).toMatchObject({ public: false })
    })

    it('omits public when isPublic is undefined', async () => {
      mock.onPost(`${ BASE }/broadcasts`).reply({ broadcast: { id: 67890 } })

      await service.createBroadcast('Subject', 'Content')

      expect(mock.history[0].body).not.toHaveProperty('public')
    })
  })

  describe('getBroadcast', () => {
    it('sends GET to /broadcasts/:id', async () => {
      const response = { broadcast: { id: 67890, subject: 'Newsletter' } }
      mock.onGet(`${ BASE }/broadcasts/67890`).reply(response)

      const result = await service.getBroadcast('67890')

      expect(result).toEqual(response)
      expect(mock.history[0].url).toBe(`${ BASE }/broadcasts/67890`)
    })
  })

  describe('getBroadcastStats', () => {
    it('sends GET to /broadcasts/:id/stats', async () => {
      const response = { broadcast: { id: 67890, stats: { recipients: 1500 } } }
      mock.onGet(`${ BASE }/broadcasts/67890/stats`).reply(response)

      const result = await service.getBroadcastStats('67890')

      expect(result).toEqual(response)
      expect(mock.history[0].url).toBe(`${ BASE }/broadcasts/67890/stats`)
    })
  })

  // ── Dictionary Methods ──

  describe('getTagsDictionary', () => {
    it('maps tags to dictionary items', async () => {
      mock.onGet(`${ BASE }/tags`).reply({
        tags: [
          { id: 1, name: 'Newsletter' },
          { id: 2, name: 'VIP' },
        ],
        pagination: { has_next_page: false, end_cursor: null },
      })

      const result = await service.getTagsDictionary({})

      expect(result.items).toEqual([
        { label: 'Newsletter', value: '1', note: 'Tag' },
        { label: 'VIP', value: '2', note: 'Tag' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/tags`).reply({
        tags: [
          { id: 1, name: 'Newsletter' },
          { id: 2, name: 'VIP' },
        ],
        pagination: { has_next_page: false },
      })

      const result = await service.getTagsDictionary({ search: 'news' })

      expect(result.items).toEqual([
        { label: 'Newsletter', value: '1', note: 'Tag' },
      ])
    })

    it('returns cursor when has_next_page is true', async () => {
      mock.onGet(`${ BASE }/tags`).reply({
        tags: [{ id: 1, name: 'Tag1' }],
        pagination: { has_next_page: true, end_cursor: 'next-cursor' },
      })

      const result = await service.getTagsDictionary({})

      expect(result.cursor).toBe('next-cursor')
    })

    it('passes cursor to listTags', async () => {
      mock.onGet(`${ BASE }/tags`).reply({
        tags: [],
        pagination: { has_next_page: false },
      })

      await service.getTagsDictionary({ cursor: 'abc' })

      expect(mock.history[0].query).toMatchObject({ after: 'abc', per_page: 500 })
    })
  })

  describe('getFormsDictionary', () => {
    it('maps forms to dictionary items with type as note', async () => {
      mock.onGet(`${ BASE }/forms`).reply({
        forms: [
          { id: 1, name: 'Homepage Signup', type: 'embed' },
          { id: 2, name: 'Landing Page', type: 'hosted' },
        ],
        pagination: { has_next_page: false },
      })

      const result = await service.getFormsDictionary({})

      expect(result.items).toEqual([
        { label: 'Homepage Signup', value: '1', note: 'embed' },
        { label: 'Landing Page', value: '2', note: 'hosted' },
      ])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/forms`).reply({
        forms: [
          { id: 1, name: 'Homepage Signup', type: 'embed' },
          { id: 2, name: 'Landing Page', type: 'hosted' },
        ],
        pagination: { has_next_page: false },
      })

      const result = await service.getFormsDictionary({ search: 'landing' })

      expect(result.items).toEqual([
        { label: 'Landing Page', value: '2', note: 'hosted' },
      ])
    })

    it('uses "Form" as note when type is missing', async () => {
      mock.onGet(`${ BASE }/forms`).reply({
        forms: [{ id: 1, name: 'Test' }],
        pagination: { has_next_page: false },
      })

      const result = await service.getFormsDictionary({})

      expect(result.items[0].note).toBe('Form')
    })
  })

  describe('getSequencesDictionary', () => {
    it('maps sequences to dictionary items', async () => {
      mock.onGet(`${ BASE }/sequences`).reply({
        sequences: [
          { id: 1, name: 'Welcome Series' },
          { id: 2, name: 'Onboarding' },
        ],
        pagination: { has_next_page: false },
      })

      const result = await service.getSequencesDictionary({})

      expect(result.items).toEqual([
        { label: 'Welcome Series', value: '1', note: 'Sequence' },
        { label: 'Onboarding', value: '2', note: 'Sequence' },
      ])
    })

    it('filters by search and returns cursor', async () => {
      mock.onGet(`${ BASE }/sequences`).reply({
        sequences: [
          { id: 1, name: 'Welcome Series' },
          { id: 2, name: 'Onboarding' },
        ],
        pagination: { has_next_page: true, end_cursor: 'seq-cursor' },
      })

      const result = await service.getSequencesDictionary({ search: 'welcome' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Welcome Series')
      expect(result.cursor).toBe('seq-cursor')
    })
  })

  // ── Trigger: onKitEvent ──

  describe('onKitEvent', () => {
    it('shapes event from webhook invocation (SHAPE_EVENT)', () => {
      const payload = {
        queryParams: { kitEvent: 'subscriber.tag_add', triggerId: 'tr-1' },
        body: {
          subscriber: {
            id: 987,
            email_address: 'alice@example.com',
            first_name: 'Alice',
            state: 'active',
          },
        },
      }

      const result = service.onKitEvent('SHAPE_EVENT', payload)

      expect(result).toEqual([{
        name: 'onKitEvent',
        data: {
          event: 'subscriber.tag_add',
          triggerId: 'tr-1',
          subscriberId: 987,
          emailAddress: 'alice@example.com',
          firstName: 'Alice',
          state: 'active',
          subscriber: payload.body.subscriber,
          payload: payload.body,
        },
      }])
    })

    it('handles missing subscriber in SHAPE_EVENT', () => {
      const payload = { queryParams: { kitEvent: 'purchase.purchase_create' }, body: {} }

      const result = service.onKitEvent('SHAPE_EVENT', payload)

      expect(result[0].data.subscriberId).toBeNull()
      expect(result[0].data.emailAddress).toBeNull()
      expect(result[0].data.subscriber).toBeNull()
    })

    it('filters triggers by triggerId in FILTER_TRIGGER', () => {
      const payload = {
        eventData: { triggerId: 'tr-1', event: 'subscriber.tag_add' },
        triggers: [
          { id: 'tr-1', data: { event: 'Tag Added' } },
          { id: 'tr-2', data: { event: 'Tag Removed' } },
        ],
      }

      const result = service.onKitEvent('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['tr-1'] })
    })

    it('falls back to event name matching when triggerId is missing', () => {
      const payload = {
        eventData: { event: 'subscriber.tag_add' },
        triggers: [
          { id: 'tr-1', data: { event: 'Tag Added' } },
          { id: 'tr-2', data: { event: 'Subscriber Activated' } },
        ],
      }

      const result = service.onKitEvent('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['tr-1'] })
    })

    it('returns empty ids when no triggers match', () => {
      const payload = {
        eventData: { event: 'subscriber.subscriber_bounce' },
        triggers: [
          { id: 'tr-1', data: { event: 'Tag Added' } },
        ],
      }

      const result = service.onKitEvent('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: [] })
    })
  })

  // ── System Trigger Handlers ──

  describe('handleTriggerUpsertWebhook', () => {
    it('creates a webhook for a simple event', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ webhook: { id: 'wh-1' } })

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://cb.example.com/hook',
        connectionId: 'conn-1',
        events: [{ id: 'tr-1', triggerData: { event: 'Subscriber Activated' } }],
      })

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toMatchObject({
        event: { name: 'subscriber.subscriber_activate' },
      })
      expect(mock.history[0].body.target_url).toContain('triggerId=tr-1')
      expect(mock.history[0].body.target_url).toContain('kitEvent=subscriber.subscriber_activate')
      expect(mock.history[0].body.target_url).toContain('connectionId=conn-1')
      expect(result.webhookData.webhooks).toEqual([
        { triggerId: 'tr-1', webhookId: 'wh-1', event: 'subscriber.subscriber_activate' },
      ])
      expect(result.connectionId).toBe('conn-1')
    })

    it('creates a webhook with extra param for tag event', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ webhook: { id: 'wh-2' } })

      await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://cb.example.com/hook',
        connectionId: 'conn-1',
        events: [{ id: 'tr-2', triggerData: { event: 'Tag Added', tagId: '54321' } }],
      })

      expect(mock.history[0].body.event).toEqual({
        name: 'subscriber.tag_add',
        tag_id: 54321,
      })
    })

    it('creates a webhook with initiator_value for link click event', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ webhook: { id: 'wh-3' } })

      await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://cb.example.com/hook',
        connectionId: 'conn-1',
        events: [{ id: 'tr-3', triggerData: { event: 'Link Clicked', linkUrl: 'https://example.com' } }],
      })

      expect(mock.history[0].body.event).toEqual({
        name: 'subscriber.link_click',
        initiator_value: 'https://example.com',
      })
    })

    it('throws when event selection is missing', async () => {
      await expect(
        service.handleTriggerUpsertWebhook({
          callbackUrl: 'https://cb.example.com/hook',
          connectionId: 'conn-1',
          events: [{ id: 'tr-x', triggerData: {} }],
        })
      ).rejects.toThrow('missing an Event selection')
    })

    it('throws when extra param is missing for tag event', async () => {
      await expect(
        service.handleTriggerUpsertWebhook({
          callbackUrl: 'https://cb.example.com/hook',
          connectionId: 'conn-1',
          events: [{ id: 'tr-x', triggerData: { event: 'Tag Added' } }],
        })
      ).rejects.toThrow('requires the Tag parameter')
    })

    it('appends query params correctly when callbackUrl already has a query string', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ webhook: { id: 'wh-4' } })

      await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://cb.example.com/hook?existing=true',
        connectionId: 'conn-1',
        events: [{ id: 'tr-1', triggerData: { event: 'Subscriber Activated' } }],
      })

      expect(mock.history[0].body.target_url).toMatch(/\?existing=true&connectionId=/)
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('returns shaped events for non-empty body', async () => {
      const invocation = {
        queryParams: { connectionId: 'conn-1', kitEvent: 'subscriber.tag_add', triggerId: 'tr-1' },
        body: { subscriber: { id: 987, email_address: 'alice@example.com' } },
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.connectionId).toBe('conn-1')
      expect(result.events).toHaveLength(1)
      expect(result.events[0].name).toBe('onKitEvent')
      expect(result.events[0].data.event).toBe('subscriber.tag_add')
    })

    it('returns handshake response for empty body', async () => {
      const result = await service.handleTriggerResolveEvents({ body: {} })

      expect(result.handshake).toBe(true)
    })

    it('returns handshake response for missing invocation', async () => {
      const result = await service.handleTriggerResolveEvents(null)

      expect(result.handshake).toBe(true)
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('delegates to onKitEvent FILTER_TRIGGER', async () => {
      const invocation = {
        eventName: 'onKitEvent',
        eventData: { triggerId: 'tr-1' },
        triggers: [{ id: 'tr-1', data: { event: 'Tag Added' } }],
      }

      const result = await service.handleTriggerSelectMatched(invocation)

      expect(result).toEqual({ ids: ['tr-1'] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes each stored webhook and clears webhookData', async () => {
      mock.onDelete(`${ BASE }/webhooks/wh-1`).reply({})
      mock.onDelete(`${ BASE }/webhooks/wh-2`).reply({})

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { webhooks: [{ webhookId: 'wh-1' }, { webhookId: 'wh-2' }] },
      })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].url).toBe(`${ BASE }/webhooks/wh-1`)
      expect(mock.history[1].url).toBe(`${ BASE }/webhooks/wh-2`)
      expect(result).toEqual({ webhookData: {} })
    })

    it('skips webhooks without webhookId', async () => {
      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { webhooks: [{ triggerId: 'tr-1' }] },
      })

      expect(mock.history).toHaveLength(0)
      expect(result).toEqual({ webhookData: {} })
    })

    it('swallows individual delete errors', async () => {
      mock.onDelete(`${ BASE }/webhooks/wh-1`).replyWithError({ message: 'gone' })

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { webhooks: [{ webhookId: 'wh-1' }] },
      })

      expect(result).toEqual({ webhookData: {} })
    })

    it('handles missing webhookData gracefully', async () => {
      const result = await service.handleTriggerDeleteWebhook({})

      expect(mock.history).toHaveLength(0)
      expect(result).toEqual({ webhookData: {} })
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('formats Kit errors array into message', async () => {
      mock.onGet(`${ BASE }/account`).replyWithError({
        message: 'Unauthorized',
        body: { errors: ['Invalid API key', 'Access denied'] },
      })

      await expect(service.getAccount()).rejects.toThrow('Kit API error: Invalid API key; Access denied')
    })

    it('falls back to error.body.error', async () => {
      mock.onGet(`${ BASE }/account`).replyWithError({
        message: 'Unauthorized',
        body: { error: 'Token expired' },
      })

      await expect(service.getAccount()).rejects.toThrow('Kit API error: Token expired')
    })

    it('falls back to error.message', async () => {
      mock.onGet(`${ BASE }/account`).replyWithError({ message: 'Network error' })

      await expect(service.getAccount()).rejects.toThrow('Kit API error: Network error')
    })
  })
})
