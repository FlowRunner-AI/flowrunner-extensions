'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('QuestDB Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('questdb')
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

  // ── checkHealth ──

  describe('checkHealth', () => {
    it('returns healthy status with url and latency', async () => {
      const result = await service.checkHealth()

      expect(result).toHaveProperty('healthy', true)
      expect(result).toHaveProperty('url')
      expect(result).toHaveProperty('latencyMs')
      expect(typeof result.latencyMs).toBe('number')
    })
  })

  // ── executeQuery ──

  describe('executeQuery', () => {
    it('runs a simple SELECT query', async () => {
      const result = await service.executeQuery('SELECT 1 as value')

      expect(result).toHaveProperty('query')
      expect(result).toHaveProperty('columns')
      expect(result).toHaveProperty('dataset')
      expect(Array.isArray(result.columns)).toBe(true)
      expect(Array.isArray(result.dataset)).toBe(true)
      expect(result.dataset.length).toBeGreaterThan(0)
    })

    it('respects limit parameter', async () => {
      const result = await service.executeQuery('SELECT x FROM long_sequence(100)', '5')

      expect(result).toHaveProperty('dataset')
      expect(result.dataset).toHaveLength(5)
    })

    it('includes count when count is true', async () => {
      const result = await service.executeQuery('SELECT 1 as value', undefined, true)

      expect(result).toHaveProperty('count')
      expect(typeof result.count).toBe('number')
    })

    it('skips metadata when skipMetadata is true', async () => {
      const result = await service.executeQuery('SELECT 1 as value', undefined, undefined, true)

      expect(result).toHaveProperty('dataset')
      expect(result.columns).toBeUndefined()
    })

    it('throws on invalid SQL', async () => {
      await expect(service.executeQuery('INVALID SQL QUERY HERE !!!')).rejects.toThrow()
    })
  })

  // ── exportQuery ──

  describe('exportQuery', () => {
    it('returns CSV text for a SELECT query', async () => {
      const result = await service.exportQuery('SELECT x, x*2 as double_x FROM long_sequence(3)')

      expect(typeof result).toBe('string')
      expect(result).toContain('x')
      expect(result.split('\n').length).toBeGreaterThan(1)
    })

    it('respects limit parameter', async () => {
      const result = await service.exportQuery('SELECT x FROM long_sequence(100)', '2')

      expect(typeof result).toBe('string')

      const lines = result.trim().split('\n')

      // 1 header + 2 data rows
      expect(lines).toHaveLength(3)
    })

    it('throws on invalid SQL', async () => {
      await expect(service.exportQuery('NOT VALID SQL !!!')).rejects.toThrow()
    })
  })
})
