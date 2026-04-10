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

const transformFormData = (data, rootKey) => {
  const result = {}

  if (Array.isArray(data)) {
    data.forEach((item, index) => {
      const order = rootKey === 'questions' ? item.order : index

      if (order === null) {
        throw new Error(`Missing 'order' field in the item: ${ JSON.stringify(item) }`)
      }

      for (const key in item) {
        result[`${ rootKey }[${ order }][${ key }]`] = item[key]
      }
    })
  } else if (data && typeof data === 'object') {
    for (const key in data) {
      result[`${ rootKey }[${ key }]`] = data[key]
    }
  }

  return result
}

const groupFormDataByOrder = list => {
  const result = {}

  if (!Array.isArray(list)) {
    return result
  }

  list.forEach(item => {
    const order = item.order

    if (order == null) {
      throw new Error(`Missing 'order' field in the item: ${ JSON.stringify(item) }`)
    }

    result[order] = item
  })

  return result
}

module.exports = {
  cleanupObject,
  searchFilter,
  transformFormData,
  groupFormDataByOrder,
}
