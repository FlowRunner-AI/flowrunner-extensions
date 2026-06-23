'use strict'

const { DEFAULT_PAGE_LIMIT, MAX_SKIP, MAX_PAGES_DEFAULT } = require('../constants')

// Offset pagination walker for /lead/, /contact/, etc.
async function paginateOffset(fetcher, { limit = DEFAULT_PAGE_LIMIT, maxPages = MAX_PAGES_DEFAULT } = {}) {
  const all = []
  let skip = 0
  let pages = 0

  while (pages < maxPages) {
    const res = await fetcher({ _limit: limit, _skip: skip })
    const data = res?.data || []
    all.push(...data)

    if (!res?.has_more || data.length === 0) break
    skip += limit
    pages++
    if (skip >= MAX_SKIP) break
  }

  return all
}

// Cursor pagination walker for POST /data/search/
async function paginateCursor(fetcher, { limit = 50, maxPages = MAX_PAGES_DEFAULT } = {}) {
  const all = []
  let cursor = null
  let pages = 0

  do {
    const res = await fetcher({ cursor, _limit: limit })
    const data = res?.data || []
    all.push(...data)
    cursor = res?.cursor || null
    pages++
    if (pages >= maxPages) break
  } while (cursor)

  return all
}

module.exports = { paginateOffset, paginateCursor }
