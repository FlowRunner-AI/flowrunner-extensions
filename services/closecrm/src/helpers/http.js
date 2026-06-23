'use strict'

const { logger } = require('./logger')
const { clean } = require('./utils')
const { wrapError } = require('./errors')

// Builds a #apiRequest function bound to a service instance.
// service must expose: getAuthHeader() => { Authorization: '...' }
function makeApiRequest(service) {
  return async function apiRequest({ url, method, body, query, logTag, headers }) {
    method = (method || 'get').toLowerCase()
    const cleanedQuery = clean(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(cleanedQuery) }]`)

      const baseHeaders = {
        ...service.getAuthHeader(),
        ...(headers || {}),
      }

      const request = Flowrunner.Request[method](url)
        .set(baseHeaders)
        .query(cleanedQuery)

      if (body !== undefined && body !== null) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      throw wrapError(error, logTag)
    }
  }
}

module.exports = { makeApiRequest }
