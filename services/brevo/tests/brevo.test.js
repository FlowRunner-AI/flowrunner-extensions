'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.brevo.com/v3'

describe('Brevo Service', () => {
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

    it('sends the api-key header on requests', async () => {
      mock.onGet(`${ BASE }/account`).reply({ email: 'admin@example.com' })

      await service.getAccountInfo()

      expect(mock.history[0].headers).toMatchObject({
        'api-key': API_KEY,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Dictionary Methods ──

  describe('getSendersDictionary', () => {
    it('maps senders to items and hits the senders endpoint', async () => {
      mock.onGet(`${ BASE }/senders`).reply({
        senders: [
          { id: 1, name: 'John Doe', email: 'john@example.com' },
          { id: 2, name: 'Jane Roe', email: 'jane@example.com' },
        ],
      })

      const result = await service.getSendersDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ BASE }/senders`)
      expect(result.items).toEqual([
        { label: 'John Doe <john@example.com>', value: 'john@example.com', note: 'ID: 1' },
        { label: 'Jane Roe <jane@example.com>', value: 'jane@example.com', note: 'ID: 2' },
      ])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/senders`).reply({
        senders: [
          { id: 1, name: 'John Doe', email: 'john@example.com' },
          { id: 2, name: 'Jane Roe', email: 'jane@example.com' },
        ],
      })

      const result = await service.getSendersDictionary({ search: 'jane' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('jane@example.com')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/senders`).reply({ senders: [] })

      const result = await service.getSendersDictionary(null)

      expect(result.items).toEqual([])
    })

    it('returns empty items on API error', async () => {
      mock.onGet(`${ BASE }/senders`).replyWithError({ message: 'Unauthorized' })

      const result = await service.getSendersDictionary({})

      expect(result).toEqual({ items: [] })
    })
  })

  describe('getTemplatesDictionary', () => {
    it('maps templates to items with pagination query', async () => {
      mock.onGet(`${ BASE }/smtp/templates`).reply({
        templates: [
          { id: 1, name: 'Welcome Email' },
          { id: 2, name: 'Reset Password' },
        ],
      })

      const result = await service.getTemplatesDictionary({})

      expect(mock.history[0].query).toMatchObject({ limit: 100, offset: 0 })
      expect(result.items).toEqual([
        { label: 'Welcome Email', value: 1, note: 'ID: 1' },
        { label: 'Reset Password', value: 2, note: 'ID: 2' },
      ])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/smtp/templates`).reply({
        templates: [
          { id: 1, name: 'Welcome Email' },
          { id: 2, name: 'Reset Password' },
        ],
      })

      const result = await service.getTemplatesDictionary({ search: 'welcome' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe(1)
    })

    it('returns empty items on API error', async () => {
      mock.onGet(`${ BASE }/smtp/templates`).replyWithError({ message: 'Server Error' })

      const result = await service.getTemplatesDictionary({})

      expect(result).toEqual({ items: [] })
    })
  })

  describe('getListsDictionary', () => {
    it('maps lists to items with subscriber note', async () => {
      mock.onGet(`${ BASE }/contacts/lists`).reply({
        lists: [
          { id: 1, name: 'Newsletter', uniqueSubscribers: 250 },
          { id: 2, name: 'Promos' },
        ],
      })

      const result = await service.getListsDictionary({})

      expect(mock.history[0].query).toMatchObject({ limit: 50, offset: 0 })
      expect(result.items).toEqual([
        { label: 'Newsletter', value: 1, note: 'Subscribers: 250' },
        { label: 'Promos', value: 2, note: 'Subscribers: 0' },
      ])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/contacts/lists`).reply({
        lists: [
          { id: 1, name: 'Newsletter', uniqueSubscribers: 250 },
          { id: 2, name: 'Promos' },
        ],
      })

      const result = await service.getListsDictionary({ search: 'promo' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe(2)
    })

    it('returns empty items on API error', async () => {
      mock.onGet(`${ BASE }/contacts/lists`).replyWithError({ message: 'Boom' })

      const result = await service.getListsDictionary({})

      expect(result).toEqual({ items: [] })
    })
  })

  describe('getPipelinesDictionary', () => {
    it('maps pipelines (array response) to items', async () => {
      mock.onGet(`${ BASE }/crm/pipeline/details/all`).reply([
        { pipeline: 'p1', pipeline_name: 'Sales Pipeline', stages: [{}, {}, {}] },
        { pipeline: 'p2', pipeline_name: 'Support', stages: [] },
      ])

      const result = await service.getPipelinesDictionary({})

      expect(result.items).toEqual([
        { label: 'Sales Pipeline', value: 'p1', note: 'Stages: 3' },
        { label: 'Support', value: 'p2', note: 'Stages: 0' },
      ])
    })

    it('handles a non-array response', async () => {
      mock.onGet(`${ BASE }/crm/pipeline/details/all`).reply({ notAnArray: true })

      const result = await service.getPipelinesDictionary({})

      expect(result.items).toEqual([])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/crm/pipeline/details/all`).reply([
        { pipeline: 'p1', pipeline_name: 'Sales Pipeline', stages: [] },
        { pipeline: 'p2', pipeline_name: 'Support', stages: [] },
      ])

      const result = await service.getPipelinesDictionary({ search: 'sales' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('p1')
    })

    it('returns empty items on API error', async () => {
      mock.onGet(`${ BASE }/crm/pipeline/details/all`).replyWithError({ message: 'Boom' })

      const result = await service.getPipelinesDictionary({})

      expect(result).toEqual({ items: [] })
    })
  })

  describe('getDealStagesDictionary', () => {
    it('returns empty items without a pipeline id', async () => {
      const result = await service.getDealStagesDictionary({})

      expect(result).toEqual({ items: [] })
      expect(mock.history).toHaveLength(0)
    })

    it('maps stages for a given pipeline', async () => {
      mock.onGet(`${ BASE }/crm/pipeline/details/p1`).reply({
        stages: [
          { id: 'stage_1', name: 'Qualification' },
          { id: 'stage_2', name: 'Won' },
        ],
      })

      const result = await service.getDealStagesDictionary({ criteria: { pipelineId: 'p1' } })

      expect(mock.history[0].url).toBe(`${ BASE }/crm/pipeline/details/p1`)
      expect(result.items).toEqual([
        { label: 'Qualification', value: 'stage_1' },
        { label: 'Won', value: 'stage_2' },
      ])
    })

    it('filters stages by search term', async () => {
      mock.onGet(`${ BASE }/crm/pipeline/details/p1`).reply({
        stages: [
          { id: 'stage_1', name: 'Qualification' },
          { id: 'stage_2', name: 'Won' },
        ],
      })

      const result = await service.getDealStagesDictionary({
        search: 'won',
        criteria: { pipelineId: 'p1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('stage_2')
    })

    it('returns empty items on API error', async () => {
      mock.onGet(`${ BASE }/crm/pipeline/details/p1`).replyWithError({ message: 'Boom' })

      const result = await service.getDealStagesDictionary({ criteria: { pipelineId: 'p1' } })

      expect(result).toEqual({ items: [] })
    })
  })

  describe('getContactsDictionary', () => {
    it('maps contacts to items with pagination cursor', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({
        contacts: [
          { id: 1, email: 'john@example.com', attributes: { FIRSTNAME: 'John', LASTNAME: 'Doe' } },
          { id: 2, email: 'noname@example.com', attributes: {} },
        ],
        count: 120,
      })

      const result = await service.getContactsDictionary({})

      expect(mock.history[0].query).toMatchObject({ limit: 50, offset: 0 })
      expect(result.items).toEqual([
        { label: 'john@example.com', value: 1, note: 'John Doe' },
        { label: 'noname@example.com', value: 2, note: 'No name' },
      ])
      expect(result.cursor).toBe('50')
    })

    it('uses cursor as offset and returns null cursor at end', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({
        contacts: [{ id: 3, email: 'last@example.com', attributes: {} }],
        count: 60,
      })

      const result = await service.getContactsDictionary({ cursor: '50' })

      expect(mock.history[0].query).toMatchObject({ limit: 50, offset: 50 })
      expect(result.cursor).toBeNull()
    })

    it('filters by search over email and note', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({
        contacts: [
          { id: 1, email: 'john@example.com', attributes: { FIRSTNAME: 'John', LASTNAME: 'Doe' } },
          { id: 2, email: 'jane@example.com', attributes: { FIRSTNAME: 'Jane' } },
        ],
        count: 2,
      })

      const result = await service.getContactsDictionary({ search: 'jane' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe(2)
    })

    it('returns empty items on API error', async () => {
      mock.onGet(`${ BASE }/contacts`).replyWithError({ message: 'Boom' })

      const result = await service.getContactsDictionary({})

      expect(result).toEqual({ items: [] })
    })
  })

  // ── Email Sending ──

  describe('sendTransactionalEmail', () => {
    it('sends with required params only', async () => {
      mock.onPost(`${ BASE }/smtp/email`).reply({ messageId: '<abc@brevo.com>' })

      const result = await service.sendTransactionalEmail(
        'from@example.com',
        undefined,
        'to@example.com',
        undefined,
        'Hello'
      )

      expect(result).toEqual({ messageId: '<abc@brevo.com>' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        sender: { email: 'from@example.com' },
        to: [{ email: 'to@example.com' }],
        subject: 'Hello',
      })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/smtp/email`).reply({ messageId: '<abc@brevo.com>' })

      await service.sendTransactionalEmail(
        'from@example.com',
        'From Name',
        'to@example.com',
        'To Name',
        'Hello',
        '<p>Hi</p>',
        'Hi',
        'cc@example.com',
        'bcc@example.com',
        'reply@example.com',
        'welcome, onboarding',
        '2025-01-15T10:00:00Z'
      )

      expect(mock.history[0].body).toEqual({
        sender: { email: 'from@example.com', name: 'From Name' },
        to: [{ email: 'to@example.com', name: 'To Name' }],
        subject: 'Hello',
        htmlContent: '<p>Hi</p>',
        textContent: 'Hi',
        cc: [{ email: 'cc@example.com' }],
        bcc: [{ email: 'bcc@example.com' }],
        replyTo: { email: 'reply@example.com' },
        tags: ['welcome', 'onboarding'],
        scheduledAt: '2025-01-15T10:00:00Z',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/smtp/email`).replyWithError({ message: 'Invalid sender' })

      await expect(
        service.sendTransactionalEmail('from@example.com', undefined, 'to@example.com', undefined, 'Hi')
      ).rejects.toThrow('Failed to send transactional email: Invalid sender')
    })
  })

  describe('sendTemplateEmail', () => {
    it('sends with required params only', async () => {
      mock.onPost(`${ BASE }/smtp/email`).reply({ messageId: '<tmpl@brevo.com>' })

      await service.sendTemplateEmail(5, 'to@example.com')

      expect(mock.history[0].body).toEqual({
        templateId: 5,
        to: [{ email: 'to@example.com' }],
      })
    })

    it('includes all optional params and parses JSON params', async () => {
      mock.onPost(`${ BASE }/smtp/email`).reply({ messageId: '<tmpl@brevo.com>' })

      await service.sendTemplateEmail(
        5,
        'to@example.com',
        'To Name',
        'from@example.com',
        'From Name',
        '{"firstName":"John"}',
        'a,b',
        '2025-01-15T10:00:00Z'
      )

      expect(mock.history[0].body).toEqual({
        templateId: 5,
        to: [{ email: 'to@example.com', name: 'To Name' }],
        sender: { email: 'from@example.com', name: 'From Name' },
        params: { firstName: 'John' },
        tags: ['a', 'b'],
        scheduledAt: '2025-01-15T10:00:00Z',
      })
    })

    it('accepts params as an object', async () => {
      mock.onPost(`${ BASE }/smtp/email`).reply({ messageId: '<tmpl@brevo.com>' })

      await service.sendTemplateEmail(5, 'to@example.com', undefined, undefined, undefined, {
        firstName: 'Jane',
      })

      expect(mock.history[0].body.params).toEqual({ firstName: 'Jane' })
    })

    it('throws on invalid JSON params', async () => {
      await expect(
        service.sendTemplateEmail(5, 'to@example.com', undefined, undefined, undefined, '{bad json')
      ).rejects.toThrow('Template Parameters must be a valid JSON object.')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/smtp/email`).replyWithError({ message: 'Template not found' })

      await expect(service.sendTemplateEmail(5, 'to@example.com')).rejects.toThrow(
        'Failed to send template email: Template not found'
      )
    })
  })

  describe('getEmailTemplates', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/smtp/templates`).reply({ count: 0, templates: [] })

      const result = await service.getEmailTemplates()

      expect(result).toEqual({ count: 0, templates: [] })
      expect(mock.history[0].query).toMatchObject({ limit: 50, offset: 0 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/smtp/templates`).reply({ count: 0, templates: [] })

      await service.getEmailTemplates(10, 20)

      expect(mock.history[0].query).toMatchObject({ limit: 10, offset: 20 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/smtp/templates`).replyWithError({ message: 'Boom' })

      await expect(service.getEmailTemplates()).rejects.toThrow('Failed to get email templates: Boom')
    })
  })

  describe('getTransactionalEmails', () => {
    it('uses default pagination with no filters', async () => {
      mock.onGet(`${ BASE }/smtp/emails`).reply({ transactionalEmails: [] })

      await service.getTransactionalEmails()

      expect(mock.history[0].query).toEqual({ limit: 50, offset: 0 })
    })

    it('includes all filters when provided', async () => {
      mock.onGet(`${ BASE }/smtp/emails`).reply({ transactionalEmails: [] })

      await service.getTransactionalEmails('john@example.com', 'delivered', 10, 5, '2025-01-01', '2025-01-31')

      expect(mock.history[0].query).toEqual({
        limit: 10,
        offset: 5,
        email: 'john@example.com',
        event: 'delivered',
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/smtp/emails`).replyWithError({ message: 'Boom' })

      await expect(service.getTransactionalEmails()).rejects.toThrow(
        'Failed to get transactional emails: Boom'
      )
    })
  })

  describe('getEmailStatistics', () => {
    it('sends no query params when none provided', async () => {
      mock.onGet(`${ BASE }/smtp/statistics/aggregatedReport`).reply({ requests: 0 })

      await service.getEmailStatistics()

      expect(mock.history[0].query).toEqual({})
    })

    it('includes all params when provided', async () => {
      mock.onGet(`${ BASE }/smtp/statistics/aggregatedReport`).reply({ requests: 100 })

      await service.getEmailStatistics('2025-01-01', '2025-01-31', 7, 'welcome')

      expect(mock.history[0].query).toEqual({
        startDate: '2025-01-01',
        endDate: '2025-01-31',
        days: 7,
        tag: 'welcome',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/smtp/statistics/aggregatedReport`).replyWithError({ message: 'Boom' })

      await expect(service.getEmailStatistics()).rejects.toThrow('Failed to get email statistics: Boom')
    })
  })

  describe('getSenders', () => {
    it('returns senders from the API', async () => {
      mock.onGet(`${ BASE }/senders`).reply({ senders: [{ id: 1, name: 'John', email: 'j@x.com' }] })

      const result = await service.getSenders()

      expect(result).toEqual({ senders: [{ id: 1, name: 'John', email: 'j@x.com' }] })
      expect(mock.history[0].url).toBe(`${ BASE }/senders`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/senders`).replyWithError({ message: 'Boom' })

      await expect(service.getSenders()).rejects.toThrow('Failed to get senders: Boom')
    })
  })

  // ── Contacts ──

  describe('createContact', () => {
    it('sends with required params only', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ id: 123 })

      const result = await service.createContact('john@example.com')

      expect(result).toEqual({ id: 123 })
      expect(mock.history[0].body).toEqual({
        email: 'john@example.com',
        updateEnabled: false,
      })
    })

    it('includes all optional params and merges attributes', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ id: 124 })

      await service.createContact(
        'john@example.com',
        'John',
        'Doe',
        '+14155552671',
        '1, 5, 12',
        '{"COMPANY":"Acme"}',
        true
      )

      expect(mock.history[0].body).toEqual({
        email: 'john@example.com',
        updateEnabled: true,
        attributes: {
          FIRSTNAME: 'John',
          LASTNAME: 'Doe',
          SMS: '+14155552671',
          COMPANY: 'Acme',
        },
        listIds: [1, 5, 12],
      })
    })

    it('throws on invalid JSON attributes', async () => {
      await expect(
        service.createContact('john@example.com', undefined, undefined, undefined, undefined, '{bad')
      ).rejects.toThrow('Attributes must be a valid JSON object.')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/contacts`).replyWithError({ message: 'Duplicate' })

      await expect(service.createContact('john@example.com')).rejects.toThrow(
        'Failed to create contact: Duplicate'
      )
    })
  })

  describe('getContact', () => {
    it('fetches by identifier with url encoding', async () => {
      mock.onGet(`${ BASE }/contacts/john%40example.com`).reply({ id: 1, email: 'john@example.com' })

      const result = await service.getContact('john@example.com')

      expect(result).toEqual({ id: 1, email: 'john@example.com' })
      expect(mock.history[0].url).toBe(`${ BASE }/contacts/john%40example.com`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/contacts/999`).replyWithError({ message: 'Not found' })

      await expect(service.getContact('999')).rejects.toThrow('Failed to get contact: Not found')
    })
  })

  describe('updateContact', () => {
    it('sends put with only the identifier when no fields change', async () => {
      mock.onPut(`${ BASE }/contacts/123`).reply(undefined)

      const result = await service.updateContact('123')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({})
    })

    it('includes all optional params', async () => {
      mock.onPut(`${ BASE }/contacts/123`).reply(undefined)

      await service.updateContact(
        '123',
        'new@example.com',
        'John',
        'Doe',
        '+14155552671',
        '1,2',
        '3,7',
        '{"CITY":"Paris"}',
        true,
        false
      )

      expect(mock.history[0].body).toEqual({
        email: 'new@example.com',
        attributes: {
          FIRSTNAME: 'John',
          LASTNAME: 'Doe',
          SMS: '+14155552671',
          CITY: 'Paris',
        },
        listIds: [1, 2],
        unlinkListIds: [3, 7],
        emailBlacklisted: true,
        smsBlacklisted: false,
      })
    })

    it('throws on invalid JSON attributes', async () => {
      await expect(
        service.updateContact('123', undefined, undefined, undefined, undefined, undefined, undefined, '{bad')
      ).rejects.toThrow('Attributes must be a valid JSON object.')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPut(`${ BASE }/contacts/123`).replyWithError({ message: 'Boom' })

      await expect(service.updateContact('123', 'new@example.com')).rejects.toThrow(
        'Failed to update contact: Boom'
      )
    })
  })

  describe('deleteContact', () => {
    it('sends delete and returns success', async () => {
      mock.onDelete(`${ BASE }/contacts/john%40example.com`).reply(undefined)

      const result = await service.deleteContact('john@example.com')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/contacts/123`).replyWithError({ message: 'Boom' })

      await expect(service.deleteContact('123')).rejects.toThrow('Failed to delete contact: Boom')
    })
  })

  describe('getContacts', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ contacts: [], count: 0 })

      await service.getContacts()

      expect(mock.history[0].query).toMatchObject({ limit: 50, offset: 0 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ contacts: [], count: 0 })

      await service.getContacts(25, 100)

      expect(mock.history[0].query).toMatchObject({ limit: 25, offset: 100 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/contacts`).replyWithError({ message: 'Boom' })

      await expect(service.getContacts()).rejects.toThrow('Failed to get contacts: Boom')
    })
  })

  // ── Contact Lists ──

  describe('createList', () => {
    it('sends with default folder id', async () => {
      mock.onPost(`${ BASE }/contacts/lists`).reply({ id: 123 })

      const result = await service.createList('Newsletter')

      expect(result).toEqual({ id: 123 })
      expect(mock.history[0].body).toEqual({ name: 'Newsletter', folderId: 1 })
    })

    it('uses a custom folder id', async () => {
      mock.onPost(`${ BASE }/contacts/lists`).reply({ id: 124 })

      await service.createList('Newsletter', 5)

      expect(mock.history[0].body).toEqual({ name: 'Newsletter', folderId: 5 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/contacts/lists`).replyWithError({ message: 'Boom' })

      await expect(service.createList('Newsletter')).rejects.toThrow('Failed to create list: Boom')
    })
  })

  describe('getLists', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/contacts/lists`).reply({ lists: [], count: 0 })

      await service.getLists()

      expect(mock.history[0].query).toMatchObject({ limit: 50, offset: 0 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/contacts/lists`).reply({ lists: [], count: 0 })

      await service.getLists(10, 20)

      expect(mock.history[0].query).toMatchObject({ limit: 10, offset: 20 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/contacts/lists`).replyWithError({ message: 'Boom' })

      await expect(service.getLists()).rejects.toThrow('Failed to get lists: Boom')
    })
  })

  describe('getListContacts', () => {
    it('fetches contacts for a list with default pagination', async () => {
      mock.onGet(`${ BASE }/contacts/lists/7/contacts`).reply({ contacts: [], count: 0 })

      await service.getListContacts(7)

      expect(mock.history[0].url).toBe(`${ BASE }/contacts/lists/7/contacts`)
      expect(mock.history[0].query).toMatchObject({ limit: 50, offset: 0 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/contacts/lists/7/contacts`).reply({ contacts: [], count: 0 })

      await service.getListContacts(7, 100, 50)

      expect(mock.history[0].query).toMatchObject({ limit: 100, offset: 50 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/contacts/lists/7/contacts`).replyWithError({ message: 'Boom' })

      await expect(service.getListContacts(7)).rejects.toThrow('Failed to get list contacts: Boom')
    })
  })

  describe('addContactsToList', () => {
    it('splits emails and posts to the add endpoint', async () => {
      mock.onPost(`${ BASE }/contacts/lists/7/contacts/add`).reply({ contacts: { success: [], failure: [] } })

      await service.addContactsToList(7, 'john@example.com, jane@example.com')

      expect(mock.history[0].url).toBe(`${ BASE }/contacts/lists/7/contacts/add`)
      expect(mock.history[0].body).toEqual({
        emails: ['john@example.com', 'jane@example.com'],
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/contacts/lists/7/contacts/add`).replyWithError({ message: 'Boom' })

      await expect(service.addContactsToList(7, 'x@x.com')).rejects.toThrow(
        'Failed to add contacts to list: Boom'
      )
    })
  })

  describe('removeContactsFromList', () => {
    it('splits emails and posts to the remove endpoint', async () => {
      mock
        .onPost(`${ BASE }/contacts/lists/7/contacts/remove`)
        .reply({ contacts: { success: [], failure: [] } })

      await service.removeContactsFromList(7, 'john@example.com,jane@example.com')

      expect(mock.history[0].body).toEqual({
        emails: ['john@example.com', 'jane@example.com'],
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/contacts/lists/7/contacts/remove`).replyWithError({ message: 'Boom' })

      await expect(service.removeContactsFromList(7, 'x@x.com')).rejects.toThrow(
        'Failed to remove contacts from list: Boom'
      )
    })
  })

  // ── SMS ──

  describe('sendTransactionalSMS', () => {
    it('sends with required params and default type', async () => {
      mock.onPost(`${ BASE }/transactionalSMS/send`).reply({ messageId: 1511882900 })

      const result = await service.sendTransactionalSMS('MyCompany', '+14155552671', 'Hi there')

      expect(result).toEqual({ messageId: 1511882900 })
      expect(mock.history[0].body).toEqual({
        sender: 'MyCompany',
        recipient: '+14155552671',
        content: 'Hi there',
        type: 'transactional',
      })
    })

    it('includes custom type and tag', async () => {
      mock.onPost(`${ BASE }/transactionalSMS/send`).reply({ messageId: 1511882901 })

      await service.sendTransactionalSMS('MyCompany', '+14155552671', 'Promo', 'marketing', 'promo-tag')

      expect(mock.history[0].body).toEqual({
        sender: 'MyCompany',
        recipient: '+14155552671',
        content: 'Promo',
        type: 'marketing',
        tag: 'promo-tag',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/transactionalSMS/send`).replyWithError({ message: 'Boom' })

      await expect(
        service.sendTransactionalSMS('MyCompany', '+14155552671', 'Hi')
      ).rejects.toThrow('Failed to send transactional SMS: Boom')
    })
  })

  describe('getSMSStatistics', () => {
    it('sends no query params when none provided', async () => {
      mock.onGet(`${ BASE }/transactionalSMS/statistics/aggregatedReport`).reply({ requests: 0 })

      await service.getSMSStatistics()

      expect(mock.history[0].query).toEqual({})
    })

    it('includes all params when provided', async () => {
      mock.onGet(`${ BASE }/transactionalSMS/statistics/aggregatedReport`).reply({ requests: 500 })

      await service.getSMSStatistics('2025-01-01', '2025-01-31', 7, 'promo')

      expect(mock.history[0].query).toEqual({
        startDate: '2025-01-01',
        endDate: '2025-01-31',
        days: 7,
        tag: 'promo',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/transactionalSMS/statistics/aggregatedReport`).replyWithError({ message: 'Boom' })

      await expect(service.getSMSStatistics()).rejects.toThrow('Failed to get SMS statistics: Boom')
    })
  })

  // ── CRM - Deals ──

  describe('createDeal', () => {
    it('sends with required params only', async () => {
      mock.onPost(`${ BASE }/crm/deals`).reply({ id: 'deal_1' })

      const result = await service.createDeal('Enterprise License')

      expect(result).toEqual({ id: 'deal_1' })
      expect(mock.history[0].body).toEqual({ name: 'Enterprise License' })
    })

    it('parses JSON attributes', async () => {
      mock.onPost(`${ BASE }/crm/deals`).reply({ id: 'deal_2' })

      await service.createDeal('Deal', '{"amount":5000,"pipeline":"p1"}')

      expect(mock.history[0].body).toEqual({
        name: 'Deal',
        attributes: { amount: 5000, pipeline: 'p1' },
      })
    })

    it('throws on invalid JSON attributes', async () => {
      await expect(service.createDeal('Deal', '{bad')).rejects.toThrow(
        'Attributes must be a valid JSON object.'
      )
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm/deals`).replyWithError({ message: 'Boom' })

      await expect(service.createDeal('Deal')).rejects.toThrow('Failed to create deal: Boom')
    })
  })

  describe('getDeal', () => {
    it('fetches a deal by id', async () => {
      mock.onGet(`${ BASE }/crm/deals/deal_1`).reply({ id: 'deal_1' })

      const result = await service.getDeal('deal_1')

      expect(result).toEqual({ id: 'deal_1' })
      expect(mock.history[0].url).toBe(`${ BASE }/crm/deals/deal_1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/crm/deals/deal_1`).replyWithError({ message: 'Boom' })

      await expect(service.getDeal('deal_1')).rejects.toThrow('Failed to get deal: Boom')
    })
  })

  describe('updateDeal', () => {
    it('sends patch with empty body when no fields change', async () => {
      mock.onPatch(`${ BASE }/crm/deals/deal_1`).reply(undefined)

      const result = await service.updateDeal('deal_1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({})
    })

    it('includes name and parsed attributes', async () => {
      mock.onPatch(`${ BASE }/crm/deals/deal_1`).reply(undefined)

      await service.updateDeal('deal_1', 'Won Deal', '{"deal_stage":"Won"}')

      expect(mock.history[0].body).toEqual({
        name: 'Won Deal',
        attributes: { deal_stage: 'Won' },
      })
    })

    it('throws on invalid JSON attributes', async () => {
      await expect(service.updateDeal('deal_1', undefined, '{bad')).rejects.toThrow(
        'Attributes must be a valid JSON object.'
      )
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${ BASE }/crm/deals/deal_1`).replyWithError({ message: 'Boom' })

      await expect(service.updateDeal('deal_1', 'Name')).rejects.toThrow('Failed to update deal: Boom')
    })
  })

  describe('deleteDeal', () => {
    it('sends delete and returns success', async () => {
      mock.onDelete(`${ BASE }/crm/deals/deal_1`).reply(undefined)

      const result = await service.deleteDeal('deal_1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/crm/deals/deal_1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteDeal('deal_1')).rejects.toThrow('Failed to delete deal: Boom')
    })
  })

  describe('getDeals', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/crm/deals`).reply({ items: [], count: 0 })

      await service.getDeals()

      expect(mock.history[0].query).toMatchObject({ limit: 50, offset: 0 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/crm/deals`).reply({ items: [], count: 0 })

      await service.getDeals(10, 20)

      expect(mock.history[0].query).toMatchObject({ limit: 10, offset: 20 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/crm/deals`).replyWithError({ message: 'Boom' })

      await expect(service.getDeals()).rejects.toThrow('Failed to get deals: Boom')
    })
  })

  // ── CRM - Companies ──

  describe('createCompany', () => {
    it('sends with required params only', async () => {
      mock.onPost(`${ BASE }/companies`).reply({ id: 'comp_1' })

      const result = await service.createCompany('Acme Corp')

      expect(result).toEqual({ id: 'comp_1' })
      expect(mock.history[0].body).toEqual({ name: 'Acme Corp' })
    })

    it('parses JSON attributes', async () => {
      mock.onPost(`${ BASE }/companies`).reply({ id: 'comp_2' })

      await service.createCompany('Acme', '{"industry":"Technology"}')

      expect(mock.history[0].body).toEqual({
        name: 'Acme',
        attributes: { industry: 'Technology' },
      })
    })

    it('throws on invalid JSON attributes', async () => {
      await expect(service.createCompany('Acme', '{bad')).rejects.toThrow(
        'Attributes must be a valid JSON object.'
      )
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/companies`).replyWithError({ message: 'Boom' })

      await expect(service.createCompany('Acme')).rejects.toThrow('Failed to create company: Boom')
    })
  })

  describe('getCompany', () => {
    it('fetches a company by id', async () => {
      mock.onGet(`${ BASE }/companies/comp_1`).reply({ id: 'comp_1' })

      const result = await service.getCompany('comp_1')

      expect(result).toEqual({ id: 'comp_1' })
      expect(mock.history[0].url).toBe(`${ BASE }/companies/comp_1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/companies/comp_1`).replyWithError({ message: 'Boom' })

      await expect(service.getCompany('comp_1')).rejects.toThrow('Failed to get company: Boom')
    })
  })

  describe('updateCompany', () => {
    it('sends patch with empty body when no fields change', async () => {
      mock.onPatch(`${ BASE }/companies/comp_1`).reply(undefined)

      const result = await service.updateCompany('comp_1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({})
    })

    it('includes name and parsed attributes', async () => {
      mock.onPatch(`${ BASE }/companies/comp_1`).reply(undefined)

      await service.updateCompany('comp_1', 'New Name', '{"industry":"Finance"}')

      expect(mock.history[0].body).toEqual({
        name: 'New Name',
        attributes: { industry: 'Finance' },
      })
    })

    it('throws on invalid JSON attributes', async () => {
      await expect(service.updateCompany('comp_1', undefined, '{bad')).rejects.toThrow(
        'Attributes must be a valid JSON object.'
      )
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${ BASE }/companies/comp_1`).replyWithError({ message: 'Boom' })

      await expect(service.updateCompany('comp_1', 'Name')).rejects.toThrow(
        'Failed to update company: Boom'
      )
    })
  })

  describe('deleteCompany', () => {
    it('sends delete and returns success', async () => {
      mock.onDelete(`${ BASE }/companies/comp_1`).reply(undefined)

      const result = await service.deleteCompany('comp_1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/companies/comp_1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteCompany('comp_1')).rejects.toThrow('Failed to delete company: Boom')
    })
  })

  describe('getCompanies', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/companies`).reply({ items: [], count: 0 })

      await service.getCompanies()

      expect(mock.history[0].query).toMatchObject({ limit: 50, offset: 0 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/companies`).reply({ items: [], count: 0 })

      await service.getCompanies(10, 20)

      expect(mock.history[0].query).toMatchObject({ limit: 10, offset: 20 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/companies`).replyWithError({ message: 'Boom' })

      await expect(service.getCompanies()).rejects.toThrow('Failed to get companies: Boom')
    })
  })

  // ── CRM - Tasks ──

  describe('createTask', () => {
    it('sends with required params and default done flag', async () => {
      mock.onPost(`${ BASE }/crm/tasks`).reply({ id: 'task_1' })

      const result = await service.createTask('Follow up')

      expect(result).toEqual({ id: 'task_1' })
      expect(mock.history[0].body).toEqual({ name: 'Follow up', done: false })
    })

    it('includes all optional params with parsed id lists', async () => {
      mock.onPost(`${ BASE }/crm/tasks`).reply({ id: 'task_2' })

      await service.createTask(
        'Call client',
        'task_call',
        '2025-01-15T10:00:00Z',
        1800000,
        'Discuss renewal',
        true,
        '123, 456',
        'deal_1, deal_2',
        'comp_1'
      )

      expect(mock.history[0].body).toEqual({
        name: 'Call client',
        done: true,
        taskTypeId: 'task_call',
        date: '2025-01-15T10:00:00Z',
        duration: 1800000,
        notes: 'Discuss renewal',
        contactsIds: [123, 456],
        dealsIds: ['deal_1', 'deal_2'],
        companiesIds: ['comp_1'],
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm/tasks`).replyWithError({ message: 'Boom' })

      await expect(service.createTask('Task')).rejects.toThrow('Failed to create task: Boom')
    })
  })

  describe('getTask', () => {
    it('fetches a task by id', async () => {
      mock.onGet(`${ BASE }/crm/tasks/task_1`).reply({ id: 'task_1' })

      const result = await service.getTask('task_1')

      expect(result).toEqual({ id: 'task_1' })
      expect(mock.history[0].url).toBe(`${ BASE }/crm/tasks/task_1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/crm/tasks/task_1`).replyWithError({ message: 'Boom' })

      await expect(service.getTask('task_1')).rejects.toThrow('Failed to get task: Boom')
    })
  })

  describe('updateTask', () => {
    it('sends patch with empty body when no fields change', async () => {
      mock.onPatch(`${ BASE }/crm/tasks/task_1`).reply(undefined)

      const result = await service.updateTask('task_1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({})
    })

    it('includes all optional params, including done false', async () => {
      mock.onPatch(`${ BASE }/crm/tasks/task_1`).reply(undefined)

      await service.updateTask('task_1', 'Updated', false, '2025-02-01T10:00:00Z', 'notes', 3600000)

      expect(mock.history[0].body).toEqual({
        name: 'Updated',
        done: false,
        date: '2025-02-01T10:00:00Z',
        notes: 'notes',
        duration: 3600000,
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${ BASE }/crm/tasks/task_1`).replyWithError({ message: 'Boom' })

      await expect(service.updateTask('task_1', 'Name')).rejects.toThrow('Failed to update task: Boom')
    })
  })

  describe('deleteTask', () => {
    it('sends delete and returns success', async () => {
      mock.onDelete(`${ BASE }/crm/tasks/task_1`).reply(undefined)

      const result = await service.deleteTask('task_1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/crm/tasks/task_1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteTask('task_1')).rejects.toThrow('Failed to delete task: Boom')
    })
  })

  describe('getTasks', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/crm/tasks`).reply({ items: [], count: 0 })

      await service.getTasks()

      expect(mock.history[0].query).toMatchObject({ limit: 50, offset: 0 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/crm/tasks`).reply({ items: [], count: 0 })

      await service.getTasks(10, 20)

      expect(mock.history[0].query).toMatchObject({ limit: 10, offset: 20 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/crm/tasks`).replyWithError({ message: 'Boom' })

      await expect(service.getTasks()).rejects.toThrow('Failed to get tasks: Boom')
    })
  })

  // ── CRM - Notes ──

  describe('createNote', () => {
    it('sends with required params only', async () => {
      mock.onPost(`${ BASE }/crm/notes`).reply({ id: 'note_1' })

      const result = await service.createNote('A note')

      expect(result).toEqual({ id: 'note_1' })
      expect(mock.history[0].body).toEqual({ text: 'A note' })
    })

    it('includes all optional id lists', async () => {
      mock.onPost(`${ BASE }/crm/notes`).reply({ id: 'note_2' })

      await service.createNote('A note', '123, 456', 'deal_1', 'comp_1, comp_2')

      expect(mock.history[0].body).toEqual({
        text: 'A note',
        contactIds: [123, 456],
        dealIds: ['deal_1'],
        companyIds: ['comp_1', 'comp_2'],
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm/notes`).replyWithError({ message: 'Boom' })

      await expect(service.createNote('Note')).rejects.toThrow('Failed to create note: Boom')
    })
  })

  describe('getNote', () => {
    it('fetches a note by id', async () => {
      mock.onGet(`${ BASE }/crm/notes/note_1`).reply({ id: 'note_1' })

      const result = await service.getNote('note_1')

      expect(result).toEqual({ id: 'note_1' })
      expect(mock.history[0].url).toBe(`${ BASE }/crm/notes/note_1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/crm/notes/note_1`).replyWithError({ message: 'Boom' })

      await expect(service.getNote('note_1')).rejects.toThrow('Failed to get note: Boom')
    })
  })

  describe('updateNote', () => {
    it('sends patch with text only', async () => {
      mock.onPatch(`${ BASE }/crm/notes/note_1`).reply(undefined)

      const result = await service.updateNote('note_1', 'Updated text')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ text: 'Updated text' })
    })

    it('includes all optional id lists', async () => {
      mock.onPatch(`${ BASE }/crm/notes/note_1`).reply(undefined)

      await service.updateNote('note_1', 'Updated', '123', 'deal_1, deal_2', 'comp_1')

      expect(mock.history[0].body).toEqual({
        text: 'Updated',
        contactIds: [123],
        dealIds: ['deal_1', 'deal_2'],
        companyIds: ['comp_1'],
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${ BASE }/crm/notes/note_1`).replyWithError({ message: 'Boom' })

      await expect(service.updateNote('note_1', 'Text')).rejects.toThrow('Failed to update note: Boom')
    })
  })

  describe('deleteNote', () => {
    it('sends delete and returns success', async () => {
      mock.onDelete(`${ BASE }/crm/notes/note_1`).reply(undefined)

      const result = await service.deleteNote('note_1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/crm/notes/note_1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteNote('note_1')).rejects.toThrow('Failed to delete note: Boom')
    })
  })

  // ── Account ──

  describe('getAccountInfo', () => {
    it('fetches account info', async () => {
      mock.onGet(`${ BASE }/account`).reply({ email: 'admin@example.com', plan: [] })

      const result = await service.getAccountInfo()

      expect(result).toEqual({ email: 'admin@example.com', plan: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/account`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/account`).replyWithError({ message: 'Boom' })

      await expect(service.getAccountInfo()).rejects.toThrow('Failed to get account info: Boom')
    })
  })
})
