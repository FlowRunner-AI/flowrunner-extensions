'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SUBDOMAIN = 'acme'
const ACCESS_TOKEN = 'test-access-token'
const BASE = `https://${ SUBDOMAIN }.workable.com/spi/v3`

const AUTH_HEADERS = {
  'Authorization': `Bearer ${ ACCESS_TOKEN }`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
}

describe('Workable Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ subdomain: SUBDOMAIN, accessToken: ACCESS_TOKEN })
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
    it('registers the required config items in order', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['subdomain', 'accessToken'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'subdomain', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'accessToken', required: true, shared: false, type: 'STRING' }),
        ])
      )
    })

    it('keeps the config values on the instance', () => {
      expect(service.subdomain).toBe(SUBDOMAIN)
      expect(service.accessToken).toBe(ACCESS_TOKEN)
    })
  })

  // ── Jobs ──

  describe('listJobs', () => {
    it('sends a GET with no query params when nothing is provided', async () => {
      mock.onGet(`${ BASE }/jobs`).reply({ jobs: [] })

      const result = await service.listJobs()

      expect(result).toEqual({ jobs: [] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/jobs`)
      expect(mock.history[0].headers).toEqual(AUTH_HEADERS)
      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].body).toBeUndefined()
    })

    it('maps the friendly state label to the API token and forwards filters', async () => {
      mock.onGet(`${ BASE }/jobs`).reply({ jobs: [] })

      await service.listJobs('Published', '2026-01-01T00:00:00Z', '19782', 25)

      expect(mock.history[0].query).toEqual({
        state: 'published',
        created_after: '2026-01-01T00:00:00Z',
        since_id: '19782',
        limit: 25,
      })
    })

    it('passes an unmapped state value through unchanged', async () => {
      mock.onGet(`${ BASE }/jobs`).reply({ jobs: [] })

      await service.listJobs('archived')

      expect(mock.history[0].query).toEqual({ state: 'archived' })
    })

    it('drops a zero limit', async () => {
      mock.onGet(`${ BASE }/jobs`).reply({ jobs: [] })

      await service.listJobs(undefined, undefined, undefined, 0)

      expect(mock.history[0].query).toEqual({})
    })

    it('throws a Workable API error including the status and message', async () => {
      mock.onGet(`${ BASE }/jobs`).replyWithError({
        message: 'Forbidden',
        status: 403,
        body: { error: 'Invalid token' },
      })

      await expect(service.listJobs()).rejects.toThrow('Workable API error: (403) Invalid token')
    })

    it('falls back to the transport message when the body has no error field', async () => {
      mock.onGet(`${ BASE }/jobs`).replyWithError({ message: 'socket hang up' })

      await expect(service.listJobs()).rejects.toThrow('Workable API error: socket hang up')
    })

    it('serializes validation errors into the thrown message', async () => {
      mock.onGet(`${ BASE }/jobs`).replyWithError({
        message: 'Unprocessable',
        statusCode: 422,
        body: { validation_errors: { title: ['is required'] } },
      })

      await expect(service.listJobs()).rejects.toThrow('Workable API error: (422) {"title":["is required"]}')
    })
  })

  describe('getJob', () => {
    it('URL-encodes the shortcode', async () => {
      mock.onGet(`${ BASE }/jobs/GH%2F789`).reply({ shortcode: 'GH/789' })

      const result = await service.getJob('GH/789')

      expect(result).toEqual({ shortcode: 'GH/789' })
      expect(mock.history[0].url).toBe(`${ BASE }/jobs/GH%2F789`)
    })
  })

  describe('getJobMembers', () => {
    it('requests the job members endpoint', async () => {
      mock.onGet(`${ BASE }/jobs/GHI789/members`).reply({ members: [{ id: '5f8d' }] })

      const result = await service.getJobMembers('GHI789')

      expect(result).toEqual({ members: [{ id: '5f8d' }] })
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('getJobStages', () => {
    it('requests the job stages endpoint', async () => {
      mock.onGet(`${ BASE }/jobs/GHI789/stages`).reply({ stages: [{ slug: 'sourced' }] })

      const result = await service.getJobStages('GHI789')

      expect(result.stages).toHaveLength(1)
    })
  })

  // ── Candidates ──

  describe('listCandidates', () => {
    it('sends an empty query by default', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({ candidates: [] })

      await service.listCandidates()

      expect(mock.history[0].query).toEqual({})
    })

    it('maps the candidate state label and forwards every filter', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({ candidates: [] })

      await service.listCandidates('GHI789', 'Disqualified', '3f7a', '2026-06-01T00:00:00Z', 10)

      expect(mock.history[0].query).toEqual({
        shortcode: 'GHI789',
        state: 'disqualified',
        since_id: '3f7a',
        created_after: '2026-06-01T00:00:00Z',
        limit: 10,
      })
    })
  })

  describe('getCandidate', () => {
    it('requests a single candidate by id', async () => {
      mock.onGet(`${ BASE }/candidates/3f7a`).reply({ candidate: { id: '3f7a' } })

      const result = await service.getCandidate('3f7a')

      expect(result.candidate.id).toBe('3f7a')
    })
  })

  describe('createCandidate', () => {
    it('posts a cleaned candidate payload', async () => {
      mock.onPost(`${ BASE }/jobs/GHI789/candidates`).reply({ status: 'created' })

      const result = await service.createCandidate(
        'GHI789',
        'John Smith',
        'John',
        'Smith',
        'john@example.com',
        '+15551234567',
        'https://files.example.com/cv.pdf',
        'Hello there',
        true
      )

      expect(result).toEqual({ status: 'created' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/jobs/GHI789/candidates`)

      expect(mock.history[0].body).toEqual({
        candidate: {
          name: 'John Smith',
          firstname: 'John',
          lastname: 'Smith',
          email: 'john@example.com',
          phone: '+15551234567',
          resume_url: 'https://files.example.com/cv.pdf',
          cover_letter: 'Hello there',
        },
        sourced: true,
      })
    })

    it('omits empty candidate fields and the sourced flag when not provided', async () => {
      mock.onPost(`${ BASE }/jobs/GHI789/candidates`).reply({ status: 'created' })

      await service.createCandidate('GHI789', 'John Smith', undefined, '', null)

      expect(mock.history[0].body).toEqual({ candidate: { name: 'John Smith' } })
    })

    it('keeps sourced when explicitly false', async () => {
      mock.onPost(`${ BASE }/jobs/GHI789/candidates`).reply({ status: 'created' })

      await service.createCandidate('GHI789', 'John Smith', undefined, undefined, undefined, undefined, undefined, undefined, false)

      expect(mock.history[0].body).toEqual({ candidate: { name: 'John Smith' }, sourced: false })
    })

    it('throws when the API rejects the candidate', async () => {
      mock.onPost(`${ BASE }/jobs/GHI789/candidates`).replyWithError({
        message: 'Bad Request',
        body: { status: 400, error: 'email is invalid' },
      })

      await expect(service.createCandidate('GHI789', 'John Smith')).rejects.toThrow(
        'Workable API error: (400) email is invalid'
      )
    })
  })

  describe('updateCandidate', () => {
    it('patches only the fields that were provided', async () => {
      mock.onPatch(`${ BASE }/candidates/3f7a`).reply({ status: 'updated' })

      const result = await service.updateCandidate('3f7a', 'Jonathan', undefined, 'jonathan@example.com')

      expect(result).toEqual({ status: 'updated' })
      expect(mock.history[0].method).toBe('patch')

      expect(mock.history[0].body).toEqual({
        candidate: { firstname: 'Jonathan', email: 'jonathan@example.com' },
      })
    })

    it('sends an empty candidate object when nothing is provided', async () => {
      mock.onPatch(`${ BASE }/candidates/3f7a`).reply({ status: 'updated' })

      await service.updateCandidate('3f7a')

      expect(mock.history[0].body).toEqual({ candidate: {} })
    })

    it('sends every editable field', async () => {
      mock.onPatch(`${ BASE }/candidates/3f7a`).reply({ status: 'updated' })

      await service.updateCandidate('3f7a', 'Jon', 'Smith', 'j@example.com', '+1555', 'Engineer', 'Summary', 'NYC')

      expect(mock.history[0].body).toEqual({
        candidate: {
          firstname: 'Jon',
          lastname: 'Smith',
          email: 'j@example.com',
          phone: '+1555',
          headline: 'Engineer',
          summary: 'Summary',
          address: 'NYC',
        },
      })
    })
  })

  describe('moveCandidateToStage', () => {
    it('posts the member id and target stage', async () => {
      mock.onPost(`${ BASE }/candidates/3f7a/move`).reply({ status: 'moved' })

      const result = await service.moveCandidateToStage('3f7a', '5f8d', 'phone_screen')

      expect(result).toEqual({ status: 'moved' })
      expect(mock.history[0].body).toEqual({ member_id: '5f8d', target_stage: 'phone_screen' })
    })
  })

  describe('disqualifyCandidate', () => {
    it('posts with an optional reason', async () => {
      mock.onPost(`${ BASE }/candidates/3f7a/disqualify`).reply({ status: 'disqualified' })

      await service.disqualifyCandidate('3f7a', '5f8d', 'Not enough experience')

      expect(mock.history[0].body).toEqual({
        member_id: '5f8d',
        disqualification_reason: 'Not enough experience',
      })
    })

    it('omits the reason when not provided', async () => {
      mock.onPost(`${ BASE }/candidates/3f7a/disqualify`).reply({ status: 'disqualified' })

      await service.disqualifyCandidate('3f7a', '5f8d')

      expect(mock.history[0].body).toEqual({ member_id: '5f8d' })
    })
  })

  describe('revertCandidate', () => {
    it('posts the member id when provided', async () => {
      mock.onPost(`${ BASE }/candidates/3f7a/revert`).reply({ status: 'reverted' })

      await service.revertCandidate('3f7a', '5f8d')

      expect(mock.history[0].body).toEqual({ member_id: '5f8d' })
    })

    it('posts an empty body when the member id is omitted', async () => {
      mock.onPost(`${ BASE }/candidates/3f7a/revert`).reply({ status: 'reverted' })

      await service.revertCandidate('3f7a')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('copyCandidateToJob', () => {
    it('posts the copy payload with an optional target stage', async () => {
      mock.onPost(`${ BASE }/candidates/3f7a/copy`).reply({ status: 'copied' })

      await service.copyCandidateToJob('3f7a', '5f8d', 'JKL012', 'applied')

      expect(mock.history[0].body).toEqual({
        member_id: '5f8d',
        target_job_shortcode: 'JKL012',
        target_stage: 'applied',
      })
    })

    it('omits the target stage when not provided', async () => {
      mock.onPost(`${ BASE }/candidates/3f7a/copy`).reply({ status: 'copied' })

      await service.copyCandidateToJob('3f7a', '5f8d', 'JKL012')

      expect(mock.history[0].body).toEqual({ member_id: '5f8d', target_job_shortcode: 'JKL012' })
    })
  })

  describe('relocateCandidateToJob', () => {
    it('posts the relocate payload', async () => {
      mock.onPost(`${ BASE }/candidates/3f7a/relocate`).reply({ status: 'relocated' })

      const result = await service.relocateCandidateToJob('3f7a', '5f8d', 'JKL012', 'applied')

      expect(result).toEqual({ status: 'relocated' })
      expect(mock.history[0].url).toBe(`${ BASE }/candidates/3f7a/relocate`)

      expect(mock.history[0].body).toEqual({
        member_id: '5f8d',
        target_job_shortcode: 'JKL012',
        target_stage: 'applied',
      })
    })
  })

  describe('listCandidateActivities', () => {
    it('requests the candidate activities endpoint', async () => {
      mock.onGet(`${ BASE }/candidates/3f7a/activities`).reply({ activities: [] })

      const result = await service.listCandidateActivities('3f7a')

      expect(result).toEqual({ activities: [] })
    })
  })

  // ── Comments & ratings ──

  describe('createComment', () => {
    it('posts a comment with mapped visibility roles', async () => {
      mock.onPost(`${ BASE }/candidates/3f7a/comments`).reply({ comment: { id: 'c_1' } })

      await service.createComment('3f7a', '5f8d', 'Strong background', ['Admin', 'Hiring Manager'])

      expect(mock.history[0].body).toEqual({
        member_id: '5f8d',
        comment: { body: 'Strong background', policy: ['admin', 'hiring_manager'] },
      })
    })

    it('omits the policy when no roles are provided', async () => {
      mock.onPost(`${ BASE }/candidates/3f7a/comments`).reply({ comment: { id: 'c_1' } })

      await service.createComment('3f7a', '5f8d', 'Strong background')

      expect(mock.history[0].body).toEqual({
        member_id: '5f8d',
        comment: { body: 'Strong background' },
      })
    })

    it('omits the policy when the roles array is empty', async () => {
      mock.onPost(`${ BASE }/candidates/3f7a/comments`).reply({ comment: { id: 'c_1' } })

      await service.createComment('3f7a', '5f8d', 'Strong background', [])

      expect(mock.history[0].body).toEqual({
        member_id: '5f8d',
        comment: { body: 'Strong background' },
      })
    })

    it('passes unmapped role tokens through unchanged', async () => {
      mock.onPost(`${ BASE }/candidates/3f7a/comments`).reply({ comment: { id: 'c_1' } })

      await service.createComment('3f7a', '5f8d', 'Note', ['reviewer'])

      expect(mock.history[0].body.comment.policy).toEqual(['reviewer'])
    })
  })

  describe('createRating', () => {
    it('maps the scale label and coerces the grade to a number', async () => {
      mock.onPost(`${ BASE }/candidates/3f7a/ratings`).reply({ rating: { id: 'r_1' } })

      await service.createRating('3f7a', '5f8d', 'Thumbs', '2', 'Great fit')

      expect(mock.history[0].body).toEqual({
        member_id: '5f8d',
        scale: 'thumbs',
        grade: 2,
        comment: 'Great fit',
      })
    })

    it('maps the Stars and Numbers scales', async () => {
      mock.onPost(`${ BASE }/candidates/3f7a/ratings`).reply({ rating: { id: 'r_1' } })

      await service.createRating('3f7a', '5f8d', 'Stars', 4)
      await service.createRating('3f7a', '5f8d', 'Numbers', 9)

      expect(mock.history[0].body.scale).toBe('stars')
      expect(mock.history[1].body.scale).toBe('numbers')
    })

    it('keeps a zero grade', async () => {
      mock.onPost(`${ BASE }/candidates/3f7a/ratings`).reply({ rating: { id: 'r_1' } })

      await service.createRating('3f7a', '5f8d', 'Thumbs', 0)

      expect(mock.history[0].body).toEqual({ member_id: '5f8d', scale: 'thumbs', grade: 0 })
    })

    it('omits the grade when it is null', async () => {
      mock.onPost(`${ BASE }/candidates/3f7a/ratings`).reply({ rating: { id: 'r_1' } })

      await service.createRating('3f7a', '5f8d', 'Thumbs', null)

      expect(mock.history[0].body).toEqual({ member_id: '5f8d', scale: 'thumbs' })
    })
  })

  // ── Members, recruiters, stages, account ──

  describe('listMembers', () => {
    it('requests the members endpoint', async () => {
      mock.onGet(`${ BASE }/members`).reply({ members: [] })

      const result = await service.listMembers()

      expect(result).toEqual({ members: [] })
      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('listRecruiters', () => {
    it('requests the recruiters endpoint', async () => {
      mock.onGet(`${ BASE }/recruiters`).reply({ recruiters: [] })

      const result = await service.listRecruiters()

      expect(result).toEqual({ recruiters: [] })
    })
  })

  describe('listStages', () => {
    it('requests the account-wide stages endpoint', async () => {
      mock.onGet(`${ BASE }/stages`).reply({ stages: [{ slug: 'hired' }] })

      const result = await service.listStages()

      expect(result.stages[0].slug).toBe('hired')
    })
  })

  describe('getAccount', () => {
    it('requests the accounts endpoint', async () => {
      mock.onGet(`${ BASE }/accounts`).reply({ name: 'Acme Inc', subdomain: 'acme' })

      const result = await service.getAccount()

      expect(result).toEqual({ name: 'Acme Inc', subdomain: 'acme' })
    })
  })

  // ── Dictionaries ──

  describe('getJobsDictionary', () => {
    const jobs = [
      { title: 'Software Engineer', full_title: 'Software Engineer - Engineering', shortcode: 'GHI789', department: 'Engineering', state: 'published' },
      { title: 'Product Designer', shortcode: 'JKL012', state: 'draft' },
      { shortcode: 'MNO345' },
    ]

    it('maps jobs to dictionary items', async () => {
      mock.onGet(`${ BASE }/jobs`).reply({ jobs })

      const result = await service.getJobsDictionary({})

      expect(mock.history[0].query).toEqual({ limit: 100 })

      expect(result).toEqual({
        items: [
          { label: 'Software Engineer', value: 'GHI789', note: 'Engineering - published' },
          { label: 'Product Designer', value: 'JKL012', note: 'draft' },
          { label: 'MNO345', value: 'MNO345', note: undefined },
        ],
        cursor: null,
      })
    })

    it('filters case-insensitively by title, full title and shortcode', async () => {
      mock.onGet(`${ BASE }/jobs`).reply({ jobs })

      const byTitle = await service.getJobsDictionary({ search: 'DESIGNER' })

      expect(byTitle.items.map(item => item.value)).toEqual(['JKL012'])

      mock.reset()
      mock.onGet(`${ BASE }/jobs`).reply({ jobs })

      const byShortcode = await service.getJobsDictionary({ search: 'mno' })

      expect(byShortcode.items.map(item => item.value)).toEqual(['MNO345'])
    })

    it('forwards the cursor as since_id', async () => {
      mock.onGet(`${ BASE }/jobs`).reply({ jobs: [] })

      await service.getJobsDictionary({ cursor: '19782' })

      expect(mock.history[0].query).toEqual({ limit: 100, since_id: '19782' })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/jobs`).reply({ jobs })

      const result = await service.getJobsDictionary(null)

      expect(result.items).toHaveLength(3)
      expect(result.cursor).toBeNull()
    })

    it('handles a response without a jobs array', async () => {
      mock.onGet(`${ BASE }/jobs`).reply({})

      const result = await service.getJobsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getMembersDictionary', () => {
    const members = [
      { id: '5f8d', name: 'Jane Doe', email: 'jane@acme.com', role: 'admin' },
      { id: '6a9e', email: 'bob@acme.com' },
      { id: '7b0f' },
    ]

    it('maps members to dictionary items', async () => {
      mock.onGet(`${ BASE }/members`).reply({ members })

      const result = await service.getMembersDictionary({})

      expect(mock.history[0].query).toEqual({ limit: 100 })

      expect(result).toEqual({
        items: [
          { label: 'Jane Doe', value: '5f8d', note: 'jane@acme.com - admin' },
          { label: 'bob@acme.com', value: '6a9e', note: 'bob@acme.com' },
          { label: '7b0f', value: '7b0f', note: undefined },
        ],
        cursor: null,
      })
    })

    it('filters by name or email', async () => {
      mock.onGet(`${ BASE }/members`).reply({ members })

      const result = await service.getMembersDictionary({ search: 'BOB@' })

      expect(result.items.map(item => item.value)).toEqual(['6a9e'])
    })

    it('forwards the cursor as since_id', async () => {
      mock.onGet(`${ BASE }/members`).reply({ members: [] })

      await service.getMembersDictionary({ cursor: '5f8d' })

      expect(mock.history[0].query).toEqual({ limit: 100, since_id: '5f8d' })
    })

    it('handles a null payload and a missing members array', async () => {
      mock.onGet(`${ BASE }/members`).reply({})

      const result = await service.getMembersDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('propagates API errors', async () => {
      mock.onGet(`${ BASE }/members`).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.getMembersDictionary({})).rejects.toThrow('Workable API error: (401) Unauthorized')
    })
  })

  // ── Polling trigger ──

  describe('onNewCandidate', () => {
    it('establishes a baseline on the first cycle without emitting events', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({
        candidates: [
          { id: 'b', created_at: '2026-06-02T12:00:00Z' },
          { id: 'a', created_at: '2026-06-01T12:00:00Z' },
        ],
      })

      const result = await service.onNewCandidate({ parameters: {}, state: null })

      expect(result.events).toEqual([])
      expect(result.state.lastCreatedAt).toBe('2026-06-02T12:00:00Z')
      expect(result.state.seenIds.sort()).toEqual(['a', 'b'])
      expect(mock.history[0].query).toEqual({ limit: 100 })
    })

    it('uses the current time as the baseline when no candidates exist', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({ candidates: [] })

      const result = await service.onNewCandidate({})

      expect(result.events).toEqual([])
      expect(result.state.seenIds).toEqual([])
      expect(typeof result.state.lastCreatedAt).toBe('string')
    })

    it('emits only unseen candidates and advances the high-water mark', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({
        candidates: [
          { id: 'c', created_at: '2026-06-03T12:00:00Z' },
          { id: 'a', created_at: '2026-06-01T12:00:00Z' },
        ],
      })

      const result = await service.onNewCandidate({
        parameters: { shortcode: 'GHI789' },
        state: { lastCreatedAt: '2026-06-01T12:00:00Z', seenIds: ['a'] },
      })

      expect(result.events.map(event => event.id)).toEqual(['c'])
      expect(result.state.lastCreatedAt).toBe('2026-06-03T12:00:00Z')
      expect(result.state.seenIds.sort()).toEqual(['a', 'c'])

      expect(mock.history[0].query).toEqual({
        shortcode: 'GHI789',
        created_after: '2026-06-01T12:00:00Z',
        limit: 100,
      })
    })

    it('keeps the previous high-water mark when nothing newer arrived', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({
        candidates: [{ id: 'a', created_at: '2026-06-01T12:00:00Z' }],
      })

      const result = await service.onNewCandidate({
        state: { lastCreatedAt: '2026-06-05T12:00:00Z', seenIds: ['a'] },
      })

      expect(result.events).toEqual([])
      expect(result.state.lastCreatedAt).toBe('2026-06-05T12:00:00Z')
    })

    it('follows the paging.next cursor across pages', async () => {
      mock.onGet(`${ BASE }/candidates`).replyWith(callRecord => {
        if (!callRecord.query.since_id) {
          return {
            candidates: [{ id: 'a', created_at: '2026-06-01T12:00:00Z' }],
            paging: { next: `${ BASE }/candidates?since_id=a` },
          }
        }

        return { candidates: [{ id: 'b', created_at: '2026-06-02T12:00:00Z' }] }
      })

      const result = await service.onNewCandidate({
        state: { lastCreatedAt: '2026-05-01T00:00:00Z', seenIds: [] },
      })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].query.since_id).toBe('a')
      expect(result.events.map(event => event.id)).toEqual(['a', 'b'])
    })

    it('stops paging when the next link has no since_id cursor', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({
        candidates: [{ id: 'a', created_at: '2026-06-01T12:00:00Z' }],
        paging: { next: `${ BASE }/candidates?page=2` },
      })

      const result = await service.onNewCandidate({
        state: { lastCreatedAt: '2026-05-01T00:00:00Z', seenIds: [] },
      })

      expect(mock.history).toHaveLength(1)
      expect(result.events.map(event => event.id)).toEqual(['a'])
    })

    it('caps paging at ten requests', async () => {
      let counter = 0

      mock.onGet(`${ BASE }/candidates`).replyWith(() => {
        counter += 1

        return {
          candidates: [{ id: `c${ counter }`, created_at: '2026-06-01T12:00:00Z' }],
          paging: { next: `${ BASE }/candidates?since_id=c${ counter }` },
        }
      })

      await service.onNewCandidate({ state: { lastCreatedAt: '2026-05-01T00:00:00Z', seenIds: [] } })

      expect(mock.history).toHaveLength(10)
    })

    it('bounds the carried seen-id set to 500 entries', async () => {
      const many = Array.from({ length: 600 }, (_, index) => ({
        id: `id-${ index }`,
        created_at: '2026-06-01T12:00:00Z',
      }))

      mock.onGet(`${ BASE }/candidates`).reply({ candidates: many })

      const result = await service.onNewCandidate({})

      expect(result.state.seenIds).toHaveLength(500)
    })

    it('ignores candidates without an id when emitting events', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({
        candidates: [{ created_at: '2026-06-03T12:00:00Z' }],
      })

      const result = await service.onNewCandidate({
        state: { lastCreatedAt: '2026-06-01T12:00:00Z', seenIds: [] },
      })

      expect(result.events).toEqual([])
    })

    it('handles a response without a candidates array', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({})

      const result = await service.onNewCandidate({ state: { lastCreatedAt: '2026-06-01T12:00:00Z' } })

      expect(result.events).toEqual([])
    })
  })

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the named trigger method', async () => {
      mock.onGet(`${ BASE }/candidates`).reply({ candidates: [] })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewCandidate',
        parameters: {},
        state: null,
      })

      expect(result).toHaveProperty('events', [])
      expect(result).toHaveProperty('state')
      expect(mock.history).toHaveLength(1)
    })
  })
})
