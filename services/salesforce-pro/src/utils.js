const path = require('path')
const xml2js = require('xml2js')

function cleanupObject(data) {
  const result = {}

  Object.keys(data ?? {}).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

function searchFilter(list, props, searchString) {
  const caseInsensitiveString = searchString.toLowerCase()

  return list.filter(item => props.some(prop => item[prop]?.toLowerCase().includes(caseInsensitiveString)))
}

function serializeToken(accessToken, instanceUrl) {
  return JSON.stringify(JSON.stringify({ a: accessToken, i: instanceUrl }))
}

function deserializeToken(tokenString) {
  let tokens

  if (tokenString) {
    try {
      tokens = JSON.parse(tokenString)
    } catch {}

    if (tokens && typeof tokens === 'string') {
      try {
        tokens = JSON.parse(tokens)
      } catch {}
    }
  }

  return {
    accessToken: tokens?.a,
    instanceUrl: tokens?.i,
  }
}

function isURL(str) {
  return typeof str === 'string' && /^https?:\/\//i.test(str)
}

function sanitizeFilename(name) {
  if (name) {
    return name.replace(/[^a-zA-Z0-9]/g, '')
  }

  return name
}

async function getFileUploadData(file, name) {
  const cleanName = sanitizeFilename(name?.trim())
  let fileName, encodedBody

  if (isURL(file)) {
    const response = await fetch(file)
    const arrayBuffer = await response.arrayBuffer()
    encodedBody = Buffer.from(arrayBuffer).toString('base64')

    const urlPathname = new URL(file).pathname
    const extension = path.extname(urlPathname) || ''

    fileName = cleanName ? `${ cleanName }${ extension }` : path.basename(urlPathname)
  } else {
    const buffer = Buffer.isBuffer(file) ? file : Buffer.from(String(file), 'utf8')
    encodedBody = buffer.toString('base64')

    const base = cleanName || sanitizeFilename(buffer.toString('utf8', 0, 12))
    fileName = `${ base }.txt`
  }

  return { fileName, encodedBody }
}

function getSoapXml({ sessionId, leadId, accountId, opportunityName, convertedStatus, doNotCreateOpportunity }) {
  const builder = new xml2js.Builder({
    headless: false,
    xmldec: { version: '1.0', encoding: 'UTF-8' },
  })

  return builder.buildObject({
    'env:Envelope': {
      $: {
        'xmlns:env': 'http://schemas.xmlsoap.org/soap/envelope/',
        'xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
        'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      },
      'env:Header': {
        SessionHeader: {
          $: { xmlns: 'urn:partner.soap.sforce.com' },
          sessionId,
        },
      },
      'env:Body': {
        convertLead: {
          $: { xmlns: 'urn:partner.soap.sforce.com' },
          leadConverts: {
            leadId,
            ...(accountId && { accountId }),
            ...(opportunityName && { opportunityName }),
            convertedStatus,
            doNotCreateOpportunity,
          },
        },
      },
    },
  })
}

function normalizeSoapObject(obj) {
  if (obj && typeof obj === 'object') {
    if (obj.$?.['xsi:nil'] === 'true') {
      return null
    }

    const normalized = {}

    for (const key in obj) {
      normalized[key] = normalizeSoapObject(obj[key])
    }

    return normalized
  }

  return obj
}

function isDate(value) {
  return typeof value === 'string' && /^\d{2}\.\d{2}\.\d{4}$/.test(value)
}

function isUTC(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2}|[+-]\d{4})$/.test(value)
  )
}

function parseDate(value) {
  const [day, month, year] = value.split('.').map(Number)

  if (
    !Number.isInteger(day) ||
    day < 1 ||
    day > 31 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(year)
  ) {
    throw new Error(`Invalid components in the date: "${ value }"`)
  }

  const date = new Date(Date.UTC(year, month - 1, day))

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: "${ value }"`)
  }

  return date
}

function convertDateFieldsToUTC(fields) {
  const result = { ...fields }

  for (const [key, value] of Object.entries(result)) {
    if (isDate(value)) {
      result[key] = parseDate(value).toISOString()
    } else if (isUTC(value)) {
      result[key] = new Date(value).toISOString()
    } else {
      result[key] = value
    }
  }

  return result
}

module.exports = {
  cleanupObject,
  searchFilter,
  serializeToken,
  deserializeToken,
  getFileUploadData,
  getSoapXml,
  normalizeSoapObject,
  convertDateFieldsToUTC,
}
