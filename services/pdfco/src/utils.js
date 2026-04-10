function cleanupObject(data) {
  if (!data) {
    return
  }

  const result = {}

  Object.keys(data).forEach(key => {
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

module.exports = {
  cleanupObject,
  searchFilter,
}
