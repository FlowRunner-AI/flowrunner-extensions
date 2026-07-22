'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Workable Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('workable')
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

  describe('getAccount', () => {
    it('returns the connected account', async () => {
      const result = await service.getAccount()

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
    })
  })

  // ── Jobs ──

  describe('jobs', () => {
    it('lists jobs', async () => {
      const result = await service.listJobs(undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('jobs')
      expect(Array.isArray(result.jobs)).toBe(true)
    })

    it('lists published jobs only', async () => {
      const result = await service.listJobs('Published', undefined, undefined, 5)

      expect(Array.isArray(result.jobs)).toBe(true)
    })

    it('gets a single job by shortcode', async () => {
      const { shortcode } = testValues

      if (!shortcode) {
        console.log('Skipping getJob: testValues.shortcode not set')

        return
      }

      const result = await service.getJob(shortcode)

      expect(result).toHaveProperty('shortcode', shortcode)
    })

    it('gets the job hiring team members', async () => {
      const { shortcode } = testValues

      if (!shortcode) {
        console.log('Skipping getJobMembers: testValues.shortcode not set')

        return
      }

      const result = await service.getJobMembers(shortcode)

      expect(result).toHaveProperty('members')
      expect(Array.isArray(result.members)).toBe(true)
    })

    it('gets the job pipeline stages', async () => {
      const { shortcode } = testValues

      if (!shortcode) {
        console.log('Skipping getJobStages: testValues.shortcode not set')

        return
      }

      const result = await service.getJobStages(shortcode)

      expect(result).toHaveProperty('stages')
      expect(Array.isArray(result.stages)).toBe(true)
    })
  })

  // ── Members, recruiters, stages ──

  describe('account metadata', () => {
    it('lists members', async () => {
      const result = await service.listMembers()

      expect(result).toHaveProperty('members')
      expect(Array.isArray(result.members)).toBe(true)
    })

    it('lists recruiters', async () => {
      const result = await service.listRecruiters()

      expect(result).toHaveProperty('recruiters')
      expect(Array.isArray(result.recruiters)).toBe(true)
    })

    it('lists account-wide stages', async () => {
      const result = await service.listStages()

      expect(result).toHaveProperty('stages')
      expect(Array.isArray(result.stages)).toBe(true)
    })
  })

  // ── Candidates ──

  describe('candidates', () => {
    let createdCandidateId

    it('lists candidates', async () => {
      const result = await service.listCandidates(undefined, undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('candidates')
      expect(Array.isArray(result.candidates)).toBe(true)
    })

    it('lists active candidates of a job', async () => {
      const { shortcode } = testValues

      if (!shortcode) {
        console.log('Skipping scoped listCandidates: testValues.shortcode not set')

        return
      }

      const result = await service.listCandidates(shortcode, 'Active', undefined, undefined, 5)

      expect(Array.isArray(result.candidates)).toBe(true)
    })

    it('creates a sourced candidate', async () => {
      const { shortcode } = testValues

      if (!shortcode) {
        console.log('Skipping createCandidate: testValues.shortcode not set')

        return
      }

      const result = await service.createCandidate(
        shortcode,
        `E2E Candidate ${ SUFFIX }`,
        undefined,
        undefined,
        `e2e.candidate.${ SUFFIX }@example.com`,
        undefined,
        undefined,
        'Created by the FlowRunner e2e test suite.',
        true
      )

      expect(result).toHaveProperty('candidate')
      expect(result.candidate).toHaveProperty('id')

      createdCandidateId = result.candidate.id
    })

    it('gets the created candidate', async () => {
      if (!createdCandidateId) {
        console.log('Skipping getCandidate: no candidate was created')

        return
      }

      const result = await service.getCandidate(createdCandidateId)

      expect(result).toHaveProperty('candidate')
      expect(result.candidate).toHaveProperty('id', createdCandidateId)
    })

    it('updates the created candidate', async () => {
      if (!createdCandidateId) {
        console.log('Skipping updateCandidate: no candidate was created')

        return
      }

      const result = await service.updateCandidate(
        createdCandidateId,
        undefined,
        undefined,
        undefined,
        undefined,
        'E2E Headline'
      )

      expect(result).toBeDefined()
    })

    it('lists the candidate activities', async () => {
      if (!createdCandidateId) {
        console.log('Skipping listCandidateActivities: no candidate was created')

        return
      }

      const result = await service.listCandidateActivities(createdCandidateId)

      expect(result).toHaveProperty('activities')
      expect(Array.isArray(result.activities)).toBe(true)
    })

    it('comments on the candidate', async () => {
      const { memberId } = testValues

      if (!createdCandidateId || !memberId) {
        console.log('Skipping createComment: no candidate created or testValues.memberId not set')

        return
      }

      const result = await service.createComment(createdCandidateId, memberId, `E2E comment ${ SUFFIX }`)

      expect(result).toBeDefined()
    })

    it('rates the candidate', async () => {
      const { memberId } = testValues

      if (!createdCandidateId || !memberId) {
        console.log('Skipping createRating: no candidate created or testValues.memberId not set')

        return
      }

      const result = await service.createRating(createdCandidateId, memberId, 'Thumbs', 1, 'E2E rating')

      expect(result).toBeDefined()
    })

    it('moves the candidate to another stage', async () => {
      const { memberId, targetStage } = testValues

      if (!createdCandidateId || !memberId || !targetStage) {
        console.log('Skipping moveCandidateToStage: candidate, testValues.memberId or testValues.targetStage missing')

        return
      }

      const result = await service.moveCandidateToStage(createdCandidateId, memberId, targetStage)

      expect(result).toBeDefined()
    })

    it('disqualifies and reverts the candidate', async () => {
      const { memberId } = testValues

      if (!createdCandidateId || !memberId) {
        console.log('Skipping disqualify/revert: no candidate created or testValues.memberId not set')

        return
      }

      const disqualified = await service.disqualifyCandidate(createdCandidateId, memberId, 'E2E cleanup')

      expect(disqualified).toBeDefined()

      const reverted = await service.revertCandidate(createdCandidateId, memberId)

      expect(reverted).toBeDefined()
    })

    it('copies the candidate to another job', async () => {
      const { memberId, targetJobShortcode } = testValues

      if (!createdCandidateId || !memberId || !targetJobShortcode) {
        console.log('Skipping copyCandidateToJob: candidate, testValues.memberId or testValues.targetJobShortcode missing')

        return
      }

      const result = await service.copyCandidateToJob(createdCandidateId, memberId, targetJobShortcode)

      expect(result).toBeDefined()
    })
  })

  // ── Dictionaries ──

  describe('dictionaries', () => {
    it('returns job dictionary items', async () => {
      const result = await service.getJobsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()
    })

    it('filters the job dictionary by search text', async () => {
      const result = await service.getJobsDictionary({ search: 'zzz-no-such-job-zzz' })

      expect(result.items).toEqual([])
    })

    it('returns member dictionary items', async () => {
      const result = await service.getMembersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Polling trigger ──

  describe('onNewCandidate', () => {
    it('establishes a baseline on the first cycle', async () => {
      const result = await service.onNewCandidate({ parameters: {}, state: null })

      expect(result).toHaveProperty('events', [])
      expect(result.state).toHaveProperty('lastCreatedAt')
      expect(Array.isArray(result.state.seenIds)).toBe(true)
    })

    it('emits nothing on a second cycle with the returned state', async () => {
      const first = await service.onNewCandidate({ parameters: {}, state: null })
      const second = await service.onNewCandidate({ parameters: {}, state: first.state })

      expect(Array.isArray(second.events)).toBe(true)
    })

    it('dispatches through handleTriggerPollingForEvent', async () => {
      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewCandidate',
        parameters: {},
        state: null,
      })

      expect(result).toHaveProperty('state')
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a descriptive error for an unknown job shortcode', async () => {
      await expect(service.getJob(`no-such-job-${ SUFFIX }`)).rejects.toThrow('Workable API error')
    })
  })
})
