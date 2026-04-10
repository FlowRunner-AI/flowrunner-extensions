const nodemailer = require('nodemailer')
const { promisify } = require('./utils')
const { logger } = require('./logger')

class EmailSender {
  constructor(config) {
    const options = {
      service: 'Office365',
      host: config.host,
      port: config.port,
      secure: config.useTLS,
      auth: {
        type: 'OAuth2',
        user: config.user,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        accessToken: config.accessToken,
      },
    }

    this.user = config.user
    this.transporter = nodemailer.createTransport(options)
  }

  async sendEmail(from, to, subject, text, html, cc, bcc, replyTo, priority) {
    this.sendMailAsync = promisify(this.transporter.sendMail.bind(this.transporter))

    const mailOptions = {
      from: `"${ from }" <${ this.user }>`,
      to: to,
      cc: cc,
      bcc: bcc,
      subject: subject,
      text: text,
      html: html,
      replyTo: replyTo,
      priority: priority,
    }

    return this.sendMailAsync(mailOptions)
      .then(info => {
        logger.debug('Email sent: ', info)

        return info
      })
      .catch(error => {
        logger.error('Error sending email:', error)

        throw error
      })
  }
}

module.exports = EmailSender
