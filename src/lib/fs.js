import { idbGet, idbSet, idbDel } from './idb'

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
  '__pycache__', 'venv', '.venv', '.idea', '.vscode', '.gradle', 'target',
])

const BIN_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'avif', 'pdf',
  'zip', 'gz', 'tar', 'rar', '7z', 'exe', 'dll', 'so', 'dylib', 'apk',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'webm', 'mkv',
  'jar', 'class', 'pyc', 'wasm', 'bin', 'dat', 'db', 'sqlite',
])

const MAX_FILE = 400 * 1024 // 400 KB на файл при чтении

// path -> FileSystemFileHandle, живёт только в рамках сессии
let fileHandles = new Map()

export const supportsDirectoryPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window

export function extOf(path) {
  const m = path.match(/\.([A-Za-z0-9]+)$/)
  return m ? m[1].toLowerCase() : ''
}

export function isBinaryPath(path) {
  return BIN_EXT.has(extOf(path))
}

export async function pickDirectory() {
  if (!supportsDirectoryPicker) {
    throw new Error('Браузер не поддерживает выбор папок. Нужен Chrome (Android/desktop) или Edge.')
  }
  return window.showDirectoryPicker({ mode: 'readwrite' })
}

export async function buildTree(rootHandle) {
  fileHandles = new Map()
  const out = []
  await walk(rootHandle, '', 0, out)
  out.sort((a, b) => a.path.localeCompare(b.path))
  return out
}

async function walk(dir, prefix, depth, out) {
  if (depth > 6 || out.length > 4000) return
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory') {
      if (IGNORE_DIRS.has(entry.name)) continue
      const p = prefix ? prefix + '/' + entry.name : entry.name
      out.push({ path: p, kind: 'dir' })
      await walk(entry, p, depth + 1, out)
    } else {
      const p = prefix ? prefix + '/' + entry.name : entry.name
      out.push({ path: p, kind: 'file' })
      fileHandles.set(p, entry)
    }
  }
}

export async function readFile(path) {
  const h = fileHandles.get(path)
  if (!h) throw new Error('Файл не найден: ' + path)
  const f = await h.getFile()
  if (f.size > MAX_FILE) throw new Error('Файл слишком большой (>400 KB)')
  if (isBinaryPath(path)) throw new Error('Бинарный файл нельзя открыть как текст')
  return f.text()
}

// Чтение напрямую по handle, без опоры на кэш fileHandles. Кэш заполняется
// только buildTree(), а при восстановлении проекта из IndexedDB дерево уже
// готовое и readFile() бросил бы «файл не найден».
export async function readFileFromRoot(rootHandle, path) {
  const parts = String(path || '').split('/').filter(Boolean)
  if (!parts.length) throw new Error('Путь к файлу не указан')
  let dir = rootHandle
  for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i])
  const fh = await dir.getFileHandle(parts[parts.length - 1])
  const f = await fh.getFile()
  if (f.size > MAX_FILE) throw new Error('Файл слишком большой (>400 KB)')
  return f.text()
}

export async function writeFile(rootHandle, path, content) {
  const parts = path.split('/')
  let dir = rootHandle
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true })
  }
  const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true })
  const w = await fh.createWritable()
  await w.write(content)
  await w.close()
  fileHandles.set(path, fh)
}

export async function removeFile(rootHandle, path) {
  const parts = path.split('/')
  let dir = rootHandle
  for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i])
  await dir.removeEntry(parts[parts.length - 1])
  fileHandles.delete(path)
}

// Импорт выбранных через <input> файлов в виртуальный проект { path: content }.
// Бинарные, слишком большие и не влезшие в общий лимит файлы помечаются null:
// пустую строку не отличить от реального содержимого, из-за чего такие файлы
// уезжали в коммит обнулёнными.
export async function importFileList(fileList, { maxTotal = 3 * 1024 * 1024 } = {}) {
  const files = {}
  let total = 0
  for (const f of fileList) {
    const rel = f.webkitRelativePath || f.name
    if (isBinaryPath(rel) || f.size > MAX_FILE || total + f.size > maxTotal) {
      files[rel] = null
      continue
    }
    const text = await f.text()
    files[rel] = text
    total += f.size
  }
  return files
}

