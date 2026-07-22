'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Jenkins Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('jenkins')
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

  describe('getJenkinsInfo', () => {
    it('returns Jenkins instance info with expected shape', async () => {
      const result = await service.getJenkinsInfo()

      expect(result).toHaveProperty('mode')
      expect(result).toHaveProperty('numExecutors')
      expect(result).toHaveProperty('quietingDown')
      expect(result).toHaveProperty('jobs')
      expect(Array.isArray(result.jobs)).toBe(true)
    })
  })

  describe('getViews', () => {
    it('returns views array', async () => {
      const result = await service.getViews()

      expect(result).toHaveProperty('views')
      expect(Array.isArray(result.views)).toBe(true)
      expect(result.views.length).toBeGreaterThan(0)

      const view = result.views[0]

      expect(view).toHaveProperty('name')
      expect(view).toHaveProperty('url')
    })
  })

  // ── Jobs ──

  describe('listJobs', () => {
    it('returns jobs array without sub-folders', async () => {
      const result = await service.listJobs()

      expect(result).toHaveProperty('jobs')
      expect(Array.isArray(result.jobs)).toBe(true)
    })

    it('returns jobs array with sub-folders', async () => {
      const result = await service.listJobs(true)

      expect(result).toHaveProperty('jobs')
      expect(Array.isArray(result.jobs)).toBe(true)
    })
  })

  describe('getJob', () => {
    it('returns job details for the test job', async () => {
      const jobPath = testValues.jobPath

      if (!jobPath) {
        console.log('Skipping getJob: no testValues.jobPath provided')
        return
      }

      const result = await service.getJob(jobPath)

      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('url')
      expect(result).toHaveProperty('buildable')
    })
  })

  describe('getJobConfig', () => {
    it('returns config.xml for the test job', async () => {
      const jobPath = testValues.jobPath

      if (!jobPath) {
        console.log('Skipping getJobConfig: no testValues.jobPath provided')
        return
      }

      const result = await service.getJobConfig(jobPath)

      expect(result).toHaveProperty('jobPath', jobPath)
      expect(result).toHaveProperty('configXml')
      expect(typeof result.configXml).toBe('string')
      expect(result.configXml).toContain('<?xml')
    })
  })

  // ── Dictionaries ──

  describe('getJobsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getJobsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)

      if (result.items.length > 0) {
        const item = result.items[0]

        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
      }
    })

    it('filters dictionary items by search', async () => {
      const all = await service.getJobsDictionary({})

      if (all.items.length === 0) {
        console.log('Skipping search filter test: no jobs found')
        return
      }

      const firstName = all.items[0].label
      const filtered = await service.getJobsDictionary({ search: firstName })

      expect(filtered.items.length).toBeGreaterThan(0)
      expect(filtered.items.length).toBeLessThanOrEqual(all.items.length)
    })
  })

  // ── Queue ──

  describe('getQueue', () => {
    it('returns queue with items array', async () => {
      const result = await service.getQueue()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Builds ──

  describe('getBuild', () => {
    it('returns build details for lastBuild alias', async () => {
      const jobPath = testValues.jobPath

      if (!jobPath) {
        console.log('Skipping getBuild: no testValues.jobPath provided')
        return
      }

      try {
        const result = await service.getBuild(jobPath, 'lastBuild')

        expect(result).toHaveProperty('number')
        expect(result).toHaveProperty('result')
        expect(result).toHaveProperty('building')
        expect(result).toHaveProperty('duration')
        expect(result).toHaveProperty('url')
      } catch (error) {
        // Job may not have any builds yet
        if (!error.message.includes('404')) {
          throw error
        }

        console.log('No builds found for the test job (expected if the job has never been built)')
      }
    })
  })

  describe('getBuildConsoleOutput', () => {
    it('returns console output for lastBuild', async () => {
      const jobPath = testValues.jobPath

      if (!jobPath) {
        console.log('Skipping getBuildConsoleOutput: no testValues.jobPath provided')
        return
      }

      try {
        const result = await service.getBuildConsoleOutput(jobPath, 'lastBuild')

        expect(result).toHaveProperty('jobPath', jobPath)
        expect(result).toHaveProperty('buildNumber', 'lastBuild')
        expect(result).toHaveProperty('consoleOutput')
        expect(typeof result.consoleOutput).toBe('string')
      } catch (error) {
        if (!error.message.includes('404')) {
          throw error
        }

        console.log('No builds found for console output test')
      }
    })
  })

  describe('getBuildLogTail', () => {
    it('returns tail of build log with line count', async () => {
      const jobPath = testValues.jobPath

      if (!jobPath) {
        console.log('Skipping getBuildLogTail: no testValues.jobPath provided')
        return
      }

      try {
        const result = await service.getBuildLogTail(jobPath, 'lastBuild', 10)

        expect(result).toHaveProperty('jobPath', jobPath)
        expect(result).toHaveProperty('buildNumber', 'lastBuild')
        expect(result).toHaveProperty('lines', 10)
        expect(result).toHaveProperty('totalLines')
        expect(result).toHaveProperty('logTail')
        expect(typeof result.logTail).toBe('string')
      } catch (error) {
        if (!error.message.includes('404')) {
          throw error
        }

        console.log('No builds found for log tail test')
      }
    })
  })

  // ── Job lifecycle (create, enable, disable, delete) ──

  describe('job lifecycle: create -> enable -> disable -> delete', () => {
    const testJobName = `e2e-test-job-${ Date.now() }`
    const configXml = `<?xml version='1.1' encoding='UTF-8'?>
<project>
  <description>E2E test job - safe to delete</description>
  <keepDependencies>false</keepDependencies>
  <properties/>
  <scm class="hudson.scm.NullSCM"/>
  <canRoam>true</canRoam>
  <disabled>false</disabled>
  <blockBuildWhenDownstreamBuilding>false</blockBuildWhenDownstreamBuilding>
  <blockBuildWhenUpstreamBuilding>false</blockBuildWhenUpstreamBuilding>
  <triggers/>
  <concurrentBuild>false</concurrentBuild>
  <builders>
    <hudson.tasks.Shell>
      <command>echo "hello from e2e test"</command>
    </hudson.tasks.Shell>
  </builders>
  <publishers/>
  <buildWrappers/>
</project>`

    it('creates a new job', async () => {
      const result = await service.createJob(testJobName, configXml)

      expect(result).toEqual({ created: true, name: testJobName, folderPath: null })
    })

    it('disables the created job', async () => {
      const result = await service.disableJob(testJobName)

      expect(result).toEqual({ disabled: true, jobPath: testJobName })
    })

    it('enables the created job', async () => {
      const result = await service.enableJob(testJobName)

      expect(result).toEqual({ enabled: true, jobPath: testJobName })
    })

    it('deletes the created job', async () => {
      const result = await service.deleteJob(testJobName)

      expect(result).toEqual({ deleted: true, jobPath: testJobName })
    })
  })
})
