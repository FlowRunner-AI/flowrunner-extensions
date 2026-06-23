'use strict'

const OAUTH_AUTHORIZE_URL = 'https://app.close.com/oauth2/authorize/'
const OAUTH_TOKEN_URL = 'https://api.close.com/oauth2/token/'
const OAUTH_REVOKE_URL = 'https://api.close.com/oauth2/revoke/'
const API_BASE_URL = 'https://api.close.com/api/v1'

const DEFAULT_SCOPE_LIST = ['all.full_access', 'offline_access']
const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

// Close enforces trailing slashes on every resource path.
const DEFAULT_PAGE_LIMIT = 100
const SEARCH_PAGE_LIMIT = 50
const MAX_SKIP = 9000 // soft cap to stay under Close's _skip ceiling
const MAX_PAGES_DEFAULT = 50
const WEBHOOK_TIMESTAMP_TOLERANCE_SEC = 300 // 5 min

// Webhook event mapping: realtime trigger method → (object_type, action) tuples
const WEBHOOK_EVENT_MAP = {
  onLeadCreated: [{ object_type: 'lead', action: 'created' }],
  onLeadUpdated: [{ object_type: 'lead', action: 'updated' }],
  onLeadDeleted: [{ object_type: 'lead', action: 'deleted' }],
  onLeadStatusChanged: [{ object_type: 'lead', action: 'status_change' }],
  onLeadMerged: [{ object_type: 'lead', action: 'merged' }],
  onOpportunityCreated: [{ object_type: 'opportunity', action: 'created' }],
  onOpportunityUpdated: [{ object_type: 'opportunity', action: 'updated' }],
  onOpportunityStatusChanged: [{ object_type: 'opportunity', action: 'status_change' }],
  onContactCreated: [{ object_type: 'contact', action: 'created' }],
  onContactUpdated: [{ object_type: 'contact', action: 'updated' }],
  onTaskCreated: [{ object_type: 'task.lead', action: 'created' }],
  onTaskCompleted: [{ object_type: 'task_completion', action: 'created' }],
  onNoteCreated: [{ object_type: 'activity.note', action: 'created' }],
  onCallCompleted: [{ object_type: 'activity.call', action: 'completed' }],
  onEmailSent: [{ object_type: 'activity.email', action: 'sent' }],
  onEmailReceived: [{ object_type: 'activity.email', action: 'created' }],
  onSmsSent: [{ object_type: 'activity.sms', action: 'sent' }],
  onSmsReceived: [{ object_type: 'activity.sms', action: 'created' }],
  onMeetingCompleted: [{ object_type: 'activity.meeting', action: 'completed' }],
  onCustomActivityCreated: [{ object_type: 'activity.custom', action: 'created' }],
}

// Reverse map: incoming webhook event → trigger method name
const EVENT_TO_METHOD = {}

for (const [methodName, events] of Object.entries(WEBHOOK_EVENT_MAP)) {
  for (const { object_type, action } of events) {
    EVENT_TO_METHOD[`${ object_type }:${ action }`] = methodName
  }
}

module.exports = {
  OAUTH_AUTHORIZE_URL,
  OAUTH_TOKEN_URL,
  OAUTH_REVOKE_URL,
  API_BASE_URL,
  DEFAULT_SCOPE_LIST,
  DEFAULT_SCOPE_STRING,
  DEFAULT_PAGE_LIMIT,
  SEARCH_PAGE_LIMIT,
  MAX_SKIP,
  MAX_PAGES_DEFAULT,
  WEBHOOK_TIMESTAMP_TOLERANCE_SEC,
  WEBHOOK_EVENT_MAP,
  EVENT_TO_METHOD,
}
