'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key-123'
const API_URL = 'https://testaccount.api-us1.com'
const BASE = `${ API_URL }/api/3`

describe('ActiveCampaign Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, apiUrl: API_URL })
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
          name: 'apiUrl',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiKey',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Contacts ──

  describe('syncContact', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(`${ BASE }/contact/sync`).reply({ contact: { id: '113', email: 'jane@example.com' } })

      const result = await service.syncContact('jane@example.com')

      expect(result).toEqual({ id: '113', email: 'jane@example.com' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'Api-Token': API_KEY })
      expect(mock.history[0].body).toEqual({ contact: { email: 'jane@example.com' } })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/contact/sync`).reply({ contact: { id: '113' } })

      await service.syncContact('jane@example.com', 'Jane', 'Doe', '+15551234567')

      expect(mock.history[0].body).toEqual({
        contact: { email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe', phone: '+15551234567' },
      })
    })

    it('includes custom field values when provided', async () => {
      mock.onPost(`${ BASE }/contact/sync`).reply({ contact: { id: '113' } })

      await service.syncContact('jane@example.com', undefined, undefined, undefined, { '1': 'Blue', '2': '2024-01-15' })

      expect(mock.history[0].body).toEqual({
        contact: {
          email: 'jane@example.com',
          fieldValues: [
            { field: '1', value: 'Blue' },
            { field: '2', value: '2024-01-15' },
          ],
        },
      })
    })

    it('omits empty custom fields object', async () => {
      mock.onPost(`${ BASE }/contact/sync`).reply({ contact: { id: '113' } })

      await service.syncContact('jane@example.com', undefined, undefined, undefined, {})

      expect(mock.history[0].body).toEqual({ contact: { email: 'jane@example.com' } })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/contact/sync`).replyWithError({
        message: 'Bad Request',
        body: { errors: [{ title: 'Email is required' }] },
      })

      await expect(service.syncContact('')).rejects.toThrow('ActiveCampaign API error: Email is required')
    })
  })

  describe('getContact', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/contacts/113`).reply({ contact: { id: '113', email: 'jane@example.com' } })

      const result = await service.getContact('113')

      expect(result).toEqual({ id: '113', email: 'jane@example.com' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'Api-Token': API_KEY })
    })
  })

  describe('listContacts', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ contacts: [], meta: { total: '0' } })

      const result = await service.listContacts()

      expect(result).toEqual({ contacts: [], total: 0 })
      expect(mock.history[0].query).toMatchObject({ limit: 20, offset: 0 })
    })

    it('passes email and search filters', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ contacts: [{ id: '1' }], meta: { total: '1' } })

      await service.listContacts('jane@example.com', 'Jane')

      expect(mock.history[0].query).toMatchObject({
        email: 'jane@example.com',
        search: 'Jane',
      })
    })

    it('resolves status label to API value', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ contacts: [], meta: { total: '0' } })

      await service.listContacts(undefined, undefined, 'Active')

      expect(mock.history[0].query).toMatchObject({ status: '1' })
    })

    it('passes custom limit and offset', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ contacts: [], meta: { total: '0' } })

      await service.listContacts(undefined, undefined, undefined, 50, 10)

      expect(mock.history[0].query).toMatchObject({ limit: 50, offset: 10 })
    })
  })

  describe('updateContact', () => {
    it('sends correct request with all params', async () => {
      mock.onPut(`${ BASE }/contacts/113`).reply({ contact: { id: '113' } })

      await service.updateContact('113', 'new@example.com', 'Jane', 'Smith', '+15559999999', { '1': 'Red' })

      expect(mock.history[0].body).toEqual({
        contact: {
          email: 'new@example.com',
          firstName: 'Jane',
          lastName: 'Smith',
          phone: '+15559999999',
          fieldValues: [{ field: '1', value: 'Red' }],
        },
      })
    })

    it('sends minimal body when only contactId provided', async () => {
      mock.onPut(`${ BASE }/contacts/113`).reply({ contact: { id: '113' } })

      await service.updateContact('113')

      expect(mock.history[0].body).toEqual({ contact: {} })
    })
  })

  describe('deleteContact', () => {
    it('sends correct request and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/contacts/113`).reply({})

      const result = await service.deleteContact('113')

      expect(result).toEqual({ deleted: true, contactId: '113' })
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Tags ──

  describe('createTag', () => {
    it('sends correct request with required params', async () => {
      mock.onPost(`${ BASE }/tags`).reply({ tag: { id: '16', tag: 'VIP' } })

      const result = await service.createTag('VIP')

      expect(result).toEqual({ id: '16', tag: 'VIP' })
      expect(mock.history[0].body).toEqual({
        tag: { tag: 'VIP', tagType: 'contact' },
      })
    })

    it('includes description when provided', async () => {
      mock.onPost(`${ BASE }/tags`).reply({ tag: { id: '16' } })

      await service.createTag('VIP', 'High-value customers')

      expect(mock.history[0].body).toEqual({
        tag: { tag: 'VIP', tagType: 'contact', description: 'High-value customers' },
      })
    })
  })

  describe('listTags', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/tags`).reply({ tags: [], meta: { total: '0' } })

      const result = await service.listTags()

      expect(result).toEqual({ tags: [], total: 0 })
      expect(mock.history[0].query).toMatchObject({ limit: 100, offset: 0 })
    })

    it('passes search filter', async () => {
      mock.onGet(`${ BASE }/tags`).reply({ tags: [{ id: '1', tag: 'VIP' }], meta: { total: '1' } })

      await service.listTags('VIP')

      expect(mock.history[0].query).toMatchObject({ search: 'VIP' })
    })
  })

  describe('addTagToContact', () => {
    it('sends correct request', async () => {
      mock.onPost(`${ BASE }/contactTags`).reply({ contactTag: { id: '3', contact: '113', tag: '16' } })

      const result = await service.addTagToContact('113', '16')

      expect(result).toEqual({ id: '3', contact: '113', tag: '16' })
      expect(mock.history[0].body).toEqual({
        contactTag: { contact: '113', tag: '16' },
      })
    })
  })

  describe('removeTagFromContact', () => {
    it('looks up association then deletes it', async () => {
      mock.onGet(`${ BASE }/contacts/113/contactTags`).reply({
        contactTags: [
          { id: '3', tag: '16' },
          { id: '4', tag: '20' },
        ],
      })
      mock.onDelete(`${ BASE }/contactTags/3`).reply({})

      const result = await service.removeTagFromContact('113', '16')

      expect(result).toEqual({ removed: true, contactId: '113', tagId: '16', contactTagId: '3' })
      expect(mock.history).toHaveLength(2)
    })

    it('throws when tag not found on contact', async () => {
      mock.onGet(`${ BASE }/contacts/113/contactTags`).reply({
        contactTags: [{ id: '4', tag: '20' }],
      })

      await expect(service.removeTagFromContact('113', '99')).rejects.toThrow(
        'ActiveCampaign API error: contact 113 does not have tag 99'
      )
    })
  })

  // ── Lists ──

  describe('listLists', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/lists`).reply({ lists: [], meta: { total: '0' } })

      const result = await service.listLists()

      expect(result).toEqual({ lists: [], total: 0 })
      expect(mock.history[0].query).toMatchObject({ limit: 100, offset: 0 })
    })

    it('passes name filter', async () => {
      mock.onGet(`${ BASE }/lists`).reply({ lists: [{ id: '1' }], meta: { total: '1' } })

      await service.listLists('Newsletter')

      expect(mock.history[0].query).toMatchObject({ 'filters[name]': 'Newsletter' })
    })
  })

  describe('updateListStatusForContact', () => {
    it('sends correct request with Subscribe status', async () => {
      mock.onPost(`${ BASE }/contactLists`).reply({ contactList: { id: '2', list: '1', contact: '113', status: '1' } })

      const result = await service.updateListStatusForContact('1', '113', 'Subscribe')

      expect(result).toEqual({ id: '2', list: '1', contact: '113', status: '1' })
      expect(mock.history[0].body).toEqual({
        contactList: { list: '1', contact: '113', status: '1' },
      })
    })

    it('resolves Unsubscribe status', async () => {
      mock.onPost(`${ BASE }/contactLists`).reply({ contactList: { id: '2' } })

      await service.updateListStatusForContact('1', '113', 'Unsubscribe')

      expect(mock.history[0].body).toEqual({
        contactList: { list: '1', contact: '113', status: '2' },
      })
    })
  })

  // ── Custom Fields ──

  describe('listFields', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/fields`).reply({ fields: [], meta: { total: '0' } })

      const result = await service.listFields()

      expect(result).toEqual({ fields: [], total: 0 })
      expect(mock.history[0].query).toMatchObject({ limit: 100, offset: 0 })
    })
  })

  describe('createFieldValue', () => {
    it('sends correct request', async () => {
      mock.onPost(`${ BASE }/fieldValues`).reply({ fieldValue: { id: '11', contact: '113', field: '1', value: 'Blue' } })

      const result = await service.createFieldValue('113', '1', 'Blue')

      expect(result).toEqual({ id: '11', contact: '113', field: '1', value: 'Blue' })
      expect(mock.history[0].body).toEqual({
        fieldValue: { contact: '113', field: '1', value: 'Blue' },
      })
    })
  })

  // ── Deals ──

  describe('createDeal', () => {
    it('sends correct request with required params', async () => {
      mock.onPost(`${ BASE }/deals`).reply({ deal: { id: '45', title: 'Website redesign' } })

      const result = await service.createDeal('Website redesign', 45000, 'usd', '1')

      expect(result).toEqual({ id: '45', title: 'Website redesign' })
      expect(mock.history[0].body).toEqual({
        deal: { title: 'Website redesign', value: 45000, currency: 'usd', group: '1' },
      })
    })

    it('includes all optional params', async () => {
      mock.onPost(`${ BASE }/deals`).reply({ deal: { id: '45' } })

      await service.createDeal('Deal', 10000, 'EUR', '1', '2', '113', '5', 'Some description')

      expect(mock.history[0].body).toEqual({
        deal: {
          title: 'Deal',
          value: 10000,
          currency: 'eur',
          group: '1',
          stage: '2',
          contact: '113',
          owner: '5',
          description: 'Some description',
        },
      })
    })

    it('defaults currency to usd when not provided', async () => {
      mock.onPost(`${ BASE }/deals`).reply({ deal: { id: '45' } })

      await service.createDeal('Deal', 10000, undefined, '1')

      expect(mock.history[0].body.deal.currency).toBe('usd')
    })
  })

  describe('getDeal', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/deals/45`).reply({ deal: { id: '45', title: 'Website redesign' } })

      const result = await service.getDeal('45')

      expect(result).toEqual({ id: '45', title: 'Website redesign' })
    })
  })

  describe('listDeals', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/deals`).reply({ deals: [], meta: { total: '0' } })

      const result = await service.listDeals()

      expect(result).toEqual({ deals: [], total: 0 })
      expect(mock.history[0].query).toMatchObject({ limit: 20, offset: 0 })
    })

    it('passes search filter', async () => {
      mock.onGet(`${ BASE }/deals`).reply({ deals: [], meta: { total: '0' } })

      await service.listDeals('Website')

      expect(mock.history[0].query).toMatchObject({
        'filters[search]': 'Website',
        'filters[search_field]': 'title',
      })
    })

    it('passes pipeline, stage, status, and contact filters', async () => {
      mock.onGet(`${ BASE }/deals`).reply({ deals: [], meta: { total: '0' } })

      await service.listDeals(undefined, '1', '2', 'Won', '113')

      expect(mock.history[0].query).toMatchObject({
        'filters[group]': '1',
        'filters[stage]': '2',
        'filters[status]': '1',
        'filters[contact]': '113',
      })
    })
  })

  describe('updateDeal', () => {
    it('sends correct request with all params', async () => {
      mock.onPut(`${ BASE }/deals/45`).reply({ deal: { id: '45' } })

      await service.updateDeal('45', 'New Title', 50000, 'eur', '1', '3', '5', 'Won', 'Updated desc')

      expect(mock.history[0].body).toEqual({
        deal: {
          title: 'New Title',
          value: 50000,
          currency: 'eur',
          group: '1',
          stage: '3',
          owner: '5',
          status: '1',
          description: 'Updated desc',
        },
      })
    })

    it('sends minimal body when only dealId provided', async () => {
      mock.onPut(`${ BASE }/deals/45`).reply({ deal: { id: '45' } })

      await service.updateDeal('45')

      expect(mock.history[0].body).toEqual({ deal: {} })
    })
  })

  describe('listPipelines', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/dealGroups`).reply({ dealGroups: [], meta: { total: '0' } })

      const result = await service.listPipelines()

      expect(result).toEqual({ pipelines: [], total: 0 })
      expect(mock.history[0].query).toMatchObject({ limit: 100, offset: 0 })
    })
  })

  describe('listStages', () => {
    it('sends correct request with pipeline filter', async () => {
      mock.onGet(`${ BASE }/dealStages`).reply({ dealStages: [], meta: { total: '0' } })

      const result = await service.listStages('1')

      expect(result).toEqual({ stages: [], total: 0 })
      expect(mock.history[0].query).toMatchObject({ 'filters[d_groupid]': '1' })
    })
  })

  // ── Automations ──

  describe('listAutomations', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/automations`).reply({ automations: [], meta: { total: '0' } })

      const result = await service.listAutomations()

      expect(result).toEqual({ automations: [], total: 0 })
      expect(mock.history[0].query).toMatchObject({ limit: 100, offset: 0 })
    })
  })

  describe('addContactToAutomation', () => {
    it('sends correct request', async () => {
      mock.onPost(`${ BASE }/contactAutomations`).reply({
        contactAutomation: { id: '2', contact: '113', automation: '1' },
      })

      const result = await service.addContactToAutomation('113', '1')

      expect(result).toEqual({ id: '2', contact: '113', automation: '1' })
      expect(mock.history[0].body).toEqual({
        contactAutomation: { contact: '113', automation: '1' },
      })
    })
  })

  // ── Campaigns ──

  describe('listCampaigns', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({ campaigns: [], meta: { total: '0' } })

      const result = await service.listCampaigns()

      expect(result).toEqual({ campaigns: [], total: 0 })
      expect(mock.history[0].query).toMatchObject({ limit: 20, offset: 0 })
    })

    it('resolves status label to API value', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({ campaigns: [], meta: { total: '0' } })

      await service.listCampaigns('Completed')

      expect(mock.history[0].query).toMatchObject({ 'filters[status]': '5' })
    })
  })

  // ── Notes ──

  describe('addNoteToContact', () => {
    it('sends correct request', async () => {
      mock.onPost(`${ BASE }/notes`).reply({
        note: { id: '7', note: 'Follow up', relid: '113', reltype: 'Subscriber' },
      })

      const result = await service.addNoteToContact('113', 'Follow up')

      expect(result).toEqual({ id: '7', note: 'Follow up', relid: '113', reltype: 'Subscriber' })
      expect(mock.history[0].body).toEqual({
        note: { note: 'Follow up', relid: '113', reltype: 'Subscriber' },
      })
    })
  })

  // ── Trigger System ──

  describe('onActiveCampaignEvent', () => {
    it('shapes event correctly (SHAPE_EVENT)', () => {
      const body = {
        type: 'subscribe',
        date: '2024-01-15 09:30:00',
        initiated_by: 'api',
        contact: { id: '113', email: 'jane@example.com' },
      }

      const result = service.onActiveCampaignEvent('SHAPE_EVENT', body)

      expect(result).toEqual([{
        name: 'onActiveCampaignEvent',
        data: {
          event: 'subscribe',
          date: '2024-01-15 09:30:00',
          initiatedBy: 'api',
          contact: { id: '113', email: 'jane@example.com' },
          deal: null,
          campaign: null,
          list: null,
          tag: null,
          link: null,
          payload: body,
        },
      }])
    })

    it('filters matching triggers (FILTER_TRIGGER)', () => {
      const payload = {
        triggers: [
          { id: 't1', data: { event: 'Contact Added' } },
          { id: 't2', data: { event: 'Contact Updated' } },
          { id: 't3', data: { event: 'Deal Added' } },
        ],
        eventData: { event: 'subscribe' },
      }

      const result = service.onActiveCampaignEvent('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['t1'] })
    })

    it('returns empty ids when no triggers match', () => {
      const payload = {
        triggers: [
          { id: 't1', data: { event: 'Deal Added' } },
        ],
        eventData: { event: 'subscribe' },
      }

      const result = service.onActiveCampaignEvent('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: [] })
    })
  })

  describe('handleTriggerUpsertWebhook', () => {
    it('creates webhooks for each event and returns webhook data', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ webhook: { id: '10' } })

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://example.com/webhook',
        connectionId: 'conn-1',
        events: [
          { id: 'e1', triggerData: { event: 'Contact Added' } },
          { id: 'e2', triggerData: { event: 'Deal Added' } },
        ],
      })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].body.webhook).toMatchObject({
        events: ['subscribe'],
        sources: ['public', 'admin', 'api', 'system'],
      })
      expect(mock.history[1].body.webhook).toMatchObject({
        events: ['deal_add'],
      })
      expect(result).toEqual({
        webhookData: {
          webhooks: [
            { triggerId: 'e1', webhookId: '10', event: 'subscribe' },
            { triggerId: 'e2', webhookId: '10', event: 'deal_add' },
          ],
        },
        connectionId: 'conn-1',
      })
    })

    it('appends connectionId to callback URL with ?', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ webhook: { id: '10' } })

      await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://example.com/webhook',
        connectionId: 'conn-1',
        events: [{ id: 'e1', triggerData: { event: 'Contact Added' } }],
      })

      expect(mock.history[0].body.webhook.url).toBe('https://example.com/webhook?connectionId=conn-1')
    })

    it('appends connectionId with & when URL already has query params', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ webhook: { id: '10' } })

      await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://example.com/webhook?foo=bar',
        connectionId: 'conn-1',
        events: [{ id: 'e1', triggerData: { event: 'Contact Added' } }],
      })

      expect(mock.history[0].body.webhook.url).toBe('https://example.com/webhook?foo=bar&connectionId=conn-1')
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('resolves JSON body with event type', async () => {
      const invocation = {
        body: { type: 'subscribe', contact: { id: '113', email: 'jane@example.com' } },
        queryParams: { connectionId: 'conn-1' },
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.connectionId).toBe('conn-1')
      expect(result.events).toHaveLength(1)
      expect(result.events[0].name).toBe('onActiveCampaignEvent')
      expect(result.events[0].data.event).toBe('subscribe')
    })

    it('returns handshake response when body is empty', async () => {
      const result = await service.handleTriggerResolveEvents({})

      expect(result).toEqual({ handshake: true, responseToExternalService: {} })
    })

    it('returns empty events when body has no type', async () => {
      const result = await service.handleTriggerResolveEvents({
        body: { contact: { id: '113' } },
        queryParams: { connectionId: 'conn-1' },
      })

      expect(result.events).toEqual([])
    })

    it('parses form-encoded string body', async () => {
      const formBody = 'type=subscribe&contact%5Bemail%5D=jane%40example.com&contact%5Bid%5D=113'

      const result = await service.handleTriggerResolveEvents({
        body: formBody,
        queryParams: { connectionId: 'conn-1' },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].data.event).toBe('subscribe')
      expect(result.events[0].data.contact).toEqual({ email: 'jane@example.com', id: '113' })
    })

    it('parses flat bracketed-key object body', async () => {
      const result = await service.handleTriggerResolveEvents({
        body: {
          'type': 'update',
          'contact[id]': '113',
          'contact[email]': 'jane@example.com',
        },
        queryParams: { connectionId: 'conn-1' },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].data.event).toBe('update')
      expect(result.events[0].data.contact).toEqual({ id: '113', email: 'jane@example.com' })
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('delegates to the correct event method', async () => {
      const invocation = {
        eventName: 'onActiveCampaignEvent',
        triggers: [{ id: 't1', data: { event: 'Contact Added' } }],
        eventData: { event: 'subscribe' },
      }

      const result = await service.handleTriggerSelectMatched(invocation)

      expect(result).toEqual({ ids: ['t1'] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes all webhooks and returns empty data', async () => {
      mock.onDelete(`${ BASE }/webhooks/10`).reply({})
      mock.onDelete(`${ BASE }/webhooks/11`).reply({})

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: {
          webhooks: [
            { triggerId: 'e1', webhookId: '10' },
            { triggerId: 'e2', webhookId: '11' },
          ],
        },
      })

      expect(mock.history).toHaveLength(2)
      expect(result).toEqual({ webhookData: {} })
    })

    it('skips webhooks without webhookId', async () => {
      mock.onDelete(`${ BASE }/webhooks/10`).reply({})

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: {
          webhooks: [
            { triggerId: 'e1', webhookId: '10' },
            { triggerId: 'e2' },
          ],
        },
      })

      expect(mock.history).toHaveLength(1)
      expect(result).toEqual({ webhookData: {} })
    })

    it('continues when a delete fails', async () => {
      mock.onDelete(`${ BASE }/webhooks/10`).replyWithError({ message: 'Not found' })
      mock.onDelete(`${ BASE }/webhooks/11`).reply({})

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: {
          webhooks: [
            { triggerId: 'e1', webhookId: '10' },
            { triggerId: 'e2', webhookId: '11' },
          ],
        },
      })

      expect(mock.history).toHaveLength(2)
      expect(result).toEqual({ webhookData: {} })
    })
  })

  // ── Dictionaries ──

  describe('getTagsDictionary', () => {
    it('returns items with correct shape', async () => {
      mock.onGet(`${ BASE }/tags`).reply({
        tags: [{ id: '16', tag: 'VIP Customer' }],
        meta: { total: '1' },
      })

      const result = await service.getTagsDictionary({})

      expect(result.items).toEqual([{ label: 'VIP Customer', value: '16', note: 'Tag ID: 16' }])
      expect(result.cursor).toBeNull()
    })

    it('passes search and pagination', async () => {
      mock.onGet(`${ BASE }/tags`).reply({ tags: [], meta: { total: '0' } })

      await service.getTagsDictionary({ search: 'VIP', cursor: '100' })

      expect(mock.history[0].query).toMatchObject({ search: 'VIP', offset: 100 })
    })

    it('returns cursor when more pages exist', async () => {
      const tags = Array.from({ length: 100 }, (_, i) => ({ id: String(i), tag: `Tag ${ i }` }))

      mock.onGet(`${ BASE }/tags`).reply({ tags, meta: { total: '250' } })

      const result = await service.getTagsDictionary({})

      expect(result.cursor).toBe('100')
    })
  })

  describe('getListsDictionary', () => {
    it('returns items with correct shape', async () => {
      mock.onGet(`${ BASE }/lists`).reply({
        lists: [{ id: '1', name: 'Newsletter' }],
        meta: { total: '1' },
      })

      const result = await service.getListsDictionary({})

      expect(result.items).toEqual([{ label: 'Newsletter', value: '1', note: 'List ID: 1' }])
    })

    it('filters by search client-side', async () => {
      mock.onGet(`${ BASE }/lists`).reply({
        lists: [{ id: '1', name: 'Newsletter' }, { id: '2', name: 'Updates' }],
        meta: { total: '2' },
      })

      const result = await service.getListsDictionary({ search: 'news' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Newsletter')
    })
  })

  describe('getFieldsDictionary', () => {
    it('returns items with correct shape', async () => {
      mock.onGet(`${ BASE }/fields`).reply({
        fields: [{ id: '1', title: 'Favorite Color', type: 'dropdown', perstag: 'FAVORITE_COLOR' }],
        meta: { total: '1' },
      })

      const result = await service.getFieldsDictionary({})

      expect(result.items).toEqual([{
        label: 'Favorite Color',
        value: '1',
        note: 'dropdown — %FAVORITE_COLOR%',
      }])
    })

    it('filters by search client-side', async () => {
      mock.onGet(`${ BASE }/fields`).reply({
        fields: [
          { id: '1', title: 'Favorite Color', type: 'dropdown', perstag: 'FAV' },
          { id: '2', title: 'Company', type: 'text', perstag: 'COMPANY' },
        ],
        meta: { total: '2' },
      })

      const result = await service.getFieldsDictionary({ search: 'color' })

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getPipelinesDictionary', () => {
    it('returns items with correct shape', async () => {
      mock.onGet(`${ BASE }/dealGroups`).reply({
        dealGroups: [{ id: '1', title: 'Sales Pipeline' }],
        meta: { total: '1' },
      })

      const result = await service.getPipelinesDictionary({})

      expect(result.items).toEqual([{ label: 'Sales Pipeline', value: '1', note: 'Pipeline ID: 1' }])
    })

    it('passes search as filter', async () => {
      mock.onGet(`${ BASE }/dealGroups`).reply({ dealGroups: [], meta: { total: '0' } })

      await service.getPipelinesDictionary({ search: 'Sales' })

      expect(mock.history[0].query).toMatchObject({ 'filters[title]': 'Sales' })
    })
  })

  describe('getStagesDictionary', () => {
    it('returns items with correct shape', async () => {
      mock.onGet(`${ BASE }/dealStages`).reply({
        dealStages: [{ id: '1', title: 'To Contact' }],
        meta: { total: '1' },
      })

      const result = await service.getStagesDictionary({ criteria: { pipelineId: '1' } })

      expect(result.items).toEqual([{ label: 'To Contact', value: '1', note: 'Stage ID: 1' }])
      expect(mock.history[0].query).toMatchObject({ 'filters[d_groupid]': '1' })
    })

    it('returns empty when no pipelineId in criteria', async () => {
      const result = await service.getStagesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('passes search as title filter', async () => {
      mock.onGet(`${ BASE }/dealStages`).reply({ dealStages: [], meta: { total: '0' } })

      await service.getStagesDictionary({ search: 'Contact', criteria: { pipelineId: '1' } })

      expect(mock.history[0].query).toMatchObject({ 'filters[title]': 'Contact' })
    })
  })

  describe('getAutomationsDictionary', () => {
    it('returns items with correct shape', async () => {
      mock.onGet(`${ BASE }/automations`).reply({
        automations: [{ id: '1', name: 'Welcome Series' }],
        meta: { total: '1' },
      })

      const result = await service.getAutomationsDictionary({})

      expect(result.items).toEqual([{ label: 'Welcome Series', value: '1', note: 'Automation ID: 1' }])
    })

    it('filters by search client-side', async () => {
      mock.onGet(`${ BASE }/automations`).reply({
        automations: [
          { id: '1', name: 'Welcome Series' },
          { id: '2', name: 'Follow Up' },
        ],
        meta: { total: '2' },
      })

      const result = await service.getAutomationsDictionary({ search: 'welcome' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Welcome Series')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('extracts error from errors array', async () => {
      mock.onGet(`${ BASE }/contacts/999`).replyWithError({
        message: 'Not Found',
        body: { errors: [{ title: 'Contact not found' }] },
      })

      await expect(service.getContact('999')).rejects.toThrow('ActiveCampaign API error: Contact not found')
    })

    it('extracts error from message field', async () => {
      mock.onGet(`${ BASE }/contacts/999`).replyWithError({
        message: 'Server Error',
        body: { message: 'Internal server error' },
      })

      await expect(service.getContact('999')).rejects.toThrow('ActiveCampaign API error: Internal server error')
    })

    it('falls back to error.message when body has no recognized fields', async () => {
      mock.onGet(`${ BASE }/contacts/999`).replyWithError({
        message: 'Network Error',
      })

      await expect(service.getContact('999')).rejects.toThrow('ActiveCampaign API error: Network Error')
    })
  })
})
