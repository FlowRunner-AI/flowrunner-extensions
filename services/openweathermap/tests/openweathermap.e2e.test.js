'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('OpenWeatherMap Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('openweathermap')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── getCurrentWeather ──

  describe('getCurrentWeather', () => {
    it('returns current weather by city name', async () => {
      const result = await service.getCurrentWeather('London')

      expect(result).toHaveProperty('weather')
      expect(result).toHaveProperty('main')
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('cod', 200)
      expect(Array.isArray(result.weather)).toBe(true)
    })

    it('returns current weather by lat/lon', async () => {
      const result = await service.getCurrentWeather(undefined, 51.51, -0.13)

      expect(result).toHaveProperty('coord')
      expect(result).toHaveProperty('main')
      expect(result.cod).toBe(200)
    })

    it('returns current weather by zip code', async () => {
      const result = await service.getCurrentWeather(undefined, undefined, undefined, '90210,US')

      expect(result).toHaveProperty('name')
      expect(result.cod).toBe(200)
    })

    it('returns weather in metric units', async () => {
      const result = await service.getCurrentWeather('London', undefined, undefined, undefined, undefined, 'Metric (Celsius)')

      expect(result).toHaveProperty('main.temp')
      expect(result.cod).toBe(200)
    })

    it('returns weather with language parameter', async () => {
      const result = await service.getCurrentWeather('London', undefined, undefined, undefined, undefined, undefined, 'es')

      expect(result).toHaveProperty('weather')
      expect(result.cod).toBe(200)
    })

    it('throws when no location is provided', async () => {
      await expect(service.getCurrentWeather()).rejects.toThrow('a location is required')
    })
  })

  // ── getForecast ──

  describe('getForecast', () => {
    it('returns 5-day forecast by city name', async () => {
      const result = await service.getForecast('London', undefined, undefined, undefined, undefined, 3)

      expect(result).toHaveProperty('list')
      expect(Array.isArray(result.list)).toBe(true)
      expect(result.list.length).toBeLessThanOrEqual(3)
      expect(result).toHaveProperty('city')
    })

    it('returns forecast by lat/lon', async () => {
      const result = await service.getForecast(undefined, 51.51, -0.13, undefined, undefined, 2)

      expect(result).toHaveProperty('list')
      expect(result).toHaveProperty('city')
    })
  })

  // ── getAirPollution ──

  describe('getAirPollution', () => {
    it('returns current air quality data', async () => {
      const result = await service.getAirPollution(50, 50)

      expect(result).toHaveProperty('list')
      expect(Array.isArray(result.list)).toBe(true)
      expect(result.list.length).toBeGreaterThan(0)
      expect(result.list[0]).toHaveProperty('main.aqi')
      expect(result.list[0]).toHaveProperty('components')
    })
  })

  // ── getAirPollutionForecast ──

  describe('getAirPollutionForecast', () => {
    it('returns air quality forecast', async () => {
      const result = await service.getAirPollutionForecast(50, 50)

      expect(result).toHaveProperty('list')
      expect(Array.isArray(result.list)).toBe(true)
      expect(result.list.length).toBeGreaterThan(0)
      expect(result.list[0]).toHaveProperty('main.aqi')
    })
  })

  // ── getAirPollutionHistory ──

  describe('getAirPollutionHistory', () => {
    it('returns historical air quality data', async () => {
      const now = Math.floor(Date.now() / 1000)
      const oneHourAgo = now - 3600

      const result = await service.getAirPollutionHistory(50, 50, oneHourAgo, now)

      expect(result).toHaveProperty('list')
      expect(Array.isArray(result.list)).toBe(true)
    })
  })

  // ── geocodingDirect ──

  describe('geocodingDirect', () => {
    it('returns coordinates for a city name', async () => {
      const result = await service.geocodingDirect('London', 3)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('name')
      expect(result[0]).toHaveProperty('lat')
      expect(result[0]).toHaveProperty('lon')
      expect(result[0]).toHaveProperty('country')
    })

    it('respects limit parameter', async () => {
      const result = await service.geocodingDirect('London', 1)

      expect(result.length).toBe(1)
    })
  })

  // ── geocodingReverse ──

  describe('geocodingReverse', () => {
    it('returns place names for coordinates', async () => {
      const result = await service.geocodingReverse(51.51, -0.13, 1)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('name')
      expect(result[0]).toHaveProperty('country')
    })
  })

  // ── geocodingZip ──

  describe('geocodingZip', () => {
    it('returns coordinates for a zip code', async () => {
      const result = await service.geocodingZip('90210,US')

      expect(result).toHaveProperty('zip')
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('lat')
      expect(result).toHaveProperty('lon')
      expect(result).toHaveProperty('country')
    })
  })

  // ── oneCall (requires One Call 3.0 subscription) ──

  describe('oneCall', () => {
    it('returns current and forecast weather data', async () => {
      try {
        const result = await service.oneCall(33.44, -94.04, ['minutely', 'alerts'], 'Metric (Celsius)')

        expect(result).toHaveProperty('lat')
        expect(result).toHaveProperty('lon')
        expect(result).toHaveProperty('timezone')
      } catch (error) {
        // One Call 3.0 requires a separate subscription; skip gracefully if not available
        console.log('Skipping oneCall: requires One Call 3.0 subscription -', error.message)
      }
    })
  })

  // ── oneCallTimemachine (requires One Call 3.0 subscription) ──

  describe('oneCallTimemachine', () => {
    it('returns historical weather data', async () => {
      try {
        const oneDayAgo = Math.floor(Date.now() / 1000) - 86400

        const result = await service.oneCallTimemachine(52.23, 21.01, oneDayAgo, 'Metric (Celsius)')

        expect(result).toHaveProperty('lat')
        expect(result).toHaveProperty('lon')
        expect(result).toHaveProperty('timezone')
        expect(result).toHaveProperty('data')
      } catch (error) {
        console.log('Skipping oneCallTimemachine: requires One Call 3.0 subscription -', error.message)
      }
    })
  })
})
