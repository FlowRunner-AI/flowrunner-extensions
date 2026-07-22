'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Storyblok Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('storyblok')
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

  // ── Content Delivery API ──

  describe('getStories', () => {
    it('returns a paginated list of published stories', async () => {
      const result = await service.getStories('Published', undefined, 5, 1)

      expect(result).toHaveProperty('stories')
      expect(Array.isArray(result.stories)).toBe(true)
    })

    it('accepts a sort expression and a filter query', async () => {
      const result = await service.getStories(
        'Published',
        undefined,
        5,
        1,
        'created_at:desc',
        { component: { in: 'page' } }
      )

      expect(Array.isArray(result.stories)).toBe(true)
    })
  })

  describe('getStory', () => {
    it('returns a single story by slug', async () => {
      const { storySlug } = testValues

      if (!storySlug) {
        console.log('Skipping getStory: testValues.storySlug not set')

        return
      }

      const result = await service.getStory(storySlug)

      expect(result).toHaveProperty('story')
      expect(result.story).toHaveProperty('id')
    })

    it('rejects for an unknown slug', async () => {
      await expect(service.getStory(`does-not-exist-${ SUFFIX }`)).rejects.toThrow(/Storyblok API error/)
    })
  })

  describe('getDatasourceEntries', () => {
    it('returns datasource entries', async () => {
      const result = await service.getDatasourceEntries(testValues.datasourceSlug, undefined, 10, 1)

      expect(result).toHaveProperty('datasource_entries')
      expect(Array.isArray(result.datasource_entries)).toBe(true)
    })
  })

  describe('getLinks', () => {
    it('returns the link tree of the space', async () => {
      const result = await service.getLinks('Published')

      expect(result).toHaveProperty('links')
      expect(typeof result.links).toBe('object')
    })
  })

  describe('getTags', () => {
    it('returns the tags used across stories', async () => {
      const result = await service.getTags()

      expect(result).toHaveProperty('tags')
      expect(Array.isArray(result.tags)).toBe(true)
    })
  })

  // ── Content Management API ──

  describe('getSpace', () => {
    it('returns the configured space', async () => {
      const result = await service.getSpace()

      expect(result).toHaveProperty('space')
      expect(result.space).toHaveProperty('id')
    })
  })

  describe('listStories', () => {
    it('lists stories including editorial metadata', async () => {
      const result = await service.listStories(undefined, undefined, 5, 1)

      expect(result).toHaveProperty('stories')
      expect(Array.isArray(result.stories)).toBe(true)
    })
  })

  describe('listAssets', () => {
    it('lists assets in the space', async () => {
      const result = await service.listAssets(undefined, undefined, 5, 1)

      expect(result).toHaveProperty('assets')
      expect(Array.isArray(result.assets)).toBe(true)
    })
  })

  describe('story lifecycle', () => {
    let createdId

    it('creates a story', async () => {
      const { contentType } = testValues

      if (!contentType) {
        console.log('Skipping story lifecycle: testValues.contentType not set')

        return
      }

      const result = await service.createStory(
        `E2E Test ${ SUFFIX }`,
        `e2e-test-${ SUFFIX }`,
        { component: contentType }
      )

      expect(result).toHaveProperty('story')
      expect(result.story).toHaveProperty('id')
      createdId = result.story.id
    })

    it('updates the created story', async () => {
      if (!createdId) {
        console.log('Skipping updateStory: no story was created')

        return
      }

      const result = await service.updateStory(createdId, `E2E Test Updated ${ SUFFIX }`)

      expect(result.story).toHaveProperty('name', `E2E Test Updated ${ SUFFIX }`)
    })

    it('publishes the created story', async () => {
      if (!createdId) {
        console.log('Skipping publishStory: no story was created')

        return
      }

      const result = await service.publishStory(createdId)

      expect(result).toHaveProperty('story')
    })

    it('deletes the created story', async () => {
      if (!createdId) {
        console.log('Skipping deleteStory: no story was created')

        return
      }

      await expect(service.deleteStory(createdId)).resolves.toBeDefined()
    })
  })
})
