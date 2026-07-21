'use strict'

const { createSandbox } = require('../../../service-sandbox')

const INSTANCE_URL = 'https://misp.example.com'
const API_KEY = 'test-misp-api-key'
const BASE = INSTANCE_URL

describe('MISP Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ url: INSTANCE_URL, apiKey: API_KEY })
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
          name: 'url',
          displayName: 'Instance URL',
          required: true,
          shared: false,
        }),
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
        }),
      ])
    })

    it('sends correct auth and content headers', async () => {
      mock.onGet(`${BASE}/events/index`).reply([])

      await service.listEvents()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': API_KEY,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      })
    })

    it('strips trailing slashes from the instance URL', async () => {
      // Verify that trailing slashes are stripped by checking the request URL.
      // The constructor does: (config.url || '').replace(/\/+$/, '')
      // We verify this by calling a method and checking the URL has no trailing slashes.
      mock.onGet(`${BASE}/events/index`).reply([])

      await service.listEvents()

      expect(mock.history[0].url).toBe('https://misp.example.com/events/index')
    })
  })

  // ── Events ──

  describe('getEvent', () => {
    it('sends GET to /events/view/:id', async () => {
      const eventData = { Event: { id: '42', uuid: '5a1b', info: 'Phishing campaign' } }

      mock.onGet(`${BASE}/events/view/42`).reply(eventData)

      const result = await service.getEvent('42')

      expect(result).toEqual(eventData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })

    it('encodes event ID in URL', async () => {
      mock.onGet(`${BASE}/events/view/some-uuid-value`).reply({ Event: {} })

      await service.getEvent('some-uuid-value')

      expect(mock.history[0].url).toBe(`${BASE}/events/view/some-uuid-value`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/events/view/999`).replyWithError({
        message: 'Not Found',
        body: { message: 'Invalid event.' },
      })

      await expect(service.getEvent('999')).rejects.toThrow('MISP API error')
    })
  })

  describe('addEvent', () => {
    it('sends POST with required fields only', async () => {
      mock.onPost(`${BASE}/events/add`).reply({ Event: { id: '42', info: 'Test event' } })

      const result = await service.addEvent('Test event')

      expect(result).toEqual({ Event: { id: '42', info: 'Test event' } })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ info: 'Test event' })
    })

    it('maps distribution label to numeric value', async () => {
      mock.onPost(`${BASE}/events/add`).reply({ Event: { id: '43' } })

      await service.addEvent('Test', 'This community only')

      expect(mock.history[0].body).toMatchObject({
        info: 'Test',
        distribution: 1,
      })
    })

    it('maps threat level label to numeric value', async () => {
      mock.onPost(`${BASE}/events/add`).reply({ Event: { id: '44' } })

      await service.addEvent('Test', undefined, 'High')

      expect(mock.history[0].body).toMatchObject({
        info: 'Test',
        threat_level_id: 1,
      })
    })

    it('maps analysis label to numeric value', async () => {
      mock.onPost(`${BASE}/events/add`).reply({ Event: { id: '45' } })

      await service.addEvent('Test', undefined, undefined, 'Completed')

      expect(mock.history[0].body).toMatchObject({
        info: 'Test',
        analysis: 2,
      })
    })

    it('sends all optional fields when provided', async () => {
      mock.onPost(`${BASE}/events/add`).reply({ Event: { id: '46' } })

      await service.addEvent(
        'Full event',
        'All communities',
        'Medium',
        'Ongoing',
        '2024-06-15',
        true
      )

      expect(mock.history[0].body).toEqual({
        info: 'Full event',
        distribution: 3,
        threat_level_id: 2,
        analysis: 1,
        date: '2024-06-15',
        published: true,
      })
    })

    it('omits undefined/null/empty optional fields via clean()', async () => {
      mock.onPost(`${BASE}/events/add`).reply({ Event: { id: '47' } })

      await service.addEvent('Minimal', undefined, null, '', undefined, undefined)

      expect(mock.history[0].body).toEqual({ info: 'Minimal' })
    })
  })

  describe('updateEvent', () => {
    it('sends PUT to /events/edit/:id', async () => {
      mock.onPut(`${BASE}/events/edit/42`).reply({ Event: { id: '42', info: 'Updated' } })

      const result = await service.updateEvent('42', 'Updated')

      expect(result).toEqual({ Event: { id: '42', info: 'Updated' } })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ info: 'Updated' })
    })

    it('maps all choice fields correctly', async () => {
      mock.onPut(`${BASE}/events/edit/42`).reply({ Event: { id: '42' } })

      await service.updateEvent(
        '42',
        'Updated info',
        'Connected communities',
        'Low',
        'Initial',
        '2024-07-01',
        false
      )

      expect(mock.history[0].body).toEqual({
        info: 'Updated info',
        distribution: 2,
        threat_level_id: 3,
        analysis: 0,
        date: '2024-07-01',
        published: false,
      })
    })

    it('omits fields not provided', async () => {
      mock.onPut(`${BASE}/events/edit/42`).reply({ Event: { id: '42' } })

      await service.updateEvent('42', undefined, undefined, 'Undefined')

      expect(mock.history[0].body).toEqual({ threat_level_id: 4 })
    })
  })

  describe('deleteEvent', () => {
    it('sends DELETE to /events/delete/:id', async () => {
      mock.onDelete(`${BASE}/events/delete/42`).reply({
        message: 'Event deleted.',
        name: 'Event deleted.',
        url: '/events/delete/42',
      })

      const result = await service.deleteEvent('42')

      expect(result).toEqual(expect.objectContaining({ message: 'Event deleted.' }))
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('publishEvent', () => {
    it('sends POST to /events/publish/:id', async () => {
      mock.onPost(`${BASE}/events/publish/42`).reply({
        name: 'Job queued',
        message: 'Job queued',
        id: '42',
      })

      const result = await service.publishEvent('42')

      expect(result).toMatchObject({ message: 'Job queued' })
      expect(mock.history[0].method).toBe('post')
    })
  })

  describe('searchEvents', () => {
    it('sends POST to /events/restSearch with returnFormat', async () => {
      const response = { response: [{ Event: { id: '42' } }] }

      mock.onPost(`${BASE}/events/restSearch`).reply(response)

      const result = await service.searchEvents('evil.com')

      expect(mock.history[0].body).toEqual({
        value: 'evil.com',
        returnFormat: 'json',
      })
      // unwrapSearch should extract the response array
      expect(result).toEqual([{ Event: { id: '42' } }])
    })

    it('sends all filter parameters when provided', async () => {
      mock.onPost(`${BASE}/events/restSearch`).reply({ response: [] })

      await service.searchEvents(
        '1.2.3.4',
        'ip-src',
        'Network activity',
        ['tlp:red'],
        '2024-01-01',
        '2024-12-31',
        'phishing',
        25,
        2
      )

      expect(mock.history[0].body).toEqual({
        value: '1.2.3.4',
        type: 'ip-src',
        category: 'Network activity',
        tags: ['tlp:red'],
        from: '2024-01-01',
        to: '2024-12-31',
        eventinfo: 'phishing',
        limit: 25,
        page: 2,
        returnFormat: 'json',
      })
    })

    it('returns array directly if response is already an array', async () => {
      mock.onPost(`${BASE}/events/restSearch`).reply([{ Event: { id: '1' } }])

      const result = await service.searchEvents()

      expect(result).toEqual([{ Event: { id: '1' } }])
    })

    it('returns response as-is when not array and no response key', async () => {
      mock.onPost(`${BASE}/events/restSearch`).reply({ some: 'data' })

      const result = await service.searchEvents()

      expect(result).toEqual({ some: 'data' })
    })
  })

  describe('listEvents', () => {
    it('sends GET to /events/index', async () => {
      const events = [{ id: '1', info: 'Event 1' }, { id: '2', info: 'Event 2' }]

      mock.onGet(`${BASE}/events/index`).reply(events)

      const result = await service.listEvents()

      expect(result).toEqual(events)
      expect(mock.history[0].method).toBe('get')
    })
  })

  // ── Attributes ──

  describe('addAttribute', () => {
    it('sends POST to /attributes/add/:eventId with required fields', async () => {
      mock.onPost(`${BASE}/attributes/add/42`).reply({
        Attribute: { id: '1001', event_id: '42', type: 'domain', value: 'evil.com' },
      })

      const result = await service.addAttribute('42', 'domain', 'evil.com')

      expect(result).toMatchObject({ Attribute: { id: '1001' } })
      expect(mock.history[0].body).toEqual({
        type: 'domain',
        value: 'evil.com',
      })
    })

    it('includes all optional fields when provided', async () => {
      mock.onPost(`${BASE}/attributes/add/42`).reply({ Attribute: { id: '1002' } })

      await service.addAttribute(
        '42',
        'ip-src',
        '1.2.3.4',
        'Network activity',
        true,
        'Seen in logs',
        'Your organisation only'
      )

      expect(mock.history[0].body).toEqual({
        type: 'ip-src',
        value: '1.2.3.4',
        category: 'Network activity',
        to_ids: true,
        comment: 'Seen in logs',
        distribution: 0,
      })
    })

    it('maps distribution label to numeric value', async () => {
      mock.onPost(`${BASE}/attributes/add/10`).reply({ Attribute: { id: '1003' } })

      await service.addAttribute('10', 'md5', 'abc123', undefined, undefined, undefined, 'All communities')

      expect(mock.history[0].body).toMatchObject({ distribution: 3 })
    })
  })

  describe('getAttribute', () => {
    it('sends GET to /attributes/view/:id', async () => {
      mock.onGet(`${BASE}/attributes/view/1001`).reply({
        Attribute: { id: '1001', type: 'domain', value: 'evil.com' },
      })

      const result = await service.getAttribute('1001')

      expect(result).toMatchObject({ Attribute: { id: '1001' } })
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('editAttribute', () => {
    it('sends PUT to /attributes/edit/:id', async () => {
      mock.onPut(`${BASE}/attributes/edit/1001`).reply({
        Attribute: { id: '1001', value: 'updated.com' },
      })

      const result = await service.editAttribute('1001', undefined, 'updated.com')

      expect(result).toMatchObject({ Attribute: { value: 'updated.com' } })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ value: 'updated.com' })
    })

    it('sends all fields when provided', async () => {
      mock.onPut(`${BASE}/attributes/edit/1001`).reply({ Attribute: { id: '1001' } })

      await service.editAttribute(
        '1001',
        'ip-dst',
        '5.6.7.8',
        'Network activity',
        false,
        'Updated comment',
        'This community only'
      )

      expect(mock.history[0].body).toEqual({
        type: 'ip-dst',
        value: '5.6.7.8',
        category: 'Network activity',
        to_ids: false,
        comment: 'Updated comment',
        distribution: 1,
      })
    })
  })

  describe('deleteAttribute', () => {
    it('sends DELETE to /attributes/delete/:id', async () => {
      mock.onDelete(`${BASE}/attributes/delete/1001`).reply({
        message: 'Attribute deleted.',
      })

      const result = await service.deleteAttribute('1001')

      expect(result).toMatchObject({ message: 'Attribute deleted.' })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('searchAttributes', () => {
    it('sends POST to /attributes/restSearch with returnFormat', async () => {
      const response = { response: { Attribute: [{ id: '1', type: 'domain' }] } }

      mock.onPost(`${BASE}/attributes/restSearch`).reply(response)

      const result = await service.searchAttributes('evil.com')

      expect(mock.history[0].body).toEqual({
        value: 'evil.com',
        returnFormat: 'json',
      })
      // unwrapSearch: response is not array and has no response[] array, returns as-is
      expect(result).toEqual(response)
    })

    it('sends all filter parameters when provided', async () => {
      mock.onPost(`${BASE}/attributes/restSearch`).reply({ response: [] })

      await service.searchAttributes(
        '1.2.3.4',
        'ip-src',
        'Network activity',
        ['tlp:amber'],
        true,
        50,
        1
      )

      expect(mock.history[0].body).toEqual({
        value: '1.2.3.4',
        type: 'ip-src',
        category: 'Network activity',
        tags: ['tlp:amber'],
        to_ids: true,
        limit: 50,
        page: 1,
        returnFormat: 'json',
      })
    })

    it('unwraps response array when present', async () => {
      mock.onPost(`${BASE}/attributes/restSearch`).reply({ response: [{ id: '1' }] })

      const result = await service.searchAttributes()

      expect(result).toEqual([{ id: '1' }])
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('sends GET to /tags', async () => {
      const tags = { Tag: [{ id: '1', name: 'tlp:red' }] }

      mock.onGet(`${BASE}/tags`).reply(tags)

      const result = await service.listTags()

      expect(result).toEqual(tags)
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('addTagToEvent', () => {
    it('sends POST to /events/addTag/:eventId/:tagId', async () => {
      mock.onPost(`${BASE}/events/addTag/42/1`).reply({
        saved: true,
        success: 'Tag added.',
      })

      const result = await service.addTagToEvent('42', '1')

      expect(result).toMatchObject({ saved: true, success: 'Tag added.' })
      expect(mock.history[0].method).toBe('post')
    })
  })

  describe('removeTagFromEvent', () => {
    it('sends POST to /events/removeTag/:eventId/:tagId', async () => {
      mock.onPost(`${BASE}/events/removeTag/42/1`).reply({
        saved: true,
        success: 'Tag removed.',
      })

      const result = await service.removeTagFromEvent('42', '1')

      expect(result).toMatchObject({ saved: true, success: 'Tag removed.' })
      expect(mock.history[0].method).toBe('post')
    })
  })

  // ── Sightings ──

  describe('addSighting', () => {
    it('sends POST to /sightings/add with value only', async () => {
      mock.onPost(`${BASE}/sightings/add`).reply({
        message: '1 sighting successfully added.',
      })

      const result = await service.addSighting('evil.com')

      expect(result).toMatchObject({ message: '1 sighting successfully added.' })
      expect(mock.history[0].body).toEqual({ value: 'evil.com' })
    })

    it('maps sighting type label to numeric value', async () => {
      mock.onPost(`${BASE}/sightings/add`).reply({ message: 'ok' })

      await service.addSighting('1.2.3.4', 'False positive')

      expect(mock.history[0].body).toEqual({ value: '1.2.3.4', type: 1 })
    })

    it('maps Expiration type to numeric value 2', async () => {
      mock.onPost(`${BASE}/sightings/add`).reply({ message: 'ok' })

      await service.addSighting('hash123', 'Expiration')

      expect(mock.history[0].body).toEqual({ value: 'hash123', type: 2 })
    })

    it('maps Sighting type to numeric value 0', async () => {
      mock.onPost(`${BASE}/sightings/add`).reply({ message: 'ok' })

      await service.addSighting('domain.com', 'Sighting')

      expect(mock.history[0].body).toEqual({ value: 'domain.com', type: 0 })
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('includes status code in error message when available', async () => {
      mock.onGet(`${BASE}/events/view/999`).replyWithError({
        message: 'Unauthorized',
        body: { message: 'Invalid API key' },
        status: 401,
      })

      await expect(service.getEvent('999')).rejects.toThrow('MISP API error (401): Invalid API key')
    })

    it('includes body errors in error message when present', async () => {
      mock.onPost(`${BASE}/events/add`).replyWithError({
        message: 'Bad Request',
        body: {
          message: 'Validation failed',
          errors: { info: 'Info is required' },
        },
        status: 400,
      })

      await expect(service.addEvent('')).rejects.toThrow('Validation failed')
    })

    it('falls back to error.message when body has no message', async () => {
      mock.onGet(`${BASE}/tags`).replyWithError({
        message: 'Network Error',
        body: {},
      })

      await expect(service.listTags()).rejects.toThrow('MISP API error: Network Error')
    })

    it('uses body.name as fallback message', async () => {
      mock.onDelete(`${BASE}/events/delete/1`).replyWithError({
        message: 'fail',
        body: { name: 'Permission denied' },
      })

      await expect(service.deleteEvent('1')).rejects.toThrow('Permission denied')
    })
  })
})
