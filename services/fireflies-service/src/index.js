const logger = {
  info: (...args) => console.log('[Fireflies Service] info:', ...args),
  debug: (...args) => console.log('[Fireflies Service] debug:', ...args),
  error: (...args) => console.log('[Fireflies Service] error:', ...args),
  warn: (...args) => console.log('[Fireflies Service] warn:', ...args),
}

const API_BASE_URL = 'https://api.fireflies.ai/graphql'

const TRANSCRIPT_LIST_FIELDS = `
  id
  title
  date
  dateString
  duration
  host_email
  organizer_email
  participants
  meeting_link
  transcript_url
`

const TRANSCRIPT_FULL_FIELDS = `
  id
  title
  date
  dateString
  duration
  host_email
  organizer_email
  participants
  meeting_attendees { displayName email }
  meeting_link
  transcript_url
  audio_url
  video_url
  sentences { index speaker_name speaker_id text raw_text start_time end_time }
  summary {
    overview
    action_items
    keywords
    outline
    shorthand_bullet
    bullet_gist
    topics_discussed
    short_summary
  }
`

const TRANSCRIPT_SUMMARY_FIELDS = `
  id
  title
  date
  dateString
  duration
  host_email
  summary {
    overview
    action_items
    keywords
    outline
    shorthand_bullet
    bullet_gist
    topics_discussed
    short_summary
  }
`

/**
 * @integrationName Fireflies.ai
 * @integrationIcon /logo.png
 * @integrationTriggersScope SINGLE_APP
 */
