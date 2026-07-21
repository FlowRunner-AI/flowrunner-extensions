'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_TOKEN = 'test-hf-token-abc123'
const ROUTER_BASE = 'https://router.huggingface.co/v1'
const HF_INFERENCE_BASE = 'https://router.huggingface.co/hf-inference/models'
const HUB_BASE = 'https://huggingface.co/api'

describe('HuggingFace Service', () => {
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
  })

  // ── Chat ──

  describe('chatCompletion', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(`${ROUTER_BASE}/chat/completions`).reply({
        choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
        model: 'openai/gpt-oss-120b',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      const result = await service.chatCompletion('Say hello')

      expect(result).toEqual({
        text: 'Hello!',
        model: 'openai/gpt-oss-120b',
        finishReason: 'stop',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
      expect(mock.history[0].body).toEqual({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: 'Say hello' }],
      })
    })

    it('includes system prompt when provided', async () => {
      mock.onPost(`${ROUTER_BASE}/chat/completions`).reply({
        choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
        model: 'openai/gpt-oss-120b',
        usage: null,
      })

      await service.chatCompletion('Hi', undefined, undefined, 'You are helpful')

      expect(mock.history[0].body.messages).toEqual([
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hi' },
      ])
    })

    it('includes all optional parameters when provided', async () => {
      mock.onPost(`${ROUTER_BASE}/chat/completions`).reply({
        choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
        model: 'custom/model',
        usage: null,
      })

      await service.chatCompletion(
        'Generate JSON',
        'custom/model',
        'groq',
        'Be concise',
        0.5,
        100,
        0.9,
        ['END'],
        42,
        true
      )

      const body = mock.history[0].body

      expect(body.model).toBe('custom/model:groq')
      expect(body.temperature).toBe(0.5)
      expect(body.max_tokens).toBe(100)
      expect(body.top_p).toBe(0.9)
      expect(body.stop).toEqual(['END'])
      expect(body.seed).toBe(42)
      expect(body.response_format).toEqual({ type: 'json_object' })
      expect(body.messages).toHaveLength(2)
    })

    it('does not append provider when model already contains colon', async () => {
      mock.onPost(`${ROUTER_BASE}/chat/completions`).reply({
        choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
        model: 'custom/model:together',
        usage: null,
      })

      await service.chatCompletion('Hi', 'custom/model:together', 'groq')

      expect(mock.history[0].body.model).toBe('custom/model:together')
    })

    it('throws when prompt is empty', async () => {
      await expect(service.chatCompletion('')).rejects.toThrow('Prompt is required')
    })

    it('handles missing choices gracefully', async () => {
      mock.onPost(`${ROUTER_BASE}/chat/completions`).reply({
        choices: [],
        model: 'openai/gpt-oss-120b',
      })

      const result = await service.chatCompletion('Hi')

      expect(result.text).toBe('')
      expect(result.finishReason).toBeNull()
    })

    it('throws on API error', async () => {
      mock.onPost(`${ROUTER_BASE}/chat/completions`).replyWithError({
        message: 'Unauthorized',
        body: { error: 'Invalid token' },
      })

      await expect(service.chatCompletion('Hi')).rejects.toThrow('Invalid token')
    })
  })

  describe('chatCompletionAdvanced', () => {
    it('sends correct request with required params only', async () => {
      const messages = [
        { role: 'system', content: 'Be helpful' },
        { role: 'user', content: 'Hello' },
      ]

      mock.onPost(`${ROUTER_BASE}/chat/completions`).reply({
        id: 'chatcmpl-123',
        choices: [{ message: { content: 'Hi!' }, finish_reason: 'stop' }],
      })

      const result = await service.chatCompletionAdvanced(messages)

      expect(result).toHaveProperty('id', 'chatcmpl-123')
      expect(mock.history[0].body).toEqual({
        model: 'openai/gpt-oss-120b',
        messages,
      })
    })

    it('includes all optional parameters', async () => {
      const messages = [{ role: 'user', content: 'Hi' }]
      const tools = [{ type: 'function', function: { name: 'get_weather' } }]
      const responseFormat = { type: 'json_object' }

      mock.onPost(`${ROUTER_BASE}/chat/completions`).reply({ choices: [] })

      await service.chatCompletionAdvanced(
        messages, 'meta-llama/Llama-3.3-70B-Instruct', 'together',
        0.7, 200, 0.95, ['STOP'], 99,
        responseFormat, tools, 'auto', 0.5, 0.3
      )

      const body = mock.history[0].body

      expect(body.model).toBe('meta-llama/Llama-3.3-70B-Instruct:together')
      expect(body.temperature).toBe(0.7)
      expect(body.max_tokens).toBe(200)
      expect(body.top_p).toBe(0.95)
      expect(body.stop).toEqual(['STOP'])
      expect(body.seed).toBe(99)
      expect(body.response_format).toEqual(responseFormat)
      expect(body.tools).toEqual(tools)
      expect(body.tool_choice).toBe('auto')
      expect(body.frequency_penalty).toBe(0.5)
      expect(body.presence_penalty).toBe(0.3)
    })

    it('parses JSON tool_choice string', async () => {
      const messages = [{ role: 'user', content: 'Hi' }]

      mock.onPost(`${ROUTER_BASE}/chat/completions`).reply({ choices: [] })

      await service.chatCompletionAdvanced(
        messages, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, '{"type":"function","function":{"name":"my_tool"}}'
      )

      expect(mock.history[0].body.tool_choice).toEqual({
        type: 'function',
        function: { name: 'my_tool' },
      })
    })

    it('throws when messages array is empty', async () => {
      await expect(service.chatCompletionAdvanced([])).rejects.toThrow(
        'Messages array is required and must not be empty'
      )
    })
  })

  // ── Images ──

  describe('generateImage', () => {
    it('sends correct task request and uploads file', async () => {
      const fakeImageBuffer = Buffer.from('fake-png-data')

      mock.onPost(`${HF_INFERENCE_BASE}/black-forest-labs/FLUX.1-schnell`).reply({
        body: fakeImageBuffer,
        headers: { 'content-type': 'image/png' },
      })

      // Mock the flowrunner.Files.uploadFile
      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.example.com/hf_image.png' }),
        },
      }

      const result = await service.generateImage('A cute cat')

      expect(result).toEqual({
        fileURL: 'https://files.example.com/hf_image.png',
        model: 'black-forest-labs/FLUX.1-schnell',
      })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({ inputs: 'A cute cat' })
    })

    it('includes optional parameters', async () => {
      const fakeImageBuffer = Buffer.from('fake-data')

      mock.onPost(`${HF_INFERENCE_BASE}/custom/model`).reply({
        body: fakeImageBuffer,
        headers: { 'content-type': 'image/jpeg' },
      })

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.example.com/img.jpg' }),
        },
      }

      await service.generateImage('A dog', 'custom/model', 'no blur', 512, 512, 7.5, 30, 42)

      expect(mock.history[0].body).toEqual({
        inputs: 'A dog',
        parameters: {
          negative_prompt: 'no blur',
          width: 512,
          height: 512,
          guidance_scale: 7.5,
          num_inference_steps: 30,
          seed: 42,
        },
      })
    })

    it('throws when prompt is empty', async () => {
      await expect(service.generateImage('')).rejects.toThrow('Prompt is required')
    })
  })

  // ── Audio ──

  describe('transcribeAudio', () => {
    it('downloads file and sends base64 to ASR model', async () => {
      const audioBuffer = Buffer.from('fake-audio')

      // Mock the file download
      mock.onGet('https://example.com/audio.mp3').reply(audioBuffer)

      mock.onPost(`${HF_INFERENCE_BASE}/openai/whisper-large-v3`).reply({
        text: 'Hello world',
        chunks: null,
      })

      const result = await service.transcribeAudio('https://example.com/audio.mp3')

      expect(result).toEqual({ text: 'Hello world', chunks: null })
      expect(mock.history).toHaveLength(2)

      // Second call is the inference request
      expect(mock.history[1].body).toEqual({
        inputs: audioBuffer.toString('base64'),
      })
    })

    it('includes return_timestamps parameter', async () => {
      const audioBuffer = Buffer.from('fake-audio')

      mock.onGet('https://example.com/audio.wav').reply(audioBuffer)
      mock.onPost(`${HF_INFERENCE_BASE}/openai/whisper-large-v3`).reply({
        text: 'Hello',
        chunks: [{ text: 'Hello', timestamp: [0, 1.5] }],
      })

      const result = await service.transcribeAudio('https://example.com/audio.wav', undefined, true)

      expect(result.chunks).toEqual([{ text: 'Hello', timestamp: [0, 1.5] }])
      expect(mock.history[1].body).toEqual({
        inputs: audioBuffer.toString('base64'),
        parameters: { return_timestamps: true },
      })
    })

    it('throws on invalid file URL', async () => {
      await expect(service.transcribeAudio('not-a-url')).rejects.toThrow('Invalid fileUrl')
    })
  })

  // ── Embeddings ──

  describe('createEmbeddings', () => {
    it('sends correct request with required params', async () => {
      const embeddings = [[0.1, 0.2, 0.3]]

      mock.onPost(`${HF_INFERENCE_BASE}/intfloat/multilingual-e5-large-instruct/pipeline/feature-extraction`).reply(embeddings)

      const result = await service.createEmbeddings(['Hello world'])

      expect(result).toEqual({
        embeddings: [[0.1, 0.2, 0.3]],
        count: 1,
        dimensions: 3,
        model: 'intfloat/multilingual-e5-large-instruct',
      })
      expect(mock.history[0].body).toEqual({ inputs: ['Hello world'] })
    })

    it('includes normalize and truncate when provided', async () => {
      mock.onPost(`${HF_INFERENCE_BASE}/intfloat/multilingual-e5-large-instruct/pipeline/feature-extraction`).reply([[0.1]])

      await service.createEmbeddings(['text'], undefined, true, true)

      expect(mock.history[0].body).toEqual({
        inputs: ['text'],
        normalize: true,
        truncate: true,
      })
    })

    it('uses custom model', async () => {
      mock.onPost(`${HF_INFERENCE_BASE}/custom/embed-model/pipeline/feature-extraction`).reply([[0.5]])

      const result = await service.createEmbeddings(['text'], 'custom/embed-model')

      expect(result.model).toBe('custom/embed-model')
    })

    it('throws when texts array is empty', async () => {
      await expect(service.createEmbeddings([])).rejects.toThrow('At least one text is required')
    })
  })

  // ── Text Transformation ──

  describe('summarizeText', () => {
    it('sends correct request and returns summary', async () => {
      mock.onPost(`${HF_INFERENCE_BASE}/facebook/bart-large-cnn`).reply([
        { summary_text: 'This is a summary.' },
      ])

      const result = await service.summarizeText('Long article text here...')

      expect(result).toEqual({ summary: 'This is a summary.' })
      expect(mock.history[0].body).toEqual({ inputs: 'Long article text here...' })
    })

    it('handles non-array response', async () => {
      mock.onPost(`${HF_INFERENCE_BASE}/facebook/bart-large-cnn`).reply({
        summary_text: 'Summary',
      })

      const result = await service.summarizeText('Some text')

      expect(result.summary).toBe('Summary')
    })

    it('throws when text is empty', async () => {
      await expect(service.summarizeText('')).rejects.toThrow('Text is required')
    })
  })

  describe('translateText', () => {
    it('sends correct request with defaults', async () => {
      mock.onPost(`${HF_INFERENCE_BASE}/google-t5/t5-base`).reply([
        { translation_text: 'Hallo Welt' },
      ])

      const result = await service.translateText('Hello world')

      expect(result).toEqual({ translation: 'Hallo Welt' })
      expect(mock.history[0].body).toEqual({ inputs: 'Hello world' })
    })

    it('includes language parameters', async () => {
      mock.onPost(`${HF_INFERENCE_BASE}/facebook/nllb-200-distilled-600M`).reply([
        { translation_text: 'Bonjour' },
      ])

      await service.translateText('Hello', 'facebook/nllb-200-distilled-600M', 'eng_Latn', 'fra_Latn')

      expect(mock.history[0].body).toEqual({
        inputs: 'Hello',
        parameters: {
          src_lang: 'eng_Latn',
          tgt_lang: 'fra_Latn',
        },
      })
    })

    it('throws when text is empty', async () => {
      await expect(service.translateText('  ')).rejects.toThrow('Text is required')
    })
  })

  // ── Text Analysis ──

  describe('classifyText', () => {
    it('sends correct request and returns labels', async () => {
      const labels = [
        { label: 'POSITIVE', score: 0.9987 },
        { label: 'NEGATIVE', score: 0.0013 },
      ]

      mock.onPost(`${HF_INFERENCE_BASE}/distilbert/distilbert-base-uncased-finetuned-sst-2-english`).reply([labels])

      const result = await service.classifyText('I love this!')

      expect(result).toEqual({
        labels,
        topLabel: 'POSITIVE',
        topScore: 0.9987,
      })
    })

    it('includes topK parameter', async () => {
      mock.onPost(`${HF_INFERENCE_BASE}/distilbert/distilbert-base-uncased-finetuned-sst-2-english`).reply([
        [{ label: 'POSITIVE', score: 0.99 }],
      ])

      await service.classifyText('Great', undefined, 1)

      expect(mock.history[0].body).toEqual({
        inputs: 'Great',
        parameters: { top_k: 1 },
      })
    })

    it('throws when text is empty', async () => {
      await expect(service.classifyText('')).rejects.toThrow('Text is required')
    })
  })

  describe('classifyTextZeroShot', () => {
    it('sends correct request with labels/scores response format', async () => {
      mock.onPost(`${HF_INFERENCE_BASE}/facebook/bart-large-mnli`).reply({
        labels: ['refund', 'legal', 'faq'],
        scores: [0.87, 0.09, 0.04],
      })

      const result = await service.classifyTextZeroShot(
        'I want my money back',
        ['refund', 'legal', 'faq']
      )

      expect(result.topLabel).toBe('refund')
      expect(result.topScore).toBe(0.87)
      expect(result.labels).toHaveLength(3)
      expect(result.labels[0]).toEqual({ label: 'refund', score: 0.87 })
    })

    it('includes optional parameters', async () => {
      mock.onPost(`${HF_INFERENCE_BASE}/facebook/bart-large-mnli`).reply({
        labels: ['a'],
        scores: [0.9],
      })

      await service.classifyTextZeroShot('text', ['a', 'b'], undefined, true, 'This is about {}.')

      expect(mock.history[0].body).toEqual({
        inputs: 'text',
        parameters: {
          candidate_labels: ['a', 'b'],
          multi_label: true,
          hypothesis_template: 'This is about {}.',
        },
      })
    })

    it('throws when text is empty', async () => {
      await expect(service.classifyTextZeroShot('', ['a'])).rejects.toThrow('Text is required')
    })

    it('throws when candidate labels are empty', async () => {
      await expect(service.classifyTextZeroShot('text', [])).rejects.toThrow(
        'At least one candidate label is required'
      )
    })
  })

  describe('fillMask', () => {
    it('sends correct request and returns predictions', async () => {
      const predictions = [
        { sequence: 'the capital of france is paris.', score: 0.97, token: 3000, token_str: 'paris' },
      ]

      mock.onPost(`${HF_INFERENCE_BASE}/google-bert/bert-base-uncased`).reply([predictions])

      const result = await service.fillMask('The capital of France is [MASK].')

      expect(result).toEqual({ predictions })
    })

    it('includes topK and targets parameters', async () => {
      mock.onPost(`${HF_INFERENCE_BASE}/google-bert/bert-base-uncased`).reply([[]])

      await service.fillMask('The [MASK] is blue.', undefined, 3, ['sky', 'ocean'])

      expect(mock.history[0].body).toEqual({
        inputs: 'The [MASK] is blue.',
        parameters: {
          top_k: 3,
          targets: ['sky', 'ocean'],
        },
      })
    })

    it('omits targets when empty array', async () => {
      mock.onPost(`${HF_INFERENCE_BASE}/google-bert/bert-base-uncased`).reply([[]])

      await service.fillMask('The [MASK] is blue.', undefined, undefined, [])

      expect(mock.history[0].body).toEqual({ inputs: 'The [MASK] is blue.' })
    })

    it('throws when text is empty', async () => {
      await expect(service.fillMask('')).rejects.toThrow('Text is required')
    })
  })

  describe('answerQuestion', () => {
    it('sends correct request and returns answer', async () => {
      mock.onPost(`${HF_INFERENCE_BASE}/deepset/roberta-base-squad2`).reply({
        answer: 'Paris',
        score: 0.98,
        start: 21,
        end: 26,
      })

      const result = await service.answerQuestion(
        'What is the capital of France?',
        'The capital of France is Paris.'
      )

      expect(result.answer).toBe('Paris')
      expect(result.score).toBe(0.98)
      expect(result.answers).toHaveLength(1)
      expect(mock.history[0].body).toEqual({
        inputs: {
          question: 'What is the capital of France?',
          context: 'The capital of France is Paris.',
        },
      })
    })

    it('includes topK parameter', async () => {
      mock.onPost(`${HF_INFERENCE_BASE}/deepset/roberta-base-squad2`).reply([
        { answer: 'Paris', score: 0.98 },
        { answer: 'Lyon', score: 0.01 },
      ])

      const result = await service.answerQuestion('What city?', 'Paris or Lyon.', undefined, 2)

      expect(result.answers).toHaveLength(2)
      expect(mock.history[0].body).toEqual({
        inputs: { question: 'What city?', context: 'Paris or Lyon.' },
        parameters: { top_k: 2 },
      })
    })

    it('throws when question is empty', async () => {
      await expect(service.answerQuestion('', 'context')).rejects.toThrow('Question is required')
    })

    it('throws when context is empty', async () => {
      await expect(service.answerQuestion('question', '')).rejects.toThrow('Context is required')
    })
  })

  // ── Hub ──

  describe('searchModels', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${HUB_BASE}/models`).reply([
        { id: 'model-1', pipeline_tag: 'text-generation', downloads: 100 },
      ])

      const result = await service.searchModels()

      expect(result.count).toBe(1)
      expect(result.models).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        sort: 'trendingScore',
        direction: -1,
        limit: 20,
      })
    })

    it('resolves choice values for pipelineTag and sortBy', async () => {
      mock.onGet(`${HUB_BASE}/models`).reply([])

      await service.searchModels('llama', 'meta-llama', 'Text Generation', 'hf-inference', 'Downloads', 5)

      expect(mock.history[0].query).toMatchObject({
        search: 'llama',
        author: 'meta-llama',
        pipeline_tag: 'text-generation',
        inference_provider: 'hf-inference',
        sort: 'downloads',
        limit: 5,
      })
    })

    it('handles empty results', async () => {
      mock.onGet(`${HUB_BASE}/models`).reply([])

      const result = await service.searchModels('nonexistent')

      expect(result).toEqual({ count: 0, models: [] })
    })
  })

  describe('getModelInfo', () => {
    it('sends correct GET request', async () => {
      const modelData = {
        id: 'meta-llama/Llama-3.3-70B-Instruct',
        pipeline_tag: 'text-generation',
        downloads: 8000000,
      }

      mock.onGet(`${HUB_BASE}/models/meta-llama/Llama-3.3-70B-Instruct`).reply(modelData)

      const result = await service.getModelInfo('meta-llama/Llama-3.3-70B-Instruct')

      expect(result).toEqual(modelData)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })

    it('throws when modelId is missing', async () => {
      await expect(service.getModelInfo()).rejects.toThrow('Model ID is required')
    })
  })

  describe('searchDatasets', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${HUB_BASE}/datasets`).reply([
        { id: 'stanfordnlp/imdb', downloads: 100 },
      ])

      const result = await service.searchDatasets()

      expect(result.count).toBe(1)
      expect(result.datasets).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        sort: 'trendingScore',
        direction: -1,
        limit: 20,
      })
    })

    it('includes search and author filters', async () => {
      mock.onGet(`${HUB_BASE}/datasets`).reply([])

      await service.searchDatasets('squad', 'rajpurkar', 'Likes', 10)

      expect(mock.history[0].query).toMatchObject({
        search: 'squad',
        author: 'rajpurkar',
        sort: 'likes',
        limit: 10,
      })
    })
  })

  describe('getAccountInfo', () => {
    it('sends correct GET request to whoami-v2', async () => {
      const accountData = { type: 'user', name: 'testuser', email: 'test@example.com' }

      mock.onGet(`${HUB_BASE}/whoami-v2`).reply(accountData)

      const result = await service.getAccountInfo()

      expect(result).toEqual(accountData)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })
  })

  // ── Dictionaries ──

  describe('getChatModelsDictionary', () => {
    it('returns formatted model list', async () => {
      mock.onGet(`${ROUTER_BASE}/models`).reply({
        data: [
          { id: 'openai/gpt-oss-120b', providers: ['groq', 'together', 'cerebras'] },
          { id: 'meta-llama/Llama-3.3-70B-Instruct', providers: ['groq'] },
        ],
      })

      const result = await service.getChatModelsDictionary({})

      expect(result.cursor).toBeNull()
      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toMatchObject({ label: expect.any(String), value: expect.any(String) })
    })

    it('filters by search string', async () => {
      mock.onGet(`${ROUTER_BASE}/models`).reply({
        data: [
          { id: 'openai/gpt-oss-120b', providers: [] },
          { id: 'meta-llama/Llama-3.3-70B-Instruct', providers: [] },
        ],
      })

      const result = await service.getChatModelsDictionary({ search: 'llama' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('meta-llama/Llama-3.3-70B-Instruct')
    })

    it('shows provider count in note', async () => {
      mock.onGet(`${ROUTER_BASE}/models`).reply({
        data: [
          { id: 'model-a', providers: ['groq'] },
          { id: 'model-b', providers: ['groq', 'together'] },
        ],
      })

      const result = await service.getChatModelsDictionary({})

      expect(result.items.find(i => i.value === 'model-a').note).toBe('1 provider')
      expect(result.items.find(i => i.value === 'model-b').note).toBe('2 providers')
    })
  })

  describe('getTextToImageModelsDictionary', () => {
    it('calls hub models dictionary with text-to-image pipeline tag', async () => {
      mock.onGet(`${HUB_BASE}/models`).reply([
        { id: 'black-forest-labs/FLUX.1-schnell', pipeline_tag: 'text-to-image', downloads: 100 },
      ])

      const result = await service.getTextToImageModelsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        pipeline_tag: 'text-to-image',
        inference_provider: 'hf-inference',
      })
    })
  })

  describe('getHubModelsDictionary', () => {
    it('calls hub models dictionary without pipeline tag filter', async () => {
      mock.onGet(`${HUB_BASE}/models`).reply([
        { id: 'some-model', pipeline_tag: 'text-generation', downloads: 50 },
      ])

      const result = await service.getHubModelsDictionary({})

      expect(result.items).toHaveLength(1)
      // No pipeline_tag or inference_provider should be set
      expect(mock.history[0].query).not.toHaveProperty('pipeline_tag')
      expect(mock.history[0].query).not.toHaveProperty('inference_provider')
    })
  })

  describe('getAsrModelsDictionary', () => {
    it('uses automatic-speech-recognition pipeline tag', async () => {
      mock.onGet(`${HUB_BASE}/models`).reply([])

      await service.getAsrModelsDictionary({})

      expect(mock.history[0].query).toMatchObject({
        pipeline_tag: 'automatic-speech-recognition',
      })
    })
  })

  describe('getEmbeddingModelsDictionary', () => {
    it('uses feature-extraction pipeline tag', async () => {
      mock.onGet(`${HUB_BASE}/models`).reply([])

      await service.getEmbeddingModelsDictionary({})

      expect(mock.history[0].query).toMatchObject({
        pipeline_tag: 'feature-extraction',
      })
    })
  })

  // ── Error normalization ──

  describe('error normalization', () => {
    it('extracts error.body.error.message', async () => {
      mock.onGet(`${HUB_BASE}/whoami-v2`).replyWithError({
        message: 'Request failed',
        body: { error: { message: 'Token expired' } },
      })

      await expect(service.getAccountInfo()).rejects.toThrow('Token expired')
    })

    it('extracts error.body.error (string)', async () => {
      mock.onGet(`${HUB_BASE}/whoami-v2`).replyWithError({
        message: 'Request failed',
        body: { error: 'Invalid credentials' },
      })

      await expect(service.getAccountInfo()).rejects.toThrow('Invalid credentials')
    })

    it('extracts error.body.message', async () => {
      mock.onGet(`${HUB_BASE}/whoami-v2`).replyWithError({
        message: 'Request failed',
        body: { message: 'Rate limited' },
      })

      await expect(service.getAccountInfo()).rejects.toThrow('Rate limited')
    })

    it('falls back to original message', async () => {
      mock.onGet(`${HUB_BASE}/whoami-v2`).replyWithError({
        message: 'Network Error',
      })

      await expect(service.getAccountInfo()).rejects.toThrow('Network Error')
    })
  })
})
