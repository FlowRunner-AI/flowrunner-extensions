'use strict'

const https = require('https')
const http = require('http')

const { signRequest } = require('./sigv4')

/**
 * Makes an HTTP/HTTPS request using Node's built-in modules.
 *
 * @param {string} method - HTTP method string
 * @param {string} url - Full URL string
 * @param {Object} headers - Request headers
 * @param {string|Buffer|null} body - Request body or null
 * @returns {Promise<{ statusCode: number, headers: Object, body: string }>}
 */
function httpRequest(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const transport = parsedUrl.protocol === 'https:' ? https : http

    const requestHeaders = { ...headers }

    if (body) {
      requestHeaders['content-length'] = Buffer.byteLength(body)
    }

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: requestHeaders,
    }

    const req = transport.request(options, res => {
      const chunks = []

      res.on('error', err => {
        reject(err)
      })

      res.on('data', chunk => {
        chunks.push(chunk)
      })

      res.on('end', () => {
        const bodyBuffer = Buffer.concat(chunks)
        const bodyString = bodyBuffer.toString('utf8')

        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: bodyString,
        })
      })
    })

    req.on('error', err => {
      reject(err)
    })

    req.setTimeout(30000, () => {
      req.destroy(new Error('Request timed out'))
    })

    if (body) {
      req.write(body)
    }

    req.end()
  })
}

/**
 * Extracts the text content of the first occurrence of <tagName>...</tagName>.
 *
 * @param {string} xml - XML string to search
 * @param {string} tagName - Tag name to find
 * @returns {string|null} Text content or null if not found
 */
function parseXmlTag(xml, tagName) {
  const re = new RegExp('<' + tagName + '>([\\s\\S]*?)</' + tagName + '>')
  const match = xml.match(re)

  return match ? match[1] : null
}

/**
 * Extracts text content of ALL occurrences of <tagName>...</tagName>.
 *
 * @param {string} xml - XML string to search
 * @param {string} tagName - Tag name to find
 * @returns {string[]} Array of text content strings, empty if none found
 */
function parseXmlTags(xml, tagName) {
  const re = new RegExp('<' + tagName + '>([\\s\\S]*?)</' + tagName + '>', 'g')
  const results = []
  let match

  while ((match = re.exec(xml)) !== null) {
    results.push(match[1])
  }

  return results
}

/** Alias for parseXmlTags — semantic name for extracting repeating XML blocks. */
const parseXmlBlocks = parseXmlTags

/**
 * Higher-level S3 request that signs and sends a request.
 *
 * @param {string} method - HTTP method
 * @param {string} url - Full URL string
 * @param {Object} headers - Request headers (will be mutated by signing)
 * @param {string|Buffer|null} body - Request body or null
 * @param {Object} credentials - { accessKeyId, secretAccessKey, sessionToken? }
 * @param {string} region - AWS region
 * @returns {Promise<{ statusCode: number, headers: Object, body: string }>}
 */
async function s3Request(method, url, headers, body, credentials, region) {
  signRequest(method, url, headers, body || '', credentials, region, 's3')

  const response = await httpRequest(method, url, headers, body)

  if (response.statusCode >= 300) {
    const code = parseXmlTag(response.body, 'Code')
    const message = parseXmlTag(response.body, 'Message')

    let inferredCode = code

    if (!inferredCode && !response.body.trim()) {
      if (response.statusCode === 404) inferredCode = 'NotFound'
      else if (response.statusCode === 403) inferredCode = 'AccessDenied'
      else if (response.statusCode === 400) inferredCode = 'BadRequest'
    }

    const err = new Error(message || 'S3 request failed')
    err.name = inferredCode || 'S3Error'
    err.statusCode = response.statusCode

    throw err
  }

  return response
}

/**
 * Assumes an IAM role using STS AssumeRole.
 *
 * @param {Object} credentials - { accessKeyId, secretAccessKey, sessionToken? }
 * @param {string} region - AWS region
 * @param {string} roleArn - ARN of the role to assume
 * @param {string} sessionName - Name for the assumed role session
 * @param {string} [externalId] - Optional external ID for cross-account access
 * @returns {Promise<{ accessKeyId: string, secretAccessKey: string, sessionToken: string, expiration: Date }>}
 */
async function stsAssumeRole(credentials, region, roleArn, sessionName, externalId) {
  let formBody =
    'Action=AssumeRole' +
    '&Version=2011-06-15' +
    `&RoleArn=${ encodeURIComponent(roleArn) }` +
    `&RoleSessionName=${ encodeURIComponent(sessionName) }`

  if (externalId) {
    formBody += `&ExternalId=${ encodeURIComponent(externalId) }`
  }

  const url = `https://sts.${ region }.amazonaws.com/`
  const headers = { 'content-type': 'application/x-www-form-urlencoded' }

  signRequest('POST', url, headers, formBody, credentials, region, 'sts')

  const response = await httpRequest('POST', url, headers, formBody)

  if (response.statusCode >= 300) {
    const code = parseXmlTag(response.body, 'Code')
    const message = parseXmlTag(response.body, 'Message')

    const err = new Error(message || 'STS AssumeRole failed')
    err.name = code || 'STSError'
    err.statusCode = response.statusCode

    throw err
  }

  const accessKeyId = parseXmlTag(response.body, 'AccessKeyId')
  const secretAccessKey = parseXmlTag(response.body, 'SecretAccessKey')
  const sessionToken = parseXmlTag(response.body, 'SessionToken')
  const expirationStr = parseXmlTag(response.body, 'Expiration')

  if (!accessKeyId || !secretAccessKey || !sessionToken) {
    const err = new Error('Failed to parse STS AssumeRole response: missing credential fields')
    err.name = 'STSParseError'

    throw err
  }

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken,
    expiration: new Date(expirationStr),
  }
}

module.exports = {
  httpRequest,
  parseXmlTag,
  parseXmlTags,
  parseXmlBlocks,
  s3Request,
  stsAssumeRole,
}
