'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

function currentMonth() {
  const now = new Date()

  return `${ now.getUTCFullYear() }-${ String(now.getUTCMonth() + 1).padStart(2, '0') }`
}

describe('ProfitWell Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('profitwell')
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

  // ── Metrics ──
  // Metrics require a metrics-enabled ProfitWell token. Set
  // testValues.metricsEnabled = false to skip this block.

  describe('metrics', () => {
    const skipMetrics = () => {
      if (testValues.metricsEnabled === false) {
        console.log('Skipping metrics: testValues.metricsEnabled is false')

        return true
      }

      return false
    }

    it('returns monthly metrics', async () => {
      if (skipMetrics()) {
        return
      }

      const month = testValues.metricsMonth || currentMonth()
      const result = await service.getMonthlyMetrics(month)

      expect(result).toHaveProperty('data')
    })

    it('returns monthly metrics for a month range', async () => {
      if (skipMetrics()) {
        return
      }

      const month = testValues.metricsMonth || currentMonth()
      const result = await service.getMonthlyMetrics(month, testValues.metricsMonthEnd || month)

      expect(result).toHaveProperty('data')
    })

    it('returns daily metrics for a month', async () => {
      if (skipMetrics()) {
        return
      }

      const month = testValues.metricsMonth || currentMonth()
      const result = await service.getDailyMetrics(month)

      expect(result).toHaveProperty('data')
    })

    it('returns a monthly breakdown of a single metric', async () => {
      if (skipMetrics()) {
        return
      }

      const month = testValues.metricsMonth || currentMonth()
      const result = await service.getMetricDetail('Recurring Revenue', 'Monthly', month)

      expect(result).toBeDefined()
    })

    it('returns a daily breakdown of a single metric', async () => {
      if (skipMetrics()) {
        return
      }

      const month = testValues.metricsMonth || currentMonth()
      const result = await service.getMetricDetail('Active Customers', 'Daily', month)

      expect(result).toBeDefined()
    })
  })

  // ── Subscriptions ──
  // Subscription writes are permanent in ProfitWell and affect real metrics, so
  // they only run when testValues.subscriptionsEnabled is explicitly true
  // (requires an API-based / manual ProfitWell account).

  describe('subscriptions', () => {
    const userId = `flowrunner-e2e-user-${ SUFFIX }`
    const subscriptionId = `flowrunner-e2e-sub-${ SUFFIX }`

    const skipSubscriptions = () => {
      if (testValues.subscriptionsEnabled !== true) {
        console.log('Skipping subscriptions: testValues.subscriptionsEnabled is not true')

        return true
      }

      return false
    }

    it('creates a subscription', async () => {
      if (skipSubscriptions()) {
        return
      }

      const result = await service.createSubscription(
        userId,
        subscriptionId,
        'flowrunner-e2e-monthly',
        'Monthly',
        'usd',
        4900,
        '2025-01-01',
        testValues.email
      )

      expect(result).toBeDefined()
    })

    it('reads back the subscription history', async () => {
      if (skipSubscriptions()) {
        return
      }

      const result = await service.getSubscriptions(userId)

      expect(result).toBeDefined()
    })

    it('updates the subscription value', async () => {
      if (skipSubscriptions()) {
        return
      }

      const result = await service.updateSubscription(subscriptionId, 9900, '2025-02-01')

      expect(result).toBeDefined()
    })

    it('migrates the subscription to another plan', async () => {
      if (skipSubscriptions()) {
        return
      }

      const result = await service.migrateSubscription(
        subscriptionId,
        'flowrunner-e2e-yearly',
        19900,
        '2025-03-01',
        'Yearly',
        'usd'
      )

      expect(result).toBeDefined()
    })

    it('churns the subscription', async () => {
      if (skipSubscriptions()) {
        return
      }

      const result = await service.churnSubscription(subscriptionId, '2025-04-01', 'Voluntary')

      expect(result).toBeDefined()
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a descriptive error for an unknown subscription lookup', async () => {
      await expect(service.getSubscriptions(`missing-${ SUFFIX }`)).rejects.toThrow(/ProfitWell API error/)
    })
  })
})
