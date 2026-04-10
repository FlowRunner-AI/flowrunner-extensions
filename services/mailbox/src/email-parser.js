const { simpleParser } = require('mailparser')
const { logger } = require('./logger')

class EmailParser {
  async parse(rawEmail) {
    try {
      const parsed = await simpleParser(rawEmail)

      return {
        messageId: parsed.messageId,
        from: parsed.from,
        to: parsed.to,
        subject: parsed.subject,
        date: parsed.date,
        replyTo: parsed.replyTo,
        body: parsed.text,
        html: parsed.html,
        textAsHtml: parsed.textAsHtml,
        inReplyTo: parsed.inReplyTo,
      }
    } catch (error) {
      logger.error('Error parsing email:', error)

      throw error
    }
  }
}

module.exports = EmailParser
