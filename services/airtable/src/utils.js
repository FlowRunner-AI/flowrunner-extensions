function sha256(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount))
  }

  const mathPow = Math.pow
  const maxWord = mathPow(2, 32)
  let result = ''

  const words = []
  const asciiBitLength = ascii.length * 8

  let hash = (sha256.h = sha256.h || [])
  const k = (sha256.k = sha256.k || [])
  let primeCounter = k.length

  const isComposite = {}

  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate
      }

      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0
    }
  }

  ascii += '\x80'
  while ((ascii.length % 64) - 56) ascii += '\x00'

  for (let i = 0; i < ascii.length; i++) {
    const j = ascii.charCodeAt(i)
    if (j >> 8) return
    words[i >> 2] |= j << (((3 - i) % 4) * 8)
  }

  words[words.length] = (asciiBitLength / maxWord) | 0
  words[words.length] = asciiBitLength

  for (let j = 0; j < words.length;) {
    const w = words.slice(j, (j += 16))
    const oldHash = hash.slice(0)

    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15],
        w2 = w[i - 2]

      const a = hash[0],
        e = hash[4]

      const temp1 =
        (hash[7] +
          (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
          ((e & hash[5]) ^ (~e & hash[6])) +
          k[i] +
          (w[i] =
            i < 16
              ? w[i]
              : w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10)))) |
        0

      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]))

      hash = [(temp1 + temp2) | 0].concat(hash)
      hash[4] = (hash[4] + temp1) | 0
    }

    for (let i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0
    }
  }

  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255
      result += (b < 16 ? 0 : '') + b.toString(16)
    }
  }

  return result
}

function base64UrlEncode(byteArray) {
  const base64String = btoa(String.fromCharCode.apply(null, byteArray))

  return base64String
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function generateCodeVerifier() {
  const randomString = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

  let codeVerifier = ''

  for (let i = 0; i < 43; i++) {
    codeVerifier += randomString.charAt(Math.floor(Math.random() * randomString.length))
  }

  return codeVerifier
}

function generateCodeChallenge(codeVerifier) {
  const hash = sha256(codeVerifier)

  const byteArray = new Uint8Array(hash.match(/.{1,2}/g).map(byte => parseInt(byte, 16)))

  return base64UrlEncode(byteArray)
}

function searchFilter(list, props, searchString) {
  const caseInsensitiveString = searchString.toLowerCase()

  return list.filter(item => props.some(prop => item[prop]?.toLowerCase().includes(caseInsensitiveString)))
}

module.exports = {
  generateCodeVerifier,
  generateCodeChallenge,
  searchFilter,
}
