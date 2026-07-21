'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Greenhouse Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('greenhouse')
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

  // On-Behalf-Of user id used for write operations. Prefer an explicit testValue;
  // falls back to undefined (the service then uses the config-level id, if any).
  const obo = () => testValues.onBehalfOfUserId

  // ── Users ──

  describe('listUsers', () => {
    it('returns users wrapped with items/nextPage', async () => {
      const result = await service.listUsers(5, 1)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('nextPage')
    })
  })

  describe('getUser', () => {
    it('retrieves a user when a userId testValue is supplied', async () => {
      if (!testValues.userId) {
        console.log('Skipping getUser: set testValues.userId')
        return
      }

      const result = await service.getUser(testValues.userId)

      expect(result).toHaveProperty('id')
    })
  })

  describe('getUsersDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getUsersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Candidates ──

  describe('listCandidates', () => {
    it('returns candidates with expected shape', async () => {
      const result = await service.listCandidates(5, 1)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('createCandidate + getCandidate + updateCandidate + addNoteToCandidate + deleteCandidate', () => {
    let candidateId

    it('creates a candidate', async () => {
      const result = await service.createCandidate(
        'E2E', `Tester ${ suffix }`, `e2e-${ suffix }@example.com`, undefined, 'Acme', 'Engineer',
        undefined, ['E2E'],
        undefined, undefined, undefined, undefined, undefined, undefined,
        obo()
      )

      expect(result).toHaveProperty('id')
      candidateId = result.id
    })

    it('retrieves the created candidate', async () => {
      const result = await service.getCandidate(candidateId)

      expect(result).toHaveProperty('id', candidateId)
      expect(result).toHaveProperty('first_name', 'E2E')
    })

    it('updates the candidate', async () => {
      const result = await service.updateCandidate(
        candidateId, undefined, undefined, 'Globex', 'Senior Engineer',
        undefined, undefined, undefined, undefined, undefined, undefined,
        obo()
      )

      expect(result).toHaveProperty('id', candidateId)
    })

    it('adds a note to the candidate', async () => {
      const result = await service.addNoteToCandidate(
        candidateId, `E2E note ${ suffix }`, 'Public', undefined, obo()
      )

      expect(result).toHaveProperty('id')
    })

    it('lists the candidate applications (empty for a bare candidate)', async () => {
      const result = await service.listCandidateApplications(candidateId, 5, 1)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('deletes the candidate', async () => {
      const result = await service.deleteCandidate(candidateId, obo())

      expect(result).toEqual({ success: true, message: `Candidate ${ candidateId } deleted.` })
    })
  })

  // ── Jobs ──

  describe('listJobs', () => {
    it('returns jobs with expected shape', async () => {
      const result = await service.listJobs(undefined, 5, 1)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getJob + getJobStages + listJobOpenings + getJobPostsForJob', () => {
    it('retrieves a job when a jobId testValue is supplied', async () => {
      if (!testValues.jobId) {
        console.log('Skipping getJob: set testValues.jobId')
        return
      }

      const result = await service.getJob(testValues.jobId)

      expect(result).toHaveProperty('id')
    })

    it('retrieves job stages', async () => {
      if (!testValues.jobId) {
        console.log('Skipping getJobStages: set testValues.jobId')
        return
      }

      const result = await service.getJobStages(testValues.jobId)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('lists job openings', async () => {
      if (!testValues.jobId) {
        console.log('Skipping listJobOpenings: set testValues.jobId')
        return
      }

      const result = await service.listJobOpenings(testValues.jobId)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('lists job posts for the job', async () => {
      if (!testValues.jobId) {
        console.log('Skipping getJobPostsForJob: set testValues.jobId')
        return
      }

      const result = await service.getJobPostsForJob(testValues.jobId)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getJobsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getJobsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getJobStagesDictionary', () => {
    it('returns dictionary items array for a supplied jobId', async () => {
      if (!testValues.jobId) {
        console.log('Skipping getJobStagesDictionary: set testValues.jobId')
        return
      }

      const result = await service.getJobStagesDictionary({ criteria: { jobId: testValues.jobId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Job Posts ──

  describe('listJobPosts', () => {
    it('returns job posts with expected shape', async () => {
      const result = await service.listJobPosts(undefined, undefined, 5, 1)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Applications ──

  describe('listApplications', () => {
    it('returns applications with expected shape', async () => {
      const result = await service.listApplications(undefined, undefined, 5, 1)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getApplication + scorecards + interviews + offers', () => {
    it('retrieves an application when an applicationId testValue is supplied', async () => {
      if (!testValues.applicationId) {
        console.log('Skipping getApplication: set testValues.applicationId')
        return
      }

      const result = await service.getApplication(testValues.applicationId)

      expect(result).toHaveProperty('id')
    })

    it('lists application scorecards', async () => {
      if (!testValues.applicationId) {
        console.log('Skipping listApplicationScorecards: set testValues.applicationId')
        return
      }

      const result = await service.listApplicationScorecards(testValues.applicationId, 5, 1)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('lists scheduled interviews', async () => {
      if (!testValues.applicationId) {
        console.log('Skipping listScheduledInterviewsForApplication: set testValues.applicationId')
        return
      }

      const result = await service.listScheduledInterviewsForApplication(testValues.applicationId, 5, 1)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('lists application offers', async () => {
      if (!testValues.applicationId) {
        console.log('Skipping listApplicationOffers: set testValues.applicationId')
        return
      }

      const result = await service.listApplicationOffers(testValues.applicationId, 5, 1)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('gets the current offer (may 404 when none exists)', async () => {
      if (!testValues.applicationId) {
        console.log('Skipping getCurrentOfferForApplication: set testValues.applicationId')
        return
      }

      try {
        const result = await service.getCurrentOfferForApplication(testValues.applicationId)
        expect(result).toBeDefined()
      } catch (error) {
        // No current offer on this application is an acceptable outcome.
        expect(error.message).toContain('Greenhouse API error')
      }
    })
  })

  // ── Reference Data ──

  describe('listSources', () => {
    it('returns sources with expected shape', async () => {
      const result = await service.listSources(5, 1)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('listRejectionReasons', () => {
    it('returns rejection reasons with expected shape', async () => {
      const result = await service.listRejectionReasons(5, 1)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('listDepartments', () => {
    it('returns departments with expected shape', async () => {
      const result = await service.listDepartments(5, 1)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('listOffices', () => {
    it('returns offices with expected shape', async () => {
      const result = await service.listOffices(5, 1)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('listCustomFields', () => {
    it('returns candidate custom fields with expected shape', async () => {
      const result = await service.listCustomFields('Candidate')

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getSourcesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getSourcesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getRejectionReasonsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getRejectionReasonsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getDepartmentsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getDepartmentsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getOfficesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getOfficesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Guarded pipeline mutations (only run when explicitly enabled) ──
  // These mutate real recruiting data (moving/advancing/rejecting applications),
  // so they only run when the developer opts in via testValues.

  describe('application pipeline writes (guarded)', () => {
    it('advances an application when testValues.advanceApplicationId is set', async () => {
      if (!testValues.advanceApplicationId) {
        console.log('Skipping advanceApplication: set testValues.advanceApplicationId to opt in')
        return
      }

      const result = await service.advanceApplication(testValues.advanceApplicationId, obo())

      expect(result).toHaveProperty('id')
    })

    it('moves an application when move testValues are set', async () => {
      const { moveApplicationId, moveFromStageId, moveToStageId } = testValues

      if (!moveApplicationId || !moveFromStageId || !moveToStageId) {
        console.log('Skipping moveApplicationStage: set testValues.moveApplicationId/moveFromStageId/moveToStageId')
        return
      }

      const result = await service.moveApplicationStage(
        moveApplicationId, moveFromStageId, moveToStageId, obo()
      )

      expect(result).toHaveProperty('id')
    })
  })
})
