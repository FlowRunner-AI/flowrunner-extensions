'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Recruitee Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('recruitee')
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

  // ── Connection ──

  describe('testConnection', () => {
    it('returns connection info', async () => {
      const result = await service.testConnection()

      expect(result).toHaveProperty('connected', true)
      expect(result).toHaveProperty('companyId')
      expect(result).toHaveProperty('user')
      expect(result.user).toHaveProperty('id')
    })
  })

  // ── Organization ──

  describe('listDepartments', () => {
    it('returns departments array', async () => {
      const result = await service.listDepartments()

      expect(result).toHaveProperty('departments')
      expect(Array.isArray(result.departments)).toBe(true)
    })
  })

  describe('listLocations', () => {
    it('returns locations array', async () => {
      const result = await service.listLocations()

      expect(result).toHaveProperty('locations')
      expect(Array.isArray(result.locations)).toBe(true)
    })
  })

  describe('listTags', () => {
    it('returns tags array', async () => {
      const result = await service.listTags()

      expect(result).toHaveProperty('tags')
      expect(Array.isArray(result.tags)).toBe(true)
    })
  })

  describe('listSources', () => {
    it('returns sources array', async () => {
      const result = await service.listSources()

      expect(result).toHaveProperty('sources')
      expect(Array.isArray(result.sources)).toBe(true)
    })
  })

  describe('listTeamMembers', () => {
    it('returns team members array', async () => {
      const result = await service.listTeamMembers()

      expect(result).toHaveProperty('teamMembers')
      expect(Array.isArray(result.teamMembers)).toBe(true)
    })
  })

  describe('listDisqualifyReasons', () => {
    it('returns reasons array', async () => {
      const result = await service.listDisqualifyReasons()

      expect(result).toHaveProperty('reasons')
      expect(Array.isArray(result.reasons)).toBe(true)
    })
  })

  // ── Jobs ──

  describe('listJobs', () => {
    it('returns jobs array', async () => {
      const result = await service.listJobs()

      expect(result).toHaveProperty('jobs')
      expect(Array.isArray(result.jobs)).toBe(true)
    })
  })

  describe('job lifecycle (create + get + update + delete)', () => {
    let createdJobId

    it('creates a job', async () => {
      const result = await service.createJob('E2E Test Job - Auto Delete')

      expect(result).toHaveProperty('id')
      createdJobId = result.id
    })

    it('gets the created job', async () => {
      if (!createdJobId) {
        console.log('Skipping: no job was created')
        return
      }

      const result = await service.getJob(String(createdJobId))

      expect(result).toHaveProperty('id', createdJobId)
      expect(result).toHaveProperty('title', 'E2E Test Job - Auto Delete')
    })

    it('updates the job title', async () => {
      if (!createdJobId) {
        console.log('Skipping: no job was created')
        return
      }

      const result = await service.updateJob(String(createdJobId), 'E2E Updated Job Title')

      expect(result).toHaveProperty('id')
    })

    it('lists pipeline stages for the job', async () => {
      if (!createdJobId) {
        console.log('Skipping: no job was created')
        return
      }

      const result = await service.listPipelineStages(String(createdJobId))

      expect(result).toHaveProperty('jobId', String(createdJobId))
      expect(result).toHaveProperty('stages')
      expect(Array.isArray(result.stages)).toBe(true)
    })

    it('deletes the created job', async () => {
      if (!createdJobId) {
        console.log('Skipping: no job was created')
        return
      }

      const result = await service.deleteJob(String(createdJobId), true)

      expect(result).toHaveProperty('confirmed', true)
      expect(result).toHaveProperty('deleted', true)
    })
  })

  // ── Candidates ──

  describe('searchCandidates', () => {
    it('returns candidates array', async () => {
      const result = await service.searchCandidates('', null, null, 1, 5)

      expect(result).toHaveProperty('candidates')
      expect(Array.isArray(result.candidates)).toBe(true)
    })
  })

  describe('candidate lifecycle (create + get + update + delete)', () => {
    let createdCandidateId

    it('creates a candidate', async () => {
      const result = await service.createCandidate(
        'E2E Test Candidate',
        `e2e-test-${Date.now()}@example.com`
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('isNew', true)
      createdCandidateId = result.id
    })

    it('gets the created candidate', async () => {
      if (!createdCandidateId) {
        console.log('Skipping: no candidate was created')
        return
      }

      const result = await service.getCandidate(String(createdCandidateId))

      expect(result).toHaveProperty('id', createdCandidateId)
    })

    it('updates the candidate', async () => {
      if (!createdCandidateId) {
        console.log('Skipping: no candidate was created')
        return
      }

      const result = await service.updateCandidate(
        String(createdCandidateId),
        'E2E Updated Candidate'
      )

      expect(result).toHaveProperty('id')
    })

    it('adds tags to the candidate', async () => {
      if (!createdCandidateId) {
        console.log('Skipping: no candidate was created')
        return
      }

      const result = await service.addCandidateTags(
        String(createdCandidateId),
        ['E2E-Test-Tag']
      )

      expect(result).toHaveProperty('tagsAdded', ['E2E-Test-Tag'])
    })

    it('adds a source to the candidate', async () => {
      if (!createdCandidateId) {
        console.log('Skipping: no candidate was created')
        return
      }

      const result = await service.addCandidateSource(
        String(createdCandidateId),
        'E2E Test Source'
      )

      expect(result).toHaveProperty('sourcesAdded')
    })

    it('adds a note to the candidate', async () => {
      if (!createdCandidateId) {
        console.log('Skipping: no candidate was created')
        return
      }

      const result = await service.addCandidateNote(
        String(createdCandidateId),
        'E2E test note - safe to delete'
      )

      expect(result).toHaveProperty('id')
    })

    it('lists candidate notes', async () => {
      if (!createdCandidateId) {
        console.log('Skipping: no candidate was created')
        return
      }

      const result = await service.listCandidateNotes(String(createdCandidateId))

      expect(result).toHaveProperty('notes')
      expect(Array.isArray(result.notes)).toBe(true)
    })

    it('deletes the created candidate', async () => {
      if (!createdCandidateId) {
        console.log('Skipping: no candidate was created')
        return
      }

      const result = await service.deleteCandidate(String(createdCandidateId), true)

      expect(result).toHaveProperty('confirmed', true)
      expect(result).toHaveProperty('deleted', true)
    })
  })

  // ── Talent Pools ──

  describe('listTalentPools', () => {
    it('returns talent pools array', async () => {
      const result = await service.listTalentPools()

      expect(result).toHaveProperty('talentPools')
      expect(Array.isArray(result.talentPools)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getJobsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getJobsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getCandidatesDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getCandidatesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getTagsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getTagsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getDepartmentsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getDepartmentsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getLocationsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getLocationsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getAdminsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getAdminsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Tasks ──

  describe('task lifecycle (create + get + complete + delete)', () => {
    let createdTaskId

    it('creates a task', async () => {
      const result = await service.createTask('E2E Test Task - Auto Delete')

      expect(result).toHaveProperty('id')
      createdTaskId = result.id
    })

    it('gets the created task', async () => {
      if (!createdTaskId) {
        console.log('Skipping: no task was created')
        return
      }

      const result = await service.getTask(String(createdTaskId))

      expect(result).toHaveProperty('id')
    })

    it('completes the task', async () => {
      if (!createdTaskId) {
        console.log('Skipping: no task was created')
        return
      }

      const result = await service.completeTask(String(createdTaskId))

      expect(result).toHaveProperty('id')
    })

    it('deletes the task', async () => {
      if (!createdTaskId) {
        console.log('Skipping: no task was created')
        return
      }

      const result = await service.deleteTask(String(createdTaskId), true)

      expect(result).toHaveProperty('confirmed', true)
    })
  })

  describe('listTasks', () => {
    it('returns tasks array', async () => {
      const result = await service.listTasks()

      expect(result).toHaveProperty('tasks')
      expect(Array.isArray(result.tasks)).toBe(true)
    })
  })

  // ── Pipeline Templates ──

  describe('listPipelineTemplates', () => {
    it('returns pipeline templates array', async () => {
      const result = await service.listPipelineTemplates()

      expect(result).toHaveProperty('pipelineTemplates')
      expect(Array.isArray(result.pipelineTemplates)).toBe(true)
    })
  })

  // ── Activity ──

  describe('listActivity', () => {
    it('returns activities array', async () => {
      const result = await service.listActivity()

      expect(result).toHaveProperty('activities')
      expect(Array.isArray(result.activities)).toBe(true)
    })
  })

  // ── Custom Fields ──

  describe('listFieldsets', () => {
    it('returns fieldsets array', async () => {
      const result = await service.listFieldsets()

      expect(result).toHaveProperty('fieldsets')
      expect(Array.isArray(result.fieldsets)).toBe(true)
    })
  })

  // ── Interviews ──

  describe('listInterviews', () => {
    it('returns interviews array', async () => {
      const result = await service.listInterviews()

      expect(result).toHaveProperty('interviews')
      expect(Array.isArray(result.interviews)).toBe(true)
    })
  })

  describe('listInterviewTemplates', () => {
    it('returns interview templates array', async () => {
      const result = await service.listInterviewTemplates()

      expect(result).toHaveProperty('interviewTemplates')
      expect(Array.isArray(result.interviewTemplates)).toBe(true)
    })
  })

  // ── Communication ──

  describe('listEmailTemplates', () => {
    it('returns email templates array', async () => {
      const result = await service.listEmailTemplates()

      expect(result).toHaveProperty('templates')
      expect(Array.isArray(result.templates)).toBe(true)
    })
  })

  // ── Requisitions ──

  describe('findRequisitions', () => {
    it('returns requisitions array', async () => {
      const result = await service.findRequisitions()

      expect(result).toHaveProperty('requisitions')
      expect(Array.isArray(result.requisitions)).toBe(true)
    })
  })

  // ── Advanced ──

  describe('listSavedSearches', () => {
    it('returns saved searches array', async () => {
      const result = await service.listSavedSearches()

      expect(result).toHaveProperty('savedSearches')
      expect(Array.isArray(result.savedSearches)).toBe(true)
    })
  })

  describe('listImports', () => {
    it('returns imports array', async () => {
      const result = await service.listImports()

      expect(result).toHaveProperty('imports')
      expect(Array.isArray(result.imports)).toBe(true)
    })
  })
})
