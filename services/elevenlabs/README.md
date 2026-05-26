# ElevenLabs FlowRunner Extension

AI-powered voice synthesis and audio processing integration for ElevenLabs. Convert text to natural-sounding speech, generate sound effects, clone and design custom voices, and retrieve audio history — all with file storage and direct download URL support.

## Ideal Use Cases

- Converting article or notification text into audio files for podcasts or voice alerts
- Generating branded voice-overs using a cloned or custom-designed voice
- Creating sound effects from text descriptions for media production pipelines
- Retrieving and archiving audio history items from ElevenLabs to external storage
- Building multilingual audio content pipelines with model selection

## List of Actions

- Add Voice Samples
- Create Voice (Instant Clone)
- Create Voice (Professional)
- Create Voice from Generation
- Delete History Item
- Delete Voice
- Design Voice from Text
- Edit Voice
- Get History
- Get History Item Audio
- Get Models
- Get Models Dictionary
- Get User Info
- Get Voice
- Get Voices
- Get Voices Dictionary
- Speech to Text
- Text to Sound Effects
- Text to Speech

## Agent Ideas

- When a **Google Sheets** "On New Row" trigger fires with a script column, use **ElevenLabs** "Text to Speech" to generate audio and store the returned URL back in the sheet with "Update Cell"
- Use **ElevenLabs** "Design Voice from Text" to prototype a brand voice, then pass the resulting voice ID to "Text to Speech" for bulk audio generation across a content library
- Combine **ElevenLabs** "Speech to Text" with **Brevo** "Send Transactional Email" to transcribe an audio file and email the transcript to stakeholders