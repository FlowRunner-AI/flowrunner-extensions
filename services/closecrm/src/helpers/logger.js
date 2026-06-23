'use strict'

const logger = {
  info: (...args) => console.log('[Close CRM Service] info:', ...args),
  debug: (...args) => console.log('[Close CRM Service] debug:', ...args),
  error: (...args) => console.log('[Close CRM Service] error:', ...args),
  warn: (...args) => console.log('[Close CRM Service] warn:', ...args),
}

module.exports = { logger }
