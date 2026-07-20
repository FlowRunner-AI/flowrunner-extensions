'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Cloudflare Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('cloudflare')
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

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // testValues the developer can supply in e2e-config.json:
  //   zoneId          - an existing zone id (enables DNS, purge cache, ruleset tests)
  //   dnsTestName     - a hostname to create/delete a test A record under (e.g. e2e.example.com)
  //   kvNamespaceId   - an existing Workers KV namespace id (enables KV key/value tests)
  // Note: KV operations also require the optional accountId config item.

  const hasZone = () => Boolean(testValues.zoneId)
  const hasAccount = () => Boolean(service.accountId)
  const hasKvNamespace = () => Boolean(testValues.kvNamespaceId && service.accountId)

  // ── Zones ──

  describe('listZones', () => {
    it('returns zones with result and result_info', async () => {
      const response = await service.listZones(undefined, undefined, 1, 5)

      expect(response).toHaveProperty('result')
      expect(Array.isArray(response.result)).toBe(true)
      expect(response).toHaveProperty('result_info')
    })
  })

  describe('getZonesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getZonesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getZone', () => {
    it('returns a single zone when a zoneId is configured', async () => {
      if (!hasZone()) {
        console.log('Skipping getZone: set testValues.zoneId')
        return
      }

      const response = await service.getZone(testValues.zoneId)

      expect(response).toHaveProperty('id', testValues.zoneId)
      expect(response).toHaveProperty('name')
    })
  })

  // ── DNS Records ──

  describe('listDnsRecords', () => {
    it('returns DNS records with result and result_info', async () => {
      if (!hasZone()) {
        console.log('Skipping listDnsRecords: set testValues.zoneId')
        return
      }

      const response = await service.listDnsRecords(testValues.zoneId, undefined, undefined, undefined, 1, 5)

      expect(response).toHaveProperty('result')
      expect(Array.isArray(response.result)).toBe(true)
    })
  })

  describe('getDnsRecordsDictionary', () => {
    it('returns dictionary items array for the configured zone', async () => {
      if (!hasZone()) {
        console.log('Skipping getDnsRecordsDictionary: set testValues.zoneId')
        return
      }

      const result = await service.getDnsRecordsDictionary({ criteria: { zoneId: testValues.zoneId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('returns empty items with no zone id in criteria', async () => {
      const result = await service.getDnsRecordsDictionary({})

      expect(result).toEqual({ items: [], cursor: undefined })
    })
  })

  describe('createDnsRecord + getDnsRecord + patchDnsRecord + updateDnsRecord + deleteDnsRecord', () => {
    let recordId
    const recordName = testValues.dnsTestName || `e2e-${ suffix }.example.com`

    it('creates a DNS record', async () => {
      if (!hasZone()) {
        console.log('Skipping createDnsRecord: set testValues.zoneId (and optionally dnsTestName)')
        return
      }

      const response = await service.createDnsRecord(
        testValues.zoneId,
        'A',
        recordName,
        '198.51.100.10',
        1,
        false
      )

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('name')
      recordId = response.id
    })

    it('retrieves the created record', async () => {
      if (!recordId) {
        return
      }

      const response = await service.getDnsRecord(testValues.zoneId, recordId)

      expect(response).toHaveProperty('id', recordId)
    })

    it('patches the record content', async () => {
      if (!recordId) {
        return
      }

      const response = await service.patchDnsRecord(
        testValues.zoneId,
        recordId,
        undefined,
        undefined,
        '198.51.100.11'
      )

      expect(response).toHaveProperty('id', recordId)
      expect(response).toHaveProperty('content', '198.51.100.11')
    })

    it('fully updates the record', async () => {
      if (!recordId) {
        return
      }

      const response = await service.updateDnsRecord(
        testValues.zoneId,
        recordId,
        'A',
        recordName,
        '198.51.100.12',
        3600,
        false
      )

      expect(response).toHaveProperty('id', recordId)
      expect(response).toHaveProperty('content', '198.51.100.12')
    })

    it('deletes the record', async () => {
      if (!recordId) {
        return
      }

      const response = await service.deleteDnsRecord(testValues.zoneId, recordId)

      expect(response).toHaveProperty('id', recordId)
    })

    afterAll(async () => {
      // Best-effort cleanup in case a mid-lifecycle assertion failed.
      if (recordId && hasZone()) {
        try {
          await service.deleteDnsRecord(testValues.zoneId, recordId)
        } catch (e) {
          // ignore cleanup errors (record likely already deleted)
        }
      }
    })
  })

  // ── Rulesets ──

  describe('listRulesets + getRuleset', () => {
    let rulesetId

    it('lists rulesets for the zone', async () => {
      if (!hasZone()) {
        console.log('Skipping listRulesets: set testValues.zoneId')
        return
      }

      const response = await service.listRulesets(testValues.zoneId)

      expect(Array.isArray(response)).toBe(true)

      if (response.length) {
        rulesetId = response[0].id
      }
    })

    it('gets a single ruleset', async () => {
      if (!rulesetId) {
        return
      }

      const response = await service.getRuleset(testValues.zoneId, rulesetId)

      expect(response).toHaveProperty('id', rulesetId)
    })
  })

  // ── Purge Cache ──

  describe('purgeCache', () => {
    // Purging everything invalidates the whole zone cache, so only run when the
    // developer explicitly opts in via testValues.allowPurge.
    it('purges everything when explicitly allowed', async () => {
      if (!hasZone() || !testValues.allowPurge) {
        console.log('Skipping purgeCache: set testValues.zoneId and testValues.allowPurge=true')
        return
      }

      const response = await service.purgeCache(testValues.zoneId, true)

      expect(response).toHaveProperty('id')
    })
  })

  // ── Workers KV ──

  describe('listKvNamespaces', () => {
    it('returns namespaces with result and result_info', async () => {
      if (!hasAccount()) {
        console.log('Skipping listKvNamespaces: set the accountId config item')
        return
      }

      const response = await service.listKvNamespaces(1, 5)

      expect(response).toHaveProperty('result')
      expect(Array.isArray(response.result)).toBe(true)
    })
  })

  describe('getKvNamespacesDictionary', () => {
    it('returns dictionary items array', async () => {
      if (!hasAccount()) {
        console.log('Skipping getKvNamespacesDictionary: set the accountId config item')
        return
      }

      const result = await service.getKvNamespacesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('putKvValue + getKvValue + listKvKeys + deleteKvValue', () => {
    const key = `e2e-key-${ suffix }`
    const value = `e2e-value-${ suffix }`

    it('writes a KV value', async () => {
      if (!hasKvNamespace()) {
        console.log('Skipping putKvValue: set testValues.kvNamespaceId and the accountId config item')
        return
      }

      const response = await service.putKvValue(testValues.kvNamespaceId, key, value)

      expect(response).toEqual({ success: true })
    })

    it('reads the KV value back', async () => {
      if (!hasKvNamespace()) {
        return
      }

      const response = await service.getKvValue(testValues.kvNamespaceId, key)

      expect(response).toHaveProperty('value')
    })

    it('lists KV keys', async () => {
      if (!hasKvNamespace()) {
        return
      }

      const response = await service.listKvKeys(testValues.kvNamespaceId, undefined, 10)

      expect(response).toHaveProperty('result')
      expect(Array.isArray(response.result)).toBe(true)
    })

    it('deletes the KV value', async () => {
      if (!hasKvNamespace()) {
        return
      }

      const response = await service.deleteKvValue(testValues.kvNamespaceId, key)

      expect(response).toEqual({ success: true })
    })

    afterAll(async () => {
      if (hasKvNamespace()) {
        try {
          await service.deleteKvValue(testValues.kvNamespaceId, key)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })
})
