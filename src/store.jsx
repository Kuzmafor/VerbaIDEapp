import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { loadSettings, saveSettings, loadChats, saveChats, uid } from './lib/storage'
import * as fs from './lib/fs'
import {
  cloneRepo, pushToGitHub as ghPush, createPullRequest, parseRepoInput,
  fetchAccount, listUserRepos, listBranches, listCommits, listCommitChecks, createBranch as ghCreateBranch, createRepository as ghCreateRepository, listIssues as ghListIssues, createIssue as ghCreateIssue,
} from './lib/github'
import { extractExternalFile } from './lib/fileExtract'
import { clearProjectIndex } from './lib/projectIndex'
import { findTemplate } from './lib/templates'

const Ctx = createContext(null)
export const useStore = () => useContext(Ctx)

export function StoreProvider({ children }) {
  const [initChats] = useState(() => loadChats())
  const [settings, setSettings] = useState(loadSettings)
  const [chats, setChats] = useState(initChats)
  const [activeChatId, setActiveChatId] = useState(initChats[0]?.id ?? null)
  const [project, setProjectState] = useState(null)
  const [page, setPage] = useState('chat') // chat | files | plugins | settings
  const [menuOpen, setMenuOpen] = useState(false)
  const [projects, setProjects] = useState([]) // список сохранённых проектов
  const [ready, setReady] = useState(false) // загрузочный экран
  const [toastMsg, setToastMsg] = useState(null)
  const [canvasSelection, setCanvasSelection] = useState(null)
  const [composerDraft, setComposerDraft] = useState('')
  const [tasks, setTasks] = useState(() => loadSettings().taskQueue || [])
  const toastTimer = useRef(null)
  const projectRef = useRef(null)

  // Функции ниже вызываются подряд в одном обработчике (записать файл → обновить
  // дерево → запушить), поэтому читать project из замыкания нельзя: setState
  // применится только к следующему рендеру, и второй вызов затрёт первый.
  // projectRef обновляется синхронно и служит источником истины внутри функций.
  const setProject = (next) => {
    const value = typeof next === 'function' ? next(projectRef.current) : next
    projectRef.current = value
    setProjectState(value)
  }
  const cur = () => projectRef.current

  // восстановление последнего проекта + списка проектов
  useEffect(() => {
    ;(async () => {
      try {
        await fs.migrateLegacyProject()
        const idx = await fs.listProjects()
        setProjects(idx)
        const activeId = await fs.getActiveProjectId()
        if (activeId && idx.some((p) => p.id === activeId)) await loadProjectById(activeId)
      } catch (e) {
        console.warn('restore', e)
      } finally {
        // загрузочный экран держится 3+ секунды
        setTimeout(() => setReady(true), 3200)
      }
    })()
  }, [])

  const loadProjectById = async (id) => {
    const data = await fs.loadProjectById(id)
    if (!data) {
      toast('Проект не найден')
      return false
    }
    if (data.meta.type === 'handle') {
      setProject({
        id, type: 'handle', name: data.meta.name, github: data.meta.github || null,
        handle: data.handle, tree: data.tree, needsPermission: !data.granted, writable: true,
      })
    } else {
      setProject({
        id, type: 'virtual', name: data.meta.name, github: data.meta.github || null,
        tree: data.tree, files: data.files, baseFiles: data.base, writable: true,
      })
    }
    await fs.setActiveProjectId(id)
    return true
  }

  const switchProject = async (id) => {
    setMenuOpen(false)
    if (cur()?.id === id) {
      setPage('files')
      return
    }
    const ok = await loadProjectById(id)
    if (ok) {
      toast('Проект: ' + (projects.find((p) => p.id === id)?.name || id))
      setPage('files')
    }
  }

  const deleteProject = async (id) => {
    await fs.removeProjectData(id)
    setProjects(await fs.listProjects())
    if (cur()?.id === id) setProject(null)
    toast('Проект удалён из списка')
  }

  // персист настроек и чатов
  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    setSettings((s) => ({ ...s, taskQueue: tasks.filter((t) => !['done', 'cancelled'].includes(t.status)).slice(-20) }))
  }, [tasks])

  const addTask = (task) => {
    const next = { id: uid(), createdAt: Date.now(), status: 'queued', step: 'В очереди', ...task }
    setTasks((all) => [...all, next])
    return next
  }
  const patchTask = (id, patch) => setTasks((all) => all.map((t) => t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t))
  const removeTask = (id) => setTasks((all) => all.filter((t) => t.id !== id))

  useEffect(() => {
    const t = setTimeout(() => saveChats(chats), 300)
    return () => clearTimeout(t)
  }, [chats])

  const toast = (msg) => {
    clearTimeout(toastTimer.current)
    setToastMsg(msg)
    toastTimer.current = setTimeout(() => setToastMsg(null), 2800)
  }

  const selectedProvider = () =>
    settings.providers.find((p) => p.id === settings.selected?.providerId) || null

  // Выбор модели запоминается на проект: для разных проектов логично держать
  // разные модели, а глобальный выбор приходилось переключать вручную.
  const selectModel = (providerId, model) => {
    setSettings((s) => {
      const next = { ...s, selected: { providerId, model } }
      const id = cur()?.id
      if (id) next.projectModels = { ...(s.projectModels || {}), [id]: { providerId, model } }
      return next
    })
  }

  useEffect(() => {
    const id = project?.id
    if (!id) return
    const saved = settings.projectModels?.[id]
    if (!saved) return
    const known = settings.providers.find((p) => p.id === saved.providerId && p.models.includes(saved.model))
    if (!known) return
    if (settings.selected?.providerId === saved.providerId && settings.selected?.model === saved.model) return
    setSettings((s) => ({ ...s, selected: { providerId: saved.providerId, model: saved.model } }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, settings.providers])

  // ---------- проект ----------

  const applyHandleProject = async (handle) => {
    const id = uid()
    const tree = await fs.buildTree(handle)
    setProject({ id, type: 'handle', name: handle.name, github: null, handle, tree, writable: true })
    await fs.persistHandleProject(id, handle, handle.name)
    setProjects(await fs.saveProjectRecord({ id, name: handle.name, type: 'handle' }))
    await fs.setActiveProjectId(id)
    toast('Папка открыта: ' + handle.name)
  }

  const openFolder = async () => {
    try {
      if (fs.supportsDirectoryPicker) {
        const handle = await fs.pickDirectory()
        await applyHandleProject(handle)
      } else {
        // запасной вариант — <input webkitdirectory>, только чтение
        pickersRef.current?.pickFolder()
      }
    } catch (e) {
      if (e?.name !== 'AbortError') toast(e.message)
    }
  }

  const grantPermission = async () => {
    const proj = cur()
    if (!proj?.handle) return
    try {
      const perm = await proj.handle.requestPermission({ mode: 'readwrite' })
      if (perm === 'granted') {
        const tree = await fs.buildTree(proj.handle)
        setProject({ ...cur(), tree, needsPermission: false })
      } else {
        toast('Доступ не выдан')
      }
    } catch (e) {
      toast(e.message)
    }
  }

  const openFolderVirtual = async (fileList) => {
    const files = await fs.importFileList(fileList)
    const first = fileList[0]?.webkitRelativePath || ''
    const name = first.includes('/') ? first.split('/')[0] : 'Папка'
    const id = uid()
    setProject({
      id, type: 'virtual', name, tree: fs.treeFromFiles(files), files,
      baseFiles: files, github: null, writable: true,
    })
    await fs.persistVirtualProject(id, files, name, null, files)
    setProjects(await fs.saveProjectRecord({ id, name, type: 'virtual' }))
    await fs.setActiveProjectId(id)
    toast('Папка загружена: ' + name + ' (только чтение диска недоступно)')
  }

  const addFilesExternal = async (fileList) => {
    const out = []
    for (const f of fileList) {
      try {
        out.push(await extractExternalFile(f))
      } catch (e) {
        toast(e.message || `Не удалось прочитать ${f.name}`)
      }
    }
    return out
  }

  const closeProject = async () => {
    // проект остаётся в списке «Проекты», просто закрываем его
    setProject(null)
    await fs.setActiveProjectId(null)
    toast('Проект закрыт')
  }

  // --- аккаунт GitHub (локально, по personal access token) ---

  // Старая версия хранила только settings.githubToken — используем его как токен
  // уже подключённого аккаунта, чтобы push не отвалился после обновления.
  const githubToken = () => settings.github?.token || (settings.githubToken || '').trim() || ''

  const connectGitHub = async (token) => {
    try {
      const account = await fetchAccount(token)
      setSettings((s) => ({ ...s, github: account, githubToken: '' }))
      toast('GitHub подключён: @' + account.login)
      return true
    } catch (e) {
      toast('GitHub: ' + e.message)
      return false
    }
  }

  const disconnectGitHub = () => {
    setSettings((s) => ({ ...s, github: null, githubToken: '' }))
    toast('Аккаунт GitHub отключён')
  }

  // Токен из старой версии превращаем в подключённый аккаунт, чтобы после
  // обновления не пришлось подключаться заново.
  useEffect(() => {
    const legacy = (settings.githubToken || '').trim()
    if (!legacy || settings.github) return
    let cancelled = false
    ;(async () => {
      try {
        const account = await fetchAccount(legacy)
        if (!cancelled) setSettings((s) => ({ ...s, github: account, githubToken: '' }))
      } catch {
        if (!cancelled) setSettings((s) => ({ ...s, githubToken: '' }))
      }
    })()
    return () => { cancelled = true }
  }, [settings.githubToken, settings.github])

  const fetchMyRepos = async () => {
    const token = githubToken()
    if (!token) {
      toast('Сначала подключите аккаунт GitHub')
      return null
    }
    try {
      return await listUserRepos(token, (m) => toast(m))
    } catch (e) {
      toast('GitHub: ' + e.message)
      return null
    }
  }

  const fetchBranches = async (owner, repo) => {
    try {
      return await listBranches({ token: githubToken(), owner, repo })
    } catch (e) {
      toast('GitHub: ' + e.message)
      return null
    }
  }

  // Принимает либо строку (owner/repo или ссылка), либо { owner, repo } из списка аккаунта.
  const cloneFromGitHub = async (target, branch) => {
    try {
      const source = typeof target === 'string' ? { input: target } : { owner: target.owner, repo: target.repo }
      const { name, owner, repo, branch: br, files } = await cloneRepo({
        ...source,
        branch,
        token: githubToken(),
        onProgress: (m) => toast(m),
      })
      const github = { owner, repo, branch: br }
      const id = uid()
      setProject({
        id, type: 'virtual', name, tree: fs.treeFromFiles(files), files,
        baseFiles: { ...files }, github, writable: true,
      })
      await fs.persistVirtualProject(id, files, name, github, files)
      setProjects(await fs.saveProjectRecord({ id, name, type: 'virtual', github }))
      await fs.setActiveProjectId(id)
      toast('Репозиторий загружен: ' + name)
      return true
    } catch (e) {
      toast('GitHub: ' + e.message)
      return false
    }
  }

  // привязать виртуальный проект к репозиторию для push
  const linkGitHub = async (repoStr, branch) => {
    if (cur()?.type !== 'virtual') {
      toast('GitHub доступен для загруженных проектов (память)')
      return false
    }
    const parsed = parseRepoInput(repoStr || '')
    if (!parsed) {
      toast('Формат: owner/repo или ссылка')
      return false
    }
    const github = { owner: parsed.owner, repo: parsed.repo, branch: (branch || '').trim() || 'main' }
    const proj = { ...cur(), github }
    setProject(proj)
    await fs.persistVirtualProject(proj.id, proj.files, proj.name, github, proj.baseFiles)
    setProjects(await fs.saveProjectRecord({ id: proj.id, github }))
    toast('Проект связан с ' + github.owner + '/' + github.repo)
    return true
  }

  // отличия текущих файлов от состояния на момент загрузки/последнего push
  const changedFiles = () => {
    const proj = cur()
    if (proj?.type !== 'virtual' || !proj.files) return []
    const base = proj.baseFiles || {}
    const out = []
    for (const path of new Set([...Object.keys(proj.files), ...Object.keys(base)])) {
      const content = proj.files[path]
      // Бинарные и слишком большие файлы лежат в проекте как заглушки без
      // содержимого — отправлять их в коммит нельзя, иначе они обнулятся.
      if (content === null) continue
      if (content === undefined) out.push({ path, status: 'deleted', content: null })
      else if (base[path] === undefined) out.push({ path, status: 'new', content })
      else if (base[path] !== content) out.push({ path, status: 'modified', content })
    }
    return out
  }

  const pushToGitHub = async ({ message, createPR, baseBranch }) => {
    const g = cur()?.github
    if (!g) {
      toast('Проект не связан с репозиторием')
      return false
    }
    const token = githubToken()
    if (!token) {
      toast('Подключите аккаунт GitHub в настройках')
      return false
    }
    const staged = settings.gitStaging?.[cur()?.id]
    const changes = changedFiles().filter((f) => !staged || staged[f.path])
    if (!changes.length) {
      toast('Нет изменённых файлов')
      return false
    }
    try {
      const res = await ghPush({
        owner: g.owner, repo: g.repo, branch: g.branch, token, changes,
        message: (message || '').trim() || 'Update from VerbaIDE',
        onProgress: (m) => toast(m),
      })
      const proj = { ...cur(), baseFiles: { ...cur().files } }
      setProject(proj)
      setSettings((s) => ({ ...s, gitStaging: { ...(s.gitStaging || {}), [proj.id]: {} } }))
      await fs.persistVirtualProject(proj.id, proj.files, proj.name, proj.github, proj.baseFiles)
      toast('Запушено: ' + res.sha.slice(0, 7))
      if (createPR) {
        const base = (baseBranch || 'main').trim()
        if (base && base !== g.branch) {
          const pr = await createPullRequest({
            owner: g.owner, repo: g.repo, token,
            head: g.branch, base,
            title: (message || '').trim() || 'PR from VerbaIDE',
            body: 'Изменения из VerbaIDE (мобильная IDE).',
          })
          toast('PR создан #' + pr.number)
        }
      }
      return true
    } catch (e) {
      toast('GitHub: ' + e.message)
      return false
    }
  }

  const refreshTree = async () => {
    const proj = cur()
    if (proj?.type === 'handle' && proj.handle) {
      const tree = await fs.buildTree(proj.handle)
      setProject({ ...cur(), tree })
    } else if (proj?.type === 'virtual') {
      setProject((p) => ({ ...p, tree: fs.treeFromFiles(p.files) }))
    }
  }

  const projectHasFile = (path) =>
    !!cur()?.tree?.some((t) => t.kind === 'file' && t.path === path)

  const readFile = async (path) => {
    const proj = cur()
    if (proj?.type === 'handle') return fs.readFile(path)
    if (proj?.type === 'virtual') {
      if (!(path in proj.files)) throw new Error('Файл не найден: ' + path)
      const content = proj.files[path]
      if (content === null) throw new Error('Файл не текстовый или слишком большой: ' + path)
      return content
    }
    throw new Error('Проект не открыт')
  }

  const writeFile = async (path, content) => {
    const proj = cur()
    if (proj?.type === 'handle') {
      await fs.writeFile(proj.handle, path, content)
    } else if (proj?.type === 'virtual') {
      const files = { ...proj.files, [path]: content }
      setProject({ ...proj, files, tree: fs.treeFromFiles(files) })
      await fs.persistVirtualProject(proj.id, files, proj.name, proj.github, proj.baseFiles)
    } else {
      throw new Error('Проект не открыт — некуда сохранять')
    }
    if (proj?.id) clearProjectIndex(proj.id)
  }

  const pullFromGitHub = async ({ force = false } = {}) => {
    const proj = cur()
    if (proj?.type !== 'virtual' || !proj.github) { toast('Откройте связанный виртуальный GitHub-проект'); return null }
    try {
      const remote = await cloneRepo({ owner: proj.github.owner, repo: proj.github.repo, branch: proj.github.branch, token: githubToken(), onProgress: (m) => toast(m) })
      const base = proj.baseFiles || {}; const local = proj.files || {}; const paths = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote.files)])
      const conflicts = [...paths].filter((path) => local[path] !== base[path] && remote.files[path] !== base[path] && local[path] !== remote.files[path])
      if (conflicts.length && !force) return { conflicts }
      const files = force ? remote.files : { ...remote.files }
      if (!force) for (const path of paths) if (local[path] !== base[path]) files[path] = local[path]
      const next = { ...proj, files, baseFiles: { ...remote.files }, tree: fs.treeFromFiles(files) }
      setProject(next); await fs.persistVirtualProject(next.id, files, next.name, next.github, next.baseFiles)
      toast(force ? 'Версия с GitHub применена' : 'Изменения с GitHub получены')
      return { conflicts: [] }
    } catch (e) { toast('GitHub: ' + e.message); return null }
  }

  const checkoutGitBranch = async (branch) => {
    const proj = cur(); if (proj?.type !== 'virtual' || !proj.github || !branch) return false
    if (changedFiles().length) { toast('Сначала закоммитьте, stash или отмените локальные изменения'); return false }
    try {
      const remote = await cloneRepo({ owner: proj.github.owner, repo: proj.github.repo, branch, token: githubToken(), onProgress: (m) => toast(m) })
      const next = { ...proj, files: remote.files, baseFiles: { ...remote.files }, tree: fs.treeFromFiles(remote.files), github: { ...proj.github, branch } }
      setProject(next); await fs.persistVirtualProject(next.id, next.files, next.name, next.github, next.baseFiles)
      toast('Открыта ветка: ' + branch); return true
    } catch (e) { toast('GitHub: ' + e.message); return false }
  }

  const stashGitChanges = async () => {
    const proj = cur(); if (proj?.type !== 'virtual') { toast('Stash доступен для виртуального проекта'); return false }
    const changed = changedFiles(); if (!changed.length) { toast('Нет изменений для stash'); return false }
    const stash = { id: uid(), createdAt: Date.now(), files: { ...proj.files }, label: `Изменений: ${changed.length}` }
    setSettings((s) => ({ ...s, gitStashes: { ...(s.gitStashes || {}), [proj.id]: [stash, ...(s.gitStashes?.[proj.id] || [])].slice(0, 8) } }))
    const next = { ...proj, files: { ...proj.baseFiles }, tree: fs.treeFromFiles(proj.baseFiles) }
    setProject(next); await fs.persistVirtualProject(next.id, next.files, next.name, next.github, next.baseFiles)
    toast('Изменения сохранены в stash'); return true
  }
  const applyGitStash = async (stashId) => {
    const proj = cur(); const stash = (settings.gitStashes?.[proj?.id] || []).find((item) => item.id === stashId)
    if (!proj || !stash) return false
    const next = { ...proj, files: { ...stash.files }, tree: fs.treeFromFiles(stash.files) }
    setProject(next); await fs.persistVirtualProject(next.id, next.files, next.name, next.github, next.baseFiles)
    setSettings((s) => ({ ...s, gitStashes: { ...(s.gitStashes || {}), [proj.id]: (s.gitStashes?.[proj.id] || []).filter((item) => item.id !== stashId) } }))
    toast('Stash восстановлен'); return true
  }

  const createTemplateProject = async (templateId, name) => {
    const template = findTemplate(templateId)
    const files = { ...template.files }
    const projectName = String(name || '').trim() || template.title
    const id = uid()
    setProject({ id, type: 'virtual', name: projectName, tree: fs.treeFromFiles(files), files, baseFiles: { ...files }, github: null, writable: true })
    await fs.persistVirtualProject(id, files, projectName, null, files)
    setProjects(await fs.saveProjectRecord({ id, name: projectName, type: 'virtual', templateId }))
    await fs.setActiveProjectId(id)
    setPage('files')
    toast('Создан проект: ' + projectName)
    return true
  }

  const fetchCommits = async (owner, repo, branch) => {
    try { return await listCommits({ token: githubToken(), owner, repo, branch }) }
    catch (e) { toast('GitHub: ' + e.message); return null }
  }
  const fetchCommitChecks = async (owner, repo, ref) => {
    try { return await listCommitChecks({ token: githubToken(), owner, repo, ref }) }
    catch (e) { toast('GitHub: ' + e.message); return null }
  }

  const createGitBranch = async (name) => {
    const proj = cur()
    if (!proj?.github || !name?.trim()) return false
    try {
      const branch = await ghCreateBranch({ token: githubToken(), owner: proj.github.owner, repo: proj.github.repo, fromBranch: proj.github.branch, name: name.trim() })
      setProject({ ...proj, github: { ...proj.github, branch } })
      toast('Создана ветка: ' + branch)
      return true
    } catch (e) { toast('GitHub: ' + e.message); return false }
  }

  const repositoryStatus = () => {
    const proj = cur()
    if (!proj?.github) throw new Error('откройте проект, связанный с GitHub-репозиторием')
    return {
      repository: `${proj.github.owner}/${proj.github.repo}`,
      branch: proj.github.branch,
      changes: changedFiles().map(({ path, status }) => ({ path, status })),
    }
  }

  const createGitPullRequest = async ({ title, body, baseBranch }) => {
    const proj = cur()
    if (!proj?.github) throw new Error('проект не связан с GitHub-репозиторием')
    const token = githubToken()
    if (!token) throw new Error('подключите аккаунт GitHub в настройках')
    const base = String(baseBranch || '').trim()
    if (!base) throw new Error('укажите целевую ветку Pull Request')
    if (base === proj.github.branch) throw new Error('целевая ветка должна отличаться от текущей')
    const pr = await createPullRequest({
      owner: proj.github.owner,
      repo: proj.github.repo,
      token,
      head: proj.github.branch,
      base,
      title: String(title || '').trim() || 'PR from VerbaIDE',
      body: String(body || '').trim() || 'Изменения из VerbaIDE (мобильная IDE).',
    })
    toast('PR создан #' + pr.number)
    return { number: pr.number, url: pr.html_url || '' }
  }

  const createGitHubRepository = async ({ name, description, isPrivate }) => {
    const token = githubToken(); if (!token) throw new Error('подключите аккаунт GitHub в настройках')
    const remote = await ghCreateRepository({ token, name, description, isPrivate })
    const proj = cur()
    if (proj?.type === 'virtual') {
      const next = { ...proj, github: { owner: remote.owner, repo: remote.repo, branch: remote.branch } }
      setProject(next); await fs.persistVirtualProject(next.id, next.files, next.name, next.github, next.baseFiles)
    }
    toast('Репозиторий создан: ' + remote.owner + '/' + remote.repo)
    return remote
  }
  const fetchGitIssues = async ({ state = 'open' } = {}) => {
    const proj = cur(); if (!proj?.github) throw new Error('проект не связан с GitHub-репозиторием')
    return ghListIssues({ token: githubToken(), owner: proj.github.owner, repo: proj.github.repo, state })
  }
  const createGitIssue = async ({ title, body }) => {
    const proj = cur(); if (!proj?.github) throw new Error('проект не связан с GitHub-репозиторием')
    const issue = await ghCreateIssue({ token: githubToken(), owner: proj.github.owner, repo: proj.github.repo, title, body })
    toast('Issue создан #' + issue.number); return { number: issue.number, url: issue.html_url || '' }
  }

  const deleteFile = async (path) => {
    const proj = cur()
    if (proj?.type === 'handle') {
      await fs.removeFile(proj.handle, path)
      setProject({ ...proj, tree: proj.tree.filter((item) => item.path !== path) })
    } else if (proj?.type === 'virtual') {
      if (!(path in proj.files)) throw new Error('Файл не найден: ' + path)
      const files = { ...proj.files }
      delete files[path]
      setProject({ ...proj, files, tree: fs.treeFromFiles(files) })
      await fs.persistVirtualProject(proj.id, files, proj.name, proj.github, proj.baseFiles)
    } else {
      throw new Error('Проект не открыт')
    }
    if (proj?.id) clearProjectIndex(proj.id)
  }

  const moveFile = async (from, to) => {
    const proj = cur()
    if (!proj) throw new Error('Проект не открыт')
    if (projectHasFile(to)) throw new Error('Файл уже существует: ' + to)
    const content = await readFile(from)
    if (proj.type === 'handle') {
      await fs.writeFile(proj.handle, to, content)
      await fs.removeFile(proj.handle, from)
      const tree = await fs.buildTree(proj.handle)
      setProject({ ...proj, tree })
    } else {
      const files = { ...proj.files, [to]: content }
      delete files[from]
      setProject({ ...proj, files, tree: fs.treeFromFiles(files) })
      await fs.persistVirtualProject(proj.id, files, proj.name, proj.github, proj.baseFiles)
    }
    if (proj.id) clearProjectIndex(proj.id)
  }

  // ---------- чаты ----------

  const newChat = () => {
    const c = { id: uid(), title: 'Новый чат', messages: [], ts: Date.now() }
    setChats((p) => [c, ...p.filter((x) => x.messages.length > 0)])
    setActiveChatId(c.id)
    setPage('chat')
    setMenuOpen(false)
    return c
  }

  const deleteChat = (id) => {
    // Раньше активный чат просто сбрасывался в null и экран прыгал на пустой
    // «Новый чат», хотя в истории оставались другие.
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== id)
      if (activeChatId === id) {
        const idx = prev.findIndex((c) => c.id === id)
        setActiveChatId(next[Math.min(idx, next.length - 1)]?.id ?? null)
      }
      return next
    })
  }

  const clearChats = () => {
    setChats([])
    setActiveChatId(null)
    toast('История чатов очищена')
  }

  const pickersRef = useRef(null)

  const value = {
    settings, setSettings,
    chats, setChats, activeChatId, setActiveChatId,
    project, setProject, projects,
    page, setPage, menuOpen, setMenuOpen,
    ready,
    canvasSelection, setCanvasSelection, composerDraft, setComposerDraft,
    toastMsg, toast,
    selectedProvider, selectModel,
    openFolder, grantPermission, openFolderVirtual, createTemplateProject, addFilesExternal, closeProject, refreshTree,
    cloneFromGitHub, linkGitHub, changedFiles, pushToGitHub, pullFromGitHub, checkoutGitBranch, stashGitChanges, applyGitStash, fetchCommits, fetchCommitChecks, createGitBranch, repositoryStatus, createGitPullRequest,
    connectGitHub, disconnectGitHub, fetchMyRepos, fetchBranches, githubToken, createGitHubRepository, fetchGitIssues, createGitIssue,
    tasks, addTask, patchTask, removeTask,
    switchProject, deleteProject,
    projectHasFile, readFile, writeFile, deleteFile, moveFile,
    newChat, deleteChat, clearChats,
    pickersRef,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
