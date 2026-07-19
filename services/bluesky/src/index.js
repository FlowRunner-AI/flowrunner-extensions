const logger = {
  info: (...args) => console.log('[Bluesky] info:', ...args),
  debug: (...args) => console.log('[Bluesky] debug:', ...args),
  error: (...args) => console.log('[Bluesky] error:', ...args),
  warn: (...args) => console.log('[Bluesky] warn:', ...args),
}

const DEFAULT_PDS_URL = 'https://bsky.social'

const POST_COLLECTION = 'app.bsky.feed.post'
const MAX_POST_GRAPHEMES = 300
const MAX_IMAGE_BYTES = 1000000
const MAX_BATCH_URIS = 25
const MAX_BATCH_ACTORS = 25

// TLD allowlist used ONLY for scheme-less link detection (e.g. "example.com/page").
// URLs with an explicit http(s):// scheme are always linked regardless of TLD.
const BARE_DOMAIN_TLDS = new Set([
  'com', 'org', 'net', 'edu', 'gov', 'mil', 'int', 'app', 'dev', 'io', 'ai', 'co', 'me', 'us', 'uk',
  'ca', 'de', 'fr', 'es', 'it', 'nl', 'se', 'no', 'fi', 'dk', 'ie', 'pt', 'pl', 'cz', 'ch', 'at',
  'be', 'gr', 'ru', 'ua', 'jp', 'cn', 'kr', 'in', 'sg', 'hk', 'tw', 'br', 'mx', 'ar', 'cl', 'au',
  'nz', 'za', 'social', 'xyz', 'info', 'biz', 'tv', 'cc', 'ly', 'sh', 'gg', 'fm', 'to', 'art',
  'blog', 'cloud', 'live', 'news', 'online', 'site', 'store', 'tech', 'website', 'wiki', 'world',
  'zone', 'bio', 'chat', 'club', 'design', 'digital', 'email', 'fyi', 'games', 'guide', 'host',
  'lol', 'media', 'network', 'one', 'page', 'pro', 'run', 'shop', 'space', 'studio', 'team',
  'today', 'tools', 'top', 'video', 'vip', 'wtf',
])

const IMAGE_MIME_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
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
 * @usesFileStorage
 * @integrationName Bluesky
 * @integrationIcon /icon.svg
 */
class BlueskyService {
  constructor(config) {
    this.identifier = config.identifier
    this.appPassword = config.appPassword
    this.pdsUrl = String(config.pdsUrl || DEFAULT_PDS_URL).replace(/\/+$/, '')
  }

  // ==========================================================================
  // Session & request plumbing
  // ==========================================================================

  // Creates (and caches per invocation) an AT Protocol session via
  // com.atproto.server.createSession. Note: this endpoint is rate-limited
  // (~30 sessions per 5 minutes per account).
  async #getSession() {
    if (this._session) {
      return this._session
    }

