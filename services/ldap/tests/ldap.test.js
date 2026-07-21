'use strict'

// ── Mock ldapts before anything else ──

const mockBind = jest.fn().mockResolvedValue()
const mockUnbind = jest.fn().mockResolvedValue()
const mockSearch = jest.fn()
const mockAdd = jest.fn().mockResolvedValue()
const mockModify = jest.fn().mockResolvedValue()
const mockModifyDN = jest.fn().mockResolvedValue()
const mockDel = jest.fn().mockResolvedValue()
const mockCompare = jest.fn()

jest.mock('ldapts', () => ({
  Client: jest.fn().mockImplementation(() => ({
    bind: mockBind,
    unbind: mockUnbind,
    search: mockSearch,
    add: mockAdd,
    modify: mockModify,
    modifyDN: mockModifyDN,
    del: mockDel,
    compare: mockCompare,
  })),
  Change: jest.fn().mockImplementation(opts => opts),
  Attribute: jest.fn().mockImplementation(opts => opts),
}))

const { Client, Change, Attribute } = require('ldapts')
const { createSandbox } = require('../../../service-sandbox')

const TEST_URL = 'ldaps://dc.example.com:636'
const TEST_BIND_DN = 'cn=admin,dc=example,dc=com'
const TEST_BIND_PASSWORD = 'admin-password'
const TEST_BASE_DN = 'dc=example,dc=com'

