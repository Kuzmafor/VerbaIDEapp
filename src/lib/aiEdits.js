// Безопасный процесс AI-правок: дифф, чекпойнты, проверка сборки.
// Полный цикл: задача -> план -> предлагаемый diff -> проверки -> подтверждение -> применение

import { runProjectCommand } from './commandBridge'

// ---------------------------------------------------------------------------
// Построчный unified diff
// ---------------------------------------------------------------------------

export function computeDiff(before, after, path = '') {
  const beforeLines = String(before || '').split('\n')
  const afterLines = String(after || '').split('\n')

  // LCS-вьювер: находим общий префикс и суффикс, между ними — изменённый блок
  let prefix = 0
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix++

  let suffix = 0
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) suffix++

  const removed = beforeLines.slice(prefix, beforeLines.length - suffix)
  const added = afterLines.slice(prefix, afterLines.length - suffix)

  // Метрики для сводки
  const removedCount = removed.length
  const addedCount = added.length
  const unchanged = prefix + suffix

  // Считаем «изменённые» строки: только те, что в пределах diff-блока
  const hunks = [{ prefix, removed, added }]

  return {
    path,
    beforeLines,
    afterLines,
    prefix,
    suffix,
    removed,
    added,
    removedCount,
    addedCount,
    unchanged,
    hunks,
    // True, если файл новый (до правки не существовал)
    isNew: !before,
    // True, если файл удаляется (после — пустой / null)
    isDelete: !after && after !== '',
  }
}

// Короткий текстовый unified diff для превью в sheet
export function formatDiffText(diff, contextLines = 2) {
  const { beforeLines, afterLines, prefix, suffix, removed, added } = diff
  const parts = []

  const startOld = Math.max(0, prefix - contextLines)
  const endOld = Math.min(beforeLines.length, beforeLines.length - suffix + contextLines)
  const startNew = Math.max(0, prefix - contextLines)
  const endNew = Math.min(afterLines.length, afterLines.length - suffix + contextLines)

  parts.push(`@@ -${startOld + 1},${endOld - startOld} +${startNew + 1},${endNew - startNew} @@`)

  // Контекст до
  for (let i = startOld; i < prefix; i++) parts.push(' ' + beforeLines[i])
  // Удалённые
  for (const line of removed) parts.push('-' + line)
  // Добавленные
  for (const line of added) parts.push('+' + line)
  // Контекст после
  for (let i = 0; i < suffix && i + (afterLines.length - suffix) < afterLines.length; i++) {
    const idx = afterLines.length - suffix + i
    if (idx >= 0 && idx < afterLines.length) parts.push(' ' + afterLines[idx])
  }

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Checkpoint — снапшот состояния файлов проекта перед AI-сессией
// ---------------------------------------------------------------------------

export function createCheckpoint(project) {
  if (!project) return null
  // Для виртуального проекта — сохраняем копию всех файлов
  // Для handle-проекта — сохраняем список путей (содержимое читается по требованию)
  if (project.type === 'virtual') {
    const snapshot = {}
    for (const [path, content] of Object.entries(project.files || {})) {
      snapshot[path] = content
    }
    return {
      projectId: project.id,
      type: 'virtual',
      files: snapshot,
      baseFiles: { ...(project.baseFiles || {}) },
      tree: project.tree ? [...project.tree] : [],
      createdAt: Date.now(),
    }
  }
  // handle-проект: чекпойнт хранит дерево путей, содержимое читается с диска
  return {
    projectId: project.id,
    type: 'handle',
    tree: project.tree ? [...project.tree] : [],
    createdAt: Date.now(),
  }
}

// Восстановление чекпойнта: возвращает { files, baseFiles, tree } для виртуального проекта
export function restoreCheckpoint(checkpoint, project) {
  if (!checkpoint || !project) return null
  if (checkpoint.type === 'virtual') {
    return {
      files: { ...checkpoint.files },
      baseFiles: { ...checkpoint.baseFiles },
      tree: [...checkpoint.tree],
    }
  }
  // handle: дерево обновится через refreshTree после применения
  return { tree: [...checkpoint.tree] }
}

// ---------------------------------------------------------------------------
// Запуск проверок (check / build)
// ---------------------------------------------------------------------------

// Команды, которые можно запускать автоматически после AI-правок
const SAFE_CHECK_COMMANDS = [
  'npm run check',
  'npm run build',
  'npm test',
  'node --check',
  'npx tsc --noEmit',
]

// Определяет подходящую команду проверки на основе package.json scripts
export function detectCheckCommand(project) {
  if (!project) return null
  // Для виртуального проекта package.json может быть в файлах
  let pkg = null
  if (project.type === 'virtual' && project.files) {
    const raw = project.files['package.json']
    if (raw) {
      try { pkg = JSON.parse(raw) } catch { /* ignore */ }
    }
  }
  if (pkg?.scripts) {
    if (pkg.scripts.check) return 'npm run check'
    if (pkg.scripts.build) return 'npm run build'
    if (pkg.scripts.test) return 'npm test'
  }
  // Запасной вариант — пробуем check, потом build
  return 'npm run check'
}

// Запускает проверку и возвращает { ok, output, command }
export async function runChecks({ project, signal, command }) {
  const cmd = command || detectCheckCommand(project)
  if (!cmd) return { ok: true, output: 'Нет команды проверки', command: '' }
  try {
    const output = await runProjectCommand({ command: cmd, projectName: project?.name || '', signal })
    const ok = !/\b(error|fail|ERR!\b)/i.test(output) || /\b0 failing\b|\bpassed\b|\bdone\b/i.test(output)
    return { ok, output: output.slice(0, 8000), command: cmd }
  } catch (e) {
    return { ok: false, output: String(e?.message || e), command: cmd }
  }
}

// ---------------------------------------------------------------------------
// Pending edits — очередь предлагаемых, но ещё не применённых правок
// ---------------------------------------------------------------------------

// Превращает tool call write_file/patch_file в pending edit
export function toolCallToPending(name, args, before, after) {
  const path = String(args.path || '').replace(/\\/g, '/').replace(/^\.\//, '')
  const diff = computeDiff(before, after, path)
  return {
    id: `${path}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    path,
    name, // write_file | patch_file
    before,
    after,
    diff,
    selected: true, // выбран для применения по умолчанию
    applied: false,
    rejected: false,
    createdAt: Date.now(),
  }
}

// Проверяет, есть ли среди pending edits хотя бы один выбранный
export function hasSelectedEdits(pendingEdits) {
  return (pendingEdits || []).some((e) => e.selected && !e.applied && !e.rejected)
}

// Сводка по pending edits для отображения в UI
export function editsSummary(pendingEdits) {
  const all = pendingEdits || []
  const pending = all.filter((e) => !e.applied && !e.rejected)
  const applied = all.filter((e) => e.applied)
  const rejected = all.filter((e) => e.rejected)
  const selected = pending.filter((e) => e.selected)
  let totalAdded = 0
  let totalRemoved = 0
  for (const e of selected) {
    totalAdded += e.diff.addedCount
    totalRemoved += e.diff.removedCount
  }
  return {
    total: all.length,
    pending: pending.length,
    applied: applied.length,
    rejected: rejected.length,
    selected: selected.length,
    totalAdded,
    totalRemoved,
  }
}
