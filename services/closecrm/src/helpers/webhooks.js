'use strict'

const crypto = require('crypto')

const { WEBHOOK_TIMESTAMP_TOLERANCE_SEC } = require('../constants')

function verifySignature({ signatureKey, timestamp, rawBody, signature }) {
  if (!signatureKey || !timestamp || !rawBody || !signature) return false

  const tsNum = Number(timestamp)
  if (!Number.isFinite(tsNum)) return false

  const ageSec = Math.abs(Date.now() / 1000 - tsNum)
  if (ageSec > WEBHOOK_TIMESTAMP_TOLERANCE_SEC) return false

  // Close's signature_key is a hex string; it must be decoded to raw bytes before HMAC keying.
  // docs: https://developer.close.com/topics/webhooks/
  const keyBytes = Buffer.from(signatureKey, 'hex')
  const hmac = crypto.createHmac('sha256', keyBytes).update(String(timestamp) + rawBody).digest('hex')

  const a = Buffer.from(hmac, 'hex')
  const b = Buffer.from(String(signature), 'hex')
  if (a.length !== b.length) return false

  return crypto.timingSafeEqual(a, b)
}

// Reconstruct raw body from invocation if possible (for HMAC verification).
function rawBodyOf(invocation) {
  if (!invocation) return ''
  if (typeof invocation.rawBody === 'string') return invocation.rawBody
  if (Buffer.isBuffer(invocation.rawBody)) return invocation.rawBody.toString('utf8')
  if (typeof invocation.body === 'string') return invocation.body
  if (invocation.body && typeof invocation.body === 'object') return JSON.stringify(invocation.body)

  return ''
}

function headersOf(invocation) {
  const headers = invocation?.headers || invocation?.queryParams?.headers || {}
  const out = {}
  for (const [k, v] of Object.entries(headers)) out[String(k).toLowerCase()] = v

  return out
}

module.exports = { verifySignature, rawBodyOf, headersOf }
