# Fireflies.ai FlowRunner Extension

Integrates the Fireflies.ai meeting intelligence platform into FlowRunner workflows. Retrieve meeting transcripts and AI-generated summaries, search past meetings, upload audio/video files for transcription, and invite the Fireflies notetaker bot ("Fred") to live Zoom, Google Meet, or Microsoft Teams calls.

## Ideal Use Cases

- Automatically syncing meeting notes and action items into project management or CRM tools
- Notifying teams in chat channels when a new meeting transcript becomes available
- Extracting structured action items from meetings and creating tasks downstream
- Building searchable archives of past meeting discussions and decisions
- Transcribing pre-recorded audio or video files at scale via URL upload
- Auto-inviting a notetaker bot to scheduled live meetings for hands-free capture

## List of Actions

### Transcripts

- Get Transcript
- List Transcripts
- Search Transcripts

### AI Summary

- Get Transcript Summary

### Uploads

- Add Fred to Live Meeting
- Upload Audio

## List of Triggers

- On New Transcript

## Agent Ideas

- When a **Fireflies.ai** "On New Transcript" trigger fires, call "Get Transcript Summary" to extract the AI overview and action items, then use **Notion** "Create Page" to file the meeting notes into a team workspace.
- When a **Fireflies.ai** "On New Transcript" trigger fires, call "Get Transcript Summary" and use **Asana** "Create Task" for each extracted action item, assigning them based on the meeting participants.
- When a **Google Calendar** "On Event Started" trigger fires for a Zoom/Meet/Teams call, use **Fireflies.ai** "Add Fred to Live Meeting" to send the notetaker bot, then **Slack** "Send Message To Channel" to notify the team that the meeting is being recorded.
