'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCOUNT_SID = 'AC_test_account_sid'
const AUTH_TOKEN = 'test_auth_token'
const API_BASE = 'https://api.twilio.com/2010-04-01'
const CONVERSATIONS_BASE = 'https://conversations.twilio.com/v1'

const expectedAuth = `Basic ${ Buffer.from(`${ ACCOUNT_SID }:${ AUTH_TOKEN }`).toString('base64') }`

describe('Twilio Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN })
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
          expect.objectContaining({ name: 'accountSid', required: true }),
          expect.objectContaining({ name: 'authToken', required: true }),
        ])
      )
    })
  })

  // ── Messaging ──

  describe('sendSms', () => {
    const messagesUrl = `${ API_BASE }/Accounts/${ ACCOUNT_SID }/Messages.json`

    it('sends SMS with required params', async () => {
      mock.onPost(messagesUrl).reply({ sid: 'SM123', status: 'queued' })

      const result = await service.sendSms('+1234567890', '+0987654321', 'Hello!')

      expect(result).toEqual({ sid: 'SM123', status: 'queued' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': expectedAuth,
        'Content-Type': 'application/x-www-form-urlencoded',
      })

      const body = mock.history[0].body
      expect(body).toContain('To=%2B1234567890')
      expect(body).toContain('From=%2B0987654321')
      expect(body).toContain('Body=Hello%21')
      expect(body).not.toContain('MediaUrl')
    })

    it('includes MediaUrl when provided', async () => {
      mock.onPost(messagesUrl).reply({ sid: 'SM124', status: 'queued' })

      await service.sendSms('+1234567890', '+0987654321', 'With image', 'https://example.com/img.png')

      const body = mock.history[0].body
      expect(body).toContain('MediaUrl=https')
    })

    it('throws on API error', async () => {
      mock.onPost(messagesUrl).replyWithError({ message: 'Bad Request', body: { code: 21211 } })

      await expect(service.sendSms('+1', '+2', 'fail')).rejects.toThrow()
    })
  })

  describe('getMessage', () => {
    it('fetches message by SID', async () => {
      const url = `${ API_BASE }/Accounts/${ ACCOUNT_SID }/Messages/SM123.json`
      mock.onGet(url).reply({ sid: 'SM123', status: 'delivered', body: 'Hello!' })

      const result = await service.getMessage('SM123')

      expect(result).toEqual({ sid: 'SM123', status: 'delivered', body: 'Hello!' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': expectedAuth })
    })
  })

  describe('listMessages', () => {
    const url = `${ API_BASE }/Accounts/${ ACCOUNT_SID }/Messages.json`

    it('lists messages with defaults', async () => {
      mock.onGet(url).reply({ messages: [], page: 0, page_size: 50 })

      const result = await service.listMessages()

      expect(result).toEqual({ messages: [], page: 0, page_size: 50 })
      expect(mock.history[0].query).toMatchObject({ PageSize: 50 })
    })

    it('passes optional filters', async () => {
      mock.onGet(url).reply({ messages: [], page: 0, page_size: 10 })

      await service.listMessages('+111', '+222', '2024-01-15', 10)

      expect(mock.history[0].query).toMatchObject({
        PageSize: 10,
        To: '+111',
        From: '+222',
        DateSent: '2024-01-15',
      })
    })

    it('omits undefined optional filters', async () => {
      mock.onGet(url).reply({ messages: [] })

      await service.listMessages(null, null, null, 25)

      const query = mock.history[0].query
      expect(query.PageSize).toBe(25)
      expect(query).not.toHaveProperty('To')
      expect(query).not.toHaveProperty('From')
      expect(query).not.toHaveProperty('DateSent')
    })
  })

  // ── Voice ──

  describe('makeCall', () => {
    const callsUrl = `${ API_BASE }/Accounts/${ ACCOUNT_SID }/Calls.json`

    it('makes a call with TwiML URL', async () => {
      mock.onPost(callsUrl).reply({ sid: 'CA123', status: 'queued' })

      const result = await service.makeCall('+111', '+222', 'https://twiml.example.com/voice')

      expect(result).toEqual({ sid: 'CA123', status: 'queued' })
      const body = mock.history[0].body
      expect(body).toContain('To=%2B111')
      expect(body).toContain('From=%2B222')
      expect(body).toContain('Url=https%3A%2F%2Ftwiml.example.com%2Fvoice')
      expect(body).toContain('Timeout=60')
    })

    it('uses voice message as TwiML URL when no URL provided', async () => {
      mock.onPost(callsUrl).reply({ sid: 'CA124', status: 'queued' })

      await service.makeCall('+111', '+222', null, 'Hello there')

      const body = mock.history[0].body
      expect(body).toContain('Url=http%3A%2F%2Ftwimlets.com%2Fmessage%3FMessage%3DHello%2520there')
    })

    it('uses default TwiML URL when no URL or message provided', async () => {
      mock.onPost(callsUrl).reply({ sid: 'CA125', status: 'queued' })

      await service.makeCall('+111', '+222')

      const body = mock.history[0].body
      expect(body).toContain('twimlets.com')
      expect(body).toContain('Hello%2520from%2520Twilio%21')
    })

    it('uses custom timeout', async () => {
      mock.onPost(callsUrl).reply({ sid: 'CA126', status: 'queued' })

      await service.makeCall('+111', '+222', 'https://twiml.com', null, 30)

      const body = mock.history[0].body
      expect(body).toContain('Timeout=30')
    })

    it('throws on API error', async () => {
      mock.onPost(callsUrl).replyWithError({ message: 'Forbidden' })

      await expect(service.makeCall('+111', '+222')).rejects.toThrow()
    })
  })

  describe('getCall', () => {
    it('fetches call by SID', async () => {
      const url = `${ API_BASE }/Accounts/${ ACCOUNT_SID }/Calls/CA123.json`
      mock.onGet(url).reply({ sid: 'CA123', status: 'completed', duration: '45' })

      const result = await service.getCall('CA123')

      expect(result).toEqual({ sid: 'CA123', status: 'completed', duration: '45' })
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('listCalls', () => {
    const url = `${ API_BASE }/Accounts/${ ACCOUNT_SID }/Calls.json`

    it('lists calls with defaults', async () => {
      mock.onGet(url).reply({ calls: [], page: 0, page_size: 50 })

      const result = await service.listCalls()

      expect(result).toEqual({ calls: [], page: 0, page_size: 50 })
      expect(mock.history[0].query).toMatchObject({ PageSize: 50 })
    })

    it('passes optional filters', async () => {
      mock.onGet(url).reply({ calls: [] })

      await service.listCalls('+111', '+222', 'completed', 10)

      expect(mock.history[0].query).toMatchObject({
        PageSize: 10,
        To: '+111',
        From: '+222',
        Status: 'completed',
      })
    })

    it('omits undefined optional filters', async () => {
      mock.onGet(url).reply({ calls: [] })

      await service.listCalls(null, null, null, 20)

      const query = mock.history[0].query
      expect(query.PageSize).toBe(20)
      expect(query).not.toHaveProperty('To')
      expect(query).not.toHaveProperty('From')
      expect(query).not.toHaveProperty('Status')
    })
  })

  // ── Phone Numbers ──

  describe('listPhoneNumbers', () => {
    const url = `${ API_BASE }/Accounts/${ ACCOUNT_SID }/IncomingPhoneNumbers.json`

    it('lists phone numbers with default page size', async () => {
      mock.onGet(url).reply({ incoming_phone_numbers: [], page: 0, page_size: 50 })

      const result = await service.listPhoneNumbers()

      expect(result).toEqual({ incoming_phone_numbers: [], page: 0, page_size: 50 })
      expect(mock.history[0].query).toMatchObject({ PageSize: 50 })
    })

    it('passes custom page size', async () => {
      mock.onGet(url).reply({ incoming_phone_numbers: [] })

      await service.listPhoneNumbers(10)

      expect(mock.history[0].query).toMatchObject({ PageSize: 10 })
    })
  })

  // ── Account ──

  describe('getAccountInfo', () => {
    it('fetches account info', async () => {
      const url = `${ API_BASE }/Accounts/${ ACCOUNT_SID }.json`
      mock.onGet(url).reply({ sid: ACCOUNT_SID, friendly_name: 'Test', status: 'active' })

      const result = await service.getAccountInfo()

      expect(result).toEqual({ sid: ACCOUNT_SID, friendly_name: 'Test', status: 'active' })
      expect(mock.history[0].method).toBe('get')
    })
  })

  // ── Conversations ──

  describe('startConversation', () => {
    const convUrl = `${ CONVERSATIONS_BASE }/Conversations`

    it('creates conversation without participants', async () => {
      mock.onPost(convUrl).reply({ sid: 'CH123', friendly_name: 'Test Conv' })

      const result = await service.startConversation('Test Conv', 'test-001')

      expect(result).toEqual({
        conversation: { sid: 'CH123', friendly_name: 'Test Conv' },
        participants: [],
      })
      expect(mock.history).toHaveLength(1)
      const body = mock.history[0].body
      expect(body).toContain('FriendlyName=Test+Conv')
      expect(body).toContain('UniqueName=test-001')
    })

    it('creates conversation with participants', async () => {
      mock.onPost(convUrl).reply({ sid: 'CH123', friendly_name: 'Test' })
      mock.onPost(`${ convUrl }/CH123/Participants`).reply({ sid: 'MB001' })

      const result = await service.startConversation('Test', null, '+111, +222', '+999')

      expect(result.conversation.sid).toBe('CH123')
      expect(result.participants).toHaveLength(2)
      // 1 conversation create + 2 participant additions
      expect(mock.history).toHaveLength(3)
    })

    it('creates conversation with optional attributes', async () => {
      mock.onPost(convUrl).reply({ sid: 'CH124' })

      await service.startConversation(null, null, null, null, '{"key":"value"}')

      const body = mock.history[0].body
      expect(body).toContain('Attributes=%7B%22key%22%3A%22value%22%7D')
    })

    it('throws on API error', async () => {
      mock.onPost(convUrl).replyWithError({ message: 'Server Error' })

      await expect(service.startConversation('Fail')).rejects.toThrow()
    })
  })

  describe('addConversationParticipantSms', () => {
    it('adds SMS participant to conversation', async () => {
      const url = `${ CONVERSATIONS_BASE }/Conversations/CH123/Participants`
      mock.onPost(url).reply({ sid: 'MB001', conversation_sid: 'CH123' })

      const result = await service.addConversationParticipantSms('CH123', '+111', '+999')

      expect(result).toEqual({ sid: 'MB001', conversation_sid: 'CH123' })
      const body = mock.history[0].body
      expect(body).toContain('MessagingBinding.Address=%2B111')
      expect(body).toContain('MessagingBinding.ProxyAddress=%2B999')
    })

    it('includes optional attributes', async () => {
      const url = `${ CONVERSATIONS_BASE }/Conversations/CH123/Participants`
      mock.onPost(url).reply({ sid: 'MB002' })

      await service.addConversationParticipantSms('CH123', '+111', '+999', '{"role":"admin"}')

      const body = mock.history[0].body
      expect(body).toContain('Attributes=%7B%22role%22%3A%22admin%22%7D')
    })
  })

  describe('addConversationMessage', () => {
    it('adds message to conversation', async () => {
      const url = `${ CONVERSATIONS_BASE }/Conversations/CH123/Messages`
      mock.onPost(url).reply({ sid: 'IM001', body: 'Hello!' })

      const result = await service.addConversationMessage('CH123', 'Hello!', 'user1')

      expect(result).toEqual({ sid: 'IM001', body: 'Hello!' })
      const body = mock.history[0].body
      expect(body).toContain('Body=Hello%21')
      expect(body).toContain('Author=user1')
    })

    it('omits optional fields when not provided', async () => {
      const url = `${ CONVERSATIONS_BASE }/Conversations/CH123/Messages`
      mock.onPost(url).reply({ sid: 'IM002' })

      await service.addConversationMessage('CH123')

      const body = mock.history[0].body
      expect(body).toBe('')
    })
  })

  describe('getConversationMessages', () => {
    it('retrieves messages with defaults', async () => {
      const url = `${ CONVERSATIONS_BASE }/Conversations/CH123/Messages`
      mock.onGet(url).reply({ messages: [], meta: { page: 0 } })

      const result = await service.getConversationMessages('CH123')

      expect(result).toEqual({ messages: [], meta: { page: 0 } })
      expect(mock.history[0].query).toMatchObject({ PageSize: 50 })
    })

    it('passes order and page size', async () => {
      const url = `${ CONVERSATIONS_BASE }/Conversations/CH123/Messages`
      mock.onGet(url).reply({ messages: [] })

      await service.getConversationMessages('CH123', 'desc', 10)

      expect(mock.history[0].query).toMatchObject({ PageSize: 10, Order: 'desc' })
    })
  })

  describe('deleteConversationMessage', () => {
    it('deletes message and returns success', async () => {
      const url = `${ CONVERSATIONS_BASE }/Conversations/CH123/Messages/IM001`
      mock.onDelete(url).reply({})

      const result = await service.deleteConversationMessage('CH123', 'IM001')

      expect(result).toEqual({ success: true, message: 'Message deleted successfully' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on API error', async () => {
      const url = `${ CONVERSATIONS_BASE }/Conversations/CH123/Messages/IM999`
      mock.onDelete(url).replyWithError({ message: 'Not Found' })

      await expect(service.deleteConversationMessage('CH123', 'IM999')).rejects.toThrow()
    })
  })

  // ── Dictionaries ──

  describe('getPhoneNumbersDictionary', () => {
    const url = `${ API_BASE }/Accounts/${ ACCOUNT_SID }/IncomingPhoneNumbers.json`

    it('returns mapped items with label and value', async () => {
      mock.onGet(url).reply({
        incoming_phone_numbers: [
          { phone_number: '+111', friendly_name: 'Main Line', capabilities: { sms: true, voice: true, mms: false } },
        ],
        next_page_uri: null,
      })

      const result = await service.getPhoneNumbersDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({
        label: 'Main Line',
        value: '+111',
        note: expect.stringContaining('SMS'),
      })
      expect(result.cursor).toBeNull()
    })

    it('uses phone_number as label when friendly_name is empty', async () => {
      mock.onGet(url).reply({
        incoming_phone_numbers: [
          { phone_number: '+222', friendly_name: '', capabilities: {} },
        ],
        next_page_uri: null,
      })

      const result = await service.getPhoneNumbersDictionary({})

      expect(result.items[0].label).toBe('+222')
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(url).reply({
        incoming_phone_numbers: [
          { phone_number: '+111', friendly_name: 'Main Line', capabilities: {} },
          { phone_number: '+222', friendly_name: 'Fax Line', capabilities: {} },
        ],
        next_page_uri: null,
      })

      const result = await service.getPhoneNumbersDictionary({ search: 'main' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('+111')
    })

    it('handles null payload', async () => {
      mock.onGet(url).reply({
        incoming_phone_numbers: [{ phone_number: '+111', friendly_name: 'A', capabilities: {} }],
        next_page_uri: null,
      })

      const result = await service.getPhoneNumbersDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('handles empty or null data', async () => {
      mock.onGet(url).reply({ incoming_phone_numbers: null, next_page_uri: null })

      const result = await service.getPhoneNumbersDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('builds cursor from next_page_uri', async () => {
      mock.onGet(url).reply({
        incoming_phone_numbers: [],
        next_page_uri: '/2010-04-01/Accounts/AC123/IncomingPhoneNumbers.json?Page=1',
      })

      const result = await service.getPhoneNumbersDictionary({})

      expect(result.cursor).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/IncomingPhoneNumbers.json?Page=1')
    })

    it('uses cursor URL when cursor is provided', async () => {
      const cursorUrl = 'https://api.twilio.com/2010-04-01/Accounts/AC123/IncomingPhoneNumbers.json?Page=1'
      mock.onGet(cursorUrl).reply({ incoming_phone_numbers: [], next_page_uri: null })

      const result = await service.getPhoneNumbersDictionary({ cursor: cursorUrl })

      expect(mock.history[0].url).toBe(cursorUrl)
      expect(result.cursor).toBeNull()
    })
  })

  describe('getMessagesDictionary', () => {
    const url = `${ API_BASE }/Accounts/${ ACCOUNT_SID }/Messages.json`

    it('returns mapped items', async () => {
      mock.onGet(url).reply({
        messages: [
          { sid: 'SM1', to: '+111', body: 'Hello world', status: 'delivered', date_sent: '2024-01-15T10:30:00Z' },
        ],
        next_page_uri: null,
      })

      const result = await service.getMessagesDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('SM1')
      expect(result.items[0].label).toContain('To: +111')
      expect(result.items[0].note).toContain('delivered')
    })

    it('truncates long message body in label', async () => {
      const longBody = 'A'.repeat(60)
      mock.onGet(url).reply({
        messages: [{ sid: 'SM2', to: '+111', body: longBody, status: 'sent', date_sent: '2024-01-15T10:00:00Z' }],
        next_page_uri: null,
      })

      const result = await service.getMessagesDictionary({})

      expect(result.items[0].label).toContain('...')
    })

    it('filters by search', async () => {
      mock.onGet(url).reply({
        messages: [
          { sid: 'SM1', to: '+111', body: 'Hi', status: 'delivered', date_sent: '2024-01-15T10:00:00Z' },
          { sid: 'SM2', to: '+222', body: 'Bye', status: 'sent', date_sent: '2024-01-15T11:00:00Z' },
        ],
        next_page_uri: null,
      })

      const result = await service.getMessagesDictionary({ search: 'delivered' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('SM1')
    })

    it('handles null payload', async () => {
      mock.onGet(url).reply({ messages: [{ sid: 'SM1', to: '+111', body: 'X', status: 's', date_sent: '' }], next_page_uri: null })

      const result = await service.getMessagesDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('handles empty data', async () => {
      mock.onGet(url).reply({ messages: null, next_page_uri: null })

      const result = await service.getMessagesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getCallsDictionary', () => {
    const url = `${ API_BASE }/Accounts/${ ACCOUNT_SID }/Calls.json`

    it('returns mapped items', async () => {
      mock.onGet(url).reply({
        calls: [
          { sid: 'CA1', to: '+111', from: '+222', status: 'completed', duration: '45', start_time: '2024-01-15T10:30:00Z' },
        ],
        next_page_uri: null,
      })

      const result = await service.getCallsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({
        label: 'To: +111 - Duration: 45s',
        value: 'CA1',
        note: 'Status: completed, Started: 2024-01-15',
      })
    })

    it('handles null duration', async () => {
      mock.onGet(url).reply({
        calls: [{ sid: 'CA2', to: '+111', status: 'failed', duration: null, start_time: '2024-01-15T10:00:00Z' }],
        next_page_uri: null,
      })

      const result = await service.getCallsDictionary({})

      expect(result.items[0].label).toContain('Duration: 0s')
    })

    it('filters by search', async () => {
      mock.onGet(url).reply({
        calls: [
          { sid: 'CA1', to: '+111', status: 'completed', duration: '10', start_time: '' },
          { sid: 'CA2', to: '+222', status: 'failed', duration: '0', start_time: '' },
        ],
        next_page_uri: null,
      })

      const result = await service.getCallsDictionary({ search: 'failed' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('CA2')
    })

    it('handles null payload', async () => {
      mock.onGet(url).reply({ calls: [{ sid: 'CA1', to: '+1', status: 's', duration: '0', start_time: '' }], next_page_uri: null })

      const result = await service.getCallsDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('handles empty data', async () => {
      mock.onGet(url).reply({ calls: null, next_page_uri: null })

      const result = await service.getCallsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getConversationsDictionary', () => {
    const url = `${ CONVERSATIONS_BASE }/Conversations`

    it('returns mapped items', async () => {
      mock.onGet(url).reply({
        conversations: [
          { sid: 'CH1', friendly_name: 'Support', unique_name: 'support-001', state: 'active' },
        ],
        meta: { next_page_url: null },
      })

      const result = await service.getConversationsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({
        label: 'Support',
        value: 'CH1',
        note: 'Unique Name: support-001, State: active',
      })
      expect(result.cursor).toBeNull()
    })

    it('uses unique_name as label when friendly_name is missing', async () => {
      mock.onGet(url).reply({
        conversations: [{ sid: 'CH2', friendly_name: null, unique_name: 'my-conv', state: 'active' }],
        meta: { next_page_url: null },
      })

      const result = await service.getConversationsDictionary({})

      expect(result.items[0].label).toBe('my-conv')
    })

    it('uses sid as label when both names are missing', async () => {
      mock.onGet(url).reply({
        conversations: [{ sid: 'CH3', friendly_name: null, unique_name: null, state: 'active' }],
        meta: { next_page_url: null },
      })

      const result = await service.getConversationsDictionary({})

      expect(result.items[0].label).toBe('CH3')
    })

    it('filters by search', async () => {
      mock.onGet(url).reply({
        conversations: [
          { sid: 'CH1', friendly_name: 'Support', unique_name: 'support', state: 'active' },
          { sid: 'CH2', friendly_name: 'Sales', unique_name: 'sales', state: 'active' },
        ],
        meta: { next_page_url: null },
      })

      const result = await service.getConversationsDictionary({ search: 'sales' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('CH2')
    })

    it('handles null payload', async () => {
      mock.onGet(url).reply({ conversations: [{ sid: 'CH1', friendly_name: 'A', state: 'active' }], meta: { next_page_url: null } })

      const result = await service.getConversationsDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('handles empty data', async () => {
      mock.onGet(url).reply({ conversations: null, meta: { next_page_url: null } })

      const result = await service.getConversationsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('uses meta.next_page_url as cursor', async () => {
      mock.onGet(url).reply({
        conversations: [],
        meta: { next_page_url: 'https://conversations.twilio.com/v1/Conversations?Page=2' },
      })

      const result = await service.getConversationsDictionary({})

      expect(result.cursor).toBe('https://conversations.twilio.com/v1/Conversations?Page=2')
    })
  })

  // ── Triggers ──

  describe('onNewSms', () => {
    it('shapes event from payload', async () => {
      const payload = { MessageSid: 'SM1', From: '+111', To: '+222', Body: 'Hi' }
      const result = await service.onNewSms('SHAPE_EVENT', payload)

      expect(result).toEqual([{ name: 'onNewSms', data: payload }])
    })

    it('filters triggers - all numbers match when no phoneNumber set', async () => {
      const payload = {
        triggers: [{ id: 't1', data: {} }, { id: 't2', data: { phoneNumber: '+222' } }],
        eventData: { To: '+222' },
      }

      const result = await service.onNewSms('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['t1', 't2'] })
    })

    it('filters triggers - only matching phone number', async () => {
      const payload = {
        triggers: [
          { id: 't1', data: { phoneNumber: '+111' } },
          { id: 't2', data: { phoneNumber: '+222' } },
        ],
        eventData: { To: '+222' },
      }

      const result = await service.onNewSms('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['t2'] })
    })

    it('returns undefined for unknown call type', async () => {
      const result = await service.onNewSms('UNKNOWN', {})

      expect(result).toBeUndefined()
    })
  })

  describe('onNewCall', () => {
    it('shapes event from payload', async () => {
      const payload = { CallSid: 'CA1', From: '+111', To: '+222' }
      const result = await service.onNewCall('SHAPE_EVENT', payload)

      expect(result).toEqual([{ name: 'onNewCall', data: payload }])
    })

    it('filters triggers - matching phone number', async () => {
      const payload = {
        triggers: [
          { id: 't1', data: { phoneNumber: '+222' } },
          { id: 't2', data: { phoneNumber: '+333' } },
        ],
        eventData: { To: '+222' },
      }

      const result = await service.onNewCall('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['t1'] })
    })

    it('filters triggers - no phoneNumber matches all', async () => {
      const payload = {
        triggers: [{ id: 't1', data: {} }],
        eventData: { To: '+222' },
      }

      const result = await service.onNewCall('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['t1'] })
    })
  })

  // ── System / Webhook Methods ──

  describe('handleTriggerUpsertWebhook', () => {
    const phoneNumbersUrl = `${ API_BASE }/Accounts/${ ACCOUNT_SID }/IncomingPhoneNumbers.json`

    it('sets webhook URLs on first phone number', async () => {
      mock.onGet(phoneNumbersUrl).reply({
        incoming_phone_numbers: [{ sid: 'PN123', phone_number: '+111' }],
      })
      mock.onPost(`${ API_BASE }/Accounts/${ ACCOUNT_SID }/IncomingPhoneNumbers/PN123.json`).reply({})

      const result = await service.handleTriggerUpsertWebhook({ callbackUrl: 'https://callback.example.com' })

      expect(result.webhookData).toHaveProperty('webhookUrl', 'https://callback.example.com')
      expect(result.webhookData).toHaveProperty('created')
      expect(mock.history).toHaveLength(2)

      const updateBody = mock.history[1].body
      expect(updateBody).toContain('SmsUrl=https%3A%2F%2Fcallback.example.com')
      expect(updateBody).toContain('VoiceUrl=https%3A%2F%2Fcallback.example.com')
    })

    it('handles no phone numbers gracefully', async () => {
      mock.onGet(phoneNumbersUrl).reply({ incoming_phone_numbers: [] })

      const result = await service.handleTriggerUpsertWebhook({ callbackUrl: 'https://cb.com' })

      expect(result.webhookData.webhookUrl).toBe('https://cb.com')
      expect(mock.history).toHaveLength(1)
    })

    it('throws on API error', async () => {
      mock.onGet(phoneNumbersUrl).replyWithError({ message: 'Auth failed' })

      await expect(service.handleTriggerUpsertWebhook({ callbackUrl: 'https://cb.com' })).rejects.toThrow()
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('resolves SMS events', async () => {
      const invocation = {
        body: { MessageSid: 'SM1', From: '+111', To: '+222', Body: 'Test' },
        queryParams: { connectionId: 'conn-1' },
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.connectionId).toBe('conn-1')
      expect(result.events).toHaveLength(1)
      expect(result.events[0].name).toBe('onNewSms')
    })

    it('resolves Call events', async () => {
      const invocation = {
        body: { CallSid: 'CA1', From: '+111', To: '+222' },
        queryParams: { connectionId: 'conn-2' },
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.events).toHaveLength(1)
      expect(result.events[0].name).toBe('onNewCall')
    })

    it('returns empty events for unknown body', async () => {
      const invocation = {
        body: { SomeOtherField: 'value' },
        queryParams: { connectionId: 'conn-3' },
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.events).toEqual([])
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('delegates to the correct trigger method', async () => {
      const invocation = {
        eventName: 'onNewSms',
        triggers: [{ id: 't1', data: {} }],
        eventData: { To: '+222' },
      }

      const result = await service.handleTriggerSelectMatched(invocation)

      expect(result).toEqual({ ids: ['t1'] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    const phoneNumbersUrl = `${ API_BASE }/Accounts/${ ACCOUNT_SID }/IncomingPhoneNumbers.json`

    it('clears webhook URLs on all phone numbers', async () => {
      mock.onGet(phoneNumbersUrl).reply({
        incoming_phone_numbers: [
          { sid: 'PN1', phone_number: '+111' },
          { sid: 'PN2', phone_number: '+222' },
        ],
      })
      mock.onPost(`${ API_BASE }/Accounts/${ ACCOUNT_SID }/IncomingPhoneNumbers/PN1.json`).reply({})
      mock.onPost(`${ API_BASE }/Accounts/${ ACCOUNT_SID }/IncomingPhoneNumbers/PN2.json`).reply({})

      const result = await service.handleTriggerDeleteWebhook({})

      expect(result).toEqual({})
      // 1 GET + 2 POSTs
      expect(mock.history).toHaveLength(3)

      const body1 = mock.history[1].body
      expect(body1).toContain('SmsUrl=')
      expect(body1).toContain('VoiceUrl=')
    })

    it('handles no phone numbers', async () => {
      mock.onGet(phoneNumbersUrl).reply({ incoming_phone_numbers: [] })

      const result = await service.handleTriggerDeleteWebhook({})

      expect(result).toEqual({})
      expect(mock.history).toHaveLength(1)
    })

    it('throws on API error', async () => {
      mock.onGet(phoneNumbersUrl).replyWithError({ message: 'Error' })

      await expect(service.handleTriggerDeleteWebhook({})).rejects.toThrow()
    })
  })
})
