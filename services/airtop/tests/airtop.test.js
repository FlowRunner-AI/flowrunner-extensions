'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-airtop-api-key'
const BASE = 'https://api.airtop.ai/api/v1'

describe('Airtop Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Mock the Files API injected by FlowRunner runtime (used by takeScreenshot)
    service.flowrunner = {
      Files: {
        uploadFile: jest.fn().mockResolvedValue({
          url: 'https://mock-files.flowrunner.io/uploaded-file',
        }),
      },
    }
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

  // ── Sessions ──

  describe('createSession', () => {
    it('sends POST with default configuration', async () => {
      mock.onPost(`${BASE}/sessions`).reply({ data: { id: 'sess-1', status: 'running' } })

      const result = await service.createSession()

      expect(result).toEqual({ data: { id: 'sess-1', status: 'running' } })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toEqual({ configuration: {} })
    })

    it('sends all optional parameters when provided', async () => {
      mock.onPost(`${BASE}/sessions`).reply({ data: { id: 'sess-2', status: 'running' } })

      await service.createSession(15, 'my-profile', true, true, true)

      expect(mock.history[0].body).toEqual({
        configuration: {
          timeoutMinutes: 15,
          profileName: 'my-profile',
          proxy: true,
          solveCaptcha: true,
          record: true,
        },
      })
    })

    it('omits boolean flags when false', async () => {
      mock.onPost(`${BASE}/sessions`).reply({ data: { id: 'sess-3' } })

      await service.createSession(10, undefined, false, false, false)

      expect(mock.history[0].body).toEqual({
        configuration: { timeoutMinutes: 10 },
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/sessions`).replyWithError({
        message: 'Unauthorized',
        body: { error: 'Invalid API key' },
        status: 401,
      })

      await expect(service.createSession()).rejects.toThrow('Airtop API error')
    })
  })

  describe('getSession', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/sessions/sess-123`).reply({ data: { id: 'sess-123', status: 'running' } })

      const result = await service.getSession('sess-123')

      expect(result).toEqual({ data: { id: 'sess-123', status: 'running' } })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` })
    })
  })

  describe('listSessions', () => {
    it('sends GET with default query params', async () => {
      mock.onGet(`${BASE}/sessions`).reply({ data: { sessions: [], pagination: { totalItems: 0 } } })

      const result = await service.listSessions()

      expect(result).toEqual({ data: { sessions: [], pagination: { totalItems: 0 } } })
      expect(mock.history[0].query).toMatchObject({ limit: 25, offset: 0 })
    })

    it('resolves status choice and passes custom pagination', async () => {
      mock.onGet(`${BASE}/sessions`).reply({ data: { sessions: [] } })

      await service.listSessions('Running', 10, 5)

      expect(mock.history[0].query).toMatchObject({ status: 'running', limit: 10, offset: 5 })
    })

    it('resolves "All" status to undefined (omitted)', async () => {
      mock.onGet(`${BASE}/sessions`).reply({ data: { sessions: [] } })

      await service.listSessions('All')

      expect(mock.history[0].query).not.toHaveProperty('status')
    })

    it('resolves "Awaiting Capacity" status', async () => {
      mock.onGet(`${BASE}/sessions`).reply({ data: { sessions: [] } })

      await service.listSessions('Awaiting Capacity')

      expect(mock.history[0].query).toMatchObject({ status: 'awaitingCapacity' })
    })
  })

  describe('terminateSession', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/sessions/sess-123`).reply({})

      const result = await service.terminateSession('sess-123')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('saveProfileOnTermination', () => {
    it('sends PUT to correct URL and returns success', async () => {
      mock.onPut(`${BASE}/sessions/sess-123/save-profile-on-termination/my-profile`).reply({})

      const result = await service.saveProfileOnTermination('sess-123', 'my-profile')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('put')
    })
  })

  // ── Windows ──

  describe('createWindow', () => {
    it('sends POST with required params', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows`).reply({ data: { windowId: 'win-1' } })

      const result = await service.createWindow('sess-1', 'https://example.com')

      expect(result).toEqual({ data: { windowId: 'win-1' } })
      expect(mock.history[0].body).toMatchObject({ url: 'https://example.com' })
    })

    it('resolves waitUntil choice', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows`).reply({ data: { windowId: 'win-1' } })

      await service.createWindow('sess-1', 'https://example.com', 'DOM Content Loaded', 30)

      expect(mock.history[0].body).toMatchObject({
        url: 'https://example.com',
        waitUntil: 'domContentLoaded',
        waitUntilTimeoutSeconds: 30,
      })
    })

    it('resolves "Complete And No Network Activity"', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows`).reply({ data: { windowId: 'win-1' } })

      await service.createWindow('sess-1', 'https://example.com', 'Complete And No Network Activity')

      expect(mock.history[0].body).toMatchObject({ waitUntil: 'complete' })
    })

    it('resolves "No Wait"', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows`).reply({ data: { windowId: 'win-1' } })

      await service.createWindow('sess-1', 'https://example.com', 'No Wait')

      expect(mock.history[0].body).toMatchObject({ waitUntil: 'noWait' })
    })
  })

  describe('getWindowInfo', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${BASE}/sessions/sess-1/windows/win-1`).reply({
        data: { windowId: 'win-1', liveViewUrl: 'https://portal.airtop.ai/live/...' },
      })

      const result = await service.getWindowInfo('sess-1', 'win-1')

      expect(result.data).toHaveProperty('windowId', 'win-1')
      expect(mock.history[0].method).toBe('get')
    })

    it('passes includeNavigationBar when true', async () => {
      mock.onGet(`${BASE}/sessions/sess-1/windows/win-1`).reply({ data: {} })

      await service.getWindowInfo('sess-1', 'win-1', true)

      expect(mock.history[0].query).toMatchObject({ includeNavigationBar: true })
    })

    it('omits includeNavigationBar when false', async () => {
      mock.onGet(`${BASE}/sessions/sess-1/windows/win-1`).reply({ data: {} })

      await service.getWindowInfo('sess-1', 'win-1', false)

      expect(mock.history[0].query).not.toHaveProperty('includeNavigationBar')
    })
  })

  describe('loadUrl', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1`).reply({ data: { windowId: 'win-1' } })

      await service.loadUrl('sess-1', 'win-1', 'https://example.com/page2', 'Load', 10)

      expect(mock.history[0].body).toEqual({
        url: 'https://example.com/page2',
        waitUntil: 'load',
        waitUntilTimeoutSeconds: 10,
      })
    })
  })

  describe('closeWindow', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/sessions/sess-1/windows/win-1`).reply({})

      const result = await service.closeWindow('sess-1', 'win-1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Content ──

  describe('scrapeContent', () => {
    it('sends POST with empty body', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/scrape-content`).reply({
        data: { modelResponse: '# Hello' },
        meta: { credits: 1 },
      })

      const result = await service.scrapeContent('sess-1', 'win-1')

      expect(result.data).toHaveProperty('modelResponse')
      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('pageQuery', () => {
    it('sends POST with prompt only', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/page-query`).reply({
        data: { modelResponse: 'The price is $10.' },
      })

      const result = await service.pageQuery('sess-1', 'win-1', 'What is the price?')

      expect(result.data.modelResponse).toBe('The price is $10.')
      expect(mock.history[0].body).toEqual({ prompt: 'What is the price?' })
    })

    it('parses outputSchema JSON string into object', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/page-query`).reply({ data: {} })

      const schema = JSON.stringify({ type: 'object', properties: { price: { type: 'string' } } })

      await service.pageQuery('sess-1', 'win-1', 'Get price', schema)

      expect(mock.history[0].body.configuration).toEqual({
        outputSchema: { type: 'object', properties: { price: { type: 'string' } } },
      })
    })

    it('sends invalid schema as-is', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/page-query`).reply({ data: {} })

      await service.pageQuery('sess-1', 'win-1', 'Get price', 'not-json')

      expect(mock.history[0].body.configuration).toEqual({ outputSchema: 'not-json' })
    })

    it('passes followPaginationLinks when true', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/page-query`).reply({ data: {} })

      await service.pageQuery('sess-1', 'win-1', 'Get items', undefined, true)

      expect(mock.history[0].body).toMatchObject({ followPaginationLinks: true })
    })

    it('omits followPaginationLinks when false', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/page-query`).reply({ data: {} })

      await service.pageQuery('sess-1', 'win-1', 'Get items', undefined, false)

      expect(mock.history[0].body).not.toHaveProperty('followPaginationLinks')
    })
  })

  describe('paginatedExtract', () => {
    it('sends POST with prompt', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/paginated-extraction`).reply({
        data: { modelResponse: '[]' },
      })

      await service.paginatedExtract('sess-1', 'win-1', 'Extract products')

      expect(mock.history[0].body).toEqual({ prompt: 'Extract products' })
    })

    it('includes parsed outputSchema', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/paginated-extraction`).reply({ data: {} })

      const schema = JSON.stringify({ type: 'array' })

      await service.paginatedExtract('sess-1', 'win-1', 'Extract products', schema)

      expect(mock.history[0].body.configuration).toEqual({ outputSchema: { type: 'array' } })
    })
  })

  describe('summarizeContent', () => {
    it('sends POST with optional prompt', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/summarize-content`).reply({
        data: { modelResponse: 'Summary here.' },
      })

      await service.summarizeContent('sess-1', 'win-1', 'Focus on pricing')

      expect(mock.history[0].body).toEqual({ prompt: 'Focus on pricing' })
    })

    it('sends POST without prompt', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/summarize-content`).reply({
        data: { modelResponse: 'General summary.' },
      })

      await service.summarizeContent('sess-1', 'win-1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Interactions ──

  describe('clickElement', () => {
    it('sends POST with element description', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/click`).reply({
        data: { modelResponse: 'Clicked.' },
      })

      await service.clickElement('sess-1', 'win-1', 'the Sign In button')

      expect(mock.history[0].body).toEqual({ elementDescription: 'the Sign In button' })
    })

    it('includes waitForNavigation when true', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/click`).reply({ data: {} })

      await service.clickElement('sess-1', 'win-1', 'the link', true)

      expect(mock.history[0].body).toMatchObject({ waitForNavigation: true })
    })

    it('omits waitForNavigation when false', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/click`).reply({ data: {} })

      await service.clickElement('sess-1', 'win-1', 'the link', false)

      expect(mock.history[0].body).not.toHaveProperty('waitForNavigation')
    })
  })

  describe('typeText', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/type`).reply({ data: {} })

      await service.typeText('sess-1', 'win-1', 'hello', 'the search box')

      expect(mock.history[0].body).toEqual({
        text: 'hello',
        elementDescription: 'the search box',
      })
    })

    it('includes all boolean flags when true', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/type`).reply({ data: {} })

      await service.typeText('sess-1', 'win-1', 'hello', 'the search box', true, true, true)

      expect(mock.history[0].body).toMatchObject({
        clearInputField: true,
        pressEnterKey: true,
        pressTabKey: true,
      })
    })

    it('omits boolean flags when false', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/type`).reply({ data: {} })

      await service.typeText('sess-1', 'win-1', 'hello', 'the search box', false, false, false)

      expect(mock.history[0].body).not.toHaveProperty('clearInputField')
      expect(mock.history[0].body).not.toHaveProperty('pressEnterKey')
      expect(mock.history[0].body).not.toHaveProperty('pressTabKey')
    })
  })

  describe('hoverElement', () => {
    it('sends POST with element description', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/hover`).reply({ data: {} })

      await service.hoverElement('sess-1', 'win-1', 'the Products menu')

      expect(mock.history[0].body).toEqual({ elementDescription: 'the Products menu' })
    })
  })

  describe('scrollPage', () => {
    it('sends scrollToEdge resolved choice', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/scroll`).reply({ data: {} })

      await service.scrollPage('sess-1', 'win-1', 'Bottom')

      expect(mock.history[0].body).toMatchObject({ scrollToEdge: 'bottom' })
    })

    it('sends scrollToElement', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/scroll`).reply({ data: {} })

      await service.scrollPage('sess-1', 'win-1', undefined, 'the reviews section')

      expect(mock.history[0].body).toMatchObject({ scrollToElement: 'the reviews section' })
      expect(mock.history[0].body).not.toHaveProperty('scrollToEdge')
    })

    it('resolves all edge choices', async () => {
      const edges = { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' }

      for (const [label, value] of Object.entries(edges)) {
        mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/scroll`).reply({ data: {} })

        await service.scrollPage('sess-1', 'win-1', label)

        expect(mock.history[mock.history.length - 1].body).toMatchObject({ scrollToEdge: value })
      }
    })
  })

  // ── Screenshot ──

  describe('takeScreenshot', () => {
    it('sends POST, extracts base64, uploads file, returns url', async () => {
      const base64Data = Buffer.from('fake-png-data').toString('base64')

      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/screenshot`).reply({
        data: { screenshot: `data:image/png;base64,${base64Data}` },
      })

      const result = await service.takeScreenshot('sess-1', 'win-1')

      expect(result).toHaveProperty('url', 'https://mock-files.flowrunner.io/uploaded-file')
      expect(result).toHaveProperty('filename')
      expect(result.filename).toMatch(/^airtop_screenshot_\d+\.png$/)
    })

    it('extracts screenshot from data.screenshot.dataUrl', async () => {
      const base64Data = Buffer.from('fake-png').toString('base64')

      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/screenshot`).reply({
        data: { screenshot: { dataUrl: `data:image/png;base64,${base64Data}` } },
      })

      const result = await service.takeScreenshot('sess-1', 'win-1')

      expect(result).toHaveProperty('url')
    })

    it('extracts screenshot from data.screenshots array', async () => {
      const base64Data = Buffer.from('fake-png').toString('base64')

      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/screenshot`).reply({
        data: { screenshots: [{ dataUrl: `data:image/png;base64,${base64Data}` }] },
      })

      const result = await service.takeScreenshot('sess-1', 'win-1')

      expect(result).toHaveProperty('url')
    })

    it('extracts screenshot from data.dataUrl', async () => {
      const base64Data = Buffer.from('fake-png').toString('base64')

      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/screenshot`).reply({
        data: { dataUrl: `data:image/png;base64,${base64Data}` },
      })

      const result = await service.takeScreenshot('sess-1', 'win-1')

      expect(result).toHaveProperty('url')
    })

    it('throws when no image data in response', async () => {
      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/screenshot`).reply({ data: {} })

      await expect(service.takeScreenshot('sess-1', 'win-1')).rejects.toThrow(
        'screenshot response did not include image data'
      )
    })

    it('uses provided fileOptions', async () => {
      const base64Data = Buffer.from('fake-png').toString('base64')

      mock.onPost(`${BASE}/sessions/sess-1/windows/win-1/screenshot`).reply({
        data: { screenshot: base64Data },
      })

      await service.takeScreenshot('sess-1', 'win-1', { scope: 'WORKSPACE' })

      // The file upload is handled by the sandbox mock; we verify the method doesn't throw
    })
  })

  // ── Dictionary ──

  describe('getSessionsDictionary', () => {
    it('fetches sessions and maps to dictionary items', async () => {
      mock.onGet(`${BASE}/sessions`).reply({
        data: {
          sessions: [
            { id: '6a4b8f7e-1c2d-4e5f-9a0b-1c2d3e4f5a6b', status: 'running' },
            { id: 'abc12345-dead-beef-cafe-000000000000', status: 'ended' },
          ],
        },
      })

      const result = await service.getSessionsDictionary()

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: '6a4b8f7e (running)',
        value: '6a4b8f7e-1c2d-4e5f-9a0b-1c2d3e4f5a6b',
        note: 'running',
      })
      expect(result.items[1]).toEqual({
        label: 'abc12345 (ended)',
        value: 'abc12345-dead-beef-cafe-000000000000',
        note: 'ended',
      })
    })

    it('filters by search text', async () => {
      mock.onGet(`${BASE}/sessions`).reply({
        data: {
          sessions: [
            { id: '6a4b8f7e-1111', status: 'running' },
            { id: 'xyz99999-2222', status: 'running' },
          ],
        },
      })

      const result = await service.getSessionsDictionary({ search: '6a4b' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('6a4b8f7e-1111')
    })

    it('uses cursor as offset', async () => {
      mock.onGet(`${BASE}/sessions`).reply({ data: { sessions: [] } })

      await service.getSessionsDictionary({ cursor: '50' })

      expect(mock.history[0].query).toMatchObject({ offset: 50, limit: 25 })
    })

    it('returns next cursor when results equal limit', async () => {
      const sessions = Array.from({ length: 25 }, (_, i) => ({
        id: `sess-${i}`,
        status: 'running',
      }))

      mock.onGet(`${BASE}/sessions`).reply({ data: { sessions } })

      const result = await service.getSessionsDictionary()

      expect(result.cursor).toBe('25')
    })

    it('returns no cursor when results less than limit', async () => {
      mock.onGet(`${BASE}/sessions`).reply({
        data: { sessions: [{ id: 'sess-1', status: 'running' }] },
      })

      const result = await service.getSessionsDictionary()

      expect(result.cursor).toBeUndefined()
    })

    it('handles empty payload', async () => {
      mock.onGet(`${BASE}/sessions`).reply({ data: { sessions: [] } })

      const result = await service.getSessionsDictionary()

      expect(result.items).toEqual([])
      expect(result.cursor).toBeUndefined()
    })

    it('handles null/missing sessions in response', async () => {
      mock.onGet(`${BASE}/sessions`).reply({ data: {} })

      const result = await service.getSessionsDictionary()

      expect(result.items).toEqual([])
    })
  })
})
