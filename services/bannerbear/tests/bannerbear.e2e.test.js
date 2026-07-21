'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Bannerbear Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('bannerbear')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  }, 60000)

  afterAll(() => {
    sandbox.cleanup()
  })

  // A unique-ish suffix so repeated e2e runs are traceable in metadata.
  const suffix = Date.now()

  // ── Account ──

  describe('getAccount', () => {
    it('returns account details with expected shape', async () => {
      const response = await service.getAccount()

      expect(response).toHaveProperty('uid')
      expect(response).toHaveProperty('quota')
    })
  })

  // ── Templates ──

  describe('listTemplates', () => {
    it('returns an array of templates', async () => {
      const response = await service.listTemplates(undefined, undefined, 1, 25)

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('getTemplatesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getTemplatesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getTemplate', () => {
    it('returns a template with its modification layers', async () => {
      // Needs a real template uid; the developer supplies testValues.templateUid.
      if (!testValues.templateUid) {
        console.log('Skipping getTemplate: set testValues.templateUid')
        return
      }

      const response = await service.getTemplate(testValues.templateUid)

      expect(response).toHaveProperty('uid', testValues.templateUid)
      expect(response).toHaveProperty('available_modifications')
    })
  })

  // ── Images ──

  describe('listImages', () => {
    it('returns an array of images', async () => {
      const response = await service.listImages(1, 25)

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('createImage + getImage', () => {
    // Rendering an image needs a real template uid, so this only runs when the
    // developer supplies testValues.templateUid.
    const canRender = () => Boolean(testValues.templateUid)

    let imageUid

    it('creates an image (pending) and returns a uid', async () => {
      if (!canRender()) {
        console.log('Skipping createImage: set testValues.templateUid')
        return
      }

      const response = await service.createImage(
        testValues.templateUid,
        testValues.modifications || [],
        undefined,
        undefined,
        undefined,
        `e2e-${ suffix }`
      )

      expect(response).toHaveProperty('uid')
      expect(response).toHaveProperty('status')
      imageUid = response.uid
    })

    it('retrieves the created image', async () => {
      if (!canRender() || !imageUid) {
        console.log('Skipping getImage: no image created')
        return
      }

      const response = await service.getImage(imageUid)

      expect(response).toHaveProperty('uid', imageUid)
      expect(response).toHaveProperty('status')
    })
  })

  describe('createImage with waitForCompletion', () => {
    // Polling can take up to ~30s, so give this test extra time.
    const canRender = () => Boolean(testValues.templateUid)

    it('renders an image and returns a completed object', async () => {
      if (!canRender()) {
        console.log('Skipping createImage waitForCompletion: set testValues.templateUid')
        return
      }

      const response = await service.createImage(
        testValues.templateUid,
        testValues.modifications || [],
        undefined,
        undefined,
        undefined,
        `e2e-wait-${ suffix }`,
        true
      )

      expect(response).toHaveProperty('uid')
      expect(['completed', 'pending']).toContain(response.status)
    }, 45000)
  })

  // ── Screenshots ──

  describe('createScreenshot', () => {
    it('creates a screenshot render (pending) with a uid', async () => {
      const response = await service.createScreenshot('https://example.com', 1280, 720)

      expect(response).toHaveProperty('uid')
      expect(response).toHaveProperty('status')
    })
  })

  // ── Collections ──

  describe('createCollection + getCollection', () => {
    // A collection needs a real template set uid, so this only runs when the
    // developer supplies testValues.templateSetUid.
    const canRender = () => Boolean(testValues.templateSetUid)

    let collectionUid

    it('creates a collection (pending) and returns a uid', async () => {
      if (!canRender()) {
        console.log('Skipping createCollection: set testValues.templateSetUid')
        return
      }

      const response = await service.createCollection(
        testValues.templateSetUid,
        testValues.modifications || [],
        undefined,
        undefined,
        `e2e-${ suffix }`
      )

      expect(response).toHaveProperty('uid')
      expect(response).toHaveProperty('status')
      collectionUid = response.uid
    })

    it('retrieves the created collection', async () => {
      if (!canRender() || !collectionUid) {
        console.log('Skipping getCollection: no collection created')
        return
      }

      const response = await service.getCollection(collectionUid)

      expect(response).toHaveProperty('uid', collectionUid)
      expect(response).toHaveProperty('status')
    })
  })

  // ── Videos ──

  describe('createVideo + getVideo', () => {
    // A video needs a real video template uid (and often an input media URL),
    // so this only runs when the developer supplies testValues.videoTemplateUid.
    const canRender = () => Boolean(testValues.videoTemplateUid)

    let videoUid

    it('creates a video (pending) and returns a uid', async () => {
      if (!canRender()) {
        console.log('Skipping createVideo: set testValues.videoTemplateUid')
        return
      }

      const response = await service.createVideo(
        testValues.videoTemplateUid,
        testValues.inputMediaUrl,
        testValues.modifications || [],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        `e2e-${ suffix }`
      )

      expect(response).toHaveProperty('uid')
      expect(response).toHaveProperty('status')
      videoUid = response.uid
    })

    it('retrieves the created video', async () => {
      if (!canRender() || !videoUid) {
        console.log('Skipping getVideo: no video created')
        return
      }

      const response = await service.getVideo(videoUid)

      expect(response).toHaveProperty('uid', videoUid)
      expect(response).toHaveProperty('status')
    })
  })

  // ── Animated GIFs ──

  describe('createAnimatedGif', () => {
    // A GIF needs a real template uid and at least one frame, so this only runs
    // when the developer supplies testValues.templateUid.
    const canRender = () => Boolean(testValues.templateUid)

    it('creates an animated gif render (pending) with a uid', async () => {
      if (!canRender()) {
        console.log('Skipping createAnimatedGif: set testValues.templateUid')
        return
      }

      const frames = testValues.gifFrames || [
        testValues.modifications || [],
        testValues.modifications || [],
      ]

      const response = await service.createAnimatedGif(
        testValues.templateUid,
        frames,
        undefined,
        undefined,
        true
      )

      expect(response).toHaveProperty('uid')
      expect(response).toHaveProperty('status')
    })
  })
})
