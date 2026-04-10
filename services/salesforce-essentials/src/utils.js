const cleanupObject = data => {
  const result = {}

  Object.keys(data ?? {}).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

const searchFilter = (list, props, searchString) => {
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

function isURL(string) {
  try {
    new URL(string)

    return true
  } catch (_) {
    return false
  }
}

async function getFileUploadData(file) {
  let fileName, encodedBody

  if (isURL(file)) {
    const response = await fetch(file)
    const arrayBuffer = await response.arrayBuffer()
    encodedBody = Buffer.from(arrayBuffer).toString('base64')

    const url = new URL(file)
    const pathSegments = url.pathname.split('/')
    fileName = pathSegments[pathSegments.length - 1] || 'noname'
  } else {
    encodedBody = Buffer.from(file, 'utf-8').toString('base64')
    fileName = fileName || file.substring(0, 12) + '.txt'
  }

  return { fileName, encodedBody }
}

module.exports = {
  cleanupObject,
  searchFilter,
  serializeToken,
  deserializeToken,
  getFileUploadData,
}
