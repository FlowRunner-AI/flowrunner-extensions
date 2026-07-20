'use strict'

/**
 * Real HTTP request implementation for e2e tests.
 *
 * Wraps superagent to match the Flowrunner.Request chainable API:
 *   Flowrunner.Request.get(url).set(headers).query(q).send(body) → Promise<responseBody>
 *
 * Key difference from raw superagent: returns response.body directly (not the
 * response object), matching how the real Flowrunner runtime behaves.
 */

const superagent = require('superagent')

function createRealRequest() {
  const Request = {}

  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    Request[method] = (url) => {
      const req = superagent[method](url)
      let encoding = undefined
      let unwrap = true

      // Wrap .then so that awaiting the chain returns response.body (not the response object),
      // matching Flowrunner.Request behavior. When unwrapBody(false) is called, resolve with the
      // full response instead (so binary downloads can read res.body + res.headers).
      const originalThen = req.then.bind(req)

      req.then = (resolve, reject) => {
        return originalThen(
          (res) => {
            const result = unwrap === false ? res : res.body
            return resolve ? resolve(result) : result
          },
          (err) => {
            // Attach body and status to the error like Flowrunner does
            if (err.response) {
              err.body = err.response.body
              err.status = err.response.status
              err.statusCode = err.response.status
            }

            if (reject) {
              return reject(err)
            }

            return Promise.reject(err)
          }
        )
      }

      // Preserve setEncoding for binary downloads
      const origSetEncoding = req.setEncoding
        ? req.setEncoding.bind(req)
        : undefined

      req.setEncoding = (enc) => {
        encoding = enc

        if (enc === null) {
          req.buffer(true).parse(superagent.parse['application/octet-stream'] || ((res, cb) => {
            const chunks = []
            res.on('data', chunk => chunks.push(chunk))
            res.on('end', () => cb(null, Buffer.concat(chunks)))
          }))
        }

        return req
      }

      // Match Flowrunner.Request.unwrapBody: false → resolve with the full response
      // object (headers + body) instead of just response.body.
      req.unwrapBody = (flag) => {
        unwrap = flag
        return req
      }

      // Wrap .form() for FormData support
      req.form = (formData) => {
        if (formData && formData._fields) {
          // Our sandbox FormData
          for (const field of formData._fields) {
            req.field(field.name, field.value)
          }
        }

        return req
      }

      return req
    }
  }

  Request.FormData = class FormData {
    constructor() {
      this._fields = []
    }

    append(name, value, filename) {
      this._fields.push({ name, value, filename })
    }
  }

  return Request
}

module.exports = { createRealRequest }
