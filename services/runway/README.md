# Runway FlowRunner Extension

Runway generates images, video, and audio with state-of-the-art AI models (Gen-4.5, Veo 3/3.1, Aleph 2, Seedance 2, Act-Two, Magnific upscalers, ElevenLabs audio) plus talking avatars, custom voices, knowledge documents, marketing recipes, and published workflows. Authenticated with a Runway API key. Every generation runs as an asynchronous Runway task; actions wait for completion by default and can persist the ephemeral output URLs into FlowRunner file storage for durable links.

## Ideal Use Cases

- Turn text prompts or reference images into finished images, videos, sound effects, speech, or dubbed audio on demand
- Produce marketing assets at scale: localized ad images, product ad/UGC/campaign videos, multi-shot brand videos, product swaps
- Build talking-avatar videos from a script or audio, using preset or cloned custom voices
- Manage a library of custom avatars, voices, and knowledge documents for reuse across generations
- Run published Runway workflows with per-node overrides as part of a larger automation
- Monitor credit balance and usage before kicking off expensive generations

## List of Actions

- **Image Generation** — Generate Image, Upscale Image
- **Video Generation** — Image to Video, Text to Video, Video to Video, Upscale Video, Character Performance
- **Audio Generation** — Generate Sound Effect, Text to Speech, Speech to Speech, Dub Audio, Isolate Voice
- **Avatars** — Generate Avatar Video, List/Create/Get/Update/Delete Avatar, List/Get/Delete Avatar Conversation, Get Avatar Usage
- **Voices** — List/Create/Get/Update/Delete Voice, Preview Voice
- **Knowledge Documents** — List/Create/Get/Update/Delete Document
- **Recipes** — Localize Ad Image, Create Marketing Stock Image, Create Product Ad Video, Create Product Campaign Images, Swap Product in Video, Create Multi-Shot Video, Create Product UGC Video
- **Tasks** — Get Task, Wait for Task, Cancel Task, Save Task Output to Files
- **Files** — Upload File to Runway
- **Workflows** — List/Get/Run Workflow, Get Workflow Invocation
- **Account** — Get Organization Info, Get Credit Usage

## List of Triggers

This service does not define any triggers.

## Authentication

Set the **API Key** config item to a Runway API key from https://dev.runwayml.com. It is sent as a Bearer token with the `X-Runway-Version: 2024-11-06` header against `api.dev.runwayml.com`.

## Notes

- **Asynchronous tasks**: Generation actions create a Runway task. By default each action waits for completion (up to ~9.5 minutes); disable *Wait for Completion* to return the task/invocation id immediately and poll later with **Get Task** / **Wait for Task** / **Get Workflow Invocation**.
- **Ephemeral output URLs**: Runway output URLs expire within 24-48 hours. Enable *Save Output to File Storage* on a generation action, or call **Save Task Output to Files**, to copy results into FlowRunner file storage for durable URLs.
- **Uploads**: **Upload File to Runway** returns a `runway://` URI (valid 24 hours) usable anywhere a media URI is accepted.
- **Realtime avatar sessions** (interactive WebRTC/LiveKit sessions) are not covered, as they require a live client connection. Recorded conversations from those sessions are still readable via List/Get/Delete Avatar Conversation.

## Agent Ideas

- After **Runway** "Generate Avatar Video" (or any generation action) completes, use **Google Drive** "Upload File" to archive the output before Runway's 24-48 hour URLs expire, then **Slack** "Send Message To Channel" to share the durable link with the team.
- Use **Airtable** "Get Records" to pull a batch of product photos and creative briefs, then call **Runway** "Create Product UGC Video" for each row and **Airtable** "Create Record" to log the resulting video URLs back into the campaign table.
- Read prompts from a spreadsheet with **Google Sheets** "Get Rows", generate assets via **Runway** "Generate Image", and post each finished image to **Slack** "Send Message To Channel" for review.
