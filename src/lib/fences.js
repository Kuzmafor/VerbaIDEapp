// Разбор markdown-ограждений с переменной длиной.
//
// Раньше разбор шёл по фиксированным трём обратным кавычкам, поэтому файл,
// внутри которого есть свой блок кода (README, инструкция, этот проект),
// обрезался на первом внутреннем ограждении — и записывался на диск урезанным.
// Ограждение из 4+ кавычек закрывается только таким же или более длинным.

const OPEN = /^(`{3,})([^`\n]*)$/

/**
 * Делит текст на куски { type: 'text' | 'code', info, code, closed }.
 * `info` — строка после кавычек (например `file:src/app.js`).
 */
export function splitFences(text) {
  const lines = String(text || '').split('\n')
  const out = []
  let buf = []
  let fence = null
  let info = ''

  const flushText = () => {
    if (buf.length) out.push({ type: 'text', code: buf.join('\n') })
    buf = []
  }

  for (const line of lines) {
    if (fence === null) {
      const m = line.match(OPEN)
      if (m) {
        flushText()
        fence = m[1]
        info = m[2].trim()
        continue
      }
      buf.push(line)
      continue
    }
    const closing = line.trim()
    if (/^`{3,}$/.test(closing) && closing.length >= fence.length) {
      out.push({ type: 'code', info, code: buf.join('\n'), closed: true })
      buf = []
      fence = null
      info = ''
      continue
    }
    buf.push(line)
  }

  if (fence !== null) out.push({ type: 'code', info, code: buf.join('\n'), closed: false })
  else flushText()
  return out
}

// Информационная строка блока: `file:path` или просто `path/to/file.js`.
export function blockPathFromInfo(info) {
  const first = String(info || '').trim().split(/\s+/)[0] || ''
  if (first.startsWith('file:')) {
    return { path: first.slice(5), lang: String(info).slice(first.length).trim() || null }
  }
  if (/^[\w.\-/\\]+\.[A-Za-z0-9]+$/.test(first)) return { path: first, lang: null }
  return null
}

export function normalizePath(path) {
  return String(path).replace(/\\/g, '/').replace(/^\.\//, '')
}
