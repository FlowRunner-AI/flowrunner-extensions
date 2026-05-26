const parse = require('parse-gmail-email')

const { logger } = require('./logger')
const { MimeType } = require('./constants')

module.exports = class EmailParser {
  parseMessage(rawEmail) {
    return new Promise((resolve, reject) => {
      parse(rawEmail, (error, data) => {
        if (error) {
          logger.error(`Error parsing email: ${ error.message }`)

          return reject(error)
        }

        if (data) {
          return resolve({
            rawEmailData: data,
            //
            id: data.id,
            fromAddress: data.from.address,
            fromName: data.from.name,
            to: data.to,
            attachments: data.attachments,
            threadId: data.threadId,
            labelIds: data.labelIds,
            cc: data.cc,
            bcc: data.bcc,
            snippet: data.snippet,
            subject: data.subject,
            message: data.message,
            date: data.date,
          })
        }
      })
    })
  }

  async parseThread(thread) {
    logger.debug(`ParseThread, before parse: ${ thread.id }`)

    const messages = await Promise.all(thread.messages.map(message => this.parseMessage(message)))

    const parsedThread = {
      id: thread.id,
      historyId: thread.historyId,
      messages,
    }

    logger.debug(`ParseThread, after parse: ${ thread.id }`)

    return parsedThread
  }

  createEmailMessage({ to, subject, bodyType, bodyContent, from, cc, bcc, attachments, myEmail, inReplyTo, references }) {
    const boundary = 'boundary'

    let message = ''

    message += `From: ${ from } <${ myEmail }>\r\n`
    message += `To: ${ to }\r\n`

    if (cc?.length > 0) {
      message += `Cc: ${ cc.join(', ') }\r\n`
    }

    if (bcc?.length > 0) {
      message += `Bcc: ${ bcc.join(', ') }\r\n`
    }

    message += `Subject: ${ subject }\r\n`

    if (inReplyTo) {
      message += `In-Reply-To: ${ inReplyTo }\r\n`
    }

    if (references) {
      message += `References: ${ references }\r\n`
    }

    message += 'MIME-Version: 1.0\r\n'
    message += `Content-Type: multipart/mixed; boundary="${ boundary }"\r\n\r\n`

    message += `--${ boundary }\r\n`
    message += `Content-Type: ${ bodyType === 'html' ? MimeType.HTML : MimeType.TEXT }; charset=UTF-8\r\n`
    message += 'Content-Transfer-Encoding: base64\r\n\r\n'
    message += `${ Buffer.from(bodyContent || '').toString('base64') }\r\n`

    if (attachments?.length > 0) {
      for (const attachment of attachments) {
        message += `--${ boundary }\r\n`

        message += `Content-Type: ${ attachment.contentType || 'application/octet-stream' }; name="${
          attachment.fileName
        }"\r\n`

        message += 'Content-Transfer-Encoding: base64\r\n'
        message += `Content-Disposition: attachment; filename="${ attachment.fileName }"; size=${ attachment.size }\r\n\r\n`
        message += `${ attachment.file }\r\n`
      }
    }

    message += `--${ boundary }--\r\n`

    return this.convertToBase64URLString(message)
  }

  convertToBase64URLString(message) {
    return Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }
}