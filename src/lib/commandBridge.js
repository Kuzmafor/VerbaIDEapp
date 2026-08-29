export async function runProjectCommand({ command, projectName, signal }) {
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
  const chunks = [
    `$ ${data.command}`,
    data.stdout?.trim(),
    data.stderr?.trim(),
    `Код завершения: ${data.code}`,
  ].filter(Boolean)
  return chunks.join('\n')
}
