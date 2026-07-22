'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'u123456-test-api-key'
const BASE = 'https://api.uptimerobot.com/v2'

function parseBody(body) {
  return Object.fromEntries(new URLSearchParams(body))
}

describe('UptimeRobot Service', () => {
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
    it('registers the apiKey config item', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          type: 'STRING',
          required: true,
          shared: false,
        }),
      ])
    })
  })

  // ── Common request shape ──

  describe('request envelope', () => {
    it('always posts form-encoded api_key and format', async () => {
      mock.onPost(`${ BASE }/getAccountDetails`).reply({ stat: 'ok', account: { user_id: 1 } })

      await service.getAccountDetails()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/getAccountDetails`)

      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      })

      expect(parseBody(mock.history[0].body)).toEqual({ api_key: API_KEY, format: 'json' })
    })

    it('throws a wrapped error when the API replies stat=fail', async () => {
      mock.onPost(`${ BASE }/getAccountDetails`).reply({
        stat: 'fail',
        error: { type: 'invalid_parameter', message: 'api_key is invalid' },
      })

      await expect(service.getAccountDetails()).rejects.toThrow(
        'UptimeRobot API error: api_key is invalid'
      )
    })

    it('falls back to the error type when no message is present', async () => {
      mock.onPost(`${ BASE }/getAccountDetails`).reply({ stat: 'fail', error: { type: 'not_found' } })

      await expect(service.getAccountDetails()).rejects.toThrow('UptimeRobot API error: not_found')
    })

    it('falls back to "Unknown error" when the failure has no details', async () => {
      mock.onPost(`${ BASE }/getAccountDetails`).reply({ stat: 'fail' })

      await expect(service.getAccountDetails()).rejects.toThrow('UptimeRobot API error: Unknown error')
    })

    it('wraps HTTP transport errors using the response body message', async () => {
      mock.onPost(`${ BASE }/getAccountDetails`).replyWithError({
        message: 'Request failed',
        status: 401,
        body: { error: { message: 'Unauthorized' } },
      })

      await expect(service.getAccountDetails()).rejects.toThrow('UptimeRobot API error: Unauthorized')
    })

    it('wraps HTTP transport errors using body.message when nested error is absent', async () => {
      mock.onPost(`${ BASE }/getAccountDetails`).replyWithError({
        message: 'Request failed',
        body: { message: 'Server exploded' },
      })

      await expect(service.getAccountDetails()).rejects.toThrow('UptimeRobot API error: Server exploded')
    })

    it('wraps HTTP transport errors using error.message as last resort', async () => {
      mock.onPost(`${ BASE }/getAccountDetails`).replyWithError({ message: 'Network timeout' })

      await expect(service.getAccountDetails()).rejects.toThrow('UptimeRobot API error: Network timeout')
    })
  })

  // ── Monitors ──

  describe('getMonitors', () => {
    it('sends only the envelope when no filters are provided', async () => {
      mock.onPost(`${ BASE }/getMonitors`).reply({ stat: 'ok', monitors: [] })

      const result = await service.getMonitors()

      expect(result).toEqual({ stat: 'ok', monitors: [] })
      expect(parseBody(mock.history[0].body)).toEqual({ api_key: API_KEY, format: 'json' })
    })

    it('maps friendly type and status labels to dash-separated integers', async () => {
      mock.onPost(`${ BASE }/getMonitors`).reply({ stat: 'ok', monitors: [] })

      await service.getMonitors('1-2', 'google', ['HTTP(S)', 'Ping'], ['Up', 'Down'], true, true, 10, 25)

      expect(parseBody(mock.history[0].body)).toEqual({
        api_key: API_KEY,
        format: 'json',
        monitors: '1-2',
        search: 'google',
        types: '1-3',
        statuses: '2-9',
        logs: '1',
        response_times: '1',
        offset: '10',
        limit: '25',
      })
    })

    it('passes through unknown type values unchanged', async () => {
      mock.onPost(`${ BASE }/getMonitors`).reply({ stat: 'ok', monitors: [] })

      await service.getMonitors(undefined, undefined, [4, 'Unknown'])

      expect(parseBody(mock.history[0].body).types).toBe('4-Unknown')
    })

    it('omits list filters when given an empty array', async () => {
      mock.onPost(`${ BASE }/getMonitors`).reply({ stat: 'ok', monitors: [] })

      await service.getMonitors(undefined, undefined, [], [])

      expect(parseBody(mock.history[0].body)).toEqual({ api_key: API_KEY, format: 'json' })
    })

    it('omits list filters when every entry resolves to empty', async () => {
      mock.onPost(`${ BASE }/getMonitors`).reply({ stat: 'ok', monitors: [] })

      await service.getMonitors(undefined, undefined, ['', null])

      expect(parseBody(mock.history[0].body).types).toBeUndefined()
    })

    it('omits the logs flags when disabled', async () => {
      mock.onPost(`${ BASE }/getMonitors`).reply({ stat: 'ok', monitors: [] })

      await service.getMonitors(undefined, undefined, undefined, undefined, false, false)

      const body = parseBody(mock.history[0].body)

      expect(body.logs).toBeUndefined()
      expect(body.response_times).toBeUndefined()
    })
  })

  describe('createMonitor', () => {
    it('sends the mapped monitor type and required fields', async () => {
      mock.onPost(`${ BASE }/newMonitor`).reply({ stat: 'ok', monitor: { id: 1, status: 1 } })

      const result = await service.createMonitor('My Site', 'https://example.com', 'HTTP(S)')

      expect(result).toEqual({ stat: 'ok', monitor: { id: 1, status: 1 } })
      expect(mock.history[0].url).toBe(`${ BASE }/newMonitor`)

      expect(parseBody(mock.history[0].body)).toEqual({
        api_key: API_KEY,
        format: 'json',
        friendly_name: 'My Site',
        url: 'https://example.com',
        type: '1',
      })
    })

    it('sends keyword, port, interval and alert contacts when provided', async () => {
      mock.onPost(`${ BASE }/newMonitor`).reply({ stat: 'ok', monitor: { id: 2 } })

      await service.createMonitor(
        'Keyword Check',
        'https://example.com',
        'Keyword',
        300,
        'Not Exists',
        'error',
        8080,
        '457_0_0-373_5_0'
      )

      expect(parseBody(mock.history[0].body)).toEqual({
        api_key: API_KEY,
        format: 'json',
        friendly_name: 'Keyword Check',
        url: 'https://example.com',
        type: '2',
        interval: '300',
        keyword_type: '2',
        keyword_value: 'error',
        port: '8080',
        alert_contacts: '457_0_0-373_5_0',
      })
    })

    it('passes a raw numeric type through untouched', async () => {
      mock.onPost(`${ BASE }/newMonitor`).reply({ stat: 'ok', monitor: { id: 3 } })

      await service.createMonitor('Ping', 'example.com', 3)

      expect(parseBody(mock.history[0].body).type).toBe('3')
    })

    it('throws when the API rejects the monitor', async () => {
      mock.onPost(`${ BASE }/newMonitor`).reply({
        stat: 'fail',
        error: { type: 'already_exists', message: 'Monitor already exists' },
      })

      await expect(service.createMonitor('X', 'https://x.com', 'HTTP(S)')).rejects.toThrow(
        'UptimeRobot API error: Monitor already exists'
      )
    })
  })

  describe('editMonitor', () => {
    it('sends only the provided fields', async () => {
      mock.onPost(`${ BASE }/editMonitor`).reply({ stat: 'ok', monitor: { id: 777 } })

      await service.editMonitor('777', 'Renamed')

      expect(parseBody(mock.history[0].body)).toEqual({
        api_key: API_KEY,
        format: 'json',
        id: '777',
        friendly_name: 'Renamed',
      })
    })

    it('maps the Paused status to 0', async () => {
      mock.onPost(`${ BASE }/editMonitor`).reply({ stat: 'ok', monitor: { id: 777 } })

      await service.editMonitor('777', undefined, undefined, undefined, 'Paused')

      // 0 is stripped by clean() because it is not undefined/null/'' — it is kept.
      expect(parseBody(mock.history[0].body).status).toBe('0')
    })

    it('maps the Resumed status to 1 and forwards keyword fields', async () => {
      mock.onPost(`${ BASE }/editMonitor`).reply({ stat: 'ok', monitor: { id: 777 } })

      await service.editMonitor('777', 'Name', 'https://new.com', 600, 'Resumed', 'Exists', 'ok', '457_0_0')

      expect(parseBody(mock.history[0].body)).toEqual({
        api_key: API_KEY,
        format: 'json',
        id: '777',
        friendly_name: 'Name',
        url: 'https://new.com',
        interval: '600',
        status: '1',
        keyword_type: '1',
        keyword_value: 'ok',
        alert_contacts: '457_0_0',
      })
    })
  })

  describe('deleteMonitor', () => {
    it('posts the monitor id to /deleteMonitor', async () => {
      mock.onPost(`${ BASE }/deleteMonitor`).reply({ stat: 'ok', monitor: { id: 777 } })

      const result = await service.deleteMonitor('777')

      expect(result).toEqual({ stat: 'ok', monitor: { id: 777 } })
      expect(parseBody(mock.history[0].body)).toEqual({ api_key: API_KEY, format: 'json', id: '777' })
    })
  })

  describe('resetMonitor', () => {
    it('posts the monitor id to /resetMonitor', async () => {
      mock.onPost(`${ BASE }/resetMonitor`).reply({ stat: 'ok', monitor: { id: 777 } })

      await service.resetMonitor('777')

      expect(mock.history[0].url).toBe(`${ BASE }/resetMonitor`)
      expect(parseBody(mock.history[0].body).id).toBe('777')
    })
  })

  // ── Alert contacts ──

  describe('getAlertContacts', () => {
    it('sends no filters by default', async () => {
      mock.onPost(`${ BASE }/getAlertContacts`).reply({ stat: 'ok', alert_contacts: [] })

      await service.getAlertContacts()

      expect(parseBody(mock.history[0].body)).toEqual({ api_key: API_KEY, format: 'json' })
    })

    it('sends ids, offset and limit', async () => {
      mock.onPost(`${ BASE }/getAlertContacts`).reply({ stat: 'ok', alert_contacts: [] })

      await service.getAlertContacts('236-1782', 5, 10)

      expect(parseBody(mock.history[0].body)).toEqual({
        api_key: API_KEY,
        format: 'json',
        alert_contacts: '236-1782',
        offset: '5',
        limit: '10',
      })
    })
  })

  describe('createAlertContact', () => {
    it('maps the friendly contact type to its integer', async () => {
      mock.onPost(`${ BASE }/newAlertContact`).reply({ stat: 'ok', alertcontact: { id: '486' } })

      await service.createAlertContact('E-mail', 'john@example.com', 'John Doe')

      expect(mock.history[0].url).toBe(`${ BASE }/newAlertContact`)

      expect(parseBody(mock.history[0].body)).toEqual({
        api_key: API_KEY,
        format: 'json',
        type: '2',
        value: 'john@example.com',
        friendly_name: 'John Doe',
      })
    })

    it('maps the Slack contact type', async () => {
      mock.onPost(`${ BASE }/newAlertContact`).reply({ stat: 'ok', alertcontact: { id: '487' } })

      await service.createAlertContact('Slack', 'https://hooks.slack.com/x', 'Slack')

      expect(parseBody(mock.history[0].body).type).toBe('11')
    })
  })

  describe('deleteAlertContact', () => {
    it('posts the contact id', async () => {
      mock.onPost(`${ BASE }/deleteAlertContact`).reply({ stat: 'ok', alert_contact: { id: '486' } })

      await service.deleteAlertContact('486')

      expect(parseBody(mock.history[0].body).id).toBe('486')
    })
  })

  // ── Maintenance windows ──

  describe('getMWindows', () => {
    it('sends ids, offset and limit', async () => {
      mock.onPost(`${ BASE }/getMWindows`).reply({ stat: 'ok', mwindows: [] })

      await service.getMWindows('345-2986', 0, 50)

      expect(parseBody(mock.history[0].body)).toEqual({
        api_key: API_KEY,
        format: 'json',
        mwindows: '345-2986',
        offset: '0',
        limit: '50',
      })
    })
  })

  describe('createMWindow', () => {
    it('maps the window type and sends the schedule', async () => {
      mock.onPost(`${ BASE }/newMWindow`).reply({ stat: 'ok', mwindow: { id: 1234 } })

      await service.createMWindow('Weekly', 'Backup', '03:00', 60, '1-3')

      expect(mock.history[0].url).toBe(`${ BASE }/newMWindow`)

      expect(parseBody(mock.history[0].body)).toEqual({
        api_key: API_KEY,
        format: 'json',
        type: '3',
        friendly_name: 'Backup',
        start_time: '03:00',
        duration: '60',
        value: '1-3',
      })
    })

    it('omits the value for a Once window', async () => {
      mock.onPost(`${ BASE }/newMWindow`).reply({ stat: 'ok', mwindow: { id: 1235 } })

      await service.createMWindow('Once', 'One-off', '1720958400', 30)

      const body = parseBody(mock.history[0].body)

      expect(body.type).toBe('1')
      expect(body.value).toBeUndefined()
    })
  })

  describe('deleteMWindow', () => {
    it('posts the maintenance window id', async () => {
      mock.onPost(`${ BASE }/deleteMWindow`).reply({ stat: 'ok', mwindow: { id: 1234 } })

      await service.deleteMWindow(1234)

      expect(parseBody(mock.history[0].body).id).toBe('1234')
    })
  })

  // ── Public status pages ──

  describe('getPSPs', () => {
    it('sends ids, offset and limit', async () => {
      mock.onPost(`${ BASE }/getPSPs`).reply({ stat: 'ok', psps: [] })

      await service.getPSPs('1780', 0, 50)

      expect(parseBody(mock.history[0].body)).toEqual({
        api_key: API_KEY,
        format: 'json',
        psps: '1780',
        offset: '0',
        limit: '50',
      })
    })
  })

  describe('createPSP', () => {
    it('maps the sort option and sends the page definition', async () => {
      mock.onPost(`${ BASE }/newPSP`).reply({ stat: 'ok', psp: { id: 1780 } })

      await service.createPSP('Public Page', '0', 'secret', 'Status (Up-Down-Paused)')

      expect(mock.history[0].url).toBe(`${ BASE }/newPSP`)

      expect(parseBody(mock.history[0].body)).toEqual({
        api_key: API_KEY,
        format: 'json',
        friendly_name: 'Public Page',
        monitors: '0',
        password: 'secret',
        sort: '3',
      })
    })

    it('omits password and sort when not provided', async () => {
      mock.onPost(`${ BASE }/newPSP`).reply({ stat: 'ok', psp: { id: 1781 } })

      await service.createPSP('Page', '15830-32696')

      expect(parseBody(mock.history[0].body)).toEqual({
        api_key: API_KEY,
        format: 'json',
        friendly_name: 'Page',
        monitors: '15830-32696',
      })
    })
  })

  describe('deletePSP', () => {
    it('posts the psp id', async () => {
      mock.onPost(`${ BASE }/deletePSP`).reply({ stat: 'ok', psp: { id: 1780 } })

      await service.deletePSP(1780)

      expect(parseBody(mock.history[0].body).id).toBe('1780')
    })
  })

  // ── Account ──

  describe('getAccountDetails', () => {
    it('returns the account payload', async () => {
      mock.onPost(`${ BASE }/getAccountDetails`).reply({
        stat: 'ok',
        account: { email: 'test@domain.com', monitor_limit: 50 },
      })

      const result = await service.getAccountDetails()

      expect(result.account).toMatchObject({ email: 'test@domain.com', monitor_limit: 50 })
    })
  })

  // ── Dictionaries ──

  describe('getAlertContactsDictionary', () => {
    it('maps contacts to dictionary items', async () => {
      mock.onPost(`${ BASE }/getAlertContacts`).reply({
        stat: 'ok',
        pagination: { offset: 0, limit: 50, total: 1 },
        alert_contacts: [{ id: '236', friendly_name: 'John Doe', value: 'john@example.com' }],
      })

      const result = await service.getAlertContactsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'John Doe', value: '236', note: 'john@example.com' }],
        cursor: undefined,
      })

      expect(parseBody(mock.history[0].body)).toMatchObject({ offset: '0', limit: '50' })
    })

    it('handles a null payload', async () => {
      mock.onPost(`${ BASE }/getAlertContacts`).reply({ stat: 'ok', alert_contacts: [] })

      const result = await service.getAlertContactsDictionary(null)

      expect(result).toEqual({ items: [], cursor: undefined })
    })

    it('filters contacts case-insensitively by name or value', async () => {
      mock.onPost(`${ BASE }/getAlertContacts`).reply({
        stat: 'ok',
        alert_contacts: [
          { id: '1', friendly_name: 'John Doe', value: 'john@example.com' },
          { id: '2', friendly_name: 'Jane Roe', value: 'jane@example.com' },
        ],
      })

      const result = await service.getAlertContactsDictionary({ search: 'JANE@' })

      expect(result.items).toEqual([{ label: 'Jane Roe', value: '2', note: 'jane@example.com' }])
    })

    it('falls back to value then id for the label', async () => {
      mock.onPost(`${ BASE }/getAlertContacts`).reply({
        stat: 'ok',
        alert_contacts: [{ id: '1', value: 'sms:12345' }, { id: '2' }],
      })

      const result = await service.getAlertContactsDictionary({})

      expect(result.items).toEqual([
        { label: 'sms:12345', value: '1', note: 'sms:12345' },
        { label: '2', value: '2', note: undefined },
      ])
    })

    it('returns a next cursor while more records remain', async () => {
      mock.onPost(`${ BASE }/getAlertContacts`).reply({
        stat: 'ok',
        pagination: { offset: 0, limit: 50, total: 120 },
        alert_contacts: [{ id: '1', friendly_name: 'A', value: 'a@b.c' }],
      })

      const result = await service.getAlertContactsDictionary({ cursor: '50' })

      expect(result.cursor).toBe('100')
      expect(parseBody(mock.history[0].body).offset).toBe('50')
    })

    it('handles a missing alert_contacts array', async () => {
      mock.onPost(`${ BASE }/getAlertContacts`).reply({ stat: 'ok' })

      const result = await service.getAlertContactsDictionary({})

      expect(result).toEqual({ items: [], cursor: undefined })
    })
  })

  describe('getMonitorsDictionary', () => {
    it('maps monitors to dictionary items and forwards the search term', async () => {
      mock.onPost(`${ BASE }/getMonitors`).reply({
        stat: 'ok',
        pagination: { offset: 0, limit: 50, total: 1 },
        monitors: [{ id: 777749809, friendly_name: 'Google', url: 'http://www.google.com' }],
      })

      const result = await service.getMonitorsDictionary({ search: 'goo' })

      expect(result).toEqual({
        items: [{ label: 'Google', value: '777749809', note: 'http://www.google.com' }],
        cursor: undefined,
      })

      expect(parseBody(mock.history[0].body)).toMatchObject({ search: 'goo', offset: '0', limit: '50' })
    })

    it('handles a null payload', async () => {
      mock.onPost(`${ BASE }/getMonitors`).reply({ stat: 'ok', monitors: [] })

      const result = await service.getMonitorsDictionary(null)

      expect(result).toEqual({ items: [], cursor: undefined })
    })

    it('falls back to url then id for the label', async () => {
      mock.onPost(`${ BASE }/getMonitors`).reply({
        stat: 'ok',
        monitors: [{ id: 1, url: 'http://a.com' }, { id: 2 }],
      })

      const result = await service.getMonitorsDictionary({})

      expect(result.items).toEqual([
        { label: 'http://a.com', value: '1', note: 'http://a.com' },
        { label: '2', value: '2', note: undefined },
      ])
    })

    it('returns a next cursor while more records remain', async () => {
      mock.onPost(`${ BASE }/getMonitors`).reply({
        stat: 'ok',
        pagination: { total: 200 },
        monitors: [{ id: 1, friendly_name: 'A' }],
      })

      const result = await service.getMonitorsDictionary({ cursor: '100' })

      expect(result.cursor).toBe('150')
    })

    it('propagates API failures', async () => {
      mock.onPost(`${ BASE }/getMonitors`).reply({ stat: 'fail', error: { message: 'bad key' } })

      await expect(service.getMonitorsDictionary({})).rejects.toThrow('UptimeRobot API error: bad key')
    })
  })
})
