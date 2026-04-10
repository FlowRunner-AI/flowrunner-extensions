function searchFilter(list, props, searchString) {
  const caseInsensitiveString = searchString.toLowerCase()

  return list.filter(item => props.some(prop => item[prop]?.toLowerCase().includes(caseInsensitiveString)))
}

function buildErrorMessage(error) {
  const { message, errors } = error.body
  let errorMessage = `MailerSend API error: ${ message }`

  if (Object.keys(errors).length > 1) {
    errorMessage += `: ${ JSON.stringify(errors) }`
  }

  return errorMessage
}

module.exports = {
  searchFilter,
  buildErrorMessage,
}
