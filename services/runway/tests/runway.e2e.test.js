'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Runway Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('runway')
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

  // ── Account ──

  describe('getOrganizationInfo', () => {
    it('returns organization info with credit balance', async () => {
      const result = await service.getOrganizationInfo()

      expect(result).toHaveProperty('creditBalance')
      expect(typeof result.creditBalance).toBe('number')
    })
  })

  describe('getCreditUsage', () => {
    it('returns usage data for a date range', async () => {
      const endDate = new Date().toISOString().split('T')[0]
      const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const result = await service.getCreditUsage(startDate, endDate)

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })
  })

  // ── Voices ──

  describe('listVoices', () => {
    it('returns voice list with expected shape', async () => {
      const result = await service.listVoices(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('hasMore')
    })
  })

  describe('voice CRUD lifecycle', () => {
    let createdVoiceId

    it('creates a voice from a text prompt', async () => {
      const result = await service.createVoice(
        'E2E Test Voice',
        'Created by e2e test - safe to delete',
        undefined,
        'A calm, professional female narrator with a neutral American accent'
      )

      expect(result).toHaveProperty('id')
      createdVoiceId = result.id
    })

    it('gets the created voice', async () => {
      if (!createdVoiceId) {
        console.log('Skipping: voice was not created')
        return
      }

      const result = await service.getVoice(createdVoiceId)

      expect(result).toHaveProperty('id', createdVoiceId)
      expect(result).toHaveProperty('status')
    })

    it('updates the created voice', async () => {
      if (!createdVoiceId) {
        console.log('Skipping: voice was not created')
        return
      }

      const result = await service.updateVoice(createdVoiceId, 'E2E Test Voice Updated')

      expect(result).toHaveProperty('id', createdVoiceId)
    })

    it('deletes the created voice', async () => {
      if (!createdVoiceId) {
        console.log('Skipping: voice was not created')
        return
      }

      const result = await service.deleteVoice(createdVoiceId)

      expect(result).toEqual({ success: true, id: createdVoiceId })
    })
  })

  describe('previewVoice', () => {
    it('generates a voice preview', async () => {
      const result = await service.previewVoice(
        'A cheerful and energetic young female sports commentator'
      )

      expect(result).toHaveProperty('url')
      expect(typeof result.url).toBe('string')
    })
  })

  // ── Avatars ──

  describe('listAvatars', () => {
    it('returns avatar list with expected shape', async () => {
      const result = await service.listAvatars(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('hasMore')
    })
  })

  describe('listAvatarConversations', () => {
    it('returns conversation list', async () => {
      const result = await service.listAvatarConversations(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('getAvatarUsage', () => {
    it('returns usage data', async () => {
      const endDate = new Date().toISOString().split('T')[0]
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const result = await service.getAvatarUsage(startDate, endDate)

      expect(result).toHaveProperty('totalSeconds')
      expect(result).toHaveProperty('totalSessions')
    })
  })

  // ── Knowledge Documents ──

  describe('listDocuments', () => {
    it('returns document list with expected shape', async () => {
      const result = await service.listDocuments(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('document CRUD lifecycle', () => {
    let createdDocId

    it('creates a document', async () => {
      const result = await service.createDocument(
        'E2E Test Document',
        'This is a test document created by e2e tests. Safe to delete.'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Document')
      createdDocId = result.id
    })

    it('gets the created document', async () => {
      if (!createdDocId) {
        console.log('Skipping: document was not created')
        return
      }

      const result = await service.getDocument(createdDocId)

      expect(result).toHaveProperty('id', createdDocId)
      expect(result).toHaveProperty('content')
    })

    it('updates the created document', async () => {
      if (!createdDocId) {
        console.log('Skipping: document was not created')
        return
      }

      const result = await service.updateDocument(createdDocId, 'E2E Test Document Updated')

      expect(result).toHaveProperty('id', createdDocId)
    })

    it('deletes the created document', async () => {
      if (!createdDocId) {
        console.log('Skipping: document was not created')
        return
      }

      const result = await service.deleteDocument(createdDocId)

      expect(result).toEqual({ success: true, id: createdDocId })
    })
  })

  // ── Workflows ──

  describe('listWorkflows', () => {
    it('returns workflow list', async () => {
      const result = await service.listWorkflows()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getImageRatiosDictionary', () => {
    it('returns ratios for Gen-4 Image', async () => {
      const result = await service.getImageRatiosDictionary({
        criteria: { model: 'Gen-4 Image' },
      })

      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.cursor).toBeNull()
    })
  })

  describe('getAvatarsDictionary', () => {
    it('returns avatars dictionary', async () => {
      const result = await service.getAvatarsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })
  })

  describe('getVoicesDictionary', () => {
    it('returns voices dictionary', async () => {
      const result = await service.getVoicesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getWorkflowsDictionary', () => {
    it('returns workflows dictionary', async () => {
      const result = await service.getWorkflowsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })
  })

  // ── Generation (only if testValues indicate it's OK to spend credits) ──

  describe('generateImage (no wait)', () => {
    it('starts an image generation task without waiting', async () => {
      const { allowGeneration } = testValues

      if (!allowGeneration) {
        console.log('Skipping generateImage: testValues.allowGeneration not set')
        return
      }

      const result = await service.generateImage(
        'Gen-4 Image', 'A small red cube on a white table', '1024:1024',
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, false
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('status', 'PENDING')

      // Clean up by cancelling the task
      try {
        await service.cancelTask(result.id)
      } catch {
        // Task may already have completed or been cancelled
      }
    })
  })

  describe('getTask', () => {
    it('retrieves a task by ID (using a recently started task)', async () => {
      const { taskId } = testValues

      if (!taskId) {
        console.log('Skipping getTask: testValues.taskId not set')
        return
      }

      const result = await service.getTask(taskId)

      expect(result).toHaveProperty('id', taskId)
      expect(result).toHaveProperty('status')
    })
  })
})
