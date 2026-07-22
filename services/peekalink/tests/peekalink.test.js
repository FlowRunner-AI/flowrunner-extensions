'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.peekalink.io'

const EXPECTED_HEADERS = {
  'X-API-Key': API_KEY,
  'Content-Type': 'application/json',
}

describe('Peekalink Service', () => {
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
    it('registers the required config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['apiKey'])

      expect(configItems[0]).toEqual(
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          type: 'STRING',
          required: true,
          shared: false,
        })
      )
    })

    it('stores the api key on the service instance', () => {
      expect(service.apiKey).toBe(API_KEY)
    })
  })

  // ── Preview Link ──

  describe('previewLink', () => {
    it('posts the link to the root endpoint', async () => {
      const preview = { id: 1, url: 'https://example.com', title: 'Example', ok: true }

      mock.onPost(`${ BASE }/`).reply(preview)

      const result = await service.previewLink('https://example.com')

      expect(result).toEqual(preview)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/`)
      expect(mock.history[0].headers).toEqual(EXPECTED_HEADERS)
      expect(mock.history[0].body).toEqual({ link: 'https://example.com' })
    })

    it('sends an undefined link through untouched when omitted', async () => {
      mock.onPost(`${ BASE }/`).reply({ ok: false })

      await service.previewLink()

      expect(mock.history[0].body).toEqual({ link: undefined })
    })

    it('maps a 401 response to an invalid api key error', async () => {
      mock.onPost(`${ BASE }/`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { message: 'Invalid token.' },
      })

      await expect(service.previewLink('https://example.com')).rejects.toThrow(
        'Peekalink API error: invalid or missing API key (401).'
      )
    })

    it('maps a 429 response to a rate limit error', async () => {
      mock.onPost(`${ BASE }/`).replyWithError({
        message: 'Too Many Requests',
        status: 429,
      })

      await expect(service.previewLink('https://example.com')).rejects.toThrow(/rate limit exceeded \(429\)/)
    })

    it('surfaces the api error body message with the status code', async () => {
      mock.onPost(`${ BASE }/`).replyWithError({
        message: 'Bad Request',
        statusCode: 400,
        body: { message: 'Enter a valid URL.' },
      })

      await expect(service.previewLink('not-a-url')).rejects.toThrow(
        'Peekalink API error (400): Enter a valid URL.'
      )
    })

    it('falls back to the transport error message when no status or body is present', async () => {
      mock.onPost(`${ BASE }/`).replyWithError({ message: 'Network timeout' })

      await expect(service.previewLink('https://example.com')).rejects.toThrow(
        'Peekalink API error: Network timeout'
      )
    })
  })

  // ── Check Availability ──

  describe('checkAvailability', () => {
    it('posts the link to the is-available endpoint', async () => {
      mock.onPost(`${ BASE }/is-available`).reply({ isAvailable: true })

      const result = await service.checkAvailability('https://example.com')

      expect(result).toEqual({ isAvailable: true })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/is-available`)
      expect(mock.history[0].headers).toEqual(EXPECTED_HEADERS)
      expect(mock.history[0].body).toEqual({ link: 'https://example.com' })
    })

    it('returns a negative availability result untouched', async () => {
      mock.onPost(`${ BASE }/is-available`).reply({ isAvailable: false })

      await expect(service.checkAvailability('https://nope.invalid')).resolves.toEqual({ isAvailable: false })
    })

    it('throws a descriptive error when the request fails', async () => {
      mock.onPost(`${ BASE }/is-available`).replyWithError({
        message: 'Server Error',
        status: 500,
        body: { message: 'Something went wrong' },
      })

      await expect(service.checkAvailability('https://example.com')).rejects.toThrow(
        'Peekalink API error (500): Something went wrong'
      )
    })
  })
})
