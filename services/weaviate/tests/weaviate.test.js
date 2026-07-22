'use strict'

const { createSandbox } = require('../../../service-sandbox')

const URL = 'https://cluster.weaviate.network'
const API_KEY = 'test-api-key'
const BASE = `${ URL }/v1`
const GRAPHQL = `${ BASE }/graphql`
const SCHEMA = `${ BASE }/schema`

const ARTICLE_SCHEMA = {
  class: 'Article',
  properties: [
    { name: 'title', dataType: ['text'] },
    { name: 'wordCount', dataType: ['int'] },
    { name: 'payload', dataType: ['object'] },
    { name: 'author', dataType: ['Person'] },
  ],
}

/**
 * Loads the service entry file in an isolated module registry so a service instance
 * with a different configuration can be exercised, then restores the outer sandbox.
 */
async function withSandbox(config, fn) {
  const previousGlobal = global.Flowrunner

  jest.resetModules()

  const altSandbox = createSandbox(config)

  try {
    require('../src/index.js')

    return await fn(altSandbox)
  } finally {
    altSandbox.cleanup()
    global.Flowrunner = previousGlobal
    jest.resetModules()
  }
}

describe('Weaviate Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ url: `${ URL }/`, apiKey: API_KEY })
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

  // ── Registration & construction ──

  describe('service registration', () => {
    it('registers the expected config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['url', 'apiKey', 'inferenceApiKeys'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'url', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'apiKey', required: false, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'inferenceApiKeys', required: false, shared: false, type: 'TEXT' }),
        ])
      )
    })

    it('strips trailing slashes from the instance URL', () => {
      expect(service.url).toBe(URL)
      expect(service.baseUrl).toBe(BASE)
    })

    it('parses inference API keys and merges them into request headers', async () => {
      await withSandbox(
        {
          url: URL,
          apiKey: API_KEY,
          inferenceApiKeys: '{"X-OpenAI-Api-Key":"sk-123"}',
        },
        async altSandbox => {
          const altService = altSandbox.getService()
          const altMock = altSandbox.getRequestMock()

          expect(altService.inferenceHeaders).toEqual({ 'X-OpenAI-Api-Key': 'sk-123' })

          altMock.onGet(`${ BASE }/meta`).reply({ version: '1.30.1' })

          await altService.getMeta()

          expect(altMock.history[0].headers).toMatchObject({
            'Content-Type': 'application/json',
            'X-OpenAI-Api-Key': 'sk-123',
            'Authorization': `Bearer ${ API_KEY }`,
          })
        }
      )
    })

    it('throws a descriptive error when inference API keys are not valid JSON', async () => {
      await withSandbox({ url: URL }, async () => {})

      const previousGlobal = global.Flowrunner

      jest.resetModules()

      const altSandbox = createSandbox({ url: URL, inferenceApiKeys: 'not-json' })

      try {
        expect(() => require('../src/index.js')).toThrow(/Invalid "Inference API Keys" configuration/)
      } finally {
        altSandbox.cleanup()
        global.Flowrunner = previousGlobal
        jest.resetModules()
      }
    })

    it('omits the Authorization header when no API key is configured', async () => {
      await withSandbox({ url: URL }, async altSandbox => {
        const altService = altSandbox.getService()
        const altMock = altSandbox.getRequestMock()

        altMock.onGet(`${ BASE }/meta`).reply({ version: '1.30.1' })

        await altService.getMeta()

        expect(altMock.history[0].headers).toEqual({ 'Content-Type': 'application/json' })
      })
    })
  })

  // ── Collections ──

  describe('createCollection', () => {
    it('sends only the class name when nothing else is provided', async () => {
      mock.onPost(SCHEMA).reply({ class: 'Article' })

      const result = await service.createCollection('Article')

      expect(result).toEqual({ class: 'Article' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(SCHEMA)
      expect(mock.history[0].body).toEqual({ class: 'Article' })
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': `Bearer ${ API_KEY }` })
    })

    it('includes description, vectorizer, properties and advanced configuration', async () => {
      mock.onPost(SCHEMA).reply({ class: 'Article' })

      await service.createCollection(
        'Article',
        'News articles',
        'text2vec-openai',
        [{ name: 'title', dataType: ['text'] }],
        { vectorIndexConfig: { distance: 'cosine' } }
      )

      expect(mock.history[0].body).toEqual({
        class: 'Article',
        vectorIndexConfig: { distance: 'cosine' },
        description: 'News articles',
        vectorizer: 'text2vec-openai',
        properties: [{ name: 'title', dataType: ['text'] }],
      })
    })

    it('omits an empty properties array', async () => {
      mock.onPost(SCHEMA).reply({ class: 'Article' })

      await service.createCollection('Article', undefined, undefined, [])

      expect(mock.history[0].body).toEqual({ class: 'Article' })
    })

    it('throws a Weaviate API error when the request fails', async () => {
      mock.onPost(SCHEMA).replyWithError({
        message: 'Bad Request',
        body: { error: [{ message: 'class name must start with an uppercase letter' }] },
      })

      await expect(service.createCollection('article')).rejects.toThrow(
        'Weaviate API error: class name must start with an uppercase letter'
      )
    })
  })

  describe('listCollections', () => {
    it('requests the full schema', async () => {
      mock.onGet(SCHEMA).reply({ classes: [ARTICLE_SCHEMA] })

      const result = await service.listCollections()

      expect(result).toEqual({ classes: [ARTICLE_SCHEMA] })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(SCHEMA)
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  describe('getCollection', () => {
    it('URL-encodes the collection name', async () => {
      mock.onGet(`${ SCHEMA }/My%20Class`).reply(ARTICLE_SCHEMA)

      const result = await service.getCollection('My Class')

      expect(result).toEqual(ARTICLE_SCHEMA)
      expect(mock.history[0].url).toBe(`${ SCHEMA }/My%20Class`)
    })
  })

  describe('deleteCollection', () => {
    it('deletes the collection and returns a success payload', async () => {
      mock.onDelete(`${ SCHEMA }/Article`).reply('')

      const result = await service.deleteCollection('Article')

      expect(result).toEqual({ success: true, className: 'Article' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('propagates API errors', async () => {
      mock.onDelete(`${ SCHEMA }/Article`).replyWithError({ message: 'Not Found' })

      await expect(service.deleteCollection('Article')).rejects.toThrow('Weaviate API error: Not Found')
    })
  })

  // ── Objects ──

  describe('createObject', () => {
    it('sends the class and properties', async () => {
      mock.onPost(`${ BASE }/objects`).reply({ id: 'obj-1' })

      const result = await service.createObject('Article', { title: 'Hello' })

      expect(result).toEqual({ id: 'obj-1' })
      expect(mock.history[0].body).toEqual({ class: 'Article', properties: { title: 'Hello' } })
    })

    it('includes the id and coerces the vector to numbers', async () => {
      mock.onPost(`${ BASE }/objects`).reply({ id: 'obj-1' })

      await service.createObject('Article', { title: 'Hello' }, 'obj-1', ['0.1', 0.2])

      expect(mock.history[0].body).toEqual({
        class: 'Article',
        properties: { title: 'Hello' },
        id: 'obj-1',
        vector: [0.1, 0.2],
      })
    })

    it('defaults missing properties to an empty object and ignores an empty vector', async () => {
      mock.onPost(`${ BASE }/objects`).reply({ id: 'obj-1' })

      await service.createObject('Article', null, null, [])

      expect(mock.history[0].body).toEqual({ class: 'Article', properties: {} })
    })
  })

  describe('getObject', () => {
    it('requests the object without a vector by default', async () => {
      mock.onGet(`${ BASE }/objects/Article/obj-1`).reply({ id: 'obj-1' })

      const result = await service.getObject('Article', 'obj-1')

      expect(result).toEqual({ id: 'obj-1' })
      expect(mock.history[0].query).toEqual({})
    })

    it('adds include=vector when requested', async () => {
      mock.onGet(`${ BASE }/objects/Article/obj-1`).reply({ id: 'obj-1' })

      await service.getObject('Article', 'obj-1', true)

      expect(mock.history[0].query).toEqual({ include: 'vector' })
    })
  })

  describe('updateObject', () => {
    it('patches the object and returns a success payload', async () => {
      mock.onPatch(`${ BASE }/objects/Article/obj-1`).reply('')

      const result = await service.updateObject('Article', 'obj-1', { title: 'Updated' })

      expect(result).toEqual({ success: true, id: 'obj-1' })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ class: 'Article', properties: { title: 'Updated' } })
    })

    it('includes the vector when provided', async () => {
      mock.onPatch(`${ BASE }/objects/Article/obj-1`).reply('')

      await service.updateObject('Article', 'obj-1', null, [1, '2'])

      expect(mock.history[0].body).toEqual({ class: 'Article', properties: {}, vector: [1, 2] })
    })
  })

  describe('replaceObject', () => {
    it('puts the full object including its id', async () => {
      mock.onPut(`${ BASE }/objects/Article/obj-1`).reply({ id: 'obj-1' })

      const result = await service.replaceObject('Article', 'obj-1', { title: 'Replaced' }, [0.5])

      expect(result).toEqual({ id: 'obj-1' })
      expect(mock.history[0].method).toBe('put')

      expect(mock.history[0].body).toEqual({
        class: 'Article',
        id: 'obj-1',
        properties: { title: 'Replaced' },
        vector: [0.5],
      })
    })
  })

  describe('deleteObject', () => {
    it('deletes the object and returns a success payload', async () => {
      mock.onDelete(`${ BASE }/objects/Article/obj-1`).reply('')

      const result = await service.deleteObject('Article', 'obj-1')

      expect(result).toEqual({ success: true, id: 'obj-1' })
    })
  })

  describe('listObjects', () => {
    it('sends only the class by default', async () => {
      mock.onGet(`${ BASE }/objects`).reply({ objects: [] })

      const result = await service.listObjects('Article')

      expect(result).toEqual({ objects: [] })
      expect(mock.history[0].query).toEqual({ class: 'Article' })
    })

    it('sends limit, after cursor and vector inclusion', async () => {
      mock.onGet(`${ BASE }/objects`).reply({ objects: [] })

      await service.listObjects('Article', '5', 'obj-1', true)

      expect(mock.history[0].query).toEqual({
        class: 'Article',
        limit: 5,
        after: 'obj-1',
        include: 'vector',
      })
    })

    it('ignores an empty-string limit', async () => {
      mock.onGet(`${ BASE }/objects`).reply({ objects: [] })

      await service.listObjects('Article', '')

      expect(mock.history[0].query).toEqual({ class: 'Article' })
    })
  })

  describe('batchCreateObjects', () => {
    it('normalizes plain property maps and full object shapes', async () => {
      mock.onPost(`${ BASE }/batch/objects`).reply([{ id: 'obj-1' }])

      const result = await service.batchCreateObjects('Article', [
        { title: 'Plain' },
        { properties: { title: 'Full' }, id: 'obj-2', vector: [0.1] },
        { properties: { title: 'Other class' }, class: 'Note' },
      ])

      expect(result).toEqual([{ id: 'obj-1' }])

      expect(mock.history[0].body).toEqual({
        objects: [
          { properties: { title: 'Plain' }, class: 'Article' },
          { properties: { title: 'Full' }, id: 'obj-2', vector: [0.1], class: 'Article' },
          { properties: { title: 'Other class' }, class: 'Note' },
        ],
      })
    })

    it('rejects a non-array or empty objects parameter', async () => {
      await expect(service.batchCreateObjects('Article', [])).rejects.toThrow(
        'The "Objects" parameter must be a non-empty array'
      )

      await expect(service.batchCreateObjects('Article', null)).rejects.toThrow(
        'The "Objects" parameter must be a non-empty array'
      )

      expect(mock.history).toHaveLength(0)
    })
  })

  describe('batchDeleteObjects', () => {
    it('sends the match filter', async () => {
      mock.onDelete(`${ BASE }/batch/objects`).reply({ results: { matches: 3 } })

      const where = { path: ['status'], operator: 'Equal', valueText: 'archived' }
      const result = await service.batchDeleteObjects('Article', where)

      expect(result).toEqual({ results: { matches: 3 } })
      expect(mock.history[0].body).toEqual({ match: { class: 'Article', where } })
    })

    it('includes the dry run flag when provided', async () => {
      mock.onDelete(`${ BASE }/batch/objects`).reply({ results: { matches: 3 } })

      await service.batchDeleteObjects('Article', { path: ['status'] }, true)

      expect(mock.history[0].body.dryRun).toBe(true)
    })

    it('requires a where filter', async () => {
      await expect(service.batchDeleteObjects('Article', null)).rejects.toThrow(
        'The "Where Filter" parameter is required for batch deletion'
      )

      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Search ──

  describe('searchVector', () => {
    it('builds a nearVector query and resolves scalar properties from the schema', async () => {
      mock.onGet(`${ SCHEMA }/Article`).reply(ARTICLE_SCHEMA)
      mock.onPost(GRAPHQL).reply({ data: { Get: { Article: [{ title: 'Hello' }] } } })

      const result = await service.searchVector('Article', ['0.1', 0.2])

      expect(result).toEqual([{ title: 'Hello' }])
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].url).toBe(`${ SCHEMA }/Article`)

      expect(mock.history[1].body.query).toBe(
        '{ Get { Article(nearVector: { vector: [0.1, 0.2] }, limit: 10) ' +
        '{ title wordCount _additional { id distance } } } }'
      )
    })

    it('uses explicit return properties, distance threshold, filter and limit', async () => {
      mock.onPost(GRAPHQL).reply({ data: { Get: { Article: [] } } })

      await service.searchVector(
        'Article',
        [0.1],
        5,
        0.3,
        undefined,
        { path: ['category'], operator: 'Equal', valueText: 'news' },
        ['title'],
        true,
        true,
        true
      )

      expect(mock.history).toHaveLength(1)

      expect(mock.history[0].body.query).toBe(
        '{ Get { Article(nearVector: { vector: [0.1], distance: 0.3 }, ' +
        'where: { path: ["category"], operator: Equal, valueText: "news" }, limit: 5) ' +
        '{ title _additional { id distance vector } } } }'
      )
    })

    it('falls back to certainty when no distance is given', async () => {
      mock.onPost(GRAPHQL).reply({ data: { Get: { Article: [] } } })

      await service.searchVector('Article', [0.1], 5, '', 0.8, undefined, ['title'])

      expect(mock.history[0].body.query).toContain('nearVector: { vector: [0.1], certainty: 0.8 }')
    })

    it('omits the id and distance additional fields when disabled', async () => {
      mock.onPost(GRAPHQL).reply({ data: { Get: { Article: [] } } })

      await service.searchVector('Article', [0.1], 5, undefined, undefined, undefined, ['title'], false, false, false)

      expect(mock.history[0].body.query).toBe(
        '{ Get { Article(nearVector: { vector: [0.1] }, limit: 5) { title } } }'
      )
    })

    it('rejects an empty vector', async () => {
      await expect(service.searchVector('Article', [])).rejects.toThrow(
        'The "Vector" parameter must be a non-empty array of numbers'
      )

      await expect(service.searchVector('Article', 'nope')).rejects.toThrow(
        'The "Vector" parameter must be a non-empty array of numbers'
      )
    })

    it('requires a collection name', async () => {
      await expect(service.searchVector('', [0.1])).rejects.toThrow('Collection name is required')
    })

    it('returns an empty array when the collection is missing from the payload', async () => {
      mock.onPost(GRAPHQL).reply({ data: { Get: {} } })

      const result = await service.searchVector('Article', [0.1], 5, undefined, undefined, undefined, ['title'])

      expect(result).toEqual([])
    })

    it('throws when the schema has no selectable scalar properties', async () => {
      mock.onGet(`${ SCHEMA }/Article`).reply({ class: 'Article', properties: [{ name: 'ref', dataType: ['Person'] }] })

      await expect(service.searchVector('Article', [0.1])).rejects.toThrow(
        /has no scalar properties to return automatically/
      )
    })

    it('throws when the schema has no properties at all', async () => {
      mock.onGet(`${ SCHEMA }/Article`).reply({ class: 'Article' })

      await expect(service.searchVector('Article', [0.1])).rejects.toThrow(
        /has no scalar properties to return automatically/
      )
    })
  })

  describe('searchText', () => {
    it('builds a nearText query from the query and extra concepts', async () => {
      mock.onPost(GRAPHQL).reply({ data: { Get: { Article: [{ title: 'Hello' }] } } })

      const result = await service.searchText(
        'Article',
        'space travel',
        ['rockets', ''],
        3,
        undefined,
        undefined,
        undefined,
        ['title']
      )

      expect(result).toEqual([{ title: 'Hello' }])

      expect(mock.history[0].body.query).toBe(
        '{ Get { Article(nearText: { concepts: ["space travel", "rockets"] }, limit: 3) ' +
        '{ title _additional { id distance } } } }'
      )
    })

    it('applies the distance threshold', async () => {
      mock.onPost(GRAPHQL).reply({ data: { Get: { Article: [] } } })

      await service.searchText('Article', 'q', null, 10, 0.25, 0.9, undefined, ['title'])

      expect(mock.history[0].body.query).toContain('nearText: { concepts: ["q"], distance: 0.25 }')
    })

    it('applies the certainty threshold when no distance is given', async () => {
      mock.onPost(GRAPHQL).reply({ data: { Get: { Article: [] } } })

      await service.searchText('Article', 'q', null, 10, null, 0.9, undefined, ['title'])

      expect(mock.history[0].body.query).toContain('nearText: { concepts: ["q"], certainty: 0.9 }')
    })

    it('requires a query', async () => {
      await expect(service.searchText('Article', '')).rejects.toThrow('The "Query" parameter is required')
    })
  })

  describe('searchKeyword', () => {
    it('builds a bm25 query with search properties', async () => {
      mock.onPost(GRAPHQL).reply({ data: { Get: { Article: [] } } })

      await service.searchKeyword('Article', 'hello', ['title^2', 'body'], 4, undefined, ['title'])

      expect(mock.history[0].body.query).toBe(
        '{ Get { Article(bm25: { query: "hello", properties: ["title^2", "body"] }, limit: 4) ' +
        '{ title _additional { id score } } } }'
      )
    })

    it('omits the score field when disabled and includes the vector when enabled', async () => {
      mock.onPost(GRAPHQL).reply({ data: { Get: { Article: [] } } })

      await service.searchKeyword('Article', 'hello', [], 4, undefined, ['title'], true, false, true)

      expect(mock.history[0].body.query).toBe(
        '{ Get { Article(bm25: { query: "hello" }, limit: 4) { title _additional { id vector } } } }'
      )
    })

    it('requires a query', async () => {
      await expect(service.searchKeyword('Article')).rejects.toThrow('The "Query" parameter is required')
    })
  })

  describe('searchHybrid', () => {
    it('builds a hybrid query with alpha and an explicit vector', async () => {
      mock.onPost(GRAPHQL).reply({ data: { Get: { Article: [] } } })

      await service.searchHybrid('Article', 'hello', 0.4, ['0.1'], 2, undefined, ['title'])

      expect(mock.history[0].body.query).toBe(
        '{ Get { Article(hybrid: { query: "hello", alpha: 0.4, vector: [0.1] }, limit: 2) ' +
        '{ title _additional { id score } } } }'
      )
    })

    it('defaults alpha and limit when not provided', async () => {
      mock.onPost(GRAPHQL).reply({ data: { Get: { Article: [] } } })

      await service.searchHybrid('Article', 'hello', '', [], undefined, undefined, ['title'])

      expect(mock.history[0].body.query).toBe(
        '{ Get { Article(hybrid: { query: "hello" }, limit: 10) { title _additional { id score } } } }'
      )
    })

    it('requires a query', async () => {
      await expect(service.searchHybrid('Article')).rejects.toThrow('The "Query" parameter is required')
    })
  })

  describe('graphqlQuery', () => {
    it('posts the raw query and returns the data payload', async () => {
      mock.onPost(GRAPHQL).reply({ data: { Get: { Article: [{ title: 'Hello' }] } } })

      const result = await service.graphqlQuery('{ Get { Article { title } } }')

      expect(result).toEqual({ Get: { Article: [{ title: 'Hello' }] } })
      expect(mock.history[0].body).toEqual({ query: '{ Get { Article { title } } }' })
    })

    it('returns an empty object when the response carries no data', async () => {
      mock.onPost(GRAPHQL).reply({})

      await expect(service.graphqlQuery('{ Get { Article { title } } }')).resolves.toEqual({})
    })

    it('surfaces GraphQL errors returned with a 200 response', async () => {
      mock.onPost(GRAPHQL).reply({ errors: [{ message: 'Cannot query field "nope"' }, { message: 'bad' }] })

      await expect(service.graphqlQuery('{ nope }')).rejects.toThrow(
        'Weaviate GraphQL error: Cannot query field "nope"; bad'
      )
    })

    it('requires a query', async () => {
      await expect(service.graphqlQuery('')).rejects.toThrow('The "GraphQL Query" parameter is required')
    })
  })

  describe('aggregateCount', () => {
    it('counts all objects in a collection', async () => {
      mock.onPost(GRAPHQL).reply({ data: { Aggregate: { Article: [{ meta: { count: 1250 } }] } } })

      const result = await service.aggregateCount('Article')

      expect(result).toEqual({ count: 1250 })
      expect(mock.history[0].body.query).toBe('{ Aggregate { Article { meta { count } } } }')
    })

    it('applies a where filter', async () => {
      mock.onPost(GRAPHQL).reply({ data: { Aggregate: { Article: [{ meta: { count: 3 } }] } } })

      await service.aggregateCount('Article', { path: ['status'], operator: 'Equal', valueText: 'published' })

      expect(mock.history[0].body.query).toBe(
        '{ Aggregate { Article(where: { path: ["status"], operator: Equal, valueText: "published" }) ' +
        '{ meta { count } } } }'
      )
    })

    it('returns zero when the aggregate payload is empty', async () => {
      mock.onPost(GRAPHQL).reply({ data: { Aggregate: {} } })

      await expect(service.aggregateCount('Article')).resolves.toEqual({ count: 0 })
    })
  })

  // ── Utilities ──

  describe('getMeta', () => {
    it('requests the meta endpoint', async () => {
      mock.onGet(`${ BASE }/meta`).reply({ version: '1.30.1' })

      const result = await service.getMeta()

      expect(result).toEqual({ version: '1.30.1' })
      expect(mock.history[0].url).toBe(`${ BASE }/meta`)
    })
  })

  describe('checkLiveness', () => {
    it('returns true when the readiness endpoint responds', async () => {
      mock.onGet(`${ BASE }/.well-known/ready`).reply('')

      await expect(service.checkLiveness()).resolves.toBe(true)
    })

    it('returns false when the instance is unreachable', async () => {
      mock.onGet(`${ BASE }/.well-known/ready`).replyWithError({ message: 'ECONNREFUSED' })

      await expect(service.checkLiveness()).resolves.toBe(false)
    })
  })

  // ── Dictionaries ──

  describe('getCollectionsDictionary', () => {
    it('maps schema classes to dictionary items', async () => {
      mock.onGet(SCHEMA).reply({
        classes: [
          { class: 'Article', description: 'News articles' },
          { class: 'Note', vectorizer: 'none' },
          { class: 'Plain' },
        ],
      })

      const result = await service.getCollectionsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Article', value: 'Article', note: 'News articles' },
          { label: 'Note', value: 'Note', note: 'none' },
          { label: 'Plain', value: 'Plain', note: undefined },
        ],
        cursor: null,
      })
    })

    it('filters classes case-insensitively by the search term', async () => {
      mock.onGet(SCHEMA).reply({ classes: [{ class: 'Article' }, { class: 'Note' }] })

      const result = await service.getCollectionsDictionary({ search: 'ART' })

      expect(result.items).toEqual([{ label: 'Article', value: 'Article', note: undefined }])
    })

    it('handles a null payload and a schema without classes', async () => {
      mock.onGet(SCHEMA).reply({})

      const result = await service.getCollectionsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('propagates API errors using the body message', async () => {
      mock.onGet(SCHEMA).replyWithError({ message: 'Unauthorized', body: { message: 'invalid api key' } })

      await expect(service.getCollectionsDictionary({})).rejects.toThrow('Weaviate API error: invalid api key')
    })
  })
})
