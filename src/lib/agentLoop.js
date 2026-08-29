// Цикл агента с инструментами: модель сама запрашивает файлы/поиск/структуру,
// мы исполняем инструменты локально и возвращаем результат, пока не получит финальный ответ.

import { streamChat } from './llm'

export const AGENT_TOOLS = [
  {
    name: 'list_connected_repositories',
    description: 'Получить список доступных репозиториев подключённого аккаунта GitHub, включая приватные и командные. Не меняет данные.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'open_connected_repository',
    description: 'Загрузить репозиторий подключённого аккаунта GitHub и открыть его как текущий проект. Перед заменой текущего проекта всегда требуется подтверждение пользователя.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Владелец репозитория GitHub.' },
        repo: { type: 'string', description: 'Название репозитория GitHub.' },
        branch: { type: 'string', description: 'Ветка; если не указана, будет выбрана основная.' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'list_files',
    description: 'Получить список всех файлов проекта (относительные пути).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'read_file',
    description: 'Прочитать содержимое файла проекта по относительному пути.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Относительный путь файла, например src/app.js' } },
      required: ['path'],
    },
  },
  {
    name: 'search_project',
    description:
      'Найти подстроку (или регулярное выражение) по всем текстовым файлам проекта. Вернёт строки вида путь:номер: текст.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Что искать' },
      },
      required: ['query'],
    },
  },
  {
    name: 'semantic_search',
    description: 'Найти наиболее релевантные смысловые фрагменты в индексе проекта. Используй для поиска связанного кода и документов, когда точная строка неизвестна.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Описание нужного кода или информации естественным языком' } },
      required: ['query'],
    },
  },
  {
    name: 'write_file',
    description: 'Создать новый текстовый файл или полностью заменить содержимое существующего файла. Используй для новых файлов и только когда полная перезапись действительно нужна.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Относительный путь внутри проекта.' },
        content: { type: 'string', description: 'Полное новое содержимое файла.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'patch_file',
    description: 'Точечно заменить известный фрагмент текста в файле. Предпочитай этот инструмент полной перезаписи существующего файла.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Относительный путь внутри проекта.' },
        old_text: { type: 'string', description: 'Точный существующий фрагмент, который нужно заменить.' },
        new_text: { type: 'string', description: 'Новый фрагмент.' },
        replace_all: { type: 'boolean', description: 'Заменить все точные совпадения; по умолчанию false.' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'run_command',
    description: 'Запустить безопасную проверку проекта через локальную среду VerbaIDE: build, test, lint, check/typecheck, node --check, git status или git diff. Произвольные и разрушительные команды запрещены.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Команда проверки, например npm run build, npm test, node --check src/app.js или git status --short.' },
      },
      required: ['command'],
    },
  },
  {
    name: 'repository_status',
    description: 'Получить состояние связанного GitHub-репозитория: владелец, имя, текущая ветка и локальные изменения. Не меняет репозиторий.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_repository_branches',
    description: 'Получить список веток связанного GitHub-репозитория. Не меняет репозиторий.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_repository_commits',
    description: 'Получить последние коммиты текущей ветки связанного GitHub-репозитория. Не меняет репозиторий.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'pull_repository',
    description: 'Получить изменения из текущей ветки GitHub-репозитория и применить их к открытому проекту. Перед применением всегда требуется подтверждение пользователя.',
    input_schema: {
      type: 'object',
      properties: { force: { type: 'boolean', description: 'Применить версию GitHub даже при конфликте, потеряв локальные версии конфликтующих файлов. Используй только по явной просьбе пользователя.' } },
      required: [],
    },
  },
  {
    name: 'create_repository_branch',
    description: 'Создать новую ветку от текущей ветки и переключить открытый проект на неё. Перед созданием всегда требуется подтверждение пользователя.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Имя новой ветки, например feature/login-form.' } },
      required: ['name'],
    },
  },
  {
    name: 'push_repository',
    description: 'Сделать commit и push локальных изменений открытого проекта в текущую ветку GitHub. Может дополнительно создать Pull Request. Перед push всегда требуется подтверждение пользователя.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Сообщение коммита.' },
        create_pull_request: { type: 'boolean', description: 'Создать Pull Request после успешного push.' },
        base_branch: { type: 'string', description: 'Целевая ветка Pull Request, например main.' },
      },
      required: ['message'],
    },
  },
  {
    name: 'create_pull_request',
    description: 'Создать Pull Request из текущей ветки в указанную базовую ветку. Перед созданием всегда требуется подтверждение пользователя.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Заголовок Pull Request.' },
        body: { type: 'string', description: 'Описание Pull Request.' },
        base_branch: { type: 'string', description: 'Целевая ветка, например main.' },
      },
      required: ['title', 'base_branch'],
    },
  },
  {
    name: 'move_file',
    description: 'Переименовать или переместить текстовый файл внутри проекта. Требует подтверждения, если автоприменение выключено.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Текущий относительный путь.' },
        to: { type: 'string', description: 'Новый относительный путь.' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'delete_file',
    description: 'Удалить файл проекта. Это разрушительное действие всегда требует явного подтверждения пользователя.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Относительный путь удаляемого файла.' } },
      required: ['path'],
    },
  },
]

