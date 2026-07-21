'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.openweathermap.org'

describe('OpenWeatherMap Service', () => {
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
        ])
      )
    })
  })

  // ── getCurrentWeather ──

  describe('getCurrentWeather', () => {
    const url = `${BASE}/data/2.5/weather`
    const weatherResponse = {
      coord: { lon: -0.13, lat: 51.51 },
      weather: [{ id: 800, main: 'Clear', description: 'clear sky', icon: '01d' }],
      main: { temp: 290, feels_like: 289, pressure: 1013, humidity: 60 },
      name: 'London',
      cod: 200,
    }

    it('sends request with city name', async () => {
      mock.onGet(url).reply(weatherResponse)

      const result = await service.getCurrentWeather('London')

      expect(result).toEqual(weatherResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ q: 'London', appid: API_KEY })
    })

    it('sends request with latitude and longitude', async () => {
      mock.onGet(url).reply(weatherResponse)

      await service.getCurrentWeather(undefined, 51.51, -0.13)

      expect(mock.history[0].query).toMatchObject({ lat: 51.51, lon: -0.13, appid: API_KEY })
      expect(mock.history[0].query.q).toBeUndefined()
    })

    it('sends request with zip code', async () => {
      mock.onGet(url).reply(weatherResponse)

      await service.getCurrentWeather(undefined, undefined, undefined, '90210,US')

      expect(mock.history[0].query).toMatchObject({ zip: '90210,US', appid: API_KEY })
    })

    it('sends request with city ID', async () => {
      mock.onGet(url).reply(weatherResponse)

      await service.getCurrentWeather(undefined, undefined, undefined, undefined, '2643743')

      expect(mock.history[0].query).toMatchObject({ id: '2643743', appid: API_KEY })
    })

    it('resolves units choice label to API value', async () => {
      mock.onGet(url).reply(weatherResponse)

      await service.getCurrentWeather('London', undefined, undefined, undefined, undefined, 'Metric (Celsius)')

      expect(mock.history[0].query).toMatchObject({ units: 'metric' })
    })

    it('passes language parameter', async () => {
      mock.onGet(url).reply(weatherResponse)

      await service.getCurrentWeather('London', undefined, undefined, undefined, undefined, undefined, 'es')

      expect(mock.history[0].query).toMatchObject({ lang: 'es' })
    })

    it('omits optional fields when not provided', async () => {
      mock.onGet(url).reply(weatherResponse)

      await service.getCurrentWeather('London')

      const query = mock.history[0].query
      expect(query.units).toBeUndefined()
      expect(query.lang).toBeUndefined()
    })

    it('city takes precedence over lat/lon', async () => {
      mock.onGet(url).reply(weatherResponse)

      await service.getCurrentWeather('London', 51.51, -0.13)

      expect(mock.history[0].query).toMatchObject({ q: 'London' })
      expect(mock.history[0].query.lat).toBeUndefined()
      expect(mock.history[0].query.lon).toBeUndefined()
    })

    it('throws when no location is provided', async () => {
      await expect(service.getCurrentWeather()).rejects.toThrow('a location is required')
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({
        message: 'Invalid API key',
        body: { cod: 401, message: 'Invalid API key. Please see https://openweathermap.org/faq' },
      })

      await expect(service.getCurrentWeather('London')).rejects.toThrow('OpenWeatherMap API error')
    })
  })

  // ── getForecast ──

  describe('getForecast', () => {
    const url = `${BASE}/data/2.5/forecast`
    const forecastResponse = {
      cod: '200',
      cnt: 2,
      list: [
        { dt: 1661871600, main: { temp: 296.76 } },
        { dt: 1661882400, main: { temp: 295.12 } },
      ],
      city: { id: 3163858, name: 'Zocca' },
    }

    it('sends request with city name and defaults', async () => {
      mock.onGet(url).reply(forecastResponse)

      const result = await service.getForecast('Zocca')

      expect(result).toEqual(forecastResponse)
      expect(mock.history[0].query).toMatchObject({ q: 'Zocca', appid: API_KEY })
    })

    it('passes count parameter', async () => {
      mock.onGet(url).reply(forecastResponse)

      await service.getForecast('Zocca', undefined, undefined, undefined, undefined, 5)

      expect(mock.history[0].query).toMatchObject({ cnt: 5 })
    })

    it('passes units and language', async () => {
      mock.onGet(url).reply(forecastResponse)

      await service.getForecast('Zocca', undefined, undefined, undefined, undefined, undefined, 'Imperial (Fahrenheit)', 'fr')

      expect(mock.history[0].query).toMatchObject({ units: 'imperial', lang: 'fr' })
    })

    it('sends request with lat/lon', async () => {
      mock.onGet(url).reply(forecastResponse)

      await service.getForecast(undefined, 44.34, 10.99)

      expect(mock.history[0].query).toMatchObject({ lat: 44.34, lon: 10.99 })
    })

    it('throws when no location is provided', async () => {
      await expect(service.getForecast()).rejects.toThrow('a location is required')
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({
        message: 'Not Found',
        body: { cod: '404', message: 'city not found' },
      })

      await expect(service.getForecast('NonexistentCity')).rejects.toThrow('OpenWeatherMap API error')
    })
  })

  // ── getAirPollution ──

  describe('getAirPollution', () => {
    const url = `${BASE}/data/2.5/air_pollution`
    const airResponse = {
      coord: { lon: 50, lat: 50 },
      list: [{ main: { aqi: 1 }, components: { co: 201.94, no: 0.019 }, dt: 1605182400 }],
    }

    it('sends request with lat and lon', async () => {
      mock.onGet(url).reply(airResponse)

      const result = await service.getAirPollution(50, 50)

      expect(result).toEqual(airResponse)
      expect(mock.history[0].query).toMatchObject({ lat: 50, lon: 50, appid: API_KEY })
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Unauthorized' })

      await expect(service.getAirPollution(50, 50)).rejects.toThrow('OpenWeatherMap API error')
    })
  })

  // ── getAirPollutionForecast ──

  describe('getAirPollutionForecast', () => {
    const url = `${BASE}/data/2.5/air_pollution/forecast`
    const forecastResponse = {
      coord: { lon: 50, lat: 50 },
      list: [{ main: { aqi: 2 }, components: { co: 203.6 }, dt: 1605892800 }],
    }

    it('sends request with lat and lon', async () => {
      mock.onGet(url).reply(forecastResponse)

      const result = await service.getAirPollutionForecast(50, 50)

      expect(result).toEqual(forecastResponse)
      expect(mock.history[0].query).toMatchObject({ lat: 50, lon: 50, appid: API_KEY })
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Server error' })

      await expect(service.getAirPollutionForecast(50, 50)).rejects.toThrow('OpenWeatherMap API error')
    })
  })

  // ── getAirPollutionHistory ──

  describe('getAirPollutionHistory', () => {
    const url = `${BASE}/data/2.5/air_pollution/history`
    const historyResponse = {
      coord: { lon: 50, lat: 50 },
      list: [{ main: { aqi: 1 }, components: { co: 201.94 }, dt: 1606223802 }],
    }

    it('sends request with lat, lon, start, and end', async () => {
      mock.onGet(url).reply(historyResponse)

      const result = await service.getAirPollutionHistory(50, 50, 1606223802, 1606310202)

      expect(result).toEqual(historyResponse)
      expect(mock.history[0].query).toMatchObject({
        lat: 50,
        lon: 50,
        start: 1606223802,
        end: 1606310202,
        appid: API_KEY,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Bad Request' })

      await expect(service.getAirPollutionHistory(50, 50, 100, 200)).rejects.toThrow('OpenWeatherMap API error')
    })
  })

  // ── geocodingDirect ──

  describe('geocodingDirect', () => {
    const url = `${BASE}/geo/1.0/direct`
    const geoResponse = [
      { name: 'London', lat: 51.5073219, lon: -0.1276474, country: 'GB', state: 'England' },
    ]

    it('sends request with query', async () => {
      mock.onGet(url).reply(geoResponse)

      const result = await service.geocodingDirect('London')

      expect(result).toEqual(geoResponse)
      expect(mock.history[0].query).toMatchObject({ q: 'London', appid: API_KEY })
    })

    it('passes limit parameter', async () => {
      mock.onGet(url).reply(geoResponse)

      await service.geocodingDirect('London', 3)

      expect(mock.history[0].query).toMatchObject({ q: 'London', limit: 3 })
    })

    it('omits limit when not provided', async () => {
      mock.onGet(url).reply(geoResponse)

      await service.geocodingDirect('London')

      expect(mock.history[0].query.limit).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Unauthorized' })

      await expect(service.geocodingDirect('London')).rejects.toThrow('OpenWeatherMap API error')
    })
  })

  // ── geocodingReverse ──

  describe('geocodingReverse', () => {
    const url = `${BASE}/geo/1.0/reverse`
    const reverseResponse = [
      { name: 'London', lat: 51.5073219, lon: -0.1276474, country: 'GB' },
    ]

    it('sends request with lat, lon', async () => {
      mock.onGet(url).reply(reverseResponse)

      const result = await service.geocodingReverse(51.51, -0.13)

      expect(result).toEqual(reverseResponse)
      expect(mock.history[0].query).toMatchObject({ lat: 51.51, lon: -0.13, appid: API_KEY })
    })

    it('passes limit parameter', async () => {
      mock.onGet(url).reply(reverseResponse)

      await service.geocodingReverse(51.51, -0.13, 2)

      expect(mock.history[0].query).toMatchObject({ limit: 2 })
    })

    it('omits limit when not provided', async () => {
      mock.onGet(url).reply(reverseResponse)

      await service.geocodingReverse(51.51, -0.13)

      expect(mock.history[0].query.limit).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Error' })

      await expect(service.geocodingReverse(51.51, -0.13)).rejects.toThrow('OpenWeatherMap API error')
    })
  })

  // ── geocodingZip ──

  describe('geocodingZip', () => {
    const url = `${BASE}/geo/1.0/zip`
    const zipResponse = { zip: '90210', name: 'Beverly Hills', lat: 34.0901, lon: -118.4065, country: 'US' }

    it('sends request with zip code', async () => {
      mock.onGet(url).reply(zipResponse)

      const result = await service.geocodingZip('90210')

      expect(result).toEqual(zipResponse)
      expect(mock.history[0].query).toMatchObject({ zip: '90210', appid: API_KEY })
    })

    it('supports zip with country code', async () => {
      mock.onGet(url).reply(zipResponse)

      await service.geocodingZip('90210,US')

      expect(mock.history[0].query).toMatchObject({ zip: '90210,US' })
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'not found' })

      await expect(service.geocodingZip('00000')).rejects.toThrow('OpenWeatherMap API error')
    })
  })

  // ── oneCall ──

  describe('oneCall', () => {
    const url = `${BASE}/data/3.0/onecall`
    const oneCallResponse = {
      lat: 33.44,
      lon: -94.04,
      timezone: 'America/Chicago',
      current: { dt: 1684929490, temp: 292.55, weather: [{ id: 803, main: 'Clouds' }] },
    }

    it('sends request with lat and lon', async () => {
      mock.onGet(url).reply(oneCallResponse)

      const result = await service.oneCall(33.44, -94.04)

      expect(result).toEqual(oneCallResponse)
      expect(mock.history[0].query).toMatchObject({ lat: 33.44, lon: -94.04, appid: API_KEY })
    })

    it('joins exclude array into comma-separated string', async () => {
      mock.onGet(url).reply(oneCallResponse)

      await service.oneCall(33.44, -94.04, ['minutely', 'hourly'])

      expect(mock.history[0].query).toMatchObject({ exclude: 'minutely,hourly' })
    })

    it('omits exclude when array is empty', async () => {
      mock.onGet(url).reply(oneCallResponse)

      await service.oneCall(33.44, -94.04, [])

      expect(mock.history[0].query.exclude).toBeUndefined()
    })

    it('omits exclude when not provided', async () => {
      mock.onGet(url).reply(oneCallResponse)

      await service.oneCall(33.44, -94.04)

      expect(mock.history[0].query.exclude).toBeUndefined()
    })

    it('resolves units and passes language', async () => {
      mock.onGet(url).reply(oneCallResponse)

      await service.oneCall(33.44, -94.04, undefined, 'Metric (Celsius)', 'de')

      expect(mock.history[0].query).toMatchObject({ units: 'metric', lang: 'de' })
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Unauthorized' })

      await expect(service.oneCall(33.44, -94.04)).rejects.toThrow('OpenWeatherMap API error')
    })
  })

  // ── oneCallTimemachine ──

  describe('oneCallTimemachine', () => {
    const url = `${BASE}/data/3.0/onecall/timemachine`
    const timemachineResponse = {
      lat: 52.23,
      lon: 21.01,
      timezone: 'Europe/Warsaw',
      data: [{ dt: 1645888976, temp: 279.13, weather: [{ id: 800, main: 'Clear' }] }],
    }

    it('sends request with lat, lon, and timestamp', async () => {
      mock.onGet(url).reply(timemachineResponse)

      const result = await service.oneCallTimemachine(52.23, 21.01, 1645888976)

      expect(result).toEqual(timemachineResponse)
      expect(mock.history[0].query).toMatchObject({
        lat: 52.23,
        lon: 21.01,
        dt: 1645888976,
        appid: API_KEY,
      })
    })

    it('resolves units and passes language', async () => {
      mock.onGet(url).reply(timemachineResponse)

      await service.oneCallTimemachine(52.23, 21.01, 1645888976, 'Standard (Kelvin)', 'pl')

      expect(mock.history[0].query).toMatchObject({ units: 'standard', lang: 'pl' })
    })

    it('omits optional fields when not provided', async () => {
      mock.onGet(url).reply(timemachineResponse)

      await service.oneCallTimemachine(52.23, 21.01, 1645888976)

      const query = mock.history[0].query
      expect(query.units).toBeUndefined()
      expect(query.lang).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Forbidden' })

      await expect(service.oneCallTimemachine(52.23, 21.01, 1645888976)).rejects.toThrow('OpenWeatherMap API error')
    })
  })

  // ── Error handling details ──

  describe('error handling', () => {
    const url = `${BASE}/data/2.5/weather`

    it('includes cod in error message when available', async () => {
      mock.onGet(url).replyWithError({
        message: 'Bad Request',
        body: { cod: 401, message: 'Invalid API key' },
      })

      await expect(service.getCurrentWeather('London')).rejects.toThrow('OpenWeatherMap API error (401): Invalid API key')
    })

    it('falls back to error.message when body is missing', async () => {
      mock.onGet(url).replyWithError({ message: 'Network timeout' })

      await expect(service.getCurrentWeather('London')).rejects.toThrow('OpenWeatherMap API error: Network timeout')
    })

    it('uses error.status when body.cod is absent', async () => {
      mock.onGet(url).replyWithError({
        message: 'Server Error',
        status: 500,
        body: { message: 'Internal Server Error' },
      })

      await expect(service.getCurrentWeather('London')).rejects.toThrow('OpenWeatherMap API error (500): Internal Server Error')
    })
  })

  // ── Location precedence ──

  describe('location precedence in buildLocation', () => {
    const url = `${BASE}/data/2.5/weather`
    const response = { name: 'Test', cod: 200 }

    it('prefers city over lat/lon, zip, and id', async () => {
      mock.onGet(url).reply(response)

      await service.getCurrentWeather('London', 51.51, -0.13, '90210', '12345')

      expect(mock.history[0].query).toMatchObject({ q: 'London' })
      expect(mock.history[0].query.lat).toBeUndefined()
      expect(mock.history[0].query.zip).toBeUndefined()
      expect(mock.history[0].query.id).toBeUndefined()
    })

    it('prefers lat/lon over zip and id when city is empty', async () => {
      mock.onGet(url).reply(response)

      await service.getCurrentWeather('', 51.51, -0.13, '90210', '12345')

      expect(mock.history[0].query).toMatchObject({ lat: 51.51, lon: -0.13 })
      expect(mock.history[0].query.zip).toBeUndefined()
      expect(mock.history[0].query.id).toBeUndefined()
    })

    it('prefers zip over id when city and lat/lon are empty', async () => {
      mock.onGet(url).reply(response)

      await service.getCurrentWeather('', undefined, undefined, '90210', '12345')

      expect(mock.history[0].query).toMatchObject({ zip: '90210' })
      expect(mock.history[0].query.id).toBeUndefined()
    })

    it('uses id as last resort', async () => {
      mock.onGet(url).reply(response)

      await service.getCurrentWeather(null, null, null, null, '12345')

      expect(mock.history[0].query).toMatchObject({ id: '12345' })
    })

    it('requires both lat and lon for coordinate location', async () => {
      mock.onGet(url).reply(response)

      // Only lat provided, no lon — should fall through to zip/id/error
      await expect(service.getCurrentWeather(null, 51.51, null, null, null)).rejects.toThrow('a location is required')
    })
  })
})
