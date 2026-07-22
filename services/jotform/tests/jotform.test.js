'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-jotform-api-key'
const BASE = 'https://api.jotform.com'

describe('Jotform Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, dataStoreRegion: 'USA' })
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
      const configItems = sandbox.getConfigItems()

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'apiKey',
            displayName: 'API Key',
            required: true,
            type: 'STRING',
          }),
          expect.objectContaining({
            name: 'dataStoreRegion',
            displayName: 'Data Store Region',
            type: 'CHOICE',
            options: ['USA', 'Europe'],
            defaultValue: 'USA',
          }),
        ])
      )
    })

    it('sends the apiKey as a query parameter on requests', async () => {
      mock.onGet(`${BASE}/user/usage`).reply({ responseCode: 200, content: {} })

      await service.getMonthlyUserUsage()

      expect(mock.history[0].query).toMatchObject({ apiKey: API_KEY })
    })
  })

  // ── getUserFormsDictionary ──

  describe('getUserFormsDictionary', () => {
    const formsResponse = {
      content: [
        { id: '100', title: 'Contact Form', status: 'ENABLED' },
        { id: '101', title: 'Feedback Form', status: 'ENABLED' },
        { id: '102', title: 'Old Form', status: 'DELETED' },
      ],
      resultSet: { offset: 0, limit: 100, count: 3 },
    }

    it('sends correct request and maps forms to dictionary items', async () => {
      mock.onGet(`${BASE}/user/forms`).reply(formsResponse)

      const result = await service.getUserFormsDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE}/user/forms`)
      expect(mock.history[0].query).toMatchObject({ apiKey: API_KEY, limit: 100 })

      expect(result.items).toEqual([
        { label: 'Contact Form', value: '100', note: 'ID: 100' },
        { label: 'Feedback Form', value: '101', note: 'ID: 101' },
      ])
    })

    it('filters out DELETED forms', async () => {
      mock.onGet(`${BASE}/user/forms`).reply(formsResponse)

      const result = await service.getUserFormsDictionary({})

      const ids = result.items.map(item => item.value)

      expect(ids).not.toContain('102')
    })

    it('returns cursor for pagination', async () => {
      mock.onGet(`${BASE}/user/forms`).reply({
        content: [],
        resultSet: { offset: 0, limit: 100, count: 0 },
      })

      const result = await service.getUserFormsDictionary({})

      expect(result.cursor).toBe(100)
    })

    it('passes cursor as offset query param', async () => {
      mock.onGet(`${BASE}/user/forms`).reply({
        content: [],
        resultSet: { offset: 200, limit: 100, count: 0 },
      })

      await service.getUserFormsDictionary({ cursor: 200 })

      expect(mock.history[0].query).toMatchObject({ offset: 200 })
    })

    it('filters forms by search term (case-insensitive)', async () => {
      mock.onGet(`${BASE}/user/forms`).reply(formsResponse)

      const result = await service.getUserFormsDictionary({ search: 'contact' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('100')
    })

    it('searches by form ID as well as title', async () => {
      mock.onGet(`${BASE}/user/forms`).reply(formsResponse)

      const result = await service.getUserFormsDictionary({ search: '101' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('101')
    })

    it('uses [empty] label for forms without a title', async () => {
      mock.onGet(`${BASE}/user/forms`).reply({
        content: [{ id: '200', title: '', status: 'ENABLED' }],
        resultSet: { offset: 0, limit: 100, count: 1 },
      })

      const result = await service.getUserFormsDictionary({})

      expect(result.items[0].label).toBe('[empty]')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/user/forms`).reply({
        content: [],
        resultSet: { offset: 0, limit: 100, count: 0 },
      })

      const result = await service.getUserFormsDictionary(null)

      expect(result.items).toEqual([])
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/user/forms`).replyWithError({ message: 'Unauthorized' })

      await expect(service.getUserFormsDictionary({})).rejects.toThrow()
    })
  })

  // ── createForm ──

  describe('createForm', () => {
    it('sends POST with transformed form data', async () => {
      mock.onPost(`${BASE}/form`).reply({
        responseCode: 200,
        content: { id: '300', title: 'New Form', status: 'ENABLED' },
      })

      const questions = [
        { type: 'control_textbox', text: 'Name', order: 1, name: 'name1' },
      ]

      const result = await service.createForm('New Form', questions)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${BASE}/form`)
      expect(mock.history[0].query).toMatchObject({ apiKey: API_KEY })
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(result).toHaveProperty('content')
      expect(result.content.id).toBe('300')
    })

    it('includes height and emails when provided', async () => {
      mock.onPost(`${BASE}/form`).reply({
        responseCode: 200,
        content: { id: '301' },
      })

      const questions = [
        { type: 'control_textbox', text: 'Name', order: 1, name: 'name1' },
      ]
      const emails = [
        { type: 'notification', name: 'notify', from: 'test@example.com', order: 0 },
      ]

      await service.createForm('Form With Height', questions, '600', emails)

      const body = mock.history[0].body

      expect(body).toContain('properties%5Btitle%5D=Form+With+Height')
      expect(body).toContain('properties%5Bheight%5D=600')
      expect(body).toContain('emails%5B0%5D%5Btype%5D=notification')
    })

    it('includes title in properties body', async () => {
      mock.onPost(`${BASE}/form`).reply({
        responseCode: 200,
        content: { id: '302' },
      })

      const questions = [
        { type: 'control_textbox', text: 'Name', order: 1, name: 'name1' },
      ]

      await service.createForm('Simple Form', questions)

      const body = mock.history[0].body

      expect(body).toContain('properties%5Btitle%5D=Simple+Form')
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/form`).replyWithError({ message: 'Bad Request' })

      await expect(
        service.createForm('Fail', [{ type: 'control_textbox', text: 'Q', order: 1, name: 'q' }])
      ).rejects.toThrow()
    })
  })

  // ── getFormQuestions ──

  describe('getFormQuestions', () => {
    it('sends GET request with form ID in URL', async () => {
      mock.onGet(`${BASE}/form/12345/questions`).reply({
        responseCode: 200,
        content: {
          '1': { qid: '1', type: 'control_textbox', text: 'Name', order: '1', name: 'name1' },
        },
      })

      const result = await service.getFormQuestions('12345')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE}/form/12345/questions`)
      expect(mock.history[0].query).toMatchObject({ apiKey: API_KEY })
      expect(result.content).toHaveProperty('1')
      expect(result.content['1'].type).toBe('control_textbox')
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/form/99999/questions`).replyWithError({ message: 'Not Found' })

      await expect(service.getFormQuestions('99999')).rejects.toThrow()
    })
  })

  // ── addQuestionsToForm ──

  describe('addQuestionsToForm', () => {
    it('sends PUT with JSON content type and grouped questions', async () => {
      mock.onPut(`${BASE}/form/12345/questions`).reply({
        responseCode: 200,
        content: {
          '3': { qid: '3', type: 'control_email', text: 'Email', order: 3, name: 'email3' },
        },
      })

      const questions = [
        { type: 'control_email', text: 'Email', order: 3, name: 'email3' },
      ]

      const result = await service.addQuestionsToForm('12345', questions)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${BASE}/form/12345/questions`)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].query).toMatchObject({ apiKey: API_KEY })
      expect(result.content).toHaveProperty('3')
    })

    it('sends questions grouped by order in the body', async () => {
      mock.onPut(`${BASE}/form/12345/questions`).reply({ responseCode: 200, content: {} })

      const questions = [
        { type: 'control_textbox', text: 'First Name', order: 1, name: 'first1' },
        { type: 'control_textbox', text: 'Last Name', order: 2, name: 'last2' },
      ]

      await service.addQuestionsToForm('12345', questions)

      const body = mock.history[0].body
      const parsed = JSON.parse(body)

      expect(parsed).toHaveProperty('questions')
      expect(parsed.questions).toHaveProperty('1')
      expect(parsed.questions).toHaveProperty('2')
      expect(parsed.questions['1']).toMatchObject({ type: 'control_textbox', text: 'First Name' })
      expect(parsed.questions['2']).toMatchObject({ type: 'control_textbox', text: 'Last Name' })
    })

    it('throws on API error', async () => {
      mock.onPut(`${BASE}/form/99999/questions`).replyWithError({ message: 'Form not found' })

      await expect(
        service.addQuestionsToForm('99999', [{ type: 'control_textbox', text: 'Q', order: 1, name: 'q' }])
      ).rejects.toThrow()
    })
  })

  // ── getFormSubmissions ──

  describe('getFormSubmissions', () => {
    it('sends GET with form ID and default query', async () => {
      mock.onGet(`${BASE}/form/12345/submissions`).reply({
        responseCode: 200,
        content: [],
        resultSet: { offset: 0, limit: 20, count: 0 },
      })

      const result = await service.getFormSubmissions('12345')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE}/form/12345/submissions`)
      expect(mock.history[0].query).toMatchObject({ apiKey: API_KEY })
      expect(result.content).toEqual([])
    })

    it('passes offset, limit, filters and orderBy as query params', async () => {
      mock.onGet(`${BASE}/form/12345/submissions`).reply({
        responseCode: 200,
        content: [],
        resultSet: { offset: 10, limit: 5, count: 0 },
      })

      await service.getFormSubmissions('12345', 10, 5, '{"status":"ACTIVE"}', 'created_at')

      expect(mock.history[0].query).toMatchObject({
        offset: 10,
        limit: 5,
        filter: '{"status":"ACTIVE"}',
        orderby: 'created_at',
      })
    })

    it('returns submission data with correct shape', async () => {
      const submission = {
        id: 'sub-1',
        form_id: '12345',
        status: 'ACTIVE',
        created_at: '2025-01-01',
        answers: {},
      }

      mock.onGet(`${BASE}/form/12345/submissions`).reply({
        responseCode: 200,
        content: [submission],
        resultSet: { offset: 0, limit: 20, count: 1 },
      })

      const result = await service.getFormSubmissions('12345')

      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toMatchObject({ id: 'sub-1', form_id: '12345' })
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/form/99999/submissions`).replyWithError({ message: 'Not Found' })

      await expect(service.getFormSubmissions('99999')).rejects.toThrow()
    })
  })

  // ── getUserSubmissions ──

  describe('getUserSubmissions', () => {
    it('sends GET to user submissions endpoint', async () => {
      mock.onGet(`${BASE}/user/submissions`).reply({
        responseCode: 200,
        content: [],
        resultSet: { offset: 0, limit: 20, count: 0 },
      })

      const result = await service.getUserSubmissions()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE}/user/submissions`)
      expect(mock.history[0].query).toMatchObject({ apiKey: API_KEY })
      expect(result.content).toEqual([])
    })

    it('passes all query parameters when provided', async () => {
      mock.onGet(`${BASE}/user/submissions`).reply({
        responseCode: 200,
        content: [],
        resultSet: { offset: 5, limit: 10, count: 0 },
      })

      await service.getUserSubmissions(5, 10, '{"new":"1"}', 'updated_at')

      expect(mock.history[0].query).toMatchObject({
        offset: 5,
        limit: 10,
        filter: '{"new":"1"}',
        orderby: 'updated_at',
      })
    })

    it('omits undefined optional params from query', async () => {
      mock.onGet(`${BASE}/user/submissions`).reply({
        responseCode: 200,
        content: [],
        resultSet: { offset: 0, limit: 20, count: 0 },
      })

      await service.getUserSubmissions()

      expect(mock.history[0].query).not.toHaveProperty('offset')
      expect(mock.history[0].query).not.toHaveProperty('limit')
      expect(mock.history[0].query).not.toHaveProperty('filter')
      expect(mock.history[0].query).not.toHaveProperty('orderby')
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/user/submissions`).replyWithError({ message: 'Unauthorized' })

      await expect(service.getUserSubmissions()).rejects.toThrow()
    })
  })

  // ── getMonthlyUserUsage ──

  describe('getMonthlyUserUsage', () => {
    it('sends GET to user usage endpoint and returns data', async () => {
      mock.onGet(`${BASE}/user/usage`).reply({
        responseCode: 200,
        content: {
          username: 'testuser',
          submissions: '7',
          form_count: '3',
        },
      })

      const result = await service.getMonthlyUserUsage()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE}/user/usage`)
      expect(mock.history[0].query).toMatchObject({ apiKey: API_KEY })
      expect(result.content).toMatchObject({
        username: 'testuser',
        submissions: '7',
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/user/usage`).replyWithError({ message: 'Server Error' })

      await expect(service.getMonthlyUserUsage()).rejects.toThrow()
    })
  })
})
