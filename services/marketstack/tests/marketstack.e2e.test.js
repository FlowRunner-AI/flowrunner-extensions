'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Marketstack Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('marketstack')
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

  // ── End-of-Day ──

  describe('getEndOfDay', () => {
    it('returns EOD data with expected shape', async () => {
      const result = await service.getEndOfDay('AAPL', undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('pagination')
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.pagination).toHaveProperty('limit')
      expect(result.pagination).toHaveProperty('offset')
      expect(result.pagination).toHaveProperty('count')
      expect(result.pagination).toHaveProperty('total')

      if (result.data.length > 0) {
        expect(result.data[0]).toHaveProperty('symbol', 'AAPL')
        expect(result.data[0]).toHaveProperty('open')
        expect(result.data[0]).toHaveProperty('close')
        expect(result.data[0]).toHaveProperty('volume')
      }
    })

    it('supports date range filtering', async () => {
      const result = await service.getEndOfDay('AAPL', '2025-01-01', '2025-01-31', undefined, 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('supports sort and pagination', async () => {
      const result = await service.getEndOfDay('AAPL', undefined, undefined, 'Ascending', 2, 0)

      expect(result).toHaveProperty('pagination')
      expect(result.pagination.limit).toBe(2)
    })
  })

  describe('getLatestEndOfDay', () => {
    it('returns latest EOD data with expected shape', async () => {
      const result = await service.getLatestEndOfDay('AAPL')

      expect(result).toHaveProperty('pagination')
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)

      if (result.data.length > 0) {
        expect(result.data[0]).toHaveProperty('symbol', 'AAPL')
        expect(result.data[0]).toHaveProperty('close')
      }
    })
  })

  describe('getEndOfDayForDate', () => {
    it('returns EOD data for a specific date', async () => {
      const result = await service.getEndOfDayForDate('2025-01-02', 'AAPL')

      expect(result).toHaveProperty('pagination')
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Intraday ──

  describe('getIntraday', () => {
    it('returns intraday data with expected shape', async () => {
      const result = await service.getIntraday('AAPL', '1 Hour')

      expect(result).toHaveProperty('pagination')
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)

      if (result.data.length > 0) {
        expect(result.data[0]).toHaveProperty('symbol', 'AAPL')
        expect(result.data[0]).toHaveProperty('open')
        expect(result.data[0]).toHaveProperty('close')
      }
    })
  })

  describe('getLatestIntraday', () => {
    it('returns latest intraday data with expected shape', async () => {
      const result = await service.getLatestIntraday('AAPL')

      expect(result).toHaveProperty('pagination')
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Splits & Dividends ──

  describe('getSplits', () => {
    it('returns splits data with expected shape', async () => {
      const result = await service.getSplits('AAPL')

      expect(result).toHaveProperty('pagination')
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)

      if (result.data.length > 0) {
        expect(result.data[0]).toHaveProperty('symbol', 'AAPL')
        expect(result.data[0]).toHaveProperty('split_factor')
        expect(result.data[0]).toHaveProperty('date')
      }
    })
  })

  describe('getDividends', () => {
    it('returns dividends data with expected shape', async () => {
      const result = await service.getDividends('AAPL')

      expect(result).toHaveProperty('pagination')
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)

      if (result.data.length > 0) {
        expect(result.data[0]).toHaveProperty('symbol', 'AAPL')
        expect(result.data[0]).toHaveProperty('dividend')
        expect(result.data[0]).toHaveProperty('date')
      }
    })
  })

  // ── Tickers ──

  describe('listTickers', () => {
    it('returns tickers with expected shape', async () => {
      const result = await service.listTickers(undefined, undefined, 5)

      expect(result).toHaveProperty('pagination')
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)

      if (result.data.length > 0) {
        expect(result.data[0]).toHaveProperty('name')
        expect(result.data[0]).toHaveProperty('symbol')
        expect(result.data[0]).toHaveProperty('stock_exchange')
      }
    })

    it('supports search filtering', async () => {
      const result = await service.listTickers('Apple', undefined, 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('supports exchange filtering', async () => {
      const result = await service.listTickers(undefined, 'XNAS', 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('getTicker', () => {
    it('returns ticker details with expected shape', async () => {
      const result = await service.getTicker('AAPL')

      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('symbol', 'AAPL')
      expect(result).toHaveProperty('stock_exchange')
      expect(result.stock_exchange).toHaveProperty('mic')
    })
  })

  describe('getTickerEndOfDay', () => {
    it('returns ticker EOD data with expected shape', async () => {
      const result = await service.getTickerEndOfDay('AAPL', undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('pagination')
      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('name')
      expect(result.data).toHaveProperty('symbol', 'AAPL')
      expect(result.data).toHaveProperty('eod')
      expect(Array.isArray(result.data.eod)).toBe(true)
    })
  })

  // ── Exchanges ──

  describe('listExchanges', () => {
    it('returns exchanges with expected shape', async () => {
      const result = await service.listExchanges(undefined, 5)

      expect(result).toHaveProperty('pagination')
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)

      if (result.data.length > 0) {
        expect(result.data[0]).toHaveProperty('name')
        expect(result.data[0]).toHaveProperty('mic')
        expect(result.data[0]).toHaveProperty('country')
      }
    })

    it('supports search filtering', async () => {
      const result = await service.listExchanges('NASDAQ', 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('getExchange', () => {
    it('returns exchange details with expected shape', async () => {
      const result = await service.getExchange('XNAS')

      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('mic', 'XNAS')
      expect(result).toHaveProperty('country')
    })
  })

  describe('getExchangeTickers', () => {
    it('returns exchange tickers with expected shape', async () => {
      const result = await service.getExchangeTickers('XNAS', undefined, 5)

      expect(result).toHaveProperty('pagination')
      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('name')
      expect(result.data).toHaveProperty('mic', 'XNAS')
      expect(result.data).toHaveProperty('tickers')
      expect(Array.isArray(result.data.tickers)).toBe(true)
    })
  })

  // ── Currencies & Timezones ──

  describe('listCurrencies', () => {
    it('returns currencies with expected shape', async () => {
      const result = await service.listCurrencies(5)

      expect(result).toHaveProperty('pagination')
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)

      if (result.data.length > 0) {
        expect(result.data[0]).toHaveProperty('code')
        expect(result.data[0]).toHaveProperty('name')
      }
    })
  })

  describe('listTimezones', () => {
    it('returns timezones with expected shape', async () => {
      const result = await service.listTimezones(5)

      expect(result).toHaveProperty('pagination')
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)

      if (result.data.length > 0) {
        expect(result.data[0]).toHaveProperty('timezone')
        expect(result.data[0]).toHaveProperty('abbr')
      }
    })
  })
})
