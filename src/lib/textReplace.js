function parseReplaceQuery(query) {
  const value = String(query || '').trim()
  if (!value) return null
  const asRegex = value.match(/^\/(.+)\/([imsu]*)$/)
  if (!asRegex) return { kind: 'text', value }
  try {
    return { kind: 'regex', re: new RegExp(asRegex[1], asRegex[2] || 'i') }
  } catch {
    throw new Error('Некорректное регулярное выражение')
  }
}

export function replaceInText(content, query, replacement) {
  const parsed = parseReplaceQuery(query)
  if (!parsed) return { content, count: 0 }
  if (parsed.kind === 'regex') {
    const flags = parsed.re.flags.includes('g') ? parsed.re.flags : parsed.re.flags + 'g'
    const re = new RegExp(parsed.re.source, flags)
    let count = 0
    const next = String(content).replace(re, (...args) => {
      count++
      const match = args[0]
      return match.replace(new RegExp(re.source, re.flags.replace('g', '')), replacement)
    })
    return { content: next, count }
  }
  const needle = parsed.value
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  let count = 0
  return {
    content: String(content).replace(re, () => { count++; return replacement }),
    count,
  }
}
