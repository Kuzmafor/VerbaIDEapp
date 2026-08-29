import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import Composer from '../components/Composer'
import Markdown from '../components/Markdown'
import { buildSystemPrompt, parseFileBlocks, lastFileBlock } from '../lib/agent'
import { runAgent } from '../lib/agentLoop'
import { searchInProject } from '../lib/search'
import { semanticSearchProject } from '../lib/projectIndex'
import { uid } from '../lib/storage'
import { mimeForPath, saveTextFile } from '../lib/deviceSave'
import { inferProviderCapabilities, streamChat } from '../lib/llm'
import { expandSlashCommand } from '../lib/commands'
import { runProjectCommand } from '../lib/commandBridge'
import { updateNativeAgent } from '../lib/backgroundAgent'
import { toolCallToPending, editsSummary } from '../lib/aiEdits'
import {
  IconCheck, IconChevronDown, IconCopy, IconFile, IconRefresh, IconStop, IconBrain, IconClose, IconArrowDown,
  IconSearch, IconEdit, IconCode, IconFolder, IconGear, IconDownload, IconBranch, ThinkingDots,
} from '../components/Icons'
import CodeEditor from '../components/CodeEditor'
import ConfirmSheet from '../components/ConfirmSheet'
import ReviewSheet from '../components/ReviewSheet'

// Точные токены приходят от провайдера в usage; если он их не вернул, честно
// помечаем цифру как приблизительную.
function MsgStats({ stats }) {
  if (!stats) return null
  const parts = []
  if (stats.exact) {
    if (Number.isFinite(stats.inputTokens)) {
      parts.push(`${stats.inputTokens.toLocaleString('ru-RU')} вход`)
      if (stats.cachedTokens) parts.push(`${stats.cachedTokens.toLocaleString('ru-RU')} из кеша`)
    }
    parts.push(`${stats.tokens.toLocaleString('ru-RU')} выход`)
  } else {
    parts.push(`≈${stats.tokens.toLocaleString('ru-RU')} токенов`)
  }
  if (Number.isFinite(stats.cost) && stats.cost !== null) {
    parts.push('$' + (stats.cost < 0.01 ? stats.cost.toFixed(5) : stats.cost.toFixed(4)))
  }
  parts.push(`${stats.speed} ток/с`)
  parts.push(`${stats.seconds} с`)
  return <>{parts.join(' · ')}</>
}

function patchMsg(chats, chatId, msgId, fn) {
  return chats.map((c) =>
    c.id !== chatId
      ? c
      : { ...c, messages: c.messages.map((m) => (m.id !== msgId ? m : fn(m))) }
  )
}

function CopyBtn({ text }) {
  const [ok, setOk] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setOk(true)
      setTimeout(() => setOk(false), 1200)
    } catch { /* ignore */ }
  }
  return <button className="mini-btn" onClick={copy}>{ok ? 'Скопировано' : 'Копировать'}</button>
}

function MessageActions({ text, alignEnd, onRetry, onStop, onRemember }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch { /* ignore */ }
  }
  return (
    <div className={'msg-actions' + (alignEnd ? ' end' : '')}>
      <button onClick={copy} aria-label="Копировать сообщение">
        <IconCopy width={13} height={13} /> {copied ? 'Скопировано' : 'Копировать'}
      </button>
      {onRetry && (
        <button onClick={onRetry} aria-label="Повторить ответ">
          <IconRefresh width={13} height={13} /> Повторить
        </button>
      )}
      {onRemember && (
        <button onClick={onRemember} aria-label="Запомнить сообщение">
          <IconBrain width={13} height={13} /> Запомнить
        </button>
      )}
      {onStop && (
        <button className="danger" onClick={onStop} aria-label="Остановить ответ">
          <IconStop width={12} height={12} /> Остановить
        </button>
      )}
    </div>
  )
}

function MessageGesture({ children, onSwipe, onLongPress, haptics = true }) {
  const [offset, setOffset] = useState(0)
  const touch = useRef(null)
  const hold = useRef(null)

  const clearHold = () => { clearTimeout(hold.current); hold.current = null }
  useEffect(() => () => clearTimeout(hold.current), [])
  const start = (e) => {
    const point = e.touches?.[0]
    if (!point) return
    // В коде и редакторе долгое нажатие нужно системе для выделения текста —
    // свой шит там не открываем, иначе всплывают оба меню сразу.
    if (e.target?.closest?.('pre, code, textarea, input, .cm-editor')) return
    touch.current = { x: point.clientX, y: point.clientY }
    clearHold()
    hold.current = setTimeout(() => {
      if (haptics) navigator.vibrate?.(18)
      onLongPress?.()
      touch.current = null
      setOffset(0)
    }, 520)
  }
  const move = (e) => {
    const point = e.touches?.[0]
    if (!point || !touch.current) return
    const dx = point.clientX - touch.current.x
    const dy = point.clientY - touch.current.y
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearHold()
    if (dx > 0 && Math.abs(dx) > Math.abs(dy)) setOffset(Math.min(82, dx * 0.72))
  }
  const end = () => {
    clearHold()
    if (offset > 58) {
      if (haptics) navigator.vibrate?.(12)
      onSwipe?.()
    }
    setOffset(0)
    touch.current = null
  }
  return (
    <div
      className={'message-gesture' + (offset > 12 ? ' swiping' : '')}
      onTouchStart={start}
      onTouchMove={move}
      onTouchEnd={end}
      onTouchCancel={end}
      onContextMenu={(e) => { e.preventDefault(); onLongPress?.() }}
    >
      <span className="swipe-repeat"><IconRefresh width={15} height={15} /></span>
      <div className="message-gesture-inner" style={{ transform: `translateX(${offset}px)` }}>{children}</div>
    </div>
  )
}

function MessageActionSheet({ item, onClose, onCopy, onRemember, onRepeat }) {
  if (!item) return null
  return (
    <div className="message-sheet-backdrop" onClick={onClose}>
      <div className="message-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="message-sheet-handle" />
        <div className="message-sheet-head"><b>Действия с сообщением</b><button className="iconbtn small" onClick={onClose} aria-label="Закрыть" title="Закрыть"><IconClose /></button></div>
        <button onClick={onCopy}><IconCopy /> Копировать</button>
        <button onClick={onRemember}><IconBrain /> Запомнить</button>
        <button onClick={onRepeat}><IconRefresh /> {item.message.role === 'user' ? 'Повторить запрос' : 'Повторить ответ'}</button>
      </div>
    </div>
  )
}

