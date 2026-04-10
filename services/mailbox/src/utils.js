const promisify = fn => {
  return (...args) => {
    return new Promise((resolve, reject) => {
      fn(...args, (err, result) => {
        if (err) {
          return reject(err)
        }

        resolve(result)
      })
    })
  }
}

module.exports = {
  promisify,
}
