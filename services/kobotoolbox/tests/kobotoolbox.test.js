'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-kobo-api-token'
const BASE_URL = 'https://kf.kobotoolbox.org'
const API_BASE = `${BASE_URL}/api/v2`

describe('KoBoToolbox Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ baseUrl: BASE_URL, apiToken: API_TOKEN })
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
            name: 'baseUrl',
            displayName: 'Server URL',
            type: 'STRING',
            required: true,
            shared: false,
            defaultValue: 'https://kf.kobotoolbox.org',
          }),
          expect.objectContaining({
            name: 'apiToken',
            displayName: 'API Token',
            type: 'STRING',
            required: true,
            shared: false,
          }),
        ])
      )
    })

    it('sends Authorization header with Token prefix on requests', async () => {
      mock.onGet(`${API_BASE}/assets/`).reply({ count: 0, results: [] })

      await service.listAssets()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Token ${API_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      })
    })

    it('sends format=json query param on all requests', async () => {
      mock.onGet(`${API_BASE}/assets/`).reply({ count: 0, results: [] })

      await service.listAssets()

      expect(mock.history[0].query).toMatchObject({ format: 'json' })
    })
  })

  // ── listAssets ──

  describe('listAssets', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${API_BASE}/assets/`).reply({ count: 0, next: null, results: [] })

      const result = await service.listAssets()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${API_BASE}/assets/`)
      expect(mock.history[0].query).toMatchObject({ limit: 30 })
      expect(result).toEqual({ count: 0, next: null, results: [] })
    })

    it('passes search, limit, and start parameters', async () => {
      mock.onGet(`${API_BASE}/assets/`).reply({ count: 1, results: [{ uid: 'a1' }] })

      await service.listAssets('household', 10, 20)

      expect(mock.history[0].query).toMatchObject({
        q: 'household',
        limit: 10,
        start: 20,
      })
    })

    it('omits q and start when not provided', async () => {
      mock.onGet(`${API_BASE}/assets/`).reply({ count: 0, results: [] })

      await service.listAssets()

      expect(mock.history[0].query).not.toHaveProperty('q')
      expect(mock.history[0].query).not.toHaveProperty('start')
    })

    it('throws on API error', async () => {
      mock.onGet(`${API_BASE}/assets/`).replyWithError({ message: 'Unauthorized' })

      await expect(service.listAssets()).rejects.toThrow('KoBoToolbox API error')
    })
  })

  // ── getAsset ──

  describe('getAsset', () => {
    it('sends GET request with uid in URL', async () => {
      const asset = { uid: 'aXaMpLe123', name: 'Test Survey', asset_type: 'survey' }

      mock.onGet(`${API_BASE}/assets/aXaMpLe123/`).reply(asset)

      const result = await service.getAsset('aXaMpLe123')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${API_BASE}/assets/aXaMpLe123/`)
      expect(result).toEqual(asset)
    })

    it('throws on API error', async () => {
      mock.onGet(`${API_BASE}/assets/bad-uid/`).replyWithError({ message: 'Not found' })

      await expect(service.getAsset('bad-uid')).rejects.toThrow('KoBoToolbox API error')
    })
  })

  // ── getAssetContent ──

  describe('getAssetContent', () => {
    it('sends GET request for asset content', async () => {
      const content = {
        uid: 'aXaMpLe123',
        name: 'Test Survey',
        content: { survey: [{ type: 'text', name: 'full_name' }] },
      }

      mock.onGet(`${API_BASE}/assets/aXaMpLe123/`).reply(content)

      const result = await service.getAssetContent('aXaMpLe123')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(result).toEqual(content)
    })
  })

  // ── createAsset ──

  describe('createAsset', () => {
    it('sends POST with name and default asset type', async () => {
      mock.onPost(`${API_BASE}/assets/`).reply({ uid: 'new123', name: 'New Survey', asset_type: 'survey' })

      const result = await service.createAsset('New Survey')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${API_BASE}/assets/`)
      expect(mock.history[0].body).toEqual({ name: 'New Survey', asset_type: 'survey' })
      expect(result.uid).toBe('new123')
    })

    it('resolves asset type from dropdown value', async () => {
      mock.onPost(`${API_BASE}/assets/`).reply({ uid: 'tmpl1', asset_type: 'template' })

      await service.createAsset('My Template', 'Template')

      expect(mock.history[0].body).toMatchObject({ asset_type: 'template' })
    })

    it('passes through unknown asset type as-is', async () => {
      mock.onPost(`${API_BASE}/assets/`).reply({ uid: 'x1', asset_type: 'custom' })

      await service.createAsset('Custom Asset', 'custom')

      expect(mock.history[0].body).toMatchObject({ asset_type: 'custom' })
    })

    it('includes content when provided', async () => {
      const surveyContent = { survey: [{ type: 'text', name: 'q1', label: ['Question 1'] }] }

      mock.onPost(`${API_BASE}/assets/`).reply({ uid: 'c1', name: 'With Content' })

      await service.createAsset('With Content', 'Survey', surveyContent)

      expect(mock.history[0].body).toMatchObject({
        name: 'With Content',
        asset_type: 'survey',
        content: surveyContent,
      })
    })

    it('omits content when not provided', async () => {
      mock.onPost(`${API_BASE}/assets/`).reply({ uid: 'nc1', name: 'No Content' })

      await service.createAsset('No Content')

      expect(mock.history[0].body).not.toHaveProperty('content')
    })

    it('throws on API error', async () => {
      mock.onPost(`${API_BASE}/assets/`).replyWithError({ message: 'Bad Request' })

      await expect(service.createAsset('Fail')).rejects.toThrow('KoBoToolbox API error')
    })
  })

  // ── deployAsset ──

  describe('deployAsset', () => {
    it('sends POST with active:true body', async () => {
      mock.onPost(`${API_BASE}/assets/aXaMpLe123/deployment/`).reply({ backend: 'mock', active: true })

      const result = await service.deployAsset('aXaMpLe123')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${API_BASE}/assets/aXaMpLe123/deployment/`)
      expect(mock.history[0].body).toEqual({ active: true })
      expect(result).toMatchObject({ active: true })
    })

    it('throws on API error', async () => {
      mock.onPost(`${API_BASE}/assets/bad/deployment/`).replyWithError({ message: 'Not found' })

      await expect(service.deployAsset('bad')).rejects.toThrow('KoBoToolbox API error')
    })
  })

  // ── redeployAsset ──

  describe('redeployAsset', () => {
    it('sends PATCH with active:true body', async () => {
      mock.onPatch(`${API_BASE}/assets/aXaMpLe123/deployment/`).reply({ backend: 'mock', active: true, version_id: 'v2' })

      const result = await service.redeployAsset('aXaMpLe123')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${API_BASE}/assets/aXaMpLe123/deployment/`)
      expect(mock.history[0].body).toEqual({ active: true })
      expect(result).toMatchObject({ active: true })
    })

    it('throws on API error', async () => {
      mock.onPatch(`${API_BASE}/assets/bad/deployment/`).replyWithError({ message: 'Not deployed' })

      await expect(service.redeployAsset('bad')).rejects.toThrow('KoBoToolbox API error')
    })
  })

  // ── getDeployment ──

  describe('getDeployment', () => {
    it('sends GET request for deployment', async () => {
      const deployment = { backend: 'mock', active: true, version_id: 'vAbC123' }

      mock.onGet(`${API_BASE}/assets/aXaMpLe123/deployment/`).reply(deployment)

      const result = await service.getDeployment('aXaMpLe123')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${API_BASE}/assets/aXaMpLe123/deployment/`)
      expect(result).toEqual(deployment)
    })

    it('throws on API error', async () => {
      mock.onGet(`${API_BASE}/assets/bad/deployment/`).replyWithError({ message: 'Not deployed' })

      await expect(service.getDeployment('bad')).rejects.toThrow('KoBoToolbox API error')
    })
  })

  // ── getSubmissions ──

  describe('getSubmissions', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${API_BASE}/assets/aXaMpLe123/data/`).reply({ count: 0, results: [] })

      const result = await service.getSubmissions('aXaMpLe123')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${API_BASE}/assets/aXaMpLe123/data/`)
      expect(mock.history[0].query).toMatchObject({ limit: 30 })
      expect(result).toEqual({ count: 0, results: [] })
    })

    it('passes query, sort, limit, and start parameters', async () => {
      mock.onGet(`${API_BASE}/assets/aXaMpLe123/data/`).reply({ count: 1, results: [{ _id: 1 }] })

      const query = { gender: 'female' }
      const sort = { _submission_time: -1 }

      await service.getSubmissions('aXaMpLe123', query, sort, 10, 5)

      expect(mock.history[0].query).toMatchObject({
        query: JSON.stringify(query),
        sort: JSON.stringify(sort),
        limit: 10,
        start: 5,
      })
    })

    it('omits query and sort when not provided', async () => {
      mock.onGet(`${API_BASE}/assets/aXaMpLe123/data/`).reply({ count: 0, results: [] })

      await service.getSubmissions('aXaMpLe123')

      expect(mock.history[0].query).not.toHaveProperty('query')
      expect(mock.history[0].query).not.toHaveProperty('sort')
    })

    it('throws on API error', async () => {
      mock.onGet(`${API_BASE}/assets/bad/data/`).replyWithError({ message: 'Not found' })

      await expect(service.getSubmissions('bad')).rejects.toThrow('KoBoToolbox API error')
    })
  })

  // ── getSubmission ──

  describe('getSubmission', () => {
    it('sends GET request with uid and submission ID in URL', async () => {
      const submission = { _id: 501, _uuid: 'a1b2c3', full_name: 'Jane' }

      mock.onGet(`${API_BASE}/assets/aXaMpLe123/data/501/`).reply(submission)

      const result = await service.getSubmission('aXaMpLe123', '501')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${API_BASE}/assets/aXaMpLe123/data/501/`)
      expect(result).toEqual(submission)
    })

    it('throws on API error', async () => {
      mock.onGet(`${API_BASE}/assets/aXaMpLe123/data/999/`).replyWithError({ message: 'Not found' })

      await expect(service.getSubmission('aXaMpLe123', '999')).rejects.toThrow('KoBoToolbox API error')
    })
  })

  // ── getSubmissionCount ──

  describe('getSubmissionCount', () => {
    it('extracts count from response envelope', async () => {
      mock.onGet(`${API_BASE}/assets/aXaMpLe123/data/`).reply({ count: 128, results: [{ _id: 1 }] })

      const result = await service.getSubmissionCount('aXaMpLe123')

      expect(mock.history[0].query).toMatchObject({ limit: 1 })
      expect(result).toEqual({ count: 128 })
    })

    it('falls back to array length when count is not a number', async () => {
      mock.onGet(`${API_BASE}/assets/aXaMpLe123/data/`).reply([{ _id: 1 }, { _id: 2 }])

      const result = await service.getSubmissionCount('aXaMpLe123')

      expect(result).toEqual({ count: 2 })
    })

    it('returns 0 when response is null-ish', async () => {
      mock.onGet(`${API_BASE}/assets/aXaMpLe123/data/`).reply(null)

      const result = await service.getSubmissionCount('aXaMpLe123')

      expect(result).toEqual({ count: 0 })
    })

    it('throws on API error', async () => {
      mock.onGet(`${API_BASE}/assets/bad/data/`).replyWithError({ message: 'Not found' })

      await expect(service.getSubmissionCount('bad')).rejects.toThrow('KoBoToolbox API error')
    })
  })

  // ── deleteSubmission ──

  describe('deleteSubmission', () => {
    it('sends DELETE request and returns confirmation object', async () => {
      mock.onDelete(`${API_BASE}/assets/aXaMpLe123/data/501/`).reply(undefined)

      const result = await service.deleteSubmission('aXaMpLe123', '501')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${API_BASE}/assets/aXaMpLe123/data/501/`)
      expect(result).toEqual({ deleted: true, uid: 'aXaMpLe123', submissionId: '501' })
    })

    it('throws on API error', async () => {
      mock.onDelete(`${API_BASE}/assets/bad/data/999/`).replyWithError({ message: 'Not found' })

      await expect(service.deleteSubmission('bad', '999')).rejects.toThrow('KoBoToolbox API error')
    })
  })

  // ── createExport ──

  describe('createExport', () => {
    it('sends POST with default CSV format', async () => {
      mock.onPost(`${API_BASE}/assets/aXaMpLe123/exports/`).reply({ uid: 'exp1', status: 'created', type: 'csv' })

      const result = await service.createExport('aXaMpLe123')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${API_BASE}/assets/aXaMpLe123/exports/`)
      expect(mock.history[0].body).toEqual({ type: 'csv' })
      expect(result.uid).toBe('exp1')
    })

    it('resolves XLS format from dropdown value', async () => {
      mock.onPost(`${API_BASE}/assets/aXaMpLe123/exports/`).reply({ uid: 'exp2', type: 'xls' })

      await service.createExport('aXaMpLe123', 'XLS')

      expect(mock.history[0].body).toMatchObject({ type: 'xls' })
    })

    it('includes fields and lang when provided', async () => {
      mock.onPost(`${API_BASE}/assets/aXaMpLe123/exports/`).reply({ uid: 'exp3', type: 'csv' })

      await service.createExport('aXaMpLe123', 'CSV', ['full_name', 'gender'], 'English (en)')

      expect(mock.history[0].body).toEqual({
        type: 'csv',
        fields: ['full_name', 'gender'],
        lang: 'English (en)',
      })
    })

    it('omits fields when empty array is provided', async () => {
      mock.onPost(`${API_BASE}/assets/aXaMpLe123/exports/`).reply({ uid: 'exp4', type: 'csv' })

      await service.createExport('aXaMpLe123', 'CSV', [])

      expect(mock.history[0].body).not.toHaveProperty('fields')
    })

    it('throws on API error', async () => {
      mock.onPost(`${API_BASE}/assets/bad/exports/`).replyWithError({ message: 'Not found' })

      await expect(service.createExport('bad')).rejects.toThrow('KoBoToolbox API error')
    })
  })

  // ── listExports ──

  describe('listExports', () => {
    it('sends GET request for exports', async () => {
      const response = { count: 1, results: [{ uid: 'exp1', status: 'complete' }] }

      mock.onGet(`${API_BASE}/assets/aXaMpLe123/exports/`).reply(response)

      const result = await service.listExports('aXaMpLe123')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${API_BASE}/assets/aXaMpLe123/exports/`)
      expect(result).toEqual(response)
    })

    it('throws on API error', async () => {
      mock.onGet(`${API_BASE}/assets/bad/exports/`).replyWithError({ message: 'Not found' })

      await expect(service.listExports('bad')).rejects.toThrow('KoBoToolbox API error')
    })
  })

  // ── getAssetsDictionary ──

  describe('getAssetsDictionary', () => {
    const assetsResponse = {
      count: 3,
      next: 'https://kf.kobotoolbox.org/api/v2/assets/?limit=50&start=50',
      results: [
        { uid: 'a1', name: 'Survey A', asset_type: 'survey', deployment__submission_count: 10 },
        { uid: 'a2', name: 'Template B', asset_type: 'template' },
        { uid: 'a3', name: '', asset_type: 'block', deployment__submission_count: 0 },
      ],
    }

    it('sends correct request and maps assets to dictionary items', async () => {
      mock.onGet(`${API_BASE}/assets/`).reply(assetsResponse)

      const result = await service.getAssetsDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toMatchObject({ limit: 50 })

      expect(result.items).toEqual([
        { label: 'Survey A', value: 'a1', note: 'survey - 10 submissions' },
        { label: 'Template B', value: 'a2', note: 'template' },
        { label: 'a3', value: 'a3', note: 'block - 0 submissions' },
      ])
    })

    it('returns cursor when next page exists', async () => {
      mock.onGet(`${API_BASE}/assets/`).reply(assetsResponse)

      const result = await service.getAssetsDictionary({})

      expect(result.cursor).toBe('3')
    })

    it('returns undefined cursor when no next page', async () => {
      mock.onGet(`${API_BASE}/assets/`).reply({ count: 1, next: null, results: [{ uid: 'a1', name: 'X' }] })

      const result = await service.getAssetsDictionary({})

      expect(result.cursor).toBeUndefined()
    })

    it('passes search as q parameter', async () => {
      mock.onGet(`${API_BASE}/assets/`).reply({ count: 0, next: null, results: [] })

      await service.getAssetsDictionary({ search: 'household' })

      expect(mock.history[0].query).toMatchObject({ q: 'household' })
    })

    it('passes cursor as start parameter', async () => {
      mock.onGet(`${API_BASE}/assets/`).reply({ count: 0, next: null, results: [] })

      await service.getAssetsDictionary({ cursor: '50' })

      expect(mock.history[0].query).toMatchObject({ start: 50 })
    })

    it('handles null payload', async () => {
      mock.onGet(`${API_BASE}/assets/`).reply({ count: 0, next: null, results: [] })

      const result = await service.getAssetsDictionary(null)

      expect(result.items).toEqual([])
    })

    it('handles empty results array', async () => {
      mock.onGet(`${API_BASE}/assets/`).reply({ count: 0, next: null, results: [] })

      const result = await service.getAssetsDictionary({})

      expect(result.items).toEqual([])
      expect(result.cursor).toBeUndefined()
    })

    it('uses uid as label when name is empty', async () => {
      mock.onGet(`${API_BASE}/assets/`).reply({
        count: 1,
        next: null,
        results: [{ uid: 'noname1', name: '', asset_type: 'survey' }],
      })

      const result = await service.getAssetsDictionary({})

      expect(result.items[0].label).toBe('noname1')
    })

    it('throws on API error', async () => {
      mock.onGet(`${API_BASE}/assets/`).replyWithError({ message: 'Unauthorized' })

      await expect(service.getAssetsDictionary({})).rejects.toThrow()
    })
  })
})
