'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-access-token'
const BASE = 'https://api.dropcontact.com'
const ENRICH_URL = `${ BASE }/v1/enrich/all`

describe('Dropcontact Service', () => {
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

    it('sends the X-Access-Token header on requests', async () => {
      mock.onPost(ENRICH_URL).reply({ success: true, request_id: 'req-1' })

      await service.enrichContacts('jane@example.com')

      expect(mock.history[0].headers).toMatchObject({
        'X-Access-Token': API_KEY,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── enrichContacts (submit) ──

  describe('enrichContacts', () => {
    it('submits a single contact with required params only and defaults language to en', async () => {
      mock.onPost(ENRICH_URL).reply({ success: true, request_id: 'req-1', credits_left: 950 })

      const result = await service.enrichContacts('jane@example.com')

      expect(result).toEqual({ success: true, request_id: 'req-1', credits_left: 950 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(ENRICH_URL)
      expect(mock.history[0].body).toEqual({
        data: [{ email: 'jane@example.com' }],
        language: 'en',
      })
    })

    it('builds a full single contact record, drops empty fields, and includes siren only when true', async () => {
      mock.onPost(ENRICH_URL).reply({ success: true, request_id: 'req-2' })

      await service.enrichContacts(
        'jane@example.com',
        'Jane',
        'Doe',
        'Jane Doe',
        'Acme',
        'acme.fr',
        '+33123456789',
        '123456789',
        'https://www.linkedin.com/in/janedoe',
        undefined,
        true,
        'fr'
      )

      expect(mock.history[0].body).toEqual({
        data: [
          {
            email: 'jane@example.com',
            first_name: 'Jane',
            last_name: 'Doe',
            full_name: 'Jane Doe',
            company: 'Acme',
            website: 'acme.fr',
            phone: '+33123456789',
            num_siren: '123456789',
            linkedin: 'https://www.linkedin.com/in/janedoe',
          },
        ],
        siren: true,
        language: 'fr',
      })
    })

    it('omits siren when it is false (not just falsy)', async () => {
      mock.onPost(ENRICH_URL).reply({ success: true, request_id: 'req-3' })

      await service.enrichContacts('jane@example.com', undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, false, undefined)

      expect(mock.history[0].body).toEqual({
        data: [{ email: 'jane@example.com' }],
        language: 'en',
      })
      expect(mock.history[0].body).not.toHaveProperty('siren')
    })

    it('uses the contacts array and it takes precedence over single-contact fields', async () => {
      mock.onPost(ENRICH_URL).reply({ success: true, request_id: 'req-4' })

      const contacts = [
        { email: 'a@example.com' },
        { first_name: 'Bob', last_name: 'Smith', company: 'Acme' },
      ]

      await service.enrichContacts(
        'ignored@example.com',
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        contacts
      )

      expect(mock.history[0].body).toEqual({
        data: contacts,
        language: 'en',
      })
    })

    it('falls back to single-contact fields when the contacts array is empty', async () => {
      mock.onPost(ENRICH_URL).reply({ success: true, request_id: 'req-5' })

      await service.enrichContacts(
        'jane@example.com',
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        []
      )

      expect(mock.history[0].body).toEqual({
        data: [{ email: 'jane@example.com' }],
        language: 'en',
      })
    })

    it('supports a name + company lookup with no email', async () => {
      mock.onPost(ENRICH_URL).reply({ success: true, request_id: 'req-6' })

      await service.enrichContacts(undefined, 'Jane', 'Doe', undefined, 'Acme')

      expect(mock.history[0].body).toEqual({
        data: [{ first_name: 'Jane', last_name: 'Doe', company: 'Acme' }],
        language: 'en',
      })
    })

    it('throws (without calling the API) when no usable contact data is provided', async () => {
      await expect(service.enrichContacts()).rejects.toThrow(
        'Dropcontact API error: provide at least an email, a first/last name with company, or a LinkedIn URL (or a non-empty Contacts array).'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('wraps an API error using error.body.error', async () => {
      mock.onPost(ENRICH_URL).replyWithError({
        message: 'Bad Request',
        body: { error: 'Invalid token' },
        status: 401,
      })

      await expect(service.enrichContacts('jane@example.com')).rejects.toThrow(
        'Dropcontact API error: Invalid token'
      )
    })

    it('wraps an API error using error.body.reason', async () => {
      mock.onPost(ENRICH_URL).replyWithError({
        message: 'Bad Request',
        body: { reason: 'quota exceeded' },
      })

      await expect(service.enrichContacts('jane@example.com')).rejects.toThrow(
        'Dropcontact API error: quota exceeded'
      )
    })

    it('wraps an API error using error.message when no structured body is present', async () => {
      mock.onPost(ENRICH_URL).replyWithError({ message: 'Network Error' })

      await expect(service.enrichContacts('jane@example.com')).rejects.toThrow(
        'Dropcontact API error: Network Error'
      )
    })
  })

  // ── getEnrichmentResult (poll) ──

  describe('getEnrichmentResult', () => {
    it('fetches the result by request id (GET, url-encoded path)', async () => {
      const payload = {
        success: true,
        error: false,
        data: [{ email: [{ email: 'jane@acme.fr', qualification: 'nominative@pro' }] }],
      }
      mock.onGet(`${ ENRICH_URL }/req%2F123`).reply(payload)

      const result = await service.getEnrichmentResult('req/123')

      expect(result).toEqual(payload)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ ENRICH_URL }/req%2F123`)
    })

    it('passes through a not-ready response (success:false)', async () => {
      mock.onGet(`${ ENRICH_URL }/req-1`).reply({ success: false, reason: 'Request not ready yet' })

      const result = await service.getEnrichmentResult('req-1')

      expect(result).toEqual({ success: false, reason: 'Request not ready yet' })
    })

    it('throws (without calling the API) when requestId is missing', async () => {
      await expect(service.getEnrichmentResult()).rejects.toThrow(
        'Dropcontact API error: requestId is required.'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('wraps an API error', async () => {
      mock.onGet(`${ ENRICH_URL }/req-1`).replyWithError({ message: 'Not found', status: 404 })

      await expect(service.getEnrichmentResult('req-1')).rejects.toThrow(
        'Dropcontact API error: Not found'
      )
    })
  })

  // ── enrichAndWait (submit + poll) ──

  describe('enrichAndWait', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.runOnlyPendingTimers()
      jest.useRealTimers()
    })

    it('submits, polls, and returns completed status with data once ready', async () => {
      mock.onPost(ENRICH_URL).reply({ success: true, request_id: 'req-99', credits_left: 900 })

      let attempt = 0
      mock.onGet(`${ ENRICH_URL }/req-99`).replyWith(() => {
        attempt += 1
        // Not ready on the first poll, ready on the second.
        if (attempt < 2) {
          return { success: false, reason: 'Request not ready yet' }
        }

        return {
          success: true,
          data: [{ email: [{ email: 'jane@acme.fr', qualification: 'nominative@pro' }] }],
        }
      })

      const promise = service.enrichAndWait('jane@example.com')

      // Two poll cycles: advance well past the poll interval to drain the sleeps.
      await jest.advanceTimersByTimeAsync(8000)
      await jest.advanceTimersByTimeAsync(8000)

      const result = await promise

      expect(result).toEqual({
        status: 'completed',
        request_id: 'req-99',
        credits_left: 900,
        data: [{ email: [{ email: 'jane@acme.fr', qualification: 'nominative@pro' }] }],
      })

      // 1 submit POST + 2 result GETs.
      const posts = mock.history.filter(h => h.method === 'post')
      const gets = mock.history.filter(h => h.method === 'get')
      expect(posts).toHaveLength(1)
      expect(gets).toHaveLength(2)
    })

    it('returns pending status with the request id when polling never completes in time', async () => {
      mock.onPost(ENRICH_URL).reply({ success: true, request_id: 'req-pending', credits_left: 800 })
      mock.onGet(`${ ENRICH_URL }/req-pending`).reply({ success: false, reason: 'Request not ready yet' })

      const promise = service.enrichAndWait('jane@example.com')

      // Drain all 11 bounded poll cycles.
      await jest.advanceTimersByTimeAsync(8000 * 11)

      const result = await promise

      expect(result).toEqual({
        status: 'pending',
        request_id: 'req-pending',
        credits_left: 800,
        reason: 'Enrichment still processing. Retry later with Get Enrichment Result using this request_id.',
      })
    })

    it('throws when the submission does not return a request_id', async () => {
      mock.onPost(ENRICH_URL).reply({ success: true, credits_left: 700 })

      await expect(service.enrichAndWait('jane@example.com')).rejects.toThrow(
        'Dropcontact API error: submission did not return a request_id.'
      )
    })

    it('propagates a submission error before polling starts', async () => {
      mock.onPost(ENRICH_URL).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.enrichAndWait('jane@example.com')).rejects.toThrow(
        'Dropcontact API error: Unauthorized'
      )
      // No GET polling should have happened.
      expect(mock.history.filter(h => h.method === 'get')).toHaveLength(0)
    })
  })
})
