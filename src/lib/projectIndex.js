import { isBinaryPath } from './fs'

const cache = new Map()

function tokens(value) {
  return [...new Set(String(value || '').toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || [])]
}

function chunks(path, text, size = 1500, overlap = 220) {
  const out = []
  for (let from = 0; from < text.length; from += size - overlap) {
    const value = text.slice(from, from + size)
    const line = text.slice(0, from).split('\n').length
    out.push({ path, line, text: value, words: tokens(path + ' ' + value) })
    if (from + size >= text.length) break
  }
  return out
}

export async function buildProjectIndex({ project, readFile, onProgress }) {
  if (!project) return []
  // В подписи учитываем сами пути, а не только их количество: правка файла
  // извне не меняла число файлов, и semantic_search отдавал устаревшие куски.
  const signature = `${project.id}:${(project.tree || []).map((t) => t.path).join('|').length}:${project.tree?.length || 0}`
  if (cache.has(signature)) return cache.get(signature)
  const docs = []
  const files = (project.tree || []).filter((x) => x.kind === 'file' && !isBinaryPath(x.path)).slice(0, 1200)
  for (let i = 0; i < files.length; i++) {
    try {
      const text = await readFile(files[i].path)
      if (text) docs.push(...chunks(files[i].path, text))
    } catch { /* unreadable/large file */ }
    if (i % 25 === 0) onProgress?.(i, files.length)
  }
  cache.set(signature, docs)
  return docs
}

export async function semanticSearchProject({ project, readFile, query, max = 12, onProgress }) {
  const docs = await buildProjectIndex({ project, readFile, onProgress })
  const wanted = tokens(query)
  if (!wanted.length) return []
  return docs.map((doc) => {
    const set = new Set(doc.words)
    let score = 0
    for (const word of wanted) {
      if (set.has(word)) score += 4
      else for (const candidate of set) {
        if (candidate.startsWith(word) || word.startsWith(candidate)) { score += 1.2; break }
      }
    }
    if (doc.path.toLowerCase().includes(String(query).toLowerCase())) score += 5
    return { ...doc, score }
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, max)
}

export function clearProjectIndex(projectId) {
  for (const key of cache.keys()) if (key.startsWith(projectId + ':')) cache.delete(key)
}
