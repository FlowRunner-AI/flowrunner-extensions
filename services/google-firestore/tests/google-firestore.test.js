'use strict'

const crypto = require('node:crypto')
const { createSandbox } = require('../../../service-sandbox')

// A real 2048-bit RSA keypair so the service's genuine JWT signing path
// (crypto.createSign('RSA-SHA256').sign(private_key)) executes for real. Only the
// HTTP boundary (Google token endpoint + Firestore API) is mocked; signing is not.
const { privateKey: PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: 'key-file-project',
  client_email: 'svc@key-file-project.iam.gserviceaccount.com',
  private_key: PRIVATE_KEY,
}

const SERVICE_ACCOUNT_KEY = JSON.stringify(SERVICE_ACCOUNT)
const PROJECT_ID = 'test-project'
const DATABASE_ID = '(default)'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const ACCESS_TOKEN = 'ya29.test-access-token'

const DB = `https://firestore.googleapis.com/v1/projects/${ PROJECT_ID }/databases/${ encodeURIComponent(DATABASE_ID) }`
const DOCS = `${ DB }/documents`

function stubToken(mock) {
  mock.onPost(TOKEN_URL).reply({ access_token: ACCESS_TOKEN, expires_in: 3600 })
}

// A Firestore REST "document" resource for the users/abc doc, exercising every
// wire value key the decoder handles.
function sampleDocumentResource(name = `${ PROJECT_ID }/databases/${ DATABASE_ID }/documents/users/abc`) {
  return {
    name: `projects/${ name }`,
    createTime: '2026-07-01T12:00:00.000000Z',
    updateTime: '2026-07-02T08:30:00.000000Z',
    fields: {
      name: { stringValue: 'Alice' },
      age: { integerValue: '30' },
      score: { doubleValue: 1.5 },
      active: { booleanValue: true },
      deleted: { nullValue: null },
      when: { timestampValue: '2026-01-01T00:00:00Z' },
      raw: { bytesValue: 'aGVsbG8=' },
      ref: { referenceValue: 'projects/p/databases/(default)/documents/users/def' },
      spot: { geoPointValue: { latitude: 48.85, longitude: 2.35 } },
      tags: { arrayValue: { values: [{ stringValue: 'a' }, { integerValue: '2' }] } },
      address: { mapValue: { fields: { city: { stringValue: 'Paris' } } } },
    },
  }
}

