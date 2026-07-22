'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Phantombuster Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('phantombuster')
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

  // ── Organization ──

  describe('getOrganizationResources', () => {
    it('returns the organization resource usage', async () => {
      const result = await service.getOrganizationResources()

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
    })
  })

  // ── Agents ──

  describe('listAgents', () => {
    it('returns the list of agents', async () => {
      const result = await service.listAgents()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getAgentsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getAgentsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })

    it('filters items by search text', async () => {
      const result = await service.getAgentsDictionary({ search: 'zzz-no-such-agent-zzz' })

      expect(result.items).toEqual([])
    })
  })

  describe('getAgent', () => {
    it('fetches a single agent', async () => {
      const { agentId } = testValues

      if (!agentId) {
        console.log('Skipping getAgent: testValues.agentId not set')

        return
      }

      const result = await service.getAgent(agentId)

      expect(result).toHaveProperty('id')
    })
  })

  describe('getAgentOutput', () => {
    it('fetches the latest output of an agent', async () => {
      const { agentId } = testValues

      if (!agentId) {
        console.log('Skipping getAgentOutput: testValues.agentId not set')

        return
      }

      const result = await service.getAgentOutput(agentId, 'Most Recent')

      expect(result).toBeDefined()
    })
  })

  // ── Containers ──

  describe('listAgentContainers', () => {
    it('lists the containers of an agent', async () => {
      const { agentId } = testValues

      if (!agentId) {
        console.log('Skipping listAgentContainers: testValues.agentId not set')

        return
      }

      const result = await service.listAgentContainers(agentId)

      expect(Array.isArray(result) || typeof result === 'object').toBe(true)
    })
  })

  describe('getContainer', () => {
    it('fetches a single container', async () => {
      const { containerId } = testValues

      if (!containerId) {
        console.log('Skipping getContainer: testValues.containerId not set')

        return
      }

      const result = await service.getContainer(containerId)

      expect(result).toHaveProperty('id')
    })
  })

  describe('getContainerResultObject', () => {
    it('fetches the result object of a container', async () => {
      const { containerId } = testValues

      if (!containerId) {
        console.log('Skipping getContainerResultObject: testValues.containerId not set')

        return
      }

      const result = await service.getContainerResultObject(containerId)

      expect(result).toBeDefined()
    })
  })

  // ── Launch / abort (destructive — opt in via testValues) ──

  describe('launchAgent + abortAgent', () => {
    it('launches an agent and aborts the run', async () => {
      const { launchableAgentId } = testValues

      if (!launchableAgentId) {
        console.log('Skipping launchAgent: testValues.launchableAgentId not set')

        return
      }

      const launched = await service.launchAgent(launchableAgentId)

      expect(launched).toHaveProperty('containerId')

      const aborted = await service.abortAgent(launchableAgentId)

      expect(aborted).toBeDefined()
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a wrapped error for an unknown agent id', async () => {
      await expect(service.getAgent('0')).rejects.toThrow(/Phantombuster API error/)
    })
  })
})
