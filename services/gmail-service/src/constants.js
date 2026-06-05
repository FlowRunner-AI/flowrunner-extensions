const MimeType = {
  TEXT: 'text/plain',
  HTML: 'text/html',
}

const DEFAULT_SCOPE_LIST = [
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://mail.google.com/',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const MAX_TOTAL_ATTACHMENTS_SIZE = 25 * 1024 * 1024 // 25 MB in bytes (Gmail limit)

module.exports = {
  MimeType,
  MAX_TOTAL_ATTACHMENTS_SIZE,
  DEFAULT_SCOPE_LIST,
  DEFAULT_SCOPE_STRING,
}