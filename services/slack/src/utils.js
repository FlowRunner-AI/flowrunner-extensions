// utils.js

/**
 * Splits a Markdown string into ≤max characters, preserving Slack formatting:
 *  • fenced code blocks (```...```) are treated atomically
 *  • inline code (`...`), bold/italics (**,*,_), strikethrough (~~), and links ([text](url))
 *    are never split across chunks
 *
 * @param {string} text The markdown string to chunk
 * @param {number} [max=3000] Max characters per chunk
 * @returns {string[]} Array of chunked markdown strings
 */
exports.chunkMarkdown = function chunkMarkdown(text, max = 3000) {
  // 1) Isolate fenced code blocks
  const fenceRe = /```[\s\S]*?```/g
  const segments = []
  let lastIndex = 0
  let m

  while ((m = fenceRe.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, m.index) })
    }

    segments.push({ type: 'code', content: m[0] })
    lastIndex = fenceRe.lastIndex
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) })
  }

  // 2) Helper: split plain-text segments safely, guarding inline markdown
  function splitTextSegment(str) {
    const mdDelims = ['**', '__', '~~', '`', '*', '_'].sort((a, b) => b.length - a.length)
    const delimCount = Object.fromEntries(mdDelims.map(d => [d, 0]))
    let bracketBalance = 0,
      parenBalance = 0
    const tokens = str.split(/(\s+)/)
    const out = []
    let curr = ''

    for (const tok of tokens) {
      const tokCounts = mdDelims.reduce((acc, d) => {
        const re = new RegExp(d.replace(/([.*+?^${}()|[\]\\/\\])/g, '\\$1'), 'g')
        acc[d] = (tok.match(re) || []).length

        return acc
      }, {})
      const tb = (tok.match(/\[/g) || []).length - (tok.match(/\]/g) || []).length
      const tp = (tok.match(/\(/g) || []).length - (tok.match(/\)/g) || []).length

      const nextLen = curr.length + tok.length
      const mdBalanced = Object.values(delimCount).every(c => c % 2 === 0)
      const linksBalanced = bracketBalance === 0 && parenBalance === 0

      if (nextLen > max && curr && mdBalanced && linksBalanced) {
        out.push(curr)
        curr = tok
        Object.assign(delimCount, tokCounts)
        bracketBalance = tb
        parenBalance = tp
      } else {
        curr += tok
        for (const d of mdDelims) delimCount[d] += tokCounts[d]
        bracketBalance += tb
        parenBalance += tp
      }
    }

    if (curr) out.push(curr)

    return out
  }

  // 3) Process each segment into raw chunks
  const rawChunks = []

  for (const seg of segments) {
    if (seg.type === 'code') {
      // Atomic code segment
      if (seg.content.length <= max) {
        rawChunks.push(seg.content)
      } else {
        // Split oversized code block by lines without rewrapping
        const lines = seg.content.split(/(?<=\n)/)
        let curr = ''

        for (const line of lines) {
          if (curr.length + line.length > max && curr) {
            rawChunks.push(curr)
            curr = line
          } else {
            curr += line
          }
        }

        if (curr) rawChunks.push(curr)
      }
    } else {
      rawChunks.push(...splitTextSegment(seg.content))
    }
  }

  // 4) Merge adjacent chunks when possible
  const merged = []

  for (const chunk of rawChunks) {
    if (merged.length > 0 && merged[merged.length - 1].length + chunk.length <= max) {
      merged[merged.length - 1] += chunk
    } else {
      merged.push(chunk)
    }
  }

  return merged
}
