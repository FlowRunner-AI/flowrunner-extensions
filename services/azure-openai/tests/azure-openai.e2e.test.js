'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Azure OpenAI Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('azure-openai')
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

  // ── askAI ──

  describe('askAI', () => {
    it('returns a text response with usage', async () => {
      const deployment = testValues.chatDeployment

      if (!deployment) {
        console.log('Skipping: no chatDeployment in testValues')
        return
      }

      const result = await service.askAI(deployment, 'Say hello in one word.')

      expect(result).toHaveProperty('text')
      expect(typeof result.text).toBe('string')
      expect(result.text.length).toBeGreaterThan(0)
      expect(result).toHaveProperty('finishReason')
      expect(result).toHaveProperty('usage')
      expect(result.usage).toHaveProperty('total_tokens')
    })

    it('includes system instruction', async () => {
      const deployment = testValues.chatDeployment

      if (!deployment) {
        console.log('Skipping: no chatDeployment in testValues')
        return
      }

      const result = await service.askAI(
        deployment,
        'What is 2+2?',
        'Always answer with just the number, nothing else.'
      )

      expect(result).toHaveProperty('text')
      expect(result.text.length).toBeGreaterThan(0)
    })
  })

  // ── chatCompletionAdvanced ──

  describe('chatCompletionAdvanced', () => {
    it('returns full API response', async () => {
      const deployment = testValues.chatDeployment

      if (!deployment) {
        console.log('Skipping: no chatDeployment in testValues')
        return
      }

      const result = await service.chatCompletionAdvanced(
        deployment,
        [{ role: 'user', content: 'Say hi' }]
      )

      expect(result).toHaveProperty('choices')
      expect(Array.isArray(result.choices)).toBe(true)
      expect(result.choices.length).toBeGreaterThan(0)
      expect(result.choices[0]).toHaveProperty('message')
      expect(result).toHaveProperty('usage')
    })
  })

  // ── createEmbeddings ──

  describe('createEmbeddings', () => {
    it('returns embeddings for input text', async () => {
      const deployment = testValues.embeddingsDeployment

      if (!deployment) {
        console.log('Skipping: no embeddingsDeployment in testValues')
        return
      }

      const result = await service.createEmbeddings(deployment, ['Hello world'])

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data.length).toBeGreaterThan(0)
      expect(result.data[0]).toHaveProperty('embedding')
      expect(Array.isArray(result.data[0].embedding)).toBe(true)
      expect(result).toHaveProperty('usage')
    })
  })
})
