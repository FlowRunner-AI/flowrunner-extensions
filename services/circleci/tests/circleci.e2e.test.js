'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('CircleCI Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('circleci')
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

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // testValues expected in e2e-config.json:
  //   projectSlug   - REQUIRED for almost everything: vcs-slug/org-name/repo-name (e.g. gh/acme/app)
  //   branch        - optional branch to trigger a pipeline against (defaults to 'main')
  //   pipelineId    - optional known pipeline UUID (falls back to a live-listed pipeline)
  //   workflowId    - optional known workflow UUID (falls back to a live-listed workflow)
  //   jobNumber     - optional known job number (falls back to a live-listed job)
  //   allowTrigger  - set truthy to allow the test to trigger a real pipeline build
  const hasProject = () => Boolean(testValues.projectSlug)

  const requireProject = () => {
    if (!hasProject()) {
      console.log('Skipping: set testValues.projectSlug (e.g. gh/acme/app) in e2e-config.json')
    }
    return hasProject()
  }

  // ── Account ──

  describe('getCurrentUser', () => {
    it('returns the token owner with expected shape', async () => {
      const response = await service.getCurrentUser()

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('login')
    })
  })

  // ── Project ──

  describe('getProject', () => {
    it('returns project details with expected shape', async () => {
      if (!requireProject()) {
        return
      }

      const response = await service.getProject(testValues.projectSlug)

      expect(response).toHaveProperty('slug')
      expect(response).toHaveProperty('name')
      expect(response).toHaveProperty('vcs_info')
    })
  })

  describe('listEnvVars', () => {
    it('returns env vars with expected shape', async () => {
      if (!requireProject()) {
        return
      }

      const response = await service.listEnvVars(testValues.projectSlug)

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  describe('createEnvVar + deleteEnvVar', () => {
    const name = `E2E_TEST_VAR_${ suffix }`

    it('creates an env var', async () => {
      if (!requireProject()) {
        return
      }

      const response = await service.createEnvVar(testValues.projectSlug, name, 'e2e-secret-value')

      expect(response).toHaveProperty('name', name)
      expect(response).toHaveProperty('value')
    })

    it('deletes the env var', async () => {
      if (!requireProject()) {
        return
      }

      const response = await service.deleteEnvVar(testValues.projectSlug, name)

      expect(response).toHaveProperty('message')
    })
  })

  describe('listCheckoutKeys', () => {
    it('returns checkout keys with expected shape', async () => {
      if (!requireProject()) {
        return
      }

      const response = await service.listCheckoutKeys(testValues.projectSlug)

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  // ── Pipelines ──

  describe('listProjectPipelines', () => {
    it('returns pipelines with expected shape', async () => {
      if (!requireProject()) {
        return
      }

      const response = await service.listProjectPipelines(testValues.projectSlug)

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  describe('listMyPipelines', () => {
    it('returns the caller pipelines with expected shape', async () => {
      if (!requireProject()) {
        return
      }

      const response = await service.listMyPipelines(testValues.projectSlug)

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  // Resolve a pipeline id to exercise the pipeline-scoped reads. Prefer a
  // developer-supplied one, otherwise fall back to the newest live pipeline.
  const resolvePipelineId = async () => {
    if (testValues.pipelineId) {
      return testValues.pipelineId
    }

    if (!hasProject()) {
      return undefined
    }

    const { items } = await service.listProjectPipelines(testValues.projectSlug)
    return items && items.length ? items[0].id : undefined
  }

  describe('getPipeline', () => {
    it('returns a pipeline with expected shape', async () => {
      const pipelineId = await resolvePipelineId()

      if (!pipelineId) {
        console.log('Skipping getPipeline: no pipeline available (set testValues.projectSlug/pipelineId)')
        return
      }

      const response = await service.getPipeline(pipelineId)

      expect(response).toHaveProperty('id', pipelineId)
      expect(response).toHaveProperty('state')
    })
  })

  describe('getPipelineByNumber', () => {
    it('returns a pipeline by its number', async () => {
      const pipelineId = await resolvePipelineId()

      if (!pipelineId || !hasProject()) {
        console.log('Skipping getPipelineByNumber: no pipeline available')
        return
      }

      const pipeline = await service.getPipeline(pipelineId)
      const response = await service.getPipelineByNumber(testValues.projectSlug, pipeline.number)

      expect(response).toHaveProperty('id', pipelineId)
      expect(response).toHaveProperty('number', pipeline.number)
    })
  })

  describe('getPipelineConfig', () => {
    it('returns the pipeline config with expected shape', async () => {
      const pipelineId = await resolvePipelineId()

      if (!pipelineId) {
        console.log('Skipping getPipelineConfig: no pipeline available')
        return
      }

      const response = await service.getPipelineConfig(pipelineId)

      expect(response).toHaveProperty('source')
    })
  })

  describe('getPipelineWorkflows', () => {
    it('returns workflows for a pipeline with expected shape', async () => {
      const pipelineId = await resolvePipelineId()

      if (!pipelineId) {
        console.log('Skipping getPipelineWorkflows: no pipeline available')
        return
      }

      const response = await service.getPipelineWorkflows(pipelineId)

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  describe('triggerPipeline', () => {
    // Triggering a real build consumes credits, so this only runs when the
    // developer opts in via testValues.allowTrigger.
    it('triggers a pipeline when allowed', async () => {
      if (!hasProject() || !testValues.allowTrigger) {
        console.log('Skipping triggerPipeline: set testValues.projectSlug and testValues.allowTrigger')
        return
      }

      const response = await service.triggerPipeline(
        testValues.projectSlug,
        testValues.branch || 'main'
      )

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('number')
      expect(response).toHaveProperty('state')
    })
  })

  // ── Workflows ──

  // Resolve a workflow id from a pipeline's workflows (or a supplied one).
  const resolveWorkflowId = async () => {
    if (testValues.workflowId) {
      return testValues.workflowId
    }

    const pipelineId = await resolvePipelineId()

    if (!pipelineId) {
      return undefined
    }

    const { items } = await service.getPipelineWorkflows(pipelineId)
    return items && items.length ? items[0].id : undefined
  }

  describe('getWorkflow', () => {
    it('returns a workflow with expected shape', async () => {
      const workflowId = await resolveWorkflowId()

      if (!workflowId) {
        console.log('Skipping getWorkflow: no workflow available (set testValues.workflowId)')
        return
      }

      const response = await service.getWorkflow(workflowId)

      expect(response).toHaveProperty('id', workflowId)
      expect(response).toHaveProperty('status')
    })
  })

  describe('getWorkflowJobs', () => {
    it('returns jobs for a workflow with expected shape', async () => {
      const workflowId = await resolveWorkflowId()

      if (!workflowId) {
        console.log('Skipping getWorkflowJobs: no workflow available')
        return
      }

      const response = await service.getWorkflowJobs(workflowId)

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  // ── Jobs ──

  // Resolve a job number from a workflow's jobs (or a supplied one).
  const resolveJobNumber = async () => {
    if (testValues.jobNumber !== undefined && testValues.jobNumber !== null) {
      return testValues.jobNumber
    }

    const workflowId = await resolveWorkflowId()

    if (!workflowId) {
      return undefined
    }

    const { items } = await service.getWorkflowJobs(workflowId)
    const withNumber = (items || []).find(job => job.job_number !== undefined && job.job_number !== null)
    return withNumber ? withNumber.job_number : undefined
  }

  describe('getJobDetails', () => {
    it('returns job details with expected shape', async () => {
      const jobNumber = await resolveJobNumber()

      if (jobNumber === undefined || !hasProject()) {
        console.log('Skipping getJobDetails: no job available (set testValues.projectSlug/jobNumber)')
        return
      }

      const response = await service.getJobDetails(testValues.projectSlug, jobNumber)

      expect(response).toHaveProperty('number')
      expect(response).toHaveProperty('status')
    })
  })

  describe('getJobArtifacts', () => {
    it('returns job artifacts with expected shape', async () => {
      const jobNumber = await resolveJobNumber()

      if (jobNumber === undefined || !hasProject()) {
        console.log('Skipping getJobArtifacts: no job available')
        return
      }

      const response = await service.getJobArtifacts(testValues.projectSlug, jobNumber)

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  describe('getTestMetadata', () => {
    it('returns test metadata with expected shape', async () => {
      const jobNumber = await resolveJobNumber()

      if (jobNumber === undefined || !hasProject()) {
        console.log('Skipping getTestMetadata: no job available')
        return
      }

      const response = await service.getTestMetadata(testValues.projectSlug, jobNumber)

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })
})
