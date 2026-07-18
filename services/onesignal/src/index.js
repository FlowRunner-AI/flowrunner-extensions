const logger = {
  info: (...args) => console.log('[OneSignal] info:', ...args),
  debug: (...args) => console.log('[OneSignal] debug:', ...args),
  error: (...args) => console.log('[OneSignal] error:', ...args),
  warn: (...args) => console.log('[OneSignal] warn:', ...args),
}

const API_BASE_URL = 'https://api.onesignal.com'

const DEFAULT_SEGMENT = 'Subscribed Users'
const DEFAULT_ALIAS_LABEL = 'external_id'
const DICTIONARY_PAGE_SIZE = 50

const DELAYED_OPTIONS = {
  'Send Immediately': null,
  'Optimize by Timezone': 'timezone',
  'Optimize by Last Active': 'last-active',
}

const KIND_OPTIONS = {
  'All': null,
  'Dashboard': 0,
  'API': 1,
  'Automated': 3,
}

const PRIORITY_OPTIONS = {
  'Normal': 5,
  'High': 10,
}

const IOS_BADGE_TYPES = {
  'None': 'None',
  'Set To': 'SetTo',
  'Increase': 'Increase',
}

const HISTORY_EVENTS = {
  'Sent': 'sent',
  'Clicked': 'clicked',
}

const SUBSCRIPTION_TYPES = {
  'Email': 'Email',
  'SMS': 'SMS',
  'iOS Push': 'iOSPush',
  'Android Push': 'AndroidPush',
}

const TEMPLATE_CHANNELS = {
  'Push': 'push',
  'Email': 'email',
  'SMS': 'sms',
}

const OUTCOME_TIME_RANGES = {
  'Last Hour': '1h',
  'Last 24 Hours': '1d',
  'Last 30 Days': '1mo',
}

const OUTCOME_ATTRIBUTIONS = {
  'Direct': 'direct',
  'Influenced': 'influenced',
  'Unattributed': 'unattributed',
  'Total': 'total',
}

