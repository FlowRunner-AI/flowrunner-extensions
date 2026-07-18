const logger = {
  info: (...args) => console.log('[Resend] info:', ...args),
  debug: (...args) => console.log('[Resend] debug:', ...args),
  error: (...args) => console.log('[Resend] error:', ...args),
  warn: (...args) => console.log('[Resend] warn:', ...args),
}

const API_BASE_URL = 'https://api.resend.com'

const MAX_RECIPIENTS = 50
const MAX_BATCH_EMAILS = 100

const REGION_MAPPING = {
  'US East (N. Virginia)': 'us-east-1',
  'EU West (Ireland)': 'eu-west-1',
  'South America (Sao Paulo)': 'sa-east-1',
  'Asia Pacific (Tokyo)': 'ap-northeast-1',
}

const TLS_MAPPING = {
  'Enforced': 'enforced',
  'Opportunistic': 'opportunistic',
}

const PERMISSION_MAPPING = {
  'Full Access': 'full_access',
  'Sending Access': 'sending_access',
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

function toArray(value) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  return Array.isArray(value) ? value : [value]
}

/**
 * @typedef {Object} EmailTag
 * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Tag name. ASCII letters, numbers, underscores or dashes only, max 256 characters."}
 * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"Tag value. ASCII letters, numbers, underscores or dashes only, max 256 characters."}
 */

/**
 * @typedef {Object} RemoteAttachment
 * @paramDef {"type":"String","label":"File URL","name":"path","required":true,"description":"Publicly accessible URL of the file to attach. Resend downloads the file when sending."}
 * @paramDef {"type":"String","label":"Filename","name":"filename","required":true,"description":"Name the attachment will have in the received email, including extension, e.g. 'invoice.pdf'."}
 */

/**
 * @typedef {Object} BatchEmail
 * @paramDef {"type":"String","label":"From","name":"from","required":true,"description":"Sender address in 'Name <email@domain.com>' format. The domain must be verified in Resend."}
 * @paramDef {"type":"Array<String>","label":"To","name":"to","required":true,"description":"Recipient email addresses, up to 50."}
 * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Email subject line."}
 * @paramDef {"type":"String","label":"HTML Body","name":"html","description":"HTML version of the message. Provide html and/or text."}
 * @paramDef {"type":"String","label":"Text Body","name":"text","description":"Plain-text version of the message. Provide html and/or text."}
 * @paramDef {"type":"Array<String>","label":"CC","name":"cc","description":"Carbon-copy recipient email addresses."}
 * @paramDef {"type":"Array<String>","label":"BCC","name":"bcc","description":"Blind-carbon-copy recipient email addresses."}
 * @paramDef {"type":"Array<String>","label":"Reply To","name":"reply_to","description":"Reply-to email addresses."}
 * @paramDef {"type":"Object","label":"Headers","name":"headers","description":"Custom email headers as a key/value object, e.g. {\"X-Entity-Ref-ID\":\"123\"}."}
 */

/**
 * @typedef {Object} getDomainsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter domains by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Resend returns all domains in one call, so this is unused but kept for API compatibility."}
 */

/**
 * @typedef {Object} getAudiencesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter audiences by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Resend returns all audiences in one call, so this is unused but kept for API compatibility."}
 */

/**
 * @typedef {Object} getBroadcastsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter broadcasts by name or subject."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Resend returns all broadcasts in one call, so this is unused but kept for API compatibility."}
 */

/**
 * @typedef {Object} getContactsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Audience","name":"audienceId","description":"The audience whose contacts populate the list."}
 */

/**
 * @typedef {Object} getContactsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter contacts by email or name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Resend returns all contacts in one call, so this is unused but kept for API compatibility."}
 * @paramDef {"type":"getContactsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The audience whose contacts to list."}
 */

/**
 * @usesFileStorage
 * @integrationName Resend
 * @integrationIcon /icon.jpeg
 */
