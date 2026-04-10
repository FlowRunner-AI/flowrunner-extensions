const logger = {
  info: (...args) => console.log('[Mailbox Service] info:', ...args),
  debug: (...args) => console.log('[Mailbox Service] debug:', ...args),
  error: (...args) => console.log('[Mailbox Service] error:', ...args),
  warn: (...args) => console.log('[Mailbox Service] warn:', ...args),
}

module.exports = {
  logger,
}
