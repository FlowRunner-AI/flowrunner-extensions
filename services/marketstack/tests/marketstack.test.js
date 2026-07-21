'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_KEY = 'test-access-key'
const BASE = 'https://api.marketstack.com/v2'

describe('Marketstack Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accessKey: ACCESS_KEY })
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
          expect.objectContaining({ name: 'accessKey', required: true, shared: false }),
        ])
      )
    })
  })

  // ── End-of-Day ──

  describe('getEndOfDay', () => {
    const eodResponse = {
      pagination: { limit: 100, offset: 0, count: 1, total: 1 },
      data: [{ open: 129.8, high: 133.04, low: 129.47, close: 132.995, volume: 106686703, symbol: 'AAPL' }],
    }

    it('sends correct request with required params only', async () => {
      mock.onGet(`${BASE}/eod`).reply(eodResponse)

      const result = await service.getEndOfDay('AAPL')

      expect(result).toEqual(eodResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })
      expect(mock.history[0].query).toMatchObject({ symbols: 'AAPL', access_key: ACCESS_KEY })
    })

    it('passes all optional parameters', async () => {
      mock.onGet(`${BASE}/eod`).reply(eodResponse)

      await service.getEndOfDay('AAPL,MSFT', '2025-01-01', '2025-06-30', 'Ascending', 50, 10)

      expect(mock.history[0].query).toMatchObject({
        symbols: 'AAPL,MSFT',
        date_from: '2025-01-01',
        date_to: '2025-06-30',
        sort: 'ASC',
        limit: 50,
        offset: 10,
        access_key: ACCESS_KEY,
      })
    })

    it('resolves Descending sort to DESC', async () => {
      mock.onGet(`${BASE}/eod`).reply(eodResponse)

      await service.getEndOfDay('AAPL', undefined, undefined, 'Descending')

      expect(mock.history[0].query).toMatchObject({ sort: 'DESC' })
    })

    it('omits undefined optional params from query', async () => {
      mock.onGet(`${BASE}/eod`).reply(eodResponse)

      await service.getEndOfDay('AAPL')

      const query = mock.history[0].query
      expect(query).not.toHaveProperty('date_from')
      expect(query).not.toHaveProperty('date_to')
      expect(query).not.toHaveProperty('sort')
      expect(query).not.toHaveProperty('limit')
      expect(query).not.toHaveProperty('offset')
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/eod`).replyWithError({
        message: 'Unauthorized',
        body: { error: { code: 'missing_access_key', message: 'You have not supplied an API Access Key.' } },
      })

      await expect(service.getEndOfDay('AAPL')).rejects.toThrow('Marketstack API error')
    })

    it('includes error code in thrown message when available', async () => {
      mock.onGet(`${BASE}/eod`).replyWithError({
        message: 'Bad Request',
        body: { error: { code: 'invalid_api_function', message: 'This function does not exist.' } },
      })

      await expect(service.getEndOfDay('AAPL')).rejects.toThrow('[invalid_api_function]')
    })
  })

  describe('getLatestEndOfDay', () => {
    const latestEodResponse = {
      pagination: { limit: 100, offset: 0, count: 1, total: 1 },
      data: [{ open: 129.8, close: 132.995, symbol: 'AAPL' }],
    }

    it('sends correct request', async () => {
      mock.onGet(`${BASE}/eod/latest`).reply(latestEodResponse)

      const result = await service.getLatestEndOfDay('AAPL')

      expect(result).toEqual(latestEodResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ symbols: 'AAPL', access_key: ACCESS_KEY })
    })

    it('supports multiple symbols', async () => {
      mock.onGet(`${BASE}/eod/latest`).reply(latestEodResponse)

      await service.getLatestEndOfDay('AAPL,MSFT,GOOGL')

      expect(mock.history[0].query).toMatchObject({ symbols: 'AAPL,MSFT,GOOGL' })
    })
  })

  describe('getEndOfDayForDate', () => {
    const eodDateResponse = {
      pagination: { limit: 100, offset: 0, count: 1, total: 1 },
      data: [{ open: 129.8, close: 132.995, symbol: 'AAPL', date: '2025-07-11T00:00:00+0000' }],
    }

    it('sends correct request with date in URL path', async () => {
      mock.onGet(`${BASE}/eod/2025-07-11`).reply(eodDateResponse)

      const result = await service.getEndOfDayForDate('2025-07-11', 'AAPL')

      expect(result).toEqual(eodDateResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ symbols: 'AAPL', access_key: ACCESS_KEY })
    })

    it('encodes date in URL', async () => {
      mock.onGet(`${BASE}/eod/2025-07-11`).reply(eodDateResponse)

      await service.getEndOfDayForDate('2025-07-11', 'AAPL')

      expect(mock.history[0].url).toBe(`${BASE}/eod/2025-07-11`)
    })
  })

  // ── Intraday ──

  describe('getIntraday', () => {
    const intradayResponse = {
      pagination: { limit: 100, offset: 0, count: 1, total: 1 },
      data: [{ open: 132.5, close: 132.99, symbol: 'AAPL' }],
    }

    it('sends correct request with required params only', async () => {
      mock.onGet(`${BASE}/intraday`).reply(intradayResponse)

      const result = await service.getIntraday('AAPL')

      expect(result).toEqual(intradayResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ symbols: 'AAPL', access_key: ACCESS_KEY })
    })

    it('resolves interval choices correctly', async () => {
      mock.onGet(`${BASE}/intraday`).reply(intradayResponse)

      await service.getIntraday('AAPL', '1 Minute')

      expect(mock.history[0].query).toMatchObject({ interval: '1min' })
    })

    it('resolves 5 Minutes interval', async () => {
      mock.onGet(`${BASE}/intraday`).reply(intradayResponse)

      await service.getIntraday('AAPL', '5 Minutes')

      expect(mock.history[0].query).toMatchObject({ interval: '5min' })
    })

    it('resolves 1 Hour interval', async () => {
      mock.onGet(`${BASE}/intraday`).reply(intradayResponse)

      await service.getIntraday('AAPL', '1 Hour')

      expect(mock.history[0].query).toMatchObject({ interval: '1hour' })
    })

    it('resolves 24 Hours interval', async () => {
      mock.onGet(`${BASE}/intraday`).reply(intradayResponse)

      await service.getIntraday('AAPL', '24 Hours')

      expect(mock.history[0].query).toMatchObject({ interval: '24hour' })
    })

    it('passes all optional parameters', async () => {
      mock.onGet(`${BASE}/intraday`).reply(intradayResponse)

      await service.getIntraday('AAPL', '30 Minutes', '2025-07-01', '2025-07-10')

      expect(mock.history[0].query).toMatchObject({
        symbols: 'AAPL',
        interval: '30min',
        date_from: '2025-07-01',
        date_to: '2025-07-10',
        access_key: ACCESS_KEY,
      })
    })

    it('omits undefined optional params from query', async () => {
      mock.onGet(`${BASE}/intraday`).reply(intradayResponse)

      await service.getIntraday('AAPL')

      const query = mock.history[0].query
      expect(query).not.toHaveProperty('interval')
      expect(query).not.toHaveProperty('date_from')
      expect(query).not.toHaveProperty('date_to')
    })
  })

  describe('getLatestIntraday', () => {
    const latestIntradayResponse = {
      pagination: { limit: 100, offset: 0, count: 1, total: 1 },
      data: [{ open: 132.5, close: 132.99, symbol: 'AAPL' }],
    }

    it('sends correct request', async () => {
      mock.onGet(`${BASE}/intraday/latest`).reply(latestIntradayResponse)

      const result = await service.getLatestIntraday('AAPL')

      expect(result).toEqual(latestIntradayResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ symbols: 'AAPL', access_key: ACCESS_KEY })
    })
  })

  // ── Splits & Dividends ──

  describe('getSplits', () => {
    const splitsResponse = {
      pagination: { limit: 100, offset: 0, count: 1, total: 1 },
      data: [{ date: '2020-08-31', split_factor: 4, symbol: 'AAPL' }],
    }

    it('sends correct request with required params only', async () => {
      mock.onGet(`${BASE}/splits`).reply(splitsResponse)

      const result = await service.getSplits('AAPL')

      expect(result).toEqual(splitsResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ symbols: 'AAPL', access_key: ACCESS_KEY })
    })

    it('passes all optional parameters', async () => {
      mock.onGet(`${BASE}/splits`).reply(splitsResponse)

      await service.getSplits('AAPL', '2020-01-01', '2025-12-31', 'Ascending', 10, 0)

      expect(mock.history[0].query).toMatchObject({
        symbols: 'AAPL',
        date_from: '2020-01-01',
        date_to: '2025-12-31',
        sort: 'ASC',
        limit: 10,
        offset: 0,
        access_key: ACCESS_KEY,
      })
    })

    it('omits undefined optional params from query', async () => {
      mock.onGet(`${BASE}/splits`).reply(splitsResponse)

      await service.getSplits('AAPL')

      const query = mock.history[0].query
      expect(query).not.toHaveProperty('date_from')
      expect(query).not.toHaveProperty('sort')
    })
  })

  describe('getDividends', () => {
    const dividendsResponse = {
      pagination: { limit: 100, offset: 0, count: 1, total: 1 },
      data: [{ date: '2025-05-12', dividend: 0.26, symbol: 'AAPL' }],
    }

    it('sends correct request with required params only', async () => {
      mock.onGet(`${BASE}/dividends`).reply(dividendsResponse)

      const result = await service.getDividends('AAPL')

      expect(result).toEqual(dividendsResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ symbols: 'AAPL', access_key: ACCESS_KEY })
    })

    it('passes all optional parameters', async () => {
      mock.onGet(`${BASE}/dividends`).reply(dividendsResponse)

      await service.getDividends('AAPL,MSFT', '2024-01-01', '2025-12-31', 'Descending', 25, 5)

      expect(mock.history[0].query).toMatchObject({
        symbols: 'AAPL,MSFT',
        date_from: '2024-01-01',
        date_to: '2025-12-31',
        sort: 'DESC',
        limit: 25,
        offset: 5,
        access_key: ACCESS_KEY,
      })
    })
  })

  // ── Tickers ──

  describe('listTickers', () => {
    const tickersResponse = {
      pagination: { limit: 100, offset: 0, count: 1, total: 1 },
      data: [{ name: 'Apple Inc', symbol: 'AAPL', stock_exchange: { mic: 'XNAS' } }],
    }

    it('sends correct request with no params', async () => {
      mock.onGet(`${BASE}/tickers`).reply(tickersResponse)

      const result = await service.listTickers()

      expect(result).toEqual(tickersResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ access_key: ACCESS_KEY })
    })

    it('passes search and exchange filters', async () => {
      mock.onGet(`${BASE}/tickers`).reply(tickersResponse)

      await service.listTickers('Apple', 'XNAS', 10, 0)

      expect(mock.history[0].query).toMatchObject({
        search: 'Apple',
        exchange: 'XNAS',
        limit: 10,
        offset: 0,
        access_key: ACCESS_KEY,
      })
    })

    it('omits undefined optional params from query', async () => {
      mock.onGet(`${BASE}/tickers`).reply(tickersResponse)

      await service.listTickers()

      const query = mock.history[0].query
      expect(query).not.toHaveProperty('search')
      expect(query).not.toHaveProperty('exchange')
    })
  })

  describe('getTicker', () => {
    const tickerResponse = { name: 'Apple Inc', symbol: 'AAPL', stock_exchange: { mic: 'XNAS' } }

    it('sends correct request with symbol in URL path', async () => {
      mock.onGet(`${BASE}/tickers/AAPL`).reply(tickerResponse)

      const result = await service.getTicker('AAPL')

      expect(result).toEqual(tickerResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ access_key: ACCESS_KEY })
    })

    it('encodes symbol in URL', async () => {
      mock.onGet(`${BASE}/tickers/BRK.A`).reply(tickerResponse)

      await service.getTicker('BRK.A')

      expect(mock.history[0].url).toBe(`${BASE}/tickers/BRK.A`)
    })
  })

  describe('getTickerEndOfDay', () => {
    const tickerEodResponse = {
      pagination: { limit: 100, offset: 0, count: 1, total: 1 },
      data: { name: 'Apple Inc', symbol: 'AAPL', eod: [{ open: 129.8, close: 132.995 }] },
    }

    it('sends correct request with required params only', async () => {
      mock.onGet(`${BASE}/tickers/AAPL/eod`).reply(tickerEodResponse)

      const result = await service.getTickerEndOfDay('AAPL')

      expect(result).toEqual(tickerEodResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ access_key: ACCESS_KEY })
    })

    it('passes all optional parameters', async () => {
      mock.onGet(`${BASE}/tickers/AAPL/eod`).reply(tickerEodResponse)

      await service.getTickerEndOfDay('AAPL', '2025-01-01', '2025-06-30', 'Ascending', 50, 10)

      expect(mock.history[0].query).toMatchObject({
        date_from: '2025-01-01',
        date_to: '2025-06-30',
        sort: 'ASC',
        limit: 50,
        offset: 10,
        access_key: ACCESS_KEY,
      })
    })

    it('omits undefined optional params from query', async () => {
      mock.onGet(`${BASE}/tickers/AAPL/eod`).reply(tickerEodResponse)

      await service.getTickerEndOfDay('AAPL')

      const query = mock.history[0].query
      expect(query).not.toHaveProperty('date_from')
      expect(query).not.toHaveProperty('sort')
    })
  })

  // ── Exchanges ──

  describe('listExchanges', () => {
    const exchangesResponse = {
      pagination: { limit: 100, offset: 0, count: 1, total: 1 },
      data: [{ name: 'NASDAQ Stock Exchange', mic: 'XNAS', country: 'USA' }],
    }

    it('sends correct request with no params', async () => {
      mock.onGet(`${BASE}/exchanges`).reply(exchangesResponse)

      const result = await service.listExchanges()

      expect(result).toEqual(exchangesResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ access_key: ACCESS_KEY })
    })

    it('passes search and pagination', async () => {
      mock.onGet(`${BASE}/exchanges`).reply(exchangesResponse)

      await service.listExchanges('NASDAQ', 10, 0)

      expect(mock.history[0].query).toMatchObject({
        search: 'NASDAQ',
        limit: 10,
        offset: 0,
        access_key: ACCESS_KEY,
      })
    })
  })

  describe('getExchange', () => {
    const exchangeResponse = { name: 'NASDAQ Stock Exchange', mic: 'XNAS', country: 'USA' }

    it('sends correct request with MIC in URL path', async () => {
      mock.onGet(`${BASE}/exchanges/XNAS`).reply(exchangeResponse)

      const result = await service.getExchange('XNAS')

      expect(result).toEqual(exchangeResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ access_key: ACCESS_KEY })
    })
  })

  describe('getExchangeTickers', () => {
    const exchangeTickersResponse = {
      pagination: { limit: 100, offset: 0, count: 1, total: 1 },
      data: { name: 'NASDAQ Stock Exchange', mic: 'XNAS', tickers: [{ name: 'Apple Inc', symbol: 'AAPL' }] },
    }

    it('sends correct request with required params only', async () => {
      mock.onGet(`${BASE}/exchanges/XNAS/tickers`).reply(exchangeTickersResponse)

      const result = await service.getExchangeTickers('XNAS')

      expect(result).toEqual(exchangeTickersResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ access_key: ACCESS_KEY })
    })

    it('passes search and pagination', async () => {
      mock.onGet(`${BASE}/exchanges/XNAS/tickers`).reply(exchangeTickersResponse)

      await service.getExchangeTickers('XNAS', 'Apple', 10, 0)

      expect(mock.history[0].query).toMatchObject({
        search: 'Apple',
        limit: 10,
        offset: 0,
        access_key: ACCESS_KEY,
      })
    })
  })

  // ── Currencies & Timezones ──

  describe('listCurrencies', () => {
    const currenciesResponse = {
      pagination: { limit: 100, offset: 0, count: 1, total: 1 },
      data: [{ code: 'USD', symbol: '$', name: 'US Dollar' }],
    }

    it('sends correct request with no params', async () => {
      mock.onGet(`${BASE}/currencies`).reply(currenciesResponse)

      const result = await service.listCurrencies()

      expect(result).toEqual(currenciesResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ access_key: ACCESS_KEY })
    })

    it('passes pagination params', async () => {
      mock.onGet(`${BASE}/currencies`).reply(currenciesResponse)

      await service.listCurrencies(10, 5)

      expect(mock.history[0].query).toMatchObject({
        limit: 10,
        offset: 5,
        access_key: ACCESS_KEY,
      })
    })
  })

  describe('listTimezones', () => {
    const timezonesResponse = {
      pagination: { limit: 100, offset: 0, count: 1, total: 1 },
      data: [{ timezone: 'America/New_York', abbr: 'EST', abbr_dst: 'EDT' }],
    }

    it('sends correct request with no params', async () => {
      mock.onGet(`${BASE}/timezones`).reply(timezonesResponse)

      const result = await service.listTimezones()

      expect(result).toEqual(timezonesResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ access_key: ACCESS_KEY })
    })

    it('passes pagination params', async () => {
      mock.onGet(`${BASE}/timezones`).reply(timezonesResponse)

      await service.listTimezones(25, 0)

      expect(mock.history[0].query).toMatchObject({
        limit: 25,
        offset: 0,
        access_key: ACCESS_KEY,
      })
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('uses fallback message when error.body has no error object', async () => {
      mock.onGet(`${BASE}/eod`).replyWithError({
        message: 'Something went wrong',
        body: { message: 'Rate limit exceeded' },
      })

      await expect(service.getEndOfDay('AAPL')).rejects.toThrow('Rate limit exceeded')
    })

    it('uses error.message when no body is available', async () => {
      mock.onGet(`${BASE}/eod`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.getEndOfDay('AAPL')).rejects.toThrow('Network timeout')
    })
  })
})