export function treeFromFiles(filesObj) {
  return Object.keys(filesObj)
    .map((p) => ({ path: p, kind: 'file' }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

// ---------- проекты: список, хранение, переключение ----------

const pk = (id, key) => `project:${id}:${key}`

export async function listProjects() {
  return (await idbGet('projectsIndex')) || []
}

// добавляет/обновляет запись и возвращает обновлённый индекс (не более 12 проектов)
export async function saveProjectRecord(rec) {
  const index = await listProjects()
  const entry = { ...rec, savedAt: Date.now() }
  const i = index.findIndex((p) => p.id === rec.id)
  if (i >= 0) index[i] = { ...index[i], ...entry }
  else index.unshift(entry)
  index.sort((a, b) => b.savedAt - a.savedAt)
  const capped = index.slice(0, 12)
  await idbSet('projectsIndex', capped)
  return capped
}

export async function removeProjectData(id) {
  const index = await listProjects()
  await idbSet('projectsIndex', index.filter((p) => p.id !== id))
  for (const k of ['meta', 'vfiles', 'vbase', 'handle']) await idbDel(pk(id, k))
}

// Загружает данные проекта; для папки на диске проверяет разрешение
export async function loadProjectById(id) {
  const meta = await idbGet(pk(id, 'meta'))
  if (!meta) return null
  if (meta.type === 'handle') {
    const handle = await idbGet(pk(id, 'handle'))
    if (!handle) return null
    const perm = await handle.queryPermission({ mode: 'readwrite' })
    const tree = perm === 'granted' ? await buildTree(handle) : []
    return { id, meta, handle, granted: perm === 'granted', tree }
  }
  const files = (await idbGet(pk(id, 'vfiles'))) || {}
  const base = (await idbGet(pk(id, 'vbase'))) || files
  return { id, meta, files, base, tree: treeFromFiles(files) }
}

export async function persistVirtualProject(id, files, name, github, baseFiles) {
  try {
    await idbSet(pk(id, 'vfiles'), files)
  } catch (e) {
    console.warn('vfiles не влезли в IndexedDB', e)
  }
  try {
    await idbSet(pk(id, 'vbase'), baseFiles || files)
  } catch (e) {
    console.warn('vbase не влезли в IndexedDB', e)
  }
  await idbSet(pk(id, 'meta'), { type: 'virtual', name, github: github || null })
}

export async function persistHandleProject(id, handle, name) {
  await idbSet(pk(id, 'handle'), handle)
  await idbSet(pk(id, 'meta'), { type: 'handle', name })
}

export async function getActiveProjectId() {
  return (await idbGet('activeProjectId')) || null
}

export async function setActiveProjectId(id) {
  await idbSet('activeProjectId', id)
}

// Разовый перенос старого формата (один проект в глобальных ключах)
export async function migrateLegacyProject() {
  const index = await listProjects()
  if (index.length) return
  const old = await idbGet('projectMeta')
  if (!old) return
  const id = 'p_legacy_' + String(old.name || 'proj').replace(/\W+/g, '_').toLowerCase()
  if (old.type === 'virtual') {
    const files = (await idbGet('vfiles')) || {}
    const base = (await idbGet('vbase')) || files
    await persistVirtualProject(id, files, old.name, old.github || null, base)
  } else {
    const h = await idbGet('rootHandle')
    if (!h) {
      await idbDel('projectMeta')
      return
    }
    await persistHandleProject(id, h, old.name)
  }
  await setActiveProjectId(id)
  for (const k of ['projectMeta', 'vfiles', 'vbase', 'rootHandle']) await idbDel(k)
}
