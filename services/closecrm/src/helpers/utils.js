'use strict'

function clean(obj) {
  if (!obj || typeof obj !== 'object') return obj

  const out = {}

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === '') continue
    out[key] = value
  }

  return out
}

function deepClean(obj) {
  if (Array.isArray(obj)) return obj.map(deepClean).filter(v => v !== undefined)

  if (obj && typeof obj === 'object') {
    const out = {}

    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null) continue
      const cleaned = deepClean(value)
      if (cleaned === undefined) continue
      if (typeof cleaned === 'object' && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0) continue
      out[key] = cleaned
    }

    return out
  }

  return obj
}

function toArray(input) {
  if (input === undefined || input === null || input === '') return []
  if (Array.isArray(input)) return input.filter(Boolean)
  if (typeof input === 'string') return input.split(',').map(s => s.trim()).filter(Boolean)

  return [input]
}

function parseMaybeJSON(input) {
  if (input === undefined || input === null || input === '') return undefined
  if (typeof input === 'object') return input
  if (typeof input !== 'string') return input

  try {
    return JSON.parse(input)
  } catch (e) {
    return input
  }
}

function buildQuery(filters) {
  // Close accepts arbitrary `query` filter strings on list endpoints: status_label:"Qualified" custom.cf_xxx:"val"
  if (!filters) return undefined
  if (typeof filters === 'string') return filters
  if (typeof filters !== 'object') return undefined

  return Object.entries(filters)
    .filter(([_, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      if (typeof v === 'string' && /\s/.test(v)) return `${ k }:"${ v }"`

      return `${ k }:${ v }`
    })
    .join(' ')
}

function dictItem(item, opts = {}) {
  return {
    label: opts.label || item.name || item.label || item.display_name || item.id,
    value: opts.value || item.id,
    note: opts.note,
  }
}

function applySearch(items, search, fields = ['name', 'display_name', 'label']) {
  if (!search) return items
  const needle = String(search).toLowerCase()

  return items.filter(it => fields.some(f => it[f] && String(it[f]).toLowerCase().includes(needle)))
}

module.exports = {
  clean,
  deepClean,
  toArray,
  parseMaybeJSON,
  buildQuery,
  dictItem,
  applySearch,
}
