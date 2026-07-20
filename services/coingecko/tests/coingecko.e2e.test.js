'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('CoinGecko Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('coingecko')
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

  // A coin id that reliably exists on CoinGecko. Overridable for future-proofing.
  const coinId = () => testValues.coinId || 'bitcoin'
  const vsCurrency = () => testValues.vsCurrency || 'usd'
  const exchangeId = () => testValues.exchangeId || 'binance'
  const platform = () => testValues.platform || 'ethereum'
  const contractAddress = () =>
    testValues.contractAddress || '0xdac17f958d2ee523a2206206994597c13d831ec7' // USDT

  // ── System ──

  describe('ping', () => {
    it('confirms the API is reachable', async () => {
      const response = await service.ping()

      expect(response).toHaveProperty('gecko_says')
    })
  })

  // ── Simple ──

  describe('getPrice', () => {
    it('returns a price for the coin in the target currency', async () => {
      const response = await service.getPrice(coinId(), vsCurrency(), true, true)

      expect(response).toHaveProperty(coinId())
      expect(response[coinId()]).toHaveProperty(vsCurrency())
    })
  })

  describe('getTokenPriceByContract', () => {
    it('returns a price for a token by contract address', async () => {
      const response = await service.getTokenPriceByContract(
        platform(),
        contractAddress(),
        vsCurrency()
      )

      expect(typeof response).toBe('object')
      expect(response).not.toBeNull()
    })
  })

  describe('getSupportedVsCurrencies', () => {
    it('returns an array of supported currency codes', async () => {
      const response = await service.getSupportedVsCurrencies()

      expect(Array.isArray(response)).toBe(true)
      expect(response).toContain('usd')
    })
  })

  // ── Coins ──

  describe('listCoins', () => {
    it('returns an array of coins with id, symbol and name', async () => {
      const response = await service.listCoins()

      expect(Array.isArray(response)).toBe(true)
      expect(response.length).toBeGreaterThan(0)
      expect(response[0]).toHaveProperty('id')
      expect(response[0]).toHaveProperty('symbol')
      expect(response[0]).toHaveProperty('name')
    })
  })

  describe('coinsMarkets', () => {
    it('returns market data rows for the target currency', async () => {
      const response = await service.coinsMarkets(
        vsCurrency(),
        undefined,
        'Market Cap (High to Low)',
        5,
        1,
        '24h'
      )

      expect(Array.isArray(response)).toBe(true)
      expect(response.length).toBeGreaterThan(0)
      expect(response[0]).toHaveProperty('id')
      expect(response[0]).toHaveProperty('current_price')
    })
  })

  describe('getCoinData', () => {
    it('returns detailed data for a single coin', async () => {
      const response = await service.getCoinData(coinId())

      expect(response).toHaveProperty('id', coinId())
      expect(response).toHaveProperty('symbol')
      expect(response).toHaveProperty('market_data')
    })
  })

  describe('getCoinMarketChart', () => {
    it('returns historical price/market-cap/volume series', async () => {
      const response = await service.getCoinMarketChart(coinId(), vsCurrency(), '7', 'Daily')

      expect(response).toHaveProperty('prices')
      expect(Array.isArray(response.prices)).toBe(true)
      expect(response).toHaveProperty('market_caps')
      expect(response).toHaveProperty('total_volumes')
    })
  })

  describe('getCoinOHLC', () => {
    it('returns OHLC candlestick rows', async () => {
      const response = await service.getCoinOHLC(coinId(), vsCurrency(), '7')

      expect(Array.isArray(response)).toBe(true)
      expect(response.length).toBeGreaterThan(0)
      expect(response[0]).toHaveLength(5)
    })
  })

  describe('getCoinHistory', () => {
    it('returns a historical snapshot for a specific date', async () => {
      const response = await service.getCoinHistory(coinId(), '30-12-2023')

      expect(response).toHaveProperty('id', coinId())
      expect(response).toHaveProperty('name')
    })
  })

  // ── Search & Trending ──

  describe('search', () => {
    it('returns matching coins for a query', async () => {
      const response = await service.search('bitcoin')

      expect(response).toHaveProperty('coins')
      expect(Array.isArray(response.coins)).toBe(true)
    })
  })

  describe('getTrending', () => {
    it('returns trending coins, nfts and categories', async () => {
      const response = await service.getTrending()

      expect(response).toHaveProperty('coins')
      expect(Array.isArray(response.coins)).toBe(true)
    })
  })

  // ── Global ──

  describe('getGlobalData', () => {
    it('returns global market data', async () => {
      const response = await service.getGlobalData()

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('total_market_cap')
    })
  })

  describe('getGlobalDefiData', () => {
    it('returns global DeFi market data', async () => {
      const response = await service.getGlobalDefiData()

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('defi_market_cap')
    })
  })

  // ── Exchanges ──

  describe('listExchanges', () => {
    it('returns a page of exchanges', async () => {
      const response = await service.listExchanges(5, 1)

      expect(Array.isArray(response)).toBe(true)
      expect(response.length).toBeGreaterThan(0)
      expect(response[0]).toHaveProperty('id')
    })
  })

  describe('getExchange', () => {
    it('returns details for a single exchange', async () => {
      const response = await service.getExchange(exchangeId())

      expect(response).toHaveProperty('name')
      expect(response).toHaveProperty('trust_score')
    })
  })

  // ── Categories ──

  describe('listCategories', () => {
    it('returns coin categories with market data', async () => {
      const response = await service.listCategories('Market Cap (High to Low)')

      expect(Array.isArray(response)).toBe(true)
      expect(response.length).toBeGreaterThan(0)
      expect(response[0]).toHaveProperty('id')
      expect(response[0]).toHaveProperty('name')
    })
  })
})
