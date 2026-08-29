import { requestJson } from './http'

function asUrl(value) {
  const url = String(value || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(url)) throw new Error('Укажите адрес, начинающийся с https://')
  return url
}

async function readAccount(url, headers) {
  const response = await requestJson({ url, headers, timeout: 20000 })
  let data = {}
  try { data = response.json() } catch { /* сервер вернул не JSON */ }
  if (!response.ok) {
    const message = data?.message || data?.error?.message || data?.error || `HTTP ${response.status}`
    throw new Error(String(message))
  }
  return data
}

/** Проверяет только доступ к профилю источника, не создавая и не изменяя репозиторий. */
export async function verifyRepositoryConnection(kind, fields) {
  if (kind === 'gitlab') {
    if (!String(fields.token || '').trim()) throw new Error('Вставьте Personal Access Token GitLab')
    const baseUrl = asUrl(fields.baseUrl || 'https://gitlab.com')
    const account = await readAccount(`${baseUrl}/api/v4/user`, { Authorization: `Bearer ${fields.token.trim()}` })
    return { baseUrl, login: account.username || account.name || 'GitLab' }
  }

  if (kind === 'bitbucket') {
    const username = String(fields.username || '').trim()
    const appPassword = String(fields.appPassword || '').trim()
    if (!username || !appPassword) throw new Error('Укажите имя пользователя и App password Bitbucket')
    const basic = btoa(`${username}:${appPassword}`)
    const account = await readAccount('https://api.bitbucket.org/2.0/user', { Authorization: `Basic ${basic}` })
    return { baseUrl: 'https://bitbucket.org', login: account.username || account.nickname || account.display_name || username }
  }

  if (kind === 'git') {
    const url = String(fields.url || '').trim()
    if (!/^(https:\/\/|git@)[^\s]+/i.test(url)) throw new Error('Укажите HTTPS-адрес или SSH Git URL')
    return { baseUrl: url, login: 'Ссылка сохранена' }
  }

  throw new Error('Неизвестный источник')
}
