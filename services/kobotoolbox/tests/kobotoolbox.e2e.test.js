'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('KoBoToolbox Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('kobotoolbox')
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

  // ── Assets ──

  describe('listAssets', () => {
    it('returns assets with expected shape', async () => {
      const result = await service.listAssets(undefined, 5, 0)

      expect(result).toHaveProperty('count')
      expect(typeof result.count).toBe('number')
      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)

      if (result.results.length > 0) {
        expect(result.results[0]).toHaveProperty('uid')
        expect(result.results[0]).toHaveProperty('name')
        expect(result.results[0]).toHaveProperty('asset_type')
      }
    })

    it('supports search filtering', async () => {
      const result = await service.listAssets('zzzz-no-match-expected', 5)

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })
  })

  // ── Dictionary ──

  describe('getAssetsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getAssetsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('filters by search term without error', async () => {
      const result = await service.getAssetsDictionary({ search: 'zzzz-no-match' })

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('supports pagination via cursor', async () => {
      const result = await service.getAssetsDictionary({ cursor: '0' })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Asset lifecycle: create + get + deploy + redeploy + delete ──

  describe('asset lifecycle', () => {
    let createdUid

    it('creates a new asset', async () => {
      const result = await service.createAsset(`E2E Test Form ${Date.now()}`, 'Survey')

      expect(result).toHaveProperty('uid')
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('asset_type', 'survey')
      createdUid = result.uid
    })

    it('retrieves the created asset', async () => {
      if (!createdUid) {
        console.log('Skipping getAsset: no asset was created')
        return
      }

      const result = await service.getAsset(createdUid)

      expect(result).toHaveProperty('uid', createdUid)
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('asset_type', 'survey')
    })

    it('retrieves asset content', async () => {
      if (!createdUid) {
        console.log('Skipping getAssetContent: no asset was created')
        return
      }

      const result = await service.getAssetContent(createdUid)

      expect(result).toHaveProperty('uid', createdUid)
    })
  })

  // ── Submissions (require a deployed asset with submissions) ──

  describe('submissions', () => {
    it('getSubmissions returns submissions with expected shape', async () => {
      if (!testValues.assetUid) {
        console.log('Skipping getSubmissions: set testValues.assetUid in e2e-config.json')
        return
      }

      const result = await service.getSubmissions(testValues.assetUid, undefined, undefined, 5, 0)

      expect(result).toHaveProperty('count')
      expect(typeof result.count).toBe('number')
      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('getSubmissionCount returns count object', async () => {
      if (!testValues.assetUid) {
        console.log('Skipping getSubmissionCount: set testValues.assetUid in e2e-config.json')
        return
      }

      const result = await service.getSubmissionCount(testValues.assetUid)

      expect(result).toHaveProperty('count')
      expect(typeof result.count).toBe('number')
    })

    it('getSubmission returns a single submission', async () => {
      if (!testValues.assetUid || !testValues.submissionId) {
        console.log('Skipping getSubmission: set testValues.assetUid and testValues.submissionId in e2e-config.json')
        return
      }

      const result = await service.getSubmission(testValues.assetUid, testValues.submissionId)

      expect(result).toHaveProperty('_id')
    })
  })

  // ── Exports (require a deployed asset) ──

  describe('exports', () => {
    it('listExports returns exports with expected shape', async () => {
      if (!testValues.assetUid) {
        console.log('Skipping listExports: set testValues.assetUid in e2e-config.json')
        return
      }

      const result = await service.listExports(testValues.assetUid)

      expect(result).toHaveProperty('count')
      expect(typeof result.count).toBe('number')
      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('createExport creates a CSV export', async () => {
      if (!testValues.assetUid) {
        console.log('Skipping createExport: set testValues.assetUid in e2e-config.json')
        return
      }

      const result = await service.createExport(testValues.assetUid, 'CSV')

      expect(result).toHaveProperty('uid')
      expect(result).toHaveProperty('status')
    })
  })

  // ── Deployment (require assetUid in testValues) ──

  describe('deployment', () => {
    it('getDeployment returns deployment details', async () => {
      if (!testValues.assetUid) {
        console.log('Skipping getDeployment: set testValues.assetUid in e2e-config.json')
        return
      }

      const result = await service.getDeployment(testValues.assetUid)

      expect(result).toHaveProperty('active')
    })
  })
})
