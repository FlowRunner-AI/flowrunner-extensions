'use strict'

const logger = {
  info: (...args) => console.log('[ClickSend Service] info:', ...args),
  debug: (...args) => console.log('[ClickSend Service] debug:', ...args),
  error: (...args) => console.log('[ClickSend Service] error:', ...args),
  warn: (...args) => console.log('[ClickSend Service] warn:', ...args),
}

/**
 * @integrationName ClickSend
 * @integrationIcon /icon.svg
 **/
class ClickSend {
  constructor({ username, apiKey }) {
    this.auth = Buffer.from(`${ username }:${ apiKey }`).toString('base64')
  }

  async #apiRequest({ method, endpoint, query, payload }) {
    const BASE_URL = 'https://rest.clicksend.com/v3'
    const logTag = 'apiRequest'

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ BASE_URL + endpoint }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](BASE_URL + endpoint)
        .set({
          Authorization: `Basic ${ this.auth }`,
          'Content-Type': 'application/json',
        })
        .query(query)
        .send(payload)
    } catch (error) {
      logger.error(`${ logTag } - API request failed:`, error.message)
      throw error
    }
  }

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   * @property {String} [cursor]
   * @property {Object} [criteria]
   */

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   * @property {Object} criteria
   */

  /**
   * @operationName Get Sender ID Groups Dictionary
   * @description Get available sender ID groups including Dedicated Numbers, Alpha Tags, and Own Numbers.
   * @route POST /get-sender-id-groups-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Dedicated Numbers","value":"Dedicated Numbers","note":"Purchased business phone numbers."}]}
   */
  getSenderIDgroupsDictionary() {
    return {
      items: [
        {
          label: 'Dedicated Numbers',
          note: 'Purchased business phone numbers.',
          value: 'Dedicated Numbers',
        },
        {
          label: 'Alpha Tags',
          note: 'The sender\'s name, such as your company name, used as the sender ID instead of a phone number.',
          value: 'Alpha Tags',
        },
        {
          label: 'Own numbers',
          note: 'Your own mobile numbers.',
          value: 'Own numbers',
        },
      ],
    }
  }

  /**
   * @operationName Get Sender Contacts Dictionary
   * @description Get available sender contacts based on the selected sender ID group (Alpha Tags, Own Numbers, or Dedicated Numbers).
   * @route POST /get-sender-contacts-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getSenderContactsDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"+14035554422","value":"+14035554422","note":"Your Dedicated Number"}]}
   */
  async getSenderContactsDictionary(payload) {
    const { search, criteria } = payload || {}
    const PAGE_SIZE = 50
    const groupName = criteria.senderIDgroup
    let outputItems = []

    if (groupName === 'Alpha Tags') {
      const query = { page_size: PAGE_SIZE }
      const response = await this.#apiRequest({
        method: 'get',
        endpoint: '/alpha-tags',
        query: query,
        payload: null,
      })

      if (response.alpha_tags && response.alpha_tags.length) {
        outputItems = response.alpha_tags.map(alphaTagItem => {
          return {
            label: alphaTagItem.alpha_tag,
            note: 'Your Alpha Tag',
            value: alphaTagItem.alpha_tag,
          }
        })
      }
    }

    if (groupName === 'Own numbers') {
      const query = { page_size: PAGE_SIZE }
      const response = await this.#apiRequest({
        method: 'get',
        endpoint: '/own-numbers',
        query: query,
        payload: null,
      })

      if (response.own_numbers && response.own_numbers.length) {
        outputItems = response.own_numbers.map(ownerNumberItem => {
          return {
            label: ownerNumberItem.phone_number,
            note: 'My phone number',
            value: ownerNumberItem.phone_number,
          }
        })
      }
    }

    if (groupName === 'Dedicated Numbers') {
      const query = { page_size: PAGE_SIZE }
      const response = await this.#apiRequest({
        method: 'get',
        endpoint: '/numbers',
        query: query,
        payload: null,
      })

      if (response.data && response.data.data) {
        outputItems = response.data.data.map(numberItem => {
          return {
            label: numberItem.dedicated_number,
            note: 'Your Dedicated Number',
            value: numberItem.dedicated_number,
          }
        })
      }
    }

    if (search) {
      outputItems = outputItems.filter(item => item.value.toLowerCase().includes(search.toLowerCase()))
    }

    return {
      items: outputItems,
    }
  }

  /**
   * @operationName Get Contact Lists Dictionary
   * @description Get available contact lists with pagination support.
   * @route POST /get-contact-lists-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getContactListsDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"SMS List","value":2932037,"note":"ID: 2932037"}],"cursor":null}
   */
  async getContactListsDictionary(payload) {
    payload = payload || {}

    let cursor = payload.cursor

    const query = cursor ? { limit: 15, page: cursor } : { limit: 15 }
    let outputItems = []
    const response = await this.#apiRequest({
      method: 'get',
      endpoint: '/lists',
      query: query,
      payload: null,
    })

    if (response.data && response.data.total && response.data.data) {
      cursor = response.data.next_page_url ? response.data.current_page + 1 : null

      outputItems = response.data.data.map(item => {
        return {
          label: item.list_name,
          note: `ID: ${ item.list_id }`,
          value: item.list_id,
        }
      })
    }

    return {
      cursor,
      items: outputItems,
    }
  }

  /**
   * @operationName Get List Contacts Dictionary
   * @description Get contacts from a specific contact list with pagination support.
   * @route POST /get-list-contacts-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getListContactsDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"John Smith","value":1217715665,"note":"ID: 1217715665"}],"cursor":null}
   */
  async getListContactsDictionary(payload) {
    payload = payload || {}

    let cursor = payload.cursor
    const criteria = payload.criteria

    let outputItems = []
    const listId = criteria.list_id
    const query = cursor ? { limit: 25, page: cursor } : { limit: 25 }

    const response = await this.#apiRequest({
      method: 'get',
      endpoint: `/lists/${ listId }/contacts`,
      query: query,
      payload: null,
    })

    if (response.data && response.data.total && response.data.data) {
      cursor = response.data.next_page_url ? response.data.current_page + 1 : null

      outputItems = response.data.data.map(item => {
        let outputLabel = ''

        if (item.first_name || item.last_name) {
          outputLabel = item.first_name + ' ' + item.last_name
        } else {
          outputLabel = item.phone_number || item.email || item.fax_number
        }

        return {
          label: outputLabel,
          note: `ID: ${ item.contact_id }`,
          value: item.contact_id,
        }
      })
    }

    return {
      cursor,
      items: outputItems,
    }
  }

  /**
   * @operationName Get Contact Details Dictionary
   * @description Get contact details including phone numbers, fax, and email for a specific contact.
   * @route POST /get-contact-details-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getContactDetailsDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Mobile Phone Number","value":"+61444444444","note":"+61444444444"}]}
   */
  async getContactDetailsDictionary(payload) {
    const { criteria } = payload || {}
    const listId = criteria.list_id
    const contactId = criteria.contact_id
    let outputItems = []

    const response = await this.#apiRequest({
      method: 'get',
      endpoint: `/lists/${ listId }/contacts/${ contactId }`,
      query: null,
      payload: null,
    })

    if (response.data) {
      outputItems = [
        {
          label: 'Mobile Phone Number',
          note: response.data.phone_number,
          value: response.data.phone_number,
        },
        {
          label: 'Fax Number',
          note: response.data.fax_number,
          value: response.data.fax_number,
        },
        {
          label: 'Email Address',
          note: response.data.email,
          value: response.data.email,
        },
      ]
    }

    return { items: outputItems }
  }

  /**
   * @operationName Get Return Addresses Dictionary
   * @description Get available return addresses for postal services with pagination support.
   * @route POST /get-return-addresses-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getReturnAddressesDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"John Smith","value":710199,"note":"ID: 710199"}],"cursor":null}
   */
  async getReturnAddressesDictionary(payload) {
    payload = payload || {}

    let cursor = payload.cursor
    let outputItems = []
    const query = cursor ? { limit: 15, page: cursor } : { limit: 15 }

    const response = await this.#apiRequest({
      method: 'get',
      endpoint: '/post/return-addresses',
      query: query,
      payload: null,
    })

    if (response.data && response.data.data && response.data.data.length) {
      cursor = response.data.next_page_url ? response.data.current_page + 1 : null

      outputItems = response.data.data.map(item => {
        return {
          label: item.address_name,
          note: `ID: ${ item.return_address_id }`,
          value: item.return_address_id,
        }
      })
    }

    return { items: outputItems, cursor }
  }

  /**
   * @operationName Get Voice Languages Dictionary
   * @description Get available languages for text-to-speech voice messages.
   * @route POST /get-voice-languages-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"English","value":"en-us","note":"en-us"}]}
   */
  async getVoiceLanguagesDictionary() {
    let outputItems = []
    const response = await this.#apiRequest({
      method: 'get',
      endpoint: '/voice/lang',
      query: null,
      payload: null,
    })

    if (response && response.data) {
      outputItems = response.data.map(item => {
        return {
          label: item.country,
          note: item.code,
          value: item.code,
        }
      })
    }

    return { items: outputItems }
  }

  /**
   * @operationName Get HTTP Methods Dictionary
   * @description Get available HTTP methods for raw API requests.
   * @route POST /get-http-methods-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"GET","value":"GET","note":"id: GET"}]}
   */
  getHttpMethodsDictionary() {
    return {
      items: [
        {
          label: 'GET',
          note: 'id: GET',
          value: 'GET',
        },
        {
          label: 'POST',
          note: 'id: POST',
          value: 'POST',
        },
        {
          label: 'PUT',
          note: 'id: PUT',
          value: 'PUT',
        },
        {
          label: 'PATCH',
          note: 'id: PATCH',
          value: 'PATCH',
        },
        {
          label: 'DELETE',
          note: 'id: DELETE',
          value: 'DELETE',
        },
      ],
    }
  }

  /**
   * @description Send SMS to one recipient with optional scheduling and sender customization.
   * @route POST /send-sms
   *
   * @operationName Send SMS
   * @category Messaging
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"The phone number of the recipient. It should be in the international format (E.164). Eg: +447777777777"}
   * @paramDef {"type":"String","label":"Message","name":"body","required":true,"description":"The text of the message that will be sent."}
   * @paramDef {"type":"String","label":"Sender's Contact Group","name":"senderIDgroup","required":false,"dictionary":"getSenderIDgroupsDictionary","description":"Sender's contact group. This can be: Alpha Tags, Dedicated Numbers, Own Numbers. Leave this field blank if you want the ClickSend service to automatically select a shared phone number for you."}
   * @paramDef {"type":"String","label":"From","name":"from","required":false,"dictionary":"getSenderContactsDictionary","dependsOn":["senderIDgroup"],"description":"The specific contact of the sender from which the message will be sent. This can be a Dedicated number, Alpha tag, Own number. Leave this field blank if you want the ClickSend service to automatically select a shared phone number for you. The phone number here must be in international format (E.164). Eg: +447777777777"}
   * @paramDef {"type":"Number","label":"Schedule","name":"schedule","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"The date you want the message to be sent. It should be in Unix format. If this field is left blank the message will be sent immediately."}
   * @paramDef {"type":"String","label":"Custom String","name":"custom_string","required":false,"description":"This is your reference. It will appear on all delivery reports and be included in all replies."}
   *
   * @returns {Object}
   * @sampleResult {"date":1735439385,"country":"GB","message_parts":0,"message_price":"0.0000","from_email":null,"list_id":null,"is_shared_system_number":true,"message_id":"1EFC58CC-4ADA-6680-BD8D-C3672D07D82A","currency_name_short":"CAD","body":"Test message","contact_id":null,"custom_string":"Test custom string","schedule":1735628400000,"carrier":"EE","user_id":999999,"from":"+447908661625","subaccount_id":643519,"to":"+447777777777","direction":"out","status":"SUCCESS"}
   */
  async sendSms(to, body, senderIDgroup, from, schedule, custom_string) {
    try {
      const response = await this.#apiRequest({
        method: 'post',
        endpoint: '/sms/send',
        query: null,
        payload: { messages: [{ to, body, from, schedule, custom_string }] },
      })

      if (response.data && response.data.messages && response.data.messages.length) {
        const outputData = response.data.messages[0]

        if (response.data._currency) {
          outputData.currency_name_short = response.data._currency.currency_name_short
        }

        return outputData
      } else {
        return {}
      }
    } catch (error) {
      throw new Error(`Failed to send SMS: ${ error.message }`)
    }
  }

  /**
   * @description Create new contact list for organizing and managing contacts.
   * @route POST /create-contact-list
   *
   * @operationName Create Contact List
   * @category Contact Management
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Contact List Name","name":"list_name","required":true,"description":"The name of the new contact list."}
   *
   * @returns {Object}
   * @sampleResult {"_import_in_progress":0,"list_id":2912622,"_optout_in_progress":0,"list_email_id":"MTKP05JXOVVQWJSX","_contacts_count":0,"list_name":"New Test Contact List"}
   */
  async createContactList(list_name) {
    try {
      const response = await this.#apiRequest({
        method: 'post',
        endpoint: '/lists',
        query: null,
        payload: { list_name },
      })

      return response.data
    } catch (error) {
      throw new Error(`Failed to create contact list: ${ error.message }`)
    }
  }

  /**
   * @description Creates a new contact in the given contact list with comprehensive contact information.
   * @route POST /create-contact
   *
   * @operationName Create Contact
   * @category Contact Management
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Contact List ID","name":"list_id","required":true,"dictionary":"getContactListsDictionary","description":"The ID of the Contact List in which the new contact will be created."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phone_number","required":false,"description":"Contact's phone number in international format (E.164). Eg: +447777777777. Must be provided if no fax number or email."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":false,"description":"Contact's Email address. Must be provided if no phone number or fax number."}
   * @paramDef {"type":"String","label":"Fax Number","name":"fax_number","required":false,"description":"Contact's Fax Number in international format (E.164). Eg: +61262222222. Must be provided if no phone number or email."}
   * @paramDef {"type":"String","label":"First Name","name":"first_name","required":false,"description":"Contact's First Name."}
   * @paramDef {"type":"String","label":"Last Name","name":"last_name","required":false,"description":"Contact's Last Name."}
   * @paramDef {"type":"String","label":"Organization Name","name":"organization_name","required":false,"description":"Contact's Organization Name."}
   * @paramDef {"type":"String","label":"Address line 1","name":"address_line_1","required":false,"description":"Contact's Address Line."}
   * @paramDef {"type":"String","label":"Address line 2","name":"address_line_2","required":false,"description":"Contact's Address Line."}
   * @paramDef {"type":"String","label":"City","name":"address_city","required":false,"description":"Contact's Nearest City."}
   * @paramDef {"type":"String","label":"State","name":"address_state","required":false,"description":"Contact's State."}
   * @paramDef {"type":"String","label":"Postal Code","name":"address_postal_code","required":false,"description":"Contact's Postal Code."}
   * @paramDef {"type":"String","label":"Country","name":"address_country","required":false,"description":"Contact's Country Cod. There must be two characters. For example: CA, US, GB."}
   * @paramDef {"type":"String","label":"Custom 1","name":"custom_1","required":false,"description":"Contact's Custom Line."}
   * @paramDef {"type":"String","label":"Custom 2","name":"custom_2","required":false,"description":"Contact's Custom Line."}
   * @paramDef {"type":"String","label":"Custom 3","name":"custom_3","required":false,"description":"Contact's Custom Line."}
   * @paramDef {"type":"String","label":"Custom 4","name":"custom_4","required":false,"description":"Contact's Custom Line."}
   *
   * @returns {Object}
   * @sampleResult {"custom_1":"Custom line 1","date_updated":1734454443,"list_id":2913405,"custom_3":"Custom line 3","custom_2":"Custom line 2","address_postal_code":"XXXXXX","_list_name":"Contact list #1","address_country":"CA","custom_4":"Custom line 4","address_state":"Ontario","last_name":"Smith","organization_name":"ABC Inc.","contact_id":1211152419,"fax_number":"+14035555555","address_city":"Toronto","date_added":1734454443,"address_line_1":"5000","phone_number":"+14039999999","address_line_2":"4000 40 Ave NW","first_name":"John","email":"test@mail.us"}
   */
  async createContact(
    list_id,
    phone_number,
    email,
    fax_number,
    first_name,
    last_name,
    organization_name,
    address_line_1,
    address_line_2,
    address_city,
    address_state,
    address_postal_code,
    address_country,
    custom_1,
    custom_2,
    custom_3,
    custom_4
  ) {
    const response = await this.#apiRequest({
      method: 'post',
      endpoint: `/lists/${ list_id }/contacts`,
      query: null,
      payload: {
        phone_number,
        email,
        fax_number,
        first_name,
        last_name,
        organization_name,
        address_line_1,
        address_line_2,
        address_city,
        address_state,
        address_postal_code,
        address_country,
        custom_1,
        custom_2,
        custom_3,
        custom_4,
      },
    })

    return response.data
  }

  /**
   * @description Delete a specific contact from the list permanently.
   * @route DELETE /delete-contact
   *
   * @operationName Delete Contact
   * @category Contact Management
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Contact List ID","name":"list_id","required":true,"dictionary":"getContactListsDictionary","description":"The ID of the contact list from which the specified contact will be deleted."}
   * @paramDef {"type":"Number","label":"Contact ID","name":"contact_id","required":true,"dictionary":"getListContactsDictionary","dependsOn":["list_id"],"description":"The ID of the contact to be deleted."}
   *
   * @returns {Number}
   * @sampleResult 1211152419
   */
  async deleteContact(list_id, contact_id) {
    await this.#apiRequest({
      method: 'delete',
      endpoint: `/lists/${ list_id }/contacts/${ contact_id }`,
      query: null,
      payload: null,
    })

    return contact_id
  }

  /**
   * @description Delete a specific contact list permanently.
   * @route DELETE /delete-contact-list
   *
   * @operationName Delete Contact List
   * @category Contact Management
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Contact List ID","name":"list_id","required":true,"dictionary":"getContactListsDictionary","description":"The ID of the contact list to be deleted"}
   *
   * @returns {Number}
   * @sampleResult 1211152419
   */
  async deleteContactList(list_id) {
    await this.#apiRequest({
      method: 'delete',
      endpoint: `/lists/${ list_id }`,
      query: null,
      payload: null,
    })

    return list_id
  }

  /**
   * @description Create SMS Campaign allows you to create and send up to 20,000 SMS messages to users from one contact list in a single API call. If the 'Schedule' input field is left empty, the SMS campaign will be sent immediately.
   * @route POST /create-sms-campaign
   *
   * @operationName Create SMS Campaign
   * @category Campaigns
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"SMS Campaign Name","name":"name","required":true,"description":"The SMS campaign name."}
   * @paramDef {"type":"Number","label":"Contact List ID","name":"list_id","required":true,"dictionary":"getContactListsDictionary","description":"The ID of the contact list to which the message will be sent."}
   * @paramDef {"type":"String","label":"Sender's Contact Group","name":"senderIDgroup","required":true,"dictionary":"getSenderIDgroupsDictionary","description":"This can be: Alpha Tags, Dedicated Numbers, Own Numbers. Leave this field blank if you want the ClickSend service to automatically select a shared phone number for you."}
   * @paramDef {"type":"String","label":"From","name":"from","required":true,"dictionary":"getSenderContactsDictionary","dependsOn":["senderIDgroup"],"description":"The specific contact of the sender from which the SMS campaign will be sent. This can be a Dedicated number, Alpha tag, Own number. Leave this field blank if you want the ClickSend service to automatically select a shared phone number for you. The phone number here must be in international format (E.164). Eg: +447777777777"}
   * @paramDef {"type":"String","label":"Message","name":"body","required":true,"description":"The text of the message that will be sent."}
   * @paramDef {"type":"String","label":"Source","name":"source","required":false,"description":"The source of the request. For example, the name of your application. It's used to identify messages sent from various applications."}
   * @paramDef {"type":"Number","label":"Schedule","name":"schedule","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"The date you want to start the SMS campaign. It should be in Unix format. If you leave this field blank, the SMS campaign will start immediately."}
   *
   * @returns {Object}
   * @sampleResult {"list_id":2922723,"_list_name":"Campaign List","source":"My APP","_total_count":4,"body":"Some test message","unsubscribe_link":0,"schedule":1734591600000,"date_added":1734543454,"user_id":565971,"name":"Test SMS Campaign","subaccount_id":643519,"from":"+14059999999","senders":null,"sms_campaign_id":2286887,"status":"Scheduled"}
   */
  async sendSmsCampaign(name, list_id, senderIDgroup, from, body, source, schedule) {
    const response = await this.#apiRequest({
      method: 'post',
      endpoint: '/sms-campaigns/send',
      query: null,
      payload: {
        name,
        list_id,
        senderIDgroup,
        from,
        body,
        source,
        schedule,
      },
    })

    return response.data.sms_campaign
  }

  /**
   * @description Sends a new fax document in PDF format to a specified recipient.
   * @route POST /send-fax
   *
   * @operationName Send Fax
   * @category Fax Services
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Contact List ID","name":"list_id","required":false,"dictionary":"getContactListsDictionary","description":"The ID of the contact list that the fax recipient is in."}
   * @paramDef {"type":"Number","label":"Contact ID","name":"contact_id","required":false,"dictionary":"getListContactsDictionary","dependsOn":["list_id"],"description":"The contact ID to whom the fax will be sent."}
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"dictionary":"getContactDetailsDictionary","dependsOn":["contact_id"],"description":"Recipient fax number in E.164 format. Eg.: +61263333333"}
   * @paramDef {"type":"String","label":"From","name":"from","required":true,"description":"Fax sender. Must be a valid fax number in international format (E.164). Eg: +61263333333"}
   * @paramDef {"type":"String","label":"PDF File Url","name":"file_url","required":true,"description":"Public URL of the file in PDF format that will be sent."}
   * @paramDef {"type":"String","label":"Source","name":"source","required":false,"description":"The source of the request. For example, the name of your application."}
   * @paramDef {"type":"Number","label":"Schedule","name":"schedule","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"The date you want the fax to be sent. It should be in Unix format. If this field is left blank the fax will be sent immediately."}
   *
   * @returns {Object}
   * @sampleResult {"country":"AU","message_price":"0.0000","status_code":null,"from_email":null,"list_id":"","message_pages":0,"message_id":"5C72FEDA-514D-472B-A761-50419C711F54","currency_name_short":"CAD","custom_string":"","schedule":1734418800000,"date_added":1734565280,"carrier":"","user_id":999999,"_file_url":"https://clicksend-api-downloads.s3.ap-southeast-2.amazonaws.com/...","subaccount_id":999999,"from":"+14058888888","to":"+61261111111","status_text":null,"status":"SUCCESS"}
   */
  async sendFax(list_id, contact_id, to, from, file_url, source, schedule) {
    const response = await this.#apiRequest({
      method: 'post',
      endpoint: '/fax/send',
      query: null,
      payload: {
        file_url,
        messages: [
          {
            to,
            from,
            source,
            schedule,
          },
        ],
      },
    })

    if (response.data && response.data.messages && response.data.messages.length) {
      const outputData = response.data.messages[0]
      outputData.currency_name_short = response.data._currency.currency_name_short

      return outputData
    } else {
      return {}
    }
  }

  /**
   * @description The PDF document is sent by mail. It is printed, folded, placed in an envelope, and delivered to any address worldwide.
   * @route POST /send-letter
   *
   * @operationName Send Letter
   * @category Postal Services
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Recipient's Name","name":"address_name","required":true,"description":"The name of the recipient to whom the letter will be sent."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"address_line_1","required":true,"description":"The first line of the address."}
   * @paramDef {"type":"String","label":"Address Line 2","name":"address_line_2","required":false,"description":"The second line of the address."}
   * @paramDef {"type":"String","label":"City","name":"address_city","required":true,"description":"City of the letter recipient"}
   * @paramDef {"type":"String","label":"State","name":"address_state","required":false,"description":"State of the letter recipient."}
   * @paramDef {"type":"String","label":"Postal Code","name":"address_postal_code","required":true,"description":"Postal code of the letter recipient."}
   * @paramDef {"type":"String","label":"Country","name":"address_country","required":true,"description":"Country of the letter recipient. There must be two characters. For example: CA,US,GB."}
   * @paramDef {"type":"String","label":"Return address ID","name":"return_address_id","required":true,"dictionary":"getReturnAddressesDictionary","description":"ID of return address to use. The return address can be set in the ClickSend dashboard."}
   * @paramDef {"type":"String","label":"PDF File Url","name":"file_url","required":true,"description":"The public URL of the PDF file containing the letter that will be sent."}
   * @paramDef {"type":"Boolean","label":"Template Used","name":"template_used","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Check the box if your PDF file matches the ClickSend template. In this case, the address will be printed on the first page of your letter. If you leave the box unchecked, the address will be printed on a blank page at the front of the letter."}
   * @paramDef {"type":"Boolean","label":"Print On Both Sides(duplex)","name":"duplex","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Check the box if you want your letter to be printed on both sides of the paper."}
   * @paramDef {"type":"Boolean","label":"Color Printing","name":"colour","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Check the box if you want your letter to be printed in color."}
   * @paramDef {"type":"Boolean","label":"Priority Delivery","name":"priority_post","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Check the box if you want priority delivery."}
   * @paramDef {"type":"Number","label":"Schedule","name":"schedule","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"The date you want the letter to be sent. It should be in Unix format."}
   * @paramDef {"type":"String","label":"Source","name":"source","required":false,"description":"The source of the request. For example, the name of your application. It's used to identify letters sent from various applications."}
   *
   * @returns {Object}
   * @sampleResult {"return_address_id":710199,"address_state":"TX","duplex":1,"address_name":"ABC Inc.","source":"My App.rest.v3","_api_username":"John","return_address_name":"John Smith","return_address_state":"TX","address_line_1":"1 Ave","_file_url":"https://clicksend-api-downloads.s3.ap-southeast-2.amazonaws.com/...","subaccount_id":999999,"address_line_2":"SE","post_pages":0,"return_address_line_2":"1 Ave","return_address_line_1":"2200","return_user_id":999999,"return_address_country":"US","address_postal_code":11111,"address_country":"US","post_price":"0.0000","message_id":"28438436-042B-4EF0-941D-63AD9FA66F99","currency_name_short":"CAD","return_address_city":"Dallas","address_city":"Dallas","schedule":1734678000000,"date_added":1734640931,"colour":1,"user_id":999999,"return_address_postal_code":"123456","priority_post":1,"status":"SUCCESS"}
   */
  async sendLetter(
    address_name,
    address_line_1,
    address_line_2,
    address_city,
    address_state,
    address_postal_code,
    address_country,
    return_address_id,
    file_url,
    template_used,
    duplex,
    colour,
    priority_post,
    schedule,
    source
  ) {
    const payload = {
      file_url,
      template_used: template_used ? 1 : 0,
      duplex: duplex ? 1 : 0,
      colour: colour ? 1 : 0,
      priority_post: priority_post ? 1 : 0,
      source,
      recipients: [
        {
          address_name,
          address_line_1,
          address_line_2,
          address_city,
          address_state,
          address_postal_code,
          address_country,
          return_address_id,
          schedule,
        },
      ],
    }

    const response = await this.#apiRequest({
      method: 'post',
      endpoint: '/post/letters/send',
      query: null,
      payload: payload,
    })

    if (response.data && response.data.recipients && response.data.recipients.length) {
      const outputData = response.data.recipients[0]
      const returnData = outputData._return_address

      if (returnData) {
        Object.keys(returnData).forEach(key => {
          if (key !== 'return_address_id') {
            outputData['return_' + key] = returnData[key]
          }
        })

        delete outputData._return_address
      }

      outputData.currency_name_short = response.data._currency.currency_name_short

      return outputData
    } else {
      return {}
    }
  }

  /**
   * @description Send MMS to one recipient with media file attachment and optional scheduling.
   * @route POST /send-mms
   *
   * @operationName Send MMS
   * @category Messaging
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Contact List ID","name":"list_id","required":false,"dictionary":"getContactListsDictionary","description":"The ID of the contact list that the MMS recipient is in."}
   * @paramDef {"type":"Number","label":"Contact ID","name":"contact_id","required":false,"dictionary":"getListContactsDictionary","dependsOn":["list_id"],"description":"The contact ID to whom the MMS will be sent."}
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"dictionary":"getContactDetailsDictionary","dependsOn":["contact_id"],"description":"The phone number of the recipient. It should be in the international format (E.164). Eg: +447777777777"}
   * @paramDef {"type":"String","label":"Sender's Contact Group","name":"senderIDgroup","required":false,"dictionary":"getSenderIDgroupsDictionary","description":"Sender's contact group. This can be: Alpha Tags, Dedicated Numbers, Own Numbers. Leave this field blank if you want the ClickSend service to automatically select a shared phone number for you."}
   * @paramDef {"type":"String","label":"From","name":"from","required":false,"dictionary":"getSenderContactsDictionary","dependsOn":["senderIDgroup"],"description":"The specific contact of the sender from which the MMS will be sent. This can be a Dedicated number, Alpha tag, Own number. Leave this field blank if you want the ClickSend service to automatically select a shared phone number for you. The phone number here must be in international format (E.164). Eg: +447777777777"}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Subject line (max 20 characters)"}
   * @paramDef {"type":"String","label":"Message","name":"body","required":true,"description":"The text of the message that will be sent along with the media file."}
   * @paramDef {"type":"String","label":"Media File URL","name":"media_file","required":true,"description":"Public URL of the media file. The following formats are supported: jpg, gif. Maximum file size 250kB"}
   * @paramDef {"type":"Number","label":"Schedule","name":"schedule","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"The date you want the MMS to be sent. It should be in Unix format. If this field is left blank the MMS will be sent immediately."}
   * @paramDef {"type":"String","label":"Source","name":"source","required":false,"description":"The source of the request. For example, the name of your application. It's used to identify messages sent from various applications."}
   * @paramDef {"type":"String","label":"Custom String","name":"custom_string","required":false,"description":"This is your reference. It will appear on all delivery reports and be included in all replies."}
   *
   * @returns {Object}
   * @sampleResult {"country":"AU","schedule":1734764400000,"message_parts":0,"message_price":"0.0000","_media_file_url":"https://clicksend-api-downloads.s3.ap-southeast-2.amazonaws.com...","subject":"Test Subject","message_id":"2845E0E4-C4D2-4393-A9D3-87E6C33443FF","from":"+14039995544","to":"+61411111111","body":"Test Message","custom_string":"Test Custom Line","status":"SUCCESS"}
   */
  async sendMms(
    list_id,
    contact_id,
    to,
    senderIDgroup,
    from,
    subject,
    body,
    media_file,
    schedule,
    source,
    custom_string
  ) {
    const payload = {
      media_file,
      messages: [
        {
          to,
          from,
          subject,
          body,
          schedule,
          source,
          custom_string,
        },
      ],
    }
    const response = await this.#apiRequest({
      method: 'post',
      endpoint: '/mms/send',
      query: null,
      payload: payload,
    })

    if (response.data && response.data.messages && response.data.messages.length) {
      const outputData = response.data.messages[0]
      outputData.currency_name_short = response.data.messages.currency_name_short

      return outputData
    } else {
      return {}
    }
  }

  /**
   * @description Send MMS Campaign allows you to send up to 20,000 MMS to users from one contact list in one API call.
   * @route POST /send-mms-campaign
   *
   * @operationName Send MMS Campaign
   * @category Campaigns
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"MMS Campaign Name","name":"name","required":true,"description":"The MMS campaign name."}
   * @paramDef {"type":"Number","label":"Contact List ID","name":"list_id","required":true,"dictionary":"getContactListsDictionary","description":"The ID of the contact list to which the MMS will be sent."}
   * @paramDef {"type":"String","label":"Sender's Contact Group","name":"senderIDgroup","required":false,"dictionary":"getSenderIDgroupsDictionary","description":"Sender's contact group. This can be: Alpha Tags, Dedicated Numbers, Own Numbers. Leave this field blank if you want the ClickSend service to automatically select a shared phone number for you."}
   * @paramDef {"type":"String","label":"From","name":"from","required":true,"dictionary":"getSenderContactsDictionary","dependsOn":["senderIDgroup"],"description":"The specific contact of the sender from which the MMS campaign will be sent. This can be a Dedicated number, Alpha tag, Own number. Leave this field blank if you want the ClickSend service to automatically select a shared phone number for you. The phone number here must be in international format (E.164). Eg: +447777777777"}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Subject of MMS campaign (max 20 characters)."}
   * @paramDef {"type":"String","label":"Message","name":"body","required":true,"description":"The text of the message that will be sent along with the media file."}
   * @paramDef {"type":"String","label":"Media File URL","name":"media_file","required":true,"description":"Public URL of the media file. The following formats are supported: jpg, gif. Maximum file size 250kB"}
   * @paramDef {"type":"Number","label":"Schedule","name":"schedule","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"The date you want to start the MMS campaign. It should be in Unix format. If you leave this field blank, the MMS campaign will start immediately."}
   * @paramDef {"type":"String","label":"Source","name":"source","required":false,"description":"The source of the request. For example, the name of your application. It's used to identify messages sent from various applications."}
   * @paramDef {"type":"String","label":"Custom String","name":"custom_string","required":false,"description":"This is your reference. It will appear on all delivery reports and be included in all replies."}
   *
   * @returns {Object}
   * @sampleResult {"_media_file_url":"https://clicksend-api-downloads.s3.ap-southeast-2.amazonaws.com...","list_id":2922723,"_list_name":"Campaign List ","subject":"Test Subject","file_name":"EFAA3D26-DE7F-4E49-AB2B-C663D044F57E.jpg","mms_campaign_id":115150,"_total_count":4,"body":"Test Message","custom_string":"Test Custom String","unsubscribe_link":0,"schedule":1735628400000,"date_added":1734713325,"user_id":999999,"name":"Test MMS Campaign","subaccount_id":999999,"from":"+14035554422","status":"Scheduled"}
   */
  async sendMmsCampaign(
    name,
    list_id,
    senderIDgroup,
    from,
    subject,
    body,
    media_file,
    schedule,
    source,
    custom_string
  ) {
    const response = await this.#apiRequest({
      method: 'post',
      endpoint: '/mms-campaigns/send',
      query: null,
      payload: {
        name,
        list_id,
        senderIDgroup,
        from,
        subject,
        body,
        media_file,
        schedule,
        source,
        custom_string,
      },
    })

    return response.data
  }

  /**
   * @description Sends a postcard through the mail. The PDF file is printed and shipped to any address worldwide.
   * @route POST /send-postcard
   *
   * @operationName Send Postcard
   * @category Postal Services
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Recipient's Name","name":"address_name","required":true,"description":"The name of the recipient to whom the postcard will be sent."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"address_line_1","required":true,"description":"The first line of the address."}
   * @paramDef {"type":"String","label":"Address Line 2","name":"address_line_2","required":false,"description":"The second line of the address."}
   * @paramDef {"type":"String","label":"City","name":"address_city","required":true,"description":"City of the postcard recipient"}
   * @paramDef {"type":"String","label":"State","name":"address_state","required":false,"description":"State of the postcard recipient."}
   * @paramDef {"type":"String","label":"Postal Code","name":"address_postal_code","required":true,"description":"Postal code of the postcard recipient."}
   * @paramDef {"type":"String","label":"Country","name":"address_country","required":true,"description":"Country of the postcard recipient. There must be two characters. For example: CA,US,GB."}
   * @paramDef {"type":"String","label":"Return address ID","name":"return_address_id","required":true,"dictionary":"getReturnAddressesDictionary","description":"ID of return address to use. The return address can be set in the ClickSend dashboard."}
   * @paramDef {"type":"String","label":"PDF File Url","name":"file_url_main","required":true,"description":"In this field, you can place a public URL to a two-page PDF file (the front and back of the postcard) or a URL to a one-page PDF file (the front of the postcard)."}
   * @paramDef {"type":"String","label":"PDF File Url (Optional. Only when using two PDF files.)","name":"file_url_add","required":false,"description":"If you are using two separate one-page PDF files, place a public link to the back of the postcard PDF here. Leave this field blank if you are using only a single two-page PDF file."}
   * @paramDef {"type":"Boolean","label":"Priority Delivery","name":"priority_post","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Check the box if you want priority delivery."}
   * @paramDef {"type":"Number","label":"Schedule","name":"schedule","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"The date you want the letter to be sent. It should be in Unix format."}
   * @paramDef {"type":"String","label":"Custom String","name":"custom_string","required":false,"description":"This is your reference. It will appear on all delivery reports and be included in all replies."}
   *
   * @returns {Object}
   * @sampleResult {"return_address_id":710199,"address_state":"TX","address_name":"ABC Inc.","_api_username":"USER_NAME","return_address_name":"John Smith","return_address_state":"TX","address_line_1":"Address Line 1","_file_url":"https://clicksend-api-downloads.s3.ap-southeast-2.amazonaws.com/...","subaccount_id":999999,"address_line_2":"Address Line 2","return_address_line_2":"1 Ave","return_address_line_1":"2200","return_user_id":999999,"return_address_country":"US","address_postal_code":11111,"address_country":"US","post_price":"0.0000","message_id":"50AC5AAB-1AC5-4295-8F2D-E0B71AF7B14D","currency_name_short":"CAD","custom_string":"Some Custom String","return_address_city":"Dallas","address_city":"Dallas","schedule":1734764400000,"date_added":1734735479,"user_id":999999,"return_address_postal_code":"123456","status":"SUCCESS"}
   */
  async sendPostcard(
    address_name,
    address_line_1,
    address_line_2,
    address_city,
    address_state,
    address_postal_code,
    address_country,
    return_address_id,
    file_url_main,
    file_url_add,
    priority_post,
    schedule,
    custom_string
  ) {
    const file_urls = file_url_add ? [file_url_main, file_url_add] : [file_url_main]

    const response = await this.#apiRequest({
      method: 'post',
      endpoint: '/post/postcards/send',
      query: null,
      payload: {
        file_urls,
        priority_post: priority_post ? 1 : 0,
        recipients: [
          {
            address_name,
            address_line_1,
            address_line_2,
            address_city,
            address_state,
            address_postal_code,
            address_country,
            return_address_id,
            schedule,
            custom_string,
          },
        ],
      },
    })

    if (response.data && response.data.recipients && response.data.recipients.length) {
      const outputData = response.data.recipients[0]
      const returnData = outputData._return_address

      if (returnData) {
        Object.keys(returnData).forEach(key => {
          if (key !== 'return_address_id') {
            outputData['return_' + key] = returnData[key]
          }
        })

        delete outputData._return_address
      }

      outputData.currency_name_short = response.data._currency.currency_name_short

      return outputData
    } else {
      return {}
    }
  }

  /**
   * @description This method enables you to send up to 1,000 SMS messages to a targeted list of contacts.
   * @route POST /send-sms-contact-list
   *
   * @operationName Send SMS To Contact List
   * @category Messaging
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Contact List ID","name":"list_id","required":true,"dictionary":"getContactListsDictionary","description":"The ID of the contact list to which the message will be sent."}
   * @paramDef {"type":"String","label":"Sender's Contact Group","name":"senderIDgroup","required":false,"dictionary":"getSenderIDgroupsDictionary","description":"Sender's contact group. This can be: Alpha Tags, Dedicated Numbers, Own Numbers. Leave this field blank if you want the ClickSend service to automatically select a shared phone number for you."}
   * @paramDef {"type":"String","label":"From","name":"from","required":false,"dictionary":"getSenderContactsDictionary","dependsOn":["senderIDgroup"],"description":"The specific contact of the sender from which the message will be sent. This can be a Dedicated number, Alpha tag, Own number. Leave this field blank if you want the ClickSend service to automatically select a shared phone number for you. The phone number here must be in international format (E.164). Eg: +447777777777"}
   * @paramDef {"type":"String","label":"Message","name":"body","required":true,"description":"The text of the message that will be sent."}
   * @paramDef {"type":"Number","label":"Schedule","name":"schedule","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"The date you want the message to be sent. It should be in Unix format. If this field is left blank the message will be sent immediately."}
   * @paramDef {"type":"String","label":"Source","name":"source","required":false,"description":"The source of the request. For example, the name of your application. It's used to identify messages sent from various applications."}
   * @paramDef {"type":"String","label":"Custom String","name":"custom_string","required":false,"description":"This is your reference. It will appear on all delivery reports and be included in all replies."}
   *
   *
   * @returns {Object}
   * @sampleResult {"blocked_count":0,"total_price":0,"total_count":2,"messages":[{"date":1735065633,"country":"GB","message_parts":0,"message_price":"0.0000","from_email":null,"list_id":2932037,"is_shared_system_number":true,"message_id":"1EFC2268-F39B-6764-A7D1-EFD8E4218731","body":"Test Message","contact_id":1217715681,"custom_string":"Test Custom String","schedule":1735628400000,"carrier":"EE","user_id":565971,"from":"+447908661615","subaccount_id":643519,"to":"+447777777777","direction":"out","status":"SUCCESS"}],"queued_count":2,"currency_name_short":"CAD"}
   */
  async sendSMSToContactList(list_id, senderIDgroup, from, body, schedule, source, custom_string) {
    const response = await this.#apiRequest({
      method: 'post',
      endpoint: '/sms/send',
      query: null,
      payload: {
        messages: [
          {
            list_id,
            from,
            body,
            schedule,
            source,
            custom_string,
          },
        ],
      },
    })

    const outputData = response.data

    if (response.data._currency) {
      outputData.currency_name_short = response.data._currency.currency_name_short
      delete outputData._currency
    }

    return outputData
  }

  /**
   * @description Send a text-to-speech voice message with customizable voice and language options.
   * @route POST /send-voice-message
   *
   * @operationName Send Voice Message
   * @category Voice Services
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"The phone number of the recipient. It should be in the international format (E.164). Eg: +447777777777"}
   * @paramDef {"type":"String","label":"Sender's Contact Group","name":"senderIDgroup","required":false,"dictionary":"getSenderIDgroupsDictionary","description":"Sender's contact group. This can be: Alpha Tags, Dedicated Numbers, Own Numbers. Leave this field blank if you want the ClickSend service to automatically select a shared phone number for you."}
   * @paramDef {"type":"String","label":"From","name":"from","required":false,"dictionary":"getSenderContactsDictionary","dependsOn":["senderIDgroup"],"description":"The specific contact of the sender from which the voice message will be sent. This can be a Dedicated number, Alpha tag, Own number. Leave this field blank if you want the ClickSend service to automatically select a shared phone number for you. The phone number here must be in international format (E.164). Eg: +447777777777"}
   * @paramDef {"type":"String","label":"Message","name":"body","required":true,"description":"A text message that will be converted and sent as a voice message."}
   * @paramDef {"type":"String","label":"Voice","name":"voice","required":true,"uiComponent":{"type": "DROPDOWN", "options": {"values": ["Male", "Female"]}} ,"description":"Select a male or female voice to be used to read the message."}
   * @paramDef {"type":"String","label":"Language","name":"lang","required":false,"dictionary":"getVoiceLanguagesDictionary","description":"The language you want to use. For example 'en-gb' for English, UK. The default language is 'en-us'(English, US)."}
   * @paramDef {"type":"Boolean","label":"Answering Machine Detector","name":"machine_detection","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Detect answering machine or voicemail and leave a message."}
   * @paramDef {"type":"Number","label":"Schedule","name":"schedule","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"The date you want the voice message to be sent. It should be in Unix format. If this field is left blank the voice message will be sent immediately."}
   * @paramDef {"type":"String","label":"Source","name":"source","required":false,"description":"The source of the request. For example, the name of your application. It's used to identify voice messages sent from various applications."}
   * @paramDef {"type":"String","label":"Custom String","name":"custom_string","required":false,"description":"This is your reference. It will appear on all delivery reports and be included in all replies."}
   *
   *
   * @returns {Object}
   * @sampleResult {"voice":"female","country":"GB","message_parts":0,"message_price":"0.0000","require_input":0,"message_id":"7D18A9EB-8D47-491B-A487-A127B677D3F1","currency_name_short":"CAD","body":"Test Message","custom_string":"Test Custom String","machine_detection":1,"to_type":"mobile","schedule":1735628400000,"date_added":1735091876,"carrier":"EE","user_id":999999,"subaccount_id":999999,"from":"+14059995566","to":"+447777777777","lang":"en-gb","status":"SUCCESS"}
   */
  async sendVoiceMessage(
    to,
    senderIDgroup,
    from,
    body,
    voice,
    lang,
    machine_detection,
    schedule,
    source,
    custom_string
  ) {
    const response = await this.#apiRequest({
      method: 'post',
      endpoint: '/voice/send',
      query: null,
      payload: {
        messages: [
          {
            to,
            from,
            body,
            voice: voice ? voice.toLowerCase() : null,
            lang,
            machine_detection: machine_detection ? 1 : 0,
            schedule,
            source,
            custom_string,
          },
        ],
      },
    })
    let outputData = {}

    if (response.data && response.data.messages && response.data.messages.length) {
      outputData = response.data.messages[0]

      if (response.data._currency) {
        outputData.currency_name_short = response.data._currency.currency_name_short
      }
    }

    return outputData
  }

  /**
   * @description Update a specific existing contact with new information.
   * @route PUT /update-contact
   *
   * @operationName Update Contact
   * @category Contact Management
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Contact List ID","name":"list_id","required":true,"dictionary":"getContactListsDictionary","description":"The ID of the contact list in which a specific existing contact needs to be updated."}
   * @paramDef {"type":"Number","label":"Contact ID","name":"contact_id","required":true,"dictionary":"getListContactsDictionary","description":"The ID of the contact to be updated."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phone_number","required":false,"description":"Contact's phone number in the international format (E.164). Eg: +447777777777. Must be provided if no fax number or email"}
   * @paramDef {"type":"String","label":"Email","name":"email","required":false,"description":"Contact's Email address. Must be provided if no phone number or fax number"}
   * @paramDef {"type":"String","label":"Fax Number","name":"fax_number","required":false,"description":"Contact's Fax Number. Must be provided if no phone number or email."}
   * @paramDef {"type":"String","label":"First Name","name":"first_name","required":false,"description":"Contact's First Name."}
   * @paramDef {"type":"String","label":"Last Name","name":"last_name","required":false,"description":"Contact's Last Name."}
   * @paramDef {"type":"String","label":"Organization Name","name":"organization_name","required":false,"description":"Contact's Organization Name."}
   * @paramDef {"type":"String","label":"Address line 1","name":"address_line_1","required":false,"description":"Contact's Address Line."}
   * @paramDef {"type":"String","label":"Address line 2","name":"address_line_2","required":false,"description":"Contact's Address Line."}
   * @paramDef {"type":"String","label":"City","name":"address_city","required":false,"description":"Contact's Nearest City."}
   * @paramDef {"type":"String","label":"State","name":"address_state","required":false,"description":"Contact's Current State."}
   * @paramDef {"type":"String","label":"Postal Code","name":"address_postal_code","required":false,"description":"Contact's Postal Code."}
   * @paramDef {"type":"String","label":"Country","name":"address_country","required":false,"description":"Contact's Country Cod. There must be two characters. For example: CA,US,GB."}
   * @paramDef {"type":"String","label":"Custom 1","name":"custom_1","required":false,"description":"Contact's Custom Line."}
   * @paramDef {"type":"String","label":"Custom 2","name":"custom_2","required":false,"description":"Contact's Custom Line."}
   * @paramDef {"type":"String","label":"Custom 3","name":"custom_3","required":false,"description":"Contact's Custom Line."}
   * @paramDef {"type":"String","label":"Custom 4","name":"custom_4","required":false,"description":"Contact's Custom Line."}
   *
   * @returns {Object}
   * @sampleResult {"custom_1":"Custom string 1","date_updated":1735237327,"list_id":2913356,"custom_3":"Custom string 3","custom_2":"Custom string 2","address_postal_code":"123456","_list_name":"Test Contact List","address_country":"CA","custom_4":"Custom string 4","address_state":"ON","last_name":"Smith","organization_name":"ABC Inc.","contact_id":1211510178,"fax_number":"+61262222222","address_city":"Toronto","date_added":1734472321,"address_line_1":"1 Ave","phone_number":"+14055555555","address_line_2":"4000","first_name":"John","email":"test@mail.com"}
   */
  async updateContact(
    list_id,
    contact_id,
    phone_number,
    email,
    fax_number,
    first_name,
    last_name,
    organization_name,
    address_line_1,
    address_line_2,
    address_city,
    address_state,
    address_postal_code,
    address_country,
    custom_1,
    custom_2,
    custom_3,
    custom_4
  ) {
    const response = await this.#apiRequest({
      method: 'put',
      endpoint: `/lists/${ list_id }/contacts/${ contact_id }`,
      query: null,
      payload: {
        phone_number,
        email,
        fax_number,
        first_name,
        last_name,
        organization_name,
        address_line_1,
        address_line_2,
        address_city,
        address_state,
        address_postal_code,
        address_country,
        custom_1,
        custom_2,
        custom_3,
        custom_4,
      },
    })

    return response.data
  }

  /**
   * @description Search for a contact in a given contact list based on an email address.
   * @route GET /search-contact-email
   *
   * @operationName Search Contact By Email
   * @category Contact Management
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Contact List ID","name":"list_id","required":true,"dictionary":"getContactListsDictionary","description":"The ID of the contact list in which the search needs to be performed."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The email address that will be used to search for the contact."}
   *
   * @returns {Object}
   * @sampleResult {"custom_1":"custom field 1","date_updated":1735253276,"list_id":2932037,"custom_3":"custom field 3","custom_2":"custom field 2","address_postal_code":"123456","_list_name":"SMS List","address_country":"US","custom_4":"custom field 4","address_state":"TX","last_name":"Smith","organization_name":"ABC Inc.","contactFound":true,"contact_id":1217715665,"fax_number":"+61262222222","address_city":"Dallas","date_added":1735065497,"address_line_1":"1 Ave","phone_number":"+61444444444","address_line_2":"4000","first_name":"John","email":"john@mail.com"}
   */
  async searchContactByEmail(list_id, email) {
    try {
      if (email) {
        email = email.trim()
      }

      if (!email) {
        throw new Error('Email is missing.')
      }

      const query = { q: `email:${ email }` }

      const response = await this.#apiRequest({
        method: 'get',
        endpoint: `/lists/${ list_id }/contacts`,
        query: query,
        payload: null,
      })

      if (response.data && response.data.data && response.data.data.length) {
        const outputData = response.data.data[0]
        outputData.contactFound = true

        return outputData
      } else {
        return { contactFound: false }
      }
    } catch (error) {
      throw new Error(`Failed to search contact by email: ${ error.message }`)
    }
  }

  /**
   * @description Search for a contact in a given contact list by phone number.
   * @route GET /search-contact-phone
   *
   * @operationName Search Contact By Phone
   * @category Contact Management
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Contact List ID","name":"list_id","required":true,"dictionary":"getContactListsDictionary","description":"The ID of the contact list in which the search needs to be performed."}
   * @paramDef {"type":"String","label":"Phone number","name":"phone_number","required":true,"description":"The phone number that will be used to search for the contact. The phone number should be in the international format (E.164). Eg: +447777777777"}
   *
   * @returns {Object}
   * @sampleResult {"custom_1":"custom field 1","date_updated":1735253276,"list_id":2932037,"custom_3":"custom field 3","custom_2":"custom field 2","address_postal_code":"123456","_list_name":"SMS List","address_country":"US","custom_4":"custom field 4","address_state":"TX","last_name":"Smith","organization_name":"ABC Inc.","contactFound":true,"contact_id":1217715665,"fax_number":"+61262222222","address_city":"Dallas","date_added":1735065497,"address_line_1":"1 Ave","phone_number":"+61444444444","address_line_2":"4000","first_name":"John","email":"john@mail.com"}
   */
  async searchContactByPhone(list_id, phone_number) {
    try {
      if (phone_number) {
        phone_number = phone_number.trim()
      }

      if (!phone_number) {
        throw new Error('Phone number is missing.')
      }

      if (phone_number[0] !== '+') {
        phone_number = '+' + phone_number
      }

      const query = { q: `phone_number:${ phone_number }` }

      const response = await this.#apiRequest({
        method: 'get',
        endpoint: `/lists/${ list_id }/contacts`,
        query: query,
        payload: null,
      })

      if (response.data && response.data.data && response.data.data.length) {
        const outputData = response.data.data[0]
        outputData.contactFound = true

        return outputData
      } else {
        return { contactFound: false }
      }
    } catch (error) {
      throw new Error(`Failed to search contact by phone: ${ error.message }`)
    }
  }

  /**
   * @description Search a contact list by its name.
   * @route GET /search-contact-list
   *
   * @operationName Search Contact List
   * @category Contact Management
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Contact List Name","name":"list_name","required":true,"description":"The name of the contact list to search."}
   *
   * @returns {Object}
   * @sampleResult {"_import_in_progress":0,"list_id":2932037,"_optout_in_progress":0,"list_email_id":"EP1EYJUOB6ZRVS4Q","_contacts_count":2,"list_name":"SMS List","contactListFound":true}
   */
  async serachContactListByName(list_name) {
    try {
      if (list_name) {
        list_name = list_name.trim()
      }

      if (!list_name) {
        throw new Error('Contact list name is missing.')
      }

      const query = { q: `list_name:${ list_name }` }

      const response = await this.#apiRequest({
        method: 'get',
        endpoint: '/lists',
        query: query,
        payload: null,
      })

      if (response.data && response.data.data && response.data.data.length) {
        const outputData = response.data.data[0]
        outputData.contactListFound = true

        return outputData
      } else {
        return { contactListFound: false }
      }
    } catch (error) {
      throw new Error(`Failed to search contact list by name: ${ error.message }`)
    }
  }

  /**
   * @description Performs a raw http request to the ClickSend service. The request can be arbitrarily configured. More detailed information on how to form a specific request to the ClickSend service can be found here: https://developers.clicksend.com/docs
   * @route POST /raw-request
   *
   * @operationName Raw ClickSend Request
   * @category API Utilities
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"HTTP Method","name":"method","required":true,"dictionary":"getHttpMethodsDictionary","description":"HTTP method to be used for the request."}
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"The URL that will be used in the request. You only need to specify the endpoint for performing a specific action. The base URL will be added automatically. For example, to view the contact list, the URL should be: /search/contacts-lists"}
   * @paramDef {"type":"String","label":"Query String","name":"query","required":false,"description":"Query String is used to perform search, sorting and pagination. For example, to search for all users in a subaccount with a given name and sort by subaccount_id, the query string would look like this: q=first_name:john,last_name:smith&order_by=subaccount_id:asc&operator=AND"}
   * @paramDef {"type":"String","label":"Body Parameters","name":"bodyParameters","required":false,"uiComponent": {"type": "MULTI_LINE_TEXT"},"description":"Parameters that will be passed in the request body. Must be a valid JSON. For example: {\"from\": \"+14039995544\",\"to\": \"+61411111111\",\"schedule\": 1734764400000} "}
   *
   * @returns {Object}
   * @sampleResult {}
   */
  async clickSendApiRequest(method, url, query, bodyParameters) {
    try {
      let validationMsg = ''
      let isDataValid = true

      if (!method) {
        isDataValid = false
        validationMsg += 'HTTP Method is required. '
      }

      if (method && !['get', 'post', 'put', 'patch', 'delete'].includes(method.toLowerCase())) {
        isDataValid = false
        validationMsg += 'Invalid HTTP method. '
      }

      if (!url) {
        isDataValid = false
        validationMsg += 'URL is required. '
      }

      try {
        bodyParameters = JSON.parse(bodyParameters)
      } catch {
        isDataValid = false
        validationMsg += 'Body Parameters are not valid JSON '
      }

      if (!isDataValid) {
        throw new Error(validationMsg)
      }

      if (query && query.trim()) {
        url = url + '?' + query
      }

      method = method.toLowerCase()

      const response = await this.#apiRequest({
        method: method,
        endpoint: url,
        query: null,
        payload: bodyParameters,
      })

      return response.data || response
    } catch (error) {
      throw new Error(`Raw API request failed: ${ error.message }`)
    }
  }

  /**
   * @description Sends text-to-speech messages to contacts from a specific contact list. You can post up to 1000 messages with each API call.
   * @route POST /send-voice-message-list
   *
   * @operationName Send Voice Message To Contact List
   * @category Voice Services
   * @appearanceColor #3012a7 #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Contact List ID","name":"list_id","required":true,"dictionary":"getContactListsDictionary","description":"The ID of the contact list to which the voice message will be sent."}
   * @paramDef {"type":"String","label":"Sender's Contact Group","name":"senderIDgroup","required":false,"dictionary":"getSenderIDgroupsDictionary","description":"Sender's contact group. This can be: Alpha Tags, Dedicated Numbers, Own Numbers. Leave this field blank if you want the ClickSend service to automatically select a shared phone number for you."}
   * @paramDef {"type":"String","label":"From","name":"from","required":false,"dictionary":"getSenderContactsDictionary","dependsOn":["senderIDgroup"],"description":"The specific contact of the sender from which the voice message will be sent. This can be a Dedicated number, Alpha tag, Own number. Leave this field blank if you want the ClickSend service to automatically select a shared phone number for you. The phone number here must be in international format (E.164). Eg: +447777777777"}
   * @paramDef {"type":"String","label":"Message","name":"body","required":true,"description":"A text message that will be converted and sent as a voice message."}
   * @paramDef {"type":"String","label":"Voice","name":"voice","required":true,"uiComponent":{"type": "DROPDOWN", "options": {"values": ["Male", "Female"]}} ,"description":"Select a male or female voice to be used to read the message."}
   * @paramDef {"type":"String","label":"Language","name":"lang","required":false,"dictionary":"getVoiceLanguagesDictionary","description":"The language you want to use. For example 'en-gb' for English, UK. The default language is 'en-us'(English, US)."}
   * @paramDef {"type":"Boolean","label":"Answering Machine Detector","name":"machine_detection","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Detect answering machine or voicemail and leave a message."}
   * @paramDef {"type":"Number","label":"Schedule","name":"schedule","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"The date you want the voice message to be sent. It should be in Unix format. If this field is left blank the voice message will be sent immediately."}
   * @paramDef {"type":"String","label":"Source","name":"source","required":false,"description":"The source of the request. For example, the name of your application. It's used to identify voice messages sent from various applications."}
   * @paramDef {"type":"String","label":"Custom String","name":"custom_string","required":false,"description":"This is your reference. It will appear on all delivery reports and be included in all replies."}
   *
   *
   * @returns {Object}
   * @sampleResult {"total_price":0,"total_count":1,"messages":[{"voice":"female","country":"AU","message_parts":0,"message_price":"0.0000","require_input":0,"message_id":"82BE3027-D5C7-44FC-B2DD-F98BC2DA62CD","body":"Test Message","custom_string":"Test Custom String","machine_detection":1,"to_type":"mobile","schedule":1735714800000,"date_added":1735677984,"carrier":"Optus","user_id":999999,"subaccount_id":999999,"from":"+14055555555","to":"+61411111111","lang":"es-es","status":"SUCCESS"}],"queued_count":1,"currency_name_short":"CAD"}
   */
  async sendVoiceMessageToContactList(
    list_id,
    senderIDgroup,
    from,
    body,
    voice,
    lang,
    machine_detection,
    schedule,
    source,
    custom_string
  ) {
    const response = await this.#apiRequest({
      method: 'post',
      endpoint: '/voice/send',
      query: null,
      payload: {
        messages: [
          {
            list_id,
            from,
            body,
            voice: voice ? voice.toLowerCase() : null,
            lang,
            machine_detection: machine_detection ? 1 : 0,
            schedule,
            source,
            custom_string,
          },
        ],
      },
    })

    if (response.data && response.data.messages && response.data.messages.length) {
      const outputData = response.data

      if (outputData._currency) {
        outputData.currency_name_short = outputData._currency.currency_name_short
        delete outputData._currency
      }

      return outputData
    } else {
      return {}
    }
  }
}

Flowrunner.ServerCode.addService(ClickSend, [
  {
    displayName: 'Username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    name: 'username',
    hint: 'You can find this value in your ClickSend account (menu item Developers - API Credentials)',
  },
  {
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    name: 'apiKey',
    hint: 'You can find this value in your ClickSend account (menu item Developers - API Credentials)',
  },
])
