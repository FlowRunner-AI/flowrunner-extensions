'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Philips Hue Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('philips-hue')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Bridge ──

  describe('getBridge', () => {
    it('returns the bridge resource', async () => {
      const result = await service.getBridge()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('id')
    })
  })

  // ── Lights ──

  describe('getLights', () => {
    it('returns the lights known to the bridge', async () => {
      const result = await service.getLights()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getLightsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getLightsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })

    it('filters items by search text', async () => {
      const result = await service.getLightsDictionary({ search: 'zzz-no-such-light-zzz' })

      expect(result.items).toEqual([])
    })
  })

  describe('getLight', () => {
    it('returns a single light', async () => {
      const lights = await service.getLights()

      if (!lights.length) {
        console.log('Skipping getLight: the bridge reports no lights')

        return
      }

      const result = await service.getLight(lights[0].id)

      expect(Array.isArray(result)).toBe(true)
      expect(result[0]).toHaveProperty('id', lights[0].id)
    })
  })

  describe('setLightState', () => {
    it('turns a light on and restores its previous state', async () => {
      const { lightId } = testValues

      if (!lightId) {
        console.log('Skipping setLightState: testValues.lightId not set')

        return
      }

      const [before] = await service.getLight(lightId)
      const wasOn = before && before.on ? before.on.on : false

      const result = await service.setLightState(lightId, true, undefined, undefined, undefined, undefined, 400)

      expect(Array.isArray(result)).toBe(true)

      await service.setLightState(lightId, wasOn)
    })
  })

  // ── Grouped lights ──

  describe('getGroupedLights', () => {
    it('returns grouped lights', async () => {
      const result = await service.getGroupedLights()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('setGroupedLight', () => {
    it('applies a state to a grouped light', async () => {
      const { groupedLightId } = testValues

      if (!groupedLightId) {
        console.log('Skipping setGroupedLight: testValues.groupedLightId not set')

        return
      }

      const result = await service.setGroupedLight(groupedLightId, true, undefined, undefined, undefined, undefined, 400)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Rooms & zones ──

  describe('getRooms', () => {
    it('returns rooms', async () => {
      const result = await service.getRooms()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getRoom', () => {
    it('returns a single room', async () => {
      const rooms = await service.getRooms()

      if (!rooms.length) {
        console.log('Skipping getRoom: the bridge reports no rooms')

        return
      }

      const result = await service.getRoom(rooms[0].id)

      expect(result[0]).toHaveProperty('id', rooms[0].id)
    })
  })

  describe('getZones', () => {
    it('returns zones', async () => {
      const result = await service.getZones()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Scenes ──

  describe('getScenes', () => {
    it('returns scenes', async () => {
      const result = await service.getScenes()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('activateScene', () => {
    it('activates a scene', async () => {
      const { sceneId } = testValues

      if (!sceneId) {
        console.log('Skipping activateScene: testValues.sceneId not set')

        return
      }

      const result = await service.activateScene(sceneId)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Devices & sensors ──

  describe('devices and sensors', () => {
    it('returns devices', async () => {
      const result = await service.getDevices()

      expect(Array.isArray(result)).toBe(true)
    })

    it('returns motion sensors', async () => {
      const result = await service.getMotionSensors()

      expect(Array.isArray(result)).toBe(true)
    })

    it('returns temperature sensors', async () => {
      const result = await service.getTemperature()

      expect(Array.isArray(result)).toBe(true)
    })

    it('returns light level sensors', async () => {
      const result = await service.getLightLevel()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a wrapped error for an unknown light rid', async () => {
      await expect(service.getLight('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
        /Philips Hue API error/
      )
    })
  })
})
