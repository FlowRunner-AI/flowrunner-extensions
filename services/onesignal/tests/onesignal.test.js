'use strict'

const { createSandbox } = require('../../../service-sandbox')

const APP_ID = 'test-app-id-uuid'
const REST_API_KEY = 'test-rest-api-key'
const BASE = 'https://api.onesignal.com'

describe('OneSignal Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ appId: APP_ID, restApiKey: REST_API_KEY })
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'appId', required: true, shared: false }),
          expect.objectContaining({ name: 'restApiKey', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Messages ──

  describe('sendPushNotification', () => {
    it('sends push with required fields only (defaults to Subscribed Users segment)', async () => {
      mock.onPost(`${BASE}/notifications`).reply({ id: 'notif-1', external_id: null })

      const result = await service.sendPushNotification('Hello world')

      expect(result).toEqual({ id: 'notif-1', external_id: null })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Key ${REST_API_KEY}` })
      expect(mock.history[0].body).toMatchObject({
        app_id: APP_ID,
        contents: { en: 'Hello world' },
        included_segments: ['Subscribed Users'],
        target_channel: 'push',
      })
    })

    it('targets by external IDs when provided', async () => {
      mock.onPost(`${BASE}/notifications`).reply({ id: 'notif-2' })

      await service.sendPushNotification(
        'Msg', null, null, null, ['user-1', 'user-2']
      )

      expect(mock.history[0].body).toMatchObject({
        include_aliases: { external_id: ['user-1', 'user-2'] },
        target_channel: 'push',
      })
      expect(mock.history[0].body.included_segments).toBeUndefined()
    })

    it('targets by filters when provided and no external IDs', async () => {
      mock.onPost(`${BASE}/notifications`).reply({ id: 'notif-3' })

      const filters = [{ field: 'tag', key: 'plan', relation: '=', value: 'pro' }]

      await service.sendPushNotification(
        'Msg', null, null, null, null, filters
      )

      expect(mock.history[0].body).toMatchObject({ filters })
      expect(mock.history[0].body.included_segments).toBeUndefined()
      expect(mock.history[0].body.include_aliases).toBeUndefined()
    })

    it('targets by custom segments when provided', async () => {
      mock.onPost(`${BASE}/notifications`).reply({ id: 'notif-4' })

      await service.sendPushNotification(
        'Msg', null, null, ['VIP Users', 'Engaged Users']
      )

      expect(mock.history[0].body).toMatchObject({
        included_segments: ['VIP Users', 'Engaged Users'],
      })
    })

    it('sends all optional fields', async () => {
      mock.onPost(`${BASE}/notifications`).reply({ id: 'notif-5' })

      await service.sendPushNotification(
        'Body', 'Title', 'Subtitle', null, null, null,
        'https://example.com', 'https://img.com/pic.png',
        [{ id: 'like', text: 'Like' }],
        { key: 'val' },
        '2026-09-24 14:00:00 GMT-0700',
        'Optimize by Timezone',
        '9:00AM',
        100,
        'High',
        'Set To',
        5,
        'channel-uuid'
      )

      const body = mock.history[0].body

      expect(body.headings).toEqual({ en: 'Title' })
      expect(body.subtitle).toEqual({ en: 'Subtitle' })
      expect(body.url).toBe('https://example.com')
      expect(body.big_picture).toBe('https://img.com/pic.png')
      expect(body.ios_attachments).toEqual({ id1: 'https://img.com/pic.png' })
      expect(body.buttons).toEqual([{ id: 'like', text: 'Like' }])
      expect(body.data).toEqual({ key: 'val' })
      expect(body.send_after).toBe('2026-09-24 14:00:00 GMT-0700')
      expect(body.delayed_option).toBe('timezone')
      expect(body.delivery_time_of_day).toBe('9:00AM')
      expect(body.throttle_rate_per_minute).toBe(100)
      expect(body.priority).toBe(10)
      expect(body.ios_badgeType).toBe('SetTo')
      expect(body.ios_badgeCount).toBe(5)
      expect(body.android_channel_id).toBe('channel-uuid')
    })

    it('resolves "Send Immediately" delayed option to null (omitted by clean)', async () => {
      mock.onPost(`${BASE}/notifications`).reply({ id: 'notif-6' })

      await service.sendPushNotification(
        'Msg', null, null, null, null, null, null, null, null, null,
        null, 'Send Immediately'
      )

      expect(mock.history[0].body.delayed_option).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/notifications`).replyWithError({
        message: 'Bad Request',
        body: { errors: ['Invalid app_id'] },
      })

      await expect(service.sendPushNotification('Msg')).rejects.toThrow('OneSignal API error')
    })
  })

  describe('sendEmail', () => {
    it('sends email with required fields', async () => {
      mock.onPost(`${BASE}/notifications`).reply({ id: 'email-1' })

      const result = await service.sendEmail('Subject', '<h1>Hi</h1>')

      expect(result).toEqual({ id: 'email-1' })
      expect(mock.history[0].body).toMatchObject({
        app_id: APP_ID,
        email_subject: 'Subject',
        email_body: '<h1>Hi</h1>',
        target_channel: 'email',
        included_segments: ['Subscribed Users'],
      })
    })

    it('includes optional from name/address and external IDs', async () => {
      mock.onPost(`${BASE}/notifications`).reply({ id: 'email-2' })

      await service.sendEmail(
        'Subject', '<p>Body</p>', 'Sender', 'sender@example.com', null, ['user-1']
      )

      const body = mock.history[0].body

      expect(body.email_from_name).toBe('Sender')
      expect(body.email_from_address).toBe('sender@example.com')
      expect(body.include_aliases).toEqual({ external_id: ['user-1'] })
    })
  })

  describe('sendSms', () => {
    it('sends SMS with required fields', async () => {
      mock.onPost(`${BASE}/notifications`).reply({ id: 'sms-1' })

      const result = await service.sendSms('Hello SMS', '+15551234567')

      expect(result).toEqual({ id: 'sms-1' })
      expect(mock.history[0].body).toMatchObject({
        app_id: APP_ID,
        contents: { en: 'Hello SMS' },
        sms_from: '+15551234567',
        target_channel: 'sms',
        included_segments: ['Subscribed Users'],
      })
    })

    it('targets by external IDs', async () => {
      mock.onPost(`${BASE}/notifications`).reply({ id: 'sms-2' })

      await service.sendSms('Msg', '+15551234567', null, ['user-1'])

      expect(mock.history[0].body.include_aliases).toEqual({ external_id: ['user-1'] })
    })
  })

  describe('sendPushWithTemplate', () => {
    it('sends push with template ID', async () => {
      mock.onPost(`${BASE}/notifications`).reply({ id: 'tmpl-1' })

      const result = await service.sendPushWithTemplate('template-uuid')

      expect(result).toEqual({ id: 'tmpl-1' })
      expect(mock.history[0].body).toMatchObject({
        app_id: APP_ID,
        template_id: 'template-uuid',
        target_channel: 'push',
        included_segments: ['Subscribed Users'],
      })
    })

    it('includes send_after and external IDs', async () => {
      mock.onPost(`${BASE}/notifications`).reply({ id: 'tmpl-2' })

      await service.sendPushWithTemplate(
        'template-uuid', null, ['user-1'], '2026-12-01 10:00:00'
      )

      const body = mock.history[0].body

      expect(body.send_after).toBe('2026-12-01 10:00:00')
      expect(body.include_aliases).toEqual({ external_id: ['user-1'] })
    })
  })

  describe('listMessages', () => {
    it('lists messages with defaults', async () => {
      mock.onGet(`${BASE}/notifications`).reply({ total_count: 1, notifications: [{ id: 'n1' }] })

      const result = await service.listMessages()

      expect(result).toEqual({ total_count: 1, notifications: [{ id: 'n1' }] })
      expect(mock.history[0].query).toMatchObject({ app_id: APP_ID })
    })

    it('passes limit, offset and kind', async () => {
      mock.onGet(`${BASE}/notifications`).reply({ total_count: 0, notifications: [] })

      await service.listMessages(10, 20, 'API')

      expect(mock.history[0].query).toMatchObject({
        app_id: APP_ID,
        limit: 10,
        offset: 20,
        kind: 1,
      })
    })

    it('resolves "All" kind to null (omitted by clean)', async () => {
      mock.onGet(`${BASE}/notifications`).reply({ total_count: 0, notifications: [] })

      await service.listMessages(50, 0, 'All')

      expect(mock.history[0].query.kind).toBeUndefined()
    })
  })

  describe('getMessage', () => {
    it('gets message by ID', async () => {
      const msgId = 'msg-uuid'

      mock.onGet(`${BASE}/notifications/${msgId}`).reply({ id: msgId, successful: 100 })

      const result = await service.getMessage(msgId)

      expect(result).toEqual({ id: msgId, successful: 100 })
      expect(mock.history[0].query).toMatchObject({ app_id: APP_ID })
    })
  })

  describe('cancelScheduledMessage', () => {
    it('cancels a scheduled message', async () => {
      mock.onDelete(`${BASE}/notifications/msg-uuid`).reply({ success: true })

      const result = await service.cancelScheduledMessage('msg-uuid')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].query).toMatchObject({ app_id: APP_ID })
    })

    it('returns default success when response is falsy', async () => {
      mock.onDelete(`${BASE}/notifications/msg-uuid`).reply(null)

      const result = await service.cancelScheduledMessage('msg-uuid')

      expect(result).toEqual({ success: true })
    })
  })

  describe('getMessageHistory', () => {
    it('requests message history export', async () => {
      mock.onPost(`${BASE}/notifications/msg-uuid/history`).reply({
        success: true,
        destination_url: 'https://s3.amazonaws.com/export.csv.gz',
      })

      const result = await service.getMessageHistory('msg-uuid', 'Sent', 'test@example.com')

      expect(result.success).toBe(true)
      expect(mock.history[0].body).toEqual({
        app_id: APP_ID,
        events: 'sent',
        email: 'test@example.com',
      })
    })

    it('resolves "Clicked" event type', async () => {
      mock.onPost(`${BASE}/notifications/msg-uuid/history`).reply({ success: true })

      await service.getMessageHistory('msg-uuid', 'Clicked', 'x@y.com')

      expect(mock.history[0].body.events).toBe('clicked')
    })
  })

  // ── Segments ──

  describe('listSegments', () => {
    it('lists segments with defaults', async () => {
      mock.onGet(`${BASE}/apps/${APP_ID}/segments`).reply({
        total_count: 1,
        segments: [{ id: 'seg-1', name: 'Subscribed Users' }],
      })

      const result = await service.listSegments()

      expect(result.segments).toHaveLength(1)
      expect(mock.history).toHaveLength(1)
    })

    it('passes limit and offset', async () => {
      mock.onGet(`${BASE}/apps/${APP_ID}/segments`).reply({ total_count: 0, segments: [] })

      await service.listSegments(100, 50)

      expect(mock.history[0].query).toMatchObject({ limit: 100, offset: 50 })
    })
  })

  describe('createSegment', () => {
    it('creates a segment with name and filters', async () => {
      mock.onPost(`${BASE}/apps/${APP_ID}/segments`).reply({ success: true, id: 'seg-new' })

      const filters = [{ field: 'session_count', relation: '>', value: '1' }]
      const result = await service.createSegment('Active Users', filters)

      expect(result).toEqual({ success: true, id: 'seg-new' })
      expect(mock.history[0].body).toEqual({ name: 'Active Users', filters })
    })
  })

  describe('deleteSegment', () => {
    it('deletes a segment by ID', async () => {
      mock.onDelete(`${BASE}/apps/${APP_ID}/segments/seg-uuid`).reply({ success: true })

      const result = await service.deleteSegment('seg-uuid')

      expect(result).toEqual({ success: true })
    })

    it('returns default success when response is falsy', async () => {
      mock.onDelete(`${BASE}/apps/${APP_ID}/segments/seg-uuid`).reply(null)

      const result = await service.deleteSegment('seg-uuid')

      expect(result).toEqual({ success: true })
    })
  })

  // ── Users ──

  describe('createUser', () => {
    it('creates a user with external ID only', async () => {
      mock.onPost(`${BASE}/apps/${APP_ID}/users`).reply({
        identity: { external_id: 'user-123' },
      })

      const result = await service.createUser('user-123')

      expect(result.identity.external_id).toBe('user-123')
      expect(mock.history[0].body).toMatchObject({
        identity: { external_id: 'user-123' },
      })
    })

    it('includes tags, language, timezone, and subscriptions', async () => {
      mock.onPost(`${BASE}/apps/${APP_ID}/users`).reply({ identity: { external_id: 'u-1' } })

      const subscriptions = [{ type: 'Email', token: 'a@b.com', enabled: true }]

      await service.createUser('u-1', { plan: 'pro' }, 'en', 'America/New_York', subscriptions)

      const body = mock.history[0].body

      expect(body.properties).toMatchObject({
        tags: { plan: 'pro' },
        language: 'en',
        timezone_id: 'America/New_York',
      })
      expect(body.subscriptions).toEqual(subscriptions)
    })

    it('omits properties and subscriptions when empty', async () => {
      mock.onPost(`${BASE}/apps/${APP_ID}/users`).reply({ identity: { external_id: 'u-2' } })

      await service.createUser('u-2', null, null, null, [])

      const body = mock.history[0].body

      expect(body.properties).toBeUndefined()
      expect(body.subscriptions).toBeUndefined()
    })
  })

  describe('getUser', () => {
    it('gets user by default alias (external_id)', async () => {
      mock.onGet(`${BASE}/apps/${APP_ID}/users/by/external_id/user-123`).reply({
        identity: { external_id: 'user-123' },
      })

      const result = await service.getUser('user-123')

      expect(result.identity.external_id).toBe('user-123')
    })

    it('gets user by custom alias label', async () => {
      mock.onGet(`${BASE}/apps/${APP_ID}/users/by/crm_id/crm-99`).reply({
        identity: { crm_id: 'crm-99' },
      })

      const result = await service.getUser('crm-99', 'crm_id')

      expect(result.identity.crm_id).toBe('crm-99')
    })
  })

  describe('updateUser', () => {
    it('updates user tags', async () => {
      mock.onPatch(`${BASE}/apps/${APP_ID}/users/by/external_id/user-123`).reply({
        properties: { tags: { plan: 'pro' } },
      })

      const result = await service.updateUser('user-123', null, { plan: 'pro' })

      expect(result.properties.tags.plan).toBe('pro')
      expect(mock.history[0].body).toMatchObject({
        properties: { tags: { plan: 'pro' } },
      })
    })

    it('includes deltas when provided', async () => {
      mock.onPatch(`${BASE}/apps/${APP_ID}/users/by/external_id/u-1`).reply({})

      await service.updateUser('u-1', null, null, null, null, { session_count: 1 })

      expect(mock.history[0].body.deltas).toEqual({ session_count: 1 })
    })

    it('uses custom alias label', async () => {
      mock.onPatch(`${BASE}/apps/${APP_ID}/users/by/onesignal_id/os-id`).reply({})

      await service.updateUser('os-id', 'onesignal_id', { plan: 'free' })

      expect(mock.history).toHaveLength(1)
    })
  })

  describe('deleteUser', () => {
    it('deletes a user by external ID', async () => {
      mock.onDelete(`${BASE}/apps/${APP_ID}/users/by/external_id/user-123`).reply({ success: true })

      const result = await service.deleteUser('user-123')

      expect(result).toEqual({ success: true })
    })

    it('returns default success when response is falsy', async () => {
      mock.onDelete(`${BASE}/apps/${APP_ID}/users/by/external_id/user-123`).reply(null)

      const result = await service.deleteUser('user-123')

      expect(result).toEqual({ success: true })
    })
  })

  describe('createAlias', () => {
    it('adds an alias to a user', async () => {
      mock.onPatch(`${BASE}/apps/${APP_ID}/users/by/external_id/user-123/identity`).reply({
        identity: { external_id: 'user-123', crm_id: 'crm-99' },
      })

      const result = await service.createAlias('user-123', null, 'crm_id', 'crm-99')

      expect(result.identity.crm_id).toBe('crm-99')
      expect(mock.history[0].body).toEqual({
        identity: { crm_id: 'crm-99' },
      })
    })
  })

  describe('deleteAlias', () => {
    it('removes an alias from a user', async () => {
      mock.onDelete(`${BASE}/apps/${APP_ID}/users/by/external_id/user-123/identity/crm_id`).reply({
        identity: { external_id: 'user-123' },
      })

      const result = await service.deleteAlias('user-123', null, 'crm_id')

      expect(result.identity.external_id).toBe('user-123')
    })

    it('returns default success when response is falsy', async () => {
      mock.onDelete(`${BASE}/apps/${APP_ID}/users/by/external_id/user-123/identity/crm_id`).reply(null)

      const result = await service.deleteAlias('user-123', null, 'crm_id')

      expect(result).toEqual({ success: true })
    })
  })

  // ── Subscriptions ──

  describe('createSubscription', () => {
    it('creates an email subscription', async () => {
      mock.onPost(`${BASE}/apps/${APP_ID}/users/by/external_id/user-123/subscriptions`).reply({
        subscription: { id: 'sub-1', type: 'Email', token: 'a@b.com', enabled: true },
      })

      const result = await service.createSubscription('user-123', null, 'Email', 'a@b.com')

      expect(result.subscription.type).toBe('Email')
      expect(mock.history[0].body).toEqual({
        subscription: { type: 'Email', token: 'a@b.com', enabled: true },
      })
    })

    it('resolves subscription type from display name', async () => {
      mock.onPost(`${BASE}/apps/${APP_ID}/users/by/external_id/u-1/subscriptions`).reply({
        subscription: { id: 'sub-2', type: 'iOSPush' },
      })

      await service.createSubscription('u-1', null, 'iOS Push', 'device-token')

      expect(mock.history[0].body.subscription.type).toBe('iOSPush')
    })

    it('passes enabled as false when specified', async () => {
      mock.onPost(`${BASE}/apps/${APP_ID}/users/by/external_id/u-1/subscriptions`).reply({
        subscription: { id: 'sub-3' },
      })

      await service.createSubscription('u-1', null, 'SMS', '+15551234567', false)

      expect(mock.history[0].body.subscription.enabled).toBe(false)
    })
  })

  describe('updateSubscription', () => {
    it('updates subscription token and enabled', async () => {
      mock.onPatch(`${BASE}/apps/${APP_ID}/subscriptions/sub-uuid`).reply({ success: true })

      const result = await service.updateSubscription('sub-uuid', 'new@email.com', true)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({
        subscription: { token: 'new@email.com', enabled: true },
      })
    })

    it('returns default success when response is falsy', async () => {
      mock.onPatch(`${BASE}/apps/${APP_ID}/subscriptions/sub-uuid`).reply(null)

      const result = await service.updateSubscription('sub-uuid', 'new@email.com')

      expect(result).toEqual({ success: true })
    })
  })

  describe('deleteSubscription', () => {
    it('deletes a subscription by ID', async () => {
      mock.onDelete(`${BASE}/apps/${APP_ID}/subscriptions/sub-uuid`).reply({ success: true })

      const result = await service.deleteSubscription('sub-uuid')

      expect(result).toEqual({ success: true })
    })

    it('returns default success when response is falsy', async () => {
      mock.onDelete(`${BASE}/apps/${APP_ID}/subscriptions/sub-uuid`).reply(null)

      const result = await service.deleteSubscription('sub-uuid')

      expect(result).toEqual({ success: true })
    })
  })

  // ── Templates ──

  describe('listTemplates', () => {
    it('lists templates with defaults', async () => {
      mock.onGet(`${BASE}/templates`).reply({
        total_count: 1,
        templates: [{ id: 'tmpl-1', name: 'Welcome' }],
      })

      const result = await service.listTemplates()

      expect(result.templates).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ app_id: APP_ID })
    })

    it('passes limit, offset, and channel', async () => {
      mock.onGet(`${BASE}/templates`).reply({ total_count: 0, templates: [] })

      await service.listTemplates(10, 5, 'Email')

      expect(mock.history[0].query).toMatchObject({
        app_id: APP_ID,
        limit: 10,
        offset: 5,
        channel: 'email',
      })
    })
  })

  describe('getTemplate', () => {
    it('gets a template by ID', async () => {
      mock.onGet(`${BASE}/templates/tmpl-uuid`).reply({
        id: 'tmpl-uuid',
        name: 'Welcome Push',
        contents: { en: 'Thanks for joining!' },
      })

      const result = await service.getTemplate('tmpl-uuid')

      expect(result.name).toBe('Welcome Push')
      expect(mock.history[0].query).toMatchObject({ app_id: APP_ID })
    })
  })

  // ── App ──

  describe('viewAppDetails', () => {
    it('retrieves app details', async () => {
      mock.onGet(`${BASE}/apps/${APP_ID}`).reply({
        id: APP_ID,
        name: 'My App',
        players: 15200,
      })

      const result = await service.viewAppDetails()

      expect(result).toMatchObject({ id: APP_ID, name: 'My App', players: 15200 })
    })
  })

  describe('viewOutcomes', () => {
    it('retrieves outcomes with required fields', async () => {
      mock.onGet(`${BASE}/apps/${APP_ID}/outcomes`).reply({
        outcomes: [{ id: 'os__click.count', value: 150 }],
      })

      const result = await service.viewOutcomes('os__click.count')

      expect(result.outcomes).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        outcome_names: 'os__click.count',
      })
    })

    it('resolves time range and attribution choices', async () => {
      mock.onGet(`${BASE}/apps/${APP_ID}/outcomes`).reply({ outcomes: [] })

      await service.viewOutcomes('os__click.count', 'Last Hour', '0,1', 'Direct')

      expect(mock.history[0].query).toMatchObject({
        outcome_time_range: '1h',
        outcome_platforms: '0,1',
        outcome_attribution: 'direct',
      })
    })
  })

  // ── Dictionaries ──

  describe('getSegmentsDictionary', () => {
    it('returns mapped items with label and value', async () => {
      mock.onGet(`${BASE}/apps/${APP_ID}/segments`).reply({
        segments: [{ id: 'seg-1', name: 'Subscribed Users', is_active: true, read_only: false }],
      })

      const result = await service.getSegmentsDictionary({})

      expect(result.items).toEqual([
        { label: 'Subscribed Users', value: 'seg-1', note: 'Active' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${BASE}/apps/${APP_ID}/segments`).reply({
        segments: [
          { id: 'seg-1', name: 'Active Users', is_active: true },
          { id: 'seg-2', name: 'VIP', is_active: true },
        ],
      })

      const result = await service.getSegmentsDictionary({ search: 'act' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('seg-1')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/apps/${APP_ID}/segments`).reply({
        segments: [{ id: 'seg-1', name: 'Test', is_active: true }],
      })

      const result = await service.getSegmentsDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('handles empty segments', async () => {
      mock.onGet(`${BASE}/apps/${APP_ID}/segments`).reply({ segments: null })

      const result = await service.getSegmentsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns cursor when page is full', async () => {
      const segments = Array.from({ length: 50 }, (_, i) => ({
        id: `seg-${i}`,
        name: `Segment ${i}`,
        is_active: true,
      }))

      mock.onGet(`${BASE}/apps/${APP_ID}/segments`).reply({ segments })

      const result = await service.getSegmentsDictionary({})

      expect(result.cursor).toBe('50')
    })

    it('passes cursor as offset', async () => {
      mock.onGet(`${BASE}/apps/${APP_ID}/segments`).reply({ segments: [] })

      await service.getSegmentsDictionary({ cursor: '100' })

      expect(mock.history[0].query).toMatchObject({ offset: 100 })
    })

    it('includes read-only note', async () => {
      mock.onGet(`${BASE}/apps/${APP_ID}/segments`).reply({
        segments: [{ id: 'seg-1', name: 'Built-in', is_active: true, read_only: true }],
      })

      const result = await service.getSegmentsDictionary({})

      expect(result.items[0].note).toBe('Active - Read-only')
    })
  })

  describe('getTemplatesDictionary', () => {
    it('returns mapped items with label and value', async () => {
      mock.onGet(`${BASE}/templates`).reply({
        templates: [{ id: 'tmpl-1', name: 'Welcome', updated_at: '2026-01-20T16:40:00.000Z' }],
      })

      const result = await service.getTemplatesDictionary({})

      expect(result.items).toEqual([
        { label: 'Welcome', value: 'tmpl-1', note: 'Updated 2026-01-20' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search', async () => {
      mock.onGet(`${BASE}/templates`).reply({
        templates: [
          { id: 'tmpl-1', name: 'Welcome Push' },
          { id: 'tmpl-2', name: 'Sale Alert' },
        ],
      })

      const result = await service.getTemplatesDictionary({ search: 'sale' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('tmpl-2')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/templates`).reply({
        templates: [{ id: 'tmpl-1', name: 'T' }],
      })

      const result = await service.getTemplatesDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('handles null templates', async () => {
      mock.onGet(`${BASE}/templates`).reply({ templates: null })

      const result = await service.getTemplatesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns cursor when page is full', async () => {
      const templates = Array.from({ length: 50 }, (_, i) => ({
        id: `tmpl-${i}`,
        name: `Template ${i}`,
      }))

      mock.onGet(`${BASE}/templates`).reply({ templates })

      const result = await service.getTemplatesDictionary({})

      expect(result.cursor).toBe('50')
    })

    it('omits note when updated_at is missing', async () => {
      mock.onGet(`${BASE}/templates`).reply({
        templates: [{ id: 'tmpl-1', name: 'Draft' }],
      })

      const result = await service.getTemplatesDictionary({})

      expect(result.items[0].note).toBeUndefined()
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('extracts array of string errors', async () => {
      mock.onGet(`${BASE}/apps/${APP_ID}`).replyWithError({
        message: 'Bad Request',
        body: { errors: ['Invalid auth', 'Missing app_id'] },
      })

      await expect(service.viewAppDetails()).rejects.toThrow('Invalid auth; Missing app_id')
    })

    it('extracts array of object errors with title', async () => {
      mock.onGet(`${BASE}/apps/${APP_ID}`).replyWithError({
        message: 'Error',
        body: { errors: [{ title: 'Not Found' }] },
      })

      await expect(service.viewAppDetails()).rejects.toThrow('Not Found')
    })

    it('falls back to error.body.message', async () => {
      mock.onGet(`${BASE}/apps/${APP_ID}`).replyWithError({
        message: 'Transport error',
        body: { message: 'Rate limited' },
      })

      await expect(service.viewAppDetails()).rejects.toThrow('Rate limited')
    })

    it('falls back to error.message when body is empty', async () => {
      mock.onGet(`${BASE}/apps/${APP_ID}`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.viewAppDetails()).rejects.toThrow('Network timeout')
    })
  })
})
