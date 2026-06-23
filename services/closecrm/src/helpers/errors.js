'use strict'

const { logger } = require('./logger')

const FRIENDLY_HINTS = {
  401: 'Close CRM credentials are invalid or expired. Reconnect the account.',
  403: 'Close CRM denied the request. Check that the connected user has permission for this object/action.',
  404: 'The requested Close CRM resource was not found. Verify the ID.',
  409: 'Close CRM reports a conflict (e.g., merging a lead with itself or duplicate unique value).',
  410: 'This Close CRM endpoint is deprecated and no longer accepts requests.',
  415: 'Close CRM rejected the request payload format. Ensure JSON content-type.',
  423: 'Close CRM resource is locked (background operation in progress). Retry shortly.',
  429: 'Close CRM rate limit exceeded. Reduce request frequency or wait for the reset window.',
  502: 'Close CRM upstream is temporarily unavailable. Retry with backoff.',
  503: 'Close CRM service is temporarily unavailable. Retry with backoff.',
}

function extractCloseError(error) {
  const status = error?.status || error?.statusCode || error?.code
  const body = error?.body || error?.message

  let parsed = body

  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body) 
    } catch (_) { /* leave string */ }
  }

  const closeMessage =
    parsed?.error ||
    parsed?.message ||
    (Array.isArray(parsed?.errors) && parsed.errors.join('; ')) ||
    (parsed?.['field-errors'] && Object.entries(parsed['field-errors']).map(([f, msgs]) => `${ f }: ${ [].concat(msgs).join(', ') }`).join('; '))

  return { status, message: closeMessage || (typeof parsed === 'string' ? parsed : null), raw: parsed }
}

function wrapError(error, logTag) {
  const { status, message } = extractCloseError(error)
  const hint = FRIENDLY_HINTS[status] || ''
  const composed = [
    logTag ? `[${ logTag }]` : null,
    status ? `Close CRM ${ status }` : 'Close CRM error',
    message,
    hint,
  ].filter(Boolean).join(' — ')

  logger.error(composed)

  const wrapped = new Error(composed)
  wrapped.status = status
  wrapped.cause = error

  return wrapped
}

module.exports = {
  FRIENDLY_HINTS,
  extractCloseError,
  wrapError,
}
