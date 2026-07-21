'use strict'

const { createSandbox } = require('../../../service-sandbox')

const OPEN_AI_KEY = 'test-openai-key'
const ANTHROPIC_KEY = 'test-anthropic-key'
const GEMINI_KEY = 'test-gemini-key'
const MISTRAL_KEY = 'test-mistral-key'
const COHERE_KEY = 'test-cohere-key'
const TOGETHER_AI_KEY = 'test-together-key'
const FIREWORKS_AI_KEY = 'test-fireworks-key'
const XAI_KEY = 'test-xai-key'
const HUGGING_FACE_TOKEN = 'test-hf-token'
const MOONSHOT_AI_KEY = 'test-moonshot-key'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions'
const TOGETHER_URL = 'https://api.together.xyz/v1/chat/completions'
const FIREWORKS_URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
const XAI_URL = 'https://api.x.ai/v1/chat/completions'
const COHERE_URL = 'https://api.cohere.com/compatibility/v1/chat/completions'
const HUGGING_FACE_URL = 'https://router.huggingface.co/v1/chat/completions'
const MOONSHOT_URL = 'https://api.moonshot.ai/v1/chat/completions'

const TEST_IMAGE_URL = 'https://example.com/image.jpg'
const TEST_PROMPT = 'Describe this image'

const OPENAI_RESPONSE = {
  choices: [{ message: { content: 'A beautiful landscape' } }],
}

const ANTHROPIC_RESPONSE = {
  content: [{ type: 'text', text: 'A beautiful landscape' }],
}

function geminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${ model }:generateContent`
}

const GEMINI_RESPONSE = {
  candidates: [{ content: { parts: [{ text: 'A beautiful landscape' }] } }],
}

describe('AI Vision Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      openAIAPIKey: OPEN_AI_KEY,
      anthropicAPIKey: ANTHROPIC_KEY,
      googleGeminiAPIKey: GEMINI_KEY,
      mistralAPIKey: MISTRAL_KEY,
      cohereAPIKey: COHERE_KEY,
      togetherAIAPIKey: TOGETHER_AI_KEY,
      fireworksAIAPIKey: FIREWORKS_AI_KEY,
      xaiAPIKey: XAI_KEY,
      huggingFaceToken: HUGGING_FACE_TOKEN,
      moonshotAIAPIKey: MOONSHOT_AI_KEY,
    })
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
      const configItems = sandbox.getConfigItems()

      expect(configItems).toHaveLength(10)

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'openAIAPIKey', required: false, shared: false }),
          expect.objectContaining({ name: 'anthropicAPIKey', required: false, shared: false }),
          expect.objectContaining({ name: 'googleGeminiAPIKey', required: false, shared: false }),
          expect.objectContaining({ name: 'mistralAPIKey', required: false, shared: false }),
          expect.objectContaining({ name: 'cohereAPIKey', required: false, shared: false }),
          expect.objectContaining({ name: 'togetherAIAPIKey', required: false, shared: false }),
          expect.objectContaining({ name: 'fireworksAIAPIKey', required: false, shared: false }),
          expect.objectContaining({ name: 'xaiAPIKey', required: false, shared: false }),
          expect.objectContaining({ name: 'huggingFaceToken', required: false, shared: false }),
          expect.objectContaining({ name: 'moonshotAIAPIKey', required: false, shared: false }),
        ])
      )
    })
  })

  // ── analyzeImage ──

  describe('analyzeImage', () => {
    // -- OpenAI (openai format) --

    it('sends correct request to OpenAI provider', async () => {
      mock.onPost(OPENAI_URL).reply(OPENAI_RESPONSE)

      const result = await service.analyzeImage(
        'OPEN_AI', 'gpt-4.1', [TEST_IMAGE_URL], TEST_PROMPT
      )

      expect(result).toEqual({
        text: 'A beautiful landscape',
        provider: 'OpenAI',
        model: 'gpt-4.1',
      })

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ OPEN_AI_KEY }`,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toEqual({
        model: 'gpt-4.1',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: TEST_PROMPT },
            { type: 'image_url', image_url: { url: TEST_IMAGE_URL } },
          ],
        }],
      })
    })

    it('uses max_completion_tokens for GPT-5 models', async () => {
      mock.onPost(OPENAI_URL).reply(OPENAI_RESPONSE)

      await service.analyzeImage(
        'OPEN_AI', 'gpt-5.6-sol', [TEST_IMAGE_URL], TEST_PROMPT, 1000
      )

      expect(mock.history[0].body).toMatchObject({
        model: 'gpt-5.6-sol',
        max_completion_tokens: 1000,
      })
      expect(mock.history[0].body).not.toHaveProperty('max_tokens')
    })

    it('uses max_tokens for non-GPT-5 OpenAI models', async () => {
      mock.onPost(OPENAI_URL).reply(OPENAI_RESPONSE)

      await service.analyzeImage(
        'OPEN_AI', 'gpt-4.1', [TEST_IMAGE_URL], TEST_PROMPT, 500
      )

      expect(mock.history[0].body).toMatchObject({
        model: 'gpt-4.1',
        max_tokens: 500,
      })
      expect(mock.history[0].body).not.toHaveProperty('max_completion_tokens')
    })

    it('uses max_completion_tokens for o-series models', async () => {
      mock.onPost(OPENAI_URL).reply(OPENAI_RESPONSE)

      await service.analyzeImage(
        'OPEN_AI', 'o1-preview', [TEST_IMAGE_URL], TEST_PROMPT, 800
      )

      expect(mock.history[0].body).toMatchObject({
        max_completion_tokens: 800,
      })
    })

    it('omits maxTokens from body when not provided (OpenAI)', async () => {
      mock.onPost(OPENAI_URL).reply(OPENAI_RESPONSE)

      await service.analyzeImage(
        'OPEN_AI', 'gpt-4.1', [TEST_IMAGE_URL], TEST_PROMPT
      )

      expect(mock.history[0].body).not.toHaveProperty('max_tokens')
      expect(mock.history[0].body).not.toHaveProperty('max_completion_tokens')
    })

    // -- Anthropic format --

    it('sends correct request to Anthropic provider', async () => {
      mock.onPost(ANTHROPIC_URL).reply(ANTHROPIC_RESPONSE)

      const result = await service.analyzeImage(
        'ANTHROPIC', 'claude-haiku-4-5', [TEST_IMAGE_URL], TEST_PROMPT
      )

      expect(result).toEqual({
        text: 'A beautiful landscape',
        provider: 'Anthropic',
        model: 'claude-haiku-4-5',
      })

      expect(mock.history[0].headers).toMatchObject({
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toEqual({
        model: 'claude-haiku-4-5',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: TEST_IMAGE_URL } },
            { type: 'text', text: TEST_PROMPT },
          ],
        }],
      })
    })

    it('disables thinking for claude-sonnet-5', async () => {
      mock.onPost(ANTHROPIC_URL).reply(ANTHROPIC_RESPONSE)

      await service.analyzeImage(
        'ANTHROPIC', 'claude-sonnet-5', [TEST_IMAGE_URL], TEST_PROMPT
      )

      expect(mock.history[0].body).toMatchObject({
        thinking: { type: 'disabled' },
      })
    })

    it('does not disable thinking for other Anthropic models', async () => {
      mock.onPost(ANTHROPIC_URL).reply(ANTHROPIC_RESPONSE)

      await service.analyzeImage(
        'ANTHROPIC', 'claude-haiku-4-5', [TEST_IMAGE_URL], TEST_PROMPT
      )

      expect(mock.history[0].body).not.toHaveProperty('thinking')
    })

    it('uses custom maxTokens for Anthropic', async () => {
      mock.onPost(ANTHROPIC_URL).reply(ANTHROPIC_RESPONSE)

      await service.analyzeImage(
        'ANTHROPIC', 'claude-haiku-4-5', [TEST_IMAGE_URL], TEST_PROMPT, 2000
      )

      expect(mock.history[0].body.max_tokens).toBe(2000)
    })

    it('handles base64 data URI images for Anthropic', async () => {
      const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
      mock.onPost(ANTHROPIC_URL).reply(ANTHROPIC_RESPONSE)

      await service.analyzeImage(
        'ANTHROPIC', 'claude-haiku-4-5', [dataUri], TEST_PROMPT
      )

      expect(mock.history[0].body.messages[0].content[0]).toEqual({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'iVBORw0KGgoAAAANSUhEUg==',
        },
      })
    })

    // -- Google Gemini format --

    it('sends correct request to Google Gemini provider', async () => {
      const model = 'gemini-2.5-flash'
      mock.onPost(geminiUrl(model)).reply(GEMINI_RESPONSE)

      const result = await service.analyzeImage(
        'GOOGLE_GEMINI', model, [TEST_IMAGE_URL], TEST_PROMPT
      )

      expect(result).toEqual({
        text: 'A beautiful landscape',
        provider: 'Google Gemini',
        model,
      })

      expect(mock.history[0].headers).toMatchObject({
        'x-goog-api-key': GEMINI_KEY,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toEqual({
        contents: [{
          parts: [
            { file_data: { file_uri: TEST_IMAGE_URL, mime_type: 'image/jpeg' } },
            { text: TEST_PROMPT },
          ],
        }],
      })
    })

    it('handles base64 data URI images for Gemini', async () => {
      const model = 'gemini-2.5-flash'
      const dataUri = 'data:image/webp;base64,UklGRg=='
      mock.onPost(geminiUrl(model)).reply(GEMINI_RESPONSE)

      await service.analyzeImage(
        'GOOGLE_GEMINI', model, [dataUri], TEST_PROMPT
      )

      expect(mock.history[0].body.contents[0].parts[0]).toEqual({
        inline_data: { mime_type: 'image/webp', data: 'UklGRg==' },
      })
    })

    // -- Mistral (openai format) --

    it('sends correct request to Mistral provider', async () => {
      mock.onPost(MISTRAL_URL).reply(OPENAI_RESPONSE)

      const result = await service.analyzeImage(
        'MISTRAL', 'mistral-large-latest', [TEST_IMAGE_URL], TEST_PROMPT
      )

      expect(result).toEqual({
        text: 'A beautiful landscape',
        provider: 'Mistral',
        model: 'mistral-large-latest',
      })

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ MISTRAL_KEY }`,
      })
    })

    // -- Together AI --

    it('sends correct request to Together AI provider', async () => {
      mock.onPost(TOGETHER_URL).reply(OPENAI_RESPONSE)

      await service.analyzeImage(
        'TOGETHER_AI', 'Qwen/Qwen2.5-VL-72B-Instruct', [TEST_IMAGE_URL], TEST_PROMPT
      )

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ TOGETHER_AI_KEY }`,
      })
    })

    // -- Fireworks AI --

    it('sends correct request to Fireworks AI provider', async () => {
      mock.onPost(FIREWORKS_URL).reply(OPENAI_RESPONSE)

      await service.analyzeImage(
        'FIREWORKS_AI', 'accounts/fireworks/models/qwen3-vl-8b-instruct', [TEST_IMAGE_URL], TEST_PROMPT
      )

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ FIREWORKS_AI_KEY }`,
      })
    })

    // -- xAI --

    it('sends correct request to xAI provider', async () => {
      mock.onPost(XAI_URL).reply(OPENAI_RESPONSE)

      await service.analyzeImage(
        'XAI', 'grok-4.5', [TEST_IMAGE_URL], TEST_PROMPT
      )

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ XAI_KEY }`,
      })
    })

    // -- Moonshot AI --

    it('sends correct request to Moonshot AI provider', async () => {
      mock.onPost(MOONSHOT_URL).reply(OPENAI_RESPONSE)

      await service.analyzeImage(
        'MOONSHOT_AI', 'kimi-latest', [TEST_IMAGE_URL], TEST_PROMPT
      )

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ MOONSHOT_AI_KEY }`,
      })
    })

    // -- Cohere (fetchImagesToBase64) --

    it('fetches images to base64 for Cohere provider', async () => {
      const imageBytes = Buffer.from('fake-image-data')
      mock.onGet(TEST_IMAGE_URL).reply(imageBytes)
      mock.onPost(COHERE_URL).reply(OPENAI_RESPONSE)

      await service.analyzeImage(
        'COHERE', 'command-a-plus-05-2026', [TEST_IMAGE_URL], TEST_PROMPT
      )

      expect(mock.history).toHaveLength(2)
      // First call is GET to fetch image
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(TEST_IMAGE_URL)
      expect(mock.history[0].encoding).toBeNull()
      // Second call is POST to Cohere API with base64 data URI
      expect(mock.history[1].method).toBe('post')
      const postedImageUrl = mock.history[1].body.messages[0].content[1].image_url.url
      expect(postedImageUrl).toMatch(/^data:image\/jpeg;base64,/)
    })

    it('skips fetching for data URIs on Cohere provider', async () => {
      const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
      mock.onPost(COHERE_URL).reply(OPENAI_RESPONSE)

      await service.analyzeImage(
        'COHERE', 'command-a-plus-05-2026', [dataUri], TEST_PROMPT
      )

      // Only the POST call, no GET to fetch image
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body.messages[0].content[1].image_url.url).toBe(dataUri)
    })

    // -- Hugging Face (fetchImagesToBase64) --

    it('fetches images to base64 for Hugging Face provider', async () => {
      const imageBytes = Buffer.from('fake-image-data')
      mock.onGet('https://example.com/photo.png').reply(imageBytes)
      mock.onPost(HUGGING_FACE_URL).reply(OPENAI_RESPONSE)

      await service.analyzeImage(
        'HUGGING_FACE', 'Qwen/Qwen3-VL-8B-Instruct', ['https://example.com/photo.png'], TEST_PROMPT
      )

      expect(mock.history).toHaveLength(2)
      const postedImageUrl = mock.history[1].body.messages[0].content[1].image_url.url
      expect(postedImageUrl).toMatch(/^data:image\/png;base64,/)
    })

    // -- Multiple images --

    it('handles multiple image URLs', async () => {
      const image2 = 'https://example.com/image2.png'
      mock.onPost(OPENAI_URL).reply(OPENAI_RESPONSE)

      await service.analyzeImage(
        'OPEN_AI', 'gpt-4.1', [TEST_IMAGE_URL, image2], TEST_PROMPT
      )

      const content = mock.history[0].body.messages[0].content
      expect(content).toHaveLength(3) // 1 text + 2 images
      expect(content[1].image_url.url).toBe(TEST_IMAGE_URL)
      expect(content[2].image_url.url).toBe(image2)
    })

    // -- String imageUrls normalization --

    it('normalizes a single string imageUrl to array', async () => {
      mock.onPost(OPENAI_URL).reply(OPENAI_RESPONSE)

      await service.analyzeImage(
        'OPEN_AI', 'gpt-4.1', TEST_IMAGE_URL, TEST_PROMPT
      )

      const content = mock.history[0].body.messages[0].content
      expect(content).toHaveLength(2)
      expect(content[1].image_url.url).toBe(TEST_IMAGE_URL)
    })

    // -- Validation errors --

    it('throws when provider is missing', async () => {
      await expect(
        service.analyzeImage(null, 'model', [TEST_IMAGE_URL], TEST_PROMPT)
      ).rejects.toThrow('The "provider" parameter is required')
    })

    it('throws when provider is unknown', async () => {
      await expect(
        service.analyzeImage('INVALID_PROVIDER', 'model', [TEST_IMAGE_URL], TEST_PROMPT)
      ).rejects.toThrow('Unknown vision provider')
    })

    it('throws when imageUrls is empty', async () => {
      await expect(
        service.analyzeImage('OPEN_AI', 'gpt-4.1', [], TEST_PROMPT)
      ).rejects.toThrow('The "imageUrls" parameter is required')
    })

    it('throws when prompt is empty', async () => {
      await expect(
        service.analyzeImage('OPEN_AI', 'gpt-4.1', [TEST_IMAGE_URL], '')
      ).rejects.toThrow('The "prompt" parameter is required')
    })

    it('throws when model is missing', async () => {
      await expect(
        service.analyzeImage('OPEN_AI', null, [TEST_IMAGE_URL], TEST_PROMPT)
      ).rejects.toThrow('The "model" parameter is required')
    })

    it('throws when provider is not configured', async () => {
      // Temporarily replace the service config to simulate an unconfigured provider
      const originalConfig = service.config
      service.config = {}

      await expect(
        service.analyzeImage('OPEN_AI', 'gpt-4.1', [TEST_IMAGE_URL], TEST_PROMPT)
      ).rejects.toThrow('not configured')

      service.config = originalConfig
    })

    // -- API error handling --

    it('throws normalized error on API failure', async () => {
      mock.onPost(OPENAI_URL).replyWithError({
        message: JSON.stringify({ error: { message: 'Rate limit exceeded' } }),
        status: 429,
      })

      await expect(
        service.analyzeImage('OPEN_AI', 'gpt-4.1', [TEST_IMAGE_URL], TEST_PROMPT)
      ).rejects.toThrow('Rate limit reached for OpenAI')
    })

    it('throws normalized error for 401 status', async () => {
      mock.onPost(OPENAI_URL).replyWithError({
        message: 'Unauthorized',
        status: 401,
      })

      await expect(
        service.analyzeImage('OPEN_AI', 'gpt-4.1', [TEST_IMAGE_URL], TEST_PROMPT)
      ).rejects.toThrow('Authentication failed')
    })

    it('throws content policy error when applicable', async () => {
      mock.onPost(OPENAI_URL).replyWithError({
        message: 'Content policy violation: the image was refused',
      })

      await expect(
        service.analyzeImage('OPEN_AI', 'gpt-4.1', [TEST_IMAGE_URL], TEST_PROMPT)
      ).rejects.toThrow('content policy')
    })

    it('trims prompt whitespace', async () => {
      mock.onPost(OPENAI_URL).reply(OPENAI_RESPONSE)

      await service.analyzeImage(
        'OPEN_AI', 'gpt-4.1', [TEST_IMAGE_URL], '  Describe this  '
      )

      expect(mock.history[0].body.messages[0].content[0].text).toBe('Describe this')
    })
  })

  // ── analyzeImageWithStructuredOutput ──

  describe('analyzeImageWithStructuredOutput', () => {
    const structure = {
      type: 'object',
      properties: {
        label: { type: 'string' },
        confidence: { type: 'number' },
      },
    }

    // -- OpenAI (native structured output) --

    it('adds json_schema response_format for OpenAI', async () => {
      mock.onPost(OPENAI_URL).reply({
        choices: [{ message: { content: '{"label":"dog","confidence":0.95}' } }],
      })

      const result = await service.analyzeImageWithStructuredOutput(
        'OPEN_AI', 'gpt-4.1', [TEST_IMAGE_URL], TEST_PROMPT, structure
      )

      expect(result).toEqual({
        result: { label: 'dog', confidence: 0.95 },
        provider: 'OpenAI',
        model: 'gpt-4.1',
      })

      expect(mock.history[0].body.response_format).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'response',
          schema: structure,
        },
      })
    })

    // -- Anthropic (forced tool call) --

    it('adds forced tool call for Anthropic structured output', async () => {
      mock.onPost(ANTHROPIC_URL).reply({
        content: [{
          type: 'tool_use',
          name: 'emit_structured_data',
          input: { label: 'cat', confidence: 0.88 },
        }],
      })

      const result = await service.analyzeImageWithStructuredOutput(
        'ANTHROPIC', 'claude-haiku-4-5', [TEST_IMAGE_URL], TEST_PROMPT, structure
      )

      expect(result).toEqual({
        result: { label: 'cat', confidence: 0.88 },
        provider: 'Anthropic',
        model: 'claude-haiku-4-5',
      })

      expect(mock.history[0].body.tools).toEqual([{
        name: 'emit_structured_data',
        description: expect.any(String),
        input_schema: structure,
      }])
      expect(mock.history[0].body.tool_choice).toEqual({
        type: 'tool',
        name: 'emit_structured_data',
      })
    })

    // -- Gemini (native structured output) --

    it('adds generationConfig for Gemini structured output', async () => {
      const model = 'gemini-2.5-flash'
      mock.onPost(geminiUrl(model)).reply({
        candidates: [{ content: { parts: [{ text: '{"label":"tree","confidence":0.9}' }] } }],
      })

      const result = await service.analyzeImageWithStructuredOutput(
        'GOOGLE_GEMINI', model, [TEST_IMAGE_URL], TEST_PROMPT, structure
      )

      expect(result).toEqual({
        result: { label: 'tree', confidence: 0.9 },
        provider: 'Google Gemini',
        model,
      })

      expect(mock.history[0].body.generationConfig).toEqual({
        responseMimeType: 'application/json',
        responseSchema: structure,
      })
    })

    // -- Fallback (no native structured output, e.g. Together AI) --

    it('appends schema to prompt for providers without native structured output', async () => {
      mock.onPost(TOGETHER_URL).reply({
        choices: [{ message: { content: '{"label":"car","confidence":0.85}' } }],
      })

      const result = await service.analyzeImageWithStructuredOutput(
        'TOGETHER_AI', 'Qwen/Qwen2.5-VL-72B-Instruct', [TEST_IMAGE_URL], TEST_PROMPT, structure
      )

      expect(result).toEqual({
        result: { label: 'car', confidence: 0.85 },
        provider: 'Together AI',
        model: 'Qwen/Qwen2.5-VL-72B-Instruct',
      })

      const sentPrompt = mock.history[0].body.messages[0].content[0].text
      expect(sentPrompt).toContain(TEST_PROMPT)
      expect(sentPrompt).toContain('You must respond with valid JSON matching this schema')
      expect(sentPrompt).toContain('"label"')
      // Should NOT have response_format
      expect(mock.history[0].body).not.toHaveProperty('response_format')
    })

    // -- JSON parsing with markdown fence --

    it('parses JSON wrapped in markdown code fence', async () => {
      mock.onPost(TOGETHER_URL).reply({
        choices: [{ message: { content: '```json\n{"label":"bird","confidence":0.7}\n```' } }],
      })

      const result = await service.analyzeImageWithStructuredOutput(
        'TOGETHER_AI', 'Qwen/Qwen2.5-VL-72B-Instruct', [TEST_IMAGE_URL], TEST_PROMPT, structure
      )

      expect(result.result).toEqual({ label: 'bird', confidence: 0.7 })
    })

    // -- Validation errors --

    it('throws when structure is missing', async () => {
      await expect(
        service.analyzeImageWithStructuredOutput(
          'OPEN_AI', 'gpt-4.1', [TEST_IMAGE_URL], TEST_PROMPT, null
        )
      ).rejects.toThrow('The "structure" parameter is required')
    })

    it('throws when structure is not an object', async () => {
      await expect(
        service.analyzeImageWithStructuredOutput(
          'OPEN_AI', 'gpt-4.1', [TEST_IMAGE_URL], TEST_PROMPT, 'not-an-object'
        )
      ).rejects.toThrow('The "structure" parameter is required')
    })

    it('throws when imageUrls is empty', async () => {
      await expect(
        service.analyzeImageWithStructuredOutput(
          'OPEN_AI', 'gpt-4.1', [], TEST_PROMPT, structure
        )
      ).rejects.toThrow('The "imageUrls" parameter is required')
    })

    it('throws when prompt is missing', async () => {
      await expect(
        service.analyzeImageWithStructuredOutput(
          'OPEN_AI', 'gpt-4.1', [TEST_IMAGE_URL], null, structure
        )
      ).rejects.toThrow('The "prompt" parameter is required')
    })

    it('throws when model returns invalid JSON for non-native providers', async () => {
      mock.onPost(TOGETHER_URL).reply({
        choices: [{ message: { content: 'This is not valid JSON at all' } }],
      })

      await expect(
        service.analyzeImageWithStructuredOutput(
          'TOGETHER_AI', 'Qwen/Qwen2.5-VL-72B-Instruct', [TEST_IMAGE_URL], TEST_PROMPT, structure
        )
      ).rejects.toThrow('Failed to parse structured output')
    })

    it('throws when model returns empty text for structured output', async () => {
      mock.onPost(OPENAI_URL).reply({
        choices: [{ message: { content: '' } }],
      })

      await expect(
        service.analyzeImageWithStructuredOutput(
          'OPEN_AI', 'gpt-4.1', [TEST_IMAGE_URL], TEST_PROMPT, structure
        )
      ).rejects.toThrow('Failed to parse structured output')
    })
  })

  // ── getVisionProvidersDictionary ──

  describe('getVisionProvidersDictionary', () => {
    it('returns all providers', async () => {
      const result = await service.getVisionProvidersDictionary({})

      expect(result.items.length).toBe(10)
      expect(result.items[0]).toMatchObject({
        label: expect.any(String),
        value: expect.any(String),
        note: expect.any(String),
      })
    })

    it('marks configured providers', async () => {
      const result = await service.getVisionProvidersDictionary({})

      const openai = result.items.find(i => i.value === 'OPEN_AI')
      expect(openai.note).toContain('Configured')
    })

    it('marks unconfigured providers', async () => {
      const originalConfig = service.config
      service.config = {}

      const result = await service.getVisionProvidersDictionary({})

      const openai = result.items.find(i => i.value === 'OPEN_AI')
      expect(openai.note).toContain('Not Configured')

      service.config = originalConfig
    })

    it('filters by search string', async () => {
      const result = await service.getVisionProvidersDictionary({ search: 'open' })

      expect(result.items.length).toBe(1)
      expect(result.items[0].value).toBe('OPEN_AI')
    })

    it('returns empty items when search has no match', async () => {
      const result = await service.getVisionProvidersDictionary({ search: 'zzzzz' })

      expect(result.items).toEqual([])
    })

    it('handles null payload', async () => {
      const result = await service.getVisionProvidersDictionary(null)

      expect(result.items.length).toBe(10)
    })
  })

  // ── getVisionProviderModelsDictionary ──

  describe('getVisionProviderModelsDictionary', () => {
    it('returns models for a valid provider', async () => {
      const result = await service.getVisionProviderModelsDictionary({
        criteria: { provider: 'OPEN_AI' },
      })

      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toMatchObject({
        label: expect.any(String),
        value: expect.any(String),
        note: expect.any(String),
      })
    })

    it('returns empty items for unknown provider', async () => {
      const result = await service.getVisionProviderModelsDictionary({
        criteria: { provider: 'UNKNOWN' },
      })

      expect(result.items).toEqual([])
    })

    it('returns empty items when no criteria', async () => {
      const result = await service.getVisionProviderModelsDictionary({})

      expect(result.items).toEqual([])
    })

    it('returns empty items for null payload', async () => {
      const result = await service.getVisionProviderModelsDictionary(null)

      expect(result.items).toEqual([])
    })

    it('filters models by search string', async () => {
      const result = await service.getVisionProviderModelsDictionary({
        search: 'sol',
        criteria: { provider: 'OPEN_AI' },
      })

      expect(result.items.length).toBe(1)
      expect(result.items[0].value).toBe('gpt-5.6-sol')
    })

    it('searches in model descriptions', async () => {
      const result = await service.getVisionProviderModelsDictionary({
        search: 'frontier',
        criteria: { provider: 'OPEN_AI' },
      })

      expect(result.items.length).toBe(1)
      expect(result.items[0].value).toBe('gpt-5.6-sol')
    })

    it('returns Anthropic models correctly', async () => {
      const result = await service.getVisionProviderModelsDictionary({
        criteria: { provider: 'ANTHROPIC' },
      })

      expect(result.items.length).toBe(4)
      const modelIds = result.items.map(i => i.value)
      expect(modelIds).toContain('claude-opus-4-8')
      expect(modelIds).toContain('claude-haiku-4-5')
    })

    it('returns Gemini models correctly', async () => {
      const result = await service.getVisionProviderModelsDictionary({
        criteria: { provider: 'GOOGLE_GEMINI' },
      })

      expect(result.items.length).toBe(4)
      const modelIds = result.items.map(i => i.value)
      expect(modelIds).toContain('gemini-2.5-flash')
    })
  })
})
