'use strict'

/**
 * Mock for Flowrunner.Request
 *
 * Provides a chainable HTTP request mock that records all calls and returns
 * configured responses. Supports the same chaining API as the real
 * Flowrunner.Request: .set(), .query(), .send(), .form(), .setEncoding()
 *
 * Setup responses:
 *   requestMock.onGet('https://api.example.com/items').reply({ items: [] })
 *   requestMock.onPost('https://api.example.com/items').reply({ id: '123' })
 *   requestMock.onAny().reply({ fallback: true })
 *
 * Inspect calls:
 *   requestMock.history  // [{ method, url, headers, query, body, encoding }]
 */

function createRequestMock() {
  const history = []
  const handlers = []

  function addHandler(method, url, response, error) {
    handlers.push({ method, url, response, error })
  }

  function findHandler(method, url) {
    return (
      handlers.find(h => h.method === method && h.url === url) ||
      handlers.find(h => h.method === method && h.url === undefined) ||
      handlers.find(h => h.method === 'any' && h.url === url) ||
      handlers.find(h => h.method === 'any' && h.url === undefined)
    )
  }

  function createChain(method, url) {
    const callRecord = {
      method,
      url,
      headers: {},
      query: {},
      body: undefined,
      formData: undefined,
      encoding: undefined,
    }

    const chain = {
      set(headers) {
        Object.assign(callRecord.headers, headers)
        return chain
      },

      query(q) {
        if (q) {
          Object.assign(callRecord.query, q)
        }
        return chain
      },

      send(body) {
        callRecord.body = body
        return chain
      },

      form(formData) {
        callRecord.formData = formData
        return chain
      },

      type(contentType) {
        callRecord.contentType = contentType
        return chain
      },

      setEncoding(enc) {
        callRecord.encoding = enc
        return chain
      },

      unwrapBody(flag) {
        // Records the flag and stays chainable. The configured reply is what the
        // awaited chain resolves to, so a test exercising an unwrapBody(false) path
        // sets its mock reply to the response-shaped object the service expects.
        callRecord.unwrapBody = flag
        return chain
      },

      then(resolve, reject) {
        history.push(callRecord)

        const handler = findHandler(method, url)

        if (handler && handler.error) {
          const err = handler.error instanceof Error
            ? handler.error
            : Object.assign(new Error(handler.error.message || 'Request failed'), handler.error)

          if (reject) {
            return reject(err)
          }

          return Promise.reject(err)
        }

        const response = handler ? handler.response : undefined

        if (typeof response === 'function') {
          try {
            const result = response(callRecord)
            return resolve ? resolve(result) : Promise.resolve(result)
          } catch (err) {
            return reject ? reject(err) : Promise.reject(err)
          }
        }

        return resolve ? resolve(response) : Promise.resolve(response)
      },

      catch(reject) {
        return chain.then(undefined, reject)
      },
    }

    return chain
  }

  function createReplyBuilder(method, url) {
    return {
      reply(response) {
        addHandler(method, url, response, null)
        return requestMock
      },

      replyWithError(error) {
        addHandler(method, url, null, error)
        return requestMock
      },

      replyWith(fn) {
        addHandler(method, url, fn, null)
        return requestMock
      },
    }
  }

  const Request = {}

  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head']) {
    Request[method] = (url) => createChain(method, url)
  }

  Request.FormData = class FormData {
    constructor() {
      this._fields = []
    }

    append(name, value, filename) {
      this._fields.push({ name, value, filename })
    }
  }

  const requestMock = {
    Request,
    history,

    onGet(url) { return createReplyBuilder('get', url) },
    onPost(url) { return createReplyBuilder('post', url) },
    onPut(url) { return createReplyBuilder('put', url) },
    onPatch(url) { return createReplyBuilder('patch', url) },
    onDelete(url) { return createReplyBuilder('delete', url) },
    onHead(url) { return createReplyBuilder('head', url) },
    onAny(url) { return createReplyBuilder('any', url) },

    reset() {
      history.length = 0
      handlers.length = 0
    },
  }

  return requestMock
}

module.exports = { createRequestMock }
