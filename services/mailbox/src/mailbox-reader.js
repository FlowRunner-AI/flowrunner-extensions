const { ImapFlow } = require('imapflow')
const { logger } = require('./logger')

class MailboxReader {
  constructor({ host, port, useTLS, user, password, accessToken }) {
    const options = {
      host: host,
      port: port,
      secure: useTLS,
      auth: {
        user: user,
      },
    }

    if (password) {
      options.auth.pass = password
    }

    if (accessToken) {
      options.auth.accessToken = accessToken
    }

    this.client = new ImapFlow(options)
  }

  async connect() {
    try {
      await this.client.connect()

      logger.debug('Connected to the mailbox')
    } catch (error) {
      logger.error('Error connecting to mailbox:', error)
      throw error
    }
  }

  async disconnect() {
    try {
      await this.client.logout()

      logger.debug('Logged out from the mailbox')
    } catch (error) {
      logger.error('Error during logout:', error)

      throw error
    }
  }

  async fetchEmails(criteria = {}, limit) {
    let lock

    try {
      lock = await this.client.getMailboxLock('INBOX')

      const messages = await this.client.search(criteria)
      const lastMessages = messages.slice(-limit)

      const emails = []

      for (const seq of lastMessages) {
        const message = await this.client.fetchOne(seq, { source: true })

        emails.push(message)

        await this.client.messageFlagsAdd(seq, ['\\Seen'])
      }

      return emails
    } finally {
      if (lock) {
        lock.release()

        logger.debug('Released Inbox Lock')
      }
    }
  }

  /**
   * Marks an email as unread.
   *
   * @param {string} uid - The UID of the email to be marked as unread.
   *
   * @returns {Promise<string>} A promise that resolves when the email is successfully marked as unread.
   */
  async markEmailAsUnread(uid) {
    let lock

    try {
      lock = await this.client.getMailboxLock('INBOX')

      const message = await this.client.fetchOne(uid, { flags: true }, { uid: true })

      if (!message) {
        throw new Error(`Email with UID ${ uid } not found`)
      }

      await this.client.messageFlagsRemove({ uid }, ['\\Seen'])

      logger.debug(`Email ${ uid } has been marked as unread.`)
    } catch (error) {
      logger.error('Error marking email as unread:', error)

      throw error
    } finally {
      if (lock) {
        lock.release()

        logger.debug('Released Inbox Lock')
      }
    }
  }
}

module.exports = MailboxReader
