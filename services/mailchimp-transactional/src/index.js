const { clean } = require('./utils')

const logger = {
  info: (...args) => console.log('[Mailchimp Transactional Service] info:', ...args),
  debug: (...args) => console.log('[Mailchimp Transactional Service] debug:', ...args),
  error: (...args) => console.log('[Mailchimp Transactional Service] error:', ...args),
  warn: (...args) => console.log('[Mailchimp Transactional Service] warn:', ...args),
}

const API_BASE_URL = 'https://mandrillapp.com/api/1.0'

/**
 *  @integrationName Mailchimp Transactional Email
 *  @integrationIcon /icon.png
 **/
class MailchimpTransactionalService {
  constructor(config) {
    this.mandrillApiKey = config.mandrillApiKey
  }

  async #apiRequest({ url, method, body, logTag }) {
    method = method || 'post'
    
    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }]`)
      
      const response = await Flowrunner.Request[method](url)
        .set({
          'Content-Type': 'application/json',
        })
        .send(JSON.stringify({ ...body, key: this.mandrillApiKey }))

      logger.debug(`${ logTag } - response: ${ JSON.stringify(response) }`)

      return response
    } catch (error) {
      logger.error(`${ logTag } - failed to execute ${ url }: ${ error.message }`)
      throw error
    }
  }

  /**
   * @typedef {Object} MessageTo
   * @property {String} email - The email address of the recipient.
   * @property {String} name - The optional display name to use for the recipient.
   * @property {String} type - The header type to use for the recipient, defaults to 'to' if not provided. Possible values: 'to', 'cc', or 'bcc'.
   */

  /**
   * @typedef {Object} GlobalMergeVar
   * @property {String} name - The global merge variable's name. Merge variable names are case-insensitive and may not start with _.
   * @property {String} content - The global merge variable's content.
   */

  /**
   * @typedef {Object} Var
   * @property {String} name - The merge variable's name. Merge variable names are case-insensitive and may not start with _.
   * @property {String} content - The merge variable's content.
   */

  /**
   * @typedef {Object} MergeVar
   * @property {String} rcpt - The email address of the recipient that the merge variables should apply to.
   * @property {Array.<Var>} content - The recipient's merge variables.
   */

  /**
   * @typedef {Object} Values
   * @property {Number} user_id - The recipient's id.
   */

  /**
   * @typedef {Object} RecipientMetadata
   * @property {String} rcpt - The email address of the recipient that the metadata is associated with.
   * @property {Values} values - An associated array containing the recipient's unique metadata. If a key exists in both the per-recipient metadata and the global metadata, the per-recipient metadata will be used.
   */

  /**
   * @typedef {Object} Attachment
   * @property {String} type - The MIME type of the attachment.
   * @property {String} name - The file name of the attachment.
   * @property {String} content - The content of the attachment as a base64-encoded string.
   */

  /**
   * @typedef {Object} Image
   * @property {String} type - The MIME type of the image - must start with 'image/'.
   * @property {String} name - The Content ID of the image - use  to reference the image in your HTML content.
   * @property {String} content - The content of the image as a base64-encoded string.
   */

  /**
   * @typedef {Object} SendMessageResponse
   * @property {String} email - The email address of the recipient.
   * @property {String} status - The sending status of the recipient. Possible values: 'sent', 'queued', 'scheduled', 'rejected', or 'invalid'.
   * @property {String} reject_reason - The reason for the rejection if the recipient status is 'rejected'. Possible values: 'hard-bounce', 'soft-bounce', 'spam', 'unsub', 'custom', 'invalid-sender', 'invalid', 'test-mode-limit', 'unsigned', or 'rule'.
   * @property {String} queued_reason - The reason for the email being queued if the response status is 'queued'. Possible values: 'attachments', 'multiple-recipients', 'free-trial-sends-exhausted', 'hourly-quota-exhausted', 'monthly-limit-reached', 'sending-paused', 'sending-suspended', 'account-suspended', or 'sending-backlogged'.
   * @property {String} _id - The message's unique id.
   */

  /**
   * @typedef {Object} Message
   * @property {String} html - The full HTML content to be sent.
   * @property {String} text - Optional full text content to be sent.
   * @property {String} subject - The message subject.
   * @property {String} from_email - The sender email address.
   * @property {String} from_name - Optional from name to be used.
   * @property {Array.<MessageTo>} to - An array of recipient information.
   * @property {Object} headers - Optional extra headers to add to the message (most headers are allowed).
   * @property {Boolean} important - Whether or not this message is important, and should be delivered ahead of non-important messages.
   * @property {Boolean} track_opens - Whether or not to turn on open tracking for the message.
   * @property {Boolean} track_clicks - Whether or not to turn on click tracking for the message.
   * @property {Boolean} auto_text - Whether or not to automatically generate a text part for messages that are not given text.
   * @property {Boolean} auto_html - Whether or not to automatically generate an HTML part for messages that are not given HTML.
   * @property {Boolean} inline_css - Whether or not to automatically inline all CSS styles provided in the message HTML - only for HTML documents less than 256KB in size.
   * @property {Boolean} url_strip_qs - Whether or not to strip the query string from URLs when aggregating tracked URL data.
   * @property {Boolean} preserve_recipients - Whether or not to expose all recipients in to 'To' header for each email.
   * @property {Boolean} view_content_link - Set to 'false' to remove content logging for sensitive emails.
   * @property {String} bcc_address - An optional address to receive an exact copy of each recipient's email.
   * @property {String} tracking_domain - A custom domain to use for tracking opens and clicks instead of mandrillapp.com.
   * @property {String} signing_domain - A custom domain to use for SPF/DKIM signing instead of mandrill (for 'via' or 'on behalf of' in email clients).
   * @property {String} return_path_domain - A custom domain to use for the messages' return-path.
   * @property {Boolean} merge - Whether to evaluate merge tags in the message. Will automatically be set to 'true' if either merge_vars or global_merge_vars are provided.
   * @property {String} merge_language - The merge tag language to use when evaluating merge tags, either mailchimp or handlebars. Possible values: 'mailchimp' or 'handlebars'.
   * @property {Array.<GlobalMergeVar>} global_merge_vars - Global merge variables to use for all recipients. You can override these per recipient.
   * @property {Array.<MergeVar>} merge_vars - Per-recipient merge variables, which override global merge variables with the same name.
   * @property {Array.<String>} tags - An array of string to tag the message with. Stats are accumulated using tags, though we only store the first 100 we see, so this should not be unique or change frequently. Tags should be 50 characters or less. Any tags starting with an underscore are reserved for internal use and will cause errors.
   * @property {String} subaccount - The unique id of a subaccount for this message - must already exist or will fail with an error.
   * @property {Array.<String>} google_analytics_domains - An array of strings indicating for which any matching URLs will automatically have Google Analytics parameters appended to their query string automatically.
   * @property {String} google_analytics_campaign - Optional string indicating the value to set for the utm_campaign tracking parameter. If this isn't provided the email's from address will be used instead.
   * @property {Metadata} metadata - Metadata an associative array of user metadata. Mandrill will store this metadata and make it available for retrieval. In addition, you can select up to 10 metadata fields to index and make searchable using the Mandrill search api.
   * @property {Array.<RecipientMetadata>} recipient_metadata - Per-recipient metadata that will override the global values specified in the metadata parameter.
   * @property {Array.<Attachment>} attachments - An array of supported attachments to add to the message.
   * @property {Array.<Image>} images - An array of embedded images to add to the message.
   */

  /**
   * @description Sends a new transactional message through the Mailchimp Transactional API. Supports rich HTML content, tracking options, merge variables, attachments, and advanced delivery settings for professional email campaigns.
   * @route POST /send-message
   * @operationName Send Message
   * @category Email Sending
   * @appearanceColor #ed9d4a #8f202f
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"The message subject."}
   * @paramDef {"type":"String","label":"From Email","name":"from_email","required":true,"description":"The sender email address."}
   * @paramDef {"type":"String","label":"From Name","name":"from_name","required":true,"description":"Optional from name to be used."}
   * @paramDef {"type":"Array.<MessageTo>","label":"To Recipients","name":"to","required":true,"description":"An array of recipient information."}
   * @paramDef {"type":"String","label":"HTML Content","name":"html","description":"The full HTML content to be sent."}
   * @paramDef {"type":"String","label":"Plain Text Content","name":"text","description":"Optional full text content to be sent."}
   * @paramDef {"type":"Object","label":"Headers","name":"headers","description":"Optional extra headers to add to the message."}
   * @paramDef {"type":"Boolean","label":"Important","name":"important","uiComponent":{"type":"TOGGLE"},"description":"Whether or not this message is important, and should be delivered ahead of non-important messages."}
   * @paramDef {"type":"Boolean","label":"Track Opens","name":"track_opens","uiComponent":{"type":"TOGGLE"},"description":"Whether or not to turn on open tracking for the message."}
   * @paramDef {"type":"Boolean","label":"Track Clicks","name":"track_clicks","uiComponent":{"type":"TOGGLE"},"description":"Whether or not to turn on click tracking for the message."}
   * @paramDef {"type":"Boolean","label":"Auto Text","name":"auto_text","uiComponent":{"type":"TOGGLE"},"description":"Automatically generate a text part for messages without text."}
   * @paramDef {"type":"Boolean","label":"Auto HTML","name":"auto_html","uiComponent":{"type":"TOGGLE"},"description":"Automatically generate an HTML part for messages without HTML."}
   * @paramDef {"type":"Boolean","label":"Inline CSS","name":"inline_css","uiComponent":{"type":"TOGGLE"},"description":"Automatically inline all CSS styles in the message HTML."}
   * @paramDef {"type":"Boolean","label":"URL Strip QS","name":"url_strip_qs","uiComponent":{"type":"TOGGLE"},"description":"Whether or not to strip query strings from URLs in tracked URLs."}
   * @paramDef {"type":"Boolean","label":"Preserve Recipients","name":"preserve_recipients","uiComponent":{"type":"TOGGLE"},"description":"Whether or not to show all recipients in the 'To' header for each email."}
   * @paramDef {"type":"Boolean","label":"View Content Link","name":"view_content_link","uiComponent":{"type":"TOGGLE"},"description":"Set to 'false' to remove content logging for sensitive emails."}
   * @paramDef {"type":"String","label":"BCC Address","name":"bcc_address","description":"An address to receive an exact copy of each recipient's email."}
   * @paramDef {"type":"String","label":"Tracking Domain","name":"tracking_domain","description":"Custom domain to use for tracking opens and clicks."}
   * @paramDef {"type":"String","label":"Signing Domain","name":"signing_domain","description":"Custom domain for SPF/DKIM signing instead of default."}
   * @paramDef {"type":"String","label":"Return Path Domain","name":"return_path_domain","description":"Custom domain for the message's return-path."}
   * @paramDef {"type":"Boolean","label":"Merge","name":"merge","uiComponent":{"type":"TOGGLE"},"description":"Whether to evaluate merge tags in the message."}
   * @paramDef {"type":"String","label":"Merge Language","name":"merge_language","uiComponent":{"type":"DROPDOWN","options":{"values":["mailchimp","handlebars"]}},"description":"Merge tag language for evaluating merge tags, either 'mailchimp' or 'handlebars'."}
   * @paramDef {"type":"Array.<GlobalMergeVar>","label":"Global Merge Vars","name":"global_merge_vars","description":"Global merge variables for all recipients, can be overridden per recipient."}
   * @paramDef {"type":"Array.<MergeVar>","label":"Merge Vars","name":"merge_vars","description":"Per-recipient merge variables, override global merge vars with the same name."}
   * @paramDef {"type":"Array.<String>","label":"Tags","name":"tags","description":"Tags for the message, used for stats."}
   * @paramDef {"type":"String","label":"Subaccount","name":"subaccount","description":"Unique id of a subaccount for this message, must already exist."}
   * @paramDef {"type":"Array.<String>","label":"Google Analytics Domains","name":"google_analytics_domains","description":"Domains for which Google Analytics parameters will be appended to URLs."}
   * @paramDef {"type":"String","label":"Google Analytics Campaign","name":"google_analytics_campaign","description":"Value for utm_campaign tracking parameter, defaults to email's from address if not provided."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Associative array of user metadata, stored and searchable using the Mandrill search API."}
   * @paramDef {"type":"Array.<RecipientMetadata>","label":"Recipient Metadata","name":"recipient_metadata","description":"Per-recipient metadata that overrides global values specified in metadata."}
   * @paramDef {"type":"Array.<Attachment>","label":"Attachments","name":"attachments","description":"An array of supported attachments to add to the message."}
   * @paramDef {"type":"Array.<Image>","label":"Images","name":"images","description":"An array of embedded images to add to the message."}
   * @paramDef {"type":"Boolean","label":"Async","name":"async","uiComponent":{"type":"TOGGLE"},"description":"Enable a background sending mode that is optimized for bulk sending. In async mode, messages/send will immediately return a status of 'queued' for every recipient. To handle rejections when sending in async mode, set up a webhook for the 'reject' event. Defaults to 'false' for messages with no more than 10 recipients; messages with more than 10 recipients are always sent asynchronously, regardless of the value of async."}
   * @paramDef {"type":"String","label":"IP Pool","name":"ip_pool","description":"The name of the dedicated ip pool that should be used to send the message. If you do not have any dedicated IPs, this parameter has no effect. If you specify a pool that does not exist, your default pool will be used instead."}
   * @paramDef {"type":"String","label":"Send At","name":"send_at","description":"When this message should be sent as a UTC timestamp in YYYY-MM-DD HH:MM:SS format. If you specify a time in the past, the message will be sent immediately; for future dates, you're limited to one year from the date of scheduling."}
   *
   * @returns {SendMessageResponse} The sending results for a single recipient.
   * @sampleResult [{"email":"user@example.com","status":"sent","reject_reason":"hard-bounce","queued_reason":"attachments","_id":"string"}]
   */
  sendMessage(
    subject,
    from_email,
    from_name,
    to,
    html,
    text,
    headers,
    important,
    track_opens,
    track_clicks,
    auto_text,
    auto_html,
    inline_css,
    url_strip_qs,
    preserve_recipients,
    view_content_link,
    bcc_address,
    tracking_domain,
    signing_domain,
    return_path_domain,
    merge,
    merge_language,
    global_merge_vars,
    merge_vars,
    tags,
    subaccount,
    google_analytics_domains,
    google_analytics_campaign,
    metadata,
    recipient_metadata,
    attachments,
    images,
    async,
    ip_pool,
    send_at
  ) {
    const message = clean({
      subject,
      from_email,
      from_name,
      to,
      html,
      text,
      headers,
      important,
      track_opens,
      track_clicks,
      auto_text,
      auto_html,
      inline_css,
      url_strip_qs,
      preserve_recipients,
      view_content_link,
      bcc_address,
      tracking_domain,
      signing_domain,
      return_path_domain,
      merge,
      merge_language,
      global_merge_vars,
      merge_vars,
      tags,
      subaccount,
      google_analytics_domains,
      google_analytics_campaign,
      metadata,
      recipient_metadata,
      attachments,
      images,
    })

    return this.#apiRequest({ 
      url: `${ API_BASE_URL }/messages/send.json`, 
      body: { message, async, ip_pool, send_at },
      logTag: 'sendMessage', 
    })
  }

  /**
   * @typedef {Object} Template
   * @property {String} slug - The immutable unique code name of the template.
   * @property {String} name - The name of the template.
   * @property {Array<String>} labels - The list of labels applied to the template.
   * @property {String} code - The full HTML code of the template, with mc:edit attributes marking the editable elements - draft version.
   * @property {String} subject - The subject line of the template, if provided - draft version.
   * @property {String} from_email - The default sender address for the template, if provided - draft version.
   * @property {String} from_name - The default sender from name for the template, if provided - draft version.
   * @property {String} text - The default text part of messages sent with the template, if provided - draft version.
   * @property {String} publish_name - The same as the template name - kept as a separate field for backwards compatibility.
   * @property {String} publish_code - The full HTML code of the template, with mc:edit attributes marking the editable elements that are available as published, if it has been published.
   * @property {String} publish_subject - The subject line of the template, if provided.
   * @property {String} publish_from_email - The default sender address for the template, if provided.
   * @property {String} publish_from_name - The default sender from name for the template, if provided.
   * @property {String} publish_text - The default text part of messages sent with the template, if provided.
   * @property {String} published_at - The date and time the template was last published as a UTC string in YYYY-MM-DD HH:MM:SS format, or null if it has not been published.
   * @property {String} created_at - The date and time the template was first created as a UTC string in YYYY-MM-DD HH:MM:SS format.
   * @property {String} updated_at - The date and time the template was last modified as a UTC string in YYYY-MM-DD HH:MM:SS format.
   * @property {Boolean} is_broken_template - Indicates if the template is malformed or corrupt.
   */

  /**
   * @description Returns a list of all the templates available to this user. Templates are reusable email designs that can be used to send consistent messages across your campaigns.
   *
   * @route GET /templates-list
   * @operationName Get Templates List
   * @category Template Management
   * @appearanceColor #ed9d4a #8f202f
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Label","name":"label","description":"An optional label to filter the templates."}
   *
   * @returns {Template[]} An array of structs with information about each template.
   * @sampleResult [{"slug":"string","name":"string","labels":["string"],"code":"string","subject":"string","from_email":"string","from_name":"string","text":"string","publish_name":"string","publish_code":"string","publish_subject":"string","publish_from_email":"user@example.com","publish_from_name":"string","publish_text":"string","published_at":"2019-08-24T14:15:22Z","created_at":"2019-08-24T14:15:22Z","updated_at":"2019-08-24T14:15:22Z","is_broken_template":true}]
   */
  getTemplatesList(label) {
    return this.#apiRequest({ 
      url: `${ API_BASE_URL }/templates/list.json`, 
      body: { label },
      logTag: 'getTemplatesList', 
    })
  }

  /**
   * @description Adds a new template to your account. Templates allow you to create reusable email designs with editable regions that can be customized for each campaign.
   *
   * @route POST /add-template
   * @operationName Add Template
   * @category Template Management
   * @appearanceColor #ed9d4a #8f202f
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Template Name","name":"name","required":true,"description":"The name for the new template - must be unique."}
   * @paramDef {"type":"String","label":"From Email","name":"from_email","description":"A default sending address for emails sent using this template."}
   * @paramDef {"type":"String","label":"From Name","name":"from_name","description":"A default from name to be used."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"A default subject line to be used."}
   * @paramDef {"type":"String","label":"HTML Content","name":"code","description":"The HTML code for the template with mc:edit attributes for the editable elements."}
   * @paramDef {"type":"String","label":"Plain Text Content","name":"text","description":"A default text part to be used when sending with this template."}
   * @paramDef {"type":"Boolean","label":"Publish","name":"publish","uiComponent":{"type":"TOGGLE"},"description":"Set to 'false' to add a draft template without publishing."}
   * @paramDef {"type":"Array.<String>","label":"Labels","name":"labels","description":"An optional array of up to 10 labels to use for filtering templates."}
   *
   * @returns {Template} The information saved about the new template.
   * @sampleResult {"slug":"string","name":"string","labels":["string"],"code":"string","subject":"string","from_email":"string","from_name":"string","text":"string","publish_name":"string","publish_code":"string","publish_subject":"string","publish_from_email":"user@example.com","publish_from_name":"string","publish_text":"string","published_at":"2019-08-24T14:15:22Z","created_at":"2019-08-24T14:15:22Z","updated_at":"2019-08-24T14:15:22Z","is_broken_template":true}
   */
  addTemplate(name, from_email, from_name, subject, code, text, publish, labels) {
    return this.#apiRequest({ 
      url: `${ API_BASE_URL }/templates/add.json`, 
      body: {
        name,
        from_email,
        from_name,
        subject,
        code,
        text,
        publish,
        labels,
      },
      logTag: 'addTemplate', 
    })
  }

  /**
   * @typedef {Object} TemplateContent
   * @property {String} name - The name of the mc:edit editable region to inject into.
   * @property {String} content - The content to inject.
   */

  /**
   * @description Sends a new transactional message through the Transactional API using a template. Templates provide consistent branding and allow dynamic content injection into predefined editable regions.
   *
   * @route POST /send-with-template
   * @operationName Send With Template
   * @category Email Sending
   * @appearanceColor #ed9d4a #8f202f
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Template Name","name":"template_name","required":true,"description":"The immutable slug of a template that exists in the user's account. Make sure you don't use the template name as this one might change."}
   * @paramDef {"type":"Array.<TemplateContent>","label":"Template Content","name":"template_content","required":true,"description":"An array of template content to send. Each item in the array should be a struct with two keys - name: the name of the content block to set the content for, and content: the actual content to put into the block."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"The message subject."}
   * @paramDef {"type":"String","label":"From Email","name":"from_email","required":true,"description":"The sender email address."}
   * @paramDef {"type":"String","label":"From Name","name":"from_name","required":true,"description":"Optional from name to be used."}
   * @paramDef {"type":"Array.<MessageTo>","label":"To Recipients","name":"to","required":true,"description":"An array of recipient information."}
   * @paramDef {"type":"String","label":"HTML Content","name":"html","description":"Optional full HTML content to be sent if not in template."}
   * @paramDef {"type":"String","label":"Plain Text Content","name":"text","description":"Optional full text content to be sent."}
   * @paramDef {"type":"Object","label":"Headers","name":"headers","description":"Optional extra headers to add to the message."}
   * @paramDef {"type":"Boolean","label":"Important","name":"important","uiComponent":{"type":"TOGGLE"},"description":"Whether or not this message is important, and should be delivered ahead of non-important messages."}
   * @paramDef {"type":"Boolean","label":"Track Opens","name":"track_opens","uiComponent":{"type":"TOGGLE"},"description":"Whether or not to turn on open tracking for the message."}
   * @paramDef {"type":"Boolean","label":"Track Clicks","name":"track_clicks","uiComponent":{"type":"TOGGLE"},"description":"Whether or not to turn on click tracking for the message."}
   * @paramDef {"type":"Boolean","label":"Auto Text","name":"auto_text","uiComponent":{"type":"TOGGLE"},"description":"Automatically generate a text part for messages without text."}
   * @paramDef {"type":"Boolean","label":"Auto HTML","name":"auto_html","uiComponent":{"type":"TOGGLE"},"description":"Automatically generate an HTML part for messages without HTML."}
   * @paramDef {"type":"Boolean","label":"Inline CSS","name":"inline_css","uiComponent":{"type":"TOGGLE"},"description":"Automatically inline all CSS styles in the message HTML."}
   * @paramDef {"type":"Boolean","label":"URL Strip QS","name":"url_strip_qs","uiComponent":{"type":"TOGGLE"},"description":"Whether or not to strip query strings from URLs in tracked URLs."}
   * @paramDef {"type":"Boolean","label":"Preserve Recipients","name":"preserve_recipients","uiComponent":{"type":"TOGGLE"},"description":"Whether or not to show all recipients in the 'To' header for each email."}
   * @paramDef {"type":"Boolean","label":"View Content Link","name":"view_content_link","uiComponent":{"type":"TOGGLE"},"description":"Set to 'false' to remove content logging for sensitive emails."}
   * @paramDef {"type":"String","label":"BCC Address","name":"bcc_address","description":"An address to receive an exact copy of each recipient's email."}
   * @paramDef {"type":"String","label":"Tracking Domain","name":"tracking_domain","description":"Custom domain to use for tracking opens and clicks."}
   * @paramDef {"type":"String","label":"Signing Domain","name":"signing_domain","description":"Custom domain for SPF/DKIM signing instead of default."}
   * @paramDef {"type":"String","label":"Return Path Domain","name":"return_path_domain","description":"Custom domain for the message's return-path."}
   * @paramDef {"type":"Boolean","label":"Merge","name":"merge","uiComponent":{"type":"TOGGLE"},"description":"Whether to evaluate merge tags in the message."}
   * @paramDef {"type":"String","label":"Merge Language","name":"merge_language","uiComponent":{"type":"DROPDOWN","options":{"values":["mailchimp","handlebars"]}},"description":"Merge tag language for evaluating merge tags, either 'mailchimp' or 'handlebars'."}
   * @paramDef {"type":"Array.<GlobalMergeVar>","label":"Global Merge Vars","name":"global_merge_vars","description":"Global merge variables for all recipients, can be overridden per recipient."}
   * @paramDef {"type":"Array.<MergeVar>","label":"Merge Vars","name":"merge_vars","description":"Per-recipient merge variables, override global merge vars with the same name."}
   * @paramDef {"type":"Array.<String>","label":"Tags","name":"tags","description":"Tags for the message, used for stats."}
   * @paramDef {"type":"String","label":"Subaccount","name":"subaccount","description":"Unique id of a subaccount for this message, must already exist."}
   * @paramDef {"type":"Array.<String>","label":"Google Analytics Domains","name":"google_analytics_domains","description":"Domains for which Google Analytics parameters will be appended to URLs."}
   * @paramDef {"type":"String","label":"Google Analytics Campaign","name":"google_analytics_campaign","description":"Value for utm_campaign tracking parameter, defaults to email's from address if not provided."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Associative array of user metadata, stored and searchable using the Mandrill search API."}
   * @paramDef {"type":"Array.<RecipientMetadata>","label":"Recipient Metadata","name":"recipient_metadata","description":"Per-recipient metadata that overrides global values specified in metadata."}
   * @paramDef {"type":"Array.<Attachment>","label":"Attachments","name":"attachments","description":"An array of supported attachments to add to the message."}
   * @paramDef {"type":"Array.<Image>","label":"Images","name":"images","description":"An array of embedded images to add to the message."}
   * @paramDef {"type":"Boolean","label":"Async","name":"async","uiComponent":{"type":"TOGGLE"},"description":"Enable a background sending mode that is optimized for bulk sending. In async mode, messages/send will immediately return a status of 'queued' for every recipient. To handle rejections when sending in async mode, set up a webhook for the 'reject' event. Defaults to 'false' for messages with no more than 10 recipients; messages with more than 10 recipients are always sent asynchronously, regardless of the value of async."}
   * @paramDef {"type":"String","label":"IP Pool","name":"ip_pool","description":"The name of the dedicated ip pool that should be used to send the message. If you do not have any dedicated IPs, this parameter has no effect. If you specify a pool that does not exist, your default pool will be used instead."}
   * @paramDef {"type":"String","label":"Send At","name":"send_at","description":"When this message should be sent as a UTC timestamp in YYYY-MM-DD HH:MM:SS format. If you specify a time in the past, the message will be sent immediately; for future dates, you're limited to one year from the date of scheduling."}
   *
   * @returns {SendMessageResponse[]} An array of objects for each recipient containing the key 'email' with the email address, and details of the message status for that recipient. The sending results for a single recipient.
   * @sampleResult [{"email":"user@example.com","status":"sent","reject_reason":"hard-bounce","queued_reason":"attachments","_id":"string"}]
   */
  sendWithTemplate(
    template_name,
    template_content,
    subject,
    from_email,
    from_name,
    to,
    html,
    text,
    headers,
    important,
    track_opens,
    track_clicks,
    auto_text,
    auto_html,
    inline_css,
    url_strip_qs,
    preserve_recipients,
    view_content_link,
    bcc_address,
    tracking_domain,
    signing_domain,
    return_path_domain,
    merge,
    merge_language,
    global_merge_vars,
    merge_vars,
    tags,
    subaccount,
    google_analytics_domains,
    google_analytics_campaign,
    metadata,
    recipient_metadata,
    attachments,
    images,
    async,
    ip_pool,
    send_at
  ) {
    const message = clean({
      subject,
      from_email,
      from_name,
      to,
      html,
      text,
      headers,
      important,
      track_opens,
      track_clicks,
      auto_text,
      auto_html,
      inline_css,
      url_strip_qs,
      preserve_recipients,
      view_content_link,
      bcc_address,
      tracking_domain,
      signing_domain,
      return_path_domain,
      merge,
      merge_language,
      global_merge_vars,
      merge_vars,
      tags,
      subaccount,
      google_analytics_domains,
      google_analytics_campaign,
      metadata,
      recipient_metadata,
      attachments,
      images,
    })

    return this.#apiRequest({ 
      url: `${ API_BASE_URL }/messages/send-template.json`, 
      body: {
        template_name,
        template_content,
        message,
        async,
        ip_pool,
        send_at,
      },
      logTag: 'sendWithTemplate', 
    })
  }

  /**
   * @typedef {Object} Tag
   * @property {String} tag - The actual tag as a string.
   * @property {String} reputation - The tag's current reputation on a scale from 0 to 100.
   * @property {String} sent - The total number of messages sent with this tag.
   * @property {Number} hard_bounces - The total number of hard bounces by messages with this tag.
   * @property {Number} soft_bounces - The total number of soft bounces by messages with this tag.
   * @property {Number} rejects - The total number of rejected messages with this tag.
   * @property {Number} complaints - The total number of spam complaints received for messages with this tag.
   * @property {Number} unsubs - The total number of unsubscribe requests received for messages with this tag.
   * @property {Number} opens - The total number of times messages with this tag have been opened.
   * @property {Number} clicks - The total number of times tracked URLs in messages with this tag have been clicked.
   * @property {Number} unique_opens - The number of unique opens for emails sent with this tag.
   * @property {Number} unique_clicks - The number of unique clicks for emails sent with this tag.
   */

  /**
   * @description Returns all of the user-defined tag information. Tags help categorize and track the performance of your email campaigns with detailed analytics and statistics.
   *
   * @route GET /tags-list
   * @operationName Get Tags List
   * @category Analytics
   * @appearanceColor #ed9d4a #8f202f
   * @executionTimeoutInSeconds 120
   *
   * @returns {Tag[]} A list of user-defined tags.
   * @sampleResult [{"tag":"string","reputation":0,"sent":0,"hard_bounces":0,"soft_bounces":0,"rejects":0,"complaints":0,"unsubs":0,"opens":0,"clicks":0,"unique_opens":0,"unique_clicks":0}]
   */
  getTagsList() {
    return this.#apiRequest({ 
      url: `${ API_BASE_URL }/tags/list.json`, 
      logTag: 'getTagsList', 
    })
  }

  /**
   * @typedef {Object} OpenDetail
   * @property {Number} ts - The unix timestamp from when the message was opened.
   * @property {String} ip - The IP address that generated the open.
   * @property {String} location - The approximate region and country that the opening IP is located.
   * @property {String} ua - The email client or browser data of the open.
   */

  /**
   * @typedef {Object} ClickDetail
   * @property {Number} ts - The unix timestamp from when the message was clicked
   * @property {String} url - The URL that was clicked on.
   * @property {String} ip - The IP address that generated the click.
   * @property {String} location - The approximate region and country that the clicking IP is located.
   * @property {String} ua - The email client or browser data of the click.
   */

  /**
   * @typedef {Object} SmtpEvent
   * @property {Number} ts - The Unix timestamp when the event occurred.
   * @property {String} type - The message's state as a result of this event.
   * @property {String} diag - The SMTP response from the recipient's server.
   */

  /**
   * @typedef {Object} MessageInfo
   * @property {String} ts - The Unix timestamp from when this message was sent.
   * @property {String} _id - The message's unique id.
   * @property {String} sender - The email address of the sender.
   * @property {String} template - The unique name of the template used, if any.
   * @property {String} subject - The message's subject line.
   * @property {String} email - The recipient email address.
   * @property {Array.<String>} tags - List of tags on this message.
   * @property {Number} opens - How many times has this message been opened.
   * @property {Array.<OpenDetail>} opens_detail - List of individual opens for the message.
   * @property {Number} clicks - How many times has a link been clicked in this message.
   * @property {Array.<ClickDetail>} clicks_detail - List of individual clicks for the message.
   * @property {String} state - Sending status of this message Possible values: 'sent', 'bounced', or 'rejected'.
   * @property {Object} metadata - Any custom metadata provided when the message was sent.
   * @property {Array.<SmtpEvent>} smtp_events - A log of up to 3 smtp events for the message.
   */

  /**
   * @description Gets the information for a single recently sent message. Provides detailed tracking data including opens, clicks, and delivery status for message analysis and troubleshooting.
   *
   * @route GET /message-info
   * @operationName Get Message Info
   * @category Message Tracking
   * @appearanceColor #ed9d4a #8f202f
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"ID","name":"id","required":true,"description":"The unique id of the message to get - passed as the '_id' field in webhooks, send calls, or search calls."}
   *
   * @returns {MessageInfo} The information for the message.
   * @sampleResult {"ts":0,"_id":"string","sender":"user@example.com","template":"string","subject":"string","email":"user@example.com","tags":["string"],"opens":0,"opens_detail":[{"ts":0,"ip":"string","location":"string","ua":"string"}],"clicks":0,"clicks_detail":[{"ts":0,"url":"string","ip":"string","location":"string","ua":"string"}],"state":"sent","metadata":{},"smtp_events":[{"ts":0,"type":"string","diag":"string"}]}
   */
  getMessageInfo(id) {
    return this.#apiRequest({ 
      url: `${ API_BASE_URL }/messages/info.json`, 
      body: { id },
      logTag: 'getMessageInfo', 
    })
  }

  /**
   * @description Validates an API key and respond to a ping. This is a simple health check method to verify your API connection and credentials are working correctly.
   *
   * @route GET /ping
   * @operationName Ping
   * @category Account Management
   * @appearanceColor #ed9d4a #8f202f
   * @executionTimeoutInSeconds 120
   *
   * @returns {String} The string 'PONG!'
   * @sampleResult "PONG!"
   */
  ping() {
    return this.#apiRequest({ 
      url: `${ API_BASE_URL }/users/ping.json`, 
      logTag: 'ping', 
    })
  }

  /**
   * @typedef {Object} Sender
   * @property {String} address - The sender's email address.
   * @property {String} created_at - The date and time that the sender was first seen by Mandrill as a UTC date string in YYYY-MM-DD HH:MM:SS format.
   * @property {Number} sent - The total number of messages sent by this sender.
   * @property {Number} hard_bounces - The total number of hard bounces by messages by this sender.
   * @property {Number} soft_bounces - The total number of soft bounces by messages by this sender.
   * @property {Number} rejects - The total number of rejected messages by this sender.
   * @property {Number} complaints - The total number of spam complaints received for messages by this sender.
   * @property {Number} unsubs - The total number of unsubscribe requests received for messages by this sender.
   * @property {Number} opens - The total number of times messages by this sender have been opened.
   * @property {Number} clicks - The total number of times tracked URLs in messages by this sender have been clicked.
   * @property {Number} unique_opens - The number of unique opens for emails sent for this sender.
   * @property {Number} unique_clicks - The number of unique clicks for emails sent for this sender.
   */

  /**
   * @typedef {Object} Rejection
   * @property {String} email - The email that is blocked.
   * @property {String} reason - The type of event (hard-bounce, soft-bounce, spam, unsub, custom) that caused this rejection.
   * @property {String} detail - Extended details about the event, such as the SMTP diagnostic for bounces or the comment for manually-created rejections.
   * @property {String} created_at - When the email was added to the denylist.
   * @property {String} last_event_at - The timestamp of the most recent event that either created or renewed this rejection.
   * @property {String} expires_at - When the denylist entry will expire (this may be in the past).
   * @property {Boolean} expired - Whether the denylist entry has expired.
   * @property {Sender} sender - The sender that this denylist entry applies to, or null if none.
   * @property {String} subaccount - The subaccount that this denylist entry applies to, or null if none.
   */

  /**
   * @description Retrieves your email rejection denylist. You can provide an email address to limit the results. Returns up to 1000 results with detailed rejection reasons and timestamps for managing email deliverability.
   *
   * @route GET /rejections-list
   * @operationName Get Rejections List
   * @category Rejection Management
   * @appearanceColor #ed9d4a #8f202f
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"An optional email address to search by."}
   * @paramDef {"type":"Boolean","label":"Include Expired","name":"include_expired","uiComponent":{"type":"TOGGLE"},"description":"Whether to include rejections that have already expired."}
   * @paramDef {"type":"String","label":"Subaccount","name":"subaccount","description":"An optional unique identifier for the subaccount to limit the denylist."}
   *
   * @returns {Rejection[]} The information for each rejection entry.
   * @sampleResult [{"email":"user@example.com","reason":"string","detail":"string","created_at":"2019-08-24T14:15:22Z","last_event_at":"2019-08-24T14:15:22Z","expires_at":"2019-08-24T14:15:22Z","expired":true,"sender":{"address":"user@example.com","created_at":"2019-08-24T14:15:22Z","sent":0,"hard_bounces":0,"soft_bounces":0,"rejects":0,"complaints":0,"unsubs":0,"opens":0,"clicks":0,"unique_opens":0,"unique_clicks":0},"subaccount":"string"}]
   */
  getRejectionsList(email, include_expired, subaccount) {
    return this.#apiRequest({ 
      url: `${ API_BASE_URL }/rejects/list.json`, 
      body: { email, include_expired, subaccount },
      logTag: 'getRejectionsList', 
    })
  }

  /**
   * @typedef {Object} AddRejectionStatus
   * @property {String} email - The email address you provided.
   * @property {Boolean} added - Whether the operation succeeded.
   */

  /**
   * @description Adds an email to your email rejection denylist. Addresses that you add manually will never expire and there is no reputation penalty for removing them from your denylist.
   *
   * @route POST /add-rejection
   * @operationName Add Rejection
   * @category Rejection Management
   * @appearanceColor #ed9d4a #8f202f
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"An email address to block."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","description":"An optional comment describing the rejection."}
   * @paramDef {"type":"String","label":"Subaccount","name":"subaccount","description":"An optional unique identifier for the subaccount to limit the denylist entry."}
   *
   * @returns {AddRejectionStatus} A status object containing the address and the result of the operation.
   * @sampleResult {"email":"user@example.com","added":true}
   */
  addRejection(email, comment, subaccount) {
    return this.#apiRequest({ 
      url: `${ API_BASE_URL }/rejects/add.json`, 
      body: { email, comment, subaccount },
      logTag: 'addRejection', 
    })
  }

  /**
   * @typedef {Object} TodayStats
   * @property {Number} sent - The number of emails sent for this user so far today.
   * @property {Number} hard_bounces - The number of emails hard bounced for this user so far today.
   * @property {Number} soft_bounces - The number of emails soft bounced for this user so far today.
   * @property {Number} rejects - The number of emails rejected for sending this sender so far today.
   * @property {Number} complaints - The number of spam complaints for this user so far today.
   * @property {Number} unsubs - The number of unsubscribes for this user so far today.
   * @property {Number} opens - The number of times emails have been opened for this user so far today.
   * @property {Number} unique_opens - The number of unique opens for emails sent for this user so far today.
   * @property {Number} clicks - The number of URLs that have been clicked for this user so far today.
   * @property {Number} unique_clicks - The number of unique clicks for emails sent for this user so far today.
   */

  /**
   * @typedef {Object} LastWeekStats
   * @property {Number} sent - The number of emails sent for this user in the last 7 days.
   * @property {Number} hard_bounces - The number of emails hard bounced for this user in the last 7 days.
   * @property {Number} soft_bounces - The number of emails soft bounced for this user in the last 7 days.
   * @property {Number} rejects - The number of emails rejected for sending this sender in the last 7 days.
   * @property {Number} complaints - The number of spam complaints for this user in the last 7 days.
   * @property {Number} unsubs - The number of unsubscribes for this user in the last 7 days.
   * @property {Number} opens - The number of times emails have been opened for this user in the last 7 days.
   * @property {Number} unique_opens - The number of unique opens for emails sent for this user in the last 7 days.
   * @property {Number} clicks - The number of URLs that have been clicked for this user in the last 7 days.
   * @property {Number} unique_clicks - The number of unique clicks for emails sent for this user in the last 7 days.
   */

  /**
   * @typedef {Object} LastMonthStats
   * @property {Number} sent - The number of emails sent for this user in the last 30 days.
   * @property {Number} hard_bounces - The number of emails hard bounced for this user in the last 30 days.
   * @property {Number} soft_bounces - The number of emails soft bounced for this user in the last 30 days.
   * @property {Number} rejects - The number of emails rejected for sending this sender in the last 30 days.
   * @property {Number} complaints - The number of spam complaints for this user in the last 30 days.
   * @property {Number} unsubs - The number of unsubscribes for this user in the last 30 days.
   * @property {Number} opens - The number of times emails have been opened for this user in the last 30 days.
   * @property {Number} unique_opens - The number of unique opens for emails sent for this user in the last 30 days.
   * @property {Number} clicks - The number of URLs that have been clicked for this user in the last 30 days.
   * @property {Number} unique_clicks - The number of unique clicks for emails sent for this user in the last 30 days.
   */

  /**
   * @typedef {Object} LastTwoMonthsStats
   * @property {Number} sent - The number of emails sent for this user in the last 60 days.
   * @property {Number} hard_bounces - The number of emails hard bounced for this user in the last 60 days.
   * @property {Number} soft_bounces - The number of emails soft bounced for this user in the last 60 days.
   * @property {Number} rejects - The number of emails rejected for sending this sender in the last 60 days.
   * @property {Number} complaints - The number of spam complaints for this user in the last 60 days.
   * @property {Number} unsubs - The number of unsubscribes for this user in the last 60 days.
   * @property {Number} opens - The number of times emails have been opened for this user in the last 60 days.
   * @property {Number} unique_opens - The number of unique opens for emails sent for this user in the last 60 days.
   * @property {Number} clicks - The number of URLs that have been clicked for this user in the last 60 days.
   * @property {Number} unique_clicks - The number of unique clicks for emails sent for this user in the last 60 days.
   */

  /**
   * @typedef {Object} LastThreeMonthsStats
   * @property {Number} sent - The number of emails sent for this user in the last 90 days.
   * @property {Number} hard_bounces - The number of emails hard bounced for this user in the last 90 days.
   * @property {Number} soft_bounces - The number of emails soft bounced for this user in the last 90 days.
   * @property {Number} rejects - The number of emails rejected for sending this sender in the last 90 days.
   * @property {Number} complaints - The number of spam complaints for this user in the last 90 days.
   * @property {Number} unsubs - The number of unsubscribes for this user in the last 90 days.
   * @property {Number} opens - The number of times emails have been opened for this user in the last 90 days.
   * @property {Number} unique_opens - The number of unique opens for emails sent for this user in the last 90 days.
   * @property {Number} clicks - The number of URLs that have been clicked for this user in the last 90 days.
   * @property {Number} unique_clicks - The number of unique clicks for emails sent for this user in the last 90 days.
   */

  /**
   * @typedef {Object} AllTimeStats
   * @property {Number} sent - The number of emails sent in the lifetime of the user's account.
   * @property {Number} hard_bounces - The number of emails hard bounced in the lifetime of the user's account.
   * @property {Number} soft_bounces - The number of emails soft bounced in the lifetime of the user's account.
   * @property {Number} rejects - The number of emails rejected for sending this user so far today.
   * @property {Number} complaints - The number of spam complaints in the lifetime of the user's account.
   * @property {Number} unsubs - The number of unsubscribes in the lifetime of the user's account.
   * @property {Number} opens - The number of times emails have been opened in the lifetime of the user's account.
   * @property {Number} unique_opens - The number of unique opens for emails sent in the lifetime of the user's account.
   * @property {Number} clicks - The number of URLs that have been clicked in the lifetime of the user's account.
   * @property {Number} unique_clicks - The number of unique clicks for emails sent in the lifetime of the user's account.
   */

  /**
   * @typedef {Object} Stats
   * @property {TodayStats} today - Stats for this user so far today.
   * @property {LastWeekStats} last_7_days - Stats for this user in the last 7 days.
   * @property {LastMonthStats} last_30_days - Stats for this user in the last 30 days.
   * @property {LastTwoMonthsStats} last_60_days - Stats for this user in the last 60 days.
   * @property {LastThreeMonthsStats} last_90_days - Stats for this user in the last 90 days.
   * @property {AllTimeStats} all_time - Stats for the lifetime of the user's account.
   */

  /**
   * @typedef {Object} UserInfo
   * @property {String} username - The username of the user (used for SMTP authentication).
   * @property {String} created_at - The date and time that the user's Mandrill account was created as a UTC string in YYYY-MM-DD HH:MM:SS format.
   * @property {String} public_id - A unique, permanent identifier for this user.
   * @property {Number} reputation - The reputation of the user on a scale from 0 to 100, with 75 generally being a 'good' reputation.
   * @property {Number} hourly_quota - The maximum number of emails Mandrill will deliver for this user each hour. Any emails beyond that will be accepted and queued for later delivery. Users with higher reputations will have higher hourly quotas.
   * @property {Number} backlog - The number of emails that are queued for delivery due to exceeding your monthly or hourly quotas.
   * @property {Stats} stats - An aggregate summary of the account's sending stats.
   */

  /**
   * @description Returns the information about the API-connected user. Provides account details including reputation score, sending quotas, and comprehensive historical statistics across different time periods.
   *
   * @route GET /user-info
   * @operationName Get User Info
   * @category Account Management
   * @appearanceColor #ed9d4a #8f202f
   * @executionTimeoutInSeconds 120
   *
   * @returns {UserInfo} The user information including username, key, reputation, quota, and historical sending stats.
   * @sampleResult {"username":"string","created_at":"string","public_id":"string","reputation":0,"hourly_quota":0,"backlog":0,"stats":{"today":{"sent":0,"hard_bounces":0,"soft_bounces":0,"rejects":0,"complaints":0,"unsubs":0,"opens":0,"unique_opens":0,"clicks":0,"unique_clicks":0},"last_7_days":{"sent":0,"hard_bounces":0,"soft_bounces":0,"rejects":0,"complaints":0,"unsubs":0,"opens":0,"unique_opens":0,"clicks":0,"unique_clicks":0},"last_30_days":{"sent":0,"hard_bounces":0,"soft_bounces":0,"rejects":0,"complaints":0,"unsubs":0,"opens":0,"unique_opens":0,"clicks":0,"unique_clicks":0},"last_60_days":{"sent":0,"hard_bounces":0,"soft_bounces":0,"rejects":0,"complaints":0,"unsubs":0,"opens":0,"unique_opens":0,"clicks":0,"unique_clicks":0},"last_90_days":{"sent":0,"hard_bounces":0,"soft_bounces":0,"rejects":0,"complaints":0,"unsubs":0,"opens":0,"unique_opens":0,"clicks":0,"unique_clicks":0},"all_time":{"sent":0,"hard_bounces":0,"soft_bounces":0,"rejects":0,"complaints":0,"unsubs":0,"opens":0,"unique_opens":0,"clicks":0,"unique_clicks":0}}}
   */
  getUserInfo() {
    return this.#apiRequest({ 
      url: `${ API_BASE_URL }/users/info.json`, 
      logTag: 'getUserInfo', 
    })
  }
}

Flowrunner.ServerCode.addService(MailchimpTransactionalService, [
  {
    order: 0,
    displayName: 'Mandrill API Key',
    name: 'mandrillApiKey',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    hint: 'Your Mandrill API key. Ensure you have a Standard or Premium Mailchimp plan, as the Mandrill add-on is only available on these paid plans.',
    required: true,
  },
])
