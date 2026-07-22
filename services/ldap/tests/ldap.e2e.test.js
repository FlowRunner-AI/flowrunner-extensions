'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('LDAP Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('ldap')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Search ──

  describe('search', () => {
    it('returns entries with expected shape using default parameters', async () => {
      const result = await service.search()

      expect(result).toHaveProperty('entries')
      expect(result).toHaveProperty('count')
      expect(Array.isArray(result.entries)).toBe(true)
      expect(typeof result.count).toBe('number')
      expect(result.count).toBe(result.entries.length)
    })

    it('searches with a specific filter', async () => {
      const filter = testValues.searchFilter || '(objectClass=*)'
      const result = await service.search(null, 'Subtree', filter, null, 5)

      expect(result).toHaveProperty('entries')
      expect(result).toHaveProperty('count')
      expect(result.count).toBeLessThanOrEqual(5)
    })

    it('searches with Base scope on the baseDN', async () => {
      const result = await service.search(null, 'Base', '(objectClass=*)')

      expect(result).toHaveProperty('entries')
      expect(result.count).toBeLessThanOrEqual(1)
    })

    it('searches with One Level scope', async () => {
      const result = await service.search(null, 'One Level', '(objectClass=*)', null, 10)

      expect(result).toHaveProperty('entries')
      expect(Array.isArray(result.entries)).toBe(true)
    })

    it('returns specific attributes when requested', async () => {
      const result = await service.search(null, 'Subtree', '(objectClass=*)', ['dn'], 3)

      expect(result).toHaveProperty('entries')

      if (result.entries.length > 0) {
        expect(result.entries[0]).toHaveProperty('dn')
      }
    })

    it('supports paged results', async () => {
      const result = await service.search(null, 'Subtree', '(objectClass=*)', null, null, true)

      expect(result).toHaveProperty('entries')
      expect(result).toHaveProperty('count')
    })
  })

  // ── Get Entry ──

  describe('getEntry', () => {
    it('fetches an entry by DN', async () => {
      // First search to get a valid DN
      const searchResult = await service.search(null, 'Subtree', '(objectClass=*)', null, 1)

      if (searchResult.entries.length === 0) {
        console.log('No entries found to test getEntry — skipping')
        return
      }

      const testDN = searchResult.entries[0].dn
      const result = await service.getEntry(testDN)

      expect(result).toHaveProperty('entry')
      expect(result.entry).not.toBeNull()
      expect(result.entry).toHaveProperty('dn')
      expect(result.entry.dn).toBe(testDN)
    })

    it('returns null for a non-existent DN', async () => {
      const result = await service.getEntry('cn=nonexistent-e2e-test-entry,dc=does,dc=not,dc=exist')

      expect(result).toEqual({ entry: null })
    })

    it('returns specific attributes when requested', async () => {
      const searchResult = await service.search(null, 'Subtree', '(objectClass=*)', null, 1)

      if (searchResult.entries.length === 0) {
        return
      }

      const testDN = searchResult.entries[0].dn
      const result = await service.getEntry(testDN, ['objectClass'])

      expect(result.entry).not.toBeNull()
      expect(result.entry).toHaveProperty('dn')
    })
  })

  // ── Add, Modify, Rename, Delete Entry lifecycle ──

  describe('entry lifecycle (add, modify, rename, delete)', () => {
    const testOU = testValues.testOU
    const testEntryRDN = `cn=e2e-test-${Date.now()}`
    let testEntryDN
    let renamedDN

    beforeAll(() => {
      if (!testOU) {
        console.log(
          'testValues.testOU is not set in e2e-config.json. ' +
          'Provide an OU where test entries can be created (e.g. ou=people,dc=example,dc=com).'
        )
      }

      testEntryDN = testOU ? `${testEntryRDN},${testOU}` : null
    })

    it('creates a new entry', async () => {
      if (!testEntryDN) {
        console.log('Skipped — testOU not configured')
        return
      }

      const result = await service.addEntry(testEntryDN, {
        objectClass: ['inetOrgPerson', 'organizationalPerson', 'person', 'top'],
        cn: `e2e-test-${Date.now()}`,
        sn: 'E2E Test',
        description: 'Created by FlowRunner e2e test',
      })

      expect(result).toEqual({ success: true, dn: testEntryDN })
    })

    it('retrieves the created entry', async () => {
      if (!testEntryDN) return

      const result = await service.getEntry(testEntryDN)

      expect(result.entry).not.toBeNull()
      expect(result.entry.sn).toBe('E2E Test')
    })

    it('modifies the created entry', async () => {
      if (!testEntryDN) return

      const result = await service.modifyEntry(testEntryDN, [
        { operation: 'replace', attribute: 'description', values: ['Modified by e2e test'] },
      ])

      expect(result).toEqual({
        success: true,
        dn: testEntryDN,
        appliedChanges: 1,
      })

      // Verify the modification
      const entry = await service.getEntry(testEntryDN, ['description'])

      expect(entry.entry.description).toBe('Modified by e2e test')
    })

    it('renames the created entry', async () => {
      if (!testEntryDN) return

      const newRDN = `cn=e2e-renamed-${Date.now()}`

      renamedDN = testOU ? `${newRDN},${testOU}` : null

      const result = await service.renameEntry(testEntryDN, renamedDN)

      expect(result).toEqual({
        success: true,
        dn: renamedDN,
        previousDN: testEntryDN,
      })

      // Update the DN for cleanup
      testEntryDN = renamedDN
    })

    it('deletes the entry', async () => {
      const dnToDelete = renamedDN || testEntryDN

      if (!dnToDelete) return

      const result = await service.deleteEntry(dnToDelete)

      expect(result).toEqual({ success: true, dn: dnToDelete })

      // Verify deletion
      const entry = await service.getEntry(dnToDelete)

      expect(entry.entry).toBeNull()
    })
  })

  // ── Compare ──

  describe('compare', () => {
    it('checks whether an attribute contains a value', async () => {
      // Get any entry to test compare against
      const searchResult = await service.search(null, 'Subtree', '(objectClass=*)', null, 1)

      if (searchResult.entries.length === 0) {
        console.log('No entries found for compare test — skipping')
        return
      }

      const testDN = searchResult.entries[0].dn

      const result = await service.compare(testDN, 'objectClass', 'top')

      expect(result).toHaveProperty('matched')
      expect(typeof result.matched).toBe('boolean')
      expect(result).toHaveProperty('dn', testDN)
      expect(result).toHaveProperty('attribute', 'objectClass')
      expect(result).toHaveProperty('value', 'top')
    })
  })

  // ── Authenticate User ──

  describe('authenticateUser', () => {
    it('returns authenticated false for invalid credentials', async () => {
      const testUserDN = testValues.testUserDN

      if (!testUserDN) {
        console.log('testValues.testUserDN not set — skipping authenticateUser test')
        return
      }

      const result = await service.authenticateUser(testUserDN, 'definitely-wrong-password-e2e')

      expect(result).toHaveProperty('authenticated', false)
      expect(result).toHaveProperty('userDN', testUserDN)
      expect(result).toHaveProperty('reason')
    })

    it('returns authenticated true for valid credentials', async () => {
      const testUserDN = testValues.testUserDN
      const testUserPassword = testValues.testUserPassword

      if (!testUserDN || !testUserPassword) {
        console.log('testValues.testUserDN or testValues.testUserPassword not set — skipping')
        return
      }

      const result = await service.authenticateUser(testUserDN, testUserPassword)

      expect(result).toEqual({
        authenticated: true,
        userDN: testUserDN,
      })
    })
  })
})
