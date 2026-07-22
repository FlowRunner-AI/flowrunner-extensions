'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()
const USER_ID = `e2e-user-${ SUFFIX }`
const THREAD_ID = `e2e-thread-${ SUFFIX }`
const GRAPH_ID = `e2e-graph-${ SUFFIX }`

describe('Zep Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('zep')
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

  afterAll(async () => {
    try {
      await service.deleteThread(THREAD_ID)
    } catch (error) {
      console.log(`Cleanup: deleteThread failed - ${ error.message }`)
    }

    try {
      await service.deleteUser(USER_ID)
    } catch (error) {
      console.log(`Cleanup: deleteUser failed - ${ error.message }`)
    }

    sandbox.cleanup()
  })

  // ── Users ──

  describe('user lifecycle', () => {
    it('creates a user', async () => {
      const result = await service.addUser(USER_ID, `${ USER_ID }@example.com`, 'E2E', 'Tester', { source: 'flowrunner-e2e' })

      expect(result).toHaveProperty('user_id', USER_ID)
    })

    it('retrieves the user', async () => {
      const result = await service.getUser(USER_ID)

      expect(result).toHaveProperty('user_id', USER_ID)
      expect(result).toHaveProperty('email', `${ USER_ID }@example.com`)
    })

    it('lists users with pagination', async () => {
      const result = await service.listUsers(1, 10)

      expect(result).toHaveProperty('users')
      expect(Array.isArray(result.users)).toBe(true)
    })

    it('updates the user', async () => {
      const result = await service.updateUser(USER_ID, undefined, 'E2E Updated', undefined, { source: 'flowrunner-e2e-updated' })

      expect(result).toHaveProperty('user_id', USER_ID)
    })

    it('retrieves the user graph node', async () => {
      const result = await service.getUserNode(USER_ID)

      expect(result).toBeDefined()
    })
  })

  // ── Threads & memory ──

  describe('thread lifecycle', () => {
    it('creates a thread for the user', async () => {
      const result = await service.createThread(THREAD_ID, USER_ID, { source: 'flowrunner-e2e' })

      expect(result).toHaveProperty('thread_id', THREAD_ID)
    })

    it('retrieves the thread', async () => {
      const result = await service.getThread(THREAD_ID)

      expect(result).toHaveProperty('thread_id', THREAD_ID)
    })

    it('lists the threads of the user', async () => {
      const result = await service.listUserThreads(USER_ID)

      expect(result).toBeDefined()
    })

    it('adds messages to the thread', async () => {
      const result = await service.addMessages(THREAD_ID, [
        { role: 'User', content: 'I just moved to Berlin.', name: 'E2E' },
        { role: 'Assistant', content: 'Berlin is a great city!' },
      ])

      expect(result).toBeDefined()
    })

    it('retrieves the thread messages', async () => {
      const result = await service.getMessages(THREAD_ID, 10)

      expect(result).toHaveProperty('messages')
      expect(Array.isArray(result.messages)).toBe(true)
    })

    it('retrieves the assembled thread context', async () => {
      const result = await service.getThreadContext(THREAD_ID, 'Basic')

      expect(result).toBeDefined()
    })
  })

  // ── Graph ──

  describe('graph operations', () => {
    it('adds text data to the user graph', async () => {
      const result = await service.addGraphData('E2E tester prefers window seats when flying.', 'Text', USER_ID)

      expect(result).toBeDefined()
    })

    it('searches the user graph', async () => {
      const result = await service.searchGraph('window seats', USER_ID, undefined, 'Edges', 5, 'RRF')

      expect(result).toBeDefined()
    })

    it('lists the user graph episodes', async () => {
      const result = await service.getUserGraphEpisodes(USER_ID, 5)

      expect(result).toBeDefined()
    })
  })

  describe('shared graphs', () => {
    it('creates a shared graph', async () => {
      const result = await service.createGraph(GRAPH_ID, 'E2E Graph', 'Created by the FlowRunner e2e suite.')

      expect(result).toHaveProperty('graph_id', GRAPH_ID)
    })

    it('retrieves the shared graph', async () => {
      const result = await service.getGraph(GRAPH_ID)

      expect(result).toHaveProperty('graph_id', GRAPH_ID)
    })

    it('searches an existing shared graph when one is configured', async () => {
      const { graphId } = testValues

      if (!graphId) {
        console.log('Skipping searchGraph on a shared graph: testValues.graphId not set')

        return
      }

      const result = await service.searchGraph('policy', undefined, graphId, 'Nodes', 5)

      expect(result).toBeDefined()
    })
  })

  // ── Dictionary ──

  describe('getUsersDictionary', () => {
    it('returns users as dictionary items', async () => {
      const result = await service.getUsersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      for (const item of result.items) {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
      }
    })

    it('filters by search text', async () => {
      const result = await service.getUsersDictionary({ search: USER_ID })

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a descriptive error for an unknown user', async () => {
      await expect(service.getUser(`missing-user-${ SUFFIX }`)).rejects.toThrow(/Zep API error/)
    })
  })
})
