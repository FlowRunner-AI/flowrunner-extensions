'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://www.googleapis.com/books/v1'

describe('Google Books Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
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
          required: false,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('does not include the service name in the config displayName', () => {
      const [apiKeyItem] = sandbox.getConfigItems()

      expect(apiKeyItem.displayName).toBe('API Key')
      expect(apiKeyItem.displayName.toLowerCase()).not.toContain('google')
    })

    it('sends the api key as the "key" query param and JSON content type', async () => {
      mock.onGet(`${ BASE }/volumes`).reply({ kind: 'books#volumes', totalItems: 0, items: [] })

      await service.searchVolumes('flowers')

      expect(mock.history[0].query.key).toBe(API_KEY)
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })
    })
  })

  // ── Volumes ──

  describe('searchVolumes', () => {
    it('sends required query and applies the default max results', async () => {
      mock.onGet(`${ BASE }/volumes`).reply({ kind: 'books#volumes', totalItems: 3, items: [] })

      const result = await service.searchVolumes('the google story')

      expect(result).toEqual({ kind: 'books#volumes', totalItems: 3, items: [] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/volumes`)
      expect(mock.history[0].query).toEqual({
        q: 'the google story',
        maxResults: 10,
        key: API_KEY,
      })
    })

    it('maps all choice params to their API values and passes raw params through', async () => {
      mock.onGet(`${ BASE }/volumes`).reply({ kind: 'books#volumes', totalItems: 1, items: [] })

      await service.searchVolumes(
        'gardening inauthor:keyes',
        20,
        40,
        'Newest',
        'Books',
        'Free eBooks',
        'en',
        'Lite'
      )

      expect(mock.history[0].query).toEqual({
        q: 'gardening inauthor:keyes',
        startIndex: 20,
        maxResults: 40,
        orderBy: 'newest',
        printType: 'books',
        filter: 'free-ebooks',
        langRestrict: 'en',
        projection: 'lite',
        key: API_KEY,
      })
    })

    it('maps the remaining choice values (Relevance / All / Full projection)', async () => {
      mock.onGet(`${ BASE }/volumes`).reply({ items: [] })

      await service.searchVolumes('books', undefined, undefined, 'Relevance', 'All', 'Full', undefined, 'Full')

      expect(mock.history[0].query).toMatchObject({
        orderBy: 'relevance',
        printType: 'all',
        filter: 'full',
        projection: 'full',
      })
    })

    it('maps the Magazines print type and the Partial / Paid eBooks / eBooks filters', async () => {
      mock.onGet(`${ BASE }/volumes`).reply({ items: [] })

      await service.searchVolumes('x', undefined, undefined, undefined, 'Magazines', 'Partial')
      await service.searchVolumes('x', undefined, undefined, undefined, undefined, 'Paid eBooks')
      await service.searchVolumes('x', undefined, undefined, undefined, undefined, 'eBooks')

      expect(mock.history[0].query.printType).toBe('magazines')
      expect(mock.history[0].query.filter).toBe('partial')
      expect(mock.history[1].query.filter).toBe('paid-ebooks')
      expect(mock.history[2].query.filter).toBe('ebooks')
    })

    it('passes an already-mapped/unknown choice value straight through', async () => {
      mock.onGet(`${ BASE }/volumes`).reply({ items: [] })

      await service.searchVolumes('x', undefined, undefined, 'newest', 'books', 'partial')

      expect(mock.history[0].query).toMatchObject({
        orderBy: 'newest',
        printType: 'books',
        filter: 'partial',
      })
    })

    it('omits empty / undefined optional params from the query', async () => {
      mock.onGet(`${ BASE }/volumes`).reply({ items: [] })

      await service.searchVolumes('x')

      const { query } = mock.history[0]

      expect(query).not.toHaveProperty('startIndex')
      expect(query).not.toHaveProperty('orderBy')
      expect(query).not.toHaveProperty('printType')
      expect(query).not.toHaveProperty('filter')
      expect(query).not.toHaveProperty('langRestrict')
      expect(query).not.toHaveProperty('projection')
    })

    it('keeps a startIndex of 0 out of the query (clean strips only empty string/null/undefined)', async () => {
      mock.onGet(`${ BASE }/volumes`).reply({ items: [] })

      await service.searchVolumes('x', 0)

      // clean() only drops undefined/null/'' — a numeric 0 is preserved.
      expect(mock.history[0].query.startIndex).toBe(0)
    })

    it('throws a wrapped error using the API error message', async () => {
      mock.onGet(`${ BASE }/volumes`).replyWithError({
        message: 'HTTP error',
        status: 400,
        body: { error: { message: 'Invalid value for q' } },
      })

      await expect(service.searchVolumes('x')).rejects.toThrow(
        'Google Books API error (400): Invalid value for q'
      )
    })
  })

  describe('getVolume', () => {
    it('fetches a volume by id and sends the api key', async () => {
      mock.onGet(`${ BASE }/volumes/zyTCAlFPjgYC`).reply({ kind: 'books#volume', id: 'zyTCAlFPjgYC' })

      const result = await service.getVolume('zyTCAlFPjgYC')

      expect(result).toEqual({ kind: 'books#volume', id: 'zyTCAlFPjgYC' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/volumes/zyTCAlFPjgYC`)
      expect(mock.history[0].query).toEqual({ key: API_KEY })
    })

    it('url-encodes the volume id', async () => {
      mock.onGet(`${ BASE }/volumes/a%2Fb%20c`).reply({ id: 'a/b c' })

      await service.getVolume('a/b c')

      expect(mock.history[0].url).toBe(`${ BASE }/volumes/a%2Fb%20c`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/volumes/missing`).replyWithError({
        message: 'Not found',
        status: 404,
      })

      await expect(service.getVolume('missing')).rejects.toThrow(
        'Google Books API error (404): Not found'
      )
    })

    it('falls back to body.message and omits the status when unavailable', async () => {
      mock.onGet(`${ BASE }/volumes/x`).replyWithError({
        body: { message: 'plain body message' },
      })

      await expect(service.getVolume('x')).rejects.toThrow(
        'Google Books API error: plain body message'
      )
    })
  })

  // ── Bookshelves ──

  describe('listPublicBookshelves', () => {
    it('lists bookshelves for a user id', async () => {
      mock.onGet(`${ BASE }/users/12345/bookshelves`).reply({
        kind: 'books#bookshelves',
        items: [{ id: 1001, title: 'Favorites' }],
      })

      const result = await service.listPublicBookshelves('12345')

      expect(result).toEqual({ kind: 'books#bookshelves', items: [{ id: 1001, title: 'Favorites' }] })
      expect(mock.history[0].url).toBe(`${ BASE }/users/12345/bookshelves`)
      expect(mock.history[0].query).toEqual({ key: API_KEY })
    })

    it('url-encodes the user id', async () => {
      mock.onGet(`${ BASE }/users/a%2Fb/bookshelves`).reply({ items: [] })

      await service.listPublicBookshelves('a/b')

      expect(mock.history[0].url).toBe(`${ BASE }/users/a%2Fb/bookshelves`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/users/12345/bookshelves`).replyWithError({
        message: 'User not found',
        statusCode: 404,
      })

      await expect(service.listPublicBookshelves('12345')).rejects.toThrow(
        'Google Books API error (404): User not found'
      )
    })
  })

  describe('getPublicBookshelf', () => {
    it('fetches a single bookshelf by user id and shelf id', async () => {
      mock.onGet(`${ BASE }/users/12345/bookshelves/3`).reply({
        kind: 'books#bookshelf',
        id: 3,
        title: 'Reviewed',
      })

      const result = await service.getPublicBookshelf('12345', '3')

      expect(result).toEqual({ kind: 'books#bookshelf', id: 3, title: 'Reviewed' })
      expect(mock.history[0].url).toBe(`${ BASE }/users/12345/bookshelves/3`)
      expect(mock.history[0].query).toEqual({ key: API_KEY })
    })

    it('url-encodes the user id and shelf id', async () => {
      mock.onGet(`${ BASE }/users/u%2F1/bookshelves/s%201`).reply({ id: 's 1' })

      await service.getPublicBookshelf('u/1', 's 1')

      expect(mock.history[0].url).toBe(`${ BASE }/users/u%2F1/bookshelves/s%201`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/users/12345/bookshelves/999`).replyWithError({
        message: 'Shelf not found',
        status: 404,
      })

      await expect(service.getPublicBookshelf('12345', '999')).rejects.toThrow(
        'Google Books API error (404): Shelf not found'
      )
    })
  })

  describe('listBookshelfVolumes', () => {
    it('lists volumes for a shelf with no pagination params', async () => {
      mock.onGet(`${ BASE }/users/12345/bookshelves/3/volumes`).reply({
        kind: 'books#volumes',
        totalItems: 2,
        items: [],
      })

      const result = await service.listBookshelfVolumes('12345', '3')

      expect(result).toEqual({ kind: 'books#volumes', totalItems: 2, items: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/users/12345/bookshelves/3/volumes`)
      // startIndex/maxResults are undefined -> stripped by clean(); only key remains.
      expect(mock.history[0].query).toEqual({ key: API_KEY })
    })

    it('passes custom pagination params', async () => {
      mock.onGet(`${ BASE }/users/12345/bookshelves/3/volumes`).reply({ items: [] })

      await service.listBookshelfVolumes('12345', '3', 5, 20)

      expect(mock.history[0].query).toEqual({
        startIndex: 5,
        maxResults: 20,
        key: API_KEY,
      })
    })

    it('url-encodes the user id and shelf id', async () => {
      mock.onGet(`${ BASE }/users/u%2F1/bookshelves/s%2F2/volumes`).reply({ items: [] })

      await service.listBookshelfVolumes('u/1', 's/2')

      expect(mock.history[0].url).toBe(`${ BASE }/users/u%2F1/bookshelves/s%2F2/volumes`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/users/12345/bookshelves/3/volumes`).replyWithError({
        message: 'Boom',
        status: 500,
      })

      await expect(service.listBookshelfVolumes('12345', '3')).rejects.toThrow(
        'Google Books API error (500): Boom'
      )
    })
  })

})

// ── API key handling (no key configured) ──
//
// Uses jest.isolateModules so the service module re-runs addService() against a
// fresh sandbox global, without disturbing the primary suite's cached instance.

describe('Google Books Service (no api key configured)', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({})

    jest.isolateModules(() => {
      require('../src/index.js')
    })

    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  it('omits the key query param entirely when no api key is set', async () => {
    mock.onGet(`${ BASE }/volumes`).reply({ items: [] })

    await service.searchVolumes('public search')

    expect(mock.history[0].query).not.toHaveProperty('key')
    expect(mock.history[0].query).toEqual({
      q: 'public search',
      maxResults: 10,
    })
  })

  it('still reaches the volume endpoint without a key', async () => {
    mock.onGet(`${ BASE }/volumes/pubId`).reply({ id: 'pubId' })

    const result = await service.getVolume('pubId')

    expect(result).toEqual({ id: 'pubId' })
    expect(mock.history[0].query).toEqual({})
  })
})
