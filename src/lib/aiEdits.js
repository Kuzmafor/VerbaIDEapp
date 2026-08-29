// Безопасный процесс AI-правок: дифф, чекпойнты, проверка сборки.
// Полный цикл: задача -> план -> предлагаемый diff -> проверки -> подтверждение -> применение

// Расширение .js обязательно: этот модуль импортируется и из бандла Vite,
// и напрямую из node в tools/self-test.mjs, где ESM требует полный путь.
import { runProjectCommandDetailed } from './commandBridge.js'
// Расширение .js обязательно: этот модуль импортируется и из бандла Vite,
// и напрямую из node в tools/self-test.mjs, где ESM требует полный путь.
import { diffLines, diffStats, diffHunks } from './textDiff.js'

// ---------------------------------------------------------------------------
// Построчный diff
// ---------------------------------------------------------------------------

// Считает diff настоящим LCS, а не обрезкой общего префикса и суффикса:
// правка двух строк в разных концах файла должна показываться как две строки,
// а не как «переписан весь файл».
export function computeDiff(before, after, path = '') {
  const rows = diffLines(before, after)
  const stats = diffStats(rows)
  return {
    path,
    rows,
    hunks: diffHunks(rows),
    addedCount: stats.added,
    removedCount: stats.removed,
    unchanged: stats.unchanged,
    // True, если файл новый (до правки не существовал)
    isNew: !before,
    // True, если файл удаляется (после — пустой / null)
    isDelete: !after && after !== '',
  }
}

// Короткий текстовый unified diff — для превью и для возврата модели
export function formatDiffText(diff, contextLines = 2) {
  const hunks = diffHunks(diff.rows, contextLines)
  if (!hunks.length) return ''
  const parts = []
  for (const hunk of hunks) {
    const oldLines = hunk.rows.filter((row) => row.oldLine != null)
    const newLines = hunk.rows.filter((row) => row.newLine != null)
    parts.push(`@@ -${oldLines[0]?.oldLine || 0},${oldLines.length} +${newLines[0]?.newLine || 0},${newLines.length} @@`)
    for (const row of hunk.rows) {
      if (row.type === 'add') parts.push(`+${row.text}`)
      else if (row.type === 'remove') parts.push(`-${row.text}`)
      else parts.push(` ${row.text}`)
    }
  }
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Checkpoint — снапшот состояния файлов проекта перед AI-сессией
// ---------------------------------------------------------------------------

export function createCheckpoint(project) {
  if (!project) return null
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
  // Для папки на диске читать все файлы заранее слишком дорого, поэтому
  // снапшот пустой и пополняется лениво — в момент, когда агент предлагает
  // правку и содержимое файла «до» уже прочитано.
  return {
    projectId: project.id,
    type: 'handle',
    files: {}, // path -> { content, existed }
    tree: project.tree ? [...project.tree] : [],
    createdAt: Date.now(),
  }
}

// Запоминает состояние файла до правки. Первый снимок для пути всегда
// выигрывает: если агент правит один файл трижды подряд, откатывать нужно
// к самому первому, исходному состоянию.
export function recordCheckpointFile(checkpoint, path, content, existed) {
  if (!checkpoint || !path) return checkpoint
  if (checkpoint.type !== 'handle') return checkpoint
  if (checkpoint.files[path]) return checkpoint
  checkpoint.files[path] = { content: content ?? '', existed: existed !== false }
  return checkpoint
}

// Восстановление чекпойнта. Для handle возвращает files вида
// path -> content, где null означает «файла не было, его нужно удалить».
export function restoreCheckpoint(checkpoint, project) {
  if (!checkpoint || !project) return null
  if (checkpoint.type === 'virtual') {
    return {
      files: { ...checkpoint.files },
      baseFiles: { ...checkpoint.baseFiles },
      tree: [...checkpoint.tree],
    }
  }
  const files = {}
  for (const [path, entry] of Object.entries(checkpoint.files || {})) {
    files[path] = entry.existed ? entry.content : null
  }
  return { files, tree: [...(checkpoint.tree || [])] }
}

// ---------------------------------------------------------------------------
// Запуск проверок (check / build)
// ---------------------------------------------------------------------------

// Определяет команду проверки по скриптам package.json.
//
// Скрипты берутся из project.scripts — их читают при открытии проекта.
// Раньше для папки на диске эта функция всегда возвращала 'npm run check':
// если такого скрипта не было, проверка падала, и push оставался заблокирован
// навсегда, без всякого объяснения. Теперь, когда проверять нечем, возвращаем
// null — отсутствие проверки не должно выглядеть как её провал.
export function detectCheckCommand(project) {
  const scripts = project?.scripts
  if (!scripts || typeof scripts !== 'object') return null
  if (scripts.check) return 'npm run check'
  if (scripts.build) return 'npm run build'
  if (scripts.test) return 'npm test'
  return null
}

// Запускает проверку и возвращает { ok, output, command, code }.
// Успех определяется кодом завершения процесса: вывод сборки может содержать
// слово «error» в названии пакета или в предупреждении, а успешный прогон
// тестов — не содержать слова «done». Угадывать по тексту нельзя.
// Обрезаем начало, а не конец: сообщения об ошибках сборки и падения тестов
// почти всегда в хвосте вывода, и именно их нужно показать человеку.
function trimTail(text, limit) {
  const value = String(text || '')
  if (value.length <= limit) return value
  return `…(начало вывода обрезано)\n${value.slice(-limit)}`
}

export async function runChecks({ project, signal, command }) {
  const cmd = command || detectCheckCommand(project)
  if (!cmd) return { ok: true, output: 'Нет команды проверки', command: '', code: null }
  try {
    const result = await runProjectCommandDetailed({ command: cmd, projectName: project?.name || '', signal })
    const output = [
      `$ ${result.command}`,
      trimTail(result.stdout.trim(), 6000),
      trimTail(result.stderr.trim(), 4000),
      `Код завершения: ${result.code}`,
    ].filter(Boolean).join('\n')
    return {
      ok: result.code === 0,
      output: output.slice(0, 8000),
      command: result.command,
      code: result.code,
    }
  } catch (e) {
    return { ok: false, output: String(e?.message || e), command: cmd, code: null }
  }
}

// ---------------------------------------------------------------------------
// Pending edits — очередь предлагаемых, но ещё не применённых правок
// ---------------------------------------------------------------------------

// Превращает tool call write_file/patch_file в pending edit.
// existed нужен, чтобы откат знал, что делать с файлом: переписать содержимое
// или удалить вовсе. По before это не различить — пустой файл и
// несуществующий дают одну и ту же пустую строку.
export function toolCallToPending(name, args, before, after, existed = true) {
  const path = String(args.path || '').replace(/\\/g, '/').replace(/^\.\//, '')
  const diff = computeDiff(before, after, path)
  return {
    id: `${path}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    path,
    name, // write_file | patch_file
    before,
    after,
    existed: existed !== false,
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
