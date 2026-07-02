# OpenAI FlowRunner Extension

Integrates OpenAI's models into FlowRunner workflows. Moderate text and image content, convert text to speech, transcribe audio to text, and generate web-search-grounded answers with cited sources.

## Ideal Use Cases

- Screening user-generated text and images for policy violations before publishing
- Converting generated or user-submitted text into narrated audio
- Transcribing call recordings, voice memos, or podcast audio into searchable text
- Answering questions with current, cited information pulled from the web
- Building content moderation and voice-enabled automation pipelines

## List of Actions

### Moderation

- Moderate Content

### Audio

- Speech to Text
- Text to Speech

### Web Search

- Web Search

## Agent Ideas

- Use **OpenAI** "Moderate Content" on incoming user submissions, and if flagged, notify moderators via **Slack** "Send Message To Channel" before the content is published
- When a **Gmail** "On New Attachment" trigger fires with a voice memo, use **OpenAI** "Speech to Text" to transcribe it, then save the transcript into **Google Sheets** "Add Row"
- Use **OpenAI** "Web Search" to answer a customer question with current information, then send the response via **Slack** "Send Message To Channel"
- Generate a script with an AI text step, convert it to narrated audio with **OpenAI** "Text to Speech", and upload the resulting file via **Google Drive** "Create File"
