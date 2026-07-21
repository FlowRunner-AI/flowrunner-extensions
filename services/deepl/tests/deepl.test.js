'use strict'

const { createSandbox } = require('../../../service-sandbox')

const PRO_KEY = 'test-pro-key-123'
const FREE_KEY = 'test-free-key-123:fx'
const PRO_BASE = 'https://api.deepl.com'
const FREE_BASE = 'https://api-free.deepl.com'

/**
 * Build a fresh sandbox + service for a given API key. Each service instance
 * resolves its base URL from the key (":fx" suffix → free plan), so tests that
 * need a specific plan build their own sandbox.
 *
 * The service entry calls `addService()` at require-time; Jest caches the module
 * so a plain re-require would not re-register. `jest.resetModules()` clears Jest's
 * registry so each build re-runs registration against the freshly-installed global.
 */
function build(apiKey) {
  jest.resetModules()

  const sandbox = createSandbox({ apiKey })

  require('../src/index.js')

  const service = sandbox.getService()
  const mock = sandbox.getRequestMock()

  return { sandbox, service, mock }
}

describe('DeepL Service', () => {
  let sandbox
  let service
  let mock

  beforeEach(() => {
    ({ sandbox, service, mock } = build(PRO_KEY))
  })

  afterEach(() => {
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

    it('does not put the service name in the displayName', () => {
      const [apiKeyItem] = sandbox.getConfigItems()

      expect(apiKeyItem.displayName).toBe('API Key')
    })
  })

  // ── Auth & base URL resolution ──

  describe('authentication and base URL', () => {
    it('sends the DeepL-Auth-Key authorization header', async () => {
      mock.onGet(`${ PRO_BASE }/v2/usage`).reply({ character_count: 1, character_limit: 2 })

      await service.getUsage()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `DeepL-Auth-Key ${ PRO_KEY }`,
      })
    })

    it('uses the pro base URL for keys without a ":fx" suffix', async () => {
      const pro = build(PRO_KEY)

      pro.mock.onGet(`${ PRO_BASE }/v2/usage`).reply({ character_count: 0, character_limit: 0 })
      await pro.service.getUsage()

      expect(pro.mock.history[0].url).toBe(`${ PRO_BASE }/v2/usage`)

      pro.sandbox.cleanup()
    })

    it('uses the free base URL for keys ending with ":fx"', async () => {
      const free = build(FREE_KEY)

      free.mock.onGet(`${ FREE_BASE }/v2/usage`).reply({ character_count: 0, character_limit: 0 })
      await free.service.getUsage()

      expect(free.mock.history[0].url).toBe(`${ FREE_BASE }/v2/usage`)
      expect(free.mock.history[0].headers).toMatchObject({
        'Authorization': `DeepL-Auth-Key ${ FREE_KEY }`,
      })

      free.sandbox.cleanup()
    })

    it('trims whitespace before checking the ":fx" suffix', async () => {
      const free = build(`${ FREE_KEY }  `)

      free.mock.onGet(`${ FREE_BASE }/v2/usage`).reply({ character_count: 0, character_limit: 0 })
      await free.service.getUsage()

      expect(free.mock.history[0].url).toBe(`${ FREE_BASE }/v2/usage`)

      free.sandbox.cleanup()
    })
  })

  // ── Translation ──

  describe('translateText', () => {
    const response = {
      translations: [{ detected_source_language: 'EN', text: 'Hallo, Welt!' }],
    }

    it('sends correct request with required params only', async () => {
      mock.onPost(`${ PRO_BASE }/v2/translate`).reply(response)

      const result = await service.translateText('Hello, world!', 'DE')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ PRO_BASE }/v2/translate`)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `DeepL-Auth-Key ${ PRO_KEY }`,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toEqual({
        text: ['Hello, world!'],
        target_lang: 'DE',
      })
      expect(result).toEqual({
        text: 'Hallo, Welt!',
        detectedSourceLanguage: 'EN',
        translations: response.translations,
      })
    })

    it('includes all optional params, mapping choice labels to API values', async () => {
      mock.onPost(`${ PRO_BASE }/v2/translate`).reply(response)

      await service.translateText(
        'Hello',
        'DE',
        'EN',
        'More Formal',
        'gloss-1',
        'some context',
        'Quality Optimized',
        true,
        'No Newlines',
        'HTML'
      )

      expect(mock.history[0].body).toEqual({
        text: ['Hello'],
        target_lang: 'DE',
        source_lang: 'EN',
        glossary_id: 'gloss-1',
        context: 'some context',
        preserve_formatting: true,
        formality: 'more',
        model_type: 'quality_optimized',
        split_sentences: 'nonewlines',
        tag_handling: 'html',
      })
    })

    it('omits formality when set to the "Default" label', async () => {
      mock.onPost(`${ PRO_BASE }/v2/translate`).reply(response)

      await service.translateText('Hello', 'DE', undefined, 'Default')

      expect(mock.history[0].body).toEqual({ text: ['Hello'], target_lang: 'DE' })
    })

    it('maps split-sentences "On" and "Off" labels', async () => {
      mock.onPost(`${ PRO_BASE }/v2/translate`).reply(response)

      await service.translateText('Hello', 'DE', undefined, undefined, undefined, undefined, undefined, undefined, 'On')
      expect(mock.history[0].body.split_sentences).toBe('1')

      mock.reset()
      mock.onPost(`${ PRO_BASE }/v2/translate`).reply(response)

      await service.translateText('Hello', 'DE', undefined, undefined, undefined, undefined, undefined, undefined, 'Off')
      expect(mock.history[0].body.split_sentences).toBe('0')
    })

    it('passes through an unmapped model type value as-is', async () => {
      mock.onPost(`${ PRO_BASE }/v2/translate`).reply(response)

      await service.translateText('Hello', 'DE', undefined, undefined, undefined, undefined, 'latency_optimized')

      expect(mock.history[0].body.model_type).toBe('latency_optimized')
    })

    it('includes preserve_formatting when explicitly false', async () => {
      mock.onPost(`${ PRO_BASE }/v2/translate`).reply(response)

      await service.translateText('Hello', 'DE', undefined, undefined, undefined, undefined, undefined, false)

      expect(mock.history[0].body).toEqual({
        text: ['Hello'],
        target_lang: 'DE',
        preserve_formatting: false,
      })
    })

    it('returns null fields when the API returns no translations', async () => {
      mock.onPost(`${ PRO_BASE }/v2/translate`).reply({ translations: [] })

      const result = await service.translateText('Hello', 'DE')

      expect(result).toEqual({ text: null, detectedSourceLanguage: null, translations: [] })
    })

    it('throws when text is missing', async () => {
      await expect(service.translateText('', 'DE')).rejects.toThrow('Text is required')
    })

    it('throws when text is only whitespace', async () => {
      await expect(service.translateText('   ', 'DE')).rejects.toThrow('Text is required')
    })

    it('throws when target language is missing', async () => {
      await expect(service.translateText('Hello')).rejects.toThrow('Target Language is required')
    })

    it('wraps API errors with a DeepL API error message', async () => {
      mock.onPost(`${ PRO_BASE }/v2/translate`).replyWithError({
        message: 'Forbidden',
        body: { message: 'Authorization failure', detail: 'wrong key' },
      })

      await expect(service.translateText('Hello', 'DE')).rejects.toThrow(
        'DeepL API error: Authorization failure — wrong key'
      )
    })

    it('falls back to error.message when there is no structured body', async () => {
      mock.onPost(`${ PRO_BASE }/v2/translate`).replyWithError({ message: 'Network down' })

      await expect(service.translateText('Hello', 'DE')).rejects.toThrow('DeepL API error: Network down')
    })
  })

  // ── Writing ──

  describe('improveText', () => {
    const response = {
      improvements: [{ text: 'Improved.', detected_source_language: 'en', target_language: 'en-US' }],
    }

    it('sends correct request with required params only', async () => {
      mock.onPost(`${ PRO_BASE }/v2/write/rephrase`).reply(response)

      const result = await service.improveText('helo wrld')

      expect(mock.history[0].url).toBe(`${ PRO_BASE }/v2/write/rephrase`)
      expect(mock.history[0].body).toEqual({ text: ['helo wrld'] })
      expect(result).toEqual({
        text: 'Improved.',
        detectedSourceLanguage: 'en',
        targetLanguage: 'en-US',
        improvements: response.improvements,
      })
    })

    it('includes target language and a writing style when provided', async () => {
      mock.onPost(`${ PRO_BASE }/v2/write/rephrase`).reply(response)

      await service.improveText('text', 'en-US', 'Business')

      expect(mock.history[0].body).toEqual({
        text: ['text'],
        target_lang: 'en-US',
        writing_style: 'business',
      })
    })

    it('includes a tone when provided', async () => {
      mock.onPost(`${ PRO_BASE }/v2/write/rephrase`).reply(response)

      await service.improveText('text', undefined, undefined, 'Friendly')

      expect(mock.history[0].body).toEqual({ text: ['text'], tone: 'friendly' })
    })

    it('omits style and tone when both are "Default"', async () => {
      mock.onPost(`${ PRO_BASE }/v2/write/rephrase`).reply(response)

      await service.improveText('text', undefined, 'Default', 'Default')

      expect(mock.history[0].body).toEqual({ text: ['text'] })
    })

    it('throws when both a non-default style and tone are set', async () => {
      await expect(service.improveText('text', undefined, 'Business', 'Friendly')).rejects.toThrow(
        'Writing Style and Tone are mutually exclusive'
      )
    })

    it('throws when text is missing', async () => {
      await expect(service.improveText('')).rejects.toThrow('Text is required')
    })

    it('returns null fields when the API returns no improvements', async () => {
      mock.onPost(`${ PRO_BASE }/v2/write/rephrase`).reply({ improvements: [] })

      const result = await service.improveText('text')

      expect(result).toEqual({
        text: null,
        detectedSourceLanguage: null,
        targetLanguage: null,
        improvements: [],
      })
    })
  })

  // ── Documents ──

  describe('uploadDocument', () => {
    const FILE_URL = 'https://example.com/report.docx'

    beforeEach(() => {
      // uploadDocument downloads the source file first (GET, binary).
      mock.onGet(FILE_URL).reply(Buffer.from('file-bytes'))
      mock.onPost(`${ PRO_BASE }/v2/document`).reply({ document_id: 'DID', document_key: 'DKEY' })
    })

    it('downloads the file then uploads via multipart form with required fields', async () => {
      const result = await service.uploadDocument(FILE_URL, 'DE')

      // GET download, then POST upload.
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(FILE_URL)

      const upload = mock.history[1]

      expect(upload.method).toBe('post')
      expect(upload.url).toBe(`${ PRO_BASE }/v2/document`)
      expect(upload.headers).toMatchObject({ 'Authorization': `DeepL-Auth-Key ${ PRO_KEY }` })
      expect(upload.formData).toBeDefined()

      const fields = upload.formData._fields
      const byName = name => fields.filter(f => f.name === name).map(f => f.value)

      expect(byName('target_lang')).toEqual(['DE'])
      // filename derived from the URL
      const fileField = fields.find(f => f.name === 'file')
      expect(fileField.filename).toEqual({ filename: 'report.docx' })
      expect(Buffer.isBuffer(fileField.value)).toBe(true)

      expect(result).toEqual({ document_id: 'DID', document_key: 'DKEY' })
    })

    it('appends optional source language, glossary, formality and output format', async () => {
      await service.uploadDocument(FILE_URL, 'DE', 'EN', 'Less Formal', 'gloss-9', 'PDF')

      const fields = mock.history[1].formData._fields
      const value = name => fields.find(f => f.name === name)?.value

      expect(value('source_lang')).toBe('EN')
      expect(value('glossary_id')).toBe('gloss-9')
      expect(value('formality')).toBe('less')
      expect(value('output_format')).toBe('pdf')
    })

    it('omits formality when set to "Default"', async () => {
      await service.uploadDocument(FILE_URL, 'DE', undefined, 'Default')

      const fields = mock.history[1].formData._fields

      expect(fields.find(f => f.name === 'formality')).toBeUndefined()
    })

    it('throws when target language is missing', async () => {
      await expect(service.uploadDocument(FILE_URL)).rejects.toThrow('Target Language is required')
    })

    it('throws for an invalid (non-http) file URL', async () => {
      await expect(service.uploadDocument('ftp://x/y.docx', 'DE')).rejects.toThrow(
        "Invalid fileUrl 'ftp://x/y.docx'"
      )
    })
  })

  describe('getDocumentStatus', () => {
    it('sends the document key in the body', async () => {
      mock.onPost(`${ PRO_BASE }/v2/document/DID`).reply({ document_id: 'DID', status: 'done', billed_characters: 10 })

      const result = await service.getDocumentStatus('DID', 'DKEY')

      expect(mock.history[0].url).toBe(`${ PRO_BASE }/v2/document/DID`)
      expect(mock.history[0].body).toEqual({ document_key: 'DKEY' })
      expect(result).toMatchObject({ status: 'done', billed_characters: 10 })
    })

    it('url-encodes the document id', async () => {
      mock.onPost(`${ PRO_BASE }/v2/document/a%2Fb`).reply({ status: 'queued' })

      await service.getDocumentStatus('a/b', 'DKEY')

      expect(mock.history[0].url).toBe(`${ PRO_BASE }/v2/document/a%2Fb`)
    })

    it('throws when the document id or key is missing', async () => {
      await expect(service.getDocumentStatus('', 'DKEY')).rejects.toThrow(
        'Document ID and Document Key are required'
      )
      await expect(service.getDocumentStatus('DID', '')).rejects.toThrow(
        'Document ID and Document Key are required'
      )
    })
  })

  describe('downloadTranslatedDocument', () => {
    const RESULT_URL = `${ PRO_BASE }/v2/document/DID/result`
    const STORED_URL = 'https://files.flowrunner.com/flow/report_translated.docx'
    let uploadFileMock

    beforeEach(() => {
      uploadFileMock = jest.fn().mockResolvedValue({ url: STORED_URL })
      // Files API is injected by the FlowRunner runtime; stub it at the test boundary.
      service.flowrunner = { Files: { uploadFile: uploadFileMock } }
    })

    afterEach(() => {
      delete service.flowrunner
    })

    it('downloads the result, stores it in FlowRunner files and returns the URL', async () => {
      // Binary path: `.setEncoding(null).unwrapBody(false)` makes the awaited chain
      // resolve to the full response object, from which the service reads `body`
      // (the bytes) and `headers['content-disposition']` (the filename).
      const bytes = Buffer.from('translated-bytes')

      mock.onPost(RESULT_URL).reply({
        body: bytes,
        headers: { 'content-disposition': 'attachment; filename="report_translated.docx"' },
      })

      const result = await service.downloadTranslatedDocument('DID', 'DKEY')

      // Request assertions: correct endpoint, method, auth header, binary encoding, body.
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(RESULT_URL)
      expect(mock.history[0].encoding).toBeNull()
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `DeepL-Auth-Key ${ PRO_KEY }`,
      })
      expect(mock.history[0].body).toEqual({ document_key: 'DKEY' })

      // The downloaded buffer is forwarded to the Files API.
      expect(uploadFileMock).toHaveBeenCalledTimes(1)

      const [buffer, options] = uploadFileMock.mock.calls[0]

      expect(Buffer.isBuffer(buffer)).toBe(true)
      expect(buffer).toBe(bytes)
      expect(buffer.toString()).toBe('translated-bytes')
      expect(options).toMatchObject({
        filename: 'report_translated.docx',
        generateUrl: true,
        overwrite: true,
        scope: 'FLOW',
      })

      // Filename is parsed from the content-disposition header.
      expect(result).toEqual({ fileURL: STORED_URL, filename: 'report_translated.docx' })
    })

    it('url-encodes the document id in the result endpoint', async () => {
      mock.onPost(`${ PRO_BASE }/v2/document/a%2Fb/result`).reply({
        body: Buffer.from('bytes'),
        headers: { 'content-disposition': 'attachment; filename="doc.docx"' },
      })

      await service.downloadTranslatedDocument('a/b', 'DKEY')

      expect(mock.history[0].url).toBe(`${ PRO_BASE }/v2/document/a%2Fb/result`)
    })

    it('handles a bare buffer response (no wrapper) and falls back to a generated filename', async () => {
      // When the runtime hands back the bytes directly (no `body`/`headers` wrapper),
      // the service uses the buffer as-is and synthesises a "deepl_document_*" name.
      mock.onPost(RESULT_URL).reply(Buffer.from('raw-bytes'))

      const result = await service.downloadTranslatedDocument('DID', 'DKEY')

      const [buffer] = uploadFileMock.mock.calls[0]

      expect(buffer.toString()).toBe('raw-bytes')
      expect(result.fileURL).toBe(STORED_URL)
      expect(result.filename).toMatch(/^deepl_document_\d+$/)
    })

    it('passes through custom file options (scope) to the Files API', async () => {
      mock.onPost(RESULT_URL).reply({
        body: Buffer.from('bytes'),
        headers: { 'content-disposition': 'attachment; filename="doc.docx"' },
      })

      await service.downloadTranslatedDocument('DID', 'DKEY', { scope: 'WORKSPACE' })

      const [, options] = uploadFileMock.mock.calls[0]

      expect(options).toMatchObject({ scope: 'WORKSPACE' })
    })

    it('throws when the document id or key is missing', async () => {
      await expect(service.downloadTranslatedDocument('', 'DKEY')).rejects.toThrow(
        'Document ID and Document Key are required'
      )
      await expect(service.downloadTranslatedDocument('DID', '')).rejects.toThrow(
        'Document ID and Document Key are required'
      )

      expect(uploadFileMock).not.toHaveBeenCalled()
    })

    it('wraps API errors from the result endpoint with a DeepL API error message', async () => {
      mock.onPost(RESULT_URL).replyWithError({
        message: 'Not Found',
        body: { message: 'Document not found' },
      })

      await expect(service.downloadTranslatedDocument('DID', 'DKEY')).rejects.toThrow(
        'DeepL API error: Document not found'
      )

      expect(uploadFileMock).not.toHaveBeenCalled()
    })
  })

  // ── Glossaries ──

  describe('createGlossary', () => {
    const response = { glossary_id: 'gid', name: 'Terms' }

    it('builds a single dictionary from source/target/entries', async () => {
      mock.onPost(`${ PRO_BASE }/v3/glossaries`).reply(response)

      const result = await service.createGlossary('Terms', 'EN', 'DE', { artist: 'Künstler', prize: 'Gewinn' })

      expect(mock.history[0].url).toBe(`${ PRO_BASE }/v3/glossaries`)
      expect(mock.history[0].body).toEqual({
        name: 'Terms',
        dictionaries: [
          {
            source_lang: 'EN',
            target_lang: 'DE',
            entries: 'artist\tKünstler\nprize\tGewinn',
            entries_format: 'tsv',
          },
        ],
      })
      expect(result).toEqual(response)
    })

    it('uses a raw dictionaries array when provided, ignoring simple fields', async () => {
      mock.onPost(`${ PRO_BASE }/v3/glossaries`).reply(response)

      const raw = [{ source_lang: 'en', target_lang: 'fr', entries: 'a\tb', entries_format: 'tsv' }]

      await service.createGlossary('Terms', undefined, undefined, undefined, raw)

      expect(mock.history[0].body).toEqual({ name: 'Terms', dictionaries: raw })
    })

    it('throws when name is missing', async () => {
      await expect(service.createGlossary('')).rejects.toThrow('Name is required')
    })

    it('throws when neither entries nor a raw dictionaries array is provided', async () => {
      await expect(service.createGlossary('Terms', 'EN', 'DE', {})).rejects.toThrow(
        'Source Language, Target Language and Entries are required'
      )
    })
  })

  describe('listGlossaries', () => {
    it('sends a GET to the v3 glossaries endpoint', async () => {
      const response = { glossaries: [{ glossary_id: 'gid', name: 'Terms' }] }

      mock.onGet(`${ PRO_BASE }/v3/glossaries`).reply(response)

      const result = await service.listGlossaries()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ PRO_BASE }/v3/glossaries`)
      expect(result).toEqual(response)
    })
  })

  describe('getGlossary', () => {
    it('sends a GET to the glossary detail endpoint', async () => {
      mock.onGet(`${ PRO_BASE }/v3/glossaries/gid`).reply({ glossary_id: 'gid', name: 'Terms' })

      const result = await service.getGlossary('gid')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ PRO_BASE }/v3/glossaries/gid`)
      expect(result).toMatchObject({ glossary_id: 'gid' })
    })

    it('throws when glossary id is missing', async () => {
      await expect(service.getGlossary('')).rejects.toThrow('Glossary ID is required')
    })
  })

  describe('getGlossaryEntries', () => {
    it('requests entries with language query params and parses TSV', async () => {
      mock.onGet(`${ PRO_BASE }/v3/glossaries/gid/entries`).reply({
        dictionaries: [
          { source_lang: 'en', target_lang: 'de', entries: 'artist\tKünstler\nprize\tGewinn', entries_format: 'tsv' },
        ],
      })

      const result = await service.getGlossaryEntries('gid', 'EN', 'DE')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ PRO_BASE }/v3/glossaries/gid/entries`)
      expect(mock.history[0].query).toMatchObject({ source_lang: 'EN', target_lang: 'DE' })
      expect(result).toEqual({
        sourceLang: 'en',
        targetLang: 'de',
        entries: { artist: 'Künstler', prize: 'Gewinn' },
        entriesTsv: 'artist\tKünstler\nprize\tGewinn',
        dictionaries: [
          { source_lang: 'en', target_lang: 'de', entries: 'artist\tKünstler\nprize\tGewinn', entries_format: 'tsv' },
        ],
      })
    })

    it('falls back to the requested languages when no dictionary is returned', async () => {
      mock.onGet(`${ PRO_BASE }/v3/glossaries/gid/entries`).reply({ dictionaries: [] })

      const result = await service.getGlossaryEntries('gid', 'EN', 'DE')

      expect(result).toEqual({
        sourceLang: 'EN',
        targetLang: 'DE',
        entries: {},
        entriesTsv: '',
        dictionaries: [],
      })
    })

    it('throws when a required argument is missing', async () => {
      await expect(service.getGlossaryEntries('gid', 'EN')).rejects.toThrow(
        'Glossary ID, Source Language and Target Language are required'
      )
    })
  })

  describe('editGlossary', () => {
    const response = { glossary_id: 'gid', name: 'Terms v2' }

    it('sends a PATCH with only a new name', async () => {
      mock.onPatch(`${ PRO_BASE }/v3/glossaries/gid`).reply(response)

      const result = await service.editGlossary('gid', 'Terms v2')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ PRO_BASE }/v3/glossaries/gid`)
      expect(mock.history[0].body).toEqual({ name: 'Terms v2' })
      expect(result).toEqual(response)
    })

    it('sends replacement entries as a dictionary', async () => {
      mock.onPatch(`${ PRO_BASE }/v3/glossaries/gid`).reply(response)

      await service.editGlossary('gid', undefined, 'EN', 'DE', { hello: 'hallo' })

      expect(mock.history[0].body).toEqual({
        dictionaries: [
          { source_lang: 'EN', target_lang: 'DE', entries: 'hello\thallo', entries_format: 'tsv' },
        ],
      })
    })

    it('throws when glossary id is missing', async () => {
      await expect(service.editGlossary('')).rejects.toThrow('Glossary ID is required')
    })

    it('throws when replacing entries without a language pair', async () => {
      await expect(service.editGlossary('gid', undefined, undefined, undefined, { a: 'b' })).rejects.toThrow(
        'Source Language and Target Language are required when replacing entries'
      )
    })

    it('throws when there is nothing to update', async () => {
      await expect(service.editGlossary('gid')).rejects.toThrow('Nothing to update')
    })
  })

  describe('deleteGlossary', () => {
    it('sends a DELETE and returns a confirmation', async () => {
      mock.onDelete(`${ PRO_BASE }/v3/glossaries/gid`).reply(undefined)

      const result = await service.deleteGlossary('gid')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ PRO_BASE }/v3/glossaries/gid`)
      expect(result).toEqual({ glossaryId: 'gid', deleted: true })
    })

    it('throws when glossary id is missing', async () => {
      await expect(service.deleteGlossary('')).rejects.toThrow('Glossary ID is required')
    })
  })

  // ── Languages ──

  describe('listSourceLanguages', () => {
    it('sends a GET with type=source', async () => {
      const response = [{ language: 'EN', name: 'English' }]

      mock.onGet(`${ PRO_BASE }/v2/languages`).reply(response)

      const result = await service.listSourceLanguages()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ PRO_BASE }/v2/languages`)
      expect(mock.history[0].query).toMatchObject({ type: 'source' })
      expect(result).toEqual(response)
    })
  })

  describe('listTargetLanguages', () => {
    it('sends a GET with type=target', async () => {
      const response = [{ language: 'DE', name: 'German', supports_formality: true }]

      mock.onGet(`${ PRO_BASE }/v2/languages`).reply(response)

      const result = await service.listTargetLanguages()

      expect(mock.history[0].query).toMatchObject({ type: 'target' })
      expect(result).toEqual(response)
    })
  })

  // ── Account ──

  describe('getUsage', () => {
    it('sends a GET to the usage endpoint', async () => {
      mock.onGet(`${ PRO_BASE }/v2/usage`).reply({ character_count: 100, character_limit: 500 })

      const result = await service.getUsage()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ PRO_BASE }/v2/usage`)
      expect(result).toEqual({ character_count: 100, character_limit: 500 })
    })
  })

  // ── Dictionaries ──

  describe('getTargetLanguagesDictionary', () => {
    const languages = [
      { language: 'DE', name: 'German', supports_formality: true },
      { language: 'EN-US', name: 'English (American)', supports_formality: false },
      { language: 'JA', name: 'Japanese', supports_formality: false },
    ]

    it('maps languages to dictionary items and marks formality support', async () => {
      mock.onGet(`${ PRO_BASE }/v2/languages`).reply(languages)

      const result = await service.getTargetLanguagesDictionary({})

      expect(mock.history[0].query).toMatchObject({ type: 'target' })
      expect(result.cursor).toBeNull()
      expect(result.items).toEqual([
        { label: 'German', value: 'DE', note: 'Supports formality' },
        { label: 'English (American)', value: 'EN-US', note: undefined },
        { label: 'Japanese', value: 'JA', note: undefined },
      ])
    })

    it('filters by search against name', async () => {
      mock.onGet(`${ PRO_BASE }/v2/languages`).reply(languages)

      const result = await service.getTargetLanguagesDictionary({ search: 'german' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ value: 'DE' })
    })

    it('filters by search against language code', async () => {
      mock.onGet(`${ PRO_BASE }/v2/languages`).reply(languages)

      const result = await service.getTargetLanguagesDictionary({ search: 'ja' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ value: 'JA' })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ PRO_BASE }/v2/languages`).reply(languages)

      const result = await service.getTargetLanguagesDictionary(null)

      expect(result.items).toHaveLength(3)
    })
  })

  describe('getSourceLanguagesDictionary', () => {
    it('requests source languages and omits the formality note', async () => {
      mock.onGet(`${ PRO_BASE }/v2/languages`).reply([
        { language: 'EN', name: 'English' },
        { language: 'JA', name: 'Japanese' },
      ])

      const result = await service.getSourceLanguagesDictionary({})

      expect(mock.history[0].query).toMatchObject({ type: 'source' })
      expect(result.items).toEqual([
        { label: 'English', value: 'EN', note: undefined },
        { label: 'Japanese', value: 'JA', note: undefined },
      ])
    })
  })

  describe('getGlossariesDictionary', () => {
    const glossariesResponse = {
      glossaries: [
        {
          glossary_id: 'g1',
          name: 'Product Terms',
          dictionaries: [{ source_lang: 'en', target_lang: 'de' }],
        },
        {
          glossary_id: 'g2',
          name: 'Legal',
          dictionaries: [
            { source_lang: 'en', target_lang: 'fr' },
            { source_lang: 'en', target_lang: 'es' },
          ],
        },
      ],
    }

    it('maps glossaries to items with language-pair notes', async () => {
      mock.onGet(`${ PRO_BASE }/v3/glossaries`).reply(glossariesResponse)

      const result = await service.getGlossariesDictionary({})

      expect(result.cursor).toBeNull()
      expect(result.items).toEqual([
        { label: 'Product Terms', value: 'g1', note: 'EN → DE' },
        { label: 'Legal', value: 'g2', note: 'EN → FR, EN → ES' },
      ])
    })

    it('filters glossaries by name search', async () => {
      mock.onGet(`${ PRO_BASE }/v3/glossaries`).reply(glossariesResponse)

      const result = await service.getGlossariesDictionary({ search: 'legal' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ value: 'g2' })
    })

    it('handles a missing glossaries array', async () => {
      mock.onGet(`${ PRO_BASE }/v3/glossaries`).reply({})

      const result = await service.getGlossariesDictionary({})

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })
  })
})