const MAX_TOOL_OUTPUT = 64000

// Ответ считается обрезанным, когда упёрся в лимит вывода, а не закончился сам.
const TRUNCATED = new Set(['max_tokens', 'length', 'MAX_TOKENS'])

const CONTINUE_PROMPT =
  'Ответ оборвался на лимите длины. Продолжи ровно с места обрыва, символ за символом. ' +
  'Не повторяй уже написанное, не пиши вступлений и пояснений. ' +
  'Если обрыв случился внутри блока кода — продолжай код и не открывай ограждение заново.'

// Модель нередко зовёт один и тот же инструмент с теми же аргументами по кругу:
// файл уже прочитан, но в ответе это не учитывается. Повторный вызов отдаём из
// кеша с явной пометкой, чтобы шаги не выгорали на дублях.
const REPEAT_NOTE = 'Этот вызов с теми же аргументами уже выполнялся, повторно его не делай. Результат:\n'

function callSignature(tc) {
  return tc.name + ':' + JSON.stringify(tc.args || {})
}

// Длинный файл (HTML, большой компонент) не влезает в один ответ: модель
// останавливается на лимите вывода, файл остаётся недописанным и правка не
// применяется. Досылаем продолжения и склеиваем текст, пока ответ не закончится
// сам или не исчерпаются попытки.
async function* continueTruncated({ provider, model, system, convo, signal, thinking, maxOutputTokens, partial, tries }) {
  let text = partial
  for (let attempt = 1; attempt <= tries; attempt++) {
    yield { kind: 'continued', part: attempt }
    const messages = [
      ...convo,
      { role: 'assistant', content: text },
      { role: 'user', content: CONTINUE_PROMPT },
    ]
    const it = streamChat({ provider, model, messages, system, signal, thinking, tools: AGENT_TOOLS, maxOutputTokens })
    let added = ''
    let res = null
    while (true) {
      const { value: ev, done } = await it.next()
      if (done) {
        res = ev
        break
      }
      if (ev.kind === 'tool_use') continue
      if (ev.kind === 'text') added += ev.value
      yield ev
    }
    if (res?.usage) yield { kind: 'usage', usage: res.usage }
    if (!added) return
    text += added
    if (!TRUNCATED.has(String(res?.stopReason))) return
  }
  yield {
    kind: 'text',
    value: '\n\n⚠️ Ответ слишком длинный: не удалось дописать за отведённые продолжения. Попросите продолжить или разбить файл на части.',
  }
}

