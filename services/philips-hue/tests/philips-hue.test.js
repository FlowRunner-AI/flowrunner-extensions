'use strict'

const { createSandbox } = require('../../../service-sandbox')

const BRIDGE_IP = '192.168.1.2'
const APP_KEY = 'test-application-key'
const BASE = `https://${ BRIDGE_IP }/clip/v2/resource`

describe('Philips Hue Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ bridgeIp: BRIDGE_IP, applicationKey: APP_KEY })
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
    it('registers the bridge ip and application key config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'bridgeIp',
          displayName: 'Bridge IP Address',
          type: 'STRING',
          required: true,
          shared: false,
        }),
        expect.objectContaining({
          name: 'applicationKey',
          displayName: 'Application Key',
          type: 'STRING',
          required: true,
          shared: false,
        }),
      ])
    })

    it('reads the connection settings from the config', () => {
      expect(service.bridgeIp).toBe(BRIDGE_IP)
      expect(service.applicationKey).toBe(APP_KEY)
    })
  })

  // ── Lights ──

  describe('getLights', () => {
    it('unwraps the CLIP v2 data envelope and sends auth headers', async () => {
      const lights = [{ id: '3a9c', metadata: { name: 'Lamp' } }]

      mock.onGet(`${ BASE }/light`).reply({ errors: [], data: lights })

      const result = await service.getLights()

      expect(result).toEqual(lights)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')

      expect(mock.history[0].headers).toMatchObject({
        'hue-application-key': APP_KEY,
        'Content-Type': 'application/json',
      })

      expect(mock.history[0].query).toEqual({})
    })

    it('returns the raw response when there is no data envelope', async () => {
      mock.onGet(`${ BASE }/light`).reply([{ id: 'raw' }])

      const result = await service.getLights()

      expect(result).toEqual([{ id: 'raw' }])
    })

    it('throws when the response carries CLIP errors', async () => {
      mock.onGet(`${ BASE }/light`).reply({
        errors: [{ description: 'device not found' }],
        data: [],
      })

      await expect(service.getLights()).rejects.toThrow(
        'Philips Hue API error: device not found'
      )
    })

    it('stringifies CLIP errors that have no description', async () => {
      mock.onGet(`${ BASE }/light`).reply({ errors: [{ code: 7 }] })

      await expect(service.getLights()).rejects.toThrow('Philips Hue API error: {"code":7}')
    })

    it('extracts errors from the HTTP error body', async () => {
      mock.onGet(`${ BASE }/light`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { errors: [{ description: 'unauthorized user' }, { code: 3 }] },
      })

      await expect(service.getLights()).rejects.toThrow(
        'Philips Hue API error: unauthorized user; {"code":3}'
      )
    })

    it('falls back to the error body message', async () => {
      mock.onGet(`${ BASE }/light`).replyWithError({
        message: 'Bad Request',
        body: { message: 'malformed request' },
      })

      await expect(service.getLights()).rejects.toThrow('Philips Hue API error: malformed request')
    })

    it('falls back to the error message', async () => {
      mock.onGet(`${ BASE }/light`).replyWithError({ message: 'ECONNREFUSED' })

      await expect(service.getLights()).rejects.toThrow('Philips Hue API error: ECONNREFUSED')
    })
  })

  describe('getLight', () => {
    it('requests a single light by rid', async () => {
      mock.onGet(`${ BASE }/light/3a9c`).reply({ data: [{ id: '3a9c' }] })

      const result = await service.getLight('3a9c')

      expect(result).toEqual([{ id: '3a9c' }])
      expect(mock.history[0].url).toBe(`${ BASE }/light/3a9c`)
    })
  })

  describe('setLightState', () => {
    it('sends only the supplied fields', async () => {
      mock.onPut(`${ BASE }/light/3a9c`).reply({ data: [{ rid: '3a9c' }] })

      const result = await service.setLightState('3a9c', true, 80)

      expect(result).toEqual([{ rid: '3a9c' }])
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ on: { on: true }, dimming: { brightness: 80 } })
    })

    it('builds a full state body with color, temperature and duration', async () => {
      mock.onPut(`${ BASE }/light/3a9c`).reply({ data: [] })

      await service.setLightState('3a9c', false, '50', 0.3, 0.4, '366', '400')

      expect(mock.history[0].body).toEqual({
        on: { on: false },
        dimming: { brightness: 50 },
        color: { xy: { x: 0.3, y: 0.4 } },
        color_temperature: { mirek: 366 },
        dynamics: { duration: 400 },
      })
    })

    it('includes the color object when only one coordinate is supplied', async () => {
      mock.onPut(`${ BASE }/light/3a9c`).reply({ data: [] })

      await service.setLightState('3a9c', undefined, undefined, 0.3)

      expect(mock.history[0].body).toEqual({ color: { xy: { x: 0.3, y: NaN } } })
    })

    it('sends an empty body when no state fields are supplied', async () => {
      mock.onPut(`${ BASE }/light/3a9c`).reply({ data: [] })

      await service.setLightState('3a9c')

      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Grouped lights ──

  describe('getGroupedLights', () => {
    it('lists grouped lights', async () => {
      mock.onGet(`${ BASE }/grouped_light`).reply({ data: [{ id: '7d2e' }] })

      const result = await service.getGroupedLights()

      expect(result).toEqual([{ id: '7d2e' }])
    })
  })

  describe('setGroupedLight', () => {
    it('puts the state body to the grouped light resource', async () => {
      mock.onPut(`${ BASE }/grouped_light/7d2e`).reply({ data: [{ rid: '7d2e' }] })

      const result = await service.setGroupedLight('7d2e', true, 65, null, null, null, 400)

      expect(result).toEqual([{ rid: '7d2e' }])

      expect(mock.history[0].body).toEqual({
        on: { on: true },
        dimming: { brightness: 65 },
        dynamics: { duration: 400 },
      })
    })
  })

  // ── Rooms & zones ──

  describe('getRooms', () => {
    it('lists rooms', async () => {
      mock.onGet(`${ BASE }/room`).reply({ data: [{ id: '91af' }] })

      await expect(service.getRooms()).resolves.toEqual([{ id: '91af' }])
    })
  })

  describe('getRoom', () => {
    it('fetches a single room by rid', async () => {
      mock.onGet(`${ BASE }/room/91af`).reply({ data: [{ id: '91af' }] })

      await expect(service.getRoom('91af')).resolves.toEqual([{ id: '91af' }])
      expect(mock.history[0].url).toBe(`${ BASE }/room/91af`)
    })
  })

  describe('getZones', () => {
    it('lists zones', async () => {
      mock.onGet(`${ BASE }/zone`).reply({ data: [{ id: 'c40b' }] })

      await expect(service.getZones()).resolves.toEqual([{ id: 'c40b' }])
    })
  })

  // ── Scenes ──

  describe('getScenes', () => {
    it('lists scenes', async () => {
      mock.onGet(`${ BASE }/scene`).reply({ data: [{ id: '5e1f' }] })

      await expect(service.getScenes()).resolves.toEqual([{ id: '5e1f' }])
    })
  })

  describe('activateScene', () => {
    it('sends a recall active action', async () => {
      mock.onPut(`${ BASE }/scene/5e1f`).reply({ data: [{ rid: '5e1f' }] })

      const result = await service.activateScene('5e1f')

      expect(result).toEqual([{ rid: '5e1f' }])
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ recall: { action: 'active' } })
    })
  })

  // ── Devices & sensors ──

  describe('getDevices', () => {
    it('lists devices', async () => {
      mock.onGet(`${ BASE }/device`).reply({ data: [{ id: 'a1b2' }] })

      await expect(service.getDevices()).resolves.toEqual([{ id: 'a1b2' }])
    })
  })

  describe('getMotionSensors', () => {
    it('lists motion sensors', async () => {
      mock.onGet(`${ BASE }/motion`).reply({ data: [{ id: 'f0e1' }] })

      await expect(service.getMotionSensors()).resolves.toEqual([{ id: 'f0e1' }])
    })
  })

  describe('getTemperature', () => {
    it('lists temperature sensors', async () => {
      mock.onGet(`${ BASE }/temperature`).reply({ data: [{ id: 'b2c3' }] })

      await expect(service.getTemperature()).resolves.toEqual([{ id: 'b2c3' }])
    })
  })

  describe('getLightLevel', () => {
    it('lists light level sensors', async () => {
      mock.onGet(`${ BASE }/light_level`).reply({ data: [{ id: 'd4e5' }] })

      await expect(service.getLightLevel()).resolves.toEqual([{ id: 'd4e5' }])
    })
  })

  // ── Bridge ──

  describe('getBridge', () => {
    it('fetches the bridge resource', async () => {
      mock.onGet(`${ BASE }/bridge`).reply({ data: [{ id: 'e6f7', bridge_id: '0017' }] })

      await expect(service.getBridge()).resolves.toEqual([{ id: 'e6f7', bridge_id: '0017' }])
    })
  })

  // ── Dictionary ──

  describe('getLightsDictionary', () => {
    it('maps lights to dictionary items', async () => {
      mock.onGet(`${ BASE }/light`).reply({
        data: [{ id: '3a9c', metadata: { name: 'Living Room Lamp' } }],
      })

      const result = await service.getLightsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Living Room Lamp', value: '3a9c', note: 'light' }],
        cursor: null,
      })
    })

    it('falls back to the rid when there is no name', async () => {
      mock.onGet(`${ BASE }/light`).reply({ data: [{ id: '3a9c' }] })

      const result = await service.getLightsDictionary(null)

      expect(result.items).toEqual([{ label: '3a9c', value: '3a9c', note: 'light' }])
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${ BASE }/light`).reply({
        data: [
          { id: '1', metadata: { name: 'Kitchen' } },
          { id: '2', metadata: { name: 'Bedroom' } },
        ],
      })

      const result = await service.getLightsDictionary({ search: ' KITCH ' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('1')
    })

    it('returns an empty list when the payload is not an array', async () => {
      mock.onGet(`${ BASE }/light`).reply({ data: null })

      const result = await service.getLightsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})
