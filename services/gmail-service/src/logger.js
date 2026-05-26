const logger = {
  info: (...args) => console.log('[Gmail Service] info:', ...args),
  debug: (...args) => console.log('[Gmail Service] debug:', ...args),
  error: (...args) => console.log('[Gmail Service] error:', ...args),
  warn: (...args) => console.log('[Gmail Service] warn:', ...args),
}

module.exports = {
  logger,
}