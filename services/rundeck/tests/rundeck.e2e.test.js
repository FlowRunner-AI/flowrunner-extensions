'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Rundeck Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('rundeck')
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

  // ── System ──

  describe('getSystemInfo', () => {
    it('returns system info with expected shape', async () => {
      const result = await service.getSystemInfo()

      expect(result).toHaveProperty('system')
      expect(result.system).toHaveProperty('rundeck')
      expect(result.system.rundeck).toHaveProperty('version')
      expect(result.system.rundeck).toHaveProperty('apiversion')
    })
  })

  // ── Projects ──

  describe('listProjects', () => {
    it('returns an array of projects', async () => {
      const result = await service.listProjects()

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('name')
      }
    })

    it('filters projects by search', async () => {
      const all = await service.listProjects()

      if (all.length === 0) {
        console.log('Skipping: no projects available to test search filtering')
        return
      }

      const firstName = all[0].name
      const filtered = await service.listProjects(firstName)

      expect(filtered.length).toBeGreaterThanOrEqual(1)
      expect(filtered[0].name.toLowerCase()).toContain(firstName.toLowerCase())
    })
  })

  describe('getProject', () => {
    it('returns project details', async () => {
      const { projectName } = testValues

      if (!projectName) {
        console.log('Skipping getProject: testValues.projectName not set')
        return
      }

      const result = await service.getProject(projectName)

      expect(result).toHaveProperty('name', projectName)
    })
  })

  // ── Dictionaries ──

  describe('getProjectsDictionary', () => {
    it('returns dictionary items with label and value', async () => {
      const result = await service.getProjectsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor', null)
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getJobsDictionary', () => {
    it('returns empty items when no project provided', async () => {
      const result = await service.getJobsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns jobs for a project', async () => {
      const { projectName } = testValues

      if (!projectName) {
        console.log('Skipping getJobsDictionary with project: testValues.projectName not set')
        return
      }

      const result = await service.getJobsDictionary({ criteria: { project: projectName } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  // ── Jobs ──

  describe('listJobs', () => {
    it('returns jobs for a project', async () => {
      const { projectName } = testValues

      if (!projectName) {
        console.log('Skipping listJobs: testValues.projectName not set')
        return
      }

      const result = await service.listJobs(projectName)

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('name')
      }
    })
  })

  describe('getJobDefinition', () => {
    it('returns job definition', async () => {
      const { jobId } = testValues

      if (!jobId) {
        console.log('Skipping getJobDefinition: testValues.jobId not set')
        return
      }

      const result = await service.getJobDefinition(jobId)

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('id', jobId)
        expect(result[0]).toHaveProperty('name')
      }
    })
  })

  // ── Executions ──

  describe('listProjectExecutions', () => {
    it('returns executions with paging info', async () => {
      const { projectName } = testValues

      if (!projectName) {
        console.log('Skipping listProjectExecutions: testValues.projectName not set')
        return
      }

      const result = await service.listProjectExecutions(projectName, undefined, undefined, 5)

      expect(result).toHaveProperty('paging')
      expect(result).toHaveProperty('executions')
      expect(Array.isArray(result.executions)).toBe(true)
    })
  })

  describe('runJob + getExecution + getExecutionState + getExecutionOutput', () => {
    it('runs a job and inspects the execution', async () => {
      const { jobId } = testValues

      if (!jobId) {
        console.log('Skipping runJob lifecycle: testValues.jobId not set')
        return
      }

      const execution = await service.runJob(jobId)

      expect(execution).toHaveProperty('id')
      expect(execution).toHaveProperty('status')

      const execId = execution.id

      const execDetail = await service.getExecution(execId)

      expect(execDetail).toHaveProperty('id', execId)
      expect(execDetail).toHaveProperty('status')

      const state = await service.getExecutionState(execId)

      expect(state).toHaveProperty('executionId', execId)

      const output = await service.getExecutionOutput(execId)

      expect(output).toHaveProperty('entries')
    })
  })

  // ── Adhoc ──

  describe('runAdhocCommand', () => {
    it('runs an adhoc command', async () => {
      const { projectName } = testValues

      if (!projectName) {
        console.log('Skipping runAdhocCommand: testValues.projectName not set')
        return
      }

      const result = await service.runAdhocCommand(projectName, 'echo "e2e test"')

      expect(result).toHaveProperty('execution')
      expect(result.execution).toHaveProperty('id')
    })
  })

  describe('runAdhocScript', () => {
    it('runs an adhoc script', async () => {
      const { projectName } = testValues

      if (!projectName) {
        console.log('Skipping runAdhocScript: testValues.projectName not set')
        return
      }

      const result = await service.runAdhocScript(projectName, '#!/bin/bash\necho "e2e script test"')

      expect(result).toHaveProperty('execution')
      expect(result.execution).toHaveProperty('id')
    })
  })
})
