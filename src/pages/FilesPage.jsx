import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import {
  IconFolder, IconFile, IconChevronDown, IconRefresh, IconPlus,
  IconClose, IconBack, IconUpload, IconBranch, IconPlay, IconCommit, IconSearch, IconGitHub,
} from '../components/Icons'
import { isBinaryPath } from '../lib/fs'
import { searchInProject } from '../lib/search'
import { replaceInText } from '../lib/textReplace'
import { findEntry, buildPreview } from '../lib/preview'
import CodeEditor from '../components/CodeEditor'
import ConfirmSheet from '../components/ConfirmSheet'
import { runProjectCommand } from '../lib/commandBridge'
import { PROJECT_TEMPLATES } from '../lib/templates'

// плоский список путей -> вложенное дерево
function buildNested(flat) {
  const root = { children: [] }
  for (const { path, kind } of flat) {
    const parts = path.split('/')
    let cur = root
    parts.forEach((name, i) => {
      const isLast = i === parts.length - 1
      const p = parts.slice(0, i + 1).join('/')
      let next = cur.children.find((c) => c.name === name)
      if (!next) {
        next = { name, path: p, kind: isLast ? kind : 'dir', children: [] }
        cur.children.push(next)
      }
      cur = next
    })
  }
  const sortRec = (n) => {
    if (!n.children) return
    n.children.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1
    )
    n.children.forEach(sortRec)
  }
  sortRec(root)
  return root.children
}

function TreeRows({ nodes, depth, expanded, toggle, onOpen, activePath }) {
  return nodes.map((n) =>
    n.kind === 'dir' ? (
      <React.Fragment key={n.path}>
        <div className="tree-row" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => toggle(n.path)}>
          <IconChevronDown width={13} height={13} className={'twist' + (expanded.has(n.path) ? ' open' : '')} />
          <IconFolder width={15} height={15} />
          <span className="tree-name">{n.name}</span>
        </div>
        {expanded.has(n.path) && (
          <TreeRows
            nodes={n.children}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            onOpen={onOpen}
            activePath={activePath}
          />
        )}
      </React.Fragment>
    ) : (
      <div
        key={n.path}
        className={'tree-row file' + (activePath === n.path ? ' active' : '')}
        style={{ paddingLeft: 26 + depth * 14 }}
        onClick={() => onOpen(n.path)}
      >
        <IconFile width={15} height={15} />
        <span className="tree-name">{n.name}</span>
      </div>
    )
  )
}

