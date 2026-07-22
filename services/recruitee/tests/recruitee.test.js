'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-api-token'
const COMPANY_ID = 'test-company'
const BASE = `https://api.recruitee.com/c/${ COMPANY_ID }`

describe('Recruitee Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiToken: API_TOKEN, companyId: COMPANY_ID })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiToken', required: true, shared: false }),
          expect.objectContaining({ name: 'companyId', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Test Connection ──

  describe('testConnection', () => {
    it('sends GET to /admin and returns connection info', async () => {
      mock.onGet(`${ BASE }/admin`).reply({
        admin: { id: 111, name: 'Jane', email: 'jane@example.com' },
      })

      const result = await service.testConnection()

      expect(result).toEqual({
        connected: true,
        companyId: COMPANY_ID,
        user: { id: 111, name: 'Jane', email: 'jane@example.com' },
      })

      expect(mock.history).toHaveLength(1)

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ API_TOKEN }`,
      })
    })
  })

  // ── Candidates ──

  describe('searchCandidates', () => {
    it('searches candidates by text', async () => {
      mock.onGet(`${ BASE }/search/new/candidates`).reply({
        hits: [{ id: 1, name: 'Alex' }],
        total: 1,
      })

      const result = await service.searchCandidates('Alex')

      expect(result).toEqual({ candidates: [{ id: 1, name: 'Alex' }], total: 1 })

      expect(mock.history[0].query).toMatchObject({
        query: 'Alex',
        page: 1,
        limit: 30,
        sort_by: 'created_at_desc',
      })
    })

    it('lists candidates without search text', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({
        candidates: [{ id: 2, name: 'Bob' }],
        total: 1,
      })

      const result = await service.searchCandidates('')

      expect(result).toEqual({ candidates: [{ id: 2, name: 'Bob' }], total: 1 })
      expect(mock.history[0].query).toMatchObject({ page: 1, limit: 30, sort: 'created_at_desc' })
    })

    it('filters by job and status', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({ candidates: [], total: 0 })

      await service.searchCandidates('', '987', 'disqualified', 2, 10, 'candidate_name')

      expect(mock.history[0].query).toMatchObject({
        offer_id: '987',
        disqualified: true,
        page: 2,
        limit: 10,
        sort: 'candidate_name',
      })
    })

    it('filters by active status with qualified flag', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({ candidates: [], total: 0 })

      await service.searchCandidates('', null, 'active')

      expect(mock.history[0].query).toMatchObject({ qualified: true })
    })
  })

  describe('getCandidate', () => {
    it('fetches a candidate by ID', async () => {
      mock.onGet(`${ BASE }/candidates/123`).reply({
        candidate: { id: 123, name: 'Alex' },
      })

      const result = await service.getCandidate('123')

      expect(result).toEqual({ id: 123, name: 'Alex' })
    })

    it('throws when candidateId is missing', async () => {
      await expect(service.getCandidate()).rejects.toThrow('"Candidate" is required.')
    })
  })

  describe('createCandidate', () => {
    it('creates a candidate with required fields only', async () => {
      mock.onPost(`${ BASE }/candidates`).reply({
        candidate: { id: 100, name: 'New Person' },
      })

      const result = await service.createCandidate('New Person')

      expect(result).toMatchObject({ id: 100, name: 'New Person', isNew: true })

      expect(mock.history[0].body).toEqual({
        candidate: { name: 'New Person' },
      })
    })

    it('creates a candidate with all fields', async () => {
      mock.onPost(`${ BASE }/candidates`).reply({
        candidate: { id: 101, name: 'Alex Carter' },
      })

      const result = await service.createCandidate(
        'Alex Carter', 'alex@example.com', '+1555', '987', 'LinkedIn',
        'Cover letter text', 'https://cv.pdf', ['Senior', 'Remote'], false
      )

      expect(result.isNew).toBe(true)

      expect(mock.history[0].body).toMatchObject({
        candidate: {
          name: 'Alex Carter',
          emails: ['alex@example.com'],
          phones: ['+1555'],
          cover_letter: 'Cover letter text',
          sources: ['LinkedIn'],
          remote_cv_url: 'https://cv.pdf',
          tags: ['Senior', 'Remote'],
        },
        offers: [987],
      })
    })

    it('updates existing candidate when updateIfExists is true', async () => {
      mock.onGet(`${ BASE }/candidates/check_presence`).reply({
        candidate: { id: 50, name: 'Existing' },
      })

      mock.onPatch(`${ BASE }/candidates/50`).reply({
        candidate: { id: 50, name: 'Updated Name' },
      })

      const result = await service.createCandidate(
        'Updated Name', 'existing@example.com', null, null, null, null, null, null, true
      )

      expect(result.isNew).toBe(false)
      expect(result.id).toBe(50)
    })

    it('throws when name is missing', async () => {
      await expect(service.createCandidate()).rejects.toThrow('"Full Name" is required.')
    })
  })

  describe('updateCandidate', () => {
    it('sends PATCH with candidate updates', async () => {
      mock.onPatch(`${ BASE }/candidates/123`).reply({
        candidate: { id: 123, name: 'Updated' },
      })

      const result = await service.updateCandidate('123', 'Updated', 'new@email.com')

      expect(result).toEqual({ id: 123, name: 'Updated' })

      expect(mock.history[0].body).toEqual({
        candidate: { name: 'Updated', emails: ['new@email.com'] },
      })
    })

    it('throws when candidateId is missing', async () => {
      await expect(service.updateCandidate()).rejects.toThrow('"Candidate" is required.')
    })
  })

  describe('deleteCandidate', () => {
    it('returns preview when confirm is false', async () => {
      mock.onGet(`${ BASE }/candidates/123`).reply({
        candidate: { id: 123, name: 'Alex', emails: ['a@b.com'] },
      })

      const result = await service.deleteCandidate('123', false)

      expect(result.confirmed).toBe(false)
      expect(result.deleted).toBe(false)
      expect(result.wouldDelete).toMatchObject({ id: 123, name: 'Alex' })
    })

    it('deletes when confirm is true', async () => {
      mock.onDelete(`${ BASE }/candidates/123`).reply({})

      const result = await service.deleteCandidate('123', true)

      expect(result).toEqual({ confirmed: true, deleted: true, candidateId: '123' })
    })

    it('throws when candidateId is missing', async () => {
      await expect(service.deleteCandidate()).rejects.toThrow('"Candidate" is required.')
    })
  })

  describe('assignCandidateToJob', () => {
    it('posts a placement', async () => {
      mock.onPost(`${ BASE }/placements`).reply({
        placement: { id: 5001, candidate_id: 123, offer_id: 987 },
      })

      const result = await service.assignCandidateToJob('123', '987', '3001')

      expect(result).toEqual({ id: 5001, candidate_id: 123, offer_id: 987 })

      expect(mock.history[0].body).toEqual({
        placement: { candidate_id: 123, offer_id: 987, stage_id: 3001 },
      })
    })

    it('throws when candidateId is missing', async () => {
      await expect(service.assignCandidateToJob()).rejects.toThrow('"Candidate" is required.')
    })

    it('throws when jobId is missing', async () => {
      await expect(service.assignCandidateToJob('123')).rejects.toThrow('"Job" is required.')
    })
  })

  describe('moveCandidateToStage', () => {
    it('moves candidates to a stage', async () => {
      mock.onGet(`${ BASE }/offers/987/candidates/1/placement`).reply({
        placement: { id: 5001 },
      })

      mock.onPatch(`${ BASE }/placements/5001/change_stage`).reply({})

      const result = await service.moveCandidateToStage(['1'], '987', '3002')

      expect(result).toEqual({ jobId: '987', stageId: '3002', moved: ['1'], failed: [] })
    })

    it('throws when jobId is missing', async () => {
      await expect(service.moveCandidateToStage(['1'], null, '3002')).rejects.toThrow('"Job" is required.')
    })

    it('throws when candidateId is empty', async () => {
      await expect(service.moveCandidateToStage([], '987', '3002')).rejects.toThrow('"Candidate(s)" is required.')
    })
  })

  describe('disqualifyCandidate', () => {
    it('disqualifies candidates with reason', async () => {
      mock.onGet(`${ BASE }/offers/987/candidates/1/placement`).reply({
        placement: { id: 5001 },
      })

      mock.onPatch(`${ BASE }/placements/5001/disqualify`).reply({})

      const result = await service.disqualifyCandidate(['1'], '987', '42')

      expect(result).toEqual({ jobId: '987', reasonId: '42', disqualified: ['1'], failed: [] })
    })

    it('throws when jobId is missing', async () => {
      await expect(service.disqualifyCandidate(['1'])).rejects.toThrow('"Job" is required.')
    })
  })

  describe('restoreCandidate', () => {
    it('restores candidates', async () => {
      mock.onGet(`${ BASE }/offers/987/candidates/1/placement`).reply({
        placement: { id: 5001 },
      })

      mock.onPatch(`${ BASE }/placements/5001/requalify`).reply({})

      const result = await service.restoreCandidate(['1'], '987')

      expect(result).toEqual({ jobId: '987', restored: ['1'], failed: [] })
    })
  })

  describe('addCandidateTags', () => {
    it('posts tags to a candidate', async () => {
      mock.onPost(`${ BASE }/candidates/123/tags`).reply({})

      const result = await service.addCandidateTags('123', ['Reviewed', 'Top Pick'])

      expect(result).toEqual({ candidateId: '123', tagsAdded: ['Reviewed', 'Top Pick'] })
      expect(mock.history[0].body).toEqual({ tags: ['Reviewed', 'Top Pick'] })
    })

    it('throws when tags are empty', async () => {
      await expect(service.addCandidateTags('123', [])).rejects.toThrow('"Tags" is required.')
    })
  })

  describe('addCandidateSource', () => {
    it('posts source to a candidate', async () => {
      mock.onPost(`${ BASE }/candidates/123/sources`).reply({})

      const result = await service.addCandidateSource('123', 'LinkedIn')

      expect(result).toEqual({ candidateId: '123', sourcesAdded: ['LinkedIn'] })
    })

    it('throws when source is missing', async () => {
      await expect(service.addCandidateSource('123')).rejects.toThrow('"Source" is required.')
    })
  })

  describe('addCandidateToTalentPool', () => {
    it('posts a placement for talent pool', async () => {
      mock.onPost(`${ BASE }/placements`).reply({
        placement: { id: 5002, candidate_id: 123, offer_id: 654 },
      })

      const result = await service.addCandidateToTalentPool('123', '654')

      expect(result).toEqual({ id: 5002, candidate_id: 123, offer_id: 654 })
    })

    it('throws when talentPoolId is missing', async () => {
      await expect(service.addCandidateToTalentPool('123')).rejects.toThrow('"Talent Pool" is required.')
    })
  })

  describe('parseCandidateCv', () => {
    it('posts parse_cv request', async () => {
      mock.onPost(`${ BASE }/candidates/123/parse_cv`).reply({ success: true })

      const result = await service.parseCandidateCv('123')

      expect(result).toEqual({ candidateId: '123', parsed: true, result: { success: true } })
    })
  })

  describe('mergeCandidates', () => {
    it('merges candidates', async () => {
      mock.onPatch(`${ BASE }/candidates/100/merge`).reply({})

      const result = await service.mergeCandidates('100', '200')

      expect(result).toEqual({ candidateId: '100', mergedFrom: '200', merged: true })
      expect(mock.history[0].body).toEqual({ ids: [200] })
    })

    it('throws when duplicateId is missing', async () => {
      await expect(service.mergeCandidates('100')).rejects.toThrow('"Duplicate Candidate" is required.')
    })
  })

  // ── Dictionaries ──

  describe('getJobsDictionary', () => {
    it('returns mapped job items', async () => {
      mock.onGet(`${ BASE }/offers`).reply({
        offers: [
          { id: 987, title: 'Engineer', location: 'Berlin', status: 'published', kind: 'job' },
          { id: 654, title: 'Pool', kind: 'talent_pool' },
        ],
      })

      const result = await service.getJobsDictionary({})

      expect(result.items).toEqual([
        { label: 'Engineer', value: '987', note: 'Berlin · published' },
      ])

      expect(result.cursor).toBeNull()
    })

    it('handles null payload', async () => {
      mock.onGet(`${ BASE }/offers`).reply({ offers: [] })

      const result = await service.getJobsDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getTalentPoolsDictionary', () => {
    it('returns mapped talent pool items', async () => {
      mock.onGet(`${ BASE }/talent_pools`).reply({
        talent_pools: [{ id: 654, title: 'Future Designers' }],
      })

      const result = await service.getTalentPoolsDictionary({})

      expect(result.items).toEqual([
        { label: 'Future Designers', value: '654', note: 'talent pool' },
      ])
    })
  })

  describe('getCandidatesDictionary', () => {
    it('searches candidates when search is provided', async () => {
      mock.onGet(`${ BASE }/search/new/candidates`).reply({
        hits: [{ id: 1, name: 'Alex', emails: ['alex@test.com'] }],
      })

      const result = await service.getCandidatesDictionary({ search: 'Alex' })

      expect(result.items).toEqual([
        { label: 'Alex', value: '1', note: 'alex@test.com' },
      ])
    })

    it('lists candidates when no search', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({
        candidates: [{ id: 2, name: 'Bob', emails: ['bob@test.com'] }],
      })

      const result = await service.getCandidatesDictionary({})

      expect(result.items).toEqual([
        { label: 'Bob', value: '2', note: 'bob@test.com' },
      ])
    })
  })

  describe('getTagsDictionary', () => {
    it('returns mapped tag items', async () => {
      mock.onGet(`${ BASE }/tags`).reply({
        tags: [{ id: 7, name: 'Referral', taggings_count: 5 }],
      })

      const result = await service.getTagsDictionary({})

      expect(result.items).toEqual([
        { label: 'Referral', value: '7', note: '5 candidates' },
      ])
    })
  })

  describe('getStagesDictionary', () => {
    it('returns stages for a job', async () => {
      mock.onGet(`${ BASE }/offers/987`).reply({
        offer: {
          pipeline_template: {
            stages: [{ id: 3001, name: 'Applied', category: 'apply' }],
          },
        },
      })

      const result = await service.getStagesDictionary({ criteria: { jobId: '987' } })

      expect(result.items).toEqual([
        { label: 'Applied', value: '3001', note: 'apply' },
      ])

      expect(result.cursor).toBeNull()
    })

    it('returns empty when no jobId', async () => {
      const result = await service.getStagesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── Jobs ──

  describe('listJobs', () => {
    it('lists non-archived jobs by default', async () => {
      mock.onGet(`${ BASE }/offers`).reply({
        offers: [{ id: 987, title: 'Engineer', kind: 'job' }],
        total: 1,
      })

      const result = await service.listJobs()

      expect(result).toEqual({ jobs: [{ id: 987, title: 'Engineer', kind: 'job' }], total: 1 })
      expect(mock.history[0].query).toMatchObject({ scope: 'not_archived' })
    })

    it('includes archived when toggled', async () => {
      mock.onGet(`${ BASE }/offers`).reply({ offers: [], total: 0 })

      await service.listJobs(null, true)

      expect(mock.history[0].query).toMatchObject({ scope: 'archived' })
    })

    it('filters talent pools out', async () => {
      mock.onGet(`${ BASE }/offers`).reply({
        offers: [
          { id: 987, title: 'Engineer', kind: 'job' },
          { id: 654, title: 'Pool', kind: 'talent_pool' },
        ],
      })

      const result = await service.listJobs()

      expect(result.jobs).toHaveLength(1)
      expect(result.jobs[0].id).toBe(987)
    })
  })

  describe('getJob', () => {
    it('fetches a job by ID', async () => {
      mock.onGet(`${ BASE }/offers/987`).reply({ offer: { id: 987, title: 'Engineer' } })

      const result = await service.getJob('987')

      expect(result).toEqual({ id: 987, title: 'Engineer' })
    })

    it('throws when jobId is missing', async () => {
      await expect(service.getJob()).rejects.toThrow('"Job" is required.')
    })
  })

  describe('createJob', () => {
    it('creates a job with all fields', async () => {
      mock.onPost(`${ BASE }/offers`).reply({ offer: { id: 987, title: 'Engineer', status: 'draft' } })

      const result = await service.createJob(
        'Engineer', 'Description', '5', '21', 'full_time', true, { salary: '100k' }
      )

      expect(result).toEqual({ id: 987, title: 'Engineer', status: 'draft' })

      expect(mock.history[0].body).toMatchObject({
        offer: {
          title: 'Engineer',
          description: 'Description',
          kind: 'job',
          department_id: 5,
          location_ids: [21],
          employment_type: 'full_time',
          remote: true,
          salary: '100k',
        },
      })
    })

    it('throws when title is missing', async () => {
      await expect(service.createJob()).rejects.toThrow('"Title" is required.')
    })
  })

  describe('updateJob', () => {
    it('patches job fields', async () => {
      mock.onPatch(`${ BASE }/offers/987`).reply({ offer: { id: 987, title: 'Staff Engineer' } })

      const result = await service.updateJob('987', 'Staff Engineer')

      expect(result).toEqual({ id: 987, title: 'Staff Engineer' })
      expect(mock.history[0].body).toEqual({ offer: { title: 'Staff Engineer' } })
    })
  })

  describe('updateJobStatus', () => {
    it('changes job status', async () => {
      mock.onPatch(`${ BASE }/offers/987/publish`).reply({ offer: { id: 987, status: 'published' } })

      const result = await service.updateJobStatus('987', 'publish')

      expect(result).toEqual({ id: 987, status: 'published' })
    })

    it('throws on invalid status', async () => {
      await expect(service.updateJobStatus('987', 'invalid')).rejects.toThrow('"New Status" must be one of')
    })
  })

  describe('duplicateJob', () => {
    it('duplicates a job', async () => {
      mock.onPatch(`${ BASE }/offers/987/duplicate`).reply({ offer: { id: 988, title: 'Engineer (copy)' } })

      const result = await service.duplicateJob('987')

      expect(result).toEqual({ id: 988, title: 'Engineer (copy)' })
    })
  })

  describe('deleteJob', () => {
    it('returns preview when confirm is false', async () => {
      mock.onGet(`${ BASE }/offers/987`).reply({ offer: { id: 987, title: 'Engineer', status: 'draft' } })

      const result = await service.deleteJob('987', false)

      expect(result.confirmed).toBe(false)
      expect(result.wouldDelete).toMatchObject({ id: 987, title: 'Engineer' })
    })

    it('deletes when confirm is true', async () => {
      mock.onDelete(`${ BASE }/offers/987`).reply({})

      const result = await service.deleteJob('987', true)

      expect(result).toEqual({ confirmed: true, deleted: true, jobId: '987' })
    })
  })

  describe('tagJob', () => {
    it('adds tags to a job', async () => {
      mock.onPost(`${ BASE }/offers/987/offer_tags`).reply({})

      const result = await service.tagJob('987', ['Urgent'])

      expect(result).toEqual({ jobId: '987', action: 'add', tags: ['Urgent'] })
    })

    it('removes tags from a job', async () => {
      mock.onDelete(`${ BASE }/offers/987/offer_tags`).reply({})

      const result = await service.tagJob('987', ['Urgent'], 'remove')

      expect(result).toEqual({ jobId: '987', action: 'remove', tags: ['Urgent'] })
    })
  })

  describe('getJobCandidates', () => {
    it('lists placements for a job', async () => {
      mock.onGet(`${ BASE }/offers/987/placements`).reply({
        placements: [{ id: 5001, candidate_id: 123 }],
      })

      const result = await service.getJobCandidates('987')

      expect(result).toEqual({ jobId: '987', placements: [{ id: 5001, candidate_id: 123 }] })
    })
  })

  describe('listPipelineStages', () => {
    it('extracts stages from a job', async () => {
      mock.onGet(`${ BASE }/offers/987`).reply({
        offer: { pipeline_template: { stages: [{ id: 3001, name: 'Applied' }] } },
      })

      const result = await service.listPipelineStages('987')

      expect(result).toEqual({ jobId: '987', stages: [{ id: 3001, name: 'Applied' }] })
    })
  })

  // ── Pipeline Templates ──

  describe('listPipelineTemplates', () => {
    it('lists pipeline templates', async () => {
      mock.onGet(`${ BASE }/pipeline_templates`).reply({
        pipeline_templates: [{ id: 7, name: 'Standard Hiring' }],
      })

      const result = await service.listPipelineTemplates()

      expect(result).toEqual({ pipelineTemplates: [{ id: 7, name: 'Standard Hiring' }] })
    })
  })

  describe('getPipelineTemplate', () => {
    it('fetches a pipeline template', async () => {
      mock.onGet(`${ BASE }/pipeline_templates/7`).reply({
        pipeline_template: { id: 7, name: 'Standard' },
      })

      const result = await service.getPipelineTemplate('7')

      expect(result).toEqual({ id: 7, name: 'Standard' })
    })
  })

  describe('createPipelineTemplate', () => {
    it('creates a pipeline template', async () => {
      mock.onPost(`${ BASE }/pipeline_templates`).reply({
        pipeline_template: { id: 8, name: 'Engineering' },
      })

      const result = await service.createPipelineTemplate('Engineering')

      expect(result).toEqual({ id: 8, name: 'Engineering' })
      expect(mock.history[0].body).toEqual({ pipeline_template: { name: 'Engineering' } })
    })
  })

  describe('updatePipelineTemplate', () => {
    it('updates a pipeline template name', async () => {
      mock.onPatch(`${ BASE }/pipeline_templates/8`).reply({
        pipeline_template: { id: 8, name: 'Engineering v2' },
      })

      const result = await service.updatePipelineTemplate('8', 'Engineering v2')

      expect(result).toEqual({ id: 8, name: 'Engineering v2' })
    })
  })

  describe('deletePipelineTemplate', () => {
    it('returns preview when confirm is false', async () => {
      mock.onGet(`${ BASE }/pipeline_templates/8`).reply({
        pipeline_template: { id: 8, name: 'Engineering' },
      })

      const result = await service.deletePipelineTemplate('8', false)

      expect(result.confirmed).toBe(false)
    })

    it('deletes when confirm is true', async () => {
      mock.onDelete(`${ BASE }/pipeline_templates/8`).reply({})

      const result = await service.deletePipelineTemplate('8', true)

      expect(result).toEqual({ confirmed: true, deleted: true, templateId: '8' })
    })
  })

  describe('addPipelineStage', () => {
    it('adds a stage to a template', async () => {
      mock.onPost(`${ BASE }/pipeline_templates/7/stages`).reply({
        stage: { id: 3010, name: 'Phone Screen' },
      })

      const result = await service.addPipelineStage('7', 'Phone Screen', 'phone_screen')

      expect(result).toEqual({ id: 3010, name: 'Phone Screen' })

      expect(mock.history[0].body).toEqual({
        stage: { name: 'Phone Screen', category: 'phone_screen' },
      })
    })
  })

  describe('updatePipelineStage', () => {
    it('updates a stage name', async () => {
      mock.onPatch(`${ BASE }/pipeline_templates/7/stages/3010`).reply({
        stage: { id: 3010, name: 'Recruiter Screen' },
      })

      const result = await service.updatePipelineStage('7', '3010', 'Recruiter Screen')

      expect(result).toEqual({ id: 3010, name: 'Recruiter Screen' })
    })
  })

  describe('deletePipelineStage', () => {
    it('returns preview when confirm is false', async () => {
      const result = await service.deletePipelineStage('7', '3010', '3001', false)

      expect(result.confirmed).toBe(false)
      expect(result.wouldDelete).toMatchObject({ stageId: '3010', movedTo: '3001' })
    })

    it('deletes and moves placements when confirm is true', async () => {
      mock.onPatch(`${ BASE }/pipeline_templates/7/stages/delete_and_move_placements/3010`).reply({})

      const result = await service.deletePipelineStage('7', '3010', '3001', true)

      expect(result).toEqual({ confirmed: true, deleted: true, stageId: '3010', movedTo: '3001' })
      expect(mock.history[0].body).toEqual({ destination_stage_id: 3001 })
    })
  })

  // ── Organization ──

  describe('listDisqualifyReasons', () => {
    it('lists disqualify reasons', async () => {
      mock.onGet(`${ BASE }/disqualify_reasons`).reply({
        disqualify_reasons: [{ id: 42, name: 'Not a fit' }],
      })

      const result = await service.listDisqualifyReasons()

      expect(result).toEqual({ reasons: [{ id: 42, name: 'Not a fit' }] })
    })
  })

  describe('createDisqualifyReason', () => {
    it('creates a disqualify reason', async () => {
      mock.onPost(`${ BASE }/disqualify_reasons`).reply({
        disqualify_reason: { id: 43, name: 'Salary expectations' },
      })

      const result = await service.createDisqualifyReason('Salary expectations')

      expect(result).toEqual({ id: 43, name: 'Salary expectations' })
    })
  })

  describe('updateDisqualifyReason', () => {
    it('updates a disqualify reason', async () => {
      mock.onPatch(`${ BASE }/disqualify_reasons/43`).reply({
        disqualify_reason: { id: 43, name: 'Too expensive' },
      })

      const result = await service.updateDisqualifyReason('43', 'Too expensive')

      expect(result).toEqual({ id: 43, name: 'Too expensive' })
    })
  })

  describe('deleteDisqualifyReason', () => {
    it('returns preview when confirm is false', async () => {
      const result = await service.deleteDisqualifyReason('43', false)

      expect(result.confirmed).toBe(false)
    })

    it('deletes when confirm is true', async () => {
      mock.onDelete(`${ BASE }/disqualify_reasons/43`).reply({})

      const result = await service.deleteDisqualifyReason('43', true)

      expect(result).toEqual({ confirmed: true, deleted: true, reasonId: '43' })
    })
  })

  describe('listDepartments', () => {
    it('lists departments', async () => {
      mock.onGet(`${ BASE }/departments`).reply({
        departments: [{ id: 5, name: 'Engineering' }],
      })

      const result = await service.listDepartments()

      expect(result).toEqual({ departments: [{ id: 5, name: 'Engineering' }] })
    })
  })

  describe('createDepartment', () => {
    it('creates a department', async () => {
      mock.onPost(`${ BASE }/departments`).reply({
        department: { id: 6, name: 'Marketing' },
      })

      const result = await service.createDepartment('Marketing')

      expect(result).toEqual({ id: 6, name: 'Marketing' })
    })
  })

  describe('deleteDepartment', () => {
    it('deletes when confirm is true', async () => {
      mock.onDelete(`${ BASE }/departments/6`).reply({})

      const result = await service.deleteDepartment('6', true)

      expect(result).toEqual({ confirmed: true, deleted: true, departmentId: '6' })
    })
  })

  describe('listLocations', () => {
    it('lists locations', async () => {
      mock.onGet(`${ BASE }/locations`).reply({
        locations: [{ id: 21, name: 'Berlin' }],
      })

      const result = await service.listLocations()

      expect(result).toEqual({ locations: [{ id: 21, name: 'Berlin' }] })
    })
  })

  describe('createLocation', () => {
    it('creates a location with all fields', async () => {
      mock.onPost(`${ BASE }/locations`).reply({
        location: { id: 22, name: 'Berlin HQ', city: 'Berlin', country: 'Germany' },
      })

      const result = await service.createLocation('Berlin HQ', 'Berlin', 'Germany')

      expect(result).toEqual({ id: 22, name: 'Berlin HQ', city: 'Berlin', country: 'Germany' })

      expect(mock.history[0].body).toEqual({
        location: { name: 'Berlin HQ', city: 'Berlin', country: 'Germany' },
      })
    })
  })

  describe('deleteLocation', () => {
    it('deletes when confirm is true', async () => {
      mock.onDelete(`${ BASE }/locations/22`).reply({})

      const result = await service.deleteLocation('22', true)

      expect(result).toEqual({ confirmed: true, deleted: true, locationId: '22' })
    })
  })

  describe('listTags', () => {
    it('lists tags', async () => {
      mock.onGet(`${ BASE }/tags`).reply({ tags: [{ id: 7, name: 'Referral' }] })

      const result = await service.listTags()

      expect(result).toEqual({ tags: [{ id: 7, name: 'Referral' }] })
    })
  })

  describe('listSources', () => {
    it('lists sources', async () => {
      mock.onGet(`${ BASE }/sources`).reply({ sources: [{ id: 3, name: 'LinkedIn' }] })

      const result = await service.listSources()

      expect(result).toEqual({ sources: [{ id: 3, name: 'LinkedIn' }] })
    })
  })

  describe('listTalentPools', () => {
    it('lists talent pools', async () => {
      mock.onGet(`${ BASE }/talent_pools`).reply({
        talent_pools: [{ id: 654, title: 'Future Designers' }],
      })

      const result = await service.listTalentPools()

      expect(result).toEqual({ talentPools: [{ id: 654, title: 'Future Designers' }] })
    })
  })

  describe('createTalentPool', () => {
    it('creates a talent pool', async () => {
      mock.onPost(`${ BASE }/talent_pools`).reply({
        talent_pool: { id: 655, title: 'Senior Designers', kind: 'talent_pool' },
      })

      const result = await service.createTalentPool('Senior Designers')

      expect(result).toEqual({ id: 655, title: 'Senior Designers', kind: 'talent_pool' })
    })
  })

  describe('listTeamMembers', () => {
    it('lists admins', async () => {
      mock.onGet(`${ BASE }/admins`).reply({
        admins: [{ id: 111, name: 'Jane', email: 'jane@example.com' }],
      })

      const result = await service.listTeamMembers()

      expect(result).toEqual({ teamMembers: [{ id: 111, name: 'Jane', email: 'jane@example.com' }] })
    })
  })

  // ── Notes & Tasks ──

  describe('addCandidateNote', () => {
    it('adds a note to a candidate', async () => {
      mock.onPost(`${ BASE }/candidates/123/notes`).reply({
        note: { id: 7788, body: 'Great interview.' },
      })

      const result = await service.addCandidateNote('123', 'Great interview.')

      expect(result).toEqual({ id: 7788, body: 'Great interview.' })
      expect(mock.history[0].body).toEqual({ note: { body: 'Great interview.' } })
    })

    it('throws when body is missing', async () => {
      await expect(service.addCandidateNote('123')).rejects.toThrow('"Note" is required.')
    })
  })

  describe('listCandidateNotes', () => {
    it('lists notes for a candidate', async () => {
      mock.onGet(`${ BASE }/candidates/123/notes`).reply({
        notes: [{ id: 7788, body: 'Note text' }],
      })

      const result = await service.listCandidateNotes('123')

      expect(result).toEqual({ notes: [{ id: 7788, body: 'Note text' }] })
    })
  })

  describe('addNote', () => {
    it('adds a note to a job', async () => {
      mock.onPost(`${ BASE }/offers/987/notes`).reply({
        note: { id: 7790, body: 'Budget approved.' },
      })

      const result = await service.addNote('Job', '987', 'Budget approved.')

      expect(result).toEqual({ id: 7790, body: 'Budget approved.' })
    })

    it('throws on invalid target type', async () => {
      await expect(service.addNote('Invalid', '1', 'text')).rejects.toThrow(
        '"Attach to" must be Candidate, Job, Talent Pool, or Requisition.'
      )
    })
  })

  describe('updateNote', () => {
    it('patches a note body', async () => {
      mock.onPatch(`${ BASE }/notes/7788`).reply({
        note: { id: 7788, body: 'Updated text.' },
      })

      const result = await service.updateNote('7788', 'Updated text.')

      expect(result).toEqual({ id: 7788, body: 'Updated text.' })
    })
  })

  describe('pinNote', () => {
    it('pins a note', async () => {
      mock.onPatch(`${ BASE }/notes/7788/pin`).reply({})

      const result = await service.pinNote('7788', true)

      expect(result).toEqual({ id: '7788', pinned: true })
    })

    it('unpins a note', async () => {
      mock.onPatch(`${ BASE }/notes/7788/unpin`).reply({})

      const result = await service.pinNote('7788', false)

      expect(result).toEqual({ id: '7788', pinned: false })
    })
  })

  describe('deleteNote', () => {
    it('deletes when confirm is true', async () => {
      mock.onDelete(`${ BASE }/notes/7788`).reply({})

      const result = await service.deleteNote('7788', true)

      expect(result).toEqual({ confirmed: true, deleted: true, noteId: '7788' })
    })
  })

  describe('createTask', () => {
    it('creates a task with all fields', async () => {
      mock.onPost(`${ BASE }/tasks`).reply({
        task: { id: 4501, title: 'Call candidate' },
      })

      const result = await service.createTask('Call candidate', '2025-01-25', '123', '111')

      expect(result).toEqual({ id: 4501, title: 'Call candidate' })

      expect(mock.history[0].body).toMatchObject({
        task: {
          title: 'Call candidate',
          due_date: '2025-01-25',
          admin_id: 111,
          references: [{ id: 123, type: 'Candidate' }],
        },
      })
    })
  })

  describe('listTasks', () => {
    it('lists open tasks by default', async () => {
      mock.onGet(`${ BASE }/tasks`).reply({
        tasks: [{ id: 4501, title: 'Call candidate' }],
      })

      const result = await service.listTasks()

      expect(result).toEqual({ tasks: [{ id: 4501, title: 'Call candidate' }] })
      expect(mock.history[0].query).toMatchObject({ scope: 'pending' })
    })

    it('lists completed tasks', async () => {
      mock.onGet(`${ BASE }/tasks`).reply({ tasks: [] })

      await service.listTasks('completed')

      expect(mock.history[0].query).toMatchObject({ scope: 'completed' })
    })
  })

  describe('getTask', () => {
    it('fetches a task by ID', async () => {
      mock.onGet(`${ BASE }/tasks/4501`).reply({ task: { id: 4501, title: 'Test' } })

      const result = await service.getTask('4501')

      expect(result).toEqual({ id: 4501, title: 'Test' })
    })
  })

  describe('updateTask', () => {
    it('patches task fields', async () => {
      mock.onPatch(`${ BASE }/tasks/4501`).reply({ task: { id: 4501, completed: true } })

      const result = await service.updateTask('4501', null, null, true)

      expect(result).toEqual({ id: 4501, completed: true })
      expect(mock.history[0].body).toEqual({ task: { completed: true } })
    })
  })

  describe('completeTask', () => {
    it('marks a task as completed', async () => {
      mock.onPatch(`${ BASE }/tasks/4501`).reply({ task: { id: 4501, completed: true } })

      const result = await service.completeTask('4501')

      expect(result).toEqual({ id: 4501, completed: true })
    })
  })

  describe('deleteTask', () => {
    it('deletes when confirm is true', async () => {
      mock.onDelete(`${ BASE }/tasks/4501`).reply({})

      const result = await service.deleteTask('4501', true)

      expect(result).toEqual({ confirmed: true, deleted: true, taskId: '4501' })
    })
  })

  // ── Activity & Custom Fields ──

  describe('listActivity', () => {
    it('lists company-wide activity', async () => {
      mock.onGet(`${ BASE }/tracking/activities`).reply({
        activities: [{ id: 99001, kind: 'candidate_moved' }],
      })

      const result = await service.listActivity()

      expect(result).toEqual({ activities: [{ id: 99001, kind: 'candidate_moved' }] })
    })

    it('lists activity for a candidate', async () => {
      mock.onGet(`${ BASE }/tracking/candidates/123/activities`).reply({
        activities: [],
      })

      const result = await service.listActivity('123')

      expect(result).toEqual({ activities: [] })
    })

    it('lists activity for a job', async () => {
      mock.onGet(`${ BASE }/tracking/offers/987/activities`).reply({
        activities: [],
      })

      const result = await service.listActivity(null, '987')

      expect(result).toEqual({ activities: [] })
    })
  })

  describe('listFieldsets', () => {
    it('lists fieldsets', async () => {
      mock.onGet(`${ BASE }/custom_fields/fieldsets`).reply({
        fieldsets: [{ id: 301, name: 'Engineering Screening' }],
      })

      const result = await service.listFieldsets()

      expect(result).toEqual({ fieldsets: [{ id: 301, name: 'Engineering Screening' }] })
    })
  })

  describe('createFieldset', () => {
    it('creates a fieldset', async () => {
      mock.onPost(`${ BASE }/custom_fields/fieldsets`).reply({
        fieldset: { id: 302, name: 'Test' },
      })

      const result = await service.createFieldset('Test')

      expect(result).toEqual({ id: 302, name: 'Test' })
    })
  })

  describe('deleteFieldset', () => {
    it('deletes when confirm is true', async () => {
      mock.onDelete(`${ BASE }/custom_fields/fieldsets/302`).reply({})

      const result = await service.deleteFieldset('302', true)

      expect(result).toEqual({ confirmed: true, deleted: true, fieldsetId: '302' })
    })
  })

  describe('setCandidateCustomField', () => {
    it('sets a custom field on a candidate', async () => {
      mock.onPost(`${ BASE }/custom_fields/candidates/123/fields`).reply({})

      const result = await service.setCandidateCustomField('123', '777', 'Senior')

      expect(result).toEqual({ candidateId: '123', fieldId: '777', value: 'Senior' })

      expect(mock.history[0].body).toEqual({
        field: { id: 777, values: ['Senior'] },
      })
    })
  })

  // ── Interviews ──

  describe('scheduleInterview', () => {
    it('creates an interview event', async () => {
      mock.onPost(`${ BASE }/interview/candidates/123/events`).reply({
        event: { id: 66001, title: 'Tech Interview' },
      })

      const result = await service.scheduleInterview(
        '123', 'Tech Interview', '2025-01-25T14:00', '2025-01-25T15:00', '987', 'Room A', false
      )

      expect(result).toMatchObject({ id: 66001, title: 'Tech Interview', scheduled: false })
    })

    it('notifies participants when toggled', async () => {
      mock.onPost(`${ BASE }/interview/candidates/123/events`).reply({
        event: { id: 66001, title: 'Tech Interview' },
      })

      mock.onPost(`${ BASE }/interview/events/66001/schedule`).reply({})

      const result = await service.scheduleInterview(
        '123', 'Tech Interview', '2025-01-25T14:00', null, null, null, true
      )

      expect(result.scheduled).toBe(true)
    })
  })

  describe('listInterviews', () => {
    it('lists interviews', async () => {
      mock.onGet(`${ BASE }/interview/events`).reply({
        events: [{ id: 66001, title: 'Tech Interview' }],
      })

      const result = await service.listInterviews()

      expect(result).toEqual({ interviews: [{ id: 66001, title: 'Tech Interview' }] })
    })
  })

  describe('getInterview', () => {
    it('fetches an interview by ID', async () => {
      mock.onGet(`${ BASE }/interview/events/66001`).reply({
        event: { id: 66001, title: 'Tech Interview' },
      })

      const result = await service.getInterview('66001')

      expect(result).toEqual({ id: 66001, title: 'Tech Interview' })
    })
  })

  describe('updateInterview', () => {
    it('patches interview fields', async () => {
      mock.onPatch(`${ BASE }/interview/events/66001`).reply({
        event: { id: 66001, title: 'Updated' },
      })

      const result = await service.updateInterview('66001', 'Updated')

      expect(result).toEqual({ id: 66001, title: 'Updated' })
    })
  })

  describe('cancelInterview', () => {
    it('cancels when confirm is true', async () => {
      mock.onDelete(`${ BASE }/interview/events/66001`).reply({})

      const result = await service.cancelInterview('66001', true)

      expect(result).toEqual({ confirmed: true, cancelled: true, eventId: '66001' })
    })
  })

  describe('submitScorecard', () => {
    it('submits a scorecard', async () => {
      mock.onPost(`${ BASE }/interview/candidates/123/results`).reply({
        result: { id: 71001, rating: 4 },
      })

      const result = await service.submitScorecard('123', '4', 'Strong technically.', '987')

      expect(result).toEqual({ id: 71001, rating: 4 })

      expect(mock.history[0].body).toEqual({
        result: { rating: 4, comment: 'Strong technically.', offer_id: 987 },
      })
    })
  })

  describe('listScorecards', () => {
    it('lists scorecards for a candidate', async () => {
      mock.onGet(`${ BASE }/interview/candidates/123/results/scorecards`).reply({
        scorecards: [{ id: 71001, rating: 4 }],
      })

      const result = await service.listScorecards('123')

      expect(result).toEqual({ scorecards: [{ id: 71001, rating: 4 }] })
    })
  })

  describe('requestInterviewFeedback', () => {
    it('requests feedback from reviewers', async () => {
      mock.onPost(`${ BASE }/interview/candidates/123/result_requests`).reply({})

      const result = await service.requestInterviewFeedback('123', ['111', '112'], 'Please review')

      expect(result).toEqual({ candidateId: '123', requestedFrom: [111, 112] })
    })

    it('throws when reviewerIds is empty', async () => {
      await expect(service.requestInterviewFeedback('123', [])).rejects.toThrow('"Reviewers" is required.')
    })
  })

  describe('listInterviewTemplates', () => {
    it('lists interview templates', async () => {
      mock.onGet(`${ BASE }/interview/templates`).reply({
        templates: [{ id: 501, name: 'Technical Screen' }],
      })

      const result = await service.listInterviewTemplates()

      expect(result).toEqual({ interviewTemplates: [{ id: 501, name: 'Technical Screen' }] })
    })
  })

  describe('createInterviewTemplate', () => {
    it('creates an interview template', async () => {
      mock.onPost(`${ BASE }/interview/templates`).reply({
        template: { id: 502, name: 'Technical Screen' },
      })

      const result = await service.createInterviewTemplate('Technical Screen')

      expect(result).toEqual({ id: 502, name: 'Technical Screen' })
    })
  })

  describe('deleteInterviewTemplate', () => {
    it('deletes when confirm is true', async () => {
      mock.onDelete(`${ BASE }/interview/templates/502`).reply({})

      const result = await service.deleteInterviewTemplate('502', true)

      expect(result).toEqual({ confirmed: true, deleted: true, templateId: '502' })
    })
  })

  describe('listInterviewSchedules', () => {
    it('lists interview schedules', async () => {
      mock.onGet(`${ BASE }/interview/schedules`).reply({
        schedules: [{ id: 801, name: '30-min screen' }],
      })

      const result = await service.listInterviewSchedules()

      expect(result).toEqual({ schedules: [{ id: 801, name: '30-min screen' }] })
    })
  })

  describe('listMeetingRooms', () => {
    it('lists meeting rooms', async () => {
      mock.onGet(`${ BASE }/interview/meeting_rooms`).reply({
        meeting_rooms: [{ id: 901, name: 'Room A' }],
      })

      const result = await service.listMeetingRooms()

      expect(result).toEqual({ meetingRooms: [{ id: 901, name: 'Room A' }] })
    })
  })

  describe('listCalendars', () => {
    it('lists calendars', async () => {
      mock.onGet(`${ BASE }/interview/calendars`).reply({
        calendars: [{ id: 1001, name: 'jane@example.com' }],
      })

      const result = await service.listCalendars()

      expect(result).toEqual({ calendars: [{ id: 1001, name: 'jane@example.com' }] })
    })
  })

  // ── Communication ──

  describe('sendEmail', () => {
    it('sends an email to a candidate', async () => {
      mock.onPost(`${ BASE }/mailbox/send`).reply({
        message: { id: 88001, state: 'sent' },
      })

      const result = await service.sendEmail('123', 'Next steps', 'Hello!', '12')

      expect(result).toEqual({ id: 88001, state: 'sent' })

      expect(mock.history[0].body).toMatchObject({
        candidate_id: 123,
        subject: 'Next steps',
        body: 'Hello!',
        email_template_id: 12,
      })
    })

    it('throws when subject is missing', async () => {
      await expect(service.sendEmail('123')).rejects.toThrow('"Subject" is required.')
    })
  })

  describe('scheduleEmail', () => {
    it('schedules an email', async () => {
      mock.onPost(`${ BASE }/mailbox/schedule`).reply({
        message: { id: 88002, state: 'scheduled' },
      })

      const result = await service.scheduleEmail('123', 'Subject', 'Body', '2025-01-26')

      expect(result).toEqual({ id: 88002, state: 'scheduled' })
    })

    it('throws when sendAt is missing', async () => {
      await expect(service.scheduleEmail('123', 'Subject', 'Body')).rejects.toThrow('"Send At" is required.')
    })
  })

  describe('listEmailThreads', () => {
    it('lists email threads for a candidate', async () => {
      mock.onGet(`${ BASE }/mailbox/candidate/123`).reply({
        threads: [{ id: 90001, subject: 'Application received' }],
      })

      const result = await service.listEmailThreads('123')

      expect(result).toEqual({ threads: [{ id: 90001, subject: 'Application received' }] })
    })
  })

  describe('getEmailThread', () => {
    it('fetches an email thread', async () => {
      mock.onGet(`${ BASE }/mailbox/threads/90001`).reply({
        thread: { id: 90001, subject: 'Test' },
      })

      const result = await service.getEmailThread('90001')

      expect(result).toEqual({ id: 90001, subject: 'Test' })
    })
  })

  describe('listEmailTemplates', () => {
    it('lists message templates by default', async () => {
      mock.onGet(`${ BASE }/email_templates`).reply({
        email_templates: [{ id: 12, name: 'Rejection' }],
      })

      const result = await service.listEmailTemplates()

      expect(result).toEqual({ templates: [{ id: 12, name: 'Rejection' }] })
    })

    it('lists event invitation templates', async () => {
      mock.onGet(`${ BASE }/event_invitation_templates`).reply({
        event_invitation_templates: [{ id: 15, name: 'Interview invite' }],
      })

      const result = await service.listEmailTemplates('Event Invitation')

      expect(result).toEqual({ templates: [{ id: 15, name: 'Interview invite' }] })
    })
  })

  describe('createEmailTemplate', () => {
    it('creates an email template', async () => {
      mock.onPost(`${ BASE }/email_templates`).reply({
        email_template: { id: 13, name: 'Interview Invite' },
      })

      const result = await service.createEmailTemplate('Message', 'Interview Invite', 'Subject', 'Body text')

      expect(result).toEqual({ id: 13, name: 'Interview Invite' })
    })
  })

  describe('deleteEmailTemplate', () => {
    it('deletes when confirm is true', async () => {
      mock.onDelete(`${ BASE }/email_templates/13`).reply({})

      const result = await service.deleteEmailTemplate('Message', '13', true)

      expect(result).toEqual({ confirmed: true, deleted: true, templateId: '13' })
    })
  })

  describe('sendSms', () => {
    it('sends an SMS', async () => {
      mock.onPost(`${ BASE }/texting/messages`).reply({
        message: { id: 95001, state: 'sent' },
      })

      const result = await service.sendSms('123', 'Hello!')

      expect(result).toEqual({ id: 95001, state: 'sent' })

      expect(mock.history[0].body).toEqual({
        message: { candidate_id: 123, body: 'Hello!' },
      })
    })
  })

  describe('listSmsThreads', () => {
    it('lists SMS threads', async () => {
      mock.onGet(`${ BASE }/texting/threads`).reply({
        threads: [{ id: 96001 }],
      })

      const result = await service.listSmsThreads()

      expect(result).toEqual({ threads: [{ id: 96001 }] })
    })
  })

  // ── Requisitions ──

  describe('findRequisitions', () => {
    it('lists requisitions', async () => {
      mock.onGet(`${ BASE }/requisitions`).reply({
        requisitions: [{ id: 2201, title: 'Backend Engineer' }],
      })

      const result = await service.findRequisitions()

      expect(result).toEqual({ requisitions: [{ id: 2201, title: 'Backend Engineer' }] })
    })
  })

  describe('getRequisition', () => {
    it('fetches a requisition', async () => {
      mock.onGet(`${ BASE }/requisitions/2201`).reply({
        requisition: { id: 2201, title: 'Backend Engineer' },
      })

      const result = await service.getRequisition('2201')

      expect(result).toEqual({ id: 2201, title: 'Backend Engineer' })
    })
  })

  describe('createRequisition', () => {
    it('creates a requisition', async () => {
      mock.onPost(`${ BASE }/requisitions`).reply({
        requisition: { id: 2202, title: 'Backend Engineer', openings: 2 },
      })

      const result = await service.createRequisition('Backend Engineer', '5', 2)

      expect(result).toEqual({ id: 2202, title: 'Backend Engineer', openings: 2 })
    })
  })

  describe('updateRequisition', () => {
    it('patches requisition fields', async () => {
      mock.onPatch(`${ BASE }/requisitions/2202`).reply({
        requisition: { id: 2202, title: 'Senior Backend' },
      })

      const result = await service.updateRequisition('2202', 'Senior Backend')

      expect(result).toEqual({ id: 2202, title: 'Senior Backend' })
    })
  })

  describe('updateRequisitionStatus', () => {
    it('changes requisition status', async () => {
      mock.onPatch(`${ BASE }/requisitions/2202/approve`).reply({
        requisition: { id: 2202, status: 'approved' },
      })

      const result = await service.updateRequisitionStatus('2202', 'approve', 'Looks good')

      expect(result).toEqual({ id: 2202, status: 'approved' })
      expect(mock.history[0].body).toEqual({ comment: 'Looks good' })
    })

    it('throws on invalid status', async () => {
      await expect(service.updateRequisitionStatus('2202', 'invalid')).rejects.toThrow(
        '"New Status" must be one of'
      )
    })
  })

  describe('deleteRequisition', () => {
    it('deletes when confirm is true', async () => {
      mock.onDelete(`${ BASE }/requisitions/2202`).reply({})

      const result = await service.deleteRequisition('2202', true)

      expect(result).toEqual({ confirmed: true, deleted: true, requisitionId: '2202' })
    })
  })

  // ── Advanced ──

  describe('listSavedSearches', () => {
    it('lists saved searches', async () => {
      mock.onGet(`${ BASE }/search/segments`).reply({
        segments: [{ id: 3301, name: 'Senior engineers' }],
      })

      const result = await service.listSavedSearches()

      expect(result).toEqual({ savedSearches: [{ id: 3301, name: 'Senior engineers' }] })
    })
  })

  describe('createSavedSearch', () => {
    it('creates a saved search', async () => {
      mock.onPost(`${ BASE }/search/segments`).reply({
        segment: { id: 3302, name: 'Test Search' },
      })

      const result = await service.createSavedSearch('Test Search', { query: 'test' })

      expect(result).toEqual({ id: 3302, name: 'Test Search' })
    })
  })

  describe('deleteSavedSearch', () => {
    it('deletes when confirm is true', async () => {
      mock.onDelete(`${ BASE }/search/segments/3302`).reply({})

      const result = await service.deleteSavedSearch('3302', true)

      expect(result).toEqual({ confirmed: true, deleted: true, segmentId: '3302' })
    })
  })

  describe('listImports', () => {
    it('lists imports', async () => {
      mock.onGet(`${ BASE }/imports`).reply({
        imports: [{ id: 4401, state: 'finished' }],
      })

      const result = await service.listImports()

      expect(result).toEqual({ imports: [{ id: 4401, state: 'finished' }] })
    })
  })

  describe('getImport', () => {
    it('fetches an import', async () => {
      mock.onGet(`${ BASE }/imports/4401`).reply({
        import: { id: 4401, state: 'finished' },
      })

      const result = await service.getImport('4401')

      expect(result).toEqual({ id: 4401, state: 'finished' })
    })
  })

  describe('revertImport', () => {
    it('reverts when confirm is true', async () => {
      mock.onPatch(`${ BASE }/imports/4401/revert`).reply({})

      const result = await service.revertImport('4401', true)

      expect(result).toEqual({ confirmed: true, reverted: true, importId: '4401' })
    })
  })

  // ── Triggers ──

  describe('onNewCandidate', () => {
    it('returns sample in learning mode', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({
        candidates: [{ id: 1, name: 'Alex' }],
        total: 1,
      })

      const result = await service.onNewCandidate({ learningMode: true, triggerData: {} })

      expect(result.events).toHaveLength(1)
      expect(result.state).toBeNull()
    })

    it('returns empty events on first poll', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({
        candidates: [{ id: 1, name: 'Alex' }],
        total: 1,
      })

      const result = await service.onNewCandidate({ triggerData: {} })

      expect(result.events).toEqual([])
      expect(result.state).toEqual({ lastSeenId: 1 })
    })

    it('returns new candidates on subsequent polls', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({
        candidates: [{ id: 3, name: 'New' }, { id: 2, name: 'Seen' }, { id: 1, name: 'Old' }],
        total: 3,
      })

      const result = await service.onNewCandidate({
        triggerData: {},
        state: { lastSeenId: 2 },
      })

      expect(result.events).toEqual([{ id: 3, name: 'New' }])
      expect(result.state).toEqual({ lastSeenId: 3 })
    })
  })

  describe('onNewApplication', () => {
    it('returns empty when no jobId', async () => {
      const result = await service.onNewApplication({ triggerData: {} })

      expect(result.events).toEqual([])
    })

    it('returns new placements', async () => {
      mock.onGet(`${ BASE }/offers/987/placements`).reply({
        placements: [{ id: 5003, candidate_id: 3 }, { id: 5002, candidate_id: 2 }],
      })

      const result = await service.onNewApplication({
        triggerData: { jobId: '987' },
        state: { lastSeenId: 5002 },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].id).toBe(5003)
    })
  })

  describe('onCandidateMovedToStage', () => {
    it('detects stage changes', async () => {
      mock.onGet(`${ BASE }/offers/987/placements`).reply({
        placements: [
          { id: 5001, stage_id: 3002, candidate_id: 1 },
          { id: 5002, stage_id: 3001, candidate_id: 2 },
        ],
      })

      const result = await service.onCandidateMovedToStage({
        triggerData: { jobId: '987', stageId: '3002' },
        state: { stages: { 5001: '3001', 5002: '3001' } },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].id).toBe(5001)
    })
  })

  describe('onStatusChange', () => {
    it('returns fresh items on subsequent poll', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({
        candidates: [{ id: 10, name: 'Hired' }, { id: 9, name: 'Old' }],
        total: 2,
      })

      const result = await service.onStatusChange({
        triggerData: { eventType: 'Candidate hired' },
        state: { seen: ['9'] },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].id).toBe(10)
    })

    it('handles job published event type', async () => {
      mock.onGet(`${ BASE }/offers`).reply({
        offers: [{ id: 987, title: 'Engineer', kind: 'job', status: 'published' }],
        total: 1,
      })

      const result = await service.onStatusChange({
        triggerData: { eventType: 'Job published' },
        state: { seen: [] },
      })

      expect(result.events).toHaveLength(1)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws normalized error on API failure', async () => {
      mock.onGet(`${ BASE }/admin`).replyWithError({
        message: 'Unauthorized',
        body: { error: 'Invalid token' },
      })

      await expect(service.testConnection()).rejects.toThrow('Invalid token')
    })

    it('throws on HTTP error without body', async () => {
      mock.onGet(`${ BASE }/admin`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.testConnection()).rejects.toThrow('Network timeout')
    })
  })

  // ── Parameter guards (table-driven sweep) ──

  describe('parameter guards', () => {
    // [label, expected message, invoke]
    const GUARDS = [
      ['getCandidate', '"Candidate" is required.', () => service.getCandidate()],
      ['createCandidate', '"Full Name" is required.', () => service.createCandidate()],
      ['updateCandidate', '"Candidate" is required.', () => service.updateCandidate()],
      ['deleteCandidate', '"Candidate" is required.', () => service.deleteCandidate()],
      ['assignCandidateToJob/candidate', '"Candidate" is required.', () => service.assignCandidateToJob()],
      ['assignCandidateToJob/job', '"Job" is required.', () => service.assignCandidateToJob('1')],
      ['moveCandidateToStage/job', '"Job" is required.', () => service.moveCandidateToStage('1')],
      ['moveCandidateToStage/stage', '"Stage" is required.', () => service.moveCandidateToStage('1', '9')],
      ['moveCandidateToStage/candidate', '"Candidate(s)" is required.', () => service.moveCandidateToStage(null, '9', '3')],
      ['disqualifyCandidate/job', '"Job" is required.', () => service.disqualifyCandidate('1')],
      ['disqualifyCandidate/candidate', '"Candidate(s)" is required.', () => service.disqualifyCandidate('', '9')],
      ['restoreCandidate/job', '"Job" is required.', () => service.restoreCandidate('1')],
      ['restoreCandidate/candidate', '"Candidate(s)" is required.', () => service.restoreCandidate([], '9')],
      ['addCandidateTags/candidate', '"Candidate" is required.', () => service.addCandidateTags()],
      ['addCandidateTags/tags', '"Tags" is required.', () => service.addCandidateTags('1', [])],
      ['addCandidateSource/candidate', '"Candidate" is required.', () => service.addCandidateSource()],
      ['addCandidateSource/source', '"Source" is required.', () => service.addCandidateSource('1')],
      ['addCandidateToTalentPool/candidate', '"Candidate" is required.', () => service.addCandidateToTalentPool()],
      ['addCandidateToTalentPool/pool', '"Talent Pool" is required.', () => service.addCandidateToTalentPool('1')],
      ['parseCandidateCv', '"Candidate" is required.', () => service.parseCandidateCv()],
      ['mergeCandidates/main', '"Main Candidate" is required.', () => service.mergeCandidates()],
      ['mergeCandidates/duplicate', '"Duplicate Candidate" is required.', () => service.mergeCandidates('1')],
      ['getJob', '"Job" is required.', () => service.getJob()],
      ['createJob', '"Title" is required.', () => service.createJob()],
      ['updateJob', '"Job" is required.', () => service.updateJob()],
      ['updateJobStatus/job', '"Job" is required.', () => service.updateJobStatus()],
      ['updateJobStatus/status', '"New Status" must be one of', () => service.updateJobStatus('1', 'bogus')],
      ['duplicateJob', '"Job" is required.', () => service.duplicateJob()],
      ['deleteJob', '"Job" is required.', () => service.deleteJob()],
      ['tagJob/job', '"Job" is required.', () => service.tagJob()],
      ['tagJob/tags', '"Tags" is required.', () => service.tagJob('1', '')],
      ['getJobCandidates', '"Job" is required.', () => service.getJobCandidates()],
      ['listPipelineStages', '"Job" is required.', () => service.listPipelineStages()],
      ['getPipelineTemplate', '"Pipeline Template" is required.', () => service.getPipelineTemplate()],
      ['createPipelineTemplate', '"Name" is required.', () => service.createPipelineTemplate()],
      ['updatePipelineTemplate/template', '"Pipeline Template" is required.', () => service.updatePipelineTemplate()],
      ['updatePipelineTemplate/name', '"Name" is required.', () => service.updatePipelineTemplate('1')],
      ['deletePipelineTemplate', '"Pipeline Template" is required.', () => service.deletePipelineTemplate()],
      ['addPipelineStage/template', '"Pipeline Template" is required.', () => service.addPipelineStage()],
      ['addPipelineStage/name', '"Stage Name" is required.', () => service.addPipelineStage('1')],
      ['updatePipelineStage/template', '"Pipeline Template" is required.', () => service.updatePipelineStage()],
      ['updatePipelineStage/stage', '"Stage ID" is required.', () => service.updatePipelineStage('1')],
      ['deletePipelineStage/template', '"Pipeline Template" is required.', () => service.deletePipelineStage()],
      ['deletePipelineStage/stage', '"Stage ID" is required.', () => service.deletePipelineStage('1')],
      ['deletePipelineStage/destination', '"Move Candidates To Stage ID" is required.', () => service.deletePipelineStage('1', '2')],
      ['createDisqualifyReason', '"Name" is required.', () => service.createDisqualifyReason()],
      ['updateDisqualifyReason/reason', '"Reason" is required.', () => service.updateDisqualifyReason()],
      ['updateDisqualifyReason/name', '"Name" is required.', () => service.updateDisqualifyReason('1')],
      ['deleteDisqualifyReason', '"Reason" is required.', () => service.deleteDisqualifyReason()],
      ['createDepartment', '"Name" is required.', () => service.createDepartment()],
      ['deleteDepartment', '"Department" is required.', () => service.deleteDepartment()],
      ['createLocation', '"Name" is required.', () => service.createLocation()],
      ['deleteLocation', '"Location" is required.', () => service.deleteLocation()],
      ['createTalentPool', '"Title" is required.', () => service.createTalentPool()],
      ['addCandidateNote/candidate', '"Candidate" is required.', () => service.addCandidateNote()],
      ['addCandidateNote/body', '"Note" is required.', () => service.addCandidateNote('1')],
      ['listCandidateNotes', '"Candidate" is required.', () => service.listCandidateNotes()],
      ['addNote/target', '"Attach to" must be Candidate, Job, Talent Pool, or Requisition.', () => service.addNote('Nope', '1', 'hi')],
      ['addNote/targetId', '"Item ID" is required.', () => service.addNote('Candidate')],
      ['addNote/body', '"Note" is required.', () => service.addNote('Candidate', '1')],
      ['updateNote/id', '"Note ID" is required.', () => service.updateNote()],
      ['updateNote/body', '"Note" is required.', () => service.updateNote('1')],
      ['pinNote', '"Note ID" is required.', () => service.pinNote()],
      ['deleteNote', '"Note ID" is required.', () => service.deleteNote()],
      ['createTask', '"Title" is required.', () => service.createTask()],
      ['getTask', '"Task ID" is required.', () => service.getTask()],
      ['updateTask', '"Task ID" is required.', () => service.updateTask()],
      ['completeTask', '"Task ID" is required.', () => service.completeTask()],
      ['deleteTask', '"Task ID" is required.', () => service.deleteTask()],
      ['createFieldset', '"Name" is required.', () => service.createFieldset()],
      ['deleteFieldset', '"Field Set ID" is required.', () => service.deleteFieldset()],
      ['setCandidateCustomField/candidate', '"Candidate" is required.', () => service.setCandidateCustomField()],
      ['setCandidateCustomField/field', '"Custom Field" is required.', () => service.setCandidateCustomField('1')],
      ['scheduleInterview/candidate', '"Candidate" is required.', () => service.scheduleInterview()],
      ['scheduleInterview/title', '"Title" is required.', () => service.scheduleInterview('1')],
      ['scheduleInterview/start', '"Start Time" is required.', () => service.scheduleInterview('1', 'Chat')],
      ['getInterview', '"Interview ID" is required.', () => service.getInterview()],
      ['updateInterview', '"Interview ID" is required.', () => service.updateInterview()],
      ['cancelInterview', '"Interview ID" is required.', () => service.cancelInterview()],
      ['submitScorecard', '"Candidate" is required.', () => service.submitScorecard()],
      ['listScorecards', '"Candidate" is required.', () => service.listScorecards()],
      ['requestInterviewFeedback/candidate', '"Candidate" is required.', () => service.requestInterviewFeedback()],
      ['requestInterviewFeedback/reviewers', '"Reviewers" is required.', () => service.requestInterviewFeedback('1', [])],
      ['createInterviewTemplate', '"Name" is required.', () => service.createInterviewTemplate()],
      ['deleteInterviewTemplate', '"Interview Template" is required.', () => service.deleteInterviewTemplate()],
      ['sendEmail/candidate', '"Candidate" is required.', () => service.sendEmail()],
      ['sendEmail/subject', '"Subject" is required.', () => service.sendEmail('1')],
      ['sendEmail/body', '"Message" is required.', () => service.sendEmail('1', 'Hi')],
      ['scheduleEmail/candidate', '"Candidate" is required.', () => service.scheduleEmail()],
      ['scheduleEmail/subject', '"Subject" is required.', () => service.scheduleEmail('1')],
      ['scheduleEmail/body', '"Message" is required.', () => service.scheduleEmail('1', 'Hi')],
      ['scheduleEmail/sendAt', '"Send At" is required.', () => service.scheduleEmail('1', 'Hi', 'Body')],
      ['listEmailThreads', '"Candidate" is required.', () => service.listEmailThreads()],
      ['getEmailThread', '"Thread ID" is required.', () => service.getEmailThread()],
      ['createEmailTemplate/name', '"Name" is required.', () => service.createEmailTemplate('Message')],
      ['createEmailTemplate/body', '"Body" is required.', () => service.createEmailTemplate('Message', 'Welcome')],
      ['deleteEmailTemplate', '"Template ID" is required.', () => service.deleteEmailTemplate('Message')],
      ['sendSms/candidate', '"Candidate" is required.', () => service.sendSms()],
      ['sendSms/message', '"Message" is required.', () => service.sendSms('1')],
      ['getRequisition', '"Requisition" is required.', () => service.getRequisition()],
      ['createRequisition', '"Title" is required.', () => service.createRequisition()],
      ['updateRequisition', '"Requisition" is required.', () => service.updateRequisition()],
      ['updateRequisitionStatus/requisition', '"Requisition" is required.', () => service.updateRequisitionStatus()],
      ['updateRequisitionStatus/status', '"New Status" must be one of', () => service.updateRequisitionStatus('1', 'bogus')],
      ['deleteRequisition', '"Requisition" is required.', () => service.deleteRequisition()],
      ['createSavedSearch', '"Name" is required.', () => service.createSavedSearch()],
      ['deleteSavedSearch', '"Saved Search ID" is required.', () => service.deleteSavedSearch()],
      ['getImport', '"Import ID" is required.', () => service.getImport()],
      ['revertImport', '"Import ID" is required.', () => service.revertImport()],
    ]

    it.each(GUARDS)('%s rejects with %s and issues no request', async (_label, message, invoke) => {
      await expect(invoke()).rejects.toThrow(message)
      expect(mock.history).toHaveLength(0)
    })

    it('lists every allowed job status in the error message', async () => {
      await expect(service.updateJobStatus('1', 'nope')).rejects.toThrow(
        '"New Status" must be one of: publish, unpublish, close, archive, unarchive, draft.'
      )
    })

    it('lists every allowed requisition status in the error message', async () => {
      await expect(service.updateRequisitionStatus('1', 'nope')).rejects.toThrow(
        '"New Status" must be one of: approve, reject, archive, cancel, retrieve.'
      )
    })
  })

  // ── Destructive previews (Confirm off) ──

  describe('delete previews without confirm', () => {
    const PREVIEWS = [
      ['deleteDisqualifyReason', 'disqualify reason', () => service.deleteDisqualifyReason('7')],
      ['deleteDepartment', 'department', () => service.deleteDepartment('7')],
      ['deleteLocation', 'location', () => service.deleteLocation('7')],
      ['deleteNote', 'note', () => service.deleteNote('7')],
      ['deleteTask', 'task', () => service.deleteTask('7')],
      ['deleteFieldset', 'custom field set', () => service.deleteFieldset('7')],
      ['cancelInterview', 'interview', () => service.cancelInterview('7')],
      ['deleteInterviewTemplate', 'interview template', () => service.deleteInterviewTemplate('7')],
      ['deleteEmailTemplate', 'email template', () => service.deleteEmailTemplate(null, '7')],
      ['deleteRequisition', 'requisition', () => service.deleteRequisition('7')],
      ['deleteSavedSearch', 'saved search', () => service.deleteSavedSearch('7')],
      ['revertImport', 'import', () => service.revertImport('7')],
      ['deletePipelineStage', 'pipeline stage', () => service.deletePipelineStage('1', '2', '3')],
    ]

    it.each(PREVIEWS)('%s previews a %s without calling the API', async (_label, noun, invoke) => {
      const result = await invoke()

      expect(result).toMatchObject({ confirmed: false, deleted: false })
      expect(result.message).toContain(`permanently delete this ${ noun }`)
      expect(result.wouldDelete).toBeDefined()
      expect(mock.history).toHaveLength(0)
    })

    it('defaults the email template type in the preview payload', async () => {
      const result = await service.deleteEmailTemplate(undefined, '7')

      expect(result.wouldDelete).toEqual({ id: '7', type: 'Message' })
    })

    it('keeps an explicit email template type in the preview payload', async () => {
      const result = await service.deleteEmailTemplate('Auto-reply', '7')

      expect(result.wouldDelete).toEqual({ id: '7', type: 'Auto-reply' })
    })

    it('falls back to the bare id when the candidate preview lookup fails', async () => {
      mock.onGet(`${ BASE }/candidates/9`).replyWithError({ message: 'boom' })

      const result = await service.deleteCandidate('9', false)

      expect(result.wouldDelete).toEqual({ id: '9' })
      expect(result.confirmed).toBe(false)
    })

    it('falls back to the bare id when the job preview lookup fails', async () => {
      mock.onGet(`${ BASE }/offers/9`).replyWithError({ message: 'boom' })

      const result = await service.deleteJob('9', false)

      expect(result.wouldDelete).toEqual({ id: '9' })
    })

    it('falls back to the bare id when the pipeline template preview lookup fails', async () => {
      mock.onGet(`${ BASE }/pipeline_templates/9`).replyWithError({ message: 'boom' })

      const result = await service.deletePipelineTemplate('9', false)

      expect(result.wouldDelete).toEqual({ id: '9' })
    })
  })

  // ── Dictionaries (table-driven sweep) ──

  describe('dictionary methods', () => {
    const DICTIONARIES = [
      ['getSourcesDictionary', 'sources', 'sources', { id: 4, name: 'LinkedIn' }, { label: 'LinkedIn', value: '4', note: '' }],
      ['getDisqualifyReasonsDictionary', 'disqualify_reasons', 'disqualify_reasons', { id: 5, name: 'Not a fit' }, { label: 'Not a fit', value: '5', note: '' }],
      ['getDepartmentsDictionary', 'departments', 'departments', { id: 6, name: 'Engineering' }, { label: 'Engineering', value: '6', note: '' }],
      ['getLocationsDictionary', 'locations', 'locations', { id: 7, name: 'Berlin', country: 'Germany' }, { label: 'Berlin', value: '7', note: 'Germany' }],
      ['getAdminsDictionary', 'admins', 'admins', { id: 8, name: 'Jane', email: 'jane@example.com' }, { label: 'Jane', value: '8', note: 'jane@example.com' }],
      ['getPipelineTemplatesDictionary', 'pipeline_templates', 'pipeline_templates', { id: 9, name: 'Standard' }, { label: 'Standard', value: '9', note: '' }],
      ['getInterviewTemplatesDictionary', 'interview/templates', 'templates', { id: 10, name: 'Screening' }, { label: 'Screening', value: '10', note: '' }],
      ['getEmailTemplatesDictionary', 'email_templates', 'email_templates', { id: 11, name: 'Welcome' }, { label: 'Welcome', value: '11', note: '' }],
      ['getRequisitionsDictionary', 'requisitions', 'requisitions', { id: 12, title: 'Backend hire', status: 'approved' }, { label: 'Backend hire', value: '12', note: 'approved' }],
    ]

    it.each(DICTIONARIES)('%s maps items from /%s', async (method, path, key, item, expected) => {
      mock.onGet(`${ BASE }/${ path }`).reply({ [key]: [item] })

      const result = await service[method]({})

      expect(result).toEqual({ items: [expected], cursor: null })
      expect(mock.history[0].query).toMatchObject({ limit: 30, page: 1 })
    })

    it.each(DICTIONARIES)('%s handles a null payload', async (method, path, key, item) => {
      mock.onGet(`${ BASE }/${ path }`).reply({ [key]: [item] })

      const result = await service[method](null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it.each(DICTIONARIES)('%s filters by case-insensitive search', async (method, path, key, item, expected) => {
      mock.onGet(`${ BASE }/${ path }`).reply({ [key]: [item] })

      const result = await service[method]({ search: expected.label.toUpperCase() })

      expect(result.items).toEqual([expected])
    })

    it.each(DICTIONARIES)('%s drops items that do not match the search', async (method, path, key, item) => {
      mock.onGet(`${ BASE }/${ path }`).reply({ [key]: [item] })

      const result = await service[method]({ search: 'zzz-no-match' })

      expect(result.items).toEqual([])
    })

    it.each(DICTIONARIES)('%s matches on an exact value', async (method, path, key, item, expected) => {
      mock.onGet(`${ BASE }/${ path }`).reply({ [key]: [item] })

      const result = await service[method]({ search: expected.value })

      expect(result.items).toEqual([expected])
    })

    it('advances the cursor when a full page comes back', async () => {
      const page = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Dept ${ i + 1 }` }))

      mock.onGet(`${ BASE }/departments`).reply({ departments: page })

      const result = await service.getDepartmentsDictionary({ cursor: 2 })

      expect(mock.history[0].query).toMatchObject({ page: 2, limit: 30 })
      expect(result.cursor).toBe(3)
      expect(result.items).toHaveLength(30)
    })

    it('falls back to page 1 for a non-numeric cursor', async () => {
      mock.onGet(`${ BASE }/departments`).reply({ departments: [] })

      const result = await service.getDepartmentsDictionary({ cursor: 'abc' })

      expect(mock.history[0].query).toMatchObject({ page: 1 })
      expect(result).toEqual({ items: [], cursor: null })
    })

    it('falls back to the id when a source has no name', async () => {
      mock.onGet(`${ BASE }/sources`).reply({ sources: [{ id: 42 }] })

      const result = await service.getSourcesDictionary({})

      expect(result.items).toEqual([{ label: '42', value: '42', note: '' }])
    })

    it('falls back to the name when a source has no id', async () => {
      mock.onGet(`${ BASE }/sources`).reply({ sources: [{ name: 'Referral' }] })

      const result = await service.getSourcesDictionary({})

      expect(result.items).toEqual([{ label: 'Referral', value: 'Referral', note: '' }])
    })

    it('falls back to the id when a disqualify reason has no name', async () => {
      mock.onGet(`${ BASE }/disqualify_reasons`).reply({ disqualify_reasons: [{ id: 3 }] })

      const result = await service.getDisqualifyReasonsDictionary({})

      expect(result.items).toEqual([{ label: '3', value: '3', note: '' }])
    })

    it('falls back to the id when a department has no name', async () => {
      mock.onGet(`${ BASE }/departments`).reply({ departments: [{ id: 3 }] })

      const result = await service.getDepartmentsDictionary({})

      expect(result.items).toEqual([{ label: '3', value: '3', note: '' }])
    })

    it('falls back to city then id for locations and to country_code for the note', async () => {
      mock.onGet(`${ BASE }/locations`).reply({
        locations: [
          { id: 1, city: 'Paris', country_code: 'FR' },
          { id: 2 },
        ],
      })

      const result = await service.getLocationsDictionary({})

      expect(result.items).toEqual([
        { label: 'Paris', value: '1', note: 'FR' },
        { label: '2', value: '2', note: '' },
      ])
    })

    it('falls back to email then id for admins', async () => {
      mock.onGet(`${ BASE }/admins`).reply({
        admins: [{ id: 1, email: 'a@example.com' }, { id: 2 }],
      })

      const result = await service.getAdminsDictionary({})

      expect(result.items).toEqual([
        { label: 'a@example.com', value: '1', note: 'a@example.com' },
        { label: '2', value: '2', note: '' },
      ])
    })

    it('falls back to the id when a pipeline template has no name', async () => {
      mock.onGet(`${ BASE }/pipeline_templates`).reply({ pipeline_templates: [{ id: 3 }] })

      const result = await service.getPipelineTemplatesDictionary({})

      expect(result.items).toEqual([{ label: '3', value: '3', note: '' }])
    })

    it('reads interview templates from the interview_templates envelope', async () => {
      mock.onGet(`${ BASE }/interview/templates`).reply({
        interview_templates: [{ id: 3 }],
      })

      const result = await service.getInterviewTemplatesDictionary({})

      expect(result.items).toEqual([{ label: '3', value: '3', note: '' }])
    })

    it('falls back to title then id for email templates', async () => {
      mock.onGet(`${ BASE }/email_templates`).reply({
        templates: [{ id: 1, title: 'Invite' }, { id: 2 }],
      })

      const result = await service.getEmailTemplatesDictionary({})

      expect(result.items).toEqual([
        { label: 'Invite', value: '1', note: '' },
        { label: '2', value: '2', note: '' },
      ])
    })

    it('falls back to name then id for requisitions', async () => {
      mock.onGet(`${ BASE }/requisitions`).reply({
        requisitions: [{ id: 1, name: 'Ops hire' }, { id: 2 }],
      })

      const result = await service.getRequisitionsDictionary({})

      expect(result.items).toEqual([
        { label: 'Ops hire', value: '1', note: '' },
        { label: '2', value: '2', note: '' },
      ])
    })

    it('falls back to the id and drops the count note for tags', async () => {
      mock.onGet(`${ BASE }/tags`).reply({
        tags: [{ id: 1, taggings_count: 0 }, { name: 'Remote' }],
      })

      const result = await service.getTagsDictionary({})

      expect(result.items).toEqual([
        { label: '1', value: '1', note: '0 candidates' },
        { label: 'Remote', value: 'Remote', note: '' },
      ])
    })

    it('labels unnamed talent pools and candidates', async () => {
      mock.onGet(`${ BASE }/talent_pools`).reply({ talent_pools: [{ id: 1 }] })

      const pools = await service.getTalentPoolsDictionary({})

      expect(pools.items).toEqual([{ label: 'Untitled pool', value: '1', note: 'talent pool' }])
    })

    it('labels unnamed jobs and skips talent pools in the jobs dictionary', async () => {
      mock.onGet(`${ BASE }/offers`).reply({
        offers: [
          { id: 1, kind: 'talent_pool', title: 'Pool' },
          { id: 2, status: 'published' },
          { id: 3, title: 'Dev', city: 'Berlin', status: 'draft' },
          { id: 4, title: 'QA', locations: [{ name: 'Remote' }] },
        ],
      })

      const result = await service.getJobsDictionary({})

      expect(result.items).toEqual([
        { label: 'Untitled job', value: '2', note: 'published' },
        { label: 'Dev', value: '3', note: 'Berlin · draft' },
        { label: 'QA', value: '4', note: 'Remote' },
      ])

      expect(mock.history[0].query).toMatchObject({ scope: 'not_archived', view_mode: 'brief' })
    })

    it('prefers the location field over city in the jobs dictionary note', async () => {
      mock.onGet(`${ BASE }/offers`).reply({
        offers: [{ id: 5, title: 'Dev', location: 'Amsterdam', city: 'Berlin' }],
      })

      const result = await service.getJobsDictionary({})

      expect(result.items[0].note).toBe('Amsterdam')
    })

    it('labels unnamed candidates and reads the first email as the note', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({
        candidates: [{ id: 1 }, { id: 2, name: 'Bo', emails: ['bo@example.com'] }],
      })

      const result = await service.getCandidatesDictionary({})

      expect(result.items).toEqual([
        { label: 'Unnamed candidate', value: '1', note: '' },
        { label: 'Bo', value: '2', note: 'bo@example.com' },
      ])

      expect(mock.history[0].query).toMatchObject({ sort: 'created_at_desc' })
    })

    it('labels unnamed candidates in the search branch and advances the cursor', async () => {
      const hits = Array.from({ length: 30 }, (_, i) => ({ id: i + 1 }))

      mock.onGet(`${ BASE }/search/new/candidates`).reply({ hits })

      const result = await service.getCandidatesDictionary({ search: 'a', cursor: 4 })

      expect(mock.history[0].query).toMatchObject({ query: 'a', page: 4, limit: 30 })
      expect(result.cursor).toBe(5)
      expect(result.items[0]).toEqual({ label: 'Unnamed candidate', value: '1', note: '' })
    })

    it('returns a null cursor from the candidate search branch on a partial page', async () => {
      mock.onGet(`${ BASE }/search/new/candidates`).reply({ candidates: [{ id: 1, name: 'Bo' }] })

      const result = await service.getCandidatesDictionary({ search: 'bo' })

      expect(result).toEqual({ items: [{ label: 'Bo', value: '1', note: '' }], cursor: null })
    })

    it('reads stages from the offer stages envelope', async () => {
      mock.onGet(`${ BASE }/offers/77`).reply({
        offer: { id: 77, stages: [{ id: 1, name: 'Applied', kind: 'inbox' }] },
      })

      const result = await service.getStagesDictionary({ criteria: { jobId: '77' } })

      expect(result.items).toEqual([{ label: 'Applied', value: '1', note: 'inbox' }])
    })

    it('reads stages from a bare pipeline template envelope', async () => {
      mock.onGet(`${ BASE }/offers/77`).reply({
        pipeline_template: { items: [{ id: 2 }] },
      })

      const result = await service.getStagesDictionary({ criteria: { jobId: '77' } })

      expect(result.items).toEqual([{ label: '2', value: '2', note: '' }])
    })

    it('filters stages by search', async () => {
      mock.onGet(`${ BASE }/offers/77`).reply({
        offer: { stages: [{ id: 1, name: 'Applied' }, { id: 2, name: 'Hired' }] },
      })

      const result = await service.getStagesDictionary({ search: 'hir', criteria: { jobId: '77' } })

      expect(result.items).toEqual([{ label: 'Hired', value: '2', note: '' }])
    })

    it('returns an empty stage list for a null payload', async () => {
      const result = await service.getStagesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('maps custom fields and falls back to the id and type', async () => {
      mock.onGet(`${ BASE }/custom_fields/fields/searchable`).reply({
        fields: [
          { id: 1, name: 'Seniority', kind: 'single_line' },
          { id: 2, type: 'boolean' },
        ],
      })

      const result = await service.getCustomFieldsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Seniority', value: '1', note: 'single_line' },
          { label: '2', value: '2', note: 'boolean' },
        ],
        cursor: null,
      })
    })

    it('filters custom fields by search and accepts a null payload', async () => {
      mock.onGet(`${ BASE }/custom_fields/fields/searchable`).reply({
        custom_fields: [{ id: 1, name: 'Seniority' }, { id: 2, name: 'Notice' }],
      })

      const result = await service.getCustomFieldsDictionary(null)

      expect(result.items).toHaveLength(2)
    })
  })

  // ── Envelope handling helpers ──

  describe('response envelope handling', () => {
    it('accepts a bare array response', async () => {
      mock.onGet(`${ BASE }/tags`).reply([{ id: 1, name: 'Remote' }])

      await expect(service.listTags()).resolves.toEqual({ tags: [{ id: 1, name: 'Remote' }] })
    })

    it('returns an empty list for a null response', async () => {
      mock.onGet(`${ BASE }/tags`).reply(null)

      await expect(service.listTags()).resolves.toEqual({ tags: [] })
    })

    it('returns an empty list for a scalar response', async () => {
      mock.onGet(`${ BASE }/tags`).reply('nope')

      await expect(service.listTags()).resolves.toEqual({ tags: [] })
    })

    it('returns an empty list when the envelope holds no arrays', async () => {
      mock.onGet(`${ BASE }/tags`).reply({ meta: { total: 0 } })

      await expect(service.listTags()).resolves.toEqual({ tags: [] })
    })

    it('falls back to the first array under an unexpected key', async () => {
      mock.onGet(`${ BASE }/tags`).reply({ unexpected_key: [{ id: 1 }] })

      await expect(service.listTags()).resolves.toEqual({ tags: [{ id: 1 }] })
    })

    it('reads the current_user envelope in testConnection', async () => {
      mock.onGet(`${ BASE }/admin`).reply({ current_user: { id: 5, name: 'Ann', email: 'ann@x.io' } })

      await expect(service.testConnection()).resolves.toEqual({
        connected: true,
        companyId: COMPANY_ID,
        user: { id: 5, name: 'Ann', email: 'ann@x.io' },
      })
    })

    it('nulls out the user fields when the admin lookup is empty', async () => {
      mock.onGet(`${ BASE }/admin`).reply(null)

      await expect(service.testConnection()).resolves.toEqual({
        connected: true,
        companyId: COMPANY_ID,
        user: { id: null, name: null, email: null },
      })
    })
  })

  // ── Rate limiting and error normalization ──

  describe('rate limiting', () => {
    it('retries once after a 429 and returns the retried response', async () => {
      let attempt = 0

      mock.onGet(`${ BASE }/tags`).replyWith(() => {
        attempt += 1

        if (attempt === 1) {
          throw Object.assign(new Error('Too Many Requests'), {
            status: 429,
            headers: { 'retry-after': '0' },
          })
        }

        return { tags: [{ id: 1 }] }
      })

      await expect(service.listTags()).resolves.toEqual({ tags: [{ id: 1 }] })
      expect(mock.history).toHaveLength(2)
    })

    it('throws a friendly message when the retry is rate limited too', async () => {
      mock.onGet(`${ BASE }/tags`).replyWithError({
        message: 'Too Many Requests',
        status: 429,
        headers: { 'retry-after': '0' },
      })

      await expect(service.listTags()).rejects.toThrow(
        'Recruitee rate limit reached, please retry shortly.'
      )

      expect(mock.history).toHaveLength(2)
    })

    it('normalizes a non-rate-limit failure on the retry', async () => {
      let attempt = 0

      mock.onGet(`${ BASE }/tags`).replyWith(() => {
        attempt += 1

        if (attempt === 1) {
          throw Object.assign(new Error('Too Many Requests'), {
            statusCode: 429,
            headers: { 'retry-after': '0' },
          })
        }

        throw Object.assign(new Error('Server error'), { body: { error: 'Boom' } })
      })

      await expect(service.listTags()).rejects.toThrow('Boom')
    })

    it('detects a rate limit from the error code field', async () => {
      let attempt = 0

      mock.onGet(`${ BASE }/tags`).replyWith(() => {
        attempt += 1

        if (attempt === 1) {
          throw Object.assign(new Error('slow down'), {
            code: 429,
            headers: { 'Retry-After': '0' },
          })
        }

        return { tags: [] }
      })

      await expect(service.listTags()).resolves.toEqual({ tags: [] })
      expect(mock.history).toHaveLength(2)
    })

    it('detects a rate limit from a 429 in the error message', async () => {
      let attempt = 0

      mock.onGet(`${ BASE }/tags`).replyWith(() => {
        attempt += 1

        if (attempt === 1) {
          throw Object.assign(new Error('Request failed with 429'), {
            headers: { 'retry-after': '0' },
          })
        }

        return { tags: [] }
      })

      await expect(service.listTags()).resolves.toEqual({ tags: [] })
      expect(mock.history).toHaveLength(2)
    })

    it('waits the default 3s when no retry-after header is present', async () => {
      jest.useFakeTimers()

      try {
        mock.onGet(`${ BASE }/tags`).replyWithError({ message: 'Too Many Requests', status: 429 })

        const promise = service.listTags()
        const assertion = expect(promise).rejects.toThrow('rate limit reached')

        await jest.advanceTimersByTimeAsync(3000)
        await assertion
      } finally {
        jest.useRealTimers()
      }
    })

    it('caps the retry-after wait at 30s', async () => {
      jest.useFakeTimers()

      try {
        mock.onGet(`${ BASE }/tags`).replyWithError({
          message: 'Too Many Requests',
          status: 429,
          headers: { 'Retry-After': '600' },
        })

        const promise = service.listTags()
        const assertion = expect(promise).rejects.toThrow('rate limit reached')

        await jest.advanceTimersByTimeAsync(30000)
        await assertion
      } finally {
        jest.useRealTimers()
      }
    })

    it('falls back to the default wait for an unparseable retry-after header', async () => {
      jest.useFakeTimers()

      try {
        mock.onGet(`${ BASE }/tags`).replyWithError({
          message: 'Too Many Requests',
          status: 429,
          headers: { 'retry-after': 'soon' },
        })

        const promise = service.listTags()
        const assertion = expect(promise).rejects.toThrow('rate limit reached')

        await jest.advanceTimersByTimeAsync(3000)
        await assertion
      } finally {
        jest.useRealTimers()
      }
    })
  })

  describe('error normalization', () => {
    it('stringifies an object error payload', async () => {
      mock.onGet(`${ BASE }/tags`).replyWithError({
        message: 'Bad Request',
        body: { errors: ['title is invalid'] },
      })

      await expect(service.listTags()).rejects.toThrow('["title is invalid"]')
    })

    it('reads error_fields from the body', async () => {
      mock.onGet(`${ BASE }/tags`).replyWithError({
        message: 'Bad Request',
        body: { error_fields: { title: 'blank' } },
      })

      await expect(service.listTags()).rejects.toThrow('{"title":"blank"}')
    })

    it('reads message from the body', async () => {
      mock.onGet(`${ BASE }/tags`).replyWithError({
        message: 'Bad Request',
        body: { message: 'Not allowed' },
      })

      await expect(service.listTags()).rejects.toThrow('Not allowed')
    })

    it('falls back to a generic message when nothing is available', async () => {
      mock.onGet(`${ BASE }/tags`).replyWithError(new Error(''))

      await expect(service.listTags()).rejects.toThrow('Recruitee API request failed.')
    })
  })

  // ── Optional parameter handling ──

  describe('optional parameter handling', () => {
    it('omits empty candidate fields on create', async () => {
      mock.onPost(`${ BASE }/candidates`).reply({ candidate: { id: 1 } })

      await service.createCandidate('Alex', '', '', '', '', '', '', [])

      expect(mock.history[0].body).toEqual({ candidate: { name: 'Alex' } })
    })

    it('accepts arrays for email, phone, source, and tags', async () => {
      mock.onPost(`${ BASE }/candidates`).reply({ candidate: { id: 1 } })

      await service.createCandidate(
        'Alex',
        ['a@x.io', ''],
        ['+1'],
        ['5', 'abc'],
        ['Referral'],
        null,
        null,
        ['Senior', null]
      )

      expect(mock.history[0].body).toEqual({
        candidate: {
          name: 'Alex',
          emails: ['a@x.io'],
          phones: ['+1'],
          sources: ['Referral'],
          tags: ['Senior'],
        },
        offers: [5, 'abc'],
      })
    })

    it('creates a new candidate when the duplicate lookup fails', async () => {
      mock.onGet(`${ BASE }/candidates/check_presence`).replyWithError({ message: 'nope' })
      mock.onPost(`${ BASE }/candidates`).reply({ candidate: { id: 3 } })

      const result = await service.createCandidate('Alex', 'a@x.io', null, null, null, null, null, null, true)

      expect(result).toEqual({ id: 3, isNew: true })
      expect(mock.history).toHaveLength(2)
    })

    it('creates a new candidate when the duplicate lookup finds nothing usable', async () => {
      mock.onGet(`${ BASE }/candidates/check_presence`).reply({ candidates: [{ name: 'no id' }] })
      mock.onPost(`${ BASE }/candidates`).reply({ id: 4 })

      const result = await service.createCandidate('Alex', 'a@x.io', null, null, null, null, null, null, true)

      expect(result).toEqual({ id: 4, isNew: true })
    })

    it('skips the duplicate lookup when no email is supplied', async () => {
      mock.onPost(`${ BASE }/candidates`).reply({ candidate: { id: 5 } })

      await service.createCandidate('Alex', null, null, null, null, null, null, null, true)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
    })

    it('updates the existing candidate found under the candidates envelope', async () => {
      mock.onGet(`${ BASE }/candidates/check_presence`).reply({ candidates: [{ id: 6 }] })
      mock.onPatch(`${ BASE }/candidates/6`).reply({ candidate: { id: 6, name: 'Alex' } })

      const result = await service.createCandidate('Alex', 'a@x.io', null, null, null, null, null, null, true)

      expect(result).toEqual({ id: 6, name: 'Alex', isNew: false })
    })

    it('sends an empty candidate object when nothing is updated', async () => {
      mock.onPatch(`${ BASE }/candidates/1`).reply({ id: 1 })

      await service.updateCandidate('1')

      expect(mock.history[0].body).toEqual({ candidate: {} })
    })

    it('omits the stage when assigning a candidate without one', async () => {
      mock.onPost(`${ BASE }/placements`).reply({ placement: { id: 1 } })

      await service.assignCandidateToJob('abc', 'def')

      expect(mock.history[0].body).toEqual({ placement: { candidate_id: 'abc', offer_id: 'def' } })
    })

    it('keeps remote=false and merges additional fields on job create', async () => {
      mock.onPost(`${ BASE }/offers`).reply({ offer: { id: 1 } })

      await service.createJob('Dev', null, null, null, null, false, { guid: 'x' })

      expect(mock.history[0].body).toEqual({
        offer: { title: 'Dev', kind: 'job', remote: false, guid: 'x' },
      })
    })

    it('ignores a non-object additionalFields on job create', async () => {
      mock.onPost(`${ BASE }/offers`).reply({ id: 1 })

      await service.createJob('Dev', null, null, null, null, null, 'oops')

      expect(mock.history[0].body).toEqual({ offer: { title: 'Dev', kind: 'job' } })
    })

    it('keeps non-numeric department and location ids on job create', async () => {
      mock.onPost(`${ BASE }/offers`).reply({ id: 1 })

      await service.createJob('Dev', 'Desc', 'dep-a', 'loc-a', 'full-time', true)

      expect(mock.history[0].body.offer).toEqual({
        title: 'Dev',
        description: 'Desc',
        kind: 'job',
        department_id: 'dep-a',
        location_ids: ['loc-a'],
        employment_type: 'full-time',
        remote: true,
      })
    })

    it('merges additional fields on job update', async () => {
      mock.onPatch(`${ BASE }/offers/1`).reply({ offer: { id: 1 } })

      await service.updateJob('1', null, null, '5', { status: 'draft' })

      expect(mock.history[0].body).toEqual({ offer: { department_id: 5, status: 'draft' } })
    })

    it('ignores a non-object additionalFields on job update', async () => {
      mock.onPatch(`${ BASE }/offers/1`).reply({ id: 1 })

      await service.updateJob('1', 'New title', null, null, 'oops')

      expect(mock.history[0].body).toEqual({ offer: { title: 'New title' } })
    })

    it('returns a synthesized job when the status change has no payload', async () => {
      mock.onPatch(`${ BASE }/offers/1/publish`).reply(null)

      await expect(service.updateJobStatus('1', 'publish')).resolves.toEqual({
        id: '1',
        status: 'publish',
      })
    })

    it('returns the raw payload when a status change has no offer envelope', async () => {
      mock.onPatch(`${ BASE }/offers/1/archive`).reply({ id: 1, status: 'archived' })

      await expect(service.updateJobStatus('1', 'archive')).resolves.toEqual({
        id: 1,
        status: 'archived',
      })
    })

    it('prefers an explicit status over the archived toggle when listing jobs', async () => {
      mock.onGet(`${ BASE }/offers`).reply({ offers: [], total: 0 })

      await service.listJobs('published', true, 'abc', 'abc')

      expect(mock.history[0].query).toMatchObject({ scope: 'published', page: 1, limit: 30 })
    })

    it('falls back to the job count when the list response has no total', async () => {
      mock.onGet(`${ BASE }/offers`).reply({ offers: [{ id: 1 }, { id: 2 }] })

      await expect(service.listJobs()).resolves.toEqual({
        jobs: [{ id: 1 }, { id: 2 }],
        total: 2,
      })
    })

    it('paginates job candidates', async () => {
      mock.onGet(`${ BASE }/offers/1/placements`).reply({ placements: [] })

      await service.getJobCandidates('1', 3, 5)

      expect(mock.history[0].query).toMatchObject({ page: 3, limit: 5 })
    })

    it('reads stages straight off a bare offer payload', async () => {
      mock.onGet(`${ BASE }/offers/1`).reply({ stages: [{ id: 1 }] })

      await expect(service.listPipelineStages('1')).resolves.toEqual({
        jobId: '1',
        stages: [{ id: 1 }],
      })
    })

    it('omits the stage category when not provided', async () => {
      mock.onPost(`${ BASE }/pipeline_templates/1/stages`).reply({ id: 9 })

      await service.addPipelineStage('1', 'Screen')

      expect(mock.history[0].body).toEqual({ stage: { name: 'Screen' } })
    })

    it('sends an empty stage object when no new name is given', async () => {
      mock.onPatch(`${ BASE }/pipeline_templates/1/stages/2`).reply({ id: 2 })

      await service.updatePipelineStage('1', '2')

      expect(mock.history[0].body).toEqual({ stage: {} })
    })

    it('keeps a non-numeric destination stage id when deleting a stage', async () => {
      mock
        .onPatch(`${ BASE }/pipeline_templates/1/stages/delete_and_move_placements/2`)
        .reply({})

      await service.deletePipelineStage('1', '2', 'stage-x', true)

      expect(mock.history[0].body).toEqual({ destination_stage_id: 'stage-x' })
    })

    it('omits city and country when creating a bare location', async () => {
      mock.onPost(`${ BASE }/locations`).reply({ id: 1 })

      await service.createLocation('HQ')

      expect(mock.history[0].body).toEqual({ location: { name: 'HQ' } })
    })

    it('paginates talent pools and reads the offers envelope', async () => {
      mock.onGet(`${ BASE }/talent_pools`).reply({ offers: [{ id: 1 }] })

      const result = await service.listTalentPools(2, 5)

      expect(mock.history[0].query).toMatchObject({ page: 2, limit: 5 })
      expect(result).toEqual({ talentPools: [{ id: 1 }] })
    })

    it('omits description and department when creating a talent pool', async () => {
      mock.onPost(`${ BASE }/talent_pools`).reply({ offer: { id: 1 } })

      const result = await service.createTalentPool('Pool')

      expect(mock.history[0].body).toEqual({ talent_pool: { title: 'Pool' } })
      expect(result).toEqual({ id: 1 })
    })

    it('keeps a non-numeric department id when creating a talent pool', async () => {
      mock.onPost(`${ BASE }/talent_pools`).reply({ id: 1 })

      await service.createTalentPool('Pool', 'Desc', 'dep-a')

      expect(mock.history[0].body).toEqual({
        talent_pool: { title: 'Pool', description: 'Desc', department_id: 'dep-a' },
      })
    })

    it('omits the visibility when adding a candidate note', async () => {
      mock.onPost(`${ BASE }/candidates/1/notes`).reply({ id: 1 })

      await service.addCandidateNote('1', 'Hello')

      expect(mock.history[0].body).toEqual({ note: { body: 'Hello' } })
    })

    it.each([
      ['Candidate', 'candidates'],
      ['Job', 'offers'],
      ['Talent Pool', 'talent_pools'],
      ['Requisition', 'requisitions'],
    ])('maps note target %s to /%s', async (targetType, path) => {
      mock.onPost(`${ BASE }/${ path }/1/notes`).reply({ note: { id: 1 } })

      await service.addNote(targetType, '1', 'Hi', 'private')

      expect(mock.history[0].url).toBe(`${ BASE }/${ path }/1/notes`)
      expect(mock.history[0].body).toEqual({ note: { body: 'Hi', visibility: 'private' } })
    })

    it('creates a task without a candidate reference', async () => {
      mock.onPost(`${ BASE }/tasks`).reply({ task: { id: 1 } })

      await service.createTask('Call back')

      expect(mock.history[0].body).toEqual({ task: { title: 'Call back' } })
    })

    it('keeps non-numeric assignee and candidate ids on a task', async () => {
      mock.onPost(`${ BASE }/tasks`).reply({ id: 1 })

      await service.createTask('Call', '2026-01-01', 'cand-a', 'admin-a')

      expect(mock.history[0].body).toEqual({
        task: {
          title: 'Call',
          due_date: '2026-01-01',
          admin_id: 'admin-a',
          references: [{ id: 'cand-a', type: 'Candidate' }],
        },
      })
    })

    it.each([
      ['open', 'pending'],
      ['completed', 'completed'],
      ['all', 'all'],
      [undefined, 'pending'],
      ['bogus', 'pending'],
    ])('maps task status %s to scope %s', async (status, scope) => {
      mock.onGet(`${ BASE }/tasks`).reply({ tasks: [] })

      await service.listTasks(status)

      expect(mock.history[0].query).toMatchObject({ scope })
    })

    it('sends completed=false when reopening a task', async () => {
      mock.onPatch(`${ BASE }/tasks/1`).reply({ task: { id: 1 } })

      await service.updateTask('1', null, null, false)

      expect(mock.history[0].body).toEqual({ task: { completed: false } })
    })

    it('ignores a non-boolean completed flag', async () => {
      mock.onPatch(`${ BASE }/tasks/1`).reply({ id: 1 })

      await service.updateTask('1', 'New title', null, 'yes')

      expect(mock.history[0].body).toEqual({ task: { title: 'New title' } })
    })

    it('synthesizes the completed task when the response is empty', async () => {
      mock.onPatch(`${ BASE }/tasks/1`).reply(null)

      await expect(service.completeTask('1')).resolves.toEqual({ id: '1', completed: true })
    })

    it('paginates activity', async () => {
      mock.onGet(`${ BASE }/tracking/activities`).reply({ activities: [] })

      await service.listActivity(null, null, 2, 5)

      expect(mock.history[0].query).toMatchObject({ page: 2, limit: 5 })
    })

    it('keeps a non-numeric custom field id', async () => {
      mock.onPost(`${ BASE }/custom_fields/candidates/1/fields`).reply({})

      await service.setCandidateCustomField('1', 'field-a', 'Senior')

      expect(mock.history[0].body).toEqual({ field: { id: 'field-a', values: ['Senior'] } })
    })

    it('omits optional interview fields', async () => {
      mock.onPost(`${ BASE }/interview/candidates/1/events`).reply({ event: { id: 1 } })

      const result = await service.scheduleInterview('1', 'Chat', '2026-01-01T10:00:00Z')

      expect(mock.history[0].body).toEqual({
        event: { title: 'Chat', start_at: '2026-01-01T10:00:00Z' },
      })

      expect(result).toEqual({ id: 1, scheduled: false })
    })

    it('reports scheduled=false when the notify step fails', async () => {
      mock.onPost(`${ BASE }/interview/candidates/1/events`).reply({ event: { id: 9 } })
      mock.onPost(`${ BASE }/interview/events/9/schedule`).replyWithError({ message: 'nope' })

      const result = await service.scheduleInterview(
        '1',
        'Chat',
        '2026-01-01T10:00:00Z',
        null,
        null,
        null,
        true
      )

      expect(result).toEqual({ id: 9, scheduled: false })
      expect(mock.history).toHaveLength(2)
    })

    it('skips the notify step when the created event has no id', async () => {
      mock.onPost(`${ BASE }/interview/candidates/1/events`).reply({ event: {} })

      const result = await service.scheduleInterview(
        '1',
        'Chat',
        '2026-01-01T10:00:00Z',
        null,
        null,
        null,
        true
      )

      expect(result).toEqual({ scheduled: false })
      expect(mock.history).toHaveLength(1)
    })

    it('filters interviews by candidate and date range', async () => {
      mock.onGet(`${ BASE }/interview/events`).reply({ events: [] })

      await service.listInterviews('cand-a', '2026-01-01', '2026-02-01')

      expect(mock.history[0].query).toMatchObject({
        candidate_id: 'cand-a',
        date_from: '2026-01-01',
        date_to: '2026-02-01',
      })
    })

    it('sends no query when listing all interviews', async () => {
      mock.onGet(`${ BASE }/interview/events`).reply({ events: [] })

      await service.listInterviews()

      expect(mock.history[0].query).toEqual({})
    })

    it('sends an empty event object when nothing is updated', async () => {
      mock.onPatch(`${ BASE }/interview/events/1`).reply({ id: 1 })

      await service.updateInterview('1')

      expect(mock.history[0].body).toEqual({ event: {} })
    })

    it('omits rating and job on a comment-only scorecard', async () => {
      mock.onPost(`${ BASE }/interview/candidates/1/results`).reply({ id: 1 })

      await service.submitScorecard('1', null, 'Great')

      expect(mock.history[0].body).toEqual({ result: { comment: 'Great' } })
    })

    it('keeps non-numeric rating and job ids on a scorecard', async () => {
      mock.onPost(`${ BASE }/interview/candidates/1/results`).reply({ result: { id: 1 } })

      await service.submitScorecard('1', 'high', 'Great', 'job-a')

      expect(mock.history[0].body).toEqual({
        result: { rating: 'high', comment: 'Great', offer_id: 'job-a' },
      })
    })

    it('reads scorecards from the results envelope', async () => {
      mock.onGet(`${ BASE }/interview/candidates/1/results/scorecards`).reply({
        results: [{ id: 1 }],
      })

      await expect(service.listScorecards('1')).resolves.toEqual({ scorecards: [{ id: 1 }] })
    })

    it('omits the message when requesting feedback', async () => {
      mock.onPost(`${ BASE }/interview/candidates/1/result_requests`).reply({})

      const result = await service.requestInterviewFeedback('1', ['5', 'admin-a'])

      expect(mock.history[0].body).toEqual({ result_request: { admin_ids: [5, 'admin-a'] } })
      expect(result).toEqual({ candidateId: '1', requestedFrom: [5, 'admin-a'] })
    })

    it('reads interview templates from the interview_templates envelope', async () => {
      mock.onGet(`${ BASE }/interview/templates`).reply({ interview_templates: [{ id: 1 }] })

      await expect(service.listInterviewTemplates()).resolves.toEqual({
        interviewTemplates: [{ id: 1 }],
      })
    })

    it('returns the raw payload when an interview template has no envelope', async () => {
      mock.onPost(`${ BASE }/interview/templates`).reply({ id: 1, name: 'Screen' })

      await expect(service.createInterviewTemplate('Screen')).resolves.toEqual({
        id: 1,
        name: 'Screen',
      })
    })

    it('omits the email template id when sending a plain email', async () => {
      mock.onPost(`${ BASE }/mailbox/send`).reply({ message: { id: 1 } })

      await service.sendEmail('cand-a', 'Hi', 'Body')

      expect(mock.history[0].body).toEqual({
        candidate_id: 'cand-a',
        subject: 'Hi',
        body: 'Body',
      })
    })

    it('keeps a non-numeric template id when sending an email', async () => {
      mock.onPost(`${ BASE }/mailbox/send`).reply({ id: 1 })

      await service.sendEmail('1', 'Hi', 'Body', 'tpl-a')

      expect(mock.history[0].body).toMatchObject({ email_template_id: 'tpl-a' })
    })

    it('keeps a non-numeric candidate id when scheduling an email', async () => {
      mock.onPost(`${ BASE }/mailbox/schedule`).reply({ id: 1 })

      await service.scheduleEmail('cand-a', 'Hi', 'Body', '2026-01-01T10:00:00Z')

      expect(mock.history[0].body).toEqual({
        candidate_id: 'cand-a',
        subject: 'Hi',
        body: 'Body',
        send_at: '2026-01-01T10:00:00Z',
      })
    })

    it.each([
      ['Message', 'email_templates'],
      ['Event Invitation', 'event_invitation_templates'],
      ['Auto-reply', 'auto_reply_templates'],
      [undefined, 'email_templates'],
      ['Unknown', 'email_templates'],
    ])('maps email template type %s to /%s', async (type, path) => {
      mock.onGet(`${ BASE }/${ path }`).reply({ [path]: [{ id: 1 }] })

      const result = await service.listEmailTemplates(type)

      expect(mock.history[0].url).toBe(`${ BASE }/${ path }`)
      expect(result).toEqual({ templates: [{ id: 1 }] })
    })

    it.each([
      ['Message', 'email_templates'],
      ['Event Invitation', 'event_invitation_templates'],
      ['Auto-reply', 'auto_reply_templates'],
    ])('creates a %s template under /%s', async (type, path) => {
      mock.onPost(`${ BASE }/${ path }`).reply({ email_template: { id: 1 } })

      await service.createEmailTemplate(type, 'Welcome', null, 'Body')

      expect(mock.history[0].url).toBe(`${ BASE }/${ path }`)
      expect(mock.history[0].body).toEqual({ email_template: { name: 'Welcome', body: 'Body' } })
    })

    it('deletes an event invitation template under its own path', async () => {
      mock.onDelete(`${ BASE }/event_invitation_templates/3`).reply({})

      await expect(service.deleteEmailTemplate('Event Invitation', '3', true)).resolves.toEqual({
        confirmed: true,
        deleted: true,
        templateId: '3',
      })

      expect(mock.history[0].url).toBe(`${ BASE }/event_invitation_templates/3`)
    })

    it('keeps a non-numeric candidate id when sending an SMS', async () => {
      mock.onPost(`${ BASE }/texting/messages`).reply({ id: 1 })

      await service.sendSms('cand-a', 'Hi')

      expect(mock.history[0].body).toEqual({
        message: { candidate_id: 'cand-a', body: 'Hi' },
      })
    })

    it('lists SMS threads for the whole company', async () => {
      mock.onGet(`${ BASE }/texting/threads`).reply({ threads: [] })

      await service.listSmsThreads()

      expect(mock.history[0].query).toEqual({})
    })

    it('filters requisitions by scope and paginates', async () => {
      mock.onGet(`${ BASE }/requisitions`).reply({ requisitions: [] })

      await service.findRequisitions('approved', 2, 5)

      expect(mock.history[0].query).toMatchObject({ scope: 'approved', page: 2, limit: 5 })
    })

    it('merges additional fields when creating a requisition', async () => {
      mock.onPost(`${ BASE }/requisitions`).reply({ requisition: { id: 1 } })

      await service.createRequisition('Ops hire', 'dep-a', 'many', { priority: 'high' })

      expect(mock.history[0].body).toEqual({
        requisition: {
          title: 'Ops hire',
          department_id: 'dep-a',
          openings: 'many',
          priority: 'high',
        },
      })
    })

    it('ignores a non-object additionalFields on requisition create', async () => {
      mock.onPost(`${ BASE }/requisitions`).reply({ id: 1 })

      await service.createRequisition('Ops hire', null, 3, 'oops')

      expect(mock.history[0].body).toEqual({ requisition: { title: 'Ops hire', openings: 3 } })
    })

    it('sends an empty requisition object when nothing is updated', async () => {
      mock.onPatch(`${ BASE }/requisitions/1`).reply({ id: 1 })

      await service.updateRequisition('1')

      expect(mock.history[0].body).toEqual({ requisition: {} })
    })

    it('sends a comment with a requisition status change', async () => {
      mock.onPatch(`${ BASE }/requisitions/1/approve`).reply({ requisition: { id: 1 } })

      await service.updateRequisitionStatus('1', 'approve', 'Looks good')

      expect(mock.history[0].body).toEqual({ comment: 'Looks good' })
    })

    it('sends no body when a requisition status change has no comment', async () => {
      mock.onPatch(`${ BASE }/requisitions/1/reject`).reply({ id: 1 })

      await service.updateRequisitionStatus('1', 'reject')

      expect(mock.history[0].body).toBeUndefined()
    })

    it('synthesizes the requisition when the status change has no payload', async () => {
      mock.onPatch(`${ BASE }/requisitions/1/cancel`).reply(null)

      await expect(service.updateRequisitionStatus('1', 'cancel')).resolves.toEqual({
        id: '1',
        status: 'cancel',
      })
    })

    it('omits filters when creating a saved search', async () => {
      mock.onPost(`${ BASE }/search/segments`).reply({ segment: { id: 1 } })

      await service.createSavedSearch('My search')

      expect(mock.history[0].body).toEqual({ segment: { name: 'My search' } })
    })

    it('ignores non-object filters on a saved search', async () => {
      mock.onPost(`${ BASE }/search/segments`).reply({ id: 1 })

      await service.createSavedSearch('My search', 'oops')

      expect(mock.history[0].body).toEqual({ segment: { name: 'My search' } })
    })

    it('returns the raw payload when an import has no envelope', async () => {
      mock.onGet(`${ BASE }/imports/1`).reply({ id: 1, state: 'done' })

      await expect(service.getImport('1')).resolves.toEqual({ id: 1, state: 'done' })
    })

    it('falls back to meta.total_count when listing candidates', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({
        candidates: [{ id: 1 }],
        meta: { total_count: 42 },
      })

      await expect(service.searchCandidates('')).resolves.toEqual({
        candidates: [{ id: 1 }],
        total: 42,
      })
    })

    it('falls back to the hit count when searching candidates', async () => {
      mock.onGet(`${ BASE }/search/new/candidates`).reply({ candidates: [{ id: 1 }, { id: 2 }] })

      await expect(service.searchCandidates('Alex')).resolves.toEqual({
        candidates: [{ id: 1 }, { id: 2 }],
        total: 2,
      })
    })

    it('ignores an unknown status filter when listing candidates', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({ candidates: [] })

      await service.searchCandidates('', null, 'hired')

      expect(mock.history[0].query).toEqual({ page: 1, limit: 30, sort: 'created_at_desc' })
    })

    it('applies the sort override when searching candidates by text', async () => {
      mock.onGet(`${ BASE }/search/new/candidates`).reply({ hits: [] })

      await service.searchCandidates('Alex', null, null, 'abc', 'abc', 'candidate_rating')

      expect(mock.history[0].query).toMatchObject({
        page: 1,
        limit: 30,
        sort_by: 'candidate_rating',
      })
    })

    it('parses a CV with a null response', async () => {
      mock.onPost(`${ BASE }/candidates/1/parse_cv`).reply(null)

      await expect(service.parseCandidateCv('1')).resolves.toEqual({
        candidateId: '1',
        parsed: true,
        result: null,
      })
    })

    it('merges several duplicates at once', async () => {
      mock.onPatch(`${ BASE }/candidates/1/merge`).reply({})

      await service.mergeCandidates('1', ['2', 'cand-a'])

      expect(mock.history[0].body).toEqual({ ids: [2, 'cand-a'] })
    })

    it('accepts a comma-free single tag string', async () => {
      mock.onPost(`${ BASE }/candidates/1/tags`).reply({})

      const result = await service.addCandidateTags('1', 'Senior')

      expect(mock.history[0].body).toEqual({ tags: ['Senior'] })
      expect(result).toEqual({ candidateId: '1', tagsAdded: ['Senior'] })
    })

    it('accepts multiple sources at once', async () => {
      mock.onPost(`${ BASE }/candidates/1/sources`).reply({})

      const result = await service.addCandidateSource('1', ['LinkedIn', 'Referral'])

      expect(mock.history[0].body).toEqual({ sources: ['LinkedIn', 'Referral'] })
      expect(result.sourcesAdded).toEqual(['LinkedIn', 'Referral'])
    })

    it('keeps non-numeric ids when adding a candidate to a talent pool', async () => {
      mock.onPost(`${ BASE }/placements`).reply({ id: 1 })

      await service.addCandidateToTalentPool('cand-a', 'pool-a')

      expect(mock.history[0].body).toEqual({
        placement: { candidate_id: 'cand-a', offer_id: 'pool-a' },
      })
    })
  })

  // ── Bulk placement operations ──

  describe('bulk placement operations', () => {
    it('records failures per candidate when moving stages', async () => {
      mock.onGet(`${ BASE }/offers/9/candidates/1/placement`).reply({ placement: { id: 500 } })

      mock.onGet(`${ BASE }/offers/9/candidates/2/placement`).replyWithError({
        message: 'Not found',
      })

      mock.onPatch(`${ BASE }/placements/500/change_stage`).reply({})

      const result = await service.moveCandidateToStage(['1', '2'], '9', '3')

      expect(result.moved).toEqual(['1'])
      expect(result.failed).toEqual([{ candidateId: '2', error: 'Not found' }])
    })

    it('reads a bare placement payload and keeps a non-numeric stage id', async () => {
      mock.onGet(`${ BASE }/offers/9/candidates/1/placement`).reply({ id: 500 })
      mock.onPatch(`${ BASE }/placements/500/change_stage`).reply({})

      await service.moveCandidateToStage('1', '9', 'stage-a')

      const patch = mock.history.find(call => call.method === 'patch')

      expect(patch.body).toEqual({ stage_id: 'stage-a' })
    })

    it('records failures per candidate when disqualifying', async () => {
      mock.onGet(`${ BASE }/offers/9/candidates/1/placement`).replyWithError({ message: 'Gone' })

      const result = await service.disqualifyCandidate('1', '9')

      expect(result).toEqual({
        jobId: '9',
        reasonId: null,
        disqualified: [],
        failed: [{ candidateId: '1', error: 'Gone' }],
      })
    })

    it('omits the disqualify reason when none is given', async () => {
      mock.onGet(`${ BASE }/offers/9/candidates/1/placement`).reply({ placement: { id: 500 } })
      mock.onPatch(`${ BASE }/placements/500/disqualify`).reply({})

      await service.disqualifyCandidate('1', '9')

      const patch = mock.history.find(call => call.method === 'patch')

      expect(patch.body).toEqual({})
    })

    it('keeps a non-numeric disqualify reason id', async () => {
      mock.onGet(`${ BASE }/offers/9/candidates/1/placement`).reply({ placement: { id: 500 } })
      mock.onPatch(`${ BASE }/placements/500/disqualify`).reply({})

      const result = await service.disqualifyCandidate('1', '9', 'reason-a')

      const patch = mock.history.find(call => call.method === 'patch')

      expect(patch.body).toEqual({ disqualify_reason_id: 'reason-a' })
      expect(result.reasonId).toBe('reason-a')
    })

    it('records failures per candidate when restoring', async () => {
      mock.onGet(`${ BASE }/offers/9/candidates/1/placement`).replyWithError({ message: 'Gone' })

      const result = await service.restoreCandidate('1', '9')

      expect(result).toEqual({
        jobId: '9',
        restored: [],
        failed: [{ candidateId: '1', error: 'Gone' }],
      })
    })
  })

  // ── Trigger branches ──

  describe('trigger branches', () => {
    it('returns a learning-mode sample for new applications', async () => {
      mock.onGet(`${ BASE }/offers/9/placements`).reply({ placements: [{ id: 1 }, { id: 2 }] })

      const result = await service.onNewApplication({
        triggerData: { jobId: '9' },
        learningMode: true,
      })

      expect(result).toEqual({ events: [{ id: 1 }], state: null })
    })

    it('seeds the application state on the first poll', async () => {
      mock.onGet(`${ BASE }/offers/9/placements`).reply({ placements: [{ id: 4 }, { id: 7 }] })

      const result = await service.onNewApplication({ triggerData: { jobId: '9' } })

      expect(result).toEqual({ events: [], state: { lastSeenId: 7 } })
    })

    it('returns a learning-mode sample for new candidates', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({ candidates: [{ id: 3 }, { id: 2 }] })

      const result = await service.onNewCandidate({ learningMode: true })

      expect(result).toEqual({ events: [{ id: 3 }], state: null })
    })

    it('keeps the last seen id when no candidates come back', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({ candidates: [] })

      const result = await service.onNewCandidate({ state: { lastSeenId: 9 } })

      expect(result).toEqual({ events: [], state: { lastSeenId: 9 } })
    })

    it('returns every candidate when the last seen id is gone', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({ candidates: [{ id: 3 }, { id: 2 }] })

      const result = await service.onNewCandidate({ state: { lastSeenId: 99 } })

      expect(result).toEqual({ events: [{ id: 3 }, { id: 2 }], state: { lastSeenId: 3 } })
    })

    it('scopes the new-candidate poll to a job', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({ candidates: [] })

      await service.onNewCandidate({ triggerData: { jobId: '9' } })

      expect(mock.history[0].query).toMatchObject({ offer_id: '9' })
    })

    it('returns no application events when the job is missing', async () => {
      const result = await service.onNewApplication({ state: { lastSeenId: 3 } })

      expect(result).toEqual({ events: [], state: { lastSeenId: 3 } })
      expect(mock.history).toHaveLength(0)
    })

    it('returns no application events for a missing trigger payload', async () => {
      const result = await service.onNewApplication()

      expect(result).toEqual({ events: [], state: {} })
    })

    it('returns no stage events when the job or stage is missing', async () => {
      const result = await service.onCandidateMovedToStage({ triggerData: { jobId: '9' } })

      expect(result).toEqual({ events: [], state: {} })
      expect(mock.history).toHaveLength(0)
    })

    it('returns a learning-mode sample matching the target stage', async () => {
      mock.onGet(`${ BASE }/offers/9/placements`).reply({
        placements: [{ id: 1, stage_id: 5 }, { id: 2, stage: { id: 3 } }],
      })

      const result = await service.onCandidateMovedToStage({
        triggerData: { jobId: '9', stageId: '3' },
        learningMode: true,
      })

      expect(result).toEqual({ events: [{ id: 2, stage: { id: 3 } }], state: null })
    })

    it('falls back to the first placement in learning mode', async () => {
      mock.onGet(`${ BASE }/offers/9/placements`).reply({ placements: [{ id: 1, stage_id: 5 }] })

      const result = await service.onCandidateMovedToStage({
        triggerData: { jobId: '9', stageId: '3' },
        learningMode: true,
      })

      expect(result).toEqual({ events: [{ id: 1, stage_id: 5 }], state: null })
    })

    it('falls back to an empty sample when there are no placements', async () => {
      mock.onGet(`${ BASE }/offers/9/placements`).reply({ placements: [] })

      const result = await service.onCandidateMovedToStage({
        triggerData: { jobId: '9', stageId: '3' },
        learningMode: true,
      })

      expect(result).toEqual({ events: [{}], state: null })
    })

    it('seeds the stage map on the first poll', async () => {
      mock.onGet(`${ BASE }/offers/9/placements`).reply({ placements: [{ id: 1, stage_id: 3 }] })

      const result = await service.onCandidateMovedToStage({
        triggerData: { jobId: '9', stageId: '3' },
      })

      expect(result).toEqual({ events: [], state: { stages: { 1: '3' } } })
    })

    it('ignores placements already sitting in the target stage', async () => {
      mock.onGet(`${ BASE }/offers/9/placements`).reply({ placements: [{ id: 1, stage_id: 3 }] })

      const result = await service.onCandidateMovedToStage({
        triggerData: { jobId: '9', stageId: '3' },
        state: { stages: { 1: '3' } },
      })

      expect(result).toEqual({ events: [], state: { stages: { 1: '3' } } })
    })

    it('returns a learning-mode sample for status changes', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({ candidates: [{ id: 1 }, { id: 2 }] })

      const result = await service.onStatusChange({
        triggerData: { eventType: 'Candidate hired' },
        learningMode: true,
      })

      expect(mock.history[0].query).toMatchObject({ page: 1, limit: 30 })
      expect(result).toEqual({ events: [{ id: 1 }], state: null })
    })

    it('polls disqualified candidates for any other status event', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({ candidates: [] })

      await service.onStatusChange({ triggerData: { eventType: 'Candidate disqualified' } })

      expect(mock.history[0].query).toMatchObject({ disqualified: true })
    })

    it('seeds the seen list on the first status poll', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({ candidates: [{ id: 1 }] })

      const result = await service.onStatusChange({ triggerData: {} })

      expect(result).toEqual({ events: [], state: { seen: ['1'] } })
    })

    it('merges the seen list across status polls', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({ candidates: [{ id: 2 }, { id: 1 }] })

      const result = await service.onStatusChange({
        triggerData: {},
        state: { seen: ['1'] },
      })

      expect(result).toEqual({ events: [{ id: 2 }], state: { seen: ['2', '1'] } })
    })

    it('tolerates a status state without a seen list', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({ candidates: [{ id: 2 }] })

      const result = await service.onStatusChange({ triggerData: {}, state: {} })

      expect(result).toEqual({ events: [{ id: 2 }], state: { seen: ['2'] } })
    })

    it('dispatches polling invocations to the named trigger', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({ candidates: [{ id: 1 }] })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewCandidate',
        learningMode: true,
      })

      expect(result).toEqual({ events: [{ id: 1 }], state: null })
    })
  })

  // ── Envelope-less responses ──

  describe('responses without a resource envelope', () => {
    const RAW = [
      ['getCandidate', 'get', '/candidates/1', () => service.getCandidate('1')],
      ['assignCandidateToJob', 'post', '/placements', () => service.assignCandidateToJob('1', '9')],
      ['getJob', 'get', '/offers/1', () => service.getJob('1')],
      ['duplicateJob', 'patch', '/offers/1/duplicate', () => service.duplicateJob('1')],
      ['getPipelineTemplate', 'get', '/pipeline_templates/1', () => service.getPipelineTemplate('1')],
      ['createPipelineTemplate', 'post', '/pipeline_templates', () => service.createPipelineTemplate('Std')],
      ['updatePipelineTemplate', 'patch', '/pipeline_templates/1', () => service.updatePipelineTemplate('1', 'Std')],
      ['createDisqualifyReason', 'post', '/disqualify_reasons', () => service.createDisqualifyReason('Nope')],
      ['updateDisqualifyReason', 'patch', '/disqualify_reasons/1', () => service.updateDisqualifyReason('1', 'Nope')],
      ['createDepartment', 'post', '/departments', () => service.createDepartment('Eng')],
      ['addCandidateNote', 'post', '/candidates/1/notes', () => service.addCandidateNote('1', 'Hi')],
      ['addNote', 'post', '/offers/1/notes', () => service.addNote('Job', '1', 'Hi')],
      ['updateNote', 'patch', '/notes/1', () => service.updateNote('1', 'Hi')],
      ['getTask', 'get', '/tasks/1', () => service.getTask('1')],
      ['createFieldset', 'post', '/custom_fields/fieldsets', () => service.createFieldset('Set')],
      ['getInterview', 'get', '/interview/events/1', () => service.getInterview('1')],
      ['getEmailThread', 'get', '/mailbox/threads/1', () => service.getEmailThread('1')],
      ['createEmailTemplate', 'post', '/email_templates', () => service.createEmailTemplate('Message', 'W', null, 'B')],
      ['getRequisition', 'get', '/requisitions/1', () => service.getRequisition('1')],
    ]

    it.each(RAW)('%s returns the raw %s payload from %s', async (_label, method, path, invoke) => {
      const on = { get: 'onGet', post: 'onPost', patch: 'onPatch' }[method]

      mock[on](`${ BASE }${ path }`).reply({ id: 1, raw: true })

      await expect(invoke()).resolves.toEqual({ id: 1, raw: true })
    })

    it('returns the raw event payload when scheduling an interview', async () => {
      mock.onPost(`${ BASE }/interview/candidates/1/events`).reply({ id: 5 })

      await expect(
        service.scheduleInterview('1', 'Chat', '2026-01-01T10:00:00Z')
      ).resolves.toEqual({ id: 5, scheduled: false })
    })
  })

  // ── Remaining conditional branches ──

  describe('remaining conditional branches', () => {
    it('normalizes a phone into an array when updating a candidate', async () => {
      mock.onPatch(`${ BASE }/candidates/1`).reply({ candidate: { id: 1 } })

      await service.updateCandidate('1', null, null, '+1-555', null)

      expect(mock.history[0].body).toEqual({ candidate: { phones: ['+1-555'] } })
    })

    it('keeps a non-numeric stage id when assigning a candidate to a job', async () => {
      mock.onPost(`${ BASE }/placements`).reply({ placement: { id: 1 } })

      await service.assignCandidateToJob('1', '9', 'stage-a')

      expect(mock.history[0].body).toEqual({
        placement: { candidate_id: 1, offer_id: 9, stage_id: 'stage-a' },
      })
    })

    it('keeps a non-numeric department id when updating a job', async () => {
      mock.onPatch(`${ BASE }/offers/1`).reply({ offer: { id: 1 } })

      await service.updateJob('1', null, null, 'dep-a')

      expect(mock.history[0].body).toEqual({ offer: { department_id: 'dep-a' } })
    })

    it.each([
      ['getJobsDictionary', '/offers', 'offers'],
      ['getCandidatesDictionary', '/candidates', 'candidates'],
      ['getTagsDictionary', '/tags', 'tags'],
      ['getTalentPoolsDictionary', '/talent_pools', 'talent_pools'],
    ])('%s handles a null payload', async (method, path, key) => {
      mock.onGet(`${ BASE }${ path }`).reply({ [key]: [{ id: 1, name: 'A', title: 'A' }] })

      const result = await service[method](null)

      expect(result.items).toHaveLength(1)
    })

    it('advances the candidate search cursor from a missing cursor', async () => {
      const hits = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `C${ i }` }))

      mock.onGet(`${ BASE }/search/new/candidates`).reply({ hits })

      const result = await service.getCandidatesDictionary({ search: 'c' })

      expect(result.cursor).toBe(2)
    })

    it('extracts stages from a bare pipeline template envelope', async () => {
      mock.onGet(`${ BASE }/offers/1`).reply({
        offer: { pipeline_template: { items: [{ id: 3, name: 'Applied' }] } },
      })

      await expect(service.listPipelineStages('1')).resolves.toEqual({
        jobId: '1',
        stages: [{ id: 3, name: 'Applied' }],
      })
    })

    it('keeps a non-numeric job id when scheduling an interview', async () => {
      mock.onPost(`${ BASE }/interview/candidates/1/events`).reply({ event: { id: 1 } })

      await service.scheduleInterview('1', 'Chat', '2026-01-01T10:00:00Z', null, 'job-a')

      expect(mock.history[0].body.event).toMatchObject({ offer_id: 'job-a' })
    })

    it('keeps a non-numeric candidate id when listing SMS threads', async () => {
      mock.onGet(`${ BASE }/texting/threads`).reply({ threads: [] })

      await service.listSmsThreads('cand-a')

      expect(mock.history[0].query).toEqual({ candidate_id: 'cand-a' })
    })

    it('omits openings when creating a requisition without them', async () => {
      mock.onPost(`${ BASE }/requisitions`).reply({ requisition: { id: 1 } })

      await service.createRequisition('Ops hire')

      expect(mock.history[0].body).toEqual({ requisition: { title: 'Ops hire' } })
    })

    it('keeps non-numeric department and openings when updating a requisition', async () => {
      mock.onPatch(`${ BASE }/requisitions/1`).reply({ requisition: { id: 1 } })

      await service.updateRequisition('1', 'Ops hire', 'dep-a', 'many')

      expect(mock.history[0].body).toEqual({
        requisition: { title: 'Ops hire', department_id: 'dep-a', openings: 'many' },
      })
    })

    it('treats placements with non-numeric ids as unseen applications', async () => {
      mock.onGet(`${ BASE }/offers/9/placements`).reply({ placements: [{ id: 'abc' }] })

      const result = await service.onNewApplication({
        triggerData: { jobId: '9' },
        state: { lastSeenId: 'nope' },
      })

      expect(result).toEqual({ events: [], state: { lastSeenId: 0 } })
    })

    it('treats a placement without any stage as stage-less', async () => {
      mock.onGet(`${ BASE }/offers/9/placements`).reply({ placements: [{ id: 1 }] })

      const result = await service.onCandidateMovedToStage({
        triggerData: { jobId: '9', stageId: '3' },
        state: { stages: {} },
      })

      expect(result).toEqual({ events: [], state: { stages: { 1: '' } } })
    })
  })
})
