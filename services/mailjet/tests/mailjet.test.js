'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const SECRET_KEY = 'test-secret-key'
const BASE = 'https://api.mailjet.com'
const AUTH_HEADER = `Basic ${ Buffer.from(`${ API_KEY }:${ SECRET_KEY }`).toString('base64') }`

describe('Mailjet Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, secretKey: SECRET_KEY })
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
        expect.objectContaining({
          name: 'secretKey',
          displayName: 'Secret Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends basic auth header on requests', async () => {
      mock.onGet(`${ BASE }/v3/REST/contact`).reply({ Count: 0, Total: 0, Data: [] })

      await service.listContacts()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': AUTH_HEADER,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Email Sending ──

  describe('sendEmail', () => {
    it('sends with required params only', async () => {
      mock.onPost(`${ BASE }/v3.1/send`).reply({
        Messages: [{
          Status: 'success',
          To: [{ Email: 'to@example.com', MessageUUID: 'uuid-1', MessageID: 123 }],
        }],
      })

      const result = await service.sendEmail('from@example.com', undefined, ['to@example.com'])

      expect(result).toMatchObject({ Status: 'success' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        Messages: [{
          From: { Email: 'from@example.com' },
          To: [{ Email: 'to@example.com' }],
        }],
      })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/v3.1/send`).reply({
        Messages: [{ Status: 'success', To: [] }],
      })

      await service.sendEmail(
        'from@example.com',      // fromEmail
        'Sender Name',           // fromName
        ['to@example.com'],      // to
        ['cc@example.com'],      // cc
        ['bcc@example.com'],     // bcc
        'Test Subject',          // subject
        'Plain text body',       // textPart
        '<p>HTML body</p>',      // htmlPart
        'reply@example.com',     // replyTo
        '12345',                 // templateId
        true,                    // templateLanguage
        { firstName: 'John' },   // variables
        undefined,               // attachmentUrls (skip for simplicity)
        'custom-id-123',         // customId
        'event-payload',         // eventPayload
        true                     // sandboxMode
      )

      expect(mock.history[0].body).toEqual({
        Messages: [{
          From: { Email: 'from@example.com', Name: 'Sender Name' },
          To: [{ Email: 'to@example.com' }],
          Cc: [{ Email: 'cc@example.com' }],
          Bcc: [{ Email: 'bcc@example.com' }],
          Subject: 'Test Subject',
          TextPart: 'Plain text body',
          HTMLPart: '<p>HTML body</p>',
          ReplyTo: { Email: 'reply@example.com' },
          TemplateID: 12345,
          TemplateLanguage: true,
          Variables: { firstName: 'John' },
          CustomID: 'custom-id-123',
          EventPayload: 'event-payload',
        }],
        SandboxMode: true,
      })
    })

    it('parses comma-separated recipients', async () => {
      mock.onPost(`${ BASE }/v3.1/send`).reply({
        Messages: [{ Status: 'success', To: [] }],
      })

      await service.sendEmail('from@example.com', undefined, 'a@x.com, b@x.com')

      expect(mock.history[0].body.Messages[0].To).toEqual([
        { Email: 'a@x.com' },
        { Email: 'b@x.com' },
      ])
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/v3.1/send`).replyWithError({
        message: 'Unauthorized',
        body: { ErrorMessage: 'Invalid credentials' },
      })

      await expect(service.sendEmail('from@example.com', undefined, ['to@example.com']))
        .rejects.toThrow('Mailjet API error')
    })
  })

  describe('sendBulkEmails', () => {
    it('sends messages array and returns full response', async () => {
      const messages = [
        { From: { Email: 'a@x.com' }, To: [{ Email: 'b@x.com' }], Subject: 'Hi' },
      ]

      mock.onPost(`${ BASE }/v3.1/send`).reply({ Messages: [{ Status: 'success' }] })

      const result = await service.sendBulkEmails(messages)

      expect(result).toEqual({ Messages: [{ Status: 'success' }] })
      expect(mock.history[0].body).toEqual({ Messages: messages })
    })

    it('includes sandbox mode when enabled', async () => {
      mock.onPost(`${ BASE }/v3.1/send`).reply({ Messages: [] })

      await service.sendBulkEmails([{ From: { Email: 'a@x.com' } }], true)

      expect(mock.history[0].body).toMatchObject({ SandboxMode: true })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/v3.1/send`).replyWithError({ message: 'Bad Request' })

      await expect(service.sendBulkEmails([])).rejects.toThrow('Mailjet API error')
    })
  })

  // ── Contacts ──

  describe('createContact', () => {
    it('sends with required params only', async () => {
      mock.onPost(`${ BASE }/v3/REST/contact`).reply({
        Count: 1, Total: 1,
        Data: [{ ID: 123, Email: 'john@example.com' }],
      })

      const result = await service.createContact('john@example.com')

      expect(result).toEqual({ ID: 123, Email: 'john@example.com' })
      expect(mock.history[0].body).toEqual({ Email: 'john@example.com' })
    })

    it('includes optional name and exclusion flag', async () => {
      mock.onPost(`${ BASE }/v3/REST/contact`).reply({
        Count: 1, Total: 1,
        Data: [{ ID: 124, Email: 'jane@example.com', Name: 'Jane', IsExcludedFromCampaigns: true }],
      })

      await service.createContact('jane@example.com', 'Jane', true)

      expect(mock.history[0].body).toEqual({
        Email: 'jane@example.com',
        Name: 'Jane',
        IsExcludedFromCampaigns: true,
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/v3/REST/contact`).replyWithError({ message: 'Duplicate' })

      await expect(service.createContact('john@example.com')).rejects.toThrow('Mailjet API error')
    })
  })

  describe('getContact', () => {
    it('fetches by email with url encoding', async () => {
      mock.onGet(`${ BASE }/v3/REST/contact/john%40example.com`).reply({
        Count: 1, Total: 1,
        Data: [{ ID: 123, Email: 'john@example.com' }],
      })

      const result = await service.getContact('john@example.com')

      expect(result).toEqual({ ID: 123, Email: 'john@example.com' })
      expect(mock.history[0].url).toBe(`${ BASE }/v3/REST/contact/john%40example.com`)
    })

    it('fetches by numeric ID', async () => {
      mock.onGet(`${ BASE }/v3/REST/contact/123`).reply({
        Count: 1, Total: 1,
        Data: [{ ID: 123, Email: 'john@example.com' }],
      })

      const result = await service.getContact('123')

      expect(result).toEqual({ ID: 123, Email: 'john@example.com' })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/v3/REST/contact/999`).replyWithError({ message: 'Not found' })

      await expect(service.getContact('999')).rejects.toThrow('Mailjet API error')
    })
  })

  describe('listContacts', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/v3/REST/contact`).reply({ Count: 0, Total: 0, Data: [] })

      const result = await service.listContacts()

      expect(result).toEqual({ count: 0, total: 0, data: [] })
      expect(mock.history[0].query).toMatchObject({ Limit: 50 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/v3/REST/contact`).reply({ Count: 0, Total: 0, Data: [] })

      await service.listContacts(10, 20)

      expect(mock.history[0].query).toMatchObject({ Limit: 10, Offset: 20 })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/v3/REST/contact`).replyWithError({ message: 'Boom' })

      await expect(service.listContacts()).rejects.toThrow('Mailjet API error')
    })
  })

  describe('updateContact', () => {
    it('sends put with name', async () => {
      mock.onPut(`${ BASE }/v3/REST/contact/123`).reply({
        Count: 1, Total: 1,
        Data: [{ ID: 123, Name: 'Updated' }],
      })

      const result = await service.updateContact('123', 'Updated')

      expect(result).toEqual({ ID: 123, Name: 'Updated' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ Name: 'Updated' })
    })

    it('includes isExcludedFromCampaigns when provided', async () => {
      mock.onPut(`${ BASE }/v3/REST/contact/123`).reply({
        Count: 1, Total: 1,
        Data: [{ ID: 123, IsExcludedFromCampaigns: true }],
      })

      await service.updateContact('123', undefined, true)

      expect(mock.history[0].body).toEqual({ IsExcludedFromCampaigns: true })
    })

    it('sends isExcludedFromCampaigns false explicitly', async () => {
      mock.onPut(`${ BASE }/v3/REST/contact/123`).reply({
        Count: 1, Total: 1,
        Data: [{ ID: 123, IsExcludedFromCampaigns: false }],
      })

      await service.updateContact('123', undefined, false)

      expect(mock.history[0].body).toEqual({ IsExcludedFromCampaigns: false })
    })

    it('throws on API error', async () => {
      mock.onPut(`${ BASE }/v3/REST/contact/123`).replyWithError({ message: 'Boom' })

      await expect(service.updateContact('123', 'Name')).rejects.toThrow('Mailjet API error')
    })
  })

  describe('updateContactProperties', () => {
    it('converts key-value object to Mailjet Data array', async () => {
      mock.onPut(`${ BASE }/v3/REST/contactdata/123`).reply({
        Count: 1, Total: 1,
        Data: [{ ID: 123, Data: [{ Name: 'firstname', Value: 'John' }] }],
      })

      const result = await service.updateContactProperties('123', { firstname: 'John', country: 'US' })

      expect(result).toHaveProperty('Data')
      expect(mock.history[0].body).toEqual({
        Data: [
          { Name: 'firstname', Value: 'John' },
          { Name: 'country', Value: 'US' },
        ],
      })
    })

    it('sends empty Data array for empty properties', async () => {
      mock.onPut(`${ BASE }/v3/REST/contactdata/123`).reply({
        Count: 1, Total: 1,
        Data: [{ ID: 123, Data: [] }],
      })

      await service.updateContactProperties('123', {})

      expect(mock.history[0].body).toEqual({ Data: [] })
    })

    it('throws on API error', async () => {
      mock.onPut(`${ BASE }/v3/REST/contactdata/123`).replyWithError({ message: 'Boom' })

      await expect(service.updateContactProperties('123', { a: 'b' })).rejects.toThrow('Mailjet API error')
    })
  })

  describe('deleteContact', () => {
    it('sends delete to v4 endpoint and returns success', async () => {
      mock.onDelete(`${ BASE }/v4/contacts/123`).reply(undefined)

      const result = await service.deleteContact('123')

      expect(result).toEqual({ success: true, contactId: '123' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/v4/contacts/123`)
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/v4/contacts/999`).replyWithError({ message: 'Boom' })

      await expect(service.deleteContact('999')).rejects.toThrow('Mailjet API error')
    })
  })

  // ── Contact Lists ──

  describe('createContactList', () => {
    it('sends POST with name', async () => {
      mock.onPost(`${ BASE }/v3/REST/contactslist`).reply({
        Count: 1, Total: 1,
        Data: [{ ID: 987, Name: 'Newsletter' }],
      })

      const result = await service.createContactList('Newsletter')

      expect(result).toEqual({ ID: 987, Name: 'Newsletter' })
      expect(mock.history[0].body).toEqual({ Name: 'Newsletter' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/v3/REST/contactslist`).replyWithError({ message: 'Boom' })

      await expect(service.createContactList('Test')).rejects.toThrow('Mailjet API error')
    })
  })

  describe('listContactLists', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/v3/REST/contactslist`).reply({ Count: 0, Total: 0, Data: [] })

      const result = await service.listContactLists()

      expect(result).toEqual({ count: 0, total: 0, data: [] })
      expect(mock.history[0].query).toMatchObject({ Limit: 50 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/v3/REST/contactslist`).reply({ Count: 0, Total: 0, Data: [] })

      await service.listContactLists(10, 20)

      expect(mock.history[0].query).toMatchObject({ Limit: 10, Offset: 20 })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/v3/REST/contactslist`).replyWithError({ message: 'Boom' })

      await expect(service.listContactLists()).rejects.toThrow('Mailjet API error')
    })
  })

  describe('manageListSubscription', () => {
    it('sends addforce action with email', async () => {
      mock.onPost(`${ BASE }/v3/REST/contactslist/987/managecontact`).reply({
        Count: 1, Total: 1,
        Data: [{ ContactID: 123, Email: 'john@example.com', Action: 'addforce' }],
      })

      const result = await service.manageListSubscription('987', 'john@example.com', 'Add Force')

      expect(result).toEqual({ ContactID: 123, Email: 'john@example.com', Action: 'addforce' })
      expect(mock.history[0].body).toEqual({
        Email: 'john@example.com',
        Action: 'addforce',
      })
    })

    it('maps all action choices correctly', async () => {
      const actions = {
        'Add Force': 'addforce',
        'Add No Force': 'addnoforce',
        'Remove': 'remove',
        'Unsubscribe': 'unsub',
      }

      for (const [display, api] of Object.entries(actions)) {
        mock.onPost(`${ BASE }/v3/REST/contactslist/987/managecontact`).reply({
          Count: 1, Total: 1,
          Data: [{ Action: api }],
        })

        await service.manageListSubscription('987', 'test@example.com', display)

        expect(mock.history[mock.history.length - 1].body.Action).toBe(api)
      }
    })

    it('includes name and properties when provided', async () => {
      mock.onPost(`${ BASE }/v3/REST/contactslist/987/managecontact`).reply({
        Count: 1, Total: 1,
        Data: [{ ContactID: 123 }],
      })

      await service.manageListSubscription('987', 'john@example.com', 'Add Force', 'John', { firstname: 'John' })

      expect(mock.history[0].body).toEqual({
        Email: 'john@example.com',
        Action: 'addforce',
        Name: 'John',
        Properties: { firstname: 'John' },
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/v3/REST/contactslist/987/managecontact`).replyWithError({ message: 'Boom' })

      await expect(service.manageListSubscription('987', 'john@example.com', 'Add Force'))
        .rejects.toThrow('Mailjet API error')
    })
  })

  // ── Templates ──

  describe('listTemplates', () => {
    it('uses default pagination and filters by user', async () => {
      mock.onGet(`${ BASE }/v3/REST/template`).reply({ Count: 0, Total: 0, Data: [] })

      const result = await service.listTemplates()

      expect(result).toEqual({ count: 0, total: 0, data: [] })
      expect(mock.history[0].query).toMatchObject({ OwnerType: 'user', Limit: 50 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/v3/REST/template`).reply({ Count: 0, Total: 0, Data: [] })

      await service.listTemplates(10, 20)

      expect(mock.history[0].query).toMatchObject({ Limit: 10, Offset: 20 })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/v3/REST/template`).replyWithError({ message: 'Boom' })

      await expect(service.listTemplates()).rejects.toThrow('Mailjet API error')
    })
  })

  // ── Messages & Statistics ──

  describe('listMessages', () => {
    it('uses default pagination with no filters', async () => {
      mock.onGet(`${ BASE }/v3/REST/message`).reply({ Count: 0, Total: 0, Data: [] })

      const result = await service.listMessages()

      expect(result).toEqual({ count: 0, total: 0, data: [] })
      expect(mock.history[0].query).toMatchObject({ Limit: 50 })
    })

    it('includes all filters when provided', async () => {
      mock.onGet(`${ BASE }/v3/REST/message`).reply({ Count: 1, Total: 1, Data: [{ ID: 111 }] })

      await service.listMessages('2026-01-01T00:00:00Z', '2026-01-31T23:59:59Z', 'test@x.com', 10, 5)

      expect(mock.history[0].query).toMatchObject({
        FromTS: '2026-01-01T00:00:00Z',
        ToTS: '2026-01-31T23:59:59Z',
        ContactAlt: 'test@x.com',
        Limit: 10,
        Offset: 5,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/v3/REST/message`).replyWithError({ message: 'Boom' })

      await expect(service.listMessages()).rejects.toThrow('Mailjet API error')
    })
  })

  describe('getMessage', () => {
    it('fetches a message by ID', async () => {
      mock.onGet(`${ BASE }/v3/REST/message/12345`).reply({
        Count: 1, Total: 1,
        Data: [{ ID: 12345, Status: 'opened' }],
      })

      const result = await service.getMessage('12345')

      expect(result).toEqual({ ID: 12345, Status: 'opened' })
      expect(mock.history[0].url).toBe(`${ BASE }/v3/REST/message/12345`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/v3/REST/message/999`).replyWithError({ message: 'Not found' })

      await expect(service.getMessage('999')).rejects.toThrow('Mailjet API error')
    })
  })

  describe('getMessageHistory', () => {
    it('fetches message history by ID', async () => {
      mock.onGet(`${ BASE }/v3/REST/messagehistory/12345`).reply({
        Count: 2, Total: 2,
        Data: [
          { EventType: 'sent', EventAt: 1769940900 },
          { EventType: 'opened', EventAt: 1769941200 },
        ],
      })

      const result = await service.getMessageHistory('12345')

      expect(result).toEqual({
        count: 2,
        total: 2,
        data: [
          { EventType: 'sent', EventAt: 1769940900 },
          { EventType: 'opened', EventAt: 1769941200 },
        ],
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/v3/REST/messagehistory/999`).replyWithError({ message: 'Not found' })

      await expect(service.getMessageHistory('999')).rejects.toThrow('Mailjet API error')
    })
  })

  describe('getStatCounters', () => {
    it('sends correct query params with choice resolution', async () => {
      mock.onGet(`${ BASE }/v3/REST/statcounters`).reply({ Count: 1, Total: 1, Data: [{ Total: 500 }] })

      const result = await service.getStatCounters('API Key', 'Message', 'Lifetime')

      expect(result).toEqual({ count: 1, total: 1, data: [{ Total: 500 }] })
      expect(mock.history[0].query).toMatchObject({
        CounterSource: 'APIKey',
        CounterTiming: 'Message',
        CounterResolution: 'Lifetime',
      })
    })

    it('includes optional time range and source ID', async () => {
      mock.onGet(`${ BASE }/v3/REST/statcounters`).reply({ Count: 0, Total: 0, Data: [] })

      await service.getStatCounters('Campaign', 'Event', 'Day', '2026-01-01', '2026-01-31', '42')

      expect(mock.history[0].query).toMatchObject({
        CounterSource: 'Campaign',
        CounterTiming: 'Event',
        CounterResolution: 'Day',
        FromTS: '2026-01-01',
        ToTS: '2026-01-31',
        SourceID: '42',
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/v3/REST/statcounters`).replyWithError({ message: 'Boom' })

      await expect(service.getStatCounters('API Key', 'Message', 'Lifetime')).rejects.toThrow('Mailjet API error')
    })
  })

  // ── Dictionary Methods ──

  describe('getContactListsDictionary', () => {
    it('maps contact lists to items with subscriber note', async () => {
      mock.onGet(`${ BASE }/v3/REST/contactslist`).reply({
        Data: [
          { ID: 1, Name: 'Newsletter', SubscriberCount: 250, IsDeleted: false },
          { ID: 2, Name: 'Promos', SubscriberCount: 0, IsDeleted: false },
        ],
      })

      const result = await service.getContactListsDictionary({})

      expect(mock.history[0].query).toMatchObject({ Limit: 50, Offset: 0 })
      expect(result.items).toEqual([
        { label: 'Newsletter', value: '1', note: '250 subscribers' },
        { label: 'Promos', value: '2', note: '0 subscribers' },
      ])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/v3/REST/contactslist`).reply({
        Data: [
          { ID: 1, Name: 'Newsletter', SubscriberCount: 250, IsDeleted: false },
          { ID: 2, Name: 'Promos', SubscriberCount: 0, IsDeleted: false },
        ],
      })

      const result = await service.getContactListsDictionary({ search: 'promo' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('2')
    })

    it('excludes deleted lists', async () => {
      mock.onGet(`${ BASE }/v3/REST/contactslist`).reply({
        Data: [
          { ID: 1, Name: 'Active', SubscriberCount: 10, IsDeleted: false },
          { ID: 2, Name: 'Deleted', SubscriberCount: 0, IsDeleted: true },
        ],
      })

      const result = await service.getContactListsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Active')
    })

    it('returns cursor when there are more pages', async () => {
      const fullPage = Array.from({ length: 50 }, (_, i) => ({
        ID: i + 1, Name: `List ${ i + 1 }`, SubscriberCount: 0, IsDeleted: false,
      }))

      mock.onGet(`${ BASE }/v3/REST/contactslist`).reply({ Data: fullPage })

      const result = await service.getContactListsDictionary({})

      expect(result.cursor).toBe('50')
    })

    it('returns null cursor when at the end', async () => {
      mock.onGet(`${ BASE }/v3/REST/contactslist`).reply({
        Data: [{ ID: 1, Name: 'Last', SubscriberCount: 0, IsDeleted: false }],
      })

      const result = await service.getContactListsDictionary({ cursor: '50' })

      expect(result.cursor).toBeNull()
      expect(mock.history[0].query).toMatchObject({ Offset: 50 })
    })

    it('handles null payload', async () => {
      mock.onGet(`${ BASE }/v3/REST/contactslist`).reply({ Data: [] })

      const result = await service.getContactListsDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getTemplatesDictionary', () => {
    it('maps templates to items with purposes note', async () => {
      mock.onGet(`${ BASE }/v3/REST/template`).reply({
        Data: [
          { ID: 100, Name: 'Welcome Email', Purposes: ['transactional'] },
          { ID: 101, Name: 'Promo', Purposes: ['marketing', 'bulk'] },
        ],
      })

      const result = await service.getTemplatesDictionary({})

      expect(mock.history[0].query).toMatchObject({ OwnerType: 'user', Limit: 50, Offset: 0 })
      expect(result.items).toEqual([
        { label: 'Welcome Email', value: '100', note: 'transactional' },
        { label: 'Promo', value: '101', note: 'marketing, bulk' },
      ])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/v3/REST/template`).reply({
        Data: [
          { ID: 100, Name: 'Welcome Email', Purposes: [] },
          { ID: 101, Name: 'Promo', Purposes: [] },
        ],
      })

      const result = await service.getTemplatesDictionary({ search: 'welcome' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('100')
    })

    it('returns undefined note when purposes is empty', async () => {
      mock.onGet(`${ BASE }/v3/REST/template`).reply({
        Data: [{ ID: 100, Name: 'No Purpose', Purposes: [] }],
      })

      const result = await service.getTemplatesDictionary({})

      expect(result.items[0].note).toBeUndefined()
    })

    it('returns cursor when there are more pages', async () => {
      const fullPage = Array.from({ length: 50 }, (_, i) => ({
        ID: i + 1, Name: `Template ${ i + 1 }`, Purposes: [],
      }))

      mock.onGet(`${ BASE }/v3/REST/template`).reply({ Data: fullPage })

      const result = await service.getTemplatesDictionary({})

      expect(result.cursor).toBe('50')
    })

    it('returns null cursor at the end', async () => {
      mock.onGet(`${ BASE }/v3/REST/template`).reply({
        Data: [{ ID: 1, Name: 'Last', Purposes: [] }],
      })

      const result = await service.getTemplatesDictionary({ cursor: '100' })

      expect(result.cursor).toBeNull()
      expect(mock.history[0].query).toMatchObject({ Offset: 100 })
    })

    it('handles null payload', async () => {
      mock.onGet(`${ BASE }/v3/REST/template`).reply({ Data: [] })

      const result = await service.getTemplatesDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  // ── Error message extraction ──

  describe('error message extraction', () => {
    it('extracts ErrorMessage from response body', async () => {
      mock.onGet(`${ BASE }/v3/REST/contact/999`).replyWithError({
        message: 'API Error',
        body: { ErrorMessage: 'Object not found', ErrorInfo: 'Contact does not exist' },
      })

      await expect(service.getContact('999'))
        .rejects.toThrow('Mailjet API error: Object not found (Contact does not exist)')
    })

    it('extracts send-level errors from Messages array', async () => {
      mock.onPost(`${ BASE }/v3.1/send`).replyWithError({
        message: 'Send failed',
        body: {
          Messages: [{
            Errors: [
              { ErrorMessage: 'Invalid email' },
              { ErrorMessage: 'Quota exceeded' },
            ],
          }],
        },
      })

      await expect(service.sendEmail('from@example.com', undefined, ['bad']))
        .rejects.toThrow('Mailjet API error: Invalid email; Quota exceeded')
    })

    it('falls back to error.message when no body', async () => {
      mock.onGet(`${ BASE }/v3/REST/contact/999`).replyWithError({
        message: 'Network error',
      })

      await expect(service.getContact('999'))
        .rejects.toThrow('Mailjet API error: Network error')
    })
  })
})
