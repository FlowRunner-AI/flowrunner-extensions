# Deepgram FlowRunner Extension

Deepgram is a Voice AI platform for speech-to-text, text-to-speech, and text intelligence. This extension transcribes pre-recorded audio, generates natural-sounding speech from text, analyzes written text, and manages Deepgram projects, API keys, usage, and billing. Authenticate with a Deepgram API key (sent as the `Authorization: Token` header), created in the Deepgram Console.

## Ideal Use Cases

- Transcribe podcasts, meetings, or call recordings with diarization, summarization, and topic/sentiment detection
- Generate voiceovers or audio prompts from text using Aura voices, saved to FlowRunner file storage
- Summarize and classify written text by topic, intent, and sentiment
- Monitor Deepgram usage and prepaid balances, and provision or revoke API keys programmatically

## List of Actions

### Speech to Text
- Transcribe Audio from URL
- Transcribe Audio File

### Text to Speech
- Convert Text to Speech

### Text Intelligence
- Analyze Text

### Projects
- List Projects
- Get Project

### API Keys
- List API Keys
- Create API Key
- Delete API Key

### Usage
- Get Usage Summary
- Get Usage Breakdown
- List Usage Fields
- List Usage Requests
- Get Usage Request

### Billing
- List Balances
- Get Balance

### Models
- List Models
- Get Model
- List Project Models

## List of Triggers

This service does not define any triggers.

## Notes

- Transcription, speech, and text-analysis actions support an async callback mode: when a Callback URL is provided, Deepgram processes the request asynchronously and returns only a `request_id`, delivering the full result to the callback.
- Convert Text to Speech saves the generated audio to FlowRunner file storage and returns the file URL; text is limited to 2000 characters per request.
- Transcribe Audio File streams a file from FlowRunner file storage directly to Deepgram, so the audio does not need to be publicly accessible.
- Key management, usage, and billing actions require a project ID (from List Projects) and an API key with the appropriate scope.
- Deepgram's Voice Agent API and live/streaming transcription are WebSocket-only and are out of scope for this HTTP extension.

## Agent Ideas

- Use **Google Drive** "Download File" to pull a meeting recording into file storage, then call **Deepgram** "Transcribe Audio File" with diarization and summarization to produce a speaker-labeled transcript with a summary.
- After **Deepgram** "Transcribe Audio from URL" returns a transcript, use **Deepgram** "Analyze Text" for topic and sentiment, then post the results with **Slack** "Send Message To Channel" to alert the team on flagged calls.
- Use **Deepgram** "Analyze Text" to summarize a long article, then save the summary and detected topics into a knowledge base with **Notion** "Create Page".