describe('Google Firestore Service', () => {
  let sandbox
  let service
  let mock
  let mainFlowrunner

  // Build a service instance backed by its own config + mock, isolated from the
  // shared instance. The service module caches on first require and only calls
  // addService() once, so jest.isolateModules() forces re-registration with the
  // new config. The isolated sandbox reassigns global.Flowrunner, so the returned
  // cleanup() restores the shared instance's global before other tests run.
  function createIsolatedService(config) {
    const isoSandbox = createSandbox(config)

    jest.isolateModules(() => {
      require('../src/index.js')
    })

    return {
      service: isoSandbox.getService(),
      mock: isoSandbox.getRequestMock(),
      cleanup() {
        isoSandbox.cleanup()
        global.Flowrunner = mainFlowrunner
      },
    }
  }

  beforeAll(async () => {
    sandbox = createSandbox({
      serviceAccountKey: SERVICE_ACCOUNT_KEY,
      projectId: PROJECT_ID,
      databaseId: DATABASE_ID,
    })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
    mainFlowrunner = global.Flowrunner

    // Warm up: perform one request so the access token is signed and cached on the
    // shared service instance. After this, mock.history[0] in every test is the
    // actual Firestore request (the token endpoint is not hit again for ~1h).
    stubToken(mock)
    mock.onGet(`${ DOCS }/users/abc`).reply(sampleDocumentResource())
    await service.getDocument('users/abc')
    mock.reset()
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
          name: 'serviceAccountKey',
          displayName: 'Service Account Key (JSON)',
          required: true,
          shared: false,
          type: 'TEXT',
        }),
        expect.objectContaining({
          name: 'projectId',
          displayName: 'Project ID',
          required: false,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'databaseId',
          displayName: 'Database ID',
          required: false,
          shared: false,
          type: 'STRING',
          defaultValue: '(default)',
        }),
      ])
    })

    it('sends the bearer token and JSON content-type on requests', async () => {
      mock.onGet(`${ DOCS }/users/abc`).reply(sampleDocumentResource())

      await service.getDocument('users/abc')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ ACCESS_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Authentication / token exchange ──

  describe('access token exchange', () => {
    it('exchanges a signed JWT for an access token on the first request', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
        databaseId: DATABASE_ID,
      })

      stubToken(iso.mock)
      iso.mock.onGet(`${ DOCS }/users/abc`).reply(sampleDocumentResource())

      await iso.service.getDocument('users/abc')

      // First call is the JWT-bearer token exchange to Google.
      expect(iso.mock.history[0].method).toBe('post')
      expect(iso.mock.history[0].url).toBe(TOKEN_URL)
      expect(iso.mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(typeof iso.mock.history[0].body).toBe('string')
      expect(iso.mock.history[0].body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer')
      expect(iso.mock.history[0].body).toContain('assertion=')

      // Second call carries the returned token to the Firestore API.
      expect(iso.mock.history[1].url).toBe(`${ DOCS }/users/abc`)
      expect(iso.mock.history[1].headers).toMatchObject({
        'Authorization': `Bearer ${ ACCESS_TOKEN }`,
      })

      iso.cleanup()
    })

    it('caches the access token across requests', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
      })

      stubToken(iso.mock)
      iso.mock.onGet(`${ DOCS }/users/abc`).reply(sampleDocumentResource())

      await iso.service.getDocument('users/abc')
      await iso.service.getDocument('users/abc')

      const tokenCalls = iso.mock.history.filter(h => h.url === TOKEN_URL)

      expect(tokenCalls).toHaveLength(1)
      iso.cleanup()
    })

    it('throws a helpful error when the service account key is not valid JSON', async () => {
      const iso = createIsolatedService({ serviceAccountKey: 'not-json', projectId: PROJECT_ID })

      await expect(iso.service.getDocument('users/abc')).rejects.toThrow(
        'Service account key is not valid JSON'
      )

      iso.cleanup()
    })

    it('throws when the key is missing client_email or private_key', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: JSON.stringify({ project_id: 'x' }),
        projectId: PROJECT_ID,
      })

      await expect(iso.service.getDocument('users/abc')).rejects.toThrow(
        'is missing "client_email" or "private_key"'
      )

      iso.cleanup()
    })

    it('recovers escaped newlines in the private key', async () => {
      // Simulate a key pasted with literal "\n" sequences instead of real newlines.
      const escapedKey = JSON.stringify({
        ...SERVICE_ACCOUNT,
        private_key: PRIVATE_KEY.replace(/\n/g, '\\n'),
      })
      const iso = createIsolatedService({ serviceAccountKey: escapedKey, projectId: PROJECT_ID })

      stubToken(iso.mock)
      iso.mock.onGet(`${ DOCS }/users/abc`).reply(sampleDocumentResource())

      // Signing must succeed after newline recovery.
      await expect(iso.service.getDocument('users/abc')).resolves.toBeDefined()

      iso.cleanup()
    })

    it('surfaces token endpoint failures', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
      })

      iso.mock.onPost(TOKEN_URL).replyWithError({
        message: 'invalid_grant',
        body: { error: 'invalid_grant', error_description: 'Invalid JWT Signature' },
      })

      await expect(iso.service.getDocument('users/abc')).rejects.toThrow(
        'Failed to obtain an access token from Google: Invalid JWT Signature'
      )

      iso.cleanup()
    })

    it('throws when the token endpoint returns no access_token', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
      })

      iso.mock.onPost(TOKEN_URL).reply({ token_type: 'Bearer' })
      iso.mock.onGet(`${ DOCS }/users/abc`).reply(sampleDocumentResource())

      await expect(iso.service.getDocument('users/abc')).rejects.toThrow(
        'Google token endpoint did not return an access token'
      )

      iso.cleanup()
    })

    it('derives the project id from the key file when projectId config is empty', async () => {
      const iso = createIsolatedService({ serviceAccountKey: SERVICE_ACCOUNT_KEY })
      const keyDocs = `https://firestore.googleapis.com/v1/projects/${ SERVICE_ACCOUNT.project_id }/databases/${ encodeURIComponent(DATABASE_ID) }/documents`

      stubToken(iso.mock)
      iso.mock.onGet(`${ keyDocs }/users/abc`).reply(sampleDocumentResource())

      await iso.service.getDocument('users/abc')

      const call = iso.mock.history.find(h => h.url === `${ keyDocs }/users/abc`)

      expect(call).toBeDefined()
      iso.cleanup()
    })

    it('honours a custom database id in the URL', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
        databaseId: 'analytics',
      })
      const customDocs = `https://firestore.googleapis.com/v1/projects/${ PROJECT_ID }/databases/analytics/documents`

      stubToken(iso.mock)
      iso.mock.onGet(`${ customDocs }/users/abc`).reply(sampleDocumentResource())

      await iso.service.getDocument('users/abc')

      expect(iso.mock.history.find(h => h.url === `${ customDocs }/users/abc`)).toBeDefined()
      iso.cleanup()
    })
  })

  // ── Value conversion: plain JSON <-> Firestore wire format ──

  describe('field-value encoding (write path)', () => {
    it('encodes every plain JSON type into the Firestore wire format', async () => {
      mock.onPost(`${ DOCS }/things`).reply(sampleDocumentResource())

      await service.createDocument('things', {
        str: 'hello',
        int: 42,
        float: 3.14,
        boolTrue: true,
        boolFalse: false,
        nothing: null,
        list: ['a', 2, true],
        nested: { city: 'Paris', zip: 75001 },
      })

      expect(mock.history[0].body).toEqual({
        fields: {
          str: { stringValue: 'hello' },
          int: { integerValue: '42' },
          float: { doubleValue: 3.14 },
          boolTrue: { booleanValue: true },
          boolFalse: { booleanValue: false },
          nothing: { nullValue: null },
          list: {
            arrayValue: {
              values: [
                { stringValue: 'a' },
                { integerValue: '2' },
                { booleanValue: true },
              ],
            },
          },
          nested: {
            mapValue: {
              fields: {
                city: { stringValue: 'Paris' },
                zip: { integerValue: '75001' },
              },
            },
          },
        },
      })
    })

    it('passes through explicit wire-format escape hatches verbatim', async () => {
      mock.onPost(`${ DOCS }/things`).reply(sampleDocumentResource())

      await service.createDocument('things', {
        when: { timestampValue: '2026-01-01T00:00:00Z' },
        spot: { geoPointValue: { latitude: 48.85, longitude: 2.35 } },
        ref: { referenceValue: 'projects/p/databases/(default)/documents/users/def' },
      })

      expect(mock.history[0].body.fields).toEqual({
        when: { timestampValue: '2026-01-01T00:00:00Z' },
        spot: { geoPointValue: { latitude: 48.85, longitude: 2.35 } },
        ref: { referenceValue: 'projects/p/databases/(default)/documents/users/def' },
      })
    })

    it('coerces an explicit integerValue escape hatch to a string', async () => {
      mock.onPost(`${ DOCS }/things`).reply(sampleDocumentResource())

      // A large id passed as a string survives without JS float rounding; the
      // service must String()-normalise it (here it is already a string, but a
      // numeric escape hatch would be stringified the same way).
      await service.createDocument('things', {
        big: { integerValue: '9007199254740993' },
        small: { integerValue: 7 },
      })

      expect(mock.history[0].body.fields.big).toEqual({ integerValue: '9007199254740993' })
      expect(mock.history[0].body.fields.small).toEqual({ integerValue: '7' })
    })

    it('treats a multi-key object as a nested map, not an escape hatch', async () => {
      mock.onPost(`${ DOCS }/things`).reply(sampleDocumentResource())

      // Two keys — even though one is a wire key — must be encoded as a map.
      await service.createDocument('things', { obj: { stringValue: 'x', extra: 1 } })

      expect(mock.history[0].body.fields.obj).toEqual({
        mapValue: {
          fields: {
            stringValue: { stringValue: 'x' },
            extra: { integerValue: '1' },
          },
        },
      })
    })
  })

  describe('field-value decoding (read path)', () => {
    it('decodes every Firestore wire value back into plain JSON', async () => {
      mock.onGet(`${ DOCS }/users/abc`).reply(sampleDocumentResource())

      const result = await service.getDocument('users/abc')

      expect(result.data).toEqual({
        name: 'Alice',
        age: 30,
        score: 1.5,
        active: true,
        deleted: null,
        when: '2026-01-01T00:00:00Z',
        raw: 'aGVsbG8=',
        ref: 'projects/p/databases/(default)/documents/users/def',
        spot: { latitude: 48.85, longitude: 2.35 },
        tags: ['a', 2],
        address: { city: 'Paris' },
      })
    })

    it('preserves unsafe-integer strings rather than losing precision', async () => {
      mock.onGet(`${ DOCS }/users/abc`).reply({
        name: `projects/${ PROJECT_ID }/databases/${ DATABASE_ID }/documents/users/abc`,
        fields: { big: { integerValue: '9007199254740993' } },
      })

      const result = await service.getDocument('users/abc')

      expect(result.data.big).toBe('9007199254740993')
    })

    it('exposes id, path, name and timestamps from the resource', async () => {
      mock.onGet(`${ DOCS }/users/abc`).reply(sampleDocumentResource())

      const result = await service.getDocument('users/abc')

      expect(result).toMatchObject({
        id: 'abc',
        path: 'users/abc',
        name: `projects/${ PROJECT_ID }/databases/${ DATABASE_ID }/documents/users/abc`,
        createTime: '2026-07-01T12:00:00.000000Z',
        updateTime: '2026-07-02T08:30:00.000000Z',
      })
    })
  })

  // ── Documents ──

  describe('createDocument', () => {
    it('posts encoded fields to the collection and returns the plain document', async () => {
      mock.onPost(`${ DOCS }/users`).reply(sampleDocumentResource())

      const result = await service.createDocument('users', { name: 'Alice', age: 30 })

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ DOCS }/users`)
      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].body).toEqual({
        fields: { name: { stringValue: 'Alice' }, age: { integerValue: '30' } },
      })
      expect(result).toMatchObject({ id: 'abc', path: 'users/abc' })
    })

    it('passes an explicit documentId as a query parameter', async () => {
      mock.onPost(`${ DOCS }/users`).reply(sampleDocumentResource())

      await service.createDocument('users', { name: 'Alice' }, 'abc')

      expect(mock.history[0].query).toEqual({ documentId: 'abc' })
    })

    it('encodes each path segment of a subcollection path', async () => {
      mock.onPost(`${ DOCS }/users/a%20b/orders`).reply(sampleDocumentResource())

      await service.createDocument('users/a b/orders', { total: 10 })

      expect(mock.history[0].url).toBe(`${ DOCS }/users/a%20b/orders`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ DOCS }/users`).replyWithError({
        message: 'Conflict',
        body: { error: { message: 'Document already exists', status: 'ALREADY_EXISTS' } },
      })

      await expect(service.createDocument('users', { name: 'Alice' })).rejects.toThrow(
        'Firestore API error: Document already exists (status: ALREADY_EXISTS)'
      )
    })
  })

  describe('getDocument', () => {
    it('gets a document by path', async () => {
      mock.onGet(`${ DOCS }/users/abc`).reply(sampleDocumentResource())

      const result = await service.getDocument('users/abc')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ DOCS }/users/abc`)
      expect(result.data.name).toBe('Alice')
    })

    it('trims and strips surrounding slashes from the path', async () => {
      mock.onGet(`${ DOCS }/users/abc`).reply(sampleDocumentResource())

      await service.getDocument('  /users/abc/  ')

      expect(mock.history[0].url).toBe(`${ DOCS }/users/abc`)
    })

    it('throws a wrapped error when the document is not found', async () => {
      mock.onGet(`${ DOCS }/users/missing`).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'No document to get', status: 'NOT_FOUND' } },
      })

      await expect(service.getDocument('users/missing')).rejects.toThrow(
        'Firestore API error: No document to get (status: NOT_FOUND)'
      )
    })
  })

  describe('updateDocument', () => {
    it('builds an update mask from the data keys and patches the document', async () => {
      mock.onPatch(`${ DOCS }/users/abc?updateMask.fieldPaths=age&updateMask.fieldPaths=active`).reply(sampleDocumentResource())

      await service.updateDocument('users/abc', { age: 31, active: false })

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(
        `${ DOCS }/users/abc?updateMask.fieldPaths=age&updateMask.fieldPaths=active`
      )
      expect(mock.history[0].body).toEqual({
        fields: { age: { integerValue: '31' }, active: { booleanValue: false } },
      })
    })

    it('adds currentDocument.exists=true when mustExist is set', async () => {
      mock
        .onPatch(`${ DOCS }/users/abc?updateMask.fieldPaths=age&currentDocument.exists=true`)
        .reply(sampleDocumentResource())

      await service.updateDocument('users/abc', { age: 31 }, true)

      expect(mock.history[0].url).toBe(
        `${ DOCS }/users/abc?updateMask.fieldPaths=age&currentDocument.exists=true`
      )
    })

    it('escapes non-identifier field paths in the update mask', async () => {
      mock
        .onPatch(`${ DOCS }/users/abc?updateMask.fieldPaths=%60weird+field%60`)
        .reply(sampleDocumentResource())

      await service.updateDocument('users/abc', { 'weird field': 1 })

      // URLSearchParams encodes the backtick-escaped path; space -> '+'.
      expect(mock.history[0].url).toContain('updateMask.fieldPaths=%60weird+field%60')
    })

    it('throws when no fields are provided', async () => {
      await expect(service.updateDocument('users/abc', {})).rejects.toThrow(
        'Data must contain at least one field to update'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock
        .onPatch(`${ DOCS }/users/abc?updateMask.fieldPaths=age&currentDocument.exists=true`)
        .replyWithError({
          message: 'Not Found',
          body: { error: { message: 'No document to update', status: 'NOT_FOUND' } },
        })

      await expect(service.updateDocument('users/abc', { age: 31 }, true)).rejects.toThrow(
        'Firestore API error: No document to update (status: NOT_FOUND)'
      )
    })
  })

  describe('deleteDocument', () => {
    it('deletes a document and returns the normalized path', async () => {
      mock.onDelete(`${ DOCS }/users/abc`).reply({})

      const result = await service.deleteDocument('users/abc')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ DOCS }/users/abc`)
      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ success: true, path: 'users/abc' })
    })

    it('adds currentDocument.exists=true when mustExist is set', async () => {
      mock.onDelete(`${ DOCS }/users/abc`).reply({})

      await service.deleteDocument('users/abc', true)

      expect(mock.history[0].query).toEqual({ 'currentDocument.exists': 'true' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ DOCS }/users/abc`).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'No document to delete', status: 'NOT_FOUND' } },
      })

      await expect(service.deleteDocument('users/abc', true)).rejects.toThrow(
        'Firestore API error: No document to delete (status: NOT_FOUND)'
      )
    })
  })

  describe('listDocuments', () => {
    it('lists documents in a collection and converts them', async () => {
      mock.onGet(`${ DOCS }/users`).reply({
        documents: [sampleDocumentResource()],
        nextPageToken: 'next',
      })

      const result = await service.listDocuments('users')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ DOCS }/users`)
      expect(mock.history[0].query).toEqual({})
      expect(result.documents).toHaveLength(1)
      expect(result.documents[0]).toMatchObject({ id: 'abc', path: 'users/abc' })
      expect(result.nextPageToken).toBe('next')
    })

    it('defaults documents to an empty list and nextPageToken to null', async () => {
      mock.onGet(`${ DOCS }/users`).reply({})

      const result = await service.listDocuments('users')

      expect(result).toEqual({ documents: [], nextPageToken: null })
    })

    it('passes pageSize, pageToken and orderBy as query params', async () => {
      mock.onGet(`${ DOCS }/users`).reply({ documents: [] })

      await service.listDocuments('users', 25, 'cursor', 'age desc, name')

      expect(mock.history[0].query).toEqual({
        pageSize: 25,
        pageToken: 'cursor',
        orderBy: 'age desc, name',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DOCS }/users`).replyWithError({
        message: 'Forbidden',
        body: { error: { message: 'Missing permission', status: 'PERMISSION_DENIED' } },
      })

      await expect(service.listDocuments('users')).rejects.toThrow(
        'Firestore API error: Missing permission (status: PERMISSION_DENIED)'
      )
    })
  })

  describe('batchGetDocuments', () => {
    it('sends resource names and splits found vs missing', async () => {
      const name = `projects/${ PROJECT_ID }/databases/${ DATABASE_ID }/documents/users/abc`

      mock.onPost(`${ DOCS }:batchGet`).reply([
        { found: sampleDocumentResource() },
        { missing: `projects/${ PROJECT_ID }/databases/${ DATABASE_ID }/documents/users/def` },
      ])

      const result = await service.batchGetDocuments(['users/abc', 'users/def'])

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ DOCS }:batchGet`)
      expect(mock.history[0].body).toEqual({
        documents: [
          name,
          `projects/${ PROJECT_ID }/databases/${ DATABASE_ID }/documents/users/def`,
        ],
      })
      expect(result.found).toHaveLength(1)
      expect(result.found[0]).toMatchObject({ id: 'abc' })
      expect(result.missing).toEqual(['users/def'])
    })

    it('handles a fully-missing batch', async () => {
      mock.onPost(`${ DOCS }:batchGet`).reply([
        { missing: `projects/${ PROJECT_ID }/databases/${ DATABASE_ID }/documents/users/x` },
      ])

      const result = await service.batchGetDocuments(['users/x'])

      expect(result).toEqual({ found: [], missing: ['users/x'] })
    })

    it('throws when no paths are provided', async () => {
      await expect(service.batchGetDocuments([])).rejects.toThrow(
        'At least one document path is required'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ DOCS }:batchGet`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Invalid path', status: 'INVALID_ARGUMENT' } },
      })

      await expect(service.batchGetDocuments(['users/abc'])).rejects.toThrow(
        'Firestore API error: Invalid path (status: INVALID_ARGUMENT)'
      )
    })
  })

  // ── Queries ──

  describe('queryDocuments', () => {
    it('runs a root-collection query and returns converted documents', async () => {
      mock.onPost(`${ DOCS }:runQuery`).reply([
        { document: sampleDocumentResource() },
        { readTime: '2026-07-03T10:00:00Z' }, // non-document entry is ignored
      ])

      const result = await service.queryDocuments('users')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ DOCS }:runQuery`)
      expect(mock.history[0].body).toEqual({
        structuredQuery: { from: [{ collectionId: 'users' }] },
      })
      expect(result.count).toBe(1)
      expect(result.documents[0]).toMatchObject({ id: 'abc' })
    })

    it('builds a single field filter with a parsed JSON value', async () => {
      mock.onPost(`${ DOCS }:runQuery`).reply([])

      await service.queryDocuments('users', [{ field: 'age', op: '>=', value: '30' }])

      expect(mock.history[0].body.structuredQuery.where).toEqual({
        fieldFilter: {
          field: { fieldPath: 'age' },
          op: 'GREATER_THAN_OR_EQUAL',
          value: { integerValue: '30' },
        },
      })
    })

    it('combines multiple conditions into a composite AND filter', async () => {
      mock.onPost(`${ DOCS }:runQuery`).reply([])

      await service.queryDocuments('users', [
        { field: 'age', op: '>', value: 21 },
        { field: 'active', op: '==', value: 'true' },
        { field: 'tags', op: 'array-contains', value: 'vip' },
      ])

      expect(mock.history[0].body.structuredQuery.where).toEqual({
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'age' },
                op: 'GREATER_THAN',
                value: { integerValue: '21' },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'active' },
                op: 'EQUAL',
                value: { booleanValue: true },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'tags' },
                op: 'ARRAY_CONTAINS',
                value: { stringValue: 'vip' },
              },
            },
          ],
        },
      })
    })

    it('applies orderBy, direction, limit and allDescendants', async () => {
      mock.onPost(`${ DOCS }:runQuery`).reply([])

      await service.queryDocuments('orders', undefined, 'createdAt', 'Descending', 5, undefined, true)

      expect(mock.history[0].body.structuredQuery).toEqual({
        from: [{ collectionId: 'orders', allDescendants: true }],
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
        limit: 5,
      })
    })

    it('escapes non-identifier field paths in order-by and filters', async () => {
      mock.onPost(`${ DOCS }:runQuery`).reply([])

      await service.queryDocuments(
        'users',
        [{ field: 'address.city', op: '==', value: 'Paris' }],
        'weird field'
      )

      const q = mock.history[0].body.structuredQuery

      expect(q.where.fieldFilter.field.fieldPath).toBe('address.city')
      expect(q.orderBy[0].field.fieldPath).toBe('`weird field`')
    })

    it('targets a subcollection under a parent document path', async () => {
      mock.onPost(`${ DOCS }/users/abc:runQuery`).reply([])

      await service.queryDocuments('orders', undefined, undefined, undefined, undefined, 'users/abc')

      expect(mock.history[0].url).toBe(`${ DOCS }/users/abc:runQuery`)
    })

    it('throws when a condition is missing a field or operator', async () => {
      await expect(
        service.queryDocuments('users', [{ op: '==', value: 'x' }])
      ).rejects.toThrow('Each condition requires a "field" and a valid "op"')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ DOCS }:runQuery`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Requires an index', status: 'FAILED_PRECONDITION' } },
      })

      await expect(service.queryDocuments('users')).rejects.toThrow(
        'Firestore API error: Requires an index (status: FAILED_PRECONDITION)'
      )
    })
  })

  describe('runAggregationQuery', () => {
    it('runs a count aggregation and decodes the result value', async () => {
      mock.onPost(`${ DOCS }:runAggregationQuery`).reply([
        {
          result: { aggregateFields: { result: { integerValue: '42' } } },
          readTime: '2026-07-03T10:00:00.000000Z',
        },
      ])

      const result = await service.runAggregationQuery('users', 'Count')

      expect(mock.history[0].url).toBe(`${ DOCS }:runAggregationQuery`)
      expect(mock.history[0].body).toEqual({
        structuredAggregationQuery: {
          structuredQuery: { from: [{ collectionId: 'users' }] },
          aggregations: [{ alias: 'result', count: {} }],
        },
      })
      expect(result).toEqual({
        aggregation: 'Count',
        value: 42,
        readTime: '2026-07-03T10:00:00.000000Z',
      })
    })

    it('runs a sum aggregation over a numeric field with conditions', async () => {
      mock.onPost(`${ DOCS }:runAggregationQuery`).reply([
        { result: { aggregateFields: { result: { doubleValue: 123.5 } } } },
      ])

      const result = await service.runAggregationQuery('orders', 'Sum', 'price', [
        { field: 'active', op: '==', value: true },
      ])

      expect(mock.history[0].body.structuredAggregationQuery.aggregations).toEqual([
        { alias: 'result', sum: { field: { fieldPath: 'price' } } },
      ])
      expect(mock.history[0].body.structuredAggregationQuery.structuredQuery.where).toEqual({
        fieldFilter: {
          field: { fieldPath: 'active' },
          op: 'EQUAL',
          value: { booleanValue: true },
        },
      })
      expect(result).toEqual({ aggregation: 'Sum', value: 123.5, readTime: null })
    })

    it('maps Average to the avg aggregate function', async () => {
      mock.onPost(`${ DOCS }:runAggregationQuery`).reply([
        { result: { aggregateFields: { result: { doubleValue: 12.5 } } } },
      ])

      await service.runAggregationQuery('orders', 'Average', 'price')

      expect(mock.history[0].body.structuredAggregationQuery.aggregations).toEqual([
        { alias: 'result', avg: { field: { fieldPath: 'price' } } },
      ])
    })

    it('returns a null value when no aggregate entry is present', async () => {
      mock.onPost(`${ DOCS }:runAggregationQuery`).reply([])

      const result = await service.runAggregationQuery('users', 'Count')

      expect(result).toEqual({ aggregation: 'Count', value: null, readTime: null })
    })

    it('throws when the aggregation is empty', async () => {
      // resolveChoice returns undefined only for empty/null input, which is the
      // sole path to the "must be one of" guard.
      await expect(service.runAggregationQuery('users', '')).rejects.toThrow(
        'Aggregation must be one of: Count, Sum, Average'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('treats an unrecognized aggregation name as requiring a field', async () => {
      // An unknown non-empty name passes resolveChoice through unchanged, so it is
      // not "count" and falls into the field-required guard rather than "must be one of".
      await expect(service.runAggregationQuery('users', 'Median')).rejects.toThrow(
        'The "Median" aggregation requires a Field to aggregate'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws when Sum/Average is requested without a field', async () => {
      await expect(service.runAggregationQuery('users', 'Sum')).rejects.toThrow(
        'The "Sum" aggregation requires a Field to aggregate'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ DOCS }:runAggregationQuery`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Invalid aggregation', status: 'INVALID_ARGUMENT' } },
      })

      await expect(service.runAggregationQuery('users', 'Count')).rejects.toThrow(
        'Firestore API error: Invalid aggregation (status: INVALID_ARGUMENT)'
      )
    })
  })

  // ── Collections ──

  describe('listCollectionIds', () => {
    it('lists root collection ids', async () => {
      mock.onPost(`${ DOCS }:listCollectionIds`).reply({
        collectionIds: ['users', 'orders'],
        nextPageToken: 'next',
      })

      const result = await service.listCollectionIds()

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ DOCS }:listCollectionIds`)
      expect(mock.history[0].body).toEqual({})
      expect(result).toEqual({ collectionIds: ['users', 'orders'], nextPageToken: 'next' })
    })

    it('lists subcollection ids under a parent document with pagination', async () => {
      mock.onPost(`${ DOCS }/users/abc:listCollectionIds`).reply({ collectionIds: ['orders'] })

      const result = await service.listCollectionIds('users/abc', 50, 'cursor')

      expect(mock.history[0].url).toBe(`${ DOCS }/users/abc:listCollectionIds`)
      expect(mock.history[0].body).toEqual({ pageSize: 50, pageToken: 'cursor' })
      expect(result).toEqual({ collectionIds: ['orders'], nextPageToken: null })
    })

    it('defaults collectionIds to an empty list', async () => {
      mock.onPost(`${ DOCS }:listCollectionIds`).reply({})

      const result = await service.listCollectionIds()

      expect(result).toEqual({ collectionIds: [], nextPageToken: null })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ DOCS }:listCollectionIds`).replyWithError({
        message: 'Forbidden',
        body: { error: { message: 'Missing permission', status: 'PERMISSION_DENIED' } },
      })

      await expect(service.listCollectionIds()).rejects.toThrow(
        'Firestore API error: Missing permission (status: PERMISSION_DENIED)'
      )
    })
  })

  // ── Dictionaries ──

  describe('getCollectionsDictionary', () => {
    const collectionsResponse = {
      collectionIds: ['users', 'orders', 'reviews'],
      nextPageToken: 'next-cursor',
    }

    it('maps root collection ids to dictionary items and returns the cursor', async () => {
      mock.onPost(`${ DOCS }:listCollectionIds`).reply(collectionsResponse)

      const result = await service.getCollectionsDictionary({})

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ DOCS }:listCollectionIds`)
      expect(mock.history[0].body).toEqual({ pageSize: 300 })
      expect(result).toEqual({
        items: [
          { label: 'users', value: 'users', note: '' },
          { label: 'orders', value: 'orders', note: '' },
          { label: 'reviews', value: 'reviews', note: '' },
        ],
        cursor: 'next-cursor',
      })
    })

    it('filters by search term (case-insensitive)', async () => {
      mock.onPost(`${ DOCS }:listCollectionIds`).reply(collectionsResponse)

      const result = await service.getCollectionsDictionary({ search: 'ER' })

      expect(result.items.map(i => i.value)).toEqual(['users', 'orders'])
    })

    it('passes the cursor as pageToken', async () => {
      mock.onPost(`${ DOCS }:listCollectionIds`).reply({ collectionIds: [] })

      await service.getCollectionsDictionary({ cursor: 'page-2' })

      expect(mock.history[0].body).toEqual({ pageSize: 300, pageToken: 'page-2' })
    })

    it('handles a null payload', async () => {
      mock.onPost(`${ DOCS }:listCollectionIds`).reply({ collectionIds: [] })

      const result = await service.getCollectionsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})
