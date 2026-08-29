// Поиск по текстовым файлам проекта.
// `/шаблон/флаги` трактуется как регулярное выражение, всё остальное — как
// обычная подстрока без учёта регистра. Раньше любой запрос уходил в RegExp,
// поэтому точка, скобки и вертикальная черта работали не так, как ожидалось,
// а запрос вида /store/ искался буквально вместе со слэшами.

import { isBinaryPath } from './fs'

export function parseQuery(query) {
  const q = String(query || '').trim()
  if (!q) return null
  const asRegex = q.match(/^\/(.+)\/([imsu]*)$/)
  if (asRegex) {
    try {
      return { kind: 'regex', re: new RegExp(asRegex[1], asRegex[2] || 'i') }
    } catch {
      return { kind: 'error', message: 'Некорректное регулярное выражение' }
    }
  }
  return { kind: 'text', lower: q.toLowerCase() }
}

export async function searchInProject({ tree, readFile, query, max = 200 }) {
  const parsed = parseQuery(query)
  if (!parsed || parsed.kind === 'error') return []
  const out = []
  const files = (tree || []).filter((t) => t.kind === 'file' && !isBinaryPath(t.path)).slice(0, 400)
  for (const t of files) {
    if (out.length >= max) break
    let content = ''
    try {
      content = await readFile(t.path)
    } catch {
      continue
    }
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (parsed.kind === 'regex') parsed.re.lastIndex = 0
      const hit = parsed.kind === 'regex'
        ? parsed.re.test(lines[i])
        : lines[i].toLowerCase().includes(parsed.lower)
      if (hit) {
        out.push({ path: t.path, line: i + 1, text: lines[i].trim().slice(0, 200) })
        if (out.length >= max) break
      }
    }
  }
  return out
}