export default function FilesPage() {
  const store = useStore()
  const { project } = store
  const english = store.settings.locale === 'en'
  const t = english ? { noProject: 'No project is open', noProjectText: 'Open a project folder or load a repository from GitHub.', openFolder: 'Open folder', fromGitHub: 'From GitHub', create: 'Create project', upload: 'Upload copy', empty: 'Folder is empty', changed: 'modified', save: 'Save', format: 'Format', preview: 'Preview', refresh: 'Refresh', console: 'Console', clear: 'Clear', nothing: 'Nothing yet', run: 'Run project', start: 'Run', build: 'Build', test: 'Test', fix: 'Fix with AI', permission: 'Folder access is required', allow: 'Allow' } : { noProject: 'Нет открытого проекта', noProjectText: 'Откройте папку с проектом или загрузите репозиторий с GitHub.', openFolder: 'Открыть папку', fromGitHub: 'Из GitHub', create: 'Создать проект', upload: 'Загрузить копию', empty: 'Папка пуста', changed: 'изменён', save: 'Сохранить', format: 'Форматировать', preview: 'Предпросмотр', refresh: 'Обновить', console: 'Консоль', clear: 'Очистить', nothing: 'Пока ничего', run: 'Запуск проекта', start: 'Запустить', build: 'Собрать', test: 'Тестировать', fix: 'Исправить через ИИ', permission: 'Нужно разрешение на доступ к папке', allow: 'Разрешить' }
  const [openPath, setOpenPath] = useState(null)
  const [tabs, setTabs] = useState([]) // { path, draft, saved, dirty }
  const [expanded, setExpanded] = useState(new Set())
  const [ghOpen, setGhOpen] = useState(false)
  const [ghInput, setGhInput] = useState('')
  const [ghBranch, setGhBranch] = useState('')
  const [ghBusy, setGhBusy] = useState(false)
  const [gitOpen, setGitOpen] = useState(false)
  const [gitRepo, setGitRepo] = useState('')
  const [gitBranch, setGitBranch] = useState('main')
  const [gitMsg, setGitMsg] = useState('')
  const [gitBusy, setGitBusy] = useState(false)
  const [gitPR, setGitPR] = useState(false)
  const [gitBase, setGitBase] = useState('main')
  const [gitHistory, setGitHistory] = useState(null)
  const [newBranch, setNewBranch] = useState('')
  const [gitBranches, setGitBranches] = useState(null)
  const [pullConflicts, setPullConflicts] = useState([])
  const [gitChecks, setGitChecks] = useState(null)
  const [terminal, setTerminal] = useState([])
  const [terminalBusy, setTerminalBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [logs, setLogs] = useState([])
  const [consoleOpen, setConsoleOpen] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)
  const [editorSelection, setEditorSelection] = useState({ word: '', line: 1, column: 1 })
  const [diagnostics, setDiagnostics] = useState([])
  const [formatRequest, setFormatRequest] = useState(0)
  const [jumpTo, setJumpTo] = useState(null)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateId, setTemplateId] = useState('vite')
  const [templateName, setTemplateName] = useState('')

  const activeTab = tabs.find((tab) => tab.path === openPath) || null
  const draft = activeTab?.draft || ''
  const dirty = !!activeTab?.dirty

  const updateTab = (path, patch) => {
    setTabs((current) => current.map((tab) => tab.path === path
      ? { ...tab, ...(typeof patch === 'function' ? patch(tab) : patch) }
      : tab))
  }

  // Поиск по проекту с задержкой на ввод. Счётчик отсекает результат
  // предыдущего запроса: он мог прийти позже нового и перезаписать список.
  const searchRun = useRef(0)
  useEffect(() => {
    if (!searchOpen) return
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    const run = ++searchRun.current
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await searchInProject({
          tree: project?.tree || [],
          readFile: store.readFile,
          query: q,
          max: 200,
        })
        if (searchRun.current !== run) return
        setResults(res)
      } finally {
        if (searchRun.current === run) setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query, searchOpen, project])

  const nested = useMemo(() => (project ? buildNested(project.tree) : []), [project])

  // Раскрытые папки принадлежат конкретному проекту: при переключении набор
  // путей от прежнего проекта оставлял дерево раскрытым как попало.
  useEffect(() => {
    setExpanded(new Set((project?.tree || []).filter((t) => t.kind === 'dir' && !t.path.includes('/')).map((t) => t.path)))
    setTabs([])
    setOpenPath(null)
    setDiagnostics([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id])

  useEffect(() => {
    setDiagnostics([])
    setEditorSelection({ word: '', line: 1, column: 1 })
  }, [openPath])

  const toggle = (path) =>
    setExpanded((s) => {
      const n = new Set(s)
      n.has(path) ? n.delete(path) : n.add(path)
      return n
    })

  function finishCloseEditor(path = openPath) {
    const index = tabs.findIndex((tab) => tab.path === path)
    const remaining = tabs.filter((tab) => tab.path !== path)
    setTabs(remaining)
    if (openPath === path) {
      setJumpTo(null)
      setOpenPath(remaining[Math.min(index, remaining.length - 1)]?.path || null)
    }
    setDiagnostics([])
  }

  function closeEditor(path = openPath) {
    const tab = tabs.find((item) => item.path === path)
    if (tab?.dirty) {
      setConfirmAction({
        title: 'Закрыть без сохранения?',
        message: `Несохранённые изменения в «${path}» будут потеряны.`,
        label: 'Закрыть файл',
        run: () => finishCloseEditor(path),
      })
      return
    }
    finishCloseEditor(path)
  }

  async function loadFile(path, target = null) {
    try {
      const existing = tabs.find((tab) => tab.path === path)
      if (existing) {
        setOpenPath(path)
        setJumpTo(target ? { ...target, key: Date.now() } : null)
        return
      }
      const content = await store.readFile(path)
      setTabs((current) => [...current, { path, draft: content, saved: content, dirty: false }])
      setOpenPath(path)
      setJumpTo(target ? { ...target, key: Date.now() } : null)
    } catch (e) {
      store.toast(e.message)
    }
  }

  function openFile(path, target = null) {
    if (path === openPath) {
      if (target) setJumpTo({ ...target, key: Date.now() })
      return
    }
    loadFile(path, target)
  }

  async function save() {
    if (!openPath || !dirty) return
    try {
      await store.writeFile(openPath, draft)
      updateTab(openPath, { saved: draft, dirty: false })
      store.toast('Сохранено: ' + openPath)
      if (!project.tree.some((t) => t.path === openPath)) store.refreshTree()
    } catch (e) {
      store.toast('Ошибка: ' + e.message)
    }
  }

  async function replaceAcrossProject() {
    if (!project || !query.trim()) return
    let changedFiles = 0
    let replacements = 0
    const updated = new Map()
    const files = project.tree.filter((item) => item.kind === 'file' && !isBinaryPath(item.path)).slice(0, 400)
    try {
      for (const file of files) {
        const tab = tabs.find((item) => item.path === file.path)
        const before = tab ? tab.draft : await store.readFile(file.path)
        const result = replaceInText(before, query, replacement)
        if (!result.count) continue
        await store.writeFile(file.path, result.content)
        updated.set(file.path, result.content)
        changedFiles++
        replacements += result.count
      }
      if (updated.size) {
        setTabs((current) => current.map((tab) => updated.has(tab.path)
          ? { ...tab, draft: updated.get(tab.path), saved: updated.get(tab.path), dirty: false }
          : tab))
        await store.refreshTree()
      }
      setResults([])
      store.toast(replacements
        ? `Заменено: ${replacements} в ${changedFiles} файл${changedFiles === 1 ? 'е' : 'ах'}`
        : 'Совпадений для замены нет')
    } catch (e) {
      store.toast('Замена не выполнена: ' + e.message)
    }
  }

  function confirmReplaceAcrossProject() {
    if (!query.trim()) return
    const files = new Set(results.map((item) => item.path)).size
    setConfirmAction({
      title: 'Заменить во всём проекте?',
      message: files
        ? `Будут изменены совпадения минимум в ${files} файл${files === 1 ? 'е' : 'ах'}. Открытые несохранённые версии файлов тоже будут учтены.`
        : 'Будет выполнен поиск и замена по всем текстовым файлам проекта.',
      label: 'Заменить всё',
      danger: false,
      run: replaceAcrossProject,
    })
  }

  async function goToDefinition() {
    const word = String(editorSelection.word || '').trim()
    if (!word || !/^[A-Za-z_$][\w$-]*$/.test(word)) {
      store.toast('Поставьте курсор на имя функции, класса или переменной')
      return
    }
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const definition = new RegExp(`\\b(?:function|class|const|let|var|interface|type|enum)\\s+${escaped}\\b|\\bid=["']${escaped}["']`)
    const candidates = project.tree
      .filter((item) => item.kind === 'file' && /\.(?:[cm]?[jt]sx?|html?|vue)$/i.test(item.path))
      .sort((a, b) => (a.path === openPath ? -1 : b.path === openPath ? 1 : 0))
      .slice(0, 400)
    for (const file of candidates) {
      try {
        const tab = tabs.find((item) => item.path === file.path)
        const content = tab ? tab.draft : await store.readFile(file.path)
        const lines = content.split(/\r?\n/)
        const lineIndex = lines.findIndex((line) => definition.test(line))
        if (lineIndex >= 0) {
          const column = Math.max(1, lines[lineIndex].indexOf(word) + 1)
          openFile(file.path, { line: lineIndex + 1, column })
          store.toast(`Определение: ${file.path}:${lineIndex + 1}`)
          return
        }
      } catch { /* пропускаем недоступный файл */ }
    }
    store.toast(`Определение «${word}» не найдено`)
  }

  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && openPath) {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [openPath, draft, dirty, project])

  async function addFile() {
    const p = window.prompt('Путь нового файла (например src/index.js):')
    if (!p) return
    try {
      await store.writeFile(p, '')
      await store.refreshTree()
      setTabs((current) => current.some((tab) => tab.path === p)
        ? current
        : [...current, { path: p, draft: '', saved: '', dirty: false }])
      setOpenPath(p)
      setJumpTo(null)
    } catch (e) {
      store.toast(e.message)
    }
  }

  async function cloneGitHub() {
    if (!ghInput.trim() || ghBusy) return
    setGhBusy(true)
    const ok = await store.cloneFromGitHub(ghInput, ghBranch)
    setGhBusy(false)
    if (ok) {
      setGhOpen(false)
      setGhInput('')
    }
  }

  // ---------- GitHub: репозитории подключённого аккаунта ----------

  const account = store.settings.github
  const [repos, setRepos] = useState(null)
  const [reposBusy, setReposBusy] = useState(false)
  const [repoFilter, setRepoFilter] = useState('')
  const [branches, setBranches] = useState(null)

  const loadRepos = useCallback(async () => {
    if (reposBusy) return
    setReposBusy(true)
    const list = await store.fetchMyRepos()
    setReposBusy(false)
    if (list) setRepos(list)
  }, [reposBusy, store])

  // список подтягивается один раз при открытии панели
  useEffect(() => {
    if (ghOpen && account?.login && repos === null && !reposBusy) loadRepos()
  }, [ghOpen, account?.login])

  const visibleRepos = useMemo(() => {
    const q = repoFilter.trim().toLowerCase()
    const list = repos || []
    return (q ? list.filter((r) => r.fullName.toLowerCase().includes(q)) : list).slice(0, 60)
  }, [repos, repoFilter])

  async function cloneFromAccount(repo, branch) {
    if (ghBusy) return
    setGhBusy(true)
    const ok = await store.cloneFromGitHub({ owner: repo.owner, repo: repo.repo }, branch || repo.branch)
    setGhBusy(false)
    if (ok) setGhOpen(false)
  }

  // ветки подтягиваются по требованию — по одному репозиторию, а не для всего списка
  async function toggleBranches(repo) {
    if (branches?.fullName === repo.fullName) {
      setBranches(null)
      return
    }
    setBranches({ fullName: repo.fullName, list: null })
    const list = await store.fetchBranches(repo.owner, repo.repo)
    setBranches(list ? { fullName: repo.fullName, list } : null)
  }

  // ---------- Git: commit & push ----------

  const changed = store.changedFiles()
  const gitLinked = project?.github
  const staged = store.settings.gitStaging?.[project?.id] || {}
  const stashes = store.settings.gitStashes?.[project?.id] || []
  const stagedCount = changed.filter((f) => staged[f.path]).length
  const paths = new Set((project?.tree || []).filter((x) => x.kind === 'file').map((x) => x.path))
  const stack = !project ? ''
    : paths.has('vite.config.js') || paths.has('vite.config.ts') ? 'React / Vite'
      : paths.has('package.json') ? 'Node.js'
        : [...paths].some((p) => /(^|\/)build\.gradle(\.kts)?$/.test(p)) ? 'Android / Gradle'
          : [...paths].some((p) => /(^|\/)pyproject\.toml$|(^|\/)requirements\.txt$/.test(p)) ? 'Python'
            : 'Не определён'
  const buildCommand = stack === 'Android / Gradle' ? './gradlew assembleDebug' : stack === 'Python' ? 'python -m build' : 'npm run build'
  const testCommand = stack === 'Android / Gradle' ? './gradlew test' : stack === 'Python' ? 'python -m pytest' : 'npm test'

  const toggleStage = (path) => store.setSettings((s) => ({ ...s, gitStaging: { ...(s.gitStaging || {}), [project.id]: { ...(s.gitStaging?.[project.id] || {}), [path]: !s.gitStaging?.[project.id]?.[path] } } }))
  const stageAll = () => store.setSettings((s) => ({ ...s, gitStaging: { ...(s.gitStaging || {}), [project.id]: Object.fromEntries(changed.map((f) => [f.path, true])) } }))
  async function loadGitHistory() { if (gitLinked) setGitHistory(await store.fetchCommits(project.github.owner, project.github.repo, project.github.branch)) }
  async function addBranch() { if (await store.createGitBranch(newBranch)) { setNewBranch(''); setGitHistory(null) } }
  async function loadGitBranches() { if (gitLinked) setGitBranches(await store.fetchBranches(project.github.owner, project.github.repo)) }
  async function pullGit() { const result = await store.pullFromGitHub(); if (result?.conflicts?.length) setPullConflicts(result.conflicts) }
  async function loadChecks() { if (!gitLinked) return; const commits = await store.fetchCommits(project.github.owner, project.github.repo, project.github.branch); if (commits?.[0]) setGitChecks(await store.fetchCommitChecks(project.github.owner, project.github.repo, commits[0].sha)) }
  function aiReview() { const files = changed.filter((f) => staged[f.path]).map((f) => f.path); if (!files.length) { store.toast('Сначала добавьте файлы в stage'); return } store.setComposerDraft(`/review Проведи ревью staged-изменений перед коммитом: ${files.join(', ')}. Проверь ошибки, безопасность, регрессии и тесты.`); store.setPage('chat') }
  const shortDiff = (path) => { const before = project?.baseFiles?.[path] || ''; const after = project?.files?.[path] || ''; const oldLines = before.split(/\r?\n/); const newLines = after.split(/\r?\n/); return ['--- ' + path, '+++ ' + path, ...oldLines.slice(0, 45).map((line) => '- ' + line), ...newLines.slice(0, 45).map((line) => '+ ' + line)].join('\n') }
  async function runTask(command, label) {
    if (terminalBusy) return
    const dangerous = /\b(rm|del|format|clean|publish|push)\b/i.test(command)
    if (dangerous) { setConfirmAction({ title: 'Разрешить команду?', message: '$ ' + command, label: 'Запустить', run: () => runTaskConfirmed(command, label) }); return }
    runTaskConfirmed(command, label)
  }
  async function runTaskConfirmed(command, label) {
    setTerminalBusy(true); setTerminal((x) => [...x, { label, command, output: 'Выполняю…' }])
    try { const output = await runProjectCommand({ command, projectName: project.name }); setTerminal((x) => [...x.slice(0, -1), { label, command, output }]) }
    catch (e) { setTerminal((x) => [...x.slice(0, -1), { label, command, output: 'Ошибка: ' + e.message, error: true }]) }
    finally { setTerminalBusy(false) }
  }

  async function doPush() {
    if (gitBusy) return
    if (!gitLinked) {
      const ok = await store.linkGitHub(gitRepo, gitBranch)
      if (!ok) return
    }
    setGitBusy(true)
    await store.pushToGitHub({ message: gitMsg, createPR: gitPR, baseBranch: gitBase })
    setGitBusy(false)
    setGitMsg('')
  }

  // ---------- Предпросмотр ----------

  async function buildFilesMap() {
    if (project.type === 'virtual') {
      const map = {}
      for (const [path, content] of Object.entries(project.files)) {
        if (typeof content === 'string') map[path] = content
      }
      return map
    }
    const map = {}
    for (const t of project.tree.filter((x) => x.kind === 'file')) {
      if (isBinaryPath(t.path)) continue
      try {
        map[t.path] = await store.readFile(t.path)
      } catch { /* пропускаем */ }
      if (Object.keys(map).length >= 300) break
    }
    return map
  }

  // Каждый запуск создаёт новый набор blob-URL. Прежние надо освобождать, иначе
  // повторное «Запустить» на большом проекте раздувает память WebView.
  const previewUrlsRef = useRef([])
  const revokePreview = () => {
    for (const u of previewUrlsRef.current) URL.revokeObjectURL(u)
    previewUrlsRef.current = []
  }
  useEffect(() => revokePreview, [])

  async function runPreview() {
    if (!project || previewBusy) return
    setPreviewBusy(true)
    try {
      const map = await buildFilesMap()
      const entry = findEntry(map)
      if (!entry) {
        store.toast('Не найден HTML или JS файл для запуска')
        return
      }
      revokePreview()
      const { url, urls } = buildPreview(map, entry)
      previewUrlsRef.current = urls
      setLogs([])
      setPreview({ url, urls, entry })
    } finally {
      setPreviewBusy(false)
    }
  }

  function closePreview() {
    revokePreview()
    setPreview(null)
  }

  useEffect(() => {
    if (!preview) return
    const onMsg = (e) => {
      if (e.data?.__vpreview) {
        setLogs((l) => [...l.slice(-200), { type: e.data.type, text: (e.data.args || []).join(' ') }])
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [preview])

  const ghPanel = (
    <div className="gh-panel">
      {account?.login ? (
        <>
          <div className="gh-repo-head">
            <span className="gh-repo-user">@{account.login}</span>
            <span className="grow" />
            <button className="mini-btn" onClick={loadRepos} disabled={reposBusy}>
              {reposBusy ? 'Обновляю…' : 'Обновить список'}
            </button>
          </div>
          {repos === null ? (
            <p className="hero-dim">
              {reposBusy ? 'Загружаю репозитории…' : 'Не удалось получить список — обновите его.'}
            </p>
          ) : (
            <>
              <input
                className="input"
                placeholder="Фильтр по названию"
                value={repoFilter}
                onChange={(e) => setRepoFilter(e.target.value)}
              />
              <div className="gh-repo-list">
                {visibleRepos.length === 0 && <div className="pc-empty">Репозитории не найдены</div>}
                {visibleRepos.map((r) => (
                  <React.Fragment key={r.fullName}>
                    <div className="gh-repo-row">
                      <button
                        className="gh-repo-main"
                        disabled={ghBusy}
                        onClick={() => cloneFromAccount(r)}
                        title={'Загрузить ' + r.fullName + ' · ' + r.branch}
                      >
                        <IconBranch width={14} height={14} />
                        <span className="gh-repo-text">
                          <b>{r.fullName}</b>
                          {r.description && <small>{r.description}</small>}
                        </span>
                        {r.private && <span className="gh-badge">приватный</span>}
                      </button>
                      <button
                        className={'gh-repo-branch' + (branches?.fullName === r.fullName ? ' on' : '')}
                        disabled={ghBusy}
                        onClick={() => toggleBranches(r)}
                        title="Выбрать ветку"
                      >
                        {r.branch}
                        <IconChevronDown width={11} height={11} />
                      </button>
                    </div>
                    {branches?.fullName === r.fullName && (
                      <div className="gh-branch-list">
                        {branches.list === null && <div className="pc-empty">Загружаю ветки…</div>}
                        {branches.list?.map((b) => (
                          <button key={b} className="gh-branch-row" disabled={ghBusy} onClick={() => cloneFromAccount(r, b)}>
                            {b}
                          </button>
                        ))}
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <p className="hero-dim">
          Подключите аккаунт GitHub в{' '}
          <button className="link-btn" onClick={() => store.setPage('settings')}>Настройках</button>
          {' '}— появится список ваших репозиториев, включая приватные.
        </p>
      )}

      <div className="gh-manual">
        <div className="gh-manual-head">Или по ссылке</div>
        <input
          className="input"
          placeholder="owner/repo или https://github.com/owner/repo"
          value={ghInput}
          onChange={(e) => setGhInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') cloneGitHub()
          }}
        />
        <input
          className="input"
          placeholder="Ветка (пусто — по умолчанию)"
          value={ghBranch}
          onChange={(e) => setGhBranch(e.target.value)}
        />
        <button className="btn btn-primary" onClick={cloneGitHub} disabled={ghBusy || !ghInput.trim()}>
          {ghBusy ? 'Загрузка…' : 'Скачать'}
        </button>
      </div>
      <p className="hero-dim">
        Файлы репозитория загружаются в память приложения (до 500 текстовых файлов).
      </p>
    </div>
  )

  const searchPanel = (
    <div className="gh-panel">
      <input
        className="input"
        autoFocus
        placeholder="Поиск по файлам: текст или /регулярка/"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setSearchOpen(false)
        }}
      />
      <div className="replace-row">
        <input
          className="input"
          placeholder="Заменить на…"
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim()) confirmReplaceAcrossProject()
          }}
        />
        <button className="btn btn-primary btn-sm" disabled={!query.trim()} onClick={confirmReplaceAcrossProject}>
          Заменить всё
        </button>
      </div>
      <div className="search-results">
        {searching && <div className="pc-empty">Ищу…</div>}
        {!searching && query.trim().length < 2 && (
          <div className="pc-empty">Введите минимум 2 символа. Поиск по всем текстовым файлам проекта.</div>
        )}
        {!searching && query.trim().length >= 2 && results.length === 0 && (
          <div className="pc-empty">Ничего не найдено</div>
        )}
        {results.map((r, i) => (
          <div key={i} className="search-row" onClick={() => openFile(r.path, { line: r.line, column: 1 })} title="Открыть файл">
            <span className="sp">{r.path}</span>
            <span className="sl">{r.line}</span>
            <span className="st">{r.text}</span>
          </div>
        ))}
      </div>
    </div>
  )

  const gitPanel = (
    <div className="gh-panel">
      {gitLinked ? (
        <div className="git-meta">
          <IconBranch width={14} height={14} />
          {project.github.owner}/{project.github.repo} · ветка {project.github.branch}
        </div>
      ) : (
        <div className="row">
          <input
            className="input"
            placeholder="owner/repo для push"
            value={gitRepo}
            onChange={(e) => setGitRepo(e.target.value)}
          />
          <input
            className="input"
            style={{ maxWidth: 110 }}
            placeholder="ветка"
            value={gitBranch}
            onChange={(e) => setGitBranch(e.target.value)}
          />
        </div>
      )}
      {account?.login ? (
        <div className="git-meta">
          <IconGitHub width={14} height={14} />
          Пушу от имени @{account.login}
        </div>
      ) : (
        <p className="hero-dim">
          Для push подключите аккаунт GitHub в{' '}
          <button className="link-btn" onClick={() => store.setPage('settings')}>Настройках</button>.
        </p>
      )}
      <div className="hero-dim">
        {changed.length
          ? `Изменено: ${changed.length} — ${changed.slice(0, 3).map((f) => f.path).join(', ')}${changed.length > 3 ? '…' : ''}`
          : 'Изменённых файлов нет — правьте файлы или попросите агента.'}
      </div>
      <div className="git-stage-list">
        <div className="row"><b>Изменения</b><span className="grow"/><button className="mini-btn" onClick={stageAll}>Stage all</button><small>{stagedCount}/{changed.length}</small></div>
        {changed.map((f) => <label className="check-row slim" key={f.path}><input type="checkbox" checked={!!staged[f.path]} onChange={() => toggleStage(f.path)} /><code>{f.status === 'new' ? 'A' : f.status === 'deleted' ? 'D' : 'M'}</code><span>{f.path}</span></label>)}
        {changed.filter((f) => staged[f.path]).map((f) => <details className="git-diff" key={'diff:' + f.path}><summary>Diff: {f.path}</summary><pre>{shortDiff(f.path)}</pre></details>)}
      </div>
      <div className="row"><button className="mini-btn" disabled={!changed.length} onClick={store.stashGitChanges}>Stash изменений</button>{stashes.length > 0 && <span className="hero-dim">Stash: {stashes.length}</span>}</div>
      {stashes.map((item) => <button key={item.id} className="git-branch-choice" onClick={() => store.applyGitStash(item.id)}>Восстановить stash · {item.label}</button>)}
      <input
        className="input"
        placeholder="Сообщение коммита"
        value={gitMsg}
        onChange={(e) => setGitMsg(e.target.value)}
      />
      <label className="check-row slim">
        <input type="checkbox" checked={gitPR} onChange={(e) => setGitPR(e.target.checked)} />
        <span>
          <b>Создать Pull Request</b>
        </span>
        <input
          className="input"
          style={{ width: 90, marginLeft: 'auto' }}
          placeholder="в ветку"
          value={gitBase}
          onChange={(e) => setGitBase(e.target.value)}
        />
      </label>
      <button className="btn btn-primary" onClick={doPush} disabled={gitBusy || !account?.login || (!gitLinked && !gitRepo.trim())}>
        <IconCommit width={15} height={15} />
        {gitBusy ? 'Пушу…' : 'Закоммитить и запушить'}
      </button>
      {gitLinked && <>
        <div className="row"><button className="mini-btn" onClick={loadGitBranches}>Ветки</button><button className="mini-btn" onClick={pullGit}>Pull</button></div>
        {gitBranches?.map((branch) => <button className={'git-branch-choice' + (branch === project.github.branch ? ' active' : '')} key={branch} onClick={() => store.checkoutGitBranch(branch)}>{branch}{branch === project.github.branch ? ' · текущая' : ''}</button>)}
        <div className="row"><input className="input" placeholder="Имя новой ветки" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} /><button className="mini-btn" onClick={addBranch}>Создать</button></div>
        <button className="mini-btn" onClick={loadGitHistory}>История коммитов</button>
        <div className="row"><button className="mini-btn accent" onClick={aiReview}>AI-ревью staged</button><button className="mini-btn" onClick={loadChecks}>Статусы PR</button></div>
        {gitHistory?.map((c) => <div className="git-commit" key={c.sha}><code>{c.sha.slice(0, 7)}</code><span>{c.message}</span><small>{c.author}</small></div>)}
        {gitChecks?.map((c, i) => <div className={'git-check ' + (c.conclusion === 'success' ? 'ok' : c.conclusion === 'failure' ? 'fail' : '')} key={i}><span>{c.conclusion === 'success' ? '✓' : c.conclusion === 'failure' ? '!' : '•'}</span>{c.name}<small>{c.conclusion || c.status}</small></div>)}
      </>}
      <p className="hero-dim">Токен аккаунта хранится только в этом браузере / приложении.</p>
      <ConfirmSheet open={pullConflicts.length > 0} title="Конфликты при Pull" message={`Изменены и локально, и на GitHub: ${pullConflicts.join(', ')}. Применить версию GitHub и потерять локальные изменения этих файлов?`} confirmLabel="Применить GitHub" danger onCancel={() => setPullConflicts([])} onConfirm={async () => { await store.pullFromGitHub({ force: true }); setPullConflicts([]) }} />
    </div>
  )

  if (!project) {
    return (
      <div className="empty">
        <h2>{t.noProject}</h2>
        <p>{t.noProjectText}</p>
        <div className="row center">
          <button className="btn btn-primary" onClick={store.openFolder}>
            <IconFolder width={16} height={16} /> {t.openFolder}
          </button>
          <button className="btn" onClick={() => setGhOpen((v) => !v)}>
            <IconBranch width={16} height={16} /> {t.fromGitHub}
          </button>
          <button className="btn" onClick={() => setTemplateOpen(true)}>
            <IconPlus width={16} height={16} /> {t.create}
          </button>
          <label className="btn">
            <IconUpload width={16} height={16} /> {t.upload}
            <input
              type="file"
              hidden
              multiple
              {...({ webkitdirectory: '' } || {})}
              onChange={async (e) => {
                const fl = [...e.target.files]
                e.target.value = ''
                await store.openFolderVirtual(fl)
              }}
            />
          </label>
        </div>
        {ghOpen && ghPanel}
        <ConfirmSheet
          open={templateOpen}
          title="Новый проект"
          message="Выберите основу — все файлы будут доступны для редактирования сразу."
          confirmLabel="Создать"
          onCancel={() => setTemplateOpen(false)}
          onConfirm={() => { store.createTemplateProject(templateId, templateName); setTemplateOpen(false) }}
        >
          <div className="template-grid">
            {PROJECT_TEMPLATES.map((t) => <button key={t.id} className={'template-card' + (templateId === t.id ? ' selected' : '')} onClick={() => { setTemplateId(t.id); if (!templateName) setTemplateName(t.title) }}><b>{t.title}</b><small>{t.badge} · {t.description}</small></button>)}
          </div>
          <input className="input" placeholder="Название проекта" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
        </ConfirmSheet>
        <p className="hero-dim">
          Прямой доступ к папке с записью работает в Chrome / Edge.
          В остальных браузерах загружается копия файлов (только в памяти).
        </p>
      </div>
    )
  }

  return (
    <div className="files-page">
      {project.needsPermission && (
        <div className="perm-banner">
          <span>{t.permission} «{project.name}»</span>
          <button className="btn btn-primary" onClick={store.grantPermission}>{t.allow}</button>
        </div>
      )}

      <div className="files-head">
        <IconFolder width={16} height={16} />
        <b>{project.name}</b>
        <span className="badge">{project.type === 'handle' ? 'диск' : 'память'}</span>
      </div>

      {/* Девять кнопок не влезали в 420px и обрезались вместе с «Закрыть проект»:
          выносим их в отдельный ряд с горизонтальной прокруткой. */}
      <div className="files-tools">
        <button className="iconbtn" onClick={runPreview} disabled={previewBusy} aria-label="Запустить предпросмотр" title="Запустить предпросмотр">
          <IconPlay width={16} height={16} />
        </button>
        <button
          className={'iconbtn' + (searchOpen ? ' on' : '')}
          onClick={() => { setSearchOpen((v) => !v); setGhOpen(false); setGitOpen(false) }}
          aria-label="Поиск по файлам"
          title="Поиск по файлам"
        >
          <IconSearch width={16} height={16} />
        </button>
        <button
          className={'iconbtn' + (gitOpen ? ' on' : '')}
          onClick={() => { setGitOpen((v) => !v); setGhOpen(false); setSearchOpen(false) }}
          aria-label="Коммит и push"
          title="Коммит и push"
        >
          <IconCommit width={16} height={16} />
        </button>
        <button
          className={'iconbtn' + (ghOpen ? ' on' : '')}
          onClick={() => { setGhOpen((v) => !v); setGitOpen(false); setSearchOpen(false) }}
          aria-label="Загрузить репозиторий с GitHub"
          title="Загрузить репозиторий с GitHub"
        >
          <IconBranch width={16} height={16} />
        </button>
        <button className="iconbtn" onClick={() => store.refreshTree()} aria-label="Обновить дерево файлов" title="Обновить дерево файлов">
          <IconRefresh width={16} height={16} />
        </button>
        <button className="iconbtn" onClick={addFile} aria-label="Новый файл" title="Новый файл">
          <IconPlus width={18} height={18} />
        </button>
        <button className="iconbtn" onClick={store.openFolder} aria-label="Открыть другую папку" title="Открыть другую папку">
          <IconFolder width={16} height={16} />
        </button>
        <button className="iconbtn danger" onClick={store.closeProject} aria-label="Закрыть проект" title="Закрыть проект">
          <IconClose width={17} height={17} />
        </button>
      </div>

      {ghOpen && ghPanel}
      {gitOpen && gitPanel}
      {searchOpen && searchPanel}

      <div className="run-panel">
        <div><b>Запуск проекта</b><small>{stack} · команды исполняются через локальный VerbaIDE runner</small></div>
        <div className="row"><button className="mini-btn accent" disabled={terminalBusy} onClick={runPreview}>Запустить</button><button className="mini-btn" disabled={terminalBusy} onClick={() => runTask(buildCommand, 'Собрать')}>Собрать</button><button className="mini-btn" disabled={terminalBusy} onClick={() => runTask(testCommand, 'Тестировать')}>Тестировать</button></div>
        {terminal.slice(-3).reverse().map((item, i) => <details className={'terminal-row' + (item.error ? ' error' : '')} key={i} open><summary>{item.label}: <code>$ {item.command}</code></summary><pre>{item.output}</pre>{item.error && <button className="mini-btn accent" onClick={() => { store.setComposerDraft(`/fix Исправь ошибку запуска проекта. Команда: ${item.command}\n\nЛог:\n${item.output}`); store.setPage('chat') }}>Исправить через ИИ</button>}</details>)}
      </div>

      <div className="tree">
        {nested.length === 0 && <div className="side-empty">{t.empty}</div>}
        <TreeRows
          nodes={nested}
          depth={0}
          expanded={expanded}
          toggle={toggle}
          onOpen={openFile}
          activePath={openPath}
        />
      </div>

      {openPath && (
        <div className="editor">
          <div className="editor-head">
            <button className="iconbtn" onClick={() => { setJumpTo(null); setOpenPath(null) }} aria-label="Назад к дереву файлов" title="Назад к дереву файлов"><IconBack width={18} height={18} /></button>
            <span className="editor-path">{openPath}</span>
            {dirty && <span className="badge">{t.changed}</span>}
            <span className="grow" />
            <button className="btn btn-primary btn-sm" onClick={save} disabled={!dirty}>{t.save}</button>
          </div>
          <div className="editor-tabs" role="tablist" aria-label="Открытые файлы">
            {tabs.map((tab) => (
              <div className={'editor-tab' + (tab.path === openPath ? ' active' : '')} key={tab.path}>
                <button
                  role="tab"
                  aria-selected={tab.path === openPath}
                  title={tab.path}
                  onClick={() => { setJumpTo(null); setOpenPath(tab.path) }}
                >
                  {tab.path.split('/').pop()}{tab.dirty ? <i>●</i> : null}
                </button>
                <button className="editor-tab-close" onClick={() => closeEditor(tab.path)} aria-label={`Закрыть ${tab.path}`}>×</button>
              </div>
            ))}
          </div>
          <div className="editor-commandbar">
            <button className="mini-btn" onClick={() => setFormatRequest((value) => value + 1)}>{t.format}</button>
            <button className="mini-btn" onClick={goToDefinition} disabled={!editorSelection.word} title="Перейти к определению (F12)">
              К определению
            </button>
            <span className="grow" />
            <span className="editor-position">Ln {editorSelection.line}, Col {editorSelection.column}</span>
            <span className={'diagnostic-count' + (diagnostics.length ? ' error' : '')}>
              {diagnostics.length ? `${diagnostics.length} ош.` : 'Ошибок нет'}
            </span>
          </div>
          <CodeEditor
            key={openPath}
            className="editor-cm"
            variant="editor"
            path={openPath}
            value={draft}
            onChange={(v) => {
              updateTab(openPath, (tab) => ({ draft: v, dirty: v !== tab.saved }))
            }}
            onSave={save}
            onSelectionChange={setEditorSelection}
            onDiagnostics={setDiagnostics}
            onGoToDefinition={goToDefinition}
            formatRequest={formatRequest}
            jumpTo={jumpTo}
          />
          {diagnostics.length > 0 && (
            <div className="editor-diagnostics" aria-label="Диагностика файла">
              {diagnostics.slice(0, 8).map((item, index) => (
                <button key={`${item.from}-${index}`} onClick={() => setJumpTo({ line: item.line, column: item.column, key: Date.now() })}>
                  <span>Ошибка</span>
                  <b>{item.message}</b>
                  <em>{item.line}:{item.column}</em>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {preview && (
        <div className="editor">
          <div className="editor-head">
            <button className="iconbtn" onClick={closePreview} aria-label="Закрыть предпросмотр" title="Закрыть предпросмотр"><IconBack width={18} height={18} /></button>
            <span className="editor-path">{t.preview}: {preview.entry}</span>
            <span className="grow" />
            <button className="mini-btn" onClick={runPreview}>{t.refresh}</button>
            <button className="mini-btn" onClick={() => setConsoleOpen((v) => !v)}>
              Консоль{logs.length ? ` (${logs.length})` : ''}
            </button>
          </div>
          <iframe
            className="preview-frame"
            src={preview.url}
            sandbox="allow-scripts allow-modals allow-forms allow-popups"
            title="Предпросмотр"
          />
          {consoleOpen && (
            <div className="preview-console">
              <div className="pc-head">
                <span>{t.console}</span>
                <span className="grow" />
                <button className="mini-btn" onClick={() => setLogs([])}>{t.clear}</button>
              </div>
              <div className="pc-body">
                {logs.length === 0 && <div className="pc-empty">{t.nothing}</div>}
                {logs.map((l, i) => (
                  <div key={i} className={'pc-line ' + l.type}>{l.text}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <ConfirmSheet
        open={!!confirmAction}
        title={confirmAction?.title}
        message={confirmAction?.message}
        confirmLabel={confirmAction?.label}
        danger={confirmAction?.danger !== false}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          const action = confirmAction
          setConfirmAction(null)
          action?.run?.()
        }}
      />
    </div>
  )
}
