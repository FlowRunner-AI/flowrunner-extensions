'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SITE_ID = 'test-site-id'
const TRACK_API_KEY = 'test-track-key'
const APP_API_KEY = 'test-app-key'

// Basic base64('test-site-id:test-track-key')
const TRACK_AUTH = `Basic ${ Buffer.from(`${ SITE_ID }:${ TRACK_API_KEY }`).toString('base64') }`
const APP_AUTH = `Bearer ${ APP_API_KEY }`

const TRACK_US = 'https://track.customer.io/api/v1'
const APP_US = 'https://api.customer.io/v1'
const TRACK_EU = 'https://track-eu.customer.io/api/v1'
const APP_EU = 'https://api-eu.customer.io/v1'

function buildSandbox(config) {
  const sandbox = createSandbox(config)
  jest.isolateModules(() => {
    require('../src/index.js')
  })

  return {
    sandbox,
    service: sandbox.getService(),
    mock: sandbox.getRequestMock(),
  }
}

describe('Customer.io Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    const built = buildSandbox({
      siteId: SITE_ID,
      trackApiKey: TRACK_API_KEY,
      appApiKey: APP_API_KEY,
      region: 'US',
    })

    sandbox = built.sandbox
    service = built.service
    mock = built.mock
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers the four config items with correct flags', () => {
      const items = sandbox.getConfigItems()

      expect(items).toEqual([
        expect.objectContaining({ name: 'siteId', displayName: 'Site ID', type: 'STRING', required: true, shared: false }),
        expect.objectContaining({ name: 'trackApiKey', displayName: 'Track API Key', type: 'STRING', required: true, shared: false }),
        expect.objectContaining({ name: 'appApiKey', displayName: 'App API Key', type: 'STRING', required: false, shared: false }),
        expect.objectContaining({ name: 'region', displayName: 'Region', type: 'CHOICE', required: true, shared: false, defaultValue: 'US' }),
      ])
    })

    it('exposes US/EU options on the region config item', () => {
      const region = sandbox.getConfigItems().find(item => item.name === 'region')

      expect(region.options).toEqual(['US', 'EU'])
    })
  })

  // ── People (Track API) ──

  describe('identifyPerson', () => {
    it('PUTs to the track customers endpoint with Basic auth and attributes body', async () => {
      mock.onPut(`${ TRACK_US }/customers/ada%40example.com`).reply({})

      const result = await service.identifyPerson('ada@example.com', { first_name: 'Ada', plan: 'pro' })

      expect(result).toEqual({ success: true, identifier: 'ada@example.com' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ TRACK_US }/customers/ada%40example.com`)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': TRACK_AUTH,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toEqual({ first_name: 'Ada', plan: 'pro' })
    })

    it('sends an empty object body when attributes are omitted', async () => {
      mock.onPut(`${ TRACK_US }/customers/user_1`).reply({})

      await service.identifyPerson('user_1')

      expect(mock.history[0].body).toEqual({})
    })

    it('wraps API errors', async () => {
      mock.onPut(`${ TRACK_US }/customers/ada%40example.com`).replyWithError({ message: 'Bad Request' })

      await expect(service.identifyPerson('ada@example.com', {})).rejects.toThrow(
        'Customer.io API error: Bad Request'
      )
    })
  })

  describe('deletePerson', () => {
    it('DELETEs the track customers endpoint', async () => {
      mock.onDelete(`${ TRACK_US }/customers/ada%40example.com`).reply({})

      const result = await service.deletePerson('ada@example.com')

      expect(result).toEqual({ success: true, personId: 'ada@example.com' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ TRACK_US }/customers/ada%40example.com`)
      expect(mock.history[0].headers.Authorization).toBe(TRACK_AUTH)
      expect(mock.history[0].body).toBeUndefined()
    })

    it('wraps API errors', async () => {
      mock.onDelete(`${ TRACK_US }/customers/user_1`).replyWithError({ message: 'Not found' })

      await expect(service.deletePerson('user_1')).rejects.toThrow('Customer.io API error: Not found')
    })
  })

  describe('suppressPerson', () => {
    it('POSTs to the suppress endpoint with an empty body', async () => {
      mock.onPost(`${ TRACK_US }/customers/user_1/suppress`).reply({})

      const result = await service.suppressPerson('user_1')

      expect(result).toEqual({ success: true, personId: 'user_1' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ TRACK_US }/customers/user_1/suppress`)
      expect(mock.history[0].body).toEqual({})
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ TRACK_US }/customers/user_1/suppress`).replyWithError({ message: 'Boom' })

      await expect(service.suppressPerson('user_1')).rejects.toThrow('Customer.io API error: Boom')
    })
  })

  describe('unsuppressPerson', () => {
    it('POSTs to the unsuppress endpoint with an empty body', async () => {
      mock.onPost(`${ TRACK_US }/customers/user_1/unsuppress`).reply({})

      const result = await service.unsuppressPerson('user_1')

      expect(result).toEqual({ success: true, personId: 'user_1' })
      expect(mock.history[0].url).toBe(`${ TRACK_US }/customers/user_1/unsuppress`)
      expect(mock.history[0].body).toEqual({})
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ TRACK_US }/customers/user_1/unsuppress`).replyWithError({ message: 'Boom' })

      await expect(service.unsuppressPerson('user_1')).rejects.toThrow('Customer.io API error: Boom')
    })
  })

  // ── Events (Track API) ──

  describe('trackEvent', () => {
    it('POSTs a named event with data', async () => {
      mock.onPost(`${ TRACK_US }/customers/ada%40example.com/events`).reply({})

      const result = await service.trackEvent('ada@example.com', 'purchase', { plan: 'pro', amount: 99 })

      expect(result).toEqual({ success: true, personId: 'ada@example.com', eventName: 'purchase' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ TRACK_US }/customers/ada%40example.com/events`)
      expect(mock.history[0].headers.Authorization).toBe(TRACK_AUTH)
      expect(mock.history[0].body).toEqual({ name: 'purchase', data: { plan: 'pro', amount: 99 } })
    })

    it('omits the data property when no data is provided', async () => {
      mock.onPost(`${ TRACK_US }/customers/user_1/events`).reply({})

      await service.trackEvent('user_1', 'signed_up')

      expect(mock.history[0].body).toEqual({ name: 'signed_up' })
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ TRACK_US }/customers/user_1/events`).replyWithError({ message: 'Boom' })

      await expect(service.trackEvent('user_1', 'x')).rejects.toThrow('Customer.io API error: Boom')
    })
  })

  describe('trackAnonymousEvent', () => {
    it('POSTs an anonymous event with data and anonymous id', async () => {
      mock.onPost(`${ TRACK_US }/events`).reply({})

      const result = await service.trackAnonymousEvent('invite_sent', { recipient: 'x@y.com' }, 'anon_1')

      expect(result).toEqual({ success: true, eventName: 'invite_sent' })
      expect(mock.history[0].url).toBe(`${ TRACK_US }/events`)
      expect(mock.history[0].body).toEqual({
        name: 'invite_sent',
        data: { recipient: 'x@y.com' },
        anonymous_id: 'anon_1',
      })
    })

    it('omits data and anonymous_id when not provided', async () => {
      mock.onPost(`${ TRACK_US }/events`).reply({})

      await service.trackAnonymousEvent('invite_sent')

      expect(mock.history[0].body).toEqual({ name: 'invite_sent' })
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ TRACK_US }/events`).replyWithError({ message: 'Boom' })

      await expect(service.trackAnonymousEvent('x')).rejects.toThrow('Customer.io API error: Boom')
    })
  })

  // ── Segments ──

  describe('addToManualSegment', () => {
    it('POSTs person ids to the add_customers endpoint (Track API)', async () => {
      mock.onPost(`${ TRACK_US }/segments/7/add_customers`).reply({})

      const result = await service.addToManualSegment('7', ['user_1', 'user_2'])

      expect(result).toEqual({ success: true, segmentId: '7', count: 2 })
      expect(mock.history[0].url).toBe(`${ TRACK_US }/segments/7/add_customers`)
      expect(mock.history[0].headers.Authorization).toBe(TRACK_AUTH)
      expect(mock.history[0].body).toEqual({ ids: ['user_1', 'user_2'] })
    })

    it('reports a zero count when person ids is nullish', async () => {
      mock.onPost(`${ TRACK_US }/segments/7/add_customers`).reply({})

      const result = await service.addToManualSegment('7', undefined)

      expect(result).toEqual({ success: true, segmentId: '7', count: 0 })
      expect(mock.history[0].body).toEqual({ ids: undefined })
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ TRACK_US }/segments/7/add_customers`).replyWithError({ message: 'Boom' })

      await expect(service.addToManualSegment('7', ['x'])).rejects.toThrow('Customer.io API error: Boom')
    })
  })

  describe('removeFromManualSegment', () => {
    it('POSTs person ids to the remove_customers endpoint (Track API)', async () => {
      mock.onPost(`${ TRACK_US }/segments/7/remove_customers`).reply({})

      const result = await service.removeFromManualSegment('7', ['user_1', 'user_2'])

      expect(result).toEqual({ success: true, segmentId: '7', count: 2 })
      expect(mock.history[0].url).toBe(`${ TRACK_US }/segments/7/remove_customers`)
      expect(mock.history[0].body).toEqual({ ids: ['user_1', 'user_2'] })
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ TRACK_US }/segments/7/remove_customers`).replyWithError({ message: 'Boom' })

      await expect(service.removeFromManualSegment('7', ['x'])).rejects.toThrow('Customer.io API error: Boom')
    })
  })

  describe('listSegments', () => {
    it('GETs the App API segments endpoint with Bearer auth', async () => {
      mock.onGet(`${ APP_US }/segments`).reply({ segments: [{ id: 7, name: 'Manual', type: 'manual' }] })

      const result = await service.listSegments()

      expect(result).toEqual({ segments: [{ id: 7, name: 'Manual', type: 'manual' }] })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ APP_US }/segments`)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': APP_AUTH,
        'Content-Type': 'application/json',
      })
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ APP_US }/segments`).replyWithError({ message: 'Unauthorized' })

      await expect(service.listSegments()).rejects.toThrow('Customer.io API error: Unauthorized')
    })
  })

  // ── Messaging (App API) ──

  describe('sendTransactionalEmail', () => {
    it('POSTs to the App API send/email endpoint with required params (uses person email)', async () => {
      mock.onPost(`${ APP_US }/send/email`).reply({ delivery_id: 'abc', queued_at: 1 })

      const result = await service.sendTransactionalEmail('5', 'to@example.com', 'person@example.com')

      expect(result).toEqual({ delivery_id: 'abc', queued_at: 1 })
      expect(mock.history[0].url).toBe(`${ APP_US }/send/email`)
      expect(mock.history[0].headers.Authorization).toBe(APP_AUTH)
      expect(mock.history[0].body).toEqual({
        transactional_message_id: '5',
        to: 'to@example.com',
        identifiers: { email: 'person@example.com' },
      })
    })

    it('prefers person id over person email and includes all overrides', async () => {
      mock.onPost(`${ APP_US }/send/email`).reply({ delivery_id: 'abc' })

      await service.sendTransactionalEmail(
        '5',
        'to@example.com',
        'person@example.com',
        'user_42',
        { order_id: 'A-1234' },
        'Support <support@example.com>',
        'Your order',
        '<p>Hi</p>'
      )

      expect(mock.history[0].body).toEqual({
        transactional_message_id: '5',
        to: 'to@example.com',
        identifiers: { id: 'user_42' },
        message_data: { order_id: 'A-1234' },
        from: 'Support <support@example.com>',
        subject: 'Your order',
        body: '<p>Hi</p>',
      })
    })

    it('throws when neither person id nor person email is provided (no request made)', async () => {
      await expect(
        service.sendTransactionalEmail('5', 'to@example.com')
      ).rejects.toThrow('Customer.io API error: provide either Person ID or Person Email')

      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ APP_US }/send/email`).replyWithError({ message: 'Template not found' })

      await expect(
        service.sendTransactionalEmail('5', 'to@example.com', 'person@example.com')
      ).rejects.toThrow('Customer.io API error: Template not found')
    })
  })

  describe('triggerBroadcast', () => {
    it('POSTs to the App API broadcast triggers endpoint with data and recipients', async () => {
      mock.onPost(`${ APP_US }/campaigns/12/triggers`).reply({ id: 3, broadcast_id: 12 })

      const result = await service.triggerBroadcast('12', { headline: 'Flash sale' }, { segment: { id: 7 } })

      expect(result).toEqual({ id: 3, broadcast_id: 12 })
      expect(mock.history[0].url).toBe(`${ APP_US }/campaigns/12/triggers`)
      expect(mock.history[0].headers.Authorization).toBe(APP_AUTH)
      expect(mock.history[0].body).toEqual({
        data: { headline: 'Flash sale' },
        recipients: { segment: { id: 7 } },
      })
    })

    it('sends an empty body when data and recipients are omitted', async () => {
      mock.onPost(`${ APP_US }/campaigns/12/triggers`).reply({ id: 3 })

      await service.triggerBroadcast('12')

      expect(mock.history[0].body).toEqual({})
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ APP_US }/campaigns/12/triggers`).replyWithError({ message: 'Boom' })

      await expect(service.triggerBroadcast('12')).rejects.toThrow('Customer.io API error: Boom')
    })
  })

  describe('listTransactionalMessages', () => {
    it('GETs the App API transactional endpoint', async () => {
      mock.onGet(`${ APP_US }/transactional`).reply({ messages: [{ id: 5, name: 'Order Confirmation' }] })

      const result = await service.listTransactionalMessages()

      expect(result).toEqual({ messages: [{ id: 5, name: 'Order Confirmation' }] })
      expect(mock.history[0].url).toBe(`${ APP_US }/transactional`)
      expect(mock.history[0].headers.Authorization).toBe(APP_AUTH)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ APP_US }/transactional`).replyWithError({ message: 'Boom' })

      await expect(service.listTransactionalMessages()).rejects.toThrow('Customer.io API error: Boom')
    })
  })

  // ── Customers (App API) ──

  describe('searchCustomers', () => {
    it('builds an eq filter from attribute name/value and sends default limit', async () => {
      mock.onPost(`${ APP_US }/customers`).reply({ identifiers: [], ids: [] })

      const result = await service.searchCustomers('email', 'ada@example.com')

      expect(result).toEqual({ identifiers: [], ids: [] })
      expect(mock.history[0].url).toBe(`${ APP_US }/customers`)
      expect(mock.history[0].headers.Authorization).toBe(APP_AUTH)
      expect(mock.history[0].query).toEqual({ limit: 50 })
      expect(mock.history[0].body).toEqual({
        filter: {
          and: [{ attribute: { field: 'email', operator: 'eq', value: 'ada@example.com' } }],
        },
      })
    })

    it('uses a raw filter over the attribute pair and passes limit + start cursor', async () => {
      mock.onPost(`${ APP_US }/customers`).reply({ identifiers: [] })

      const rawFilter = { and: [{ attribute: { field: 'plan', operator: 'eq', value: 'pro' } }] }
      await service.searchCustomers('ignored', 'ignored', rawFilter, 100, 'cursor_xyz')

      expect(mock.history[0].query).toEqual({ limit: 100, start: 'cursor_xyz' })
      expect(mock.history[0].body).toEqual({ filter: rawFilter })
    })

    it('throws when neither attribute name nor raw filter is provided (no request made)', async () => {
      await expect(service.searchCustomers()).rejects.toThrow(
        'Customer.io API error: provide either an Attribute Name/Value pair or a Raw Filter object.'
      )

      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ APP_US }/customers`).replyWithError({ message: 'Boom' })

      await expect(service.searchCustomers('email', 'x@y.com')).rejects.toThrow('Customer.io API error: Boom')
    })
  })

  describe('getCustomerAttributes', () => {
    it('GETs the App API customer attributes endpoint', async () => {
      mock.onGet(`${ APP_US }/customers/ada%40example.com/attributes`).reply({ customer: { id: 'user_42' } })

      const result = await service.getCustomerAttributes('ada@example.com')

      expect(result).toEqual({ customer: { id: 'user_42' } })
      expect(mock.history[0].url).toBe(`${ APP_US }/customers/ada%40example.com/attributes`)
      expect(mock.history[0].headers.Authorization).toBe(APP_AUTH)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ APP_US }/customers/user_1/attributes`).replyWithError({ message: 'Boom' })

      await expect(service.getCustomerAttributes('user_1')).rejects.toThrow('Customer.io API error: Boom')
    })
  })

  describe('listCustomerActivities', () => {
    it('GETs activities with no filters and empty query', async () => {
      mock.onGet(`${ APP_US }/customers/user_1/activities`).reply({ activities: [], next: '' })

      const result = await service.listCustomerActivities('user_1')

      expect(result).toEqual({ activities: [], next: '' })
      expect(mock.history[0].url).toBe(`${ APP_US }/customers/user_1/activities`)
      expect(mock.history[0].query).toEqual({})
    })

    it('maps the activity type label to the API type and passes name + limit', async () => {
      mock.onGet(`${ APP_US }/customers/user_1/activities`).reply({ activities: [] })

      await service.listCustomerActivities('user_1', 'Email Opened', 'purchase', 25)

      expect(mock.history[0].query).toEqual({ type: 'opened_email', name: 'purchase', limit: 25 })
    })

    it('passes an unknown activity type through unchanged', async () => {
      mock.onGet(`${ APP_US }/customers/user_1/activities`).reply({ activities: [] })

      await service.listCustomerActivities('user_1', 'custom_type')

      expect(mock.history[0].query).toEqual({ type: 'custom_type' })
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ APP_US }/customers/user_1/activities`).replyWithError({ message: 'Boom' })

      await expect(service.listCustomerActivities('user_1')).rejects.toThrow('Customer.io API error: Boom')
    })
  })

  // ── Campaigns (App API) ──

  describe('listCampaigns', () => {
    it('GETs the App API campaigns endpoint', async () => {
      mock.onGet(`${ APP_US }/campaigns`).reply({ campaigns: [{ id: 3, name: 'Welcome Series' }] })

      const result = await service.listCampaigns()

      expect(result).toEqual({ campaigns: [{ id: 3, name: 'Welcome Series' }] })
      expect(mock.history[0].url).toBe(`${ APP_US }/campaigns`)
      expect(mock.history[0].headers.Authorization).toBe(APP_AUTH)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ APP_US }/campaigns`).replyWithError({ message: 'Boom' })

      await expect(service.listCampaigns()).rejects.toThrow('Customer.io API error: Boom')
    })
  })

  describe('getCampaignMetrics', () => {
    it('GETs metrics with the default period (days) when none provided', async () => {
      mock.onGet(`${ APP_US }/campaigns/3/metrics`).reply({ metric: { series: {} } })

      const result = await service.getCampaignMetrics(3)

      expect(result).toEqual({ metric: { series: {} } })
      expect(mock.history[0].url).toBe(`${ APP_US }/campaigns/3/metrics`)
      expect(mock.history[0].query).toEqual({ period: 'days' })
    })

    it('maps the period label to the API value and passes steps', async () => {
      mock.onGet(`${ APP_US }/campaigns/3/metrics`).reply({ metric: {} })

      await service.getCampaignMetrics(3, 'Weeks', 12)

      expect(mock.history[0].query).toEqual({ period: 'weeks', steps: 12 })
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ APP_US }/campaigns/3/metrics`).replyWithError({ message: 'Boom' })

      await expect(service.getCampaignMetrics(3)).rejects.toThrow('Customer.io API error: Boom')
    })
  })

  // ── Dictionaries (App API) ──

  describe('getSegmentsDictionary', () => {
    it('maps only manual segments to items', async () => {
      mock.onGet(`${ APP_US }/segments`).reply({
        segments: [
          { id: 7, name: 'Manual Segment', description: 'People added via API', type: 'manual' },
          { id: 8, name: 'Data Driven', type: 'dynamic' },
        ],
      })

      const result = await service.getSegmentsDictionary({})

      expect(mock.history[0].url).toBe(`${ APP_US }/segments`)
      expect(mock.history[0].headers.Authorization).toBe(APP_AUTH)
      expect(result).toEqual({
        items: [{ label: 'Manual Segment', value: '7', note: 'People added via API' }],
        cursor: null,
      })
    })

    it('falls back to the type as note when there is no description', async () => {
      mock.onGet(`${ APP_US }/segments`).reply({
        segments: [{ id: 9, name: 'No Desc', type: 'manual' }],
      })

      const result = await service.getSegmentsDictionary({})

      expect(result.items).toEqual([{ label: 'No Desc', value: '9', note: 'manual' }])
    })

    it('filters manual segments by search term', async () => {
      mock.onGet(`${ APP_US }/segments`).reply({
        segments: [
          { id: 7, name: 'VIP Customers', type: 'manual' },
          { id: 8, name: 'Newsletter', type: 'manual' },
        ],
      })

      const result = await service.getSegmentsDictionary({ search: 'vip' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('7')
    })

    it('handles a null payload and a missing segments array', async () => {
      mock.onGet(`${ APP_US }/segments`).reply({})

      const result = await service.getSegmentsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('propagates API errors (App API key required)', async () => {
      mock.onGet(`${ APP_US }/segments`).replyWithError({ message: 'Unauthorized' })

      await expect(service.getSegmentsDictionary({})).rejects.toThrow('Customer.io API error: Unauthorized')
    })
  })

  describe('getTransactionalMessagesDictionary', () => {
    it('maps transactional messages to items', async () => {
      mock.onGet(`${ APP_US }/transactional`).reply({
        messages: [
          { id: 5, name: 'Order Confirmation', description: 'Sent after purchase' },
          { id: 6, name: 'Password Reset' },
        ],
      })

      const result = await service.getTransactionalMessagesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Order Confirmation', value: '5', note: 'Sent after purchase' },
          { label: 'Password Reset', value: '6', note: undefined },
        ],
        cursor: null,
      })
    })

    it('filters by search term', async () => {
      mock.onGet(`${ APP_US }/transactional`).reply({
        messages: [
          { id: 5, name: 'Order Confirmation' },
          { id: 6, name: 'Password Reset' },
        ],
      })

      const result = await service.getTransactionalMessagesDictionary({ search: 'reset' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('6')
    })

    it('handles a missing messages array', async () => {
      mock.onGet(`${ APP_US }/transactional`).reply({})

      const result = await service.getTransactionalMessagesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('propagates API errors', async () => {
      mock.onGet(`${ APP_US }/transactional`).replyWithError({ message: 'Boom' })

      await expect(service.getTransactionalMessagesDictionary({})).rejects.toThrow('Customer.io API error: Boom')
    })
  })

  describe('getBroadcastsDictionary', () => {
    it('maps broadcasts to items with active/inactive note', async () => {
      mock.onGet(`${ APP_US }/broadcasts`).reply({
        broadcasts: [
          { id: 12, name: 'Flash Sale', active: true },
          { id: 13, name: 'Retired Promo', active: false },
          { id: 14, name: 'Unknown State' },
        ],
      })

      const result = await service.getBroadcastsDictionary({})

      expect(mock.history[0].url).toBe(`${ APP_US }/broadcasts`)
      expect(result).toEqual({
        items: [
          { label: 'Flash Sale', value: '12', note: 'active' },
          { label: 'Retired Promo', value: '13', note: 'inactive' },
          { label: 'Unknown State', value: '14', note: 'active' },
        ],
        cursor: null,
      })
    })

    it('filters by search term', async () => {
      mock.onGet(`${ APP_US }/broadcasts`).reply({
        broadcasts: [
          { id: 12, name: 'Flash Sale', active: true },
          { id: 13, name: 'Weekly Digest', active: true },
        ],
      })

      const result = await service.getBroadcastsDictionary({ search: 'digest' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('13')
    })

    it('handles a missing broadcasts array', async () => {
      mock.onGet(`${ APP_US }/broadcasts`).reply({})

      const result = await service.getBroadcastsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('propagates API errors', async () => {
      mock.onGet(`${ APP_US }/broadcasts`).replyWithError({ message: 'Boom' })

      await expect(service.getBroadcastsDictionary({})).rejects.toThrow('Customer.io API error: Boom')
    })
  })

  // ── Error message extraction ──

  describe('error message extraction', () => {
    it('surfaces meta.error from the response body', async () => {
      mock.onGet(`${ APP_US }/segments`).replyWithError({
        message: 'HTTP 400',
        body: { meta: { error: 'invalid app api key' } },
      })

      await expect(service.listSegments()).rejects.toThrow('Customer.io API error: invalid app api key')
    })

    it('joins an errors array of detail objects', async () => {
      mock.onGet(`${ APP_US }/segments`).replyWithError({
        message: 'HTTP 422',
        body: { errors: [{ detail: 'field is required' }, { reason: 'bad value' }] },
      })

      await expect(service.listSegments()).rejects.toThrow(
        'Customer.io API error: field is required; bad value'
      )
    })

    it('joins an errors array of strings', async () => {
      mock.onGet(`${ APP_US }/segments`).replyWithError({
        message: 'HTTP 422',
        body: { errors: ['first problem', 'second problem'] },
      })

      await expect(service.listSegments()).rejects.toThrow(
        'Customer.io API error: first problem; second problem'
      )
    })
  })
})

// ── EU region base-URL switch ──

describe('Customer.io Service (EU region)', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    const built = buildSandbox({
      siteId: SITE_ID,
      trackApiKey: TRACK_API_KEY,
      appApiKey: APP_API_KEY,
      region: 'EU',
    })

    sandbox = built.sandbox
    service = built.service
    mock = built.mock
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  it('uses the EU track host for Track API calls', async () => {
    mock.onPut(`${ TRACK_EU }/customers/user_1`).reply({})

    await service.identifyPerson('user_1', { plan: 'pro' })

    expect(mock.history[0].url).toBe(`${ TRACK_EU }/customers/user_1`)
  })

  it('uses the EU app host for App API calls', async () => {
    mock.onGet(`${ APP_EU }/segments`).reply({ segments: [] })

    await service.listSegments()

    expect(mock.history[0].url).toBe(`${ APP_EU }/segments`)
  })
})

// ── Missing App API key guard ──

describe('Customer.io Service (no App API key configured)', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    const built = buildSandbox({
      siteId: SITE_ID,
      trackApiKey: TRACK_API_KEY,
      region: 'US',
    })

    sandbox = built.sandbox
    service = built.service
    mock = built.mock
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  it('still allows Track API actions', async () => {
    mock.onPost(`${ TRACK_US }/customers/user_1/events`).reply({})

    const result = await service.trackEvent('user_1', 'signed_up')

    expect(result).toEqual({ success: true, personId: 'user_1', eventName: 'signed_up' })
  })

  it('throws a helpful error for App API actions without making a request', async () => {
    await expect(service.listSegments()).rejects.toThrow(
      'Customer.io App API Key is not configured'
    )

    expect(mock.history).toHaveLength(0)
  })

  it('throws for App API dictionaries without making a request', async () => {
    await expect(service.getSegmentsDictionary({})).rejects.toThrow(
      'Customer.io App API Key is not configured'
    )

    expect(mock.history).toHaveLength(0)
  })
})
