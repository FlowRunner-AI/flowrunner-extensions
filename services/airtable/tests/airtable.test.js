'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const OAUTH_TOKEN = 'test-oauth-access-token'
const OAUTH_BASE = 'https://airtable.com/oauth2/v1'
const API_BASE = 'https://api.airtable.com/v0'

const BASIC_TOKEN = Buffer.from(`${ CLIENT_ID }:${ CLIENT_SECRET }`).toString('base64')

describe('Airtable Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate OAuth access token header available at runtime
    service.request = { headers: { 'oauth-access-token': OAUTH_TOKEN } }
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
          name: 'clientId',
          required: true,
          shared: true,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'clientSecret',
          required: true,
          shared: true,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── OAuth Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a valid authorization URL with correct params', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`${ OAUTH_BASE }/authorize`)
      expect(url).toContain(`client_id=${ CLIENT_ID }`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('code_challenge_method=S256')
      expect(url).toContain('scope=')
      expect(url).toContain('state=')
      expect(url).toContain('code_challenge=')
    })
  })

  describe('refreshToken', () => {
    it('sends correct request and returns token data', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'new-access-token',
        expirationInSeconds: 3600,
        refreshToken: 'new-refresh-token',
      })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Basic ${ BASIC_TOKEN }`,
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
    })

    it('keeps original refresh token when none returned', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).reply({
        access_token: 'new-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('keep-this-token')

      expect(result.refreshToken).toBe('keep-this-token')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).replyWithError({ message: 'Invalid grant' })

      await expect(service.refreshToken('bad-token')).rejects.toThrow()
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches user info', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      })
      mock.onGet(`${ API_BASE }/meta/whoami`).reply({
        id: 'usr123',
        email: 'test@example.com',
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://example.com/callback',
        state: 'code-verifier-value',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        expirationInSeconds: 3600,
        refreshToken: 'new-refresh-token',
        connectionIdentityName: 'test@example.com',
        connectionIdentityImageURL: null,
        overwrite: true,
        userData: { id: 'usr123', email: 'test@example.com' },
      })

      // Verify token exchange request
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Basic ${ BASIC_TOKEN }`,
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain('code=auth-code')

      // Verify whoami request uses the new access token
      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer new-access-token',
      })
    })

    it('returns empty object when token exchange fails', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).replyWithError({ message: 'Bad request' })

      const result = await service.executeCallback({
        code: 'bad-code',
        redirectURI: 'https://example.com/callback',
        state: 'verifier',
      })

      expect(result).toEqual({})
    })

    it('returns empty object when whoami fails', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).reply({
        access_token: 'token',
        expires_in: 3600,
        refresh_token: 'rt',
      })
      mock.onGet(`${ API_BASE }/meta/whoami`).replyWithError({ message: 'Unauthorized' })

      const result = await service.executeCallback({
        code: 'code',
        redirectURI: 'https://example.com/callback',
        state: 'verifier',
      })

      expect(result).toEqual({})
    })

    it('uses "Unknown Airtable Account" when email is missing', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).reply({
        access_token: 'token',
        expires_in: 3600,
        refresh_token: 'rt',
      })
      mock.onGet(`${ API_BASE }/meta/whoami`).reply({ id: 'usr123' })

      const result = await service.executeCallback({
        code: 'code',
        redirectURI: 'https://example.com/callback',
        state: 'verifier',
      })

      expect(result.connectionIdentityName).toBe('Unknown Airtable Account')
    })
  })

  // ── Bases ──

  describe('getBases', () => {
    it('returns list of bases', async () => {
      const bases = [
        { id: 'app1', name: 'Base 1', permissionLevel: 'create' },
        { id: 'app2', name: 'Base 2', permissionLevel: 'edit' },
      ]

      mock.onGet(`${ API_BASE }/meta/bases`).reply({ bases })

      const result = await service.getBases()

      expect(result).toEqual(bases)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ OAUTH_TOKEN }`,
      })
    })
  })

  describe('getBaseSchema', () => {
    it('returns schema for specified base', async () => {
      const schema = { tables: [{ id: 'tbl1', name: 'Table1' }] }

      mock.onGet(`${ API_BASE }/meta/bases/app123/tables`).reply(schema)

      const result = await service.getBaseSchema('app123')

      expect(result).toEqual(schema)
    })
  })

  describe('createBase', () => {
    it('sends POST with correct body', async () => {
      const tables = [{ name: 'Tasks', fields: [{ name: 'Name', type: 'singleLineText' }] }]
      const response = { id: 'appNew', tables }

      mock.onPost(`${ API_BASE }/meta/bases`).reply(response)

      const result = await service.createBase('My Base', tables, 'wsp123')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({
        name: 'My Base',
        tables,
        workspaceId: 'wsp123',
      })
    })

    it('defaults tables to empty array when not an array', async () => {
      mock.onPost(`${ API_BASE }/meta/bases`).reply({ id: 'appNew', tables: [] })

      await service.createBase('My Base', 'not-an-array', 'wsp123')

      expect(mock.history[0].body.tables).toEqual([])
    })
  })

  // ── Tables ──

  describe('createTable', () => {
    it('sends POST with correct body', async () => {
      const fields = [{ name: 'Name', type: 'singleLineText' }]
      const response = { id: 'tbl1', name: 'Tasks', fields }

      mock.onPost(`${ API_BASE }/meta/bases/app123/tables`).reply(response)

      const result = await service.createTable('app123', 'Tasks', 'A task tracker', fields)

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({
        name: 'Tasks',
        description: 'A task tracker',
        fields,
      })
    })

    it('uses empty string for description when not provided', async () => {
      mock.onPost(`${ API_BASE }/meta/bases/app123/tables`).reply({ id: 'tbl1' })

      await service.createTable('app123', 'Tasks', undefined, [])

      expect(mock.history[0].body.description).toBe('')
    })

    it('defaults fields to empty array when not an array', async () => {
      mock.onPost(`${ API_BASE }/meta/bases/app123/tables`).reply({ id: 'tbl1' })

      await service.createTable('app123', 'Tasks', '', 'not-array')

      expect(mock.history[0].body.fields).toEqual([])
    })
  })

  describe('updateTable', () => {
    it('sends PATCH with name and description', async () => {
      mock.onPatch(`${ API_BASE }/meta/bases/app123/tables/tbl1`).reply({
        id: 'tbl1',
        name: 'New Name',
        description: 'New Desc',
        fields: [{ id: 'fld1' }],
      })

      const result = await service.updateTable('app123', 'tbl1', 'New Name', 'New Desc')

      expect(result).toEqual({ id: 'tbl1', name: 'New Name', description: 'New Desc' })
      expect(result).not.toHaveProperty('fields')
      expect(mock.history[0].body).toEqual({ name: 'New Name', description: 'New Desc' })
    })

    it('omits name when not provided', async () => {
      mock.onPatch(`${ API_BASE }/meta/bases/app123/tables/tbl1`).reply({
        id: 'tbl1',
        description: 'Updated Desc',
      })

      await service.updateTable('app123', 'tbl1', undefined, 'Updated Desc')

      expect(mock.history[0].body).toEqual({ description: 'Updated Desc' })
      expect(mock.history[0].body).not.toHaveProperty('name')
    })

    it('omits description when not provided', async () => {
      mock.onPatch(`${ API_BASE }/meta/bases/app123/tables/tbl1`).reply({
        id: 'tbl1',
        name: 'New Name',
      })

      await service.updateTable('app123', 'tbl1', 'New Name', undefined)

      expect(mock.history[0].body).toEqual({ name: 'New Name' })
      expect(mock.history[0].body).not.toHaveProperty('description')
    })
  })

  // ── Records ──

  describe('findRecords', () => {
    it('sends GET with no filters by default', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({ records: [] })

      const result = await service.findRecords('app123', 'tbl1')

      expect(result).toEqual([])
      expect(mock.history[0].query).toEqual({})
    })

    it('uses exact match formula when exactMatch is true', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({ records: [{ id: 'rec1' }] })

      await service.findRecords('app123', 'tbl1', 'Name', 'John', true)

      expect(mock.history[0].query).toMatchObject({
        filterByFormula: '{Name} = "John"',
      })
    })

    it('uses SEARCH formula when exactMatch is false', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({ records: [{ id: 'rec1' }] })

      await service.findRecords('app123', 'tbl1', 'Name', 'John', false)

      expect(mock.history[0].query).toMatchObject({
        filterByFormula: "SEARCH('John', {Name} & \"\") > 0",
      })
    })

    it('uses searchFormula when provided (overrides field search)', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({ records: [] })

      await service.findRecords('app123', 'tbl1', 'Name', 'John', true, 'AND({Status}="Active")')

      expect(mock.history[0].query).toMatchObject({
        filterByFormula: 'AND({Status}="Active")',
      })
    })

    it('passes maxRecords when provided', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({ records: [] })

      await service.findRecords('app123', 'tbl1', null, null, null, null, 10)

      expect(mock.history[0].query).toMatchObject({ maxRecords: 10 })
    })
  })

  describe('findRecord', () => {
    it('returns first matching record', async () => {
      const record = { id: 'rec1', fields: { Name: 'John' } }

      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({ records: [record] })

      const result = await service.findRecord('app123', 'tbl1', 'Name', 'John', true)

      expect(result).toEqual(record)
      expect(mock.history[0].query).toMatchObject({ maxRecords: 1 })
    })

    it('returns undefined when no records found', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({ records: [] })

      const result = await service.findRecord('app123', 'tbl1', 'Name', 'Nobody', true)

      expect(result).toBeUndefined()
    })
  })

  describe('createRecord', () => {
    it('sends POST with fields wrapped in body', async () => {
      const fields = { Name: 'Test', Email: 'test@example.com' }
      const response = { id: 'recNew', fields, createdTime: '2022-01-01T00:00:00.000Z' }

      mock.onPost(`${ API_BASE }/app123/tbl1`).reply(response)

      const result = await service.createRecord('app123', 'tbl1', fields)

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ fields })
    })
  })

  describe('createRecords', () => {
    it('wraps each field object in a records array', async () => {
      const recordFields = [
        { Name: 'Alice' },
        { Name: 'Bob' },
      ]
      const response = {
        records: [
          { id: 'rec1', fields: { Name: 'Alice' } },
          { id: 'rec2', fields: { Name: 'Bob' } },
        ],
      }

      mock.onPost(`${ API_BASE }/app123/tbl1`).reply(response)

      const result = await service.createRecords('app123', 'tbl1', recordFields)

      expect(result).toEqual(response.records)
      expect(mock.history[0].body).toEqual({
        records: [
          { fields: { Name: 'Alice' } },
          { fields: { Name: 'Bob' } },
        ],
      })
    })
  })

  describe('updateRecord', () => {
    it('sends PATCH with fields', async () => {
      const fields = { Name: 'Updated' }
      const response = { id: 'rec1', fields, createdTime: '2022-01-01T00:00:00.000Z' }

      mock.onPatch(`${ API_BASE }/app123/tbl1/rec1`).reply(response)

      const result = await service.updateRecord('app123', 'tbl1', 'rec1', fields)

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ fields })
    })
  })

  describe('createOrUpdateRecord', () => {
    it('updates existing record when exactly one match found', async () => {
      // findRecords returns exactly 1 record
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({
        records: [{ id: 'rec1', fields: { Name: 'Existing' } }],
      })
      // updateRecord
      mock.onPatch(`${ API_BASE }/app123/tbl1/rec1`).reply({
        id: 'rec1',
        fields: { Name: 'Updated' },
      })

      const result = await service.createOrUpdateRecord(
        'app123', 'tbl1', 'Name', null, { Name: 'Updated' }
      )

      expect(result).toMatchObject({ id: 'rec1', isNew: false })
    })

    it('creates new record when no match found', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({ records: [] })
      mock.onPost(`${ API_BASE }/app123/tbl1`).reply({
        id: 'recNew',
        fields: { Name: 'New' },
      })

      const result = await service.createOrUpdateRecord(
        'app123', 'tbl1', 'Name', null, { Name: 'New' }
      )

      expect(result).toMatchObject({ id: 'recNew', isNew: true })
    })

    it('creates new record when multiple matches found', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({
        records: [{ id: 'rec1' }, { id: 'rec2' }],
      })
      mock.onPost(`${ API_BASE }/app123/tbl1`).reply({
        id: 'recNew',
        fields: { Name: 'Ambiguous' },
      })

      const result = await service.createOrUpdateRecord(
        'app123', 'tbl1', 'Name', null, { Name: 'Ambiguous' }
      )

      expect(result).toMatchObject({ isNew: true })
    })

    it('uses compound formula with secondary lookup field', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({ records: [] })
      mock.onPost(`${ API_BASE }/app123/tbl1`).reply({
        id: 'recNew',
        fields: { Name: 'John', Email: 'john@test.com' },
      })

      await service.createOrUpdateRecord(
        'app123', 'tbl1', 'Name', 'Email', { Name: 'John', Email: 'john@test.com' }
      )

      expect(mock.history[0].query).toMatchObject({
        filterByFormula: 'AND({Name} = "John", {Email} = "john@test.com")',
      })
    })

    it('throws when lookupField is falsy', async () => {
      await expect(
        service.createOrUpdateRecord('app123', 'tbl1', '', null, { Name: 'Test' })
      ).rejects.toThrow('Lookup field is required')
    })

    it('throws when fields object does not contain lookup field value', async () => {
      await expect(
        service.createOrUpdateRecord('app123', 'tbl1', 'Name', null, { Email: 'test@test.com' })
      ).rejects.toThrow('Fields object must contain value by the lookupField="Name"')
    })
  })

  describe('deleteRecord', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${ API_BASE }/app123/tbl1/rec1`).reply({ deleted: true, id: 'rec1' })

      const result = await service.deleteRecord('app123', 'tbl1', 'rec1')

      expect(result).toEqual({ deleted: true, id: 'rec1' })
    })
  })

  describe('deleteRecords', () => {
    it('sends DELETE with record IDs in query string', async () => {
      const response = {
        records: [
          { deleted: true, id: 'rec1' },
          { deleted: true, id: 'rec2' },
        ],
      }

      mock.onDelete(`${ API_BASE }/app123/tbl1?records[]=rec1&records[]=rec2`).reply(response)

      const result = await service.deleteRecords('app123', 'tbl1', ['rec1', 'rec2'])

      expect(result).toEqual(response.records)
    })

    it('throws when recordIds is empty array', async () => {
      await expect(
        service.deleteRecords('app123', 'tbl1', [])
      ).rejects.toThrow('No record IDs provided for deletion.')
    })

    it('defaults to empty array and throws when recordIds is not an array', async () => {
      await expect(
        service.deleteRecords('app123', 'tbl1', 'not-array')
      ).rejects.toThrow('No record IDs provided for deletion.')
    })
  })

  // ── Comments ──

  describe('getLatestComments', () => {
    it('returns comments for a record', async () => {
      const comments = [
        { id: 'com1', text: 'Hello', author: { email: 'user@test.com' } },
      ]

      mock.onGet(`${ API_BASE }/app123/tbl1/rec1/comments`).reply({ comments })

      const result = await service.getLatestComments('app123', 'tbl1', 'rec1')

      expect(result).toEqual(comments)
    })
  })

  describe('createComment', () => {
    it('sends POST with text body', async () => {
      const response = { id: 'com1', text: 'New comment' }

      mock.onPost(`${ API_BASE }/app123/tbl1/rec1/comments`).reply(response)

      const result = await service.createComment('app123', 'tbl1', 'rec1', 'New comment')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ text: 'New comment' })
    })
  })

  describe('updateComment', () => {
    it('sends PATCH with new text', async () => {
      const response = { id: 'com1', text: 'Updated text' }

      mock.onPatch(`${ API_BASE }/app123/tbl1/rec1/comments/com1`).reply(response)

      const result = await service.updateComment('app123', 'tbl1', 'rec1', 'com1', 'Updated text')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ text: 'Updated text' })
    })
  })

  describe('deleteComment', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${ API_BASE }/app123/tbl1/rec1/comments/com1`).reply({ deleted: true, id: 'com1' })

      const result = await service.deleteComment('app123', 'tbl1', 'rec1', 'com1')

      expect(result).toEqual({ deleted: true, id: 'com1' })
    })

    it('throws when commentId is falsy', async () => {
      await expect(
        service.deleteComment('app123', 'tbl1', 'rec1', '')
      ).rejects.toThrow('No comment ID provided for deletion.')
    })
  })

  // ── Dictionaries ──

  describe('getBasesDictionary', () => {
    it('returns formatted bases with pagination cursor', async () => {
      mock.onGet(`${ API_BASE }/meta/bases`).reply({
        bases: [
          { id: 'app1', name: 'My Base' },
          { id: 'app2', name: 'Other Base' },
        ],
        offset: 'next-page',
      })

      const result = await service.getBasesDictionary({ search: undefined, cursor: undefined })

      expect(result).toEqual({
        cursor: 'next-page',
        items: [
          { label: 'My Base', note: 'ID: app1', value: 'app1' },
          { label: 'Other Base', note: 'ID: app2', value: 'app2' },
        ],
      })
    })

    it('filters bases by search string', async () => {
      mock.onGet(`${ API_BASE }/meta/bases`).reply({
        bases: [
          { id: 'app1', name: 'My Base' },
          { id: 'app2', name: 'Other Base' },
        ],
      })

      const result = await service.getBasesDictionary({ search: 'other' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('app2')
    })

    it('passes cursor as offset query param', async () => {
      mock.onGet(`${ API_BASE }/meta/bases`).reply({ bases: [] })

      await service.getBasesDictionary({ cursor: 'page2' })

      expect(mock.history[0].query).toMatchObject({ offset: 'page2' })
    })

    it('uses [empty] label when name is missing', async () => {
      mock.onGet(`${ API_BASE }/meta/bases`).reply({
        bases: [{ id: 'app1', name: '' }],
      })

      const result = await service.getBasesDictionary({})

      expect(result.items[0].label).toBe('[empty]')
    })
  })

  describe('getTablesDictionary', () => {
    it('returns formatted tables', async () => {
      mock.onGet(`${ API_BASE }/meta/bases/app123/tables`).reply({
        tables: [
          { id: 'tbl1', name: 'Tasks' },
          { id: 'tbl2', name: 'People' },
        ],
      })

      const result = await service.getTablesDictionary({
        search: undefined,
        criteria: { baseId: 'app123' },
      })

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({ label: 'Tasks', note: 'ID: tbl1', value: 'tbl1' })
    })

    it('filters tables by search', async () => {
      mock.onGet(`${ API_BASE }/meta/bases/app123/tables`).reply({
        tables: [
          { id: 'tbl1', name: 'Tasks' },
          { id: 'tbl2', name: 'People' },
        ],
      })

      const result = await service.getTablesDictionary({
        search: 'task',
        criteria: { baseId: 'app123' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('tbl1')
    })
  })

  describe('getFieldsDictionary', () => {
    it('returns fields for specified table', async () => {
      mock.onGet(`${ API_BASE }/meta/bases/app123/tables`).reply({
        tables: [
          {
            id: 'tbl1',
            name: 'Tasks',
            fields: [
              { id: 'fld1', name: 'Name' },
              { id: 'fld2', name: 'Status' },
            ],
          },
        ],
      })

      const result = await service.getFieldsDictionary({
        search: undefined,
        criteria: { baseId: 'app123', tableIdOrName: 'tbl1' },
      })

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({ label: 'Name', note: 'ID: fld1', value: 'Name' })
    })

    it('filters fields by search', async () => {
      mock.onGet(`${ API_BASE }/meta/bases/app123/tables`).reply({
        tables: [
          {
            id: 'tbl1',
            fields: [
              { id: 'fld1', name: 'Name' },
              { id: 'fld2', name: 'Status' },
            ],
          },
        ],
      })

      const result = await service.getFieldsDictionary({
        search: 'stat',
        criteria: { baseId: 'app123', tableIdOrName: 'tbl1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('Status')
    })
  })

  describe('getLastModifiedColumnsDictionary', () => {
    it('returns only lastModifiedTime fields', async () => {
      mock.onGet(`${ API_BASE }/meta/bases/app123/tables`).reply({
        tables: [
          {
            id: 'tbl1',
            fields: [
              { id: 'fld1', name: 'Name', type: 'singleLineText' },
              { id: 'fld2', name: 'Last Modified', type: 'lastModifiedTime' },
              { id: 'fld3', name: 'Updated At', type: 'lastModifiedTime' },
            ],
          },
        ],
      })

      const result = await service.getLastModifiedColumnsDictionary({
        search: undefined,
        criteria: { baseId: 'app123', tableIdOrName: 'tbl1' },
      })

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: 'Last Modified',
        note: 'ID: fld2',
        value: 'Last Modified',
      })
    })

    it('filters lastModifiedTime fields by search', async () => {
      mock.onGet(`${ API_BASE }/meta/bases/app123/tables`).reply({
        tables: [
          {
            id: 'tbl1',
            fields: [
              { id: 'fld2', name: 'Last Modified', type: 'lastModifiedTime' },
              { id: 'fld3', name: 'Updated At', type: 'lastModifiedTime' },
            ],
          },
        ],
      })

      const result = await service.getLastModifiedColumnsDictionary({
        search: 'updated',
        criteria: { baseId: 'app123', tableIdOrName: 'tbl1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('Updated At')
    })
  })

  describe('getRecordsDictionary', () => {
    it('returns formatted records', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({
        records: [
          { id: 'rec1' },
          { id: 'rec2' },
        ],
      })

      const result = await service.getRecordsDictionary({
        search: undefined,
        criteria: { baseId: 'app123', tableIdOrName: 'tbl1' },
      })

      expect(result.items).toEqual([
        { label: 'rec1', note: 'ID: rec1', value: 'rec1' },
        { label: 'rec2', note: 'ID: rec2', value: 'rec2' },
      ])
    })

    it('filters records by search on id', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({
        records: [{ id: 'recABC' }, { id: 'recXYZ' }],
      })

      const result = await service.getRecordsDictionary({
        search: 'xyz',
        criteria: { baseId: 'app123', tableIdOrName: 'tbl1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('recXYZ')
    })
  })

  describe('getCommentsDictionary', () => {
    it('returns formatted comments with pagination', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1/rec1/comments`).reply({
        comments: [
          { id: 'com1', text: 'Hello world' },
          { id: 'com2', text: 'Another comment' },
        ],
        offset: 'next-cursor',
      })

      const result = await service.getCommentsDictionary({
        search: undefined,
        cursor: undefined,
        criteria: { baseId: 'app123', tableIdOrName: 'tbl1', recordId: 'rec1' },
      })

      expect(result.cursor).toBe('next-cursor')
      expect(result.items).toEqual([
        { label: 'Hello world', note: 'ID: com1', value: 'com1' },
        { label: 'Another comment', note: 'ID: com2', value: 'com2' },
      ])
      expect(mock.history[0].query).toMatchObject({ pageSize: 100 })
    })

    it('filters comments by search', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1/rec1/comments`).reply({
        comments: [
          { id: 'com1', text: 'Hello world' },
          { id: 'com2', text: 'Goodbye' },
        ],
      })

      const result = await service.getCommentsDictionary({
        search: 'hello',
        criteria: { baseId: 'app123', tableIdOrName: 'tbl1', recordId: 'rec1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('com1')
    })

    it('uses [empty] label when text is missing', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1/rec1/comments`).reply({
        comments: [{ id: 'com1', text: '' }],
      })

      const result = await service.getCommentsDictionary({
        criteria: { baseId: 'app123', tableIdOrName: 'tbl1', recordId: 'rec1' },
      })

      expect(result.items[0].label).toBe('[empty]')
    })
  })

  // ── Triggers ──

  describe('handleTriggerPollingForEvent', () => {
    it('delegates to the method named by eventName', async () => {
      mock.onGet(`${ API_BASE }/meta/bases/app123/tables`).reply({
        tables: [{
          id: 'tbl1',
          fields: [{ name: 'Created', type: 'createdTime' }],
        }],
      })
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({
        records: [{ id: 'rec1', fields: { Created: '2022-01-01' } }],
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewRecord',
        triggerData: { baseId: 'app123', tableIdOrName: 'tbl1' },
        learningMode: false,
        state: null,
      })

      // First invocation without state initializes with empty events
      expect(result.events).toEqual([])
      expect(result.state).toHaveProperty('records')
    })
  })

  describe('onNewOrUpdatedRecord', () => {
    const baseInvocation = {
      eventName: 'onNewOrUpdatedRecord',
      triggerData: {
        baseId: 'app123',
        tableIdOrName: 'tbl1',
        lastModifiedColumn: 'Modified',
      },
    }

    it('returns first record in learning mode', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({
        records: [
          { id: 'rec1', fields: { Modified: '2022-01-02' } },
          { id: 'rec2', fields: { Modified: '2022-01-01' } },
        ],
      })

      const result = await service.onNewOrUpdatedRecord({
        ...baseInvocation,
        learningMode: true,
        state: null,
      })

      expect(result.events).toEqual([{ id: 'rec1', fields: { Modified: '2022-01-02' } }])
      expect(result.state).toBeNull()
    })

    it('initializes state with empty events on first run', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({
        records: [{ id: 'rec1', fields: { Modified: '2022-01-01' } }],
      })

      const result = await service.onNewOrUpdatedRecord({
        ...baseInvocation,
        learningMode: false,
        state: null,
      })

      expect(result.events).toEqual([])
      expect(result.state.records).toHaveLength(1)
    })

    it('detects new records compared to previous state', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({
        records: [
          { id: 'rec1', fields: { Modified: '2022-01-01' } },
          { id: 'rec2', fields: { Modified: '2022-01-02' } },
        ],
      })

      const result = await service.onNewOrUpdatedRecord({
        ...baseInvocation,
        learningMode: false,
        state: {
          records: [{ id: 'rec1', fields: { Modified: '2022-01-01' } }],
        },
      })

      expect(result.events).toEqual([{ id: 'rec2', fields: { Modified: '2022-01-02' } }])
    })

    it('detects updated records by comparing lastModifiedColumn', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({
        records: [
          { id: 'rec1', fields: { Modified: '2022-01-03' } },
        ],
      })

      const result = await service.onNewOrUpdatedRecord({
        ...baseInvocation,
        learningMode: false,
        state: {
          records: [{ id: 'rec1', fields: { Modified: '2022-01-01' } }],
        },
      })

      expect(result.events).toEqual([{ id: 'rec1', fields: { Modified: '2022-01-03' } }])
    })

    it('returns no events when nothing changed', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({
        records: [{ id: 'rec1', fields: { Modified: '2022-01-01' } }],
      })

      const result = await service.onNewOrUpdatedRecord({
        ...baseInvocation,
        learningMode: false,
        state: {
          records: [{ id: 'rec1', fields: { Modified: '2022-01-01' } }],
        },
      })

      expect(result.events).toEqual([])
    })

    it('sends sort query params', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({ records: [] })

      await service.onNewOrUpdatedRecord({
        ...baseInvocation,
        learningMode: false,
        state: null,
      })

      expect(mock.history[0].query).toMatchObject({
        'sort[0][field]': 'Modified',
        'sort[0][direction]': 'desc',
      })
    })
  })

  describe('onNewRecord', () => {
    it('initializes state on first run', async () => {
      // getCreatedColumnName call
      mock.onGet(`${ API_BASE }/meta/bases/app123/tables`).reply({
        tables: [{
          id: 'tbl1',
          fields: [
            { name: 'Name', type: 'singleLineText' },
            { name: 'Created', type: 'createdTime' },
          ],
        }],
      })
      // getLatestRecords call
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({
        records: [{ id: 'rec1', fields: { Created: '2022-01-01' } }],
      })

      const result = await service.onNewRecord({
        eventName: 'onNewRecord',
        triggerData: { baseId: 'app123', tableIdOrName: 'tbl1' },
        learningMode: false,
        state: null,
      })

      expect(result.events).toEqual([])
      expect(result.state.records).toHaveLength(1)
    })

    it('returns first record in learning mode', async () => {
      mock.onGet(`${ API_BASE }/meta/bases/app123/tables`).reply({
        tables: [{
          id: 'tbl1',
          fields: [{ name: 'Created', type: 'createdTime' }],
        }],
      })
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({
        records: [{ id: 'rec1', fields: { Created: '2022-01-01' } }],
      })

      const result = await service.onNewRecord({
        eventName: 'onNewRecord',
        triggerData: { baseId: 'app123', tableIdOrName: 'tbl1' },
        learningMode: true,
        state: null,
      })

      expect(result.events).toHaveLength(1)
      expect(result.state).toBeNull()
    })

    it('detects new records by ID comparison', async () => {
      mock.onGet(`${ API_BASE }/meta/bases/app123/tables`).reply({
        tables: [{
          id: 'tbl1',
          fields: [{ name: 'Created', type: 'createdTime' }],
        }],
      })
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({
        records: [
          { id: 'rec1', fields: {} },
          { id: 'rec2', fields: {} },
        ],
      })

      const result = await service.onNewRecord({
        eventName: 'onNewRecord',
        triggerData: { baseId: 'app123', tableIdOrName: 'tbl1' },
        learningMode: false,
        state: { records: [{ id: 'rec1' }] },
      })

      expect(result.events).toEqual([{ id: 'rec2', fields: {} }])
    })

    it('throws when table has no createdTime column', async () => {
      mock.onGet(`${ API_BASE }/meta/bases/app123/tables`).reply({
        tables: [{
          id: 'tbl1',
          fields: [{ name: 'Name', type: 'singleLineText' }],
        }],
      })

      await expect(
        service.onNewRecord({
          eventName: 'onNewRecord',
          triggerData: { baseId: 'app123', tableIdOrName: 'tbl1' },
          learningMode: false,
          state: null,
        })
      ).rejects.toThrow('There is no a column with type "createdTime"')
    })
  })

  // ── Sample Result Loader ──

  describe('onNewOrUpdatedRecord_SampleResultLoader', () => {
    it('returns first record with missing fields filled as null', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({
        records: [{ id: 'rec1', fields: { Name: 'Test' }, createdTime: '2022-01-01' }],
      })
      mock.onGet(`${ API_BASE }/meta/bases/app123/tables`).reply({
        tables: [{
          id: 'tbl1',
          name: 'Tasks',
          fields: [
            { name: 'Name', type: 'singleLineText' },
            { name: 'Status', type: 'singleLineText' },
          ],
        }],
      })

      const result = await service.onNewOrUpdatedRecord_SampleResultLoader({
        criteria: { baseId: 'app123', tableIdOrName: 'tbl1' },
      })

      expect(result.fields.Name).toBe('Test')
      expect(result.fields.Status).toBeNull()
    })

    it('returns empty object when no records exist', async () => {
      mock.onGet(`${ API_BASE }/app123/tbl1`).reply({ records: [] })

      const result = await service.onNewOrUpdatedRecord_SampleResultLoader({
        criteria: { baseId: 'app123', tableIdOrName: 'tbl1' },
      })

      expect(result).toEqual({})
    })
  })

  // ── Error Handling ──

  describe('API error handling', () => {
    it('throws ResponseError with structured error body (object)', async () => {
      mock.onGet(`${ API_BASE }/meta/bases`).replyWithError({
        message: 'Bad Request',
        body: {
          error: { type: 'INVALID_REQUEST', message: 'Invalid base ID' },
        },
        status: 400,
      })

      await expect(service.getBases()).rejects.toThrow('[AirtableError]: Invalid base ID')
    })

    it('throws ResponseError with string error body', async () => {
      mock.onGet(`${ API_BASE }/meta/bases`).replyWithError({
        message: 'Unauthorized',
        body: {
          error: 'UNAUTHORIZED',
        },
        status: 401,
      })

      await expect(service.getBases()).rejects.toThrow('[AirtableError]: UNAUTHORIZED')
    })

    it('throws original error when no error body', async () => {
      mock.onGet(`${ API_BASE }/meta/bases`).replyWithError({
        message: 'Network Error',
      })

      await expect(service.getBases()).rejects.toThrow('Network Error')
    })
  })
})
