'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_TOKEN = 'test-access-token'
const BASE = 'https://api.surveymonkey.com/v3'

const AUTH_HEADERS = {
  'Authorization': `Bearer ${ ACCESS_TOKEN }`,
  'Content-Type': 'application/json',
}

describe('SurveyMonkey Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accessToken: ACCESS_TOKEN })
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
    it('registers the required config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['accessToken'])

      expect(configItems).toEqual([
        expect.objectContaining({
          name: 'accessToken',
          displayName: 'Access Token',
          type: 'STRING',
          required: true,
          shared: false,
        }),
      ])
    })

    it('reads the access token from config', () => {
      expect(service.accessToken).toBe(ACCESS_TOKEN)
    })
  })

  // ── Surveys ──

  describe('listSurveys', () => {
    it('sends a GET with no query params when nothing is provided', async () => {
      mock.onGet(`${ BASE }/surveys`).reply({ data: [], total: 0 })

      const result = await service.listSurveys()

      expect(result).toEqual({ data: [], total: 0 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/surveys`)
      expect(mock.history[0].headers).toEqual(AUTH_HEADERS)
      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].body).toBeUndefined()
    })

    it('maps the sort choices to API values', async () => {
      mock.onGet(`${ BASE }/surveys`).reply({ data: [] })

      await service.listSurveys(2, 25, 'Feedback', 'Number of Responses', 'Ascending')

      expect(mock.history[0].query).toEqual({
        page: 2,
        per_page: 25,
        title: 'Feedback',
        sort_by: 'num_responses',
        sort_order: 'ASC',
      })
    })

    it('maps the remaining sort choices', async () => {
      mock.onGet(`${ BASE }/surveys`).reply({ data: [] })

      await service.listSurveys(undefined, undefined, undefined, 'Title', 'Descending')
      await service.listSurveys(undefined, undefined, undefined, 'Date Modified', 'Descending')

      expect(mock.history[0].query).toEqual({ sort_by: 'title', sort_order: 'DESC' })
      expect(mock.history[1].query).toEqual({ sort_by: 'date_modified', sort_order: 'DESC' })
    })

    it('passes unknown choice values through unchanged', async () => {
      mock.onGet(`${ BASE }/surveys`).reply({ data: [] })

      await service.listSurveys(undefined, undefined, undefined, 'custom_field', 'WHATEVER')

      expect(mock.history[0].query).toEqual({ sort_by: 'custom_field', sort_order: 'WHATEVER' })
    })

    it('drops empty-string choices', async () => {
      mock.onGet(`${ BASE }/surveys`).reply({ data: [] })

      await service.listSurveys(undefined, undefined, '', '', '')

      expect(mock.history[0].query).toEqual({})
    })

    it('throws a wrapped error when the API responds with an error body', async () => {
      mock.onGet(`${ BASE }/surveys`).replyWithError({
        message: 'Request failed',
        body: { error: { id: '1014', message: 'Invalid token' } },
      })

      await expect(service.listSurveys()).rejects.toThrow('SurveyMonkey API error: Invalid token (error 1014)')
    })

    it('falls back to the transport error message when there is no API error body', async () => {
      mock.onGet(`${ BASE }/surveys`).replyWithError({ message: 'Network timeout' })

      await expect(service.listSurveys()).rejects.toThrow('SurveyMonkey API error: Network timeout')
    })

    it('omits the error id suffix when the API error has no id', async () => {
      mock.onGet(`${ BASE }/surveys`).replyWithError({
        message: 'Request failed',
        body: { error: { message: 'Rate limit exceeded' } },
      })

      await expect(service.listSurveys()).rejects.toThrow('SurveyMonkey API error: Rate limit exceeded')
    })
  })

  describe('getSurvey', () => {
    it('requests the survey by id', async () => {
      mock.onGet(`${ BASE }/surveys/123456789`).reply({ id: '123456789', title: 'Customer Feedback' })

      const result = await service.getSurvey('123456789')

      expect(result).toEqual({ id: '123456789', title: 'Customer Feedback' })
      expect(mock.history[0].url).toBe(`${ BASE }/surveys/123456789`)
      expect(mock.history[0].method).toBe('get')
    })

    it('url-encodes the survey id', async () => {
      mock.onGet(`${ BASE }/surveys/a%2Fb`).reply({ id: 'a/b' })

      await service.getSurvey('a/b')

      expect(mock.history[0].url).toBe(`${ BASE }/surveys/a%2Fb`)
    })
  })

  describe('getSurveyDetails', () => {
    it('requests the details endpoint', async () => {
      mock.onGet(`${ BASE }/surveys/123/details`).reply({ id: '123', pages: [] })

      const result = await service.getSurveyDetails('123')

      expect(result).toEqual({ id: '123', pages: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/surveys/123/details`)
    })
  })

  describe('createSurvey', () => {
    it('sends only the title when nothing else is provided', async () => {
      mock.onPost(`${ BASE }/surveys`).reply({ id: '987', title: 'New Survey' })

      const result = await service.createSurvey('New Survey')

      expect(result).toEqual({ id: '987', title: 'New Survey' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ title: 'New Survey' })
    })

    it('sends every optional field when provided', async () => {
      mock.onPost(`${ BASE }/surveys`).reply({ id: '987' })

      await service.createSurvey('Copy', 'tpl-1', 'srv-1', 'internal')

      expect(mock.history[0].body).toEqual({
        title: 'Copy',
        from_template_id: 'tpl-1',
        from_survey_id: 'srv-1',
        nickname: 'internal',
      })
    })

    it('throws on API failure', async () => {
      mock.onPost(`${ BASE }/surveys`).replyWithError({
        message: 'Bad Request',
        body: { error: { id: '1003', message: 'Title required' } },
      })

      await expect(service.createSurvey('x')).rejects.toThrow('SurveyMonkey API error: Title required (error 1003)')
    })
  })

  describe('deleteSurvey', () => {
    it('sends a DELETE to the survey URL', async () => {
      mock.onDelete(`${ BASE }/surveys/123`).reply({ id: '123', title: 'Deleted' })

      const result = await service.deleteSurvey('123')

      expect(result).toEqual({ id: '123', title: 'Deleted' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  // ── Responses ──

  describe('listSurveyResponses', () => {
    it('sends only the survey id path when no filters are given', async () => {
      mock.onGet(`${ BASE }/surveys/123/responses`).reply({ data: [] })

      const result = await service.listSurveyResponses('123')

      expect(result).toEqual({ data: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/surveys/123/responses`)
      expect(mock.history[0].query).toEqual({})
    })

    it('maps the status choice and passes date filters', async () => {
      mock.onGet(`${ BASE }/surveys/123/responses`).reply({ data: [] })

      await service.listSurveyResponses('123', 1, 10, 'Over Quota', '2026-01-01T00:00:00', '2026-02-01T00:00:00')

      expect(mock.history[0].query).toEqual({
        page: 1,
        per_page: 10,
        status: 'overquota',
        start_created_at: '2026-01-01T00:00:00',
        end_created_at: '2026-02-01T00:00:00',
      })
    })

    it('maps each supported status choice', async () => {
      mock.onGet(`${ BASE }/surveys/123/responses`).reply({ data: [] })

      await service.listSurveyResponses('123', undefined, undefined, 'Completed')
      await service.listSurveyResponses('123', undefined, undefined, 'Partial')
      await service.listSurveyResponses('123', undefined, undefined, 'Disqualified')

      expect(mock.history.map(call => call.query.status)).toEqual(['completed', 'partial', 'disqualified'])
    })
  })

  describe('getResponseDetails', () => {
    it('returns the response with a mapping note and no extra call when mapping is disabled', async () => {
      mock.onGet(`${ BASE }/surveys/123/responses/100001/details`).reply({ id: '100001', pages: [] })

      const result = await service.getResponseDetails('123', '100001')

      expect(mock.history).toHaveLength(1)
      expect(result.id).toBe('100001')
      expect(result.mapping_note).toContain('Get Survey Details')
      expect(result).not.toHaveProperty('mapped_answers')
    })

    it('builds mapped_answers from the survey structure when mapping is enabled', async () => {
      mock.onGet(`${ BASE }/surveys/123/responses/100001/details`).reply({
        id: '100001',
        pages: [
          {
            id: '111',
            questions: [
              { id: 'q1', answers: [{ choice_id: 'c1' }] },
              { id: 'q2', answers: [{ text: 'Free text answer' }] },
              { id: 'q3', answers: [{ row_id: 'r1', col_id: 'col1' }, { row_id: 'r2' }] },
              { id: 'q4', answers: [{ other_id: 'o1' }] },
              { id: 'q5', answers: [{ choice_id: 'unknown-choice' }] },
              { id: 'unknown-question', answers: [{ text: 'ignored' }] },
            ],
          },
        ],
      })

      mock.onGet(`${ BASE }/surveys/123/details`).reply({
        id: '123',
        pages: [
          {
            id: '111',
            questions: [
              {
                id: 'q1',
                headings: [{ heading: 'How satisfied are you?' }],
                answers: { choices: [{ id: 'c1', text: 'Very satisfied' }] },
              },
              { id: 'q2', headings: [{ heading: 'Any comments?' }] },
              {
                id: 'q3',
                headings: [{ heading: 'Rate each area' }],
                answers: {
                  rows: [{ id: 'r1', text: 'Support' }, { id: 'r2', text: 'Pricing' }],
                  cols: [{ id: 'col1', text: 'Good' }],
                },
              },
              { id: 'q4', answers: {} },
              { id: 'q5', headings: [{ heading: 'Unmapped choice' }], answers: { choices: [] } },
            ],
          },
        ],
      })

      const result = await service.getResponseDetails('123', '100001', true)

      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].url).toBe(`${ BASE }/surveys/123/details`)

      expect(result.mapped_answers).toEqual([
        { question: 'How satisfied are you?', answers: ['Very satisfied'] },
        { question: 'Any comments?', answers: ['Free text answer'] },
        { question: 'Rate each area', answers: ['Support: Good', 'Pricing'] },
        { question: '', answers: ['o1'] },
        { question: 'Unmapped choice', answers: ['unknown-choice'] },
      ])
    })

    it('tolerates a response and survey without pages', async () => {
      mock.onGet(`${ BASE }/surveys/123/responses/1/details`).reply({ id: '1' })
      mock.onGet(`${ BASE }/surveys/123/details`).reply({ id: '123' })

      const result = await service.getResponseDetails('123', '1', true)

      expect(result.mapped_answers).toEqual([])
    })

    it('sets mapped_answers to null when the details call fails', async () => {
      mock.onGet(`${ BASE }/surveys/123/responses/1/details`).reply({ id: '1', pages: [] })
      mock.onGet(`${ BASE }/surveys/123/details`).replyWithError({ message: 'Not found' })

      const result = await service.getResponseDetails('123', '1', true)

      expect(result.mapped_answers).toBeNull()
      expect(result.mapping_note).toBeDefined()
    })

    it('throws when the response itself cannot be fetched', async () => {
      mock.onGet(`${ BASE }/surveys/123/responses/1/details`).replyWithError({
        message: 'Not Found',
        body: { error: { id: '1020', message: 'Response not found' } },
      })

      await expect(service.getResponseDetails('123', '1')).rejects.toThrow(
        'SurveyMonkey API error: Response not found (error 1020)'
      )
    })
  })

  describe('listAllResponsesBulk', () => {
    it('requests the bulk endpoint with mapped status', async () => {
      mock.onGet(`${ BASE }/surveys/123/responses/bulk`).reply({ data: [] })

      const result = await service.listAllResponsesBulk('123', 1, 100, 'Completed')

      expect(result).toEqual({ data: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/surveys/123/responses/bulk`)
      expect(mock.history[0].query).toEqual({ page: 1, per_page: 100, status: 'completed' })
    })

    it('omits the status when not provided', async () => {
      mock.onGet(`${ BASE }/surveys/123/responses/bulk`).reply({ data: [] })

      await service.listAllResponsesBulk('123')

      expect(mock.history[0].query).toEqual({})
    })
  })

  // ── Collectors ──

  describe('listCollectors', () => {
    it('requests the survey collectors with pagination', async () => {
      mock.onGet(`${ BASE }/surveys/123/collectors`).reply({ data: [] })

      await service.listCollectors('123', 2, 10)

      expect(mock.history[0].url).toBe(`${ BASE }/surveys/123/collectors`)
      expect(mock.history[0].query).toEqual({ page: 2, per_page: 10 })
    })
  })

  describe('getCollector', () => {
    it('requests the collector by id', async () => {
      mock.onGet(`${ BASE }/collectors/200001`).reply({ id: '200001', type: 'weblink' })

      const result = await service.getCollector('200001')

      expect(result).toEqual({ id: '200001', type: 'weblink' })
    })
  })

  describe('createCollector', () => {
    it('maps the Web Link type and sends the name', async () => {
      mock.onPost(`${ BASE }/surveys/123/collectors`).reply({ id: '200002' })

      const result = await service.createCollector('123', 'Web Link', 'Link 1')

      expect(result).toEqual({ id: '200002' })
      expect(mock.history[0].body).toEqual({ type: 'weblink', name: 'Link 1' })
    })

    it('maps the Email type and omits the name when not provided', async () => {
      mock.onPost(`${ BASE }/surveys/123/collectors`).reply({ id: '200003' })

      await service.createCollector('123', 'Email')

      expect(mock.history[0].body).toEqual({ type: 'email' })
    })
  })

  describe('getCollectorResponses', () => {
    it('requests the collector responses with a mapped status', async () => {
      mock.onGet(`${ BASE }/collectors/200001/responses`).reply({ data: [] })

      await service.getCollectorResponses('200001', 1, 50, 'Partial')

      expect(mock.history[0].url).toBe(`${ BASE }/collectors/200001/responses`)
      expect(mock.history[0].query).toEqual({ page: 1, per_page: 50, status: 'partial' })
    })
  })

  // ── Pages & Questions ──

  describe('listSurveyPages', () => {
    it('requests the survey pages', async () => {
      mock.onGet(`${ BASE }/surveys/123/pages`).reply({ data: [] })

      await service.listSurveyPages('123', 1, 50)

      expect(mock.history[0].query).toEqual({ page: 1, per_page: 50 })
    })
  })

  describe('getPage', () => {
    it('requests a single page', async () => {
      mock.onGet(`${ BASE }/surveys/123/pages/111`).reply({ id: '111' })

      const result = await service.getPage('123', '111')

      expect(result).toEqual({ id: '111' })
      expect(mock.history[0].url).toBe(`${ BASE }/surveys/123/pages/111`)
    })
  })

  describe('listPageQuestions', () => {
    it('requests the questions of a page', async () => {
      mock.onGet(`${ BASE }/surveys/123/pages/111/questions`).reply({ data: [] })

      await service.listPageQuestions('123', '111', 1, 20)

      expect(mock.history[0].url).toBe(`${ BASE }/surveys/123/pages/111/questions`)
      expect(mock.history[0].query).toEqual({ page: 1, per_page: 20 })
    })
  })

  // ── Account ──

  describe('getMe', () => {
    it('requests the authenticated user', async () => {
      mock.onGet(`${ BASE }/users/me`).reply({ id: '999', username: 'jane.doe' })

      const result = await service.getMe()

      expect(result).toEqual({ id: '999', username: 'jane.doe' })
      expect(mock.history[0].headers).toEqual(AUTH_HEADERS)
    })
  })

  // ── Dictionaries ──

  describe('getSurveysDictionary', () => {
    it('maps surveys to dictionary items and requests page 1 by default', async () => {
      mock.onGet(`${ BASE }/surveys`).reply({
        data: [{ id: '1', title: 'Alpha', response_count: 42 }],
      })

      const result = await service.getSurveysDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Alpha', value: '1', note: '42 responses' }],
        cursor: undefined,
      })

      expect(mock.history[0].query).toEqual({
        page: 1,
        per_page: 50,
        sort_by: 'date_modified',
        sort_order: 'DESC',
      })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/surveys`).reply({ data: [] })

      const result = await service.getSurveysDictionary(null)

      expect(result.items).toEqual([])
      expect(mock.history[0].query.page).toBe(1)
    })

    it('passes the search text as a title filter', async () => {
      mock.onGet(`${ BASE }/surveys`).reply({ data: [] })

      await service.getSurveysDictionary({ search: 'feedback' })

      expect(mock.history[0].query.title).toBe('feedback')
    })

    it('uses the cursor as the page number and returns the next cursor', async () => {
      mock.onGet(`${ BASE }/surveys`).reply({
        data: [{ id: '2', title: 'Beta' }],
        links: { next: 'https://api.surveymonkey.com/v3/surveys?page=4' },
      })

      const result = await service.getSurveysDictionary({ cursor: '3' })

      expect(mock.history[0].query.page).toBe(3)
      expect(result.cursor).toBe('4')
    })

    it('falls back to nickname then id for the label and omits the note without a response count', async () => {
      mock.onGet(`${ BASE }/surveys`).reply({
        data: [
          { id: '1', title: '', nickname: 'Internal name' },
          { id: '2', title: '', nickname: '' },
        ],
      })

      const result = await service.getSurveysDictionary({})

      expect(result.items).toEqual([
        { label: 'Internal name', value: '1', note: undefined },
        { label: '2', value: '2', note: undefined },
      ])
    })

    it('handles a payload without a data array', async () => {
      mock.onGet(`${ BASE }/surveys`).reply({})

      const result = await service.getSurveysDictionary({})

      expect(result).toEqual({ items: [], cursor: undefined })
    })

    it('propagates API errors', async () => {
      mock.onGet(`${ BASE }/surveys`).replyWithError({ message: 'Unauthorized' })

      await expect(service.getSurveysDictionary({})).rejects.toThrow('SurveyMonkey API error: Unauthorized')
    })
  })

  describe('getCollectorsDictionary', () => {
    it('returns an empty list without making a request when no survey id is given', async () => {
      const result = await service.getCollectorsDictionary({})

      expect(result).toEqual({ items: [], cursor: undefined })
      expect(mock.history).toHaveLength(0)
    })

    it('returns an empty list for a null payload', async () => {
      const result = await service.getCollectorsDictionary(null)

      expect(result).toEqual({ items: [], cursor: undefined })
      expect(mock.history).toHaveLength(0)
    })

    it('maps collectors to dictionary items', async () => {
      mock.onGet(`${ BASE }/surveys/123/collectors`).reply({
        data: [
          { id: '200001', name: 'Web Link 1', type: 'weblink' },
          { id: '200002', name: '', type: '' },
        ],
      })

      const result = await service.getCollectorsDictionary({ criteria: { survey_id: '123' } })

      expect(result).toEqual({
        items: [
          { label: 'Web Link 1', value: '200001', note: 'weblink' },
          { label: '200002', value: '200002', note: undefined },
        ],
        cursor: undefined,
      })

      expect(mock.history[0].query).toEqual({ page: 1, per_page: 50 })
    })

    it('passes the search as a name filter and paginates via the cursor', async () => {
      mock.onGet(`${ BASE }/surveys/123/collectors`).reply({
        data: [],
        links: { next: 'https://api.surveymonkey.com/v3/surveys/123/collectors?page=3' },
      })

      const result = await service.getCollectorsDictionary({
        search: 'web',
        cursor: '2',
        criteria: { survey_id: '123' },
      })

      expect(mock.history[0].query).toEqual({ name: 'web', page: 2, per_page: 50 })
      expect(result.cursor).toBe('3')
    })

    it('handles a payload without a data array', async () => {
      mock.onGet(`${ BASE }/surveys/123/collectors`).reply({})

      const result = await service.getCollectorsDictionary({ criteria: { survey_id: '123' } })

      expect(result).toEqual({ items: [], cursor: undefined })
    })

    it('propagates API errors', async () => {
      mock.onGet(`${ BASE }/surveys/123/collectors`).replyWithError({ message: 'Forbidden' })

      await expect(
        service.getCollectorsDictionary({ criteria: { survey_id: '123' } })
      ).rejects.toThrow('SurveyMonkey API error: Forbidden')
    })
  })
})