function clean(obj) {
  if (!obj) {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * @integrationName OneSignal
 * @integrationIcon /icon.png
 */
class OneSignalService {
  constructor(config) {
    this.appId = config.appId
    this.restApiKey = config.restApiKey
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Key ${ this.restApiKey }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = this.#extractErrorMessage(error)

      logger.error(`${ logTag } - request failed: ${ message }`)

      throw new Error(`OneSignal API error: ${ message }`)
    }
  }

  #extractErrorMessage(error) {
    const errors = error.body?.errors

    if (Array.isArray(errors) && errors.length) {
      return errors
        .map(item => (typeof item === 'string' ? item : item.title || JSON.stringify(item)))
        .join('; ')
    }

    return error.body?.message || error.message || 'Unknown error'
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #buildTargeting({ externalIds, segments, filters, targetChannel }) {
    const targeting = { target_channel: targetChannel }

    if (externalIds && externalIds.length) {
      targeting.include_aliases = { external_id: externalIds }
    } else if (filters && filters.length) {
      targeting.filters = filters
    } else {
      targeting.included_segments = segments && segments.length ? segments : [DEFAULT_SEGMENT]
    }

    return targeting
  }

  #userPath(aliasLabel, aliasId) {
    const label = encodeURIComponent(aliasLabel || DEFAULT_ALIAS_LABEL)

    return `${ API_BASE_URL }/apps/${ this.appId }/users/by/${ label }/${ encodeURIComponent(aliasId) }`
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  /**
   * @operationName Send Push Notification
   * @category Messages
   * @description Sends a push notification to your app's subscribers through OneSignal. Targeting priority: if External IDs are provided they are used (via include_aliases); otherwise Filters are used if provided; otherwise Segments are used, defaulting to the built-in "Subscribed Users" segment. Supports scheduling (Send After), intelligent delivery (timezone or last-active optimization), rich media, action buttons, custom data payloads, iOS badge control, Android channels, and throttling. Returns the created message id; a response without an id and with empty errors usually means no subscribers matched the targeting.
   * @route POST /send-push-notification
   *
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notification body text (English). OneSignal delivers it as contents.en."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Notification title (English), delivered as headings.en. If omitted, OneSignal uses your app name on most platforms."}
   * @paramDef {"type":"String","label":"Subtitle","name":"subtitle","description":"Subtitle shown under the title on iOS only."}
   * @paramDef {"type":"Array<String>","label":"Segments","name":"segments","description":"Segment names to target, e.g. [\"Subscribed Users\",\"Engaged Users\"]. Used only when External IDs and Filters are empty. Defaults to [\"Subscribed Users\"]."}
   * @paramDef {"type":"Array<String>","label":"External IDs","name":"externalIds","description":"External user ids to target specific users (sent as include_aliases.external_id). When provided, Segments and Filters are ignored."}
   * @paramDef {"type":"Array<Object>","label":"Filters","name":"filters","description":"Advanced targeting filters, e.g. [{\"field\":\"tag\",\"key\":\"plan\",\"relation\":\"=\",\"value\":\"pro\"}]. Used only when External IDs is empty. See OneSignal filter docs for fields and relations."}
   * @paramDef {"type":"String","label":"Launch URL","name":"url","description":"URL to open when the notification is tapped."}
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","description":"Large image URL, sent as big_picture (Android) and ios_attachments (iOS). Must be a direct, publicly accessible image URL."}
   * @paramDef {"type":"Array<Object>","label":"Buttons","name":"buttons","description":"Action buttons, e.g. [{\"id\":\"like\",\"text\":\"Like\"},{\"id\":\"later\",\"text\":\"Remind Me Later\"}]. Button taps are reported in the notification's click events."}
   * @paramDef {"type":"Object","label":"Data","name":"data","description":"Custom key-value JSON payload delivered silently with the notification for your app to read."}
   * @paramDef {"type":"String","label":"Send After","name":"sendAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Schedules delivery for a future time, e.g. 2026-09-24 14:00:00 GMT-0700. Leave empty to send immediately."}
   * @paramDef {"type":"String","label":"Delivery Optimization","name":"delayedOption","uiComponent":{"type":"DROPDOWN","options":{"values":["Send Immediately","Optimize by Timezone","Optimize by Last Active"]}},"defaultValue":"Send Immediately","description":"Intelligent delivery mode. Optimize by Timezone delivers at Delivery Time Of Day in each user's timezone; Optimize by Last Active delivers at each user's most active time."}
   * @paramDef {"type":"String","label":"Delivery Time Of Day","name":"deliveryTimeOfDay","description":"Local time of day for timezone-optimized delivery, e.g. 9:00AM or 21:45. Used only with Optimize by Timezone."}
   * @paramDef {"type":"Number","label":"Throttle Rate Per Minute","name":"throttleRatePerMinute","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum notifications delivered per minute (paid feature). Set 0 to disable throttling for this message."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["Normal","High"]}},"description":"Android/Chrome delivery priority. High (10) wakes the device and shows immediately; Normal (5) may be batched to save battery."}
   * @paramDef {"type":"String","label":"iOS Badge Type","name":"iosBadgeType","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Set To","Increase"]}},"description":"How to apply iOS Badge Count: None leaves the badge unchanged, Set To sets it to the exact value, Increase adds the value to the current badge."}
   * @paramDef {"type":"Number","label":"iOS Badge Count","name":"iosBadgeCount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Badge value used with iOS Badge Type (exact value for Set To, delta for Increase)."}
   * @paramDef {"type":"String","label":"Android Channel ID","name":"androidChannelId","description":"OneSignal Android notification channel id (UUID) controlling sound, vibration, and importance on Android 8+."}
   *
   * @returns {Object}
   * @sampleResult {"id":"e664a747-324c-406a-bafb-ab51db71c960","external_id":null}
   */
  async sendPushNotification(
    message, title, subtitle, segments, externalIds, filters, url, imageUrl, buttons, data,
    sendAfter, delayedOption, deliveryTimeOfDay, throttleRatePerMinute, priority,
    iosBadgeType, iosBadgeCount, androidChannelId
  ) {
    const logTag = '[sendPushNotification]'

    const body = clean({
      app_id: this.appId,
      ...this.#buildTargeting({ externalIds, segments, filters, targetChannel: 'push' }),
      contents: { en: message },
      headings: title ? { en: title } : null,
      subtitle: subtitle ? { en: subtitle } : null,
      url,
      big_picture: imageUrl,
      ios_attachments: imageUrl ? { id1: imageUrl } : null,
      buttons,
      data,
      send_after: sendAfter,
      delayed_option: this.#resolveChoice(delayedOption, DELAYED_OPTIONS),
      delivery_time_of_day: deliveryTimeOfDay,
      throttle_rate_per_minute: throttleRatePerMinute,
      priority: this.#resolveChoice(priority, PRIORITY_OPTIONS),
      ios_badgeType: this.#resolveChoice(iosBadgeType, IOS_BADGE_TYPES),
      ios_badgeCount: iosBadgeCount,
      android_channel_id: androidChannelId,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/notifications`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Send Email
   * @category Messages
   * @description Sends an email through OneSignal to email subscribers. If External IDs are provided they are targeted via include_aliases; otherwise Segments are used, defaulting to "Subscribed Users" (targeted users must have an email subscription). The body accepts full HTML. From name/address override your app's default email settings when provided. Requires email to be configured for your OneSignal app.
   * @route POST /send-email
   *
   * @paramDef {"type":"String","label":"Subject","name":"emailSubject","required":true,"description":"Email subject line."}
   * @paramDef {"type":"String","label":"Body (HTML)","name":"emailBody","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Email body as HTML. Include an unsubscribe link (e.g. [unsubscribe_url]) for commercial email compliance."}
   * @paramDef {"type":"String","label":"From Name","name":"emailFromName","description":"Sender display name. Defaults to your app's email settings."}
   * @paramDef {"type":"String","label":"From Address","name":"emailFromAddress","description":"Sender email address. Must be authorized in your OneSignal email setup. Defaults to your app's email settings."}
   * @paramDef {"type":"Array<String>","label":"Segments","name":"segments","description":"Segment names to target, e.g. [\"Subscribed Users\"]. Used only when External IDs is empty. Defaults to [\"Subscribed Users\"]."}
   * @paramDef {"type":"Array<String>","label":"External IDs","name":"externalIds","description":"External user ids to target specific users (sent as include_aliases.external_id). When provided, Segments are ignored."}
   *
   * @returns {Object}
   * @sampleResult {"id":"a9f52c9e-6b9a-4b5f-9c3e-2f4d8a1b0c7d","external_id":null}
   */
  async sendEmail(emailSubject, emailBody, emailFromName, emailFromAddress, segments, externalIds) {
    const logTag = '[sendEmail]'

    const body = clean({
      app_id: this.appId,
      ...this.#buildTargeting({ externalIds, segments, targetChannel: 'email' }),
      email_subject: emailSubject,
      email_body: emailBody,
      email_from_name: emailFromName,
      email_from_address: emailFromAddress,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/notifications`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Send SMS
   * @category Messages
   * @description Sends an SMS through OneSignal to SMS subscribers using your configured Twilio integration. If External IDs are provided they are targeted via include_aliases; otherwise Segments are used, defaulting to "Subscribed Users" (targeted users must have an SMS subscription). The From number must be an SMS-capable number from your Twilio account connected to OneSignal.
   * @route POST /send-sms
   *
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"SMS text content (English), delivered as contents.en."}
   * @paramDef {"type":"String","label":"From Number","name":"smsFrom","required":true,"description":"Sending phone number in E.164 format, e.g. +15551234567. Must be an SMS-capable number from the Twilio account connected to OneSignal."}
   * @paramDef {"type":"Array<String>","label":"Segments","name":"segments","description":"Segment names to target, e.g. [\"Subscribed Users\"]. Used only when External IDs is empty. Defaults to [\"Subscribed Users\"]."}
   * @paramDef {"type":"Array<String>","label":"External IDs","name":"externalIds","description":"External user ids to target specific users (sent as include_aliases.external_id). When provided, Segments are ignored."}
   *
   * @returns {Object}
   * @sampleResult {"id":"c2d97a4b-1e3f-4c5d-8a6b-9e0f1a2b3c4d","external_id":null}
   */
  async sendSms(message, smsFrom, segments, externalIds) {
    const logTag = '[sendSms]'

    const body = clean({
      app_id: this.appId,
      ...this.#buildTargeting({ externalIds, segments, targetChannel: 'sms' }),
      sms_from: smsFrom,
      contents: { en: message },
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/notifications`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Send Push with Template
   * @category Messages
   * @description Sends a push notification using a OneSignal template created in the dashboard. The template supplies the message content, media, and styling; this action supplies targeting and optional scheduling. Targeting priority: External IDs (include_aliases) if provided, otherwise Segments (defaulting to "Subscribed Users").
   * @route POST /send-push-with-template
   *
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"OneSignal template id (UUID). Select from your app's templates or paste an id."}
   * @paramDef {"type":"Array<String>","label":"Segments","name":"segments","description":"Segment names to target, e.g. [\"Subscribed Users\"]. Used only when External IDs is empty. Defaults to [\"Subscribed Users\"]."}
   * @paramDef {"type":"Array<String>","label":"External IDs","name":"externalIds","description":"External user ids to target specific users (sent as include_aliases.external_id). When provided, Segments are ignored."}
   * @paramDef {"type":"String","label":"Send After","name":"sendAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Schedules delivery for a future time. Leave empty to send immediately."}
   *
   * @returns {Object}
   * @sampleResult {"id":"f1e2d3c4-b5a6-4789-9abc-def012345678","external_id":null}
   */
  async sendPushWithTemplate(templateId, segments, externalIds, sendAfter) {
    const logTag = '[sendPushWithTemplate]'

    const body = clean({
      app_id: this.appId,
      ...this.#buildTargeting({ externalIds, segments, targetChannel: 'push' }),
      template_id: templateId,
      send_after: sendAfter,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/notifications`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName List Messages
   * @category Messages
   * @description Lists messages (push, email, and SMS) sent or scheduled for your OneSignal app, newest first, with delivery statistics per message. Filter by creation source: Dashboard, API, or Automated. Returns up to 50 messages per page; use Offset with Total Count for pagination. Note: API-sent messages are retained for 30 days; dashboard-sent messages for the app's lifetime.
   * @route GET /list-messages
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of messages to return (1-50). Defaults to 50."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of messages to skip for pagination. Defaults to 0."}
   * @paramDef {"type":"String","label":"Kind","name":"kind","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Dashboard","API","Automated"]}},"defaultValue":"All","description":"Filter by how the message was created: sent from the OneSignal dashboard, sent via the API, or sent by an automated flow."}
   *
   * @returns {Object}
   * @sampleResult {"total_count":2,"offset":0,"limit":50,"notifications":[{"id":"e664a747-324c-406a-bafb-ab51db71c960","headings":{"en":"Sale Ends Tonight"},"contents":{"en":"Save 20% until midnight"},"queued_at":1752764400,"send_after":1752764400,"completed_at":1752768000,"successful":950,"failed":3,"converted":41,"remaining":0}]}
   */
  async listMessages(limit, offset, kind) {
    const logTag = '[listMessages]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/notifications`,
      method: 'get',
      query: {
        app_id: this.appId,
        limit,
        offset,
        kind: this.#resolveChoice(kind, KIND_OPTIONS),
      },
    })
  }

  /**
   * @operationName Get Message
   * @category Messages
   * @description Retrieves a single message by id with its full definition (content, targeting, scheduling) and delivery outcomes: successful, failed, errored, converted, remaining, and per-platform delivery stats. Works for push, email, and SMS messages.
   * @route GET /get-message
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"The OneSignal message id (UUID) returned when the message was sent."}
   *
   * @returns {Object}
   * @sampleResult {"id":"e664a747-324c-406a-bafb-ab51db71c960","app_id":"3beb3078-e0f1-4629-af17-fde833b9f716","headings":{"en":"Sale Ends Tonight"},"contents":{"en":"Save 20% until midnight"},"included_segments":["Subscribed Users"],"successful":950,"failed":3,"converted":41,"remaining":0,"completed_at":1752768000,"platform_delivery_stats":{"android":{"successful":500,"failed":1},"ios":{"successful":450,"failed":2}}}
   */
  async getMessage(messageId) {
    const logTag = '[getMessage]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/notifications/${ encodeURIComponent(messageId) }`,
      method: 'get',
      query: { app_id: this.appId },
    })
  }

  /**
   * @operationName Cancel Scheduled Message
   * @category Messages
   * @description Cancels a scheduled message (one created with Send After or delivery optimization) before delivery begins. Messages that have already started sending cannot be stopped.
   * @route DELETE /cancel-scheduled-message
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"The id (UUID) of the scheduled message to cancel."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async cancelScheduledMessage(messageId) {
    const logTag = '[cancelScheduledMessage]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/notifications/${ encodeURIComponent(messageId) }`,
      method: 'delete',
      query: { app_id: this.appId },
    })

    return response || { success: true }
  }

  /**
   * @operationName Get Message History
   * @category Messages
   * @description Requests a CSV export of the devices a message was sent to or clicked by. This is asynchronous: OneSignal generates the CSV and emails a download link to the provided address; the returned destination_url may take time to become available and expires after a few days. Requires the paid Event Streams / message history feature on your OneSignal plan.
   * @route POST /get-message-history
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"The id (UUID) of the message to export history for."}
   * @paramDef {"type":"String","label":"Event","name":"events","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Sent","Clicked"]}},"defaultValue":"Sent","description":"Which event history to export: devices the message was sent to, or devices that clicked it."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address that receives the CSV download link when the export is ready."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"destination_url":"https://onesignal-notification-history.s3.amazonaws.com/export.csv.gz"}
   */
  async getMessageHistory(messageId, events, email) {
    const logTag = '[getMessageHistory]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/notifications/${ encodeURIComponent(messageId) }/history`,
      method: 'post',
      body: {
        app_id: this.appId,
        events: this.#resolveChoice(events, HISTORY_EVENTS),
        email,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Segments
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Segments
   * @category Segments
   * @description Lists the segments defined for your OneSignal app, including built-in segments like "Subscribed Users". Each entry includes the segment id, name, activity status, and whether it is read-only. Use segment names for message targeting and segment ids for Delete Segment.
   * @route GET /list-segments
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of segments to return per page. Defaults to 300."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of segments to skip for pagination. Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"total_count":2,"offset":0,"limit":300,"segments":[{"id":"7ed2887d-bd24-4a81-8220-4b256a08ab19","name":"Subscribed Users","created_at":"2025-02-14T13:44:32.101Z","updated_at":"2025-02-14T13:44:32.101Z","app_id":"3beb3078-e0f1-4629-af17-fde833b9f716","read_only":false,"is_active":true}]}
   */
  async listSegments(limit, offset) {
    const logTag = '[listSegments]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/apps/${ this.appId }/segments`,
      method: 'get',
      query: { limit, offset },
    })
  }

  /**
   * @operationName Create Segment
   * @category Segments
   * @description Creates a segment for your OneSignal app from filter conditions (tags, session count, last session, location, language, and more). The new segment can immediately be used by name for message targeting. Segment creation via API is available on paid OneSignal plans.
   * @route POST /create-segment
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Segment name, shown in the dashboard and used for message targeting."}
   * @paramDef {"type":"Array<Object>","label":"Filters","name":"filters","required":true,"description":"Filter conditions defining segment membership, e.g. [{\"field\":\"session_count\",\"relation\":\">\",\"value\":\"1\"}]. Combine conditions with {\"operator\":\"OR\"} or {\"operator\":\"AND\"} entries between them."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"7ed2887d-bd24-4a81-8220-4b256a08ab19"}
   */
  async createSegment(name, filters) {
    const logTag = '[createSegment]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/apps/${ this.appId }/segments`,
      method: 'post',
      body: { name, filters },
    })
  }

  /**
   * @operationName Delete Segment
   * @category Segments
   * @description Permanently deletes a segment from your OneSignal app by id. Users in the segment are not affected, only the segment definition is removed. Built-in read-only segments cannot be deleted.
   * @route DELETE /delete-segment
   *
   * @paramDef {"type":"String","label":"Segment","name":"segmentId","required":true,"dictionary":"getSegmentsDictionary","description":"The segment id (UUID) to delete. Select from your app's segments or paste an id."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteSegment(segmentId) {
    const logTag = '[deleteSegment]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/apps/${ this.appId }/segments/${ encodeURIComponent(segmentId) }`,
      method: 'delete',
    })

    return response || { success: true }
  }

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create User
   * @category Users
   * @description Creates a user in OneSignal's user model with an external_id identity, optional properties (tags, language, timezone), and optional channel subscriptions. If a user with the same external_id already exists, OneSignal returns the existing user. Subscriptions created here can immediately receive messages targeted by External ID.
   * @route POST /create-user
   *
   * @paramDef {"type":"String","label":"External ID","name":"externalId","required":true,"description":"Your system's unique id for this user, stored as the external_id alias and used for message targeting."}
   * @paramDef {"type":"Object","label":"Tags","name":"tags","description":"Key-value tags for segmentation and message personalization, e.g. {\"plan\":\"pro\",\"first_name\":\"Ada\"}. Values must be strings."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"ISO 639-1 language code, e.g. en, es, fr."}
   * @paramDef {"type":"String","label":"Timezone ID","name":"timezoneId","description":"IANA timezone id, e.g. America/New_York. Used for timezone-optimized delivery."}
   * @paramDef {"type":"Array<Object>","label":"Subscriptions","name":"subscriptions","description":"Channel subscriptions to create with the user, e.g. [{\"type\":\"Email\",\"token\":\"user@example.com\",\"enabled\":true}]. Types: Email, SMS, iOSPush, AndroidPush, ChromePush, FirefoxPush, SafariPush."}
   *
   * @returns {Object}
   * @sampleResult {"identity":{"external_id":"user-123","onesignal_id":"3a2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"},"properties":{"tags":{"plan":"pro"},"language":"en","timezone_id":"America/New_York"},"subscriptions":[{"id":"b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e","type":"Email","token":"user@example.com","enabled":true}]}
   */
  async createUser(externalId, tags, language, timezoneId, subscriptions) {
    const logTag = '[createUser]'

    const properties = clean({ tags, language, timezone_id: timezoneId })

    const body = clean({
      identity: { external_id: externalId },
      properties: Object.keys(properties).length ? properties : null,
      subscriptions: subscriptions && subscriptions.length ? subscriptions : null,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/apps/${ this.appId }/users`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get User
   * @category Users
   * @description Retrieves a user by alias (external_id by default, or onesignal_id or any custom alias label), returning their full identity map, properties (tags, language, timezone, location, first/last active), and all channel subscriptions with ids, tokens, and enabled state.
   * @route GET /get-user
   *
   * @paramDef {"type":"String","label":"Alias ID","name":"aliasId","required":true,"description":"The alias value identifying the user, e.g. your external user id."}
   * @paramDef {"type":"String","label":"Alias Label","name":"aliasLabel","defaultValue":"external_id","description":"The alias namespace to look the user up by: external_id (default), onesignal_id, or a custom alias label."}
   *
   * @returns {Object}
   * @sampleResult {"identity":{"external_id":"user-123","onesignal_id":"3a2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"},"properties":{"tags":{"plan":"pro"},"language":"en","timezone_id":"America/New_York","first_active":1748736000,"last_active":1752764400},"subscriptions":[{"id":"b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e","type":"Email","token":"user@example.com","enabled":true}]}
   */
  async getUser(aliasId, aliasLabel) {
    const logTag = '[getUser]'

    return await this.#apiRequest({
      logTag,
      url: this.#userPath(aliasLabel, aliasId),
      method: 'get',
    })
  }

  /**
   * @operationName Update User
   * @category Users
   * @description Updates a user's properties by alias. Tags are merged with existing tags (set a tag to an empty string to remove it); language and timezone replace existing values. Deltas can adjust counted properties such as session_count and purchase amount. Only the fields you provide are changed.
   * @route PATCH /update-user
   *
   * @paramDef {"type":"String","label":"Alias ID","name":"aliasId","required":true,"description":"The alias value identifying the user, e.g. your external user id."}
   * @paramDef {"type":"String","label":"Alias Label","name":"aliasLabel","defaultValue":"external_id","description":"The alias namespace to look the user up by: external_id (default), onesignal_id, or a custom alias label."}
   * @paramDef {"type":"Object","label":"Tags","name":"tags","description":"Key-value tags to add or update, e.g. {\"plan\":\"pro\"}. Merged with existing tags; set a tag to \"\" to remove it. Values must be strings."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"ISO 639-1 language code, e.g. en, es, fr."}
   * @paramDef {"type":"String","label":"Timezone ID","name":"timezoneId","description":"IANA timezone id, e.g. America/New_York."}
   * @paramDef {"type":"Object","label":"Deltas","name":"deltas","description":"Incremental updates to counted properties, e.g. {\"session_count\":1,\"purchases\":[{\"sku\":\"plan_pro\",\"amount\":\"9.99\",\"iso\":\"USD\"}]}."}
   *
   * @returns {Object}
   * @sampleResult {"properties":{"tags":{"plan":"pro","last_purchase":"2026-07-01"},"language":"en","timezone_id":"America/New_York"}}
   */
  async updateUser(aliasId, aliasLabel, tags, language, timezoneId, deltas) {
    const logTag = '[updateUser]'

    const properties = clean({ tags, language, timezone_id: timezoneId })

    const body = clean({
      properties: Object.keys(properties).length ? properties : null,
      deltas,
    })

    return await this.#apiRequest({
      logTag,
      url: this.#userPath(aliasLabel, aliasId),
      method: 'patch',
      body,
    })
  }

  /**
   * @operationName Delete User
   * @category Users
   * @description Permanently deletes a user by alias, removing their identity, properties, and all channel subscriptions from OneSignal. This cannot be undone; the user will no longer receive any messages.
   * @route DELETE /delete-user
   *
   * @paramDef {"type":"String","label":"Alias ID","name":"aliasId","required":true,"description":"The alias value identifying the user to delete, e.g. your external user id."}
   * @paramDef {"type":"String","label":"Alias Label","name":"aliasLabel","defaultValue":"external_id","description":"The alias namespace to look the user up by: external_id (default), onesignal_id, or a custom alias label."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteUser(aliasId, aliasLabel) {
    const logTag = '[deleteUser]'

    const response = await this.#apiRequest({
      logTag,
      url: this.#userPath(aliasLabel, aliasId),
      method: 'delete',
    })

    return response || { success: true }
  }

  /**
   * @operationName Create Alias
   * @category Users
   * @description Adds an alias (an alternative identifier such as a CRM id) to an existing user, located by their current alias. Each alias label can hold one value per user, and alias values must be unique within a label across your app. Returns the user's updated identity map.
   * @route PATCH /create-alias
   *
   * @paramDef {"type":"String","label":"Alias ID","name":"aliasId","required":true,"description":"The current alias value identifying the user, e.g. their external user id."}
   * @paramDef {"type":"String","label":"Alias Label","name":"aliasLabel","defaultValue":"external_id","description":"The alias namespace the user is looked up by: external_id (default), onesignal_id, or a custom alias label."}
   * @paramDef {"type":"String","label":"New Alias Label","name":"newAliasLabel","required":true,"description":"The label of the alias to add, e.g. crm_id."}
   * @paramDef {"type":"String","label":"New Alias ID","name":"newAliasId","required":true,"description":"The value of the alias to add, e.g. the user's id in your CRM."}
   *
   * @returns {Object}
   * @sampleResult {"identity":{"external_id":"user-123","crm_id":"crm-889","onesignal_id":"3a2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"}}
   */
  async createAlias(aliasId, aliasLabel, newAliasLabel, newAliasId) {
    const logTag = '[createAlias]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#userPath(aliasLabel, aliasId) }/identity`,
      method: 'patch',
      body: { identity: { [newAliasLabel]: newAliasId } },
    })
  }

  /**
   * @operationName Delete Alias
   * @category Users
   * @description Removes an alias label from a user, located by another of their aliases. The user and their subscriptions are unaffected; only the specified identifier is detached. The onesignal_id alias cannot be deleted.
   * @route DELETE /delete-alias
   *
   * @paramDef {"type":"String","label":"Alias ID","name":"aliasId","required":true,"description":"The current alias value identifying the user, e.g. their external user id."}
   * @paramDef {"type":"String","label":"Alias Label","name":"aliasLabel","defaultValue":"external_id","description":"The alias namespace the user is looked up by: external_id (default), onesignal_id, or a custom alias label."}
   * @paramDef {"type":"String","label":"Alias Label to Delete","name":"aliasLabelToDelete","required":true,"description":"The label of the alias to remove from the user, e.g. crm_id."}
   *
   * @returns {Object}
   * @sampleResult {"identity":{"external_id":"user-123","onesignal_id":"3a2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"}}
   */
  async deleteAlias(aliasId, aliasLabel, aliasLabelToDelete) {
    const logTag = '[deleteAlias]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.#userPath(aliasLabel, aliasId) }/identity/${ encodeURIComponent(aliasLabelToDelete) }`,
      method: 'delete',
    })

    return response || { success: true }
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Subscription
   * @category Subscriptions
   * @description Adds a channel subscription (email address, SMS number, or push token) to an existing user, located by alias. The token format depends on type: an email address for Email, an E.164 phone number for SMS, or a device push token for iOS/Android Push. Push subscriptions are normally created by the OneSignal SDK; use this action primarily for Email and SMS.
   * @route POST /create-subscription
   *
   * @paramDef {"type":"String","label":"Alias ID","name":"aliasId","required":true,"description":"The alias value identifying the user, e.g. their external user id."}
   * @paramDef {"type":"String","label":"Alias Label","name":"aliasLabel","defaultValue":"external_id","description":"The alias namespace the user is looked up by: external_id (default), onesignal_id, or a custom alias label."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Email","SMS","iOS Push","Android Push"]}},"description":"Subscription channel type."}
   * @paramDef {"type":"String","label":"Token","name":"token","required":true,"description":"Channel address: email address for Email, E.164 phone number (e.g. +15551234567) for SMS, or device push token for push types."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"description":"Whether the subscription can receive messages. Defaults to true."}
   *
   * @returns {Object}
   * @sampleResult {"subscription":{"id":"b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e","type":"Email","token":"user@example.com","enabled":true}}
   */
  async createSubscription(aliasId, aliasLabel, type, token, enabled) {
    const logTag = '[createSubscription]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.#userPath(aliasLabel, aliasId) }/subscriptions`,
      method: 'post',
      body: {
        subscription: clean({
          type: this.#resolveChoice(type, SUBSCRIPTION_TYPES),
          token,
          enabled: enabled === undefined ? true : enabled,
        }),
      },
    })

    return response || { success: true }
  }

  /**
   * @operationName Update Subscription
   * @category Subscriptions
   * @description Updates an existing subscription by its subscription id, changing its token (e.g. a new email address or phone number) and/or its enabled state. Disabling a subscription opts it out of messages without deleting it.
   * @route PATCH /update-subscription
   *
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The subscription id (UUID), available from Get User or Create Subscription."}
   * @paramDef {"type":"String","label":"Token","name":"token","description":"New channel address: email address, E.164 phone number, or push token."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","uiComponent":{"type":"TOGGLE"},"description":"Whether the subscription can receive messages. Set false to opt the subscription out."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updateSubscription(subscriptionId, token, enabled) {
    const logTag = '[updateSubscription]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/apps/${ this.appId }/subscriptions/${ encodeURIComponent(subscriptionId) }`,
      method: 'patch',
      body: { subscription: clean({ token, enabled }) },
    })

    return response || { success: true }
  }

  /**
   * @operationName Delete Subscription
   * @category Subscriptions
   * @description Permanently deletes a subscription by its subscription id, removing that channel address from the user. Other subscriptions and the user record are unaffected.
   * @route DELETE /delete-subscription
   *
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The subscription id (UUID) to delete, available from Get User."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteSubscription(subscriptionId) {
    const logTag = '[deleteSubscription]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/apps/${ this.appId }/subscriptions/${ encodeURIComponent(subscriptionId) }`,
      method: 'delete',
    })

    return response || { success: true }
  }

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Templates
   * @category Templates
   * @description Lists message templates created in your OneSignal dashboard, optionally filtered by channel (push, email, or SMS). Returns template ids, names, and timestamps (not full content — use Get Template for that). Up to 50 templates per page; use Offset with Total Count for pagination.
   * @route GET /list-templates
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of templates to return (1-50). Defaults to 50."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of templates to skip for pagination. Defaults to 0."}
   * @paramDef {"type":"String","label":"Channel","name":"channel","uiComponent":{"type":"DROPDOWN","options":{"values":["Push","Email","SMS"]}},"description":"Filter templates by message channel. Leave empty for all channels."}
   *
   * @returns {Object}
   * @sampleResult {"total_count":2,"offset":0,"limit":50,"templates":[{"id":"9d3e1f6a-8c2b-4a5d-b7e9-0f1a2b3c4d5e","name":"Welcome Push","created_at":"2025-11-02T09:15:00.000Z","updated_at":"2026-01-20T16:40:00.000Z"}]}
   */
  async listTemplates(limit, offset, channel) {
    const logTag = '[listTemplates]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/templates`,
      method: 'get',
      query: {
        app_id: this.appId,
        limit,
        offset,
        channel: this.#resolveChoice(channel, TEMPLATE_CHANNELS),
      },
    })
  }

  /**
   * @operationName Get Template
   * @category Templates
   * @description Retrieves a single template by id, including its full content (headings, contents, and channel-specific fields) as configured in the OneSignal dashboard. Use the returned id with Send Push with Template.
   * @route GET /get-template
   *
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"The template id (UUID). Select from your app's templates or paste an id."}
   *
   * @returns {Object}
   * @sampleResult {"id":"9d3e1f6a-8c2b-4a5d-b7e9-0f1a2b3c4d5e","name":"Welcome Push","channel":"push","headings":{"en":"Welcome"},"contents":{"en":"Thanks for joining!"},"created_at":"2025-11-02T09:15:00.000Z","updated_at":"2026-01-20T16:40:00.000Z"}
   */
  async getTemplate(templateId) {
    const logTag = '[getTemplate]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/templates/${ encodeURIComponent(templateId) }`,
      method: 'get',
      query: { app_id: this.appId },
    })
  }

  // ---------------------------------------------------------------------------
  // App
  // ---------------------------------------------------------------------------

  /**
   * @operationName View App Details
   * @category App
   * @description Retrieves your OneSignal app's configuration and audience counts, including total and messageable subscribers. Note: OneSignal restricts parts of this endpoint to the Organization API key; if your REST API key is not authorized, the API's 403 error is surfaced as-is.
   * @route GET /view-app-details
   *
   * @returns {Object}
   * @sampleResult {"id":"3beb3078-e0f1-4629-af17-fde833b9f716","name":"My App","players":15200,"messageable_players":13400,"created_at":"2024-04-01T12:00:00.000Z","updated_at":"2026-06-30T10:00:00.000Z","site_name":"Example","chrome_web_origin":"https://example.com"}
   */
  async viewAppDetails() {
    const logTag = '[viewAppDetails]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/apps/${ this.appId }`,
      method: 'get',
    })
  }

  /**
   * @operationName View Outcomes
   * @category App
   * @description Retrieves aggregated outcome (conversion event) statistics for your app, such as click counts, session duration, or custom outcomes, over a selected time range. Optionally restrict by platform and attribution model. Outcome names use the format seen in the dashboard, e.g. os__click.count or custom names like Purchase.count and Purchase.sum.
   * @route GET /view-outcomes
   *
   * @paramDef {"type":"String","label":"Outcome Names","name":"outcomeNames","required":true,"defaultValue":"os__click.count","description":"Comma-separated outcome names with aggregation suffixes, e.g. os__click.count,os__session_duration.sum,Purchase.count."}
   * @paramDef {"type":"String","label":"Time Range","name":"outcomeTimeRange","uiComponent":{"type":"DROPDOWN","options":{"values":["Last Hour","Last 24 Hours","Last 30 Days"]}},"defaultValue":"Last 24 Hours","description":"Reporting window for the outcome statistics."}
   * @paramDef {"type":"String","label":"Platforms","name":"outcomePlatforms","description":"Comma-separated OneSignal platform ids to include, e.g. 0,1 (0=iOS, 1=Android, 5=Chrome Web, 7=Safari, 8=Firefox). Leave empty for all platforms."}
   * @paramDef {"type":"String","label":"Attribution","name":"outcomeAttribution","uiComponent":{"type":"DROPDOWN","options":{"values":["Direct","Influenced","Unattributed","Total"]}},"description":"Attribution model: Direct (clicked a notification), Influenced (received but not clicked), Unattributed, or Total. Leave empty for the API default."}
   *
   * @returns {Object}
   * @sampleResult {"outcomes":[{"id":"os__click.count","value":150,"aggregation":"count"},{"id":"os__session_duration.sum","value":98452,"aggregation":"sum"}]}
   */
  async viewOutcomes(outcomeNames, outcomeTimeRange, outcomePlatforms, outcomeAttribution) {
    const logTag = '[viewOutcomes]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/apps/${ this.appId }/outcomes`,
      method: 'get',
      query: {
        outcome_names: outcomeNames,
        outcome_time_range: this.#resolveChoice(outcomeTimeRange, OUTCOME_TIME_RANGES),
        outcome_platforms: outcomePlatforms,
        outcome_attribution: this.#resolveChoice(outcomeAttribution, OUTCOME_ATTRIBUTIONS),
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getSegmentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter segments by name (matched within the current page)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) returned by the previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Segments Dictionary
   * @description Lists your app's segments for selection in dependent parameters. The option value is the segment id and the label is the segment name; the note shows activity and read-only status.
   * @route POST /get-segments-dictionary
   * @paramDef {"type":"getSegmentsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Engaged Users","value":"7ed2887d-bd24-4a81-8220-4b256a08ab19","note":"Active"}],"cursor":null}
   */
  async getSegmentsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getSegmentsDictionary]'

    const offset = cursor ? parseInt(cursor, 10) : 0

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/apps/${ this.appId }/segments`,
      method: 'get',
      query: { limit: DICTIONARY_PAGE_SIZE, offset },
    })

    const segments = response.segments || []
    const searchLower = (search || '').toLowerCase()

    const items = segments
      .filter(segment => !searchLower || (segment.name || '').toLowerCase().includes(searchLower))
      .map(segment => ({
        label: segment.name,
        value: segment.id,
        note: [segment.is_active ? 'Active' : 'Inactive', segment.read_only ? 'Read-only' : null]
          .filter(Boolean)
          .join(' - '),
      }))

    return {
      items,
      cursor: segments.length === DICTIONARY_PAGE_SIZE ? String(offset + DICTIONARY_PAGE_SIZE) : null,
    }
  }

  /**
   * @typedef {Object} getTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter templates by name (matched within the current page)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) returned by the previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Templates Dictionary
   * @description Lists your app's message templates for selection in dependent parameters. The option value is the template id and the label is the template name; the note shows the last update date.
   * @route POST /get-templates-dictionary
   * @paramDef {"type":"getTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Welcome Push","value":"9d3e1f6a-8c2b-4a5d-b7e9-0f1a2b3c4d5e","note":"Updated 2026-01-20"}],"cursor":null}
   */
  async getTemplatesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getTemplatesDictionary]'

    const offset = cursor ? parseInt(cursor, 10) : 0

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/templates`,
      method: 'get',
      query: { app_id: this.appId, limit: DICTIONARY_PAGE_SIZE, offset },
    })

    const templates = response.templates || []
    const searchLower = (search || '').toLowerCase()

    const items = templates
      .filter(template => !searchLower || (template.name || '').toLowerCase().includes(searchLower))
      .map(template => ({
        label: template.name,
        value: template.id,
        note: template.updated_at ? `Updated ${ String(template.updated_at).slice(0, 10) }` : undefined,
      }))

    return {
      items,
      cursor: templates.length === DICTIONARY_PAGE_SIZE ? String(offset + DICTIONARY_PAGE_SIZE) : null,
    }
  }
}

Flowrunner.ServerCode.addService(OneSignalService, [
  {
    name: 'appId',
    displayName: 'App ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your OneSignal App ID (UUID). Find it in OneSignal under Settings > Keys & IDs.',
  },
  {
    name: 'restApiKey',
    displayName: 'REST API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your OneSignal REST API key from the same Settings > Keys & IDs page (the app REST API key, not the User Auth Key).',
  },
])
