'use strict'

const { createSandbox } = require('../../../service-sandbox')

/**
 * Load the service into a freshly-created sandbox. The service module calls
 * Flowrunner.ServerCode.addService() at require time, and Jest caches modules
 * in its own registry, so jest.resetModules() is needed to re-run registration
 * against a new sandbox.
 */
function loadServiceInto(config) {
  const sandbox = createSandbox(config)

  jest.resetModules()
  require('../src/index.js')

  return sandbox
}

const BASE_URL = 'https://cms.example.com'
const API_TOKEN = 'test-api-token'
const API = `${ BASE_URL }/api`
const AUTH = { Authorization: `Bearer ${ API_TOKEN }` }

describe('Strapi Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = loadServiceInto({ baseUrl: `  ${ BASE_URL }///  `, apiToken: API_TOKEN })
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration & construction ──

  describe('service registration', () => {
    it('registers the required config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['baseUrl', 'apiToken'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'baseUrl', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'apiToken', required: true, shared: false, type: 'STRING' }),
        ])
      )
    })

    it('trims whitespace and trailing slashes from the base URL', () => {
      expect(service.baseUrl).toBe(BASE_URL)
      expect(service.apiBase).toBe(API)
    })
  })

  // ── Entries ──

  describe('listEntries', () => {
    it('sends an authorized GET with no query when only a collection is given', async () => {
      mock.onGet(`${ API }/articles`).reply({ data: [], meta: {} })

      const result = await service.listEntries('articles')

      expect(result).toEqual({ data: [], meta: {} })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({ ...AUTH, 'Content-Type': 'application/json' })
      expect(mock.history[0].query).toEqual({})
    })

    it('trims and encodes the collection segment', async () => {
      mock.onGet(`${ API }/articles`).reply({ data: [] })

      await service.listEntries('  /articles/  ')

      expect(mock.history[0].url).toBe(`${ API }/articles`)
    })

    it('supports populate: *', async () => {
      mock.onGet(`${ API }/articles`).reply({ data: [] })

      await service.listEntries('articles', '*')

      expect(mock.history[0].query).toEqual({ populate: '*' })
    })

    it('indexes a comma-separated populate list', async () => {
      mock.onGet(`${ API }/articles`).reply({ data: [] })

      await service.listEntries('articles', 'author, cover , ')

      expect(mock.history[0].query).toEqual({
        'populate[0]': 'author',
        'populate[1]': 'cover',
      })
    })

    it('flattens nested filters into bracket syntax', async () => {
      mock.onGet(`${ API }/articles`).reply({ data: [] })

      await service.listEntries('articles', undefined, {
        title: { $contains: 'hello' },
        rating: { $gte: 4 },
      })

      expect(mock.history[0].query).toEqual({
        'filters[title][$contains]': 'hello',
        'filters[rating][$gte]': 4,
      })
    })

    it('flattens array filter values into indexed keys', async () => {
      mock.onGet(`${ API }/articles`).reply({ data: [] })

      await service.listEntries('articles', undefined, { id: { $in: [1, 2] } })

      expect(mock.history[0].query).toEqual({
        'filters[id][$in][0]': 1,
        'filters[id][$in][1]': 2,
      })
    })

    it('drops null and undefined filter values', async () => {
      mock.onGet(`${ API }/articles`).reply({ data: [] })

      await service.listEntries('articles', undefined, { title: null, slug: undefined, ok: 1 })

      expect(mock.history[0].query).toEqual({ 'filters[ok]': 1 })
    })

    it('indexes sort clauses and field selection', async () => {
      mock.onGet(`${ API }/articles`).reply({ data: [] })

      await service.listEntries('articles', undefined, undefined, 'createdAt:desc, title:asc', 'title,slug')

      expect(mock.history[0].query).toEqual({
        'sort[0]': 'createdAt:desc',
        'sort[1]': 'title:asc',
        'fields[0]': 'title',
        'fields[1]': 'slug',
      })
    })

    it('sends pagination, locale and mapped status', async () => {
      mock.onGet(`${ API }/articles`).reply({ data: [] })

      await service.listEntries('articles', undefined, undefined, undefined, undefined, 2, 50, 'fr', 'Draft')

      expect(mock.history[0].query).toEqual({
        'pagination[page]': 2,
        'pagination[pageSize]': 50,
        locale: 'fr',
        status: 'draft',
      })
    })

    it('passes an unmapped status value through unchanged', async () => {
      mock.onGet(`${ API }/articles`).reply({ data: [] })

      await service.listEntries('articles', undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'archived')

      expect(mock.history[0].query).toEqual({ status: 'archived' })
    })

    it('omits pagination when page and pageSize are empty strings', async () => {
      mock.onGet(`${ API }/articles`).reply({ data: [] })

      await service.listEntries('articles', undefined, undefined, undefined, undefined, '', '')

      expect(mock.history[0].query).toEqual({})
    })

    it.each([[undefined], [null], [''], [42]])('rejects an invalid collection (%p)', async collection => {
      await expect(service.listEntries(collection)).rejects.toThrow(
        'Strapi API error: A collection (plural API ID, e.g. "articles") is required.'
      )

      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors with name, message and details', async () => {
      mock.onGet(`${ API }/articles`).replyWithError({
        body: {
          error: {
            name: 'ValidationError',
            message: 'Invalid key',
            details: { errors: [{ path: ['title'] }] },
          },
        },
      })

      await expect(service.listEntries('articles')).rejects.toThrow(
        'Strapi API error: ValidationError: Invalid key ({"errors":[{"path":["title"]}]})'
      )
    })

    it('falls back to the transport error message', async () => {
      mock.onGet(`${ API }/articles`).replyWithError({ message: 'socket hang up' })

      await expect(service.listEntries('articles')).rejects.toThrow('Strapi API error: socket hang up')
    })

    it('omits empty details from the error message', async () => {
      mock.onGet(`${ API }/articles`).replyWithError({
        body: { error: { message: 'Forbidden', details: {} } },
      })

      await expect(service.listEntries('articles')).rejects.toThrow('Strapi API error: Forbidden')
    })
  })

  describe('getEntry', () => {
    it('requests the entry by documentId', async () => {
      mock.onGet(`${ API }/articles/doc123`).reply({ data: { documentId: 'doc123' }, meta: {} })

      const result = await service.getEntry('articles', 'doc123', '*', 'en', 'Published')

      expect(result).toEqual({ data: { documentId: 'doc123' }, meta: {} })
      expect(mock.history[0].query).toEqual({ populate: '*', locale: 'en', status: 'published' })
    })

    it('encodes the documentId', async () => {
      mock.onGet(`${ API }/articles/doc%2F1`).reply({ data: {} })

      await service.getEntry('articles', 'doc/1')

      expect(mock.history[0].url).toBe(`${ API }/articles/doc%2F1`)
    })

    it('requires a documentId', async () => {
      await expect(service.getEntry('articles')).rejects.toThrow('Strapi API error: A documentId is required.')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('createEntry', () => {
    it('wraps the fields in a data envelope', async () => {
      mock.onPost(`${ API }/articles`).reply({ data: { documentId: 'new' }, meta: {} })

      const result = await service.createEntry('articles', { title: 'Hello' }, 'en', 'Published')

      expect(result).toEqual({ data: { documentId: 'new' }, meta: {} })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ data: { title: 'Hello' } })
      expect(mock.history[0].query).toEqual({ locale: 'en', status: 'published' })
    })

    it.each([[undefined], [null], ['nope'], [7]])('rejects invalid data (%p)', async data => {
      await expect(service.createEntry('articles', data)).rejects.toThrow(
        'Strapi API error: A data object with the entry fields is required.'
      )

      expect(mock.history).toHaveLength(0)
    })
  })

  describe('updateEntry', () => {
    it('sends a PUT with the data envelope', async () => {
      mock.onPut(`${ API }/articles/doc123`).reply({ data: { documentId: 'doc123' } })

      await service.updateEntry('articles', 'doc123', { title: 'Updated' }, 'fr', 'Draft')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ data: { title: 'Updated' } })
      expect(mock.history[0].query).toEqual({ locale: 'fr', status: 'draft' })
    })

    it('requires a documentId', async () => {
      await expect(service.updateEntry('articles', '', { title: 'x' })).rejects.toThrow(
        'Strapi API error: A documentId is required.'
      )
    })

    it('requires a data object', async () => {
      await expect(service.updateEntry('articles', 'doc123', null)).rejects.toThrow(
        'Strapi API error: A data object with the fields to update is required.'
      )

      expect(mock.history).toHaveLength(0)
    })
  })

  describe('deleteEntry', () => {
    it('sends a DELETE and returns the response', async () => {
      mock.onDelete(`${ API }/articles/doc123`).reply({ data: null, meta: { ok: true } })

      const result = await service.deleteEntry('articles', 'doc123', 'en')

      expect(result).toEqual({ data: null, meta: { ok: true } })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].query).toEqual({ locale: 'en' })
    })

    it('normalizes an empty 204 response', async () => {
      mock.onDelete(`${ API }/articles/doc123`).reply(undefined)

      const result = await service.deleteEntry('articles', 'doc123')

      expect(result).toEqual({ data: null, meta: {} })
    })

    it('requires a documentId', async () => {
      await expect(service.deleteEntry('articles')).rejects.toThrow('Strapi API error: A documentId is required.')
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Media ──

  describe('uploadFile', () => {
    const FILE_URL = 'https://files.example.com/path/my%20cover.jpg?token=abc'

    it('downloads the file and posts it as multipart form data', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('image-bytes'))
      mock.onPost(`${ API }/upload`).reply([{ id: 1, name: 'my cover.jpg' }])

      const result = await service.uploadFile(FILE_URL)

      expect(result).toEqual([{ id: 1, name: 'my cover.jpg' }])
      expect(mock.history).toHaveLength(2)

      const download = mock.history[0]

      expect(download.method).toBe('get')
      expect(download.encoding).toBeNull()

      const upload = mock.history[1]

      expect(upload.method).toBe('post')
      expect(upload.headers).toMatchObject(AUTH)
      // Multipart requests must NOT declare a JSON content type — the boundary comes from the form.
      expect(upload.headers['Content-Type']).toBeUndefined()
      expect(upload.body).toBeUndefined()

      expect(upload.formData._fields).toEqual([
        { name: 'files', value: Buffer.from('image-bytes'), filename: { filename: 'my cover.jpg' } },
      ])
    })

    it('converts non-buffer bytes into a Buffer', async () => {
      mock.onGet(FILE_URL).reply(new Uint8Array([1, 2, 3]))
      mock.onPost(`${ API }/upload`).reply([{ id: 2 }])

      await service.uploadFile(FILE_URL, 'bytes.bin')

      const field = mock.history[1].formData._fields[0]

      expect(Buffer.isBuffer(field.value)).toBe(true)
      expect(field.filename).toEqual({ filename: 'bytes.bin' })
    })

    it('appends the ref, refId and field link parameters', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('x'))
      mock.onPost(`${ API }/upload`).reply([{ id: 3 }])

      await service.uploadFile(FILE_URL, 'cover.jpg', 'api::article.article', 7, 'cover')

      expect(mock.history[1].formData._fields).toEqual([
        { name: 'files', value: Buffer.from('x'), filename: { filename: 'cover.jpg' } },
        { name: 'ref', value: 'api::article.article', filename: undefined },
        { name: 'refId', value: '7', filename: undefined },
        { name: 'field', value: 'cover', filename: undefined },
      ])
    })

    it('omits an empty refId', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('x'))
      mock.onPost(`${ API }/upload`).reply([{ id: 4 }])

      await service.uploadFile(FILE_URL, 'cover.jpg', 'api::article.article', '')

      expect(mock.history[1].formData._fields.map(f => f.name)).toEqual(['files', 'ref'])
    })

    it('requires a file url', async () => {
      await expect(service.uploadFile()).rejects.toThrow('Strapi API error: A file to upload is required.')
      expect(mock.history).toHaveLength(0)
    })

    it('wraps upload failures', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('x'))
      mock.onPost(`${ API }/upload`).replyWithError({ body: { error: { message: 'Payload too large' } } })

      await expect(service.uploadFile(FILE_URL)).rejects.toThrow('Strapi API error: Payload too large')
    })
  })

  describe('listMediaFiles', () => {
    it('lists media files without any query', async () => {
      mock.onGet(`${ API }/upload/files`).reply([])

      const result = await service.listMediaFiles()

      expect(result).toEqual([])
      expect(mock.history[0].query).toEqual({})
    })

    it('applies filters and sorting', async () => {
      mock.onGet(`${ API }/upload/files`).reply([{ id: 1 }])

      await service.listMediaFiles({ mime: { $contains: 'image' } }, 'createdAt:desc,name:asc')

      expect(mock.history[0].query).toEqual({
        'filters[mime][$contains]': 'image',
        'sort[0]': 'createdAt:desc',
        'sort[1]': 'name:asc',
      })
    })

    it('ignores a non-object filters argument', async () => {
      mock.onGet(`${ API }/upload/files`).reply([])

      await service.listMediaFiles('nope')

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getMediaFile', () => {
    it('requests the file by numeric id', async () => {
      mock.onGet(`${ API }/upload/files/12`).reply({ id: 12, name: 'cover.jpg' })

      const result = await service.getMediaFile(12)

      expect(result).toEqual({ id: 12, name: 'cover.jpg' })
      expect(mock.history[0].headers).toMatchObject(AUTH)
    })

    it('requires a file id', async () => {
      await expect(service.getMediaFile()).rejects.toThrow('Strapi API error: A media file id is required.')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('deleteMediaFile', () => {
    it('sends a DELETE for the file id', async () => {
      mock.onDelete(`${ API }/upload/files/12`).reply({ id: 12 })

      const result = await service.deleteMediaFile(12)

      expect(result).toEqual({ id: 12 })
      expect(mock.history[0].method).toBe('delete')
    })

    it('requires a file id', async () => {
      await expect(service.deleteMediaFile(0)).rejects.toThrow('Strapi API error: A media file id is required.')
      expect(mock.history).toHaveLength(0)
    })
  })
})

// ── Construction edge cases ──

describe('Strapi Service construction', () => {
  it('tolerates a missing base URL', () => {
    const sandbox = loadServiceInto({ apiToken: API_TOKEN })

    expect(sandbox.getService().baseUrl).toBe('')
    expect(sandbox.getService().apiBase).toBe('/api')

    sandbox.cleanup()
  })
})
