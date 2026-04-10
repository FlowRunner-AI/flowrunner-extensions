const cleanupObject = data => {
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

function getLabel(name, extra) {
  if (name && extra) {
    return `${ name } (${ extra })`
  }

  return name || (extra ? `(${ extra })` : '[empty]')
}

function getStickerLabel({ image, top, left, zIndex }) {
  if (!image) {
    return '[empty]'
  }

  return `${ image } (top: ${ top }, left: ${ left }, zIndex: ${ zIndex })`
}

module.exports = {
  cleanupObject,
  searchFilter,
  getLabel,
  getStickerLabel,
}
