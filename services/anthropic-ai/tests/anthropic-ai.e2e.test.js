'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Anthropic Claude Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('anthropic-ai')
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

  // ── Models ──

  describe('listModels', () => {
    it('returns models with expected shape', async () => {
      const result = await service.listModels(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data.length).toBeGreaterThan(0)
      expect(result.data[0]).toHaveProperty('id')
      expect(result.data[0]).toHaveProperty('type', 'model')
    })
  })

  describe('getModel', () => {
    it('returns model details for a known model', async () => {
      const result = await service.getModel('claude-sonnet-4-20250514')

      expect(result).toHaveProperty('id', 'claude-sonnet-4-20250514')
      expect(result).toHaveProperty('type', 'model')
      expect(result).toHaveProperty('display_name')
    })
  })

  // ── Dictionary: Models ──

  describe('getModelsDictionary', () => {
    it('returns dictionary items with label/value/note', async () => {
      const result = await service.getModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.items[0]).toHaveProperty('note')
    })

    it('filters by search term', async () => {
      const result = await service.getModelsDictionary({ search: 'sonnet' })

      expect(result.items.length).toBeGreaterThan(0)
      expect(
        result.items.every(item =>
          item.value.toLowerCase().includes('sonnet') ||
          item.label.toLowerCase().includes('sonnet')
        )
      ).toBe(true)
    })
  })

  // ── Messages ──

  describe('askClaude', () => {
    it('returns a text response with usage info', async () => {
      const result = await service.askClaude(
        'Reply with exactly the word "hello" and nothing else.',
        'claude-sonnet-4-20250514',
        undefined,
        100
      )

      expect(result).toHaveProperty('text')
      expect(result.text.length).toBeGreaterThan(0)
      expect(result).toHaveProperty('model')
      expect(result).toHaveProperty('stopReason')
      expect(result).toHaveProperty('usage')
      expect(result.usage).toHaveProperty('input_tokens')
      expect(result.usage).toHaveProperty('output_tokens')
    }, 30000)
  })

  describe('sendMessages', () => {
    it('returns a complete response with text field', async () => {
      const messages = [
        { role: 'user', content: 'Reply with exactly "ok".' },
      ]

      const result = await service.sendMessages(
        'claude-sonnet-4-20250514', messages, 100
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('type', 'message')
      expect(result).toHaveProperty('content')
      expect(result).toHaveProperty('text')
      expect(result).toHaveProperty('usage')
    }, 30000)
  })

  describe('countTokens', () => {
    it('returns token count for a prompt', async () => {
      const result = await service.countTokens(
        'claude-sonnet-4-20250514',
        'How many tokens is this prompt?'
      )

      expect(result).toHaveProperty('input_tokens')
      expect(typeof result.input_tokens).toBe('number')
      expect(result.input_tokens).toBeGreaterThan(0)
    })
  })

  // ── Files ──

  describe('listFiles', () => {
    it('returns file list with expected shape', async () => {
      const result = await service.listFiles(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Message Batches ──

  describe('listBatches', () => {
    it('returns batch list with expected shape', async () => {
      const result = await service.listBatches(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })
})
