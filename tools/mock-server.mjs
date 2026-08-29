// Тестовый SSE-сервер для проверки чата без реального API.
// Запуск: npm run mock  →  http://localhost:8787/v1 (формат OpenAI)
// Поддерживает tool-calling: при наличии tools сначала вызывает list_files,
// а после получения результата инструмента шлёт финальный ответ.
import http from 'node:http'

const PORT = 8787

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
}

const server = http.createServer((req, res) => {
  console.log('→', req.method, req.url)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    res.end()
    return
  }

  // Список моделей нужен подключению провайдера в настройках.
  if (/\/models\/?$/.test(req.url)) {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'mock-1' }, { id: 'mock-reasoner' }] }))
    return
  }

  let bodyRaw = ''
  req.on('data', (c) => (bodyRaw += c))

  let responded = false
  res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })

  const respond = () => {
    if (responded) return
    responded = true

    let tools = []
    let msgs = []
    try {
      const j = JSON.parse(bodyRaw)
      tools = j.tools || []
      msgs = j.messages || []
    } catch { /* ignore */ }
    const hasToolResult = msgs.some((m) => m.role === 'tool')

    let events
    if (tools.length && !hasToolResult) {
      // шаг 1: вызываем инструмент
      events = [
        { delta: { content: 'Сейчас посмотрю структуру проекта.\n\n' } },
        { delta: { tool_calls: [{ index: 0, id: 'call_mock1', type: 'function', function: { name: 'list_files', arguments: '' } }] } },
        { delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] } },
        { delta: {}, finish_reason: 'tool_calls' },
      ]
    } else {
      // финальный ответ с размышлениями и тремя файлами — заодно проверяет,
      // что применяется весь набор правок, а не только последняя
      const reasoning =
        'Пользователь просит файлы. Я уже видел структуру проекта, теперь создам три файла в test/.'
      const reply =
        'Готово! Создал три файла — проверьте карточки ниже.\n\n' +
        '```file:test/one.txt\nПервый файл\n```\n\n' +
        '```file:test/two.txt\nВторой файл\n```\n\n' +
        '````file:test/three.md\n# Третий\n\nВнутри есть свой блок кода:\n\n```js\nconsole.log(3)\n```\n````\n'
      events = [
        ...reasoning.split(/(?= )/).map((w) => ({ delta: { reasoning_content: w } })),
        ...reply.split(/(?= )/).map((w) => ({ delta: { content: w } })),
      ]
    }

    let i = 0
    const timer = setInterval(() => {
      if (i >= events.length) {
        clearInterval(timer)
        res.write('data: [DONE]\n\n')
        res.end()
        console.log('✓ ответ завершён')
        return
      }
      const ev = events[i++]
      res.write(`data: ${JSON.stringify({ choices: [{ delta: ev.delta || {}, finish_reason: ev.finish_reason || null }] })}\n\n`)
    }, 40)

    // close на res (не на req!) — соединение закрыто клиентом
    res.on('close', () => clearInterval(timer))
  }

  req.on('end', respond)
  setTimeout(respond, 700) // запасной вариант, если end не пришёл
})

server.listen(PORT, () => console.log(`Mock LLM: http://localhost:${PORT}/v1`))
