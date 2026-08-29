async function requestCommand({ command, projectName, signal }) {
  let response
  try {
    response = await fetch('/__verbaide/run-command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, projectName }),
      signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new Error('Локальная среда команд недоступна. Запустите проект через npm run dev на компьютере.')
  }
  const type = response.headers.get('content-type') || ''
  if (!type.includes('application/json')) {
    throw new Error('Запуск команд доступен только через локальный dev-сервер VerbaIDE; внутри APK системного терминала нет.')
  }
  const data = await response.json()
  if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

// Структурный результат: код завершения процесса доступен вызывающему.
// По нему, а не по тексту вывода, нужно решать, прошла проверка или нет —
// иначе успех приходится угадывать по словам вроде error или done.
export async function runProjectCommandDetailed({ command, projectName, signal }) {
  const data = await requestCommand({ command, projectName, signal })
  return {
    command: data.command || command,
    code: Number.isFinite(data.code) ? data.code : -1,
    stdout: data.stdout || '',
    stderr: data.stderr || '',
  }
}

// Текстовая форма — для показа человеку и для возврата модели в run_command.
export async function runProjectCommand({ command, projectName, signal }) {
  const { command: label, code, stdout, stderr } = await runProjectCommandDetailed({ command, projectName, signal })
  const chunks = [
    `$ ${label}`,
    stdout.trim(),
    stderr.trim(),
    `Код завершения: ${code}`,
  ].filter(Boolean)
  return chunks.join('\n')
}
