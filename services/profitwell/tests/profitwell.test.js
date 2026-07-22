'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-api-token'
const BASE = 'https://api.profitwell.com/v2'

const AUTH_HEADERS = {
  'Authorization': API_TOKEN,
  'Content-Type': 'application/json',
}

describe('ProfitWell Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiToken: API_TOKEN })
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
    it('registers the required config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['apiToken'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'apiToken',
            displayName: 'API Token',
            type: 'STRING',
            required: true,
            shared: false,
          }),
        ])
      )
    })

    it('stores the API token on the instance', () => {
      expect(service.apiToken).toBe(API_TOKEN)
    })
  })

  // ── Metrics ──

  describe('getMonthlyMetrics', () => {
    it('requests the monthly metrics endpoint with the start month', async () => {
      mock.onGet(`${ BASE }/metrics/monthly/`).reply({ data: { recurring_revenue: [] } })

      const result = await service.getMonthlyMetrics('2025-01')

      expect(result).toEqual({ data: { recurring_revenue: [] } })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/metrics/monthly/`)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
      expect(mock.history[0].query).toEqual({ month: '2025-01' })
    })

    it('includes the end month when provided', async () => {
      mock.onGet(`${ BASE }/metrics/monthly/`).reply({ data: {} })

      await service.getMonthlyMetrics('2025-01', '2025-06')

      expect(mock.history[0].query).toEqual({ month: '2025-01', month_end: '2025-06' })
    })

    it('throws a descriptive error on failure', async () => {
      mock.onGet(`${ BASE }/metrics/monthly/`).replyWithError({
        message: 'Forbidden',
        status: 403,
        body: { message: 'Your account is not metrics-enabled' },
      })

      await expect(service.getMonthlyMetrics('2025-01')).rejects.toThrow(
        'ProfitWell API error [403]: Your account is not metrics-enabled'
      )
    })

    it('falls back to body.error then to the transport message', async () => {
      mock.onGet(`${ BASE }/metrics/monthly/`).replyWithError({
        message: 'ignored',
        statusCode: 401,
        body: { error: 'Invalid token' },
      })

      await expect(service.getMonthlyMetrics('2025-01')).rejects.toThrow(
        'ProfitWell API error [401]: Invalid token'
      )

      mock.reset()
      mock.onGet(`${ BASE }/metrics/monthly/`).replyWithError({ message: 'Network down' })

      await expect(service.getMonthlyMetrics('2025-01')).rejects.toThrow('ProfitWell API error: Network down')
    })
  })

  describe('getDailyMetrics', () => {
    it('requests the daily metrics endpoint for the given month', async () => {
      mock.onGet(`${ BASE }/metrics/daily/`).reply({ data: { active_customers: [] } })

      const result = await service.getDailyMetrics('2025-06')

      expect(result).toEqual({ data: { active_customers: [] } })
      expect(mock.history[0].url).toBe(`${ BASE }/metrics/daily/`)
      expect(mock.history[0].query).toEqual({ month: '2025-06' })
    })
  })

  describe('getMetricDetail', () => {
    it('maps the metric label and defaults the resolution to monthly', async () => {
      mock.onGet(`${ BASE }/metrics/monthly/`).reply({ data: [] })

      const result = await service.getMetricDetail('Recurring Revenue')

      expect(result).toEqual({ data: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/metrics/monthly/`)
      expect(mock.history[0].query).toEqual({ type: 'recurring_revenue' })
    })

    it('sends month, month_end and plan_id for the monthly resolution', async () => {
      mock.onGet(`${ BASE }/metrics/monthly/`).reply({ data: [] })

      await service.getMetricDetail('Churned Customers', 'Monthly', '2025-01', '2025-06', 'pro')

      expect(mock.history[0].query).toEqual({
        type: 'churned_customers',
        month: '2025-01',
        month_end: '2025-06',
        plan_id: 'pro',
      })
    })

    it('drops month_end for the daily resolution', async () => {
      mock.onGet(`${ BASE }/metrics/daily/`).reply({ data: [] })

      await service.getMetricDetail('Active Customers', 'Daily', '2025-06', '2025-07')

      expect(mock.history[0].url).toBe(`${ BASE }/metrics/daily/`)
      expect(mock.history[0].query).toEqual({ type: 'active_customers', month: '2025-06' })
    })

    it('passes through raw API metric and resolution values', async () => {
      mock.onGet(`${ BASE }/metrics/daily/`).reply({ data: [] })

      await service.getMetricDetail('net_new_revenue', 'daily', '2025-06')

      expect(mock.history[0].url).toBe(`${ BASE }/metrics/daily/`)
      expect(mock.history[0].query).toEqual({ type: 'net_new_revenue', month: '2025-06' })
    })
  })

  // ── Subscriptions ──

  describe('createSubscription', () => {
    it('sends the mapped plan interval and all required fields', async () => {
      mock.onPost(`${ BASE }/subscriptions/`).reply({ subscription_id: 'sub_456' })

      const result = await service.createSubscription(
        'user_123',
        'sub_456',
        'pro-monthly',
        'Monthly',
        'usd',
        4900,
        '2025-01-01'
      )

      expect(result).toEqual({ subscription_id: 'sub_456' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/subscriptions/`)

      expect(mock.history[0].body).toEqual({
        user_id: 'user_123',
        subscription_id: 'sub_456',
        plan_id: 'pro-monthly',
        plan_interval: 'month',
        plan_currency: 'usd',
        value: 4900,
        effective_date: '2025-01-01',
      })
    })

    it('maps Yearly to year and includes the optional email', async () => {
      mock.onPost(`${ BASE }/subscriptions/`).reply({ subscription_id: 'sub_789' })

      await service.createSubscription(
        'user_1',
        'sub_789',
        'pro-yearly',
        'Yearly',
        'eur',
        49000,
        1704067200,
        'user@example.com'
      )

      expect(mock.history[0].body).toMatchObject({
        plan_interval: 'year',
        effective_date: 1704067200,
        email: 'user@example.com',
      })
    })

    it('throws on API failure', async () => {
      mock.onPost(`${ BASE }/subscriptions/`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { message: 'subscription_id already exists' },
      })

      await expect(
        service.createSubscription('u', 's', 'p', 'Monthly', 'usd', 100, '2025-01-01')
      ).rejects.toThrow('ProfitWell API error [400]: subscription_id already exists')
    })
  })

  describe('updateSubscription', () => {
    it('PUTs the new value to the encoded subscription resource', async () => {
      mock.onPut(`${ BASE }/subscriptions/sub_456/`).reply({ subscription_id: 'sub_456', value: 9900 })

      const result = await service.updateSubscription('sub_456', 9900, '2025-02-01')

      expect(result).toEqual({ subscription_id: 'sub_456', value: 9900 })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ value: 9900, effective_date: '2025-02-01' })
    })

    it('includes optional plan fields and maps the interval', async () => {
      mock.onPut(`${ BASE }/subscriptions/sub_456/`).reply({})

      await service.updateSubscription('sub_456', 9900, '2025-02-01', 'pro-yearly', 'Yearly', 'usd')

      expect(mock.history[0].body).toEqual({
        value: 9900,
        effective_date: '2025-02-01',
        plan_id: 'pro-yearly',
        plan_interval: 'year',
        plan_currency: 'usd',
      })
    })

    it('URL-encodes the subscription id', async () => {
      mock.onPut(`${ BASE }/subscriptions/sub%2F456/`).reply({})

      await service.updateSubscription('sub/456', 100, '2025-02-01')

      expect(mock.history[0].url).toBe(`${ BASE }/subscriptions/sub%2F456/`)
    })
  })

  describe('churnSubscription', () => {
    it('defaults the churn type to voluntary', async () => {
      mock.onDelete(`${ BASE }/subscriptions/sub_456/`).reply({ status: 'churned' })

      const result = await service.churnSubscription('sub_456', '2025-03-01')

      expect(result).toEqual({ status: 'churned' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].query).toEqual({ effective_date: '2025-03-01', churn_type: 'voluntary' })
      expect(mock.history[0].body).toBeUndefined()
    })

    it('maps the Delinquent churn type', async () => {
      mock.onDelete(`${ BASE }/subscriptions/sub_456/`).reply({})

      await service.churnSubscription('sub_456', '2025-03-01', 'Delinquent')

      expect(mock.history[0].query).toMatchObject({ churn_type: 'delinquent' })
    })
  })

  describe('getSubscriptions', () => {
    it('fetches the subscription history for a lookup id', async () => {
      mock.onGet(`${ BASE }/subscriptions/user_123/`).reply({ subscriptions: [{ subscription_id: 'sub_456' }] })

      const result = await service.getSubscriptions('user_123')

      expect(result.subscriptions).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/subscriptions/user_123/`)
    })

    it('throws when the customer is unknown', async () => {
      mock.onGet(`${ BASE }/subscriptions/missing/`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { message: 'User not found' },
      })

      await expect(service.getSubscriptions('missing')).rejects.toThrow(
        'ProfitWell API error [404]: User not found'
      )
    })
  })

  describe('migrateSubscription', () => {
    it('PUTs the new plan to the migrate endpoint', async () => {
      mock.onPut(`${ BASE }/subscriptions/sub_456/migrate/`).reply({ plan_id: 'enterprise-yearly' })

      const result = await service.migrateSubscription('sub_456', 'enterprise-yearly', 9900, '2025-02-01')

      expect(result).toEqual({ plan_id: 'enterprise-yearly' })
      expect(mock.history[0].url).toBe(`${ BASE }/subscriptions/sub_456/migrate/`)

      expect(mock.history[0].body).toEqual({
        plan_id: 'enterprise-yearly',
        value: 9900,
        effective_date: '2025-02-01',
      })
    })

    it('includes the mapped interval and currency when provided', async () => {
      mock.onPut(`${ BASE }/subscriptions/sub_456/migrate/`).reply({})

      await service.migrateSubscription('sub_456', 'pro', 4900, '2025-02-01', 'Monthly', 'usd')

      expect(mock.history[0].body).toEqual({
        plan_id: 'pro',
        value: 4900,
        effective_date: '2025-02-01',
        plan_interval: 'month',
        plan_currency: 'usd',
      })
    })
  })
})