// Карточка готового файла в сообщении агента
function FileCard({ path, code, applied, writing, canApply, onApply }) {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const status = applied ? 'сохранён' : writing ? 'пишу…' : 'файл готов'
  const download = async () => {
    try {
      await saveTextFile({ name: path.split('/').pop() || 'file.txt', content: code, mime: mimeForPath(path) })
      store.toast('Файл сохранён на устройство')
    } catch (e) {
      store.toast(e.message || 'Не удалось сохранить файл')
    }
  }
  return (
    <div className="file-card">
      <div className="file-card-head">
        <button className="file-card-toggle" onClick={() => setOpen((v) => !v)}>
          <IconFile width={14} height={14} />
          <span className="fc-path">{path}</span>
          <span className={'fc-status' + (applied ? ' ok' : '')}>{status}</span>
          <IconChevronDown width={13} height={13} className={'twist' + (open ? ' open' : '')} />
        </button>
        {!writing && (
          <button className="fc-download" onClick={download} aria-label={`Скачать ${path}`} title={`Скачать ${path}`}>
            <IconDownload width={14} height={14} /><span>Скачать</span>
          </button>
        )}
      </div>
      {open && (
        <div className="fc-body">
          <CodeEditor variant="readable" value={code} path={path} className="fc-cm" />
          <div className="fc-actions">
            <CopyBtn text={code} />
            {canApply && !applied && !writing && (
              <button className="mini-btn accent" onClick={onApply}>Применить</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Статус агента: действие раскрашено по типу, цель остаётся приглушённой,
// чтобы в длинной строке было видно, что именно он делает.
function stepInfo(s) {
  if (!s) return null
  if (s.name === 'list_connected_repositories') return { kind: 'tree', verb: 'смотрит', target: 'репозитории GitHub' }
  if (s.name === 'open_connected_repository') return { kind: 'call', verb: 'открывает', target: `${s.args?.owner || '?'}/${s.args?.repo || '?'}` }
  if (s.name === 'read_file') return { kind: 'read', verb: 'читает', target: s.args?.path || 'файл' }
  if (s.name === 'search_project') return { kind: 'search', verb: 'ищет', target: '«' + (s.args?.query || '') + '»' }
  if (s.name === 'semantic_search') return { kind: 'index', verb: 'ищет по индексу', target: '«' + (s.args?.query || '') + '»' }
  if (s.name === 'list_files') return { kind: 'tree', verb: 'смотрит структуру проекта' }
  if (s.name === 'write_file') return { kind: 'create', verb: 'записывает', target: s.args?.path || 'файл' }
  if (s.name === 'patch_file') return { kind: 'edit', verb: 'изменяет', target: s.args?.path || 'файл' }
  if (s.name === 'move_file') return { kind: 'edit', verb: 'перемещает', target: `${s.args?.from || '?'} → ${s.args?.to || '?'}` }
  if (s.name === 'delete_file') return { kind: 'edit', verb: 'удаляет', target: s.args?.path || 'файл' }
  if (s.name === 'run_command') return { kind: 'call', verb: 'проверяет', target: s.args?.command || 'проект' }
  if (s.name === 'repository_status') return { kind: 'tree', verb: 'проверяет', target: 'состояние репозитория' }
  if (s.name === 'list_repository_branches') return { kind: 'tree', verb: 'смотрит', target: 'ветки репозитория' }
  if (s.name === 'list_repository_commits') return { kind: 'tree', verb: 'смотрит', target: 'историю коммитов' }
  if (s.name === 'pull_repository') return { kind: 'call', verb: 'получает', target: 'изменения из GitHub' }
  if (s.name === 'create_repository_branch') return { kind: 'call', verb: 'создаёт ветку', target: s.args?.name || '' }
  if (s.name === 'push_repository') return { kind: 'call', verb: 'отправляет', target: 'изменения в GitHub' }
  if (s.name === 'create_pull_request') return { kind: 'call', verb: 'создаёт', target: 'Pull Request' }
  return { kind: 'call', verb: 'вызывает', target: s.name }
}

function ActLabel({ info }) {
  if (!info) return null
  return (
    <span className="act">
      <span className={'act-verb act-' + info.kind}>{info.verb}</span>
      {info.target ? <span className="act-target">{info.target}</span> : null}
    </span>
  )
}

function taskPlan(text, hasProject) {
  const steps = hasProject
    ? ['Изучу связанные файлы', 'Внесу точечные изменения', 'Проверю сборку или тесты', 'Покажу изменённые файлы и предложу commit']
    : ['Уточню задачу и составлю решение', 'Подготовлю результат', 'Проверю итог и следующие шаги']
  return String(text || '').length < 36 ? steps.slice(0, hasProject ? 3 : 2) : steps
}

function ProviderErrorCard({ error, onRetry, onSettings }) {
  const message = String(error?.message || 'Не удалось получить ответ от провайдера')
  const auth = /\b(401|403)\b|ключ|token|unauthor/i.test(message)
  const limit = /\b429\b|rate.?limit|лимит/i.test(message)
  const title = auth ? 'Проверьте API-ключ' : limit ? 'Лимит провайдера исчерпан' : 'Провайдер недоступен'
  const hint = auth
    ? 'Провайдер отклонил авторизацию. Проверьте ключ и выбранную модель.'
    : limit
      ? 'Запрос отклонён из-за ограничения тарифа или частоты запросов.'
      : 'Соединение не установлено. В браузере частая причина — CORS; в Android также проверьте сеть и адрес API.'
  return (
    <section className="provider-error" role="alert">
      <span className="provider-error-mark">!</span>
      <div className="provider-error-main">
        <b>{title}</b>
        <p>{hint}</p>
        <details>
          <summary>Технические детали</summary>
          <code>{message}</code>
        </details>
        <div className="provider-error-actions">
          {onRetry && <button className="btn btn-primary btn-sm" onClick={onRetry}><IconRefresh /> Повторить</button>}
          <button className="btn btn-sm" onClick={onSettings}><IconGear /> Настройки</button>
        </div>
      </div>
    </section>
  )
}

function formatWorkTime(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0))
  if (value < 60) return `${value}с`
  const minutes = Math.floor(value / 60)
  const rest = value % 60
  return rest ? `${minutes}м ${rest}с` : `${minutes}м`
}

function fileParts(path) {
  const clean = String(path || '').replace(/\\/g, '/')
  const split = clean.lastIndexOf('/')
  return {
    name: split >= 0 ? clean.slice(split + 1) : clean,
    dir: split >= 0 ? clean.slice(0, split + 1) : '',
  }
}

function fileKind(path) {
  const ext = String(path || '').split('.').pop()?.toLowerCase()
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return { label: ext === 'jsx' ? 'R' : 'JS', tone: 'js' }
  if (['ts', 'tsx'].includes(ext)) return { label: ext === 'tsx' ? 'R' : 'TS', tone: 'ts' }
  if (ext === 'css') return { label: '#', tone: 'css' }
  if (['html', 'htm'].includes(ext)) return { label: '<>', tone: 'html' }
  if (ext === 'json') return { label: '{}', tone: 'json' }
  if (ext === 'py') return { label: 'PY', tone: 'py' }
  return { label: '·', tone: 'file' }
}

function resultMeta(step) {
  if (step.resultMeta) return step.resultMeta
  if (step.status === 'running') return 'в процессе'
  return ''
}

function ToolGlyph({ name }) {
  if (name === 'read_file') return <IconFile />
  if (name === 'list_files') return <IconFolder />
  if (['write_file', 'patch_file', 'move_file', 'delete_file'].includes(name)) return <IconEdit />
  if (name === 'run_command') return <IconCode />
  if (['list_connected_repositories', 'open_connected_repository', 'repository_status', 'list_repository_branches', 'list_repository_commits', 'pull_repository', 'create_repository_branch', 'push_repository', 'create_pull_request'].includes(name)) return <IconBranch />
  return <IconSearch />
}

function WorkLog({ message, active, statusInfo }) {
  const [open, setOpen] = useState(true)
  const [, tick] = useState(0)
  const started = message.workStartedAt || message.ts || Date.now()

  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [active])

  const elapsed = active
    ? (Date.now() - started) / 1000
    : (message.stats?.seconds || ((message.workFinishedAt || started) - started) / 1000)
  const steps = message.toolSteps || []
  // Во время работы новые действия важнее истории: активный шаг должен быть
  // сразу под заголовком, а не теряться внизу длинного журнала.
  const displaySteps = active ? [...steps].reverse() : steps
  const blocks = parseFileBlocks(message.content || '')
  const applied = new Set(message.appliedPaths || [])
  const changes = message.fileChanges || []
  const changedPaths = new Set(changes.map((item) => item.path))
  const prepared = blocks.filter((block) => !changedPaths.has(block.path))
  const hasThought = !!message.reasoning
  const lastStep = steps[steps.length - 1]
  const showLiveStatus = active && statusInfo && !(
    lastStep?.status === 'running'
  )
  const hasRows = hasThought || steps.length > 0 || changes.length > 0 || prepared.length > 0 || showLiveStatus || message.plan?.length > 0
  if (!hasRows) return null

  return (
    <section className={'work-log' + (active ? ' is-live' : '')} aria-label="Ход работы агента">
      <button className="work-log-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className={'work-state-dot' + (active ? ' live' : '')} />
        <span>{active ? 'Работает' : 'Работал'} {formatWorkTime(elapsed)}</span>
        <IconChevronDown className={'work-chevron' + (open ? ' open' : '')} />
      </button>
      {open && (
        <div className="work-log-body">
          {message.plan?.length > 0 && <ol className="work-plan">{message.plan.map((item, index) => <li key={index} className={active && index === 1 ? 'active' : ''}>{item}</li>)}</ol>}
          {hasThought && (
            <div className="work-row work-thought">
              <span className="work-icon"><IconBrain /></span>
              <span className="work-label">Размышлял</span>
              <span className="work-sep">·</span>
              <span className="work-meta">несколько секунд</span>
            </div>
          )}
          {showLiveStatus && (
            <div className="work-row running">
              <span className="work-icon"><IconCode /></span>
              <span className="work-label">{statusInfo.verb}</span>
              {statusInfo.target && <span className="work-target">{statusInfo.target}</span>}
              <span className="work-mini-loader" />
            </div>
          )}
          {displaySteps.map((step, index) => {
            const info = stepInfo(step)
            const path = ['read_file', 'write_file', 'patch_file', 'delete_file'].includes(step.name) ? step.args?.path : ''
            const parts = path ? fileParts(path) : null
            const label = step.name === 'read_file' ? 'Читал'
              : step.name === 'list_files' ? 'Обзор'
                : step.name === 'list_connected_repositories' ? 'Репозитории GitHub'
                  : step.name === 'open_connected_repository' ? 'Открыл GitHub'
                : step.name === 'write_file' ? 'Записал'
                  : step.name === 'patch_file' ? 'Изменил'
                    : step.name === 'move_file' ? 'Переместил'
                      : step.name === 'delete_file' ? 'Удалил'
                        : step.name === 'run_command' ? 'Проверил'
                          : step.name === 'repository_status' ? 'Проверил GitHub'
                            : step.name === 'list_repository_branches' ? 'Ветки GitHub'
                              : step.name === 'list_repository_commits' ? 'Коммиты GitHub'
                                : step.name === 'pull_repository' ? 'Получил из GitHub'
                                  : step.name === 'create_repository_branch' ? 'Создал ветку'
                                    : step.name === 'push_repository' ? 'Отправил в GitHub'
                                      : step.name === 'create_pull_request' ? 'Создал Pull Request'
                          : 'Искал'
            const target = parts ? parts.name : (step.name === 'list_files' ? '' : step.args?.query || step.args?.command || (step.name === 'move_file' ? `${step.args?.from} → ${step.args?.to}` : ''))
            return (
              <div className={'work-row' + (step.status === 'running' ? ' running' : '')} key={step.id || index}>
                <span className="work-icon"><ToolGlyph name={step.name} /></span>
                <span className="work-label">{label}</span>
                {path && <FileBadge path={path} />}
                {target && <span className="work-target" title={path || target}>{target}</span>}
                {parts?.dir && <span className="work-path">{parts.dir}</span>}
                {info?.target && !path && step.name !== 'list_files' && <span className="work-path">{info.target}</span>}
                {resultMeta(step) && <><span className="work-sep">·</span><span className="work-meta">{resultMeta(step)}</span></>}
                {step.status === 'running' && <span className="work-mini-loader" />}
              </div>
            )
          })}
          {changes.map((change, index) => {
            const parts = fileParts(change.path)
            return (
              <div className="work-row work-change" key={change.path + index}>
                <span className="work-icon"><IconEdit /></span>
                <span className="work-label">{change.deleted ? 'Удалил' : change.movedTo ? 'Переместил' : change.movedFrom ? 'Создал' : 'Изменил'}</span>
                <FileBadge path={change.path} />
                <span className="work-target" title={change.path}>{parts.name}</span>
                <span className="work-path">{parts.dir}</span>
                <span className="work-diff plus">+{change.added || 0}</span>
                <span className="work-diff minus">-{change.removed || 0}</span>
              </div>
            )
          })}
          {prepared.map((block, index) => {
            const parts = fileParts(block.path)
            return (
              <div className="work-row" key={block.path + index}>
                <span className="work-icon"><IconEdit /></span>
                <span className="work-label">{active ? 'Пишет' : applied.has(block.path) ? 'Изменил' : 'Подготовил'}</span>
                <FileBadge path={block.path} />
                <span className="work-target" title={block.path}>{parts.name}</span>
                <span className="work-path">{parts.dir}</span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function FileBadge({ path }) {
  const kind = fileKind(path)
  return <span className={'work-file-badge ' + kind.tone}>{kind.label}</span>
}

function summarizeToolResult(name, output) {
  const text = String(output || '').trim()
  const lines = text ? text.split(/\r?\n/).filter(Boolean) : []
  if (name === 'list_files') return `${lines.length} ${lines.length === 1 ? 'файл' : 'файлов'}`
  if (name === 'list_connected_repositories') return `${lines.length} репозиториев`
  if (name === 'open_connected_repository') return lines[0] || 'репозиторий открыт'
  if (name === 'read_file') return `${lines.length} ${lines.length === 1 ? 'строка' : 'строк'}`
  if (name === 'search_project' || name === 'semantic_search') {
    const files = new Set(lines.map((line) => line.match(/^([^:\n]+(?:\.[\w-]+)):/)?.[1]).filter(Boolean))
    const suffix = files.size ? ` · ${files.size} ${files.size === 1 ? 'файл' : 'файлов'}` : ''
    return `${lines.length} ${lines.length === 1 ? 'совпадение' : 'совпадений'}${suffix}`
  }
  if (['write_file', 'patch_file', 'move_file', 'delete_file'].includes(name)) return text.split('\n')[0] || 'готово'
  if (name === 'run_command') {
    const code = text.match(/Код завершения:\s*(-?\d+)/)?.[1]
    return code === '0' ? 'проверка пройдена' : code ? `код ${code}` : 'завершено'
  }
  if (name === 'repository_status') return 'состояние получено'
  if (name === 'list_repository_branches') return `${lines.length} веток`
  if (name === 'list_repository_commits') return `${lines.length} коммитов`
  if (name === 'pull_repository' || name === 'create_repository_branch' || name === 'push_repository' || name === 'create_pull_request') return lines[0] || 'завершено'
  return 'готово'
}

function safeToolPath(value) {
  const clean = String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (!clean || clean.startsWith('/') || /^[A-Za-z]:\//.test(clean) || clean.split('/').includes('..')) {
    throw new Error('Разрешён только относительный путь внутри проекта')
  }
  return clean
}

function lineDelta(before, after) {
  const left = String(before || '').split(/\r?\n/)
  const right = String(after || '').split(/\r?\n/)
  let start = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start++
  let end = 0
  while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++
  return { added: Math.max(0, right.length - start - end), removed: Math.max(0, left.length - start - end) }
}

export default function ChatPage() {
  const store = useStore()
  const { chats, setChats, activeChatId, settings, setSettings } = store
  const chat = chats.find((c) => c.id === activeChatId) || null
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState([])
  const [streaming, setStreaming] = useState(false)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [curStep, setCurStep] = useState(null) // инструмент, который агент использует сейчас
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [streamStats, setStreamStats] = useState({ tokens: 0, speed: 0 })
  const [streamUsage, setStreamUsage] = useState(null)
  const [continuePart, setContinuePart] = useState(0)
  const [actionMenu, setActionMenu] = useState(null)
  const [applying, setApplying] = useState(() => new Set())
  const applyingRef = useRef(new Set())
  const approvalResolveRef = useRef(null)
  const abortRef = useRef(null)
  const listRef = useRef(null)
  const panelRef = useRef(null)
  const reasonRef = useRef(null)
  const stick = useRef(true)
  const [toolApproval, setToolApproval] = useState(null)
  const [reviewOpen, setReviewOpen] = useState(false) // ReviewSheet для pending edits

  const draftKey = `verbaide.composer-draft.${activeChatId || 'new'}`

  // Черновик не исчезает, если Android выгрузил WebView или пользователь
  // случайно закрыл приложение. Для разных чатов он хранится отдельно.
  useEffect(() => {
    try { setInput(localStorage.getItem(draftKey) || '') } catch { setInput('') }
  }, [draftKey])
  useEffect(() => {
    try {
      if (input) localStorage.setItem(draftKey, input)
      else localStorage.removeItem(draftKey)
    } catch { /* квота localStorage не должна ломать чат */ }
  }, [draftKey, input])

  useEffect(() => {
    if (!store.composerDraft) return
    setInput(store.composerDraft)
    store.setComposerDraft('')
  }, [store.composerDraft])

  // Агентская задача должна переживать переход в другой раздел. Сам поток
  // пишет результат в Store, поэтому здесь при размонтировании закрываем лишь
  // ожидающее подтверждение, но не отменяем запрос.
  useEffect(() => () => {
    approvalResolveRef.current?.(false)
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })

  // автоскролл живой панели кода и размышлений
  useEffect(() => {
    for (const el of [panelRef.current, reasonRef.current]) {
      if (el) el.scrollTop = el.scrollHeight
    }
  })

  const onScroll = () => {
    const el = listRef.current
    if (el) {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90
      setShowScrollDown(!stick.current)
    }
  }

  const scrollToBottom = () => {
    stick.current = true
    setShowScrollDown(false)
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }

  function ensureChat() {
    if (chat) return chat
    const c = { id: uid(), title: 'Новый чат', messages: [], ts: Date.now() }
    setChats((p) => [c, ...p])
    store.setActiveChatId(c.id)
    return c
  }

  async function gatherFiles(sourceAttachments = attachments) {
    const files = []
    const images = []
    for (const a of sourceAttachments) {
      try {
        const content = a.external ? a.content : await store.readFile(a.path)
        if (a.kind === 'image' && a.dataUrl) images.push({ path: a.path, dataUrl: a.dataUrl, mimeType: a.mimeType })
        else if (content != null) files.push({ path: a.path, content, kind: a.kind || 'text' })
      } catch (e) {
        store.toast('Пропущен ' + a.path + ': ' + e.message)
      }
    }
    return { files, images }
  }

  const requestToolApproval = (details, signal) => new Promise((resolve) => {
    const finish = (allowed) => {
      signal?.removeEventListener('abort', onAbort)
      if (approvalResolveRef.current === finish) approvalResolveRef.current = null
      setToolApproval(null)
      resolve(allowed)
    }
    const onAbort = () => finish(false)
    approvalResolveRef.current?.(false)
    approvalResolveRef.current = finish
    setToolApproval(details)
    if (signal?.aborted) {
      finish(false)
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

  const settleToolApproval = (allowed) => approvalResolveRef.current?.(allowed)

  // Инструменты агента: чтение, точечные правки и безопасные проверки.
  const executeTool = async (name, args, context = {}) => {
    const globalRepositoryTools = ['list_connected_repositories', 'open_connected_repository']
    if (!store.project && !globalRepositoryTools.includes(name)) return Promise.resolve('Ошибка: проект не открыт')
    if (name === 'list_connected_repositories') {
      const repos = await store.fetchMyRepos()
      return repos?.length
        ? repos.map((repo) => `${repo.fullName}\t${repo.branch}\t${repo.private ? 'private' : 'public'}\t${repo.description || ''}`).join('\n')
        : 'Нет доступных репозиториев или GitHub не подключён'
    }
    if (name === 'open_connected_repository') {
      const owner = String(args.owner || '').trim()
      const repo = String(args.repo || '').trim()
      if (!owner || !repo) return 'Ошибка: нужны owner и repo'
      const allowed = await requestToolApproval({
        kind: 'repository',
        title: 'Открыть репозиторий GitHub?',
        message: `${owner}/${repo}`,
        detail: 'Текущий открытый проект будет заменён загруженной копией репозитория',
      }, context.signal)
      if (!allowed) return 'Отказано пользователем: репозиторий не открыт'
      return (await store.cloneFromGitHub({ owner, repo }, args.branch))
        ? `Репозиторий открыт: ${owner}/${repo}`
        : 'Ошибка: репозиторий не удалось открыть'
    }
    if (name === 'list_files') {
      const files = (store.project.tree || []).filter((t) => t.kind === 'file').map((t) => t.path)
      return Promise.resolve(files.length ? files.slice(0, 800).join('\n') : 'Проект пуст')
    }
    if (name === 'read_file') {
      if (!args.path) return Promise.resolve('Ошибка: не указан path')
      const limit = settings.maxFileChars || 24000
      return store
        .readFile(args.path)
        .then((c) => (c.length > limit ? c.slice(0, limit) + '\n…(обрезано)' : c))
        .catch((e) => 'Ошибка: ' + e.message)
    }
    if (name === 'search_project') {
      return searchInProject({
        tree: store.project.tree || [],
        readFile: store.readFile,
        query: args.query || '',
        max: 50,
      }).then((res) =>
        res.length ? res.map((r) => `${r.path}:${r.line}: ${r.text}`).join('\n') : 'Ничего не найдено'
      )
    }
    if (name === 'semantic_search') {
      return semanticSearchProject({
        project: store.project,
        readFile: store.readFile,
        query: args.query || '',
        max: 12,
      }).then((res) => res.length
        ? res.map((r) => `${r.path}:${r.line}\n${r.text}`).join('\n\n---\n\n')
        : 'В индексе ничего релевантного не найдено')
    }
    if (name === 'write_file' || name === 'patch_file') {
      if (store.project.needsPermission) return 'Ошибка: нет разрешения на запись в папку проекта'
      try {
        const path = safeToolPath(args.path)
        const exists = store.projectHasFile(path)
        const before = exists ? await store.readFile(path) : ''
        let after
        if (name === 'write_file') {
          if (typeof args.content !== 'string') return 'Ошибка: content должен быть строкой'
          after = args.content
        } else {
          if (!exists) return `Ошибка: файл не найден: ${path}`
          const oldText = String(args.old_text ?? '')
          const newText = String(args.new_text ?? '')
          if (!oldText) return 'Ошибка: old_text не может быть пустым'
          const hits = before.split(oldText).length - 1
          if (!hits) return 'Ошибка: old_text не найден в файле; сначала перечитай актуальное содержимое'
          if (hits > 1 && !args.replace_all) return `Ошибка: найдено ${hits} совпадений; уточни фрагмент или установи replace_all`
          after = args.replace_all ? before.split(oldText).join(newText) : before.replace(oldText, newText)
        }
        if (after === before) return 'Файл уже содержит требуемый результат; запись не нужна'

        // Безопасный процесс: сохраняем правку в pendingEdits, не применяем сразу.
        // Стартуем AI-сессию, если ещё не начата. Пользователь увидит ReviewSheet
        // с построчным diff'ом и сможет выбрать, что применять.
        if (!store.aiSession) store.startAiSession()

        const edit = toolCallToPending(name, args, before, after)
        store.addPendingEdit(edit)
        setReviewOpen(true)

        // Записываем в сообщение preliminary file change для отображения в WorkLog
        const change = { path, ...lineDelta(before, after) }
        setChats((previous) => patchMsg(previous, context.chatId, context.assistantId, (message) => ({
          ...message,
          fileChanges: [...(message.fileChanges || []).filter((item) => item.path !== path), change],
        })))
        return `Изменение подготовлено: ${path} (+${change.added} -${change.removed}). Проверьте и подтвердите в панели правок.`
      } catch (error) {
        return 'Ошибка: ' + (error?.message || String(error))
      }
    }
    if (name === 'move_file' || name === 'delete_file') {
      try {
        const from = safeToolPath(name === 'move_file' ? args.from : args.path)
        const to = name === 'move_file' ? safeToolPath(args.to) : null
        if (!store.projectHasFile(from)) return `Ошибка: файл не найден: ${from}`
        let before = ''
        try {
          before = await store.readFile(from)
        } catch (error) {
          if (name === 'move_file') throw error
        }
        const needsApproval = name === 'delete_file' || !settings.confirmForMe
        if (needsApproval) {
          const allowed = await requestToolApproval({
            kind: name === 'delete_file' ? 'delete' : 'file',
            title: name === 'delete_file' ? 'Разрешить удаление файла?' : 'Разрешить перемещение файла?',
            message: name === 'delete_file' ? from : `${from} → ${to}`,
            detail: name === 'delete_file' ? 'Файл будет удалён из проекта' : 'Путь файла будет изменён',
          }, context.signal)
          if (!allowed) return `Отказано пользователем: файл не ${name === 'delete_file' ? 'удалён' : 'перемещён'}`
        }
        if (name === 'delete_file') await store.deleteFile(from)
        else await store.moveFile(from, to)
        await store.refreshTree()
        const lines = String(before).split(/\r?\n/).length
        setChats((previous) => patchMsg(previous, context.chatId, context.assistantId, (message) => ({
          ...message,
          fileChanges: name === 'delete_file'
            ? [...(message.fileChanges || []).filter((item) => item.path !== from), { path: from, added: 0, removed: lines, deleted: true }]
            : [
                ...(message.fileChanges || []).filter((item) => item.path !== from && item.path !== to),
                { path: from, added: 0, removed: lines, movedTo: to },
                { path: to, added: lines, removed: 0, movedFrom: from },
              ],
        })))
        return name === 'delete_file' ? `Файл удалён: ${from}` : `Файл перемещён: ${from} → ${to}`
      } catch (error) {
        return 'Ошибка: ' + (error?.message || String(error))
      }
    }
    if (name === 'run_command') {
      const command = String(args.command || '').trim()
      if (!command) return 'Ошибка: не указана команда'
      const allowed = await requestToolApproval({
        kind: 'command',
        title: 'Разрешить проверку проекта?',
        message: 'Команда запускается локальным dev-сервером только после подтверждения.',
        detail: command,
      }, context.signal)
      if (!allowed) return 'Отказано пользователем: команда не запускалась'
      try {
        return await runProjectCommand({ command, projectName: store.project.name, signal: context.signal })
      } catch (error) {
      return 'Ошибка: ' + (error?.message || String(error))
    }
  }
    if (name === 'repository_status') {
      try {
        return JSON.stringify(store.repositoryStatus(), null, 2)
      } catch (error) {
        return 'Ошибка: ' + (error?.message || String(error))
      }
    }
    if (name === 'list_repository_branches') {
      try {
        const status = store.repositoryStatus()
        const branches = await store.fetchBranches(...status.repository.split('/'))
        return branches?.length ? branches.join('\n') : 'Ветки не найдены'
      } catch (error) {
        return 'Ошибка: ' + (error?.message || String(error))
      }
    }
    if (name === 'list_repository_commits') {
      try {
        const status = store.repositoryStatus()
        const [owner, repo] = status.repository.split('/')
        const commits = await store.fetchCommits(owner, repo, status.branch)
        return commits?.length
          ? commits.map((item) => `${item.sha.slice(0, 7)} ${item.message} — ${item.author}`).join('\n')
          : 'Коммиты не найдены'
      } catch (error) {
        return 'Ошибка: ' + (error?.message || String(error))
      }
    }
    if (name === 'pull_repository') {
      const allowed = await requestToolApproval({
        kind: 'repository',
        title: 'Применить изменения из GitHub?',
        message: 'Текущая ветка будет обновлена из удалённого репозитория.',
        detail: args.force ? 'При конфликтах локальные версии будут заменены версией GitHub' : 'При конфликте изменения не будут применены без отдельного решения',
      }, context.signal)
      if (!allowed) return 'Отказано пользователем: изменения из GitHub не применены'
      const result = await store.pullFromGitHub({ force: !!args.force })
      if (!result) return 'Ошибка: не удалось получить изменения из GitHub'
      if (result.conflicts?.length) return `Конфликты: ${result.conflicts.join(', ')}. Изменения не применены.`
      return 'Изменения из GitHub применены'
    }
    if (name === 'create_repository_branch') {
      const branch = String(args.name || '').trim()
      if (!branch) return 'Ошибка: не указано имя ветки'
      const allowed = await requestToolApproval({
        kind: 'repository',
        title: 'Создать ветку GitHub?',
        message: branch,
        detail: 'Будет создана новая ветка от текущей ветки и проект переключится на неё',
      }, context.signal)
      if (!allowed) return 'Отказано пользователем: ветка не создана'
      return (await store.createGitBranch(branch)) ? `Ветка создана и открыта: ${branch}` : 'Ошибка: не удалось создать ветку'
    }
    if (name === 'push_repository') {
      const status = (() => { try { return store.repositoryStatus() } catch { return null } })()
      if (!status) return 'Ошибка: откройте проект, связанный с GitHub-репозиторием'
      if (!status.changes.length) return 'Нет локальных изменений для отправки'
      const message = String(args.message || '').trim()
      if (!message) return 'Ошибка: укажите сообщение коммита'
      const allowed = await requestToolApproval({
        kind: 'repository',
        title: 'Отправить изменения в GitHub?',
        message: `${status.repository} · ${status.branch}`,
        detail: `${status.changes.length} файлов · commit: ${message}${args.create_pull_request ? ` · затем Pull Request в ${args.base_branch || 'main'}` : ''}`,
      }, context.signal)
      if (!allowed) return 'Отказано пользователем: push не выполнен'
      return (await store.pushToGitHub({ message, createPR: !!args.create_pull_request, baseBranch: args.base_branch }))
        ? 'Изменения успешно отправлены в GitHub'
        : 'Ошибка: push не выполнен'
    }
    if (name === 'create_pull_request') {
      const title = String(args.title || '').trim()
      const baseBranch = String(args.base_branch || '').trim()
      if (!title || !baseBranch) return 'Ошибка: нужны title и base_branch'
      const allowed = await requestToolApproval({
        kind: 'repository',
        title: 'Создать Pull Request?',
        message: `${title} → ${baseBranch}`,
        detail: 'Pull Request будет создан в GitHub из текущей ветки проекта',
      }, context.signal)
      if (!allowed) return 'Отказано пользователем: Pull Request не создан'
      try {
        const pr = await store.createGitPullRequest({ title, body: args.body, baseBranch })
        return `Pull Request создан #${pr.number}${pr.url ? `: ${pr.url}` : ''}`
      } catch (error) {
        return 'Ошибка: ' + (error?.message || String(error))
      }
    }
    return Promise.resolve('Неизвестный инструмент: ' + name)
  }

  async function send() {
    const rawText = input.trim()
    if ((!rawText && !attachments.length) || streaming) return
    if (store.tasks.some((task) => task.kind === 'agent' && task.status === 'running')) {
      store.toast('Уже выполняется фоновая задача — дождитесь завершения или остановите её в чате')
      return
    }
    const prov = store.selectedProvider()
    if (!prov || !settings.selected?.model) {
      store.toast('Сначала добавьте провайдера в Настройках')
      store.setPage('settings')
      return
    }
    const selectedCaps = inferProviderCapabilities({ ...prov, models: [settings.selected.model] })
    const expanded = expandSlashCommand(rawText, {
      selection: store.canvasSelection?.text || '',
      webAvailable: selectedCaps.webSearch,
    })
    const text = expanded?.content || rawText
    if (expanded?.id === 'search' && !selectedCaps.webSearch) store.toast('Веб-поиск не найден у модели — выполню поиск по проекту')
    const mentioned = [...rawText.matchAll(/@([^\s@]+)/gu)].map((m) => m[1].replace(/\\/g, '/'))
    const mentionedAttachments = mentioned
      .filter((path) => store.projectHasFile(path) && !attachments.some((a) => a.path === path))
      .map((path) => ({ path, mentioned: true }))
    const activeAttachments = [...attachments, ...mentionedAttachments]
    const { files, images } = await gatherFiles(activeAttachments)
    if (images.length && selectedCaps.vision === false) {
      store.toast('Выбранная модель не поддерживает Vision. Уберите изображение или выберите другую модель.')
      return
    }
    const userMsg = {
      id: uid(), role: 'user', content: rawText || 'Проанализируй прикреплённые материалы.',
      modelContent: text || 'Проанализируй прикреплённые материалы.',
      command: expanded?.id || null,
      attachments: activeAttachments.map((a) => a.path),
      images,
    }
    const target = ensureChat()
    try {
      localStorage.removeItem(draftKey)
      localStorage.removeItem(`verbaide.composer-draft.${target.id}`)
    } catch { /* ignore */ }
    const fullHistory = [...target.messages, userMsg]
      .filter((m) => !(m.role === 'assistant' && m.providerError && !m.content))
      .map((m) => ({ role: m.role, content: m.modelContent || m.content, images: m.images }))
    const history = target.summary && fullHistory.length > 14 ? fullHistory.slice(-14) : fullHistory
    const assistantId = uid()
    setChats((p) =>
      p.map((c) =>
        c.id === target.id
          ? {
              ...c,
              title: c.messages.length ? c.title : (rawText || activeAttachments[0]?.path || 'Новый чат').slice(0, 42),
              messages: [...c.messages, userMsg, {
                id: assistantId, role: 'assistant', content: '', ts: Date.now(), workStartedAt: Date.now(),
                plan: taskPlan(rawText, !!store.project),
                sources: [
                  ...files.map((file) => ({ path: file.path, kind: file.kind, excerpt: file.content.slice(0, 180) })),
                  ...images.map((image) => ({ path: image.path, kind: 'image', excerpt: 'Изображение передано модели для анализа' })),
                ],
              }],
            }
          : c
      )
    )
    setInput('')
    setAttachments([])
    setPanelCollapsed(false)
    setCurStep(null)
    setShowScrollDown(false)
    stick.current = true
    const task = store.addTask({ title: (rawText || 'Задача ИИ').slice(0, 70), chatId: target.id, assistantId, kind: 'agent' })
    runStream(target.id, history, assistantId, files, prov, fullHistory, task.id)
  }

  async function summarizeLongChat(chatId, source, assistantText, prov) {
    if (settings.autoSummarize === false || source.length < 17 || source.length % 8 !== 1) return
    const transcript = [...source, { role: 'assistant', content: assistantText }]
      .slice(-24)
      .map((m) => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.content || '[изображение]'}`)
      .join('\n\n')
      .slice(-48000)
    try {
      let summary = ''
      const iterator = streamChat({
        provider: prov,
        model: settings.selected.model,
        messages: [{ role: 'user', content: `Сделай компактное рабочее резюме диалога: цели, решения, ограничения, изменённые файлы и незавершённые задачи. Не добавляй ничего от себя.\n\n${transcript}` }],
        system: 'Ты сжимаешь контекст диалога для продолжения работы. Ответь только резюме.',
        thinking: false,
        tools: [],
        maxOutputTokens: 2000, // резюме короткое, полный лимит здесь не нужен
      })
      for await (const event of iterator) if (event.kind === 'text') summary += event.value
      if (summary.trim()) setChats((p) => p.map((c) => c.id === chatId ? { ...c, summary: summary.trim(), summaryMessageCount: source.length + 1 } : c))
    } catch { /* резюме не должно мешать основному ответу */ }
  }

  async function runStream(chatId, history, assistantId, files, prov, summarySource = history, taskId = null, retryAttempt = 0) {
    setStreaming(true)
    if (taskId) {
      store.patchTask(taskId, { status: 'running', step: 'Подключаю модель', startedAt: Date.now() })
      updateNativeAgent('start', { taskId, title: 'VerbaIDE · ' + (history.at(-1)?.content || 'Задача').slice(0, 38), step: 'Подключаю модель' })
    }
    const ctrl = new AbortController()
    const providerCaps = inferProviderCapabilities({ ...prov, models: [settings.selected?.model || ''] })
    abortRef.current = ctrl
    const maxMs = Math.max(1, Number(settings.agentLimits?.maxMinutes || 12)) * 60_000
    const limitTimer = setTimeout(() => ctrl.abort(), maxMs)
    let buf = ''
    let full = ''
    let rbuf = ''
    let streamError = null
    const startedAt = performance.now()
    setStreamStats({ tokens: 0, speed: 0 })
    setStreamUsage(null)
    setContinuePart(0)
    const flush = () => {
      if (!buf && !rbuf) return
      const add = buf
      const radd = rbuf
      buf = ''
      rbuf = ''
      setChats((p) =>
        patchMsg(p, chatId, assistantId, (m) => ({
          ...m,
          content: m.content + add,
          reasoning: radd ? (m.reasoning || '') + radd : m.reasoning,
        }))
      )
      const elapsed = Math.max(.1, (performance.now() - startedAt) / 1000)
      const tokens = Math.ceil(full.length / 4)
      setStreamStats({ tokens, speed: Math.round(tokens / elapsed) })
    }
    const timer = setInterval(flush, 60)
    let usage = {}
    let shouldRetry = false
    try {
      const sys = buildSystemPrompt({
        project: store.project,
        attachedFiles: files,
        effort: settings.effort,
        customInstructions: settings.customInstructions,
        plugins: settings.plugins || [],
        memories: (settings.memories || []).filter((m) => m.scope === 'global' || m.projectId === store.project?.id),
        projectInstruction: store.project ? settings.projectInstructions?.[store.project.id] : '',
        chatSummary: chat?.summary || '',
        maxFileChars: settings.maxFileChars,
      })
      const it = runAgent({
        provider: prov,
        model: settings.selected.model,
        system: sys,
        messages: history.map((m) => ({ role: m.role, content: m.content, images: m.images })),
        signal: ctrl.signal,
        thinking: !!settings.anthropicThinking && prov.format === 'anthropic',
        maxOutputTokens: settings.maxOutputTokens,
        // Gemini thinking-модели требуют возвращать зашифрованную
        // thought_signature внутри function call. Некоторые OpenAI-совместимые
        // прокси её не отдают, поэтому второй tool-шаг получает HTTP 400. Для
        // таких endpoint'ов безопасно отвечаем без локальных инструментов,
        // вместо падения всего чата.
        enableTools: providerCaps.functionCalling !== false && !/gemini|generativelanguage/i.test(`${prov.baseUrl || ''} ${settings.selected.model || ''}`),
        executeTool: (name, args) => executeTool(name, args, { chatId, assistantId, signal: ctrl.signal }),
      })
      while (true) {
        const { value: ev, done } = await it.next()
        if (done) break
        if (ev.kind === 'text') {
          setCurStep(null)
          if (taskId) { store.patchTask(taskId, { step: 'Формирую ответ', tokens: Math.ceil((full.length + ev.value.length) / 4) }); updateNativeAgent('progress', { title: 'VerbaIDE', step: 'Формирую ответ' }) }
          full += ev.value
          buf += ev.value
          if (Math.ceil(full.length / 4) >= Number(settings.agentLimits?.maxTokens || 24000)) ctrl.abort()
        } else if (ev.kind === 'reasoning') {
          rbuf += ev.value
        } else if (ev.kind === 'tool') {
          setCurStep(ev)
          if (taskId) { const step = 'Выполняю: ' + (ev.name || 'инструмент'); store.patchTask(taskId, { step }); updateNativeAgent('progress', { title: 'VerbaIDE', step }) }
          const s = { ...ev, id: uid(), status: 'running', startedAt: Date.now() }
          setChats((p) =>
            patchMsg(p, chatId, assistantId, (m) => ({ ...m, toolSteps: [...(m.toolSteps || []), s] }))
          )
        } else if (ev.kind === 'usage') {
          // Точный расход от провайдера: входные токены берём из последнего
          // запроса, выходные суммируем по всем шагам агента.
          usage = {
            ...usage,
            input: ev.usage.input ?? usage.input,
            output: (usage.output || 0) + (ev.usage.output || 0),
            cachedRead: (usage.cachedRead || 0) + (ev.usage.cachedRead || 0),
          }
          setStreamUsage(usage)
        } else if (ev.kind === 'continued') {
          setContinuePart(ev.part)
        } else if (ev.kind === 'tool_result') {
          const path = ev.args?.path || (ev.name === 'list_files' ? 'Структура проекта' : ev.args?.query || 'Проект')
          setChats((p) => patchMsg(p, chatId, assistantId, (m) => ({
            ...m,
            sources: ['list_files', 'read_file', 'search_project', 'semantic_search'].includes(ev.name)
              ? [...(m.sources || []), { path, kind: ev.name, excerpt: ev.output?.slice(0, 240) || '' }]
              : (m.sources || []),
            toolSteps: (() => {
              const next = [...(m.toolSteps || [])]
              const signature = JSON.stringify(ev.args || {})
              for (let index = next.length - 1; index >= 0; index--) {
                const step = next[index]
                if (step.name === ev.name && JSON.stringify(step.args || {}) === signature && step.status === 'running') {
                  next[index] = {
                    ...step,
                    status: 'done',
                    finishedAt: Date.now(),
                    resultMeta: summarizeToolResult(ev.name, ev.output),
                  }
                  break
                }
              }
              return next
            })(),
          })))
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        streamError = {
          kind: 'provider',
          message: e?.message || String(e),
          at: Date.now(),
        }
        // Один безопасный повтор только до первого фрагмента ответа: так не
        // дублируем текст и не повторяем команды агента после их выполнения.
        shouldRetry = retryAttempt < 1 && !full.trim() && /network|fetch|connection|timeout|временн|сеть/i.test(streamError.message)
      }
    } finally {
      clearInterval(timer)
      clearTimeout(limitTimer)
      flush()
      setStreaming(false)
      setCurStep(null)
      abortRef.current = null
      setContinuePart(0)
      const seconds = Math.max(.1, (performance.now() - startedAt) / 1000)
      const exact = Number.isFinite(usage.output) || Number.isFinite(usage.input)
      const outputTokens = Number.isFinite(usage.output) ? usage.output : Math.ceil(full.length / 4)
      setChats((p) => patchMsg(p, chatId, assistantId, (m) => ({
        ...m,
        workFinishedAt: Date.now(),
        providerError: shouldRetry ? null : streamError,
        retrying: shouldRetry,
        stats: streamError ? null : {
          tokens: outputTokens,
          inputTokens: Number.isFinite(usage.input) ? usage.input : null,
          cachedTokens: usage.cachedRead || 0,
          exact,
          cost: estimateCost(prov, settings.selected.model, usage),
          seconds: Math.round(seconds * 10) / 10,
          speed: Math.round(outputTokens / seconds),
        },
      })))
      if (!shouldRetry) summarizeLongChat(chatId, summarySource, full, prov)
      if (taskId) {
        const aborted = ctrl.signal.aborted
        store.patchTask(taskId, { status: shouldRetry ? 'running' : aborted ? 'paused' : streamError ? 'failed' : 'done', step: shouldRetry ? 'Сеть недоступна — повторяю запрос' : aborted ? 'Приостановлена — лимит времени или пользователь' : streamError ? 'Ошибка провайдера' : 'Готово', finishedAt: shouldRetry ? null : Date.now(), tokens: outputTokens })
        if (!shouldRetry) updateNativeAgent('finish', { title: 'VerbaIDE', step: aborted ? 'Задача приостановлена' : streamError ? 'Ошибка задачи' : 'Задача завершена' })
        if (!aborted && !streamError && settings.agentLimits?.notify && 'Notification' in window && Notification.permission === 'granted') new Notification('VerbaIDE', { body: 'Задача завершена: ' + (full.slice(0, 80) || 'готово') })
      }
      if (shouldRetry) {
        setTimeout(() => runStream(chatId, history, assistantId, files, prov, summarySource, taskId, retryAttempt + 1), 900)
        return
      }
      // «Подтверждать за меня»: файловые блоки агента сохраняем как pending edits,
      // затем автоматически запускаем проверку и открываем ReviewSheet.
      // Раньше правки применялись сразу — теперь всё проходит через безопасный цикл.
      if (store.project && !store.project.needsPermission && settings.confirmForMe) {
        const blocks = parseFileBlocks(full)
        if (blocks.length) {
          if (!store.aiSession) store.startAiSession()
          for (const b of blocks) {
            try {
              let before = ''
              if (store.projectHasFile(b.path)) before = await store.readFile(b.path)
              if (b.code === before) continue // уже актуален
              const edit = toolCallToPending('write_file', { path: b.path, content: b.code }, before, b.code)
              store.addPendingEdit(edit)
            } catch { /* пропускаем блок, который не удалось прочитать */ }
          }
          // Автозапуск проверки после завершения ответа агента
          if (store.aiSession?.pendingEdits?.length) {
            setReviewOpen(true)
            // Запускаем check/build в фоне, результат появится в ReviewSheet
            store.runAiChecks().then((result) => {
              if (!result.ok) store.toast('Проверка не пройдена — push заблокирован. Откройте панель правок.')
            })
          }
        }
      }
    }
  }

  async function applyBlock(chatId, msgId, path, code) {
    if (store.project?.needsPermission) {
      store.toast('Сначала выдайте доступ к папке в разделе «Файлы»')
      return
    }
    if (applyingRef.current.has(path)) return // защита от повторного тапа
    applyingRef.current.add(path)
    setApplying(new Set(applyingRef.current))
    try {
      let before = ''
      if (store.projectHasFile(path)) before = await store.readFile(path)
      await store.writeFile(path, code)
      const change = { path, ...lineDelta(before, code) }
      setChats((p) =>
        patchMsg(p, chatId, msgId, (m) => ({
          ...m,
          appliedPaths: [...new Set([...(m.appliedPaths || []), path])],
          fileChanges: [...(m.fileChanges || []).filter((item) => item.path !== path), change],
        }))
      )
      store.refreshTree()
      store.toast('Сохранено: ' + path)
    } catch (e) {
      store.toast('Ошибка: ' + e.message)
    } finally {
      applyingRef.current.delete(path)
      setApplying(new Set(applyingRef.current))
    }
  }

  const codeExtraFor = (m) => (raw) => {
    const nl = raw.indexOf('\n')
    const info = nl >= 0 ? raw.slice(0, nl).trim() : ''
    const first = info.split(/\s+/)[0] || ''
    let path = null
    if (first.startsWith('file:')) path = first.slice(5)
    else if (/^[\w.\-/\\]+\.[A-Za-z0-9]+$/.test(first)) path = first
    if (!path) return null
    path = path.replace(/\\/g, '/').replace(/^\.\//, '')
    if ((m.appliedPaths || []).includes(path)) {
      return (
        <span className="applied-tag">
          <IconCheck width={12} height={12} /> сохранён
        </span>
      )
    }
    if (!store.project || streaming) return null
    const code = nl >= 0 ? raw.slice(nl + 1) : raw
    const busy = applying.has(path)
    return (
      <button className="mini-btn accent" disabled={busy} onClick={() => applyBlock(chat.id, m.id, path, code)}>
        {busy ? 'Сохраняю…' : 'Применить'}
      </button>
    )
  }

  // Стоимость считается только когда цена модели задана в настройках —
  // выдумывать тарифы за провайдера нельзя.
  const estimateCost = (provider, model, usage) => {
    const price = settings.modelPrices?.[`${provider.id}:${model}`]
    if (!price || !usage) return null
    const inPrice = Number(price.input)
    const outPrice = Number(price.output)
    if (!Number.isFinite(inPrice) && !Number.isFinite(outPrice)) return null
    const billedInput = Math.max(0, (usage.input || 0) - (usage.cachedRead || 0))
    const total =
      (billedInput / 1e6) * (Number.isFinite(inPrice) ? inPrice : 0) +
      ((usage.output || 0) / 1e6) * (Number.isFinite(outPrice) ? outPrice : 0)
    return Math.round(total * 1e6) / 1e6
  }

  const liveTokens = Number.isFinite(streamUsage?.output)
    ? streamUsage.output.toLocaleString('ru-RU')
    : '≈' + streamStats.tokens

  const messages = chat?.messages || []
  const lastIdx = messages.length - 1

  async function retryLastResponse() {
    if (streaming || !chat || messages[lastIdx]?.role !== 'assistant') return
    const prov = store.selectedProvider()
    if (!prov || !settings.selected?.model) {
      store.toast('Сначала добавьте провайдера в Настройках')
      store.setPage('settings')
      return
    }

    const baseMessages = messages.slice(0, lastIdx)
    const lastUser = [...baseMessages].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    const files = []
    for (const path of lastUser.attachments || []) {
      try {
        const content = await store.readFile(path)
        if (content != null) files.push({ path, content })
      } catch { /* внешний файл уже недоступен — повторяем без него */ }
    }

    const assistantId = uid()
    setChats((p) =>
      p.map((c) =>
        c.id === chat.id
          ? { ...c, messages: [...baseMessages, { id: assistantId, role: 'assistant', content: '', ts: Date.now(), workStartedAt: Date.now() }] }
          : c
      )
    )
    setPanelCollapsed(false)
    setCurStep(null)
    stick.current = true
    runStream(
      chat.id,
      baseMessages
        .filter((m) => !(m.role === 'assistant' && m.providerError && !m.content))
        .map((m) => ({ role: m.role, content: m.modelContent || m.content, images: m.images })),
      assistantId,
      files,
      prov
    )
  }

  // последний ассистентский ответ и файловый блок, который агент пишет прямо сейчас
  const lastAssistant = streaming ? [...messages].reverse().find((m) => m.role === 'assistant') : null
  const block = lastAssistant ? lastFileBlock(lastAssistant.content) : null

  const statusInfo = (() => {
    if (!streaming) return null
    if (continuePart) return { kind: 'write', verb: 'дописывает ответ', target: 'часть ' + (continuePart + 1) }
    if (curStep) return stepInfo(curStep)
    if (block) {
      if (!block.closed) {
        return store.projectHasFile(block.path)
          ? { kind: 'edit', verb: 'редактирует', target: block.path }
          : { kind: 'create', verb: 'создаёт', target: block.path }
      }
      if (block.active) return { kind: 'done', verb: 'файл готов', target: block.path }
    }
    if (lastAssistant?.reasoning && !lastAssistant.content) return { kind: 'think', verb: 'размышляет…' }
    if (lastAssistant?.reasoning) return { kind: 'write', verb: 'дописывает ответ…' }
    if (lastAssistant?.content) return { kind: 'write', verb: 'пишет ответ…' }
    return { kind: 'think', verb: 'думает…' }
  })()

  // карточки файлов — только для последнего сообщения ассистента
  const fileCardFor = (m) => (raw) => {
    const nl = raw.indexOf('\n')
    const info = nl >= 0 ? raw.slice(0, nl).trim() : ''
    const first = info.split(/\s+/)[0] || ''
    const code = nl >= 0 ? raw.slice(nl + 1) : raw
    let path = null
    if (first.startsWith('file:')) path = first.slice(5)
    else if (/^[\w.\-/\\]+\.[A-Za-z0-9]+$/.test(first)) path = first
    // Полный HTML-документ часто приходит как обычный ```html. Превращаем
    // его в настоящий скачиваемый index.html, не затрагивая короткие примеры.
    else if (/^html?$/i.test(first) && /^\s*(?:<!doctype\s+html|<html\b)/i.test(code)) path = 'index.html'
    if (!path) return null // обычный блок кода
    path = path.replace(/\\/g, '/').replace(/^\.\//, '')
    const writing = !!(streaming && m.id === lastAssistant?.id && block && block.path === path && !block.closed)
    return (
      <FileCard
        key={path + m.id}
        path={path}
        code={code}
        applied={(m.appliedPaths || []).includes(path)}
        writing={writing}
        canApply={!!store.project && !store.project.needsPermission}
        onApply={() => applyBlock(chat.id, m.id, path, code)}
      />
    )
  }

  const contextTokens = useMemo(() => {
    const historyChars = (chat?.messages || []).reduce((n, m) => n + (m.content?.length || 0) + (m.reasoning?.length || 0), 0)
    const attachmentChars = attachments.reduce((n, a) => n + (a.content?.length || (a.dataUrl?.length || 0) / 8), 0)
    return Math.ceil((historyChars + input.length + attachmentChars) / 4)
  }, [chat?.messages, input, attachments])
  const contextLimit = settings.contextLimit || 128000
  const contextPercent = Math.min(100, Math.round(contextTokens / contextLimit * 100))

  const remember = (text) => {
    const value = String(text || '').trim()
    if (!value) return
    setSettings((s) => ({
      ...s,
      memories: [...(s.memories || []), { id: uid(), text: value.slice(0, 3000), scope: 'global', projectId: null, createdAt: Date.now() }],
    }))
    store.toast('Сообщение добавлено в память')
  }

  const copyMessage = async (message) => {
    try {
      await navigator.clipboard.writeText(message.content || '')
      store.toast('Сообщение скопировано')
    } catch { store.toast('Не удалось скопировать') }
    setActionMenu(null)
  }

  const repeatMessage = (message, index) => {
    setActionMenu(null)
    if (streaming) return
    if (message.role === 'assistant' && index === lastIdx) {
      retryLastResponse()
      return
    }
    const source = message.role === 'user'
      ? message
      : [...messages.slice(0, index)].reverse().find((m) => m.role === 'user')
    if (source) {
      setInput(source.content || '')
      store.toast('Запрос возвращён в поле ввода')
    }
  }

  const starterPrompts = [
    ['Найти ошибки', '/review Проверь проект и начни с критичных проблем'],
    ['Исправить проблему', '/fix Определи наиболее вероятную проблему в проекте'],
    ['Создать тесты', '/test Добавь тесты для ключевой логики проекта'],
    ['Объяснить проект', 'Изучи структуру проекта и кратко объясни, как всё устроено'],
  ]

  return (
    <div className="chat-wrap">
      {messages.length === 0 ? (
        <div className="chat-hero">
          <h1>VerbaIDE</h1>
          <p>Поручите что угодно — код, правки, идеи.</p>
          {!store.project && (
            <p className="hero-dim">Откройте папку проекта через «+» или в разделе «Файлы».</p>
          )}
          {!settings.selected && (
            <p className="hero-dim">
              Добавьте провайдера модели в{' '}
              <button className="link-btn" onClick={() => store.setPage('settings')}>Настройках</button>.
            </p>
          )}
          <div className="starter-prompts">
            {starterPrompts.map(([label, prompt]) => (
              <button key={label} onClick={() => setInput(prompt)}>{label}<IconChevronDown /></button>
            ))}
          </div>
        </div>
      ) : (
        <div className="msgs" ref={listRef} onScroll={onScroll}>
          {messages.map((m, i) => (
            <MessageGesture
              key={m.id}
              onSwipe={() => repeatMessage(m, i)}
              onLongPress={() => setActionMenu({ message: m, index: i })}
              haptics={settings.haptics !== false}
            >
            {m.role === 'user' ? (
              <div className="msg-user-wrap">
                <div className="msg-user">{m.content}</div>
                {m.images?.length > 0 && (
                  <div className="msg-images">
                    {m.images.map((img, n) => <img key={img.path + n} src={img.dataUrl} alt={img.path} />)}
                  </div>
                )}
                {m.attachments?.length > 0 && (
                  <div className="msg-atts">
                    {m.attachments.map((path) => (
                      <span className="msg-att" key={path} title={path}>
                        <IconFile width={12} height={12} />
                        <span>{path.split('/').pop()}</span>
                      </span>
                    ))}
                  </div>
                )}
                <MessageActions text={m.content} alignEnd onRemember={() => remember(m.content)} />
              </div>
            ) : (
              <div className="msg-assistant">
                <WorkLog message={m} active={i === lastIdx && streaming} statusInfo={i === lastIdx ? statusInfo : null} />
                {m.retrying && <div className="chat-retry-status"><ThinkingDots /> Сеть прервалась — повторяю запрос…</div>}
                {m.providerError && (
                  <ProviderErrorCard
                    error={m.providerError}
                    onRetry={i === lastIdx && !streaming ? retryLastResponse : null}
                    onSettings={() => store.setPage('settings')}
                  />
                )}
                {m.reasoning && settings.showThinking !== false && (
                  i === lastIdx && streaming ? (
                    <div className="reasoning-live" ref={reasonRef}>{m.reasoning}</div>
                  ) : (
                    <details className="reasoning">
                      <summary>Ход мыслей</summary>
                      <div className="reasoning-body">{m.reasoning}</div>
                    </details>
                  )
                )}
                <Markdown
                  text={m.content}
                  codeExtra={codeExtraFor(m)}
                  fileCard={fileCardFor(m)}
                />
                {m.sources?.length > 0 && (m.content || i !== lastIdx || !streaming) && (
                  <details className="answer-sources">
                    <summary>
                      <span className="source-summary-icon"><IconFile width={13} height={13} /></span>
                      <span className="source-summary-label">Источники ответа</span>
                      <span className="source-count">{m.sources.length}</span>
                      <IconChevronDown className="source-chevron" width={13} height={13} />
                    </summary>
                    <div className="sources-body">
                      {m.sources.map((s, n) => (
                        <div className="source-row" key={s.path + n}>
                          <span className="source-file-icon"><IconFile width={13} height={13} /></span>
                          <span>
                            <b>{s.path}</b>
                            <em>{s.kind === 'image' ? 'Изображение' : s.kind === 'semantic_search' ? 'Фрагмент из индекса' : s.kind === 'search_project' ? 'Результат поиска' : 'Файл проекта'}</em>
                            {s.excerpt && <small>{s.excerpt}</small>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {!m.providerError && (
                  <MessageActions
                    text={m.content}
                    onRetry={i === lastIdx && !streaming ? retryLastResponse : null}
                    onStop={i === lastIdx && streaming ? () => abortRef.current?.abort() : null}
                    onRemember={!streaming && m.content ? () => remember(m.content) : null}
                  />
                )}
                {m.stats && (
                  <div className="msg-stats"><MsgStats stats={m.stats} /></div>
                )}
              </div>
            )}
            </MessageGesture>
          ))}
        </div>
      )}

      {showScrollDown && messages.length > 0 && (
        <div className="scroll-bottom-row">
          <button className="scroll-bottom-btn" onClick={scrollToBottom} aria-label="К последнему сообщению">
            <IconArrowDown width={17} height={17} />
          </button>
        </div>
      )}

      {streaming && block && !panelCollapsed && (
        <div className="code-panel">
          <div className="cp-head">
            <ThinkingDots />
            <span className="cp-title"><ActLabel info={statusInfo} /></span>
            <span className="grow" />
            <button className="mini-btn" onClick={() => setPanelCollapsed(true)}>Скрыть</button>
          </div>
          <div className="cp-cm" ref={panelRef}>
            <CodeEditor variant="readable" value={block.code} path={block.path} className="cp-cm-inner" />
          </div>
        </div>
      )}

      {streaming && block && panelCollapsed && (
        <div className="gen-chip-row">
          <button className="gen-chip" onClick={() => setPanelCollapsed(false)}>
            <ThinkingDots />
            <span className="txt"><ActLabel info={statusInfo} /></span>
            <span className="live-stats">{liveTokens} · {streamStats.speed}/с</span>
            <IconChevronDown width={12} height={12} className="flip-up" />
          </button>
        </div>
      )}

      {streaming && !block && statusInfo && (
        <div className="gen-chip-row">
          <span className="gen-chip static">
            <ThinkingDots />
            <span className="txt"><ActLabel info={statusInfo} /></span>
            <span className="live-stats">{liveTokens} ток. · {streamStats.speed}/с</span>
          </span>
        </div>
      )}

      <ConfirmSheet
        open={!!toolApproval}
        title={toolApproval?.title}
        message={toolApproval?.message}
        confirmLabel={toolApproval?.kind === 'command' ? 'Запустить' : 'Разрешить'}
        danger={toolApproval?.kind === 'delete'}
        onCancel={() => settleToolApproval(false)}
        onConfirm={() => settleToolApproval(true)}
      >
        {toolApproval?.detail && <pre className="confirm-command">{toolApproval.detail}</pre>}
      </ConfirmSheet>

      {/* Плавающая кнопка открытия панели правок, если есть pending edits */}
      {store.aiSession?.pendingEdits?.length > 0 && !reviewOpen && (
        <button className="review-fab" onClick={() => setReviewOpen(true)}>
          <IconEdit width={16} height={16} />
          <span className="review-fab-count">{editsSummary(store.aiSession.pendingEdits).pending}</span>
        </button>
      )}

      <ReviewSheet
        open={reviewOpen}
        edits={store.aiSession?.pendingEdits || []}
        summary={editsSummary(store.aiSession?.pendingEdits || [])}
        checkResult={store.aiSession?.checkResult}
        onToggleEdit={(editId, selected) => store.updatePendingEdit(editId, { selected })}
        onSelectAll={() => {
          const edits = store.aiSession?.pendingEdits || []
          edits.forEach((e) => { if (!e.applied && !e.rejected) store.updatePendingEdit(e.id, { selected: true }) })
        }}
        onDeselectAll={() => {
          const edits = store.aiSession?.pendingEdits || []
          edits.forEach((e) => { if (!e.applied && !e.rejected) store.updatePendingEdit(e.id, { selected: false }) })
        }}
        onApply={async () => {
          const edits = store.aiSession?.pendingEdits || []
          const selectedIds = edits.filter((e) => e.selected && !e.applied && !e.rejected).map((e) => e.id)
          if (!selectedIds.length) return
          const result = await store.applyPendingEdits(selectedIds)
          if (result.failed.length) {
            store.toast('Не удалось сохранить: ' + result.failed[0])
          } else {
            store.toast('Применено файлов: ' + result.applied.length)
          }
          // После применения — автозапуск проверки
          await store.runAiChecks()
          // Обновляем сообщения о применённых путях
          const appliedPaths = result.applied
          setChats((p) =>
            patchMsg(p, chat?.id, messages[lastIdx]?.id, (m) => ({
              ...m,
              appliedPaths: [...new Set([...(m.appliedPaths || []), ...appliedPaths])],
            }))
          )
        }}
        onRevertSession={async () => {
          const ok = await store.revertAiSession()
          if (ok) setReviewOpen(false)
        }}
        onRunCheck={() => store.runAiChecks()}
        onClose={() => setReviewOpen(false)}
      />

      <Composer
        value={input}
        onChange={setInput}
        onSend={send}
        onStop={() => abortRef.current?.abort()}
        streaming={streaming}
        attachments={attachments}
        onRemoveAttachment={(path) => setAttachments((a) => a.filter((x) => x.path !== path))}
        onToggleAttach={(path) =>
          setAttachments((a) =>
            a.some((x) => x.path === path) ? a.filter((x) => x.path !== path) : [...a, { path }]
          )
        }
        onAttachFiles={async (fileList) => {
          const ext = await store.addFilesExternal(fileList)
          setAttachments((a) => [
            ...a,
            ...ext.filter((e) => !a.some((x) => x.path === e.path)),
          ])
        }}
        contextTokens={contextTokens}
        contextPercent={contextPercent}
      />
      <MessageActionSheet
        item={actionMenu}
        onClose={() => setActionMenu(null)}
        onCopy={() => copyMessage(actionMenu.message)}
        onRemember={() => { remember(actionMenu.message.content); setActionMenu(null) }}
        onRepeat={() => repeatMessage(actionMenu.message, actionMenu.index)}
      />
    </div>
  )
}
