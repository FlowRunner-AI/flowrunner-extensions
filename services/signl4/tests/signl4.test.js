'use strict'

const { createSandbox } = require('../../../service-sandbox')

const TEAM_SECRET = 'test-team-secret'
const WEBHOOK_URL = `https://connect.signl4.com/webhook/${ TEAM_SECRET }`

describe('SIGNL4 Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ teamSecret: TEAM_SECRET })
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
    it('registers the required config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['teamSecret'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'teamSecret',
            displayName: 'Team Secret',
            type: 'STRING',
            required: true,
            shared: false,
          }),
        ])
      )
    })

    it('stores the team secret on the instance', () => {
      expect(service.teamSecret).toBe(TEAM_SECRET)
    })
  })

  // ── Send Alert ──

  describe('sendAlert', () => {
    it('posts a minimal alert with defaults applied', async () => {
      mock.onPost(WEBHOOK_URL).reply({ eventId: 'evt-1' })

      const result = await service.sendAlert('Database unreachable')

      expect(result).toEqual({ eventId: 'evt-1' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(WEBHOOK_URL)
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })

      expect(mock.history[0].body).toEqual({
        'Title': 'Database unreachable',
        'X-S4-AlertingScenario': 'single_ack',
        'X-S4-Status': 'new',
      })
    })

    it('sends every optional field and maps the alerting scenario label', async () => {
      mock.onPost(WEBHOOK_URL).reply({ eventId: 'evt-2' })

      await service.sendAlert(
        'Disk full',
        'Node 3 is out of disk space',
        'Multi ACK',
        'incident-42',
        'Payments API',
        '49.4,8.7',
        true,
        'FlowRunner'
      )

      expect(mock.history[0].body).toEqual({
        'Title': 'Disk full',
        'Message': 'Node 3 is out of disk space',
        'X-S4-Service': 'Payments API',
        'X-S4-Location': '49.4,8.7',
        'X-S4-AlertingScenario': 'multi_ack',
        'X-S4-Filtering': 'true',
        'X-S4-ExternalID': 'incident-42',
        'X-S4-Status': 'new',
        'X-S4-SourceSystem': 'FlowRunner',
      })
    })

    it('accepts the string "true" for filtering', async () => {
      mock.onPost(WEBHOOK_URL).reply({ eventId: 'evt-3' })

      await service.sendAlert('Title', undefined, undefined, undefined, undefined, undefined, 'true')

      expect(mock.history[0].body['X-S4-Filtering']).toBe('true')
    })

    it('omits filtering when it is false', async () => {
      mock.onPost(WEBHOOK_URL).reply({ eventId: 'evt-4' })

      await service.sendAlert('Title', undefined, undefined, undefined, undefined, undefined, false)

      expect(mock.history[0].body).not.toHaveProperty('X-S4-Filtering')
    })

    it('passes an unmapped alerting scenario value through unchanged', async () => {
      mock.onPost(WEBHOOK_URL).reply({ eventId: 'evt-5' })

      await service.sendAlert('Title', undefined, 'multi_ack')

      expect(mock.history[0].body['X-S4-AlertingScenario']).toBe('multi_ack')
    })

    it('falls back to single_ack when the scenario is empty', async () => {
      mock.onPost(WEBHOOK_URL).reply({ eventId: 'evt-6' })

      await service.sendAlert('Title', undefined, null)

      expect(mock.history[0].body['X-S4-AlertingScenario']).toBe('single_ack')
    })

    it('drops empty-string fields from the payload', async () => {
      mock.onPost(WEBHOOK_URL).reply({ eventId: 'evt-7' })

      await service.sendAlert('Title', '', undefined, '', '', '')

      expect(mock.history[0].body).toEqual({
        'Title': 'Title',
        'X-S4-AlertingScenario': 'single_ack',
        'X-S4-Status': 'new',
      })
    })
  })

  // ── Resolve Alert ──

  describe('resolveAlert', () => {
    it('posts a resolve payload for the external id', async () => {
      mock.onPost(WEBHOOK_URL).reply({ eventId: 'evt-8' })

      const result = await service.resolveAlert('incident-42')

      expect(result).toEqual({ eventId: 'evt-8' })
      expect(mock.history[0].method).toBe('post')

      expect(mock.history[0].body).toEqual({
        'X-S4-ExternalID': 'incident-42',
        'X-S4-Status': 'resolved',
      })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('surfaces the status and the API message', async () => {
      mock.onPost(WEBHOOK_URL).replyWithError({
        message: 'Request failed',
        status: 401,
        body: { message: 'Invalid team secret' },
      })

      await expect(service.sendAlert('Title')).rejects.toThrow('SIGNL4 API error (401): Invalid team secret')
    })

    it('uses a string error body verbatim', async () => {
      mock.onPost(WEBHOOK_URL).replyWithError({
        message: 'Request failed',
        statusCode: 400,
        body: 'Bad Request',
      })

      await expect(service.resolveAlert('incident-42')).rejects.toThrow('SIGNL4 API error (400): Bad Request')
    })

    it('stringifies an object body without a message field', async () => {
      mock.onPost(WEBHOOK_URL).replyWithError({
        message: 'Request failed',
        status: 500,
        body: { error: 'boom' },
      })

      await expect(service.sendAlert('Title')).rejects.toThrow('SIGNL4 API error (500): {"error":"boom"}')
    })

    it('falls back to the error message and omits the status when there is none', async () => {
      mock.onPost(WEBHOOK_URL).replyWithError({ message: 'Network timeout' })

      await expect(service.sendAlert('Title')).rejects.toThrow('SIGNL4 API error: Network timeout')
    })
  })
})
