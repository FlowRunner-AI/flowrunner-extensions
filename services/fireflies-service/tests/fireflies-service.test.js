'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-fireflies-api-key'
const API_URL = 'https://api.fireflies.ai/graphql'

describe('Fireflies Service', () => {
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
        ])
      )
    })
  })

  // ── getUsersDictionary ──

  describe('getUsersDictionary', () => {
    const mockUsers = [
      { user_id: 'u1', email: 'jane@example.com', name: 'Jane Doe' },
      { user_id: 'u2', email: 'bob@example.com', name: 'Bob Smith' },
      { user_id: 'u3', email: 'alice@example.com', name: null },
    ]

    it('sends correct GraphQL query and returns formatted items', async () => {
      mock.onPost(API_URL).reply({ data: { users: mockUsers } })

      const result = await service.getUsersDictionary({})

      expect(result.items).toHaveLength(3)
      expect(result.items[0]).toEqual({ label: 'Jane Doe', value: 'jane@example.com', note: 'ID: u1' })
      expect(result.items[2]).toEqual({ label: 'alice@example.com', value: 'alice@example.com', note: 'ID: u3' })
      expect(result.cursor).toBeNull()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` })
      expect(mock.history[0].body.query).toContain('users')
    })

    it('filters users by search term (name)', async () => {
      mock.onPost(API_URL).reply({ data: { users: mockUsers } })

      const result = await service.getUsersDictionary({ search: 'jane' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('jane@example.com')
    })

    it('filters users by search term (email)', async () => {
      mock.onPost(API_URL).reply({ data: { users: mockUsers } })

      const result = await service.getUsersDictionary({ search: 'bob@' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('bob@example.com')
    })

    it('returns empty items when no users match search', async () => {
      mock.onPost(API_URL).reply({ data: { users: mockUsers } })

      const result = await service.getUsersDictionary({ search: 'zzz' })

      expect(result.items).toHaveLength(0)
      expect(result.cursor).toBeNull()
    })

    it('handles null payload gracefully', async () => {
      mock.onPost(API_URL).reply({ data: { users: mockUsers } })

      const result = await service.getUsersDictionary(null)

      expect(result.items).toHaveLength(3)
    })

    it('handles null users response', async () => {
      mock.onPost(API_URL).reply({ data: { users: null } })

      const result = await service.getUsersDictionary({})

      expect(result.items).toHaveLength(0)
    })
  })

  // ── listTranscripts ──

  describe('listTranscripts', () => {
    const mockTranscripts = [
      { id: 't1', title: 'Weekly Sync', date: 1717200000000, duration: 31.5 },
      { id: 't2', title: 'Standup', date: 1717200000001, duration: 10 },
    ]

    it('sends correct query with default limit', async () => {
      mock.onPost(API_URL).reply({ data: { transcripts: mockTranscripts } })

      const result = await service.listTranscripts()

      expect(result).toEqual(mockTranscripts)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body.variables).toMatchObject({ limit: 25 })
      expect(mock.history[0].body.variables.title).toBeUndefined()
      expect(mock.history[0].body.variables.host_email).toBeUndefined()
    })

    it('passes all filter parameters', async () => {
      mock.onPost(API_URL).reply({ data: { transcripts: mockTranscripts } })

      await service.listTranscripts('Weekly', 1000, 2000, 'jane@example.com', 'bob@example.com', 10)

      const vars = mock.history[0].body.variables
      expect(vars).toMatchObject({
        title: 'Weekly',
        fromDate: 1000,
        toDate: 2000,
        host_email: 'jane@example.com',
        participant_email: 'bob@example.com',
        limit: 10,
      })
    })

    it('returns empty array when transcripts is null', async () => {
      mock.onPost(API_URL).reply({ data: { transcripts: null } })

      const result = await service.listTranscripts()

      expect(result).toEqual([])
    })

    it('throws on GraphQL error', async () => {
      mock.onPost(API_URL).reply({ errors: [{ message: 'Unauthorized' }] })

      await expect(service.listTranscripts()).rejects.toThrow('Fireflies API error: Unauthorized')
    })
  })

  // ── getTranscript ──

  describe('getTranscript', () => {
    const mockTranscript = {
      id: 'abc123',
      title: 'Weekly Sync',
      sentences: [{ index: 0, speaker_name: 'Jane', text: 'Hello' }],
      summary: { overview: 'Overview text' },
    }

    it('sends correct query with transcript ID', async () => {
      mock.onPost(API_URL).reply({ data: { transcript: mockTranscript } })

      const result = await service.getTranscript('abc123')

      expect(result).toEqual(mockTranscript)
      expect(mock.history[0].body.variables).toEqual({ id: 'abc123' })
      expect(mock.history[0].body.query).toContain('transcript(id: $id)')
    })

    it('throws when transcriptId is not provided', async () => {
      await expect(service.getTranscript()).rejects.toThrow('Transcript ID is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when transcriptId is empty string', async () => {
      await expect(service.getTranscript('')).rejects.toThrow('Transcript ID is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── searchTranscripts ──

  describe('searchTranscripts', () => {
    const mockResults = [{ id: 't1', title: 'Weekly Sync' }]

    it('sends correct query with search term and default limit', async () => {
      mock.onPost(API_URL).reply({ data: { transcripts: mockResults } })

      const result = await service.searchTranscripts('Weekly')

      expect(result).toEqual(mockResults)
      expect(mock.history[0].body.variables).toEqual({ title: 'Weekly', limit: 25 })
    })

    it('passes custom limit', async () => {
      mock.onPost(API_URL).reply({ data: { transcripts: mockResults } })

      await service.searchTranscripts('Sync', 10)

      expect(mock.history[0].body.variables).toEqual({ title: 'Sync', limit: 10 })
    })

    it('throws when searchQuery is not provided', async () => {
      await expect(service.searchTranscripts()).rejects.toThrow('Search query is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when searchQuery is empty string', async () => {
      await expect(service.searchTranscripts('')).rejects.toThrow('Search query is required')
    })

    it('returns empty array when transcripts is null', async () => {
      mock.onPost(API_URL).reply({ data: { transcripts: null } })

      const result = await service.searchTranscripts('nothing')

      expect(result).toEqual([])
    })
  })

  // ── getTranscriptSummary ──

  describe('getTranscriptSummary', () => {
    const mockSummary = {
      id: 'abc123',
      title: 'Weekly Sync',
      summary: { overview: 'Overview', action_items: 'Do X', keywords: ['sync'] },
    }

    it('sends correct query with transcript ID', async () => {
      mock.onPost(API_URL).reply({ data: { transcript: mockSummary } })

      const result = await service.getTranscriptSummary('abc123')

      expect(result).toEqual(mockSummary)
      expect(mock.history[0].body.variables).toEqual({ id: 'abc123' })
      expect(mock.history[0].body.query).toContain('transcript(id: $id)')
      expect(mock.history[0].body.query).toContain('summary')
    })

    it('throws when transcriptId is not provided', async () => {
      await expect(service.getTranscriptSummary()).rejects.toThrow('Transcript ID is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── uploadAudio ──

  describe('uploadAudio', () => {
    const mockResponse = { success: true, title: 'My Meeting', message: 'Audio uploaded successfully.' }

    it('sends correct mutation with only required audioUrl', async () => {
      mock.onPost(API_URL).reply({ data: { uploadAudio: mockResponse } })

      const result = await service.uploadAudio('https://example.com/audio.mp3')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].body.variables.input).toMatchObject({ url: 'https://example.com/audio.mp3' })
      expect(mock.history[0].body.variables.input.title).toBeUndefined()
      expect(mock.history[0].body.variables.input.attendees).toBeUndefined()
      expect(mock.history[0].body.variables.input.custom_language).toBeUndefined()
      expect(mock.history[0].body.variables.input.save_video).toBeUndefined()
    })

    it('sends all optional parameters', async () => {
      mock.onPost(API_URL).reply({ data: { uploadAudio: mockResponse } })

      await service.uploadAudio('https://example.com/video.mp4', 'Q2 Planning', 'a@b.com, c@d.com', 'es', true)

      const input = mock.history[0].body.variables.input
      expect(input.url).toBe('https://example.com/video.mp4')
      expect(input.title).toBe('Q2 Planning')
      expect(input.attendees).toEqual([{ email: 'a@b.com' }, { email: 'c@d.com' }])
      expect(input.custom_language).toBe('es')
      expect(input.save_video).toBe(true)
    })

    it('handles saveVideo=false by not including it', async () => {
      mock.onPost(API_URL).reply({ data: { uploadAudio: mockResponse } })

      await service.uploadAudio('https://example.com/audio.mp3', null, null, null, false)

      expect(mock.history[0].body.variables.input.save_video).toBeUndefined()
    })

    it('throws when audioUrl is not provided', async () => {
      await expect(service.uploadAudio()).rejects.toThrow('Audio URL is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when audioUrl is empty string', async () => {
      await expect(service.uploadAudio('')).rejects.toThrow('Audio URL is required')
    })
  })

  // ── addToLiveMeeting ──

  describe('addToLiveMeeting', () => {
    const mockResponse = { success: true, message: 'Fred is on the way to your meeting.' }

    it('sends correct mutation with meeting link', async () => {
      mock.onPost(API_URL).reply({ data: { addToLiveMeeting: mockResponse } })

      const result = await service.addToLiveMeeting('https://zoom.us/j/123')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].body.variables).toEqual({ meeting_link: 'https://zoom.us/j/123' })
      expect(mock.history[0].body.query).toContain('addToLiveMeeting')
    })

    it('throws when meetingLink is not provided', async () => {
      await expect(service.addToLiveMeeting()).rejects.toThrow('Meeting link is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when meetingLink is empty string', async () => {
      await expect(service.addToLiveMeeting('')).rejects.toThrow('Meeting link is required')
    })
  })

  // ── onNewTranscript (polling trigger) ──

  describe('onNewTranscript', () => {
    const mockTranscripts = [
      { id: 't1', title: 'Meeting A' },
      { id: 't2', title: 'Meeting B' },
      { id: 't3', title: 'Meeting C' },
    ]

    it('returns latest transcript in learning mode', async () => {
      mock.onPost(API_URL).reply({ data: { transcripts: mockTranscripts } })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewTranscript',
        learningMode: true,
        triggerData: {},
        state: null,
      })

      expect(result.events).toEqual([mockTranscripts[0]])
      expect(result.state).toBeNull()
    })

    it('returns empty events in learning mode when no transcripts', async () => {
      mock.onPost(API_URL).reply({ data: { transcripts: [] } })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewTranscript',
        learningMode: true,
        triggerData: {},
        state: null,
      })

      expect(result.events).toEqual([])
      expect(result.state).toBeNull()
    })

    it('seeds state with transcript IDs on first non-learning run', async () => {
      mock.onPost(API_URL).reply({ data: { transcripts: mockTranscripts } })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewTranscript',
        learningMode: false,
        triggerData: {},
        state: null,
      })

      expect(result.events).toEqual([])
      expect(result.state.ids).toEqual(['t1', 't2', 't3'])
    })

    it('detects new transcripts on subsequent runs', async () => {
      const newTranscripts = [
        { id: 't4', title: 'New Meeting' },
        ...mockTranscripts,
      ]
      mock.onPost(API_URL).reply({ data: { transcripts: newTranscripts } })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewTranscript',
        learningMode: false,
        triggerData: {},
        state: { ids: ['t1', 't2', 't3'] },
      })

      expect(result.events).toEqual([{ id: 't4', title: 'New Meeting' }])
      expect(result.state.ids).toContain('t4')
      expect(result.state.ids).toContain('t1')
    })

    it('returns no events when no new transcripts', async () => {
      mock.onPost(API_URL).reply({ data: { transcripts: mockTranscripts } })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewTranscript',
        learningMode: false,
        triggerData: {},
        state: { ids: ['t1', 't2', 't3'] },
      })

      expect(result.events).toEqual([])
      expect(result.state.ids).toEqual(['t1', 't2', 't3'])
    })

    it('passes hostEmail filter to the query', async () => {
      mock.onPost(API_URL).reply({ data: { transcripts: [] } })

      await service.handleTriggerPollingForEvent({
        eventName: 'onNewTranscript',
        learningMode: true,
        triggerData: { hostEmail: 'jane@example.com' },
        state: null,
      })

      expect(mock.history[0].body.variables).toMatchObject({
        host_email: 'jane@example.com',
        limit: 25,
      })
    })

    it('caps stored IDs at 200', async () => {
      const manyTranscripts = Array.from({ length: 5 }, (_, i) => ({ id: `new-${i}` }))
      const existingIds = Array.from({ length: 198 }, (_, i) => `old-${i}`)

      mock.onPost(API_URL).reply({ data: { transcripts: manyTranscripts } })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewTranscript',
        learningMode: false,
        triggerData: {},
        state: { ids: existingIds },
      })

      expect(result.state.ids.length).toBeLessThanOrEqual(200)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('wraps GraphQL errors with descriptive message', async () => {
      mock.onPost(API_URL).reply({ errors: [{ message: 'Invalid API key' }] })

      await expect(service.listTranscripts()).rejects.toThrow('Fireflies API error: Invalid API key')
    })

    it('handles GraphQL error without message field', async () => {
      mock.onPost(API_URL).reply({ errors: [{ code: 'AUTH_FAILED' }] })

      await expect(service.listTranscripts()).rejects.toThrow('Fireflies API error:')
    })

    it('wraps network errors', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'Network timeout' })

      await expect(service.listTranscripts()).rejects.toThrow('Fireflies API error: Network timeout')
    })
  })
})
