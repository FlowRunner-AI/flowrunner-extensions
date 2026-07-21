'use strict'

// ── Mock external SDK modules before requiring the service ──

const mockClient = {
  system: { loadStatus: jest.fn() },
  apps: { getApps: jest.fn() },
  settings: { getAppSettings: jest.fn() },
  tables: { get: jest.fn() },
  dataViews: { getViews: jest.fn() },
  bl: { getEventHandlers: jest.fn() },
  counters: { listNames: jest.fn() },
  email: { loadCustomTemplates: jest.fn() },
  messaging: { getPushTemplates: jest.fn() },
  pdf: { listTemplates: jest.fn(), loadTemplate: jest.fn(), generatePDF: jest.fn() },
  webhooks: { saveWebhook: jest.fn(), deleteWebhook: jest.fn() },
  files: { loadDirectory: jest.fn() },
}

jest.mock('backendless-console-sdk', () => ({
  createClient: jest.fn(() => mockClient),
}))

const mockStore = {
  find: jest.fn(),
  getObjectCount: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  bulkDelete: jest.fn(),
  bulkUpdate: jest.fn(),
}

const mockQueryBuilder = {
  setWhereClause: jest.fn(),
  setSortBy: jest.fn(),
  setPageSize: jest.fn(),
  setOffset: jest.fn(),
}

const mockEmailEnvelope = {
  setTo: jest.fn(),
  setCc: jest.fn(),
  setBcc: jest.fn(),
  setQuery: jest.fn(),
}

const mockBackendless = {
  initApp: jest.fn(() => ({
    Data: { of: jest.fn(() => mockStore) },
    DataQueryBuilder: { create: jest.fn(() => mockQueryBuilder) },
    Files: {
      createDirectory: jest.fn(),
      remove: jest.fn(),
      append: jest.fn(),
      appendText: jest.fn(),
      saveFile: jest.fn(),
    },
    EmailEnvelope: { create: jest.fn(() => mockEmailEnvelope) },
    Messaging: {
      sendEmailFromTemplate: jest.fn(),
      pushWithTemplate: jest.fn(),
    },
    Request: { get: jest.fn() },
    appPath: '/app-path',
  })),
  Request: {
    post: jest.fn(),
    get: jest.fn(),
  },
}

jest.mock('backendless', () => mockBackendless)

const { createSandbox } = require('../../../service-sandbox')
const { createClient } = require('backendless-console-sdk')

const CLIENT_ID_US = 'test-client-id-us'
const CLIENT_SECRET_US = 'test-client-secret-us'
const CLIENT_ID_EU = 'test-client-id-eu'
const CLIENT_SECRET_EU = 'test-client-secret-eu'
const CLUSTER_URL_US = 'https://develop.backendless.com'
const CLUSTER_URL_EU = 'https://eu-develop.backendless.com'
const ACCESS_TOKEN = 'test-access-token'

function setOAuthToken(service, token) {
  service.request = { headers: { 'oauth-access-token': token || ACCESS_TOKEN } }
}

function mockPostChain(responseData) {
  const chain = {
    set: jest.fn().mockReturnThis(),
    send: jest.fn().mockResolvedValue(responseData),
  }
  mockBackendless.Request.post.mockReturnValue(chain)
  return chain
}

function mockGetChain(responseData) {
  const chain = {
    set: jest.fn().mockResolvedValue(responseData),
  }
  mockBackendless.Request.get.mockReturnValue(chain)
  return chain
}