class FirefliesService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ query, variables, logTag }) {
    try {
      logger.debug(`${ logTag } - GraphQL request`)

      const response = await Flowrunner.Request.post(API_BASE_URL)
        .set({
          Authorization: `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .send({ query, variables })

      if (response.errors && response.errors.length > 0) {
        const message = response.errors[0].message || JSON.stringify(response.errors[0])

        logger.error(`${ logTag } - GraphQL error: ${ message }`)

        throw new Error(`Fireflies API error: ${ message }`)
      }

      return response.data
    } catch (error) {
      if (error.message && error.message.startsWith('Fireflies API error:')) {
        throw error
      }

      const message = error.message && typeof error.message === 'string'
        ? error.message
        : JSON.stringify(error.message)

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Fireflies API error: ${ message }`)
    }
  }

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter users by name or email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Fireflies returns the full user list in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Provides a searchable list of users in the Fireflies workspace for use as a host or participant filter.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering users by name or email."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe","value":"jane@example.com","note":"ID: 6123abc"}],"cursor":null}
   */
  async getUsersDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getUsersDictionary]'

    const { users } = await this.#apiRequest({
      logTag,
      query: 'query { users { user_id email name } }',
    })

    let list = users || []

    if (search) {
      const term = search.toLowerCase()

      list = list.filter(u =>
        (u.name && u.name.toLowerCase().includes(term)) ||
        (u.email && u.email.toLowerCase().includes(term))
      )
    }

    return {
      items: list.map(u => ({
        label: u.name || u.email,
        value: u.email,
        note: `ID: ${ u.user_id }`,
      })),
      cursor: null,
    }
  }

  /**
   * @operationName List Transcripts
   * @description Retrieves a list of meeting transcripts with optional filters by title, date range, host email, and participant email. Returns transcript summary metadata (id, title, date, duration, host, participants, meeting link). Use Get Transcript to fetch the full transcript with sentences and AI summary.
   * @category Transcripts
   * @route POST /list-transcripts
   * @appearanceColor #6E4AFF #9B85FF
   *
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Optional case-insensitive substring filter on transcript titles."}
   * @paramDef {"type":"Number","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional earliest meeting date (UNIX milliseconds). Only transcripts on or after this moment are returned."}
   * @paramDef {"type":"Number","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional latest meeting date (UNIX milliseconds). Only transcripts on or before this moment are returned."}
   * @paramDef {"type":"String","label":"Host Email","name":"hostEmail","dictionary":"getUsersDictionary","description":"Optional email of the meeting host to filter by."}
   * @paramDef {"type":"String","label":"Participant Email","name":"participantEmail","dictionary":"getUsersDictionary","description":"Optional email of a meeting participant to filter by."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of transcripts to return. Defaults to 25, typically up to 50."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"abc123","title":"Weekly Sync","date":1717200000000,"dateString":"2026-06-01T10:00:00.000Z","duration":31.5,"host_email":"jane@example.com","organizer_email":"jane@example.com","participants":["jane@example.com","bob@example.com"],"meeting_link":"https://zoom.us/j/123","transcript_url":"https://app.fireflies.ai/view/abc123"}]
   */
  async listTranscripts(title, fromDate, toDate, hostEmail, participantEmail, limit) {
    const logTag = '[listTranscripts]'

    const variables = {
      title: title || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      host_email: hostEmail || undefined,
      participant_email: participantEmail || undefined,
      limit: limit || 25,
    }

    const { transcripts } = await this.#apiRequest({
      logTag,
      query: `
        query ListTranscripts(
          $title: String
          $fromDate: DateTime
          $toDate: DateTime
          $host_email: String
          $participant_email: String
          $limit: Int
        ) {
          transcripts(
            title: $title
            fromDate: $fromDate
            toDate: $toDate
            host_email: $host_email
            participant_email: $participant_email
            limit: $limit
          ) { ${ TRANSCRIPT_LIST_FIELDS } }
        }
      `,
      variables,
    })

    logger.info(`${ logTag } Returned ${ (transcripts || []).length } transcripts`)

    return transcripts || []
  }

  /**
   * @operationName Get Transcript
   * @description Retrieves the full details of a single meeting transcript by ID, including all sentences with speakers and timestamps, attendees, the AI-generated summary with action items and keywords, and links to the audio/video recording.
   * @category Transcripts
   * @route POST /get-transcript
   * @appearanceColor #6E4AFF #9B85FF
   *
   * @paramDef {"type":"String","label":"Transcript ID","name":"transcriptId","required":true,"description":"The unique ID of the transcript to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abc123","title":"Weekly Sync","date":1717200000000,"duration":31.5,"host_email":"jane@example.com","participants":["jane@example.com","bob@example.com"],"meeting_link":"https://zoom.us/j/123","transcript_url":"https://app.fireflies.ai/view/abc123","audio_url":"https://...","video_url":null,"sentences":[{"index":0,"speaker_name":"Jane","speaker_id":"1","text":"Welcome everyone.","start_time":0,"end_time":1.4}],"summary":{"overview":"Weekly status sync","action_items":"Bob to send the report by Friday","keywords":["status","report"],"outline":"Intro\nUpdates\nNext steps","bullet_gist":"- Statuses reviewed\n- Report due Friday","topics_discussed":["Status","Report"],"short_summary":"Team reviewed weekly status; Bob owes a report by Friday."}}
   */
  async getTranscript(transcriptId) {
    const logTag = '[getTranscript]'

    if (!transcriptId) {
      throw new Error('Transcript ID is required')
    }

    const { transcript } = await this.#apiRequest({
      logTag,
      query: `
        query GetTranscript($id: String!) {
          transcript(id: $id) { ${ TRANSCRIPT_FULL_FIELDS } }
        }
      `,
      variables: { id: transcriptId },
    })

    return transcript
  }

  /**
   * @operationName Search Transcripts
   * @description Searches transcripts by title using a case-insensitive substring match. Useful when you know part of a meeting title but not its exact ID. Returns transcript summary metadata. Note: Fireflies' GraphQL API only filters by title, not full-text content.
   * @category Transcripts
   * @route POST /search-transcripts
   * @appearanceColor #6E4AFF #9B85FF
   *
   * @paramDef {"type":"String","label":"Search Query","name":"searchQuery","required":true,"description":"Substring to match against transcript titles (case-insensitive)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of transcripts to return. Defaults to 25."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"abc123","title":"Weekly Sync","date":1717200000000,"duration":31.5,"host_email":"jane@example.com","participants":["jane@example.com"],"meeting_link":"https://zoom.us/j/123","transcript_url":"https://app.fireflies.ai/view/abc123"}]
   */
  async searchTranscripts(searchQuery, limit) {
    const logTag = '[searchTranscripts]'

    if (!searchQuery) {
      throw new Error('Search query is required')
    }

    const { transcripts } = await this.#apiRequest({
      logTag,
      query: `
        query SearchTranscripts($title: String, $limit: Int) {
          transcripts(title: $title, limit: $limit) { ${ TRANSCRIPT_LIST_FIELDS } }
        }
      `,
      variables: {
        title: searchQuery,
        limit: limit || 25,
      },
    })

    return transcripts || []
  }

  /**
   * @operationName Get Transcript Summary
   * @description Retrieves only the AI-generated summary outputs for a transcript (overview, action items, keywords, outline, bullet gist, topics, short summary) along with basic meeting metadata. Use this when you only need the AI analysis and don't need the full sentence-by-sentence transcript.
   * @category AI Summary
   * @route POST /get-transcript-summary
   * @appearanceColor #6E4AFF #9B85FF
   *
   * @paramDef {"type":"String","label":"Transcript ID","name":"transcriptId","required":true,"description":"The unique ID of the transcript to retrieve the AI summary for."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abc123","title":"Weekly Sync","date":1717200000000,"dateString":"2026-06-01T10:00:00.000Z","duration":31.5,"host_email":"jane@example.com","summary":{"overview":"Weekly status sync","action_items":"Bob to send the report by Friday","keywords":["status","report"],"outline":"Intro\nUpdates\nNext steps","bullet_gist":"- Statuses reviewed\n- Report due Friday","topics_discussed":["Status","Report"],"short_summary":"Team reviewed weekly status; Bob owes a report by Friday."}}
   */
  async getTranscriptSummary(transcriptId) {
    const logTag = '[getTranscriptSummary]'

    if (!transcriptId) {
      throw new Error('Transcript ID is required')
    }

    const { transcript } = await this.#apiRequest({
      logTag,
      query: `
        query GetTranscriptSummary($id: String!) {
          transcript(id: $id) { ${ TRANSCRIPT_SUMMARY_FIELDS } }
        }
      `,
      variables: { id: transcriptId },
    })

    return transcript
  }

  /**
   * @operationName Upload Audio
   * @description Submits an audio/video file URL to Fireflies for transcription. Fireflies fetches the file from the URL and processes it asynchronously; the resulting transcript will appear in your dashboard and via List Transcripts shortly after. Supports common audio and video formats (mp3, mp4, wav, m4a, webm).
   * @category Uploads
   * @route POST /upload-audio
   * @appearanceColor #1465FF #4B8FFF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Audio URL","name":"audioUrl","required":true,"description":"Publicly accessible URL of the audio or video file to transcribe."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Optional title for the resulting meeting/transcript. Defaults to the filename if omitted."}
   * @paramDef {"type":"String","label":"Attendee Emails","name":"attendeeEmails","description":"Optional comma-separated list of attendee emails to associate with the transcript."}
   * @paramDef {"type":"String","label":"Custom Language","name":"customLanguage","description":"Optional language code override (e.g., 'en', 'es', 'fr'). Defaults to Fireflies' auto-detection."}
   * @paramDef {"type":"Boolean","label":"Save Video","name":"saveVideo","uiComponent":{"type":"TOGGLE"},"description":"If true and the source is a video file, Fireflies retains the video alongside the transcript."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"title":"Q2 Planning","message":"Audio uploaded successfully. The transcript will be available shortly."}
   */
  async uploadAudio(audioUrl, title, attendeeEmails, customLanguage, saveVideo) {
    const logTag = '[uploadAudio]'

    if (!audioUrl) {
      throw new Error('Audio URL is required')
    }

    const attendees = attendeeEmails
      ? attendeeEmails.split(',').map(e => ({ email: e.trim() })).filter(a => a.email)
      : undefined

    const { uploadAudio } = await this.#apiRequest({
      logTag,
      query: `
        mutation UploadAudio($input: AudioUploadInput!) {
          uploadAudio(input: $input) { success title message }
        }
      `,
      variables: {
        input: {
          url: audioUrl,
          title: title || undefined,
          attendees,
          custom_language: customLanguage || undefined,
          save_video: saveVideo === true ? true : undefined,
        },
      },
    })

    logger.info(`${ logTag } Upload result: success=${ uploadAudio?.success } title=${ uploadAudio?.title }`)

    return uploadAudio
  }

  /**
   * @operationName Add Fred to Live Meeting
   * @description Invites the Fireflies notetaker bot ("Fred") to join a live meeting on Zoom, Google Meet, or Microsoft Teams. The bot joins the meeting and records/transcribes it. The transcript appears in your Fireflies dashboard after the meeting ends.
   * @category Uploads
   * @route POST /add-to-live-meeting
   * @appearanceColor #1465FF #4B8FFF
   *
   * @paramDef {"type":"String","label":"Meeting Link","name":"meetingLink","required":true,"description":"The URL of the live Zoom, Google Meet, or Microsoft Teams meeting for Fred to join."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Fred is on the way to your meeting."}
   */
  async addToLiveMeeting(meetingLink) {
    const logTag = '[addToLiveMeeting]'

    if (!meetingLink) {
      throw new Error('Meeting link is required')
    }

    const { addToLiveMeeting } = await this.#apiRequest({
      logTag,
      query: `
        mutation AddToLiveMeeting($meeting_link: String!) {
          addToLiveMeeting(meeting_link: $meeting_link) { success message }
        }
      `,
      variables: { meeting_link: meetingLink },
    })

    logger.info(`${ logTag } Result: success=${ addToLiveMeeting?.success }`)

    return addToLiveMeeting
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  /**
   * @operationName On New Transcript
   * @description Triggers when a new meeting transcript becomes available in Fireflies. Optionally filter by host email to only trigger for meetings hosted by a specific user. Polling interval can be customized (minimum 30 seconds).
   * @category Triggers
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-transcript
   * @appearanceColor #6E4AFF #9B85FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Host Email","name":"hostEmail","dictionary":"getUsersDictionary","description":"Optional. If set, only transcripts hosted by this user trigger the flow. Leave empty to receive transcripts for all hosts."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abc123","title":"Weekly Sync","date":1717200000000,"dateString":"2026-06-01T10:00:00.000Z","duration":31.5,"host_email":"jane@example.com","participants":["jane@example.com","bob@example.com"],"meeting_link":"https://zoom.us/j/123","transcript_url":"https://app.fireflies.ai/view/abc123"}
   */
  async onNewTranscript(invocation) {
    const logTag = '[onNewTranscript]'
    const { hostEmail } = invocation.triggerData || {}

    const { transcripts } = await this.#apiRequest({
      logTag,
      query: `
        query ListTranscriptsForTrigger($host_email: String, $limit: Int) {
          transcripts(host_email: $host_email, limit: $limit) { ${ TRANSCRIPT_LIST_FIELDS } }
        }
      `,
      variables: {
        host_email: hostEmail || undefined,
        limit: 25,
      },
    })

    const list = transcripts || []

    if (invocation.learningMode) {
      logger.debug(`${ logTag } learningMode returning latest transcript`)

      return {
        events: list[0] ? [list[0]] : [],
        state: null,
      }
    }

    if (!invocation.state?.ids) {
      logger.debug(`${ logTag } seeding state with ${ list.length } transcript ids`)

      return {
        events: [],
        state: { ids: list.map(t => t.id) },
      }
    }

    const seen = new Set(invocation.state.ids)
    const newOnes = list.filter(t => !seen.has(t.id))

    const mergedIds = [...list.map(t => t.id), ...invocation.state.ids]
    const dedupedIds = [...new Set(mergedIds)].slice(0, 200)

    logger.debug(`${ logTag } emitting ${ newOnes.length } new transcript event(s)`)

    return {
      events: newOnes,
      state: { ids: dedupedIds },
    }
  }
}

Flowrunner.ServerCode.addService(FirefliesService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Fireflies API key. Get it from https://app.fireflies.ai/integrations/custom/fireflies',
  },
])
