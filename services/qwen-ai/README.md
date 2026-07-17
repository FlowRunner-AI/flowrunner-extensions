# Qwen FlowRunner Extension

FlowRunner integration for Qwen — Alibaba Cloud Model Studio (DashScope). Provides text generation with the Qwen model family (qwen-max, qwen-plus, qwen-flash, qwen3 series), vision analysis with Qwen-VL, text embeddings, Wan text-to-image and text-to-video generation, and Qwen speech synthesis (TTS) and recognition (ASR). Authenticates with a region-specific Model Studio API key.

## Ideal Use Cases

- Generate, summarize, translate or classify text and drive agent/function-calling loops with Qwen chat models
- Analyze images — describe scenes, run OCR, compare pictures or reason over charts and documents — with Qwen-VL
- Produce vector embeddings for semantic search and RAG over your own content
- Create marketing images and short videos from text prompts with Wan models
- Convert text to natural multilingual speech and transcribe audio to text within automated flows

## List of Actions

- **Chat** — Chat Completion, Chat Completion (Advanced)
- **Vision** — Analyze Image
- **Embeddings** — Create Embeddings
- **Image Generation** — Generate Image, Create Image Task
- **Video Generation** — Create Video Task
- **Async Tasks** — Get Task Status
- **Audio** — Synthesize Speech, Transcribe Audio
- **Models** — List Models

## List of Triggers

This service does not define any triggers.

## Configuration

- **API Key** — your Model Studio API key. Keys are region-specific: create it in the console matching the selected Region (International: modelstudio.console.alibabacloud.com, China: bailian.console.aliyun.com).
- **Region** — `International` (default, `dashscope-intl.aliyuncs.com`, Singapore) or `China (Beijing)` (`dashscope.aliyuncs.com`).

## Notes

- All calls are non-streaming HTTP. Models that require streaming output (e.g. qwen-omni realtime, realtime ASR/TTS variants, and thinking mode on some Qwen3 hybrid models) are not supported by this runtime — leave Thinking Mode on Default or Disabled if a request is rejected.
- DashScope image/video/audio result URLs expire after 24 hours. **Generate Image** and **Synthesize Speech** run synchronously and automatically persist results to FlowRunner file storage; **Create Image Task** and **Create Video Task** are asynchronous — poll them with **Get Task Status** and download the result URLs promptly.

## Agent Ideas

- Use **Qwen** "Analyze Image" to OCR or describe an uploaded photo, then use **Google Sheets** "Add Row" to log the extracted text alongside its source into a tracking spreadsheet
- Chain **Qwen** "Chat Completion" to draft a script, then "Create Video Task" plus "Get Task Status" to render it, and finally **Dropbox** "Upload File from URL" to archive the finished video
- Use **Qwen** "Synthesize Speech" to turn generated copy into a multilingual voiceover, then **Google Drive** "Upload File" to store the audio and share it with your team
