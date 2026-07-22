'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.vapi.ai'

describe('Vapi Service', () => {
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

  // ── Calls ──

  describe('createCall', () => {
    it('sends POST with assistant and customer', async () => {
      mock.onPost(`${BASE}/call`).reply({ id: 'call-1', status: 'queued' })

      const result = await service.createCall('asst-1', 'pn-1', '+14155551234', 'Jane')

      expect(result).toEqual({ id: 'call-1', status: 'queued' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': `Bearer ${API_KEY}` })
      expect(mock.history[0].body).toMatchObject({
        assistantId: 'asst-1',
        phoneNumberId: 'pn-1',
        customer: { number: '+14155551234', name: 'Jane' },
      })
    })

    it('includes schedulePlan when earliestAt/latestAt provided', async () => {
      mock.onPost(`${BASE}/call`).reply({ id: 'call-2', status: 'scheduled' })

      await service.createCall('asst-1', 'pn-1', '+14155551234', undefined, undefined, undefined, '2026-08-01T10:00:00Z', '2026-08-01T12:00:00Z')

      expect(mock.history[0].body).toMatchObject({
        schedulePlan: { earliestAt: '2026-08-01T10:00:00Z', latestAt: '2026-08-01T12:00:00Z' },
      })
    })

    it('merges advancedConfig into body', async () => {
      mock.onPost(`${BASE}/call`).reply({ id: 'call-3' })

      await service.createCall('asst-1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { workflowId: 'wf-1' })

      expect(mock.history[0].body).toMatchObject({ assistantId: 'asst-1', workflowId: 'wf-1' })
    })

    it('sends customers array when provided', async () => {
      mock.onPost(`${BASE}/call`).reply({ id: 'call-4' })
      const customers = [{ number: '+14155551234' }, { number: '+14155556789' }]

      await service.createCall(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, customers)

      expect(mock.history[0].body).toMatchObject({ customers })
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/call`).replyWithError({ message: 'Bad Request', body: { message: 'Invalid phone number' } })

      await expect(service.createCall('asst-1')).rejects.toThrow('Vapi API error')
    })
  })

  describe('listCalls', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/call`).reply([{ id: 'call-1' }])

      const result = await service.listCalls('asst-1', 'pn-1', 50)

      expect(result).toEqual([{ id: 'call-1' }])
      expect(mock.history[0].query).toMatchObject({ assistantId: 'asst-1', phoneNumberId: 'pn-1', limit: 50 })
    })
  })

  describe('getCall', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/call/call-1`).reply({ id: 'call-1', status: 'ended' })

      const result = await service.getCall('call-1')

      expect(result).toEqual({ id: 'call-1', status: 'ended' })
    })
  })

  describe('updateCall', () => {
    it('sends PATCH with name', async () => {
      mock.onPatch(`${BASE}/call/call-1`).reply({ id: 'call-1', name: 'Updated' })

      await service.updateCall('call-1', 'Updated')

      expect(mock.history[0].body).toEqual({ name: 'Updated' })
    })
  })

  describe('deleteCall', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/call/call-1`).reply({ id: 'call-1' })

      const result = await service.deleteCall('call-1')

      expect(result).toEqual({ id: 'call-1' })
    })
  })

  describe('getCallRecording', () => {
    it('downloads stereo recording and uploads to file storage', async () => {
      mock.onGet(`${BASE}/call/call-1`).reply({
        id: 'call-1',
        artifact: { stereoRecordingUrl: 'https://storage.vapi.ai/stereo.wav' },
      })
      mock.onGet('https://storage.vapi.ai/stereo.wav').reply(Buffer.from('audio-data'))

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.com/stereo.wav' }),
        },
      }

      const result = await service.getCallRecording('call-1', 'Stereo')

      expect(result).toMatchObject({
        url: 'https://files.flowrunner.com/stereo.wav',
        callId: 'call-1',
        recordingType: 'Stereo',
        bytes: 10,
      })
      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ generateUrl: true, overwrite: true, scope: 'FLOW' })
      )
    })

    it('throws for unknown recording type', async () => {
      await expect(service.getCallRecording('call-1', 'Unknown')).rejects.toThrow('Unknown recording type')
    })

    it('throws when recording URL not available', async () => {
      mock.onGet(`${BASE}/call/call-1`).reply({ id: 'call-1', artifact: {} })

      await expect(service.getCallRecording('call-1', 'Stereo')).rejects.toThrow('No \'Stereo\' recording is available')
    })
  })

  describe('getCallLogs', () => {
    it('downloads and returns log content', async () => {
      mock.onGet(`${BASE}/call/call-1`).reply({
        id: 'call-1',
        artifact: { logUrl: 'https://storage.vapi.ai/log.txt' },
      })
      mock.onGet('https://storage.vapi.ai/log.txt').reply(Buffer.from('log content here'))

      const result = await service.getCallLogs('call-1')

      expect(result).toEqual({ callId: 'call-1', content: 'log content here' })
    })

    it('throws when no log URL available', async () => {
      mock.onGet(`${BASE}/call/call-1`).reply({ id: 'call-1', artifact: {} })

      await expect(service.getCallLogs('call-1')).rejects.toThrow('No log artifact is available')
    })
  })

  // ── Assistants ──

  describe('createAssistant', () => {
    it('sends POST with convenience fields', async () => {
      mock.onPost(`${BASE}/assistant`).reply({ id: 'asst-1', name: 'Support' })

      await service.createAssistant('Support', 'Hello!', 'You are helpful.', 'openai', 'gpt-4o', '11labs', 'burt')

      expect(mock.history[0].body).toMatchObject({
        name: 'Support',
        firstMessage: 'Hello!',
        model: { provider: 'openai', model: 'gpt-4o', messages: [{ role: 'system', content: 'You are helpful.' }] },
        voice: { provider: '11labs', voiceId: 'burt' },
      })
    })

    it('uses full model/voice config objects when provided', async () => {
      mock.onPost(`${BASE}/assistant`).reply({ id: 'asst-2' })

      const modelConfig = { provider: 'anthropic', model: 'claude-sonnet-4-20250514' }
      const voiceConfig = { provider: 'openai', voiceId: 'alloy' }

      await service.createAssistant('Bot', null, null, null, null, null, null, modelConfig, voiceConfig)

      expect(mock.history[0].body).toMatchObject({
        name: 'Bot',
        model: modelConfig,
        voice: voiceConfig,
      })
    })

    it('includes serverUrl as server object', async () => {
      mock.onPost(`${BASE}/assistant`).reply({ id: 'asst-3' })

      await service.createAssistant(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'https://example.com/webhook')

      expect(mock.history[0].body).toMatchObject({
        server: { url: 'https://example.com/webhook' },
      })
    })
  })

  describe('listAssistants', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/assistant`).reply([{ id: 'asst-1' }])

      const result = await service.listAssistants(50)

      expect(result).toEqual([{ id: 'asst-1' }])
      expect(mock.history[0].query).toMatchObject({ limit: 50 })
    })
  })

  describe('getAssistant', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/assistant/asst-1`).reply({ id: 'asst-1', name: 'Bot' })

      const result = await service.getAssistant('asst-1')

      expect(result).toEqual({ id: 'asst-1', name: 'Bot' })
    })
  })

  describe('updateAssistant', () => {
    it('sends PATCH with updated fields', async () => {
      mock.onPatch(`${BASE}/assistant/asst-1`).reply({ id: 'asst-1', name: 'Updated' })

      await service.updateAssistant('asst-1', 'Updated', 'Hi there')

      expect(mock.history[0].body).toMatchObject({ name: 'Updated', firstMessage: 'Hi there' })
    })
  })

  describe('deleteAssistant', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/assistant/asst-1`).reply({ id: 'asst-1' })

      const result = await service.deleteAssistant('asst-1')

      expect(result).toEqual({ id: 'asst-1' })
    })
  })

  // ── Phone Numbers ──

  describe('createPhoneNumber', () => {
    it('sends POST with vapi provider resolved', async () => {
      mock.onPost(`${BASE}/phone-number`).reply({ id: 'pn-1', provider: 'vapi' })

      await service.createPhoneNumber('Vapi (Free US Number)', undefined, '415')

      expect(mock.history[0].body).toMatchObject({
        provider: 'vapi',
        numberDesiredAreaCode: '415',
      })
    })

    it('sends POST with twilio provider and credentials', async () => {
      mock.onPost(`${BASE}/phone-number`).reply({ id: 'pn-2', provider: 'twilio' })

      await service.createPhoneNumber('Twilio', '+14155551234', undefined, undefined, undefined, 'sid-123', 'token-456', 'Sales Line')

      expect(mock.history[0].body).toMatchObject({
        provider: 'twilio',
        number: '+14155551234',
        twilioAccountSid: 'sid-123',
        twilioAuthToken: 'token-456',
        name: 'Sales Line',
      })
    })

    it('includes server URL and inbound assistant', async () => {
      mock.onPost(`${BASE}/phone-number`).reply({ id: 'pn-3' })

      await service.createPhoneNumber('Vapi (Free US Number)', undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'asst-1', undefined, undefined, 'https://example.com/webhook')

      expect(mock.history[0].body).toMatchObject({
        assistantId: 'asst-1',
        server: { url: 'https://example.com/webhook' },
      })
    })
  })

  describe('listPhoneNumbers', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/phone-number`).reply([{ id: 'pn-1' }])

      await service.listPhoneNumbers(10)

      expect(mock.history[0].query).toMatchObject({ limit: 10 })
    })
  })

  describe('getPhoneNumber', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/phone-number/pn-1`).reply({ id: 'pn-1' })

      const result = await service.getPhoneNumber('pn-1')

      expect(result).toEqual({ id: 'pn-1' })
    })
  })

  describe('updatePhoneNumber', () => {
    it('sends PATCH with updated fields', async () => {
      mock.onPatch(`${BASE}/phone-number/pn-1`).reply({ id: 'pn-1', name: 'Updated' })

      await service.updatePhoneNumber('pn-1', 'Updated', 'asst-2')

      expect(mock.history[0].body).toMatchObject({ name: 'Updated', assistantId: 'asst-2' })
    })
  })

  describe('deletePhoneNumber', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/phone-number/pn-1`).reply({ id: 'pn-1' })

      const result = await service.deletePhoneNumber('pn-1')

      expect(result).toEqual({ id: 'pn-1' })
    })
  })

  // ── Tools ──

  describe('createTool', () => {
    it('creates a function tool with schema', async () => {
      mock.onPost(`${BASE}/tool`).reply({ id: 'tool-1', type: 'function' })

      const schema = { type: 'object', properties: { orderNumber: { type: 'string' } } }
      await service.createTool('Function', 'lookup_order', 'Looks up an order', schema)

      expect(mock.history[0].body).toMatchObject({
        type: 'function',
        function: {
          name: 'lookup_order',
          description: 'Looks up an order',
          parameters: schema,
        },
      })
    })

    it('creates an API Request tool with URL and method', async () => {
      mock.onPost(`${BASE}/tool`).reply({ id: 'tool-2', type: 'apiRequest' })

      await service.createTool('API Request', 'get_weather', 'Gets weather', undefined, 'https://api.weather.com', 'GET')

      expect(mock.history[0].body).toMatchObject({
        type: 'apiRequest',
        name: 'get_weather',
        url: 'https://api.weather.com',
        method: 'GET',
      })
    })

    it('sets async flag when provided', async () => {
      mock.onPost(`${BASE}/tool`).reply({ id: 'tool-3' })

      await service.createTool('Function', 'bg_task', 'Async task', undefined, undefined, undefined, undefined, undefined, undefined, true)

      expect(mock.history[0].body).toMatchObject({ async: true })
    })

    it('sets server URL when provided', async () => {
      mock.onPost(`${BASE}/tool`).reply({ id: 'tool-4' })

      await service.createTool('Function', 'my_tool', 'Desc', undefined, undefined, undefined, undefined, undefined, 'https://example.com/tool')

      expect(mock.history[0].body).toMatchObject({ server: { url: 'https://example.com/tool' } })
    })
  })

  describe('listTools', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/tool`).reply([{ id: 'tool-1' }])

      await service.listTools(25)

      expect(mock.history[0].query).toMatchObject({ limit: 25 })
    })
  })

  describe('getTool', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/tool/tool-1`).reply({ id: 'tool-1', type: 'function' })

      const result = await service.getTool('tool-1')

      expect(result).toEqual({ id: 'tool-1', type: 'function' })
    })
  })

  describe('updateTool', () => {
    it('sends PATCH with description and server URL', async () => {
      mock.onPatch(`${BASE}/tool/tool-1`).reply({ id: 'tool-1' })

      await service.updateTool('tool-1', 'New description', 'https://example.com/v2')

      expect(mock.history[0].body).toMatchObject({
        description: 'New description',
        server: { url: 'https://example.com/v2' },
      })
    })

    it('merges advancedConfig', async () => {
      mock.onPatch(`${BASE}/tool/tool-1`).reply({ id: 'tool-1' })

      await service.updateTool('tool-1', undefined, undefined, { function: { name: 'updated' } })

      expect(mock.history[0].body).toMatchObject({ function: { name: 'updated' } })
    })
  })

  describe('deleteTool', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/tool/tool-1`).reply({ id: 'tool-1' })

      const result = await service.deleteTool('tool-1')

      expect(result).toEqual({ id: 'tool-1' })
    })
  })

  // ── Squads ──

  describe('createSquad', () => {
    it('sends POST with members and name', async () => {
      mock.onPost(`${BASE}/squad`).reply({ id: 'squad-1', name: 'Support Squad' })
      const members = [{ assistantId: 'asst-1' }, { assistantId: 'asst-2' }]

      await service.createSquad(members, 'Support Squad')

      expect(mock.history[0].body).toMatchObject({ name: 'Support Squad', members })
    })
  })

  describe('listSquads', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/squad`).reply([{ id: 'squad-1' }])

      await service.listSquads(10)

      expect(mock.history[0].query).toMatchObject({ limit: 10 })
    })
  })

  describe('getSquad', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/squad/squad-1`).reply({ id: 'squad-1' })

      const result = await service.getSquad('squad-1')

      expect(result).toEqual({ id: 'squad-1' })
    })
  })

  describe('updateSquad', () => {
    it('sends PATCH with name and members', async () => {
      mock.onPatch(`${BASE}/squad/squad-1`).reply({ id: 'squad-1', name: 'v2' })
      const members = [{ assistantId: 'asst-3' }]

      await service.updateSquad('squad-1', 'v2', members)

      expect(mock.history[0].body).toMatchObject({ name: 'v2', members })
    })
  })

  describe('deleteSquad', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/squad/squad-1`).reply({ id: 'squad-1' })

      const result = await service.deleteSquad('squad-1')

      expect(result).toEqual({ id: 'squad-1' })
    })
  })

  // ── Chat ──

  describe('createChat', () => {
    it('sends POST with input and assistant', async () => {
      mock.onPost(`${BASE}/chat`).reply({ id: 'chat-1', output: [{ role: 'assistant', content: 'Hello!' }] })

      const result = await service.createChat('Hi', 'asst-1')

      expect(result.output).toEqual([{ role: 'assistant', content: 'Hello!' }])
      expect(mock.history[0].body).toMatchObject({
        input: 'Hi',
        assistantId: 'asst-1',
        stream: false,
      })
    })

    it('includes sessionId and previousChatId', async () => {
      mock.onPost(`${BASE}/chat`).reply({ id: 'chat-2' })

      await service.createChat('Follow up', 'asst-1', undefined, 'sess-1', 'chat-1')

      expect(mock.history[0].body).toMatchObject({
        sessionId: 'sess-1',
        previousChatId: 'chat-1',
      })
    })
  })

  describe('listChats', () => {
    it('sends GET with query params and resolves sortOrder', async () => {
      mock.onGet(`${BASE}/chat`).reply({ results: [], metadata: {} })

      await service.listChats('asst-1', undefined, undefined, 50, 'Ascending')

      expect(mock.history[0].query).toMatchObject({
        assistantId: 'asst-1',
        limit: 50,
        sortOrder: 'ASC',
      })
    })
  })

  describe('getChat', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/chat/chat-1`).reply({ id: 'chat-1' })

      const result = await service.getChat('chat-1')

      expect(result).toEqual({ id: 'chat-1' })
    })
  })

  describe('deleteChat', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/chat/chat-1`).reply({ id: 'chat-1' })

      const result = await service.deleteChat('chat-1')

      expect(result).toEqual({ id: 'chat-1' })
    })
  })

  // ── Sessions ──

  describe('createSession', () => {
    it('sends POST with name and assistant', async () => {
      mock.onPost(`${BASE}/session`).reply({ id: 'sess-1', status: 'active' })

      await service.createSession('Test Session', 'asst-1', undefined, 3600)

      expect(mock.history[0].body).toMatchObject({
        name: 'Test Session',
        assistantId: 'asst-1',
        expirationSeconds: 3600,
      })
    })

    it('merges advancedConfig', async () => {
      mock.onPost(`${BASE}/session`).reply({ id: 'sess-2' })

      await service.createSession(undefined, undefined, undefined, undefined, { customer: { number: '+1234' } })

      expect(mock.history[0].body).toMatchObject({ customer: { number: '+1234' } })
    })
  })

  describe('listSessions', () => {
    it('sends GET with resolved sortOrder', async () => {
      mock.onGet(`${BASE}/session`).reply({ results: [], metadata: {} })

      await service.listSessions(undefined, undefined, 25, 'Descending')

      expect(mock.history[0].query).toMatchObject({ limit: 25, sortOrder: 'DESC' })
    })
  })

  describe('getSession', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/session/sess-1`).reply({ id: 'sess-1' })

      const result = await service.getSession('sess-1')

      expect(result).toEqual({ id: 'sess-1' })
    })
  })

  describe('updateSession', () => {
    it('sends PATCH with resolved status', async () => {
      mock.onPatch(`${BASE}/session/sess-1`).reply({ id: 'sess-1', status: 'completed' })

      await service.updateSession('sess-1', 'Done', 'Completed', 7200)

      expect(mock.history[0].body).toMatchObject({
        name: 'Done',
        status: 'completed',
        expirationSeconds: 7200,
      })
    })
  })

  describe('deleteSession', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/session/sess-1`).reply({ id: 'sess-1' })

      const result = await service.deleteSession('sess-1')

      expect(result).toEqual({ id: 'sess-1' })
    })
  })

  // ── Files ──

  describe('uploadFile', () => {
    it('downloads file and uploads via FormData', async () => {
      mock.onGet('https://files.example.com/doc.pdf').reply(Buffer.from('pdf-bytes'))
      mock.onPost(`${BASE}/file`).reply({ id: 'file-1', name: 'doc.pdf' })

      const result = await service.uploadFile('https://files.example.com/doc.pdf')

      expect(result).toEqual({ id: 'file-1', name: 'doc.pdf' })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].headers).toMatchObject({ 'Authorization': `Bearer ${API_KEY}` })
      expect(mock.history[1].formData).toBeDefined()
    })

    it('uses provided filename', async () => {
      mock.onGet('https://files.example.com/doc.pdf').reply(Buffer.from('pdf-bytes'))
      mock.onPost(`${BASE}/file`).reply({ id: 'file-2', name: 'custom.pdf' })

      const result = await service.uploadFile('https://files.example.com/doc.pdf', 'custom.pdf')

      expect(result).toMatchObject({ name: 'custom.pdf' })
    })

    it('throws on invalid file URL', async () => {
      await expect(service.uploadFile('not-a-url')).rejects.toThrow('Invalid file URL')
    })
  })

  describe('listFiles', () => {
    it('sends GET with purpose filter', async () => {
      mock.onGet(`${BASE}/file`).reply([{ id: 'file-1' }])

      await service.listFiles('assistant')

      expect(mock.history[0].query).toMatchObject({ purpose: 'assistant' })
    })
  })

  describe('getFile', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/file/file-1`).reply({ id: 'file-1' })

      const result = await service.getFile('file-1')

      expect(result).toEqual({ id: 'file-1' })
    })
  })

  describe('renameFile', () => {
    it('sends PATCH with new name', async () => {
      mock.onPatch(`${BASE}/file/file-1`).reply({ id: 'file-1', name: 'renamed.pdf' })

      await service.renameFile('file-1', 'renamed.pdf')

      expect(mock.history[0].body).toEqual({ name: 'renamed.pdf' })
    })
  })

  describe('deleteFile', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/file/file-1`).reply({ id: 'file-1' })

      const result = await service.deleteFile('file-1')

      expect(result).toEqual({ id: 'file-1' })
    })
  })

  // ── Campaigns ──

  describe('createCampaign', () => {
    it('sends POST with name, assistant, and customers', async () => {
      mock.onPost(`${BASE}/campaign`).reply({ id: 'camp-1', status: 'scheduled' })
      const customers = [{ number: '+14155551234', name: 'Jane' }]

      await service.createCampaign('Q3 Outreach', 'pn-1', customers, 'asst-1')

      expect(mock.history[0].body).toMatchObject({
        name: 'Q3 Outreach',
        phoneNumberId: 'pn-1',
        customers,
        assistantId: 'asst-1',
      })
    })

    it('includes schedulePlan when earliestAt provided', async () => {
      mock.onPost(`${BASE}/campaign`).reply({ id: 'camp-2' })

      await service.createCampaign('Campaign', undefined, undefined, undefined, undefined, undefined, '2026-08-01T10:00:00Z')

      expect(mock.history[0].body).toMatchObject({
        schedulePlan: { earliestAt: '2026-08-01T10:00:00Z' },
      })
    })
  })

  describe('listCampaigns', () => {
    it('sends GET with resolved status and sortOrder', async () => {
      mock.onGet(`${BASE}/campaign`).reply({ results: [], metadata: {} })

      await service.listCampaigns('In Progress', 50, 'Descending')

      expect(mock.history[0].query).toMatchObject({
        status: 'in-progress',
        limit: 50,
        sortOrder: 'DESC',
      })
    })
  })

  describe('getCampaign', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/campaign/camp-1`).reply({ id: 'camp-1' })

      const result = await service.getCampaign('camp-1')

      expect(result).toEqual({ id: 'camp-1' })
    })
  })

  describe('updateCampaign', () => {
    it('sends PATCH with resolved status', async () => {
      mock.onPatch(`${BASE}/campaign/camp-1`).reply({ id: 'camp-1', status: 'ended' })

      await service.updateCampaign('camp-1', 'Ended')

      expect(mock.history[0].body).toMatchObject({ status: 'ended' })
    })

    it('includes schedule plan and name', async () => {
      mock.onPatch(`${BASE}/campaign/camp-1`).reply({ id: 'camp-1' })

      await service.updateCampaign('camp-1', undefined, 'New Name', undefined, undefined, '2026-09-01T00:00:00Z')

      expect(mock.history[0].body).toMatchObject({
        name: 'New Name',
        schedulePlan: { earliestAt: '2026-09-01T00:00:00Z' },
      })
    })
  })

  describe('deleteCampaign', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/campaign/camp-1`).reply({ id: 'camp-1' })

      const result = await service.deleteCampaign('camp-1')

      expect(result).toEqual({ id: 'camp-1' })
    })
  })

  // ── Analytics ──

  describe('runAnalyticsQuery', () => {
    it('sends POST with query wrapped in queries array', async () => {
      mock.onPost(`${BASE}/analytics`).reply([{ name: 'totals', result: [] }])

      const ops = [{ operation: 'count', column: 'id' }]
      await service.runAnalyticsQuery('totals', ops, 'Call')

      expect(mock.history[0].body).toEqual({
        queries: [expect.objectContaining({
          name: 'totals',
          table: 'call',
          operations: ops,
        })],
      })
    })

    it('resolves groupBy and timeRange step', async () => {
      mock.onPost(`${BASE}/analytics`).reply([{ name: 'q1', result: [] }])

      const ops = [{ operation: 'sum', column: 'cost' }]
      await service.runAnalyticsQuery('q1', ops, 'Call', ['Type', 'Assistant ID'], '2026-07-01T00:00:00Z', '2026-07-31T00:00:00Z', 'Day', 'America/New_York')

      expect(mock.history[0].body.queries[0]).toMatchObject({
        groupBy: ['type', 'assistantId'],
        timeRange: {
          start: '2026-07-01T00:00:00Z',
          end: '2026-07-31T00:00:00Z',
          step: 'day',
          timezone: 'America/New_York',
        },
      })
    })
  })

  // ── Dictionaries ──

  describe('getAssistantsDictionary', () => {
    it('returns mapped items with label and value', async () => {
      mock.onGet(`${BASE}/assistant`).reply([
        { id: 'asst-1', name: 'Bot', model: { provider: 'openai', model: 'gpt-4o' }, createdAt: '2026-01-01T00:00:00Z' },
      ])

      const result = await service.getAssistantsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Bot', value: 'asst-1', note: 'openai/gpt-4o' }],
        cursor: null,
      })
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${BASE}/assistant`).reply([
        { id: 'asst-1', name: 'Alpha Bot', createdAt: '2026-01-01T00:00:00Z' },
        { id: 'asst-2', name: 'Beta Bot', createdAt: '2026-01-02T00:00:00Z' },
      ])

      const result = await service.getAssistantsDictionary({ search: 'ALPHA' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('asst-1')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/assistant`).reply([{ id: 'asst-1', name: 'Bot', createdAt: '2026-01-01T00:00:00Z' }])

      const result = await service.getAssistantsDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('returns cursor when page is full', async () => {
      const items = Array.from({ length: 100 }, (_, i) => ({
        id: `asst-${i}`,
        name: `Bot ${i}`,
        createdAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      }))
      mock.onGet(`${BASE}/assistant`).reply(items)

      const result = await service.getAssistantsDictionary({})

      expect(result.cursor).toBe(items[99].createdAt)
    })

    it('uses id as label fallback when name is missing', async () => {
      mock.onGet(`${BASE}/assistant`).reply([{ id: 'asst-no-name', createdAt: '2026-01-01T00:00:00Z' }])

      const result = await service.getAssistantsDictionary({})

      expect(result.items[0].label).toBe('asst-no-name')
    })
  })

  describe('getPhoneNumbersDictionary', () => {
    it('returns items with number and name label', async () => {
      mock.onGet(`${BASE}/phone-number`).reply([
        { id: 'pn-1', number: '+14155551234', name: 'Main Line', provider: 'vapi', createdAt: '2026-01-01T00:00:00Z' },
      ])

      const result = await service.getPhoneNumbersDictionary({})

      expect(result.items[0]).toEqual({
        label: '+14155551234 (Main Line)',
        value: 'pn-1',
        note: 'vapi',
      })
    })

    it('uses number only when name is absent', async () => {
      mock.onGet(`${BASE}/phone-number`).reply([
        { id: 'pn-2', number: '+14155556789', provider: 'twilio', createdAt: '2026-01-01T00:00:00Z' },
      ])

      const result = await service.getPhoneNumbersDictionary({})

      expect(result.items[0].label).toBe('+14155556789')
    })
  })

  describe('getSquadsDictionary', () => {
    it('returns items with member count note', async () => {
      mock.onGet(`${BASE}/squad`).reply([
        { id: 'sq-1', name: 'Team', members: [{ assistantId: 'a' }, { assistantId: 'b' }], createdAt: '2026-01-01T00:00:00Z' },
      ])

      const result = await service.getSquadsDictionary({})

      expect(result.items[0]).toEqual({ label: 'Team', value: 'sq-1', note: '2 members' })
    })
  })

  describe('getToolsDictionary', () => {
    it('uses function.name as label for function tools', async () => {
      mock.onGet(`${BASE}/tool`).reply([
        { id: 'tool-1', type: 'function', function: { name: 'lookup_order' }, createdAt: '2026-01-01T00:00:00Z' },
      ])

      const result = await service.getToolsDictionary({})

      expect(result.items[0]).toEqual({ label: 'lookup_order', value: 'tool-1', note: 'function' })
    })

    it('uses name for non-function tools', async () => {
      mock.onGet(`${BASE}/tool`).reply([
        { id: 'tool-2', type: 'apiRequest', name: 'get_weather', createdAt: '2026-01-01T00:00:00Z' },
      ])

      const result = await service.getToolsDictionary({})

      expect(result.items[0].label).toBe('get_weather')
    })
  })

  describe('getCampaignsDictionary', () => {
    it('returns items with status note', async () => {
      mock.onGet(`${BASE}/campaign`).reply([
        { id: 'camp-1', name: 'Q3 Outreach', status: 'in-progress', createdAt: '2026-01-01T00:00:00Z' },
      ])

      const result = await service.getCampaignsDictionary({})

      expect(result.items[0]).toEqual({ label: 'Q3 Outreach', value: 'camp-1', note: 'in-progress' })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('formats array error messages', async () => {
      mock.onGet(`${BASE}/call/bad`).replyWithError({
        message: 'Validation failed',
        body: { message: ['field1 is required', 'field2 must be a string'] },
      })

      await expect(service.getCall('bad')).rejects.toThrow('Vapi API error: field1 is required; field2 must be a string')
    })

    it('falls back to error.message when body.message is absent', async () => {
      mock.onGet(`${BASE}/call/bad`).replyWithError({ message: 'Network timeout' })

      await expect(service.getCall('bad')).rejects.toThrow('Vapi API error: Network timeout')
    })
  })
})
