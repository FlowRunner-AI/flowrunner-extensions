'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-manychat-api-key'
const BASE = 'https://api.manychat.com'

describe('ManyChat Service', () => {
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

    it('sends Authorization Bearer header on requests', async () => {
      mock.onGet(`${ BASE }/fb/page/getInfo`).reply({ status: 'success', data: { id: 1 } })

      await service.getPageInfo()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Subscribers ──

  describe('getSubscriber', () => {
    it('sends correct query params and returns data', async () => {
      const subscriberData = { id: '123', first_name: 'John' }

      mock.onGet(`${ BASE }/fb/subscriber/getInfo`).reply({ status: 'success', data: subscriberData })

      const result = await service.getSubscriber('123')

      expect(result).toEqual(subscriberData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ subscriber_id: '123' })
    })
  })

  describe('findSubscribersByName', () => {
    it('sends name as query param', async () => {
      const subscribers = [{ id: '123', name: 'John Doe' }]

      mock.onGet(`${ BASE }/fb/subscriber/findByName`).reply({ status: 'success', data: subscribers })

      const result = await service.findSubscribersByName('John Doe')

      expect(result).toEqual(subscribers)
      expect(mock.history[0].query).toMatchObject({ name: 'John Doe' })
    })
  })

  describe('findSubscriberBySystemField', () => {
    it('sends email and phone as query params', async () => {
      const subscriber = { id: '123', email: 'test@example.com' }

      mock.onGet(`${ BASE }/fb/subscriber/findBySystemField`).reply({ status: 'success', data: subscriber })

      const result = await service.findSubscriberBySystemField('test@example.com', '+15551234567')

      expect(result).toEqual(subscriber)
      expect(mock.history[0].query).toMatchObject({
        email: 'test@example.com',
        phone: '+15551234567',
      })
    })

    it('sends only email when phone is not provided', async () => {
      mock.onGet(`${ BASE }/fb/subscriber/findBySystemField`).reply({ status: 'success', data: {} })

      await service.findSubscriberBySystemField('test@example.com')

      expect(mock.history[0].query).toMatchObject({ email: 'test@example.com' })
    })

    it('throws when neither email nor phone is provided', async () => {
      await expect(service.findSubscriberBySystemField()).rejects.toThrow(
        'Either Email or Phone must be provided'
      )
    })
  })

  describe('findSubscribersByCustomField', () => {
    it('sends field_id and field_value as query params', async () => {
      const subscribers = [{ id: '123' }]

      mock.onGet(`${ BASE }/fb/subscriber/findByCustomField`).reply({ status: 'success', data: subscribers })

      const result = await service.findSubscribersByCustomField(11, 'A-1001')

      expect(result).toEqual(subscribers)
      expect(mock.history[0].query).toMatchObject({
        field_id: 11,
        field_value: 'A-1001',
      })
    })
  })

  describe('createSubscriber', () => {
    it('sends POST with all fields', async () => {
      const subscriberData = { id: '999', first_name: 'Jane' }

      mock.onPost(`${ BASE }/fb/subscriber/createSubscriber`).reply({ status: 'success', data: subscriberData })

      const result = await service.createSubscriber(
        'Jane', 'Smith', '+15559876543', '+15559876543',
        'jane@example.com', 'Female', true, true, 'I agree to receive messages'
      )

      expect(result).toEqual(subscriberData)
      expect(mock.history[0].body).toEqual({
        first_name: 'Jane',
        last_name: 'Smith',
        phone: '+15559876543',
        whatsapp_phone: '+15559876543',
        email: 'jane@example.com',
        gender: 'female',
        has_opt_in_sms: true,
        has_opt_in_email: true,
        consent_phrase: 'I agree to receive messages',
      })
    })

    it('omits undefined/null/empty fields via clean()', async () => {
      mock.onPost(`${ BASE }/fb/subscriber/createSubscriber`).reply({ status: 'success', data: { id: '999' } })

      await service.createSubscriber('Jane', undefined, '+15559876543')

      expect(mock.history[0].body).toEqual({
        first_name: 'Jane',
        phone: '+15559876543',
      })
    })

    it('resolves gender dropdown label to API value', async () => {
      mock.onPost(`${ BASE }/fb/subscriber/createSubscriber`).reply({ status: 'success', data: { id: '999' } })

      await service.createSubscriber('John', undefined, undefined, undefined, undefined, 'Male')

      expect(mock.history[0].body).toMatchObject({ gender: 'male' })
    })
  })

  describe('updateSubscriber', () => {
    it('sends POST with subscriber_id and updated fields', async () => {
      const subscriberData = { id: '123', first_name: 'Johnny' }

      mock.onPost(`${ BASE }/fb/subscriber/updateSubscriber`).reply({ status: 'success', data: subscriberData })

      const result = await service.updateSubscriber('123', 'Johnny', 'Doe', '+15551234567', 'john@example.com', 'Male')

      expect(result).toEqual(subscriberData)
      expect(mock.history[0].body).toMatchObject({
        subscriber_id: '123',
        first_name: 'Johnny',
        last_name: 'Doe',
        phone: '+15551234567',
        email: 'john@example.com',
        gender: 'male',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${ BASE }/fb/subscriber/updateSubscriber`).reply({ status: 'success', data: { id: '123' } })

      await service.updateSubscriber('123', 'Johnny')

      expect(mock.history[0].body).toEqual({
        subscriber_id: '123',
        first_name: 'Johnny',
      })
    })
  })

  // ── Tagging ──

  describe('addTagToSubscriber', () => {
    it('sends POST with subscriber_id and numeric tag_id', async () => {
      mock.onPost(`${ BASE }/fb/subscriber/addTag`).reply({ status: 'success' })

      const result = await service.addTagToSubscriber('123', 101)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({
        subscriber_id: '123',
        tag_id: 101,
      })
    })
  })

  describe('addTagToSubscriberByName', () => {
    it('sends POST with subscriber_id and tag_name', async () => {
      mock.onPost(`${ BASE }/fb/subscriber/addTagByName`).reply({ status: 'success' })

      const result = await service.addTagToSubscriberByName('123', 'vip')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({
        subscriber_id: '123',
        tag_name: 'vip',
      })
    })
  })

  describe('removeTagFromSubscriber', () => {
    it('sends POST with subscriber_id and numeric tag_id', async () => {
      mock.onPost(`${ BASE }/fb/subscriber/removeTag`).reply({ status: 'success' })

      const result = await service.removeTagFromSubscriber('123', 101)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({
        subscriber_id: '123',
        tag_id: 101,
      })
    })
  })

  describe('removeTagFromSubscriberByName', () => {
    it('sends POST with subscriber_id and tag_name', async () => {
      mock.onPost(`${ BASE }/fb/subscriber/removeTagByName`).reply({ status: 'success' })

      const result = await service.removeTagFromSubscriberByName('123', 'vip')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({
        subscriber_id: '123',
        tag_name: 'vip',
      })
    })
  })

  describe('listTags', () => {
    it('sends GET and returns tags array', async () => {
      const tags = [{ id: 101, name: 'vip' }, { id: 102, name: 'newsletter' }]

      mock.onGet(`${ BASE }/fb/page/getTags`).reply({ status: 'success', data: tags })

      const result = await service.listTags()

      expect(result).toEqual(tags)
    })
  })

  describe('createTag', () => {
    it('sends POST with tag name', async () => {
      const tagData = { tag: { id: 103, name: 'customer' } }

      mock.onPost(`${ BASE }/fb/page/createTag`).reply({ status: 'success', data: tagData })

      const result = await service.createTag('customer')

      expect(result).toEqual(tagData)
      expect(mock.history[0].body).toEqual({ name: 'customer' })
    })
  })

  describe('deleteTag', () => {
    it('sends POST with numeric tag_id', async () => {
      mock.onPost(`${ BASE }/fb/page/removeTag`).reply({ status: 'success' })

      const result = await service.deleteTag(103)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({ tag_id: 103 })
    })
  })

  describe('deleteTagByName', () => {
    it('sends POST with tag_name', async () => {
      mock.onPost(`${ BASE }/fb/page/removeTagByName`).reply({ status: 'success' })

      const result = await service.deleteTagByName('vip')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({ tag_name: 'vip' })
    })
  })

  // ── Custom Fields ──

  describe('setCustomField', () => {
    it('sends POST with subscriber_id, numeric field_id, and field_value', async () => {
      mock.onPost(`${ BASE }/fb/subscriber/setCustomField`).reply({ status: 'success' })

      const result = await service.setCustomField('123', 11, 'A-1001')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({
        subscriber_id: '123',
        field_id: 11,
        field_value: 'A-1001',
      })
    })
  })

  describe('setCustomFieldByName', () => {
    it('sends POST with subscriber_id, field_name, and field_value', async () => {
      mock.onPost(`${ BASE }/fb/subscriber/setCustomFieldByName`).reply({ status: 'success' })

      const result = await service.setCustomFieldByName('123', 'Order ID', 'A-1001')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({
        subscriber_id: '123',
        field_name: 'Order ID',
        field_value: 'A-1001',
      })
    })
  })

  describe('listCustomFields', () => {
    it('sends GET and returns fields array', async () => {
      const fields = [{ id: 11, name: 'Order ID', type: 'text' }]

      mock.onGet(`${ BASE }/fb/page/getCustomFields`).reply({ status: 'success', data: fields })

      const result = await service.listCustomFields()

      expect(result).toEqual(fields)
    })
  })

  describe('createCustomField', () => {
    it('sends POST with caption, resolved type, and description', async () => {
      const fieldData = { field: { id: 12, name: 'Loyalty Points', type: 'number' } }

      mock.onPost(`${ BASE }/fb/page/createCustomField`).reply({ status: 'success', data: fieldData })

      const result = await service.createCustomField('Loyalty Points', 'Number', 'Reward balance')

      expect(result).toEqual(fieldData)
      expect(mock.history[0].body).toEqual({
        caption: 'Loyalty Points',
        type: 'number',
        description: 'Reward balance',
      })
    })

    it('omits description when not provided', async () => {
      mock.onPost(`${ BASE }/fb/page/createCustomField`).reply({ status: 'success', data: {} })

      await service.createCustomField('Notes', 'Text')

      expect(mock.history[0].body).toEqual({
        caption: 'Notes',
        type: 'text',
      })
    })
  })

  // ── Bot Fields ──

  describe('setBotField', () => {
    it('sends POST with numeric field_id and field_value', async () => {
      mock.onPost(`${ BASE }/fb/page/setBotField`).reply({ status: 'success' })

      const result = await service.setBotField(21, 'help@example.com')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({
        field_id: 21,
        field_value: 'help@example.com',
      })
    })
  })

  describe('setBotFieldByName', () => {
    it('sends POST with field_name and field_value', async () => {
      mock.onPost(`${ BASE }/fb/page/setBotFieldByName`).reply({ status: 'success' })

      const result = await service.setBotFieldByName('promo_code', 'SPRING25')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({
        field_name: 'promo_code',
        field_value: 'SPRING25',
      })
    })
  })

  describe('listBotFields', () => {
    it('sends GET and returns bot fields array', async () => {
      const fields = [{ id: 21, name: 'support_email', type: 'text', value: 'help@example.com' }]

      mock.onGet(`${ BASE }/fb/page/getBotFields`).reply({ status: 'success', data: fields })

      const result = await service.listBotFields()

      expect(result).toEqual(fields)
    })
  })

  describe('createBotField', () => {
    it('sends POST with all fields including resolved type and initial value', async () => {
      const fieldData = { field: { id: 22, name: 'promo_code', type: 'text', value: 'SPRING25' } }

      mock.onPost(`${ BASE }/fb/page/createBotField`).reply({ status: 'success', data: fieldData })

      const result = await service.createBotField('promo_code', 'Text', 'Current promotion code', 'SPRING25')

      expect(result).toEqual(fieldData)
      expect(mock.history[0].body).toEqual({
        name: 'promo_code',
        type: 'text',
        description: 'Current promotion code',
        value: 'SPRING25',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${ BASE }/fb/page/createBotField`).reply({ status: 'success', data: {} })

      await service.createBotField('counter', 'Number')

      expect(mock.history[0].body).toEqual({
        name: 'counter',
        type: 'number',
      })
    })
  })

  // ── Sending ──

  describe('sendContent', () => {
    it('sends text message with correct content structure', async () => {
      mock.onPost(`${ BASE }/fb/sending/sendContent`).reply({ status: 'success' })

      const result = await service.sendContent('123', 'Hello!')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({
        subscriber_id: '123',
        data: {
          version: 'v2',
          content: {
            messages: [{ type: 'text', text: 'Hello!' }],
            actions: [],
            quick_replies: [],
          },
        },
      })
    })

    it('sends raw content when provided, ignoring messageText', async () => {
      const rawContent = {
        messages: [{ type: 'text', text: 'Custom' }],
        actions: [{ action: 'add_tag', tag_name: 'vip' }],
        quick_replies: [],
      }

      mock.onPost(`${ BASE }/fb/sending/sendContent`).reply({ status: 'success' })

      await service.sendContent('123', 'ignored text', rawContent)

      expect(mock.history[0].body).toMatchObject({
        subscriber_id: '123',
        data: {
          version: 'v2',
          content: rawContent,
        },
      })
    })

    it('includes message_tag when provided', async () => {
      mock.onPost(`${ BASE }/fb/sending/sendContent`).reply({ status: 'success' })

      await service.sendContent('123', 'Update', undefined, 'Account Update')

      expect(mock.history[0].body).toMatchObject({
        message_tag: 'ACCOUNT_UPDATE',
      })
    })

    it('includes otn_topic_name when provided', async () => {
      mock.onPost(`${ BASE }/fb/sending/sendContent`).reply({ status: 'success' })

      await service.sendContent('123', 'News', undefined, undefined, 'Product updates')

      expect(mock.history[0].body).toMatchObject({
        otn_topic_name: 'Product updates',
      })
    })

    it('throws when neither messageText nor content is provided', async () => {
      await expect(service.sendContent('123')).rejects.toThrow(
        'Either Message Text or Raw Content must be provided'
      )
    })
  })

  describe('sendFlow', () => {
    it('sends POST with subscriber_id and flow_ns', async () => {
      mock.onPost(`${ BASE }/fb/sending/sendFlow`).reply({ status: 'success' })

      const result = await service.sendFlow('123', 'content20250115123456_123456')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({
        subscriber_id: '123',
        flow_ns: 'content20250115123456_123456',
      })
    })
  })

  describe('sendContentByUserRef', () => {
    it('sends POST with user_ref and text content', async () => {
      mock.onPost(`${ BASE }/fb/sending/sendContentByUserRef`).reply({ status: 'success' })

      const result = await service.sendContentByUserRef('ref-abc', 'Hello!')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({
        user_ref: 'ref-abc',
        data: {
          version: 'v2',
          content: {
            messages: [{ type: 'text', text: 'Hello!' }],
            actions: [],
            quick_replies: [],
          },
        },
      })
    })

    it('sends raw content when provided', async () => {
      const rawContent = { messages: [{ type: 'text', text: 'Hi' }], actions: [], quick_replies: [] }

      mock.onPost(`${ BASE }/fb/sending/sendContentByUserRef`).reply({ status: 'success' })

      await service.sendContentByUserRef('ref-abc', 'ignored', rawContent)

      expect(mock.history[0].body).toMatchObject({
        data: { version: 'v2', content: rawContent },
      })
    })
  })

  // ── Page ──

  describe('getPageInfo', () => {
    it('sends GET and returns page data', async () => {
      const pageData = { id: 1234567890, name: 'My Business', is_pro: true }

      mock.onGet(`${ BASE }/fb/page/getInfo`).reply({ status: 'success', data: pageData })

      const result = await service.getPageInfo()

      expect(result).toEqual(pageData)
    })
  })

  describe('listFlows', () => {
    it('sends GET and returns flows and folders', async () => {
      const flowsData = {
        flows: [{ ns: 'flow1', name: 'Welcome', folder_id: 1 }],
        folders: [{ id: 1, name: 'Onboarding' }],
      }

      mock.onGet(`${ BASE }/fb/page/getFlows`).reply({ status: 'success', data: flowsData })

      const result = await service.listFlows()

      expect(result).toEqual(flowsData)
    })
  })

  describe('listGrowthTools', () => {
    it('sends GET and returns growth tools array', async () => {
      const tools = [{ id: 201, name: 'Chat Widget', type: 'widget' }]

      mock.onGet(`${ BASE }/fb/page/getGrowthTools`).reply({ status: 'success', data: tools })

      const result = await service.listGrowthTools()

      expect(result).toEqual(tools)
    })
  })

  describe('listOtnTopics', () => {
    it('sends GET and returns OTN topics array', async () => {
      const topics = [{ id: 31, name: 'Product updates' }]

      mock.onGet(`${ BASE }/fb/page/getOtnTopics`).reply({ status: 'success', data: topics })

      const result = await service.listOtnTopics()

      expect(result).toEqual(topics)
    })
  })

  // ── Dictionaries ──

  describe('getTagsDictionary', () => {
    it('returns formatted items with label and string value', async () => {
      mock.onGet(`${ BASE }/fb/page/getTags`).reply({
        status: 'success',
        data: [{ id: 101, name: 'vip' }, { id: 102, name: 'newsletter' }],
      })

      const result = await service.getTagsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'vip', value: '101' },
          { label: 'newsletter', value: '102' },
        ],
        cursor: null,
      })
    })

    it('filters items by search term', async () => {
      mock.onGet(`${ BASE }/fb/page/getTags`).reply({
        status: 'success',
        data: [{ id: 101, name: 'vip' }, { id: 102, name: 'newsletter' }],
      })

      const result = await service.getTagsDictionary({ search: 'news' })

      expect(result.items).toEqual([{ label: 'newsletter', value: '102' }])
    })

    it('returns empty items when API returns non-array', async () => {
      mock.onGet(`${ BASE }/fb/page/getTags`).reply({ status: 'success', data: null })

      const result = await service.getTagsDictionary({})

      expect(result.items).toEqual([])
    })
  })

  describe('getFlowsDictionary', () => {
    it('returns formatted items with folder note', async () => {
      mock.onGet(`${ BASE }/fb/page/getFlows`).reply({
        status: 'success',
        data: {
          flows: [{ ns: 'flow1', name: 'Welcome Flow', folder_id: 1 }],
          folders: [{ id: 1, name: 'Onboarding' }],
        },
      })

      const result = await service.getFlowsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Welcome Flow', value: 'flow1', note: 'Onboarding' },
        ],
        cursor: null,
      })
    })

    it('sets note to undefined when folder is not found', async () => {
      mock.onGet(`${ BASE }/fb/page/getFlows`).reply({
        status: 'success',
        data: {
          flows: [{ ns: 'flow1', name: 'Orphan Flow', folder_id: 999 }],
          folders: [],
        },
      })

      const result = await service.getFlowsDictionary({})

      expect(result.items[0].note).toBeUndefined()
    })

    it('filters items by search term', async () => {
      mock.onGet(`${ BASE }/fb/page/getFlows`).reply({
        status: 'success',
        data: {
          flows: [
            { ns: 'flow1', name: 'Welcome Flow', folder_id: 1 },
            { ns: 'flow2', name: 'Goodbye Flow', folder_id: 1 },
          ],
          folders: [{ id: 1, name: 'Main' }],
        },
      })

      const result = await service.getFlowsDictionary({ search: 'good' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Goodbye Flow')
    })
  })

  describe('getCustomFieldsDictionary', () => {
    it('returns formatted items with type as note', async () => {
      mock.onGet(`${ BASE }/fb/page/getCustomFields`).reply({
        status: 'success',
        data: [{ id: 11, name: 'Order ID', type: 'text' }],
      })

      const result = await service.getCustomFieldsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Order ID', value: '11', note: 'text' }],
        cursor: null,
      })
    })

    it('filters items by search term', async () => {
      mock.onGet(`${ BASE }/fb/page/getCustomFields`).reply({
        status: 'success',
        data: [
          { id: 11, name: 'Order ID', type: 'text' },
          { id: 12, name: 'Loyalty Points', type: 'number' },
        ],
      })

      const result = await service.getCustomFieldsDictionary({ search: 'loyal' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Loyalty Points')
    })
  })

  describe('getBotFieldsDictionary', () => {
    it('returns formatted items with type as note', async () => {
      mock.onGet(`${ BASE }/fb/page/getBotFields`).reply({
        status: 'success',
        data: [{ id: 21, name: 'support_email', type: 'text' }],
      })

      const result = await service.getBotFieldsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'support_email', value: '21', note: 'text' }],
        cursor: null,
      })
    })

    it('filters items by search term', async () => {
      mock.onGet(`${ BASE }/fb/page/getBotFields`).reply({
        status: 'success',
        data: [
          { id: 21, name: 'support_email', type: 'text' },
          { id: 22, name: 'promo_code', type: 'text' },
        ],
      })

      const result = await service.getBotFieldsDictionary({ search: 'promo' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('promo_code')
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('throws on API error response with status error', async () => {
      mock.onGet(`${ BASE }/fb/page/getInfo`).reply({
        status: 'error',
        message: 'Invalid API key',
      })

      await expect(service.getPageInfo()).rejects.toThrow('ManyChat API error: Invalid API key')
    })

    it('throws on HTTP error with body containing message', async () => {
      mock.onGet(`${ BASE }/fb/page/getInfo`).replyWithError({
        message: 'Request failed',
        body: { status: 'error', message: 'Unauthorized', details: { code: 401 } },
      })

      await expect(service.getPageInfo()).rejects.toThrow('ManyChat API error: Unauthorized')
    })

    it('throws generic message on unexpected error', async () => {
      mock.onGet(`${ BASE }/fb/page/getInfo`).replyWithError({
        message: 'Network Error',
      })

      await expect(service.getPageInfo()).rejects.toThrow('ManyChat API error: Network Error')
    })
  })
})
