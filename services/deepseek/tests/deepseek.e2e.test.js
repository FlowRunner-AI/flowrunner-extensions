'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('DeepSeek Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('deepseek')
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

  // A developer may override which models to hit via testValues; otherwise the
  // service defaults (deepseek-v4-flash / deepseek-v4-pro) are used.
  const chatModel = () => testValues.chatModel || undefined
  const fimModel = () => testValues.fimModel || undefined

  // ── Account / Models (read-only, no token spend) ──

  describe('getBalance', () => {
    it('returns balance info with expected shape', async () => {
      const response = await service.getBalance()

      expect(response).toHaveProperty('is_available')
      expect(response).toHaveProperty('balance_infos')
      expect(Array.isArray(response.balance_infos)).toBe(true)
    })
  })

  describe('listModels', () => {
    it('returns the models list with expected shape', async () => {
      const response = await service.listModels()

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
      expect(response.data.length).toBeGreaterThan(0)
      expect(response.data[0]).toHaveProperty('id')
    })
  })

  describe('getModelsDictionary', () => {
    it('returns dictionary items array with a null cursor', async () => {
      const result = await service.getModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.cursor).toBeNull()
    })

    it('filters models by search term', async () => {
      const all = await service.getModelsDictionary({})
      const term = all.items[0].value.slice(0, 6)

      const filtered = await service.getModelsDictionary({ search: term })

      expect(filtered.items.length).toBeGreaterThan(0)
      filtered.items.forEach(item => {
        expect(item.value.toLowerCase()).toContain(term.toLowerCase())
      })
    })
  })

  // ── Chat Completion (spends a few tokens) ──

  describe('chatCompletion', () => {
    it('returns a shaped chat response', async () => {
      const response = await service.chatCompletion(
        'Reply with the single word: pong',
        chatModel(),
        undefined,
        'Disabled', // faster / cheaper, no reasoning
        undefined,
        undefined,
        undefined,
        16
      )

      expect(response).toHaveProperty('text')
      expect(typeof response.text).toBe('string')
      expect(response.text.length).toBeGreaterThan(0)
      expect(response).toHaveProperty('model')
      expect(response).toHaveProperty('finishReason')
      expect(response).toHaveProperty('usage')
      expect(response.usage).toHaveProperty('total_tokens')
    })

    it('returns valid JSON when JSON mode is enabled', async () => {
      const response = await service.chatCompletion(
        'Return a JSON object like {"ok": true} and nothing else.',
        chatModel(),
        'You output only valid JSON.',
        'Disabled',
        undefined,
        undefined,
        undefined,
        64,
        undefined,
        true
      )

      expect(() => JSON.parse(response.text)).not.toThrow()
    })
  })

  describe('chatCompletionAdvanced', () => {
    it('returns the raw OpenAI-compatible response', async () => {
      const response = await service.chatCompletionAdvanced(
        [
          { role: 'system', content: 'You are terse.' },
          { role: 'user', content: 'Say hi in one word.' },
        ],
        chatModel(),
        'Disabled',
        undefined,
        undefined,
        undefined,
        16
      )

      expect(response).toHaveProperty('choices')
      expect(Array.isArray(response.choices)).toBe(true)
      expect(response.choices[0]).toHaveProperty('message')
      expect(response.choices[0].message).toHaveProperty('content')
      expect(response).toHaveProperty('usage')
    })
  })

  // ── Beta endpoints ──

  describe('chatPrefixCompletion', () => {
    it('returns a continuation and full text with the prefix prepended', async () => {
      const prefix = 'Answer: '
      const response = await service.chatPrefixCompletion(
        'What is 2 + 2? Answer with just the number.',
        prefix,
        fimModel(),
        undefined,
        undefined,
        16
      )

      expect(response).toHaveProperty('text')
      expect(response).toHaveProperty('fullText')
      expect(response.fullText.startsWith(prefix)).toBe(true)
      expect(response.fullText).toBe(`${ prefix }${ response.text }`)
    })
  })

  describe('fimCompletion', () => {
    it('returns a fill-in-the-middle completion', async () => {
      const response = await service.fimCompletion(
        'def add(a, b):\n    return ',
        '\n',
        fimModel(),
        16
      )

      expect(response).toHaveProperty('text')
      expect(typeof response.text).toBe('string')
      expect(response).toHaveProperty('model')
      expect(response).toHaveProperty('usage')
    })
  })
})
