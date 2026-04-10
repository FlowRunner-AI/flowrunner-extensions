function validateFields(fields) {
  Object.entries(fields).forEach(([field, value]) => {
    if (!value) {
      throw new Error(`'${ field }' is required`)
    }
  })
}

const OptionsShaper = {
  base: ({ id, name }) => ({ label: name || '[empty]', note: `ID: ${ id }`, value: id }),
  response: ({ responseId }) => ({ label: responseId || '[empty]', note: `ID: ${ responseId }`, value: responseId }),
}

function searchFilter(list, props, searchString) {
  return list.filter(item => props.some(prop => item[prop].includes(searchString)))
}

module.exports = {
  validateFields,
  OptionsShaper,
  searchFilter,
}
