'use strict'

// Build a Close Search API query tree from the simple/declarative form used by FlowRunner inputs.
//
// Accepts:
//   - A full Close query tree (passed through unchanged when it looks like one)
//   - A string treated as a saved-search reference or smart-view name (caller resolves)
//   - A simple object: { objectType, status, leadStatus, opportunityStatus, pipelineId, contactId, userId,
//                       createdAfter, createdBefore, updatedAfter, updatedBefore, hasOpportunity,
//                       customFields: { cfId: value }, conditions: [...] }

function looksLikeNativeQuery(q) {
  return q && typeof q === 'object' && typeof q.type === 'string' &&
    ['and', 'or', 'not', 'object_type', 'field_condition', 'has_related', 'saved_search'].includes(q.type)
}

function objectTypeNode(objectType) {
  return { type: 'object_type', object_type: objectType }
}

function fieldCondition(objectType, fieldName, condition) {
  return {
    type: 'field_condition',
    field: { type: 'regular_field', object_type: objectType, field_name: fieldName },
    condition,
  }
}

function customFieldCondition(customFieldId, condition) {
  return {
    type: 'field_condition',
    field: { type: 'custom_field', custom_field_id: customFieldId },
    condition,
  }
}

function textExact(value) {
  return { type: 'text', mode: 'exact_value', value: String(value) }
}

function textContains(value) {
  return { type: 'text', mode: 'phrase', value: String(value) }
}

function momentRange({ after, before }) {
  const range = {}
  if (after) range.after = after
  if (before) range.before = before

  return { type: 'moment_range', ...range }
}

function reference(ids) {
  return { type: 'reference', reference_id: Array.isArray(ids) ? ids : [ids] }
}

function buildSearchQuery(input) {
  if (!input) return null
  if (typeof input === 'string') return null // caller handles smart-view id
  if (looksLikeNativeQuery(input)) return input

  const {
    objectType = 'lead',
    status,
    leadStatus,
    opportunityStatus,
    pipelineId,
    contactId,
    userId,
    assignedToId,
    createdAfter,
    createdBefore,
    updatedAfter,
    updatedBefore,
    customFields,
    conditions = [],
    operator = 'and',
  } = input

  const sub = [objectTypeNode(objectType)]

  if (leadStatus || (status && objectType === 'lead')) {
    sub.push(fieldCondition('lead', 'status_label', textExact(leadStatus || status)))
  }

  if (opportunityStatus || (status && objectType === 'opportunity')) {
    sub.push(fieldCondition('opportunity', 'status_label', textExact(opportunityStatus || status)))
  }

  if (pipelineId && objectType === 'opportunity') {
    sub.push(fieldCondition('opportunity', 'pipeline_id', reference(pipelineId)))
  }

  if (contactId) {
    sub.push(fieldCondition(objectType, 'contact_id', reference(contactId)))
  }

  if (userId) {
    sub.push(fieldCondition(objectType, 'user_id', reference(userId)))
  }

  if (assignedToId && objectType === 'lead') {
    sub.push(fieldCondition('lead', 'lead_owner_id', reference(assignedToId)))
  }

  if (createdAfter || createdBefore) {
    sub.push(fieldCondition(objectType, 'date_created', momentRange({ after: createdAfter, before: createdBefore })))
  }

  if (updatedAfter || updatedBefore) {
    sub.push(fieldCondition(objectType, 'date_updated', momentRange({ after: updatedAfter, before: updatedBefore })))
  }

  if (customFields && typeof customFields === 'object') {
    for (const [cfId, value] of Object.entries(customFields)) {
      if (value === undefined || value === null || value === '') continue
      sub.push(customFieldCondition(cfId, textExact(value)))
    }
  }

  for (const c of conditions) {
    if (looksLikeNativeQuery(c)) sub.push(c)
  }

  if (sub.length === 1) return sub[0]

  return { type: operator, queries: sub }
}

function smartViewNode(savedSearchId) {
  return { type: 'saved_search', saved_search_id: savedSearchId }
}

module.exports = {
  buildSearchQuery,
  smartViewNode,
  objectTypeNode,
  fieldCondition,
  customFieldCondition,
  textExact,
  textContains,
  momentRange,
  reference,
  looksLikeNativeQuery,
}
