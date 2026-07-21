'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.bannerbear.com/v2'

describe('Bannerbear Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the Authorization bearer header on requests', async () => {
      mock.onGet(`${ BASE }/account`).reply({ uid: 'acct_1' })

      await service.getAccount()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Images ──

  describe('createImage', () => {
    it('sends with required params only', async () => {
      mock.onPost(`${ BASE }/images`).reply({ uid: 'img_1', status: 'pending' })

      const modifications = [{ name: 'title', text: 'Hello' }]
      const result = await service.createImage('tmpl_1', modifications)

      expect(result).toEqual({ uid: 'img_1', status: 'pending' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/images`)
      expect(mock.history[0].body).toEqual({
        template: 'tmpl_1',
        modifications,
      })
    })

    it('defaults modifications to an empty array when omitted', async () => {
      mock.onPost(`${ BASE }/images`).reply({ uid: 'img_2', status: 'pending' })

      await service.createImage('tmpl_1')

      expect(mock.history[0].body).toEqual({
        template: 'tmpl_1',
        modifications: [],
      })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/images`).reply({ uid: 'img_3', status: 'pending' })

      const modifications = [{ name: 'photo', image_url: 'https://x.com/p.png' }]
      await service.createImage(
        'tmpl_1',
        modifications,
        'https://hook.example.com',
        true,
        true,
        'meta-string',
        false
      )

      expect(mock.history[0].body).toEqual({
        template: 'tmpl_1',
        modifications,
        webhook_url: 'https://hook.example.com',
        transparent: true,
        render_pdf: true,
        metadata: 'meta-string',
      })
    })

    it('omits transparent and render_pdf when passed false', async () => {
      mock.onPost(`${ BASE }/images`).reply({ uid: 'img_4', status: 'pending' })

      await service.createImage('tmpl_1', [], undefined, false, false)

      expect(mock.history[0].body).toEqual({ template: 'tmpl_1', modifications: [] })
    })

    it('returns the pending object immediately when waitForCompletion is not set', async () => {
      mock.onPost(`${ BASE }/images`).reply({ uid: 'img_5', status: 'pending' })

      const result = await service.createImage('tmpl_1', [])

      expect(result).toEqual({ uid: 'img_5', status: 'pending' })
      expect(mock.history).toHaveLength(1)
    })

    it('polls until completion when waitForCompletion is true', async () => {
      mock.onPost(`${ BASE }/images`).reply({ uid: 'img_6', status: 'pending' })
      mock.onGet(`${ BASE }/images/img_6`).reply({
        uid: 'img_6',
        status: 'completed',
        image_url: 'https://cdn.bannerbear.com/img_6.png',
      })

      const result = await service.createImage('tmpl_1', [], undefined, undefined, undefined, undefined, true)

      expect(result).toMatchObject({ uid: 'img_6', status: 'completed' })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].method).toBe('get')
      expect(mock.history[1].url).toBe(`${ BASE }/images/img_6`)
    })

    it('does not poll when the create response is already completed', async () => {
      mock.onPost(`${ BASE }/images`).reply({ uid: 'img_7', status: 'completed', image_url: 'https://x' })

      const result = await service.createImage('tmpl_1', [], undefined, undefined, undefined, undefined, true)

      expect(result).toMatchObject({ uid: 'img_7', status: 'completed' })
      expect(mock.history).toHaveLength(1)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/images`).replyWithError({ message: 'Bad template', status: 422 })

      await expect(service.createImage('tmpl_1', [])).rejects.toThrow(
        'Bannerbear API error (422): Bad template'
      )
    })
  })

  describe('getImage', () => {
    it('fetches an image by uid', async () => {
      mock.onGet(`${ BASE }/images/img_1`).reply({ uid: 'img_1', status: 'completed' })

      const result = await service.getImage('img_1')

      expect(result).toEqual({ uid: 'img_1', status: 'completed' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/images/img_1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/images/img_1`).replyWithError({ message: 'Not found' })

      await expect(service.getImage('img_1')).rejects.toThrow('Bannerbear API error: Not found')
    })
  })

  describe('listImages', () => {
    it('sends no pagination query params when none provided', async () => {
      mock.onGet(`${ BASE }/images`).reply([])

      const result = await service.listImages()

      expect(result).toEqual([])
      expect(mock.history[0].url).toBe(`${ BASE }/images`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes page and limit query params', async () => {
      mock.onGet(`${ BASE }/images`).reply([{ uid: 'img_1' }])

      await service.listImages(2, 50)

      expect(mock.history[0].query).toEqual({ page: 2, limit: 50 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/images`).replyWithError({ message: 'Boom' })

      await expect(service.listImages()).rejects.toThrow('Bannerbear API error: Boom')
    })
  })

  // ── Templates ──

  describe('listTemplates', () => {
    it('sends no query params when none provided', async () => {
      mock.onGet(`${ BASE }/templates`).reply([])

      const result = await service.listTemplates()

      expect(result).toEqual([])
      expect(mock.history[0].query).toEqual({})
    })

    it('includes name, tag, page and limit filters when provided', async () => {
      mock.onGet(`${ BASE }/templates`).reply([{ uid: 'tmpl_1' }])

      await service.listTemplates('Social', 'promo', 1, 25)

      expect(mock.history[0].query).toEqual({
        name: 'Social',
        tag: 'promo',
        page: 1,
        limit: 25,
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/templates`).replyWithError({ message: 'Boom' })

      await expect(service.listTemplates()).rejects.toThrow('Bannerbear API error: Boom')
    })
  })

  describe('getTemplate', () => {
    it('fetches a template by uid', async () => {
      mock.onGet(`${ BASE }/templates/tmpl_1`).reply({ uid: 'tmpl_1', name: 'Social Post' })

      const result = await service.getTemplate('tmpl_1')

      expect(result).toEqual({ uid: 'tmpl_1', name: 'Social Post' })
      expect(mock.history[0].url).toBe(`${ BASE }/templates/tmpl_1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/templates/tmpl_1`).replyWithError({ message: 'Not found' })

      await expect(service.getTemplate('tmpl_1')).rejects.toThrow('Bannerbear API error: Not found')
    })
  })

  // ── Videos ──

  describe('createVideo', () => {
    it('sends with required params only', async () => {
      mock.onPost(`${ BASE }/videos`).reply({ uid: 'vid_1', status: 'pending' })

      const result = await service.createVideo('vtmpl_1')

      expect(result).toEqual({ uid: 'vid_1', status: 'pending' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/videos`)
      expect(mock.history[0].body).toEqual({ video_template: 'vtmpl_1' })
    })

    it('includes all optional params and maps the zoom choice', async () => {
      mock.onPost(`${ BASE }/videos`).reply({ uid: 'vid_2', status: 'pending' })

      const modifications = [{ name: 'title', text: 'Hi' }]
      const frames = [[{ name: 'title', text: 'A' }]]
      await service.createVideo(
        'vtmpl_1',
        'https://x.com/in.mp4',
        modifications,
        frames,
        'Center',
        '00:00:01',
        '00:00:05',
        'https://hook.example.com',
        'meta'
      )

      expect(mock.history[0].body).toEqual({
        video_template: 'vtmpl_1',
        input_media_url: 'https://x.com/in.mp4',
        modifications,
        frames,
        zoom: 'center',
        trim_start_time: '00:00:01',
        trim_end_time: '00:00:05',
        webhook_url: 'https://hook.example.com',
        metadata: 'meta',
      })
    })

    it('passes an unknown zoom value through unchanged', async () => {
      mock.onPost(`${ BASE }/videos`).reply({ uid: 'vid_3', status: 'pending' })

      await service.createVideo('vtmpl_1', undefined, undefined, undefined, 'diagonal')

      expect(mock.history[0].body).toEqual({
        video_template: 'vtmpl_1',
        zoom: 'diagonal',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/videos`).replyWithError({ message: 'Boom', status: 500 })

      await expect(service.createVideo('vtmpl_1')).rejects.toThrow('Bannerbear API error (500): Boom')
    })
  })

  describe('getVideo', () => {
    it('fetches a video by uid', async () => {
      mock.onGet(`${ BASE }/videos/vid_1`).reply({ uid: 'vid_1', status: 'completed' })

      const result = await service.getVideo('vid_1')

      expect(result).toEqual({ uid: 'vid_1', status: 'completed' })
      expect(mock.history[0].url).toBe(`${ BASE }/videos/vid_1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/videos/vid_1`).replyWithError({ message: 'Not found' })

      await expect(service.getVideo('vid_1')).rejects.toThrow('Bannerbear API error: Not found')
    })
  })

  // ── Collections ──

  describe('createCollection', () => {
    it('sends with required params only', async () => {
      mock.onPost(`${ BASE }/collections`).reply({ uid: 'col_1', status: 'pending' })

      const modifications = [{ name: 'title', text: 'Hi' }]
      const result = await service.createCollection('set_1', modifications)

      expect(result).toEqual({ uid: 'col_1', status: 'pending' })
      expect(mock.history[0].url).toBe(`${ BASE }/collections`)
      expect(mock.history[0].body).toEqual({
        template_set: 'set_1',
        modifications,
      })
    })

    it('defaults modifications to an empty array when omitted', async () => {
      mock.onPost(`${ BASE }/collections`).reply({ uid: 'col_2', status: 'pending' })

      await service.createCollection('set_1')

      expect(mock.history[0].body).toEqual({
        template_set: 'set_1',
        modifications: [],
      })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/collections`).reply({ uid: 'col_3', status: 'pending' })

      const modifications = [{ name: 'photo', image_url: 'https://x.com/p.png' }]
      await service.createCollection('set_1', modifications, true, 'https://hook.example.com', 'meta')

      expect(mock.history[0].body).toEqual({
        template_set: 'set_1',
        modifications,
        transparent: true,
        webhook_url: 'https://hook.example.com',
        metadata: 'meta',
      })
    })

    it('omits transparent when passed false', async () => {
      mock.onPost(`${ BASE }/collections`).reply({ uid: 'col_4', status: 'pending' })

      await service.createCollection('set_1', [], false)

      expect(mock.history[0].body).toEqual({ template_set: 'set_1', modifications: [] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/collections`).replyWithError({ message: 'Boom' })

      await expect(service.createCollection('set_1', [])).rejects.toThrow('Bannerbear API error: Boom')
    })
  })

  describe('getCollection', () => {
    it('fetches a collection by uid', async () => {
      mock.onGet(`${ BASE }/collections/col_1`).reply({ uid: 'col_1', status: 'completed' })

      const result = await service.getCollection('col_1')

      expect(result).toEqual({ uid: 'col_1', status: 'completed' })
      expect(mock.history[0].url).toBe(`${ BASE }/collections/col_1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/collections/col_1`).replyWithError({ message: 'Not found' })

      await expect(service.getCollection('col_1')).rejects.toThrow('Bannerbear API error: Not found')
    })
  })

  // ── Screenshots ──

  describe('createScreenshot', () => {
    it('sends with required params only', async () => {
      mock.onPost(`${ BASE }/screenshots`).reply({ uid: 'ss_1', status: 'pending' })

      const result = await service.createScreenshot('https://example.com')

      expect(result).toEqual({ uid: 'ss_1', status: 'pending' })
      expect(mock.history[0].url).toBe(`${ BASE }/screenshots`)
      expect(mock.history[0].body).toEqual({ url: 'https://example.com' })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/screenshots`).reply({ uid: 'ss_2', status: 'pending' })

      await service.createScreenshot('https://example.com', 1280, 720, true, 'https://hook.example.com', 'meta')

      expect(mock.history[0].body).toEqual({
        url: 'https://example.com',
        width: 1280,
        height: 720,
        mobile: true,
        webhook_url: 'https://hook.example.com',
        metadata: 'meta',
      })
    })

    it('omits mobile when passed false', async () => {
      mock.onPost(`${ BASE }/screenshots`).reply({ uid: 'ss_3', status: 'pending' })

      await service.createScreenshot('https://example.com', undefined, undefined, false)

      expect(mock.history[0].body).toEqual({ url: 'https://example.com' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/screenshots`).replyWithError({ message: 'Boom' })

      await expect(service.createScreenshot('https://example.com')).rejects.toThrow(
        'Bannerbear API error: Boom'
      )
    })
  })

  // ── Animated GIFs ──

  describe('createAnimatedGif', () => {
    it('sends with required params only', async () => {
      mock.onPost(`${ BASE }/animated_gifs`).reply({ uid: 'gif_1', status: 'pending' })

      const frames = [[{ name: 'title', text: 'A' }], [{ name: 'title', text: 'B' }]]
      const result = await service.createAnimatedGif('tmpl_1', frames)

      expect(result).toEqual({ uid: 'gif_1', status: 'pending' })
      expect(mock.history[0].url).toBe(`${ BASE }/animated_gifs`)
      expect(mock.history[0].body).toEqual({
        template: 'tmpl_1',
        frames,
      })
    })

    it('defaults frames to an empty array when omitted', async () => {
      mock.onPost(`${ BASE }/animated_gifs`).reply({ uid: 'gif_2', status: 'pending' })

      await service.createAnimatedGif('tmpl_1')

      expect(mock.history[0].body).toEqual({ template: 'tmpl_1', frames: [] })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/animated_gifs`).reply({ uid: 'gif_3', status: 'pending' })

      const frames = [[{ name: 'title', text: 'A' }]]
      await service.createAnimatedGif(
        'tmpl_1',
        frames,
        12,
        [500, 500],
        true,
        'https://x.com/in.mp4',
        'https://hook.example.com',
        'meta'
      )

      expect(mock.history[0].body).toEqual({
        template: 'tmpl_1',
        frames,
        fps: 12,
        frame_durations: [500, 500],
        loop: true,
        input_media_url: 'https://x.com/in.mp4',
        webhook_url: 'https://hook.example.com',
        metadata: 'meta',
      })
    })

    it('omits loop when passed false', async () => {
      mock.onPost(`${ BASE }/animated_gifs`).reply({ uid: 'gif_4', status: 'pending' })

      await service.createAnimatedGif('tmpl_1', [], undefined, undefined, false)

      expect(mock.history[0].body).toEqual({ template: 'tmpl_1', frames: [] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/animated_gifs`).replyWithError({ message: 'Boom' })

      await expect(service.createAnimatedGif('tmpl_1', [])).rejects.toThrow('Bannerbear API error: Boom')
    })
  })

  // ── Account ──

  describe('getAccount', () => {
    it('fetches account details', async () => {
      mock.onGet(`${ BASE }/account`).reply({ uid: 'acct_1', quota: 30000, usage: 1420 })

      const result = await service.getAccount()

      expect(result).toEqual({ uid: 'acct_1', quota: 30000, usage: 1420 })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/account`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/account`).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.getAccount()).rejects.toThrow('Bannerbear API error (401): Unauthorized')
    })
  })

  // ── Dictionary ──

  describe('getTemplatesDictionary', () => {
    const templatesResponse = [
      { uid: 'tmpl_1', name: 'Social Post', width: 1200, height: 630 },
      { uid: 'tmpl_2', name: 'Banner', width: 728, height: 90 },
    ]

    it('maps templates to items with dimension notes', async () => {
      mock.onGet(`${ BASE }/templates`).reply(templatesResponse)

      const result = await service.getTemplatesDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/templates`)
      expect(mock.history[0].query).toMatchObject({ page: 1, limit: 100 })
      expect(result.items).toEqual([
        { label: 'Social Post', value: 'tmpl_1', note: '1200x630' },
        { label: 'Banner', value: 'tmpl_2', note: '728x90' },
      ])
    })

    it('passes the search string as the name query param', async () => {
      mock.onGet(`${ BASE }/templates`).reply(templatesResponse)

      await service.getTemplatesDictionary({ search: 'Social' })

      expect(mock.history[0].query).toMatchObject({ name: 'Social', page: 1, limit: 100 })
    })

    it('parses the cursor into the page query param', async () => {
      mock.onGet(`${ BASE }/templates`).reply([])

      await service.getTemplatesDictionary({ cursor: '3' })

      expect(mock.history[0].query).toMatchObject({ page: 3, limit: 100 })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/templates`).reply([])

      const result = await service.getTemplatesDictionary(null)

      expect(result.items).toEqual([])
      expect(result.cursor).toBeUndefined()
      expect(mock.history[0].query).toMatchObject({ page: 1, limit: 100 })
    })

    it('falls back to uid as label and omits note when dimensions are missing', async () => {
      mock.onGet(`${ BASE }/templates`).reply([{ uid: 'tmpl_3' }])

      const result = await service.getTemplatesDictionary({})

      expect(result.items).toEqual([{ label: 'tmpl_3', value: 'tmpl_3', note: undefined }])
    })

    it('handles a non-array response', async () => {
      mock.onGet(`${ BASE }/templates`).reply({ notAnArray: true })

      const result = await service.getTemplatesDictionary({})

      expect(result.items).toEqual([])
      expect(result.cursor).toBeUndefined()
    })

    it('returns a next-page cursor when the page is full', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        uid: `tmpl_${ i }`,
        name: `Template ${ i }`,
        width: 100,
        height: 100,
      }))
      mock.onGet(`${ BASE }/templates`).reply(fullPage)

      const result = await service.getTemplatesDictionary({})

      expect(result.items).toHaveLength(100)
      expect(result.cursor).toBe('2')
    })

    it('returns an incremented cursor based on the current page', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        uid: `tmpl_${ i }`,
        name: `Template ${ i }`,
        width: 100,
        height: 100,
      }))
      mock.onGet(`${ BASE }/templates`).reply(fullPage)

      const result = await service.getTemplatesDictionary({ cursor: '4' })

      expect(result.cursor).toBe('5')
    })
  })
})