async function* finalAnswerPass({ provider, model, system, convo, signal, thinking, maxOutputTokens, reason }) {
  const messages = [
    ...convo,
    {
      role: 'user',
      content:
        `${reason} Больше инструменты не вызывай. Ответь сейчас по существу, опираясь на то, ` +
        'что уже собрано. Если данных не хватает, прямо скажи, чего именно не хватает и что нужно открыть.',
    },
  ]
  // Инструменты остаются объявленными: в переписке уже есть блоки tool_use и
  // tool_result, и Anthropic отклоняет такой запрос с HTTP 400, если списка
  // инструментов нет. Новые вызовы просто игнорируем.
  const it = streamChat({ provider, model, messages, system, signal, thinking, tools: AGENT_TOOLS, maxOutputTokens })
  let got = false
  let res = null
  while (true) {
    const { value: ev, done } = await it.next()
    if (done) {
      res = ev
      break
    }
    if (ev.kind === 'text' && ev.value) got = true
    if (ev.kind !== 'tool_use') yield ev
  }
  if (res?.usage) yield { kind: 'usage', usage: res.usage }
  if (!got) yield { kind: 'text', value: '\n\n⚠️ Не удалось собрать ответ: модель продолжает запрашивать инструменты.' }
}

export async function* runAgent({ provider, model, system, messages, signal, thinking, executeTool, maxSteps = 16, maxOutputTokens, maxContinues = 6, enableTools = true }) {
  const tools = enableTools ? AGENT_TOOLS : []
  const convo = [...messages]
  const seen = new Map()
  let lastRound = ''

  for (let step = 0; step < maxSteps; step++) {
    const it = streamChat({ provider, model, messages: convo, system, signal, thinking, tools, maxOutputTokens })
    let text = ''
    const toolCalls = []
    let res = null
    while (true) {
      const { value: ev, done } = await it.next()
      if (done) {
        res = ev
        break
      }
      if (ev.kind === 'text') text += ev.value
      if (ev.kind === 'tool_use') toolCalls.push(ev.call)
      yield ev
    }

    if (res?.usage) yield { kind: 'usage', usage: res.usage }

    if (!toolCalls.length) {
      // Финальный ответ получен — но он мог упереться в лимит вывода.
      if (TRUNCATED.has(String(res?.stopReason))) {
        yield* continueTruncated({
          provider, model, system, convo, signal, thinking, maxOutputTokens,
          partial: text, tries: maxContinues,
        })
      }
      return
    }

    convo.push({
      role: 'assistant',
      content: text,
      toolCalls,
      thinkingBlocks: res?.thinkingBlocks || [],
    })

    // Тот же набор вызовов дважды подряд означает, что модель зациклилась:
    // дальше ждать нечего, выжимаем ответ из уже собранного.
    const round = toolCalls.map(callSignature).sort().join('|')
    const stuck = round === lastRound
    lastRound = round

    for (const tc of toolCalls) {
      yield { kind: 'tool', name: tc.name, args: tc.args || {} }
      const sig = callSignature(tc)
      let out
      if (seen.has(sig)) {
        out = REPEAT_NOTE + seen.get(sig)
      } else {
        try {
          out = await executeTool(tc.name, tc.args || {})
        } catch (e) {
          out = 'Ошибка: ' + (e?.message || String(e))
        }
        seen.set(sig, String(out).slice(0, MAX_TOOL_OUTPUT))
      }
      yield { kind: 'tool_result', name: tc.name, args: tc.args || {}, output: String(out).slice(0, 1200) }
      convo.push({ role: 'tool', id: tc.id, name: tc.name, content: String(out).slice(0, MAX_TOOL_OUTPUT) })
    }

    if (stuck) {
      yield* finalAnswerPass({
        provider, model, system, convo, signal, thinking, maxOutputTokens,
        reason: 'Ты повторяешь одни и те же вызовы инструментов.',
      })
      return
    }
  }

  yield* finalAnswerPass({
    provider, model, system, convo, signal, thinking, maxOutputTokens,
    reason: `Достигнут лимит в ${maxSteps} шагов с инструментами.`,
  })
}