describe('Backendless Service', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createSandbox({
      clientId_US: CLIENT_ID_US,
      clientSecret_US: CLIENT_SECRET_US,
      clientId_EU: CLIENT_ID_EU,
      clientSecret_EU: CLIENT_SECRET_EU,
      clusterZone: 'US',
    })

    require('../src/index.js')
    service = sandbox.getService()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    setOAuthToken(service)
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const items = sandbox.getConfigItems()

      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId_US', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret_US', required: true, shared: true }),
          expect.objectContaining({ name: 'clientId_EU', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret_EU', required: true, shared: true }),
          expect.objectContaining({ name: 'clusterZone', required: true, shared: false }),
          expect.objectContaining({ name: 'selfHostedClientURL', required: false, shared: false }),
          expect.objectContaining({ name: 'selfHostedClientId', required: false, shared: false }),
          expect.objectContaining({ name: 'selfHostedClientSecret', required: false, shared: false }),
        ])
      )
    })
  })

  // ── Constructor ──

  describe('constructor', () => {
    it('uses US cluster URL by default', () => {
      const svc = sandbox.getService()

      expect(svc.clusterURL).toBe(CLUSTER_URL_US)
      expect(svc.clientId).toBe(CLIENT_ID_US)
      expect(svc.clientSecret).toBe(CLIENT_SECRET_US)
    })

    it('uses EU cluster when configured', () => {
      jest.isolateModules(() => {
        const euSandbox = createSandbox({
          clientId_US: CLIENT_ID_US,
          clientSecret_US: CLIENT_SECRET_US,
          clientId_EU: CLIENT_ID_EU,
          clientSecret_EU: CLIENT_SECRET_EU,
          clusterZone: 'EU',
        })

        require('../src/index.js')
        const euService = euSandbox.getService()

        expect(euService.clusterURL).toBe(CLUSTER_URL_EU)
        expect(euService.clientId).toBe(CLIENT_ID_EU)
        expect(euService.clientSecret).toBe(CLIENT_SECRET_EU)

        euSandbox.cleanup()
      })
    })

    it('uses self-hosted config when cluster zone is SelfHosted', () => {
      jest.isolateModules(() => {
        const shSandbox = createSandbox({
          clusterZone: 'SelfHosted',
          selfHostedClientId: 'sh-id',
          selfHostedClientSecret: 'sh-secret',
          selfHostedClientURL: 'https://my-backendless.com',
        })

        require('../src/index.js')
        const shService = shSandbox.getService()

        expect(shService.clusterURL).toBe('https://my-backendless.com')
        expect(shService.clientId).toBe('sh-id')
        expect(shService.clientSecret).toBe('sh-secret')

        shSandbox.cleanup()
      })
    })

    it('throws when SelfHosted config is incomplete', () => {
      jest.isolateModules(() => {
        expect(() => {
          const badSandbox = createSandbox({
            clusterZone: 'SelfHosted',
          })

          require('../src/index.js')
          badSandbox.cleanup()
        }).toThrow('SelfHosted cluster zone requires selfHostedClientId, selfHostedClientSecret, and selfHostedClientURL')
      })
    })
  })

  // ── OAuth2 System Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns correct authorization URL', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(CLUSTER_URL_US)
      expect(url).toContain('/developer/oauth2/authorize')
      expect(url).toContain(`client_id=${CLIENT_ID_US}`)
      expect(url).toContain('response_type=code')
    })
  })

  describe('refreshToken', () => {
    it('sends correct token refresh request', async () => {
      const chain = mockPostChain({
        access_token: 'new-token',
        expires_in: 3600,
        refresh_token: 'new-refresh',
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(mockBackendless.Request.post).toHaveBeenCalledWith(
        `${CLUSTER_URL_US}/developer/oauth2/token`
      )
      expect(chain.set).toHaveBeenCalledWith({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(chain.send).toHaveBeenCalledWith(expect.stringContaining('grant_type=refresh_token'))
      expect(chain.send).toHaveBeenCalledWith(expect.stringContaining('refresh_token=old-refresh-token'))

      expect(result).toEqual({
        token: 'new-token',
        expirationInSeconds: 3600,
        refreshToken: 'new-refresh',
      })
    })

    it('falls back to original refresh token when none returned', async () => {
      mockPostChain({
        access_token: 'new-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('original-refresh')

      expect(result.refreshToken).toBe('original-refresh')
    })

    it('throws on API error', async () => {
      const chain = {
        set: jest.fn().mockReturnThis(),
        send: jest.fn().mockRejectedValue(new Error('Unauthorized')),
      }
      mockBackendless.Request.post.mockReturnValue(chain)

      await expect(service.refreshToken('bad-token')).rejects.toThrow('Unauthorized')
    })
  })

  describe('executeCallback', () => {
    it('exchanges auth code for tokens and fetches user info', async () => {
      const postChain = mockPostChain({
        access_token: 'access-123',
        refresh_token: 'refresh-456',
        expires_in: 7200,
      })

      const getChain = {
        set: jest.fn().mockResolvedValue({
          name: 'Test User',
          email: 'test@example.com',
        }),
      }
      mockBackendless.Request.get.mockReturnValue(getChain)

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://app.flowrunner.com/callback',
      })

      expect(mockBackendless.Request.post).toHaveBeenCalledWith(
        `${CLUSTER_URL_US}/developer/oauth2/token`
      )
      expect(postChain.send).toHaveBeenCalledWith(expect.stringContaining('grant_type=authorization_code'))
      expect(postChain.send).toHaveBeenCalledWith(expect.stringContaining('code=auth-code-123'))

      expect(mockBackendless.Request.get).toHaveBeenCalledWith(
        `${CLUSTER_URL_US}/console/home/myaccount`
      )

      expect(result).toEqual({
        token: 'access-123',
        refreshToken: 'refresh-456',
        expirationInSeconds: 7200,
        overwrite: true,
        connectionIdentityName: 'Test User (test@example.com)',
        connectionIdentityImageURL: null,
      })
    })

    it('returns empty object when user info fetch fails', async () => {
      mockPostChain({
        access_token: 'access-123',
        refresh_token: 'refresh-456',
        expires_in: 7200,
      })

      const getChain = {
        set: jest.fn().mockRejectedValue(new Error('Forbidden')),
      }
      mockBackendless.Request.get.mockReturnValue(getChain)

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://app.flowrunner.com/callback',
      })

      expect(result).toEqual({})
    })

    it('throws on token exchange failure', async () => {
      const chain = {
        set: jest.fn().mockReturnThis(),
        send: jest.fn().mockRejectedValue(new Error('Invalid code')),
      }
      mockBackendless.Request.post.mockReturnValue(chain)

      await expect(service.executeCallback({
        code: 'bad-code',
        redirectURI: 'https://app.flowrunner.com/callback',
      })).rejects.toThrow('Invalid code')
    })
  })

  // ── Trigger Methods ──

  describe('trigger methods', () => {
    describe('handleTriggerUpsertWebhook', () => {
      it('creates a new webhook when no existing webhookData', async () => {
        setOAuthToken(service)

        mockClient.webhooks.saveWebhook.mockResolvedValue({ id: 'wh-1', url: 'https://callback.url' })

        const invocation = {
          events: [{ name: 'onRecordCreated', triggerData: { appId: 'app-1' } }],
          callbackUrl: 'https://callback.url',
          connectionId: 'conn-1',
        }

        const result = await service.handleTriggerUpsertWebhook(invocation)

        expect(createClient).toHaveBeenCalledWith(CLUSTER_URL_US, ACCESS_TOKEN)
        expect(mockClient.webhooks.saveWebhook).toHaveBeenCalledWith('app-1', {
          url: 'https://callback.url',
          enabledOperations: [{ service: 'DATA_SERVICE', operation: 'CREATE' }],
        })
        expect(result).toEqual({
          webhookData: { id: 'wh-1', url: 'https://callback.url', appId: 'app-1' },
          connectionId: 'conn-1',
        })
      })

      it('deletes old webhook before creating new one when webhookData exists', async () => {
        setOAuthToken(service)

        mockClient.webhooks.deleteWebhook.mockResolvedValue(true)
        mockClient.webhooks.saveWebhook.mockResolvedValue({ id: 'wh-2' })

        const invocation = {
          webhookData: { id: 'wh-old', appId: 'app-1' },
          events: [{ name: 'onRecordUpdated', triggerData: { appId: 'app-1' } }],
          callbackUrl: 'https://callback.url',
          connectionId: 'conn-1',
        }

        await service.handleTriggerUpsertWebhook(invocation)

        expect(mockClient.webhooks.deleteWebhook).toHaveBeenCalledWith('app-1', 'wh-old')
        expect(mockClient.webhooks.saveWebhook).toHaveBeenCalled()
      })

      it('groups multiple events and deduplicates operations', async () => {
        setOAuthToken(service)

        mockClient.webhooks.saveWebhook.mockResolvedValue({ id: 'wh-3' })

        const invocation = {
          events: [
            { name: 'onRecordCreated', triggerData: { appId: 'app-1' } },
            { name: 'onRecordUpdated', triggerData: { appId: 'app-1' } },
            { name: 'onFileUploaded', triggerData: { appId: 'app-1' } },
          ],
          callbackUrl: 'https://callback.url',
          connectionId: 'conn-1',
        }

        await service.handleTriggerUpsertWebhook(invocation)

        const savedOps = mockClient.webhooks.saveWebhook.mock.calls[0][1].enabledOperations
        expect(savedOps).toHaveLength(3)
        expect(savedOps).toEqual(expect.arrayContaining([
          { service: 'DATA_SERVICE', operation: 'CREATE' },
          { service: 'DATA_SERVICE', operation: 'UPDATE' },
          { service: 'FILE_SERVICE', operation: 'UPLOAD' },
        ]))
      })
    })

    describe('handleTriggerResolveEvents', () => {
      it('resolves events from webhook body operation', async () => {
        const invocation = {
          body: { operation: 'CREATE' },
          queryParams: { connectionId: 'conn-1' },
        }

        const result = await service.handleTriggerResolveEvents(invocation)

        expect(result).toEqual({
          events: [{ name: 'onRecordCreated', data: { operation: 'CREATE' } }],
          connectionId: 'conn-1',
        })
      })

      it('returns null for unknown operation', async () => {
        const invocation = {
          body: { operation: 'UNKNOWN_OP' },
          queryParams: { connectionId: 'conn-1' },
        }

        const result = await service.handleTriggerResolveEvents(invocation)

        expect(result).toBeNull()
      })
    })

    describe('handleTriggerSelectMatched', () => {
      it('delegates to the correct event method for filtering', async () => {
        const invocation = {
          eventName: 'onRecordCreated',
          eventData: { tableId: 'table-A' },
          triggers: [
            { id: 't1', data: { tableId: 'table-A' } },
            { id: 't2', data: { tableId: 'table-B' } },
          ],
        }

        const result = await service.handleTriggerSelectMatched(invocation)

        expect(result).toEqual({ ids: ['t1'] })
      })
    })

    describe('handleTriggerDeleteWebhook', () => {
      it('deletes webhook using invocation data', async () => {
        setOAuthToken(service)

        mockClient.webhooks.deleteWebhook.mockResolvedValue(true)

        await service.handleTriggerDeleteWebhook({
          webhookData: { id: 'wh-del', appId: 'app-1' },
        })

        expect(mockClient.webhooks.deleteWebhook).toHaveBeenCalledWith('app-1', 'wh-del')
      })
    })
  })

  // ── Realtime Trigger Event Methods ──

  describe('realtime trigger event methods', () => {
    // Counter triggers filter by counter name
    const counterTriggers = [
      'onCounterReset',
      'onCounterGetAndIncrement',
      'onCounterIncrementAndGet',
      'onCounterGetAndDecrement',
      'onCounterDecrementAndGet',
      'onCounterAddAndGet',
      'onCounterGetAndAdd',
      'onCounterCompareAndSet',
    ]

    // Data triggers filter by tableId
    const dataTriggers = [
      'onRecordCreated',
      'onRecordUpdated',
      'onRecordDeleted',
    ]

    // File/Messaging/User triggers pass all trigger IDs
    const passAllTriggers = [
      'onFileCopied',
      'onFileDeleted',
      'onFileMoved',
      'onFileRenamed',
      'onFileUploaded',
      'onPushNotificationPublished',
      'onPushNotificationWithTemplateSent',
      'onRegistered',
    ]

    describe('SHAPE_EVENT call type', () => {
      it.each([...counterTriggers, ...dataTriggers, ...passAllTriggers])(
        '%s returns shaped event array',
        (methodName) => {
          const payload = { some: 'data' }
          const result = service[methodName]('SHAPE_EVENT', payload)

          expect(result).toEqual([
            { name: methodName, data: payload },
          ])
        }
      )
    })

    describe('FILTER_TRIGGER call type for counter events', () => {
      it.each(counterTriggers)(
        '%s filters by counterName',
        (methodName) => {
          const payload = {
            eventData: { counterName: 'pageViews' },
            triggers: [
              { id: 't1', data: { counter: 'pageViews' } },
              { id: 't2', data: { counter: 'otherCounter' } },
            ],
          }

          const result = service[methodName]('FILTER_TRIGGER', payload)

          expect(result).toEqual({ ids: ['t1'] })
        }
      )
    })

    describe('FILTER_TRIGGER call type for data events', () => {
      it.each(dataTriggers)(
        '%s filters by tableId',
        (methodName) => {
          const payload = {
            eventData: { tableId: 'table-X' },
            triggers: [
              { id: 't1', data: { tableId: 'table-X' } },
              { id: 't2', data: { tableId: 'table-Y' } },
              { id: 't3', data: { tableId: 'table-X' } },
            ],
          }

          const result = service[methodName]('FILTER_TRIGGER', payload)

          expect(result).toEqual({ ids: ['t1', 't3'] })
        }
      )
    })

    describe('FILTER_TRIGGER call type for pass-all events', () => {
      it.each(passAllTriggers)(
        '%s returns all trigger IDs',
        (methodName) => {
          const payload = {
            triggers: [
              { id: 't1', data: {} },
              { id: 't2', data: {} },
            ],
          }

          const result = service[methodName]('FILTER_TRIGGER', payload)

          expect(result).toEqual({ ids: ['t1', 't2'] })
        }
      )
    })

    describe('onTimerExecute', () => {
      it('filters by timerName in FILTER_TRIGGER', () => {
        const payload = {
          eventData: { timerName: 'dailyCleanup' },
          triggers: [
            { id: 't1', data: { timername: 'dailyCleanup' } },
            { id: 't2', data: { timername: 'hourlySync' } },
          ],
        }

        const result = service.onTimerExecute('FILTER_TRIGGER', payload)

        expect(result).toEqual({ ids: ['t1'] })
      })

      it('shapes event correctly', () => {
        const payload = { timerName: 'test', executionTime: 12345 }
        const result = service.onTimerExecute('SHAPE_EVENT', payload)

        expect(result).toEqual([{ name: 'onTimerExecute', data: payload }])
      })
    })
  })

  // ── Dictionary Methods ──

  describe('dictionary methods', () => {
    describe('getAppsDictionary', () => {
      it('returns all apps when no search', async () => {
        setOAuthToken(service)

        mockClient.apps.getApps.mockResolvedValue([
          { id: 'app-1', name: 'My App' },
          { id: 'app-2', name: 'Other App' },
        ])

        const result = await service.getAppsDictionary({})

        expect(result.items).toHaveLength(2)
        expect(result.items[0]).toEqual({
          label: 'My App',
          value: 'app-1',
          note: 'ID: app-1 ',
        })
      })

      it('filters apps by search string (case-insensitive)', async () => {
        setOAuthToken(service)

        mockClient.apps.getApps.mockResolvedValue([
          { id: 'app-1', name: 'My App' },
          { id: 'app-2', name: 'Other App' },
        ])

        const result = await service.getAppsDictionary({ search: 'other' })

        expect(result.items).toHaveLength(1)
        expect(result.items[0].label).toBe('Other App')
      })
    })

    describe('getApiKeysDictionary', () => {
      it('returns API keys for the specified app', async () => {
        setOAuthToken(service)

        mockClient.settings.getAppSettings.mockResolvedValue({
          apiKeys: [
            { name: 'REST', apiKey: 'rest-key-123' },
            { name: 'JS', apiKey: 'js-key-456' },
          ],
        })

        const result = await service.getApiKeysDictionary({ criteria: { appId: 'app-1' } })

        expect(mockClient.settings.getAppSettings).toHaveBeenCalledWith('app-1')
        expect(result.items).toHaveLength(2)
        expect(result.items[0]).toEqual({ label: 'REST', value: 'rest-key-123' })
      })

      it('filters API keys by search', async () => {
        setOAuthToken(service)

        mockClient.settings.getAppSettings.mockResolvedValue({
          apiKeys: [
            { name: 'REST', apiKey: 'rest-key' },
            { name: 'JS', apiKey: 'js-key' },
          ],
        })

        const result = await service.getApiKeysDictionary({ search: 'js', criteria: { appId: 'app-1' } })

        expect(result.items).toHaveLength(1)
        expect(result.items[0].label).toBe('JS')
      })
    })

    describe('getTimersDictionary', () => {
      it('returns timers for the specified app', async () => {
        setOAuthToken(service)

        mockClient.bl.getEventHandlers.mockResolvedValue([
          { id: 'timer-1', timername: 'dailyCleanup', model: 'TIMER', language: 'JS' },
        ])

        const result = await service.getTimersDictionary({ criteria: { appId: 'app-1' } })

        expect(mockClient.bl.getEventHandlers).toHaveBeenCalledWith('app-1', ['PRODUCTION'])
        expect(result.items).toHaveLength(1)
        expect(result.items[0]).toEqual({
          label: 'dailyCleanup',
          value: 'timer-1',
          note: 'TIMER (JS)',
        })
      })

      it('filters timers by search', async () => {
        setOAuthToken(service)

        mockClient.bl.getEventHandlers.mockResolvedValue([
          { id: 't1', timername: 'dailyCleanup', model: 'TIMER', language: 'JS' },
          { id: 't2', timername: 'hourlySync', model: 'TIMER', language: 'JS' },
        ])

        const result = await service.getTimersDictionary({ search: 'daily', criteria: { appId: 'app-1' } })

        expect(result.items).toHaveLength(1)
        expect(result.items[0].label).toBe('dailyCleanup')
      })
    })

    describe('getCounterNamesDictionary', () => {
      it('returns counter names', async () => {
        setOAuthToken(service)

        mockClient.counters.listNames.mockResolvedValue(['pageViews', 'loginCount'])

        const result = await service.getCounterNamesDictionary({ criteria: { appId: 'app-1' } })

        expect(result.items).toHaveLength(2)
        expect(result.items[0]).toEqual({ label: 'pageViews', value: 'pageViews' })
      })

      it('filters counters by search', async () => {
        setOAuthToken(service)

        mockClient.counters.listNames.mockResolvedValue(['pageViews', 'loginCount'])

        const result = await service.getCounterNamesDictionary({ search: 'login', criteria: { appId: 'app-1' } })

        expect(result.items).toHaveLength(1)
        expect(result.items[0].label).toBe('loginCount')
      })
    })

    describe('getTableIdsDictionary', () => {
      it('returns tables with IDs as values', async () => {
        setOAuthToken(service)

        mockClient.tables.get.mockResolvedValue({
          tables: [
            { tableId: 'tid-1', name: 'Users' },
            { tableId: 'tid-2', name: 'Orders' },
          ],
        })

        const result = await service.getTableIdsDictionary({ criteria: { appId: 'app-1' } })

        expect(result.items).toHaveLength(2)
        expect(result.items[0]).toEqual({
          label: 'Users',
          value: 'tid-1',
          note: 'ID: tid-1 ',
        })
      })

      it('filters tables by search', async () => {
        setOAuthToken(service)

        mockClient.tables.get.mockResolvedValue({
          tables: [
            { tableId: 'tid-1', name: 'Users' },
            { tableId: 'tid-2', name: 'Orders' },
          ],
        })

        const result = await service.getTableIdsDictionary({ search: 'ord', criteria: { appId: 'app-1' } })

        expect(result.items).toHaveLength(1)
        expect(result.items[0].label).toBe('Orders')
      })
    })

    describe('getTableNamesDictionary', () => {
      it('returns tables with names as values', async () => {
        setOAuthToken(service)

        mockClient.tables.get.mockResolvedValue({
          tables: [{ tableId: 'tid-1', name: 'Users' }],
        })

        const result = await service.getTableNamesDictionary({ criteria: { appId: 'app-1' } })

        expect(result.items[0]).toEqual({
          label: 'Users',
          value: 'Users',
          note: 'ID: tid-1 ',
        })
      })
    })

    describe('getTablesAndViewsDictionary', () => {
      it('returns both tables and views', async () => {
        setOAuthToken(service)

        mockClient.tables.get.mockResolvedValue({
          tables: [{ tableId: 'tid-1', name: 'Users' }],
        })
        mockClient.dataViews.getViews.mockResolvedValue([
          { viewId: 'vid-1', name: 'ActiveUsers' },
        ])

        const result = await service.getTablesAndViewsDictionary({ criteria: { appId: 'app-1' } })

        expect(result.items).toHaveLength(2)
        expect(result.items[0]).toEqual({ label: 'Users', value: 'Users', note: 'ID: tid-1 ' })
        expect(result.items[1]).toEqual({ label: 'ActiveUsers', value: 'ActiveUsers', note: 'ID: vid-1 ' })
      })

      it('filters tables and views by search', async () => {
        setOAuthToken(service)

        mockClient.tables.get.mockResolvedValue({
          tables: [{ tableId: 'tid-1', name: 'Users' }],
        })
        mockClient.dataViews.getViews.mockResolvedValue([
          { viewId: 'vid-1', name: 'ActiveUsers' },
        ])

        const result = await service.getTablesAndViewsDictionary({ search: 'active', criteria: { appId: 'app-1' } })

        expect(result.items).toHaveLength(1)
        expect(result.items[0].label).toBe('ActiveUsers')
      })
    })

    describe('getEmailTemplatesDictionary', () => {
      it('returns email templates', async () => {
        setOAuthToken(service)

        mockClient.email.loadCustomTemplates.mockResolvedValue([
          { name: 'welcome-email' },
          { name: 'password-reset' },
        ])

        const result = await service.getEmailTemplatesDictionary({ criteria: { appId: 'app-1' } })

        expect(result.items).toHaveLength(2)
        expect(result.items[0]).toEqual({ label: 'welcome-email', value: 'welcome-email' })
      })

      it('filters by search', async () => {
        setOAuthToken(service)

        mockClient.email.loadCustomTemplates.mockResolvedValue([
          { name: 'welcome-email' },
          { name: 'password-reset' },
        ])

        const result = await service.getEmailTemplatesDictionary({ search: 'pass', criteria: { appId: 'app-1' } })

        expect(result.items).toHaveLength(1)
        expect(result.items[0].label).toBe('password-reset')
      })
    })

    describe('getPushTemplatesDictionary', () => {
      it('returns push templates with IDs', async () => {
        setOAuthToken(service)

        mockClient.messaging.getPushTemplates.mockResolvedValue([
          { id: 'pt-1', name: 'promo-push' },
        ])

        const result = await service.getPushTemplatesDictionary({ criteria: { appId: 'app-1' } })

        expect(result.items[0]).toEqual({
          label: 'promo-push',
          value: 'promo-push',
          note: 'ID: pt-1',
        })
      })
    })

    describe('getPdfTemplatesDictionary', () => {
      it('returns PDF templates with IDs as values', async () => {
        setOAuthToken(service)

        mockClient.pdf.listTemplates.mockResolvedValue([
          { id: 'pdf-1', name: 'invoice-template' },
        ])

        const result = await service.getPdfTemplatesDictionary({ criteria: { appId: 'app-1' } })

        expect(result.items[0]).toEqual({
          label: 'invoice-template',
          value: 'pdf-1',
          note: 'ID: pdf-1',
        })
      })
    })
  })

  // ── Schema Loader ──

  describe('createRecordFieldsSchemaLoader', () => {
    it('returns empty array when appId or tableName is missing', async () => {
      const result = await service.createRecordFieldsSchemaLoader({ criteria: {} })
      expect(result).toEqual([])
    })

    it('returns empty array when table is not found', async () => {
      setOAuthToken(service)

      mockClient.tables.get.mockResolvedValue({
        tables: [{ name: 'Users', columns: [] }],
      })

      const result = await service.createRecordFieldsSchemaLoader({
        criteria: { appId: 'app-1', tableName: 'NonExistent' },
      })

      expect(result).toEqual([])
    })

    it('returns column schemas excluding system columns', async () => {
      setOAuthToken(service)

      mockClient.tables.get.mockResolvedValue({
        tables: [{
          name: 'Users',
          columns: [
            { name: 'objectId', dataType: 'STRING_ID', required: true },
            { name: '___class', dataType: 'STRING', required: false },
            { name: 'created', dataType: 'DATETIME', required: false },
            { name: 'updated', dataType: 'DATETIME', required: false },
            { name: 'ownerId', dataType: 'STRING', required: false },
            { name: 'email', dataType: 'STRING', required: true },
            { name: 'age', dataType: 'INT', required: false },
            { name: 'bio', dataType: 'TEXT', required: false },
            { name: 'active', dataType: 'BOOLEAN', required: false },
            { name: 'score', dataType: 'DOUBLE', required: false },
            { name: 'lastLogin', dataType: 'DATETIME', required: false },
            { name: 'counter', dataType: 'AUTO_INCREMENT', required: false },
          ],
        }],
      })

      const result = await service.createRecordFieldsSchemaLoader({
        criteria: { appId: 'app-1', tableName: 'Users' },
      })

      // System columns filtered out
      expect(result.find(c => c.name === 'objectId')).toBeUndefined()
      expect(result.find(c => c.name === '___class')).toBeUndefined()
      expect(result.find(c => c.name === 'created')).toBeUndefined()

      // User columns present with correct UI components
      const emailCol = result.find(c => c.name === 'email')
      expect(emailCol).toMatchObject({
        type: 'STRING',
        label: 'email',
        required: true,
        uiComponent: { type: 'SINGLE_LINE_TEXT' },
      })

      const ageCol = result.find(c => c.name === 'age')
      expect(ageCol.uiComponent).toEqual({ type: 'NUMERIC_STEPPER' })

      const bioCol = result.find(c => c.name === 'bio')
      expect(bioCol.uiComponent).toEqual({ type: 'MULTI_LINE_TEXT' })

      const activeCol = result.find(c => c.name === 'active')
      expect(activeCol.uiComponent).toEqual({ type: 'TOGGLE' })

      const scoreCol = result.find(c => c.name === 'score')
      expect(scoreCol.uiComponent).toEqual({ type: 'NUMERIC_STEPPER' })

      const lastLoginCol = result.find(c => c.name === 'lastLogin')
      expect(lastLoginCol.uiComponent).toEqual({ type: 'DATE_TIME_PICKER' })

      const counterCol = result.find(c => c.name === 'counter')
      expect(counterCol.uiComponent).toEqual({ type: 'NUMERIC_STEPPER' })
    })
  })

  // ── Action Methods: Database ──

  describe('database actions', () => {
    beforeEach(() => {
      setOAuthToken(service)
      // Reset apiSDK cache
      service.apiSDK = undefined

      mockClient.system.loadStatus.mockResolvedValue({ apiURL: 'https://api.backendless.com' })
      mockClient.settings.getAppSettings.mockResolvedValue({ apiKeysMap: { REST: 'rest-key' } })
      mockBackendless.initApp.mockReturnValue({
        Data: { of: jest.fn(() => mockStore) },
        DataQueryBuilder: { create: jest.fn(() => mockQueryBuilder) },
        Files: {
          createDirectory: jest.fn(),
          remove: jest.fn(),
          append: jest.fn(),
          appendText: jest.fn(),
          saveFile: jest.fn(),
        },
        EmailEnvelope: { create: jest.fn(() => mockEmailEnvelope) },
        Messaging: {
          sendEmailFromTemplate: jest.fn(),
          pushWithTemplate: jest.fn(),
        },
        Request: { get: jest.fn() },
        appPath: '/app-path',
      })
    })

    describe('deleteRecord', () => {
      it('removes a record by ID', async () => {
        mockStore.remove.mockResolvedValue({})

        const result = await service.deleteRecord('app-1', null, 'Users', 'obj-123')

        expect(mockStore.remove).toHaveBeenCalledWith('obj-123')
        expect(result).toEqual({})
      })
    })

    describe('deleteRecords', () => {
      it('bulk deletes with whereClause', async () => {
        mockStore.bulkDelete.mockResolvedValue(5)

        const result = await service.deleteRecords('app-1', null, 'Users', "status='inactive'")

        expect(mockStore.bulkDelete).toHaveBeenCalledWith("status='inactive'")
        expect(result).toEqual({ deletedCount: 5 })
      })

      it('bulk deletes with objectIds', async () => {
        mockStore.bulkDelete.mockResolvedValue(2)

        const result = await service.deleteRecords('app-1', null, 'Users', undefined, ['id-1', 'id-2'])

        expect(mockStore.bulkDelete).toHaveBeenCalledWith(['id-1', 'id-2'])
        expect(result).toEqual({ deletedCount: 2 })
      })

      it('throws when neither whereClause nor objectIds provided', async () => {
        await expect(
          service.deleteRecords('app-1', null, 'Users')
        ).rejects.toThrow('Either `whereClause` or `objectIds` must be provided.')
      })
    })

    describe('findRecords', () => {
      it('finds records with defaults', async () => {
        const records = [{ objectId: 'obj-1', name: 'Test' }]
        mockStore.find.mockResolvedValue(records)
        mockStore.getObjectCount.mockResolvedValue(1)

        const result = await service.findRecords('app-1', null, 'Users')

        expect(result).toEqual({ records, totalCount: 1 })
      })

      it('applies whereClause, sortBy, pageSize, offset', async () => {
        mockStore.find.mockResolvedValue([])
        mockStore.getObjectCount.mockResolvedValue(0)

        await service.findRecords('app-1', null, 'Users', "age > 18", 'name ASC, created DESC', 10, 20)

        expect(mockQueryBuilder.setWhereClause).toHaveBeenCalledWith("age > 18")
        expect(mockQueryBuilder.setSortBy).toHaveBeenCalledWith(['name ASC', 'created DESC'])
        expect(mockQueryBuilder.setPageSize).toHaveBeenCalledWith(10)
        expect(mockQueryBuilder.setOffset).toHaveBeenCalledWith(20)
      })

      it('does not set optional params when not provided', async () => {
        mockStore.find.mockResolvedValue([])
        mockStore.getObjectCount.mockResolvedValue(0)

        await service.findRecords('app-1', null, 'Users')

        expect(mockQueryBuilder.setWhereClause).not.toHaveBeenCalled()
        expect(mockQueryBuilder.setSortBy).not.toHaveBeenCalled()
        expect(mockQueryBuilder.setPageSize).not.toHaveBeenCalled()
        expect(mockQueryBuilder.setOffset).not.toHaveBeenCalled()
      })
    })

    describe('saveRecord', () => {
      it('saves record fields', async () => {
        const savedRecord = { objectId: 'new-1', name: 'John' }
        mockStore.save.mockResolvedValue(savedRecord)

        const result = await service.saveRecord('app-1', null, 'Users', { name: 'John' })

        expect(mockStore.save).toHaveBeenCalledWith({ name: 'John' })
        expect(result).toEqual(savedRecord)
      })

      it('saves empty object when fields not provided', async () => {
        mockStore.save.mockResolvedValue({ objectId: 'new-2' })

        await service.saveRecord('app-1', null, 'Users')

        expect(mockStore.save).toHaveBeenCalledWith({})
      })
    })

    describe('updateRecordsWithQuery', () => {
      it('bulk updates with where clause and fields', async () => {
        mockStore.bulkUpdate.mockResolvedValue(12)

        const result = await service.updateRecordsWithQuery(
          'app-1', null, 'Users', "status='active'", { role: 'admin' }
        )

        expect(mockStore.bulkUpdate).toHaveBeenCalledWith("status='active'", { role: 'admin' })
        expect(result).toEqual({ updatedCount: 12 })
      })

      it('cleans up null/undefined/empty fields', async () => {
        mockStore.bulkUpdate.mockResolvedValue(1)

        await service.updateRecordsWithQuery(
          'app-1', null, 'Users', "id='1'", { name: 'Bob', empty: '', nul: null, undef: undefined, valid: 'yes' }
        )

        expect(mockStore.bulkUpdate).toHaveBeenCalledWith("id='1'", { name: 'Bob', valid: 'yes' })
      })
    })
  })

  // ── Action Methods: Files ──

  describe('file actions', () => {
    let mockApiSdk

    beforeEach(() => {
      setOAuthToken(service)
      service.apiSDK = undefined
      service.apiInfo = undefined

      mockApiSdk = {
        Data: { of: jest.fn(() => mockStore) },
        DataQueryBuilder: { create: jest.fn(() => mockQueryBuilder) },
        Files: {
          createDirectory: jest.fn(),
          remove: jest.fn(),
          append: jest.fn(),
          appendText: jest.fn(),
          saveFile: jest.fn(),
        },
        EmailEnvelope: { create: jest.fn(() => mockEmailEnvelope) },
        Messaging: {
          sendEmailFromTemplate: jest.fn(),
          pushWithTemplate: jest.fn(),
        },
        Request: { get: jest.fn() },
        appPath: '/app-path',
      }

      mockClient.system.loadStatus.mockResolvedValue({ apiURL: 'https://api.backendless.com' })
      mockClient.settings.getAppSettings.mockResolvedValue({ apiKeysMap: { REST: 'rest-key' } })
      mockBackendless.initApp.mockReturnValue(mockApiSdk)
    })

    describe('createDirectory', () => {
      it('creates a directory at the specified path', async () => {
        mockApiSdk.Files.createDirectory.mockResolvedValue(true)

        const result = await service.createDirectory('app-1', null, '/uploads/images')

        expect(mockApiSdk.Files.createDirectory).toHaveBeenCalledWith('/uploads/images')
        expect(result).toEqual({ directoryPath: '/uploads/images' })
      })

      it('normalizes empty path to root', async () => {
        mockApiSdk.Files.createDirectory.mockResolvedValue(true)

        const result = await service.createDirectory('app-1', null, '')

        expect(mockApiSdk.Files.createDirectory).toHaveBeenCalledWith('/')
        expect(result).toEqual({ directoryPath: '/' })
      })
    })

    describe('deleteFile', () => {
      it('deletes file and returns deleted true', async () => {
        mockApiSdk.Files.remove.mockResolvedValue(true)

        const result = await service.deleteFile('app-1', null, '/docs/test.txt')

        expect(mockApiSdk.Files.remove).toHaveBeenCalledWith('/docs/test.txt')
        expect(result).toEqual({ deleted: true })
      })

      it('returns deleted false when file not found and failIfFileNotFound is false', async () => {
        const error = new Error('File not found')
        error.code = 6000
        mockApiSdk.Files.remove.mockRejectedValue(error)

        const result = await service.deleteFile('app-1', null, '/docs/missing.txt', false)

        expect(result).toEqual({ deleted: false })
      })

      it('throws when file not found and failIfFileNotFound is true', async () => {
        const error = new Error('File not found')
        error.code = 6000
        mockApiSdk.Files.remove.mockRejectedValue(error)

        await expect(
          service.deleteFile('app-1', null, '/docs/missing.txt', true)
        ).rejects.toThrow('File not found')
      })

      it('throws on non-6000 errors regardless of failIfFileNotFound', async () => {
        const error = new Error('Permission denied')
        error.code = 5000
        mockApiSdk.Files.remove.mockRejectedValue(error)

        await expect(
          service.deleteFile('app-1', null, '/docs/locked.txt', false)
        ).rejects.toThrow('Permission denied')
      })
    })

    describe('addToFile', () => {
      it('throws when neither content nor contentFromUrl is provided', async () => {
        await expect(
          service.addToFile('app-1', null, '/logs', 'app.log')
        ).rejects.toThrow('Please provide one of the arguments: Content or Content from URL')
      })

      it('appends text content to file', async () => {
        mockApiSdk.Files.appendText.mockResolvedValue('https://internal.backendless.com/api/files/logs/app.log')

        // Mock #getServerBaseURL and #getPublicBaseURL chain
        const mockGetResponse = jest.fn()
        mockApiSdk.Request.get.mockReturnValue({ query: jest.fn().mockResolvedValue({}) })

        // Simplify by mocking the internal #replaceWithPublicBaseURL behavior
        // Since apiInfo is not cached, it will try to call #appRequest
        // We need to mock the chain properly
        mockApiSdk.Request.get = jest.fn().mockImplementation((url) => {
          if (url.includes('/info')) {
            return Promise.resolve({
              filesURL: 'https://internal.backendless.com',
              appId: 'app-1',
              apiKey: 'rest-key',
              apiURL: 'https://api.backendless.com',
            })
          }
          if (url.includes('/domains')) {
            return Promise.resolve([])
          }
          return Promise.resolve({})
        })

        const result = await service.addToFile('app-1', null, '/logs', 'app.log', 'log entry\n')

        expect(mockApiSdk.Files.appendText).toHaveBeenCalled()
        expect(result).toHaveProperty('fileName', 'app.log')
        expect(result).toHaveProperty('directoryPath', '/logs')
      })

      it('strips URL from fileName keeping only the filename part', async () => {
        mockApiSdk.Files.appendText.mockResolvedValue('https://example.com/files/report.csv')
        mockApiSdk.Request.get = jest.fn().mockImplementation((url) => {
          if (url.includes('/info')) {
            return Promise.resolve({
              filesURL: 'https://internal.backendless.com',
              appId: 'app-1',
              apiKey: 'rest-key',
              apiURL: 'https://api.backendless.com',
            })
          }
          if (url.includes('/domains')) {
            return Promise.resolve([])
          }
          return Promise.resolve({})
        })

        const result = await service.addToFile('app-1', null, '/data', 'https://example.com/path/report.csv', 'csv data')

        expect(result.fileName).toBe('report.csv')
      })

      it('converts non-string content to JSON', async () => {
        mockApiSdk.Files.appendText.mockResolvedValue('https://example.com/files/data.json')
        mockApiSdk.Request.get = jest.fn().mockImplementation((url) => {
          if (url.includes('/info')) {
            return Promise.resolve({
              filesURL: 'https://internal.backendless.com',
              appId: 'app-1',
              apiKey: 'rest-key',
              apiURL: 'https://api.backendless.com',
            })
          }
          if (url.includes('/domains')) {
            return Promise.resolve([])
          }
          return Promise.resolve({})
        })

        await service.addToFile('app-1', null, '/data', 'data.json', { key: 'value' })

        expect(mockApiSdk.Files.appendText).toHaveBeenCalledWith(
          '/data/data.json',
          '{"key":"value"}'
        )
      })

      it('appends content from URL', async () => {
        mockApiSdk.Files.append.mockResolvedValue({ fileURL: 'https://example.com/files/data.txt' })
        mockApiSdk.Request.get = jest.fn().mockImplementation((url) => {
          if (url.includes('/info')) {
            return Promise.resolve({
              filesURL: 'https://internal.backendless.com',
              appId: 'app-1',
              apiKey: 'rest-key',
              apiURL: 'https://api.backendless.com',
            })
          }
          if (url.includes('/domains')) {
            return Promise.resolve([])
          }
          return Promise.resolve({})
        })

        const result = await service.addToFile(
          'app-1', null, '/data', 'data.txt', undefined, 'https://source.com/content.txt'
        )

        expect(mockApiSdk.Files.append).toHaveBeenCalledWith(
          '/data/data.txt',
          'https://source.com/content.txt'
        )
        expect(result).toHaveProperty('fileName', 'data.txt')
      })
    })

    describe('createFile', () => {
      it('creates a file with content', async () => {
        mockApiSdk.Files.saveFile.mockResolvedValue('https://example.com/files/report.json')
        mockApiSdk.Request.get = jest.fn().mockImplementation((url) => {
          if (url.includes('/info')) {
            return Promise.resolve({
              filesURL: 'https://internal.backendless.com',
              appId: 'app-1',
              apiKey: 'rest-key',
              apiURL: 'https://api.backendless.com',
            })
          }
          if (url.includes('/domains')) {
            return Promise.resolve([])
          }
          return Promise.resolve({})
        })

        const result = await service.createFile('app-1', null, '/reports', 'report.json', '{"data":true}', true)

        expect(mockApiSdk.Files.saveFile).toHaveBeenCalledWith('/reports', 'report.json', '{"data":true}', true)
        expect(result).toHaveProperty('fileName', 'report.json')
        expect(result).toHaveProperty('directoryPath', '/reports')
      })

      it('converts non-string content to JSON', async () => {
        mockApiSdk.Files.saveFile.mockResolvedValue('https://example.com/files/data.json')
        mockApiSdk.Request.get = jest.fn().mockImplementation((url) => {
          if (url.includes('/info')) {
            return Promise.resolve({
              filesURL: 'https://internal.backendless.com',
              appId: 'app-1',
              apiKey: 'rest-key',
              apiURL: 'https://api.backendless.com',
            })
          }
          if (url.includes('/domains')) {
            return Promise.resolve([])
          }
          return Promise.resolve({})
        })

        await service.createFile('app-1', null, '/', 'data.json', { hello: 'world' })

        expect(mockApiSdk.Files.saveFile).toHaveBeenCalledWith(
          '/', 'data.json', '{"hello":"world"}', undefined
        )
      })
    })

    describe('listDirectory', () => {
      it('lists directory contents with default params', async () => {
        setOAuthToken(service)

        mockClient.files.loadDirectory.mockResolvedValue({
          data: [{ name: 'file.txt' }],
          totalRows: 1,
        })

        const result = await service.listDirectory('app-1', '/docs')

        expect(mockClient.files.loadDirectory).toHaveBeenCalledWith('app-1', '/docs', { sub: false })
        expect(result).toEqual({ data: [{ name: 'file.txt' }], totalRows: 1 })
      })

      it('passes all optional params', async () => {
        setOAuthToken(service)

        mockClient.files.loadDirectory.mockResolvedValue({ data: [], totalRows: 0 })

        await service.listDirectory('app-1', '/docs', '*.pdf', true, 'name', 'desc', 10, 5)

        expect(mockClient.files.loadDirectory).toHaveBeenCalledWith('app-1', '/docs', {
          sub: true,
          pattern: '*.pdf',
          sortBy: 'name',
          sortDirection: 'desc',
          pageSize: 10,
          offset: 5,
        })
      })
    })
  })

  // ── Action Methods: Messaging ──

  describe('messaging actions', () => {
    let mockApiSdk

    beforeEach(() => {
      setOAuthToken(service)
      service.apiSDK = undefined

      mockApiSdk = {
        Data: { of: jest.fn(() => mockStore) },
        DataQueryBuilder: { create: jest.fn(() => mockQueryBuilder) },
        Files: {
          createDirectory: jest.fn(),
          remove: jest.fn(),
          append: jest.fn(),
          appendText: jest.fn(),
          saveFile: jest.fn(),
        },
        EmailEnvelope: { create: jest.fn(() => mockEmailEnvelope) },
        Messaging: {
          sendEmailFromTemplate: jest.fn(),
          pushWithTemplate: jest.fn(),
        },
        Request: { get: jest.fn() },
        appPath: '/app-path',
      }

      mockClient.system.loadStatus.mockResolvedValue({ apiURL: 'https://api.backendless.com' })
      mockClient.settings.getAppSettings.mockResolvedValue({ apiKeysMap: { REST: 'rest-key' } })
      mockBackendless.initApp.mockReturnValue(mockApiSdk)
    })

    describe('sendEmail', () => {
      it('throws when no recipients provided', async () => {
        await expect(
          service.sendEmail('app-1', null, 'welcome')
        ).rejects.toThrow('At least one of "Send To", "CC", "BCC", or "Criteria" must be provided.')
      })

      it('sends email with sendTo recipients', async () => {
        mockApiSdk.Messaging.sendEmailFromTemplate.mockResolvedValue({ messageId: 'msg-1' })

        const result = await service.sendEmail(
          'app-1', null, 'welcome', ['user@example.com']
        )

        expect(mockEmailEnvelope.setTo).toHaveBeenCalledWith(['user@example.com'])
        expect(mockApiSdk.Messaging.sendEmailFromTemplate).toHaveBeenCalledWith(
          'welcome', mockEmailEnvelope, undefined
        )
        expect(result).toEqual({ messageId: 'msg-1' })
      })

      it('sets CC and BCC when provided', async () => {
        mockApiSdk.Messaging.sendEmailFromTemplate.mockResolvedValue({ messageId: 'msg-2' })

        await service.sendEmail(
          'app-1', null, 'template', ['to@test.com'], ['cc@test.com'], ['bcc@test.com']
        )

        expect(mockEmailEnvelope.setTo).toHaveBeenCalledWith(['to@test.com'])
        expect(mockEmailEnvelope.setCc).toHaveBeenCalledWith(['cc@test.com'])
        expect(mockEmailEnvelope.setBcc).toHaveBeenCalledWith(['bcc@test.com'])
      })

      it('sets criteria when provided', async () => {
        mockApiSdk.Messaging.sendEmailFromTemplate.mockResolvedValue({ messageId: 'msg-3' })

        await service.sendEmail(
          'app-1', null, 'template', undefined, undefined, undefined, "name = 'Bob'"
        )

        expect(mockEmailEnvelope.setQuery).toHaveBeenCalledWith("name = 'Bob'")
      })

      it('passes attachments to sendEmailFromTemplate', async () => {
        mockApiSdk.Messaging.sendEmailFromTemplate.mockResolvedValue({ messageId: 'msg-4' })

        await service.sendEmail(
          'app-1', null, 'template', ['to@test.com'], undefined, undefined, undefined, ['docs/file.pdf']
        )

        expect(mockApiSdk.Messaging.sendEmailFromTemplate).toHaveBeenCalledWith(
          'template', mockEmailEnvelope, ['docs/file.pdf']
        )
      })
    })

    describe('sendPushNotification', () => {
      it('sends push notification with template and params', async () => {
        mockApiSdk.Messaging.pushWithTemplate.mockResolvedValue({ messageId: 'push-1' })

        const result = await service.sendPushNotification('app-1', null, 'promo', { name: 'John' })

        expect(mockApiSdk.Messaging.pushWithTemplate).toHaveBeenCalledWith('promo', { name: 'John' })
        expect(result).toEqual({ messageId: 'push-1' })
      })
    })
  })

  // ── Action Methods: PDF ──

  describe('PDF actions', () => {
    describe('generatePDF', () => {
      it('loads template and generates PDF', async () => {
        setOAuthToken(service)

        const template = { html: '<h1>Invoice</h1>', fields: [] }
        mockClient.pdf.loadTemplate.mockResolvedValue(template)
        mockClient.pdf.generatePDF.mockResolvedValue({
          path: 'path/to/folder/report.pdf',
          fileURL: 'https://app.backendless.app/api/files/path/to/folder/report.pdf',
        })

        const result = await service.generatePDF('app-1', null, 'tmpl-1', 'report.pdf', '/path/to/folder', { name: 'Test' })

        expect(mockClient.pdf.loadTemplate).toHaveBeenCalledWith('app-1', 'tmpl-1')
        expect(mockClient.pdf.generatePDF).toHaveBeenCalledWith('app-1', {
          template: JSON.stringify(template),
          values: { name: 'Test' },
          name: 'report.pdf',
          path: '/path/to/folder',
        })
        expect(result).toHaveProperty('path')
      })

      it('uses empty object for values when not provided', async () => {
        setOAuthToken(service)

        mockClient.pdf.loadTemplate.mockResolvedValue({ html: '' })
        mockClient.pdf.generatePDF.mockResolvedValue({ path: 'test.pdf' })

        await service.generatePDF('app-1', null, 'tmpl-1', 'test.pdf', '/output')

        expect(mockClient.pdf.generatePDF).toHaveBeenCalledWith('app-1', expect.objectContaining({
          values: {},
        }))
      })
    })
  })
})
