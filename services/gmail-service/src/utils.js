const { MAX_TOTAL_ATTACHMENTS_SIZE } = require('./constants')

const DEFAULT_LABEL_COLORS = [
  // backgroundColor,textColor
  ['#e7e7e7', '#464646'],
  ['#b6cff5', '#0d3472'],
  ['#98d7e4', '#0d3b44'],
  ['#e3d7ff', '#3d188e'],
  ['#fbd3e0', '#711a36'],
  ['#f2b2a8', '#8a1c0a'],
  ['#c2c2c2', '#ffffff'],
  ['#4986e7', '#ffffff'],
  ['#2da2bb', '#ffffff'],
  ['#b99aff', '#ffffff'],
  ['#f691b2', '#994a64'],
  ['#fb4c2f', '#ffffff'],
  ['#ffc8af', '#7a2e0b'],
  ['#ffdeb5', '#7a4706'],
  ['#fbe983', '#594c05'],
  ['#fdefd1', '#684e07'],
  ['#b3efd3', '#0b4f30'],
  ['#a2dcc1', '#04502e'],
  ['#ff7537', '#ffffff'],
  ['#ffad46', '#ffffff'],
  ['#ebdbde', '#662e37'],
  ['#cca6ac', '#ffffff'],
  ['#42d692', '#094228'],
  ['#16a765', '#ffffff'],
]

function getRandomLabelColor(name) {
  let hash = 0

  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }

  const randomIndex = Math.abs(hash) % DEFAULT_LABEL_COLORS.length

  const [backgroundColor, textColor] = DEFAULT_LABEL_COLORS[randomIndex]

  return {
    backgroundColor,
    textColor,
  }
}

function constructIdentityName(user) {
  return `${ user.name } (${ user.email })` || 'Gmail Service Account'
}

function getIdentityImageURL(user) {
  return user.picture || null
}

function validateUrl(url) {
  try {
    return !!new URL(url)
  } catch (e) {
    return false
  }
}

function assert(condition, argName) {
  if (!condition) {
    throw new Error(`"${ argName }" is a required argument`)
  }
}

async function getFileAttachment(url) {
  try {
    const response = await Flowrunner.Request.get(url)
      .unwrapBody(false)
      .setEncoding(null)

    const parsedUrl = new URL(url)
    const fileName = parsedUrl.pathname.substring(parsedUrl.pathname.lastIndexOf('/') + 1) || 'noname'

    const contentType = response.headers['content-type']
    const base64File = Buffer.from(response.body).toString('base64')
    const base64Size = Buffer.byteLength(base64File, 'utf8')

    return { size: base64Size, file: base64File, url, fileName, contentType }
  } catch (error) {
    throw error
  }
}

async function downloadAttachments(urls) {
  const results = []
  let totalSize = 0

  const filesData = await Promise.all(urls.map(url => getFileAttachment(url)))

  for (const fileData of filesData) {
    totalSize += fileData.size

    if (totalSize > MAX_TOTAL_ATTACHMENTS_SIZE) {
      throw new Error('The total size of attachments exceeds 25MB.')
    }

    results.push(fileData)
  }

  return results
}

function validateAttachmentsUrl(urls) {
  const filesUrl = Array.isArray(urls) ? urls : [urls]

  return filesUrl.filter(validateUrl)
}

async function getValidAttachments(urls) {
  const validUrls = validateAttachmentsUrl(urls)

  if (validUrls.length === 0) {
    return []
  }

  return downloadAttachments(validUrls)
}

function createSearchParams({ query, loadUnread, maxResults, labelIds, nextPageToken, includeSpamTrash }) {
  const parameters = {}

  if (query) parameters.q = query
  if (maxResults) parameters.maxResults = maxResults
  if (labelIds) parameters.labelIds = Array.isArray(labelIds) ? labelIds : null
  if (nextPageToken) parameters.pageToken = nextPageToken
  if (includeSpamTrash) parameters.includeSpamTrash = includeSpamTrash

  if (loadUnread) {
    parameters.q = `${ parameters.q || '' } is:unread`
  }

  if (parameters.q) {
    parameters.q = parameters.q.trim()
  }

  return parameters
}

function searchFilter(list, props, searchString) {
  const caseInsensitiveSearch = searchString.toLowerCase()

  return list.filter(item => {
    if (typeof item === 'string') {
      return item.toLowerCase().includes(caseInsensitiveSearch)
    }

    return props.some(prop => {
      const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

      return value && String(value).toLowerCase().includes(caseInsensitiveSearch)
    })
  })
}

module.exports = {
  getRandomLabelColor,
  constructIdentityName,
  getIdentityImageURL,
  getValidAttachments,
  createSearchParams,
  searchFilter,
  assert,
}