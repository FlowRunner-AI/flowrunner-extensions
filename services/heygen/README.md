# HeyGen FlowRunner Extension

FlowRunner integration for [HeyGen](https://www.heygen.com), the AI avatar video generation platform. It covers the current HeyGen v3 API surface: avatar, image, and cinematic video generation, Video Agent sessions, photo and digital-twin avatars, voices, lipsync, templates, video translation with proofreading, AI clipping, background removal, HyperFrames renders, asset management, webhook endpoint management, workflows, and account/brand info. Authentication is by HeyGen API key (`x-api-key` header).

## Ideal Use Cases

- Turn text scripts into avatar-narrated videos for marketing, training, product demos, and personalized outreach at scale.
- Localize existing videos into other languages with translation plus human proofreading of the transcript before rendering.
- Generate photo, digital-twin, or prompt-based AI avatars and manage their looks, voices, and brand kits.
- Auto-clip long-form videos, remove backgrounds, and render HyperFrames variations for social distribution.
- Save finished renders straight into FlowRunner file storage and react to completion via HeyGen webhook endpoints.

## List of Actions

- **Videos**: Create Avatar Video, Create Avatar Video and Wait, Create Video from Image, Create Cinematic Avatar Video, Get Video, List Videos, Delete Video, Get Bulk Video Statuses, Create Video Batch, Get Video Batch, Save Video to File Storage
- **Video Agent**: Create Video Agent Session, Get Video Agent Session, List Video Agent Sessions, List Video Agent Session Videos, List Video Agent Styles, Get Video Agent Session Resource, Send Video Agent Message, Stop Video Agent Session
- **Avatars**: Create Photo Avatar, Create Digital Twin Avatar, Create AI Avatar from Prompt, Create Avatar Consent, List Avatar Groups, Get Avatar Group, Delete Avatar Group, List Avatar Looks, Get Avatar Look, Update Avatar Look, Delete Avatar Look
- **Voices & Audio**: List Voices, Get Voice, Design Voice, Clone Voice, Delete Voice, Generate Speech, Search Audio Library
- **Lipsync**: Create Lipsync, Get Lipsync, List Lipsyncs, Update Lipsync, Delete Lipsync, Create Lipsync Batch, Get Lipsync Batch, Get Bulk Lipsync Statuses
- **Templates**: List Templates, Get Template, Generate Video from Template
- **Video Translation**: Create Video Translation, Get Video Translation, List Video Translations, Update Video Translation, Delete Video Translation, List Translation Target Languages, Get Bulk Video Translation Statuses, Create Video Translation Batch, Get Video Translation Batch, Create Proofread Session, Get Proofread Session, Get Proofread SRT URLs, Upload Proofread SRT, Generate Video from Proofread
- **AI Clipping**: Create AI Clipping Job, Get AI Clipping Job, List AI Clipping Jobs, Delete AI Clipping Job
- **Background Removal**: Create Background Removal, Get Background Removal, List Background Removals, Delete Background Removal
- **HyperFrames**: Create HyperFrames Render, Get HyperFrames Render, List HyperFrames Renders, Delete HyperFrames Render
- **Assets**: Upload Asset, Get Asset, Delete Asset, Search Stock Assets, Get Bulk Asset Statuses, Create Direct Upload, Complete Direct Upload, Create Direct Upload Batch, Complete Direct Upload Batch, Get Asset Batch
- **Webhooks**: List Webhook Endpoints, Create Webhook Endpoint, Update Webhook Endpoint, Delete Webhook Endpoint, Rotate Webhook Secret, List Webhook Event Types, List Webhook Events
- **Account & Brand**: Get Current User, List Brand Kits, List Brand Glossaries
- **Workflows**: List Workflows, Execute Workflow, Execute Workflow Graph, Get Workflow Execution

## List of Triggers

This service does not define any triggers. Video, translation, and job generation is asynchronous; poll the corresponding Get/List action (or Create Avatar Video and Wait), or register a HeyGen webhook endpoint via the Webhooks actions to be notified of completion.

## Configuration

- **API Key** (`apiKey`, required) — your HeyGen API key, sent as the `x-api-key` header. Get it from the [HeyGen API settings](https://app.heygen.com/settings/api) page.

## Notes

- Built on HeyGen's current v3 API. HeyGen retires the legacy v1/v2 endpoints on November 1, 2026.
- Streaming/realtime avatar WebSocket endpoints are out of scope for this integration.
- Most generation actions are asynchronous and return an ID immediately. Use the matching Get action to poll status, the bulk-status actions to check many jobs at once, or configure a webhook endpoint for push notifications.
- Save Video to File Storage downloads a completed render and stores it in FlowRunner file storage, returning a URL.

## Agent Ideas

- After a **HeyGen** "Create Avatar Video and Wait" finishes, use **YouTube** "Upload Video" to publish the render directly to a channel, then **Slack** "Send Message To Channel" to share the link with the team.
- When a marketing asset lands in Drive, use **Google Drive** "Download File" to pull a source video, call **HeyGen** "Create Video Translation" and "Generate Video from Proofread" to produce a proofread localized version, then **Google Drive** "Upload File" to file the result.
- Use **HeyGen** "Create AI Clipping Job" and "Get AI Clipping Job" to auto-clip a long recording, then **HeyGen** "Save Video to File Storage" and **Slack** "Send Direct Message" to deliver each clip to the requesting stakeholder.