    try {
      logger.debug('creating session at', this.pdsUrl)

      const response = await Flowrunner.Request.post(`${ this.pdsUrl }/xrpc/com.atproto.server.createSession`)
        .set({ 'Content-Type': 'application/json' })
        .send({ identifier: this.identifier, password: this.appPassword })

      this._session = {
        accessJwt: response.accessJwt,
        did: response.did,
        handle: response.handle,
      }

      return this._session
    } catch (error) {
      const message = error.body?.message || error.body?.error || error.message

      logger.error(`createSession failed: ${ message }`)

      if (error.status === 401 || /invalid identifier or password/i.test(String(message))) {
        throw new Error(
          `Bluesky sign-in failed: ${ message }. ` +
          'Make sure the App Password config item contains an App Password created in ' +
          'Settings -> Privacy and Security -> App Passwords, NOT your main account password, ' +
          'and that the identifier is your full handle (e.g. alice.bsky.social) or account email.'
        )
      }

      throw new Error(`Bluesky API error: ${ message }`)
    }
  }

  // Single gateway for all XRPC calls. `nsid` is the XRPC method id, e.g.
  // "app.bsky.feed.getTimeline". Use `rawQuery` for repeated query params
  // (uris=..&uris=..), `headers` to override Content-Type (blob uploads).
  async #apiRequest({ nsid, method = 'get', body, query, rawQuery, headers, logTag }) {
    const session = await this.#getSession()
    const url = `${ this.pdsUrl }/xrpc/${ nsid }${ rawQuery ? `?${ rawQuery }` : '' }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ nsid }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ session.accessJwt }`,
          'Content-Type': 'application/json',
          ...(headers || {}),
        })
        .query(clean(query) || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.message || error.body?.error || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Bluesky API error: ${ message }`)
    }
  }

  // ==========================================================================
  // Identity & post-reference helpers
  // ==========================================================================

  // Resolves a handle (with or without leading @) or passes a DID through.
  async #resolveDid(actor, logTag) {
    const value = String(actor || '').trim().replace(/^@/, '')

    if (!value) {
      throw new Error('An actor (handle or DID) is required.')
    }

    if (value.startsWith('did:')) {
      return value
    }

    const response = await this.#apiRequest({
      logTag,
      nsid: 'com.atproto.identity.resolveHandle',
      query: { handle: value },
    })

    return response.did
  }

  async #tryResolveDid(handle) {
    try {
      return await this.#resolveDid(handle, '[detectFacets]')
    } catch (error) {
      logger.debug(`facet mention skipped, cannot resolve @${ handle }: ${ error.message }`)

      return null
    }
  }

  // Accepts an at:// URI or a https://bsky.app/profile/{actor}/post/{rkey} URL
  // and returns the canonical at:// URI.
  async #parsePostRef(postRef, logTag) {
    const ref = String(postRef || '').trim()

    if (!ref) {
      throw new Error('A post reference is required.')
    }

    if (ref.startsWith('at://')) {
      return ref
    }

    const match = ref.match(/^https?:\/\/bsky\.app\/profile\/([^/]+)\/post\/([^/?#]+)/i)

    if (match) {
      const [, actor, rkey] = match
      const did = await this.#resolveDid(actor, logTag)

      return `at://${ did }/${ POST_COLLECTION }/${ rkey }`
    }

    throw new Error(
      `Unrecognized post reference "${ postRef }". ` +
      'Provide an at:// URI (at://did:plc:xxx/app.bsky.feed.post/rkey) or a https://bsky.app post URL.'
    )
  }

  #rkeyFromUri(uri) {
    return String(uri).split('/').pop()
  }

  // Fetches the {uri, cid} strong ref required by likes, reposts and quotes.
  async #getSubjectRef(postRef, logTag) {
    const uri = await this.#parsePostRef(postRef, logTag)

    const response = await this.#apiRequest({
      logTag,
      nsid: 'app.bsky.feed.getPosts',
      rawQuery: `uris=${ encodeURIComponent(uri) }`,
    })

    const post = response.posts && response.posts[0]

    if (!post) {
      throw new Error(`Post not found: ${ uri }. It may have been deleted or is not visible to this account.`)
    }

    return { uri: post.uri, cid: post.cid }
  }

  // ==========================================================================
  // Rich text facets (Bluesky does NOT auto-link text)
  // ==========================================================================

  #graphemeLength(text) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return [...new Intl.Segmenter().segment(text)].length
    }

    return Array.from(text).length
  }

  #byteIndexOf(text, charIndex) {
    return Buffer.byteLength(text.slice(0, charIndex), 'utf8')
  }

  // Detects links, @mentions and #hashtags and returns app.bsky.richtext.facet
  // entries with UTF-8 BYTE offsets (the AT Protocol requirement — character
  // offsets would corrupt facets for any non-ASCII text).
  async #detectFacets(text) {
    const facets = []

    // --- links: explicit http(s) URLs and bare domains like example.com/page
    const urlRegex = /(^|\s|\()((https?:\/\/\S+)|((?<domain>[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+)\S*))/gim
    let match

    while ((match = urlRegex.exec(text)) !== null) {
      let raw = match[2]
      const hasScheme = /^https?:\/\//i.test(raw)

      if (!hasScheme) {
        const domain = match.groups.domain || ''
        const tld = domain.split('.').pop().toLowerCase()

        if (!BARE_DOMAIN_TLDS.has(tld)) {
          continue
        }
      }

      // Trim trailing punctuation; keep a closing ")" only when balanced by a "(".
      while (/[.,;:!?'"”’)\]]$/.test(raw)) {
        if (raw.endsWith(')') && raw.includes('(')) {
          break
        }

        raw = raw.slice(0, -1)
      }

      if (!raw) {
        continue
      }

      const start = match.index + match[1].length
      const end = start + raw.length

      facets.push({
        index: { byteStart: this.#byteIndexOf(text, start), byteEnd: this.#byteIndexOf(text, end) },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: hasScheme ? raw : `https://${ raw }` }],
      })
    }

    // --- mentions: @handle.domain, resolved to DIDs (unresolvable handles are skipped)
    const mentionRegex = /(^|\s|\()(@)([a-zA-Z0-9.-]+)(\b)/g

    while ((match = mentionRegex.exec(text)) !== null) {
      const handle = match[3].replace(/\.+$/, '')

      if (!handle.includes('.')) {
        continue
      }

      const did = await this.#tryResolveDid(handle)

      if (!did) {
        continue
      }

      const start = match.index + match[1].length
      const end = start + 1 + handle.length

      facets.push({
        index: { byteStart: this.#byteIndexOf(text, start), byteEnd: this.#byteIndexOf(text, end) },
        features: [{ $type: 'app.bsky.richtext.facet#mention', did }],
      })
    }

    // --- hashtags: #tag (not all-digits, max 64 chars, trailing punctuation trimmed)
    const tagRegex = /(^|\s)#([^\s\u00AD\u2060\u200A\u200B\u200C\u200D]+)/gu

    while ((match = tagRegex.exec(text)) !== null) {
      const tag = match[2].replace(/\p{P}+$/gu, '')

      if (!tag || tag.length > 64 || /^\d+$/.test(tag)) {
        continue
      }

      const start = match.index + match[1].length
      const end = start + 1 + tag.length

      facets.push({
        index: { byteStart: this.#byteIndexOf(text, start), byteEnd: this.#byteIndexOf(text, end) },
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag }],
      })
    }

    return facets.sort((a, b) => a.index.byteStart - b.index.byteStart)
  }

  // ==========================================================================
  // Post creation core
  // ==========================================================================

  async #createPostRecord({ text, languages, embed, reply, disableFacets, logTag }) {
    if (!text || !String(text).trim()) {
      throw new Error('Post text is required.')
    }

    if (this.#graphemeLength(text) > MAX_POST_GRAPHEMES) {
      throw new Error(
        `Post text is ${ this.#graphemeLength(text) } characters; the Bluesky limit is ${ MAX_POST_GRAPHEMES }.`
      )
    }

    const session = await this.#getSession()

    const record = {
      $type: POST_COLLECTION,
      text,
      createdAt: new Date().toISOString(),
    }

    if (!disableFacets) {
      const facets = await this.#detectFacets(text)

      if (facets.length) {
        record.facets = facets
      }
    }

    if (Array.isArray(languages) && languages.length) {
      record.langs = languages
    }

    if (embed) {
      record.embed = embed
    }

    if (reply) {
      record.reply = reply
    }

    const response = await this.#apiRequest({
      logTag,
      nsid: 'com.atproto.repo.createRecord',
      method: 'post',
      body: { repo: session.did, collection: POST_COLLECTION, record },
    })

    return {
      ...response,
      webUrl: `https://bsky.app/profile/${ session.handle }/post/${ this.#rkeyFromUri(response.uri) }`,
    }
  }

  #imageMimeType(fileUrl) {
    const ext = String(fileUrl).split('?')[0].split('#')[0].split('.').pop().toLowerCase()

    return IMAGE_MIME_TYPES[ext] || 'image/jpeg'
  }

  // ==========================================================================
  // Posting
  // ==========================================================================

  /**
   * @operationName Create Post
   * @category Posting
   * @description Publishes a text post (skeet) to Bluesky, up to 300 characters. Links (https://... and bare domains like example.com), @mentions and #hashtags in the text are automatically converted to rich-text facets so they render as clickable — Bluesky does not auto-link plain text. Optionally attaches an external link preview card and sets the post language(s). Returns the record's at:// URI, CID and a bsky.app web URL.
   * @route POST /post
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Post text, up to 300 characters. URLs, @handles and #hashtags become clickable automatically unless Disable Auto-Formatting is on."}
   * @paramDef {"type":"Array<String>","label":"Languages","name":"languages","description":"Optional BCP-47 language codes for the post, e.g. [\"en\"] or [\"en\",\"es\"]. Helps feeds and translation features."}
   * @paramDef {"type":"String","label":"Link Card URL","name":"linkCardUrl","description":"Optional URL to attach as an external link preview card (app.bsky.embed.external) below the post."}
   * @paramDef {"type":"String","label":"Link Card Title","name":"linkCardTitle","description":"Title shown on the link preview card. Defaults to the Link Card URL when empty."}
   * @paramDef {"type":"String","label":"Link Card Description","name":"linkCardDescription","description":"Description text shown on the link preview card."}
   * @paramDef {"type":"Boolean","label":"Disable Auto-Formatting","name":"disableFacets","uiComponent":{"type":"TOGGLE"},"description":"When on, the text is posted as-is with no rich-text facets: links, mentions and hashtags stay plain text."}
   *
   * @returns {Object}
   * @sampleResult {"uri":"at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3kenlltlvus2u","cid":"bafyreidfayvfuwqa2qskciwocboesuwsvvi5vgzqxjkcwon5h6trxrxlxq","commit":{"cid":"bafyreib2rxk3rw6fgq3f2evb6vhf3ghyz5rxu4b7y7jmtpyd2rmnqre2xa","rev":"3kenlltm2ns2u"},"validationStatus":"valid","webUrl":"https://bsky.app/profile/alice.bsky.social/post/3kenlltlvus2u"}
   */
  async createPost(text, languages, linkCardUrl, linkCardTitle, linkCardDescription, disableFacets) {
    const logTag = '[createPost]'
    let embed

    if (linkCardUrl) {
      embed = {
        $type: 'app.bsky.embed.external',
        external: {
          uri: linkCardUrl,
          title: linkCardTitle || linkCardUrl,
          description: linkCardDescription || '',
        },
      }
    }

    return await this.#createPostRecord({ text, languages, embed, disableFacets, logTag })
  }

  /**
   * @operationName Create Post with Image
   * @category Posting
   * @description Publishes a post with one attached image. The image is read from FlowRunner file storage, uploaded to Bluesky as a blob (com.atproto.repo.uploadBlob) and embedded via app.bsky.embed.images. Bluesky accepts PNG, JPEG, WebP, GIF and AVIF up to 1 MB per image; Bluesky posts support up to 4 images, this action attaches one. Text links, @mentions and #hashtags are auto-formatted like in Create Post.
   * @route POST /post-with-image
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Post text, up to 300 characters."}
   * @paramDef {"type":"String","label":"Image File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"FlowRunner file to attach (PNG, JPEG, WebP, GIF or AVIF, max 1 MB)."}
   * @paramDef {"type":"String","label":"Alt Text","name":"altText","description":"Accessibility description of the image, shown to screen readers and when the image cannot load. Strongly recommended."}
   * @paramDef {"type":"Array<String>","label":"Languages","name":"languages","description":"Optional BCP-47 language codes for the post, e.g. [\"en\"]."}
   * @paramDef {"type":"Boolean","label":"Disable Auto-Formatting","name":"disableFacets","uiComponent":{"type":"TOGGLE"},"description":"When on, the text is posted as-is with no rich-text facets."}
   *
   * @returns {Object}
   * @sampleResult {"uri":"at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3kenlmt4ax52u","cid":"bafyreig7ox2f5rrl3c4jyyjmcgsx4mkdi2nyqvvzcdjkeuxjcv7f7l2aida","validationStatus":"valid","webUrl":"https://bsky.app/profile/alice.bsky.social/post/3kenlmt4ax52u"}
   */
  async createPostWithImage(text, fileUrl, altText, languages, disableFacets) {
    const logTag = '[createPostWithImage]'

    if (!fileUrl) {
      throw new Error('An image file is required.')
    }

    const bytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)

    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new Error(
        `Image is ${ buffer.length } bytes; Bluesky allows at most ${ MAX_IMAGE_BYTES } bytes (1 MB) per image. ` +
        'Resize or compress the image and try again.'
      )
    }

    const mimeType = this.#imageMimeType(fileUrl)

    logger.debug(`${ logTag } - uploading ${ buffer.length } bytes as ${ mimeType }`)

    const uploadResponse = await this.#apiRequest({
      logTag,
      nsid: 'com.atproto.repo.uploadBlob',
      method: 'post',
      headers: { 'Content-Type': mimeType },
      body: buffer,
    })

    const embed = {
      $type: 'app.bsky.embed.images',
      images: [{ image: uploadResponse.blob, alt: altText || '' }],
    }

    return await this.#createPostRecord({ text, languages, embed, disableFacets, logTag })
  }

  /**
   * @operationName Reply to Post
   * @category Posting
   * @description Posts a reply to an existing Bluesky post. Accepts the parent post as an at:// URI or a regular bsky.app post URL; the thread root is resolved automatically so the reply lands in the correct thread. Links, @mentions and #hashtags in the reply text are auto-formatted.
   * @route POST /reply
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"Parent Post","name":"postRef","required":true,"description":"Post to reply to: an at:// URI (at://did:plc:xxx/app.bsky.feed.post/rkey) or a bsky.app URL (https://bsky.app/profile/handle/post/rkey)."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Reply text, up to 300 characters."}
   * @paramDef {"type":"Array<String>","label":"Languages","name":"languages","description":"Optional BCP-47 language codes for the reply, e.g. [\"en\"]."}
   * @paramDef {"type":"Boolean","label":"Disable Auto-Formatting","name":"disableFacets","uiComponent":{"type":"TOGGLE"},"description":"When on, the text is posted as-is with no rich-text facets."}
   *
   * @returns {Object}
   * @sampleResult {"uri":"at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3kenlnnkzhc2u","cid":"bafyreicidr4i6nbhzuqcy7c3lmglrctmqcgqxr6vgeqyoyfj3azp2xemxa","validationStatus":"valid","webUrl":"https://bsky.app/profile/alice.bsky.social/post/3kenlnnkzhc2u"}
   */
  async replyToPost(postRef, text, languages, disableFacets) {
    const logTag = '[replyToPost]'
    const parentUri = await this.#parsePostRef(postRef, logTag)

    const threadResponse = await this.#apiRequest({
      logTag,
      nsid: 'app.bsky.feed.getPostThread',
      query: { uri: parentUri, depth: 0, parentHeight: 0 },
    })

    const parentPost = threadResponse.thread && threadResponse.thread.post

    if (!parentPost) {
      throw new Error(`Parent post not found: ${ parentUri }. It may have been deleted or blocked.`)
    }

    const parent = { uri: parentPost.uri, cid: parentPost.cid }
    const rootRef = parentPost.record && parentPost.record.reply && parentPost.record.reply.root
    const root = rootRef ? { uri: rootRef.uri, cid: rootRef.cid } : parent

    return await this.#createPostRecord({ text, languages, reply: { root, parent }, disableFacets, logTag })
  }

  /**
   * @operationName Quote Post
   * @category Posting
   * @description Publishes a new post that quotes an existing post (app.bsky.embed.record). The quoted post is shown as an embedded card below your commentary text. Accepts the quoted post as an at:// URI or a bsky.app URL. Links, @mentions and #hashtags in the text are auto-formatted.
   * @route POST /quote
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"Quoted Post","name":"postRef","required":true,"description":"Post to quote: an at:// URI or a bsky.app URL (https://bsky.app/profile/handle/post/rkey)."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Your commentary text shown above the quoted post, up to 300 characters."}
   * @paramDef {"type":"Array<String>","label":"Languages","name":"languages","description":"Optional BCP-47 language codes for the post, e.g. [\"en\"]."}
   * @paramDef {"type":"Boolean","label":"Disable Auto-Formatting","name":"disableFacets","uiComponent":{"type":"TOGGLE"},"description":"When on, the text is posted as-is with no rich-text facets."}
   *
   * @returns {Object}
   * @sampleResult {"uri":"at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3kenlp5d7t42u","cid":"bafyreiaz3dmuyd6kfoqmpmrgvvcnrjza3rbcp3pxjcgtmyilaeh43rrzli","validationStatus":"valid","webUrl":"https://bsky.app/profile/alice.bsky.social/post/3kenlp5d7t42u"}
   */
  async quotePost(postRef, text, languages, disableFacets) {
    const logTag = '[quotePost]'
    const subject = await this.#getSubjectRef(postRef, logTag)

    const embed = {
      $type: 'app.bsky.embed.record',
      record: subject,
    }

    return await this.#createPostRecord({ text, languages, embed, disableFacets, logTag })
  }

  /**
   * @operationName Repost
   * @category Posting
   * @description Reposts an existing post to your followers (app.bsky.feed.repost). Accepts the post as an at:// URI or a bsky.app URL; the post's CID is resolved automatically. Returns the repost record's at:// URI and CID.
   * @route POST /repost
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"Post","name":"postRef","required":true,"description":"Post to repost: an at:// URI or a bsky.app URL (https://bsky.app/profile/handle/post/rkey)."}
   *
   * @returns {Object}
   * @sampleResult {"uri":"at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.repost/3kenlqb2rhk2u","cid":"bafyreie5lqk4dsvyz6xkeqbrsfvahvijdlrxpylxwyxbmr34kkrqlqvmwe","validationStatus":"valid","subject":{"uri":"at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3kencmjqk7k2q","cid":"bafyreih5cmnnk73i6yyvhr2rfsyameozjmck2xir4jqmqvctcuh5emjdiq"}}
   */
  async repost(postRef) {
    const logTag = '[repost]'
    const subject = await this.#getSubjectRef(postRef, logTag)
    const session = await this.#getSession()

    const response = await this.#apiRequest({
      logTag,
      nsid: 'com.atproto.repo.createRecord',
      method: 'post',
      body: {
        repo: session.did,
        collection: 'app.bsky.feed.repost',
        record: { $type: 'app.bsky.feed.repost', subject, createdAt: new Date().toISOString() },
      },
    })

    return { ...response, subject }
  }

  /**
   * @operationName Like Post
   * @category Posting
   * @description Likes an existing post (app.bsky.feed.like). Accepts the post as an at:// URI or a bsky.app URL; the post's CID is resolved automatically. Returns the like record's at:// URI and CID. Note: removing a like is not supported by this integration because it requires the like record's own key.
   * @route POST /like
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"Post","name":"postRef","required":true,"description":"Post to like: an at:// URI or a bsky.app URL (https://bsky.app/profile/handle/post/rkey)."}
   *
   * @returns {Object}
   * @sampleResult {"uri":"at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.like/3kenlr6mzn42u","cid":"bafyreibkkkfrmnjkfhka3dhkbforgpvkwxjkhbnjfrqzs7rzcvpazhulcm","validationStatus":"valid","subject":{"uri":"at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3kencmjqk7k2q","cid":"bafyreih5cmnnk73i6yyvhr2rfsyameozjmck2xir4jqmqvctcuh5emjdiq"}}
   */
  async likePost(postRef) {
    const logTag = '[likePost]'
    const subject = await this.#getSubjectRef(postRef, logTag)
    const session = await this.#getSession()

    const response = await this.#apiRequest({
      logTag,
      nsid: 'com.atproto.repo.createRecord',
      method: 'post',
      body: {
        repo: session.did,
        collection: 'app.bsky.feed.like',
        record: { $type: 'app.bsky.feed.like', subject, createdAt: new Date().toISOString() },
      },
    })

    return { ...response, subject }
  }

  /**
   * @operationName Delete Post
   * @category Posting
   * @description Deletes one of the connected account's own posts (com.atproto.repo.deleteRecord). Accepts the post as an at:// URI or a bsky.app URL. Only posts created by the connected account can be deleted.
   * @route DELETE /post
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"Post","name":"postRef","required":true,"description":"Post to delete: an at:// URI or a bsky.app URL (https://bsky.app/profile/handle/post/rkey). Must belong to the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"uri":"at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3kenlltlvus2u"}
   */
  async deletePost(postRef) {
    const logTag = '[deletePost]'
    const uri = await this.#parsePostRef(postRef, logTag)
    const session = await this.#getSession()

    await this.#apiRequest({
      logTag,
      nsid: 'com.atproto.repo.deleteRecord',
      method: 'post',
      body: {
        repo: session.did,
        collection: POST_COLLECTION,
        rkey: this.#rkeyFromUri(uri),
      },
    })

    return { success: true, uri }
  }

  // ==========================================================================
  // Feeds & Search
  // ==========================================================================

  /**
   * @operationName Get Timeline
   * @category Feeds & Search
   * @description Retrieves the connected account's home timeline (the "Following" feed) with full post views: author, text, embeds, like/repost/reply counts. Paginate with the returned cursor.
   * @route GET /timeline
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of feed items to return (1-100). Defaults to 50."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"cursor":"2026-07-15T09:41:22Z","feed":[{"post":{"uri":"at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3kencmjqk7k2q","cid":"bafyreih5cmnnk73i6yyvhr2rfsyameozjmck2xir4jqmqvctcuh5emjdiq","author":{"did":"did:plc:z72i7hdynmk6r22z27h6tvur","handle":"bsky.app","displayName":"Bluesky"},"record":{"$type":"app.bsky.feed.post","text":"Hello from Bluesky!","createdAt":"2026-07-15T09:40:00Z"},"replyCount":3,"repostCount":12,"likeCount":87,"indexedAt":"2026-07-15T09:40:01Z"}}]}
   */
  async getTimeline(limit, cursor) {
    const logTag = '[getTimeline]'

    return await this.#apiRequest({
      logTag,
      nsid: 'app.bsky.feed.getTimeline',
      query: { limit: limit || 50, cursor },
    })
  }

  /**
   * @operationName Get Author Feed
   * @category Feeds & Search
   * @description Retrieves posts authored by a specific user (their profile feed), with filtering: all posts with replies, top-level posts only, media posts only, or posts plus own-thread replies. Paginate with the returned cursor.
   * @route GET /author-feed
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"Author","name":"actor","required":true,"description":"Handle (e.g. alice.bsky.social) or DID of the author."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","defaultValue":"Posts With Replies","uiComponent":{"type":"DROPDOWN","options":{"values":["Posts With Replies","Posts No Replies","Posts With Media","Posts And Author Threads"]}},"description":"Which posts to include. Defaults to Posts With Replies."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of feed items to return (1-100). Defaults to 50."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"cursor":"2026-07-10T18:03:11Z","feed":[{"post":{"uri":"at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3kenh7wkbys2u","cid":"bafyreif3pcuhcyfqhhkmvyeieqjwqagd4kbkrkw6vfpxrrjcvpajmwjhwm","author":{"did":"did:plc:ewvi7nxzyoun6zhxrhs64oiz","handle":"alice.bsky.social","displayName":"Alice"},"record":{"$type":"app.bsky.feed.post","text":"Shipping day!","createdAt":"2026-07-10T18:00:00Z"},"replyCount":1,"repostCount":4,"likeCount":29,"indexedAt":"2026-07-10T18:00:02Z"}}]}
   */
  async getAuthorFeed(actor, filter, limit, cursor) {
    const logTag = '[getAuthorFeed]'

    return await this.#apiRequest({
      logTag,
      nsid: 'app.bsky.feed.getAuthorFeed',
      query: {
        actor: String(actor || '').trim().replace(/^@/, ''),
        filter: this.#resolveChoice(filter, {
          'Posts With Replies': 'posts_with_replies',
          'Posts No Replies': 'posts_no_replies',
          'Posts With Media': 'posts_with_media',
          'Posts And Author Threads': 'posts_and_author_threads',
        }),
        limit: limit || 50,
        cursor,
      },
    })
  }

  /**
   * @operationName Get Post Thread
   * @category Feeds & Search
   * @description Retrieves a full conversation thread around a post: the post itself, its parent chain and nested replies. Accepts the post as an at:// URI or a bsky.app URL. Control how many reply levels (depth) and parent levels (parent height) are included.
   * @route GET /post-thread
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"Post","name":"postRef","required":true,"description":"Thread anchor post: an at:// URI or a bsky.app URL (https://bsky.app/profile/handle/post/rkey)."}
   * @paramDef {"type":"Number","label":"Reply Depth","name":"depth","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many levels of nested replies to include (0-1000). Defaults to 6."}
   * @paramDef {"type":"Number","label":"Parent Height","name":"parentHeight","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many parent posts up the chain to include (0-1000). Defaults to 80."}
   *
   * @returns {Object}
   * @sampleResult {"thread":{"$type":"app.bsky.feed.defs#threadViewPost","post":{"uri":"at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3kencmjqk7k2q","cid":"bafyreih5cmnnk73i6yyvhr2rfsyameozjmck2xir4jqmqvctcuh5emjdiq","author":{"did":"did:plc:z72i7hdynmk6r22z27h6tvur","handle":"bsky.app","displayName":"Bluesky"},"record":{"$type":"app.bsky.feed.post","text":"Hello from Bluesky!","createdAt":"2026-07-15T09:40:00Z"},"replyCount":2,"repostCount":12,"likeCount":87,"indexedAt":"2026-07-15T09:40:01Z"},"replies":[{"$type":"app.bsky.feed.defs#threadViewPost","post":{"uri":"at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3kenlnnkzhc2u","cid":"bafyreicidr4i6nbhzuqcy7c3lmglrctmqcgqxr6vgeqyoyfj3azp2xemxa","author":{"did":"did:plc:ewvi7nxzyoun6zhxrhs64oiz","handle":"alice.bsky.social"},"record":{"$type":"app.bsky.feed.post","text":"Congrats!","createdAt":"2026-07-15T09:45:00Z"},"likeCount":3,"indexedAt":"2026-07-15T09:45:01Z"}}]}}
   */
  async getPostThread(postRef, depth, parentHeight) {
    const logTag = '[getPostThread]'
    const uri = await this.#parsePostRef(postRef, logTag)

    return await this.#apiRequest({
      logTag,
      nsid: 'app.bsky.feed.getPostThread',
      query: {
        uri,
        depth: depth !== undefined && depth !== null ? depth : undefined,
        parentHeight: parentHeight !== undefined && parentHeight !== null ? parentHeight : undefined,
      },
    })
  }

  /**
   * @operationName Get Posts
   * @category Feeds & Search
   * @description Retrieves full post views (hydrated with author, counts and embeds) for up to 25 posts at once. Each entry can be an at:// URI or a bsky.app URL. Useful for resolving CIDs and checking engagement of known posts.
   * @route GET /posts
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"Array<String>","label":"Posts","name":"postRefs","required":true,"description":"Up to 25 post references: at:// URIs or bsky.app URLs (https://bsky.app/profile/handle/post/rkey)."}
   *
   * @returns {Object}
   * @sampleResult {"posts":[{"uri":"at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3kencmjqk7k2q","cid":"bafyreih5cmnnk73i6yyvhr2rfsyameozjmck2xir4jqmqvctcuh5emjdiq","author":{"did":"did:plc:z72i7hdynmk6r22z27h6tvur","handle":"bsky.app","displayName":"Bluesky"},"record":{"$type":"app.bsky.feed.post","text":"Hello from Bluesky!","createdAt":"2026-07-15T09:40:00Z"},"replyCount":3,"repostCount":12,"likeCount":87,"quoteCount":2,"indexedAt":"2026-07-15T09:40:01Z"}]}
   */
  async getPosts(postRefs) {
    const logTag = '[getPosts]'

    if (!Array.isArray(postRefs) || !postRefs.length) {
      throw new Error('At least one post reference is required.')
    }

    if (postRefs.length > MAX_BATCH_URIS) {
      throw new Error(`Get Posts accepts at most ${ MAX_BATCH_URIS } posts per call; got ${ postRefs.length }.`)
    }

    const uris = []

    for (const ref of postRefs) {
      uris.push(await this.#parsePostRef(ref, logTag))
    }

    return await this.#apiRequest({
      logTag,
      nsid: 'app.bsky.feed.getPosts',
      rawQuery: uris.map(uri => `uris=${ encodeURIComponent(uri) }`).join('&'),
    })
  }

  /**
   * @operationName Search Posts
   * @category Feeds & Search
   * @description Searches all of Bluesky for posts matching a query string, with optional filters: author, language, and date range. Sort by relevance (Top) or recency (Latest). Returns full post views; paginate with the returned cursor. Total hit count may be approximate.
   * @route GET /search-posts
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Search query string. Supports quoted phrases, from:handle, and hashtag terms."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","defaultValue":"Latest","uiComponent":{"type":"DROPDOWN","options":{"values":["Top","Latest"]}},"description":"Result ranking: Top (relevance) or Latest (most recent first). Defaults to Latest."}
   * @paramDef {"type":"String","label":"Since","name":"since","description":"Only posts on/after this date, ISO format: 2026-07-01 or 2026-07-01T00:00:00Z. Based on the post's sort timestamp."}
   * @paramDef {"type":"String","label":"Until","name":"until","description":"Only posts before this date (exclusive), ISO format: 2026-07-15 or 2026-07-15T00:00:00Z."}
   * @paramDef {"type":"String","label":"Author","name":"author","description":"Restrict results to posts by this handle or DID."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Restrict results to posts in this BCP-47 language, e.g. en, es, ja."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results to return (1-100). Defaults to 25."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"cursor":"25","hitsTotal":1042,"posts":[{"uri":"at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3kenh7wkbys2u","cid":"bafyreif3pcuhcyfqhhkmvyeieqjwqagd4kbkrkw6vfpxrrjcvpajmwjhwm","author":{"did":"did:plc:ewvi7nxzyoun6zhxrhs64oiz","handle":"alice.bsky.social","displayName":"Alice"},"record":{"$type":"app.bsky.feed.post","text":"FlowRunner automation is live!","createdAt":"2026-07-10T18:00:00Z"},"replyCount":1,"repostCount":4,"likeCount":29,"indexedAt":"2026-07-10T18:00:02Z"}]}
   */
  async searchPosts(query, sort, since, until, author, language, limit, cursor) {
    const logTag = '[searchPosts]'

    return await this.#apiRequest({
      logTag,
      nsid: 'app.bsky.feed.searchPosts',
      query: {
        q: query,
        sort: this.#resolveChoice(sort, { Top: 'top', Latest: 'latest' }),
        since,
        until,
        author: author ? String(author).trim().replace(/^@/, '') : undefined,
        lang: language,
        limit: limit || 25,
        cursor,
      },
    })
  }

  // ==========================================================================
  // Profiles
  // ==========================================================================

  /**
   * @operationName Get Profile
   * @category Profiles
   * @description Retrieves a user's full profile: display name, bio, avatar, banner, follower/following/post counts, and the connected account's relationship to them (following, followed-by, muted, blocked).
   * @route GET /profile
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"User","name":"actor","required":true,"description":"Handle (e.g. alice.bsky.social) or DID of the user."}
   *
   * @returns {Object}
   * @sampleResult {"did":"did:plc:ewvi7nxzyoun6zhxrhs64oiz","handle":"alice.bsky.social","displayName":"Alice","description":"Automation engineer. Posts about workflows.","avatar":"https://cdn.bsky.app/img/avatar/plain/did:plc:ewvi7nxzyoun6zhxrhs64oiz/bafkreibv6bmshyt7yextrbmyf5j4a4a5z5f5x7cmpwyrbhkyxi4nb6qedu@jpeg","followersCount":1250,"followsCount":310,"postsCount":842,"indexedAt":"2026-07-14T08:00:00Z","viewer":{"muted":false,"blockedBy":false,"following":"at://did:plc:6fktaamhhxdqb2jg7h6lqpxq/app.bsky.graph.follow/3kem2c5p7zk2u"},"createdAt":"2023-04-12T04:53:57Z"}
   */
  async getProfile(actor) {
    const logTag = '[getProfile]'

    return await this.#apiRequest({
      logTag,
      nsid: 'app.bsky.actor.getProfile',
      query: { actor: String(actor || '').trim().replace(/^@/, '') },
    })
  }

  /**
   * @operationName Get Profiles
   * @category Profiles
   * @description Retrieves full profiles for up to 25 users in a single call. Each entry can be a handle or DID.
   * @route GET /profiles
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"Array<String>","label":"Users","name":"actors","required":true,"description":"Up to 25 handles (e.g. alice.bsky.social) or DIDs."}
   *
   * @returns {Object}
   * @sampleResult {"profiles":[{"did":"did:plc:ewvi7nxzyoun6zhxrhs64oiz","handle":"alice.bsky.social","displayName":"Alice","followersCount":1250,"followsCount":310,"postsCount":842,"indexedAt":"2026-07-14T08:00:00Z"},{"did":"did:plc:z72i7hdynmk6r22z27h6tvur","handle":"bsky.app","displayName":"Bluesky","followersCount":3200000,"followsCount":3,"postsCount":420,"indexedAt":"2026-07-14T08:00:00Z"}]}
   */
  async getProfiles(actors) {
    const logTag = '[getProfiles]'

    if (!Array.isArray(actors) || !actors.length) {
      throw new Error('At least one user (handle or DID) is required.')
    }

    if (actors.length > MAX_BATCH_ACTORS) {
      throw new Error(`Get Profiles accepts at most ${ MAX_BATCH_ACTORS } users per call; got ${ actors.length }.`)
    }

    const normalized = actors.map(actor => String(actor).trim().replace(/^@/, ''))

    return await this.#apiRequest({
      logTag,
      nsid: 'app.bsky.actor.getProfiles',
      rawQuery: normalized.map(actor => `actors=${ encodeURIComponent(actor) }`).join('&'),
    })
  }

  /**
   * @operationName Search Users
   * @category Profiles
   * @description Searches Bluesky user profiles by name, handle or bio text (app.bsky.actor.searchActors). Returns profile views with follower counts and viewer relationship; paginate with the returned cursor.
   * @route GET /search-users
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Search term matched against handles, display names and bios."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results to return (1-100). Defaults to 25."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"cursor":"25","actors":[{"did":"did:plc:ewvi7nxzyoun6zhxrhs64oiz","handle":"alice.bsky.social","displayName":"Alice","description":"Automation engineer.","avatar":"https://cdn.bsky.app/img/avatar/plain/did:plc:ewvi7nxzyoun6zhxrhs64oiz/bafkreibv6bmshyt7yextrbmyf5j4a4a5z5f5x7cmpwyrbhkyxi4nb6qedu@jpeg","indexedAt":"2026-07-14T08:00:00Z","viewer":{"muted":false,"blockedBy":false}}]}
   */
  async searchUsers(query, limit, cursor) {
    const logTag = '[searchUsers]'

    return await this.#apiRequest({
      logTag,
      nsid: 'app.bsky.actor.searchActors',
      query: { q: query, limit: limit || 25, cursor },
    })
  }

  // ==========================================================================
  // Social Graph
  // ==========================================================================

  /**
   * @operationName Follow User
   * @category Social Graph
   * @description Follows a user from the connected account (creates an app.bsky.graph.follow record). Accepts a handle or DID; handles are resolved to DIDs automatically. Returns the follow record's at:// URI, which Unfollow User can reverse.
   * @route POST /follow
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"User","name":"actor","required":true,"description":"Handle (e.g. alice.bsky.social) or DID of the user to follow."}
   *
   * @returns {Object}
   * @sampleResult {"uri":"at://did:plc:6fktaamhhxdqb2jg7h6lqpxq/app.bsky.graph.follow/3kenlsy2b7c2u","cid":"bafyreid5xjfhjvnjyzvxgvhcrbzlgkqvvzbcvjrqvbqxqzblcyzpzvj5aa","validationStatus":"valid","subject":"did:plc:ewvi7nxzyoun6zhxrhs64oiz"}
   */
  async followUser(actor) {
    const logTag = '[followUser]'
    const did = await this.#resolveDid(actor, logTag)
    const session = await this.#getSession()

    const response = await this.#apiRequest({
      logTag,
      nsid: 'com.atproto.repo.createRecord',
      method: 'post',
      body: {
        repo: session.did,
        collection: 'app.bsky.graph.follow',
        record: { $type: 'app.bsky.graph.follow', subject: did, createdAt: new Date().toISOString() },
      },
    })

    return { ...response, subject: did }
  }

  /**
   * @operationName Unfollow User
   * @category Social Graph
   * @description Unfollows a user: looks up the connected account's follow record for them (via their profile's viewer state) and deletes it. Fails with a clear error if the account is not currently following the user.
   * @route DELETE /follow
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"User","name":"actor","required":true,"description":"Handle (e.g. alice.bsky.social) or DID of the user to unfollow."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"unfollowed":"did:plc:ewvi7nxzyoun6zhxrhs64oiz","handle":"alice.bsky.social"}
   */
  async unfollowUser(actor) {
    const logTag = '[unfollowUser]'

    const profile = await this.#apiRequest({
      logTag,
      nsid: 'app.bsky.actor.getProfile',
      query: { actor: String(actor || '').trim().replace(/^@/, '') },
    })

    const followUri = profile.viewer && profile.viewer.following

    if (!followUri) {
      throw new Error(`The connected account is not following ${ profile.handle || actor }.`)
    }

    const session = await this.#getSession()

    await this.#apiRequest({
      logTag,
      nsid: 'com.atproto.repo.deleteRecord',
      method: 'post',
      body: {
        repo: session.did,
        collection: 'app.bsky.graph.follow',
        rkey: this.#rkeyFromUri(followUri),
      },
    })

    return { success: true, unfollowed: profile.did, handle: profile.handle }
  }

  /**
   * @operationName Get Followers
   * @category Social Graph
   * @description Lists the accounts that follow a user, as profile views with viewer relationship info. Paginate with the returned cursor.
   * @route GET /followers
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"User","name":"actor","required":true,"description":"Handle (e.g. alice.bsky.social) or DID of the user whose followers to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of followers to return (1-100). Defaults to 50."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"subject":{"did":"did:plc:ewvi7nxzyoun6zhxrhs64oiz","handle":"alice.bsky.social","displayName":"Alice"},"cursor":"3kenltx4qgs2u","followers":[{"did":"did:plc:z72i7hdynmk6r22z27h6tvur","handle":"bsky.app","displayName":"Bluesky","indexedAt":"2026-07-14T08:00:00Z","viewer":{"muted":false,"blockedBy":false}}]}
   */
  async getFollowers(actor, limit, cursor) {
    const logTag = '[getFollowers]'

    return await this.#apiRequest({
      logTag,
      nsid: 'app.bsky.graph.getFollowers',
      query: {
        actor: String(actor || '').trim().replace(/^@/, ''),
        limit: limit || 50,
        cursor,
      },
    })
  }

  /**
   * @operationName Get Follows
   * @category Social Graph
   * @description Lists the accounts a user follows, as profile views with viewer relationship info. Paginate with the returned cursor.
   * @route GET /follows
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"User","name":"actor","required":true,"description":"Handle (e.g. alice.bsky.social) or DID of the user whose follows to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of follows to return (1-100). Defaults to 50."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"subject":{"did":"did:plc:ewvi7nxzyoun6zhxrhs64oiz","handle":"alice.bsky.social","displayName":"Alice"},"cursor":"3kenlv7hjt42u","follows":[{"did":"did:plc:z72i7hdynmk6r22z27h6tvur","handle":"bsky.app","displayName":"Bluesky","indexedAt":"2026-07-14T08:00:00Z","viewer":{"muted":false,"blockedBy":false}}]}
   */
  async getFollows(actor, limit, cursor) {
    const logTag = '[getFollows]'

    return await this.#apiRequest({
      logTag,
      nsid: 'app.bsky.graph.getFollows',
      query: {
        actor: String(actor || '').trim().replace(/^@/, ''),
        limit: limit || 50,
        cursor,
      },
    })
  }

  /**
   * @operationName Mute User
   * @category Social Graph
   * @description Mutes a user for the connected account (app.bsky.graph.muteActor). Their posts and notifications are hidden from you; muting is private and the muted user is not notified.
   * @route POST /mute
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"User","name":"actor","required":true,"description":"Handle (e.g. alice.bsky.social) or DID of the user to mute."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"actor":"alice.bsky.social","muted":true}
   */
  async muteUser(actor) {
    const logTag = '[muteUser]'
    const normalized = String(actor || '').trim().replace(/^@/, '')

    await this.#apiRequest({
      logTag,
      nsid: 'app.bsky.graph.muteActor',
      method: 'post',
      body: { actor: normalized },
    })

    return { success: true, actor: normalized, muted: true }
  }

  /**
   * @operationName Unmute User
   * @category Social Graph
   * @description Unmutes a previously muted user for the connected account (app.bsky.graph.unmuteActor), restoring their posts and notifications in your feeds.
   * @route POST /unmute
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"User","name":"actor","required":true,"description":"Handle (e.g. alice.bsky.social) or DID of the user to unmute."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"actor":"alice.bsky.social","muted":false}
   */
  async unmuteUser(actor) {
    const logTag = '[unmuteUser]'
    const normalized = String(actor || '').trim().replace(/^@/, '')

    await this.#apiRequest({
      logTag,
      nsid: 'app.bsky.graph.unmuteActor',
      method: 'post',
      body: { actor: normalized },
    })

    return { success: true, actor: normalized, muted: false }
  }

  // ==========================================================================
  // Notifications
  // ==========================================================================

  /**
   * @operationName List Notifications
   * @category Notifications
   * @description Lists the connected account's notifications: likes, reposts, follows, mentions, replies and quotes. Each notification includes the acting user, reason, subject post URI and read state. Paginate with the returned cursor.
   * @route GET /notifications
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of notifications to return (1-100). Defaults to 50."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"cursor":"2026-07-15T09:41:22Z","seenAt":"2026-07-15T08:00:00Z","notifications":[{"uri":"at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.like/3kenlwm5kbc2u","cid":"bafyreig4x2kdrwqmnhbvyzafjkgqvbclzjfmxvvbxjbwdgvbqzlvhjrq3e","author":{"did":"did:plc:z72i7hdynmk6r22z27h6tvur","handle":"bsky.app","displayName":"Bluesky"},"reason":"like","reasonSubject":"at://did:plc:6fktaamhhxdqb2jg7h6lqpxq/app.bsky.feed.post/3kenh7wkbys2u","isRead":false,"indexedAt":"2026-07-15T09:41:20Z"}]}
   */
  async listNotifications(limit, cursor) {
    const logTag = '[listNotifications]'

    return await this.#apiRequest({
      logTag,
      nsid: 'app.bsky.notification.listNotifications',
      query: { limit: limit || 50, cursor },
    })
  }

  /**
   * @operationName Mark Notifications Seen
   * @category Notifications
   * @description Marks all of the connected account's notifications as seen up to the current moment (app.bsky.notification.updateSeen), clearing the unread state.
   * @route POST /notifications-seen
   * @appearanceColor #0085FF #4CA2FE
   *
   * @returns {Object}
   * @sampleResult {"success":true,"seenAt":"2026-07-15T10:00:00.000Z"}
   */
  async markNotificationsSeen() {
    const logTag = '[markNotificationsSeen]'
    const seenAt = new Date().toISOString()

    await this.#apiRequest({
      logTag,
      nsid: 'app.bsky.notification.updateSeen',
      method: 'post',
      body: { seenAt },
    })

    return { success: true, seenAt }
  }

  // ==========================================================================
  // Identity
  // ==========================================================================

  /**
   * @operationName Resolve Handle
   * @category Identity
   * @description Resolves a Bluesky handle (e.g. alice.bsky.social or a custom domain handle) to its permanent DID (com.atproto.identity.resolveHandle). DIDs are stable identifiers that survive handle changes and are required by some AT Protocol operations.
   * @route GET /resolve-handle
   * @appearanceColor #0085FF #4CA2FE
   *
   * @paramDef {"type":"String","label":"Handle","name":"handle","required":true,"description":"Handle to resolve, with or without the leading @, e.g. alice.bsky.social."}
   *
   * @returns {Object}
   * @sampleResult {"did":"did:plc:ewvi7nxzyoun6zhxrhs64oiz","handle":"alice.bsky.social"}
   */
  async resolveHandle(handle) {
    const logTag = '[resolveHandle]'
    const normalized = String(handle || '').trim().replace(/^@/, '')
    const did = await this.#resolveDid(normalized, logTag)

    return { did, handle: normalized }
  }

  // ==========================================================================
  // Shared utilities
  // ==========================================================================

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }
}

Flowrunner.ServerCode.addService(BlueskyService, [
  {
    name: 'identifier',
    displayName: 'Identifier',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Bluesky handle (e.g. alice.bsky.social) or the account email address.',
  },
  {
    name: 'appPassword',
    displayName: 'App Password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Create one in the Bluesky app under Settings -> Privacy and Security -> App Passwords. ' +
      'Do NOT use your main account password. Note: Bluesky rate-limits sign-ins (~30 per 5 minutes), ' +
      'so very high-frequency flows should batch their Bluesky steps.',
  },
  {
    name: 'pdsUrl',
    displayName: 'PDS URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    defaultValue: DEFAULT_PDS_URL,
    hint: 'AT Protocol server that hosts the account. Keep the default https://bsky.social unless the account lives on a self-hosted PDS.',
  },
])
