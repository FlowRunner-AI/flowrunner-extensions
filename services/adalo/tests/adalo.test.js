'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const APP_ID = 'test-app-id'
const BASE = `https://api.adalo.com/v0/apps/${ APP_ID }/collections`
const COLLECTION_ID = 'col_abc123'

describe('Adalo Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, appId: APP_ID })
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
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'appId',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── listRecords ──

  describe('listRecords', () => {
    it('sends correct request with defaults', async () => {
      const responseData = { records: [{ id: 1, Name: 'Test' }], offset: 0, limit: 100 }

      mock.onGet(`${ BASE }/${ COLLECTION_ID }`).reply(responseData)

      const result = await service.listRecords(COLLECTION_ID)

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].query).toMatchObject({ offset: 0, limit: 100 })
    })

    it('passes custom offset and limit', async () => {
      mock.onGet(`${ BASE }/${ COLLECTION_ID }`).reply({ records: [], offset: 10, limit: 25 })

      await service.listRecords(COLLECTION_ID, 10, 25)

      expect(mock.history[0].query).toMatchObject({ offset: 10, limit: 25 })
    })

    it('uses default offset when null is provided', async () => {
      mock.onGet(`${ BASE }/${ COLLECTION_ID }`).reply({ records: [] })

      await service.listRecords(COLLECTION_ID, null, 50)

      expect(mock.history[0].query).toMatchObject({ offset: 0, limit: 50 })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/${ COLLECTION_ID }`).replyWithError({
        message: 'Unauthorized',
        body: { error: 'Invalid API key' },
        status: 401,
      })

      await expect(service.listRecords(COLLECTION_ID)).rejects.toThrow('Adalo API error (401): Invalid API key')
    })
  })

  // ── getRecord ──

  describe('getRecord', () => {
    it('sends correct request', async () => {
      const record = { id: 1, Name: 'Ada', Email: 'ada@example.com' }

      mock.onGet(`${ BASE }/${ COLLECTION_ID }/1`).reply(record)

      const result = await service.getRecord(COLLECTION_ID, 1)

      expect(result).toEqual(record)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
      })
    })

    it('throws on not found', async () => {
      mock.onGet(`${ BASE }/${ COLLECTION_ID }/999`).replyWithError({
        message: 'Not Found',
        body: { error: 'Record not found' },
        status: 404,
      })

      await expect(service.getRecord(COLLECTION_ID, 999)).rejects.toThrow('Adalo API error (404): Record not found')
    })
  })

  // ── createRecord ──

  describe('createRecord', () => {
    it('sends POST with correct body', async () => {
      const fields = { Name: 'Ada', Email: 'ada@example.com' }
      const created = { id: 3, ...fields }

      mock.onPost(`${ BASE }/${ COLLECTION_ID }`).reply(created)

      const result = await service.createRecord(COLLECTION_ID, fields)

      expect(result).toEqual(created)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual(fields)
    })

    it('sends empty object when fields is undefined', async () => {
      mock.onPost(`${ BASE }/${ COLLECTION_ID }`).reply({ id: 4 })

      await service.createRecord(COLLECTION_ID)

      expect(mock.history[0].body).toEqual({})
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/${ COLLECTION_ID }`).replyWithError({
        message: 'Bad Request',
        body: { message: 'Missing required field' },
        status: 400,
      })

      await expect(service.createRecord(COLLECTION_ID, {})).rejects.toThrow('Adalo API error (400): Missing required field')
    })
  })

  // ── updateRecord ──

  describe('updateRecord', () => {
    it('sends PUT with correct body', async () => {
      const fields = { Email: 'ada.new@example.com' }
      const updated = { id: 1, Name: 'Ada', Email: 'ada.new@example.com' }

      mock.onPut(`${ BASE }/${ COLLECTION_ID }/1`).reply(updated)

      const result = await service.updateRecord(COLLECTION_ID, 1, fields)

      expect(result).toEqual(updated)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual(fields)
    })

    it('sends empty object when fields is undefined', async () => {
      mock.onPut(`${ BASE }/${ COLLECTION_ID }/1`).reply({ id: 1 })

      await service.updateRecord(COLLECTION_ID, 1)

      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── deleteRecord ──

  describe('deleteRecord', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/${ COLLECTION_ID }/1`).reply({})

      const result = await service.deleteRecord(COLLECTION_ID, 1)

      expect(result).toEqual({ success: true, collectionId: COLLECTION_ID, recordId: 1 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/${ COLLECTION_ID }/999`).replyWithError({
        message: 'Not Found',
        body: { error: 'Record not found' },
        status: 404,
      })

      await expect(service.deleteRecord(COLLECTION_ID, 999)).rejects.toThrow('Adalo API error (404): Record not found')
    })
  })

  // ── URL encoding ──

  describe('URL encoding', () => {
    it('encodes special characters in collectionId and recordId', async () => {
      const specialCollectionId = 'col/special&id'
      const specialRecordId = 'rec/special&id'

      mock.onGet(`${ BASE }/${ encodeURIComponent(specialCollectionId) }/${ encodeURIComponent(specialRecordId) }`).reply({ id: 1 })

      await service.getRecord(specialCollectionId, specialRecordId)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toContain(encodeURIComponent(specialCollectionId))
      expect(mock.history[0].url).toContain(encodeURIComponent(specialRecordId))
    })
  })
})
