const logger = {
  info: (...args) => console.log('[Kajabi] info:', ...args),
  debug: (...args) => console.log('[Kajabi] debug:', ...args),
  error: (...args) => console.log('[Kajabi] error:', ...args),
  warn: (...args) => console.log('[Kajabi] warn:', ...args),
}

const API_BASE_URL = 'https://api.kajabi.com/v1'
const TOKEN_URL = 'https://api.kajabi.com/v1/oauth/token'

// Kajabi's Public API follows the JSON:API spec (application/vnd.api+json).
const JSON_API_CONTENT_TYPE = 'application/vnd.api+json'

const DEFAULT_PAGE_SIZE = 25
const DICTIONARY_PAGE_SIZE = 50

// Removes undefined/null/'' values so we never send empty query params or attributes.
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
 * @integrationName Kajabi
 * @integrationIcon /icon.svg
 */
class KajabiService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret

    // Access token is cached on the instance for the duration of a single invocation.
    this.accessToken = null
  }

  // ---------------------------------------------------------------------------
  // Authentication (OAuth2 client_credentials, machine-to-machine)
  // ---------------------------------------------------------------------------

  // Requests (and caches) a Bearer access token via the client_credentials grant.
  async #getToken() {
    if (this.accessToken) {
      return this.accessToken
    }

    if (!this.clientId || !this.clientSecret) {
      throw new Error('Kajabi API error: Client ID and Client Secret are required. Create API credentials in Kajabi under Settings -> Third Party Integrations -> Public API.')
    }

    try {
      logger.debug('[#getToken] - requesting client_credentials access token')

      const formData = new Flowrunner.Request.FormData()

      formData.append('grant_type', 'client_credentials')
      formData.append('client_id', this.clientId)
      formData.append('client_secret', this.clientSecret)

      const response = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Accept': 'application/json' })
        .send(formData)

      const token = response?.access_token

      if (!token) {
        throw new Error('token endpoint did not return an access_token')
      }

      this.accessToken = token

      return token
    } catch (error) {
      const message = error.body?.error_description || error.body?.error || error.message

      logger.error(`[#getToken] - authentication failed: ${ message }`)

      throw new Error(`Kajabi API error: authentication failed - ${ message }`)
    }
  }

  // Single private request helper — all external API calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    const token = await this.#getToken()

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ token }`,
          'Content-Type': JSON_API_CONTENT_TYPE,
          'Accept': JSON_API_CONTENT_TYPE,
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const jsonApiError = Array.isArray(error.body?.errors) ? error.body.errors[0] : undefined
      const message = jsonApiError?.detail || jsonApiError?.title || error.body?.message || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Kajabi API error: ${ message }`)
    }
  }

  // Maps a friendly dropdown label to its API value; passes through unknown values.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Extracts the next page number from a JSON:API links.next URL (page[number]=N).
  #nextPageFrom(response) {
    const nextLink = response?.links?.next

    if (!nextLink) {
      return null
    }

    const match = /[?&]page(?:%5B|\[)number(?:%5D|\])=(\d+)/.exec(nextLink)

    return match ? Number(match[1]) : null
  }

  // Normalizes a JSON:API list response into { items, nextPage, meta }.
  #listResult(response) {
    return {
      items: Array.isArray(response?.data) ? response.data : [],
      nextPage: this.#nextPageFrom(response),
      meta: response?.meta || {},
    }
  }

  // Builds standard JSON:API pagination/sort query params.
  #pagination(page, pageSize, sort) {
    return {
      'page[number]': page,
      'page[size]': pageSize,
      'sort': sort,
    }
  }

  // ---------------------------------------------------------------------------
  // Sites
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Sites
   * @category Sites
   * @description Lists the Kajabi sites the connected credentials can access. A Kajabi account can contain multiple sites, and most other operations are site-scoped, so use this first to discover the Site ID to pass into contact, offer, product, tag, and webhook operations. Returns each site's title and subdomain along with JSON:API pagination.
   * @route GET /sites
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of sites per page (max 100). Defaults to 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"123","type":"sites","attributes":{"title":"My Academy","subdomain":"my-academy","created_at":"2023-01-01T00:00:00Z","updated_at":"2024-01-01T00:00:00Z"}}],"nextPage":2,"meta":{"total_pages":2,"total_count":30,"current_page":1}}
   */
  async listSites(page, pageSize) {
    const response = await this.#apiRequest({
      logTag: '[listSites]',
      url: `${ API_BASE_URL }/sites`,
      method: 'get',
      query: this.#pagination(page, pageSize || DEFAULT_PAGE_SIZE),
    })

    return this.#listResult(response)
  }

  /**
   * @operationName Get Site
   * @category Sites
   * @description Retrieves a single Kajabi site by its ID, returning its title, subdomain, and timestamps. Use List Sites to discover available Site IDs.
   * @route GET /sites/get
   *
   * @paramDef {"type":"String","label":"Site ID","name":"siteId","required":true,"dictionary":"sitesDictionary","description":"The ID of the site to retrieve. Search and select a site, or enter an ID directly."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"123","type":"sites","attributes":{"title":"My Academy","subdomain":"my-academy","created_at":"2023-01-01T00:00:00Z","updated_at":"2024-01-01T00:00:00Z"}}}
   */
  async getSite(siteId) {
    return await this.#apiRequest({
      logTag: '[getSite]',
      url: `${ API_BASE_URL }/sites/${ encodeURIComponent(siteId) }`,
      method: 'get',
    })
  }

  // ---------------------------------------------------------------------------
  // Contacts
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Lists contacts (people) for a Kajabi site, with optional full-text search and filters for name, email, and tag/offer/product membership. Returns JSON:API contact resources including name, email, phone, address, and subscription status, plus pagination. Provide a Site ID to scope results to a single site.
   * @route GET /contacts
   *
   * @paramDef {"type":"String","label":"Site ID","name":"siteId","dictionary":"sitesDictionary","description":"Restrict results to a single site. Search and select a site, or enter an ID directly."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search across contact name and email."}
   * @paramDef {"type":"String","label":"Name Contains","name":"nameContains","description":"Filter to contacts whose name contains this text."}
   * @paramDef {"type":"String","label":"Email Contains","name":"emailContains","description":"Filter to contacts whose email contains this text."}
   * @paramDef {"type":"String","label":"Has Tag ID","name":"hasTagId","dictionary":"tagsDictionary","description":"Filter to contacts that have this contact tag. Search and select a tag, or enter a tag ID directly."}
   * @paramDef {"type":"String","label":"Has Offer ID","name":"hasOfferId","dictionary":"offersDictionary","description":"Filter to contacts that have been granted this offer. Search and select an offer, or enter an offer ID directly."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Name (A-Z)","Name (Z-A)","Email (A-Z)","Email (Z-A)","Newest First","Oldest First"]}},"description":"Order the returned contacts."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of contacts per page (max 100). Defaults to 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"456","type":"contacts","attributes":{"name":"John Doe","email":"john.doe@example.com","phone_number":null,"subscribed":true,"created_at":"2024-01-01T00:00:00Z"}}],"nextPage":2,"meta":{"total_pages":3,"total_count":75,"current_page":1}}
   */
  async listContacts(siteId, search, nameContains, emailContains, hasTagId, hasOfferId, sort, page, pageSize) {
    const response = await this.#apiRequest({
      logTag: '[listContacts]',
      url: `${ API_BASE_URL }/contacts`,
      method: 'get',
      query: {
        ...this.#pagination(page, pageSize || DEFAULT_PAGE_SIZE, this.#resolveChoice(sort, {
          'Name (A-Z)': 'name',
          'Name (Z-A)': '-name',
          'Email (A-Z)': 'email',
          'Email (Z-A)': '-email',
          'Newest First': '-created_at',
          'Oldest First': 'created_at',
        })),
        'filter[site_id]': siteId,
        'filter[search]': search,
        'filter[name_contains]': nameContains,
        'filter[email_contains]': emailContains,
        'filter[has_tag_id]': hasTagId,
        'filter[has_offer_id]': hasOfferId,
      },
    })

    return this.#listResult(response)
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves a single contact by ID, returning the full JSON:API contact resource with attributes (name, email, phone, address, subscription status) and relationships (site, tags, offers). Use List Contacts to discover contact IDs.
   * @route GET /contacts/get
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The ID of the contact to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"456","type":"contacts","attributes":{"name":"John Doe","email":"john.doe@example.com","subscribed":true},"relationships":{"site":{"data":{"id":"123","type":"sites"}}}}}
   */
  async getContact(contactId) {
    return await this.#apiRequest({
      logTag: '[getContact]',
      url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(contactId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Creates a contact on a Kajabi site. A Site ID is required so the contact is associated with the correct site. Email is required; name, phone, and address fields are optional. Returns the newly created JSON:API contact resource. Note: external_user_id is not supported at creation and only becomes available after the contact is granted an offer or makes a purchase.
   * @route POST /contacts
   *
   * @paramDef {"type":"String","label":"Site ID","name":"siteId","required":true,"dictionary":"sitesDictionary","description":"The site the contact belongs to. Search and select a site, or enter an ID directly."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The contact's email address."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The contact's full name."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","description":"The contact's phone number."}
   * @paramDef {"type":"Boolean","label":"Subscribed","name":"subscribed","uiComponent":{"type":"CHECKBOX"},"description":"Whether the contact is subscribed to marketing emails."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"addressLine1","description":"First line of the contact's mailing address."}
   * @paramDef {"type":"String","label":"Address Line 2","name":"addressLine2","description":"Second line of the contact's mailing address."}
   * @paramDef {"type":"String","label":"City","name":"addressCity","description":"City of the contact's mailing address."}
   * @paramDef {"type":"String","label":"State/Region","name":"addressState","description":"State or region of the contact's mailing address."}
   * @paramDef {"type":"String","label":"Country","name":"addressCountry","description":"Country of the contact's mailing address."}
   * @paramDef {"type":"String","label":"Postal Code","name":"addressZip","description":"Postal or ZIP code of the contact's mailing address."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"456","type":"contacts","attributes":{"name":"John Doe","email":"john.doe@example.com","subscribed":true}}}
   */
  async createContact(siteId, email, name, phoneNumber, subscribed, addressLine1, addressLine2, addressCity, addressState, addressCountry, addressZip) {
    return await this.#apiRequest({
      logTag: '[createContact]',
      url: `${ API_BASE_URL }/contacts`,
      method: 'post',
      body: {
        data: {
          type: 'contacts',
          attributes: clean({
            email,
            name,
            phone_number: phoneNumber,
            subscribed,
            address_line_1: addressLine1,
            address_line_2: addressLine2,
            address_city: addressCity,
            address_state: addressState,
            address_country: addressCountry,
            address_zip: addressZip,
          }),
          relationships: {
            site: { data: { type: 'sites', id: String(siteId) } },
          },
        },
      },
    })
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates attributes of an existing contact by ID. Only the fields you provide are changed; empty fields are left untouched. Returns the updated JSON:API contact resource.
   * @route PATCH /contacts
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The ID of the contact to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Updated full name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Updated email address."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","description":"Updated phone number."}
   * @paramDef {"type":"Boolean","label":"Subscribed","name":"subscribed","uiComponent":{"type":"CHECKBOX"},"description":"Updated marketing subscription status."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"addressLine1","description":"Updated first line of the mailing address."}
   * @paramDef {"type":"String","label":"Address Line 2","name":"addressLine2","description":"Updated second line of the mailing address."}
   * @paramDef {"type":"String","label":"City","name":"addressCity","description":"Updated city."}
   * @paramDef {"type":"String","label":"State/Region","name":"addressState","description":"Updated state or region."}
   * @paramDef {"type":"String","label":"Country","name":"addressCountry","description":"Updated country."}
   * @paramDef {"type":"String","label":"Postal Code","name":"addressZip","description":"Updated postal or ZIP code."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"456","type":"contacts","attributes":{"name":"Jane Doe","email":"jane.doe@example.com","subscribed":false}}}
   */
  async updateContact(contactId, name, email, phoneNumber, subscribed, addressLine1, addressLine2, addressCity, addressState, addressCountry, addressZip) {
    return await this.#apiRequest({
      logTag: '[updateContact]',
      url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(contactId) }`,
      method: 'patch',
      body: {
        data: {
          id: String(contactId),
          type: 'contacts',
          attributes: clean({
            name,
            email,
            phone_number: phoneNumber,
            subscribed,
            address_line_1: addressLine1,
            address_line_2: addressLine2,
            address_city: addressCity,
            address_state: addressState,
            address_country: addressCountry,
            address_zip: addressZip,
          }),
        },
      },
    })
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @description Permanently deletes a contact by ID. This action cannot be undone. Returns a confirmation object with the deleted contact ID.
   * @route DELETE /contacts
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The ID of the contact to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"contactId":"456"}
   */
  async deleteContact(contactId) {
    await this.#apiRequest({
      logTag: '[deleteContact]',
      url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(contactId) }`,
      method: 'delete',
    })

    return { deleted: true, contactId }
  }

  /**
   * @operationName Add Tag to Contact
   * @category Contacts
   * @description Adds an existing contact tag to a contact. Tags must already exist on the site (Kajabi's API does not create tags on demand) — use List Tags to find the tag ID. Returns the contact's updated list of tag resource identifiers.
   * @route POST /contacts/tags/add
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The ID of the contact to tag."}
   * @paramDef {"type":"String","label":"Tag ID","name":"tagId","required":true,"dictionary":"tagsDictionary","description":"The contact tag to add. Search and select a tag, or enter a tag ID directly."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"type":"contact_tags","id":"123"},{"type":"contact_tags","id":"789"}]}
   */
  async addTagToContact(contactId, tagId) {
    return await this.#apiRequest({
      logTag: '[addTagToContact]',
      url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(contactId) }/relationships/tags`,
      method: 'post',
      body: {
        data: [{ type: 'contact_tags', id: String(tagId) }],
      },
    })
  }

  /**
   * @operationName Remove Tag from Contact
   * @category Contacts
   * @description Removes a contact tag from a contact. Returns the contact's updated list of remaining tag resource identifiers. This removes the association only; the tag itself continues to exist on the site.
   * @route DELETE /contacts/tags/remove
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The ID of the contact to untag."}
   * @paramDef {"type":"String","label":"Tag ID","name":"tagId","required":true,"dictionary":"tagsDictionary","description":"The contact tag to remove. Search and select a tag, or enter a tag ID directly."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"type":"contact_tags","id":"123"}]}
   */
  async removeTagFromContact(contactId, tagId) {
    return await this.#apiRequest({
      logTag: '[removeTagFromContact]',
      url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(contactId) }/relationships/tags`,
      method: 'delete',
      body: {
        data: [{ type: 'contact_tags', id: String(tagId) }],
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Offers
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Offers
   * @category Offers
   * @description Lists active (non-archived) offers for a Kajabi site that can be granted to contacts. Returns JSON:API offer resources including title, price, currency, payment type, and checkout URL, plus pagination. Use offer IDs with Grant Offer to Contact.
   * @route GET /offers
   *
   * @paramDef {"type":"String","label":"Site ID","name":"siteId","dictionary":"sitesDictionary","description":"Restrict results to a single site. Search and select a site, or enter an ID directly."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Title (A-Z)","Title (Z-A)"]}},"description":"Order the returned offers by title."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of offers per page (max 100). Defaults to 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"123","type":"offers","attributes":{"title":"Advanced Course Bundle","price_in_cents":19900,"currency":"USD","payment_type":"one_time","checkout_url":"https://my-academy.mykajabi.com/offers/abc"}}],"nextPage":null,"meta":{"total_pages":1,"total_count":5,"current_page":1}}
   */
  async listOffers(siteId, sort, page, pageSize) {
    const response = await this.#apiRequest({
      logTag: '[listOffers]',
      url: `${ API_BASE_URL }/offers`,
      method: 'get',
      query: {
        ...this.#pagination(page, pageSize || DEFAULT_PAGE_SIZE, this.#resolveChoice(sort, {
          'Title (A-Z)': 'title',
          'Title (Z-A)': '-title',
        })),
        'filter[site_id]': siteId,
      },
    })

    return this.#listResult(response)
  }

  /**
   * @operationName Get Offer
   * @category Offers
   * @description Retrieves a single offer by ID, returning its full JSON:API resource including title, price, currency, payment type, checkout URL, and its related products. Use List Offers to discover offer IDs.
   * @route GET /offers/get
   *
   * @paramDef {"type":"String","label":"Offer ID","name":"offerId","required":true,"dictionary":"offersDictionary","description":"The ID of the offer to retrieve. Search and select an offer, or enter an ID directly."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"123","type":"offers","attributes":{"title":"Advanced Course Bundle","price_in_cents":19900,"currency":"USD","payment_type":"one_time","recurring_offer":false}}}
   */
  async getOffer(offerId) {
    return await this.#apiRequest({
      logTag: '[getOffer]',
      url: `${ API_BASE_URL }/offers/${ encodeURIComponent(offerId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Grant Offer to Contact
   * @category Offers
   * @description Grants an offer to a contact, enrolling them and giving access to the offer's products. If no matching customer exists, one is created from the contact's details. By default a welcome email is sent to the customer; set Send Welcome Email to false to suppress it. Returns the contact's updated list of granted offer identifiers.
   * @route POST /contacts/offers/grant
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The ID of the contact to grant the offer to."}
   * @paramDef {"type":"String","label":"Offer ID","name":"offerId","required":true,"dictionary":"offersDictionary","description":"The offer to grant. Search and select an offer, or enter an offer ID directly."}
   * @paramDef {"type":"Boolean","label":"Send Welcome Email","name":"sendWelcomeEmail","uiComponent":{"type":"CHECKBOX"},"description":"Whether to send the customer a welcome email. Defaults to true when left unset."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"type":"offers","id":"123"}]}
   */
  async grantOfferToContact(contactId, offerId, sendWelcomeEmail) {
    const body = {
      data: [{ type: 'offers', id: String(offerId) }],
    }

    if (sendWelcomeEmail !== undefined && sendWelcomeEmail !== null) {
      body.meta = { send_customer_welcome_email: sendWelcomeEmail }
    }

    return await this.#apiRequest({
      logTag: '[grantOfferToContact]',
      url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(contactId) }/relationships/offers`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Revoke Offer from Contact
   * @category Offers
   * @description Revokes a previously granted offer from a contact, removing their access to the offer's products. Returns the contact's updated list of remaining granted offer identifiers.
   * @route DELETE /contacts/offers/revoke
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The ID of the contact to revoke the offer from."}
   * @paramDef {"type":"String","label":"Offer ID","name":"offerId","required":true,"dictionary":"offersDictionary","description":"The offer to revoke. Search and select an offer, or enter an offer ID directly."}
   *
   * @returns {Object}
   * @sampleResult {"data":[]}
   */
  async revokeOfferFromContact(contactId, offerId) {
    return await this.#apiRequest({
      logTag: '[revokeOfferFromContact]',
      url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(contactId) }/relationships/offers`,
      method: 'delete',
      body: {
        data: [{ type: 'offers', id: String(offerId) }],
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Products & Courses
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Products
   * @category Products
   * @description Lists active (non-archived) products for a Kajabi site that can be granted to contacts. Returns JSON:API product resources including title, description, status, and member counts, plus pagination.
   * @route GET /products
   *
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Title (A-Z)","Title (Z-A)"]}},"description":"Order the returned products by title."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of products per page (max 100). Defaults to 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"321","type":"products","attributes":{"title":"Photography Masterclass","status":"published","description":"Learn photography from scratch"}}],"nextPage":null,"meta":{"total_pages":1,"total_count":3,"current_page":1}}
   */
  async listProducts(sort, page, pageSize) {
    const response = await this.#apiRequest({
      logTag: '[listProducts]',
      url: `${ API_BASE_URL }/products`,
      method: 'get',
      query: this.#pagination(page, pageSize || DEFAULT_PAGE_SIZE, this.#resolveChoice(sort, {
        'Title (A-Z)': 'title',
        'Title (Z-A)': '-title',
      })),
    })

    return this.#listResult(response)
  }

  /**
   * @operationName Get Product
   * @category Products
   * @description Retrieves a single product by ID, returning its full JSON:API resource including title, description, status, and member counts. Use List Products to discover product IDs.
   * @route GET /products/get
   *
   * @paramDef {"type":"String","label":"Product ID","name":"productId","required":true,"dictionary":"productsDictionary","description":"The ID of the product to retrieve. Search and select a product, or enter an ID directly."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"321","type":"products","attributes":{"title":"Photography Masterclass","status":"published","description":"Learn photography from scratch"}}}
   */
  async getProduct(productId) {
    return await this.#apiRequest({
      logTag: '[getProduct]',
      url: `${ API_BASE_URL }/products/${ encodeURIComponent(productId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Courses
   * @category Products
   * @description Lists courses for a Kajabi site with optional title/description filters and publish-status filtering. Returns JSON:API course resources including title, description, and thumbnail, plus pagination.
   * @route GET /courses
   *
   * @paramDef {"type":"String","label":"Site ID","name":"siteId","dictionary":"sitesDictionary","description":"Restrict results to a single site. Search and select a site, or enter an ID directly."}
   * @paramDef {"type":"String","label":"Title Contains","name":"titleContains","description":"Filter to courses whose title contains this text."}
   * @paramDef {"type":"String","label":"Publish Status","name":"publishStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Published","Draft"]}},"description":"Filter courses by publish status."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Title (A-Z)","Title (Z-A)","Newest First","Oldest First"]}},"description":"Order the returned courses."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of courses per page (max 100). Defaults to 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"654","type":"courses","attributes":{"title":"Intro to Baking","description":"A beginner course","thumbnail_url":"https://cdn.kajabi.com/thumb.jpg","created_at":"2024-01-01T00:00:00Z"}}],"nextPage":null,"meta":{"total_pages":1,"total_count":4,"current_page":1}}
   */
  async listCourses(siteId, titleContains, publishStatus, sort, page, pageSize) {
    const response = await this.#apiRequest({
      logTag: '[listCourses]',
      url: `${ API_BASE_URL }/courses`,
      method: 'get',
      query: {
        ...this.#pagination(page, pageSize || DEFAULT_PAGE_SIZE, this.#resolveChoice(sort, {
          'Title (A-Z)': 'title',
          'Title (Z-A)': '-title',
          'Newest First': '-created_at',
          'Oldest First': 'created_at',
        })),
        'filter[site_id]': siteId,
        'filter[title_cont]': titleContains,
        'filter[publish_status_eq]': this.#resolveChoice(publishStatus, {
          'Published': 'published',
          'Draft': 'draft',
        }),
      },
    })

    return this.#listResult(response)
  }

  /**
   * @operationName Get Course
   * @category Products
   * @description Retrieves a single course by ID, returning its full JSON:API resource including title, description, and thumbnail. Include related modules, lessons, or offers via the Include parameter to expand the response.
   * @route GET /courses/get
   *
   * @paramDef {"type":"String","label":"Course ID","name":"courseId","required":true,"description":"The ID of the course to retrieve."}
   * @paramDef {"type":"Array<String>","label":"Include","name":"include","uiComponent":{"type":"DROPDOWN","options":{"values":["modules","lessons","offers"]}},"description":"Related resources to include in the response (modules, lessons, offers)."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"654","type":"courses","attributes":{"title":"Intro to Baking","description":"A beginner course","thumbnail_url":"https://cdn.kajabi.com/thumb.jpg"}}}
   */
  async getCourse(courseId, include) {
    const includeParam = Array.isArray(include) && include.length > 0 ? include.join(',') : undefined

    return await this.#apiRequest({
      logTag: '[getCourse]',
      url: `${ API_BASE_URL }/courses/${ encodeURIComponent(courseId) }`,
      method: 'get',
      query: { include: includeParam },
    })
  }

  // ---------------------------------------------------------------------------
  // Tags
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Tags
   * @category Tags
   * @description Lists contact tags for a Kajabi site, with an optional name filter. Returns JSON:API contact-tag resources (id and name) plus pagination. Use tag IDs with Add Tag to Contact and Remove Tag from Contact. Note: Kajabi's public API does not support creating tags; tags are managed in the Kajabi dashboard.
   * @route GET /contact-tags
   *
   * @paramDef {"type":"String","label":"Site ID","name":"siteId","dictionary":"sitesDictionary","description":"Restrict results to a single site. Search and select a site, or enter an ID directly."}
   * @paramDef {"type":"String","label":"Name Contains","name":"nameContains","description":"Filter to tags whose name contains this text."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Name (A-Z)","Name (Z-A)"]}},"description":"Order the returned tags by name."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of tags per page (max 100). Defaults to 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"123","type":"contact_tags","attributes":{"name":"VIP"}}],"nextPage":null,"meta":{"total_pages":1,"total_count":8,"current_page":1}}
   */
  async listTags(siteId, nameContains, sort, page, pageSize) {
    const response = await this.#apiRequest({
      logTag: '[listTags]',
      url: `${ API_BASE_URL }/contact_tags`,
      method: 'get',
      query: {
        ...this.#pagination(page, pageSize || DEFAULT_PAGE_SIZE, this.#resolveChoice(sort, {
          'Name (A-Z)': 'name',
          'Name (Z-A)': '-name',
        })),
        'filter[site_id]': siteId,
        'filter[name_cont]': nameContains,
      },
    })

    return this.#listResult(response)
  }

  /**
   * @operationName Get Tag
   * @category Tags
   * @description Retrieves a single contact tag by ID, returning its JSON:API resource (id and name). Use List Tags to discover tag IDs.
   * @route GET /contact-tags/get
   *
   * @paramDef {"type":"String","label":"Tag ID","name":"tagId","required":true,"dictionary":"tagsDictionary","description":"The ID of the tag to retrieve. Search and select a tag, or enter an ID directly."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"123","type":"contact_tags","attributes":{"name":"VIP"}}}
   */
  async getTag(tagId) {
    return await this.#apiRequest({
      logTag: '[getTag]',
      url: `${ API_BASE_URL }/contact_tags/${ encodeURIComponent(tagId) }`,
      method: 'get',
    })
  }

  // ---------------------------------------------------------------------------
  // Purchases, Orders & Transactions
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Purchases
   * @category Commerce
   * @description Lists purchases (offer grants a contact has bought or received) for a Kajabi site, with filters for active/deactivated status, referrer, coupon code, and customer. Returns JSON:API purchase resources plus pagination.
   * @route GET /purchases
   *
   * @paramDef {"type":"String","label":"Site ID","name":"siteId","dictionary":"sitesDictionary","description":"Restrict results to a single site. Search and select a site, or enter an ID directly."}
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","description":"Filter to purchases belonging to a specific customer."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Deactivated"]}},"description":"Filter purchases by activation status."}
   * @paramDef {"type":"String","label":"Coupon Code","name":"couponCode","description":"Filter to purchases that used this exact coupon code."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of purchases per page (max 100). Defaults to 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"987","type":"purchases","attributes":{"active":true,"created_at":"2024-05-01T00:00:00Z"}}],"nextPage":null,"meta":{"total_pages":1,"total_count":2,"current_page":1}}
   */
  async listPurchases(siteId, customerId, status, couponCode, page, pageSize) {
    const query = {
      ...this.#pagination(page, pageSize || DEFAULT_PAGE_SIZE),
      'filter[site_id]': siteId,
      'filter[customer_id]': customerId,
      'filter[coupon_code_eq]': couponCode,
    }

    if (status === 'Active') {
      query['filter[active]'] = true
    } else if (status === 'Deactivated') {
      query['filter[deactivated]'] = true
    }

    const response = await this.#apiRequest({
      logTag: '[listPurchases]',
      url: `${ API_BASE_URL }/purchases`,
      method: 'get',
      query,
    })

    return this.#listResult(response)
  }

  /**
   * @operationName Get Purchase
   * @category Commerce
   * @description Retrieves a single purchase by ID, returning its full JSON:API resource. Use List Purchases to discover purchase IDs.
   * @route GET /purchases/get
   *
   * @paramDef {"type":"String","label":"Purchase ID","name":"purchaseId","required":true,"description":"The ID of the purchase to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"987","type":"purchases","attributes":{"active":true,"created_at":"2024-05-01T00:00:00Z"}}}
   */
  async getPurchase(purchaseId) {
    return await this.#apiRequest({
      logTag: '[getPurchase]',
      url: `${ API_BASE_URL }/purchases/${ encodeURIComponent(purchaseId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Orders
   * @category Commerce
   * @description Lists orders for a Kajabi site, with filters for customer, order number, and fulfillment status. Returns JSON:API order resources plus pagination.
   * @route GET /orders
   *
   * @paramDef {"type":"String","label":"Site ID","name":"siteId","dictionary":"sitesDictionary","description":"Restrict results to a single site. Search and select a site, or enter an ID directly."}
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","description":"Filter to orders belonging to a specific customer."}
   * @paramDef {"type":"String","label":"Order Number","name":"orderNumber","description":"Filter to the order with this exact order number."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of orders per page (max 100). Defaults to 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"555","type":"orders","attributes":{"order_number":"1001","created_at":"2024-05-01T00:00:00Z"}}],"nextPage":null,"meta":{"total_pages":1,"total_count":1,"current_page":1}}
   */
  async listOrders(siteId, customerId, orderNumber, page, pageSize) {
    const response = await this.#apiRequest({
      logTag: '[listOrders]',
      url: `${ API_BASE_URL }/orders`,
      method: 'get',
      query: {
        ...this.#pagination(page, pageSize || DEFAULT_PAGE_SIZE),
        'filter[site_id]': siteId,
        'filter[customer_id]': customerId,
        'filter[order_number_eq]': orderNumber,
      },
    })

    return this.#listResult(response)
  }

  /**
   * @operationName Get Order
   * @category Commerce
   * @description Retrieves a single order by ID, returning its full JSON:API resource including order number and timestamps. Use List Orders to discover order IDs.
   * @route GET /orders/get
   *
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"The ID of the order to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"555","type":"orders","attributes":{"order_number":"1001","created_at":"2024-05-01T00:00:00Z"}}}
   */
  async getOrder(orderId) {
    return await this.#apiRequest({
      logTag: '[getOrder]',
      url: `${ API_BASE_URL }/orders/${ encodeURIComponent(orderId) }`,
      method: 'get',
    })
  }

  // ---------------------------------------------------------------------------
  // Forms
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Forms
   * @category Forms
   * @description Lists opt-in and marketing forms for a Kajabi site, with an optional title filter. Returns JSON:API form resources plus pagination.
   * @route GET /forms
   *
   * @paramDef {"type":"String","label":"Site ID","name":"siteId","dictionary":"sitesDictionary","description":"Restrict results to a single site. Search and select a site, or enter an ID directly."}
   * @paramDef {"type":"String","label":"Title Contains","name":"titleContains","description":"Filter to forms whose title contains this text."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of forms per page (max 100). Defaults to 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"222","type":"forms","attributes":{"title":"Newsletter Signup"}}],"nextPage":null,"meta":{"total_pages":1,"total_count":1,"current_page":1}}
   */
  async listForms(siteId, titleContains, page, pageSize) {
    const response = await this.#apiRequest({
      logTag: '[listForms]',
      url: `${ API_BASE_URL }/forms`,
      method: 'get',
      query: {
        ...this.#pagination(page, pageSize || DEFAULT_PAGE_SIZE),
        'filter[site_id]': siteId,
        'filter[title_cont]': titleContains,
      },
    })

    return this.#listResult(response)
  }

  /**
   * @operationName Get Form
   * @category Forms
   * @description Retrieves a single form by ID, returning its full JSON:API resource. Use List Forms to discover form IDs.
   * @route GET /forms/get
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"description":"The ID of the form to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"222","type":"forms","attributes":{"title":"Newsletter Signup"}}}
   */
  async getForm(formId) {
    return await this.#apiRequest({
      logTag: '[getForm]',
      url: `${ API_BASE_URL }/forms/${ encodeURIComponent(formId) }`,
      method: 'get',
    })
  }

  // ---------------------------------------------------------------------------
  // Webhooks (Hooks)
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Webhooks
   * @category Webhooks
   * @description Lists webhooks (hooks) configured for a Kajabi site. Returns JSON:API hook resources including target URL and subscribed event, plus pagination.
   * @route GET /webhooks
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of webhooks per page (max 100). Defaults to 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"77","type":"hooks","attributes":{"target_url":"https://example.com/webhook","event":"tag_added"}}],"nextPage":null,"meta":{"total_pages":1,"total_count":1,"current_page":1}}
   */
  async listWebhooks(page, pageSize) {
    const response = await this.#apiRequest({
      logTag: '[listWebhooks]',
      url: `${ API_BASE_URL }/hooks`,
      method: 'get',
      query: this.#pagination(page, pageSize || DEFAULT_PAGE_SIZE),
    })

    return this.#listResult(response)
  }

  /**
   * @operationName Create Webhook
   * @category Webhooks
   * @description Creates a webhook (hook) on a Kajabi site that delivers events to your target URL. Choose the event to subscribe to; optionally provide a Resource ID (for example a contact tag ID) to filter to a specific resource, or leave it blank to receive all events of that type. Requires that your API credentials have the scopes for the chosen event. Returns the created JSON:API hook resource.
   * @route POST /webhooks
   *
   * @paramDef {"type":"String","label":"Site ID","name":"siteId","required":true,"dictionary":"sitesDictionary","description":"The site the webhook belongs to. Search and select a site, or enter an ID directly."}
   * @paramDef {"type":"String","label":"Target URL","name":"targetUrl","required":true,"description":"The HTTPS URL where webhook events will be delivered."}
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Purchase","Payment Succeeded","Order Created","Form Submission","Tag Added","Tag Removed"]}},"description":"The event type to subscribe to."}
   * @paramDef {"type":"String","label":"Resource ID","name":"resourceId","description":"Optional resource ID to filter events (e.g. a contact tag ID for Tag Added/Removed). Leave blank for a wildcard webhook covering all events of the type."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"77","type":"hooks","attributes":{"target_url":"https://example.com/webhook","event":"tag_added","resource_id":"123"}}}
   */
  async createWebhook(siteId, targetUrl, event, resourceId) {
    return await this.#apiRequest({
      logTag: '[createWebhook]',
      url: `${ API_BASE_URL }/hooks`,
      method: 'post',
      body: {
        data: {
          type: 'hooks',
          attributes: clean({
            target_url: targetUrl,
            event: this.#resolveChoice(event, {
              'Purchase': 'purchase',
              'Payment Succeeded': 'payment_succeeded',
              'Order Created': 'order_created',
              'Form Submission': 'form_submission',
              'Tag Added': 'tag_added',
              'Tag Removed': 'tag_removed',
            }),
            resource_id: resourceId,
          }),
          relationships: {
            site: { data: { type: 'sites', id: String(siteId) } },
          },
        },
      },
    })
  }

  /**
   * @operationName Get Webhook
   * @category Webhooks
   * @description Retrieves a single webhook (hook) by ID, returning its target URL and subscribed event. Use List Webhooks to discover webhook IDs.
   * @route GET /webhooks/get
   *
   * @paramDef {"type":"String","label":"Webhook ID","name":"webhookId","required":true,"description":"The ID of the webhook to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"77","type":"hooks","attributes":{"target_url":"https://example.com/webhook","event":"tag_added"}}}
   */
  async getWebhook(webhookId) {
    return await this.#apiRequest({
      logTag: '[getWebhook]',
      url: `${ API_BASE_URL }/hooks/${ encodeURIComponent(webhookId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Delete Webhook
   * @category Webhooks
   * @description Deletes a webhook (hook) by ID so it stops delivering events. Returns a confirmation object with the deleted webhook ID.
   * @route DELETE /webhooks
   *
   * @paramDef {"type":"String","label":"Webhook ID","name":"webhookId","required":true,"description":"The ID of the webhook to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"webhookId":"77"}
   */
  async deleteWebhook(webhookId) {
    await this.#apiRequest({
      logTag: '[deleteWebhook]',
      url: `${ API_BASE_URL }/hooks/${ encodeURIComponent(webhookId) }`,
      method: 'delete',
    })

    return { deleted: true, webhookId }
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} sitesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter sites by title (client-side)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for the next page of sites."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sites Dictionary
   * @description Lists Kajabi sites for selection in Site ID parameters. The option value is the site ID.
   * @route POST /sites-dictionary
   * @paramDef {"type":"sitesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for filtering sites."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My Academy","value":"123","note":"my-academy"}],"cursor":null}
   */
  async sitesDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[sitesDictionary]',
      url: `${ API_BASE_URL }/sites`,
      method: 'get',
      query: this.#pagination(cursor ? Number(cursor) : 1, DICTIONARY_PAGE_SIZE),
    })

    const items = (response?.data || [])
      .filter(site => !search || (site.attributes?.title || '').toLowerCase().includes(String(search).toLowerCase()))
      .map(site => ({
        label: site.attributes?.title || site.id,
        value: site.id,
        note: site.attributes?.subdomain || undefined,
      }))

    return { items, cursor: this.#nextPageFrom(response) }
  }

  /**
   * @typedef {Object} offersDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Site ID","name":"siteId","description":"Optional site ID to scope offers to a single site."}
   */

  /**
   * @typedef {Object} offersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter offers by title (client-side)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for the next page of offers."}
   * @paramDef {"type":"offersDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional site scoping for the offers list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Offers Dictionary
   * @description Lists Kajabi offers for selection in Offer ID parameters. The option value is the offer ID.
   * @route POST /offers-dictionary
   * @paramDef {"type":"offersDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and optional site criteria for filtering offers."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Advanced Course Bundle","value":"123","note":"$199.00 USD"}],"cursor":null}
   */
  async offersDictionary(payload) {
    const { search, cursor, criteria } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[offersDictionary]',
      url: `${ API_BASE_URL }/offers`,
      method: 'get',
      query: {
        ...this.#pagination(cursor ? Number(cursor) : 1, DICTIONARY_PAGE_SIZE),
        'filter[site_id]': criteria?.siteId,
      },
    })

    const items = (response?.data || [])
      .filter(offer => !search || (offer.attributes?.title || '').toLowerCase().includes(String(search).toLowerCase()))
      .map(offer => {
        const attrs = offer.attributes || {}
        const price = typeof attrs.price_in_cents === 'number'
          ? `${ (attrs.price_in_cents / 100).toFixed(2) } ${ attrs.currency || '' }`.trim()
          : undefined

        return {
          label: attrs.title || offer.id,
          value: offer.id,
          note: price || undefined,
        }
      })

    return { items, cursor: this.#nextPageFrom(response) }
  }

  /**
   * @typedef {Object} productsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter products by title (client-side)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for the next page of products."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Products Dictionary
   * @description Lists Kajabi products for selection in Product ID parameters. The option value is the product ID.
   * @route POST /products-dictionary
   * @paramDef {"type":"productsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for filtering products."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Photography Masterclass","value":"321","note":"published"}],"cursor":null}
   */
  async productsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[productsDictionary]',
      url: `${ API_BASE_URL }/products`,
      method: 'get',
      query: this.#pagination(cursor ? Number(cursor) : 1, DICTIONARY_PAGE_SIZE),
    })

    const items = (response?.data || [])
      .filter(product => !search || (product.attributes?.title || '').toLowerCase().includes(String(search).toLowerCase()))
      .map(product => ({
        label: product.attributes?.title || product.id,
        value: product.id,
        note: product.attributes?.status || undefined,
      }))

    return { items, cursor: this.#nextPageFrom(response) }
  }

  /**
   * @typedef {Object} tagsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Site ID","name":"siteId","description":"Optional site ID to scope tags to a single site."}
   */

  /**
   * @typedef {Object} tagsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter tags by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for the next page of tags."}
   * @paramDef {"type":"tagsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional site scoping for the tags list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Lists Kajabi contact tags for selection in Tag ID parameters. The option value is the tag ID.
   * @route POST /tags-dictionary
   * @paramDef {"type":"tagsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and optional site criteria for filtering tags."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"VIP","value":"123","note":"Tag"}],"cursor":null}
   */
  async tagsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[tagsDictionary]',
      url: `${ API_BASE_URL }/contact_tags`,
      method: 'get',
      query: {
        ...this.#pagination(cursor ? Number(cursor) : 1, DICTIONARY_PAGE_SIZE),
        'filter[site_id]': criteria?.siteId,
        'filter[name_cont]': search,
      },
    })

    const items = (response?.data || []).map(tag => ({
      label: tag.attributes?.name || tag.id,
      value: tag.id,
      note: 'Tag',
    }))

    return { items, cursor: this.#nextPageFrom(response) }
  }
}

Flowrunner.ServerCode.addService(KajabiService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Kajabi Public API Client ID. In Kajabi, go to Settings -> Third Party Integrations -> Public API and create API credentials.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Kajabi Public API Client Secret, created alongside the Client ID under Settings -> Third Party Integrations -> Public API.',
  },
])
