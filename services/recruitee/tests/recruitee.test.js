'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-api-token'
const COMPANY_ID = 'test-company'
const BASE = `https://api.recruitee.com/c/${COMPANY_ID}`

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
      mock.onGet(`${BASE}/admin`).reply({
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
        Authorization: `Bearer ${API_TOKEN}`,
      })
    })
  })

  // ── Candidates ──

  describe('searchCandidates', () => {
    it('searches candidates by text', async () => {
      mock.onGet(`${BASE}/search/new/candidates`).reply({
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
      mock.onGet(`${BASE}/candidates`).reply({
        candidates: [{ id: 2, name: 'Bob' }],
        total: 1,
      })

      const result = await service.searchCandidates('')

      expect(result).toEqual({ candidates: [{ id: 2, name: 'Bob' }], total: 1 })
      expect(mock.history[0].query).toMatchObject({ page: 1, limit: 30, sort: 'created_at_desc' })
    })

    it('filters by job and status', async () => {
      mock.onGet(`${BASE}/candidates`).reply({ candidates: [], total: 0 })

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
      mock.onGet(`${BASE}/candidates`).reply({ candidates: [], total: 0 })

      await service.searchCandidates('', null, 'active')

      expect(mock.history[0].query).toMatchObject({ qualified: true })
    })
  })

  describe('getCandidate', () => {
    it('fetches a candidate by ID', async () => {
      mock.onGet(`${BASE}/candidates/123`).reply({
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
      mock.onPost(`${BASE}/candidates`).reply({
        candidate: { id: 100, name: 'New Person' },
      })

      const result = await service.createCandidate('New Person')

      expect(result).toMatchObject({ id: 100, name: 'New Person', isNew: true })
      expect(mock.history[0].body).toEqual({
        candidate: { name: 'New Person' },
      })
    })

    it('creates a candidate with all fields', async () => {
      mock.onPost(`${BASE}/candidates`).reply({
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
      mock.onGet(`${BASE}/candidates/check_presence`).reply({
        candidate: { id: 50, name: 'Existing' },
      })
      mock.onPatch(`${BASE}/candidates/50`).reply({
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
      mock.onPatch(`${BASE}/candidates/123`).reply({
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
      mock.onGet(`${BASE}/candidates/123`).reply({
        candidate: { id: 123, name: 'Alex', emails: ['a@b.com'] },
      })

      const result = await service.deleteCandidate('123', false)

      expect(result.confirmed).toBe(false)
      expect(result.deleted).toBe(false)
      expect(result.wouldDelete).toMatchObject({ id: 123, name: 'Alex' })
    })

    it('deletes when confirm is true', async () => {
      mock.onDelete(`${BASE}/candidates/123`).reply({})

      const result = await service.deleteCandidate('123', true)

      expect(result).toEqual({ confirmed: true, deleted: true, candidateId: '123' })
    })

    it('throws when candidateId is missing', async () => {
      await expect(service.deleteCandidate()).rejects.toThrow('"Candidate" is required.')
    })
  })

  describe('assignCandidateToJob', () => {
    it('posts a placement', async () => {
      mock.onPost(`${BASE}/placements`).reply({
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
      mock.onGet(`${BASE}/offers/987/candidates/1/placement`).reply({
        placement: { id: 5001 },
      })
      mock.onPatch(`${BASE}/placements/5001/change_stage`).reply({})

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
      mock.onGet(`${BASE}/offers/987/candidates/1/placement`).reply({
        placement: { id: 5001 },
      })
      mock.onPatch(`${BASE}/placements/5001/disqualify`).reply({})

      const result = await service.disqualifyCandidate(['1'], '987', '42')

      expect(result).toEqual({ jobId: '987', reasonId: '42', disqualified: ['1'], failed: [] })
    })

    it('throws when jobId is missing', async () => {
      await expect(service.disqualifyCandidate(['1'])).rejects.toThrow('"Job" is required.')
    })
  })

  describe('restoreCandidate', () => {
    it('restores candidates', async () => {
      mock.onGet(`${BASE}/offers/987/candidates/1/placement`).reply({
        placement: { id: 5001 },
      })
      mock.onPatch(`${BASE}/placements/5001/requalify`).reply({})

      const result = await service.restoreCandidate(['1'], '987')

      expect(result).toEqual({ jobId: '987', restored: ['1'], failed: [] })
    })
  })

  describe('addCandidateTags', () => {
    it('posts tags to a candidate', async () => {
      mock.onPost(`${BASE}/candidates/123/tags`).reply({})

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
      mock.onPost(`${BASE}/candidates/123/sources`).reply({})

      const result = await service.addCandidateSource('123', 'LinkedIn')

      expect(result).toEqual({ candidateId: '123', sourcesAdded: ['LinkedIn'] })
    })

    it('throws when source is missing', async () => {
      await expect(service.addCandidateSource('123')).rejects.toThrow('"Source" is required.')
    })
  })

  describe('addCandidateToTalentPool', () => {
    it('posts a placement for talent pool', async () => {
      mock.onPost(`${BASE}/placements`).reply({
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
      mock.onPost(`${BASE}/candidates/123/parse_cv`).reply({ success: true })

      const result = await service.parseCandidateCv('123')

      expect(result).toEqual({ candidateId: '123', parsed: true, result: { success: true } })
    })
  })

  describe('mergeCandidates', () => {
    it('merges candidates', async () => {
      mock.onPatch(`${BASE}/candidates/100/merge`).reply({})

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
      mock.onGet(`${BASE}/offers`).reply({
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
      mock.onGet(`${BASE}/offers`).reply({ offers: [] })

      const result = await service.getJobsDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getTalentPoolsDictionary', () => {
    it('returns mapped talent pool items', async () => {
      mock.onGet(`${BASE}/talent_pools`).reply({
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
      mock.onGet(`${BASE}/search/new/candidates`).reply({
        hits: [{ id: 1, name: 'Alex', emails: ['alex@test.com'] }],
      })

      const result = await service.getCandidatesDictionary({ search: 'Alex' })

      expect(result.items).toEqual([
        { label: 'Alex', value: '1', note: 'alex@test.com' },
      ])
    })

    it('lists candidates when no search', async () => {
      mock.onGet(`${BASE}/candidates`).reply({
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
      mock.onGet(`${BASE}/tags`).reply({
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
      mock.onGet(`${BASE}/offers/987`).reply({
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
      mock.onGet(`${BASE}/offers`).reply({
        offers: [{ id: 987, title: 'Engineer', kind: 'job' }],
        total: 1,
      })

      const result = await service.listJobs()

      expect(result).toEqual({ jobs: [{ id: 987, title: 'Engineer', kind: 'job' }], total: 1 })
      expect(mock.history[0].query).toMatchObject({ scope: 'not_archived' })
    })

    it('includes archived when toggled', async () => {
      mock.onGet(`${BASE}/offers`).reply({ offers: [], total: 0 })

      await service.listJobs(null, true)

      expect(mock.history[0].query).toMatchObject({ scope: 'archived' })
    })

    it('filters talent pools out', async () => {
      mock.onGet(`${BASE}/offers`).reply({
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
      mock.onGet(`${BASE}/offers/987`).reply({ offer: { id: 987, title: 'Engineer' } })

      const result = await service.getJob('987')

      expect(result).toEqual({ id: 987, title: 'Engineer' })
    })

    it('throws when jobId is missing', async () => {
      await expect(service.getJob()).rejects.toThrow('"Job" is required.')
    })
  })

  describe('createJob', () => {
    it('creates a job with all fields', async () => {
      mock.onPost(`${BASE}/offers`).reply({ offer: { id: 987, title: 'Engineer', status: 'draft' } })

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
      mock.onPatch(`${BASE}/offers/987`).reply({ offer: { id: 987, title: 'Staff Engineer' } })

      const result = await service.updateJob('987', 'Staff Engineer')

      expect(result).toEqual({ id: 987, title: 'Staff Engineer' })
      expect(mock.history[0].body).toEqual({ offer: { title: 'Staff Engineer' } })
    })
  })

  describe('updateJobStatus', () => {
    it('changes job status', async () => {
      mock.onPatch(`${BASE}/offers/987/publish`).reply({ offer: { id: 987, status: 'published' } })

      const result = await service.updateJobStatus('987', 'publish')

      expect(result).toEqual({ id: 987, status: 'published' })
    })

    it('throws on invalid status', async () => {
      await expect(service.updateJobStatus('987', 'invalid')).rejects.toThrow('"New Status" must be one of')
    })
  })

  describe('duplicateJob', () => {
    it('duplicates a job', async () => {
      mock.onPatch(`${BASE}/offers/987/duplicate`).reply({ offer: { id: 988, title: 'Engineer (copy)' } })

      const result = await service.duplicateJob('987')

      expect(result).toEqual({ id: 988, title: 'Engineer (copy)' })
    })
  })

  describe('deleteJob', () => {
    it('returns preview when confirm is false', async () => {
      mock.onGet(`${BASE}/offers/987`).reply({ offer: { id: 987, title: 'Engineer', status: 'draft' } })

      const result = await service.deleteJob('987', false)

      expect(result.confirmed).toBe(false)
      expect(result.wouldDelete).toMatchObject({ id: 987, title: 'Engineer' })
    })

    it('deletes when confirm is true', async () => {
      mock.onDelete(`${BASE}/offers/987`).reply({})

      const result = await service.deleteJob('987', true)

      expect(result).toEqual({ confirmed: true, deleted: true, jobId: '987' })
    })
  })

  describe('tagJob', () => {
    it('adds tags to a job', async () => {
      mock.onPost(`${BASE}/offers/987/offer_tags`).reply({})

      const result = await service.tagJob('987', ['Urgent'])

      expect(result).toEqual({ jobId: '987', action: 'add', tags: ['Urgent'] })
    })

    it('removes tags from a job', async () => {
      mock.onDelete(`${BASE}/offers/987/offer_tags`).reply({})

      const result = await service.tagJob('987', ['Urgent'], 'remove')

      expect(result).toEqual({ jobId: '987', action: 'remove', tags: ['Urgent'] })
    })
  })

  describe('getJobCandidates', () => {
    it('lists placements for a job', async () => {
      mock.onGet(`${BASE}/offers/987/placements`).reply({
        placements: [{ id: 5001, candidate_id: 123 }],
      })

      const result = await service.getJobCandidates('987')

      expect(result).toEqual({ jobId: '987', placements: [{ id: 5001, candidate_id: 123 }] })
    })
  })

  describe('listPipelineStages', () => {
    it('extracts stages from a job', async () => {
      mock.onGet(`${BASE}/offers/987`).reply({
        offer: { pipeline_template: { stages: [{ id: 3001, name: 'Applied' }] } },
      })

      const result = await service.listPipelineStages('987')

      expect(result).toEqual({ jobId: '987', stages: [{ id: 3001, name: 'Applied' }] })
    })
  })

  // ── Pipeline Templates ──

  describe('listPipelineTemplates', () => {
    it('lists pipeline templates', async () => {
      mock.onGet(`${BASE}/pipeline_templates`).reply({
        pipeline_templates: [{ id: 7, name: 'Standard Hiring' }],
      })

      const result = await service.listPipelineTemplates()

      expect(result).toEqual({ pipelineTemplates: [{ id: 7, name: 'Standard Hiring' }] })
    })
  })

  describe('getPipelineTemplate', () => {
    it('fetches a pipeline template', async () => {
      mock.onGet(`${BASE}/pipeline_templates/7`).reply({
        pipeline_template: { id: 7, name: 'Standard' },
      })

      const result = await service.getPipelineTemplate('7')

      expect(result).toEqual({ id: 7, name: 'Standard' })
    })
  })

  describe('createPipelineTemplate', () => {
    it('creates a pipeline template', async () => {
      mock.onPost(`${BASE}/pipeline_templates`).reply({
        pipeline_template: { id: 8, name: 'Engineering' },
      })

      const result = await service.createPipelineTemplate('Engineering')

      expect(result).toEqual({ id: 8, name: 'Engineering' })
      expect(mock.history[0].body).toEqual({ pipeline_template: { name: 'Engineering' } })
    })
  })

  describe('updatePipelineTemplate', () => {
    it('updates a pipeline template name', async () => {
      mock.onPatch(`${BASE}/pipeline_templates/8`).reply({
        pipeline_template: { id: 8, name: 'Engineering v2' },
      })

      const result = await service.updatePipelineTemplate('8', 'Engineering v2')

      expect(result).toEqual({ id: 8, name: 'Engineering v2' })
    })
  })

  describe('deletePipelineTemplate', () => {
    it('returns preview when confirm is false', async () => {
      mock.onGet(`${BASE}/pipeline_templates/8`).reply({
        pipeline_template: { id: 8, name: 'Engineering' },
      })

      const result = await service.deletePipelineTemplate('8', false)

      expect(result.confirmed).toBe(false)
    })

    it('deletes when confirm is true', async () => {
      mock.onDelete(`${BASE}/pipeline_templates/8`).reply({})

      const result = await service.deletePipelineTemplate('8', true)

      expect(result).toEqual({ confirmed: true, deleted: true, templateId: '8' })
    })
  })

  describe('addPipelineStage', () => {
    it('adds a stage to a template', async () => {
      mock.onPost(`${BASE}/pipeline_templates/7/stages`).reply({
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
      mock.onPatch(`${BASE}/pipeline_templates/7/stages/3010`).reply({
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
      mock.onPatch(`${BASE}/pipeline_templates/7/stages/delete_and_move_placements/3010`).reply({})

      const result = await service.deletePipelineStage('7', '3010', '3001', true)

      expect(result).toEqual({ confirmed: true, deleted: true, stageId: '3010', movedTo: '3001' })
      expect(mock.history[0].body).toEqual({ destination_stage_id: 3001 })
    })
  })

  // ── Organization ──

  describe('listDisqualifyReasons', () => {
    it('lists disqualify reasons', async () => {
      mock.onGet(`${BASE}/disqualify_reasons`).reply({
        disqualify_reasons: [{ id: 42, name: 'Not a fit' }],
      })

      const result = await service.listDisqualifyReasons()

      expect(result).toEqual({ reasons: [{ id: 42, name: 'Not a fit' }] })
    })
  })

  describe('createDisqualifyReason', () => {
    it('creates a disqualify reason', async () => {
      mock.onPost(`${BASE}/disqualify_reasons`).reply({
        disqualify_reason: { id: 43, name: 'Salary expectations' },
      })

      const result = await service.createDisqualifyReason('Salary expectations')

      expect(result).toEqual({ id: 43, name: 'Salary expectations' })
    })
  })

  describe('updateDisqualifyReason', () => {
    it('updates a disqualify reason', async () => {
      mock.onPatch(`${BASE}/disqualify_reasons/43`).reply({
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
      mock.onDelete(`${BASE}/disqualify_reasons/43`).reply({})

      const result = await service.deleteDisqualifyReason('43', true)

      expect(result).toEqual({ confirmed: true, deleted: true, reasonId: '43' })
    })
  })

  describe('listDepartments', () => {
    it('lists departments', async () => {
      mock.onGet(`${BASE}/departments`).reply({
        departments: [{ id: 5, name: 'Engineering' }],
      })

      const result = await service.listDepartments()

      expect(result).toEqual({ departments: [{ id: 5, name: 'Engineering' }] })
    })
  })

  describe('createDepartment', () => {
    it('creates a department', async () => {
      mock.onPost(`${BASE}/departments`).reply({
        department: { id: 6, name: 'Marketing' },
      })

      const result = await service.createDepartment('Marketing')

      expect(result).toEqual({ id: 6, name: 'Marketing' })
    })
  })

  describe('deleteDepartment', () => {
    it('deletes when confirm is true', async () => {
      mock.onDelete(`${BASE}/departments/6`).reply({})

      const result = await service.deleteDepartment('6', true)

      expect(result).toEqual({ confirmed: true, deleted: true, departmentId: '6' })
    })
  })

  describe('listLocations', () => {
    it('lists locations', async () => {
      mock.onGet(`${BASE}/locations`).reply({
        locations: [{ id: 21, name: 'Berlin' }],
      })

      const result = await service.listLocations()

      expect(result).toEqual({ locations: [{ id: 21, name: 'Berlin' }] })
    })
  })

  describe('createLocation', () => {
    it('creates a location with all fields', async () => {
      mock.onPost(`${BASE}/locations`).reply({
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
      mock.onDelete(`${BASE}/locations/22`).reply({})

      const result = await service.deleteLocation('22', true)

      expect(result).toEqual({ confirmed: true, deleted: true, locationId: '22' })
    })
  })

  describe('listTags', () => {
    it('lists tags', async () => {
      mock.onGet(`${BASE}/tags`).reply({ tags: [{ id: 7, name: 'Referral' }] })

      const result = await service.listTags()

      expect(result).toEqual({ tags: [{ id: 7, name: 'Referral' }] })
    })
  })

  describe('listSources', () => {
    it('lists sources', async () => {
      mock.onGet(`${BASE}/sources`).reply({ sources: [{ id: 3, name: 'LinkedIn' }] })

      const result = await service.listSources()

      expect(result).toEqual({ sources: [{ id: 3, name: 'LinkedIn' }] })
    })
  })

  describe('listTalentPools', () => {
    it('lists talent pools', async () => {
      mock.onGet(`${BASE}/talent_pools`).reply({
        talent_pools: [{ id: 654, title: 'Future Designers' }],
      })

      const result = await service.listTalentPools()

      expect(result).toEqual({ talentPools: [{ id: 654, title: 'Future Designers' }] })
    })
  })

  describe('createTalentPool', () => {
    it('creates a talent pool', async () => {
      mock.onPost(`${BASE}/talent_pools`).reply({
        talent_pool: { id: 655, title: 'Senior Designers', kind: 'talent_pool' },
      })

      const result = await service.createTalentPool('Senior Designers')

      expect(result).toEqual({ id: 655, title: 'Senior Designers', kind: 'talent_pool' })
    })
  })

  describe('listTeamMembers', () => {
    it('lists admins', async () => {
      mock.onGet(`${BASE}/admins`).reply({
        admins: [{ id: 111, name: 'Jane', email: 'jane@example.com' }],
      })

      const result = await service.listTeamMembers()

      expect(result).toEqual({ teamMembers: [{ id: 111, name: 'Jane', email: 'jane@example.com' }] })
    })
  })

  // ── Notes & Tasks ──

  describe('addCandidateNote', () => {
    it('adds a note to a candidate', async () => {
      mock.onPost(`${BASE}/candidates/123/notes`).reply({
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
      mock.onGet(`${BASE}/candidates/123/notes`).reply({
        notes: [{ id: 7788, body: 'Note text' }],
      })

      const result = await service.listCandidateNotes('123')

      expect(result).toEqual({ notes: [{ id: 7788, body: 'Note text' }] })
    })
  })

  describe('addNote', () => {
    it('adds a note to a job', async () => {
      mock.onPost(`${BASE}/offers/987/notes`).reply({
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
      mock.onPatch(`${BASE}/notes/7788`).reply({
        note: { id: 7788, body: 'Updated text.' },
      })

      const result = await service.updateNote('7788', 'Updated text.')

      expect(result).toEqual({ id: 7788, body: 'Updated text.' })
    })
  })

  describe('pinNote', () => {
    it('pins a note', async () => {
      mock.onPatch(`${BASE}/notes/7788/pin`).reply({})

      const result = await service.pinNote('7788', true)

      expect(result).toEqual({ id: '7788', pinned: true })
    })

    it('unpins a note', async () => {
      mock.onPatch(`${BASE}/notes/7788/unpin`).reply({})

      const result = await service.pinNote('7788', false)

      expect(result).toEqual({ id: '7788', pinned: false })
    })
  })

  describe('deleteNote', () => {
    it('deletes when confirm is true', async () => {
      mock.onDelete(`${BASE}/notes/7788`).reply({})

      const result = await service.deleteNote('7788', true)

      expect(result).toEqual({ confirmed: true, deleted: true, noteId: '7788' })
    })
  })

  describe('createTask', () => {
    it('creates a task with all fields', async () => {
      mock.onPost(`${BASE}/tasks`).reply({
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
      mock.onGet(`${BASE}/tasks`).reply({
        tasks: [{ id: 4501, title: 'Call candidate' }],
      })

      const result = await service.listTasks()

      expect(result).toEqual({ tasks: [{ id: 4501, title: 'Call candidate' }] })
      expect(mock.history[0].query).toMatchObject({ scope: 'pending' })
    })

    it('lists completed tasks', async () => {
      mock.onGet(`${BASE}/tasks`).reply({ tasks: [] })

      await service.listTasks('completed')

      expect(mock.history[0].query).toMatchObject({ scope: 'completed' })
    })
  })

  describe('getTask', () => {
    it('fetches a task by ID', async () => {
      mock.onGet(`${BASE}/tasks/4501`).reply({ task: { id: 4501, title: 'Test' } })

      const result = await service.getTask('4501')

      expect(result).toEqual({ id: 4501, title: 'Test' })
    })
  })

  describe('updateTask', () => {
    it('patches task fields', async () => {
      mock.onPatch(`${BASE}/tasks/4501`).reply({ task: { id: 4501, completed: true } })

      const result = await service.updateTask('4501', null, null, true)

      expect(result).toEqual({ id: 4501, completed: true })
      expect(mock.history[0].body).toEqual({ task: { completed: true } })
    })
  })

  describe('completeTask', () => {
    it('marks a task as completed', async () => {
      mock.onPatch(`${BASE}/tasks/4501`).reply({ task: { id: 4501, completed: true } })

      const result = await service.completeTask('4501')

      expect(result).toEqual({ id: 4501, completed: true })
    })
  })

  describe('deleteTask', () => {
    it('deletes when confirm is true', async () => {
      mock.onDelete(`${BASE}/tasks/4501`).reply({})

      const result = await service.deleteTask('4501', true)

      expect(result).toEqual({ confirmed: true, deleted: true, taskId: '4501' })
    })
  })

  // ── Activity & Custom Fields ──

  describe('listActivity', () => {
    it('lists company-wide activity', async () => {
      mock.onGet(`${BASE}/tracking/activities`).reply({
        activities: [{ id: 99001, kind: 'candidate_moved' }],
      })

      const result = await service.listActivity()

      expect(result).toEqual({ activities: [{ id: 99001, kind: 'candidate_moved' }] })
    })

    it('lists activity for a candidate', async () => {
      mock.onGet(`${BASE}/tracking/candidates/123/activities`).reply({
        activities: [],
      })

      const result = await service.listActivity('123')

      expect(result).toEqual({ activities: [] })
    })

    it('lists activity for a job', async () => {
      mock.onGet(`${BASE}/tracking/offers/987/activities`).reply({
        activities: [],
      })

      const result = await service.listActivity(null, '987')

      expect(result).toEqual({ activities: [] })
    })
  })

  describe('listFieldsets', () => {
    it('lists fieldsets', async () => {
      mock.onGet(`${BASE}/custom_fields/fieldsets`).reply({
        fieldsets: [{ id: 301, name: 'Engineering Screening' }],
      })

      const result = await service.listFieldsets()

      expect(result).toEqual({ fieldsets: [{ id: 301, name: 'Engineering Screening' }] })
    })
  })

  describe('createFieldset', () => {
    it('creates a fieldset', async () => {
      mock.onPost(`${BASE}/custom_fields/fieldsets`).reply({
        fieldset: { id: 302, name: 'Test' },
      })

      const result = await service.createFieldset('Test')

      expect(result).toEqual({ id: 302, name: 'Test' })
    })
  })

  describe('deleteFieldset', () => {
    it('deletes when confirm is true', async () => {
      mock.onDelete(`${BASE}/custom_fields/fieldsets/302`).reply({})

      const result = await service.deleteFieldset('302', true)

      expect(result).toEqual({ confirmed: true, deleted: true, fieldsetId: '302' })
    })
  })

  describe('setCandidateCustomField', () => {
    it('sets a custom field on a candidate', async () => {
      mock.onPost(`${BASE}/custom_fields/candidates/123/fields`).reply({})

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
      mock.onPost(`${BASE}/interview/candidates/123/events`).reply({
        event: { id: 66001, title: 'Tech Interview' },
      })

      const result = await service.scheduleInterview(
        '123', 'Tech Interview', '2025-01-25T14:00', '2025-01-25T15:00', '987', 'Room A', false
      )

      expect(result).toMatchObject({ id: 66001, title: 'Tech Interview', scheduled: false })
    })

    it('notifies participants when toggled', async () => {
      mock.onPost(`${BASE}/interview/candidates/123/events`).reply({
        event: { id: 66001, title: 'Tech Interview' },
      })
      mock.onPost(`${BASE}/interview/events/66001/schedule`).reply({})

      const result = await service.scheduleInterview(
        '123', 'Tech Interview', '2025-01-25T14:00', null, null, null, true
      )

      expect(result.scheduled).toBe(true)
    })
  })

  describe('listInterviews', () => {
    it('lists interviews', async () => {
      mock.onGet(`${BASE}/interview/events`).reply({
        events: [{ id: 66001, title: 'Tech Interview' }],
      })

      const result = await service.listInterviews()

      expect(result).toEqual({ interviews: [{ id: 66001, title: 'Tech Interview' }] })
    })
  })

  describe('getInterview', () => {
    it('fetches an interview by ID', async () => {
      mock.onGet(`${BASE}/interview/events/66001`).reply({
        event: { id: 66001, title: 'Tech Interview' },
      })

      const result = await service.getInterview('66001')

      expect(result).toEqual({ id: 66001, title: 'Tech Interview' })
    })
  })

  describe('updateInterview', () => {
    it('patches interview fields', async () => {
      mock.onPatch(`${BASE}/interview/events/66001`).reply({
        event: { id: 66001, title: 'Updated' },
      })

      const result = await service.updateInterview('66001', 'Updated')

      expect(result).toEqual({ id: 66001, title: 'Updated' })
    })
  })

  describe('cancelInterview', () => {
    it('cancels when confirm is true', async () => {
      mock.onDelete(`${BASE}/interview/events/66001`).reply({})

      const result = await service.cancelInterview('66001', true)

      expect(result).toEqual({ confirmed: true, cancelled: true, eventId: '66001' })
    })
  })

  describe('submitScorecard', () => {
    it('submits a scorecard', async () => {
      mock.onPost(`${BASE}/interview/candidates/123/results`).reply({
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
      mock.onGet(`${BASE}/interview/candidates/123/results/scorecards`).reply({
        scorecards: [{ id: 71001, rating: 4 }],
      })

      const result = await service.listScorecards('123')

      expect(result).toEqual({ scorecards: [{ id: 71001, rating: 4 }] })
    })
  })

  describe('requestInterviewFeedback', () => {
    it('requests feedback from reviewers', async () => {
      mock.onPost(`${BASE}/interview/candidates/123/result_requests`).reply({})

      const result = await service.requestInterviewFeedback('123', ['111', '112'], 'Please review')

      expect(result).toEqual({ candidateId: '123', requestedFrom: [111, 112] })
    })

    it('throws when reviewerIds is empty', async () => {
      await expect(service.requestInterviewFeedback('123', [])).rejects.toThrow('"Reviewers" is required.')
    })
  })

  describe('listInterviewTemplates', () => {
    it('lists interview templates', async () => {
      mock.onGet(`${BASE}/interview/templates`).reply({
        templates: [{ id: 501, name: 'Technical Screen' }],
      })

      const result = await service.listInterviewTemplates()

      expect(result).toEqual({ interviewTemplates: [{ id: 501, name: 'Technical Screen' }] })
    })
  })

  describe('createInterviewTemplate', () => {
    it('creates an interview template', async () => {
      mock.onPost(`${BASE}/interview/templates`).reply({
        template: { id: 502, name: 'Technical Screen' },
      })

      const result = await service.createInterviewTemplate('Technical Screen')

      expect(result).toEqual({ id: 502, name: 'Technical Screen' })
    })
  })

  describe('deleteInterviewTemplate', () => {
    it('deletes when confirm is true', async () => {
      mock.onDelete(`${BASE}/interview/templates/502`).reply({})

      const result = await service.deleteInterviewTemplate('502', true)

      expect(result).toEqual({ confirmed: true, deleted: true, templateId: '502' })
    })
  })

  describe('listInterviewSchedules', () => {
    it('lists interview schedules', async () => {
      mock.onGet(`${BASE}/interview/schedules`).reply({
        schedules: [{ id: 801, name: '30-min screen' }],
      })

      const result = await service.listInterviewSchedules()

      expect(result).toEqual({ schedules: [{ id: 801, name: '30-min screen' }] })
    })
  })

  describe('listMeetingRooms', () => {
    it('lists meeting rooms', async () => {
      mock.onGet(`${BASE}/interview/meeting_rooms`).reply({
        meeting_rooms: [{ id: 901, name: 'Room A' }],
      })

      const result = await service.listMeetingRooms()

      expect(result).toEqual({ meetingRooms: [{ id: 901, name: 'Room A' }] })
    })
  })

  describe('listCalendars', () => {
    it('lists calendars', async () => {
      mock.onGet(`${BASE}/interview/calendars`).reply({
        calendars: [{ id: 1001, name: 'jane@example.com' }],
      })

      const result = await service.listCalendars()

      expect(result).toEqual({ calendars: [{ id: 1001, name: 'jane@example.com' }] })
    })
  })

  // ── Communication ──

  describe('sendEmail', () => {
    it('sends an email to a candidate', async () => {
      mock.onPost(`${BASE}/mailbox/send`).reply({
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
      mock.onPost(`${BASE}/mailbox/schedule`).reply({
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
      mock.onGet(`${BASE}/mailbox/candidate/123`).reply({
        threads: [{ id: 90001, subject: 'Application received' }],
      })

      const result = await service.listEmailThreads('123')

      expect(result).toEqual({ threads: [{ id: 90001, subject: 'Application received' }] })
    })
  })

  describe('getEmailThread', () => {
    it('fetches an email thread', async () => {
      mock.onGet(`${BASE}/mailbox/threads/90001`).reply({
        thread: { id: 90001, subject: 'Test' },
      })

      const result = await service.getEmailThread('90001')

      expect(result).toEqual({ id: 90001, subject: 'Test' })
    })
  })

  describe('listEmailTemplates', () => {
    it('lists message templates by default', async () => {
      mock.onGet(`${BASE}/email_templates`).reply({
        email_templates: [{ id: 12, name: 'Rejection' }],
      })

      const result = await service.listEmailTemplates()

      expect(result).toEqual({ templates: [{ id: 12, name: 'Rejection' }] })
    })

    it('lists event invitation templates', async () => {
      mock.onGet(`${BASE}/event_invitation_templates`).reply({
        event_invitation_templates: [{ id: 15, name: 'Interview invite' }],
      })

      const result = await service.listEmailTemplates('Event Invitation')

      expect(result).toEqual({ templates: [{ id: 15, name: 'Interview invite' }] })
    })
  })

  describe('createEmailTemplate', () => {
    it('creates an email template', async () => {
      mock.onPost(`${BASE}/email_templates`).reply({
        email_template: { id: 13, name: 'Interview Invite' },
      })

      const result = await service.createEmailTemplate('Message', 'Interview Invite', 'Subject', 'Body text')

      expect(result).toEqual({ id: 13, name: 'Interview Invite' })
    })
  })

  describe('deleteEmailTemplate', () => {
    it('deletes when confirm is true', async () => {
      mock.onDelete(`${BASE}/email_templates/13`).reply({})

      const result = await service.deleteEmailTemplate('Message', '13', true)

      expect(result).toEqual({ confirmed: true, deleted: true, templateId: '13' })
    })
  })

  describe('sendSms', () => {
    it('sends an SMS', async () => {
      mock.onPost(`${BASE}/texting/messages`).reply({
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
      mock.onGet(`${BASE}/texting/threads`).reply({
        threads: [{ id: 96001 }],
      })

      const result = await service.listSmsThreads()

      expect(result).toEqual({ threads: [{ id: 96001 }] })
    })
  })

  // ── Requisitions ──

  describe('findRequisitions', () => {
    it('lists requisitions', async () => {
      mock.onGet(`${BASE}/requisitions`).reply({
        requisitions: [{ id: 2201, title: 'Backend Engineer' }],
      })

      const result = await service.findRequisitions()

      expect(result).toEqual({ requisitions: [{ id: 2201, title: 'Backend Engineer' }] })
    })
  })

  describe('getRequisition', () => {
    it('fetches a requisition', async () => {
      mock.onGet(`${BASE}/requisitions/2201`).reply({
        requisition: { id: 2201, title: 'Backend Engineer' },
      })

      const result = await service.getRequisition('2201')

      expect(result).toEqual({ id: 2201, title: 'Backend Engineer' })
    })
  })

  describe('createRequisition', () => {
    it('creates a requisition', async () => {
      mock.onPost(`${BASE}/requisitions`).reply({
        requisition: { id: 2202, title: 'Backend Engineer', openings: 2 },
      })

      const result = await service.createRequisition('Backend Engineer', '5', 2)

      expect(result).toEqual({ id: 2202, title: 'Backend Engineer', openings: 2 })
    })
  })

  describe('updateRequisition', () => {
    it('patches requisition fields', async () => {
      mock.onPatch(`${BASE}/requisitions/2202`).reply({
        requisition: { id: 2202, title: 'Senior Backend' },
      })

      const result = await service.updateRequisition('2202', 'Senior Backend')

      expect(result).toEqual({ id: 2202, title: 'Senior Backend' })
    })
  })

  describe('updateRequisitionStatus', () => {
    it('changes requisition status', async () => {
      mock.onPatch(`${BASE}/requisitions/2202/approve`).reply({
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
      mock.onDelete(`${BASE}/requisitions/2202`).reply({})

      const result = await service.deleteRequisition('2202', true)

      expect(result).toEqual({ confirmed: true, deleted: true, requisitionId: '2202' })
    })
  })

  // ── Advanced ──

  describe('listSavedSearches', () => {
    it('lists saved searches', async () => {
      mock.onGet(`${BASE}/search/segments`).reply({
        segments: [{ id: 3301, name: 'Senior engineers' }],
      })

      const result = await service.listSavedSearches()

      expect(result).toEqual({ savedSearches: [{ id: 3301, name: 'Senior engineers' }] })
    })
  })

  describe('createSavedSearch', () => {
    it('creates a saved search', async () => {
      mock.onPost(`${BASE}/search/segments`).reply({
        segment: { id: 3302, name: 'Test Search' },
      })

      const result = await service.createSavedSearch('Test Search', { query: 'test' })

      expect(result).toEqual({ id: 3302, name: 'Test Search' })
    })
  })

  describe('deleteSavedSearch', () => {
    it('deletes when confirm is true', async () => {
      mock.onDelete(`${BASE}/search/segments/3302`).reply({})

      const result = await service.deleteSavedSearch('3302', true)

      expect(result).toEqual({ confirmed: true, deleted: true, segmentId: '3302' })
    })
  })

  describe('listImports', () => {
    it('lists imports', async () => {
      mock.onGet(`${BASE}/imports`).reply({
        imports: [{ id: 4401, state: 'finished' }],
      })

      const result = await service.listImports()

      expect(result).toEqual({ imports: [{ id: 4401, state: 'finished' }] })
    })
  })

  describe('getImport', () => {
    it('fetches an import', async () => {
      mock.onGet(`${BASE}/imports/4401`).reply({
        import: { id: 4401, state: 'finished' },
      })

      const result = await service.getImport('4401')

      expect(result).toEqual({ id: 4401, state: 'finished' })
    })
  })

  describe('revertImport', () => {
    it('reverts when confirm is true', async () => {
      mock.onPatch(`${BASE}/imports/4401/revert`).reply({})

      const result = await service.revertImport('4401', true)

      expect(result).toEqual({ confirmed: true, reverted: true, importId: '4401' })
    })
  })

  // ── Triggers ──

  describe('onNewCandidate', () => {
    it('returns sample in learning mode', async () => {
      mock.onGet(`${BASE}/candidates`).reply({
        candidates: [{ id: 1, name: 'Alex' }],
        total: 1,
      })

      const result = await service.onNewCandidate({ learningMode: true, triggerData: {} })

      expect(result.events).toHaveLength(1)
      expect(result.state).toBeNull()
    })

    it('returns empty events on first poll', async () => {
      mock.onGet(`${BASE}/candidates`).reply({
        candidates: [{ id: 1, name: 'Alex' }],
        total: 1,
      })

      const result = await service.onNewCandidate({ triggerData: {} })

      expect(result.events).toEqual([])
      expect(result.state).toEqual({ lastSeenId: 1 })
    })

    it('returns new candidates on subsequent polls', async () => {
      mock.onGet(`${BASE}/candidates`).reply({
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
      mock.onGet(`${BASE}/offers/987/placements`).reply({
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
      mock.onGet(`${BASE}/offers/987/placements`).reply({
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
      mock.onGet(`${BASE}/candidates`).reply({
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
      mock.onGet(`${BASE}/offers`).reply({
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
      mock.onGet(`${BASE}/admin`).replyWithError({
        message: 'Unauthorized',
        body: { error: 'Invalid token' },
      })

      await expect(service.testConnection()).rejects.toThrow('Invalid token')
    })

    it('throws on HTTP error without body', async () => {
      mock.onGet(`${BASE}/admin`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.testConnection()).rejects.toThrow('Network timeout')
    })
  })
})
