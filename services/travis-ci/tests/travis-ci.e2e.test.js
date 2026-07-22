'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Travis CI Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('travis-ci')
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

  // ── User ──

  describe('getCurrentUser', () => {
    it('returns current user with expected shape', async () => {
      const result = await service.getCurrentUser()

      expect(result).toHaveProperty('@type', 'user')
      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('login')
    })
  })

  // ── Repositories ──

  describe('listRepositories', () => {
    it('returns repositories list', async () => {
      const result = await service.listRepositories(false, 5, 0)

      expect(result).toHaveProperty('@type', 'repositories')
      expect(result).toHaveProperty('repositories')
      expect(Array.isArray(result.repositories)).toBe(true)
    })

    it('returns only active repositories when activeOnly is true', async () => {
      const result = await service.listRepositories(true, 5, 0)

      expect(result).toHaveProperty('@type', 'repositories')
      expect(Array.isArray(result.repositories)).toBe(true)
    })
  })

  describe('getRepository', () => {
    it('returns a single repository by slug', async () => {
      const { slug } = testValues

      if (!slug) {
        console.log('Skipping getRepository: testValues.slug not set')
        return
      }

      const result = await service.getRepository(slug)

      expect(result).toHaveProperty('@type', 'repository')
      expect(result).toHaveProperty('slug')
      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('active')
    })
  })

  describe('starRepository + unstarRepository', () => {
    it('stars and unstars a repository', async () => {
      const { slug } = testValues

      if (!slug) {
        console.log('Skipping star/unstar: testValues.slug not set')
        return
      }

      const starResult = await service.starRepository(slug)

      expect(starResult).toHaveProperty('@type', 'repository')

      const unstarResult = await service.unstarRepository(slug)

      expect(unstarResult).toHaveProperty('@type', 'repository')
    })
  })

  // ── Builds ──

  describe('listBuilds', () => {
    it('returns builds for a repository', async () => {
      const { slug } = testValues

      if (!slug) {
        console.log('Skipping listBuilds: testValues.slug not set')
        return
      }

      const result = await service.listBuilds(slug, 'Newest First', 5, 0)

      expect(result).toHaveProperty('@type', 'builds')
      expect(result).toHaveProperty('builds')
      expect(Array.isArray(result.builds)).toBe(true)
    })
  })

  describe('getBuild', () => {
    it('returns a single build by ID', async () => {
      const { buildId } = testValues

      if (!buildId) {
        console.log('Skipping getBuild: testValues.buildId not set')
        return
      }

      const result = await service.getBuild(buildId)

      expect(result).toHaveProperty('@type', 'build')
      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('state')
    })
  })

  // ── Jobs ──

  describe('listBuildJobs', () => {
    it('returns jobs for a build', async () => {
      const { buildId } = testValues

      if (!buildId) {
        console.log('Skipping listBuildJobs: testValues.buildId not set')
        return
      }

      const result = await service.listBuildJobs(buildId)

      expect(result).toHaveProperty('@type', 'jobs')
      expect(result).toHaveProperty('jobs')
      expect(Array.isArray(result.jobs)).toBe(true)
    })
  })

  describe('getJob', () => {
    it('returns a single job by ID', async () => {
      const { jobId } = testValues

      if (!jobId) {
        console.log('Skipping getJob: testValues.jobId not set')
        return
      }

      const result = await service.getJob(jobId)

      expect(result).toHaveProperty('@type', 'job')
      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('state')
    })
  })

  describe('getJobLog', () => {
    it('returns log text for a job', async () => {
      const { jobId } = testValues

      if (!jobId) {
        console.log('Skipping getJobLog: testValues.jobId not set')
        return
      }

      const result = await service.getJobLog(jobId)

      expect(result).toHaveProperty('jobId')
      expect(result).toHaveProperty('log')
      expect(typeof result.log).toBe('string')
    })
  })

  // ── Environment Variables ──

  describe('listEnvVars', () => {
    it('returns env vars for a repository', async () => {
      const { slug } = testValues

      if (!slug) {
        console.log('Skipping listEnvVars: testValues.slug not set')
        return
      }

      const result = await service.listEnvVars(slug)

      expect(result).toHaveProperty('@type', 'env_vars')
      expect(result).toHaveProperty('env_vars')
      expect(Array.isArray(result.env_vars)).toBe(true)
    })
  })

  describe('createEnvVar + deleteEnvVar', () => {
    it('creates and deletes an environment variable', async () => {
      const { slug } = testValues

      if (!slug) {
        console.log('Skipping createEnvVar/deleteEnvVar: testValues.slug not set')
        return
      }

      const created = await service.createEnvVar(slug, 'E2E_TEST_VAR', 'test-value', true)

      expect(created).toHaveProperty('@type', 'env_var')
      expect(created).toHaveProperty('id')
      expect(created).toHaveProperty('name', 'E2E_TEST_VAR')

      const deleted = await service.deleteEnvVar(slug, created.id)

      expect(deleted).toEqual({ deleted: true, envVarId: created.id })
    })
  })

  // ── Branches & Caches ──

  describe('listBranches', () => {
    it('returns branches for a repository', async () => {
      const { slug } = testValues

      if (!slug) {
        console.log('Skipping listBranches: testValues.slug not set')
        return
      }

      const result = await service.listBranches(slug)

      expect(result).toHaveProperty('@type', 'branches')
      expect(result).toHaveProperty('branches')
      expect(Array.isArray(result.branches)).toBe(true)
    })
  })

  describe('listCaches', () => {
    it('returns caches for a repository', async () => {
      const { slug } = testValues

      if (!slug) {
        console.log('Skipping listCaches: testValues.slug not set')
        return
      }

      const result = await service.listCaches(slug)

      expect(result).toHaveProperty('@type', 'caches')
      expect(result).toHaveProperty('caches')
      expect(Array.isArray(result.caches)).toBe(true)
    })
  })
})
