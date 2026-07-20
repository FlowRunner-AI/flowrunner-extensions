'use strict'

const crypto = require('crypto')

const { createSandbox } = require('../../../service-sandbox')

const CLOUD_NAME = 'test-cloud'
const API_KEY = 'test-api-key'
const API_SECRET = 'test-api-secret'

const API_HOST = 'https://api.cloudinary.com/v1_1'
const DELIVERY_HOST = 'https://res.cloudinary.com'
const BASE = `${ API_HOST }/${ CLOUD_NAME }`

const EXPECTED_BASIC_AUTH = `Basic ${ Buffer.from(`${ API_KEY }:${ API_SECRET }`).toString('base64') }`

// Converts a mock-recorded FormData instance into a plain { key: value } object.
// Array params are appended by the service as `key[]`, so they are collected into arrays.
function formToObject(formData) {
  const result = {}

  for (const { name, value } of formData._fields) {
    if (name.endsWith('[]')) {
      const arrayKey = name.slice(0, -2)

      result[arrayKey] = result[arrayKey] || []
      result[arrayKey].push(value)
    } else {
      result[name] = value
    }
  }

  return result
}

describe('Cloudinary Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ cloudName: CLOUD_NAME, apiKey: API_KEY, apiSecret: API_SECRET })
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
          name: 'cloudName',
          displayName: 'Cloud Name',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiSecret',
          displayName: 'API Secret',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends Basic auth + JSON content type on admin requests', async () => {
      mock.onGet(`${ BASE }/ping`).reply({ status: 'ok' })

      await service.ping()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': EXPECTED_BASIC_AUTH,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Upload API (signed multipart) ──

  describe('uploadAsset', () => {
    it('throws when neither File nor Source URL is provided', async () => {
      await expect(service.uploadAsset()).rejects.toThrow('Either File or Source URL must be provided.')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when both File and Source URL are provided', async () => {
      await expect(
        service.uploadAsset('https://files/x.jpg', 'https://remote/y.jpg')
      ).rejects.toThrow('Provide either File or Source URL, not both.')
    })

    it('uploads from a source URL with auto resource type and default action', async () => {
      mock.onPost(`${ API_HOST }/${ CLOUD_NAME }/auto/upload`).reply({ public_id: 'remote', secure_url: 'https://x' })

      const result = await service.uploadAsset(undefined, 'https://remote/y.jpg')

      expect(result).toEqual({ public_id: 'remote', secure_url: 'https://x' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')

      const fields = formToObject(mock.history[0].formData)

      expect(fields.file).toBe('https://remote/y.jpg')
      expect(fields.api_key).toBe(API_KEY)
      expect(fields).toHaveProperty('timestamp')
      expect(fields).toHaveProperty('signature')
    })

    it('includes all optional params in the signed form and resolves resource type', async () => {
      mock.onPost(`${ API_HOST }/${ CLOUD_NAME }/image/upload`).reply({ public_id: 'products/shoe' })

      await service.uploadAsset(
        undefined,
        'https://remote/y.jpg',
        'products/shoe',
        'products',
        'sale,featured',
        true,
        'w_1000,c_limit',
        'w_400,h_300,c_fill',
        'alt=Red shoe',
        'Image'
      )

      const fields = formToObject(mock.history[0].formData)

      expect(fields).toMatchObject({
        file: 'https://remote/y.jpg',
        public_id: 'products/shoe',
        folder: 'products',
        tags: 'sale,featured',
        overwrite: 'true',
        transformation: 'w_1000,c_limit',
        eager: 'w_400,h_300,c_fill',
        context: 'alt=Red shoe',
      })
    })

    it('downloads FlowRunner file bytes and sends a base64 data URI', async () => {
      const pngBytes = Buffer.from('fake-png-bytes')

      mock.onGet('https://files.flowrunner.com/img.png').reply(pngBytes)
      mock.onPost(`${ API_HOST }/${ CLOUD_NAME }/auto/upload`).reply({ public_id: 'img' })

      await service.uploadAsset('https://files.flowrunner.com/img.png')

      // First call downloads the bytes (binary encoding), second uploads.
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].encoding).toBeNull()
      expect(mock.history[1].method).toBe('post')

      const fields = formToObject(mock.history[1].formData)
      const expectedDataUri = `data:image/png;base64,${ pngBytes.toString('base64') }`

      expect(fields.file).toBe(expectedDataUri)
    })

    it('wraps upload API errors', async () => {
      mock.onPost(`${ API_HOST }/${ CLOUD_NAME }/auto/upload`).replyWithError({
        message: 'Bad',
        body: { error: { message: 'Invalid image file' } },
      })

      await expect(service.uploadAsset(undefined, 'https://remote/y.jpg')).rejects.toThrow(
        'Cloudinary API error: Invalid image file'
      )
    })
  })

  describe('uploadFromUrl', () => {
    it('uploads with required URL only and auto resource type', async () => {
      mock.onPost(`${ API_HOST }/${ CLOUD_NAME }/auto/upload`).reply({ public_id: 'remote' })

      const result = await service.uploadFromUrl('https://remote/y.jpg')

      expect(result).toEqual({ public_id: 'remote' })

      const fields = formToObject(mock.history[0].formData)

      expect(fields.file).toBe('https://remote/y.jpg')
    })

    it('includes optional params and resolves resource type to video', async () => {
      mock.onPost(`${ API_HOST }/${ CLOUD_NAME }/video/upload`).reply({ public_id: 'clip' })

      await service.uploadFromUrl(
        'https://remote/clip.mp4',
        'clip',
        'videos',
        'promo',
        true,
        'w_640',
        'Video'
      )

      const fields = formToObject(mock.history[0].formData)

      expect(fields).toMatchObject({
        file: 'https://remote/clip.mp4',
        public_id: 'clip',
        folder: 'videos',
        tags: 'promo',
        overwrite: 'true',
        transformation: 'w_640',
      })
    })
  })

  describe('renameAsset', () => {
    it('sends a signed rename with default image resource type', async () => {
      mock.onPost(`${ API_HOST }/${ CLOUD_NAME }/image/rename`).reply({ public_id: 'products/shoe' })

      const result = await service.renameAsset('drafts/img', 'products/shoe')

      expect(result).toEqual({ public_id: 'products/shoe' })

      const fields = formToObject(mock.history[0].formData)

      expect(fields).toMatchObject({
        from_public_id: 'drafts/img',
        to_public_id: 'products/shoe',
      })
    })

    it('includes overwrite flag and resolves resource type', async () => {
      mock.onPost(`${ API_HOST }/${ CLOUD_NAME }/raw/rename`).reply({ public_id: 'x' })

      await service.renameAsset('a', 'b', true, 'Raw')

      const fields = formToObject(mock.history[0].formData)

      expect(fields.overwrite).toBe('true')
    })
  })

  describe('destroyAsset', () => {
    it('sends a signed destroy for the given public id', async () => {
      mock.onPost(`${ API_HOST }/${ CLOUD_NAME }/image/destroy`).reply({ result: 'ok' })

      const result = await service.destroyAsset('products/shoe')

      expect(result).toEqual({ result: 'ok' })

      const fields = formToObject(mock.history[0].formData)

      expect(fields.public_id).toBe('products/shoe')
    })

    it('includes invalidate flag and resolves resource type', async () => {
      mock.onPost(`${ API_HOST }/${ CLOUD_NAME }/video/destroy`).reply({ result: 'ok' })

      await service.destroyAsset('clip', true, 'Video')

      const fields = formToObject(mock.history[0].formData)

      expect(fields.invalidate).toBe('true')
    })
  })

  describe('manageTags', () => {
    it('adds a tag to multiple public ids (array serialized as key[])', async () => {
      mock.onPost(`${ API_HOST }/${ CLOUD_NAME }/image/tags`).reply({ public_ids: ['a', 'b'] })

      const result = await service.manageTags('Add', ['a', 'b'], 'sale')

      expect(result).toEqual({ public_ids: ['a', 'b'] })

      const fields = formToObject(mock.history[0].formData)

      expect(fields.command).toBe('add')
      expect(fields.tag).toBe('sale')
      expect(fields.public_ids).toEqual(['a', 'b'])
    })

    it('resolves the Replace command', async () => {
      mock.onPost(`${ API_HOST }/${ CLOUD_NAME }/image/tags`).reply({ public_ids: ['a'] })

      await service.manageTags('Replace', ['a'], 'featured')

      const fields = formToObject(mock.history[0].formData)

      expect(fields.command).toBe('replace')
    })

    it('omits tag for the Remove All command', async () => {
      mock.onPost(`${ API_HOST }/${ CLOUD_NAME }/image/tags`).reply({ public_ids: ['a'] })

      await service.manageTags('Remove All', ['a'])

      const fields = formToObject(mock.history[0].formData)

      expect(fields.command).toBe('remove_all')
      expect(fields).not.toHaveProperty('tag')
    })

    it('throws when tag is missing for a non-remove_all command', async () => {
      await expect(service.manageTags('Add', ['a'])).rejects.toThrow(
        'Tag is required for the Add, Remove, and Replace commands.'
      )
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('applyTransformation', () => {
    it('sends a signed explicit request with type=upload', async () => {
      mock.onPost(`${ API_HOST }/${ CLOUD_NAME }/image/explicit`).reply({ public_id: 'products/shoe', eager: [] })

      const result = await service.applyTransformation('products/shoe', 'w_400,h_300,c_fill')

      expect(result).toEqual({ public_id: 'products/shoe', eager: [] })

      const fields = formToObject(mock.history[0].formData)

      expect(fields).toMatchObject({
        public_id: 'products/shoe',
        type: 'upload',
        eager: 'w_400,h_300,c_fill',
      })
    })

    it('resolves the resource type', async () => {
      mock.onPost(`${ API_HOST }/${ CLOUD_NAME }/video/explicit`).reply({ public_id: 'clip' })

      await service.applyTransformation('clip', 'w_640', 'Video')

      expect(mock.history[0].url).toBe(`${ API_HOST }/${ CLOUD_NAME }/video/explicit`)
    })
  })

  // ── Admin API (Basic auth) ──

  describe('listResources', () => {
    it('lists image resources with defaults', async () => {
      mock.onGet(`${ BASE }/resources/image`).reply({ resources: [], next_cursor: null })

      const result = await service.listResources()

      expect(result).toEqual({ resources: [], next_cursor: null })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({ type: 'upload' })
    })

    it('passes all query params and resolves direction + resource type', async () => {
      mock.onGet(`${ BASE }/resources/video`).reply({ resources: [] })

      await service.listResources('Video', 'clips/', 25, 'CURSOR', true, true, 'Oldest First')

      expect(mock.history[0].query).toEqual({
        type: 'upload',
        prefix: 'clips/',
        max_results: 25,
        next_cursor: 'CURSOR',
        tags: true,
        context: true,
        direction: 'asc',
      })
    })

    it('wraps admin API errors', async () => {
      mock.onGet(`${ BASE }/resources/image`).replyWithError({
        message: 'Fail',
        body: { error: { message: 'Invalid credentials' } },
      })

      await expect(service.listResources()).rejects.toThrow('Cloudinary API error: Invalid credentials')
    })
  })

  describe('searchAssets', () => {
    it('posts a search body with defaults', async () => {
      mock.onPost(`${ BASE }/resources/search`).reply({ total_count: 0, resources: [] })

      const result = await service.searchAssets()

      expect(result).toEqual({ total_count: 0, resources: [] })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        sort_by: [{ created_at: 'desc' }],
      })
    })

    it('includes expression, sort, pagination and mapped with_field', async () => {
      mock.onPost(`${ BASE }/resources/search`).reply({ total_count: 1, resources: [] })

      await service.searchAssets('folder:products', 'public_id', 'Ascending', 25, 'CURSOR', ['Tags', 'Context'])

      expect(mock.history[0].body).toEqual({
        expression: 'folder:products',
        sort_by: [{ public_id: 'asc' }],
        max_results: 25,
        next_cursor: 'CURSOR',
        with_field: ['tags', 'context'],
      })
    })
  })

  describe('getAssetDetails', () => {
    it('fetches details with url-encoded public id and no flags', async () => {
      mock.onGet(`${ BASE }/resources/image/upload/products/shoe%2001`).reply({ public_id: 'products/shoe 01' })

      const result = await service.getAssetDetails('products/shoe 01')

      expect(result).toEqual({ public_id: 'products/shoe 01' })
      expect(mock.history[0].url).toBe(`${ BASE }/resources/image/upload/products/shoe%2001`)
      expect(mock.history[0].query).toEqual({})
    })

    it('includes colors, faces and image metadata flags and resolves resource type', async () => {
      mock.onGet(`${ BASE }/resources/video/upload/clip`).reply({ public_id: 'clip' })

      await service.getAssetDetails('clip', 'Video', true, true, true)

      expect(mock.history[0].query).toEqual({
        colors: true,
        faces: true,
        image_metadata: true,
      })
    })
  })

  describe('updateAsset', () => {
    it('sends a POST to the resource path with cleaned query params', async () => {
      mock.onPost(`${ BASE }/resources/image/upload/products/shoe`).reply({ public_id: 'products/shoe' })

      const result = await service.updateAsset('products/shoe', 'Image', 'sale,featured', 'alt=Red', 'products')

      expect(result).toEqual({ public_id: 'products/shoe' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].query).toEqual({
        tags: 'sale,featured',
        context: 'alt=Red',
        asset_folder: 'products',
      })
    })

    it('sends empty query when no fields are provided', async () => {
      mock.onPost(`${ BASE }/resources/image/upload/products/shoe`).reply({ public_id: 'products/shoe' })

      await service.updateAsset('products/shoe')

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('deleteAssets', () => {
    it('throws when neither Public IDs nor Prefix is provided', async () => {
      await expect(service.deleteAssets()).rejects.toThrow('Either Public IDs or Prefix must be provided.')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when both Public IDs and Prefix are provided', async () => {
      await expect(service.deleteAssets(['a'], 'products/')).rejects.toThrow(
        'Provide either Public IDs or Prefix, not both.'
      )
    })

    it('deletes by public ids (encoded into the URL) via DELETE', async () => {
      const url = `${ BASE }/resources/image/upload?public_ids[]=a&public_ids[]=b%2Fc`

      mock.onDelete(url).reply({ deleted: { a: 'deleted' } })

      const result = await service.deleteAssets(['a', 'b/c'])

      expect(result).toEqual({ deleted: { a: 'deleted' } })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(url)
    })

    it('deletes by prefix and resolves resource type', async () => {
      const url = `${ BASE }/resources/video/upload?prefix=clips%2F`

      mock.onDelete(url).reply({ deleted: {}, partial: false })

      await service.deleteAssets(undefined, 'clips/', 'Video')

      expect(mock.history[0].url).toBe(url)
    })
  })

  describe('listTags', () => {
    it('lists image tags with defaults', async () => {
      mock.onGet(`${ BASE }/tags/image`).reply({ tags: ['sale'] })

      const result = await service.listTags()

      expect(result).toEqual({ tags: ['sale'] })
      expect(mock.history[0].query).toEqual({})
    })

    it('passes prefix and pagination and resolves resource type', async () => {
      mock.onGet(`${ BASE }/tags/video`).reply({ tags: [] })

      await service.listTags('Video', 'pr', 20, 'CURSOR')

      expect(mock.history[0].query).toEqual({
        prefix: 'pr',
        max_results: 20,
        next_cursor: 'CURSOR',
      })
    })
  })

  describe('getUsage', () => {
    it('fetches the usage report', async () => {
      mock.onGet(`${ BASE }/usage`).reply({ plan: 'Free', credits: { usage: 0.71 } })

      const result = await service.getUsage()

      expect(result).toEqual({ plan: 'Free', credits: { usage: 0.71 } })
      expect(mock.history[0].url).toBe(`${ BASE }/usage`)
    })
  })

  describe('ping', () => {
    it('pings the admin API', async () => {
      mock.onGet(`${ BASE }/ping`).reply({ status: 'ok' })

      const result = await service.ping()

      expect(result).toEqual({ status: 'ok' })
      expect(mock.history[0].url).toBe(`${ BASE }/ping`)
    })

    it('wraps errors using body.message when there is no nested error', async () => {
      mock.onGet(`${ BASE }/ping`).replyWithError({
        message: 'HTTP error',
        body: { message: 'Rate limited' },
      })

      await expect(service.ping()).rejects.toThrow('Cloudinary API error: Rate limited')
    })

    it('falls back to error.message when body has no message', async () => {
      mock.onGet(`${ BASE }/ping`).replyWithError({ message: 'Network down' })

      await expect(service.ping()).rejects.toThrow('Cloudinary API error: Network down')
    })
  })

  // ── Folders ──

  describe('listRootFolders', () => {
    it('lists root folders with defaults', async () => {
      mock.onGet(`${ BASE }/folders`).reply({ folders: [{ name: 'products', path: 'products' }] })

      const result = await service.listRootFolders()

      expect(result).toEqual({ folders: [{ name: 'products', path: 'products' }] })
      expect(mock.history[0].query).toEqual({})
    })

    it('passes pagination params', async () => {
      mock.onGet(`${ BASE }/folders`).reply({ folders: [] })

      await service.listRootFolders(50, 'CURSOR')

      expect(mock.history[0].query).toEqual({ max_results: 50, next_cursor: 'CURSOR' })
    })
  })

  describe('listSubfolders', () => {
    it('lists subfolders of an encoded path', async () => {
      mock.onGet(`${ BASE }/folders/products/summer`).reply({ folders: [] })

      const result = await service.listSubfolders('products/summer')

      expect(result).toEqual({ folders: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/folders/products/summer`)
    })

    it('encodes special characters in path segments', async () => {
      mock.onGet(`${ BASE }/folders/my%20folder`).reply({ folders: [] })

      await service.listSubfolders('my folder', 10, 'CURSOR')

      expect(mock.history[0].url).toBe(`${ BASE }/folders/my%20folder`)
      expect(mock.history[0].query).toEqual({ max_results: 10, next_cursor: 'CURSOR' })
    })
  })

  describe('createFolder', () => {
    it('creates a folder via POST to the encoded path', async () => {
      mock.onPost(`${ BASE }/folders/products/summer`).reply({ success: true, path: 'products/summer' })

      const result = await service.createFolder('products/summer')

      expect(result).toEqual({ success: true, path: 'products/summer' })
      expect(mock.history[0].method).toBe('post')
    })
  })

  describe('deleteFolder', () => {
    it('deletes a folder via DELETE to the encoded path', async () => {
      mock.onDelete(`${ BASE }/folders/products/summer`).reply({ deleted: ['products/summer'] })

      const result = await service.deleteFolder('products/summer')

      expect(result).toEqual({ deleted: ['products/summer'] })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Delivery ──

  describe('generateDeliveryUrl', () => {
    it('builds a plain delivery URL with no API call', async () => {
      const result = await service.generateDeliveryUrl('products/shoe')

      expect(mock.history).toHaveLength(0)
      expect(result).toEqual({
        url: `${ DELIVERY_HOST }/${ CLOUD_NAME }/image/upload/products/shoe`,
        publicId: 'products/shoe',
        resourceType: 'image',
        transformation: null,
        format: null,
        signed: false,
      })
    })

    it('includes transformation, version and format', async () => {
      const result = await service.generateDeliveryUrl('products/shoe', 'w_400,c_fill', 'jpg', 'Image', 'v1712345678')

      expect(result.url).toBe(
        `${ DELIVERY_HOST }/${ CLOUD_NAME }/image/upload/w_400,c_fill/v1712345678/products/shoe.jpg`
      )
      expect(result.transformation).toBe('w_400,c_fill')
      expect(result.format).toBe('jpg')
    })

    it('normalizes a version that already has a v prefix', async () => {
      const result = await service.generateDeliveryUrl('shoe', undefined, undefined, 'Image', 'v999')

      expect(result.url).toBe(`${ DELIVERY_HOST }/${ CLOUD_NAME }/image/upload/v999/shoe`)
    })

    it('adds a signature computed with the API secret when signUrl is true', async () => {
      const transformation = 'w_400,c_fill'
      const format = 'jpg'
      const publicIdPart = `products/shoe.${ format }`
      const stringToSign = [transformation, publicIdPart].join('/')
      const digest = crypto.createHash('sha1').update(stringToSign + API_SECRET).digest('base64')
      const expectedSig = `s--${ digest.replace(/\+/g, '-').replace(/\//g, '_').substring(0, 8) }--`

      const result = await service.generateDeliveryUrl('products/shoe', transformation, format, 'Image', undefined, true)

      expect(result.signed).toBe(true)
      expect(result.url).toBe(
        `${ DELIVERY_HOST }/${ CLOUD_NAME }/image/upload/${ expectedSig }/${ transformation }/${ publicIdPart }`
      )
    })
  })

  describe('downloadAsset', () => {
    let uploadFileMock

    beforeEach(() => {
      uploadFileMock = jest.fn().mockResolvedValue({ url: 'https://storage.flowrunner.com/files/flow/shoe.jpg' })
      // Files API is injected by the FlowRunner runtime; stub it at the test boundary.
      service.flowrunner = { Files: { uploadFile: uploadFileMock } }
    })

    afterEach(() => {
      delete service.flowrunner
    })

    it('downloads bytes from the delivery URL and stores them in FlowRunner files', async () => {
      const bytes = Buffer.from('image-bytes')

      mock.onGet(`${ DELIVERY_HOST }/${ CLOUD_NAME }/image/upload/w_400,c_fill/products/shoe.jpg`).reply(bytes)

      const result = await service.downloadAsset('products/shoe', 'w_400,c_fill', 'jpg')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].encoding).toBeNull()

      expect(uploadFileMock).toHaveBeenCalledTimes(1)

      const [buffer, options] = uploadFileMock.mock.calls[0]

      expect(Buffer.isBuffer(buffer)).toBe(true)
      expect(buffer.toString()).toBe('image-bytes')
      expect(options).toMatchObject({ generateUrl: true, overwrite: true, scope: 'FLOW' })
      expect(options.filename).toMatch(/^shoe_\d+\.jpg$/)

      expect(result).toMatchObject({
        fileUrl: 'https://storage.flowrunner.com/files/flow/shoe.jpg',
        sizeBytes: bytes.length,
        sourceUrl: `${ DELIVERY_HOST }/${ CLOUD_NAME }/image/upload/w_400,c_fill/products/shoe.jpg`,
      })
      expect(result.filename).toMatch(/^shoe_\d+\.jpg$/)
    })

    it('passes through custom file options (scope) and resolves resource type', async () => {
      const bytes = Buffer.from('clip')

      mock.onGet(`${ DELIVERY_HOST }/${ CLOUD_NAME }/video/upload/clip`).reply(bytes)

      await service.downloadAsset('clip', undefined, undefined, 'Video', false, { scope: 'WORKSPACE' })

      const [, options] = uploadFileMock.mock.calls[0]

      expect(options).toMatchObject({ scope: 'WORKSPACE' })
    })
  })

  // ── Dictionaries ──

  describe('getFoldersDictionary', () => {
    it('lists root folders and maps them to items', async () => {
      mock.onGet(`${ BASE }/folders`).reply({
        folders: [
          { name: 'products', path: 'products' },
          { name: 'marketing', path: 'marketing' },
        ],
        next_cursor: null,
      })

      const result = await service.getFoldersDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/folders`)
      expect(mock.history[0].query).toMatchObject({ max_results: 100 })
      expect(result).toEqual({
        items: [
          { label: 'products', value: 'products', note: 'folder' },
          { label: 'marketing', value: 'marketing', note: 'folder' },
        ],
        cursor: null,
      })
    })

    it('filters root folders by name', async () => {
      mock.onGet(`${ BASE }/folders`).reply({
        folders: [
          { name: 'products', path: 'products' },
          { name: 'marketing', path: 'marketing' },
        ],
      })

      const result = await service.getFoldersDictionary({ search: 'mark' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('marketing')
    })

    it('browses subfolders when the search contains a slash', async () => {
      mock.onGet(`${ BASE }/folders/products`).reply({
        folders: [
          { name: 'summer', path: 'products/summer' },
          { name: 'winter', path: 'products/winter' },
        ],
        next_cursor: 'NEXT',
      })

      const result = await service.getFoldersDictionary({ search: 'products/sum' })

      expect(mock.history[0].url).toBe(`${ BASE }/folders/products`)
      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('products/summer')
      expect(result.cursor).toBe('NEXT')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/folders`).reply({ folders: [] })

      const result = await service.getFoldersDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getTagsDictionary', () => {
    it('lists image tags and maps them to items', async () => {
      mock.onGet(`${ BASE }/tags/image`).reply({ tags: ['sale', 'summer'], next_cursor: null })

      const result = await service.getTagsDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/tags/image`)
      expect(mock.history[0].query).toMatchObject({ max_results: 50 })
      expect(result).toEqual({
        items: [
          { label: 'sale', value: 'sale' },
          { label: 'summer', value: 'summer' },
        ],
        cursor: null,
      })
    })

    it('passes the search string as a prefix and forwards the cursor', async () => {
      mock.onGet(`${ BASE }/tags/image`).reply({ tags: ['sale'], next_cursor: 'NEXT' })

      const result = await service.getTagsDictionary({ search: 'sa', cursor: 'CUR' })

      expect(mock.history[0].query).toMatchObject({ prefix: 'sa', next_cursor: 'CUR' })
      expect(result.cursor).toBe('NEXT')
    })

    it('handles a null payload and missing tags', async () => {
      mock.onGet(`${ BASE }/tags/image`).reply({})

      const result = await service.getTagsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getRecentAssetsDictionary', () => {
    it('searches recent assets and maps public ids to items', async () => {
      mock.onPost(`${ BASE }/resources/search`).reply({
        resources: [
          { public_id: 'products/shoe', resource_type: 'image', format: 'jpg' },
          { public_id: 'clip', resource_type: 'video', format: 'mp4' },
        ],
        next_cursor: 'NEXT',
      })

      const result = await service.getRecentAssetsDictionary({})

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toMatchObject({
        sort_by: [{ created_at: 'desc' }],
        max_results: 50,
      })
      expect(result).toEqual({
        items: [
          { label: 'products/shoe', value: 'products/shoe', note: 'image/jpg' },
          { label: 'clip', value: 'clip', note: 'video/mp4' },
        ],
        cursor: 'NEXT',
      })
    })

    it('builds a prefix expression from the search term and forwards the cursor', async () => {
      mock.onPost(`${ BASE }/resources/search`).reply({ resources: [], next_cursor: null })

      const result = await service.getRecentAssetsDictionary({ search: 'products/sh', cursor: 'CUR' })

      expect(mock.history[0].body).toMatchObject({
        expression: 'public_id:products/sh*',
        next_cursor: 'CUR',
      })
      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles a null payload', async () => {
      mock.onPost(`${ BASE }/resources/search`).reply({ resources: [] })

      const result = await service.getRecentAssetsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})
