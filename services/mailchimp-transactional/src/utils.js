function clean(obj) {
  const newObj = {}

  for (const propName in obj) {
    if (obj[propName] !== null && obj[propName] !== undefined) {
      newObj[propName] = obj[propName]
    }
  }

  return newObj
}

module.exports = {
  clean,
}
