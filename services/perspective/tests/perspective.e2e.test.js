'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Perspective Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('perspective')
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

  // ── analyzeComment ──

  describe('analyzeComment', () => {
    it('scores a neutral comment for toxicity', async () => {
      const result = await service.analyzeComment('Thank you for the thoughtful write-up.')

      expect(result).toHaveProperty('attributeScores')
      expect(result.attributeScores).toHaveProperty('TOXICITY')
      expect(typeof result.attributeScores.TOXICITY.summaryScore.value).toBe('number')
    })

    it('scores multiple attributes at once', async () => {
      const result = await service.analyzeComment(
        'You are being incredibly rude and stupid.',
        ['Toxicity', 'Insult', 'Profanity']
      )

      expect(Object.keys(result.attributeScores).sort()).toEqual(['INSULT', 'PROFANITY', 'TOXICITY'])
    })

    it('returns span scores when span annotations are enabled', async () => {
      const result = await service.analyzeComment(
        'This is a first sentence. This is a second, much ruder sentence.',
        ['Toxicity'],
        ['en'],
        true,
        true
      )

      expect(Array.isArray(result.attributeScores.TOXICITY.spanScores)).toBe(true)
      expect(result.attributeScores.TOXICITY.spanScores.length).toBeGreaterThan(0)
    })

    it('accepts an explicit non-English language for a production attribute', async () => {
      const result = await service.analyzeComment('Este es un comentario normal.', ['Toxicity'], ['es'])

      expect(result.attributeScores).toHaveProperty('TOXICITY')
    })

    it('rejects an unsupported attribute/language combination', async () => {
      await expect(
        service.analyzeComment('Ceci est un commentaire.', ['Flirtation'], ['fr'])
      ).rejects.toThrow(/Perspective API error/)
    })
  })

  // ── suggestCommentScore ──

  describe('suggestCommentScore', () => {
    it('submits feedback for a comment', async () => {
      const result = await service.suggestCommentScore(
        'This comment was scored too harshly.',
        'Toxicity',
        0.1
      )

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
    })
  })
})
