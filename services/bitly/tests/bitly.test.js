'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_TOKEN = 'test-access-token-123'
const BASE = 'https://api-ssl.bitly.com/v4'

// Bitlink ids contain a slash and are URL-encoded into the request path.
const BITLINK = 'bit.ly/abc123'
const ENCODED_BITLINK = encodeURIComponent(BITLINK) // bit.ly%2Fabc123

describe('Bitly Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accessToken: ACCESS_TOKEN })
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
          name: 'accessToken',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the access token as a Bearer Authorization header', async () => {
      mock.onGet(`${ BASE }/user`).reply({ login: 'jdoe' })

      await service.getUser()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ ACCESS_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Links ──

  describe('shortenLink', () => {
    it('sends correct request with required params only (defaults domain to bit.ly)', async () => {
      mock.onPost(`${ BASE }/shorten`).reply({ id: 'bit.ly/3xY4zAb', link: 'https://bit.ly/3xY4zAb' })

      const result = await service.shortenLink('https://example.com/page')

      expect(result).toEqual({ id: 'bit.ly/3xY4zAb', link: 'https://bit.ly/3xY4zAb' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        long_url: 'https://example.com/page',
        domain: 'bit.ly',
      })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/shorten`).reply({ id: 'brand.co/xyz' })

      await service.shortenLink('https://example.com/page', 'brand.co', 'Bg1AbCdEf')

      expect(mock.history[0].body).toEqual({
        long_url: 'https://example.com/page',
        domain: 'brand.co',
        group_guid: 'Bg1AbCdEf',
      })
    })

    it('throws a Bitly API error on failure', async () => {
      mock.onPost(`${ BASE }/shorten`).replyWithError({
        message: 'Network Error',
        body: { message: 'ALREADY_A_BITLY_LINK', description: 'The URL is already a Bitlink' },
      })

      await expect(service.shortenLink('https://bit.ly/abc')).rejects.toThrow(
        'Bitly API error: ALREADY_A_BITLY_LINK - The URL is already a Bitlink'
      )
    })
  })

  describe('createBitlink', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(`${ BASE }/bitlinks`).reply({ id: 'bit.ly/3xY4zAb' })

      const result = await service.createBitlink('https://example.com/page')

      expect(result).toEqual({ id: 'bit.ly/3xY4zAb' })
      expect(mock.history[0].body).toEqual({
        long_url: 'https://example.com/page',
        domain: 'bit.ly',
      })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/bitlinks`).reply({ id: 'bit.ly/3xY4zAb' })

      const deeplinks = [{ app_uri_path: '/store', app_id: 'com.example' }]

      await service.createBitlink(
        'https://example.com/page',
        'Launch page',
        ['launch', 'promo'],
        deeplinks,
        'brand.co',
        'Bg1AbCdEf'
      )

      expect(mock.history[0].body).toEqual({
        long_url: 'https://example.com/page',
        title: 'Launch page',
        tags: ['launch', 'promo'],
        deeplinks,
        domain: 'brand.co',
        group_guid: 'Bg1AbCdEf',
      })
    })

    it('omits empty tags and deeplinks arrays', async () => {
      mock.onPost(`${ BASE }/bitlinks`).reply({ id: 'bit.ly/3xY4zAb' })

      await service.createBitlink('https://example.com/page', 'Title', [], [])

      expect(mock.history[0].body).toEqual({
        long_url: 'https://example.com/page',
        title: 'Title',
        domain: 'bit.ly',
      })
    })

    it('throws a Bitly API error on failure', async () => {
      mock.onPost(`${ BASE }/bitlinks`).replyWithError({
        message: 'Bad Request',
        body: { message: 'INVALID_ARG_LONG_URL', description: 'Invalid long URL' },
      })

      await expect(service.createBitlink('not-a-url')).rejects.toThrow('Bitly API error:')
    })
  })

  describe('getBitlink', () => {
    it('sends a GET to the URL-encoded bitlink path', async () => {
      mock.onGet(`${ BASE }/bitlinks/${ ENCODED_BITLINK }`).reply({ id: BITLINK, long_url: 'https://example.com' })

      const result = await service.getBitlink(BITLINK)

      expect(result).toEqual({ id: BITLINK, long_url: 'https://example.com' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/bitlinks/${ ENCODED_BITLINK }`)
    })

    it('strips protocol and trailing slash before encoding', async () => {
      mock.onGet(`${ BASE }/bitlinks/${ ENCODED_BITLINK }`).reply({ id: BITLINK })

      await service.getBitlink('https://bit.ly/abc123/')

      expect(mock.history[0].url).toBe(`${ BASE }/bitlinks/${ ENCODED_BITLINK }`)
    })

    it('throws when bitlink is missing', async () => {
      await expect(service.getBitlink()).rejects.toThrow(
        'Bitly API error: A bitlink (e.g. bit.ly/abc123) is required.'
      )
    })

    it('throws a Bitly API error on failure', async () => {
      mock.onGet(`${ BASE }/bitlinks/${ ENCODED_BITLINK }`).replyWithError({
        message: 'Not Found',
        body: { message: 'NOT_FOUND', description: 'Bitlink not found' },
      })

      await expect(service.getBitlink(BITLINK)).rejects.toThrow('Bitly API error: NOT_FOUND - Bitlink not found')
    })
  })

  describe('updateBitlink', () => {
    it('sends a PATCH with only provided fields', async () => {
      mock.onPatch(`${ BASE }/bitlinks/${ ENCODED_BITLINK }`).reply({ id: BITLINK, title: 'New' })

      const result = await service.updateBitlink(BITLINK, 'New')

      expect(result).toEqual({ id: BITLINK, title: 'New' })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ title: 'New' })
    })

    it('includes all fields when provided (including archived false)', async () => {
      mock.onPatch(`${ BASE }/bitlinks/${ ENCODED_BITLINK }`).reply({ id: BITLINK })

      await service.updateBitlink(BITLINK, 'Title', ['a', 'b'], false)

      expect(mock.history[0].body).toEqual({
        title: 'Title',
        tags: ['a', 'b'],
        archived: false,
      })
    })

    it('sends an empty tags array when explicitly cleared', async () => {
      mock.onPatch(`${ BASE }/bitlinks/${ ENCODED_BITLINK }`).reply({ id: BITLINK })

      await service.updateBitlink(BITLINK, undefined, [], true)

      expect(mock.history[0].body).toEqual({ tags: [], archived: true })
    })

    it('omits archived when it is not a boolean', async () => {
      mock.onPatch(`${ BASE }/bitlinks/${ ENCODED_BITLINK }`).reply({ id: BITLINK })

      await service.updateBitlink(BITLINK, 'Only title')

      expect(mock.history[0].body).toEqual({ title: 'Only title' })
      expect(mock.history[0].body).not.toHaveProperty('archived')
    })
  })

  describe('expandBitlink', () => {
    it('sends a POST to /expand with normalized bitlink_id', async () => {
      mock.onPost(`${ BASE }/expand`).reply({ id: BITLINK, long_url: 'https://example.com' })

      const result = await service.expandBitlink('https://bit.ly/abc123/')

      expect(result).toEqual({ id: BITLINK, long_url: 'https://example.com' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ bitlink_id: 'bit.ly/abc123' })
    })

    it('passes a plain bitlink id through unchanged', async () => {
      mock.onPost(`${ BASE }/expand`).reply({ id: BITLINK })

      await service.expandBitlink('bit.ly/abc123')

      expect(mock.history[0].body).toEqual({ bitlink_id: 'bit.ly/abc123' })
    })

    it('throws a Bitly API error on failure', async () => {
      mock.onPost(`${ BASE }/expand`).replyWithError({
        message: 'Not Found',
        body: { message: 'NOT_FOUND' },
      })

      await expect(service.expandBitlink('bit.ly/missing')).rejects.toThrow('Bitly API error: NOT_FOUND')
    })
  })

  // ── Metrics ──

  describe('getClicksSummary', () => {
    it('sends correct request with default unit/units', async () => {
      mock.onGet(`${ BASE }/bitlinks/${ ENCODED_BITLINK }/clicks/summary`).reply({ total_clicks: 42 })

      const result = await service.getClicksSummary(BITLINK)

      expect(result).toEqual({ total_clicks: 42 })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({ unit: 'day', units: -1 })
    })

    it('maps friendly unit labels and passes units', async () => {
      mock.onGet(`${ BASE }/bitlinks/${ ENCODED_BITLINK }/clicks/summary`).reply({ total_clicks: 5 })

      await service.getClicksSummary(BITLINK, 'Hour', 24)

      expect(mock.history[0].query).toEqual({ unit: 'hour', units: 24 })
    })

    it('throws a Bitly API error on failure', async () => {
      mock.onGet(`${ BASE }/bitlinks/${ ENCODED_BITLINK }/clicks/summary`).replyWithError({
        message: 'Forbidden',
        body: { message: 'FORBIDDEN' },
      })

      await expect(service.getClicksSummary(BITLINK)).rejects.toThrow('Bitly API error: FORBIDDEN')
    })
  })

  describe('getClicks', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/bitlinks/${ ENCODED_BITLINK }/clicks`).reply({ link_clicks: [] })

      const result = await service.getClicks(BITLINK)

      expect(result).toEqual({ link_clicks: [] })
      expect(mock.history[0].query).toEqual({ unit: 'day', units: -1 })
    })

    it('passes custom unit and units', async () => {
      mock.onGet(`${ BASE }/bitlinks/${ ENCODED_BITLINK }/clicks`).reply({ link_clicks: [] })

      await service.getClicks(BITLINK, 'Week', 4)

      expect(mock.history[0].query).toEqual({ unit: 'week', units: 4 })
    })
  })

  describe('getClicksByCountry', () => {
    it('sends correct request to the countries endpoint', async () => {
      mock.onGet(`${ BASE }/bitlinks/${ ENCODED_BITLINK }/countries`).reply({ metrics: [] })

      const result = await service.getClicksByCountry(BITLINK, 'Month', 12)

      expect(result).toEqual({ metrics: [] })
      expect(mock.history[0].query).toEqual({ unit: 'month', units: 12 })
    })

    it('defaults unit to day and units to -1', async () => {
      mock.onGet(`${ BASE }/bitlinks/${ ENCODED_BITLINK }/countries`).reply({ metrics: [] })

      await service.getClicksByCountry(BITLINK)

      expect(mock.history[0].query).toEqual({ unit: 'day', units: -1 })
    })
  })

  describe('getClicksByReferrer', () => {
    it('sends correct request to the referrers endpoint', async () => {
      mock.onGet(`${ BASE }/bitlinks/${ ENCODED_BITLINK }/referrers`).reply({ metrics: [] })

      const result = await service.getClicksByReferrer(BITLINK, 'Minute', 60)

      expect(result).toEqual({ metrics: [] })
      expect(mock.history[0].query).toEqual({ unit: 'minute', units: 60 })
    })

    it('defaults unit to day and units to -1', async () => {
      mock.onGet(`${ BASE }/bitlinks/${ ENCODED_BITLINK }/referrers`).reply({ metrics: [] })

      await service.getClicksByReferrer(BITLINK)

      expect(mock.history[0].query).toEqual({ unit: 'day', units: -1 })
    })

    it('passes through an unknown unit value unchanged', async () => {
      mock.onGet(`${ BASE }/bitlinks/${ ENCODED_BITLINK }/referrers`).reply({ metrics: [] })

      await service.getClicksByReferrer(BITLINK, 'fortnight')

      expect(mock.history[0].query).toEqual({ unit: 'fortnight', units: -1 })
    })
  })

  describe('listBitlinksByGroup', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/groups/Bg1AbCdEf/bitlinks`).reply({ links: [], pagination: {} })

      const result = await service.listBitlinksByGroup('Bg1AbCdEf')

      expect(result).toEqual({ links: [], pagination: {} })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({ size: 50, page: 1, archived: 'off' })
    })

    it('includes all optional params and maps archived choice', async () => {
      mock.onGet(`${ BASE }/groups/Bg1AbCdEf/bitlinks`).reply({ links: [] })

      await service.listBitlinksByGroup('Bg1AbCdEf', 100, 2, 'launch', ['promo'], 'Archived Only')

      expect(mock.history[0].query).toEqual({
        size: 100,
        page: 2,
        query: 'launch',
        tags: ['promo'],
        archived: 'on',
      })
    })

    it('maps the Both archived choice', async () => {
      mock.onGet(`${ BASE }/groups/Bg1AbCdEf/bitlinks`).reply({ links: [] })

      await service.listBitlinksByGroup('Bg1AbCdEf', undefined, undefined, undefined, undefined, 'Both')

      expect(mock.history[0].query).toMatchObject({ archived: 'both' })
    })

    it('URL-encodes the group guid', async () => {
      const guid = 'Bg1 Ab/Cd'
      mock.onGet(`${ BASE }/groups/${ encodeURIComponent(guid) }/bitlinks`).reply({ links: [] })

      await service.listBitlinksByGroup(guid)

      expect(mock.history[0].url).toBe(`${ BASE }/groups/${ encodeURIComponent(guid) }/bitlinks`)
    })
  })

  // ── QR Codes ──

  describe('createQrCode', () => {
    // The service relies on this.flowrunner.Files (injected by the FlowRunner
    // runtime). The sandbox does not provide it, so we stub it on the instance.
    let uploadFile

    beforeEach(() => {
      uploadFile = jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.io/qr/bitly-qr-abc123.png' })
      service.flowrunner = { Files: { uploadFile } }
    })

    afterEach(() => {
      delete service.flowrunner
    })

    it('fetches the QR image, decodes base64, uploads and returns metadata', async () => {
      const base64 = Buffer.from('fake-png-bytes').toString('base64')
      mock.onGet(`${ BASE }/bitlinks/${ ENCODED_BITLINK }/qr`).reply({ qr_code: base64 })

      const result = await service.createQrCode(BITLINK)

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/bitlinks/${ ENCODED_BITLINK }/qr`)

      expect(uploadFile).toHaveBeenCalledTimes(1)
      const [buffer, options] = uploadFile.mock.calls[0]
      expect(Buffer.isBuffer(buffer)).toBe(true)
      expect(buffer.toString()).toBe('fake-png-bytes')
      expect(options).toMatchObject({
        filename: 'bitly-qr-abc123.png',
        generateUrl: true,
        overwrite: true,
        scope: 'FLOW',
      })

      expect(result).toEqual({
        bitlink: 'bit.ly/abc123',
        fileName: 'bitly-qr-abc123.png',
        contentType: 'image/png',
        qrCodeUrl: 'https://files.flowrunner.io/qr/bitly-qr-abc123.png',
      })
    })

    it('strips a data-URI prefix before decoding', async () => {
      const base64 = Buffer.from('data-uri-bytes').toString('base64')
      mock.onGet(`${ BASE }/bitlinks/${ ENCODED_BITLINK }/qr`).reply({ qr_code: `data:image/png;base64,${ base64 }` })

      await service.createQrCode(BITLINK)

      const [buffer] = uploadFile.mock.calls[0]
      expect(buffer.toString()).toBe('data-uri-bytes')
    })

    it('passes through provided fileOptions (overriding scope)', async () => {
      const base64 = Buffer.from('x').toString('base64')
      mock.onGet(`${ BASE }/bitlinks/${ ENCODED_BITLINK }/qr`).reply({ qr_code: base64 })

      await service.createQrCode(BITLINK, { scope: 'APP' })

      const [, options] = uploadFile.mock.calls[0]
      expect(options).toMatchObject({ scope: 'APP' })
    })

    it('throws when the QR response has no image data', async () => {
      mock.onGet(`${ BASE }/bitlinks/${ ENCODED_BITLINK }/qr`).reply({})

      await expect(service.createQrCode(BITLINK)).rejects.toThrow(
        'Bitly API error: The QR code response did not contain image data.'
      )
      expect(uploadFile).not.toHaveBeenCalled()
    })
  })

  // ── Organization ──

  describe('listGroups', () => {
    it('sends a GET to /groups without organization by default', async () => {
      mock.onGet(`${ BASE }/groups`).reply({ groups: [] })

      const result = await service.listGroups()

      expect(result).toEqual({ groups: [] })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({})
    })

    it('passes the organization guid as a query param', async () => {
      mock.onGet(`${ BASE }/groups`).reply({ groups: [] })

      await service.listGroups('Og1AbCdEf')

      expect(mock.history[0].query).toEqual({ organization_guid: 'Og1AbCdEf' })
    })
  })

  describe('getGroup', () => {
    it('sends a GET to the URL-encoded group path', async () => {
      mock.onGet(`${ BASE }/groups/Bg1AbCdEf`).reply({ guid: 'Bg1AbCdEf', name: 'My Group' })

      const result = await service.getGroup('Bg1AbCdEf')

      expect(result).toEqual({ guid: 'Bg1AbCdEf', name: 'My Group' })
      expect(mock.history[0].url).toBe(`${ BASE }/groups/Bg1AbCdEf`)
    })

    it('throws a Bitly API error on failure', async () => {
      mock.onGet(`${ BASE }/groups/Bg1AbCdEf`).replyWithError({
        message: 'Not Found',
        body: { message: 'NOT_FOUND' },
      })

      await expect(service.getGroup('Bg1AbCdEf')).rejects.toThrow('Bitly API error: NOT_FOUND')
    })
  })

  describe('getOrganizations', () => {
    it('sends a GET to /organizations', async () => {
      mock.onGet(`${ BASE }/organizations`).reply({ organizations: [] })

      const result = await service.getOrganizations()

      expect(result).toEqual({ organizations: [] })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/organizations`)
    })
  })

  describe('getUser', () => {
    it('sends a GET to /user', async () => {
      mock.onGet(`${ BASE }/user`).reply({ login: 'jdoe', name: 'Jane Doe' })

      const result = await service.getUser()

      expect(result).toEqual({ login: 'jdoe', name: 'Jane Doe' })
      expect(mock.history[0].url).toBe(`${ BASE }/user`)
    })

    it('surfaces field-level errors from the errors array', async () => {
      mock.onGet(`${ BASE }/user`).replyWithError({
        message: 'Unprocessable',
        body: {
          message: 'INVALID',
          errors: [{ field: 'token', error_code: 'expired' }],
        },
      })

      await expect(service.getUser()).rejects.toThrow('Bitly API error: INVALID - (token: expired)')
    })

    it('falls back to error.message when body has no details', async () => {
      mock.onGet(`${ BASE }/user`).replyWithError({ message: 'Boom', body: {} })

      await expect(service.getUser()).rejects.toThrow('Bitly API error: Boom')
    })
  })

  // ── Dictionary ──

  describe('getGroupsDictionary', () => {
    const groupsResponse = {
      groups: [
        { guid: 'Bg1', name: 'Marketing', role: 'admin' },
        { guid: 'Bg2', name: 'Sales', role: 'editor' },
        { guid: 'Bg3', name: 'Engineering', organization_guid: 'Og1' },
      ],
    }

    it('returns all groups mapped to dictionary items when no search', async () => {
      mock.onGet(`${ BASE }/groups`).reply(groupsResponse)

      const result = await service.getGroupsDictionary({})

      expect(result.cursor).toBeNull()
      expect(result.items).toEqual([
        { label: 'Marketing', value: 'Bg1', note: 'admin' },
        { label: 'Sales', value: 'Bg2', note: 'editor' },
        { label: 'Engineering', value: 'Bg3', note: 'Og1' },
      ])
    })

    it('filters groups by search term (case-insensitive)', async () => {
      mock.onGet(`${ BASE }/groups`).reply(groupsResponse)

      const result = await service.getGroupsDictionary({ search: 'sal' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ value: 'Bg2' })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/groups`).reply(groupsResponse)

      const result = await service.getGroupsDictionary(null)

      expect(result.items).toHaveLength(3)
    })

    it('handles an empty groups response', async () => {
      mock.onGet(`${ BASE }/groups`).reply({})

      const result = await service.getGroupsDictionary({})

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })

    it('falls back to guid when a group has no name', async () => {
      mock.onGet(`${ BASE }/groups`).reply({ groups: [{ guid: 'Bg9' }] })

      const result = await service.getGroupsDictionary({})

      expect(result.items[0]).toEqual({ label: 'Bg9', value: 'Bg9', note: undefined })
    })
  })
})
