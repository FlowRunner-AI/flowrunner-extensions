'use strict'

const { createSandbox } = require('../../../service-sandbox')

const URL = 'https://sendy.example.com'
const API_KEY = 'test-api-key'

describe('Sendy Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ url: `${ URL }///`, apiKey: API_KEY })
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

  // ── Registration & construction ──

  describe('service registration', () => {
    it('registers the required config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['url', 'apiKey'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'url', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'apiKey', required: true, shared: false, type: 'STRING' }),
        ])
      )
    })

    it('strips trailing slashes from the installation URL', () => {
      expect(service.url).toBe(URL)
      expect(service.apiKey).toBe(API_KEY)
    })
  })

  // ── Subscribers ──

  describe('subscribe', () => {
    it('sends a form-encoded POST with the API key and required fields only', async () => {
      mock.onPost(`${ URL }/subscribe`).reply('true')

      const result = await service.subscribe('list-1', 'jane@example.com')

      expect(result).toBe('true')
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ URL }/subscribe`)

      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })

      expect(mock.history[0].body).toEqual({
        api_key: API_KEY,
        list: 'list-1',
        email: 'jane@example.com',
        boolean: 'true',
      })
    })

    it('includes all optional fields and merges custom fields', async () => {
      mock.onPost(`${ URL }/subscribe`).reply('true')

      await service.subscribe(
        'list-1',
        'jane@example.com',
        'Jane',
        'US',
        '10.0.0.1',
        'https://example.com',
        true,
        true,
        { City: 'London' }
      )

      expect(mock.history[0].body).toEqual({
        api_key: API_KEY,
        list: 'list-1',
        email: 'jane@example.com',
        name: 'Jane',
        country: 'US',
        ipaddress: '10.0.0.1',
        referrer: 'https://example.com',
        gdpr: 'true',
        silent: 'true',
        boolean: 'true',
        City: 'London',
      })
    })

    it('normalizes truthy flag variants to the string "true"', async () => {
      mock.onPost(`${ URL }/subscribe`).reply('true')

      await service.subscribe('list-1', 'jane@example.com', null, null, null, null, '1', 1)

      expect(mock.history[0].body).toMatchObject({ gdpr: 'true', silent: 'true' })
    })

    it('omits flags when they are falsy or unrecognized', async () => {
      mock.onPost(`${ URL }/subscribe`).reply('true')

      await service.subscribe('list-1', 'jane@example.com', null, null, null, null, false, '')

      expect(mock.history[0].body).not.toHaveProperty('gdpr')
      expect(mock.history[0].body).not.toHaveProperty('silent')
    })

    it('ignores custom fields that are not an object', async () => {
      mock.onPost(`${ URL }/subscribe`).reply('true')

      await service.subscribe('list-1', 'jane@example.com', null, null, null, null, null, null, 'nope')

      expect(mock.history[0].body).toEqual({
        api_key: API_KEY,
        list: 'list-1',
        email: 'jane@example.com',
        boolean: 'true',
      })
    })

    it('throws when Sendy replies with a plain-text error string', async () => {
      mock.onPost(`${ URL }/subscribe`).reply('Already subscribed.')

      await expect(service.subscribe('list-1', 'jane@example.com'))
        .rejects.toThrow('Sendy API error: Already subscribed.')
    })

    it('throws on the "Invalid email address." plain-text error', async () => {
      mock.onPost(`${ URL }/subscribe`).reply('Invalid email address.')

      await expect(service.subscribe('list-1', 'oops'))
        .rejects.toThrow('Sendy API error: Invalid email address.')
    })
  })

  describe('unsubscribe', () => {
    it('posts the list, email and boolean flag', async () => {
      mock.onPost(`${ URL }/unsubscribe`).reply('true')

      const result = await service.unsubscribe('list-1', 'jane@example.com')

      expect(result).toBe('true')

      expect(mock.history[0].body).toEqual({
        api_key: API_KEY,
        list: 'list-1',
        email: 'jane@example.com',
        boolean: 'true',
      })
    })

    it('throws when the email does not exist', async () => {
      mock.onPost(`${ URL }/unsubscribe`).reply('Email does not exist.')

      await expect(service.unsubscribe('list-1', 'ghost@example.com'))
        .rejects.toThrow('Sendy API error: Email does not exist.')
    })
  })

  describe('deleteSubscriber', () => {
    it('posts to the subscribers delete endpoint with snake_case fields', async () => {
      mock.onPost(`${ URL }/api/subscribers/delete.php`).reply('true')

      const result = await service.deleteSubscriber('list-1', 'jane@example.com')

      expect(result).toBe('true')

      expect(mock.history[0].body).toEqual({
        api_key: API_KEY,
        list_id: 'list-1',
        email: 'jane@example.com',
      })
    })

    it('throws when the subscriber does not exist', async () => {
      mock.onPost(`${ URL }/api/subscribers/delete.php`).reply('Subscriber does not exist')

      await expect(service.deleteSubscriber('list-1', 'ghost@example.com'))
        .rejects.toThrow('Sendy API error: Subscriber does not exist')
    })
  })

  describe('getSubscriptionStatus', () => {
    it('returns the trimmed plain-text status', async () => {
      mock.onPost(`${ URL }/api/subscribers/subscription-status.php`).reply('  Subscribed  ')

      const result = await service.getSubscriptionStatus('list-1', 'jane@example.com')

      expect(result).toBe('Subscribed')

      expect(mock.history[0].body).toEqual({
        api_key: API_KEY,
        list_id: 'list-1',
        email: 'jane@example.com',
      })
    })

    it('throws when the email is not in the list', async () => {
      mock.onPost(`${ URL }/api/subscribers/subscription-status.php`)
        .reply('Email does not exist in list')

      await expect(service.getSubscriptionStatus('list-1', 'ghost@example.com'))
        .rejects.toThrow('Sendy API error: Email does not exist in list')
    })
  })

  describe('getActiveSubscriberCount', () => {
    it('returns the plain-text count', async () => {
      mock.onPost(`${ URL }/api/subscribers/active-subscriber-count.php`).reply('1543')

      const result = await service.getActiveSubscriberCount('list-1')

      expect(result).toBe('1543')
      expect(mock.history[0].body).toEqual({ api_key: API_KEY, list_id: 'list-1' })
    })

    it('throws when the list id is missing', async () => {
      mock.onPost(`${ URL }/api/subscribers/active-subscriber-count.php`).reply('List ID not passed')

      await expect(service.getActiveSubscriberCount()).rejects.toThrow('Sendy API error: List ID not passed')
    })
  })

  // ── Campaigns ──

  describe('createCampaign', () => {
    it('creates a draft campaign with send_campaign set to 0', async () => {
      mock.onPost(`${ URL }/api/campaigns/create.php`).reply('Campaign created')

      const result = await service.createCampaign(
        'Acme',
        'news@example.com',
        'reply@example.com',
        'Hello',
        '<p>Hi</p>'
      )

      expect(result).toBe('Campaign created')

      expect(mock.history[0].body).toEqual({
        api_key: API_KEY,
        from_name: 'Acme',
        from_email: 'news@example.com',
        reply_to: 'reply@example.com',
        subject: 'Hello',
        html_text: '<p>Hi</p>',
        send_campaign: '0',
      })
    })

    it('sends every optional field and send_campaign=1 when sending immediately', async () => {
      mock.onPost(`${ URL }/api/campaigns/create.php`).reply('Campaign created and now sending')

      const result = await service.createCampaign(
        'Acme',
        'news@example.com',
        'reply@example.com',
        'Hello',
        '<p>Hi</p>',
        'Internal title',
        'Hi',
        '1,2',
        '9',
        'brand-1',
        'utm_source=sendy',
        true
      )

      expect(result).toBe('Campaign created and now sending')

      expect(mock.history[0].body).toEqual({
        api_key: API_KEY,
        from_name: 'Acme',
        from_email: 'news@example.com',
        reply_to: 'reply@example.com',
        subject: 'Hello',
        html_text: '<p>Hi</p>',
        title: 'Internal title',
        plain_text: 'Hi',
        list_ids: '1,2',
        segment_ids: '9',
        brand_id: 'brand-1',
        query_string: 'utm_source=sendy',
        send_campaign: '1',
      })
    })

    it('accepts the string "1" as a send flag', async () => {
      mock.onPost(`${ URL }/api/campaigns/create.php`).reply('Campaign created and now sending')

      await service.createCampaign('A', 'a@b.c', 'a@b.c', 'S', 'H', null, null, '1', null, null, null, '1')

      expect(mock.history[0].body).toMatchObject({ send_campaign: '1' })
    })

    it('throws when Sendy reports invalid list ids', async () => {
      mock.onPost(`${ URL }/api/campaigns/create.php`).reply('One or more list IDs are invalid')

      await expect(
        service.createCampaign('A', 'a@b.c', 'a@b.c', 'S', 'H', null, null, 'bad', null, null, null, true)
      ).rejects.toThrow('Sendy API error: One or more list IDs are invalid')
    })
  })

  // ── Brands ──

  describe('getBrands', () => {
    it('posts only the API key and returns the raw text', async () => {
      mock.onPost(`${ URL }/api/brands/get-brands.php`).reply('[{"id":"1","name":"My Brand"}]')

      const result = await service.getBrands()

      expect(result).toBe('[{"id":"1","name":"My Brand"}]')
      expect(mock.history[0].body).toEqual({ api_key: API_KEY })
    })

    it('throws when no brands exist', async () => {
      mock.onPost(`${ URL }/api/brands/get-brands.php`).reply('No brands found')

      await expect(service.getBrands()).rejects.toThrow('Sendy API error: No brands found')
    })
  })

  // ── Response normalization & error handling ──

  describe('response normalization', () => {
    it('decodes Buffer responses to text', async () => {
      mock.onPost(`${ URL }/api/brands/get-brands.php`).reply(Buffer.from('  brand-text  ', 'utf8'))

      await expect(service.getBrands()).resolves.toBe('brand-text')
    })

    it('reads the text property of object responses', async () => {
      mock.onPost(`${ URL }/api/brands/get-brands.php`).reply({ text: ' Subscribed ' })

      await expect(service.getBrands()).resolves.toBe('Subscribed')
    })

    it('stringifies object responses without a text property', async () => {
      mock.onPost(`${ URL }/api/brands/get-brands.php`).reply({ id: '1' })

      await expect(service.getBrands()).resolves.toBe('{"id":"1"}')
    })

    it('returns an empty string for an empty response', async () => {
      mock.onPost(`${ URL }/api/brands/get-brands.php`).reply(undefined)

      await expect(service.getBrands()).resolves.toBe('')
    })

    it('detects error markers case-insensitively', async () => {
      mock.onPost(`${ URL }/api/brands/get-brands.php`).reply('INVALID API KEY')

      await expect(service.getBrands()).rejects.toThrow('Sendy API error: INVALID API KEY')
    })
  })

  describe('transport error handling', () => {
    it('uses the plain-text error body when the request fails', async () => {
      mock.onPost(`${ URL }/subscribe`).replyWithError({
        message: 'Forbidden',
        status: 403,
        body: 'Invalid API key.',
      })

      await expect(service.subscribe('list-1', 'jane@example.com'))
        .rejects.toThrow('Sendy API error: Invalid API key.')
    })

    it('falls back to the error message when there is no body', async () => {
      mock.onPost(`${ URL }/subscribe`).replyWithError({ message: 'Network timeout' })

      await expect(service.subscribe('list-1', 'jane@example.com'))
        .rejects.toThrow('Sendy API error: Network timeout')
    })

    it('falls back to "Unknown error" when neither body nor message is present', async () => {
      mock.onPost(`${ URL }/subscribe`).replyWithError({ message: '' })

      await expect(service.subscribe('list-1', 'jane@example.com'))
        .rejects.toThrow('Sendy API error: Unknown error')
    })
  })
})
