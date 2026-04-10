const { cleanupObject, getLabel, getStickerLabel, searchFilter } = require('./utils')

const logger = {
  info: (...args) => console.log('[Trello Service] info:', ...args),
  debug: (...args) => console.log('[Trello Service] debug:', ...args),
  error: (...args) => console.log('[Trello Service] error:', ...args),
  warn: (...args) => console.log('[Trello Service] warn:', ...args),
}

const API_BASE_URL = 'https://api.trello.com/1'

/**
 * @integrationName Trello
 * @integrationIcon /icon.png
 **/
class Trello {
  constructor(config) {
    this.apiKey = config.apiKey
    this.token = config.token
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'
    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url)
        .set({ Authorization: `OAuth oauth_consumer_key="${ this.apiKey }", oauth_token="${ this.token }"` })
        .query(query)
        .send(body)
    } catch (error) {
      logger.error(`[${ logTag }] Error: ${ JSON.stringify(error.message) }`)

      throw error
    }
  }

  /**
   * @typedef {Object} BackgroundImageScaled
   * @property {Number} width - The width of the image
   * @property {Number} height - The height of the image
   * @property {String} url - The URL of the image. Format: url
   */

  /**
   * @typedef {Object} Prefs
   * @property {String} permissionLevel - Valid values: 'org', 'board'
   * @property {Boolean} hideVotes
   * @property {String} voting - Valid values: 'disabled', 'enabled'
   * @property {String} comments
   * @property {any} invitations
   * @property {Boolean} selfJoin
   * @property {Boolean} cardCovers
   * @property {Boolean} isTemplate
   * @property {String} cardAging - Valid values: 'pirate', 'regular'
   * @property {Boolean} calendarFeedEnabled
   * @property {String} background - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} backgroundImage - Format: uri
   * @property {Array.<BackgroundImageScaled>} backgroundImageScaled
   * @property {Boolean} backgroundTile
   * @property {String} backgroundBrightness
   * @property {String} backgroundBottomColor
   * @property {String} backgroundTopColor
   * @property {Boolean} canBePublic
   * @property {Boolean} canBeEnterprise
   * @property {Boolean} canBeOrg
   * @property {Boolean} canBePrivate
   * @property {Boolean} canInvite
   */

  /**
   * @typedef {Object} LabelNames
   * @property {String} green
   * @property {String} yellow
   * @property {String} orange
   * @property {String} red
   * @property {String} purple
   * @property {String} blue
   * @property {String} sky
   * @property {String} lime
   * @property {String} pink
   * @property {String} black
   */

  /**
   * @typedef {Object} PerBoard
   * @property {String} status - Valid values: 'ok', 'warning'
   * @property {Number} disableAt
   * @property {Number} warnAt
   */

  /**
   * @typedef {Object} Attachments
   * @property {PerBoard} perBoard
   */

  /**
   * @typedef {Object} PerAction
   * @property {String} status
   * @property {Number} disableAt
   * @property {Number} warnAt
   */

  /**
   * @typedef {Object} Reactions
   * @property {PerAction} perAction
   * @property {PerAction} uniquePerAction
   */

  /**
   * @typedef {Object} Limits
   * @property {Attachments} attachments
   * @property {Reactions} reactions
   */

  /**
   * @typedef {Object} Board
   * @property {String} id - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} name - The name of the board
   * @property {String} desc
   * @property {String} descData
   * @property {Boolean} closed
   * @property {String} idMemberCreator - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} idOrganization - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Boolean} pinned
   * @property {String} url - Format: url
   * @property {String} shortUrl - Format: url
   * @property {Prefs} prefs
   * @property {LabelNames} labelNames
   * @property {Limits} limits
   * @property {Boolean} starred
   * @property {Array.<Member>} members
   * @property {String} memberships
   * @property {String} shortLink
   * @property {Boolean} subscribed
   * @property {String} powerUps
   * @property {String} dateLastActivity - Format: date
   * @property {String} dateLastView - Format: date
   * @property {String} idTags
   * @property {String} datePluginDisable - Format: date
   * @property {String} creationMethod
   * @property {Number} ixUpdate
   * @property {String} templateGallery
   * @property {Boolean} enterpriseOwned
   */

  /**
   * @typedef {Object} Datasource
   * @property {Boolean} filter
   */

  /**
   * @typedef {Object} List
   * @property {String} id - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} name - The name of the list
   * @property {String} color - Valid values: 'yellow', 'purple', 'blue', 'red', 'green', 'orange', 'black', 'sky', 'pink', 'lime'
   * @property {Boolean} closed
   * @property {String} idBoard - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Number} pos
   * @property {String} softLimit
   * @property {Boolean} subscribed
   * @property {String} type
   * @property {Datasource} datasource
   * @property {Limits} limits
   */

  /**
   * @typedef {Object} BioData
   * @property {Object} emoji
   */

  /**
   * @typedef {Object} NonPublic
   * @property {String} fullName
   * @property {String} initials
   * @property {String} avatarUrl - A URL that references the non-public avatar for the member. Format: url
   * @property {String} avatarHash
   */

  /**
   * @typedef {Object} MemberLimits
   * @property {String} status
   * @property {Number} disableAt
   * @property {Number} warnAt
   */

  /**
   * @typedef {Object} MarketingOptIn
   * @property {Boolean} optedIn
   * @property {String} date - Format: date
   */

  /**
   * @typedef {Object} MessagesDismissed
   * @property {String} name
   * @property {String} count
   * @property {String} lastDismissed - Format: date
   * @property {String} _id - Pattern: ^[0-9a-fA-F]{24}$
   */

  /**
   * @typedef {Object} TimezoneInfo
   * @property {Number} offsetCurrent
   * @property {String} timezoneCurrent
   * @property {String} dateNext - Format: date
   * @property {String} timezoneNext
   */

  /**
   * @typedef {Object} Privacy
   * @property {String} fullName - Valid values: 'public', 'private', 'collaborator'
   * @property {String} avatar - Valid values: 'public', 'private', 'collaborator'
   */

  /**
   * @typedef {Object} TwoFactor
   * @property {Boolean} enabled
   * @property {Boolean} needsNewBackups
   */

  /**
   * @typedef {Object} MemberPrefs
   * @property {TimezoneInfo} timezoneInfo
   * @property {Privacy} privacy
   * @property {Boolean} sendSummaries
   * @property {Number} minutesBetweenSummaries
   * @property {Number} minutesBeforeDeadlineToNotify
   * @property {Boolean} colorBlind
   * @property {String} locale
   * @property {String} timezone
   * @property {TwoFactor} twoFactor
   */

  /**
   * @typedef {Object} Member
   * @property {String} id - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Boolean} activityBlocked
   * @property {String} avatarHash
   * @property {String} avatarUrl - Format: url
   * @property {String} bio
   * @property {BioData} bioData
   * @property {Boolean} confirmed
   * @property {String} fullName
   * @property {String} idEnterprise - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Array.<String>} idEnterprisesDeactivated
   * @property {String} idMemberReferrer - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Array.<String>} idPremOrgsAdmin
   * @property {String} initials
   * @property {String} memberType - Valid values: 'normal', 'ghost'
   * @property {NonPublic} nonPublic - Profile data with restricted visibility. These fields are visible only to members of the same organization. The values here (full name, for example) may differ from the values at the top level of the response
   * @property {Boolean} nonPublicAvailable - Whether the response contains non-public profile data for the member
   * @property {Array.<Number>} products
   * @property {String} url - Format: url
   * @property {String} username
   * @property {String} status - Valid values: 'disconnected'
   * @property {String} aaEmail - Format: email
   * @property {String} aaEnrolledDate
   * @property {String} aaId
   * @property {String} avatarSource - Valid values: 'gravatar', 'upload'
   * @property {String} email
   * @property {String} gravatarHash
   * @property {Array.<String>} idBoards
   * @property {Array.<String>} idOrganizations
   * @property {Array.<String>} idEnterprisesAdmin
   * @property {MemberLimits} limits
   * @property {Array.<String>} MemberLimits - Valid values: 'password', 'saml'
   * @property {MarketingOptIn} marketingOptIn
   * @property {MessagesDismissed} messagesDismissed
   * @property {Array.<String>} oneTimeMessagesDismissed
   * @property {MemberPrefs} prefs
   * @property {Array.<String>} trophies
   * @property {String} uploadedAvatarHash
   * @property {String} uploadedAvatarUrl - Format: url
   * @property {Array.<String>} premiumFeatures
   * @property {Boolean} isAaMastered
   * @property {Number} ixUpdate
   * @property {Array.<String>} idBoardsPinned
   */

  /**
   * @typedef {Object} Label
   * @property {String} id - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} idBoard - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} name - The name displayed for the label
   * @property {String} color - Valid values: 'yellow', 'purple', 'blue', 'red', 'green', 'orange', 'black', 'sky', 'pink', 'lime'
   * @property {Number} uses
   */

  /**
   * @typedef {Object} Trello
   * @property {Number} board
   * @property {Number} card
   */

  /**
   * @typedef {Object} AttachmentsByType
   * @property {Trello} trello
   */

  /**
   * @typedef {Object} Badges
   * @property {AttachmentsByType} attachmentsByType
   * @property {Boolean} location
   * @property {Number} votes
   * @property {Boolean} viewingMemberVoted
   * @property {Boolean} subscribed
   * @property {String} fogbugz
   * @property {Number} checkItems
   * @property {Number} checkItemsChecked
   * @property {Number} comments
   * @property {Number} integer
   * @property {Boolean} description
   * @property {String} due - Format: date
   * @property {String} start - Format: date
   * @property {Boolean} dueComplete
   */

  /**
   * @typedef {Object} DescData
   * @property {Object} emoji
   */

  /**
   * @typedef {Object} IdChecklist
   * @property {String} id - Pattern: ^[0-9a-fA-F]{24}$
   */

  /**
   * @typedef {Object} Cover
   * @property {String} idAttachment - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} color - Valid values: 'yellow', 'purple', 'blue', 'red', 'green', 'orange', 'black', 'sky', 'pink', 'lime'
   * @property {Boolean} idUploadedBackground
   * @property {String} size - Valid values: 'normal'
   * @property {String} brightness - Valid values: 'light', 'dark'
   * @property {Boolean} isTemplate
   */

  /**
   * @typedef {Object} Card
   * @property {String} id - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} address
   * @property {Badges} badges
   * @property {Array.<String>} checkItemStates
   * @property {Boolean} closed
   * @property {String} coordinates
   * @property {String} creationMethod
   * @property {String} dateLastActivity - Format: date-time
   * @property {String} desc
   * @property {DescData} descData
   * @property {String} due - Format: date
   * @property {Boolean} hideIfContext
   * @property {String} dueReminder
   * @property {String} idBoard - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Array.<IdChecklist>} idChecklists
   * @property {Array.<Label>} idLabels
   * @property {String} idList - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Array.<String>} idMembers
   * @property {Array.<String>} idMembersVoted
   * @property {Number} idShort
   * @property {String} idAttachmentCover - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Array.<String>} labels
   * @property {Limits} limits
   * @property {String} locationName
   * @property {Boolean} manualCoverAttachment
   * @property {String} name
   * @property {Number} pos
   * @property {String} shortLink
   * @property {String} shortUrl - Format: url
   * @property {Boolean} subscribed
   * @property {String} text
   * @property {String} url - Format: url
   * @property {Cover} cover
   */

  /**
   * @typedef {Object} Data
   * @property {String} text
   * @property {Card} card
   * @property {Board} board
   * @property {List} list
   */

  /**
   * @typedef {Object} ContextOn
   * @property {String} type
   * @property {String} translationKey
   * @property {Boolean} hideIfContext
   * @property {String} idContext - Pattern: ^[0-9a-fA-F]{24}$
   */

  /**
   * @typedef {Object} Comment
   * @property {String} type
   * @property {String} text
   */

  /**
   * @typedef {Object} MemberCreator
   * @property {String} id - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Boolean} activityBlocked
   * @property {String} avatarHash
   * @property {String} avatarUrl - Format: url
   * @property {String} fullName
   * @property {String} idMemberReferrer - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} initials
   * @property {String} text
   * @property {String} type
   * @property {String} username
   */

  /**
   * @typedef {Object} Entities
   * @property {ContextOn} contextOn
   * @property {Card} card
   * @property {Comment} comment
   * @property {MemberCreator} memberCreator
   */

  /**
   * @typedef {Object} Display
   * @property {String} translationKey
   * @property {Entities} entities
   */

  /**
   * @typedef {Object} Action
   * @property {String} id - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} idMemberCreator - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Data} data
   * @property {String} type
   * @property {String} date - Format: date-time
   * @property {Limits} limits
   * @property {Display} display
   * @property {MemberCreator} memberCreator
   */

  /**
   * @typedef {Object} PowerUp
   * @property {String} id - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} idBoard - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} idPlugin - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Boolean} promotional
   */

  /**
   * @typedef {Object} Attachment
   * @property {String} id - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} bytes
   * @property {String} date - Format: date-time
   * @property {String} edgeColor
   * @property {String} idMember - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Boolean} isUpload
   * @property {String} mimeType
   * @property {String} name
   * @property {Array.<Object>} previews
   * @property {String} url - Format: url
   * @property {Number} pos
   */

  /**
   * @typedef {Object} Membership
   * @property {Boolean} unconfirmed
   * @property {String} idMember - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} orgMemberType
   * @property {String} id - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} memberType
   * @property {Boolean} deactivated
   */

  /**
   * @typedef {Object} BoardMembership
   * @property {Array.<Member>} members
   * @property {String} id - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Array.<Membership>} memberships
   */

  /**
   * @typedef {Object} Notification
   * @property {String} id - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Boolean} unread
   * @property {String} type - Valid values: 'cardDueSoon'
   * @property {String} date - Format: date
   * @property {String} dateRead - Format: date
   * @property {String} data
   * @property {Card} card
   * @property {Board} board
   * @property {String} idMemberCreator - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} idAction - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Array.<Reactions>} reactions
   */

  /**
   * @typedef {Object} CheckItem
   * @property {String} id - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} name - The name of the check item on the checklist
   * @property {BioData} nameData
   * @property {Number} pos
   * @property {String} state
   * @property {String} due - Format: date-time
   * @property {Number} dueReminder
   * @property {String} idMember - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} idChecklist - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Limits} limits
   */

  /**
   * @typedef {Object} Checklist
   * @property {String} id - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} name - The name of the checklist
   * @property {String} idBoard - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} idCard - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Number} pos
   * @property {Array.<CheckItem>} checkItems
   * @property {Limits} limits
   */

  /**
   * @typedef {Object} ImageScaled
   * @property {String} _id - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} id - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Boolean} scaled
   * @property {String} url - Format: url
   * @property {Number} bytes
   * @property {Number} height
   * @property {Number} width
   */

  /**
   * @typedef {Object} Sticker
   * @property {String} id - Pattern: ^[0-9a-fA-F]{24}$
   * @property {Number} top
   * @property {Number} left
   * @property {Number} zIndex
   * @property {Number} rotate
   * @property {String} image - The name of the sticker
   * @property {String} imageUrl - Format: url
   * @property {Array.<ImageScaled>} imageScaled
   * @property {Limits} limits
   */

  /**
   * @typedef {Object} Organization
   * @property {BioData} descData
   * @property {String} website
   * @property {String} displayName
   * @property {String} logoHash
   * @property {String} url - Format: url
   * @property {String} logoUrl - Format: url
   * @property {Array.<Number>} products
   * @property {String} offering
   * @property {String} name - The name of the organization
   * @property {String} id - Pattern: ^[0-9a-fA-F]{24}$
   * @property {String} teamType
   * @property {String} desc
   * @property {Array.<Number>} powerUps
   */

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
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
   * @property {Object} criteria
   */

  // ======================================= DICTIONARIES =======================================

  /**
   * @operationName Get Boards Dictionary
   * @description Retrieve all boards available for the authenticated user
   * @route POST /get-boards-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"My Board","note":"ID: 5abbe4b7ddc1b351ef961414","value":"5abbe4b7ddc1b351ef961414"}],"cursor":null}
   */
  async getBoardsDictionary(payload) {
    const { search } = payload || {}
    const boards = await this.#apiRequest({ url: `${ API_BASE_URL }/members/me/boards`, logTag: 'getBoards' })
    const filteredBoards = search ? searchFilter(boards, ['id', 'name'], search) : boards

    return {
      items: filteredBoards.map(({ id, name }) => ({
        label: name || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get Board Lists Dictionary
   * @description Retrieve all lists for a specific board
   * @route POST /get-board-lists-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria with idBoard"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"To Do","note":"ID: 5abbe4b7ddc1b351ef961414","value":"5abbe4b7ddc1b351ef961414"}],"cursor":null}
   */
  async getBoardListsDictionary(payload) {
    const { search, criteria } = payload || {}
    const { idBoard, newIdBoard } = criteria || {}
    const lists = await this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ newIdBoard || idBoard }/lists`,
      query: undefined,
      logTag: 'getBoardLists',
    })
    const filteredLists = search ? searchFilter(lists, ['id', 'name'], search) : lists

    return {
      items: filteredLists.map(({ id, name }) => ({
        label: name || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get Archived Board Cards Dictionary
   * @description Retrieve all archived cards for a specific board
   * @route POST /get-archived-board-cards-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria with idBoard"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Archived Card","note":"ID: 5abbe4b7ddc1b351ef961414","value":"5abbe4b7ddc1b351ef961414"}],"cursor":null}
   */
  async getArchivedBoardCardsDictionary(payload) {
    const { search, criteria } = payload || {}
    const { idBoard } = criteria || {}
    const archivedCards = await this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ idBoard }/cards`,
      query: { filter: 'closed' },
      logTag: 'getBoardCards',
    })
    const filteredArchivedCards = search ? searchFilter(archivedCards, ['id', 'name'], search) : archivedCards

    return {
      items: filteredArchivedCards.map(({ id, name }) => ({
        label: name || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get Board Members Dictionary
   * @description Retrieve all members for a specific board
   * @route POST /get-board-members-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria with idBoard"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"username","note":"ID: 5abbe4b7ddc1b351ef961414","value":"5abbe4b7ddc1b351ef961414"}],"cursor":null}
   */
  async getBoardMembersDictionary(payload) {
    const { search, criteria } = payload || {}
    const { idBoard, newIdBoard } = criteria || {}
    const members = await this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ newIdBoard || idBoard }/members`,
      logTag: 'getBoardMembers',
    })
    const filteredMembers = search ? searchFilter(members, ['id', 'username'], search) : members

    return {
      items: filteredMembers.map(({ id, username }) => ({
        label: username || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get Board Labels Dictionary
   * @description Retrieve all labels for a specific board
   * @route POST /get-board-labels-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria with idBoard"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Label Name (green)","note":"ID: 5abbe4b7ddc1b351ef961414","value":"5abbe4b7ddc1b351ef961414"}],"cursor":null}
   */
  async getBoardLabelsDictionary(payload) {
    const { search, criteria } = payload || {}
    const { idBoard, newIdBoard } = criteria || {}
    const labels = await this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ newIdBoard || idBoard }/labels`,
      query: undefined,
      logTag: 'getBoardLabels',
    })
    const filteredLabels = search ? searchFilter(labels, ['id', 'name', 'color'], search) : labels

    return {
      items: filteredLabels.map(({ id, name, color }) => ({
        label: getLabel(name, color),
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get List Cards Dictionary
   * @description Retrieve all cards for a specific list
   * @route POST /get-list-cards-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria with idList"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Card Name","note":"ID: 5abbe4b7ddc1b351ef961414","value":"5abbe4b7ddc1b351ef961414"}],"cursor":null}
   */
  async getListCardsDictionary(payload) {
    const { search, criteria } = payload || {}
    const { idList } = criteria || {}
    const cards = await this.#apiRequest({ url: `${ API_BASE_URL }/lists/${ idList }/cards`, logTag: 'getListCards' })
    const filteredCards = search ? searchFilter(cards, ['id', 'name'], search) : cards

    return {
      items: filteredCards.map(({ id, name }) => ({
        label: name || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get Card Labels Dictionary
   * @description Retrieve all labels for a specific card
   * @route POST /get-card-labels-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria with idCard"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Label Name (green)","note":"ID: 5abbe4b7ddc1b351ef961414","value":"5abbe4b7ddc1b351ef961414"}],"cursor":null}
   */
  async getCardLabelsDictionary(payload) {
    const { search, criteria } = payload || {}
    const { idCard } = criteria || {}
    const labels = await this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/labels`,
      logTag: 'getCardLabels',
    })
    const filteredLabels = search ? searchFilter(labels, ['id', 'name', 'color'], search) : labels

    return {
      items: filteredLabels.map(({ id, name, color }) => ({
        label: getLabel(name, color),
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get Card Attachments Dictionary
   * @description Retrieve all attachments for a specific card
   * @route POST /get-card-attachments-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria with idCard"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Attachment Name","note":"ID: 5abbe4b7ddc1b351ef961414","value":"5abbe4b7ddc1b351ef961414"}],"cursor":null}
   */
  async getCardAttachmentsDictionary(payload) {
    const { search, criteria } = payload || {}
    const { idCard } = criteria || {}
    const attachments = await this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/attachments`,
      query: undefined,
      logTag: 'getCardAttachments',
    })
    const filteredAttachments = search ? searchFilter(attachments, ['id', 'name'], search) : attachments

    return {
      items: filteredAttachments.map(({ id, name }) => ({
        label: name || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get Card Stickers Dictionary
   * @description Retrieve all stickers for a specific card
   * @route POST /get-card-stickers-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria with idCard"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Sticker (image: star, position: 10x20)","note":"ID: 5abbe4b7ddc1b351ef961414","value":"5abbe4b7ddc1b351ef961414"}],"cursor":null}
   */
  async getCardStickersDictionary(payload) {
    const { search, criteria } = payload || {}
    const { idCard } = criteria || {}
    const stickers = await this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/stickers`,
      query: undefined,
      logTag: 'getCardStickers',
    })
    const filteredStickers = search ? searchFilter(stickers, ['id', 'image'], search) : stickers

    return {
      items: filteredStickers.map(({ id, image, top, left, zIndex }) => ({
        label: getStickerLabel({ image, top, left, zIndex }),
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get Card Checklists Dictionary
   * @description Retrieve all checklists for a specific card
   * @route POST /get-card-checklists-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria with idCard"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Checklist Name","note":"ID: 5abbe4b7ddc1b351ef961414","value":"5abbe4b7ddc1b351ef961414"}],"cursor":null}
   */
  async getCardChecklistsDictionary(payload) {
    const { search, criteria } = payload || {}
    const { idCard } = criteria || {}
    const checklists = await this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/checklists`,
      query: undefined,
      logTag: 'getCardChecklists',
    })
    const filteredChecklists = search ? searchFilter(checklists, ['id', 'name'], search) : checklists

    return {
      items: filteredChecklists.map(({ id, name }) => ({
        label: name || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get Card Check Items Dictionary
   * @description Retrieve all check items from checklists for a specific card
   * @route POST /get-card-check-items-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria with idCard"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Check Item (complete)","note":"ID: 5abbe4b7ddc1b351ef961414","value":"5abbe4b7ddc1b351ef961414"}],"cursor":null}
   */
  async getCardCheckItemsDictionary(payload) {
    const { search, criteria } = payload || {}
    const { idCard } = criteria || {}
    const checkItems = (await this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/checklists`,
      query: undefined,
      logTag: 'getCardChecklists',
    })).flatMap(item => item.checkItems)
    const filteredCheckItems = search ? searchFilter(checkItems, ['id', 'name', 'state'], search) : checkItems

    return {
      items: filteredCheckItems.map(({ id, name, state }) => ({
        label: getLabel(name, state),
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get Organizations Dictionary
   * @description Retrieve all organizations for the authenticated user
   * @route POST /get-organizations-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Organization Name","note":"ID: 5abbe4b7ddc1b351ef961414","value":"5abbe4b7ddc1b351ef961414"}],"cursor":null}
   */
  async getOrganizationsDictionary(payload) {
    const { search } = payload || {}
    const organizations = await this.#apiRequest({
      url: `${ API_BASE_URL }/members/me/organizations`,
      logTag: 'getOrganizations',
    })
    const filteredOrganizations = search ? searchFilter(organizations, ['id', 'name'], search) : organizations

    return {
      items: filteredOrganizations.map(({ id, name }) => ({
        label: name || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get Organization Boards Dictionary
   * @description Retrieve all boards for a specific organization
   * @route POST /get-organization-boards-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria with organization ID"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Board Name","note":"ID: 5abbe4b7ddc1b351ef961414","value":"5abbe4b7ddc1b351ef961414"}],"cursor":null}
   */
  async getOrganizationBoardsDictionary(payload) {
    const { search, criteria } = payload || {}
    const { id, idOrganization } = criteria || {}
    const organizationBoards = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ id || idOrganization }/boards`,
      query: undefined,
      logTag: 'getOrganizationBoards',
    })

    const filteredOrganizationBoards = search
      ? searchFilter(organizationBoards, ['id', 'name'], search)
      : organizationBoards

    return {
      items: filteredOrganizationBoards.map(({ id, name }) => ({
        label: name || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get Organization Members Dictionary
   * @description Retrieve all members for a specific organization
   * @route POST /get-organization-members-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria with organization ID"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"username","note":"ID: 5abbe4b7ddc1b351ef961414","value":"5abbe4b7ddc1b351ef961414"}],"cursor":null}
   */
  async getOrganizationMembersDictionary(payload) {
    const { search, criteria } = payload || {}
    const { id } = criteria || {}
    const organizationMembers = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ id }/members`,
      query: undefined,
      logTag: 'getOrganizationMembers',
    })

    const filteredOrganizationMembers = search
      ? searchFilter(organizationMembers, ['id', 'username'], search)
      : organizationMembers

    return {
      items: filteredOrganizationMembers.map(({ id, username }) => ({
        label: username || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get Member Notifications Dictionary
   * @description Retrieve all notifications for a specific member
   * @route POST /get-member-notifications-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria with member ID"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Notification Type","note":"ID: 5abbe4b7ddc1b351ef961414","value":"5abbe4b7ddc1b351ef961414"}],"cursor":null}
   */
  async getMemberNotificationsDictionary(payload) {
    const { search, criteria } = payload || {}
    const { idMember } = criteria || {}
    const memberNotifications = await this.#apiRequest({
      url: `${ API_BASE_URL }/members/${ idMember }/notifications`,
      query: undefined,
      logTag: 'getMemberNotifications',
    })

    const filteredMemberNotifications = search
      ? searchFilter(memberNotifications, ['id', 'type'], search)
      : memberNotifications

    return {
      items: filteredMemberNotifications.map(({ id, type }) => ({
        label: type || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  // =================================== END OF DICTIONARIES ====================================

  /**
   * @description Requests a single board.
   *
   * @route POST /get-board
   * @operationName Get Board by ID
   * @category Board Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"Actions","name":"actions","description":"Comma-separated list of actions nested resources to include in the response. Default: 'all'."}
   * @paramDef {"type":"String","label":"Board Stars","name":"boardStars","uiComponent":{"type":"DROPDOWN","options":{"values":["mine","none"]}},"description":"Filter information about board stars. Default: 'none'."}
   * @paramDef {"type":"String","label":"Cards","name":"cards","description":"Comma-separated list of cards nested resources to include in the response. Default: 'none'."}
   * @paramDef {"type":"Boolean","label":"Card Plugin Data","name":"cardPluginData","uiComponent":{"type":"TOGGLE"},"description":"Use with the 'cards' param to include card pluginData with the response. Default: false."}
   * @paramDef {"type":"String","label":"Checklists","name":"checklists","description":"Comma-separated list of checklists nested resources to include in the response. Default: 'none'."}
   * @paramDef {"type":"Boolean","label":"Custom Fields","name":"customFields","uiComponent":{"type":"TOGGLE"},"description":"Whether to include the custom fields with the response. Default: false."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"The fields of the board to be included in the response. Valid values: 'all' or a comma-separated list of: 'closed', 'dateLastActivity', 'dateLastView', 'desc', 'descData', 'idMemberCreator', 'idOrganization', 'invitations', 'invited', 'labelNames', 'memberships', 'name', 'pinned', 'powerUps', 'prefs', 'shortLink', 'shortUrl', 'starred', 'subscribed', 'url'. Default: 'name,desc,descData,closed,idOrganization,pinned,url,shortUrl,prefs,labelNames'."}
   * @paramDef {"type":"String","label":"Labels","name":"labels","description":"Comma-separated list of labels nested resources to include in the response."}
   * @paramDef {"type":"String","label":"Lists","name":"lists","description":"Comma-separated list of lists nested resources to include in the response. Default: 'open'."}
   * @paramDef {"type":"String","label":"Members","name":"members","description":"Comma-separated list of members nested resources to include in the response. Default: 'none'."}
   * @paramDef {"type":"String","label":"Memberships","name":"memberships","description":"Comma-separated list of memberships nested resources to include in the response. Default: 'none'."}
   * @paramDef {"type":"Boolean","label":"Plugin Data","name":"pluginData","uiComponent":{"type":"TOGGLE"},"description":"Whether the pluginData for this board should be returned. Default: false."}
   * @paramDef {"type":"Boolean","label":"Organization","name":"organization","uiComponent":{"type":"TOGGLE"},"description":"Whether the organization for this board should be returned. Default: false."}
   * @paramDef {"type":"Boolean","label":"Organization Plugin Data","name":"organizationPluginData","uiComponent":{"type":"TOGGLE"},"description":"Use with the 'organization' param to include organization pluginData with the response. Default: false."}
   * @paramDef {"type":"Boolean","label":"My Preferences","name":"myPrefs","uiComponent":{"type":"TOGGLE"},"description":"Whether the personal board settings (preferences) for the current user should be returned. Default: false."}
   * @paramDef {"type":"Boolean","label":"Tags","name":"tags","uiComponent":{"type":"TOGGLE"},"description":"Also known as collections, tags, refer to the collection(s) that a Board belongs to. Default: false."}
   *
   * @returns {Board} Returns information about the matching board.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","name":"TrelloPlatformChanges","desc":"TrackchangestoTrello'sPlatformonthisboard.","descData":"<string>","closed":false,"idMemberCreator":"5abbe4b7ddc1b351ef961414","idOrganization":"5abbe4b7ddc1b351ef961414","pinned":false,"url":"https://trello.com/b/dQHqCohZ/trello-platform-changelog","shortUrl":"https://trello.com/b/dQHqCohZ","prefs":{"permissionLevel":"org","hideVotes":true,"voting":"disabled","comments":"<string>","selfJoin":true,"cardCovers":true,"isTemplate":true,"cardAging":"pirate","calendarFeedEnabled":true,"background":"5abbe4b7ddc1b351ef961414","backgroundImage":"<string>","backgroundImageScaled":[{"width":100,"height":64,"url":"https://trello-backgrounds.s3.amazonaws.com/SharedBackground/100x64/abc/photo-123.jpg"}],"backgroundTile":true,"backgroundBrightness":"dark","backgroundBottomColor":"#1e2e00","backgroundTopColor":"#ffffff","canBePublic":true,"canBeEnterprise":true,"canBeOrg":true,"canBePrivate":true,"canInvite":true},"labelNames":{"green":"Addition","yellow":"Update","orange":"Deprecation","red":"Deletion","purple":"Power-Ups","blue":"News","sky":"Announcement","lime":"Delight","pink":"RESTAPI","black":"Capabilties"},"limits":{"attachments":{"perBoard":{"status":"ok","disableAt":36000,"warnAt":32400}}},"starred":true,"memberships":"<string>","shortLink":"<string>","subscribed":true,"powerUps":"<string>","dateLastActivity":"<string>","dateLastView":"<string>","idTags":"<string>","datePluginDisable":"<string>","creationMethod":"<string>","ixUpdate":2154,"templateGallery":"<string>","enterpriseOwned":true}
   */
  getBoardById(
    idBoard,
    actions,
    boardStars,
    cards,
    cardPluginData,
    checklists,
    customFields,
    fields,
    labels,
    lists,
    members,
    memberships,
    pluginData,
    organizationPluginData,
    myPrefs,
    tags
  ) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ idBoard }`,
      query: {
        actions,
        boardStars,
        cards,
        card_pluginData: cardPluginData,
        checklists,
        customFields,
        fields,
        labels,
        lists,
        members,
        memberships,
        pluginData,
        organization_pluginData: organizationPluginData,
        myPrefs,
        tags,
      },
      logTag: 'getBoardById',
    })
  }

  /**
   * @description Finds a board by name.
   *
   * @route POST /find-board
   * @operationName Find Board by Name
   * @category Board Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Organization","name":"idOrganization","required":true,"dictionary":"getOrganizationsDictionary","description":"The ID of the organization."}
   * @paramDef {"type":"String","label":"Search Name","name":"name","required":true,"description":"The name of the board."}
   *
   * @returns {Board} Returns information about the matching board.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","name":"TrelloPlatformChanges","desc":"TrackchangestoTrello'sPlatformonthisboard.","descData":"<string>","closed":false,"idMemberCreator":"5abbe4b7ddc1b351ef961414","idOrganization":"5abbe4b7ddc1b351ef961414","pinned":false,"url":"https://trello.com/b/dQHqCohZ/trello-platform-changelog","shortUrl":"https://trello.com/b/dQHqCohZ","prefs":{"permissionLevel":"org","hideVotes":true,"voting":"disabled","comments":"<string>","selfJoin":true,"cardCovers":true,"isTemplate":true,"cardAging":"pirate","calendarFeedEnabled":true,"background":"5abbe4b7ddc1b351ef961414","backgroundImage":"<string>","backgroundImageScaled":[{"width":100,"height":64,"url":"https://trello-backgrounds.s3.amazonaws.com/SharedBackground/100x64/abc/photo-123.jpg"}],"backgroundTile":true,"backgroundBrightness":"dark","backgroundBottomColor":"#1e2e00","backgroundTopColor":"#ffffff","canBePublic":true,"canBeEnterprise":true,"canBeOrg":true,"canBePrivate":true,"canInvite":true},"labelNames":{"green":"Addition","yellow":"Update","orange":"Deprecation","red":"Deletion","purple":"Power-Ups","blue":"News","sky":"Announcement","lime":"Delight","pink":"RESTAPI","black":"Capabilties"},"limits":{"attachments":{"perBoard":{"status":"ok","disableAt":36000,"warnAt":32400}}},"starred":true,"memberships":"<string>","shortLink":"<string>","subscribed":true,"powerUps":"<string>","dateLastActivity":"<string>","dateLastView":"<string>","idTags":"<string>","datePluginDisable":"<string>","creationMethod":"<string>","ixUpdate":2154,"templateGallery":"<string>","enterpriseOwned":true}
   */
  async findBoardByName(idOrganization, name) {
    const boards = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ idOrganization }/boards`,
      query: undefined,
      logTag: 'findBoardByName',
    })

    return boards.find(board => board.name === name)
  }

  /**
   * @description Finds a board by name, or creates it if it doesn't exist.
   *
   * @route POST /find-or-create-board
   * @operationName Find or Create Board
   * @category Board Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Organization","name":"idOrganization","required":true,"dictionary":"getOrganizationsDictionary","description":"The ID of the organization."}
   * @paramDef {"type":"String","label":"Search Name","name":"name","required":true,"description":"The name of the board."}
   *
   * @returns {Board} Returns information about the matching board, or the newly created board.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","name":"TrelloPlatformChanges","desc":"TrackchangestoTrello'sPlatformonthisboard.","descData":"<string>","closed":false,"idMemberCreator":"5abbe4b7ddc1b351ef961414","idOrganization":"5abbe4b7ddc1b351ef961414","pinned":false,"url":"https://trello.com/b/dQHqCohZ/trello-platform-changelog","shortUrl":"https://trello.com/b/dQHqCohZ","prefs":{"permissionLevel":"org","hideVotes":true,"voting":"disabled","comments":"<string>","selfJoin":true,"cardCovers":true,"isTemplate":true,"cardAging":"pirate","calendarFeedEnabled":true,"background":"5abbe4b7ddc1b351ef961414","backgroundImage":"<string>","backgroundImageScaled":[{"width":100,"height":64,"url":"https://trello-backgrounds.s3.amazonaws.com/SharedBackground/100x64/abc/photo-123.jpg"}],"backgroundTile":true,"backgroundBrightness":"dark","backgroundBottomColor":"#1e2e00","backgroundTopColor":"#ffffff","canBePublic":true,"canBeEnterprise":true,"canBeOrg":true,"canBePrivate":true,"canInvite":true},"labelNames":{"green":"Addition","yellow":"Update","orange":"Deprecation","red":"Deletion","purple":"Power-Ups","blue":"News","sky":"Announcement","lime":"Delight","pink":"RESTAPI","black":"Capabilties"},"limits":{"attachments":{"perBoard":{"status":"ok","disableAt":36000,"warnAt":32400}}},"starred":true,"memberships":"<string>","shortLink":"<string>","subscribed":true,"powerUps":"<string>","dateLastActivity":"<string>","dateLastView":"<string>","idTags":"<string>","datePluginDisable":"<string>","creationMethod":"<string>","ixUpdate":2154,"templateGallery":"<string>","enterpriseOwned":true}
   */
  async findOrCreateBoard(idOrganization, name) {
    const boards = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ idOrganization }/boards`,
      query: undefined,
      logTag: 'findOrCreateBoard',
    })

    const foundBoard = boards.find(board => board.name === name)

    return foundBoard || this.#apiRequest({
      url: `${ API_BASE_URL }/boards`,
      method: 'post',
      query: { idOrganization, name },
      logTag: 'createBoard',
    })
  }

  /**
   * @description Creates a new board.
   *
   * @route POST /board
   * @operationName Create Board
   * @category Board Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board Name","name":"name","required":true,"description":"The new name for the board. 1 to 16384 characters long."}
   * @paramDef {"type":"Boolean","label":"Default Labels","name":"defaultLabels","uiComponent":{"type":"TOGGLE"},"description":"Determines whether to use the default set of labels. Default: true."}
   * @paramDef {"type":"Boolean","label":"Default Lists","name":"defaultLists","uiComponent":{"type":"TOGGLE"},"description":"Determines whether to add the default set of lists to a board (To Do, Doing, Done). It is ignored if idBoardSource is provided. Default: true."}
   * @paramDef {"type":"String","label":"Description","name":"desc","description":"A new description for the board, 0 to 16384 characters long."}
   * @paramDef {"type":"String","label":"Organization","name":"idOrganization","dictionary":"getOrganizationsDictionary","description":"The ID or name of the Workspace the board should belong to."}
   * @paramDef {"type":"String","label":"Board Source","name":"idBoardSource","dictionary":"getBoardsDictionary","description":"The ID of the board to copy into the new board."}
   * @paramDef {"type":"String","label":"Keep From Source","name":"keepFromSource","uiComponent":{"type":"DROPDOWN","options":{"values":["cards","none"]}},"description":"To keep cards from the original board pass in the value 'cards'. Default: 'none'."}
   * @paramDef {"type":"String","label":"Power Ups","name":"powerUps","uiComponent":{"type":"DROPDOWN","options":{"values":["all","calendar","cardAging","recap","voting"]}},"description":"The power-ups that should be enabled on the new board."}
   * @paramDef {"type":"String","label":"Permission Level Preferences","name":"prefsPermissionLevel","uiComponent":{"type":"DROPDOWN","options":{"values":["org","private","public"]}},"description":"The permissions level of the board. Default: 'private'."}
   * @paramDef {"type":"String","label":"Voting Preferences","name":"prefsVoting","uiComponent":{"type":"DROPDOWN","options":{"values":["disabled","members","observers","org","public"]}},"description":"Who can vote on this board. Default: 'disabled'."}
   * @paramDef {"type":"String","label":"Comments Preferences","name":"prefsComments","uiComponent":{"type":"DROPDOWN","options":{"values":["disabled","members","observers","org","public"]}},"description":"Who can comment on cards on this board. Default: 'members'."}
   * @paramDef {"type":"String","label":"Invitations Preferences","name":"prefsInvitations","uiComponent":{"type":"DROPDOWN","options":{"values":["admins","members"]}},"description":"Determines what types of members can invite users to join. Default: 'members'."}
   * @paramDef {"type":"Boolean","label":"Self Join Preferences","name":"prefsSelfJoin","uiComponent":{"type":"TOGGLE"},"description":"Determines whether users can join the boards themselves or whether they have to be invited. Default: true."}
   * @paramDef {"type":"Boolean","label":"Card Covers Preferences","name":"prefsCardCovers","uiComponent":{"type":"TOGGLE"},"description":"Determines whether card covers are enabled. Default: true."}
   * @paramDef {"type":"String","label":"Background Preferences","name":"prefsBackground","uiComponent":{"type":"DROPDOWN","options":{"values":["blue","orange","green","red","purple","pink","lime","sky","grey"]}},"description":"The ID of a custom background or one of: 'blue', 'orange', 'green', 'red', 'purple', 'pink', 'lime', 'sky', 'grey'. Default: 'blue'."}
   * @paramDef {"type":"String","label":"Card Aging Preferences","name":"prefsCardAging","uiComponent":{"type":"DROPDOWN","options":{"values":["pirate","regular"]}},"description":"Determines the type of card aging that should take place on the board if card aging is enabled. Default: 'regular'."}
   *
   * @returns {Board} Returns information about the created board.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","name":"TrelloPlatformChanges","desc":"TrackchangestoTrello'sPlatformonthisboard.","descData":"<string>","closed":false,"idMemberCreator":"5abbe4b7ddc1b351ef961414","idOrganization":"5abbe4b7ddc1b351ef961414","pinned":false,"url":"https://trello.com/b/dQHqCohZ/trello-platform-changelog","shortUrl":"https://trello.com/b/dQHqCohZ","prefs":{"permissionLevel":"org","hideVotes":true,"voting":"disabled","comments":"<string>","selfJoin":true,"cardCovers":true,"isTemplate":true,"cardAging":"pirate","calendarFeedEnabled":true,"background":"5abbe4b7ddc1b351ef961414","backgroundImage":"<string>","backgroundImageScaled":[{"width":100,"height":64,"url":"https://trello-backgrounds.s3.amazonaws.com/SharedBackground/100x64/abc/photo-123.jpg"}],"backgroundTile":true,"backgroundBrightness":"dark","backgroundBottomColor":"#1e2e00","backgroundTopColor":"#ffffff","canBePublic":true,"canBeEnterprise":true,"canBeOrg":true,"canBePrivate":true,"canInvite":true},"labelNames":{"green":"Addition","yellow":"Update","orange":"Deprecation","red":"Deletion","purple":"Power-Ups","blue":"News","sky":"Announcement","lime":"Delight","pink":"RESTAPI","black":"Capabilties"},"limits":{"attachments":{"perBoard":{"status":"ok","disableAt":36000,"warnAt":32400}}},"starred":true,"memberships":"<string>","shortLink":"<string>","subscribed":true,"powerUps":"<string>","dateLastActivity":"<string>","dateLastView":"<string>","idTags":"<string>","datePluginDisable":"<string>","creationMethod":"<string>","ixUpdate":2154,"templateGallery":"<string>","enterpriseOwned":true}
   */
  createBoard(
    name,
    defaultLabels,
    defaultLists,
    desc,
    idOrganization,
    idBoardSource,
    keepFromSource,
    powerUps,
    prefsPermissionLevel,
    prefsVoting,
    prefsComments,
    prefsInvitations,
    prefsSelfJoin,
    prefsCardCovers,
    prefsBackground,
    prefsCardAging
  ) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/boards`, method: 'post', query: {
        name,
        defaultLabels,
        defaultLists,
        desc,
        idOrganization,
        idBoardSource,
        keepFromSource,
        powerUps,
        prefs_permissionLevel: prefsPermissionLevel,
        prefs_voting: prefsVoting,
        prefs_comments: prefsComments,
        prefs_invitations: prefsInvitations,
        prefs_selfJoin: prefsSelfJoin,
        prefs_cardCovers: prefsCardCovers,
        prefs_background: prefsBackground,
        prefs_cardAging: prefsCardAging,
      }, logTag: 'createBoard',
    })
  }

  /**
   * @description Get the lists on a board.
   *
   * @route POST /get-board-lists
   * @operationName Get Board Lists
   * @category List Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"Cards Filter","name":"cards","uiComponent":{"type":"DROPDOWN","options":{"values":["all","closed","none","open"]}},"description":"Filter to apply to cards."}
   * @paramDef {"type":"String","label":"Card Fields","name":"cardFields","description":"'all' or a comma-separated list of card fields. Default: 'all'."}
   * @paramDef {"type":"String","label":"Lists Filter","name":"filter","uiComponent":{"type":"DROPDOWN","options":{"values":["all","closed","none","open"]}},"description":"Filter to apply to lists."}
   * @paramDef {"type":"String","label":"List Fields","name":"fields","description":"'all' or a comma-separated list of list fields. Default: 'all'."}
   *
   * @returns {List[]} Returns the lists on a board.
   * @sampleResult [{"id":"5abbe4b7ddc1b351ef961414","name":"Thingstobuytoday","closed":true,"pos":2154,"softLimit":"<string>","idBoard":"<string>","subscribed":true,"limits":{"attachments":{"perBoard":{}}}}]
   */
  getBoardLists(idBoard, cards, cardFields, filter, fields) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ idBoard }/lists`,
      query: { cards, card_fields: cardFields, filter, fields },
      logTag: 'getBoardLists',
    })
  }

  /**
   * @description Creates a new list on a board.
   *
   * @route POST /board-list
   * @operationName Create Board List
   * @category List Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the list to be created. 1 to 16384 characters long."}
   * @paramDef {"type":"String","label":"Position","name":"pos","description":"Determines the position of the list: 'top', 'bottom', or a positive number."}
   *
   * @returns {List} Returns information about a created list.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","name":"Thingstobuytoday","closed":true,"pos":2154,"softLimit":"<string>","idBoard":"<string>","subscribed":true,"limits":{"attachments":{"perBoard":{}}}}
   */
  createBoardList(idBoard, name, pos) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ idBoard }/lists`,
      method: 'post',
      query: { name, pos },
      logTag: 'createBoardList',
    })
  }

  /**
   * @description Finds a list on a board by name.
   *
   * @route POST /find-board-list
   * @operationName Find Board List by Name
   * @category List Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"Search Name","name":"name","required":true,"description":"The name of the list."}
   *
   * @returns {List} Returns information about the matching list.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","name":"Thingstobuytoday","closed":true,"pos":2154,"softLimit":"<string>","idBoard":"<string>","subscribed":true,"limits":{"attachments":{"perBoard":{}}}}
   */
  async findBoardListByName(idBoard, name) {
    const boardLists = await this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ idBoard }/lists`,
      query: undefined,
      logTag: 'findBoardListByName',
    })

    return boardLists.find(list => list.name === name)
  }

  /**
   * @description Finds a list on a board by name, or creates it if it doesn't exist.
   *
   * @route POST /find-or-create-board-list
   * @operationName Find or Create Board List
   * @category List Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"Search Name","name":"name","required":true,"description":"The name of the list."}
   *
   * @returns {List} Returns information about the matching list, or the newly created list.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","name":"Thingstobuytoday","closed":true,"pos":2154,"softLimit":"<string>","idBoard":"<string>","subscribed":true,"limits":{"attachments":{"perBoard":{}}}}
   */
  async findOrCreateBoardList(idBoard, name) {
    const boardLists = await this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ idBoard }/lists`,
      query: undefined,
      logTag: 'findOrCreateBoardList',
    })

    const foundBoardList = boardLists.find(list => list.name === name)

    return foundBoardList || this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ idBoard }/lists`,
      method: 'post',
      query: { name },
      logTag: 'createBoardList',
    })
  }

  /**
   * @description Gets the members for a board.
   *
   * @route POST /get-board-members
   * @operationName Get Board Members
   * @category Member Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   *
   * @returns {Member} Returns a list of board members.
   * @sampleResult [{"id":"0215e4clfgf94a101d212392","fullName":"TestName","username":"test123"}]
   */
  getBoardMembers(idBoard) {
    return this.#apiRequest({ url: `${ API_BASE_URL }/boards/${ idBoard }/members`, logTag: 'getBoardMembers' })
  }

  /**
   * @description Gets all the actions of a board.
   *
   * @route POST /get-board-actions
   * @operationName Get Board Actions
   * @category Board Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"The fields of the board to be included in the response."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"A comma-separated list of action types."}
   * @paramDef {"type":"String","label":"Format","name":"format","uiComponent":{"type":"DROPDOWN","options":{"values":["list","count"]}},"description":"The format of the returned actions. Default: 'list'."}
   * @paramDef {"type":"String","label":"Model ID(s)","name":"idModels","description":"Single model ID or a comma-separated list of IDs. Only actions related to these models will be returned."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"The limit of the number of responses, between 0 and 1000. Default: 50."}
   * @paramDef {"type":"Boolean","label":"Member","name":"member","uiComponent":{"type":"TOGGLE"},"description":"Whether to return the member object for each action. Default: true."}
   * @paramDef {"type":"String","label":"Member Fields","name":"memberFields","description":"The fields of the member to return. Defaults: 'activityBlocked,avatarHash,avatarUrl,fullName,idMemberReferrer,initials,nonPublic,nonPublicAvailable,username'."}
   * @paramDef {"type":"Boolean","label":"Member Creator","name":"memberCreator","uiComponent":{"type":"TOGGLE"},"description":"Whether to return the memberCreator object for each action. Default: true."}
   * @paramDef {"type":"String","label":"Member Creator Fields","name":"memberCreatorFields","description":"The fields of the member creator to return. Defaults: 'activityBlocked,avatarHash,avatarUrl,fullName,idMemberReferrer,initials,nonPublic,nonPublicAvailable,username'."}
   * @paramDef {"type":"Number","label":"Page","name":"page","description":"The page of results for actions. Default: 0."}
   * @paramDef {"type":"Boolean","label":"Reactions","name":"reactions","uiComponent":{"type":"TOGGLE"},"description":"Whether to show reactions on comments or not."}
   * @paramDef {"type":"String","label":"Before Date","name":"before","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"A date string in the form of YYYY-MM-DDThh:mm:ssZ or a mongo object ID. Only objects created before this date will be returned."}
   * @paramDef {"type":"String","label":"Since Date","name":"since","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"A date string in the form of YYYY-MM-DDThh:mm:ssZ or a mongo object ID. Only objects created since this date will be returned."}
   *
   * @returns {Action[]} Returns a list of board actions.
   * @sampleResult [{"id":"test_action_id_001","idMemberCreator":"test_member_creator_id_001","data":{"idMember":"test_member_id_001","deactivated":false,"card":{"id":"test_card_id_001","name":"TestCard","idShort":123,"shortLink":"testShortLink001"},"board":{"id":"test_board_id_001","name":"TestBoard","shortLink":"testShortLinkBoard001"},"member":{"id":"test_member_id_002","name":"TestMemberTwo"}},"appCreator":{"id":"test_app_creator_id_001","icon":{"url":"https://example.com/icon.png"}},"type":"removeMemberFromCard","date":"2025-03-03T14:00:55.492Z","limits":{"attachments":{"perBoard":{"status":"ok","disableAt":36000,"warnAt":32400}}},"member":{"id":"test_member_id_001","activityBlocked":false,"avatarHash":"testAvatarHash001","avatarUrl":"https://example.com/avatar1.png","fullName":"TestMemberOne","idMemberReferrer":null,"initials":"TM","nonPublic":{},"nonPublicAvailable":true,"username":"testmember1"},"memberCreator":{"id":"test_member_creator_id_001","activityBlocked":false,"avatarHash":"testAvatarHashCreator001","avatarUrl":"https://example.com/avatarCreator.png","fullName":"TestMemberCreator","idMemberReferrer":null,"initials":"TMC","nonPublic":{},"nonPublicAvailable":true,"username":"testcreator"}}]
   */
  getBoardActions(
    idBoard,
    fields,
    filter,
    format,
    idModels,
    limit,
    member,
    memberFields,
    memberCreator,
    memberCreatorFields,
    page,
    reactions,
    before,
    since
  ) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ idBoard }/actions`, query: {
        fields,
        filter,
        format,
        idModels,
        limit,
        member,
        member_fields: memberFields,
        memberCreator,
        memberCreator_fields: memberCreatorFields,
        page,
        reactions,
        before,
        since,
      }, logTag: 'getBoardActions',
    })
  }

  /**
   * @description Gets the enabled power-ups on a board.
   *
   * @route POST /get-board-power-ups
   * @operationName Get Enabled Power-Ups on Board
   * @category Board Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   *
   * @returns {PowerUp[]} Returns a list of board power-ups.
   * @sampleResult [{"id":"test_powerup_id_001","idBoard":"test_board_id_001","idPlugin":"test_plugin_id_001","promotional":false}]
   */
  getBoardPowerUps(idBoard) {
    return this.#apiRequest({ url: `${ API_BASE_URL }/boards/${ idBoard }/boardPlugins`, logTag: 'getBoardPowerUps' })
  }

  /**
   * @description Gets all the labels on a board.
   *
   * @route POST /get-board-labels
   * @operationName Get Board Labels
   * @category Label Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"The fields to be returned for the labels."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"The number of labels to be returned. Default: 50. Minimum: 0. Maximum: 1000."}
   *
   * @returns {Label[]} Returns a list of board labels.
   * @sampleResult [{"id":"test_label_id_001","idBoard":"test_board_id_001","name":"TestLabel","color":"purple","uses":5}]
   */
  getBoardLabels(idBoard, fields, limit) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ idBoard }/labels`,
      query: { fields, limit },
      logTag: 'getBoardLabels',
    })
  }

  /**
   * @description Creates a new label on a board.
   *
   * @route POST /board-label
   * @operationName Create Board Label
   * @category Label Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the label to be created. 1 to 16384 characters long."}
   * @paramDef {"type":"String","label":"Color","name":"color","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["null","green_light","green","green_dark","blue_light","blue","blue_dark","yellow_light","yellow","yellow_dark","sky_light","sky","sky_dark","orange_light","orange","orange_dark","lime_light","lime","lime_dark","red_light","red","red_dark","pink_light","pink","pink_dark","purple_light","purple","purple_dark","black_light","black","black_dark"]}},"description":"Sets the color of the new label or 'null' if without color."}
   *
   * @returns {Label} Returns information about a created label.
   * @sampleResult {"id":"test_label_id_001","idBoard":"test_board_id_001","name":"TestLabel","color":"purple","uses":5}
   */
  createBoardLabel(idBoard, name, color) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ idBoard }/labels`,
      method: 'post',
      query: { name, color },
      logTag: 'createBoardLabel',
    })
  }

  /**
   * @description Updates a label on a board.
   *
   * @route PUT /board-label
   * @operationName Update Board Label
   * @category Label Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"Label","name":"id","required":true,"dictionary":"getBoardLabelsDictionary","dependsOn":["idBoard"],"description":"The ID of the label to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The new name for the label."}
   * @paramDef {"type":"String","label":"Color","name":"color","uiComponent":{"type":"DROPDOWN","options":{"values":["null","green_light","green","green_dark","blue_light","blue","blue_dark","yellow_light","yellow","yellow_dark","sky_light","sky","sky_dark","orange_light","orange","orange_dark","lime_light","lime","lime_dark","red_light","red","red_dark","pink_light","pink","pink_dark","purple_light","purple","purple_dark","black_light","black","black_dark"]}},"description":"The new color for the label."}
   *
   * @returns {Label} Returns information about the updated label.
   * @sampleResult {"id":"test_label_id_001","idBoard":"test_board_id_001","name":"TestLabel","color":"purple","uses":5}
   */
  updateBoardLabel(idBoard, id, name, color) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/labels/${ id }`,
      method: 'put',
      query: { name, color },
      logTag: 'updateBoardLabel',
    })
  }

  /**
   * @description Deletes a label from a board.
   *
   * @route DELETE /board-label
   * @operationName Delete Board Label
   * @category Label Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"Label","name":"id","required":true,"dictionary":"getBoardLabelsDictionary","dependsOn":["idBoard"],"description":"The ID of the label."}
   */
  deleteBoardLabel(idBoard, id) {
    return this.#apiRequest({ url: `${ API_BASE_URL }/labels/${ id }`, method: 'delete', logTag: 'deleteBoardLabel' })
  }

  /**
   * @description Finds a label on a board by name.
   *
   * @route POST /find-board-label
   * @operationName Find Board Label by Name
   * @category Label Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Organization","name":"idOrganization","required":true,"dictionary":"getOrganizationsDictionary","description":"The ID of the organization."}
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getOrganizationBoardsDictionary","dependsOn":["idOrganization"],"description":"The ID of the board."}
   * @paramDef {"type":"String","label":"Search Name","name":"name","required":true,"description":"The name of the label."}
   *
   * @returns {Label} Returns information about the matching label.
   * @sampleResult {"id":"test_label_id_001","idBoard":"test_board_id_001","name":"TestLabel","color":"purple","uses":5}
   */
  async findBoardLabelByName(idOrganization, idBoard, name) {
    const boardLabels = await this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ idBoard }/labels`,
      query: undefined,
      logTag: 'findBoardLabelByName',
    })

    return boardLabels.find(label => label.name === name)
  }

  /**
   * @description Finds a label on a board by name, or creates it if it doesn't exist.
   *
   * @route POST /find-or-create-board-label
   * @operationName Find or Create Board Label
   * @category Label Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Organization","name":"idOrganization","required":true,"dictionary":"getOrganizationsDictionary","description":"The ID of the organization."}
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getOrganizationBoardsDictionary","dependsOn":["idOrganization"],"description":"The ID of the board."}
   * @paramDef {"type":"String","label":"Search Name","name":"name","required":true,"description":"The name of the label."}
   * @paramDef {"type":"String","label":"Color","name":"color","uiComponent":{"type":"DROPDOWN","options":{"values":["null","green_light","green","green_dark","blue_light","blue","blue_dark","yellow_light","yellow","yellow_dark","sky_light","sky","sky_dark","orange_light","orange","orange_dark","lime_light","lime","lime_dark","red_light","red","red_dark","pink_light","pink","pink_dark","purple_light","purple","purple_dark","black_light","black","black_dark"]}},"description":"Sets the color of the new label or 'null' if without color. Required when creating a label."}
   *
   * @returns {Label} Returns information about the matching label, or the newly created label.
   * @sampleResult {"id":"test_label_id_001","idBoard":"test_board_id_001","name":"TestLabel","color":"purple","uses":5}
   */
  async findOrCreateBoardLabel(idOrganization, idBoard, name, color) {
    const boardLabels = await this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ idBoard }/labels`,
      query: undefined,
      logTag: 'findOrCreateBoardLabel',
    })

    const foundBoardLabel = boardLabels.find(label => label.name === name)

    return foundBoardLabel || this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ idBoard }/labels`,
      method: 'post',
      query: { name, color },
      logTag: 'createBoardLabel',
    })
  }

  /**
   * @description Copies an existing board.
   *
   * @route POST /copy-board
   * @operationName Copy Board
   * @category Board Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Organization","name":"idOrganization","required":true,"dictionary":"getOrganizationsDictionary","description":"The ID of the organization."}
   * @paramDef {"type":"String","label":"Board Source","name":"idBoardSource","required":true,"dictionary":"getOrganizationBoardsDictionary","dependsOn":["idOrganization"],"description":"The ID of the board to copy."}
   * @paramDef {"type":"String","label":"New Board Name","name":"name","required":true,"description":"The new name of the board."}
   *
   * @returns {Board} Returns information about the copied board.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","name":"TrelloPlatformChanges","desc":"TrackchangestoTrello'sPlatformonthisboard.","descData":"<string>","closed":false,"idMemberCreator":"5abbe4b7ddc1b351ef961414","idOrganization":"5abbe4b7ddc1b351ef961414","pinned":false,"url":"https://trello.com/b/dQHqCohZ/trello-platform-changelog","shortUrl":"https://trello.com/b/dQHqCohZ","prefs":{"permissionLevel":"org","hideVotes":true,"voting":"disabled","comments":"<string>","selfJoin":true,"cardCovers":true,"isTemplate":true,"cardAging":"pirate","calendarFeedEnabled":true,"background":"5abbe4b7ddc1b351ef961414","backgroundImage":"<string>","backgroundImageScaled":[{"width":100,"height":64,"url":"https://trello-backgrounds.s3.amazonaws.com/SharedBackground/100x64/abc/photo-123.jpg"}],"backgroundTile":true,"backgroundBrightness":"dark","backgroundBottomColor":"#1e2e00","backgroundTopColor":"#ffffff","canBePublic":true,"canBeEnterprise":true,"canBeOrg":true,"canBePrivate":true,"canInvite":true},"labelNames":{"green":"Addition","yellow":"Update","orange":"Deprecation","red":"Deletion","purple":"Power-Ups","blue":"News","sky":"Announcement","lime":"Delight","pink":"RESTAPI","black":"Capabilties"},"limits":{"attachments":{"perBoard":{"status":"ok","disableAt":36000,"warnAt":32400}}},"starred":true,"memberships":"<string>","shortLink":"<string>","subscribed":true,"powerUps":"<string>","dateLastActivity":"<string>","dateLastView":"<string>","idTags":"<string>","datePluginDisable":"<string>","creationMethod":"<string>","ixUpdate":2154,"templateGallery":"<string>","enterpriseOwned":true}
   */
  copyBoard(idOrganization, idBoardSource, name) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/boards`,
      method: 'post',
      query: { idOrganization, idBoardSource, name },
      logTag: 'copyBoard',
    })
  }

  /**
   * @description Closes a board.
   *
   * @route PUT /close-board
   * @operationName Close Board
   * @category Board Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   *
   * @returns {Board} Returns information about the closed board.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","name":"TrelloPlatformChanges","desc":"TrackchangestoTrello'sPlatformonthisboard.","descData":"<string>","closed":true,"idMemberCreator":"5abbe4b7ddc1b351ef961414","idOrganization":"5abbe4b7ddc1b351ef961414","pinned":false,"url":"https://trello.com/b/dQHqCohZ/trello-platform-changelog","shortUrl":"https://trello.com/b/dQHqCohZ","prefs":{"permissionLevel":"org","hideVotes":true,"voting":"disabled","comments":"<string>","selfJoin":true,"cardCovers":true,"isTemplate":true,"cardAging":"pirate","calendarFeedEnabled":true,"background":"5abbe4b7ddc1b351ef961414","backgroundImage":"<string>","backgroundImageScaled":[{"width":100,"height":64,"url":"https://trello-backgrounds.s3.amazonaws.com/SharedBackground/100x64/abc/photo-123.jpg"}],"backgroundTile":true,"backgroundBrightness":"dark","backgroundBottomColor":"#1e2e00","backgroundTopColor":"#ffffff","canBePublic":true,"canBeEnterprise":true,"canBeOrg":true,"canBePrivate":true,"canInvite":true},"labelNames":{"green":"Addition","yellow":"Update","orange":"Deprecation","red":"Deletion","purple":"Power-Ups","blue":"News","sky":"Announcement","lime":"Delight","pink":"RESTAPI","black":"Capabilties"},"limits":{"attachments":{"perBoard":{"status":"ok","disableAt":36000,"warnAt":32400}}},"starred":true,"memberships":"<string>","shortLink":"<string>","subscribed":true,"powerUps":"<string>","dateLastActivity":"<string>","dateLastView":"<string>","idTags":"<string>","datePluginDisable":"<string>","creationMethod":"<string>","ixUpdate":2154,"templateGallery":"<string>","enterpriseOwned":true}
   */
  closeBoard(idBoard) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ idBoard }`,
      query: { closed: true },
      method: 'put',
      logTag: 'closeBoard',
    })
  }

  /**
   * @description Creates a new card.
   *
   * @route POST /card
   * @operationName Create Card
   * @category Card Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list the card should be created in."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name for the card."}
   * @paramDef {"type":"String","label":"Description","name":"desc","description":"The description for the card."}
   * @paramDef {"type":"String","label":"Position","name":"pos","description":"The position of the new card: 'top', 'bottom', or a positive float."}
   * @paramDef {"type":"String","label":"Due Date","name":"due","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"A due date for the card."}
   * @paramDef {"type":"String","label":"Start Date","name":"start","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"A start date of a card."}
   * @paramDef {"type":"Boolean","label":"Due Complete","name":"dueComplete","uiComponent":{"type":"TOGGLE"},"description":"Whether the card’s due date is marked as complete."}
   * @paramDef {"type":"String","label":"Member ID(s)","name":"idMembers","dictionary":"getBoardMembersDictionary","dependsOn":["idBoard"],"description":"Single member ID of a comma-separated list of IDs to add to the card."}
   * @paramDef {"type":"String","label":"Label ID(s)","name":"idLabels","dictionary":"getBoardLabelsDictionary","dependsOn":["idBoard"],"description":"Single label ID or a comma-separated list of IDs to add to the card."}
   * @paramDef {"type":"String","label":"URL Source","name":"urlSource","description":"A URL starting with http:// or https://. The URL will be attached to the card upon creation."}
   *
   * @returns {Card} Returns information about a created card.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","address":"<string>","badges":{"attachmentsByType":{"trello":{"board":2154,"card":2154}},"location":true,"votes":2154,"viewingMemberVoted":false,"subscribed":false,"fogbugz":"<string>","checkItems":0,"checkItemsChecked":0,"comments":0,"attachments":0,"description":true,"due":"<string>","start":"<string>","dueComplete":true},"checkItemStates":["<string>"],"closed":true,"coordinates":"<string>","creationMethod":"<string>","dateLastActivity":"2019-09-16T16:19:17.156Z","desc":"👋Hey there,\n\nTrello's Platform team uses this board to keep developers up-to-date.","descData":{"emoji":{}},"due":"<string>","dueReminder":"<string>","idBoard":"5abbe4b7ddc1b351ef961414","idChecklists":[{"id":"5abbe4b7ddc1b351ef961414"}],"idLabels":[{"id":"5abbe4b7ddc1b351ef961414","idBoard":"5abbe4b7ddc1b351ef961414","name":"Overdue","color":"yellow"}],"idList":"5abbe4b7ddc1b351ef961414","idMembers":["5abbe4b7ddc1b351ef961414"],"idMembersVoted":["5abbe4b7ddc1b351ef961414"],"idShort":2154,"labels":["5abbe4b7ddc1b351ef961414"],"limits":{"attachments":{"perBoard":{"status":"ok","disableAt":36000,"warnAt":32400}}},"locationName":"<string>","manualCoverAttachment":false,"name":"👋 What? Why? How?","pos":65535,"shortLink":"H0TZyzbK","shortUrl":"https://trello.com/c/H0TZyzbK","subscribed":false,"url":"https://trello.com/c/H0TZyzbK/4-%F0%9F%91%8B-what-why-how","cover":{"color":"yellow","idUploadedBackground":true,"size":"normal","brightness":"light","isTemplate":false}}
   */
  createCard(idBoard, idList, name, desc, pos, due, start, dueComplete, idMembers, idLabels, urlSource) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards`,
      method: 'post',
      query: { idList, name, desc, pos, due, start, dueComplete, idMembers, idLabels, urlSource },
      logTag: 'createCard',
    })
  }

  /**
   * @description Updates a card.
   *
   * @route PUT /card
   * @operationName Update Card
   * @category Card Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The new name for the card."}
   * @paramDef {"type":"String","label":"Description","name":"desc","description":"The new description for the card."}
   * @paramDef {"type":"Boolean","label":"Closed","name":"closed","uiComponent":{"type":"TOGGLE"},"description":"Whether the card should be archived."}
   * @paramDef {"type":"String","label":"New Board","name":"newIdBoard","dictionary":"getBoardsDictionary","description":"The ID of the board the card should be on."}
   * @paramDef {"type":"String","label":"New List","name":"newIdList","dictionary":"getBoardListsDictionary","dependsOn":["idBoard","newIdBoard"],"description":"The ID of the list the card should be in."}
   * @paramDef {"type":"String","label":"Member ID(s)","name":"idMembers","dictionary":"getBoardMembersDictionary","dependsOn":["idBoard","newIdBoard"],"description":"Single member ID or a comma-separated list of IDs."}
   * @paramDef {"type":"String","label":"Label ID(s)","name":"idLabels","dictionary":"getBoardLabelsDictionary","dependsOn":["idBoard","newIdBoard"],"description":"Single label ID or a comma-separated list of IDs."}
   * @paramDef {"type":"String","label":"Position","name":"pos","description":"The position of the card in its list: 'top', 'bottom', or a positive float."}
   * @paramDef {"type":"String","label":"Due Date","name":"due","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the card is due."}
   * @paramDef {"type":"String","label":"Start Date","name":"start","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The start date of a card."}
   * @paramDef {"type":"Boolean","label":"Due Complete","name":"dueComplete","uiComponent":{"type":"TOGGLE"},"description":"Whether the due date should be marked as complete."}
   * @paramDef {"type":"Boolean","label":"Subscribed","name":"subscribed","uiComponent":{"type":"TOGGLE"},"description":"Whether the member is should be subscribed to the card."}
   *
   * @returns {Card} Returns information about the updated card.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","address":"<string>","badges":{"attachmentsByType":{"trello":{"board":2154,"card":2154}},"location":true,"votes":2154,"viewingMemberVoted":false,"subscribed":false,"fogbugz":"<string>","checkItems":0,"checkItemsChecked":0,"comments":0,"attachments":0,"description":true,"due":"<string>","start":"<string>","dueComplete":true},"checkItemStates":["<string>"],"closed":true,"coordinates":"<string>","creationMethod":"<string>","dateLastActivity":"2019-09-16T16:19:17.156Z","desc":"👋Hey there,\n\nTrello's Platform team uses this board to keep developers up-to-date.","descData":{"emoji":{}},"due":"<string>","dueReminder":"<string>","idBoard":"5abbe4b7ddc1b351ef961414","idChecklists":[{"id":"5abbe4b7ddc1b351ef961414"}],"idLabels":[{"id":"5abbe4b7ddc1b351ef961414","idBoard":"5abbe4b7ddc1b351ef961414","name":"Overdue","color":"yellow"}],"idList":"5abbe4b7ddc1b351ef961414","idMembers":["5abbe4b7ddc1b351ef961414"],"idMembersVoted":["5abbe4b7ddc1b351ef961414"],"idShort":2154,"labels":["5abbe4b7ddc1b351ef961414"],"limits":{"attachments":{"perBoard":{"status":"ok","disableAt":36000,"warnAt":32400}}},"locationName":"<string>","manualCoverAttachment":false,"name":"👋 What? Why? How?","pos":65535,"shortLink":"H0TZyzbK","shortUrl":"https://trello.com/c/H0TZyzbK","subscribed":false,"url":"https://trello.com/c/H0TZyzbK/4-%F0%9F%91%8B-what-why-how","cover":{"color":"yellow","idUploadedBackground":true,"size":"normal","brightness":"light","isTemplate":false}}
   */
  updateCard(
    idBoard,
    idList,
    idCard,
    name,
    desc,
    closed,
    newIdBoard,
    newIdList,
    idMembers,
    idLabels,
    pos,
    due,
    start,
    dueComplete,
    subscribed
  ) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }`,
      method: 'put',
      query: {
        name,
        desc,
        closed,
        idBoard: newIdBoard,
        idList: newIdList,
        idMembers,
        idLabels,
        pos,
        due,
        start,
        dueComplete,
        subscribed,
      },
      logTag: 'updateCard',
    })
  }

  /**
   * @description Archives a card.
   *
   * @route POST /archive-card
   * @operationName Archive Card
   * @category Card Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   *
   * @returns {Card} Returns information about the updated card.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","address":"<string>","badges":{"attachmentsByType":{"trello":{"board":2154,"card":2154}},"location":true,"votes":2154,"viewingMemberVoted":false,"subscribed":false,"fogbugz":"<string>","checkItems":0,"checkItemsChecked":0,"comments":0,"attachments":0,"description":true,"due":"<string>","start":"<string>","dueComplete":true},"checkItemStates":["<string>"],"closed":true,"coordinates":"<string>","creationMethod":"<string>","dateLastActivity":"2019-09-16T16:19:17.156Z","desc":"👋Hey there,\n\nTrello's Platform team uses this board to keep developers up-to-date.","descData":{"emoji":{}},"due":"<string>","dueReminder":"<string>","idBoard":"5abbe4b7ddc1b351ef961414","idChecklists":[{"id":"5abbe4b7ddc1b351ef961414"}],"idLabels":[{"id":"5abbe4b7ddc1b351ef961414","idBoard":"5abbe4b7ddc1b351ef961414","name":"Overdue","color":"yellow"}],"idList":"5abbe4b7ddc1b351ef961414","idMembers":["5abbe4b7ddc1b351ef961414"],"idMembersVoted":["5abbe4b7ddc1b351ef961414"],"idShort":2154,"labels":["5abbe4b7ddc1b351ef961414"],"limits":{"attachments":{"perBoard":{"status":"ok","disableAt":36000,"warnAt":32400}}},"locationName":"<string>","manualCoverAttachment":false,"name":"👋 What? Why? How?","pos":65535,"shortLink":"H0TZyzbK","shortUrl":"https://trello.com/c/H0TZyzbK","subscribed":false,"url":"https://trello.com/c/H0TZyzbK/4-%F0%9F%91%8B-what-why-how","cover":{"color":"yellow","idUploadedBackground":true,"size":"normal","brightness":"light","isTemplate":false}}
   */
  archiveCard(idBoard, idList, idCard) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/closed`,
      method: 'put',
      query: { value: true },
      logTag: 'archiveCard',
    })
  }

  /**
   * @description Unarchives a card.
   *
   * @route POST /unarchive-card
   * @operationName Unarchive Card
   * @category Card Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getArchivedBoardCardsDictionary","dependsOn":["idBoard"],"description":"The ID of the archived card."}
   *
   * @returns {Card} Returns information about the updated card.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","address":"<string>","badges":{"attachmentsByType":{"trello":{"board":2154,"card":2154}},"location":true,"votes":2154,"viewingMemberVoted":false,"subscribed":false,"fogbugz":"<string>","checkItems":0,"checkItemsChecked":0,"comments":0,"attachments":0,"description":true,"due":"<string>","start":"<string>","dueComplete":true},"checkItemStates":["<string>"],"closed":false,"coordinates":"<string>","creationMethod":"<string>","dateLastActivity":"2019-09-16T16:19:17.156Z","desc":"👋Hey there,\n\nTrello's Platform team uses this board to keep developers up-to-date.","descData":{"emoji":{}},"due":"<string>","dueReminder":"<string>","idBoard":"5abbe4b7ddc1b351ef961414","idChecklists":[{"id":"5abbe4b7ddc1b351ef961414"}],"idLabels":[{"id":"5abbe4b7ddc1b351ef961414","idBoard":"5abbe4b7ddc1b351ef961414","name":"Overdue","color":"yellow"}],"idList":"5abbe4b7ddc1b351ef961414","idMembers":["5abbe4b7ddc1b351ef961414"],"idMembersVoted":["5abbe4b7ddc1b351ef961414"],"idShort":2154,"labels":["5abbe4b7ddc1b351ef961414"],"limits":{"attachments":{"perBoard":{"status":"ok","disableAt":36000,"warnAt":32400}}},"locationName":"<string>","manualCoverAttachment":false,"name":"👋 What? Why? How?","pos":65535,"shortLink":"H0TZyzbK","shortUrl":"https://trello.com/c/H0TZyzbK","subscribed":false,"url":"https://trello.com/c/H0TZyzbK/4-%F0%9F%91%8B-what-why-how","cover":{"color":"yellow","idUploadedBackground":true,"size":"normal","brightness":"light","isTemplate":false}}
   */
  unarchiveCard(idBoard, idCard) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/closed`,
      method: 'put',
      query: { value: false },
      logTag: 'unarchiveCard',
    })
  }

  /**
   * @description Deletes a card.
   *
   * @route DELETE /card
   * @operationName Delete Card
   * @category Card Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   */
  deleteCard(idBoard, idList, idCard) {
    return this.#apiRequest({ url: `${ API_BASE_URL }/cards/${ idCard }`, method: 'delete', logTag: 'deleteCard' })
  }

  /**
   * @description Gets a card by its ID.
   *
   * @route POST /get-card
   * @operationName Get Card by ID
   * @category Card Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"'all' or a comma-separated list of fields. Defaults: 'badges,checkItemStates,closed,dateLastActivity,desc,descData,due,start,idBoard,idChecklists,idLabels,idList,idMembers,idShort,idAttachmentCover,manualCoverAttachment,labels,name,pos,shortUrl,url'."}
   * @paramDef {"type":"String","label":"Actions","name":"actions","description":"Comma-separated list of actions nested resources to include in the response."}
   * @paramDef {"type":"String","label":"Attachments","name":"attachments","uiComponent":{"type":"DROPDOWN","options":{"values":["true","false","cover"]}},"description":"Whether and how attachments are returned in the card response. Default: false."}
   * @paramDef {"type":"String","label":"Attachment Fields","name":"attachmentFields","description":"'all' or a comma-separated list of attachment fields. Default: 'all'."}
   * @paramDef {"type":"Boolean","label":"Members","name":"members","uiComponent":{"type":"TOGGLE"},"description":"Whether to return the member objects for members on the card. Default: false."}
   * @paramDef {"type":"String","label":"Member Fields","name":"memberFields","description":"'all' or a comma-separated list of member fields. Defaults: 'avatarHash,fullName,initials,username'."}
   * @paramDef {"type":"Boolean","label":"Members Voted","name":"membersVoted","uiComponent":{"type":"TOGGLE"},"description":"Whether to return the member objects for members who voted on the card. Default: false."}
   * @paramDef {"type":"String","label":"Member Voted Fields","name":"memberVotedFields","description":"'all' or a comma-separated list of member fields. Defaults: 'avatarHash,fullName,initials,username'."}
   * @paramDef {"type":"Boolean","label":"Check Item States","name":"checkItemStates","uiComponent":{"type":"TOGGLE"},"description":"Whether the response should include an array of the card’s check item states. Default: false."}
   * @paramDef {"type":"String","label":"Checklists","name":"checklists","uiComponent":{"type":"DROPDOWN","options":{"values":["all","none"]}},"description":"Whether to return the checklists on the card. Default: 'none'."}
   * @paramDef {"type":"String","label":"Checklist Fields","name":"checklistFields","description":"'all' or a comma-separated list of checklist fields (idBoard, idCard, name, pos). Default: 'all'."}
   * @paramDef {"type":"Boolean","label":"Board Object","name":"board","uiComponent":{"type":"TOGGLE"},"description":"Whether to return the board object the card is on. Default: false."}
   * @paramDef {"type":"String","label":"Board Fields","name":"boardFields","description":"'all' or a comma-separated list of board fields. Defaults: 'name,desc,descData,closed,idOrganization,pinned,url,prefs'."}
   * @paramDef {"type":"Boolean","label":"List Object","name":"list","uiComponent":{"type":"TOGGLE"},"description":"Whether to return the list object the card is in. Default: false."}
   * @paramDef {"type":"Boolean","label":"Plugin Data","name":"pluginData","uiComponent":{"type":"TOGGLE"},"description":"Whether to include the plugin data on the card with the response. Default: false."}
   * @paramDef {"type":"Boolean","label":"Stickers","name":"stickers","uiComponent":{"type":"TOGGLE"},"description":"Whether to include the sticker models with the response. Default: false."}
   * @paramDef {"type":"String","label":"Sticker Fields","name":"stickerFields","description":"'all' or a comma-separated list of sticker fields. Default: 'all'."}
   * @paramDef {"type":"Boolean","label":"Custom Field Items","name":"customFieldItems","uiComponent":{"type":"TOGGLE"},"description":"Whether to include the custom field items with the response. Default: false."}
   *
   * @returns {Card} Returns information about the matching card.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","address":"<string>","badges":{"attachmentsByType":{"trello":{"board":2154,"card":2154}},"location":true,"votes":2154,"viewingMemberVoted":false,"subscribed":false,"fogbugz":"<string>","checkItems":0,"checkItemsChecked":0,"comments":0,"attachments":0,"description":true,"due":"<string>","start":"<string>","dueComplete":true},"checkItemStates":["<string>"],"closed":true,"coordinates":"<string>","creationMethod":"<string>","dateLastActivity":"2019-09-16T16:19:17.156Z","desc":"👋Hey there,\n\nTrello's Platform team uses this board to keep developers up-to-date.","descData":{"emoji":{}},"due":"<string>","dueReminder":"<string>","idBoard":"5abbe4b7ddc1b351ef961414","idChecklists":[{"id":"5abbe4b7ddc1b351ef961414"}],"idLabels":[{"id":"5abbe4b7ddc1b351ef961414","idBoard":"5abbe4b7ddc1b351ef961414","name":"Overdue","color":"yellow"}],"idList":"5abbe4b7ddc1b351ef961414","idMembers":["5abbe4b7ddc1b351ef961414"],"idMembersVoted":["5abbe4b7ddc1b351ef961414"],"idShort":2154,"labels":["5abbe4b7ddc1b351ef961414"],"limits":{"attachments":{"perBoard":{"status":"ok","disableAt":36000,"warnAt":32400}}},"locationName":"<string>","manualCoverAttachment":false,"name":"👋 What? Why? How?","pos":65535,"shortLink":"H0TZyzbK","shortUrl":"https://trello.com/c/H0TZyzbK","subscribed":false,"url":"https://trello.com/c/H0TZyzbK/4-%F0%9F%91%8B-what-why-how","cover":{"color":"yellow","idUploadedBackground":true,"size":"normal","brightness":"light","isTemplate":false}}
   */
  getCardById(
    idBoard,
    idList,
    idCard,
    fields,
    actions,
    attachments,
    attachmentFields,
    members,
    memberFields,
    membersVoted,
    memberVotedFields,
    checkItemStates,
    checklists,
    checklistFields,
    board,
    boardFields,
    list,
    pluginData,
    stickers,
    stickerFields,
    customFieldItems
  ) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }`,
      query: {
        fields,
        actions,
        attachments,
        attachment_fields: attachmentFields,
        members,
        member_fields: memberFields,
        membersVoted,
        memberVoted_fields: memberVotedFields,
        checkItemStates,
        checklists,
        checklist_fields: checklistFields,
        board,
        board_fields: boardFields,
        list,
        pluginData,
        stickers,
        sticker_fields: stickerFields,
        customFieldItems,
      },
      logTag: 'getCardById',
    })
  }

  /**
   * @description Finds a card by name.
   *
   * @route POST /find-card
   * @operationName Find Card by Name
   * @category Card Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Organization","name":"idOrganization","required":true,"dictionary":"getOrganizationsDictionary","description":"The ID of the organization."}
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getOrganizationBoardsDictionary","dependsOn":["idOrganization"],"description":"The ID of the board."}
   * @paramDef {"type":"String","label":"Search Name","name":"name","required":true,"description":"The name of the card."}
   *
   * @returns {Card} Returns information about the matching card.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","address":"<string>","badges":{"attachmentsByType":{"trello":{"board":2154,"card":2154}},"location":true,"votes":2154,"viewingMemberVoted":false,"subscribed":false,"fogbugz":"<string>","checkItems":0,"checkItemsChecked":0,"comments":0,"attachments":0,"description":true,"due":"<string>","start":"<string>","dueComplete":true},"checkItemStates":["<string>"],"closed":true,"coordinates":"<string>","creationMethod":"<string>","dateLastActivity":"2019-09-16T16:19:17.156Z","desc":"👋Hey there,\n\nTrello's Platform team uses this board to keep developers up-to-date.","descData":{"emoji":{}},"due":"<string>","dueReminder":"<string>","idBoard":"5abbe4b7ddc1b351ef961414","idChecklists":[{"id":"5abbe4b7ddc1b351ef961414"}],"idLabels":[{"id":"5abbe4b7ddc1b351ef961414","idBoard":"5abbe4b7ddc1b351ef961414","name":"Overdue","color":"yellow"}],"idList":"5abbe4b7ddc1b351ef961414","idMembers":["5abbe4b7ddc1b351ef961414"],"idMembersVoted":["5abbe4b7ddc1b351ef961414"],"idShort":2154,"labels":["5abbe4b7ddc1b351ef961414"],"limits":{"attachments":{"perBoard":{"status":"ok","disableAt":36000,"warnAt":32400}}},"locationName":"<string>","manualCoverAttachment":false,"name":"👋 What? Why? How?","pos":65535,"shortLink":"H0TZyzbK","shortUrl":"https://trello.com/c/H0TZyzbK","subscribed":false,"url":"https://trello.com/c/H0TZyzbK/4-%F0%9F%91%8B-what-why-how","cover":{"color":"yellow","idUploadedBackground":true,"size":"normal","brightness":"light","isTemplate":false}}
   */
  async findCardByName(idOrganization, idBoard, name) {
    const boardCards = await this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ idBoard }/cards`,
      query: undefined,
      logTag: 'findCardByName',
    })

    return boardCards.find(card => card.name === name)
  }

  /**
   * @description Finds a card by name, or creates it if it doesn't exist.
   *
   * @route POST /find-or-create-card
   * @operationName Find or Create Card
   * @category Card Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Organization","name":"idOrganization","required":true,"dictionary":"getOrganizationsDictionary","description":"The ID of the organization."}
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getOrganizationBoardsDictionary","dependsOn":["idOrganization"],"description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Search Name","name":"name","required":true,"description":"The name of the card."}
   *
   * @returns {Card} Returns information about the matching card, or the newly created card.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","address":"<string>","badges":{"attachmentsByType":{"trello":{"board":2154,"card":2154}},"location":true,"votes":2154,"viewingMemberVoted":false,"subscribed":false,"fogbugz":"<string>","checkItems":0,"checkItemsChecked":0,"comments":0,"attachments":0,"description":true,"due":"<string>","start":"<string>","dueComplete":true},"checkItemStates":["<string>"],"closed":true,"coordinates":"<string>","creationMethod":"<string>","dateLastActivity":"2019-09-16T16:19:17.156Z","desc":"👋Hey there,\n\nTrello's Platform team uses this board to keep developers up-to-date.","descData":{"emoji":{}},"due":"<string>","dueReminder":"<string>","idBoard":"5abbe4b7ddc1b351ef961414","idChecklists":[{"id":"5abbe4b7ddc1b351ef961414"}],"idLabels":[{"id":"5abbe4b7ddc1b351ef961414","idBoard":"5abbe4b7ddc1b351ef961414","name":"Overdue","color":"yellow"}],"idList":"5abbe4b7ddc1b351ef961414","idMembers":["5abbe4b7ddc1b351ef961414"],"idMembersVoted":["5abbe4b7ddc1b351ef961414"],"idShort":2154,"labels":["5abbe4b7ddc1b351ef961414"],"limits":{"attachments":{"perBoard":{"status":"ok","disableAt":36000,"warnAt":32400}}},"locationName":"<string>","manualCoverAttachment":false,"name":"👋 What? Why? How?","pos":65535,"shortLink":"H0TZyzbK","shortUrl":"https://trello.com/c/H0TZyzbK","subscribed":false,"url":"https://trello.com/c/H0TZyzbK/4-%F0%9F%91%8B-what-why-how","cover":{"color":"yellow","idUploadedBackground":true,"size":"normal","brightness":"light","isTemplate":false}}
   */
  async findOrCreateCard(idOrganization, idBoard, idList, name) {
    const boardCards = await this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ idBoard }/cards`,
      query: undefined,
      logTag: 'findOrCreateCard',
    })

    const foundCard = boardCards.find(card => card.name === name)

    return foundCard || this.#apiRequest({
      url: '/cards',
      method: 'post',
      query: { idList, name },
      logTag: 'createCard',
    })
  }

  /**
   * @description Gets a list of actions on a card.
   *
   * @route POST /get-card-actions
   * @operationName Get Card Actions
   * @category Card Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"A comma-separated list of action types. Defaults: 'commentCard,updateCard:idList'."}
   * @paramDef {"type":"Number","label":"Page","name":"page","description":"The page of results for actions. Each page of results has 50 actions. Default: 0. Maximum: 19."}
   *
   * @returns {Action[]} Returns a list of actions on a card.
   * @sampleResult [{"id":"5abbe4b7ddc1b351ef961414","idMemberCreator":"5abbe4b7ddc1b351ef961414","data":{"text":"Can never go wrong with bowie","card":{"id":"5abbe4b7ddc1b351ef961414","name":"Bowie","idShort":7,"shortLink":"3CsPkqOF"},"board":{"id":"5abbe4b7ddc1b351ef961414","name":"Mullets","shortLink":"3CsPkqOF"},"list":{"id":"5abbe4b7ddc1b351ef961414","name":"Amazing"}},"type":"commentCard","date":"2020-03-09T19:41:51.396Z","limits":{"reactions":{"perAction":{"status":"ok","disableAt":1000,"warnAt":900},"uniquePerAction":{"status":"ok","disableAt":1000,"warnAt":900}}},"display":{"translationKey":"action_comment_on_card","entities":{"contextOn":{"type":"translatable","translationKey":"action_on","hideIfContext":true,"idContext":"5abbe4b7ddc1b351ef961414"},"card":{"type":"card","hideIfContext":true,"id":"5abbe4b7ddc1b351ef961414","shortLink":"3CsPkqOF","text":"Bowie"},"comment":{"type":"comment","text":"Can never go wrong with bowie"},"memberCreator":{"type":"member","id":"5abbe4b7ddc1b351ef961414","username":"bobloblaw","text":"Bob Loblaw (World)"}}},"memberCreator":{"id":"5abbe4b7ddc1b351ef961414","activityBlocked":false,"avatarHash":"db2adf80c2e6c26b76e1f10400eb4c45","avatarUrl":"https://trello-members.s3.amazonaws.com/5b02e7f4e1facdc393169f9d/db2adf80c2e6c26b76e1f10400eb4c45","fullName":"Bob Loblaw (Trello)","idMemberReferrer":"5abbe4b7ddc1b351ef961414","initials":"BL","username":"bobloblaw"}}]
   */
  getCardActions(idBoard, idList, idCard, filter, page) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/actions`,
      query: { filter, page },
      logTag: 'getCardActions',
    })
  }

  /**
   * @description Gets the checklists on a card.
   *
   * @route POST /get-card-checklists
   * @operationName Get Card Checklists
   * @category Checklist Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","uiComponent":{"type":"DROPDOWN","options":{"values":["all","none"]}},"description":"Determines whether to include checklists in the response. Default: 'all'."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"'all' or a comma-separated list of checklist fields. Default: 'all'."}
   *
   * @returns {Checklist[]} Returns a list of checklists on the card.
   * @sampleResult [{"id":"test_checklist_id_001","name":"TestChecklist","idBoard":"test_board_id_001","idCard":"test_card_id_001","pos":2,"checkItems":[{"id":"test_checkitem_id_001","name":"TestCheckItem","nameData":{"emoji":{}},"pos":16384,"state":"incomplete","due":"2025-02-28T12:07:20.000Z","dueReminder":3,"idMember":null,"idChecklist":"test_checklist_id_001"}]}]
   */
  getCardChecklists(idBoard, idList, idCard, filter, fields) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/checklists`,
      query: { filter, fields },
      logTag: 'getCardChecklists',
    })
  }

  /**
   * @description Gets information about a single checklist.
   *
   * @route POST /get-card-checklist
   * @operationName Get Card Checklist by ID
   * @category Checklist Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Checklist","name":"idChecklist","required":true,"dictionary":"getCardChecklistsDictionary","dependsOn":["idCard"],"description":"The ID of the checklist."}
   * @paramDef {"type":"String","label":"Cards","name":"cards","uiComponent":{"type":"DROPDOWN","options":{"values":["all","closed","none","open","visible"]}},"description":"Determines which associated cards are included in the checklist response. Default: 'none'."}
   * @paramDef {"type":"String","label":"Check Items","name":"checkItems","uiComponent":{"type":"DROPDOWN","options":{"values":["all","none"]}},"description":"The check items on the list to return. Default: 'all'."}
   * @paramDef {"type":"String","label":"Check Item Fields","name":"checkItemFields","description":"The fields on the checkItem to return if checkItems are being returned. 'all' or a comma-separated list of: 'name', 'nameData', 'pos', 'state', 'type', 'due', 'dueReminder', 'idMember'. Defaults: 'name,nameData,pos,state,due,dueReminder,idMember'."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"'all' or a comma-separated list of checklist fields. Default: 'all'."}
   *
   * @returns {Checklist} Returns information about the matching checklist.
   * @sampleResult {"id":"test_checklist_id_001","name":"TestChecklist","idBoard":"test_board_id_001","idCard":"test_card_id_001","pos":2,"checkItems":[{"id":"test_checkitem_id_001","name":"TestCheckItem","nameData":{"emoji":{}},"pos":16384,"state":"incomplete","due":"2025-02-28T12:07:20.000Z","dueReminder":3,"idMember":null,"idChecklist":"test_checklist_id_001"}]}
   */
  getCardChecklistById(idBoard, idList, idCard, idChecklist, cards, checkItems, checkItemFields, fields) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/checklists/${ idChecklist }`, query: {
        cards,
        checkItems,
        checkItem_fields: checkItemFields,
        fields,
      }, logTag: 'getCardChecklistById',
    })
  }

  /**
   * @description Creates a new checklist on a card.
   *
   * @route POST /checklist-to-card
   * @operationName Add Checklist to Card
   * @category Checklist Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Organization","name":"id","required":true,"dictionary":"getOrganizationsDictionary","description":"The ID of the organization."}
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getOrganizationBoardsDictionary","dependsOn":["id"],"description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Checklist Name","name":"name","required":true,"description":"The name of the checklist."}
   * @paramDef {"type":"String","label":"Checklist Source","name":"idChecklistSource","dictionary":"getCardChecklistsDictionary","dependsOn":["idCard"],"description":"The ID of a source checklist to copy into the new one."}
   * @paramDef {"type":"String","label":"Position","name":"pos","description":"The position of the checklist on the card. One of: 'top', 'bottom', or a positive number."}
   *
   * @returns {Checklist} Returns information about the created checklist.
   * @sampleResult {"id":"test_checklist_id_001","name":"TestChecklist","idBoard":"test_board_id_001","idCard":"test_card_id_001","pos":2,"checkItems":[{"id":"test_checkitem_id_001","name":"TestCheckItem","nameData":{"emoji":{}},"pos":16384,"state":"incomplete","due":"2025-02-28T12:07:20.000Z","dueReminder":3,"idMember":null,"idChecklist":"test_checklist_id_001"}]}
   */
  addChecklistToCard(id, idBoard, idList, idCard, name, idChecklistSource, pos) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/checklists`,
      method: 'post',
      query: { name, idChecklistSource, pos },
      logTag: 'addChecklistToCard',
    })
  }

  /**
   * @description Deletes a checklist from a card.
   *
   * @route DELETE /card-checklist
   * @operationName Delete Card Checklist
   * @category Checklist Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Checklist","name":"idChecklist","required":true,"dictionary":"getCardChecklistsDictionary","dependsOn":["idCard"],"description":"The ID of the checklist."}
   *
   * @returns {Checklist[]} Returns the remaining checklists on the card.
   * @sampleResult [{"id":"test_checklist_id_001","name":"TestChecklist","idBoard":"test_board_id_001","idCard":"test_card_id_001","pos":2,"checkItems":[{"id":"test_checkitem_id_001","name":"TestCheckItem","nameData":{"emoji":{}},"pos":16384,"state":"incomplete","due":"2025-02-28T12:07:20.000Z","dueReminder":3,"idMember":null,"idChecklist":"test_checklist_id_001"}]}]
   */
  deleteCardChecklist(idBoard, idList, idCard, idChecklist) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/checklists/${ idChecklist }`,
      method: 'delete',
      logTag: 'deleteChecklist',
    })
  }

  /**
   * @description Gets the stickers on a card.
   *
   * @route POST /get-card-stickers
   * @operationName Get Card Stickers
   * @category Card Content
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"'all' or a comma-separated list of sticker fields. Default: 'all'."}
   *
   * @returns {Sticker[]} Returns a list of stickers on the card.
   * @sampleResult [{"rotate":10,"image":"test-sticker","top":30,"left":-35,"imageUrl":"https://example.com/stickers/test-sticker.png","imageScaled":[{"scaled":false,"bytes":1234,"width":100,"_id":"test_scaled_1","id":"test_scaled_1","url":"https://example.com/stickers/test-sticker.png","height":100},{"scaled":false,"bytes":2345,"width":200,"_id":"test_scaled_2","id":"test_scaled_2","url":"https://example.com/stickers/test-sticker@2x.png","height":200}],"id":"test_sticker_id_001","zIndex":2}]
   */
  getCardStickers(idBoard, idList, idCard, fields) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/stickers`,
      query: { fields },
      logTag: 'getCardStickers',
    })
  }

  /**
   * @description Add a sticker to a card.
   *
   * @route POST /card-sticker
   * @operationName Add Sticker to Card
   * @category Card Content
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Sticker","name":"image","required":true,"description":"For custom stickers, the ID of the sticker. For default stickers, the string identifier (like 'taco-cool')."}
   * @paramDef {"type":"Number","label":"Top Position","name":"top","required":true,"description":"The top position of the sticker. Minimum: -60. Maximum: 100."}
   * @paramDef {"type":"Number","label":"Left Position","name":"left","required":true,"description":"The left position of the sticker. Minimum: -60. Maximum: 100."}
   * @paramDef {"type":"Number","label":"Z-Index","name":"zIndex","required":true,"description":"The z-index of the sticker."}
   * @paramDef {"type":"Number","label":"Rotate","name":"rotate","description":"The rotation of the sticker. Default: 0. Minimum: 0. Maximum: 360."}
   *
   * @returns {Sticker} Returns information about the created sticker.
   * @sampleResult {"rotate":10,"image":"test-sticker","top":30,"left":-35,"imageUrl":"https://example.com/stickers/test-sticker.png","imageScaled":[{"scaled":false,"bytes":1234,"width":100,"_id":"test_scaled_1","id":"test_scaled_1","url":"https://example.com/stickers/test-sticker.png","height":100},{"scaled":false,"bytes":2345,"width":200,"_id":"test_scaled_2","id":"test_scaled_2","url":"https://example.com/stickers/test-sticker@2x.png","height":200}],"id":"test_sticker_id_001","zIndex":2}
   */
  addStickerToCard(idBoard, idList, idCard, image, top, left, zIndex, rotate) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/stickers`,
      method: 'post',
      query: { image, top, left, zIndex, rotate },
      logTag: 'addStickerToCard',
    })
  }

  /**
   * @description Deletes a sticker from a card.
   *
   * @route DELETE /card-sticker
   * @operationName Delete Sticker from Card
   * @category Card Content
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Sticker","name":"idSticker","required":true,"dictionary":"getCardStickersDictionary","dependsOn":["idCard"],"description":"The ID of the sticker."}
   *
   * @returns {Card} Returns information about the updated card.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","address":"<string>","badges":{"attachmentsByType":{"trello":{"board":2154,"card":2154}},"location":true,"votes":2154,"viewingMemberVoted":false,"subscribed":false,"fogbugz":"<string>","checkItems":0,"checkItemsChecked":0,"comments":0,"attachments":0,"description":true,"due":"<string>","start":"<string>","dueComplete":true},"checkItemStates":["<string>"],"closed":true,"coordinates":"<string>","creationMethod":"<string>","dateLastActivity":"2019-09-16T16:19:17.156Z","desc":"👋Heythere,\n\nTrello'sPlatformteamusesthisboardtokeepdevelopersup-to-date.","descData":{"emoji":{}},"due":"<string>","dueReminder":"<string>","idBoard":"5abbe4b7ddc1b351ef961414","idChecklists":[{"id":"5abbe4b7ddc1b351ef961414"}],"idLabels":[{"id":"5abbe4b7ddc1b351ef961414","idBoard":"5abbe4b7ddc1b351ef961414","name":"Overdue","color":"yellow"}],"idList":"5abbe4b7ddc1b351ef961414","idMembers":["5abbe4b7ddc1b351ef961414"],"idMembersVoted":["5abbe4b7ddc1b351ef961414"],"idShort":2154,"labels":["5abbe4b7ddc1b351ef961414"],"limits":{"attachments":{"perBoard":{"status":"ok","disableAt":36000,"warnAt":32400}}},"locationName":"<string>","manualCoverAttachment":false,"name":"👋What?Why?How?","pos":65535,"shortLink":"H0TZyzbK","shortUrl":"https://trello.com/c/H0TZyzbK","subscribed":false,"url":"https://trello.com/c/H0TZyzbK/4-%F0%9F%91%8B-what-why-how","cover":{"color":"yellow","idUploadedBackground":true,"size":"normal","brightness":"light","isTemplate":false}}
   */
  deleteStickerFromCard(idBoard, idList, idCard, idSticker) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/stickers/${ idSticker }`,
      method: 'delete',
      logTag: 'deleteStickerFromCard',
    })
  }

  /**
   * @description Gets the members on a card.
   *
   * @route POST /get-card-members
   * @operationName Get Card Members
   * @category Member Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"'all' or a comma-separated list of member fields. Default: 'all'."}
   *
   * @returns {Member[]} Returns a list of members on the card.
   * @sampleResult [{"id":"test_member_id_001","activityBlocked":false,"avatarHash":"testAvatarHash001","avatarUrl":"https://example.com/avatar1.png","fullName":"TestMemberOne","idMemberReferrer":"test_referrer_id_001","initials":"TM","nonPublic":{},"nonPublicAvailable":true,"username":"testmember1"}]
   */
  getCardMembers(idBoard, idList, idCard, fields) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/members`,
      query: { fields },
      logTag: 'getCardMembers',
    })
  }

  /**
   * @description Adds a member to a card.
   *
   * @route POST /card-member
   * @operationName Add Member to Card
   * @category Member Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Organization","name":"id","required":true,"dictionary":"getOrganizationsDictionary","description":"The ID of the organization."}
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getOrganizationBoardsDictionary","dependsOn":["id"],"description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Member","name":"idMember","required":true,"dictionary":"getOrganizationMembersDictionary","dependsOn":["id"],"description":"The ID or username of the member to add to the card."}
   *
   * @returns {Member[]} Returns a list of members on the card.
   * @sampleResult [{"id":"test_member_id_001","activityBlocked":false,"avatarHash":"testAvatarHash001","avatarUrl":"https://example.com/avatar1.png","fullName":"TestMemberOne","idMemberReferrer":"test_referrer_id_001","initials":"TM","nonPublic":{},"nonPublicAvailable":true,"username":"testmember1"}]
   */
  addMemberToCard(id, idBoard, idList, idCard, idMember) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/idMembers`,
      method: 'post',
      query: { value: idMember },
      logTag: 'addMemberToCard',
    })
  }

  /**
   * @description Deletes a member from a card.
   *
   * @route DELETE /card-member
   * @operationName Delete Member from Card
   * @category Member Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Member","name":"idMember","required":true,"dictionary":"getBoardMembersDictionary","dependsOn":["idBoard"],"description":"The ID or username of the member."}
   */
  deleteMemberFromCard(idBoard, idList, idCard, idMember) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/idMembers/${ idMember }`,
      method: 'delete',
      logTag: 'deleteMemberFromCard',
    })
  }

  /**
   * @description Adds a label to a card.
   *
   * @route POST /card-label
   * @operationName Add Label to Card
   * @category Label Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Organization","name":"id","required":true,"dictionary":"getOrganizationsDictionary","description":"The ID of the organization."}
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getOrganizationBoardsDictionary","dependsOn":["id"],"description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Label","name":"idLabel","required":true,"dictionary":"getBoardLabelsDictionary","dependsOn":["idBoard"],"description":"The ID of the label to add."}
   *
   * @returns {String[]} Returns a list of label IDs on the card.
   * @sampleResult ["1a2b3c4d5e6f7a8b9c0d1e2f","abcdefabcdefabcdefabcdef","1234567890abcdef12345678"]
   */
  addLabelToCard(id, idBoard, idList, idCard, idLabel) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/idLabels`,
      method: 'post',
      query: { value: idLabel },
      logTag: 'addLabelToCard',
    })
  }

  /**
   * @description Deletes a label from a card.
   *
   * @route DELETE /card-label
   * @operationName Delete Label from Card
   * @category Label Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Organization","name":"idOrganization","required":true,"dictionary":"getOrganizationsDictionary","description":"The ID of the organization."}
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getOrganizationBoardsDictionary","dependsOn":["idOrganization"],"description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Label","name":"idLabel","required":true,"dictionary":"getCardLabelsDictionary","dependsOn":["idCard"],"description":"The ID of the label to delete."}
   */
  deleteCardLabel(idOrganization, idBoard, idList, idCard, idLabel) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/idLabels/${ idLabel }`,
      method: 'delete',
      logTag: 'deleteCardLabel',
    })
  }

  /**
   * @description Gets a list of attachments on a card.
   *
   * @route POST /get-card-attachments
   * @operationName Get Card Attachments
   * @category Card Content
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"'all' or a comma-separated list of attachment fields. Default: 'all'."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Use 'cover' to restrict to just the cover attachment. Default: false."}
   *
   * @returns {Attachment[]} Returns a list of attachments on a card.
   * @sampleResult [{"id":"5abbe4b7ddc1b351ef961414","bytes":"<string>","date":"2018-10-17T19:10:14.808Z","edgeColor":"yellow","idMember":"5abbe4b7ddc1b351ef961414","isUpload":false,"mimeType":"","name":"Deprecation Extension Notice","previews":[],"url":"https://admin.typeform.com/form/RzExEM/share#/link","pos":1638}]
   */
  getCardAttachments(idBoard, idList, idCard, fields, filter) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/attachments`,
      query: { fields, filter },
      logTag: 'getCardAttachments',
    })
  }

  /**
   * @description Adds a new attachment to a card.
   *
   * @route POST /card-attachment
   * @operationName Add Attachment to Card
   * @category Card Content
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the attachment. Max length: 256."}
   * @paramDef {"type":"String","label":"File","name":"file","required":true,"description":"The file to attach, as multipart/form-data."}
   * @paramDef {"type":"String","label":"Mime Type","name":"mimeType","description":"The mimeType of the attachment. Max length: 256."}
   * @paramDef {"type":"String","label":"URL","name":"url","description":"A URL to attach. Must start with http:// or https://."}
   * @paramDef {"type":"Boolean","label":"Set Cover","name":"setCover","uiComponent":{"type":"TOGGLE"},"description":"Determines whether to use the new attachment as a cover for the card. Default: false."}
   *
   * @returns {Attachment} Returns information about the new attachment.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","bytes":"<string>","date":"2018-10-17T19:10:14.808Z","edgeColor":"yellow","idMember":"5abbe4b7ddc1b351ef961414","isUpload":false,"mimeType":"","name":"DeprecationExtensionNotice","previews":[],"url":"https://admin.typeform.com/form/RzExEM/share#/link","pos":1638}
   */
  addAttachment(idBoard, idList, idCard, name, file, mimeType, url, setCover) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/attachments`,
      method: 'post',
      query: { name, file, mimeType, url, setCover },
      logTag: 'addAttachment',
    })
  }

  /**
   * @description Deletes an attachment.
   *
   * @route DELETE /card-attachment
   * @operationName Delete Attachment from Card
   * @category Card Content
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Attachment","name":"idAttachment","required":true,"dictionary":"getCardAttachmentsDictionary","dependsOn":["idCard"],"description":"The ID of the card."}
   */
  deleteAttachment(idBoard, idList, idCard, idAttachment) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/attachments/${ idAttachment }`,
      method: 'delete',
      logTag: 'deleteAttachment',
    })
  }

  /**
   * @description Adds a new comment to a card.
   *
   * @route POST /card-comment
   * @operationName Add Comment to Card
   * @category Card Content
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"description":"The comment."}
   *
   * @returns {Card} Returns information about the updated card.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","idMemberCreator":"5abbe4b7ddc1b351ef961414","data":{"text":"Can never go wrong with bowie","card":{"id":"5abbe4b7ddc1b351ef961414","name":"Bowie","idShort":7,"shortLink":"3CsPkqOF"},"board":{"id":"5abbe4b7ddc1b351ef961414","name":"Mullets","shortLink":"3CsPkqOF"},"list":{"id":"5abbe4b7ddc1b351ef961414","name":"Amazing"}},"type":"commentCard","date":"2020-03-09T19:41:51.396Z","limits":{"reactions":{"perAction":{"status":"ok","disableAt":1000,"warnAt":900},"uniquePerAction":{"status":"ok","disableAt":1000,"warnAt":900}}},"display":{"translationKey":"action_comment_on_card","entities":{"contextOn":{"type":"translatable","translationKey":"action_on","hideIfContext":true,"idContext":"5abbe4b7ddc1b351ef961414"},"card":{"type":"card","hideIfContext":true,"id":"5abbe4b7ddc1b351ef961414","shortLink":"3CsPkqOF","text":"Bowie"},"comment":{"type":"comment","text":"Can never go wrong with bowie"},"memberCreator":{"type":"member","id":"5abbe4b7ddc1b351ef961414","username":"bobloblaw","text":"Bob Loblaw (World)"}}},"memberCreator":{"id":"5abbe4b7ddc1b351ef961414","activityBlocked":false,"avatarHash":"db2adf80c2e6c26b76e1f10400eb4c45","avatarUrl":"https://trello-members.s3.amazonaws.com/5b02e7f4e1facdc393169f9d/db2adf80c2e6c26b76e1f10400eb4c45","fullName":"Bob Loblaw (Trello)","idMemberReferrer":"5abbe4b7ddc1b351ef961414","initials":"BL","username":"bobloblaw"}}
   */
  addComment(idBoard, idList, idCard, text) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/actions/comments`,
      method: 'post',
      query: { text },
      logTag: 'addComment',
    })
  }

  /**
   * @description Moves a card to a new list.
   *
   * @route PUT /move-card
   * @operationName Move Card to List
   * @category Card Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"New List","name":"newIdList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list the card should be moved to."}
   *
   * @returns {Card} Returns information about the updated card.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","address":"<string>","badges":{"attachmentsByType":{"trello":{"board":2154,"card":2154}},"location":true,"votes":2154,"viewingMemberVoted":false,"subscribed":false,"fogbugz":"<string>","checkItems":0,"checkItemsChecked":0,"comments":0,"attachments":0,"description":true,"due":"<string>","start":"<string>","dueComplete":true},"checkItemStates":["<string>"],"closed":true,"coordinates":"<string>","creationMethod":"<string>","dateLastActivity":"2019-09-16T16:19:17.156Z","desc":"👋Hey there,\n\nTrello's Platform team uses this board to keep developers up-to-date.","descData":{"emoji":{}},"due":"<string>","dueReminder":"<string>","idBoard":"5abbe4b7ddc1b351ef961414","idChecklists":[{"id":"5abbe4b7ddc1b351ef961414"}],"idLabels":[{"id":"5abbe4b7ddc1b351ef961414","idBoard":"5abbe4b7ddc1b351ef961414","name":"Overdue","color":"yellow"}],"idList":"5abbe4b7ddc1b351ef961414","idMembers":["5abbe4b7ddc1b351ef961414"],"idMembersVoted":["5abbe4b7ddc1b351ef961414"],"idShort":2154,"labels":["5abbe4b7ddc1b351ef961414"],"limits":{"attachments":{"perBoard":{"status":"ok","disableAt":36000,"warnAt":32400}}},"locationName":"<string>","manualCoverAttachment":false,"name":"👋 What? Why? How?","pos":65535,"shortLink":"H0TZyzbK","shortUrl":"https://trello.com/c/H0TZyzbK","subscribed":false,"url":"https://trello.com/c/H0TZyzbK/4-%F0%9F%91%8B-what-why-how","cover":{"color":"yellow","idUploadedBackground":true,"size":"normal","brightness":"light","isTemplate":false}}
   */
  moveCardToList(idBoard, idList, idCard, newIdList) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }`,
      method: 'put',
      query: { idList: newIdList },
      logTag: 'moveCardToList',
    })
  }

  /**
   * @description Gets information about a list.
   *
   * @route POST /get-board-list
   * @operationName Get List by ID
   * @category List Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"'all' or a comma-separated list of list field names. Defaults: 'name,closed,idBoard,pos'."}
   *
   * @returns {List} Returns information about the matching list.
   * @sampleResult {"idBoard":"1a2b3c4d5e6f7a8b9c0d1e2f","color":null,"pos":49152,"datasource":{"filter":false},"name":"Done","closed":false,"id":"1234567890abcdef12345678","type":null}
   */
  getListById(idBoard, idList, fields) {
    return this.#apiRequest({ url: `${ API_BASE_URL }/lists/${ idList }`, query: { fields }, logTag: 'getListById' })
  }

  /**
   * @description Gets a list of cards in a list.
   *
   * @route POST /get-list-cards
   * @operationName Get List Cards
   * @category List Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   *
   * @returns {Card[]} Returns a list of cards in the list.
   * @sampleResult [{"id":"5abbe4b7ddc1b351ef961414","address":"<string>","badges":{"attachmentsByType":{"trello":{"board":2154,"card":2154}},"location":true,"votes":2154,"viewingMemberVoted":false,"subscribed":false,"fogbugz":"<string>","checkItems":0,"checkItemsChecked":0,"comments":0,"attachments":0,"description":true,"due":"<string>","start":"<string>","dueComplete":true},"checkItemStates":["<string>"],"closed":true,"coordinates":"<string>","creationMethod":"<string>","dateLastActivity":"2019-09-16T16:19:17.156Z","desc":"👋Hey there,\n\nTrello's Platform team uses this board to keep developers up-to-date.","descData":{"emoji":{}},"due":"<string>","dueReminder":"<string>","idBoard":"5abbe4b7ddc1b351ef961414","idChecklists":[{"id":"5abbe4b7ddc1b351ef961414"}],"idLabels":[{"id":"5abbe4b7ddc1b351ef961414","idBoard":"5abbe4b7ddc1b351ef961414","name":"Overdue","color":"yellow"}],"idList":"5abbe4b7ddc1b351ef961414","idMembers":["5abbe4b7ddc1b351ef961414"],"idMembersVoted":["5abbe4b7ddc1b351ef961414"],"idShort":2154,"labels":["5abbe4b7ddc1b351ef961414"],"limits":{"attachments":{"perBoard":{}}},"locationName":"<string>","manualCoverAttachment":false,"name":"👋 What? Why? How?","pos":65535,"shortLink":"H0TZyzbK","shortUrl":"https://trello.com/c/H0TZyzbK","subscribed":false,"url":"https://trello.com/c/H0TZyzbK/4-%F0%9F%91%8B-what-why-how","cover":{"color":"yellow","idUploadedBackground":true,"size":"normal","brightness":"light","isTemplate":false}}]
   */
  getListCards(idBoard, idList) {
    return this.#apiRequest({ url: `${ API_BASE_URL }/lists/${ idList }/cards`, logTag: 'getListCards' })
  }

  /**
   * @description Updates the properties of a list.
   *
   * @route PUT /board-list
   * @operationName Update List
   * @category List Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name for the list."}
   * @paramDef {"type":"Boolean","label":"Closed","name":"closed","uiComponent":{"type":"TOGGLE"},"description":"Whether the list should be closed (archived)."}
   * @paramDef {"type":"String","label":"Target Board","name":"idBoardTarget","required":true,"dictionary":"getBoardsDictionary","description":"ID of a board the list should be moved to."}
   * @paramDef {"type":"String","label":"Position","name":"pos","description":"New position for the list: 'top', 'bottom', or a positive floating point number."}
   * @paramDef {"type":"Boolean","label":"Subscribed","name":"subscribed","uiComponent":{"type":"TOGGLE"},"description":"Whether the active member is subscribed to this list."}
   *
   * @returns {List} Returns information about the updated list.
   * @sampleResult {"idBoard":"1a2b3c4d5e6f7a8b9c0d1e2f","color":null,"pos":49152,"datasource":{"filter":false},"name":"Done","closed":false,"id":"1234567890abcdef12345678","type":null}
   */
  updateList(idBoard, idList, name, closed, idBoardTarget, pos, subscribed) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/lists/${ idList }`,
      method: 'put',
      query: { name, closed, idBoard: idBoardTarget, pos, subscribed },
      logTag: 'updateList',
    })
  }

  /**
   * @description Archives a list.
   *
   * @route PUT /archive-list
   * @operationName Archive List
   * @category List Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   */
  archiveList(idBoard, idList) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/lists/${ idList }/closed`,
      method: 'put',
      query: { value: true },
      logTag: 'archiveList',
    })
  }

  /**
   * @description Gets a member by its ID.
   *
   * @route POST /get-member
   * @operationName Get Member by ID
   * @category Member Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"Member","name":"idMember","required":true,"dictionary":"getBoardMembersDictionary","dependsOn":["idBoard"],"description":"The ID or username of the member."}
   * @paramDef {"type":"String","label":"Actions","name":"actions","description":"Comma-separated list of actions nested resources to include in the response."}
   * @paramDef {"type":"String","label":"Boards","name":"boards","description":"Comma-separated list of boards nested resources to include in the response."}
   * @paramDef {"type":"String","label":"Board Backgrounds","name":"boardBackgrounds","uiComponent":{"type":"DROPDOWN","options":{"values":["all","custom","default","none","premium"]}},"description":"Specifies which board backgrounds are included in the response. Default: 'none'."}
   * @paramDef {"type":"String","label":"Board Invited","name":"boardsInvited","description":"'all' or a comma-separated list of: 'closed', 'members', 'open', 'organization', 'pinned', 'public', 'starred', 'unpinned'."}
   * @paramDef {"type":"String","label":"Board Invited Fields","name":"boardsInvitedFields","description":"'all' or a comma-separated list of board fields. Valid values: 'id', 'name', 'desc', 'descData', 'closed', 'idMemberCreator', 'idOrganization', 'pinned', 'url', 'shortUrl', 'prefs', 'labelNames', 'starred', 'limits', 'memberships', 'enterpriseOwned'."}
   * @paramDef {"type":"Boolean","label":"Board Stars","name":"boardStars","uiComponent":{"type":"TOGGLE"},"description":"Whether to return the boardStars or not. Default: false."}
   * @paramDef {"type":"String","label":"Cards","name":"cards","description":"Comma-separated list of cards nested resources to include in the response. Default: 'none'."}
   * @paramDef {"type":"String","label":"Custom Board Backgrounds","name":"customBoardBackgrounds","uiComponent":{"type":"DROPDOWN","options":{"values":["all","none"]}},"description":"Specifies which custom board backgrounds are included in the response. Default: 'none'."}
   * @paramDef {"type":"String","label":"Custom Emoji","name":"customEmoji","uiComponent":{"type":"DROPDOWN","options":{"values":["all","none"]}},"description":"Specifies which custom emoji are included in the response. Default: 'none'."}
   * @paramDef {"type":"String","label":"Custom Stickers","name":"customStickers","uiComponent":{"type":"DROPDOWN","options":{"values":["all","none"]}},"description":"Specifies which custom stickers are included in the response. Default: 'none'."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"'all' or a comma-separated list of member fields."}
   * @paramDef {"type":"String","label":"Notifications","name":"notifications","description":"Comma-separated list of notifications nested resources to include in the response."}
   * @paramDef {"type":"String","label":"Organizations","name":"organizations","uiComponent":{"type":"DROPDOWN","options":{"values":["all","members","none","public"]}},"description":"Specifies which organizations are included in the response. Default: 'none'."}
   * @paramDef {"type":"String","label":"Organization Fields","name":"organizationFields","description":"'all' or a comma-separated list of organization fields."}
   * @paramDef {"type":"Boolean","label":"Organization Paid Account","name":"organizationPaidAccount","uiComponent":{"type":"TOGGLE"},"description":"Whether or not to include paid account information in the returned workspace object. Default: false."}
   * @paramDef {"type":"String","label":"Organizations Invited","name":"organizationsInvited","uiComponent":{"type":"DROPDOWN","options":{"values":["all","members","none","public"]}},"description":"Specifies which invited organizations are included in the response. Default: 'none'."}
   * @paramDef {"type":"String","label":"Organizations Invited Fields","name":"organizationsInvitedFields","description":"'all' or a comma-separated list of organization fields."}
   * @paramDef {"type":"Boolean","label":"Paid Account","name":"paidAccount","uiComponent":{"type":"TOGGLE"},"description":"Whether or not to include paid account information in the returned member object. Default: false."}
   * @paramDef {"type":"Boolean","label":"Saved Searches","name":"savedSearches","uiComponent":{"type":"TOGGLE"},"description":"Specifies whether saved searches for the member are included in the response. Default: false."}
   * @paramDef {"type":"String","label":"Tokens","name":"tokens","uiComponent":{"type":"DROPDOWN","options":{"values":["all","none"]}},"description":"Specifies which tokens are included in the response. Default: 'none'."}
   *
   * @returns {Member} Returns information about the matching member.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","activityBlocked":false,"avatarHash":"fc8faaaee46666a4eb8b626c08933e16","avatarUrl":"https://trello-avatars.s3.amazonaws.com/fc8faaaee46666a4eb8b626c08933e16","bio":"👋 I'm a developer advocate at Trello!","bioData":{"emoji":{}},"confirmed":true,"fullName":"Bentley Cook","idEnterprise":"5abbe4b7ddc1b351ef961414","idEnterprisesDeactivated":["<string>"],"idMemberReferrer":"5abbe4b7ddc1b351ef961414","idPremOrgsAdmin":["5abbe4b7ddc1b351ef961414"],"initials":"BC","memberType":"normal","nonPublic":{"fullName":"Bentley Cook","initials":"BC","avatarUrl":"https://trello-members.s3.amazonaws.com/5b02e7f4e1facdc393169f9d/db2adf80c2e6c26b76e1f10400eb4c45","avatarHash":"db2adf80c2e6c26b76e1f10400eb4c45"},"nonPublicAvailable":false,"products":[2154],"url":"https://trello.com/bentleycook","username":"bentleycook","status":"disconnected","aaEmail":"<string>","aaEnrolledDate":"<string>","aaId":"<string>","avatarSource":"gravatar","email":"bcook@atlassian.com","gravatarHash":"0a1e804f6e35a65ae5e1f7ef4c92471c","idBoards":["5abbe4b7ddc1b351ef961414"],"idOrganizations":["5abbe4b7ddc1b351ef961414"],"idEnterprisesAdmin":["5abbe4b7ddc1b351ef961414"],"limits":{"status":"ok","disableAt":36000,"warnAt":32400},"loginTypes":["password"],"marketingOptIn":{"optedIn":false,"date":"2018-04-26T17:03:25.155Z"},"messagesDismissed":{"name":"ad-security-features","count":"<string>","lastDismissed":"2019-03-11T20:19:46.809Z","_id":"5abbe4b7ddc1b351ef961414"},"oneTimeMessagesDismissed":["<string>"],"prefs":{"timezoneInfo":{"offsetCurrent":360,"timezoneCurrent":"CST","offsetNext":300,"dateNext":"2020-03-08T08:00:00.000Z","timezoneNext":"CDT"},"privacy":{"fullName":"public","avatar":"public"},"sendSummaries":true,"minutesBetweenSummaries":60,"minutesBeforeDeadlineToNotify":1440,"colorBlind":true,"locale":"en-AU","timezone":"America/Chicago","twoFactor":{"enabled":true,"needsNewBackups":false}},"trophies":["<string>"],"uploadedAvatarHash":"dac3ad49ff117829dd63a79bb2ea3426","uploadedAvatarUrl":"https://trello-avatars.s3.amazonaws.com/dac3ad49ff117829dd63a79bb2ea3426","premiumFeatures":["<string>"],"isAaMastered":false,"ixUpdate":2154,"idBoardsPinned":["5abbe4b7ddc1b351ef961414"]}
   */
  getMemberById(
    idBoard,
    idMember,
    actions,
    boards,
    boardBackgrounds,
    boardsInvited,
    boardsInvitedFields,
    boardStars,
    cards,
    customBoardBackgrounds,
    customEmoji,
    customStickers,
    fields,
    notifications,
    organizations,
    organizationFields,
    organizationPaidAccount,
    organizationsInvited,
    organizationsInvitedFields,
    paidAccount,
    savedSearches,
    tokens
  ) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/members/${ idMember }`,
      query: {
        actions,
        boards,
        boardBackgrounds,
        boardsInvited,
        boardsInvited_fields: boardsInvitedFields,
        boardStars,
        cards,
        customBoardBackgrounds,
        customEmoji,
        customStickers,
        fields,
        notifications,
        organizations,
        organization_fields: organizationFields,
        organization_paid_account: organizationPaidAccount,
        organizationsInvited,
        organizationsInvited_fields: organizationsInvitedFields,
        paid_account: paidAccount,
        savedSearches,
        tokens,
      },
      logTag: 'getMemberById',
    })
  }

  /**
   * @description Finds a member by name.
   *
   * @route POST /find-member
   * @operationName Find Member by Name
   * @category Member Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Organization","name":"idOrganization","required":true,"dictionary":"getOrganizationsDictionary","description":"The ID of the organization."}
   * @paramDef {"type":"String","label":"Search Name","name":"name","required":true,"description":"The username of the member."}
   *
   * @returns {Member} Returns information about the matching member.
   * @sampleResult {"id":"5abbe4b7ddc1b351ef961414","activityBlocked":false,"avatarHash":"fc8faaaee46666a4eb8b626c08933e16","avatarUrl":"https://trello-avatars.s3.amazonaws.com/fc8faaaee46666a4eb8b626c08933e16","bio":"👋 I'm a developer advocate at Trello!","bioData":{"emoji":{}},"confirmed":true,"fullName":"Bentley Cook","idEnterprise":"5abbe4b7ddc1b351ef961414","idEnterprisesDeactivated":["<string>"],"idMemberReferrer":"5abbe4b7ddc1b351ef961414","idPremOrgsAdmin":["5abbe4b7ddc1b351ef961414"],"initials":"BC","memberType":"normal","nonPublic":{"fullName":"Bentley Cook","initials":"BC","avatarUrl":"https://trello-members.s3.amazonaws.com/5b02e7f4e1facdc393169f9d/db2adf80c2e6c26b76e1f10400eb4c45","avatarHash":"db2adf80c2e6c26b76e1f10400eb4c45"},"nonPublicAvailable":false,"products":[2154],"url":"https://trello.com/bentleycook","username":"bentleycook","status":"disconnected","aaEmail":"<string>","aaEnrolledDate":"<string>","aaId":"<string>","avatarSource":"gravatar","email":"bcook@atlassian.com","gravatarHash":"0a1e804f6e35a65ae5e1f7ef4c92471c","idBoards":["5abbe4b7ddc1b351ef961414"],"idOrganizations":["5abbe4b7ddc1b351ef961414"],"idEnterprisesAdmin":["5abbe4b7ddc1b351ef961414"],"limits":{"status":"ok","disableAt":36000,"warnAt":32400},"loginTypes":["password"],"marketingOptIn":{"optedIn":false,"date":"2018-04-26T17:03:25.155Z"},"messagesDismissed":{"name":"ad-security-features","count":"<string>","lastDismissed":"2019-03-11T20:19:46.809Z","_id":"5abbe4b7ddc1b351ef961414"},"oneTimeMessagesDismissed":["<string>"],"prefs":{"timezoneInfo":{"offsetCurrent":360,"timezoneCurrent":"CST","offsetNext":300,"dateNext":"2020-03-08T08:00:00.000Z","timezoneNext":"CDT"},"privacy":{"fullName":"public","avatar":"public"},"sendSummaries":true,"minutesBetweenSummaries":60,"minutesBeforeDeadlineToNotify":1440,"colorBlind":true,"locale":"en-AU","timezone":"America/Chicago","twoFactor":{"enabled":true,"needsNewBackups":false}},"trophies":["<string>"],"uploadedAvatarHash":"dac3ad49ff117829dd63a79bb2ea3426","uploadedAvatarUrl":"https://trello-avatars.s3.amazonaws.com/dac3ad49ff117829dd63a79bb2ea3426","premiumFeatures":["<string>"],"isAaMastered":false,"ixUpdate":2154,"idBoardsPinned":["5abbe4b7ddc1b351ef961414"]}
   */
  async findMemberByName(idOrganization, name) {
    const members = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ idOrganization }/members`,
      query: undefined,
      logTag: 'getOrganizationMembers',
    })

    return members.find(({ username }) => username === name)
  }

  /**
   * @description Adds a member to the board.
   *
   * @route PUT /board-member
   * @operationName Add Member to Board
   * @category Member Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Organization","name":"id","required":true,"dictionary":"getOrganizationsDictionary","description":"The ID or name of the organization."}
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getOrganizationBoardsDictionary","dependsOn":["id"],"description":"The ID of the board to update."}
   * @paramDef {"type":"String","label":"Member","name":"idMember","required":true,"dictionary":"getOrganizationMembersDictionary","dependsOn":["id"],"description":"The ID or username of the member to add to the board."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["admin","normal","observer"]}},"description":"Determines the type of member this user will be on the board."}
   * @paramDef {"type":"Boolean","label":"Allow Billable Guest","name":"allowBillableGuest","uiComponent":{"type":"TOGGLE"},"description":"Optional param that allows organization admins to add multi-board guests onto a board. Default: false."}
   *
   * @returns {BoardMembership} Returns information about the board membership.
   * @sampleResult {"members":[{"activityBlocked":false,"avatarHash":"a1b2c3d4e5f60718293a4b5c6d7e8f90","avatarUrl":"https://example.com/members/testmember.png","initials":"TM","nonPublicAvailable":true,"idMemberReferrer":"ref1234567890abcdef123456","fullName":"TestMember","id":"testmemberid000000000001","memberType":"normal","nonPublic":{},"confirmed":true,"username":"testmember"}],"id":"testboardid000000000001","memberships":[{"unconfirmed":false,"idMember":"testmemberid000000000001","orgMemberType":"normal","id":"testmembershipid000000000001","memberType":"observer","deactivated":false}]}
   */
  addMemberToBoard(id, idBoard, idMember, type, allowBillableGuest) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ idBoard }/members/${ idMember }`,
      method: 'put',
      query: { type, allowBillableGuest },
      logTag: 'addMemberToBoard',
    })
  }

  /**
   * @description Deletes member from a board.
   *
   * @route DELETE /board-member
   * @operationName Delete Member from Board
   * @category Member Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board to update."}
   * @paramDef {"type":"String","label":"Member","name":"idMember","required":true,"dictionary":"getBoardMembersDictionary","dependsOn":["idBoard"],"description":"The ID or username of the member to delete."}
   *
   * @returns {Board} Returns information about the updated board.
   * @sampleResult {"descData":null,"pinned":false,"labelNames":{"pink":"custom-label","orange_light":"","yellow":""},"shortUrl":"https://trello.com/b/testshorturl","url":"https://trello.com/b/testshorturl/flow","prefs":{"canBeEnterprise":true,"cardCounts":false,"hideVotes":false,"backgroundImage":"https://example.com/backgrounds/testphoto.jpg","voting":"disabled","showCompleteStatus":true,"hiddenPluginBoardButtons":[],"backgroundDarkImage":null,"switcherViews":[{"viewType":"Board","enabled":true},{"viewType":"Table","enabled":true}],"canBePublic":true,"canBePrivate":true,"backgroundImageScaled":[{"width":88,"url":"https://example.com/backgrounds/testphoto_88x100.webp","height":100},{"width":169,"url":"https://example.com/backgrounds/testphoto_169x192.webp","height":192}],"invitations":"members","backgroundDarkColor":null,"selfJoin":true,"backgroundBrightness":"dark","backgroundColor":null,"comments":"members","sharedSourceUrl":"https://example.com/shared/testsource.jpg","backgroundTopColor":"#6794a9","canBeOrg":true,"backgroundBottomColor":"#0d2129","calendarFeedEnabled":false,"backgroundTile":false,"permissionLevel":"org","cardAging":"regular","canInvite":true,"isTemplate":false,"background":"testbackgroundid0001","cardCovers":true},"idEnterprise":null,"members":[{"activityBlocked":false,"avatarHash":"testavatarhash0001","avatarUrl":"https://example.com/avatars/testmember.png","initials":"K","nonPublicAvailable":true,"idMemberReferrer":null,"fullName":"TestKaryna","id":"testmemberid0001","memberType":"normal","nonPublic":{},"confirmed":true,"username":"testkaryna"}],"name":"flow","idOrganization":"testorgid0001","closed":false,"id":"testboardid000000000001","desc":""}
   */
  deleteMemberFromBoard(idBoard, idMember) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/boards/${ idBoard }/members/${ idMember }`,
      method: 'delete',
      logTag: 'deleteMemberFromBoard',
    })
  }

  /**
   * @description Gets the cards a member is on.
   *
   * @route POST /get-member-cards
   * @operationName Get Member's Cards
   * @category Member Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Organization","name":"id","required":true,"dictionary":"getOrganizationsDictionary","description":"The ID or name of the organization."}
   * @paramDef {"type":"String","label":"Member","name":"idMember","required":true,"dictionary":"getOrganizationMembersDictionary","dependsOn":["id"],"description":"The ID or username of the member."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","uiComponent":{"type":"DROPDOWN","options":{"values":["all","closed","none","open","visible"]}},"description":"Filter member's cards. Default: 'visible'."}
   *
   * @returns {Card[]} Returns a list of cards the member is on.
   * @sampleResult [{"id":"5abbe4b7ddc1b351ef961414","address":"<string>","badges":{"attachmentsByType":{"trello":{"board":2154,"card":2154}},"location":true,"votes":2154,"viewingMemberVoted":false,"subscribed":false,"fogbugz":"<string>","checkItems":0,"checkItemsChecked":0,"comments":0,"attachments":0,"description":true,"due":"<string>","start":"<string>","dueComplete":true},"checkItemStates":["<string>"],"closed":true,"coordinates":"<string>","creationMethod":"<string>","dateLastActivity":"2019-09-16T16:19:17.156Z","desc":"👋Hey there,\n\nTrello's Platform team uses this board to keep developers up-to-date.","descData":{"emoji":{}},"due":"<string>","dueReminder":"<string>","idBoard":"5abbe4b7ddc1b351ef961414","idChecklists":[{"id":"5abbe4b7ddc1b351ef961414"}],"idLabels":[{"id":"5abbe4b7ddc1b351ef961414","idBoard":"5abbe4b7ddc1b351ef961414","name":"Overdue","color":"yellow"}],"idList":"5abbe4b7ddc1b351ef961414","idMembers":["5abbe4b7ddc1b351ef961414"],"idMembersVoted":["5abbe4b7ddc1b351ef961414"],"idShort":2154,"labels":["5abbe4b7ddc1b351ef961414"],"limits":{"attachments":{"perBoard":{}}},"locationName":"<string>","manualCoverAttachment":false,"name":"👋 What? Why? How?","pos":65535,"shortLink":"H0TZyzbK","shortUrl":"https://trello.com/c/H0TZyzbK","subscribed":false,"url":"https://trello.com/c/H0TZyzbK/4-%F0%9F%91%8B-what-why-how","cover":{"color":"yellow","idUploadedBackground":true,"size":"normal","brightness":"light","isTemplate":false}}]
   */
  getMemberCards(id, idMember, filter) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/members/${ idMember }/cards`,
      query: { filter },
      logTag: 'getMemberCards',
    })
  }

  /**
   * @description Gets a member's notifications.
   *
   * @route POST /get-member-notifications
   * @operationName Get Member's Notifications
   * @category Notification Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Organization","name":"id","required":true,"dictionary":"getOrganizationsDictionary","description":"The ID or name of the organization."}
   * @paramDef {"type":"String","label":"Member","name":"idMember","required":true,"dictionary":"getOrganizationMembersDictionary","dependsOn":["id"],"description":"The ID or username of the member."}
   * @paramDef {"type":"Boolean","label":"Entities","name":"entities","uiComponent":{"type":"TOGGLE"},"description":"Determines whether to include detailed data for each notification’s related entities. Default: false."}
   * @paramDef {"type":"Boolean","label":"Display","name":"display","uiComponent":{"type":"TOGGLE"},"description":"Determines whether to include preformatted display details with each notification. Default: false."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"'all' or a comma-separated list of notification types. Default: 'all'."}
   * @paramDef {"type":"String","label":"Read Filter","name":"readFilter","uiComponent":{"type":"DROPDOWN","options":{"values":["all","read","unread"]}},"description":"Filters notifications by read status. Default: 'all'."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"'all' or a comma-separated list of notification fields. Default: 'all'."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"The number of notifications to be returned. Default: 50. Maximum: 1000."}
   * @paramDef {"type":"Number","label":"Page","name":"page","description":"The page of results for notifications. Default: 0. Maximum: 100."}
   * @paramDef {"type":"String","label":"Before Notification","name":"before","dictionary":"getMemberNotificationsDictionary","dependsOn":["idMember"],"description":"A notification ID."}
   * @paramDef {"type":"String","label":"Since Notification","name":"since","dictionary":"getMemberNotificationsDictionary","dependsOn":["idMember"],"description":"A notification ID."}
   * @paramDef {"type":"Boolean","label":"Member Creator","name":"memberCreator","uiComponent":{"type":"TOGGLE"},"description":"Whether to include details about the member who created the notification. Default: true."}
   * @paramDef {"type":"String","label":"Member Creator Fields","name":"memberCreatorFields","description":"'all' or a comma-separated list of member fields. Default: 'avatarHash,fullName,initials,username'."}
   *
   * @returns {Notification[]} Returns a list of notifications for the member.
   * @sampleResult [{"id":"5dc591ac425f2a223aba0a8e","unread":true,"type":"cardDueSoon","date":"2019-11-08T16:02:52.763Z","dateRead":"<string>","data":"<string>","card":{"id":"5abbe4b7ddc1b351ef961414","address":"<string>","badges":{"attachmentsByType":{"trello":{"board":2154,"card":2154}},"location":true,"votes":2154,"viewingMemberVoted":false,"subscribed":false,"fogbugz":"<string>","checkItems":0,"checkItemsChecked":0,"comments":0,"attachments":0,"description":true,"due":"<string>","start":"<string>","dueComplete":true},"checkItemStates":["<string>"],"closed":true,"coordinates":"<string>","creationMethod":"<string>","dateLastActivity":"2019-09-16T16:19:17.156Z","desc":"👋Hey there,\n\nTrello's Platform team uses this board to keep developers up-to-date.","descData":{"emoji":{}},"due":"<string>","dueReminder":"<string>","idBoard":"5abbe4b7ddc1b351ef961414","idChecklists":[{"id":"5abbe4b7ddc1b351ef961414"}],"idLabels":[{"id":"5abbe4b7ddc1b351ef961414","idBoard":"5abbe4b7ddc1b351ef961414","name":"Overdue","color":"yellow"}],"idList":"5abbe4b7ddc1b351ef961414","idMembers":["5abbe4b7ddc1b351ef961414"],"idMembersVoted":["5abbe4b7ddc1b351ef961414"],"idShort":2154,"labels":["5abbe4b7ddc1b351ef961414"],"limits":{},"locationName":"<string>","manualCoverAttachment":false,"name":"👋 What? Why? How?","pos":65535,"shortLink":"H0TZyzbK","shortUrl":"https://trello.com/c/H0TZyzbK","subscribed":false,"url":"https://trello.com/c/H0TZyzbK/4-%F0%9F%91%8B-what-why-how","cover":{"color":"yellow","idUploadedBackground":true,"size":"normal","brightness":"light","isTemplate":false}},"board":{"id":"5abbe4b7ddc1b351ef961414","name":"Trello Platform Changes","desc":"Track changes to Trello's Platform on this board.","descData":"<string>","closed":false,"idMemberCreator":"5abbe4b7ddc1b351ef961414","idOrganization":"5abbe4b7ddc1b351ef961414","pinned":false,"url":"https://trello.com/b/dQHqCohZ/trello-platform-changelog","shortUrl":"https://trello.com/b/dQHqCohZ","prefs":{},"labelNames":{"green":"Addition","yellow":"Update","orange":"Deprecation","red":"Deletion","purple":"Power-Ups","blue":"News","sky":"Announcement","lime":"Delight","pink":"REST API","black":"Capabilties"},"limits":{},"starred":true,"memberships":"<string>","shortLink":"<string>","subscribed":true,"powerUps":"<string>","dateLastActivity":"<string>","dateLastView":"<string>","idTags":"<string>","datePluginDisable":"<string>","creationMethod":"<string>","ixUpdate":2154,"templateGallery":"<string>","enterpriseOwned":true},"idMemberCreator":"5abbe4b7ddc1b351ef961414","idAction":"5abbe4b7ddc1b351ef961414","reactions":[]}]
   */
  getMemberNotifications(
    id,
    idMember,
    entities,
    display,
    filter,
    readFilter,
    fields,
    limit,
    page,
    before,
    since,
    memberCreator,
    memberCreatorFields
  ) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/members/${ idMember }/notifications`, query: {
        entities,
        display,
        filter,
        read_filter: readFilter,
        fields,
        limit,
        page,
        before,
        since,
        memberCreator,
        memberCreator_fields: memberCreatorFields,
      }, logTag: 'getMemberNotifications',
    })
  }

  /**
   * @description Marks a notification as read.
   *
   * @route PUT /notification-as-read
   * @operationName Mark Notification as Read
   * @category Notification Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Organization","name":"id","required":true,"dictionary":"getOrganizationsDictionary","description":"The ID of the organization."}
   * @paramDef {"type":"String","label":"Member","name":"idMember","required":true,"dictionary":"getOrganizationMembersDictionary","dependsOn":["id"],"description":"The ID or username of the member."}
   * @paramDef {"type":"String","label":"Notification","name":"idNotification","required":true,"dictionary":"getMemberNotificationsDictionary","dependsOn":["idMember"],"description":"The ID of the notification."}
   *
   * @returns {Notification} Returns information about the updated notifications.
   * @sampleResult {"id":"5dc591ac425f2a223aba0a8e","unread":false,"type":"cardDueSoon","date":"2019-11-08T16:02:52.763Z","dateRead":"<string>","data":"<string>","card":{"id":"5abbe4b7ddc1b351ef961414","address":"<string>","badges":{"attachmentsByType":{"trello":{"board":2154,"card":2154}},"location":true,"votes":2154,"viewingMemberVoted":false,"subscribed":false,"fogbugz":"<string>","checkItems":0,"checkItemsChecked":0,"comments":0,"attachments":0,"description":true,"due":"<string>","start":"<string>","dueComplete":true},"checkItemStates":["<string>"],"closed":true,"coordinates":"<string>","creationMethod":"<string>","dateLastActivity":"2019-09-16T16:19:17.156Z","desc":"👋Hey there,\n\nTrello's Platform team uses this board to keep developers up-to-date.","descData":{"emoji":{}},"due":"<string>","dueReminder":"<string>","idBoard":"5abbe4b7ddc1b351ef961414","idChecklists":[{"id":"5abbe4b7ddc1b351ef961414"}],"idLabels":[{"id":"5abbe4b7ddc1b351ef961414","idBoard":"5abbe4b7ddc1b351ef961414","name":"Overdue","color":"yellow"}],"idList":"5abbe4b7ddc1b351ef961414","idMembers":["5abbe4b7ddc1b351ef961414"],"idMembersVoted":["5abbe4b7ddc1b351ef961414"],"idShort":2154,"labels":["5abbe4b7ddc1b351ef961414"],"limits":{"attachments":{"perBoard":{}}},"locationName":"<string>","manualCoverAttachment":false,"name":"👋 What? Why? How?","pos":65535,"shortLink":"H0TZyzbK","shortUrl":"https://trello.com/c/H0TZyzbK","subscribed":false,"url":"https://trello.com/c/H0TZyzbK/4-%F0%9F%91%8B-what-why-how","cover":{"color":"yellow","idUploadedBackground":true,"size":"normal","brightness":"light","isTemplate":false}},"board":{"id":"5abbe4b7ddc1b351ef961414","name":"Trello Platform Changes","desc":"Track changes to Trello's Platform on this board.","descData":"<string>","closed":false,"idMemberCreator":"5abbe4b7ddc1b351ef961414","idOrganization":"5abbe4b7ddc1b351ef961414","pinned":false,"url":"https://trello.com/b/dQHqCohZ/trello-platform-changelog","shortUrl":"https://trello.com/b/dQHqCohZ","prefs":{"permissionLevel":"org","hideVotes":true,"voting":"disabled","comments":"<string>","selfJoin":true,"cardCovers":true,"isTemplate":true,"cardAging":"pirate","calendarFeedEnabled":true,"background":"5abbe4b7ddc1b351ef961414","backgroundImage":"<string>","backgroundImageScaled":[{}],"backgroundTile":true,"backgroundBrightness":"dark","backgroundBottomColor":"#1e2e00","backgroundTopColor":"#ffffff","canBePublic":true,"canBeEnterprise":true,"canBeOrg":true,"canBePrivate":true,"canInvite":true},"labelNames":{"green":"Addition","yellow":"Update","orange":"Deprecation","red":"Deletion","purple":"Power-Ups","blue":"News","sky":"Announcement","lime":"Delight","pink":"REST API","black":"Capabilties"},"limits":{"attachments":{"perBoard":{}}},"starred":true,"memberships":"<string>","shortLink":"<string>","subscribed":true,"powerUps":"<string>","dateLastActivity":"<string>","dateLastView":"<string>","idTags":"<string>","datePluginDisable":"<string>","creationMethod":"<string>","ixUpdate":2154,"templateGallery":"<string>","enterpriseOwned":true},"idMemberCreator":"5abbe4b7ddc1b351ef961414","idAction":"5abbe4b7ddc1b351ef961414","reactions":[]}
   */
  markNotificationAsRead(id, idMember, idNotification) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/notifications/${ idNotification }`,
      method: 'put',
      query: { unread: false },
      logTag: 'markNotificationAsRead',
    })
  }

  /**
   * @description Creates a new checklist on a card.
   *
   * @route POST /card-checklist
   * @operationName Create Checklist
   * @category Checklist Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card that the checklist should be added to."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the checklist. Should be a string of length 1 to 16384. Min length: 1. Max length: 16384."}
   * @paramDef {"type":"String","label":"Position","name":"pos","description":"The position of the checklist on the card. One of: 'top', 'bottom', or a positive number."}
   * @paramDef {"type":"String","label":"Checklist Source","name":"idChecklistSource","dictionary":"getCardChecklistsDictionary","dependsOn":["idCard"],"description":"The ID of a checklist to copy into the new checklist."}
   *
   * @returns {Checklist} Returns information about a created checklist.
   * @sampleResult {"id":"test_checklist_id_001","name":"TestChecklist","idBoard":"test_board_id_001","idCard":"test_card_id_001","pos":2,"checkItems":[{"id":"test_checkitem_id_001","name":"TestCheckItem","nameData":{"emoji":{}},"pos":16384,"state":"incomplete","due":"2025-02-28T12:07:20.000Z","dueReminder":3,"idMember":null,"idChecklist":"test_checklist_id_001"}]}
   */
  createChecklist(idBoard, idList, idCard, name, pos, idChecklistSource) {
    return this.#apiRequest({
      url: '/checklists',
      method: 'post',
      query: { idCard, name, pos, idChecklistSource },
      logTag: 'createChecklist',
    })
  }

  /**
   * @description Finds a checklist by name on a card.
   *
   * @route POST /find-checklist
   * @operationName Find Checklist by Name
   * @category Checklist Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Search Checklist Name","name":"name","required":true,"description":"The name of the checklist."}
   *
   * @returns {Checklist} Returns information about the matching checklist.
   * @sampleResult {"id":"test_checklist_id_001","name":"TestChecklist","idBoard":"test_board_id_001","idCard":"test_card_id_001","pos":2,"checkItems":[{"id":"test_checkitem_id_001","name":"TestCheckItem","nameData":{"emoji":{}},"pos":16384,"state":"incomplete","due":"2025-02-28T12:07:20.000Z","dueReminder":3,"idMember":null,"idChecklist":"test_checklist_id_001"}]}
   */
  async findChecklistByName(idBoard, idList, idCard, name) {
    const checklists = await this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/checklists`,
      query: undefined,
      logTag: 'findChecklistByName',
    })

    return checklists.find(checklist => checklist.name === name)
  }

  /**
   * @description Finds a checklist by name, or creates it if it doesn't exist.
   *
   * @route POST /find-or-create-checklist
   * @operationName Find or Create Checklist
   * @category Checklist Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Search Checklist Name","name":"name","required":true,"description":"The name of the checklist."}
   *
   * @returns {Checklist} Returns information about the matching checklist, or the newly created checklist.
   * @sampleResult {"id":"test_checklist_id_001","name":"TestChecklist","idBoard":"test_board_id_001","idCard":"test_card_id_001","pos":2,"checkItems":[{"id":"test_checkitem_id_001","name":"TestCheckItem","nameData":{"emoji":{}},"pos":16384,"state":"incomplete","due":"2025-02-28T12:07:20.000Z","dueReminder":3,"idMember":null,"idChecklist":"test_checklist_id_001"}]}
   */
  async findOrCreateChecklist(idBoard, idList, idCard, name) {
    const checklists = await this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/checklists`,
      query: undefined,
      logTag: 'findOrCreateChecklist',
    })

    const foundChecklist = checklists.find(checklist => checklist.name === name)

    return foundChecklist || this.#apiRequest({
      url: '/checklists',
      method: 'post',
      query: { idCard, name },
      logTag: 'createChecklist',
    })
  }

  /**
   * @description Creates a new check item on a checklist.
   *
   * @route POST /checklist-item
   * @operationName Add Checklist Item
   * @category Checklist Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Checklist","name":"idChecklist","required":true,"dictionary":"getCardChecklistsDictionary","dependsOn":["idCard"],"description":"The ID of the checklist."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the new check item on the checklist. Should be a string of length 1 to 16384. Min length: 1. Max length: 16384."}
   * @paramDef {"type":"String","label":"Position","name":"pos","description":"The position of the checklist on the card. One of: 'top', 'bottom', or a positive number."}
   * @paramDef {"type":"Boolean","label":"Checked","name":"checked","uiComponent":{"type":"TOGGLE"},"description":"Determines whether the check item is already checked when created. Default: false."}
   * @paramDef {"type":"String","label":"Due Date","name":"due","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"A due date for the check item."}
   * @paramDef {"type":"Number","label":"Due Reminder","name":"dueReminder","description":"A dueReminder for the due date on the check item."}
   * @paramDef {"type":"String","label":"Member","name":"idMember","dictionary":"getBoardMembersDictionary","dependsOn":["idBoard"],"description":"The ID of a member resource."}
   *
   * @returns {CheckItem} Returns information about a created checklist item.
   * @sampleResult {"dueReminder":3,"pos":16384,"due":"2025-02-28T12:07:20.000Z","idMember":"testmemberid000000000001","idChecklist":"testchecklistid000000000001","name":"TestCheckItem","nameData":{"emoji":{}},"id":"testcheckitemid000000000001","state":"complete","limits":{}}
   */
  addChecklistItem(idBoard, idList, idCard, idChecklist, name, pos, checked, due, dueReminder, idMember) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/checklists/${ idChecklist }/checkItems`,
      method: 'post',
      query: { name, pos, checked, due, dueReminder, idMember },
      logTag: 'addChecklistItem',
    })
  }

  /**
   * @description Updates an item in a checklist on a card.
   *
   * @route PUT /checklist-item
   * @operationName Update Checklist Item
   * @category Checklist Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Check Item","name":"idCheckItem","required":true,"dictionary":"getCardCheckItemsDictionary","dependsOn":["idCard"],"description":"The ID of the check item."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The new name for the checklist item."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["complete","incomplete"]}},"description":"The state of the check item."}
   * @paramDef {"type":"String","label":"Checklist","name":"idChecklist","dictionary":"getCardChecklistsDictionary","dependsOn":["idCard"],"description":"The ID of the checklist this item is in."}
   * @paramDef {"type":"String","label":"Position","name":"pos","description":"The position of the check item. One of: 'top', 'bottom', or a positive float."}
   * @paramDef {"type":"String","label":"Due Date","name":"due","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"A due date for the check item."}
   * @paramDef {"type":"Number","label":"Due Reminder","name":"dueReminder","description":"A dueReminder for the due date on the check item."}
   * @paramDef {"type":"String","label":"Member","name":"idMember","dictionary":"getBoardMembersDictionary","dependsOn":["idBoard"],"description":"The ID or username of the member."}
   *
   * @returns {CheckItem} Returns information about the updated checklist item.
   * @sampleResult {"dueReminder":3,"pos":16384,"due":"2025-02-28T12:07:20.000Z","idMember":"testmemberid000000000001","idChecklist":"testchecklistid000000000001","name":"TestCheckItem","nameData":{"emoji":{}},"id":"testcheckitemid000000000001","state":"complete","limits":{}}
   */
  updateChecklistItem(idBoard, idList, idCard, idCheckItem, name, state, idChecklist, pos, due, dueReminder, idMember) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/checkItem/${ idCheckItem }`,
      method: 'put',
      query: {
        name,
        state,
        idChecklist,
        pos,
        due,
        dueReminder,
        idMember,
      },
      logTag: 'updateChecklistItem',
    })
  }

  /**
   * @description Marks a checklist item as complete on a card.
   *
   * @route PUT /complete-checklist-item
   * @operationName Mark Checklist Item as Complete
   * @category Checklist Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Check Item","name":"idCheckItem","required":true,"dictionary":"getCardCheckItemsDictionary","dependsOn":["idCard"],"description":"The ID of the check item."}
   *
   * @returns {CheckItem} Returns information about the updated checklist item.
   * @sampleResult {"dueReminder":3,"pos":16384,"due":"2025-02-28T12:07:20.000Z","idMember":"testmemberid000000000001","idChecklist":"testchecklistid000000000001","name":"TestCheckItem","nameData":{"emoji":{}},"id":"testcheckitemid000000000001","state":"complete","limits":{}}
   */
  completeCheckItem(idBoard, idList, idCard, idCheckItem) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/checkItem/${ idCheckItem }`,
      method: 'put',
      query: { state: 'complete' },
      logTag: 'completeCheckItem',
    })
  }

  /**
   * @description Finds a check item on a checklist by name.
   *
   * @route POST /find-checklist-item
   * @operationName Find Checklist Item by Name
   * @category Checklist Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Checklist","name":"idChecklist","required":true,"dictionary":"getCardChecklistsDictionary","dependsOn":["idCard"],"description":"The ID of the checklist."}
   * @paramDef {"type":"String","label":"Search Check Item Name","name":"name","required":true,"description":"The name of the check item."}
   *
   * @returns {CheckItem} Returns information about the matching checklist item.
   * @sampleResult {"dueReminder":3,"pos":16384,"due":"2025-02-28T12:07:20.000Z","idMember":"testmemberid000000000001","idChecklist":"testchecklistid000000000001","name":"TestCheckItem","nameData":{"emoji":{}},"id":"testcheckitemid000000000001","state":"complete","limits":{}}
   */
  async findChecklistItemByName(idBoard, idList, idCard, idChecklist, name) {
    const checklist = await this.#apiRequest({
      url: `${ API_BASE_URL }/checklists/${ idChecklist }`,
      query: undefined,
      logTag: 'getCardChecklistById',
    })

    return checklist.checkItems.find(item => item.name === name)
  }

  /**
   * @description Deletes a checklist item.
   *
   * @route DELETE /checklist-item
   * @operationName Delete Checklist Item
   * @category Checklist Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Board","name":"idBoard","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board."}
   * @paramDef {"type":"String","label":"List","name":"idList","required":true,"dictionary":"getBoardListsDictionary","dependsOn":["idBoard"],"description":"The ID of the list."}
   * @paramDef {"type":"String","label":"Card","name":"idCard","required":true,"dictionary":"getListCardsDictionary","dependsOn":["idList"],"description":"The ID of the card."}
   * @paramDef {"type":"String","label":"Check Item","name":"idCheckItem","required":true,"dictionary":"getCardCheckItemsDictionary","dependsOn":["idCard"],"description":"The ID of the check item."}
   */
  deleteChecklistItem(idBoard, idList, idCard, idCheckItem) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/cards/${ idCard }/checkItem/${ idCheckItem }`,
      method: 'delete',
      logTag: 'deleteCheckItem',
    })
  }

  /**
   * @description Gets an organization by its ID.
   *
   * @route POST /get-organization
   * @operationName Get Organization by ID
   * @category Organization Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Organization","name":"id","required":true,"dictionary":"getOrganizationsDictionary","description":"The ID or name of the organization."}
   *
   * @returns {Organization} Returns information about the matching organization.
   * @sampleResult {"descData":{"emoji":{}},"website":"https://example.com","displayName":"TestOrg","logoHash":"testlogohash0001","url":"https://trello.com/w/testorg","logoUrl":"https://example.com/logo.png","products":[110],"offering":"trello.business_class","name":"TestOrg","id":"testorgid000000000001","teamType":"engineering-it","desc":"Thisisatestorganizationdescription.","powerUps":[110]}
   */
  getOrganizationById(id) {
    return this.#apiRequest({ url: `${ API_BASE_URL }/organizations/${ id }`, logTag: 'getOrganizationById' })
  }

  /**
   * @description Gets a list of the boards in a Workspace.
   *
   * @route POST /get-organization-boards
   * @operationName Get Organization Boards
   * @category Organization Management
   *
   * @appearanceColor #007fc8 #b3d4ff
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Organization","name":"id","required":true,"dictionary":"getOrganizationsDictionary","description":"The ID or name of the organization."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"'all' or a comma-separated list of: 'open', 'closed', 'members', 'organization', 'public'. Default: 'all'."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"'all' or a comma-separated list of board fields. Valid values: 'id', 'name', 'desc', 'descData', 'closed', 'idMemberCreator', 'idOrganization', 'pinned', 'url', 'shortUrl', 'prefs', 'labelNames', 'starred', 'limits', 'memberships', 'enterpriseOwned'."}
   *
   * @returns {Board[]} Returns a list of the boards in the organization.
   * @sampleResult [{"id":"5abbe4b7ddc1b351ef961414","name":"TrelloPlatformChanges","desc":"TrackchangestoTrello'sPlatformonthisboard.","descData":"<string>","closed":false,"idMemberCreator":"5abbe4b7ddc1b351ef961414","idOrganization":"5abbe4b7ddc1b351ef961414","pinned":false,"url":"https://trello.com/b/dQHqCohZ/trello-platform-changelog","shortUrl":"https://trello.com/b/dQHqCohZ","prefs":{"permissionLevel":"org","hideVotes":true,"voting":"disabled","comments":"<string>","selfJoin":true,"cardCovers":true,"isTemplate":true,"cardAging":"pirate","calendarFeedEnabled":true,"background":"5abbe4b7ddc1b351ef961414","backgroundImage":"<string>","backgroundImageScaled":[{"width":100,"height":64,"url":"https://trello-backgrounds.s3.amazonaws.com/SharedBackground/100x64/abc/photo-123.jpg"}],"backgroundTile":true,"backgroundBrightness":"dark","backgroundBottomColor":"#1e2e00","backgroundTopColor":"#ffffff","canBePublic":true,"canBeEnterprise":true,"canBeOrg":true,"canBePrivate":true,"canInvite":true},"labelNames":{"green":"Addition","yellow":"Update","orange":"Deprecation","red":"Deletion","purple":"Power-Ups","blue":"News","sky":"Announcement","lime":"Delight","pink":"RESTAPI","black":"Capabilties"},"limits":{"attachments":{"perBoard":{"status":"ok","disableAt":36000,"warnAt":32400}}},"starred":true,"memberships":"<string>","shortLink":"<string>","subscribed":true,"powerUps":"<string>","dateLastActivity":"<string>","dateLastView":"<string>","idTags":"<string>","datePluginDisable":"<string>","creationMethod":"<string>","ixUpdate":2154,"templateGallery":"<string>","enterpriseOwned":true}]
   */
  getOrganizationBoards(id, filter, fields) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ id }/boards`,
      query: { filter, fields },
      logTag: 'getOrganizationBoards',
    })
  }
}

Flowrunner.ServerCode.addService(Trello, [
  {
    order: 0,
    displayName: 'Trello API Key',
    name: 'apiKey',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your Trello API key',
  },
  {
    order: 1,
    displayName: 'Trello Access Token',
    name: 'token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your Trello Access Token',
  },
])
