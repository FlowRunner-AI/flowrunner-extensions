'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_KEY = 'test-access-key'
const BASE = 'https://rest.messagebird.com'

describe('MessageBird Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accessKey: ACCESS_KEY })
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
          name: 'accessKey',
          displayName: 'Access Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends correct auth header on requests', async () => {
      mock.onGet(`${BASE}/balance`).reply({ payment: 'prepaid', type: 'credits', amount: 87.5 })

      await service.getBalance()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `AccessKey ${ACCESS_KEY}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Messaging ──

  describe('sendSms', () => {
    it('sends POST with correct body and defaults', async () => {
      const mockResponse = { id: 'msg-123', originator: 'MyCompany', body: 'Hello!' }
      mock.onPost(`${BASE}/messages`).reply(mockResponse)

      const result = await service.sendSms('MyCompany', ['+31612345678'], 'Hello!')

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toMatchObject({
        originator: 'MyCompany',
        recipients: ['+31612345678'],
        body: 'Hello!',
      })
    })

    it('resolves type choice from display label to API value', async () => {
      mock.onPost(`${BASE}/messages`).reply({ id: 'msg-456' })

      await service.sendSms('MyCompany', ['+31612345678'], 'deadbeef', 'Binary')

      expect(mock.history[0].body).toMatchObject({
        type: 'binary',
      })
    })

    it('passes optional reference and scheduledDatetime', async () => {
      mock.onPost(`${BASE}/messages`).reply({ id: 'msg-789' })

      await service.sendSms(
        'MyCompany', ['+31612345678'], 'Hello!', 'Text', 'ref-001', '2024-05-01T14:00:00+00:00'
      )

      expect(mock.history[0].body).toMatchObject({
        type: 'text',
        reference: 'ref-001',
        scheduledDatetime: '2024-05-01T14:00:00+00:00',
      })
    })

    it('converts comma-separated string recipients to array', async () => {
      mock.onPost(`${BASE}/messages`).reply({ id: 'msg-111' })

      await service.sendSms('MyCompany', '+31612345678, +31698765432', 'Hi')

      expect(mock.history[0].body.recipients).toEqual(['+31612345678', '+31698765432'])
    })

    it('throws on API error with formatted message', async () => {
      mock.onPost(`${BASE}/messages`).replyWithError({
        message: 'Bad Request',
        body: {
          errors: [{ code: 9, description: 'no (correct) recipients found', parameter: 'recipients' }],
        },
      })

      await expect(service.sendSms('MyCompany', [], 'Hello!')).rejects.toThrow('MessageBird API error')
    })
  })

  describe('getMessage', () => {
    it('sends GET to correct URL', async () => {
      const mockResponse = { id: 'msg-123', body: 'Hello!' }
      mock.onGet(`${BASE}/messages/msg-123`).reply(mockResponse)

      const result = await service.getMessage('msg-123')

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${BASE}/messages/msg-123`)
    })
  })

  describe('listMessages', () => {
    it('sends GET with default pagination query params', async () => {
      const mockResponse = { offset: 0, limit: 20, count: 0, totalCount: 0, items: [] }
      mock.onGet(`${BASE}/messages`).reply(mockResponse)

      const result = await service.listMessages(20, 0)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].query).toMatchObject({ limit: 20, offset: 0 })
    })

    it('sends custom pagination values', async () => {
      mock.onGet(`${BASE}/messages`).reply({ offset: 10, limit: 5, count: 0, totalCount: 0, items: [] })

      await service.listMessages(5, 10)

      expect(mock.history[0].query).toMatchObject({ limit: 5, offset: 10 })
    })
  })

  // ── Voice ──

  describe('sendVoiceMessage', () => {
    it('sends POST with correct body and resolves choice values', async () => {
      const mockResponse = { id: 'voice-123', body: 'Hello voice' }
      mock.onPost(`${BASE}/voicemessages`).reply(mockResponse)

      const result = await service.sendVoiceMessage(
        ['+31612345678'], 'Hello voice', 'English (UK)', 'Female', 'Delay'
      )

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].body).toMatchObject({
        recipients: ['+31612345678'],
        body: 'Hello voice',
        language: 'en-gb',
        voice: 'female',
        ifMachine: 'delay',
      })
    })

    it('resolves Male voice and Hang Up ifMachine choices', async () => {
      mock.onPost(`${BASE}/voicemessages`).reply({ id: 'voice-456' })

      await service.sendVoiceMessage(['+31612345678'], 'Test', 'German', 'Male', 'Hang Up')

      expect(mock.history[0].body).toMatchObject({
        language: 'de-de',
        voice: 'male',
        ifMachine: 'hangup',
      })
    })

    it('resolves Continue ifMachine choice', async () => {
      mock.onPost(`${BASE}/voicemessages`).reply({ id: 'voice-789' })

      await service.sendVoiceMessage(['+31612345678'], 'Test', 'French (France)', 'Female', 'Continue')

      expect(mock.history[0].body).toMatchObject({
        language: 'fr-fr',
        ifMachine: 'continue',
      })
    })
  })

  // ── Verify ──

  describe('sendVerification', () => {
    it('sends POST with required and optional fields', async () => {
      const mockResponse = { id: 'verify-123', status: 'sent' }
      mock.onPost(`${BASE}/verify`).reply(mockResponse)

      const result = await service.sendVerification(
        '+31612345678', 'MyApp', 'SMS', 'Your code is %token'
      )

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].body).toMatchObject({
        recipient: '+31612345678',
        originator: 'MyApp',
        type: 'sms',
        template: 'Your code is %token',
      })
    })

    it('resolves Text-to-Speech type choice', async () => {
      mock.onPost(`${BASE}/verify`).reply({ id: 'verify-456' })

      await service.sendVerification('+31612345678', undefined, 'Text-to-Speech')

      expect(mock.history[0].body).toMatchObject({ type: 'tts' })
    })

    it('resolves Flash type choice', async () => {
      mock.onPost(`${BASE}/verify`).reply({ id: 'verify-789' })

      await service.sendVerification('+31612345678', undefined, 'Flash')

      expect(mock.history[0].body).toMatchObject({ type: 'flash' })
    })
  })

  describe('verifyToken', () => {
    it('sends GET with token as query parameter', async () => {
      const mockResponse = { id: 'verify-123', status: 'verified' }
      mock.onGet(`${BASE}/verify/verify-123`).reply(mockResponse)

      const result = await service.verifyToken('verify-123', '123456')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].query).toMatchObject({ token: '123456' })
    })
  })

  describe('getVerification', () => {
    it('sends GET to correct URL', async () => {
      const mockResponse = { id: 'verify-123', status: 'sent' }
      mock.onGet(`${BASE}/verify/verify-123`).reply(mockResponse)

      const result = await service.getVerification('verify-123')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].url).toBe(`${BASE}/verify/verify-123`)
    })
  })

  describe('deleteVerification', () => {
    it('sends DELETE and returns success object', async () => {
      mock.onDelete(`${BASE}/verify/verify-123`).reply(undefined)

      const result = await service.deleteVerification('verify-123')

      expect(result).toEqual({ success: true })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Lookup ──

  describe('phoneNumberLookup', () => {
    it('sends GET with phone number in URL path', async () => {
      const mockResponse = { phoneNumber: 31612345678, type: 'mobile', countryCode: 'NL' }
      mock.onGet(`${BASE}/lookup/%2B31612345678`).reply(mockResponse)

      const result = await service.phoneNumberLookup('+31612345678')

      expect(result).toEqual(mockResponse)
    })

    it('passes optional countryCode as query parameter', async () => {
      mock.onGet(`${BASE}/lookup/612345678`).reply({ phoneNumber: 31612345678 })

      await service.phoneNumberLookup('612345678', 'NL')

      expect(mock.history[0].query).toMatchObject({ countryCode: 'NL' })
    })
  })

  describe('lookupHlr', () => {
    it('sends GET to /lookup/{phone}/hlr', async () => {
      const mockResponse = { id: 'hlr-123', status: 'active' }
      mock.onGet(`${BASE}/lookup/%2B31612345678/hlr`).reply(mockResponse)

      const result = await service.lookupHlr('+31612345678')

      expect(result).toEqual(mockResponse)
    })

    it('passes optional countryCode as query parameter', async () => {
      mock.onGet(`${BASE}/lookup/612345678/hlr`).reply({ id: 'hlr-456' })

      await service.lookupHlr('612345678', 'US')

      expect(mock.history[0].query).toMatchObject({ countryCode: 'US' })
    })
  })

  // ── Contacts ──

  describe('createContact', () => {
    it('sends POST with required and optional fields', async () => {
      const mockResponse = { id: 'contact-123', msisdn: 31612345678 }
      mock.onPost(`${BASE}/contacts`).reply(mockResponse)

      const result = await service.createContact('+31612345678', 'Jane', 'Doe', 'VIP')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].body).toMatchObject({
        msisdn: '+31612345678',
        firstName: 'Jane',
        lastName: 'Doe',
        custom1: 'VIP',
      })
    })

    it('sends only required fields when optionals are omitted', async () => {
      mock.onPost(`${BASE}/contacts`).reply({ id: 'contact-456' })

      await service.createContact('+31612345678')

      expect(mock.history[0].body).toMatchObject({ msisdn: '+31612345678' })
    })
  })

  describe('getContact', () => {
    it('sends GET to correct URL', async () => {
      const mockResponse = { id: 'contact-123', firstName: 'Jane' }
      mock.onGet(`${BASE}/contacts/contact-123`).reply(mockResponse)

      const result = await service.getContact('contact-123')

      expect(result).toEqual(mockResponse)
    })
  })

  describe('listContacts', () => {
    it('sends GET with pagination query params', async () => {
      const mockResponse = { offset: 0, limit: 20, count: 0, totalCount: 0, items: [] }
      mock.onGet(`${BASE}/contacts`).reply(mockResponse)

      const result = await service.listContacts(20, 0)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].query).toMatchObject({ limit: 20, offset: 0 })
    })
  })

  describe('updateContact', () => {
    it('sends PATCH with updated fields', async () => {
      const mockResponse = { id: 'contact-123', firstName: 'Jane', lastName: 'Smith' }
      mock.onPatch(`${BASE}/contacts/contact-123`).reply(mockResponse)

      const result = await service.updateContact('contact-123', undefined, 'Jane', 'Smith')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].method).toBe('patch')
    })
  })

  describe('deleteContact', () => {
    it('sends DELETE and returns success object', async () => {
      mock.onDelete(`${BASE}/contacts/contact-123`).reply(undefined)

      const result = await service.deleteContact('contact-123')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Groups ──

  describe('listGroups', () => {
    it('sends GET with pagination query params', async () => {
      const mockResponse = { offset: 0, limit: 20, count: 1, totalCount: 1, items: [{ id: 'grp-1', name: 'Newsletter' }] }
      mock.onGet(`${BASE}/groups`).reply(mockResponse)

      const result = await service.listGroups(20, 0)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].query).toMatchObject({ limit: 20, offset: 0 })
    })
  })

  describe('addContactToGroup', () => {
    it('sends PUT with contact IDs as query string', async () => {
      mock.onPut(`${BASE}/groups/grp-1/contacts?ids[]=c1&ids[]=c2`).reply(undefined)

      const result = await service.addContactToGroup('grp-1', ['c1', 'c2'])

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('put')
    })
  })

  describe('removeContactFromGroup', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/groups/grp-1/contacts/contact-123`).reply(undefined)

      const result = await service.removeContactFromGroup('grp-1', 'contact-123')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Account ──

  describe('getBalance', () => {
    it('sends GET and returns balance data', async () => {
      const mockResponse = { payment: 'prepaid', type: 'credits', amount: 87.5 }
      mock.onGet(`${BASE}/balance`).reply(mockResponse)

      const result = await service.getBalance()

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Dictionary ──

  describe('getGroupsDictionary', () => {
    it('returns formatted items from API response', async () => {
      mock.onGet(`${BASE}/groups`).reply({
        items: [
          { id: 'grp-1', name: 'Newsletter', contacts: { totalCount: 42 } },
          { id: 'grp-2', name: 'VIP', contacts: { totalCount: 5 } },
        ],
        totalCount: 2,
      })

      const result = await service.getGroupsDictionary({})

      expect(result.items).toEqual([
        { label: 'Newsletter', value: 'grp-1', note: '42 contacts' },
        { label: 'VIP', value: 'grp-2', note: '5 contacts' },
      ])
      expect(result.cursor).toBeNull()
      expect(mock.history[0].query).toMatchObject({ limit: 50, offset: 0 })
    })

    it('filters items by search text (case-insensitive)', async () => {
      mock.onGet(`${BASE}/groups`).reply({
        items: [
          { id: 'grp-1', name: 'Newsletter', contacts: { totalCount: 42 } },
          { id: 'grp-2', name: 'VIP Customers', contacts: { totalCount: 5 } },
        ],
        totalCount: 2,
      })

      const result = await service.getGroupsDictionary({ search: 'vip' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('grp-2')
    })

    it('returns cursor when more pages are available', async () => {
      const items = Array.from({ length: 50 }, (_, i) => ({
        id: `grp-${i}`, name: `Group ${i}`, contacts: { totalCount: i },
      }))

      mock.onGet(`${BASE}/groups`).reply({ items, totalCount: 100 })

      const result = await service.getGroupsDictionary({})

      expect(result.cursor).toBe('50')
    })

    it('uses cursor for pagination offset', async () => {
      mock.onGet(`${BASE}/groups`).reply({ items: [], totalCount: 100 })

      await service.getGroupsDictionary({ cursor: '50' })

      expect(mock.history[0].query).toMatchObject({ limit: 50, offset: 50 })
    })

    it('handles empty payload gracefully', async () => {
      mock.onGet(`${BASE}/groups`).reply({ items: [], totalCount: 0 })

      const result = await service.getGroupsDictionary()

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })

    it('handles missing contacts totalCount with default 0', async () => {
      mock.onGet(`${BASE}/groups`).reply({
        items: [{ id: 'grp-1', name: 'Empty Group' }],
        totalCount: 1,
      })

      const result = await service.getGroupsDictionary({})

      expect(result.items[0].note).toBe('0 contacts')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('formats multiple API errors into a single message', async () => {
      mock.onGet(`${BASE}/balance`).replyWithError({
        message: 'Forbidden',
        body: {
          errors: [
            { code: 2, description: 'Request not allowed', parameter: 'accessKey' },
            { code: 10, description: 'Invalid parameter' },
          ],
        },
      })

      await expect(service.getBalance()).rejects.toThrow(
        'MessageBird API error: [2] Request not allowed (parameter: accessKey); [10] Invalid parameter'
      )
    })

    it('falls back to error.body.message when errors array is absent', async () => {
      mock.onGet(`${BASE}/balance`).replyWithError({
        message: 'Something went wrong',
        body: { message: 'Service unavailable' },
      })

      await expect(service.getBalance()).rejects.toThrow('MessageBird API error: Service unavailable')
    })

    it('falls back to error.message when body has no message', async () => {
      mock.onGet(`${BASE}/balance`).replyWithError({
        message: 'Network error',
      })

      await expect(service.getBalance()).rejects.toThrow('MessageBird API error: Network error')
    })
  })
})
