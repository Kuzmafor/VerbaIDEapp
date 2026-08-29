// Транспорт HTTP-запросов к внешним API.
//
// В Android-сборке страница живёт на origin https://localhost, поэтому любой запрос
// к API провайдера — кросс-доменный и подчиняется CORS. Если провайдер не отдаёт
// Access-Control-Allow-*, fetch падает с TypeError «Failed to fetch», хотя тот же
// запрос из curl или desktop-клиента проходит. Нативный HTTP Capacitor выполняется
// вне WebView, поэтому CORS к нему не применяется — используем его как фолбэк.

import { Capacitor, CapacitorHttp } from '@capacitor/core'

export function isNativePlatform() {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

// fetch не различает «сервер ответил ошибкой» и «запрос не ушёл»: любая сетевая
// проблема, CORS-блокировка и заблокированный mixed content дают один TypeError.
export function isNetworkError(err) {
  if (!err) return false
  if (err.name === 'AbortError') return false
  return (
    err instanceof TypeError ||
    /failed to fetch|load failed|network\s?(request )?(error|failed)|networkerror/i.test(String(err.message || ''))
  )
}

export function describeNetworkError(url) {
  let host = url
  try {
    host = new URL(url).host
  } catch { /* ignore */ }
  return isNativePlatform()
    ? `${host} недоступен: нет сети или сервер не отвечает`
    : `${host} заблокирован CORS или недоступен — в браузере сервер должен отдавать Access-Control-Allow-Origin (в Android-сборке это ограничение снято)`
}

function normalizeHeaders(headers) {
  const out = {}
  for (const [k, v] of Object.entries(headers || {})) {
    if (v != null) out[k] = String(v)
  }
  return out
}

function abortError() {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

// CapacitorHttp нельзя отменить, поэтому «Остановить» не обрывает соединение,
// но и ждать полный ответ незачем: гонка с сигналом отпускает интерфейс сразу.
function withAbort(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

// Нативный запрос: возвращает такую же форму, что и ветка с fetch.
async function nativeRequest({ url, method, headers, body, timeout, signal }) {
  const res = await withAbort(
    CapacitorHttp.request({
      url,
      method: method || 'GET',
      headers: normalizeHeaders(headers),
      data: body,
      responseType: 'text',
      connectTimeout: 30000,
      readTimeout: timeout || 300000,
    }),
    signal
  )
  const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
  return { ok: res.status >= 200 && res.status < 300, status: res.status, text: raw }
}

/**
 * JSON-запрос без стриминга.
 *
 * На нативной платформе сразу идёт через CapacitorHttp: CORS там не мешает,
 * и это единственный способ работать с провайдерами без CORS-заголовков.
 * В браузере используется fetch.
 *
 * @returns {Promise<{ok:boolean, status:number, text:string, json:()=>any}>}
 */
export async function requestJson({ url, method = 'GET', headers = {}, body, signal, timeout }) {
  const serialized = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  const hdrs = { ...headers }
  if (serialized !== undefined && !Object.keys(hdrs).some((k) => k.toLowerCase() === 'content-type')) {
    hdrs['Content-Type'] = 'application/json'
  }

  let result
  if (isNativePlatform()) {
    result = await nativeRequest({ url, method, headers: hdrs, body: serialized, timeout, signal })
  } else {
    const res = await fetch(url, { method, headers: hdrs, body: serialized, signal })
    let text = ''
    try {
      text = await res.text()
    } catch { /* ignore */ }
    result = { ok: res.ok, status: res.status, text }
  }

  if (signal?.aborted) throw abortError()

  return {
    ...result,
    json() {
      return JSON.parse(result.text)
    },
  }
}

/**
 * POST со стримингом SSE. Возвращает { chunks } — асинхронный итератор строковых
 * кусков тела, — либо { fallbackNeeded: true }, если стрим невозможен и вызывающий
 * код должен повторить запрос без стриминга через requestJson.
 */
export async function streamPost({ url, headers, body, signal }) {
  const serialized = typeof body === 'string' ? body : JSON.stringify(body)

  // Нативный HTTP отдаёт тело целиком, поэтому стримить нечего — сразу фолбэк.
  if (isNativePlatform()) return { fallbackNeeded: true, reason: 'native' }

  let res
  try {
    res = await fetch(url, { method: 'POST', headers, body: serialized, signal })
  } catch (err) {
    if (isNetworkError(err)) return { fallbackNeeded: true, reason: 'network', error: err }
    throw err
  }

  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 400)
    } catch { /* ignore */ }
    const error = new Error(`HTTP ${res.status}${detail ? ': ' + detail : ''}`)
    error.status = res.status
    throw error
  }

  if (!res.body) return { fallbackNeeded: true, reason: 'no-body' }

  return { chunks: readChunks(res.body) }
}

async function* readChunks(stream) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      yield decoder.decode(value, { stream: true })
    }
    const tail = decoder.decode()
    if (tail) yield tail
  } finally {
    try {
      reader.releaseLock()
    } catch { /* ignore */ }
  }
}
