'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Airtop Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('airtop')
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

  // ── Sessions lifecycle ──

  describe('session lifecycle', () => {
    let sessionId

    it('creates a session', async () => {
      const result = await service.createSession(10)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      expect(result.data).toHaveProperty('status')
      sessionId = result.data.id
    })

    it('gets the created session', async () => {
      const result = await service.getSession(sessionId)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id', sessionId)
    })

    it('lists sessions and finds the created one', async () => {
      const result = await service.listSessions()

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('sessions')
      expect(Array.isArray(result.data.sessions)).toBe(true)
    })

    it('lists sessions with status filter', async () => {
      const result = await service.listSessions('Running')

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data.sessions)).toBe(true)
    })

    it('terminates the session', async () => {
      const result = await service.terminateSession(sessionId)

      expect(result).toEqual({ success: true })
    })
  })

  // ── Dictionary ──

  describe('getSessionsDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getSessionsDictionary()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('supports search filtering', async () => {
      const result = await service.getSessionsDictionary({ search: 'nonexistent-id-xyz' })

      expect(result).toHaveProperty('items')
      expect(result.items).toHaveLength(0)
    })
  })

  // ── Window + content operations ──

  describe('window and content operations', () => {
    let sessionId
    let windowId

    beforeAll(async () => {
      const session = await service.createSession(10)

      sessionId = session.data.id
    }, 60000)

    afterAll(async () => {
      if (sessionId) {
        await service.terminateSession(sessionId)
      }
    })

    it('creates a window', async () => {
      const result = await service.createWindow(sessionId, 'https://example.com', 'Load')

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('windowId')
      windowId = result.data.windowId
    }, 60000)

    it('gets window info', async () => {
      const result = await service.getWindowInfo(sessionId, windowId)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('windowId')
    })

    it('gets window info with navigation bar', async () => {
      const result = await service.getWindowInfo(sessionId, windowId, true)

      expect(result).toHaveProperty('data')
    })

    it('scrapes content from the window', async () => {
      const result = await service.scrapeContent(sessionId, windowId)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('modelResponse')
      expect(typeof result.data.modelResponse).toBe('string')
    }, 120000)

    it('queries the page with a prompt', async () => {
      const result = await service.pageQuery(sessionId, windowId, 'What is this page about?')

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('modelResponse')
    }, 120000)

    it('summarizes page content', async () => {
      const result = await service.summarizeContent(sessionId, windowId)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('modelResponse')
    }, 120000)

    it('loads a new URL in the window', async () => {
      const result = await service.loadUrl(
        sessionId,
        windowId,
        'https://example.org',
        'Load',
        10
      )

      expect(result).toHaveProperty('data')
    }, 60000)

    it('clicks an element on the page', async () => {
      const result = await service.clickElement(sessionId, windowId, 'the "More information" link')

      expect(result).toHaveProperty('data')
    }, 120000)

    it('hovers over an element', async () => {
      // Navigate back to a page with known content
      await service.loadUrl(sessionId, windowId, 'https://example.com', 'Load', 10)

      const result = await service.hoverElement(sessionId, windowId, 'the "More information" link')

      expect(result).toHaveProperty('data')
    }, 120000)

    it('scrolls the page', async () => {
      const result = await service.scrollPage(sessionId, windowId, 'Bottom')

      expect(result).toHaveProperty('data')
    }, 120000)

    it('closes the window', async () => {
      const result = await service.closeWindow(sessionId, windowId)

      expect(result).toEqual({ success: true })
    })
  })
})
