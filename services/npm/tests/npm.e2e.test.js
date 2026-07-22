'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('npm Registry Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('npm')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── getPackage ──

  describe('getPackage', () => {
    it('retrieves metadata for an unscoped package', async () => {
      const result = await service.getPackage('express')

      expect(result).toHaveProperty('name', 'express')
      expect(result).toHaveProperty('dist-tags')
      expect(result).toHaveProperty('versions')
    })

    it('retrieves metadata for a scoped package', async () => {
      const result = await service.getPackage('@angular/core')

      expect(result).toHaveProperty('name', '@angular/core')
      expect(result).toHaveProperty('dist-tags')
    })
  })

  // ── getPackageVersion ──

  describe('getPackageVersion', () => {
    it('retrieves a specific version', async () => {
      const result = await service.getPackageVersion('express', '4.19.2')

      expect(result).toHaveProperty('name', 'express')
      expect(result).toHaveProperty('version', '4.19.2')
      expect(result).toHaveProperty('dependencies')
      expect(result).toHaveProperty('dist')
    })

    it('retrieves the latest dist-tag', async () => {
      const result = await service.getPackageVersion('express', 'latest')

      expect(result).toHaveProperty('name', 'express')
      expect(result).toHaveProperty('version')
      expect(result).toHaveProperty('dist')
    })
  })

  // ── getPackageDistTags ──

  describe('getPackageDistTags', () => {
    it('returns dist-tags map', async () => {
      const result = await service.getPackageDistTags('express')

      expect(result).toHaveProperty('latest')
      expect(typeof result.latest).toBe('string')
    })
  })

  // ── searchPackages ──

  describe('searchPackages', () => {
    it('returns search results with expected shape', async () => {
      const result = await service.searchPackages('express', 5)

      expect(result).toHaveProperty('objects')
      expect(Array.isArray(result.objects)).toBe(true)
      expect(result.objects.length).toBeGreaterThan(0)
      expect(result.objects[0]).toHaveProperty('package')
      expect(result.objects[0].package).toHaveProperty('name')
      expect(result).toHaveProperty('total')
    })

    it('respects size parameter', async () => {
      const result = await service.searchPackages('react', 2)

      expect(result.objects.length).toBeLessThanOrEqual(2)
    })

    it('supports pagination with from', async () => {
      const page1 = await service.searchPackages('lodash', 2, 0)
      const page2 = await service.searchPackages('lodash', 2, 2)

      expect(page1.objects[0].package.name).not.toBe(page2.objects[0].package.name)
    })
  })

  // ── getDownloadCount ──

  describe('getDownloadCount', () => {
    it('returns download count for a package with preset period', async () => {
      const result = await service.getDownloadCount('Last Week', 'express')

      expect(result).toHaveProperty('downloads')
      expect(typeof result.downloads).toBe('number')
      expect(result).toHaveProperty('start')
      expect(result).toHaveProperty('end')
      expect(result).toHaveProperty('package', 'express')
    })

    it('returns registry-wide downloads when no package specified', async () => {
      const result = await service.getDownloadCount('Last Day')

      expect(result).toHaveProperty('downloads')
      expect(typeof result.downloads).toBe('number')
    })

    it('works with all period presets', async () => {
      const presets = ['Last Day', 'Last Week', 'Last Month', 'Last Year']

      for (const period of presets) {
        const result = await service.getDownloadCount(period, 'express')

        expect(result).toHaveProperty('downloads')
        expect(typeof result.downloads).toBe('number')
      }
    })
  })

  // ── getDownloadRange ──

  describe('getDownloadRange', () => {
    it('returns per-day download breakdown', async () => {
      const result = await service.getDownloadRange('Last Week', 'express')

      expect(result).toHaveProperty('downloads')
      expect(Array.isArray(result.downloads)).toBe(true)
      expect(result.downloads.length).toBeGreaterThan(0)
      expect(result.downloads[0]).toHaveProperty('day')
      expect(result.downloads[0]).toHaveProperty('downloads')
      expect(result).toHaveProperty('start')
      expect(result).toHaveProperty('end')
      expect(result).toHaveProperty('package', 'express')
    })

    it('returns registry-wide range when no package specified', async () => {
      const result = await service.getDownloadRange('Last Day')

      expect(result).toHaveProperty('downloads')
      expect(Array.isArray(result.downloads)).toBe(true)
    })
  })

  // ── getRegistryInfo ──

  describe('getRegistryInfo', () => {
    it('returns registry metadata', async () => {
      const result = await service.getRegistryInfo()

      expect(result).toHaveProperty('db_name')
      expect(typeof result.db_name).toBe('string')
    })
  })
})
