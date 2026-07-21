'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE'
const SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
const REGION = 'us-east-1'

describe('AWS Transcribe Service', () => {
  let sandbox
  let service
  let jsonRequestMock

  beforeAll(() => {
    sandbox = createSandbox({
      authenticationMethod: 'API Key',
      region: REGION,
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
    })

    require('../src/index.js')
    service = sandbox.getService()

    // The service uses its own jsonRequest (Node https + SigV4), not Flowrunner.Request.
    // We stub service.deps.jsonRequest to intercept all AWS API calls.
    jsonRequestMock = jest.fn()
    service.deps.jsonRequest = jsonRequestMock
  })

  afterEach(() => {
    jsonRequestMock.mockReset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const items = sandbox.getConfigItems()

      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'authenticationMethod', type: 'CHOICE', required: true, shared: false }),
          expect.objectContaining({ name: 'region', type: 'STRING', required: true, shared: false }),
          expect.objectContaining({ name: 'accessKeyId', type: 'STRING', shared: false }),
          expect.objectContaining({ name: 'secretAccessKey', type: 'STRING', shared: false }),
          expect.objectContaining({ name: 'roleArn', type: 'STRING', shared: false }),
          expect.objectContaining({ name: 'externalId', type: 'STRING', shared: false }),
        ])
      )
    })
  })

  // ── Transcription Jobs ──

  describe('startTranscriptionJob', () => {
    it('sends correct request with required params and language code', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job',
          TranscriptionJobStatus: 'IN_PROGRESS',
          LanguageCode: 'en-US',
          Media: { MediaFileUri: 's3://bucket/audio.mp3' },
        },
      })

      const result = await service.startTranscriptionJob(
        'test-job', 's3://bucket/audio.mp3', 'en-US'
      )

      expect(jsonRequestMock).toHaveBeenCalledTimes(1)

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts).toMatchObject({
        region: REGION,
        service: 'transcribe',
        target: 'Transcribe.StartTranscriptionJob',
        contentType: 'application/x-amz-json-1.1',
      })

      expect(opts.body).toMatchObject({
        TranscriptionJobName: 'test-job',
        Media: { MediaFileUri: 's3://bucket/audio.mp3' },
        LanguageCode: 'en-US',
      })

      expect(result).toMatchObject({
        transcriptionJobName: 'test-job',
        status: 'IN_PROGRESS',
        languageCode: 'en-US',
        mediaFileUri: 's3://bucket/audio.mp3',
      })
    })

    it('uses identifyLanguage when set instead of languageCode', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJob: {
          TranscriptionJobName: 'auto-lang-job',
          TranscriptionJobStatus: 'IN_PROGRESS',
          IdentifyLanguage: true,
        },
      })

      await service.startTranscriptionJob(
        'auto-lang-job', 's3://bucket/audio.mp3', null, true
      )

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body.IdentifyLanguage).toBe(true)
      expect(body).not.toHaveProperty('LanguageCode')
    })

    it('throws when no languageCode and identifyLanguage is false', async () => {
      await expect(
        service.startTranscriptionJob('job', 's3://bucket/audio.mp3', null, false)
      ).rejects.toThrow('Provide a languageCode or enable identifyLanguage.')
    })

    it('throws when transcriptionJobName is missing', async () => {
      await expect(
        service.startTranscriptionJob(null, 's3://bucket/audio.mp3', 'en-US')
      ).rejects.toThrow('transcriptionJobName is required.')
    })

    it('throws when mediaFileUri is missing', async () => {
      await expect(
        service.startTranscriptionJob('job', null, 'en-US')
      ).rejects.toThrow('mediaFileUri (an S3 URI) is required.')
    })

    it('includes all optional params when provided', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJob: {
          TranscriptionJobName: 'full-job',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      })

      await service.startTranscriptionJob(
        'full-job',
        's3://bucket/audio.mp3',
        'en-US',
        false,       // identifyLanguage
        'mp3',       // mediaFormat
        'my-bucket', // outputBucketName
        true,        // showSpeakerLabels
        5,           // maxSpeakerLabels
        false,       // channelIdentification
        'my-vocab',  // vocabularyName
        ['vtt', 'srt'] // subtitleFormats
      )

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).toMatchObject({
        TranscriptionJobName: 'full-job',
        Media: { MediaFileUri: 's3://bucket/audio.mp3' },
        LanguageCode: 'en-US',
        MediaFormat: 'mp3',
        OutputBucketName: 'my-bucket',
        Settings: {
          ShowSpeakerLabels: true,
          MaxSpeakerLabels: 5,
          VocabularyName: 'my-vocab',
        },
        Subtitles: { Formats: ['vtt', 'srt'] },
      })
    })

    it('defaults maxSpeakerLabels to 2 when showSpeakerLabels is true and maxSpeakerLabels not given', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJob: { TranscriptionJobName: 'spk-job', TranscriptionJobStatus: 'IN_PROGRESS' },
      })

      await service.startTranscriptionJob(
        'spk-job', 's3://bucket/audio.mp3', 'en-US',
        false, null, null, true, null
      )

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body.Settings.ShowSpeakerLabels).toBe(true)
      expect(body.Settings.MaxSpeakerLabels).toBe(2)
    })

    it('includes channelIdentification in settings', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJob: { TranscriptionJobName: 'ch-job', TranscriptionJobStatus: 'IN_PROGRESS' },
      })

      await service.startTranscriptionJob(
        'ch-job', 's3://bucket/audio.mp3', 'en-US',
        false, null, null, false, null, true
      )

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body.Settings.ChannelIdentification).toBe(true)
    })

    it('omits Settings when no settings are provided', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJob: { TranscriptionJobName: 'plain-job', TranscriptionJobStatus: 'IN_PROGRESS' },
      })

      await service.startTranscriptionJob(
        'plain-job', 's3://bucket/audio.mp3', 'en-US'
      )

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).not.toHaveProperty('Settings')
    })

    it('handles ConflictException from AWS', async () => {
      const err = new Error('Job already exists')

      err.name = 'ConflictException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(
        service.startTranscriptionJob('dup-job', 's3://bucket/audio.mp3', 'en-US')
      ).rejects.toThrow('Conflict:')
    })
  })

  describe('getTranscriptionJob', () => {
    it('sends correct request and returns formatted job', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJob: {
          TranscriptionJobName: 'my-job',
          TranscriptionJobStatus: 'COMPLETED',
          LanguageCode: 'en-US',
          Media: { MediaFileUri: 's3://bucket/audio.mp3' },
          Transcript: { TranscriptFileUri: 'https://s3.amazonaws.com/transcript.json' },
          CreationTime: '2024-01-01T00:00:00Z',
          CompletionTime: '2024-01-01T00:05:00Z',
        },
      })

      const result = await service.getTranscriptionJob('my-job')

      expect(jsonRequestMock).toHaveBeenCalledTimes(1)

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('Transcribe.GetTranscriptionJob')
      expect(opts.body).toEqual({ TranscriptionJobName: 'my-job' })

      expect(result).toMatchObject({
        transcriptionJobName: 'my-job',
        status: 'COMPLETED',
        languageCode: 'en-US',
        transcriptFileUri: 'https://s3.amazonaws.com/transcript.json',
      })
    })

    it('throws when transcriptionJobName is missing', async () => {
      await expect(service.getTranscriptionJob(null)).rejects.toThrow('transcriptionJobName is required.')
    })

    it('does not fetch transcript text when fetchTranscriptText is false', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJob: {
          TranscriptionJobName: 'my-job',
          TranscriptionJobStatus: 'COMPLETED',
          Transcript: { TranscriptFileUri: 'https://example.com/t.json' },
        },
      })

      const result = await service.getTranscriptionJob('my-job', false)

      expect(result).not.toHaveProperty('transcriptText')
    })

    it('handles NotFoundException', async () => {
      const err = new Error('Job not found')

      err.name = 'NotFoundException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.getTranscriptionJob('missing-job')).rejects.toThrow('Not found:')
    })
  })

  describe('listTranscriptionJobs', () => {
    it('sends correct request with no filters', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJobSummaries: [
          {
            TranscriptionJobName: 'job-1',
            TranscriptionJobStatus: 'COMPLETED',
            LanguageCode: 'en-US',
            CreationTime: '2024-01-01T00:00:00Z',
          },
        ],
        NextToken: 'abc123',
      })

      const result = await service.listTranscriptionJobs()

      expect(jsonRequestMock.mock.calls[0][0].target).toBe('Transcribe.ListTranscriptionJobs')
      expect(jsonRequestMock.mock.calls[0][0].body).toEqual({})

      expect(result.jobs).toHaveLength(1)
      expect(result.jobs[0]).toMatchObject({
        transcriptionJobName: 'job-1',
        status: 'COMPLETED',
        languageCode: 'en-US',
      })
      expect(result.cursor).toBe('abc123')
    })

    it('passes all filters', async () => {
      jsonRequestMock.mockResolvedValue({ TranscriptionJobSummaries: [], NextToken: null })

      await service.listTranscriptionJobs('COMPLETED', 'meeting', 10, 'cursor-abc')

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).toEqual({
        Status: 'COMPLETED',
        JobNameContains: 'meeting',
        MaxResults: 10,
        NextToken: 'cursor-abc',
      })
    })

    it('returns null cursor when no NextToken', async () => {
      jsonRequestMock.mockResolvedValue({ TranscriptionJobSummaries: [] })

      const result = await service.listTranscriptionJobs()

      expect(result.cursor).toBeNull()
    })
  })

  describe('deleteTranscriptionJob', () => {
    it('sends correct request and returns confirmation', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.deleteTranscriptionJob('old-job')

      expect(jsonRequestMock.mock.calls[0][0].target).toBe('Transcribe.DeleteTranscriptionJob')
      expect(jsonRequestMock.mock.calls[0][0].body).toEqual({ TranscriptionJobName: 'old-job' })
      expect(result).toEqual({ deleted: true, transcriptionJobName: 'old-job' })
    })

    it('throws when transcriptionJobName is missing', async () => {
      await expect(service.deleteTranscriptionJob(null)).rejects.toThrow('transcriptionJobName is required.')
    })
  })

  // ── Custom Vocabularies ──

  describe('createVocabulary', () => {
    it('sends correct request with all required params', async () => {
      jsonRequestMock.mockResolvedValue({
        VocabularyName: 'medical-terms',
        LanguageCode: 'en-US',
        VocabularyState: 'PENDING',
        LastModifiedTime: '2024-01-01T00:00:00Z',
      })

      const result = await service.createVocabulary('medical-terms', 'en-US', ['aspirin', 'ibuprofen'])

      expect(jsonRequestMock.mock.calls[0][0].target).toBe('Transcribe.CreateVocabulary')
      expect(jsonRequestMock.mock.calls[0][0].body).toEqual({
        VocabularyName: 'medical-terms',
        LanguageCode: 'en-US',
        Phrases: ['aspirin', 'ibuprofen'],
      })

      expect(result).toMatchObject({
        vocabularyName: 'medical-terms',
        languageCode: 'en-US',
        vocabularyState: 'PENDING',
      })
    })

    it('throws when vocabularyName is missing', async () => {
      await expect(service.createVocabulary(null, 'en-US', ['word'])).rejects.toThrow('vocabularyName is required.')
    })

    it('throws when languageCode is missing', async () => {
      await expect(service.createVocabulary('vocab', null, ['word'])).rejects.toThrow('languageCode is required.')
    })

    it('throws when phrases is empty', async () => {
      await expect(service.createVocabulary('vocab', 'en-US', [])).rejects.toThrow('phrases must be a non-empty array.')
    })

    it('throws when phrases is not an array', async () => {
      await expect(service.createVocabulary('vocab', 'en-US', 'word')).rejects.toThrow('phrases must be a non-empty array.')
    })
  })

  describe('getVocabulary', () => {
    it('sends correct request and returns formatted vocabulary', async () => {
      jsonRequestMock.mockResolvedValue({
        VocabularyName: 'medical-terms',
        LanguageCode: 'en-US',
        VocabularyState: 'READY',
        LastModifiedTime: '2024-01-01T00:00:00Z',
        DownloadUri: 'https://s3.amazonaws.com/vocab.txt',
      })

      const result = await service.getVocabulary('medical-terms')

      expect(jsonRequestMock.mock.calls[0][0].target).toBe('Transcribe.GetVocabulary')
      expect(jsonRequestMock.mock.calls[0][0].body).toEqual({ VocabularyName: 'medical-terms' })

      expect(result).toMatchObject({
        vocabularyName: 'medical-terms',
        languageCode: 'en-US',
        vocabularyState: 'READY',
        downloadUri: 'https://s3.amazonaws.com/vocab.txt',
      })
    })

    it('throws when vocabularyName is missing', async () => {
      await expect(service.getVocabulary(null)).rejects.toThrow('vocabularyName is required.')
    })
  })

  describe('listVocabularies', () => {
    it('sends correct request with no filters', async () => {
      jsonRequestMock.mockResolvedValue({
        Vocabularies: [
          { VocabularyName: 'vocab-1', LanguageCode: 'en-US', VocabularyState: 'READY' },
        ],
        NextToken: 'next-page',
      })

      const result = await service.listVocabularies()

      expect(jsonRequestMock.mock.calls[0][0].target).toBe('Transcribe.ListVocabularies')
      expect(jsonRequestMock.mock.calls[0][0].body).toEqual({})

      expect(result.vocabularies).toHaveLength(1)
      expect(result.vocabularies[0]).toMatchObject({
        vocabularyName: 'vocab-1',
        vocabularyState: 'READY',
      })
      expect(result.cursor).toBe('next-page')
    })

    it('passes all filters', async () => {
      jsonRequestMock.mockResolvedValue({ Vocabularies: [] })

      await service.listVocabularies('READY', 'medical', 25, 'cursor-xyz')

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).toEqual({
        StateEquals: 'READY',
        NameContains: 'medical',
        MaxResults: 25,
        NextToken: 'cursor-xyz',
      })
    })

    it('returns null cursor when no NextToken', async () => {
      jsonRequestMock.mockResolvedValue({ Vocabularies: [] })

      const result = await service.listVocabularies()

      expect(result.cursor).toBeNull()
    })
  })

  describe('deleteVocabulary', () => {
    it('sends correct request and returns confirmation', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.deleteVocabulary('old-vocab')

      expect(jsonRequestMock.mock.calls[0][0].target).toBe('Transcribe.DeleteVocabulary')
      expect(jsonRequestMock.mock.calls[0][0].body).toEqual({ VocabularyName: 'old-vocab' })
      expect(result).toEqual({ deleted: true, vocabularyName: 'old-vocab' })
    })

    it('throws when vocabularyName is missing', async () => {
      await expect(service.deleteVocabulary(null)).rejects.toThrow('vocabularyName is required.')
    })
  })

  // ── Dictionary Methods ──

  describe('getVocabulariesDictionary', () => {
    it('returns formatted dictionary items', async () => {
      jsonRequestMock.mockResolvedValue({
        Vocabularies: [
          { VocabularyName: 'medical-terms', VocabularyState: 'READY' },
          { VocabularyName: 'legal-terms', VocabularyState: 'PENDING' },
        ],
        NextToken: null,
      })

      const result = await service.getVocabulariesDictionary({})

      expect(jsonRequestMock.mock.calls[0][0].target).toBe('Transcribe.ListVocabularies')
      expect(jsonRequestMock.mock.calls[0][0].body).toEqual({ MaxResults: 100 })

      expect(result.items).toEqual([
        { label: 'medical-terms', value: 'medical-terms', note: 'READY' },
        { label: 'legal-terms', value: 'legal-terms', note: 'PENDING' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('passes search and cursor', async () => {
      jsonRequestMock.mockResolvedValue({ Vocabularies: [], NextToken: 'next' })

      const result = await service.getVocabulariesDictionary({ search: 'med', cursor: 'prev' })

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).toEqual({ MaxResults: 100, NameContains: 'med', NextToken: 'prev' })
      expect(result.cursor).toBe('next')
    })

    it('handles empty payload', async () => {
      jsonRequestMock.mockResolvedValue({ Vocabularies: [] })

      const result = await service.getVocabulariesDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getTranscriptionJobsDictionary', () => {
    it('returns formatted dictionary items', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJobSummaries: [
          { TranscriptionJobName: 'meeting-2024', TranscriptionJobStatus: 'COMPLETED' },
        ],
      })

      const result = await service.getTranscriptionJobsDictionary({})

      expect(jsonRequestMock.mock.calls[0][0].target).toBe('Transcribe.ListTranscriptionJobs')
      expect(jsonRequestMock.mock.calls[0][0].body).toEqual({ MaxResults: 100 })

      expect(result.items).toEqual([
        { label: 'meeting-2024', value: 'meeting-2024', note: 'COMPLETED' },
      ])
    })

    it('passes search and cursor', async () => {
      jsonRequestMock.mockResolvedValue({ TranscriptionJobSummaries: [] })

      await service.getTranscriptionJobsDictionary({ search: 'meeting', cursor: 'tok' })

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).toEqual({ MaxResults: 100, JobNameContains: 'meeting', NextToken: 'tok' })
    })

    it('handles empty payload', async () => {
      jsonRequestMock.mockResolvedValue({ TranscriptionJobSummaries: [] })

      const result = await service.getTranscriptionJobsDictionary(null)

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('maps BadRequestException', async () => {
      const err = new Error('Invalid S3 URI')

      err.name = 'BadRequestException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.listTranscriptionJobs()).rejects.toThrow('Invalid request:')
    })

    it('maps LimitExceededException', async () => {
      const err = new Error('Too many requests')

      err.name = 'LimitExceededException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.listVocabularies()).rejects.toThrow('Limit exceeded:')
    })

    it('maps unknown errors through mapAwsError', async () => {
      const err = new Error('Something unexpected')

      err.name = 'ThrottlingException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.listTranscriptionJobs()).rejects.toThrow('throttled by AWS')
    })
  })
})
