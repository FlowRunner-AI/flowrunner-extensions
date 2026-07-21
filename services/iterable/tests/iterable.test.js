'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const US_BASE = 'https://api.iterable.com/api'
const EU_BASE = 'https://api.eu.iterable.com/api'

describe('Iterable Service', () => {
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
        expect.objectContaining({
          name: 'region',
          displayName: 'Data Center',
          required: false,
          shared: false,
          type: 'CHOICE',
          options: ['US', 'EU'],
          defaultValue: 'US',
        }),
      ])
    })

    it('sends the Api-Key and Content-Type headers on requests', async () => {
      mock.onGet(`${ US_BASE }/lists`).reply({ lists: [] })

      await service.getLists()

      expect(mock.history[0].headers).toMatchObject({
        'Api-Key': API_KEY,
        'Content-Type': 'application/json',
      })
    })

    it('defaults to the US base URL', async () => {
      mock.onGet(`${ US_BASE }/lists`).reply({ lists: [] })

      await service.getLists()

      expect(mock.history[0].url).toBe(`${ US_BASE }/lists`)
    })
  })

  // ── Region / base URL selection ──
  //
  // `region` is read in the constructor, so the EU branch needs its own service
  // instance. We re-register the service against a fresh EU sandbox in an
  // isolated module context, then restore the primary sandbox's global so the
  // remaining tests keep using the US instance/mock.

  describe('EU region', () => {
    let euSandbox
    let euService
    let euMock

    beforeAll(() => {
      jest.resetModules()
      euSandbox = createSandbox({ apiKey: API_KEY, region: 'EU' })
      require('../src/index.js')
      euService = euSandbox.getService()
      euMock = euSandbox.getRequestMock()
    })

    afterEach(() => {
      euMock.reset()
    })

    afterAll(() => {
      euSandbox.cleanup()
      // Rebuild the primary US sandbox so the remaining suites keep a valid
      // global Flowrunner, service instance, and request mock.
      jest.resetModules()
      sandbox = createSandbox({ apiKey: API_KEY })
      require('../src/index.js')
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })

    it('uses the EU base URL when region is EU', async () => {
      euMock.onGet(`${ EU_BASE }/lists`).reply({ lists: [] })

      await euService.getLists()

      expect(euMock.history[0].url).toBe(`${ EU_BASE }/lists`)
      expect(euMock.history[0].headers).toMatchObject({ 'Api-Key': API_KEY })
    })

    it('routes a write request to the EU host', async () => {
      euMock.onPost(`${ EU_BASE }/users/update`).reply({ code: 'Success', msg: '' })

      await euService.updateUser('user@example.com')

      expect(euMock.history[0].url).toBe(`${ EU_BASE }/users/update`)
    })
  })

  // ── Users ──

  describe('updateUser', () => {
    it('sends with required identifier only (email)', async () => {
      mock.onPost(`${ US_BASE }/users/update`).reply({ code: 'Success', msg: '', params: null })

      const result = await service.updateUser('user@example.com')

      expect(result).toEqual({ code: 'Success', msg: '', params: null })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ email: 'user@example.com' })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ US_BASE }/users/update`).reply({ code: 'Success' })

      await service.updateUser(
        'user@example.com',
        'u-123',
        { firstName: 'Ada', plan: 'pro' },
        true,
        true
      )

      expect(mock.history[0].body).toEqual({
        email: 'user@example.com',
        userId: 'u-123',
        dataFields: { firstName: 'Ada', plan: 'pro' },
        mergeNestedObjects: true,
        preferUserId: true,
      })
    })

    it('omits falsy optional flags and empty dataFields', async () => {
      mock.onPost(`${ US_BASE }/users/update`).reply({ code: 'Success' })

      await service.updateUser('user@example.com', undefined, undefined, false, false)

      expect(mock.history[0].body).toEqual({ email: 'user@example.com' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ US_BASE }/users/update`).replyWithError({
        body: { code: 'InvalidApiKey', msg: 'Invalid API key' },
      })

      await expect(service.updateUser('user@example.com')).rejects.toThrow(
        'Iterable API error: Invalid API key (InvalidApiKey)'
      )
    })

    it('throws when the API returns a non-Success code with a 2xx status', async () => {
      mock.onPost(`${ US_BASE }/users/update`).reply({ code: 'BadParams', msg: 'Missing identifier' })

      await expect(service.updateUser('user@example.com')).rejects.toThrow(
        'Iterable API error: Missing identifier'
      )
    })
  })

  describe('getUser', () => {
    it('looks up by email (default) with url encoding', async () => {
      mock.onGet(`${ US_BASE }/users/user%40example.com`).reply({ user: { email: 'user@example.com' } })

      const result = await service.getUser('user@example.com')

      expect(result).toEqual({ user: { email: 'user@example.com' } })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ US_BASE }/users/user%40example.com`)
    })

    it('looks up by userId when lookupBy is User ID', async () => {
      mock.onGet(`${ US_BASE }/users/byUserId/u-123`).reply({ user: { userId: 'u-123' } })

      const result = await service.getUser('u-123', 'User ID')

      expect(result).toEqual({ user: { userId: 'u-123' } })
      expect(mock.history[0].url).toBe(`${ US_BASE }/users/byUserId/u-123`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ US_BASE }/users/missing%40example.com`).replyWithError({ message: 'Not found' })

      await expect(service.getUser('missing@example.com')).rejects.toThrow(
        'Iterable API error: Not found'
      )
    })
  })

  describe('deleteUser', () => {
    it('sends delete with url-encoded email', async () => {
      mock.onDelete(`${ US_BASE }/users/user%40example.com`).reply({ code: 'Success' })

      const result = await service.deleteUser('user@example.com')

      expect(result).toEqual({ code: 'Success' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ US_BASE }/users/user%40example.com`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ US_BASE }/users/user%40example.com`).replyWithError({ message: 'Boom' })

      await expect(service.deleteUser('user@example.com')).rejects.toThrow('Iterable API error: Boom')
    })
  })

  describe('bulkUpdateUsers', () => {
    it('sends the users array to the bulkUpdate endpoint', async () => {
      mock.onPost(`${ US_BASE }/users/bulkUpdate`).reply({ successCount: 2, failCount: 0 })

      const users = [{ email: 'a@x.com' }, { email: 'b@x.com', dataFields: { plan: 'pro' } }]
      const result = await service.bulkUpdateUsers(users)

      expect(result).toEqual({ successCount: 2, failCount: 0 })
      expect(mock.history[0].url).toBe(`${ US_BASE }/users/bulkUpdate`)
      expect(mock.history[0].body).toEqual({ users })
    })

    it('defaults to an empty array when no users provided', async () => {
      mock.onPost(`${ US_BASE }/users/bulkUpdate`).reply({ successCount: 0, failCount: 0 })

      await service.bulkUpdateUsers()

      expect(mock.history[0].body).toEqual({ users: [] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ US_BASE }/users/bulkUpdate`).replyWithError({ message: 'Boom' })

      await expect(service.bulkUpdateUsers([])).rejects.toThrow('Iterable API error: Boom')
    })
  })

  describe('updateSubscriptions', () => {
    it('sends with identifier only', async () => {
      mock.onPost(`${ US_BASE }/users/updateSubscriptions`).reply({ code: 'Success' })

      await service.updateSubscriptions('user@example.com')

      expect(mock.history[0].url).toBe(`${ US_BASE }/users/updateSubscriptions`)
      expect(mock.history[0].body).toEqual({ email: 'user@example.com' })
    })

    it('includes all optional arrays and campaign id', async () => {
      mock.onPost(`${ US_BASE }/users/updateSubscriptions`).reply({ code: 'Success' })

      await service.updateSubscriptions(
        undefined,
        'u-123',
        [1, 2],
        [3],
        [4, 5],
        [6],
        777
      )

      expect(mock.history[0].body).toEqual({
        userId: 'u-123',
        emailListIds: [1, 2],
        unsubscribedChannelIds: [3],
        unsubscribedMessageTypeIds: [4, 5],
        subscribedMessageTypeIds: [6],
        campaignId: 777,
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ US_BASE }/users/updateSubscriptions`).replyWithError({ message: 'Boom' })

      await expect(service.updateSubscriptions('user@example.com')).rejects.toThrow(
        'Iterable API error: Boom'
      )
    })
  })

  describe('getUserFields', () => {
    it('fetches the user field schema', async () => {
      mock.onGet(`${ US_BASE }/users/getFields`).reply({ fields: { email: 'string' } })

      const result = await service.getUserFields()

      expect(result).toEqual({ fields: { email: 'string' } })
      expect(mock.history[0].url).toBe(`${ US_BASE }/users/getFields`)
      expect(mock.history[0].method).toBe('get')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ US_BASE }/users/getFields`).replyWithError({ message: 'Boom' })

      await expect(service.getUserFields()).rejects.toThrow('Iterable API error: Boom')
    })
  })

  // ── Events ──

  describe('trackEvent', () => {
    it('sends with required params only', async () => {
      mock.onPost(`${ US_BASE }/events/track`).reply({ code: 'Success' })

      await service.trackEvent('purchase', 'user@example.com')

      expect(mock.history[0].url).toBe(`${ US_BASE }/events/track`)
      expect(mock.history[0].body).toEqual({
        eventName: 'purchase',
        email: 'user@example.com',
      })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ US_BASE }/events/track`).reply({ code: 'Success' })

      await service.trackEvent(
        'purchase',
        undefined,
        'u-123',
        { amount: 49.99, currency: 'USD' },
        1700000000,
        555
      )

      expect(mock.history[0].body).toEqual({
        eventName: 'purchase',
        userId: 'u-123',
        dataFields: { amount: 49.99, currency: 'USD' },
        createdAt: 1700000000,
        campaignId: 555,
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ US_BASE }/events/track`).replyWithError({ message: 'Boom' })

      await expect(service.trackEvent('purchase', 'user@example.com')).rejects.toThrow(
        'Iterable API error: Boom'
      )
    })
  })

  describe('trackBulkEvents', () => {
    it('sends the events array to the trackBulk endpoint', async () => {
      mock.onPost(`${ US_BASE }/events/trackBulk`).reply({ successCount: 3, failCount: 0 })

      const events = [
        { email: 'a@x.com', eventName: 'purchase', dataFields: { amount: 10 } },
        { email: 'b@x.com', eventName: 'signup' },
      ]
      const result = await service.trackBulkEvents(events)

      expect(result).toEqual({ successCount: 3, failCount: 0 })
      expect(mock.history[0].url).toBe(`${ US_BASE }/events/trackBulk`)
      expect(mock.history[0].body).toEqual({ events })
    })

    it('defaults to an empty array when no events provided', async () => {
      mock.onPost(`${ US_BASE }/events/trackBulk`).reply({ successCount: 0, failCount: 0 })

      await service.trackBulkEvents()

      expect(mock.history[0].body).toEqual({ events: [] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ US_BASE }/events/trackBulk`).replyWithError({ message: 'Boom' })

      await expect(service.trackBulkEvents([])).rejects.toThrow('Iterable API error: Boom')
    })
  })

  // ── Lists ──

  describe('getLists', () => {
    it('fetches all lists', async () => {
      mock.onGet(`${ US_BASE }/lists`).reply({ lists: [{ id: 12345, name: 'Newsletter' }] })

      const result = await service.getLists()

      expect(result).toEqual({ lists: [{ id: 12345, name: 'Newsletter' }] })
      expect(mock.history[0].url).toBe(`${ US_BASE }/lists`)
      expect(mock.history[0].method).toBe('get')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ US_BASE }/lists`).replyWithError({ message: 'Boom' })

      await expect(service.getLists()).rejects.toThrow('Iterable API error: Boom')
    })
  })

  describe('createList', () => {
    it('posts the list name', async () => {
      mock.onPost(`${ US_BASE }/lists`).reply({ listId: 12345 })

      const result = await service.createList('Newsletter')

      expect(result).toEqual({ listId: 12345 })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ name: 'Newsletter' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ US_BASE }/lists`).replyWithError({ message: 'Boom' })

      await expect(service.createList('Newsletter')).rejects.toThrow('Iterable API error: Boom')
    })
  })

  describe('deleteList', () => {
    it('sends delete to the list id endpoint', async () => {
      mock.onDelete(`${ US_BASE }/lists/12345`).reply({ code: 'Success' })

      const result = await service.deleteList(12345)

      expect(result).toEqual({ code: 'Success' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ US_BASE }/lists/12345`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ US_BASE }/lists/12345`).replyWithError({ message: 'Boom' })

      await expect(service.deleteList(12345)).rejects.toThrow('Iterable API error: Boom')
    })
  })

  describe('subscribeToList', () => {
    it('posts list id and subscribers', async () => {
      mock.onPost(`${ US_BASE }/lists/subscribe`).reply({ successCount: 2, failCount: 0 })

      const subscribers = [{ email: 'a@x.com' }, { userId: 'u-1' }]
      const result = await service.subscribeToList(12345, subscribers)

      expect(result).toEqual({ successCount: 2, failCount: 0 })
      expect(mock.history[0].url).toBe(`${ US_BASE }/lists/subscribe`)
      expect(mock.history[0].body).toEqual({ listId: 12345, subscribers })
    })

    it('defaults subscribers to an empty array', async () => {
      mock.onPost(`${ US_BASE }/lists/subscribe`).reply({ successCount: 0, failCount: 0 })

      await service.subscribeToList(12345)

      expect(mock.history[0].body).toEqual({ listId: 12345, subscribers: [] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ US_BASE }/lists/subscribe`).replyWithError({ message: 'Boom' })

      await expect(service.subscribeToList(12345, [])).rejects.toThrow('Iterable API error: Boom')
    })
  })

  describe('unsubscribeFromList', () => {
    it('posts list id and subscribers', async () => {
      mock.onPost(`${ US_BASE }/lists/unsubscribe`).reply({ successCount: 1, failCount: 0 })

      const subscribers = [{ email: 'a@x.com' }]
      const result = await service.unsubscribeFromList(12345, subscribers)

      expect(result).toEqual({ successCount: 1, failCount: 0 })
      expect(mock.history[0].url).toBe(`${ US_BASE }/lists/unsubscribe`)
      expect(mock.history[0].body).toEqual({ listId: 12345, subscribers })
    })

    it('defaults subscribers to an empty array', async () => {
      mock.onPost(`${ US_BASE }/lists/unsubscribe`).reply({ successCount: 0, failCount: 0 })

      await service.unsubscribeFromList(12345)

      expect(mock.history[0].body).toEqual({ listId: 12345, subscribers: [] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ US_BASE }/lists/unsubscribe`).replyWithError({ message: 'Boom' })

      await expect(service.unsubscribeFromList(12345, [])).rejects.toThrow('Iterable API error: Boom')
    })
  })

  describe('getListUsers', () => {
    it('passes the list id as a query param', async () => {
      mock.onGet(`${ US_BASE }/lists/getUsers`).reply({ emails: 'a@x.com\nb@x.com' })

      const result = await service.getListUsers(12345)

      expect(result).toEqual({ emails: 'a@x.com\nb@x.com' })
      expect(mock.history[0].url).toBe(`${ US_BASE }/lists/getUsers`)
      expect(mock.history[0].query).toEqual({ listId: 12345 })
    })

    it('wraps a newline-delimited string response into an object', async () => {
      mock.onGet(`${ US_BASE }/lists/getUsers`).reply('user1@example.com\nuser2@example.com')

      const result = await service.getListUsers(12345)

      expect(result).toEqual({ emails: 'user1@example.com\nuser2@example.com' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ US_BASE }/lists/getUsers`).replyWithError({ message: 'Boom' })

      await expect(service.getListUsers(12345)).rejects.toThrow('Iterable API error: Boom')
    })
  })

  describe('getListSize', () => {
    it('wraps a numeric response into an object', async () => {
      mock.onGet(`${ US_BASE }/lists/12345/size`).reply(1042)

      const result = await service.getListSize(12345)

      expect(result).toEqual({ size: 1042 })
      expect(mock.history[0].url).toBe(`${ US_BASE }/lists/12345/size`)
    })

    it('passes through an object response unchanged', async () => {
      mock.onGet(`${ US_BASE }/lists/12345/size`).reply({ size: 5 })

      const result = await service.getListSize(12345)

      expect(result).toEqual({ size: 5 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ US_BASE }/lists/12345/size`).replyWithError({ message: 'Boom' })

      await expect(service.getListSize(12345)).rejects.toThrow('Iterable API error: Boom')
    })
  })

  // ── Email & Push ──

  describe('sendEmail', () => {
    it('sends with required params only', async () => {
      mock.onPost(`${ US_BASE }/email/target`).reply({ code: 'Success' })

      await service.sendEmail(98765, 'to@example.com')

      expect(mock.history[0].url).toBe(`${ US_BASE }/email/target`)
      expect(mock.history[0].body).toEqual({
        campaignId: 98765,
        recipientEmail: 'to@example.com',
      })
    })

    it('includes dataFields when provided', async () => {
      mock.onPost(`${ US_BASE }/email/target`).reply({ code: 'Success' })

      await service.sendEmail(98765, 'to@example.com', { orderId: 'A-100' })

      expect(mock.history[0].body).toEqual({
        campaignId: 98765,
        recipientEmail: 'to@example.com',
        dataFields: { orderId: 'A-100' },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ US_BASE }/email/target`).replyWithError({ message: 'Boom' })

      await expect(service.sendEmail(98765, 'to@example.com')).rejects.toThrow(
        'Iterable API error: Boom'
      )
    })
  })

  describe('sendPush', () => {
    it('sends with campaign id and recipient email', async () => {
      mock.onPost(`${ US_BASE }/push/target`).reply({ code: 'Success' })

      await service.sendPush(98765, 'to@example.com')

      expect(mock.history[0].url).toBe(`${ US_BASE }/push/target`)
      expect(mock.history[0].body).toEqual({
        campaignId: 98765,
        recipientEmail: 'to@example.com',
      })
    })

    it('sends with recipient user id and data fields', async () => {
      mock.onPost(`${ US_BASE }/push/target`).reply({ code: 'Success' })

      await service.sendPush(98765, undefined, 'u-123', { title: 'Hi' })

      expect(mock.history[0].body).toEqual({
        campaignId: 98765,
        recipientUserId: 'u-123',
        dataFields: { title: 'Hi' },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ US_BASE }/push/target`).replyWithError({ message: 'Boom' })

      await expect(service.sendPush(98765, 'to@example.com')).rejects.toThrow(
        'Iterable API error: Boom'
      )
    })
  })

  // ── Campaigns ──

  describe('listCampaigns', () => {
    it('fetches all campaigns', async () => {
      mock.onGet(`${ US_BASE }/campaigns`).reply({ campaigns: [{ id: 98765, name: 'Welcome' }] })

      const result = await service.listCampaigns()

      expect(result).toEqual({ campaigns: [{ id: 98765, name: 'Welcome' }] })
      expect(mock.history[0].url).toBe(`${ US_BASE }/campaigns`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ US_BASE }/campaigns`).replyWithError({ message: 'Boom' })

      await expect(service.listCampaigns()).rejects.toThrow('Iterable API error: Boom')
    })
  })

  describe('getCampaignMetrics', () => {
    it('sends campaign ids as the campaignId query param', async () => {
      mock.onGet(`${ US_BASE }/campaigns/metrics`).reply({ metrics: 'id,name\n1,Welcome' })

      const result = await service.getCampaignMetrics([98765, 98766])

      expect(result).toEqual({ metrics: 'id,name\n1,Welcome' })
      expect(mock.history[0].url).toBe(`${ US_BASE }/campaigns/metrics`)
      expect(mock.history[0].query).toEqual({ campaignId: [98765, 98766] })
    })

    it('includes the date range when provided', async () => {
      mock.onGet(`${ US_BASE }/campaigns/metrics`).reply({ metrics: 'csv' })

      await service.getCampaignMetrics([98765], '2024-01-01', '2024-01-31')

      expect(mock.history[0].query).toEqual({
        campaignId: [98765],
        startDateTime: '2024-01-01',
        endDateTime: '2024-01-31',
      })
    })

    it('wraps a raw CSV string response into an object', async () => {
      mock.onGet(`${ US_BASE }/campaigns/metrics`).reply('id,name,sends\n98765,Welcome,1000')

      const result = await service.getCampaignMetrics([98765])

      expect(result).toEqual({ metrics: 'id,name,sends\n98765,Welcome,1000' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ US_BASE }/campaigns/metrics`).replyWithError({ message: 'Boom' })

      await expect(service.getCampaignMetrics([98765])).rejects.toThrow('Iterable API error: Boom')
    })
  })

  // ── Templates ──

  describe('listEmailTemplates', () => {
    it('sends an empty query when no filters provided', async () => {
      mock.onGet(`${ US_BASE }/templates`).reply({ templates: [] })

      const result = await service.listEmailTemplates()

      expect(result).toEqual({ templates: [] })
      expect(mock.history[0].url).toBe(`${ US_BASE }/templates`)
      expect(mock.history[0].query).toEqual({})
    })

    it('maps friendly choice labels to API values', async () => {
      mock.onGet(`${ US_BASE }/templates`).reply({ templates: [] })

      await service.listEmailTemplates('Triggered', 'In-App')

      expect(mock.history[0].query).toEqual({
        templateType: 'Triggered',
        messageMedium: 'InApp',
      })
    })

    it('passes through message medium values that map identically', async () => {
      mock.onGet(`${ US_BASE }/templates`).reply({ templates: [] })

      await service.listEmailTemplates('Blast', 'Email')

      expect(mock.history[0].query).toEqual({
        templateType: 'Blast',
        messageMedium: 'Email',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ US_BASE }/templates`).replyWithError({ message: 'Boom' })

      await expect(service.listEmailTemplates()).rejects.toThrow('Iterable API error: Boom')
    })
  })

  describe('getEmailTemplate', () => {
    it('passes the template id as a query param', async () => {
      mock.onGet(`${ US_BASE }/templates/email/get`).reply({ templateId: 54321, name: 'Welcome' })

      const result = await service.getEmailTemplate(54321)

      expect(result).toEqual({ templateId: 54321, name: 'Welcome' })
      expect(mock.history[0].url).toBe(`${ US_BASE }/templates/email/get`)
      expect(mock.history[0].query).toEqual({ templateId: 54321 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ US_BASE }/templates/email/get`).replyWithError({ message: 'Boom' })

      await expect(service.getEmailTemplate(54321)).rejects.toThrow('Iterable API error: Boom')
    })
  })

  // ── Dictionary Methods ──

  describe('getListsDictionary', () => {
    it('maps lists to items with list type notes', async () => {
      mock.onGet(`${ US_BASE }/lists`).reply({
        lists: [
          { id: 12345, name: 'Newsletter', listType: 'Standard' },
          { id: 12346, name: 'Promos', listType: 'Standard' },
        ],
      })

      const result = await service.getListsDictionary({})

      expect(mock.history[0].url).toBe(`${ US_BASE }/lists`)
      expect(result).toEqual({
        items: [
          { label: 'Newsletter', value: 12345, note: 'Standard' },
          { label: 'Promos', value: 12346, note: 'Standard' },
        ],
        cursor: null,
      })
    })

    it('falls back to a generated label when name is missing', async () => {
      mock.onGet(`${ US_BASE }/lists`).reply({
        lists: [{ id: 999 }],
      })

      const result = await service.getListsDictionary({})

      expect(result.items[0]).toEqual({ label: 'List 999', value: 999, note: undefined })
    })

    it('filters by search term', async () => {
      mock.onGet(`${ US_BASE }/lists`).reply({
        lists: [
          { id: 1, name: 'Newsletter', listType: 'Standard' },
          { id: 2, name: 'Promotions', listType: 'Standard' },
        ],
      })

      const result = await service.getListsDictionary({ search: 'promo' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe(2)
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ US_BASE }/lists`).reply({ lists: [] })

      const result = await service.getListsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles a response with no lists key', async () => {
      mock.onGet(`${ US_BASE }/lists`).reply({})

      const result = await service.getListsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getCampaignsDictionary', () => {
    it('maps campaigns to items with medium/state notes', async () => {
      mock.onGet(`${ US_BASE }/campaigns`).reply({
        campaigns: [
          { id: 98765, name: 'Welcome Series', messageMedium: 'Email', campaignState: 'Ready' },
          { id: 98766, name: 'Push Blast', messageMedium: 'Push', campaignState: 'Running' },
        ],
      })

      const result = await service.getCampaignsDictionary({})

      expect(mock.history[0].url).toBe(`${ US_BASE }/campaigns`)
      expect(result).toEqual({
        items: [
          { label: 'Welcome Series', value: 98765, note: 'Email - Ready' },
          { label: 'Push Blast', value: 98766, note: 'Push - Running' },
        ],
        cursor: null,
      })
    })

    it('falls back to a generated label and omits note when metadata is missing', async () => {
      mock.onGet(`${ US_BASE }/campaigns`).reply({
        campaigns: [{ id: 42 }],
      })

      const result = await service.getCampaignsDictionary({})

      expect(result.items[0]).toEqual({ label: 'Campaign 42', value: 42, note: undefined })
    })

    it('filters by search term', async () => {
      mock.onGet(`${ US_BASE }/campaigns`).reply({
        campaigns: [
          { id: 1, name: 'Welcome Series', messageMedium: 'Email' },
          { id: 2, name: 'Winback', messageMedium: 'Email' },
        ],
      })

      const result = await service.getCampaignsDictionary({ search: 'winback' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe(2)
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ US_BASE }/campaigns`).reply({ campaigns: [] })

      const result = await service.getCampaignsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles a response with no campaigns key', async () => {
      mock.onGet(`${ US_BASE }/campaigns`).reply({})

      const result = await service.getCampaignsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})
