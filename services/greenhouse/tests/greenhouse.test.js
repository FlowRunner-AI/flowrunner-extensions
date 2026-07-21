'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const ON_BEHALF_OF = '4080'
const BASE = 'https://harvest.greenhouse.io/v1'

// The service authenticates with HTTP Basic: base64 of "{apiKey}:".
const BASIC_AUTH = `Basic ${ Buffer.from(`${ API_KEY }:`).toString('base64') }`

// The service calls .unwrapBody(false) and reads { body, headers } off the resolved
// value, so every mock reply must be shaped that way. These helpers keep tests terse.
const ok = (body, headers = {}) => ({ body, headers })
const okList = (items, headers = {}) => ({ body: items, headers })

describe('Greenhouse Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, onBehalfOfUserId: ON_BEHALF_OF })
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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'onBehalfOfUserId',
          displayName: 'On-Behalf-Of User ID',
          required: false,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends HTTP Basic auth and JSON content type on every request', async () => {
      mock.onGet(`${ BASE }/candidates`).reply(okList([]))

      await service.listCandidates()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': BASIC_AUTH,
        'Content-Type': 'application/json',
      })
    })

    it('does NOT send On-Behalf-Of on read requests', async () => {
      mock.onGet(`${ BASE }/candidates`).reply(okList([]))

      await service.listCandidates()

      expect(mock.history[0].headers['On-Behalf-Of']).toBeUndefined()
    })
  })

  // ==========================================================================
  //  CANDIDATES
  // ==========================================================================

  describe('listCandidates', () => {
    it('sends default request and wraps items with nextPage from the Link header', async () => {
      mock.onGet(`${ BASE }/candidates`).reply(
        okList(
          [{ id: 1 }],
          { link: '<https://harvest.greenhouse.io/v1/candidates?page=2>; rel="next"' }
        )
      )

      const result = await service.listCandidates()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/candidates`)
      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ items: [{ id: 1 }], nextPage: 2 })
    })

    it('passes all filters and clamps per_page to 500', async () => {
      mock.onGet(`${ BASE }/candidates`).reply(okList([]))

      await service.listCandidates(
        999, 3, '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z',
        '2024-01-15T00:00:00Z', '299902', 'jane@example.com', '123,456'
      )

      expect(mock.history[0].query).toEqual({
        per_page: 500,
        page: 3,
        created_after: '2024-01-01T00:00:00Z',
        created_before: '2024-02-01T00:00:00Z',
        updated_after: '2024-01-15T00:00:00Z',
        job_id: '299902',
        email: 'jane@example.com',
        candidate_ids: '123,456',
      })
    })

    it('returns nextPage null when there is no Link header', async () => {
      mock.onGet(`${ BASE }/candidates`).reply(okList([{ id: 1 }]))

      const result = await service.listCandidates()

      expect(result.nextPage).toBeNull()
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/candidates`).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.listCandidates()).rejects.toThrow('Greenhouse API error: Unauthorized')
    })

    it('surfaces the Greenhouse error detail array', async () => {
      mock.onGet(`${ BASE }/candidates`).replyWithError({
        status: 422,
        body: { message: 'Invalid', errors: [{ field: 'email', message: 'is invalid' }] },
      })

      await expect(service.listCandidates()).rejects.toThrow(
        'Greenhouse API error: Invalid (email: is invalid)'
      )
    })
  })

  describe('getCandidate', () => {
    it('fetches a candidate by id', async () => {
      mock.onGet(`${ BASE }/candidates/17681532`).reply(ok({ id: 17681532, first_name: 'Jane' }))

      const result = await service.getCandidate('17681532')

      expect(result).toEqual({ id: 17681532, first_name: 'Jane' })
      expect(mock.history[0].url).toBe(`${ BASE }/candidates/17681532`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/candidates/999`).replyWithError({ message: 'Not found', status: 404 })

      await expect(service.getCandidate('999')).rejects.toThrow('Greenhouse API error: Not found')
    })
  })

  describe('createCandidate', () => {
    it('sends On-Behalf-Of header and a minimal payload with required params only', async () => {
      mock.onPost(`${ BASE }/candidates`).reply(ok({ id: 1 }))

      const result = await service.createCandidate('Jane', 'Doe')

      expect(result).toEqual({ id: 1 })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers['On-Behalf-Of']).toBe(ON_BEHALF_OF)
      expect(mock.history[0].body).toEqual({ first_name: 'Jane', last_name: 'Doe' })
    })

    it('builds email, phone and application from convenience params', async () => {
      mock.onPost(`${ BASE }/candidates`).reply(ok({ id: 2 }))

      await service.createCandidate(
        'Jane', 'Doe', 'jane@example.com', '+15551234567', 'Acme', 'Engineer', '299902', ['Referral']
      )

      expect(mock.history[0].body).toEqual({
        first_name: 'Jane',
        last_name: 'Doe',
        company: 'Acme',
        title: 'Engineer',
        email_addresses: [{ value: 'jane@example.com', type: 'personal' }],
        phone_numbers: [{ value: '+15551234567', type: 'mobile' }],
        applications: [{ job_id: 299902 }],
        tags: ['Referral'],
      })
    })

    it('lets advanced array params override the convenience fields', async () => {
      mock.onPost(`${ BASE }/candidates`).reply(ok({ id: 3 }))

      await service.createCandidate(
        'Jane', 'Doe', 'ignored@example.com', '000', undefined, undefined, '111', undefined,
        [{ value: '+1999', type: 'work' }],
        [{ value: 'raw@example.com', type: 'work' }],
        [{ value: '1 Main St', type: 'home' }],
        [{ value: 'https://linkedin.com/in/jane' }],
        [{ value: 'https://jane.dev', type: 'personal' }],
        [{ job_id: 555, source_id: 4000 }]
      )

      expect(mock.history[0].body).toEqual({
        first_name: 'Jane',
        last_name: 'Doe',
        phone_numbers: [{ value: '+1999', type: 'work' }],
        email_addresses: [{ value: 'raw@example.com', type: 'work' }],
        addresses: [{ value: '1 Main St', type: 'home' }],
        social_media_addresses: [{ value: 'https://linkedin.com/in/jane' }],
        website_addresses: [{ value: 'https://jane.dev', type: 'personal' }],
        applications: [{ job_id: 555, source_id: 4000 }],
      })
    })

    it('uses the per-action On-Behalf-Of override when provided', async () => {
      mock.onPost(`${ BASE }/candidates`).reply(ok({ id: 4 }))

      await service.createCandidate(
        'Jane', 'Doe', undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, '9999'
      )

      expect(mock.history[0].headers['On-Behalf-Of']).toBe('9999')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/candidates`).replyWithError({ message: 'Bad request', status: 400 })

      await expect(service.createCandidate('Jane', 'Doe')).rejects.toThrow(
        'Greenhouse API error: Bad request'
      )
    })
  })

  describe('updateCandidate', () => {
    it('sends a PATCH with only supplied fields and the On-Behalf-Of header', async () => {
      mock.onPatch(`${ BASE }/candidates/17681532`).reply(ok({ id: 17681532 }))

      await service.updateCandidate('17681532', 'Jane', 'Doe', 'Globex', 'Senior Engineer', ['VIP'])

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].headers['On-Behalf-Of']).toBe(ON_BEHALF_OF)
      expect(mock.history[0].body).toEqual({
        first_name: 'Jane',
        last_name: 'Doe',
        company: 'Globex',
        title: 'Senior Engineer',
        tags: ['VIP'],
      })
    })

    it('sends an empty body when no fields are supplied', async () => {
      mock.onPatch(`${ BASE }/candidates/1`).reply(ok({ id: 1 }))

      await service.updateCandidate('1')

      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${ BASE }/candidates/1`).replyWithError({ message: 'Boom' })

      await expect(service.updateCandidate('1', 'Jane')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('deleteCandidate', () => {
    it('sends DELETE with On-Behalf-Of and returns a success message', async () => {
      mock.onDelete(`${ BASE }/candidates/17681532`).reply(ok(undefined))

      const result = await service.deleteCandidate('17681532')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].headers['On-Behalf-Of']).toBe(ON_BEHALF_OF)
      expect(result).toEqual({ success: true, message: 'Candidate 17681532 deleted.' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/candidates/1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteCandidate('1')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('addNoteToCandidate', () => {
    it('sends the note with resolved visibility and defaults the author to the On-Behalf-Of user', async () => {
      mock.onPost(`${ BASE }/candidates/1/activity_feed/notes`).reply(ok({ id: 123 }))

      await service.addNoteToCandidate('1', 'Great screen', 'Admin Only')

      expect(mock.history[0].url).toBe(`${ BASE }/candidates/1/activity_feed/notes`)
      expect(mock.history[0].headers['On-Behalf-Of']).toBe(ON_BEHALF_OF)
      expect(mock.history[0].body).toEqual({
        user_id: Number(ON_BEHALF_OF),
        body: 'Great screen',
        visibility: 'admin_only',
      })
    })

    it('defaults visibility to public and honors an explicit author userId', async () => {
      mock.onPost(`${ BASE }/candidates/1/activity_feed/notes`).reply(ok({ id: 124 }))

      await service.addNoteToCandidate('1', 'Note', undefined, '5555')

      expect(mock.history[0].body).toEqual({
        user_id: 5555,
        body: 'Note',
        visibility: 'public',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/candidates/1/activity_feed/notes`).replyWithError({ message: 'Boom' })

      await expect(service.addNoteToCandidate('1', 'Note')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('addAttachmentToCandidate', () => {
    it('downloads the file, base64-encodes it and posts with resolved type and guessed content type', async () => {
      // The file fetch is a GET to the fileUrl with encoding null; return raw bytes.
      mock.onGet('https://files.example.com/resume.pdf').reply(Buffer.from('PDFDATA'))
      mock.onPost(`${ BASE }/candidates/1/attachments`).reply(ok({ filename: 'resume.pdf' }))

      await service.addAttachmentToCandidate('1', 'https://files.example.com/resume.pdf', 'resume.pdf', 'Cover Letter')

      const fetchCall = mock.history.find(h => h.url === 'https://files.example.com/resume.pdf')
      expect(fetchCall.encoding).toBeNull()

      const uploadCall = mock.history.find(h => h.url === `${ BASE }/candidates/1/attachments`)
      expect(uploadCall.headers['On-Behalf-Of']).toBe(ON_BEHALF_OF)
      expect(uploadCall.body).toEqual({
        filename: 'resume.pdf',
        type: 'cover_letter',
        content: Buffer.from('PDFDATA').toString('base64'),
        content_type: 'application/pdf',
      })
    })

    it('honors an explicit content type and defaults type to resume', async () => {
      mock.onGet('https://files.example.com/x.bin').reply(Buffer.from('BIN'))
      mock.onPost(`${ BASE }/candidates/1/attachments`).reply(ok({ filename: 'x.bin' }))

      await service.addAttachmentToCandidate('1', 'https://files.example.com/x.bin', 'x.bin', undefined, 'application/x-custom')

      const uploadCall = mock.history.find(h => h.url === `${ BASE }/candidates/1/attachments`)
      expect(uploadCall.body.type).toBe('resume')
      expect(uploadCall.body.content_type).toBe('application/x-custom')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet('https://files.example.com/r.pdf').reply(Buffer.from('X'))
      mock.onPost(`${ BASE }/candidates/1/attachments`).replyWithError({ message: 'Boom' })

      await expect(
        service.addAttachmentToCandidate('1', 'https://files.example.com/r.pdf', 'r.pdf')
      ).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('listCandidateApplications', () => {
    it('fetches applications for a candidate with pagination', async () => {
      mock.onGet(`${ BASE }/candidates/1/applications`).reply(okList([{ id: 265968 }]))

      const result = await service.listCandidateApplications('1', 25, 2)

      expect(mock.history[0].url).toBe(`${ BASE }/candidates/1/applications`)
      expect(mock.history[0].query).toEqual({ per_page: 25, page: 2 })
      expect(result).toEqual({ items: [{ id: 265968 }], nextPage: null })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/candidates/1/applications`).replyWithError({ message: 'Boom' })

      await expect(service.listCandidateApplications('1')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  // ==========================================================================
  //  APPLICATIONS
  // ==========================================================================

  describe('listApplications', () => {
    it('sends default request with no filters', async () => {
      mock.onGet(`${ BASE }/applications`).reply(okList([]))

      const result = await service.listApplications()

      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ items: [], nextPage: null })
    })

    it('resolves the status label and passes all filters', async () => {
      mock.onGet(`${ BASE }/applications`).reply(okList([]))

      await service.listApplications('299902', 'Hired', 10, 2, '2024-01-01T00:00:00Z')

      expect(mock.history[0].query).toEqual({
        per_page: 10,
        page: 2,
        job_id: '299902',
        status: 'hired',
        created_after: '2024-01-01T00:00:00Z',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/applications`).replyWithError({ message: 'Boom' })

      await expect(service.listApplications()).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('getApplication', () => {
    it('fetches an application by id', async () => {
      mock.onGet(`${ BASE }/applications/265968`).reply(ok({ id: 265968 }))

      const result = await service.getApplication('265968')

      expect(result).toEqual({ id: 265968 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/applications/1`).replyWithError({ message: 'Boom' })

      await expect(service.getApplication('1')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('moveApplicationStage', () => {
    it('posts numeric from/to stage ids with On-Behalf-Of', async () => {
      mock.onPost(`${ BASE }/applications/265968/move`).reply(ok({ id: 265968 }))

      await service.moveApplicationStage('265968', '2708728', '2708729')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers['On-Behalf-Of']).toBe(ON_BEHALF_OF)
      expect(mock.history[0].body).toEqual({ from_stage_id: 2708728, to_stage_id: 2708729 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/applications/1/move`).replyWithError({ message: 'Boom' })

      await expect(service.moveApplicationStage('1', '2', '3')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('advanceApplication', () => {
    it('posts an empty body with On-Behalf-Of', async () => {
      mock.onPost(`${ BASE }/applications/265968/advance`).reply(ok({ id: 265968 }))

      await service.advanceApplication('265968')

      expect(mock.history[0].url).toBe(`${ BASE }/applications/265968/advance`)
      expect(mock.history[0].headers['On-Behalf-Of']).toBe(ON_BEHALF_OF)
      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/applications/1/advance`).replyWithError({ message: 'Boom' })

      await expect(service.advanceApplication('1')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('rejectApplication', () => {
    it('posts the numeric reason id with required params only', async () => {
      mock.onPost(`${ BASE }/applications/265968/reject`).reply(ok({ id: 265968, status: 'rejected' }))

      await service.rejectApplication('265968', '9001')

      expect(mock.history[0].headers['On-Behalf-Of']).toBe(ON_BEHALF_OF)
      expect(mock.history[0].body).toEqual({ rejection_reason_id: 9001 })
    })

    it('includes notes and a rejection email object', async () => {
      mock.onPost(`${ BASE }/applications/265968/reject`).reply(ok({ id: 265968 }))

      const email = { send_email_at: '2024-01-20T12:00:00Z', email_template_id: 7 }
      await service.rejectApplication('265968', '9001', 'Not a fit', email)

      expect(mock.history[0].body).toEqual({
        rejection_reason_id: 9001,
        notes: 'Not a fit',
        rejection_email: email,
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/applications/1/reject`).replyWithError({ message: 'Boom' })

      await expect(service.rejectApplication('1', '9001')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('hireApplication', () => {
    it('posts an empty body with required params only', async () => {
      mock.onPost(`${ BASE }/applications/265968/hire`).reply(ok({ id: 265968, status: 'hired' }))

      await service.hireApplication('265968')

      expect(mock.history[0].headers['On-Behalf-Of']).toBe(ON_BEHALF_OF)
      expect(mock.history[0].body).toEqual({})
    })

    it('includes start date and numeric opening id', async () => {
      mock.onPost(`${ BASE }/applications/265968/hire`).reply(ok({ id: 265968 }))

      await service.hireApplication('265968', '2024-02-01', '123')

      expect(mock.history[0].body).toEqual({ start_date: '2024-02-01', opening_id: 123 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/applications/1/hire`).replyWithError({ message: 'Boom' })

      await expect(service.hireApplication('1')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('updateApplication', () => {
    it('sends a PATCH with numeric source id and referrer', async () => {
      mock.onPatch(`${ BASE }/applications/265968`).reply(ok({ id: 265968 }))

      const referrer = { type: 'id', value: 4080 }
      await service.updateApplication('265968', '4000', referrer)

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].headers['On-Behalf-Of']).toBe(ON_BEHALF_OF)
      expect(mock.history[0].body).toEqual({ source_id: 4000, referrer })
    })

    it('sends an empty body when nothing is supplied', async () => {
      mock.onPatch(`${ BASE }/applications/1`).reply(ok({ id: 1 }))

      await service.updateApplication('1')

      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${ BASE }/applications/1`).replyWithError({ message: 'Boom' })

      await expect(service.updateApplication('1', '4000')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('listApplicationScorecards', () => {
    it('fetches scorecards with pagination', async () => {
      mock.onGet(`${ BASE }/applications/265968/scorecards`).reply(okList([{ id: 300001 }]))

      const result = await service.listApplicationScorecards('265968', 5, 1)

      expect(mock.history[0].query).toEqual({ per_page: 5, page: 1 })
      expect(result).toEqual({ items: [{ id: 300001 }], nextPage: null })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/applications/1/scorecards`).replyWithError({ message: 'Boom' })

      await expect(service.listApplicationScorecards('1')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('listScheduledInterviewsForApplication', () => {
    it('fetches scheduled interviews for an application', async () => {
      mock.onGet(`${ BASE }/applications/265968/scheduled_interviews`).reply(okList([{ id: 400001 }]))

      const result = await service.listScheduledInterviewsForApplication('265968')

      expect(mock.history[0].url).toBe(`${ BASE }/applications/265968/scheduled_interviews`)
      expect(result).toEqual({ items: [{ id: 400001 }], nextPage: null })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/applications/1/scheduled_interviews`).replyWithError({ message: 'Boom' })

      await expect(service.listScheduledInterviewsForApplication('1')).rejects.toThrow(
        'Greenhouse API error: Boom'
      )
    })
  })

  describe('listApplicationOffers', () => {
    it('fetches offers for an application', async () => {
      mock.onGet(`${ BASE }/applications/265968/offers`).reply(okList([{ id: 500001 }]))

      const result = await service.listApplicationOffers('265968')

      expect(result).toEqual({ items: [{ id: 500001 }], nextPage: null })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/applications/1/offers`).replyWithError({ message: 'Boom' })

      await expect(service.listApplicationOffers('1')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('getCurrentOfferForApplication', () => {
    it('fetches the current offer', async () => {
      mock.onGet(`${ BASE }/applications/265968/offers/current_offer`).reply(ok({ id: 500001 }))

      const result = await service.getCurrentOfferForApplication('265968')

      expect(result).toEqual({ id: 500001 })
      expect(mock.history[0].url).toBe(`${ BASE }/applications/265968/offers/current_offer`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/applications/1/offers/current_offer`).replyWithError({ message: 'Boom' })

      await expect(service.getCurrentOfferForApplication('1')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  // ==========================================================================
  //  JOBS
  // ==========================================================================

  describe('listJobs', () => {
    it('sends default request with no filters', async () => {
      mock.onGet(`${ BASE }/jobs`).reply(okList([]))

      const result = await service.listJobs()

      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ items: [], nextPage: null })
    })

    it('resolves status and passes all filters', async () => {
      mock.onGet(`${ BASE }/jobs`).reply(okList([]))

      await service.listJobs('Closed', 20, 2, 'R-100', '2024-01-01T00:00:00Z')

      expect(mock.history[0].query).toEqual({
        per_page: 20,
        page: 2,
        status: 'closed',
        requisition_id: 'R-100',
        created_after: '2024-01-01T00:00:00Z',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/jobs`).replyWithError({ message: 'Boom' })

      await expect(service.listJobs()).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('getJob', () => {
    it('fetches a job by id', async () => {
      mock.onGet(`${ BASE }/jobs/299902`).reply(ok({ id: 299902 }))

      const result = await service.getJob('299902')

      expect(result).toEqual({ id: 299902 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/jobs/1`).replyWithError({ message: 'Boom' })

      await expect(service.getJob('1')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('getJobStages', () => {
    it('returns stages wrapped in an items array (no pagination)', async () => {
      mock.onGet(`${ BASE }/jobs/299902/stages`).reply(okList([{ id: 2708728 }, { id: 2708729 }]))

      const result = await service.getJobStages('299902')

      expect(mock.history[0].url).toBe(`${ BASE }/jobs/299902/stages`)
      expect(result).toEqual({ items: [{ id: 2708728 }, { id: 2708729 }] })
    })

    it('returns an empty items array for a non-array body', async () => {
      mock.onGet(`${ BASE }/jobs/1/stages`).reply(ok(null))

      const result = await service.getJobStages('1')

      expect(result).toEqual({ items: [] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/jobs/1/stages`).replyWithError({ message: 'Boom' })

      await expect(service.getJobStages('1')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('listJobOpenings', () => {
    it('fetches openings with no status filter', async () => {
      mock.onGet(`${ BASE }/jobs/299902/openings`).reply(okList([{ id: 123 }]))

      const result = await service.listJobOpenings('299902')

      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ items: [{ id: 123 }] })
    })

    it('resolves the status label into a query param', async () => {
      mock.onGet(`${ BASE }/jobs/299902/openings`).reply(okList([]))

      await service.listJobOpenings('299902', 'Open')

      expect(mock.history[0].query).toEqual({ status: 'open' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/jobs/1/openings`).replyWithError({ message: 'Boom' })

      await expect(service.listJobOpenings('1')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('createJobOpening', () => {
    it('posts openings with On-Behalf-Of', async () => {
      mock.onPost(`${ BASE }/jobs/299902/openings`).reply(ok({ id: 299902 }))

      const openings = [{ opening_id: 'R-100-2', employment_status: 'full_time' }]
      await service.createJobOpening('299902', openings)

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers['On-Behalf-Of']).toBe(ON_BEHALF_OF)
      expect(mock.history[0].body).toEqual({ openings })
    })

    it('sends an empty openings array when openings is not an array', async () => {
      mock.onPost(`${ BASE }/jobs/1/openings`).reply(ok({ id: 1 }))

      await service.createJobOpening('1', undefined)

      expect(mock.history[0].body).toEqual({ openings: [] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/jobs/1/openings`).replyWithError({ message: 'Boom' })

      await expect(service.createJobOpening('1', [])).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  // ==========================================================================
  //  JOB POSTS
  // ==========================================================================

  describe('listJobPosts', () => {
    it('omits active/live when not true', async () => {
      mock.onGet(`${ BASE }/job_posts`).reply(okList([]))

      await service.listJobPosts()

      expect(mock.history[0].query).toEqual({})
    })

    it('sends active and live flags only when true', async () => {
      mock.onGet(`${ BASE }/job_posts`).reply(okList([]))

      await service.listJobPosts(true, true, 10, 2)

      expect(mock.history[0].query).toEqual({ per_page: 10, page: 2, active: true, live: true })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/job_posts`).replyWithError({ message: 'Boom' })

      await expect(service.listJobPosts()).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('getJobPostsForJob', () => {
    it('fetches job posts for a job wrapped in items', async () => {
      mock.onGet(`${ BASE }/jobs/299902/job_posts`).reply(okList([{ id: 600001 }]))

      const result = await service.getJobPostsForJob('299902')

      expect(result).toEqual({ items: [{ id: 600001 }] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/jobs/1/job_posts`).replyWithError({ message: 'Boom' })

      await expect(service.getJobPostsForJob('1')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  // ==========================================================================
  //  USERS
  // ==========================================================================

  describe('listUsers', () => {
    it('sends default request', async () => {
      mock.onGet(`${ BASE }/users`).reply(okList([]))

      const result = await service.listUsers()

      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ items: [], nextPage: null })
    })

    it('passes pagination and email filter', async () => {
      mock.onGet(`${ BASE }/users`).reply(okList([]))

      await service.listUsers(50, 2, 'recruiter@example.com')

      expect(mock.history[0].query).toEqual({ per_page: 50, page: 2, email: 'recruiter@example.com' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/users`).replyWithError({ message: 'Boom' })

      await expect(service.listUsers()).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('getUser', () => {
    it('fetches a user by id', async () => {
      mock.onGet(`${ BASE }/users/4080`).reply(ok({ id: 4080 }))

      const result = await service.getUser('4080')

      expect(result).toEqual({ id: 4080 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/users/1`).replyWithError({ message: 'Boom' })

      await expect(service.getUser('1')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  // ==========================================================================
  //  REFERENCE DATA
  // ==========================================================================

  describe('listSources', () => {
    it('fetches sources with pagination', async () => {
      mock.onGet(`${ BASE }/sources`).reply(okList([{ id: 4000 }]))

      const result = await service.listSources(10, 1)

      expect(mock.history[0].query).toEqual({ per_page: 10, page: 1 })
      expect(result).toEqual({ items: [{ id: 4000 }], nextPage: null })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/sources`).replyWithError({ message: 'Boom' })

      await expect(service.listSources()).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('listRejectionReasons', () => {
    it('fetches rejection reasons', async () => {
      mock.onGet(`${ BASE }/rejection_reasons`).reply(okList([{ id: 9001 }]))

      const result = await service.listRejectionReasons()

      expect(result).toEqual({ items: [{ id: 9001 }], nextPage: null })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/rejection_reasons`).replyWithError({ message: 'Boom' })

      await expect(service.listRejectionReasons()).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('listDepartments', () => {
    it('fetches departments', async () => {
      mock.onGet(`${ BASE }/departments`).reply(okList([{ id: 4000 }]))

      const result = await service.listDepartments()

      expect(result).toEqual({ items: [{ id: 4000 }], nextPage: null })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/departments`).replyWithError({ message: 'Boom' })

      await expect(service.listDepartments()).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('listOffices', () => {
    it('fetches offices', async () => {
      mock.onGet(`${ BASE }/offices`).reply(okList([{ id: 9000 }]))

      const result = await service.listOffices()

      expect(result).toEqual({ items: [{ id: 9000 }], nextPage: null })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/offices`).replyWithError({ message: 'Boom' })

      await expect(service.listOffices()).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('listCustomFields', () => {
    it('resolves the field type label into the URL path', async () => {
      mock.onGet(`${ BASE }/custom_fields/application`).reply(okList([{ id: 700001 }]))

      const result = await service.listCustomFields('Application')

      expect(mock.history[0].url).toBe(`${ BASE }/custom_fields/application`)
      expect(result).toEqual({ items: [{ id: 700001 }] })
    })

    it('defaults to the candidate field type', async () => {
      mock.onGet(`${ BASE }/custom_fields/candidate`).reply(okList([]))

      await service.listCustomFields()

      expect(mock.history[0].url).toBe(`${ BASE }/custom_fields/candidate`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/custom_fields/candidate`).replyWithError({ message: 'Boom' })

      await expect(service.listCustomFields('Candidate')).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================

  describe('getJobsDictionary', () => {
    it('maps jobs to items and reads the next cursor from the Link header', async () => {
      mock.onGet(`${ BASE }/jobs`).reply(
        okList(
          [{ id: 299902, name: 'Software Engineer', status: 'open' }],
          { link: '<https://harvest.greenhouse.io/v1/jobs?page=2>; rel="next"' }
        )
      )

      const result = await service.getJobsDictionary({})

      expect(mock.history[0].query).toMatchObject({ per_page: 100 })
      expect(result).toEqual({
        items: [{ label: 'Software Engineer', value: '299902', note: 'open' }],
        cursor: '2',
      })
    })

    it('filters by search term and paginates with a cursor', async () => {
      mock.onGet(`${ BASE }/jobs`).reply(okList([
        { id: 1, name: 'Software Engineer', status: 'open' },
        { id: 2, name: 'Product Manager', status: 'open' },
      ]))

      const result = await service.getJobsDictionary({ search: 'product', cursor: '3' })

      expect(mock.history[0].query).toMatchObject({ per_page: 100, page: 3 })
      expect(result.items).toEqual([{ label: 'Product Manager', value: '2', note: 'open' }])
      expect(result.cursor).toBeNull()
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/jobs`).reply(okList([]))

      const result = await service.getJobsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('propagates API errors (dictionaries are not error-swallowing here)', async () => {
      mock.onGet(`${ BASE }/jobs`).replyWithError({ message: 'Boom' })

      await expect(service.getJobsDictionary({})).rejects.toThrow('Greenhouse API error: Boom')
    })
  })

  describe('getUsersDictionary', () => {
    it('maps users to items with email note', async () => {
      mock.onGet(`${ BASE }/users`).reply(okList([
        { id: 4080, name: 'Recruiter One', primary_email_address: 'recruiter@example.com' },
      ]))

      const result = await service.getUsersDictionary({})

      expect(result.items).toEqual([
        { label: 'Recruiter One', value: '4080', note: 'recruiter@example.com' },
      ])
    })

    it('filters by name or email', async () => {
      mock.onGet(`${ BASE }/users`).reply(okList([
        { id: 1, name: 'Alice', primary_email_address: 'alice@example.com' },
        { id: 2, name: 'Bob', primary_email_address: 'bob@work.com' },
      ]))

      const result = await service.getUsersDictionary({ search: 'work.com' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('2')
    })
  })

  describe('getJobStagesDictionary', () => {
    it('returns empty items without a job id in criteria (no HTTP call)', async () => {
      const result = await service.getJobStagesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('maps stages for a given job with a Priority note', async () => {
      mock.onGet(`${ BASE }/jobs/299902/stages`).reply(okList([
        { id: 2708728, name: 'Recruiter Phone Screen', priority: 1 },
        { id: 2708729, name: 'Onsite', priority: 2 },
      ]))

      const result = await service.getJobStagesDictionary({ criteria: { jobId: '299902' } })

      expect(mock.history[0].url).toBe(`${ BASE }/jobs/299902/stages`)
      expect(result).toEqual({
        items: [
          { label: 'Recruiter Phone Screen', value: '2708728', note: 'Priority 1' },
          { label: 'Onsite', value: '2708729', note: 'Priority 2' },
        ],
        cursor: null,
      })
    })

    it('filters stages by search term', async () => {
      mock.onGet(`${ BASE }/jobs/299902/stages`).reply(okList([
        { id: 2708728, name: 'Recruiter Phone Screen', priority: 1 },
        { id: 2708729, name: 'Onsite', priority: 2 },
      ]))

      const result = await service.getJobStagesDictionary({
        search: 'onsite',
        criteria: { jobId: '299902' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('2708729')
    })
  })

  describe('getSourcesDictionary', () => {
    it('maps sources to items with the type name as note', async () => {
      mock.onGet(`${ BASE }/sources`).reply(okList([
        { id: 4000, public_name: 'LinkedIn', type: { id: 11, name: 'Job boards & job ads' } },
      ]))

      const result = await service.getSourcesDictionary({})

      expect(result.items).toEqual([
        { label: 'LinkedIn', value: '4000', note: 'Job boards & job ads' },
      ])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/sources`).reply(okList([
        { id: 1, public_name: 'LinkedIn' },
        { id: 2, public_name: 'Referral' },
      ]))

      const result = await service.getSourcesDictionary({ search: 'refer' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('2')
    })
  })

  describe('getRejectionReasonsDictionary', () => {
    it('maps rejection reasons to items with type note', async () => {
      mock.onGet(`${ BASE }/rejection_reasons`).reply(okList([
        { id: 9001, name: 'Not enough experience', type: { id: 1, name: 'We rejected them' } },
      ]))

      const result = await service.getRejectionReasonsDictionary({})

      expect(result.items).toEqual([
        { label: 'Not enough experience', value: '9001', note: 'We rejected them' },
      ])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/rejection_reasons`).reply(okList([
        { id: 1, name: 'Not enough experience' },
        { id: 2, name: 'Better candidate' },
      ]))

      const result = await service.getRejectionReasonsDictionary({ search: 'better' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('2')
    })
  })

  describe('getDepartmentsDictionary', () => {
    it('maps departments with a sub-department count note', async () => {
      mock.onGet(`${ BASE }/departments`).reply(okList([
        { id: 4000, name: 'Engineering', child_ids: [4010, 4020, 4030] },
        { id: 5000, name: 'Sales', child_ids: [] },
      ]))

      const result = await service.getDepartmentsDictionary({})

      expect(result.items).toEqual([
        { label: 'Engineering', value: '4000', note: '3 sub-departments' },
        { label: 'Sales', value: '5000', note: undefined },
      ])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/departments`).reply(okList([
        { id: 1, name: 'Engineering', child_ids: [] },
        { id: 2, name: 'Marketing', child_ids: [] },
      ]))

      const result = await service.getDepartmentsDictionary({ search: 'market' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('2')
    })
  })

  describe('getOfficesDictionary', () => {
    it('maps offices with the location name as note', async () => {
      mock.onGet(`${ BASE }/offices`).reply(okList([
        { id: 9000, name: 'San Francisco', location: { name: 'San Francisco, CA' } },
      ]))

      const result = await service.getOfficesDictionary({})

      expect(result.items).toEqual([
        { label: 'San Francisco', value: '9000', note: 'San Francisco, CA' },
      ])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/offices`).reply(okList([
        { id: 1, name: 'San Francisco' },
        { id: 2, name: 'New York' },
      ]))

      const result = await service.getOfficesDictionary({ search: 'york' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('2')
    })
  })

  // ==========================================================================
  //  On-Behalf-Of validation (write methods require a Greenhouse user)
  // ==========================================================================

  describe('On-Behalf-Of requirement', () => {
    // Build a fresh instance with NO service-level On-Behalf-Of user id by
    // reusing the registered class from the active runtime. The class is captured
    // when the service module is required; construct it directly with a bare config.
    let noOboService

    beforeAll(() => {
      const ServiceClass = service.constructor
      noOboService = new ServiceClass({ apiKey: API_KEY })
    })

    it('throws a helpful error when a write has no On-Behalf-Of user (no HTTP call made)', async () => {
      await expect(noOboService.createCandidate('Jane', 'Doe')).rejects.toThrow(
        /On-Behalf-Of header/
      )
      expect(mock.history).toHaveLength(0)
    })

    it('allows a write when the per-action override supplies the user id', async () => {
      mock.onPost(`${ BASE }/candidates`).reply(ok({ id: 1 }))

      await noOboService.createCandidate(
        'Jane', 'Doe', undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, '7777'
      )

      expect(mock.history[0].headers['On-Behalf-Of']).toBe('7777')
    })
  })
})