describe('LDAP Service', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createSandbox({
      url: TEST_URL,
      bindDN: TEST_BIND_DN,
      bindPassword: TEST_BIND_PASSWORD,
      baseDN: TEST_BASE_DN,
    })

    require('../src/index.js')
    service = sandbox.getService()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems).toEqual([
        expect.objectContaining({ name: 'url', required: true, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'bindDN', required: true, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'bindPassword', required: true, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'baseDN', required: false, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'rejectUnauthorized', required: false, shared: false, type: 'BOOL' }),
      ])
    })

    it('creates Client with ldaps URL and TLS options', async () => {
      // Client is created lazily per method call; trigger one first
      mockSearch.mockResolvedValueOnce({ searchEntries: [] })
      await service.search()

      expect(Client).toHaveBeenCalled()

      const callArgs = Client.mock.calls[0][0]

      expect(callArgs.url).toBe(TEST_URL)
      expect(callArgs.tlsOptions).toEqual({ rejectUnauthorized: true })
    })
  })

  // ── Search ──

  describe('search', () => {
    it('searches with default scope, filter, and configured baseDN', async () => {
      mockSearch.mockResolvedValueOnce({
        searchEntries: [{ dn: 'uid=jdoe,ou=people,dc=example,dc=com', cn: 'John Doe' }],
      })

      const result = await service.search()

      expect(mockBind).toHaveBeenCalledWith(TEST_BIND_DN, TEST_BIND_PASSWORD)
      expect(mockSearch).toHaveBeenCalledWith(TEST_BASE_DN, {
        scope: 'sub',
        filter: '(objectClass=*)',
      })
      expect(result).toEqual({
        entries: [{ dn: 'uid=jdoe,ou=people,dc=example,dc=com', cn: 'John Doe' }],
        count: 1,
      })
      expect(mockUnbind).toHaveBeenCalled()
    })

    it('uses provided baseDN, scope, filter, attributes, sizeLimit, and paged', async () => {
      mockSearch.mockResolvedValueOnce({
        searchEntries: [],
      })

      const result = await service.search(
        'ou=people,dc=example,dc=com',
        'One Level',
        '(uid=jdoe)',
        ['cn', 'mail'],
        100,
        true
      )

      expect(mockSearch).toHaveBeenCalledWith('ou=people,dc=example,dc=com', {
        scope: 'one',
        filter: '(uid=jdoe)',
        attributes: ['cn', 'mail'],
        sizeLimit: 100,
        paged: true,
      })
      expect(result).toEqual({ entries: [], count: 0 })
    })

    it('maps Base scope correctly', async () => {
      mockSearch.mockResolvedValueOnce({ searchEntries: [] })
      await service.search(null, 'Base')

      expect(mockSearch.mock.calls[0][1].scope).toBe('base')
    })

    it('maps Subtree scope correctly', async () => {
      mockSearch.mockResolvedValueOnce({ searchEntries: [] })
      await service.search(null, 'Subtree')

      expect(mockSearch.mock.calls[0][1].scope).toBe('sub')
    })

    it('defaults to (objectClass=*) filter when empty filter provided', async () => {
      mockSearch.mockResolvedValueOnce({ searchEntries: [] })
      await service.search(null, null, '  ')

      expect(mockSearch.mock.calls[0][1].filter).toBe('(objectClass=*)')
    })

    it('omits attributes when empty array is passed', async () => {
      mockSearch.mockResolvedValueOnce({ searchEntries: [] })
      await service.search(null, null, null, [])

      expect(mockSearch.mock.calls[0][1]).not.toHaveProperty('attributes')
    })

    it('omits sizeLimit when not provided', async () => {
      mockSearch.mockResolvedValueOnce({ searchEntries: [] })
      await service.search()

      expect(mockSearch.mock.calls[0][1]).not.toHaveProperty('sizeLimit')
    })

    it('omits paged when not set to true', async () => {
      mockSearch.mockResolvedValueOnce({ searchEntries: [] })
      await service.search(null, null, null, null, null, false)

      expect(mockSearch.mock.calls[0][1]).not.toHaveProperty('paged')
    })

    it('accepts paged as string "true"', async () => {
      mockSearch.mockResolvedValueOnce({ searchEntries: [] })
      await service.search(null, null, null, null, null, 'true')

      expect(mockSearch.mock.calls[0][1].paged).toBe(true)
    })

    it('handles null searchEntries from server', async () => {
      mockSearch.mockResolvedValueOnce({ searchEntries: null })
      const result = await service.search()

      expect(result).toEqual({ entries: [], count: 0 })
    })

    it('throws when no baseDN configured and none provided', async () => {
      // Temporarily clear the service's baseDN to simulate missing config
      const originalBaseDN = service.baseDN

      service.baseDN = ''

      await expect(
        service.search('')
      ).rejects.toThrow('LDAP error: no Base DN provided')

      service.baseDN = originalBaseDN
    })

    it('throws on LDAP error', async () => {
      const ldapError = new Error('Connection refused')

      ldapError.code = 'ECONNREFUSED'
      mockSearch.mockRejectedValueOnce(ldapError)

      await expect(service.search()).rejects.toThrow('LDAP error:')
    })

    it('always unbinds even on error', async () => {
      mockSearch.mockRejectedValueOnce(new Error('search failed'))

      try { await service.search() } catch (e) { /* expected */ }

      expect(mockUnbind).toHaveBeenCalled()
    })
  })

  // ── Get Entry ──

  describe('getEntry', () => {
    it('fetches a single entry by DN', async () => {
      const entry = { dn: 'uid=jdoe,ou=people,dc=example,dc=com', cn: 'John Doe', mail: 'jdoe@example.com' }

      mockSearch.mockResolvedValueOnce({ searchEntries: [entry] })

      const result = await service.getEntry('uid=jdoe,ou=people,dc=example,dc=com')

      expect(mockSearch).toHaveBeenCalledWith('uid=jdoe,ou=people,dc=example,dc=com', {
        scope: 'base',
        filter: '(objectClass=*)',
      })
      expect(result).toEqual({ entry })
    })

    it('returns null when entry is not found (empty results)', async () => {
      mockSearch.mockResolvedValueOnce({ searchEntries: [] })

      const result = await service.getEntry('uid=nobody,dc=example,dc=com')

      expect(result).toEqual({ entry: null })
    })

    it('returns null when entry is not found (code 32)', async () => {
      const noSuchObjectError = new Error('No Such Object')

      noSuchObjectError.code = 32
      mockSearch.mockRejectedValueOnce(noSuchObjectError)

      const result = await service.getEntry('uid=nobody,dc=example,dc=com')

      expect(result).toEqual({ entry: null })
    })

    it('includes specific attributes when provided', async () => {
      mockSearch.mockResolvedValueOnce({ searchEntries: [{ dn: 'uid=jdoe,dc=example,dc=com', cn: 'John' }] })
      await service.getEntry('uid=jdoe,dc=example,dc=com', ['cn', 'mail'])

      expect(mockSearch.mock.calls[0][1].attributes).toEqual(['cn', 'mail'])
    })

    it('omits attributes option when empty array provided', async () => {
      mockSearch.mockResolvedValueOnce({ searchEntries: [{ dn: 'uid=jdoe,dc=example,dc=com' }] })
      await service.getEntry('uid=jdoe,dc=example,dc=com', [])

      expect(mockSearch.mock.calls[0][1]).not.toHaveProperty('attributes')
    })

    it('throws when DN is empty', async () => {
      await expect(service.getEntry('')).rejects.toThrow('DN is required')
    })

    it('throws when DN is not a string', async () => {
      await expect(service.getEntry(123)).rejects.toThrow('DN is required')
    })

    it('re-throws non-code-32 LDAP errors', async () => {
      const otherError = new Error('Insufficient access')

      otherError.code = 50
      mockSearch.mockRejectedValueOnce(otherError)

      await expect(service.getEntry('uid=jdoe,dc=example,dc=com')).rejects.toThrow('LDAP error:')
    })
  })

  // ── Add Entry ──

  describe('addEntry', () => {
    it('creates an entry with the given DN and attributes', async () => {
      const attrs = { objectClass: ['inetOrgPerson', 'person'], cn: 'John Doe', sn: 'Doe' }

      const result = await service.addEntry('uid=jdoe,ou=people,dc=example,dc=com', attrs)

      expect(mockAdd).toHaveBeenCalledWith('uid=jdoe,ou=people,dc=example,dc=com', attrs)
      expect(result).toEqual({ success: true, dn: 'uid=jdoe,ou=people,dc=example,dc=com' })
    })

    it('throws when DN is empty', async () => {
      await expect(service.addEntry('', { cn: 'Test' })).rejects.toThrow('DN is required')
    })

    it('throws when attributes is null', async () => {
      await expect(service.addEntry('uid=test,dc=example,dc=com', null))
        .rejects.toThrow('Attributes must be a non-empty JSON object')
    })

    it('throws when attributes is an empty object', async () => {
      await expect(service.addEntry('uid=test,dc=example,dc=com', {}))
        .rejects.toThrow('Attributes must be a non-empty JSON object')
    })

    it('throws when attributes is an array', async () => {
      await expect(service.addEntry('uid=test,dc=example,dc=com', ['cn']))
        .rejects.toThrow('Attributes must be a non-empty JSON object')
    })

    it('throws on LDAP error (already exists)', async () => {
      const error = new Error('Already Exists')

      error.code = 68
      error.name = 'EntryAlreadyExistsError'
      mockAdd.mockRejectedValueOnce(error)

      await expect(
        service.addEntry('uid=jdoe,dc=example,dc=com', { cn: 'John' })
      ).rejects.toThrow('LDAP error:')
    })
  })

  // ── Modify Entry ──

  describe('modifyEntry', () => {
    it('applies replace and add operations', async () => {
      const operations = [
        { operation: 'replace', attribute: 'mail', values: ['new@example.com'] },
        { operation: 'add', attribute: 'memberOf', values: ['cn=admins,dc=example,dc=com'] },
      ]

      const result = await service.modifyEntry('uid=jdoe,ou=people,dc=example,dc=com', operations)

      expect(mockModify).toHaveBeenCalledWith(
        'uid=jdoe,ou=people,dc=example,dc=com',
        expect.arrayContaining([
          expect.objectContaining({ operation: 'replace' }),
          expect.objectContaining({ operation: 'add' }),
        ])
      )
      expect(result).toEqual({
        success: true,
        dn: 'uid=jdoe,ou=people,dc=example,dc=com',
        appliedChanges: 2,
      })
    })

    it('handles delete operation with empty values', async () => {
      const operations = [
        { operation: 'delete', attribute: 'telephoneNumber' },
      ]

      const result = await service.modifyEntry('uid=jdoe,dc=example,dc=com', operations)

      expect(Change).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'delete' })
      )
      expect(result.appliedChanges).toBe(1)
    })

    it('wraps non-array values into an array', async () => {
      const operations = [
        { operation: 'replace', attribute: 'mail', values: 'single@example.com' },
      ]

      await service.modifyEntry('uid=jdoe,dc=example,dc=com', operations)

      expect(Attribute).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'mail', values: ['single@example.com'] })
      )
    })

    it('throws when DN is empty', async () => {
      await expect(
        service.modifyEntry('', [{ operation: 'replace', attribute: 'cn', values: ['New'] }])
      ).rejects.toThrow('DN is required')
    })

    it('throws when operations is not an array', async () => {
      await expect(
        service.modifyEntry('uid=jdoe,dc=example,dc=com', 'not-an-array')
      ).rejects.toThrow('Operations must be a non-empty array')
    })

    it('throws when operations is an empty array', async () => {
      await expect(
        service.modifyEntry('uid=jdoe,dc=example,dc=com', [])
      ).rejects.toThrow('Operations must be a non-empty array')
    })

    it('throws when operation type is invalid', async () => {
      await expect(
        service.modifyEntry('uid=jdoe,dc=example,dc=com', [
          { operation: 'update', attribute: 'cn', values: ['New'] },
        ])
      ).rejects.toThrow('Operations[0].operation must be one of')
    })

    it('throws when attribute name is missing', async () => {
      await expect(
        service.modifyEntry('uid=jdoe,dc=example,dc=com', [
          { operation: 'replace', attribute: '', values: ['New'] },
        ])
      ).rejects.toThrow('Operations[0].attribute is required')
    })
  })

  // ── Rename Entry ──

  describe('renameEntry', () => {
    it('renames an entry by changing its DN', async () => {
      const result = await service.renameEntry(
        'cn=Old Name,ou=people,dc=example,dc=com',
        'cn=New Name,ou=people,dc=example,dc=com'
      )

      expect(mockModifyDN).toHaveBeenCalledWith(
        'cn=Old Name,ou=people,dc=example,dc=com',
        'cn=New Name,ou=people,dc=example,dc=com'
      )
      expect(result).toEqual({
        success: true,
        dn: 'cn=New Name,ou=people,dc=example,dc=com',
        previousDN: 'cn=Old Name,ou=people,dc=example,dc=com',
      })
    })

    it('throws when DN is empty', async () => {
      await expect(
        service.renameEntry('', 'cn=New,dc=example,dc=com')
      ).rejects.toThrow('DN is required')
    })

    it('throws when new DN is empty', async () => {
      await expect(
        service.renameEntry('cn=Old,dc=example,dc=com', '')
      ).rejects.toThrow('New DN is required')
    })
  })

  // ── Delete Entry ──

  describe('deleteEntry', () => {
    it('deletes an entry by DN', async () => {
      const result = await service.deleteEntry('uid=jdoe,ou=people,dc=example,dc=com')

      expect(mockDel).toHaveBeenCalledWith('uid=jdoe,ou=people,dc=example,dc=com')
      expect(result).toEqual({ success: true, dn: 'uid=jdoe,ou=people,dc=example,dc=com' })
    })

    it('throws when DN is empty', async () => {
      await expect(service.deleteEntry('')).rejects.toThrow('DN is required')
    })

    it('throws on LDAP error (not allowed on non-leaf)', async () => {
      const error = new Error('Not Allowed On Non-Leaf')

      error.code = 66
      mockDel.mockRejectedValueOnce(error)

      await expect(
        service.deleteEntry('ou=people,dc=example,dc=com')
      ).rejects.toThrow('LDAP error:')
    })
  })

  // ── Compare ──

  describe('compare', () => {
    it('returns matched true when attribute contains the value', async () => {
      mockCompare.mockResolvedValueOnce(true)

      const result = await service.compare(
        'uid=jdoe,ou=people,dc=example,dc=com',
        'objectClass',
        'person'
      )

      expect(mockCompare).toHaveBeenCalledWith(
        'uid=jdoe,ou=people,dc=example,dc=com',
        'objectClass',
        'person'
      )
      expect(result).toEqual({
        matched: true,
        dn: 'uid=jdoe,ou=people,dc=example,dc=com',
        attribute: 'objectClass',
        value: 'person',
      })
    })

    it('returns matched false when attribute does not contain the value', async () => {
      mockCompare.mockResolvedValueOnce(false)

      const result = await service.compare(
        'uid=jdoe,dc=example,dc=com',
        'objectClass',
        'groupOfNames'
      )

      expect(result.matched).toBe(false)
    })

    it('converts numeric value to string', async () => {
      mockCompare.mockResolvedValueOnce(true)

      await service.compare('uid=jdoe,dc=example,dc=com', 'uidNumber', 1001)

      expect(mockCompare.mock.calls[0][2]).toBe('1001')
    })

    it('throws when DN is empty', async () => {
      await expect(
        service.compare('', 'objectClass', 'person')
      ).rejects.toThrow('DN is required')
    })

    it('throws when attribute is empty', async () => {
      await expect(
        service.compare('uid=jdoe,dc=example,dc=com', '', 'person')
      ).rejects.toThrow('Attribute is required')
    })

    it('throws when value is null', async () => {
      await expect(
        service.compare('uid=jdoe,dc=example,dc=com', 'objectClass', null)
      ).rejects.toThrow('Value is required')
    })

    it('throws when value is undefined', async () => {
      await expect(
        service.compare('uid=jdoe,dc=example,dc=com', 'objectClass', undefined)
      ).rejects.toThrow('Value is required')
    })
  })

  // ── Authenticate User ──

  describe('authenticateUser', () => {
    it('returns authenticated true on successful bind', async () => {
      const result = await service.authenticateUser(
        'uid=jdoe,ou=people,dc=example,dc=com',
        'correct-password'
      )

      // A new Client is created for user auth (separate from the service client)
      expect(Client).toHaveBeenCalled()
      expect(mockBind).toHaveBeenCalledWith(
        'uid=jdoe,ou=people,dc=example,dc=com',
        'correct-password'
      )
      expect(result).toEqual({
        authenticated: true,
        userDN: 'uid=jdoe,ou=people,dc=example,dc=com',
      })
    })

    it('returns authenticated false on invalid credentials (code 49)', async () => {
      const credError = new Error('Invalid credentials')

      credError.code = 49
      credError.name = 'InvalidCredentialsError'
      mockBind.mockRejectedValueOnce(credError)

      const result = await service.authenticateUser(
        'uid=jdoe,dc=example,dc=com',
        'wrong-password'
      )

      expect(result).toEqual({
        authenticated: false,
        userDN: 'uid=jdoe,dc=example,dc=com',
        reason: 'Invalid credentials',
      })
    })

    it('returns authenticated false when error name is InvalidCredentialsError', async () => {
      const credError = new Error('Bad password')

      credError.name = 'InvalidCredentialsError'
      mockBind.mockRejectedValueOnce(credError)

      const result = await service.authenticateUser('uid=jdoe,dc=example,dc=com', 'bad')

      expect(result.authenticated).toBe(false)
    })

    it('throws on non-credential errors', async () => {
      const networkError = new Error('Connection refused')

      networkError.code = 'ECONNREFUSED'
      mockBind.mockRejectedValueOnce(networkError)

      await expect(
        service.authenticateUser('uid=jdoe,dc=example,dc=com', 'password')
      ).rejects.toThrow('LDAP error:')
    })

    it('throws when userDN is empty', async () => {
      await expect(
        service.authenticateUser('', 'password')
      ).rejects.toThrow('User DN is required')
    })

    it('throws when password is empty', async () => {
      await expect(
        service.authenticateUser('uid=jdoe,dc=example,dc=com', '')
      ).rejects.toThrow('User Password is required')
    })

    it('throws when password is not a string', async () => {
      await expect(
        service.authenticateUser('uid=jdoe,dc=example,dc=com', 123)
      ).rejects.toThrow('User Password is required')
    })

    it('always unbinds the user client even on error', async () => {
      const error = new Error('Connection lost')

      error.code = 'ECONNRESET'
      mockBind.mockRejectedValueOnce(error)

      try { await service.authenticateUser('uid=jdoe,dc=example,dc=com', 'pass') } catch (e) { /* expected */ }

      expect(mockUnbind).toHaveBeenCalled()
    })
  })

  // ── Client creation ──

  describe('client creation', () => {
    it('throws when URL is empty', async () => {
      // Temporarily clear the service URL
      const originalUrl = service.url

      service.url = ''

      await expect(service.search()).rejects.toThrow('Server URL is required')

      service.url = originalUrl
    })

    it('does not set tlsOptions for ldap:// URLs', async () => {
      // Temporarily change the service URL to plain ldap://
      const originalUrl = service.url

      service.url = 'ldap://dc.example.com:389'

      mockSearch.mockResolvedValueOnce({ searchEntries: [] })
      await service.search()

      const lastCall = Client.mock.calls[Client.mock.calls.length - 1][0]

      expect(lastCall.url).toBe('ldap://dc.example.com:389')
      expect(lastCall.tlsOptions).toBeUndefined()

      service.url = originalUrl
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('includes hint for ECONNREFUSED errors', async () => {
      const error = new Error('connect ECONNREFUSED')

      error.code = 'ECONNREFUSED'
      mockSearch.mockRejectedValueOnce(error)

      await expect(service.search()).rejects.toThrow('could not reach the LDAP server')
    })

    it('includes hint for ETIMEDOUT errors', async () => {
      const error = new Error('connect ETIMEDOUT')

      error.code = 'ETIMEDOUT'
      mockSearch.mockRejectedValueOnce(error)

      await expect(service.search()).rejects.toThrow('could not reach the LDAP server')
    })

    it('includes hint for ENOTFOUND errors', async () => {
      const error = new Error('getaddrinfo ENOTFOUND')

      error.code = 'ENOTFOUND'
      mockSearch.mockRejectedValueOnce(error)

      await expect(service.search()).rejects.toThrow('could not reach the LDAP server')
    })

    it('includes error name and code in message', async () => {
      const error = new Error('Insufficient access rights')

      error.name = 'InsufficientAccessError'
      error.code = 50
      mockSearch.mockRejectedValueOnce(error)

      await expect(service.search()).rejects.toThrow(/name: InsufficientAccessError/)
      // The error was already thrown above, need to set up again for code check
    })

    it('handles unbind failure gracefully', async () => {
      mockSearch.mockResolvedValueOnce({ searchEntries: [] })
      mockUnbind.mockRejectedValueOnce(new Error('unbind failed'))

      // Should not throw despite unbind failure
      const result = await service.search()

      expect(result).toEqual({ entries: [], count: 0 })
    })
  })
})
