# Google Meet FlowRunner Extension

Connect a Google account via OAuth2 to create and configure Google Meet meeting spaces and read post-meeting data through the Meet REST API v2. A space is a reusable virtual meeting room with settings for access, moderation, attendance reports, and automatic recording/transcription/smart notes. After a conference, retrieve conference records, participants and their sessions, recordings (Google Drive MP4 destinations), and transcripts — including individual entries and a fully assembled plain-text transcript with resolved speaker names, ready for AI summarization.

## Ideal Use Cases

- Programmatically spin up on-demand Google Meet rooms with auto-recording and auto-transcription enabled, and share the meeting link instantly.
- Pull complete meeting transcripts as clean plain text to feed an AI agent for summaries and action items.
- Build attendance and presence reports from participant join/leave sessions.
- Locate a meeting's recording in Google Drive for archival, sharing, or download.
- Enforce standard access and moderation policies across meeting spaces.

## List of Actions

### Meeting Spaces
- Create Meeting Space
- Get Meeting Space
- Update Meeting Space
- End Active Conference

### Conference Records
- List Conference Records
- Get Conference Record

### Participants
- List Participants
- Get Participant
- List Participant Sessions
- Get Participant Session

### Recordings
- List Recordings
- Get Recording

### Transcripts
- List Transcripts
- Get Transcript
- List Transcript Entries
- Get Transcript Entry
- Get Full Transcript Text

## List of Triggers

This service does not define any triggers.

## Notes

- **Authentication**: OAuth2. Scopes used: `meetings.space.created`, `meetings.space.readonly`, `meetings.space.settings`, plus `userinfo.profile` / `userinfo.email` for connection identity.
- **Creating a space does not schedule or invite**: A space is a reusable room, not a calendar event. To schedule a meeting at a specific time with invitees, create a Google Calendar event with Google Meet conferencing via the Google Calendar service.
- **~30-day retention**: Google automatically deletes conference records and their artifacts (participants, recordings, transcripts) 30 days after the conference ends — older meetings are not retrievable. The generated Drive/Docs files follow normal Drive retention.
- **Automatic artifacts**: Auto recording/transcription/smart notes require compatible Google Workspace editions; smart notes additionally require a Gemini license.

## Agent Ideas

- Use **Google Meet** "Create Meeting Space" (with auto-recording enabled) to open a room, then call **Google Calendar** "Create Event" with Google Meet conferencing to schedule it and invite attendees.
- When a **Google Calendar** "On Event Ended" trigger fires for a Meet, call **Google Meet** "Get Full Transcript Text" and pass it to **Anthropic AI** "Ask Claude" to generate a summary and extract action items.
- After a call, use **Google Meet** "List Recordings" to obtain the Google Drive file ID, then **Google Drive** "Download File" to archive the meeting MP4.