class ResendService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Resend API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #extractFileName(url) {
    const pathname = url.split('?')[0].split('#')[0]

    return decodeURIComponent(pathname.split('/').pop() || 'attachment')
  }

  async #downloadBuffer(fileUrl, logTag) {
    if (!fileUrl || !/^https?:\/\//i.test(fileUrl)) {
      throw new Error(`Invalid file URL '${ fileUrl }'. Should start with 'http://' or 'https://'`)
    }

    logger.debug(`${ logTag } - downloading file from: ${ fileUrl }`)

    const rawBytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)

    return Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes)
  }

  // ---------------------------------------------------------------------------
  // Emails
  // ---------------------------------------------------------------------------

  /**
   * @operationName Send Email
   * @category Emails
   * @description Sends a transactional email through Resend. Supports up to 50 recipients, CC/BCC, reply-to addresses, custom headers, tags for analytics, and scheduled delivery via natural language (e.g. 'in 1 hour') or an ISO 8601 timestamp. Attach a FlowRunner file (its bytes are base64-encoded and embedded) and/or remote files by public URL. Total attachment size is limited to 40 MB per email; emails with attachments cannot be scheduled. Provide at least one of HTML Body or Text Body. Returns the ID of the created email.
   * @route POST /send-email
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"From","name":"from","required":true,"description":"Sender address. Use plain 'you@example.com' or friendly 'Your Name <you@example.com>' format. The domain must be verified in Resend."}
   * @paramDef {"type":"Array<String>","label":"To","name":"to","required":true,"description":"Recipient email addresses, up to 50."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Email subject line."}
   * @paramDef {"type":"String","label":"HTML Body","name":"html","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"HTML version of the message. Provide HTML Body and/or Text Body."}
   * @paramDef {"type":"String","label":"Text Body","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain-text version of the message. Provide HTML Body and/or Text Body."}
   * @paramDef {"type":"Array<String>","label":"CC","name":"cc","description":"Carbon-copy recipient email addresses."}
   * @paramDef {"type":"Array<String>","label":"BCC","name":"bcc","description":"Blind-carbon-copy recipient email addresses."}
   * @paramDef {"type":"Array<String>","label":"Reply To","name":"replyTo","description":"Reply-to email addresses."}
   * @paramDef {"type":"Object","label":"Headers","name":"headers","description":"Custom email headers as a key/value object, e.g. {\"X-Entity-Ref-ID\":\"123\"}."}
   * @paramDef {"type":"String","label":"Scheduled At","name":"scheduledAt","description":"When to deliver the email. Accepts natural language like 'in 1 min' or 'tomorrow at 9am', or an ISO 8601 timestamp like '2026-08-05T11:52:01.858Z'. Leave empty to send immediately. Not supported together with attachments."}
   * @paramDef {"type":"Array<EmailTag>","label":"Tags","name":"tags","description":"Key/value tags attached to the email for filtering in the Resend dashboard and webhooks, e.g. [{\"name\":\"category\",\"value\":\"welcome\"}]."}
   * @paramDef {"type":"String","label":"Attachment File","name":"attachmentFile","uiComponent":{"type":"FILE_SELECTOR"},"description":"A FlowRunner file to attach. Its bytes are downloaded, base64-encoded, and embedded in the email. The filename is derived from the file URL."}
   * @paramDef {"type":"Array<RemoteAttachment>","label":"Remote Attachments","name":"remoteAttachments","description":"Files to attach by public URL, each as {\"path\":\"https://...\",\"filename\":\"invoice.pdf\"}. Resend downloads them when sending."}
   *
   * @returns {Object}
   * @sampleResult {"id":"49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"}
   */
  async sendEmail(from, to, subject, html, text, cc, bcc, replyTo, headers, scheduledAt, tags, attachmentFile, remoteAttachments) {
    const logTag = '[sendEmail]'
    const recipients = toArray(to)

    if (!recipients || !recipients.length) {
      throw new Error('At least one recipient is required in To')
    }

    if (recipients.length > MAX_RECIPIENTS) {
      throw new Error(`Resend supports at most ${ MAX_RECIPIENTS } recipients per email, got ${ recipients.length }`)
    }

    if (!html && !text) {
      throw new Error('Provide at least one of HTML Body or Text Body')
    }

    const attachments = []

    if (attachmentFile) {
      const buffer = await this.#downloadBuffer(attachmentFile, logTag)

      attachments.push({
        filename: this.#extractFileName(attachmentFile),
        content: buffer.toString('base64'),
      })
    }

    for (const attachment of remoteAttachments || []) {
      if (!attachment || !attachment.path) {
        throw new Error('Each remote attachment must include a "path" URL')
      }

      attachments.push(clean({ path: attachment.path, filename: attachment.filename }))
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/emails`,
      method: 'post',
      body: clean({
        from,
        to: recipients,
        subject,
        html,
        text,
        cc: toArray(cc),
        bcc: toArray(bcc),
        reply_to: toArray(replyTo),
        headers,
        scheduled_at: scheduledAt,
        tags: tags && tags.length ? tags : undefined,
        attachments: attachments.length ? attachments : undefined,
      }),
    })
  }

  /**
   * @operationName Get Email
   * @category Emails
   * @description Retrieves a single sent or scheduled email by ID, including sender, recipients, subject, HTML/text content, creation time, and the last delivery event (e.g. delivered, bounced, complained).
   * @route GET /get-email
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Email ID","name":"emailId","required":true,"description":"The ID of the email, as returned by Send Email or Send Batch Emails."}
   *
   * @returns {Object}
   * @sampleResult {"object":"email","id":"4ef9a417-02e9-4d39-ad75-9611e0fcc33c","to":["delivered@resend.dev"],"from":"Acme <onboarding@resend.dev>","created_at":"2026-04-03T22:13:42.674981+00:00","subject":"Hello World","html":"<p>Congrats on sending your first email!</p>","text":null,"bcc":[],"cc":[],"reply_to":[],"last_event":"delivered"}
   */
  async getEmail(emailId) {
    const logTag = '[getEmail]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/emails/${ encodeURIComponent(emailId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Email
   * @category Emails
   * @description Updates a scheduled email that has not been sent yet by changing its delivery time. Accepts natural language like 'in 1 hour' or an ISO 8601 timestamp.
   * @route PATCH /update-email
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Email ID","name":"emailId","required":true,"description":"The ID of the scheduled email to update, as returned by Send Email."}
   * @paramDef {"type":"String","label":"Scheduled At","name":"scheduledAt","required":true,"description":"New delivery time. Accepts natural language like 'in 1 min' or an ISO 8601 timestamp like '2026-08-05T11:52:01.858Z'."}
   *
   * @returns {Object}
   * @sampleResult {"object":"email","id":"49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"}
   */
  async updateEmail(emailId, scheduledAt) {
    const logTag = '[updateEmail]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/emails/${ encodeURIComponent(emailId) }`,
      method: 'patch',
      body: { scheduled_at: scheduledAt },
    })
  }

  /**
   * @operationName Cancel Scheduled Email
   * @category Emails
   * @description Cancels a scheduled email so it is never delivered. Only emails scheduled via the Scheduled At option that have not been sent yet can be canceled.
   * @route POST /cancel-scheduled-email
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Email ID","name":"emailId","required":true,"description":"The ID of the scheduled email to cancel, as returned by Send Email."}
   *
   * @returns {Object}
   * @sampleResult {"object":"email","id":"49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"}
   */
  async cancelScheduledEmail(emailId) {
    const logTag = '[cancelScheduledEmail]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/emails/${ encodeURIComponent(emailId) }/cancel`,
      method: 'post',
      body: {},
    })
  }

  /**
   * @operationName Send Batch Emails
   * @category Emails
   * @description Sends up to 100 fully independent emails in a single API call. Each item defines its own sender, recipients, subject, and HTML/text content. Batch sending does not support attachments, tags, or scheduled delivery - use Send Email for those. Returns the IDs of all created emails in order.
   * @route POST /send-batch-emails
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"Array<BatchEmail>","label":"Emails","name":"emails","required":true,"description":"Email payloads to send, up to 100. Each requires from, to, and subject, plus html and/or text, e.g. [{\"from\":\"Acme <hi@acme.com>\",\"to\":[\"a@b.com\"],\"subject\":\"Hi\",\"html\":\"<p>Hello</p>\"}]."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"ae2014de-c168-4c61-8267-70d2662a1ce1"},{"id":"faccb7a5-8a28-4e9a-ac64-8da1cc3bc1cb"}]}
   */
  async sendBatchEmails(emails) {
    const logTag = '[sendBatchEmails]'

    if (!Array.isArray(emails) || !emails.length) {
      throw new Error('Emails must be a non-empty array of email payloads')
    }

    if (emails.length > MAX_BATCH_EMAILS) {
      throw new Error(`Resend supports at most ${ MAX_BATCH_EMAILS } emails per batch, got ${ emails.length }`)
    }

    const payload = emails.map((email, index) => {
      if (!email || !email.from || !email.to || !email.subject) {
        throw new Error(`Batch email at index ${ index } must include from, to, and subject`)
      }

      return clean({ ...email, to: toArray(email.to) })
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/emails/batch`,
      method: 'post',
      body: payload,
    })
  }

  // ---------------------------------------------------------------------------
  // Domains
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Domain
   * @category Domains
   * @description Registers a sending domain in Resend and returns the DNS records (SPF, DKIM, MX) you must add at your DNS provider before the domain can be verified. Choose the region closest to your users for fastest delivery.
   * @route POST /create-domain
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Domain Name","name":"name","required":true,"description":"The domain to register for sending, e.g. 'example.com' or 'mail.example.com'."}
   * @paramDef {"type":"String","label":"Region","name":"region","uiComponent":{"type":"DROPDOWN","options":{"values":["US East (N. Virginia)","EU West (Ireland)","South America (Sao Paulo)","Asia Pacific (Tokyo)"]}},"defaultValue":"US East (N. Virginia)","description":"Region emails from this domain are sent from. Defaults to US East (N. Virginia)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"4dd369bc-aa82-4ff3-97de-514ae3000ee0","name":"example.com","created_at":"2026-03-28T17:12:02.059593+00:00","status":"not_started","records":[{"record":"SPF","name":"send","type":"MX","ttl":"Auto","status":"not_started","value":"feedback-smtp.us-east-1.amazonses.com","priority":10}],"region":"us-east-1"}
   */
  async createDomain(name, region) {
    const logTag = '[createDomain]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/domains`,
      method: 'post',
      body: clean({
        name,
        region: this.#resolveChoice(region, REGION_MAPPING),
      }),
    })
  }

  /**
   * @operationName List Domains
   * @category Domains
   * @description Lists all sending domains in your Resend account with their verification status, region, and creation time.
   * @route GET /list-domains
   * @appearanceColor #000000 #404040
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"d91cd9bd-1176-453e-8fc1-35364d380206","name":"example.com","status":"verified","created_at":"2026-04-26T20:21:26.347412+00:00","region":"us-east-1"}]}
   */
  async listDomains() {
    const logTag = '[listDomains]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/domains`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Domain
   * @category Domains
   * @description Retrieves a single sending domain by ID, including its verification status, region, and the DNS records (with per-record status) you need to configure at your DNS provider.
   * @route GET /get-domain
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Domain","name":"domainId","required":true,"dictionary":"getDomainsDictionary","description":"The domain to fetch. Select one or paste a domain ID."}
   *
   * @returns {Object}
   * @sampleResult {"object":"domain","id":"d91cd9bd-1176-453e-8fc1-35364d380206","name":"example.com","status":"not_started","created_at":"2026-04-26T20:21:26.347412+00:00","region":"us-east-1","records":[{"record":"SPF","name":"send","type":"MX","ttl":"Auto","status":"not_started","value":"feedback-smtp.us-east-1.amazonses.com","priority":10}]}
   */
  async getDomain(domainId) {
    const logTag = '[getDomain]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/domains/${ encodeURIComponent(domainId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Verify Domain
   * @category Domains
   * @description Triggers DNS verification for a domain after you have added the required SPF, DKIM, and MX records at your DNS provider. Verification runs asynchronously - check the domain status with Get Domain afterwards.
   * @route POST /verify-domain
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Domain","name":"domainId","required":true,"dictionary":"getDomainsDictionary","description":"The domain to verify. Select one or paste a domain ID."}
   *
   * @returns {Object}
   * @sampleResult {"object":"domain","id":"d91cd9bd-1176-453e-8fc1-35364d380206"}
   */
  async verifyDomain(domainId) {
    const logTag = '[verifyDomain]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/domains/${ encodeURIComponent(domainId) }/verify`,
      method: 'post',
      body: {},
    })
  }

  /**
   * @operationName Update Domain
   * @category Domains
   * @description Updates a domain's tracking and TLS settings. Enable click tracking to rewrite links for analytics, open tracking to embed a tracking pixel, and choose whether TLS is enforced (delivery fails without a secure connection) or opportunistic (falls back to unencrypted delivery).
   * @route PATCH /update-domain
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Domain","name":"domainId","required":true,"dictionary":"getDomainsDictionary","description":"The domain to update. Select one or paste a domain ID."}
   * @paramDef {"type":"Boolean","label":"Click Tracking","name":"clickTracking","uiComponent":{"type":"TOGGLE"},"description":"Track clicks by rewriting links in emails sent from this domain. Leave empty to keep the current setting."}
   * @paramDef {"type":"Boolean","label":"Open Tracking","name":"openTracking","uiComponent":{"type":"TOGGLE"},"description":"Track opens via a hidden tracking pixel in emails sent from this domain. Leave empty to keep the current setting."}
   * @paramDef {"type":"String","label":"TLS","name":"tls","uiComponent":{"type":"DROPDOWN","options":{"values":["Enforced","Opportunistic"]}},"description":"TLS policy for outgoing mail. Enforced requires a secure TLS connection (delivery fails otherwise); Opportunistic attempts TLS but falls back to unencrypted delivery. Leave empty to keep the current setting."}
   *
   * @returns {Object}
   * @sampleResult {"object":"domain","id":"d91cd9bd-1176-453e-8fc1-35364d380206"}
   */
  async updateDomain(domainId, clickTracking, openTracking, tls) {
    const logTag = '[updateDomain]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/domains/${ encodeURIComponent(domainId) }`,
      method: 'patch',
      body: clean({
        click_tracking: clickTracking,
        open_tracking: openTracking,
        tls: this.#resolveChoice(tls, TLS_MAPPING),
      }),
    })
  }

  /**
   * @operationName Delete Domain
   * @category Domains
   * @description Permanently removes a sending domain from your Resend account. Emails can no longer be sent from addresses on this domain until it is re-added and verified.
   * @route DELETE /delete-domain
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Domain","name":"domainId","required":true,"dictionary":"getDomainsDictionary","description":"The domain to delete. Select one or paste a domain ID."}
   *
   * @returns {Object}
   * @sampleResult {"object":"domain","id":"d91cd9bd-1176-453e-8fc1-35364d380206","deleted":true}
   */
  async deleteDomain(domainId) {
    const logTag = '[deleteDomain]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/domains/${ encodeURIComponent(domainId) }`,
      method: 'delete',
    })
  }

  // ---------------------------------------------------------------------------
  // API Keys
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create API Key
   * @category API Keys
   * @description Creates a new Resend API key. Full Access keys can manage all resources (domains, contacts, broadcasts) and send emails; Sending Access keys can only send emails, optionally restricted to a single domain. The token is returned only once in this response - store it securely.
   * @route POST /create-api-key
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Descriptive name for the API key, e.g. 'Production'."}
   * @paramDef {"type":"String","label":"Permission","name":"permission","uiComponent":{"type":"DROPDOWN","options":{"values":["Full Access","Sending Access"]}},"defaultValue":"Full Access","description":"Full Access can create, read, update, and delete all resources. Sending Access can only send emails."}
   * @paramDef {"type":"String","label":"Restrict to Domain","name":"domainId","dictionary":"getDomainsDictionary","description":"Restrict a Sending Access key to sending emails from a single domain. Only applies when Permission is Sending Access."}
   *
   * @returns {Object}
   * @sampleResult {"id":"dacf4072-4119-4d88-932f-6202748ac7c8","token":"re_c1tpEyD8_NKFusih9vKVQknRAQfmFcWCv"}
   */
  async createApiKey(name, permission, domainId) {
    const logTag = '[createApiKey]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/api-keys`,
      method: 'post',
      body: clean({
        name,
        permission: this.#resolveChoice(permission, PERMISSION_MAPPING),
        domain_id: domainId,
      }),
    })
  }

  /**
   * @operationName List API Keys
   * @category API Keys
   * @description Lists all API keys in your Resend account with their names and creation times. Token values are never returned - they are only visible once, when the key is created.
   * @route GET /list-api-keys
   * @appearanceColor #000000 #404040
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"91f3200a-df72-4654-b0cd-f202395f5354","name":"Production","created_at":"2026-04-08T00:11:13.110779+00:00"}]}
   */
  async listApiKeys() {
    const logTag = '[listApiKeys]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/api-keys`,
      method: 'get',
    })
  }

  /**
   * @operationName Delete API Key
   * @category API Keys
   * @description Permanently revokes an API key. Any application still using the key will immediately lose access to the Resend API.
   * @route DELETE /delete-api-key
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"API Key ID","name":"apiKeyId","required":true,"description":"The ID of the API key to revoke. Find it with List API Keys."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"91f3200a-df72-4654-b0cd-f202395f5354"}
   */
  async deleteApiKey(apiKeyId) {
    const logTag = '[deleteApiKey]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/api-keys/${ encodeURIComponent(apiKeyId) }`,
      method: 'delete',
    })

    return { success: true, id: apiKeyId }
  }

  // ---------------------------------------------------------------------------
  // Audiences
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Audience
   * @category Audiences
   * @description Creates a new audience - a named list of contacts that broadcasts can be sent to. Returns the audience ID used by contact and broadcast operations.
   * @route POST /create-audience
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the audience, e.g. 'Registered Users' or 'Newsletter Subscribers'."}
   *
   * @returns {Object}
   * @sampleResult {"object":"audience","id":"78261eea-8f8b-4381-83c6-79fa7120f1cf","name":"Registered Users"}
   */
  async createAudience(name) {
    const logTag = '[createAudience]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/audiences`,
      method: 'post',
      body: { name },
    })
  }

  /**
   * @operationName List Audiences
   * @category Audiences
   * @description Lists all audiences in your Resend account with their IDs, names, and creation times.
   * @route GET /list-audiences
   * @appearanceColor #000000 #404040
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"78261eea-8f8b-4381-83c6-79fa7120f1cf","name":"Registered Users","created_at":"2026-10-06T22:59:55.977Z"}]}
   */
  async listAudiences() {
    const logTag = '[listAudiences]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/audiences`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Audience
   * @category Audiences
   * @description Retrieves a single audience by ID, including its name and creation time.
   * @route GET /get-audience
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","required":true,"dictionary":"getAudiencesDictionary","description":"The audience to fetch. Select one or paste an audience ID."}
   *
   * @returns {Object}
   * @sampleResult {"object":"audience","id":"78261eea-8f8b-4381-83c6-79fa7120f1cf","name":"Registered Users","created_at":"2026-10-06T22:59:55.977Z"}
   */
  async getAudience(audienceId) {
    const logTag = '[getAudience]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/audiences/${ encodeURIComponent(audienceId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Delete Audience
   * @category Audiences
   * @description Permanently deletes an audience and all contacts inside it. Broadcasts already sent to this audience are not affected.
   * @route DELETE /delete-audience
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","required":true,"dictionary":"getAudiencesDictionary","description":"The audience to delete. Select one or paste an audience ID."}
   *
   * @returns {Object}
   * @sampleResult {"object":"audience","id":"78261eea-8f8b-4381-83c6-79fa7120f1cf","deleted":true}
   */
  async deleteAudience(audienceId) {
    const logTag = '[deleteAudience]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/audiences/${ encodeURIComponent(audienceId) }`,
      method: 'delete',
    })
  }

  // ---------------------------------------------------------------------------
  // Contacts
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Adds a contact to an audience with an email address, optional first and last name, and subscription status. Returns the new contact's ID.
   * @route POST /create-contact
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","required":true,"dictionary":"getAudiencesDictionary","description":"The audience to add the contact to. Select one or paste an audience ID."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The contact's email address."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The contact's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"The contact's last name."}
   * @paramDef {"type":"Boolean","label":"Unsubscribed","name":"unsubscribed","uiComponent":{"type":"CHECKBOX"},"description":"Whether the contact is unsubscribed from broadcasts. Defaults to false (subscribed)."}
   *
   * @returns {Object}
   * @sampleResult {"object":"contact","id":"479e3145-dd38-476b-932c-529ceb705947"}
   */
  async createContact(audienceId, email, firstName, lastName, unsubscribed) {
    const logTag = '[createContact]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/audiences/${ encodeURIComponent(audienceId) }/contacts`,
      method: 'post',
      body: clean({
        email,
        first_name: firstName,
        last_name: lastName,
        unsubscribed,
      }),
    })
  }

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Lists all contacts in an audience with their email addresses, names, subscription status, and creation times.
   * @route GET /list-contacts
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","required":true,"dictionary":"getAudiencesDictionary","description":"The audience whose contacts to list. Select one or paste an audience ID."}
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"e169aa45-1ecf-4183-9955-b1499d5701d3","email":"steve.wozniak@gmail.com","first_name":"Steve","last_name":"Wozniak","created_at":"2026-10-06T23:47:56.678Z","unsubscribed":false}]}
   */
  async listContacts(audienceId) {
    const logTag = '[listContacts]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/audiences/${ encodeURIComponent(audienceId) }/contacts`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves a single contact from an audience by contact ID or email address, including name, subscription status, and creation time.
   * @route GET /get-contact
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","required":true,"dictionary":"getAudiencesDictionary","description":"The audience the contact belongs to. Select one or paste an audience ID."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","dependsOn":["audienceId"],"description":"The contact to fetch. Select one, or paste a contact ID or email address."}
   *
   * @returns {Object}
   * @sampleResult {"object":"contact","id":"e169aa45-1ecf-4183-9955-b1499d5701d3","email":"steve.wozniak@gmail.com","first_name":"Steve","last_name":"Wozniak","created_at":"2026-10-06T23:47:56.678Z","unsubscribed":false}
   */
  async getContact(audienceId, contactId) {
    const logTag = '[getContact]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/audiences/${ encodeURIComponent(audienceId) }/contacts/${ encodeURIComponent(contactId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates a contact's first name, last name, or subscription status. The contact can be identified by contact ID or email address. Only provided fields are changed.
   * @route PATCH /update-contact
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","required":true,"dictionary":"getAudiencesDictionary","description":"The audience the contact belongs to. Select one or paste an audience ID."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","dependsOn":["audienceId"],"description":"The contact to update. Select one, or paste a contact ID or email address."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New first name. Leave empty to keep the current value."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New last name. Leave empty to keep the current value."}
   * @paramDef {"type":"Boolean","label":"Unsubscribed","name":"unsubscribed","uiComponent":{"type":"CHECKBOX"},"description":"Set to true to unsubscribe the contact from broadcasts, false to resubscribe. Leave empty to keep the current value."}
   *
   * @returns {Object}
   * @sampleResult {"object":"contact","id":"479e3145-dd38-476b-932c-529ceb705947"}
   */
  async updateContact(audienceId, contactId, firstName, lastName, unsubscribed) {
    const logTag = '[updateContact]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/audiences/${ encodeURIComponent(audienceId) }/contacts/${ encodeURIComponent(contactId) }`,
      method: 'patch',
      body: clean({
        first_name: firstName,
        last_name: lastName,
        unsubscribed,
      }),
    })
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @description Permanently removes a contact from an audience. The contact can be identified by contact ID or email address.
   * @route DELETE /delete-contact
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","required":true,"dictionary":"getAudiencesDictionary","description":"The audience the contact belongs to. Select one or paste an audience ID."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","dependsOn":["audienceId"],"description":"The contact to delete. Select one, or paste a contact ID or email address."}
   *
   * @returns {Object}
   * @sampleResult {"object":"contact","contact":"520784e2-887d-4c25-b53c-4ad46ad38100","deleted":true}
   */
  async deleteContact(audienceId, contactId) {
    const logTag = '[deleteContact]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/audiences/${ encodeURIComponent(audienceId) }/contacts/${ encodeURIComponent(contactId) }`,
      method: 'delete',
    })
  }

  // ---------------------------------------------------------------------------
  // Broadcasts
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Broadcast
   * @category Broadcasts
   * @description Creates a draft broadcast (marketing email) targeted at an audience. The broadcast is not delivered until you call Send Broadcast. HTML content supports personalization variables like {{{FIRST_NAME|there}}} and the required {{{RESEND_UNSUBSCRIBE_URL}}} unsubscribe link. Returns the broadcast ID.
   * @route POST /create-broadcast
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","required":true,"dictionary":"getAudiencesDictionary","description":"The audience that will receive the broadcast. Select one or paste an audience ID."}
   * @paramDef {"type":"String","label":"From","name":"from","required":true,"description":"Sender address. Use plain 'you@example.com' or friendly 'Your Name <you@example.com>' format. The domain must be verified in Resend."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Email subject line."}
   * @paramDef {"type":"String","label":"HTML Body","name":"html","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"HTML version of the message. Supports variables like {{{FIRST_NAME|there}}} and {{{RESEND_UNSUBSCRIBE_URL}}}. Provide HTML Body and/or Text Body."}
   * @paramDef {"type":"String","label":"Text Body","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain-text version of the message. Provide HTML Body and/or Text Body."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Internal name for the broadcast, shown only in the Resend dashboard."}
   * @paramDef {"type":"Array<String>","label":"Reply To","name":"replyTo","description":"Reply-to email addresses."}
   * @paramDef {"type":"String","label":"Preview Text","name":"previewText","description":"Snippet shown after the subject line in most inboxes."}
   *
   * @returns {Object}
   * @sampleResult {"id":"49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"}
   */
  async createBroadcast(audienceId, from, subject, html, text, name, replyTo, previewText) {
    const logTag = '[createBroadcast]'

    if (!html && !text) {
      throw new Error('Provide at least one of HTML Body or Text Body')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/broadcasts`,
      method: 'post',
      body: clean({
        audience_id: audienceId,
        from,
        subject,
        html,
        text,
        name,
        reply_to: toArray(replyTo),
        preview_text: previewText,
      }),
    })
  }

  /**
   * @operationName List Broadcasts
   * @category Broadcasts
   * @description Lists all broadcasts in your Resend account with their status (draft, scheduled, or sent), target audience, and timing information.
   * @route GET /list-broadcasts
   * @appearanceColor #000000 #404040
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"49a3999c-0ce1-4ea6-ab68-afcd6dc2e794","audience_id":"78261eea-8f8b-4381-83c6-79fa7120f1cf","status":"draft","created_at":"2026-11-01T15:13:31.723Z","scheduled_at":null,"sent_at":null}]}
   */
  async listBroadcasts() {
    const logTag = '[listBroadcasts]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/broadcasts`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Broadcast
   * @category Broadcasts
   * @description Retrieves a single broadcast by ID, including its name, sender, subject, preview text, target audience, status, and scheduling information.
   * @route GET /get-broadcast
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Broadcast","name":"broadcastId","required":true,"dictionary":"getBroadcastsDictionary","description":"The broadcast to fetch. Select one or paste a broadcast ID."}
   *
   * @returns {Object}
   * @sampleResult {"object":"broadcast","id":"559ac32e-9ef5-46fb-82a1-b76b840c0f7b","name":"Announcements","audience_id":"78261eea-8f8b-4381-83c6-79fa7120f1cf","from":"Acme <onboarding@resend.dev>","subject":"hello world","reply_to":null,"preview_text":"Check out our latest announcements","status":"draft","created_at":"2026-12-01T19:32:22.980Z","scheduled_at":null,"sent_at":null}
   */
  async getBroadcast(broadcastId) {
    const logTag = '[getBroadcast]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/broadcasts/${ encodeURIComponent(broadcastId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Broadcast
   * @category Broadcasts
   * @description Updates a draft broadcast's audience, sender, subject, content, name, reply-to, or preview text. Only provided fields are changed. Broadcasts that have already been sent cannot be updated.
   * @route PATCH /update-broadcast
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Broadcast","name":"broadcastId","required":true,"dictionary":"getBroadcastsDictionary","description":"The broadcast to update. Select one or paste a broadcast ID."}
   * @paramDef {"type":"String","label":"Audience","name":"audienceId","dictionary":"getAudiencesDictionary","description":"New target audience. Leave empty to keep the current one."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"New sender address in 'Name <email@domain.com>' format. Leave empty to keep the current one."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"New subject line. Leave empty to keep the current one."}
   * @paramDef {"type":"String","label":"HTML Body","name":"html","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New HTML version of the message. Leave empty to keep the current one."}
   * @paramDef {"type":"String","label":"Text Body","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New plain-text version of the message. Leave empty to keep the current one."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New internal name for the broadcast. Leave empty to keep the current one."}
   * @paramDef {"type":"Array<String>","label":"Reply To","name":"replyTo","description":"New reply-to email addresses. Leave empty to keep the current ones."}
   * @paramDef {"type":"String","label":"Preview Text","name":"previewText","description":"New inbox preview snippet. Leave empty to keep the current one."}
   *
   * @returns {Object}
   * @sampleResult {"id":"559ac32e-9ef5-46fb-82a1-b76b840c0f7b"}
   */
  async updateBroadcast(broadcastId, audienceId, from, subject, html, text, name, replyTo, previewText) {
    const logTag = '[updateBroadcast]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/broadcasts/${ encodeURIComponent(broadcastId) }`,
      method: 'patch',
      body: clean({
        audience_id: audienceId,
        from,
        subject,
        html,
        text,
        name,
        reply_to: toArray(replyTo),
        preview_text: previewText,
      }),
    })
  }

  /**
   * @operationName Send Broadcast
   * @category Broadcasts
   * @description Sends a draft broadcast to its audience, either immediately or at a scheduled time. Scheduling accepts natural language like 'in 1 hour' or an ISO 8601 timestamp.
   * @route POST /send-broadcast
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Broadcast","name":"broadcastId","required":true,"dictionary":"getBroadcastsDictionary","description":"The broadcast to send. Select one or paste a broadcast ID."}
   * @paramDef {"type":"String","label":"Scheduled At","name":"scheduledAt","description":"When to deliver the broadcast. Accepts natural language like 'in 1 min' or an ISO 8601 timestamp like '2026-08-05T11:52:01.858Z'. Leave empty to send immediately."}
   *
   * @returns {Object}
   * @sampleResult {"id":"49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"}
   */
  async sendBroadcast(broadcastId, scheduledAt) {
    const logTag = '[sendBroadcast]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/broadcasts/${ encodeURIComponent(broadcastId) }/send`,
      method: 'post',
      body: clean({ scheduled_at: scheduledAt }),
    })
  }

  /**
   * @operationName Delete Broadcast
   * @category Broadcasts
   * @description Permanently deletes a broadcast. Only broadcasts with draft status can be deleted; scheduled or sent broadcasts cannot.
   * @route DELETE /delete-broadcast
   * @appearanceColor #000000 #404040
   *
   * @paramDef {"type":"String","label":"Broadcast","name":"broadcastId","required":true,"dictionary":"getBroadcastsDictionary","description":"The draft broadcast to delete. Select one or paste a broadcast ID."}
   *
   * @returns {Object}
   * @sampleResult {"object":"broadcast","id":"559ac32e-9ef5-46fb-82a1-b76b840c0f7b","deleted":true}
   */
  async deleteBroadcast(broadcastId) {
    const logTag = '[deleteBroadcast]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/broadcasts/${ encodeURIComponent(broadcastId) }`,
      method: 'delete',
    })
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @registerAs DICTIONARY
   * @operationName Get Domains Dictionary
   * @description Provides the list of sending domains for selecting a domain in domain and API key operations. The option value is the domain ID.
   * @route POST /get-domains-dictionary
   * @paramDef {"type":"getDomainsDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter domains by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"example.com","value":"d91cd9bd-1176-453e-8fc1-35364d380206","note":"verified - us-east-1"}],"cursor":null}
   */
  async getDomainsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getDomainsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/domains`,
      method: 'get',
    })

    const searchLower = (search || '').toLowerCase()
    const domains = (response.data || [])
      .filter(domain => !searchLower || (domain.name || '').toLowerCase().includes(searchLower))

    return {
      items: domains.map(domain => ({
        label: domain.name,
        value: domain.id,
        note: [domain.status, domain.region].filter(Boolean).join(' - ') || undefined,
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Audiences Dictionary
   * @description Provides the list of audiences for selecting an audience in contact and broadcast operations. The option value is the audience ID.
   * @route POST /get-audiences-dictionary
   * @paramDef {"type":"getAudiencesDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter audiences by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Registered Users","value":"78261eea-8f8b-4381-83c6-79fa7120f1cf","note":"Created 2026-10-06"}],"cursor":null}
   */
  async getAudiencesDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getAudiencesDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/audiences`,
      method: 'get',
    })

    const searchLower = (search || '').toLowerCase()
    const audiences = (response.data || [])
      .filter(audience => !searchLower || (audience.name || '').toLowerCase().includes(searchLower))

    return {
      items: audiences.map(audience => ({
        label: audience.name,
        value: audience.id,
        note: audience.created_at ? `Created ${ audience.created_at.slice(0, 10) }` : undefined,
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Broadcasts Dictionary
   * @description Provides the list of broadcasts for selecting a broadcast in broadcast operations. The option value is the broadcast ID; the note shows the broadcast status (draft, scheduled, or sent).
   * @route POST /get-broadcasts-dictionary
   * @paramDef {"type":"getBroadcastsDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter broadcasts by name or subject."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Announcements","value":"49a3999c-0ce1-4ea6-ab68-afcd6dc2e794","note":"draft"}],"cursor":null}
   */
  async getBroadcastsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getBroadcastsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/broadcasts`,
      method: 'get',
    })

    const searchLower = (search || '').toLowerCase()
    const broadcasts = (response.data || []).filter(broadcast => {
      if (!searchLower) {
        return true
      }

      return [broadcast.name, broadcast.subject]
        .some(value => (value || '').toLowerCase().includes(searchLower))
    })

    return {
      items: broadcasts.map(broadcast => ({
        label: broadcast.name || broadcast.subject || broadcast.id,
        value: broadcast.id,
        note: broadcast.status || undefined,
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Contacts Dictionary
   * @description Provides the list of contacts in the selected audience for selecting a contact in contact operations. The option value is the contact ID. Requires an audience to be selected first.
   * @route POST /get-contacts-dictionary
   * @paramDef {"type":"getContactsDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string and the audience whose contacts to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"steve.wozniak@gmail.com","value":"e169aa45-1ecf-4183-9955-b1499d5701d3","note":"Steve Wozniak"}],"cursor":null}
   */
  async getContactsDictionary(payload) {
    const { search, criteria } = payload || {}
    const logTag = '[getContactsDictionary]'
    const audienceId = criteria?.audienceId

    if (!audienceId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/audiences/${ encodeURIComponent(audienceId) }/contacts`,
      method: 'get',
    })

    const searchLower = (search || '').toLowerCase()
    const contacts = (response.data || []).filter(contact => {
      if (!searchLower) {
        return true
      }

      return [contact.email, contact.first_name, contact.last_name]
        .some(value => (value || '').toLowerCase().includes(searchLower))
    })

    return {
      items: contacts.map(contact => {
        const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ')
        const noteParts = [fullName, contact.unsubscribed ? 'unsubscribed' : null].filter(Boolean)

        return {
          label: contact.email,
          value: contact.id,
          note: noteParts.join(' - ') || undefined,
        }
      }),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(ResendService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Resend API key (starts with re_). Create one at https://resend.com/api-keys',
  },
])
