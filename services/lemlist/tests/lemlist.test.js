'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-lemlist-api-key'
const BASE = 'https://api.lemlist.com/api'
const AUTH_HEADER = `Basic ${ Buffer.from(`:${ API_KEY }`).toString('base64') }`

describe('Lemlist Service', () => {
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

    it('sends Basic auth header on requests', async () => {
      mock.onGet(`${ BASE }/team`).reply({ _id: 'tea_1' })

      await service.getTeam()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': AUTH_HEADER,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Campaigns ──

  describe('listCampaigns', () => {
    it('sends GET with default limit and no offset', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply([])

      const result = await service.listCampaigns()

      expect(result).toEqual([])
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toMatchObject({ limit: 100 })
    })

    it('passes custom offset and limit', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply([{ _id: 'cam_1' }])

      await service.listCampaigns(10, 25)

      expect(mock.history[0].query).toMatchObject({ offset: 10, limit: 25 })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/campaigns`).replyWithError({
        message: 'Unauthorized',
        body: { message: 'Invalid API key' },
        status: 401,
      })

      await expect(service.listCampaigns()).rejects.toThrow('Lemlist API error (401)')
    })
  })

  describe('getCampaign', () => {
    it('sends GET with campaign ID in the URL', async () => {
      mock.onGet(`${ BASE }/campaigns/cam_aBcD1234`).reply({ _id: 'cam_aBcD1234', name: 'Q3' })

      const result = await service.getCampaign('cam_aBcD1234')

      expect(result).toEqual({ _id: 'cam_aBcD1234', name: 'Q3' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/campaigns/cam_aBcD1234`)
    })
  })

  describe('getCampaignStats', () => {
    it('sends GET to /campaigns/{id}/stats', async () => {
      const stats = { nbLeads: 250, nbEmailsSent: 480 }
      mock.onGet(`${ BASE }/campaigns/cam_1/stats`).reply(stats)

      const result = await service.getCampaignStats('cam_1')

      expect(result).toEqual(stats)
      expect(mock.history[0].url).toBe(`${ BASE }/campaigns/cam_1/stats`)
    })
  })

  // ── Leads ──

  describe('addLeadToCampaign', () => {
    it('sends POST with required fields only', async () => {
      const response = { _id: 'lea_1', email: 'jane@acme.com', campaignId: 'cam_1' }
      mock.onPost(`${ BASE }/campaigns/cam_1/leads/jane%40acme.com`).reply(response)

      const result = await service.addLeadToCampaign('cam_1', 'jane@acme.com')

      expect(result).toEqual(response)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({})
    })

    it('sends all optional fields in body', async () => {
      mock.onPost(`${ BASE }/campaigns/cam_1/leads/jane%40acme.com`).reply({ _id: 'lea_1' })

      await service.addLeadToCampaign(
        'cam_1', 'jane@acme.com', 'Jane', 'Doe', 'Acme', '+1234567890',
        'https://linkedin.com/in/jane', { icebreaker: 'Loved your talk' }
      )

      expect(mock.history[0].body).toEqual({
        firstName: 'Jane',
        lastName: 'Doe',
        companyName: 'Acme',
        phone: '+1234567890',
        linkedinUrl: 'https://linkedin.com/in/jane',
        icebreaker: 'Loved your talk',
      })
    })

    it('omits empty/null optional fields via clean()', async () => {
      mock.onPost(`${ BASE }/campaigns/cam_1/leads/jane%40acme.com`).reply({ _id: 'lea_1' })

      await service.addLeadToCampaign('cam_1', 'jane@acme.com', 'Jane', '', null, undefined)

      expect(mock.history[0].body).toEqual({ firstName: 'Jane' })
    })

    it('sends deduplicate=true as query param when enabled', async () => {
      mock.onPost(`${ BASE }/campaigns/cam_1/leads/jane%40acme.com`).reply({ _id: 'lea_1' })

      await service.addLeadToCampaign(
        'cam_1', 'jane@acme.com', undefined, undefined, undefined,
        undefined, undefined, undefined, true
      )

      expect(mock.history[0].query).toMatchObject({ deduplicate: 'true' })
    })

    it('omits deduplicate query param when false', async () => {
      mock.onPost(`${ BASE }/campaigns/cam_1/leads/jane%40acme.com`).reply({ _id: 'lea_1' })

      await service.addLeadToCampaign('cam_1', 'jane@acme.com')

      expect(mock.history[0].query).not.toHaveProperty('deduplicate')
    })
  })

  describe('getLead', () => {
    it('sends GET with email in the URL', async () => {
      const lead = { _id: 'lea_1', email: 'jane@acme.com', firstName: 'Jane' }
      mock.onGet(`${ BASE }/leads/jane%40acme.com`).reply(lead)

      const result = await service.getLead('jane@acme.com')

      expect(result).toEqual(lead)
      expect(mock.history[0].url).toBe(`${ BASE }/leads/jane%40acme.com`)
    })
  })

  describe('updateLead', () => {
    it('sends PATCH with updated fields', async () => {
      mock.onPatch(`${ BASE }/campaigns/cam_1/leads/jane%40acme.com`).reply({ _id: 'lea_1' })

      await service.updateLead('cam_1', 'jane@acme.com', 'Jane', 'Smith')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ firstName: 'Jane', lastName: 'Smith' })
    })

    it('spreads custom fields into body', async () => {
      mock.onPatch(`${ BASE }/campaigns/cam_1/leads/jane%40acme.com`).reply({ _id: 'lea_1' })

      await service.updateLead(
        'cam_1', 'jane@acme.com', undefined, undefined, undefined,
        undefined, undefined, { title: 'CTO', icebreaker: 'Hi' }
      )

      expect(mock.history[0].body).toEqual({ title: 'CTO', icebreaker: 'Hi' })
    })

    it('sends empty body when no fields provided', async () => {
      mock.onPatch(`${ BASE }/campaigns/cam_1/leads/jane%40acme.com`).reply({ _id: 'lea_1' })

      await service.updateLead('cam_1', 'jane@acme.com')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteLeadFromCampaign', () => {
    it('sends DELETE with campaign and email in the URL', async () => {
      mock.onDelete(`${ BASE }/campaigns/cam_1/leads/jane%40acme.com`).reply({ deleted: true })

      const result = await service.deleteLeadFromCampaign('cam_1', 'jane@acme.com')

      expect(result).toEqual({ deleted: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/campaigns/cam_1/leads/jane%40acme.com`)
    })
  })

  describe('unsubscribeLead', () => {
    it('sends POST to /unsubscribe endpoint', async () => {
      mock.onPost(`${ BASE }/campaigns/cam_1/leads/jane%40acme.com/unsubscribe`).reply({ unsubscribed: true })

      const result = await service.unsubscribeLead('cam_1', 'jane@acme.com')

      expect(result).toEqual({ unsubscribed: true })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/campaigns/cam_1/leads/jane%40acme.com/unsubscribe`)
    })
  })

  describe('markLeadInterested', () => {
    it('sends POST to /interested endpoint', async () => {
      mock.onPost(`${ BASE }/campaigns/cam_1/leads/jane%40acme.com/interested`).reply({ interested: true })

      const result = await service.markLeadInterested('cam_1', 'jane@acme.com')

      expect(result).toEqual({ interested: true })
      expect(mock.history[0].url).toBe(`${ BASE }/campaigns/cam_1/leads/jane%40acme.com/interested`)
    })
  })

  describe('markLeadNotInterested', () => {
    it('sends POST to /notinterested endpoint', async () => {
      mock.onPost(`${ BASE }/campaigns/cam_1/leads/jane%40acme.com/notinterested`).reply({ interested: false })

      const result = await service.markLeadNotInterested('cam_1', 'jane@acme.com')

      expect(result).toEqual({ interested: false })
      expect(mock.history[0].url).toBe(`${ BASE }/campaigns/cam_1/leads/jane%40acme.com/notinterested`)
    })
  })

  // ── Activities ──

  describe('getActivities', () => {
    it('sends GET with default limit and no filters', async () => {
      mock.onGet(`${ BASE }/activities`).reply([])

      const result = await service.getActivities()

      expect(result).toEqual([])
      expect(mock.history[0].query).toMatchObject({ limit: 100 })
      expect(mock.history[0].query).not.toHaveProperty('type')
    })

    it('resolves friendly type label to API value', async () => {
      mock.onGet(`${ BASE }/activities`).reply([])

      await service.getActivities('Email Opened')

      expect(mock.history[0].query).toMatchObject({ type: 'emailsOpened' })
    })

    it('passes through raw API type value', async () => {
      mock.onGet(`${ BASE }/activities`).reply([])

      await service.getActivities('emailsClicked')

      expect(mock.history[0].query).toMatchObject({ type: 'emailsClicked' })
    })

    it('passes campaignId, limit and offset', async () => {
      mock.onGet(`${ BASE }/activities`).reply([])

      await service.getActivities('Email Sent', 'cam_1', 50, 10)

      expect(mock.history[0].query).toMatchObject({
        type: 'emailsSent',
        campaignId: 'cam_1',
        limit: 50,
        offset: 10,
      })
    })
  })

  // ── Unsubscribes ──

  describe('listUnsubscribes', () => {
    it('sends GET with default limit', async () => {
      mock.onGet(`${ BASE }/unsubscribes`).reply([])

      const result = await service.listUnsubscribes()

      expect(result).toEqual([])
      expect(mock.history[0].query).toMatchObject({ limit: 100 })
    })

    it('passes custom limit and offset', async () => {
      mock.onGet(`${ BASE }/unsubscribes`).reply([])

      await service.listUnsubscribes(25, 50)

      expect(mock.history[0].query).toMatchObject({ limit: 25, offset: 50 })
    })
  })

  describe('addUnsubscribe', () => {
    it('sends POST with email in the URL', async () => {
      mock.onPost(`${ BASE }/unsubscribes/optout%40example.com`).reply({ _id: 'uns_1', email: 'optout@example.com' })

      const result = await service.addUnsubscribe('optout@example.com')

      expect(result).toEqual({ _id: 'uns_1', email: 'optout@example.com' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/unsubscribes/optout%40example.com`)
    })
  })

  describe('deleteUnsubscribe', () => {
    it('sends DELETE with email in the URL', async () => {
      mock.onDelete(`${ BASE }/unsubscribes/optout%40example.com`).reply({ deleted: true })

      const result = await service.deleteUnsubscribe('optout@example.com')

      expect(result).toEqual({ deleted: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Team ──

  describe('getTeam', () => {
    it('sends GET to /team', async () => {
      const team = { _id: 'tea_1', name: 'Acme Growth' }
      mock.onGet(`${ BASE }/team`).reply(team)

      const result = await service.getTeam()

      expect(result).toEqual(team)
      expect(mock.history[0].url).toBe(`${ BASE }/team`)
    })
  })

  // ── Dictionary ──

  describe('getCampaignsDictionary', () => {
    const campaigns = [
      { _id: 'cam_1', name: 'Q3 Outbound', status: 'running' },
      { _id: 'cam_2', name: 'Holiday Promo', status: 'paused' },
      { _id: 'cam_3', name: 'Q4 Outbound', status: 'draft' },
    ]

    it('returns all campaigns as dictionary items', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply(campaigns)

      const result = await service.getCampaignsDictionary({})

      expect(result.items).toEqual([
        { label: 'Q3 Outbound', value: 'cam_1', note: 'running' },
        { label: 'Holiday Promo', value: 'cam_2', note: 'paused' },
        { label: 'Q4 Outbound', value: 'cam_3', note: 'draft' },
      ])
    })

    it('filters campaigns by search term', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply(campaigns)

      const result = await service.getCampaignsDictionary({ search: 'outbound' })

      expect(result.items).toHaveLength(2)
      expect(result.items[0].label).toBe('Q3 Outbound')
      expect(result.items[1].label).toBe('Q4 Outbound')
    })

    it('returns undefined cursor when fewer than limit campaigns', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply(campaigns)

      const result = await service.getCampaignsDictionary({})

      expect(result.cursor).toBeUndefined()
    })

    it('returns next cursor when campaigns equal the limit', async () => {
      // Simulate a full page of 100 campaigns
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        _id: `cam_${ i }`,
        name: `Campaign ${ i }`,
        status: 'running',
      }))
      mock.onGet(`${ BASE }/campaigns`).reply(fullPage)

      const result = await service.getCampaignsDictionary({})

      expect(result.cursor).toBe('100')
    })

    it('uses cursor as numeric offset', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply([])

      await service.getCampaignsDictionary({ cursor: '200' })

      expect(mock.history[0].query).toMatchObject({ offset: 200, limit: 100 })
    })

    it('handles null payload gracefully', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply([])

      const result = await service.getCampaignsDictionary(null)

      expect(result).toHaveProperty('items')
      expect(result.items).toEqual([])
    })

    it('falls back to _id as label when name is missing', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply([{ _id: 'cam_x' }])

      const result = await service.getCampaignsDictionary({})

      expect(result.items[0].label).toBe('cam_x')
    })

    it('handles response with campaigns property instead of array', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({ campaigns: [{ _id: 'cam_1', name: 'C1' }] })

      const result = await service.getCampaignsDictionary({})

      expect(result.items).toEqual([{ label: 'C1', value: 'cam_1', note: undefined }])
    })
  })
})
