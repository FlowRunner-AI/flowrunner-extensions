'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Fireflies Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('fireflies-service')
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

  // ── getUsersDictionary ──

  describe('getUsersDictionary', () => {
    it('returns items array with expected shape', async () => {
      const result = await service.getUsersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })

    it('filters by search term', async () => {
      const allResult = await service.getUsersDictionary({})
      const searchResult = await service.getUsersDictionary({ search: 'zzz_no_match_expected' })

      expect(searchResult.items.length).toBeLessThanOrEqual(allResult.items.length)
    })
  })

  // ── listTranscripts ──

  describe('listTranscripts', () => {
    it('returns an array of transcripts', async () => {
      const result = await service.listTranscripts(null, null, null, null, null, 5)

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('title')
        expect(result[0]).toHaveProperty('date')
        expect(result[0]).toHaveProperty('duration')
      }
    })

    it('respects limit parameter', async () => {
      const result = await service.listTranscripts(null, null, null, null, null, 2)

      expect(result.length).toBeLessThanOrEqual(2)
    })
  })

  // ── getTranscript ──

  describe('getTranscript', () => {
    it('retrieves a full transcript by ID', async () => {
      const list = await service.listTranscripts(null, null, null, null, null, 1)

      if (list.length === 0) {
        console.log('No transcripts available to test getTranscript -- skipping')
        return
      }

      const transcript = await service.getTranscript(list[0].id)

      expect(transcript).toHaveProperty('id', list[0].id)
      expect(transcript).toHaveProperty('title')
      expect(transcript).toHaveProperty('sentences')
      expect(transcript).toHaveProperty('summary')
    })

    it('throws when transcriptId is empty', async () => {
      await expect(service.getTranscript('')).rejects.toThrow('Transcript ID is required')
    })
  })

  // ── searchTranscripts ──

  describe('searchTranscripts', () => {
    it('returns array for a search query', async () => {
      const result = await service.searchTranscripts('meeting', 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('throws when search query is empty', async () => {
      await expect(service.searchTranscripts('')).rejects.toThrow('Search query is required')
    })
  })

  // ── getTranscriptSummary ──

  describe('getTranscriptSummary', () => {
    it('retrieves summary for a transcript', async () => {
      const list = await service.listTranscripts(null, null, null, null, null, 1)

      if (list.length === 0) {
        console.log('No transcripts available to test getTranscriptSummary -- skipping')
        return
      }

      const summary = await service.getTranscriptSummary(list[0].id)

      expect(summary).toHaveProperty('id', list[0].id)
      expect(summary).toHaveProperty('title')
      expect(summary).toHaveProperty('summary')
    })

    it('throws when transcriptId is empty', async () => {
      await expect(service.getTranscriptSummary('')).rejects.toThrow('Transcript ID is required')
    })
  })

  // ── addToLiveMeeting ──

  describe('addToLiveMeeting', () => {
    it('throws when meetingLink is empty', async () => {
      await expect(service.addToLiveMeeting('')).rejects.toThrow('Meeting link is required')
    })
  })

  // ── uploadAudio ──

  describe('uploadAudio', () => {
    it('throws when audioUrl is empty', async () => {
      await expect(service.uploadAudio('')).rejects.toThrow('Audio URL is required')
    })
  })
})
