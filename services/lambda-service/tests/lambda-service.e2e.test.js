'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('AWS Lambda Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('lambda-service')
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

  // ── List Functions Dictionary ──

  describe('listFunctionsDictionary', () => {
    it('returns items with expected shape', async () => {
      const result = await service.listFunctionsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        const item = result.items[0]

        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
        expect(item).toHaveProperty('note')
      }
    })

    it('supports search filtering', async () => {
      const allResult = await service.listFunctionsDictionary({})

      if (allResult.items.length > 0) {
        const searchTerm = allResult.items[0].label.substring(0, 3)
        const searchResult = await service.listFunctionsDictionary({ search: searchTerm })

        expect(Array.isArray(searchResult.items)).toBe(true)

        for (const item of searchResult.items) {
          expect(item.label.toLowerCase()).toContain(searchTerm.toLowerCase())
        }
      }
    })
  })

  // ── Get Function ──

  describe('getFunction', () => {
    it('returns function details with expected shape', async () => {
      const listResult = await service.listFunctionsDictionary({})

      if (listResult.items.length === 0) {
        console.log('No Lambda functions found in account, skipping getFunction test')

        return
      }

      const functionName = listResult.items[0].value
      const result = await service.getFunction(functionName)

      expect(result).toHaveProperty('functionName')
      expect(result).toHaveProperty('runtime')
      expect(result).toHaveProperty('handler')
      expect(result).toHaveProperty('timeout')
      expect(result).toHaveProperty('memorySize')
      expect(result).toHaveProperty('state')
      expect(result).toHaveProperty('version')
      expect(result).toHaveProperty('role')
      expect(result).toHaveProperty('arn')
      expect(result.functionName).toBe(functionName)
    })

    it('throws for non-existent function', async () => {
      await expect(service.getFunction('nonexistent-function-xyz-12345')).rejects.toThrow()
    })
  })

  // ── Invoke Function ──

  describe('invoke', () => {
    it('invokes a function with DryRun (validates without executing)', async () => {
      const listResult = await service.listFunctionsDictionary({})

      if (listResult.items.length === 0) {
        console.log('No Lambda functions found in account, skipping invoke test')

        return
      }

      const functionName = listResult.items[0].value
      const result = await service.invoke(functionName, null, 'DryRun')

      expect(result).toHaveProperty('statusCode')
      expect(result).toHaveProperty('functionError')
      expect(result).toHaveProperty('payload')
      expect(result.statusCode).toBe(204)
    })

    it('invokes a function synchronously (RequestResponse)', async () => {
      const { functionName } = sandbox.getTestValues()

      if (!functionName) {
        console.log('No functionName in testValues, skipping synchronous invoke test')

        return
      }

      const result = await service.invoke(functionName, { test: true })

      expect(result).toHaveProperty('statusCode')
      expect(result).toHaveProperty('functionError')
      expect(result).toHaveProperty('payload')
      expect(result.statusCode).toBe(200)
    })

    it('throws when functionName is empty', async () => {
      await expect(service.invoke('')).rejects.toThrow('functionName is required')
    })
  })
})
