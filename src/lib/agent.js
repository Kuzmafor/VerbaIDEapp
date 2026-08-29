// Сборка системного промпта агента и разбор файловых блоков в ответе модели

import { blockPathFromInfo, normalizePath, splitFences } from './fences'

export function buildSystemPrompt({ project, attachedFiles, effort, customInstructions, plugins = [], memories = [], projectInstruction = '', chatSummary = '', maxFileChars = 24000 }) {
  const lines = []
  lines.push('Ты — агент-помощник по программированию внутри мобильной IDE VerbaIDE (веб-приложение).')
  lines.push('Отвечай на языке пользователя, кратко и по делу. Используй markdown и блоки кода.')
  lines.push('Для большой задачи сначала дай план из 2–5 шагов, затем выполняй его по порядку. Перед применением перечисли затронутые файлы. После успешных проверок предложи сообщение commit, но не выполняй commit без явного действия пользователя.')
  if (effort === 'low') lines.push('Отвечай максимально сжато, без пояснений.')
  if (effort === 'high') lines.push('При необходимости подробно поясняй решения.')
  if (customInstructions?.trim()) {
    lines.push('')
    lines.push('Инструкции от пользователя (соблюдай всегда):')
    lines.push(customInstructions.trim())
  }
  if (memories.length) {
    lines.push('')
    lines.push('Сохранённая память пользователя:')
    for (const memory of memories.slice(-30)) lines.push(`- ${memory.text}`)
  }
  if (projectInstruction?.trim()) {
    lines.push('')
    lines.push('Инструкции текущего проекта:')
    lines.push(projectInstruction.trim())
  }
  if (chatSummary?.trim()) {
    lines.push('')
    lines.push('Резюме более ранней части этого диалога:')
    lines.push(chatSummary.trim())
  }
  const enabledPlugins = plugins.filter((p) => p.enabled && p.instructions?.trim())
  if (enabledPlugins.length) {
    lines.push('')
    lines.push('Активные навыки агента (соблюдай их инструкции):')
    for (const plugin of enabledPlugins) {
      lines.push(`- ${plugin.name}: ${plugin.instructions.trim()}`)
    }
  }

  if (project) {
    const access =
      project.type === 'handle'
        ? 'чтение и запись на диске'
        : 'файлы загружены в память приложения'
    lines.push('')
    lines.push(`Проект: «${project.name}». Доступ: ${access}.`)
    lines.push(
      'У тебя есть инструменты исследования: list_files, read_file, search_project и semantic_search; инструменты правок: patch_file, write_file, move_file и delete_file; а также run_command для разрешённых сборок, тестов и статических проверок. Сначала изучи связанные файлы. Для небольшой правки предпочитай patch_file, для нового файла — write_file. Удаляй и перемещай файлы только когда это действительно требуется задачей. После существенных изменений запусти подходящую проверку. Никогда не заявляй, что команда или запись успешна, если инструмент вернул ошибку, отказ пользователя или недоступность.'
    )
    if (project.github) {
      lines.push(
        'Этот проект связан с GitHub. Доступны repository_status, list_repository_branches и list_repository_commits для чтения; pull_repository, create_repository_branch, push_repository и create_pull_request для управления репозиторием. list_connected_repositories позволяет посмотреть все доступные репозитории, а open_connected_repository — открыть один из них с подтверждением пользователя. Перед любым внешним изменением VerbaIDE всегда покажет пользователю отдельное подтверждение. Перед push сначала проверь repository_status, используй осмысленное сообщение коммита и не создавай Pull Request без просьбы пользователя.'
      )
    }
    const filePaths = (project.tree || []).filter((t) => t.kind === 'file').map((t) => t.path)
    if (filePaths.length) {
      lines.push('')
      lines.push('Структура проекта:')
      for (const p of filePaths.slice(0, 500)) lines.push(p)
    }
  }

  if (attachedFiles?.length) {
    lines.push('')
    lines.push('Содержимое приложенных файлов:')
    for (const f of attachedFiles) {
      lines.push('')
      lines.push(`<file path="${f.path}">`)
      lines.push(f.content.length > maxFileChars ? f.content.slice(0, maxFileChars) + '\n…(обрезано)' : f.content)
      lines.push('</file>')
    }
  }

  lines.push('Если пользователь просит работать с репозиторием GitHub, сначала используй list_connected_repositories. Для открытия выбранного репозитория используй open_connected_repository: приложение запросит подтверждение. Если GitHub не подключён, честно сообщи, что его нужно подключить в Настройках → Репозитории.')

  if (project || attachedFiles?.length) {
    lines.push('')
    lines.push('Если инструменты записи недоступны или пользователь должен вручную применить результат, выведи файловый блок, у которого в первой строке указан путь в формате file:путь/к/файлу. Выводи файл целиком, а не диф. Пример:')
    lines.push('```file:src/app.js')
    lines.push('// полное новое содержимое файла')
    lines.push('```')
    lines.push('Если внутри содержимого файла есть свои блоки кода, огради файл четырьмя обратными кавычками вместо трёх, иначе он обрежется на первом внутреннем ограждении.')
  }

  lines.push('Если пользователь просит создать готовую HTML-страницу, обязательно верни полный документ в файловом блоке ```file:index.html (или с указанным пользователем именем). Не ограничивайся обычным блоком ```html: интерфейс должен предложить скачать готовый файл.')

  return lines.join('\n')
}

// Ищет файловые блоки: в информационной строке ограждения указан file:путь
// (или просто путь с расширением).
export function parseFileBlocks(text) {
  const blocks = []
  for (const part of splitFences(text)) {
    if (part.type !== 'code') continue
    const p = blockPathFromInfo(part.info)
    if (!p) continue
    blocks.push({ path: normalizePath(p.path), lang: p.lang, code: part.code })
  }
  return blocks
}

// Последний файловый блок в тексте — тот, что агент пишет прямо сейчас.
// closed — блок уже закрыт ограждением, active — после блока ничего нет.
export function lastFileBlock(text) {
  const parts = splitFences(text)
  let last = null
  let lastIndex = -1
  parts.forEach((part, i) => {
    if (part.type !== 'code') return
    const p = blockPathFromInfo(part.info)
    if (!p) return
    last = { path: normalizePath(p.path), lang: p.lang, code: part.code, closed: !!part.closed }
    lastIndex = i
  })
  if (!last) return null
  last.active = parts.slice(lastIndex + 1).every((part) => !part.code.trim())
  return last
}
