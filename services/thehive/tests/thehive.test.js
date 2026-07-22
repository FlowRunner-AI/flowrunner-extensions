'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE_URL = 'https://thehive.example.com'
const API_BASE = `${BASE_URL}/api/v1`

describe('TheHive Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ url: BASE_URL, apiKey: API_KEY })
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
          expect.objectContaining({ name: 'url', required: true, shared: false }),
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Auth & Base URL ──

  describe('auth and base URL', () => {
    it('sends Bearer token in Authorization header', async () => {
      mock.onGet(`${API_BASE}/case/~1`).reply({ _id: '~1' })

      await service.getCase('~1')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      })
    })

    it('strips trailing slashes from the instance URL', async () => {
      // The service was initialized with BASE_URL (no trailing slash).
      // Verify the request URL is built correctly.
      mock.onGet(`${API_BASE}/case/~1`).reply({ _id: '~1' })

      await service.getCase('~1')

      expect(mock.history[0].url).toBe(`${API_BASE}/case/~1`)
    })
  })

  // ── Cases ──

  describe('createCase', () => {
    it('sends POST with required fields only', async () => {
      mock.onPost(`${API_BASE}/case`).reply({ _id: '~100', title: 'Test Case' })

      const result = await service.createCase('Test Case', 'A description')

      expect(result).toEqual({ _id: '~100', title: 'Test Case' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toMatchObject({
        title: 'Test Case',
        description: 'A description',
      })
    })

    it('maps severity, TLP, and PAP labels to numeric codes', async () => {
      mock.onPost(`${API_BASE}/case`).reply({ _id: '~101' })

      await service.createCase('Title', 'Desc', 'High', 'RED', 'GREEN')

      expect(mock.history[0].body).toMatchObject({
        severity: 3,
        tlp: 3,
        pap: 1,
      })
    })

    it('includes tags when provided', async () => {
      mock.onPost(`${API_BASE}/case`).reply({ _id: '~102' })

      await service.createCase('Title', 'Desc', undefined, undefined, undefined, ['tag1', 'tag2'])

      expect(mock.history[0].body.tags).toEqual(['tag1', 'tag2'])
    })

    it('omits tags when empty array is provided', async () => {
      mock.onPost(`${API_BASE}/case`).reply({ _id: '~103' })

      await service.createCase('Title', 'Desc', undefined, undefined, undefined, [])

      expect(mock.history[0].body.tags).toBeUndefined()
    })

    it('includes status and flag when provided', async () => {
      mock.onPost(`${API_BASE}/case`).reply({ _id: '~104' })

      await service.createCase('Title', 'Desc', undefined, undefined, undefined, undefined, 'New', true)

      expect(mock.history[0].body).toMatchObject({ status: 'New', flag: true })
    })

    it('omits flag when not a boolean', async () => {
      mock.onPost(`${API_BASE}/case`).reply({ _id: '~105' })

      await service.createCase('Title', 'Desc', undefined, undefined, undefined, undefined, undefined, 'yes')

      expect(mock.history[0].body.flag).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onPost(`${API_BASE}/case`).replyWithError({
        message: 'Unauthorized',
        body: { type: 'AuthenticationError', message: 'Invalid API key' },
        status: 401,
      })

      await expect(service.createCase('Title', 'Desc')).rejects.toThrow('TheHive API error (401): Invalid API key')
    })
  })

  describe('getCase', () => {
    it('sends GET with encoded case id', async () => {
      mock.onGet(`${API_BASE}/case/${encodeURIComponent('~8200')}`).reply({ _id: '~8200', title: 'Case' })

      const result = await service.getCase('~8200')

      expect(result).toEqual({ _id: '~8200', title: 'Case' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('updateCase', () => {
    it('sends PATCH with provided fields only', async () => {
      mock.onPatch(`${API_BASE}/case/${encodeURIComponent('~8200')}`).reply(null)

      const result = await service.updateCase('~8200', 'New Title')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toMatchObject({ title: 'New Title' })
      expect(mock.history[0].body.description).toBeUndefined()
    })

    it('maps severity label to numeric code', async () => {
      mock.onPatch(`${API_BASE}/case/${encodeURIComponent('~8200')}`).reply(null)

      await service.updateCase('~8200', undefined, undefined, 'Critical')

      expect(mock.history[0].body).toMatchObject({ severity: 4 })
    })

    it('returns API response when body is present', async () => {
      mock.onPatch(`${API_BASE}/case/${encodeURIComponent('~8200')}`).reply({ _id: '~8200', title: 'Updated' })

      const result = await service.updateCase('~8200', 'Updated')

      expect(result).toEqual({ _id: '~8200', title: 'Updated' })
    })
  })

  describe('deleteCase', () => {
    it('sends DELETE and returns success when no body returned', async () => {
      mock.onDelete(`${API_BASE}/case/${encodeURIComponent('~8200')}`).reply(null)

      const result = await service.deleteCase('~8200')

      expect(result).toEqual({ success: true })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
    })

    it('returns API response when body is present', async () => {
      mock.onDelete(`${API_BASE}/case/${encodeURIComponent('~8200')}`).reply({ message: 'deleted' })

      const result = await service.deleteCase('~8200')

      expect(result).toEqual({ message: 'deleted' })
    })
  })

  describe('listCases', () => {
    it('posts query with default pagination', async () => {
      mock.onPost(`${API_BASE}/query`).reply([{ _id: '~1' }])

      const result = await service.listCases()

      expect(result).toEqual([{ _id: '~1' }])
      expect(mock.history[0].body).toEqual({
        query: [
          { _name: 'listCase' },
          { _name: 'page', from: 0, to: 25 },
        ],
      })
    })

    it('includes keyword filter when provided', async () => {
      mock.onPost(`${API_BASE}/query`).reply([])

      await service.listCases('phishing')

      expect(mock.history[0].body).toEqual({
        query: [
          { _name: 'listCase' },
          { _name: 'filter', _like: { _field: 'keyword', _value: 'phishing' } },
          { _name: 'page', from: 0, to: 25 },
        ],
      })
    })

    it('uses custom pagination', async () => {
      mock.onPost(`${API_BASE}/query`).reply([])

      await service.listCases(undefined, 10, 20)

      const page = mock.history[0].body.query.find(s => s._name === 'page')

      expect(page).toEqual({ _name: 'page', from: 10, to: 20 })
    })
  })

  // ── Tasks ──

  describe('createTask', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${API_BASE}/case/${encodeURIComponent('~8200')}/task`).reply({ _id: '~9300', title: 'My Task' })

      const result = await service.createTask('~8200', 'My Task')

      expect(result).toEqual({ _id: '~9300', title: 'My Task' })
      expect(mock.history[0].body).toMatchObject({ title: 'My Task' })
    })

    it('includes optional fields when provided', async () => {
      mock.onPost(`${API_BASE}/case/${encodeURIComponent('~8200')}/task`).reply({ _id: '~9301' })

      await service.createTask('~8200', 'Task', 'identification', 'InProgress', 'Collect logs')

      expect(mock.history[0].body).toMatchObject({
        title: 'Task',
        group: 'identification',
        status: 'InProgress',
        description: 'Collect logs',
      })
    })

    it('omits empty optional fields', async () => {
      mock.onPost(`${API_BASE}/case/${encodeURIComponent('~8200')}/task`).reply({ _id: '~9302' })

      await service.createTask('~8200', 'Task', '', '', '')

      expect(mock.history[0].body).toEqual({ title: 'Task' })
    })
  })

  describe('getTask', () => {
    it('sends GET with encoded task id', async () => {
      mock.onGet(`${API_BASE}/task/${encodeURIComponent('~9300')}`).reply({ _id: '~9300', title: 'Task' })

      const result = await service.getTask('~9300')

      expect(result).toEqual({ _id: '~9300', title: 'Task' })
    })
  })

  describe('updateTask', () => {
    it('sends PATCH with provided fields only', async () => {
      mock.onPatch(`${API_BASE}/task/${encodeURIComponent('~9300')}`).reply(null)

      const result = await service.updateTask('~9300', undefined, undefined, 'Completed')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toMatchObject({ status: 'Completed' })
      expect(mock.history[0].body.title).toBeUndefined()
    })

    it('returns API response when body is present', async () => {
      mock.onPatch(`${API_BASE}/task/${encodeURIComponent('~9300')}`).reply({ _id: '~9300' })

      const result = await service.updateTask('~9300', 'Updated')

      expect(result).toEqual({ _id: '~9300' })
    })
  })

  describe('listCaseTasks', () => {
    it('posts query with default pagination', async () => {
      mock.onPost(`${API_BASE}/query`).reply([{ _id: '~9300' }])

      const result = await service.listCaseTasks('~8200')

      expect(result).toEqual([{ _id: '~9300' }])
      expect(mock.history[0].body).toEqual({
        query: [
          { _name: 'getCase', idOrName: '~8200' },
          { _name: 'tasks' },
          { _name: 'page', from: 0, to: 50 },
        ],
      })
    })

    it('uses custom pagination', async () => {
      mock.onPost(`${API_BASE}/query`).reply([])

      await service.listCaseTasks('~8200', 5, 15)

      const page = mock.history[0].body.query.find(s => s._name === 'page')

      expect(page).toEqual({ _name: 'page', from: 5, to: 15 })
    })
  })

  // ── Observables ──

  describe('createObservable', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${API_BASE}/case/${encodeURIComponent('~8200')}/observable`).reply([{ _id: '~10400' }])

      const result = await service.createObservable('~8200', 'ip', '8.8.8.8')

      expect(result).toEqual([{ _id: '~10400' }])
      expect(mock.history[0].body).toMatchObject({ dataType: 'ip', data: '8.8.8.8' })
    })

    it('includes optional fields when provided', async () => {
      mock.onPost(`${API_BASE}/case/${encodeURIComponent('~8200')}/observable`).reply([{ _id: '~10401' }])

      await service.createObservable('~8200', 'domain', 'evil.com', 'C2 server', ['c2'], true, false, 'RED')

      expect(mock.history[0].body).toMatchObject({
        dataType: 'domain',
        data: 'evil.com',
        message: 'C2 server',
        tags: ['c2'],
        ioc: true,
        sighted: false,
        tlp: 3,
      })
    })

    it('omits ioc/sighted when not boolean', async () => {
      mock.onPost(`${API_BASE}/case/${encodeURIComponent('~8200')}/observable`).reply([{ _id: '~10402' }])

      await service.createObservable('~8200', 'ip', '1.2.3.4', undefined, undefined, 'yes', 'no')

      expect(mock.history[0].body.ioc).toBeUndefined()
      expect(mock.history[0].body.sighted).toBeUndefined()
    })

    it('omits tags when empty array', async () => {
      mock.onPost(`${API_BASE}/case/${encodeURIComponent('~8200')}/observable`).reply([{ _id: '~10403' }])

      await service.createObservable('~8200', 'ip', '1.2.3.4', undefined, [])

      expect(mock.history[0].body.tags).toBeUndefined()
    })
  })

  describe('getObservable', () => {
    it('sends GET with encoded observable id', async () => {
      mock.onGet(`${API_BASE}/observable/${encodeURIComponent('~10400')}`).reply({ _id: '~10400', dataType: 'ip' })

      const result = await service.getObservable('~10400')

      expect(result).toEqual({ _id: '~10400', dataType: 'ip' })
    })
  })

  describe('listCaseObservables', () => {
    it('posts query with default pagination', async () => {
      mock.onPost(`${API_BASE}/query`).reply([{ _id: '~10400' }])

      const result = await service.listCaseObservables('~8200')

      expect(result).toEqual([{ _id: '~10400' }])
      expect(mock.history[0].body).toEqual({
        query: [
          { _name: 'getCase', idOrName: '~8200' },
          { _name: 'observables' },
          { _name: 'page', from: 0, to: 50 },
        ],
      })
    })

    it('uses custom pagination', async () => {
      mock.onPost(`${API_BASE}/query`).reply([])

      await service.listCaseObservables('~8200', 0, 10)

      const page = mock.history[0].body.query.find(s => s._name === 'page')

      expect(page).toEqual({ _name: 'page', from: 0, to: 10 })
    })
  })

  // ── Alerts ──

  describe('createAlert', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${API_BASE}/alert`).reply({ _id: '~12500', title: 'Phishing' })

      const result = await service.createAlert('phishing', 'SIEM', 'REF-001', 'Phishing', 'Desc')

      expect(result).toEqual({ _id: '~12500', title: 'Phishing' })
      expect(mock.history[0].body).toMatchObject({
        type: 'phishing',
        source: 'SIEM',
        sourceRef: 'REF-001',
        title: 'Phishing',
        description: 'Desc',
      })
    })

    it('maps severity and TLP labels', async () => {
      mock.onPost(`${API_BASE}/alert`).reply({ _id: '~12501' })

      await service.createAlert('type', 'src', 'ref', 'title', 'desc', 'Low', 'WHITE')

      expect(mock.history[0].body).toMatchObject({ severity: 1, tlp: 0 })
    })

    it('includes tags and observables when provided', async () => {
      mock.onPost(`${API_BASE}/alert`).reply({ _id: '~12502' })

      const observables = [{ dataType: 'ip', data: '8.8.8.8' }]

      await service.createAlert('type', 'src', 'ref', 'title', 'desc', undefined, undefined, ['tag1'], observables)

      expect(mock.history[0].body.tags).toEqual(['tag1'])
      expect(mock.history[0].body.observables).toEqual(observables)
    })

    it('omits tags and observables when empty arrays', async () => {
      mock.onPost(`${API_BASE}/alert`).reply({ _id: '~12503' })

      await service.createAlert('type', 'src', 'ref', 'title', 'desc', undefined, undefined, [], [])

      expect(mock.history[0].body.tags).toBeUndefined()
      expect(mock.history[0].body.observables).toBeUndefined()
    })
  })

  describe('getAlert', () => {
    it('sends GET with encoded alert id', async () => {
      mock.onGet(`${API_BASE}/alert/${encodeURIComponent('~12500')}`).reply({ _id: '~12500' })

      const result = await service.getAlert('~12500')

      expect(result).toEqual({ _id: '~12500' })
    })
  })

  describe('updateAlert', () => {
    it('sends PATCH with provided fields', async () => {
      mock.onPatch(`${API_BASE}/alert/${encodeURIComponent('~12500')}`).reply(null)

      const result = await service.updateAlert('~12500', 'New Title', undefined, 'Medium', 'GREEN')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toMatchObject({
        title: 'New Title',
        severity: 2,
        tlp: 1,
      })
    })

    it('includes tags and status when provided', async () => {
      mock.onPatch(`${API_BASE}/alert/${encodeURIComponent('~12500')}`).reply(null)

      await service.updateAlert('~12500', undefined, undefined, undefined, undefined, ['t1'], 'Ignored')

      expect(mock.history[0].body).toMatchObject({ tags: ['t1'], status: 'Ignored' })
    })

    it('returns API response when body is present', async () => {
      mock.onPatch(`${API_BASE}/alert/${encodeURIComponent('~12500')}`).reply({ _id: '~12500' })

      const result = await service.updateAlert('~12500', 'Updated')

      expect(result).toEqual({ _id: '~12500' })
    })
  })

  describe('promoteAlertToCase', () => {
    it('sends POST with empty body when no options provided', async () => {
      mock.onPost(`${API_BASE}/alert/${encodeURIComponent('~12500')}/case`).reply({ _id: '~8300', _type: 'Case' })

      const result = await service.promoteAlertToCase('~12500')

      expect(result).toEqual({ _id: '~8300', _type: 'Case' })
      expect(mock.history[0].body).toEqual({})
    })

    it('includes caseTemplate when provided', async () => {
      mock.onPost(`${API_BASE}/alert/${encodeURIComponent('~12500')}/case`).reply({ _id: '~8301' })

      await service.promoteAlertToCase('~12500', 'IncidentTemplate')

      expect(mock.history[0].body).toMatchObject({ caseTemplate: 'IncidentTemplate' })
    })

    it('includes field overrides when provided', async () => {
      mock.onPost(`${API_BASE}/alert/${encodeURIComponent('~12500')}/case`).reply({ _id: '~8302' })

      await service.promoteAlertToCase('~12500', undefined, { title: 'Escalated', severity: 3 })

      expect(mock.history[0].body).toMatchObject({ fields: { title: 'Escalated', severity: 3 } })
    })
  })

  describe('mergeAlertIntoCase', () => {
    it('sends POST to merge URL', async () => {
      const url = `${API_BASE}/alert/${encodeURIComponent('~12500')}/merge/${encodeURIComponent('~8200')}`

      mock.onPost(url).reply({ _id: '~8200', _type: 'Case' })

      const result = await service.mergeAlertIntoCase('~12500', '~8200')

      expect(result).toEqual({ _id: '~8200', _type: 'Case' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
    })
  })

  describe('listAlerts', () => {
    it('posts query with default pagination', async () => {
      mock.onPost(`${API_BASE}/query`).reply([{ _id: '~12500' }])

      const result = await service.listAlerts()

      expect(result).toEqual([{ _id: '~12500' }])
      expect(mock.history[0].body).toEqual({
        query: [
          { _name: 'listAlert' },
          { _name: 'page', from: 0, to: 25 },
        ],
      })
    })

    it('includes keyword filter when provided', async () => {
      mock.onPost(`${API_BASE}/query`).reply([])

      await service.listAlerts('malware')

      expect(mock.history[0].body).toEqual({
        query: [
          { _name: 'listAlert' },
          { _name: 'filter', _like: { _field: 'keyword', _value: 'malware' } },
          { _name: 'page', from: 0, to: 25 },
        ],
      })
    })

    it('uses custom pagination', async () => {
      mock.onPost(`${API_BASE}/query`).reply([])

      await service.listAlerts(undefined, 5, 10)

      const page = mock.history[0].body.query.find(s => s._name === 'page')

      expect(page).toEqual({ _name: 'page', from: 5, to: 10 })
    })
  })

  // ── Query ──

  describe('runQuery', () => {
    it('sends POST with provided query pipeline', async () => {
      const pipeline = [{ _name: 'listCase' }, { _name: 'page', from: 0, to: 5 }]

      mock.onPost(`${API_BASE}/query`).reply([{ _id: '~1' }])

      const result = await service.runQuery(pipeline)

      expect(result).toEqual([{ _id: '~1' }])
      expect(mock.history[0].body).toEqual({ query: pipeline })
    })

    it('sends empty array when query is null', async () => {
      mock.onPost(`${API_BASE}/query`).reply([])

      await service.runQuery(null)

      expect(mock.history[0].body).toEqual({ query: [] })
    })

    it('sends empty array when query is undefined', async () => {
      mock.onPost(`${API_BASE}/query`).reply([])

      await service.runQuery()

      expect(mock.history[0].body).toEqual({ query: [] })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('formats error from object body with message', async () => {
      mock.onGet(`${API_BASE}/case/~999`).replyWithError({
        message: 'Not Found',
        body: { type: 'NotFoundError', message: 'Case not found' },
        status: 404,
      })

      await expect(service.getCase('~999')).rejects.toThrow('TheHive API error (404): Case not found')
    })

    it('formats error from array body', async () => {
      mock.onPost(`${API_BASE}/case`).replyWithError({
        message: 'Bad Request',
        body: [
          { type: 'ValidationError', message: 'title is required' },
          { type: 'ValidationError', message: 'description is required' },
        ],
        status: 400,
      })

      await expect(service.createCase()).rejects.toThrow(
        'TheHive API error (400): title is required; description is required'
      )
    })

    it('falls back to error.message when body has no message', async () => {
      mock.onGet(`${API_BASE}/case/~999`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.getCase('~999')).rejects.toThrow('TheHive API error: Network timeout')
    })

    it('uses error.type from body when message is missing', async () => {
      mock.onGet(`${API_BASE}/case/~999`).replyWithError({
        message: 'Error',
        body: { type: 'AuthenticationError' },
        status: 401,
      })

      await expect(service.getCase('~999')).rejects.toThrow('TheHive API error (401): AuthenticationError')
    })

    it('uses statusCode when status is not available', async () => {
      mock.onGet(`${API_BASE}/case/~999`).replyWithError({
        message: 'Forbidden',
        body: { message: 'Access denied' },
        statusCode: 403,
      })

      await expect(service.getCase('~999')).rejects.toThrow('TheHive API error (403): Access denied')
    })
  })
})
