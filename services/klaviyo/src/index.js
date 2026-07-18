const logger = {
  info: (...args) => console.log('[Klaviyo] info:', ...args),
  debug: (...args) => console.log('[Klaviyo] debug:', ...args),
  error: (...args) => console.log('[Klaviyo] error:', ...args),
  warn: (...args) => console.log('[Klaviyo] warn:', ...args),
}

const API_BASE_URL = 'https://a.klaviyo.com/api'
const API_REVISION = '2026-01-15'

const MAX_PAGE_SIZE = 100

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
 * @integrationName Klaviyo
 * @integrationIcon /icon.png
 */
class Klaviyo {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Klaviyo-API-Key ${ this.apiKey }`,
          'revision': API_REVISION,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const apiError = error.body?.errors?.[0]
      const message = apiError?.detail || apiError?.title || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Klaviyo API error: ${ message }`)
    }
  }

  // Maps a friendly dropdown label to its API value; passes unknown values through unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #resolveChoiceList(values, mapping) {
    if (!Array.isArray(values) || values.length === 0) {
      return undefined
    }

    return values.map(value => this.#resolveChoice(value, mapping))
  }

  // Escapes a value for use inside a double-quoted JSON:API filter string.
  #filterValue(value) {
    return `"${ String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') }"`
  }

  // Klaviyo ANDs comma-separated filter expressions.
  #combineFilters(...parts) {
    const combined = parts.filter(Boolean).join(',')

    return combined || undefined
  }

  #clampPageSize(pageSize, max = MAX_PAGE_SIZE) {
    if (pageSize === undefined || pageSize === null || pageSize === '') {
      return undefined
    }

    return Math.min(Math.max(1, Math.floor(Number(pageSize))), max)
  }

  // Extracts the page[cursor] value from a JSON:API links.next URL.
  #extractCursor(links) {
    const next = links?.next

    if (!next) {
      return null
    }

    try {
      return new URL(next).searchParams.get('page[cursor]')
    } catch (error) {
      logger.warn(`Could not parse next-page link: ${ next }`)

      return null
    }
  }

  // Unwraps a JSON:API list response into { items, nextCursor } (plus included resources when requested).
  #unwrapList(response) {
    const result = {
      items: response?.data || [],
      nextCursor: this.#extractCursor(response?.links),
    }

    if (response?.included) {
      result.included = response.included
    }

    return result
  }

  #buildProfileAttributes(email, phoneNumber, externalId, firstName, lastName, organization, title, location, properties) {
    return clean({
      email,
      phone_number: phoneNumber,
      external_id: externalId,
      first_name: firstName,
      last_name: lastName,
      organization,
      title,
      location,
      properties,
    })
  }

  // ─── Profiles ──────────────────────────────────────────────────────────

  /**
   * @operationName List Profiles
   * @category Profiles
   * @description Retrieves a page of profiles from the Klaviyo account with cursor-based pagination (up to 100 per page). Supports Klaviyo JSON:API filtering (e.g. equals(email,"a@b.com"), greater-than(created,2025-01-01T00:00:00Z)) and sorting by created, updated, or email. Returns items (profile resources) and nextCursor for fetching the next page.
   * @route GET /profiles
   *
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Raw Klaviyo JSON:API filter expression, e.g. equals(email,\"a@b.com\") or greater-than(created,2025-01-01T00:00:00Z). Multiple comma-separated expressions are combined with AND. Leave empty to list all profiles."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Created (Newest First)","Created (Oldest First)","Updated (Newest First)","Updated (Oldest First)","Email (A-Z)","Email (Z-A)"]}},"description":"Sort order for the returned profiles. Leave empty for the API default order."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of profiles per page, 1-100. Defaults to 20."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"type":"profile","id":"01GDDKASAP8TKDDA2GRZDSVP4H","attributes":{"email":"sarah.mason@klaviyo-demo.com","phone_number":"+15005550006","first_name":"Sarah","last_name":"Mason","created":"2025-03-01T15:00:00+00:00","updated":"2025-06-10T09:30:00+00:00"}}],"nextCursor":"WzE2NDA5OTUyMDAsIjNjT1pyNjdCIl0"}
   */
  async listProfiles(filter, sort, pageSize, cursor) {
    const response = await this.#apiRequest({
      logTag: '[listProfiles]',
      url: `${ API_BASE_URL }/profiles`,
      query: {
        'filter': filter,
        'sort': this.#resolveChoice(sort, {
          'Created (Newest First)': '-created',
          'Created (Oldest First)': 'created',
          'Updated (Newest First)': '-updated',
          'Updated (Oldest First)': 'updated',
          'Email (A-Z)': 'email',
          'Email (Z-A)': '-email',
        }),
        'page[size]': this.#clampPageSize(pageSize),
        'page[cursor]': cursor,
      },
    })

    return this.#unwrapList(response)
  }

  /**
   * @operationName Get Profile
   * @category Profiles
   * @description Retrieves a single profile by its Klaviyo profile ID, including identifiers, name, organization, location, and custom properties. Optionally includes the profile's channel subscriptions and predictive analytics (CLV, churn risk, expected next order date) via Additional Fields.
   * @route GET /profiles/{profileId}
   *
   * @paramDef {"type":"String","label":"Profile ID","name":"profileId","required":true,"description":"The Klaviyo profile ID, e.g. 01GDDKASAP8TKDDA2GRZDSVP4H. Use List Profiles or Get Profile by Email to find it."}
   * @paramDef {"type":"Array<String>","label":"Additional Fields","name":"additionalFields","uiComponent":{"type":"DROPDOWN","options":{"values":["Subscriptions","Predictive Analytics"]}},"description":"Extra data blocks to include on the profile. Predictive Analytics requires sufficient order history in the account."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"profile","id":"01GDDKASAP8TKDDA2GRZDSVP4H","attributes":{"email":"sarah.mason@klaviyo-demo.com","phone_number":"+15005550006","first_name":"Sarah","last_name":"Mason","organization":"Klaviyo Demo","title":"Regional Manager","created":"2025-03-01T15:00:00+00:00","updated":"2025-06-10T09:30:00+00:00","location":{"city":"Boston","region":"MA","country":"United States"},"properties":{"loyalty_tier":"gold"}}}}
   */
  async getProfile(profileId, additionalFields) {
    const fields = this.#resolveChoiceList(additionalFields, {
      'Subscriptions': 'subscriptions',
      'Predictive Analytics': 'predictive_analytics',
    })

    return await this.#apiRequest({
      logTag: '[getProfile]',
      url: `${ API_BASE_URL }/profiles/${ profileId }`,
      query: {
        'additional-fields[profile]': fields ? fields.join(',') : undefined,
      },
    })
  }

  /**
   * @operationName Get Profile by Email
   * @category Profiles
   * @description Finds a profile by its exact email address using a Klaviyo filter query. Returns the matching profile resource (type, id, attributes) or null when no profile with that email exists. Use the returned id with Get Profile, Update Profile, or list membership operations.
   * @route GET /profiles-by-email
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Exact email address of the profile to look up, e.g. sarah.mason@example.com. Matching is case-insensitive."}
   *
   * @returns {Object}
   * @sampleResult {"type":"profile","id":"01GDDKASAP8TKDDA2GRZDSVP4H","attributes":{"email":"sarah.mason@klaviyo-demo.com","first_name":"Sarah","last_name":"Mason","created":"2025-03-01T15:00:00+00:00","updated":"2025-06-10T09:30:00+00:00"}}
   */
  async getProfileByEmail(email) {
    const response = await this.#apiRequest({
      logTag: '[getProfileByEmail]',
      url: `${ API_BASE_URL }/profiles`,
      query: {
        filter: `equals(email,${ this.#filterValue(email) })`,
      },
    })

    return response?.data?.[0] || null
  }

  /**
   * @operationName Create Profile
   * @category Profiles
   * @description Creates a new profile in Klaviyo. At least one identifier (email, phone number, or external ID) is required. Fails with a duplicate error if a profile with the same identifier already exists — use Create or Update Profile for upsert behavior. Phone numbers must be in E.164 format (e.g. +15005550006).
   * @route POST /profiles
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address of the profile. At least one of email, phone number, or external ID is required."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","description":"Phone number in E.164 format, e.g. +15005550006. Required for SMS subscriptions."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","description":"Your system's identifier for this person, used to link the Klaviyo profile to an external record."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The person's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"The person's last name."}
   * @paramDef {"type":"String","label":"Organization","name":"organization","description":"Company or organization the person belongs to."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The person's job title."}
   * @paramDef {"type":"Object","label":"Location","name":"location","description":"Location object with any of: address1, address2, city, region, zip, country, timezone, ip, latitude, longitude."}
   * @paramDef {"type":"Object","label":"Custom Properties","name":"properties","description":"Key-value map of custom profile properties, e.g. {\"loyalty_tier\":\"gold\"}. Values may be strings, numbers, booleans, or arrays."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"profile","id":"01GDDKASAP8TKDDA2GRZDSVP4H","attributes":{"email":"sarah.mason@klaviyo-demo.com","phone_number":"+15005550006","external_id":"crm-10231","first_name":"Sarah","last_name":"Mason","organization":"Klaviyo Demo","title":"Regional Manager","created":"2025-06-15T10:00:00+00:00","properties":{"loyalty_tier":"gold"}}}}
   */
  async createProfile(email, phoneNumber, externalId, firstName, lastName, organization, title, location, properties) {
    const attributes = this.#buildProfileAttributes(email, phoneNumber, externalId, firstName, lastName, organization, title, location, properties)

    if (!attributes.email && !attributes.phone_number && !attributes.external_id) {
      throw new Error('Klaviyo requires at least one identifier: email, phone number, or external ID.')
    }

    return await this.#apiRequest({
      logTag: '[createProfile]',
      url: `${ API_BASE_URL }/profiles`,
      method: 'post',
      body: { data: { type: 'profile', attributes } },
    })
  }

  /**
   * @operationName Update Profile
   * @category Profiles
   * @description Updates attributes of an existing profile identified by its Klaviyo profile ID. Only the provided fields are changed; omitted fields keep their current values. Custom properties are merged into the profile's existing properties.
   * @route PATCH /profiles/{profileId}
   *
   * @paramDef {"type":"String","label":"Profile ID","name":"profileId","required":true,"description":"The Klaviyo profile ID of the profile to update, e.g. 01GDDKASAP8TKDDA2GRZDSVP4H."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address for the profile."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","description":"New phone number in E.164 format, e.g. +15005550006."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","description":"Your system's identifier for this person."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The person's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"The person's last name."}
   * @paramDef {"type":"String","label":"Organization","name":"organization","description":"Company or organization the person belongs to."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The person's job title."}
   * @paramDef {"type":"Object","label":"Location","name":"location","description":"Location object with any of: address1, address2, city, region, zip, country, timezone, ip, latitude, longitude."}
   * @paramDef {"type":"Object","label":"Custom Properties","name":"properties","description":"Key-value map of custom profile properties to set or overwrite, e.g. {\"loyalty_tier\":\"platinum\"}."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"profile","id":"01GDDKASAP8TKDDA2GRZDSVP4H","attributes":{"email":"sarah.mason@klaviyo-demo.com","first_name":"Sarah","last_name":"Mason","title":"Director","updated":"2025-06-15T10:05:00+00:00","properties":{"loyalty_tier":"platinum"}}}}
   */
  async updateProfile(profileId, email, phoneNumber, externalId, firstName, lastName, organization, title, location, properties) {
    const attributes = this.#buildProfileAttributes(email, phoneNumber, externalId, firstName, lastName, organization, title, location, properties)

    return await this.#apiRequest({
      logTag: '[updateProfile]',
      url: `${ API_BASE_URL }/profiles/${ profileId }`,
      method: 'patch',
      body: { data: { type: 'profile', id: profileId, attributes } },
    })
  }

  /**
   * @operationName Create or Update Profile
   * @category Profiles
   * @description Upserts a profile: creates it if no profile matches the given identifier, or updates the existing profile's attributes if one does. Ideal for syncing contacts from external systems without checking existence first. At least one identifier (email, phone number, or external ID) is required.
   * @route POST /profile-import
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address used to match or create the profile. At least one of email, phone number, or external ID is required."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","description":"Phone number in E.164 format, e.g. +15005550006."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","description":"Your system's identifier for this person, used to match or create the profile."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The person's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"The person's last name."}
   * @paramDef {"type":"String","label":"Organization","name":"organization","description":"Company or organization the person belongs to."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The person's job title."}
   * @paramDef {"type":"Object","label":"Location","name":"location","description":"Location object with any of: address1, address2, city, region, zip, country, timezone, ip, latitude, longitude."}
   * @paramDef {"type":"Object","label":"Custom Properties","name":"properties","description":"Key-value map of custom profile properties, e.g. {\"loyalty_tier\":\"gold\"}. Merged into existing properties on update."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"profile","id":"01GDDKASAP8TKDDA2GRZDSVP4H","attributes":{"email":"sarah.mason@klaviyo-demo.com","first_name":"Sarah","last_name":"Mason","created":"2025-03-01T15:00:00+00:00","updated":"2025-06-15T10:10:00+00:00","properties":{"loyalty_tier":"gold"}}}}
   */
  async createOrUpdateProfile(email, phoneNumber, externalId, firstName, lastName, organization, title, location, properties) {
    const attributes = this.#buildProfileAttributes(email, phoneNumber, externalId, firstName, lastName, organization, title, location, properties)

    if (!attributes.email && !attributes.phone_number && !attributes.external_id) {
      throw new Error('Klaviyo requires at least one identifier: email, phone number, or external ID.')
    }

    return await this.#apiRequest({
      logTag: '[createOrUpdateProfile]',
      url: `${ API_BASE_URL }/profile-import`,
      method: 'post',
      body: { data: { type: 'profile', attributes } },
    })
  }

  /**
   * @operationName Suppress Profiles
   * @category Profiles
   * @description Suppresses one or more profiles from receiving email marketing by adding a USER_SUPPRESSED suppression for each email address. Suppressed profiles remain in the account but are excluded from all email sends until unsuppressed. Processed asynchronously by Klaviyo.
   * @route POST /profile-suppression-bulk-create-jobs
   *
   * @paramDef {"type":"Array<String>","label":"Email Addresses","name":"emails","required":true,"description":"Email addresses of the profiles to suppress from email marketing, e.g. [\"a@example.com\",\"b@example.com\"]."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"emails":["sarah.mason@klaviyo-demo.com"]}
   */
  async suppressProfiles(emails) {
    if (!Array.isArray(emails) || emails.length === 0) {
      throw new Error('Provide at least one email address to suppress.')
    }

    await this.#apiRequest({
      logTag: '[suppressProfiles]',
      url: `${ API_BASE_URL }/profile-suppression-bulk-create-jobs`,
      method: 'post',
      body: {
        data: {
          type: 'profile-suppression-bulk-create-job',
          attributes: {
            profiles: { data: emails.map(email => ({ type: 'profile', attributes: { email } })) },
          },
        },
      },
    })

    return { success: true, emails }
  }

  /**
   * @operationName Unsuppress Profiles
   * @category Profiles
   * @description Removes email marketing suppressions for one or more profiles so they can receive email campaigns and flows again. Only removes suppressions (e.g. USER_SUPPRESSED); it does not change unsubscribe consent recorded for a profile. Processed asynchronously by Klaviyo.
   * @route POST /profile-suppression-bulk-delete-jobs
   *
   * @paramDef {"type":"Array<String>","label":"Email Addresses","name":"emails","required":true,"description":"Email addresses of the profiles to unsuppress, e.g. [\"a@example.com\",\"b@example.com\"]."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"emails":["sarah.mason@klaviyo-demo.com"]}
   */
  async unsuppressProfiles(emails) {
    if (!Array.isArray(emails) || emails.length === 0) {
      throw new Error('Provide at least one email address to unsuppress.')
    }

    await this.#apiRequest({
      logTag: '[unsuppressProfiles]',
      url: `${ API_BASE_URL }/profile-suppression-bulk-delete-jobs`,
      method: 'post',
      body: {
        data: {
          type: 'profile-suppression-bulk-delete-job',
          attributes: {
            profiles: { data: emails.map(email => ({ type: 'profile', attributes: { email } })) },
          },
        },
      },
    })

    return { success: true, emails }
  }

  // ─── Subscriptions ─────────────────────────────────────────────────────

  /**
   * @operationName Subscribe Profiles
   * @category Subscriptions
   * @description Subscribes a person to email and/or SMS marketing with explicit SUBSCRIBED consent, optionally adding them to a list. If the list uses double opt-in, Klaviyo sends a confirmation message instead of subscribing immediately. Provide an email for the Email channel and an E.164 phone number for the SMS channel. Processed asynchronously by Klaviyo.
   * @route POST /profile-subscription-bulk-create-jobs
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address to subscribe. Required when the Email channel is selected."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","description":"Phone number in E.164 format, e.g. +15005550006. Required when the SMS channel is selected."}
   * @paramDef {"type":"String","label":"List","name":"listId","dictionary":"getListsDictionary","description":"Optional list to add the subscriber to. When empty, consent is recorded on the profile without a list membership."}
   * @paramDef {"type":"Array<String>","label":"Channels","name":"channels","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","SMS"]}},"description":"Marketing channels to subscribe to. Defaults to the channels matching the identifiers you provide (Email when an email is given, SMS when a phone number is given)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"listId":"Y6nRLr","channels":["email"]}
   */
  async subscribeProfiles(email, phoneNumber, listId, channels) {
    if (!email && !phoneNumber) {
      throw new Error('Provide an email address or a phone number to subscribe.')
    }

    const resolvedChannels = this.#resolveChoiceList(channels, { 'Email': 'email', 'SMS': 'sms' }) ||
      [email && 'email', phoneNumber && 'sms'].filter(Boolean)

    const subscriptions = {}

    if (resolvedChannels.includes('email')) {
      if (!email) {
        throw new Error('An email address is required to subscribe to the Email channel.')
      }

      subscriptions.email = { marketing: { consent: 'SUBSCRIBED' } }
    }

    if (resolvedChannels.includes('sms')) {
      if (!phoneNumber) {
        throw new Error('A phone number is required to subscribe to the SMS channel.')
      }

      subscriptions.sms = { marketing: { consent: 'SUBSCRIBED' } }
    }

    await this.#apiRequest({
      logTag: '[subscribeProfiles]',
      url: `${ API_BASE_URL }/profile-subscription-bulk-create-jobs`,
      method: 'post',
      body: {
        data: {
          type: 'profile-subscription-bulk-create-job',
          attributes: {
            profiles: {
              data: [{
                type: 'profile',
                attributes: clean({ email, phone_number: phoneNumber, subscriptions }),
              }],
            },
            historical_import: false,
          },
          ...(listId ? { relationships: { list: { data: { type: 'list', id: listId } } } } : {}),
        },
      },
    })

    return { success: true, listId: listId || null, channels: resolvedChannels }
  }

  /**
   * @operationName Unsubscribe Profiles
   * @category Subscriptions
   * @description Unsubscribes a person from email and/or SMS marketing by recording UNSUBSCRIBED consent, optionally removing them from a specific list. Provide an email for the Email channel and an E.164 phone number for the SMS channel. Processed asynchronously by Klaviyo.
   * @route POST /profile-subscription-bulk-delete-jobs
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address to unsubscribe. Required when the Email channel is selected."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","description":"Phone number in E.164 format, e.g. +15005550006. Required when the SMS channel is selected."}
   * @paramDef {"type":"String","label":"List","name":"listId","dictionary":"getListsDictionary","description":"Optional list to remove the person from. When empty, the unsubscribe applies account-wide for the selected channels."}
   * @paramDef {"type":"Array<String>","label":"Channels","name":"channels","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","SMS"]}},"description":"Marketing channels to unsubscribe from. Defaults to the channels matching the identifiers you provide (Email when an email is given, SMS when a phone number is given)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"listId":"Y6nRLr","channels":["email"]}
   */
  async unsubscribeProfiles(email, phoneNumber, listId, channels) {
    if (!email && !phoneNumber) {
      throw new Error('Provide an email address or a phone number to unsubscribe.')
    }

    const resolvedChannels = this.#resolveChoiceList(channels, { 'Email': 'email', 'SMS': 'sms' }) ||
      [email && 'email', phoneNumber && 'sms'].filter(Boolean)

    const subscriptions = {}

    if (resolvedChannels.includes('email')) {
      if (!email) {
        throw new Error('An email address is required to unsubscribe from the Email channel.')
      }

      subscriptions.email = { marketing: { consent: 'UNSUBSCRIBED' } }
    }

    if (resolvedChannels.includes('sms')) {
      if (!phoneNumber) {
        throw new Error('A phone number is required to unsubscribe from the SMS channel.')
      }

      subscriptions.sms = { marketing: { consent: 'UNSUBSCRIBED' } }
    }

    await this.#apiRequest({
      logTag: '[unsubscribeProfiles]',
      url: `${ API_BASE_URL }/profile-subscription-bulk-delete-jobs`,
      method: 'post',
      body: {
        data: {
          type: 'profile-subscription-bulk-delete-job',
          attributes: {
            profiles: {
              data: [{
                type: 'profile',
                attributes: clean({ email, phone_number: phoneNumber, subscriptions }),
              }],
            },
          },
          ...(listId ? { relationships: { list: { data: { type: 'list', id: listId } } } } : {}),
        },
      },
    })

    return { success: true, listId: listId || null, channels: resolvedChannels }
  }

  // ─── Lists ─────────────────────────────────────────────────────────────

  /**
   * @operationName List Lists
   * @category Lists
   * @description Retrieves the lists in the Klaviyo account with cursor-based pagination (10 lists per page). Supports Klaviyo JSON:API filtering on name, id, created, and updated (e.g. equals(name,"Newsletter")). Returns items (list resources) and nextCursor for the next page.
   * @route GET /lists
   *
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Raw Klaviyo JSON:API filter expression, e.g. equals(name,\"Newsletter\") or greater-than(created,2025-01-01T00:00:00Z). Leave empty to list all lists."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"type":"list","id":"Y6nRLr","attributes":{"name":"Newsletter","created":"2025-01-15T12:00:00+00:00","updated":"2025-06-01T08:00:00+00:00","opt_in_process":"double_opt_in"}}],"nextCursor":null}
   */
  async listLists(filter, cursor) {
    const response = await this.#apiRequest({
      logTag: '[listLists]',
      url: `${ API_BASE_URL }/lists`,
      query: {
        'filter': filter,
        'page[cursor]': cursor,
      },
    })

    return this.#unwrapList(response)
  }

  /**
   * @operationName Get List
   * @category Lists
   * @description Retrieves a single list by ID, including its name, opt-in process, and timestamps. Optionally includes the list's current profile count (computed on demand by Klaviyo, which may add latency on very large lists).
   * @route GET /lists/{listId}
   *
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The list to retrieve. Select a list or provide its Klaviyo list ID, e.g. Y6nRLr."}
   * @paramDef {"type":"Boolean","label":"Include Profile Count","name":"includeProfileCount","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, includes the list's current profile count in the response attributes."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"list","id":"Y6nRLr","attributes":{"name":"Newsletter","created":"2025-01-15T12:00:00+00:00","updated":"2025-06-01T08:00:00+00:00","opt_in_process":"double_opt_in","profile_count":1523}}}
   */
  async getList(listId, includeProfileCount) {
    return await this.#apiRequest({
      logTag: '[getList]',
      url: `${ API_BASE_URL }/lists/${ listId }`,
      query: {
        'additional-fields[list]': includeProfileCount ? 'profile_count' : undefined,
      },
    })
  }

  /**
   * @operationName Create List
   * @category Lists
   * @description Creates a new list in the Klaviyo account with the given name. Returns the created list resource including its ID, which can be used with Add Profiles to List and Subscribe Profiles.
   * @route POST /lists
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the new list, e.g. Newsletter Subscribers."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"list","id":"Y6nRLr","attributes":{"name":"Newsletter Subscribers","created":"2025-06-15T10:00:00+00:00","updated":"2025-06-15T10:00:00+00:00","opt_in_process":"single_opt_in"}}}
   */
  async createList(name) {
    return await this.#apiRequest({
      logTag: '[createList]',
      url: `${ API_BASE_URL }/lists`,
      method: 'post',
      body: { data: { type: 'list', attributes: { name } } },
    })
  }

  /**
   * @operationName Update List
   * @category Lists
   * @description Renames an existing list. Only the list name can be changed via the API; membership is managed with Add Profiles to List, Remove Profiles from List, and Subscribe Profiles.
   * @route PATCH /lists/{listId}
   *
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The list to rename. Select a list or provide its Klaviyo list ID."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"New name for the list."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"list","id":"Y6nRLr","attributes":{"name":"Weekly Newsletter","created":"2025-01-15T12:00:00+00:00","updated":"2025-06-15T10:05:00+00:00","opt_in_process":"double_opt_in"}}}
   */
  async updateList(listId, name) {
    return await this.#apiRequest({
      logTag: '[updateList]',
      url: `${ API_BASE_URL }/lists/${ listId }`,
      method: 'patch',
      body: { data: { type: 'list', id: listId, attributes: { name } } },
    })
  }

  /**
   * @operationName Delete List
   * @category Lists
   * @description Permanently deletes a list from the Klaviyo account. Profiles that belong to the list are NOT deleted — only the list and its memberships are removed. This action cannot be undone.
   * @route DELETE /lists/{listId}
   *
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The list to delete. Select a list or provide its Klaviyo list ID."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteList(listId) {
    await this.#apiRequest({
      logTag: '[deleteList]',
      url: `${ API_BASE_URL }/lists/${ listId }`,
      method: 'delete',
    })

    return { success: true }
  }

  /**
   * @operationName Add Profiles to List
   * @category Lists
   * @description Adds up to 1000 existing profiles to a list by their Klaviyo profile IDs. This directly adds list memberships without recording marketing consent — use Subscribe Profiles when you need SUBSCRIBED consent or double opt-in handling.
   * @route POST /lists/{listId}/relationships/profiles
   *
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The list to add profiles to. Select a list or provide its Klaviyo list ID."}
   * @paramDef {"type":"Array<String>","label":"Profile IDs","name":"profileIds","required":true,"description":"Klaviyo profile IDs to add, e.g. [\"01GDDKASAP8TKDDA2GRZDSVP4H\"]. Maximum 1000 per call. Use Get Profile by Email or List Profiles to find IDs."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"listId":"Y6nRLr","added":2}
   */
  async addProfilesToList(listId, profileIds) {
    if (!Array.isArray(profileIds) || profileIds.length === 0) {
      throw new Error('Provide at least one profile ID to add to the list.')
    }

    await this.#apiRequest({
      logTag: '[addProfilesToList]',
      url: `${ API_BASE_URL }/lists/${ listId }/relationships/profiles`,
      method: 'post',
      body: { data: profileIds.map(id => ({ type: 'profile', id })) },
    })

    return { success: true, listId, added: profileIds.length }
  }

  /**
   * @operationName Remove Profiles from List
   * @category Lists
   * @description Removes up to 1000 profiles from a list by their Klaviyo profile IDs. Only the list membership is removed — the profiles themselves and their consent status are unchanged.
   * @route DELETE /lists/{listId}/relationships/profiles
   *
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The list to remove profiles from. Select a list or provide its Klaviyo list ID."}
   * @paramDef {"type":"Array<String>","label":"Profile IDs","name":"profileIds","required":true,"description":"Klaviyo profile IDs to remove, e.g. [\"01GDDKASAP8TKDDA2GRZDSVP4H\"]. Maximum 1000 per call."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"listId":"Y6nRLr","removed":2}
   */
  async removeProfilesFromList(listId, profileIds) {
    if (!Array.isArray(profileIds) || profileIds.length === 0) {
      throw new Error('Provide at least one profile ID to remove from the list.')
    }

    await this.#apiRequest({
      logTag: '[removeProfilesFromList]',
      url: `${ API_BASE_URL }/lists/${ listId }/relationships/profiles`,
      method: 'delete',
      body: { data: profileIds.map(id => ({ type: 'profile', id })) },
    })

    return { success: true, listId, removed: profileIds.length }
  }

  /**
   * @operationName Get List Profiles
   * @category Lists
   * @description Retrieves the profiles that belong to a list with cursor-based pagination (up to 100 per page). Supports Klaviyo JSON:API filtering on profile fields (e.g. equals(email,"a@b.com"), greater-than(joined_group_at,2025-01-01T00:00:00Z)). Returns items (profile resources) and nextCursor.
   * @route GET /lists/{listId}/profiles
   *
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The list whose members to retrieve. Select a list or provide its Klaviyo list ID."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Raw Klaviyo JSON:API filter expression applied to the list members, e.g. equals(email,\"a@b.com\")."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of profiles per page, 1-100. Defaults to 20."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"type":"profile","id":"01GDDKASAP8TKDDA2GRZDSVP4H","attributes":{"email":"sarah.mason@klaviyo-demo.com","first_name":"Sarah","last_name":"Mason","joined_group_at":"2025-02-01T09:00:00+00:00"}}],"nextCursor":"WzE2NDA5OTUyMDBd"}
   */
  async getListProfiles(listId, filter, pageSize, cursor) {
    const response = await this.#apiRequest({
      logTag: '[getListProfiles]',
      url: `${ API_BASE_URL }/lists/${ listId }/profiles`,
      query: {
        'filter': filter,
        'page[size]': this.#clampPageSize(pageSize),
        'page[cursor]': cursor,
      },
    })

    return this.#unwrapList(response)
  }

  // ─── Segments ──────────────────────────────────────────────────────────

  /**
   * @operationName List Segments
   * @category Segments
   * @description Retrieves the segments in the Klaviyo account with cursor-based pagination (10 segments per page). Supports Klaviyo JSON:API filtering on name, id, created, updated, is_active, and is_starred (e.g. equals(is_active,true)). Returns items (segment resources) and nextCursor.
   * @route GET /segments
   *
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Raw Klaviyo JSON:API filter expression, e.g. equals(name,\"VIP Customers\") or equals(is_active,true). Leave empty to list all segments."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"type":"segment","id":"W92xRt","attributes":{"name":"VIP Customers","created":"2025-01-10T12:00:00+00:00","updated":"2025-06-01T08:00:00+00:00","is_active":true,"is_processing":false,"is_starred":true}}],"nextCursor":null}
   */
  async listSegments(filter, cursor) {
    const response = await this.#apiRequest({
      logTag: '[listSegments]',
      url: `${ API_BASE_URL }/segments`,
      query: {
        'filter': filter,
        'page[cursor]': cursor,
      },
    })

    return this.#unwrapList(response)
  }

  /**
   * @operationName Get Segment
   * @category Segments
   * @description Retrieves a single segment by ID, including its name, activity flags, and timestamps. Optionally includes the segment's current profile count (computed on demand by Klaviyo, which may add latency on very large segments).
   * @route GET /segments/{segmentId}
   *
   * @paramDef {"type":"String","label":"Segment","name":"segmentId","required":true,"dictionary":"getSegmentsDictionary","description":"The segment to retrieve. Select a segment or provide its Klaviyo segment ID, e.g. W92xRt."}
   * @paramDef {"type":"Boolean","label":"Include Profile Count","name":"includeProfileCount","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, includes the segment's current profile count in the response attributes."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"segment","id":"W92xRt","attributes":{"name":"VIP Customers","created":"2025-01-10T12:00:00+00:00","updated":"2025-06-01T08:00:00+00:00","is_active":true,"is_processing":false,"is_starred":true,"profile_count":412}}}
   */
  async getSegment(segmentId, includeProfileCount) {
    return await this.#apiRequest({
      logTag: '[getSegment]',
      url: `${ API_BASE_URL }/segments/${ segmentId }`,
      query: {
        'additional-fields[segment]': includeProfileCount ? 'profile_count' : undefined,
      },
    })
  }

  /**
   * @operationName Get Segment Profiles
   * @category Segments
   * @description Retrieves the profiles that currently belong to a segment with cursor-based pagination (up to 100 per page). Supports Klaviyo JSON:API filtering on profile fields (e.g. equals(email,"a@b.com"), greater-than(joined_group_at,2025-01-01T00:00:00Z)). Returns items (profile resources) and nextCursor.
   * @route GET /segments/{segmentId}/profiles
   *
   * @paramDef {"type":"String","label":"Segment","name":"segmentId","required":true,"dictionary":"getSegmentsDictionary","description":"The segment whose members to retrieve. Select a segment or provide its Klaviyo segment ID."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Raw Klaviyo JSON:API filter expression applied to the segment members, e.g. equals(email,\"a@b.com\")."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of profiles per page, 1-100. Defaults to 20."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"type":"profile","id":"01GDDKASAP8TKDDA2GRZDSVP4H","attributes":{"email":"sarah.mason@klaviyo-demo.com","first_name":"Sarah","last_name":"Mason","joined_group_at":"2025-02-01T09:00:00+00:00"}}],"nextCursor":null}
   */
  async getSegmentProfiles(segmentId, filter, pageSize, cursor) {
    const response = await this.#apiRequest({
      logTag: '[getSegmentProfiles]',
      url: `${ API_BASE_URL }/segments/${ segmentId }/profiles`,
      query: {
        'filter': filter,
        'page[size]': this.#clampPageSize(pageSize),
        'page[cursor]': cursor,
      },
    })

    return this.#unwrapList(response)
  }

  // ─── Events ────────────────────────────────────────────────────────────

  /**
   * @operationName Create Event
   * @category Events
   * @description Tracks a custom event (e.g. Placed Order, Viewed Product) for a profile identified by email and/or phone number. If the metric or profile does not exist yet, Klaviyo creates it automatically. Events can trigger flows and power segments and analytics. Processed asynchronously by Klaviyo.
   * @route POST /events
   *
   * @paramDef {"type":"String","label":"Metric Name","name":"metricName","required":true,"description":"Name of the metric to track, e.g. Placed Order. A new metric is created automatically if it does not exist."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address identifying the profile the event belongs to. At least one of email or phone number is required."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","description":"Phone number in E.164 format identifying the profile, e.g. +15005550006."}
   * @paramDef {"type":"Object","label":"Event Properties","name":"properties","description":"Key-value map of event properties, e.g. {\"order_id\":\"1042\",\"items\":[\"SKU-1\"]}. Available in flows, segments, and analytics."}
   * @paramDef {"type":"Number","label":"Value","name":"value","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Monetary value of the event in the account's currency, e.g. 29.98. Used for revenue analytics."}
   * @paramDef {"type":"String","label":"Unique ID","name":"uniqueId","description":"Idempotency key for the event. Sending the same metric, profile, time, and unique ID again does not create a duplicate."}
   * @paramDef {"type":"String","label":"Time","name":"time","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"ISO 8601 timestamp when the event occurred, e.g. 2025-06-15T14:30:00Z. Defaults to the time Klaviyo receives the event."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"metric":"Placed Order"}
   */
  async createEvent(metricName, email, phoneNumber, properties, value, uniqueId, time) {
    if (!email && !phoneNumber) {
      throw new Error('Provide an email address or a phone number to identify the profile for the event.')
    }

    await this.#apiRequest({
      logTag: '[createEvent]',
      url: `${ API_BASE_URL }/events`,
      method: 'post',
      body: {
        data: {
          type: 'event',
          attributes: clean({
            properties: properties || {},
            time,
            value,
            unique_id: uniqueId,
            metric: { data: { type: 'metric', attributes: { name: metricName } } },
            profile: { data: { type: 'profile', attributes: clean({ email, phone_number: phoneNumber }) } },
          }),
        },
      },
    })

    return { success: true, metric: metricName }
  }

  /**
   * @operationName List Events
   * @category Events
   * @description Retrieves events from the Klaviyo account with cursor-based pagination, newest first by default. Filter by metric and/or profile using the convenience parameters, or supply a raw JSON:API filter. Optionally includes the related metric, profile, and attribution resources in the response.
   * @route GET /events
   *
   * @paramDef {"type":"String","label":"Metric","name":"metricId","dictionary":"getMetricsDictionary","description":"Only return events for this metric. Select a metric or provide its Klaviyo metric ID."}
   * @paramDef {"type":"String","label":"Profile ID","name":"profileId","description":"Only return events for this profile, e.g. 01GDDKASAP8TKDDA2GRZDSVP4H. Use Get Profile by Email to find it."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Additional raw Klaviyo JSON:API filter expression, e.g. greater-than(datetime,2025-06-01T00:00:00Z). Combined with the metric/profile filters using AND."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Newest First","Oldest First"]}},"defaultValue":"Newest First","description":"Order of returned events by their datetime."}
   * @paramDef {"type":"Array<String>","label":"Include","name":"include","uiComponent":{"type":"DROPDOWN","options":{"values":["Metric","Profile","Attributions"]}},"description":"Related resources to include in the response's included array."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"type":"event","id":"4dXkbR","attributes":{"timestamp":1750000200,"event_properties":{"order_id":"1042","value":29.98},"datetime":"2025-06-15T14:30:00+00:00","uuid":"3a9c1e60-49f1-11f0-8001-0242ac110002"}}],"nextCursor":"WzE3NTAwMDAyMDBd"}
   */
  async listEvents(metricId, profileId, filter, sort, include, cursor) {
    const includes = this.#resolveChoiceList(include, {
      'Metric': 'metric',
      'Profile': 'profile',
      'Attributions': 'attributions',
    })

    const response = await this.#apiRequest({
      logTag: '[listEvents]',
      url: `${ API_BASE_URL }/events`,
      query: {
        'filter': this.#combineFilters(
          metricId ? `equals(metric_id,${ this.#filterValue(metricId) })` : null,
          profileId ? `equals(profile_id,${ this.#filterValue(profileId) })` : null,
          filter
        ),
        'sort': this.#resolveChoice(sort, { 'Newest First': '-datetime', 'Oldest First': 'datetime' }) || '-datetime',
        'include': includes ? includes.join(',') : undefined,
        'page[cursor]': cursor,
      },
    })

    return this.#unwrapList(response)
  }

  /**
   * @operationName Get Event
   * @category Events
   * @description Retrieves a single event by its Klaviyo event ID, including its timestamp and event properties. Optionally includes the related metric, profile, and attribution resources in the response's included array.
   * @route GET /events/{eventId}
   *
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"description":"The Klaviyo event ID, e.g. 4dXkbR. Use List Events to find event IDs."}
   * @paramDef {"type":"Array<String>","label":"Include","name":"include","uiComponent":{"type":"DROPDOWN","options":{"values":["Metric","Profile","Attributions"]}},"description":"Related resources to include in the response's included array."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"event","id":"4dXkbR","attributes":{"timestamp":1750000200,"event_properties":{"order_id":"1042","value":29.98},"datetime":"2025-06-15T14:30:00+00:00","uuid":"3a9c1e60-49f1-11f0-8001-0242ac110002"}}}
   */
  async getEvent(eventId, include) {
    const includes = this.#resolveChoiceList(include, {
      'Metric': 'metric',
      'Profile': 'profile',
      'Attributions': 'attributions',
    })

    return await this.#apiRequest({
      logTag: '[getEvent]',
      url: `${ API_BASE_URL }/events/${ eventId }`,
      query: {
        include: includes ? includes.join(',') : undefined,
      },
    })
  }

  // ─── Metrics ───────────────────────────────────────────────────────────

  /**
   * @operationName List Metrics
   * @category Metrics
   * @description Retrieves the metrics (event types) in the Klaviyo account with cursor-based pagination, including built-in metrics and those created by integrations (e.g. Shopify's Placed Order). Supports filtering by integration name or category, e.g. equals(integration.name,"Shopify").
   * @route GET /metrics
   *
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Raw Klaviyo JSON:API filter expression, e.g. equals(integration.name,\"Shopify\") or equals(integration.category,\"eCommerce\"). Leave empty to list all metrics."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"type":"metric","id":"XVTP5Q","attributes":{"name":"Placed Order","created":"2024-10-01T10:00:00+00:00","updated":"2025-06-01T10:00:00+00:00","integration":{"name":"Shopify","category":"eCommerce"}}}],"nextCursor":null}
   */
  async listMetrics(filter, cursor) {
    const response = await this.#apiRequest({
      logTag: '[listMetrics]',
      url: `${ API_BASE_URL }/metrics`,
      query: {
        'filter': filter,
        'page[cursor]': cursor,
      },
    })

    return this.#unwrapList(response)
  }

  /**
   * @operationName Get Metric
   * @category Metrics
   * @description Retrieves a single metric by ID, including its name, creation and update timestamps, and the integration that produces it (if any). Use the metric ID with List Events and Query Metric Aggregates.
   * @route GET /metrics/{metricId}
   *
   * @paramDef {"type":"String","label":"Metric","name":"metricId","required":true,"dictionary":"getMetricsDictionary","description":"The metric to retrieve. Select a metric or provide its Klaviyo metric ID, e.g. XVTP5Q."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"metric","id":"XVTP5Q","attributes":{"name":"Placed Order","created":"2024-10-01T10:00:00+00:00","updated":"2025-06-01T10:00:00+00:00","integration":{"name":"Shopify","category":"eCommerce"}}}}
   */
  async getMetric(metricId) {
    return await this.#apiRequest({
      logTag: '[getMetric]',
      url: `${ API_BASE_URL }/metrics/${ metricId }`,
    })
  }

  /**
   * @operationName Query Metric Aggregates
   * @category Metrics
   * @description Runs an aggregate analytics query over a metric for a date range, returning time-bucketed measurements such as event count, total value (revenue), and unique profile count. Supports hourly, daily, weekly, or monthly intervals, optional grouping by event dimensions (e.g. $message), and a timezone for bucketing. Ideal for building reports and dashboards from Klaviyo event data.
   * @route POST /metric-aggregates
   *
   * @paramDef {"type":"String","label":"Metric","name":"metricId","required":true,"dictionary":"getMetricsDictionary","description":"The metric to aggregate. Select a metric or provide its Klaviyo metric ID."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the query range (inclusive) as an ISO 8601 datetime, e.g. 2025-06-01T00:00:00Z."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the query range (exclusive) as an ISO 8601 datetime, e.g. 2025-07-01T00:00:00Z."}
   * @paramDef {"type":"Array<String>","label":"Measurements","name":"measurements","uiComponent":{"type":"DROPDOWN","options":{"values":["Count","Sum Value","Unique"]}},"description":"Measurements to compute per interval: Count (number of events), Sum Value (total monetary value), Unique (distinct profiles). Defaults to Count."}
   * @paramDef {"type":"String","label":"Interval","name":"interval","uiComponent":{"type":"DROPDOWN","options":{"values":["Hour","Day","Week","Month"]}},"defaultValue":"Day","description":"Time bucket size for the aggregation."}
   * @paramDef {"type":"Array<String>","label":"Group By","name":"groupBy","description":"Optional event dimensions to group results by, e.g. [\"$message\"] to split by campaign/flow message, or a custom event property name."}
   * @paramDef {"type":"String","label":"Timezone","name":"timezone","description":"IANA timezone used for interval bucketing, e.g. America/New_York. Defaults to UTC."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"metric-aggregate","id":"XVTP5Q","attributes":{"dates":["2025-06-01T00:00:00+00:00","2025-06-02T00:00:00+00:00"],"data":[{"dimensions":[],"measurements":{"count":[120,98]}}]}}}
   */
  async queryMetricAggregates(metricId, startDate, endDate, measurements, interval, groupBy, timezone) {
    const resolvedMeasurements = this.#resolveChoiceList(measurements, {
      'Count': 'count',
      'Sum Value': 'sum_value',
      'Unique': 'unique',
    }) || ['count']

    return await this.#apiRequest({
      logTag: '[queryMetricAggregates]',
      url: `${ API_BASE_URL }/metric-aggregates`,
      method: 'post',
      body: {
        data: {
          type: 'metric-aggregate',
          attributes: clean({
            metric_id: metricId,
            measurements: resolvedMeasurements,
            interval: this.#resolveChoice(interval, { 'Hour': 'hour', 'Day': 'day', 'Week': 'week', 'Month': 'month' }) || 'day',
            filter: [
              `greater-or-equal(datetime,${ startDate })`,
              `less-than(datetime,${ endDate })`,
            ],
            by: Array.isArray(groupBy) && groupBy.length > 0 ? groupBy : undefined,
            timezone: timezone || 'UTC',
          }),
        },
      },
    })
  }

  // ─── Campaigns ─────────────────────────────────────────────────────────

  /**
   * @operationName List Campaigns
   * @category Campaigns
   * @description Retrieves campaigns for a messaging channel (Email or SMS — the Klaviyo API requires a channel filter) with cursor-based pagination. Additional JSON:API filters on name, status, created_at, etc. can be combined, e.g. equals(status,"Draft"). Returns items (campaign resources) and nextCursor.
   * @route GET /campaigns
   *
   * @paramDef {"type":"String","label":"Channel","name":"channel","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","SMS"]}},"defaultValue":"Email","description":"Messaging channel of the campaigns to list. The Klaviyo API requires this filter."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Additional raw Klaviyo JSON:API filter expression, e.g. equals(status,\"Draft\") or greater-than(created_at,2025-01-01T00:00:00Z). Combined with the channel filter using AND."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"type":"campaign","id":"01GMRWDSA0ARTAKE1SFX8JGXAY","attributes":{"name":"Summer Sale Announcement","status":"Draft","archived":false,"audiences":{"included":["Y6nRLr"],"excluded":[]},"created_at":"2025-05-20T11:00:00+00:00","updated_at":"2025-06-01T09:00:00+00:00"}}],"nextCursor":null}
   */
  async listCampaigns(channel, filter, cursor) {
    const resolvedChannel = this.#resolveChoice(channel, { 'Email': 'email', 'SMS': 'sms' }) || 'email'

    const response = await this.#apiRequest({
      logTag: '[listCampaigns]',
      url: `${ API_BASE_URL }/campaigns`,
      query: {
        'filter': this.#combineFilters(`equals(messages.channel,'${ resolvedChannel }')`, filter),
        'page[cursor]': cursor,
      },
    })

    return this.#unwrapList(response)
  }

  /**
   * @operationName Get Campaign
   * @category Campaigns
   * @description Retrieves a single campaign by ID, including its name, status, audiences, send options, send strategy, and tracking options. Campaign creation involves complex nested payloads, so this service focuses on listing, inspecting, sending, and deleting campaigns created in the Klaviyo UI.
   * @route GET /campaigns/{campaignId}
   *
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The campaign to retrieve. Select a campaign or provide its Klaviyo campaign ID, e.g. 01GMRWDSA0ARTAKE1SFX8JGXAY."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"campaign","id":"01GMRWDSA0ARTAKE1SFX8JGXAY","attributes":{"name":"Summer Sale Announcement","status":"Draft","archived":false,"audiences":{"included":["Y6nRLr"],"excluded":[]},"send_options":{"use_smart_sending":true},"send_strategy":{"method":"static"},"created_at":"2025-05-20T11:00:00+00:00","updated_at":"2025-06-01T09:00:00+00:00"}}}
   */
  async getCampaign(campaignId) {
    return await this.#apiRequest({
      logTag: '[getCampaign]',
      url: `${ API_BASE_URL }/campaigns/${ campaignId }`,
    })
  }

  /**
   * @operationName Delete Campaign
   * @category Campaigns
   * @description Permanently deletes a campaign from the Klaviyo account. This action cannot be undone. Sent campaign analytics may no longer be accessible after deletion — consider archiving in the Klaviyo UI instead if you need to keep reporting.
   * @route DELETE /campaigns/{campaignId}
   *
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The campaign to delete. Select a campaign or provide its Klaviyo campaign ID."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteCampaign(campaignId) {
    await this.#apiRequest({
      logTag: '[deleteCampaign]',
      url: `${ API_BASE_URL }/campaigns/${ campaignId }`,
      method: 'delete',
    })

    return { success: true }
  }

  /**
   * @operationName Send Campaign
   * @category Campaigns
   * @description Triggers the send job for an existing draft campaign, sending it to its configured audiences according to its send strategy. The campaign must be fully configured (audience, message content, sender) in Klaviyo before it can be sent. Sending is processed asynchronously by Klaviyo.
   * @route POST /campaign-send-jobs
   *
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The campaign to send. Select a campaign or provide its Klaviyo campaign ID."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"campaignId":"01GMRWDSA0ARTAKE1SFX8JGXAY"}
   */
  async sendCampaign(campaignId) {
    const response = await this.#apiRequest({
      logTag: '[sendCampaign]',
      url: `${ API_BASE_URL }/campaign-send-jobs`,
      method: 'post',
      body: { data: { type: 'campaign-send-job', id: campaignId } },
    })

    return response?.data ? response : { success: true, campaignId }
  }

  /**
   * @operationName Get Campaign Recipient Estimation
   * @category Campaigns
   * @description Retrieves the estimated number of recipients a campaign will be sent to, based on its included and excluded audiences. The estimation is computed by Klaviyo when the campaign audience is saved and may lag recent audience changes.
   * @route GET /campaign-recipient-estimations/{campaignId}
   *
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The campaign whose recipient estimation to retrieve. Select a campaign or provide its Klaviyo campaign ID."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"campaign-recipient-estimation","id":"01GMRWDSA0ARTAKE1SFX8JGXAY","attributes":{"estimated_recipient_count":15420}}}
   */
  async getCampaignRecipientEstimation(campaignId) {
    return await this.#apiRequest({
      logTag: '[getCampaignRecipientEstimation]',
      url: `${ API_BASE_URL }/campaign-recipient-estimations/${ campaignId }`,
    })
  }

  // ─── Templates ─────────────────────────────────────────────────────────

  /**
   * @operationName List Templates
   * @category Templates
   * @description Retrieves the email templates in the Klaviyo account with cursor-based pagination (10 templates per page). Filter by exact name using the convenience parameter or supply a raw JSON:API filter on id, name, created, or updated. Returns items (template resources) and nextCursor.
   * @route GET /templates
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Only return templates with this exact name. Combined with the raw filter using AND when both are set."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Raw Klaviyo JSON:API filter expression, e.g. greater-than(created,2025-01-01T00:00:00Z). Leave empty to list all templates."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"type":"template","id":"KT5kfd","attributes":{"name":"Monthly Newsletter","editor_type":"CODE","created":"2025-02-01T10:00:00+00:00","updated":"2025-06-01T10:00:00+00:00"}}],"nextCursor":null}
   */
  async listTemplates(name, filter, cursor) {
    const response = await this.#apiRequest({
      logTag: '[listTemplates]',
      url: `${ API_BASE_URL }/templates`,
      query: {
        'filter': this.#combineFilters(
          name ? `equals(name,${ this.#filterValue(name) })` : null,
          filter
        ),
        'page[cursor]': cursor,
      },
    })

    return this.#unwrapList(response)
  }

  /**
   * @operationName Get Template
   * @category Templates
   * @description Retrieves a single email template by ID, including its name, editor type, HTML content, and plain-text version. Use with Render Template to produce personalized output for a given context.
   * @route GET /templates/{templateId}
   *
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"The template to retrieve. Select a template or provide its Klaviyo template ID, e.g. KT5kfd."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"template","id":"KT5kfd","attributes":{"name":"Monthly Newsletter","editor_type":"CODE","html":"<html><body><p>Hello {{ first_name }}</p></body></html>","text":"Hello {{ first_name }}","created":"2025-02-01T10:00:00+00:00","updated":"2025-06-01T10:00:00+00:00"}}}
   */
  async getTemplate(templateId) {
    return await this.#apiRequest({
      logTag: '[getTemplate]',
      url: `${ API_BASE_URL }/templates/${ templateId }`,
    })
  }

  /**
   * @operationName Create Template
   * @category Templates
   * @description Creates a new HTML (code editor) email template with the given name and content. The HTML may include Django-style template variables such as {{ first_name }} that are resolved when the template is rendered or sent. Returns the created template resource including its ID.
   * @route POST /templates
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the new template, e.g. Monthly Newsletter."}
   * @paramDef {"type":"String","label":"HTML","name":"html","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"HTML content of the template. May include template variables like {{ first_name }}."}
   * @paramDef {"type":"String","label":"Text","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional plain-text version of the template used by email clients that do not render HTML."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"template","id":"KT5kfd","attributes":{"name":"Monthly Newsletter","editor_type":"CODE","html":"<html><body><p>Hello {{ first_name }}</p></body></html>","created":"2025-06-15T10:00:00+00:00","updated":"2025-06-15T10:00:00+00:00"}}}
   */
  async createTemplate(name, html, text) {
    return await this.#apiRequest({
      logTag: '[createTemplate]',
      url: `${ API_BASE_URL }/templates`,
      method: 'post',
      body: {
        data: {
          type: 'template',
          attributes: clean({ name, editor_type: 'CODE', html, text }),
        },
      },
    })
  }

  /**
   * @operationName Render Template
   * @category Templates
   * @description Renders an email template with the provided context variables, resolving placeholders like {{ first_name }} into final HTML and text. Useful for previewing personalized output or producing HTML for sending through another channel.
   * @route POST /template-render
   *
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"The template to render. Select a template or provide its Klaviyo template ID."}
   * @paramDef {"type":"Object","label":"Context","name":"context","description":"Key-value map of variables substituted into the template, e.g. {\"first_name\":\"Sarah\",\"discount_code\":\"SUMMER20\"}."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"template","id":"KT5kfd","attributes":{"name":"Monthly Newsletter","html":"<html><body><p>Hello Sarah</p></body></html>","text":"Hello Sarah"}}}
   */
  async renderTemplate(templateId, context) {
    return await this.#apiRequest({
      logTag: '[renderTemplate]',
      url: `${ API_BASE_URL }/template-render`,
      method: 'post',
      body: {
        data: {
          type: 'template',
          id: templateId,
          attributes: { context: context || {} },
        },
      },
    })
  }

  // ─── Flows ─────────────────────────────────────────────────────────────

  /**
   * @operationName List Flows
   * @category Flows
   * @description Retrieves the automation flows in the Klaviyo account with cursor-based pagination. Supports Klaviyo JSON:API filtering on name, status, archived, created, updated, and trigger_type, e.g. equals(status,"live"). Returns items (flow resources) and nextCursor.
   * @route GET /flows
   *
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Raw Klaviyo JSON:API filter expression, e.g. equals(status,\"live\") or equals(archived,false). Leave empty to list all flows."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"type":"flow","id":"XVTP5Q","attributes":{"name":"Welcome Series","status":"live","archived":false,"created":"2024-11-01T10:00:00+00:00","updated":"2025-06-01T10:00:00+00:00","trigger_type":"List"}}],"nextCursor":null}
   */
  async listFlows(filter, cursor) {
    const response = await this.#apiRequest({
      logTag: '[listFlows]',
      url: `${ API_BASE_URL }/flows`,
      query: {
        'filter': filter,
        'page[cursor]': cursor,
      },
    })

    return this.#unwrapList(response)
  }

  /**
   * @operationName Get Flow
   * @category Flows
   * @description Retrieves a single automation flow by ID, including its name, status (live, draft, or manual), archived state, trigger type, and timestamps.
   * @route GET /flows/{flowId}
   *
   * @paramDef {"type":"String","label":"Flow","name":"flowId","required":true,"dictionary":"getFlowsDictionary","description":"The flow to retrieve. Select a flow or provide its Klaviyo flow ID, e.g. XVTP5Q."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"flow","id":"XVTP5Q","attributes":{"name":"Welcome Series","status":"live","archived":false,"created":"2024-11-01T10:00:00+00:00","updated":"2025-06-01T10:00:00+00:00","trigger_type":"List"}}}
   */
  async getFlow(flowId) {
    return await this.#apiRequest({
      logTag: '[getFlow]',
      url: `${ API_BASE_URL }/flows/${ flowId }`,
    })
  }

  /**
   * @operationName Update Flow Status
   * @category Flows
   * @description Changes the status of an automation flow: Live (actively sending to profiles that enter it), Draft (paused, no sends), or Manual (only profiles you add manually go through it). Setting a flow to Live starts real message sends — verify the flow content first.
   * @route PATCH /flows/{flowId}
   *
   * @paramDef {"type":"String","label":"Flow","name":"flowId","required":true,"dictionary":"getFlowsDictionary","description":"The flow to update. Select a flow or provide its Klaviyo flow ID."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Live","Draft","Manual"]}},"description":"New status for the flow. Live activates sending, Draft pauses the flow, Manual only processes manually added profiles."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"flow","id":"XVTP5Q","attributes":{"name":"Welcome Series","status":"draft","archived":false,"trigger_type":"List","updated":"2025-06-15T10:00:00+00:00"}}}
   */
  async updateFlowStatus(flowId, status) {
    return await this.#apiRequest({
      logTag: '[updateFlowStatus]',
      url: `${ API_BASE_URL }/flows/${ flowId }`,
      method: 'patch',
      body: {
        data: {
          type: 'flow',
          id: flowId,
          attributes: {
            status: this.#resolveChoice(status, { 'Live': 'live', 'Draft': 'draft', 'Manual': 'manual' }),
          },
        },
      },
    })
  }

  // ─── Tags ──────────────────────────────────────────────────────────────

  /**
   * @operationName List Tags
   * @category Tags
   * @description Retrieves the organizational tags in the Klaviyo account with cursor-based pagination. Tags can be applied to lists, segments, campaigns, and flows in Klaviyo. Supports JSON:API filtering on name, e.g. contains(name,"holiday").
   * @route GET /tags
   *
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Raw Klaviyo JSON:API filter expression, e.g. contains(name,\"holiday\") or equals(name,\"holiday-2025\"). Leave empty to list all tags."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"type":"tag","id":"9c9e6a80-49f1-11f0-8001-0242ac110002","attributes":{"name":"holiday-2025"}}],"nextCursor":null}
   */
  async listTags(filter, cursor) {
    const response = await this.#apiRequest({
      logTag: '[listTags]',
      url: `${ API_BASE_URL }/tags`,
      query: {
        'filter': filter,
        'page[cursor]': cursor,
      },
    })

    return this.#unwrapList(response)
  }

  /**
   * @operationName Create Tag
   * @category Tags
   * @description Creates a new tag in the account's default tag group. Tags help organize lists, segments, campaigns, and flows. Returns the created tag resource including its ID.
   * @route POST /tags
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the new tag, e.g. holiday-2025. Tag names must be unique within their tag group."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"tag","id":"9c9e6a80-49f1-11f0-8001-0242ac110002","attributes":{"name":"holiday-2025"}}}
   */
  async createTag(name) {
    return await this.#apiRequest({
      logTag: '[createTag]',
      url: `${ API_BASE_URL }/tags`,
      method: 'post',
      body: { data: { type: 'tag', attributes: { name } } },
    })
  }

  /**
   * @operationName Delete Tag
   * @category Tags
   * @description Permanently deletes a tag from the Klaviyo account and removes it from every resource it is applied to. The tagged lists, segments, campaigns, and flows themselves are not affected. This action cannot be undone.
   * @route DELETE /tags/{tagId}
   *
   * @paramDef {"type":"String","label":"Tag","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"The tag to delete. Select a tag or provide its Klaviyo tag ID (a UUID)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteTag(tagId) {
    await this.#apiRequest({
      logTag: '[deleteTag]',
      url: `${ API_BASE_URL }/tags/${ tagId }`,
      method: 'delete',
    })

    return { success: true }
  }

  // ─── Data Privacy ──────────────────────────────────────────────────────

  /**
   * @operationName Request Profile Deletion
   * @category Data Privacy
   * @description Submits a GDPR/CCPA data privacy deletion request for the profile with the given email address. WARNING: this permanently and irreversibly deletes the profile and all of its associated data (events, consent history, analytics) from Klaviyo once processed. Use Suppress Profiles instead if you only want to stop sending to someone.
   * @route POST /data-privacy-deletion-jobs
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the profile to permanently delete from Klaviyo."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"email":"sarah.mason@klaviyo-demo.com"}
   */
  async requestProfileDeletion(email) {
    await this.#apiRequest({
      logTag: '[requestProfileDeletion]',
      url: `${ API_BASE_URL }/data-privacy-deletion-jobs`,
      method: 'post',
      body: {
        data: {
          type: 'data-privacy-deletion-job',
          attributes: {
            profile: { data: { type: 'profile', attributes: { email } } },
          },
        },
      },
    })

    return { success: true, email }
  }

  // ─── Dictionary Helpers ────────────────────────────────────────────────

  async #resourceDictionary({ url, query, search, mapItem, logTag }) {
    const response = await this.#apiRequest({ url, query, logTag })

    let items = (response.data || []).map(mapItem)

    if (search) {
      const term = search.toLowerCase()

      items = items.filter(item => item.label.toLowerCase().includes(term))
    }

    return { items, cursor: this.#extractCursor(response.links) }
  }

  // ─── Dictionary Typedefs ───────────────────────────────────────────────

  /**
   * @typedef {Object} getListsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter lists by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of lists."}
   */

  /**
   * @typedef {Object} getSegmentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter segments by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of segments."}
   */

  /**
   * @typedef {Object} getMetricsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter metrics by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of metrics."}
   */

  /**
   * @typedef {Object} getCampaignsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Channel","name":"channel","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","SMS"]}},"defaultValue":"Email","description":"Messaging channel of the campaigns to list. Defaults to Email."}
   */

  /**
   * @typedef {Object} getCampaignsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter campaigns by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of campaigns."}
   * @paramDef {"type":"getCampaignsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional criteria selecting the campaign messaging channel (Email or SMS)."}
   */

  /**
   * @typedef {Object} getTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter templates by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of templates."}
   */

  /**
   * @typedef {Object} getFlowsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter flows by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of flows."}
   */

  /**
   * @typedef {Object} getTagsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tags by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of tags."}
   */

  // ─── Dictionary Methods ────────────────────────────────────────────────

  /**
   * @registerAs DICTIONARY
   * @operationName Get Lists Dictionary
   * @description Provides the account's lists for selection in list parameters. The option value is the Klaviyo list ID.
   * @route POST /get-lists-dictionary
   * @paramDef {"type":"getListsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for filtering lists."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Newsletter","value":"Y6nRLr","note":"Created 2025-01-15"}],"cursor":null}
   */
  async getListsDictionary(payload) {
    const { search, cursor } = payload || {}

    return await this.#resourceDictionary({
      logTag: '[getListsDictionary]',
      url: `${ API_BASE_URL }/lists`,
      query: { 'page[cursor]': cursor },
      search,
      mapItem: list => ({
        label: list.attributes?.name || list.id,
        value: list.id,
        note: list.attributes?.created ? `Created ${ list.attributes.created.slice(0, 10) }` : undefined,
      }),
    })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Segments Dictionary
   * @description Provides the account's segments for selection in segment parameters. The option value is the Klaviyo segment ID.
   * @route POST /get-segments-dictionary
   * @paramDef {"type":"getSegmentsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for filtering segments."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"VIP Customers","value":"W92xRt","note":"Active"}],"cursor":null}
   */
  async getSegmentsDictionary(payload) {
    const { search, cursor } = payload || {}

    return await this.#resourceDictionary({
      logTag: '[getSegmentsDictionary]',
      url: `${ API_BASE_URL }/segments`,
      query: { 'page[cursor]': cursor },
      search,
      mapItem: segment => ({
        label: segment.attributes?.name || segment.id,
        value: segment.id,
        note: segment.attributes?.is_active === false ? 'Inactive' : 'Active',
      }),
    })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Metrics Dictionary
   * @description Provides the account's metrics (event types) for selection in metric parameters. The option value is the Klaviyo metric ID and the note shows the source integration when available.
   * @route POST /get-metrics-dictionary
   * @paramDef {"type":"getMetricsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for filtering metrics."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Placed Order","value":"XVTP5Q","note":"Shopify"}],"cursor":null}
   */
  async getMetricsDictionary(payload) {
    const { search, cursor } = payload || {}

    return await this.#resourceDictionary({
      logTag: '[getMetricsDictionary]',
      url: `${ API_BASE_URL }/metrics`,
      query: { 'page[cursor]': cursor },
      search,
      mapItem: metric => ({
        label: metric.attributes?.name || metric.id,
        value: metric.id,
        note: metric.attributes?.integration?.name || undefined,
      }),
    })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Campaigns Dictionary
   * @description Provides the account's campaigns for selection in campaign parameters, filtered by messaging channel (Email by default, SMS via criteria). The option value is the Klaviyo campaign ID and the note shows the campaign status.
   * @route POST /get-campaigns-dictionary
   * @paramDef {"type":"getCampaignsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and optional channel criteria for filtering campaigns."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Summer Sale Announcement","value":"01GMRWDSA0ARTAKE1SFX8JGXAY","note":"Draft"}],"cursor":null}
   */
  async getCampaignsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}

    const channel = this.#resolveChoice(criteria?.channel, { 'Email': 'email', 'SMS': 'sms' }) || 'email'

    return await this.#resourceDictionary({
      logTag: '[getCampaignsDictionary]',
      url: `${ API_BASE_URL }/campaigns`,
      query: {
        'filter': `equals(messages.channel,'${ channel }')`,
        'page[cursor]': cursor,
      },
      search,
      mapItem: campaign => ({
        label: campaign.attributes?.name || campaign.id,
        value: campaign.id,
        note: campaign.attributes?.status || undefined,
      }),
    })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Templates Dictionary
   * @description Provides the account's email templates for selection in template parameters. The option value is the Klaviyo template ID and the note shows the editor type.
   * @route POST /get-templates-dictionary
   * @paramDef {"type":"getTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for filtering templates."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Monthly Newsletter","value":"KT5kfd","note":"CODE"}],"cursor":null}
   */
  async getTemplatesDictionary(payload) {
    const { search, cursor } = payload || {}

    return await this.#resourceDictionary({
      logTag: '[getTemplatesDictionary]',
      url: `${ API_BASE_URL }/templates`,
      query: { 'page[cursor]': cursor },
      search,
      mapItem: template => ({
        label: template.attributes?.name || template.id,
        value: template.id,
        note: template.attributes?.editor_type || undefined,
      }),
    })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Flows Dictionary
   * @description Provides the account's automation flows for selection in flow parameters. The option value is the Klaviyo flow ID and the note shows the flow status.
   * @route POST /get-flows-dictionary
   * @paramDef {"type":"getFlowsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for filtering flows."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Welcome Series","value":"XVTP5Q","note":"live"}],"cursor":null}
   */
  async getFlowsDictionary(payload) {
    const { search, cursor } = payload || {}

    return await this.#resourceDictionary({
      logTag: '[getFlowsDictionary]',
      url: `${ API_BASE_URL }/flows`,
      query: { 'page[cursor]': cursor },
      search,
      mapItem: flow => ({
        label: flow.attributes?.name || flow.id,
        value: flow.id,
        note: flow.attributes?.status || undefined,
      }),
    })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Provides the account's tags for selection in tag parameters. The option value is the Klaviyo tag ID (a UUID).
   * @route POST /get-tags-dictionary
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for filtering tags."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"holiday-2025","value":"9c9e6a80-49f1-11f0-8001-0242ac110002"}],"cursor":null}
   */
  async getTagsDictionary(payload) {
    const { search, cursor } = payload || {}

    return await this.#resourceDictionary({
      logTag: '[getTagsDictionary]',
      url: `${ API_BASE_URL }/tags`,
      query: { 'page[cursor]': cursor },
      search,
      mapItem: tag => ({
        label: tag.attributes?.name || tag.id,
        value: tag.id,
      }),
    })
  }
}

Flowrunner.ServerCode.addService(Klaviyo, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your private API key (pk_...). Create it in Klaviyo under Settings → API keys. Use a full-access key or one scoped to the endpoints you need (profiles, lists, segments, events, metrics, campaigns, templates, flows, tags).',
  },
])
