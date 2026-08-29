// Работа с GitHub: локальное подключение аккаунта, список своих репозиториев,
// загрузка (включая приватные) и коммит/push.
//
// Все запросы идут через общий транспорт: в Android-сборке они выполняются
// нативно, поэтому не упираются в CORS, а в браузере GitHub его и так разрешает.

import { isBinaryPath } from './fs'
import { describeNetworkError, isNetworkError, requestJson } from './http'

const API = 'https://api.github.com'
const MAX_FILE = 400 * 1024
const MAX_TOTAL = 6 * 1024 * 1024
const MAX_FILES = 500

// Ссылка сразу открывает создание токена с нужными правами.
export const TOKEN_CREATE_URL =
  'https://github.com/settings/tokens/new?scopes=repo,read:user&description=VerbaIDE'

export function parseRepoInput(input) {
  const s = String(input || '').trim()
  if (!s) return null
  const urlMatch = s.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)/i)
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/, '') }
  const short = s.match(/^([\w.-]+)\/([\w.-]+)$/)
  if (short) return { owner: short[1], repo: short[2].replace(/\.git$/, '') }
  return null
}

// Имя ветки может содержать слэш (feature/login). GitHub ждёт его в пути
// неэкранированным, поэтому кодируем сегменты по отдельности.
function refPath(name) {
  return String(name).split('/').map(encodeURIComponent).join('/')
}

function ghHeaders(token, hasBody) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  if (token) h.Authorization = 'Bearer ' + token
  if (hasBody) h['Content-Type'] = 'application/json'
  return h
}

async function gh(path, { token, method = 'GET', body } = {}) {
  const url = path.startsWith('http') ? path : API + path
  let res
  try {
    res = await requestJson({ url, method, headers: ghHeaders(token, body !== undefined), body, timeout: 60000 })
  } catch (err) {
    if (isNetworkError(err)) throw new Error(describeNetworkError(url))
    throw err
  }
  if (!res.ok) {
    let detail = ''
    try {
      detail = res.json()?.message || ''
    } catch {
      detail = (res.text || '').slice(0, 150)
    }
    if (res.status === 401) throw new Error('токен недействителен или отозван')
    if (res.status === 404) throw new Error('не найдено: репозитория нет или у токена нет к нему доступа')
    if (res.status === 403) {
      throw new Error(
        /rate limit/i.test(detail)
          ? 'лимит GitHub API исчерпан, попробуйте позже'
          : 'нет доступа' + (detail ? ': ' + detail : '') + ' — нужен токен с правом repo'
      )
    }
    throw new Error('HTTP ' + res.status + (detail ? ': ' + detail : ''))
  }
  try {
    return res.json()
  } catch {
    throw new Error('GitHub вернул не JSON')
  }
}

// blobs API отдаёт содержимое в base64; переводим в текст с учётом многобайтных символов
function decodeBase64Utf8(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

// --- аккаунт ---

// Проверяет токен и возвращает данные аккаунта для локального хранения.
export async function fetchAccount(token) {
  const t = String(token || '').trim()
  if (!t) throw new Error('вставьте токен')
  const user = await gh('/user', { token: t })
  return {
    token: t,
    login: user.login,
    name: user.name || user.login,
    avatarUrl: user.avatar_url || '',
    connectedAt: Date.now(),
  }
}

export async function listUserRepos(token, onProgress) {
  const out = []
  for (let page = 1; page <= 5; page++) {
    onProgress?.(out.length ? `Загружаю репозитории… ${out.length}` : 'Загружаю репозитории…')
    const chunk = await gh(
      `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
      { token }
    )
    if (!Array.isArray(chunk) || !chunk.length) break
    for (const r of chunk) {
      out.push({
        fullName: r.full_name,
        owner: r.owner?.login || '',
        repo: r.name,
        private: !!r.private,
        branch: r.default_branch || 'main',
        description: r.description || '',
        language: r.language || '',
        pushedAt: r.pushed_at || r.updated_at || '',
      })
    }
    if (chunk.length < 100) break
  }
  return out
}

export async function listBranches({ token, owner, repo }) {
  const list = await gh(`/repos/${owner}/${repo}/branches?per_page=100`, { token })
  return (Array.isArray(list) ? list : []).map((b) => b.name).filter(Boolean)
}

export async function listCommits({ token, owner, repo, branch }) {
  const data = await gh(`/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=30`, { token })
  return data.map((c) => ({ sha: c.sha, message: c.commit?.message?.split('\n')[0] || 'Без сообщения', author: c.commit?.author?.name || c.author?.login || 'unknown', date: c.commit?.author?.date || null }))
}

export async function createBranch({ token, owner, repo, fromBranch, name }) {
  const clean = name.replace(/^refs\/heads\//, '')
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(clean) || clean.includes('..') || clean.endsWith('/')) throw new Error('некорректное имя ветки')
  const source = await gh(`/repos/${owner}/${repo}/git/ref/heads/${refPath(fromBranch)}`, { token })
  await gh(`/repos/${owner}/${repo}/git/refs`, { token, method: 'POST', body: { ref: `refs/heads/${clean}`, sha: source.object.sha } })
  return clean
}

export async function listCommitChecks({ token, owner, repo, ref }) {
  const data = await gh(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}/check-runs`, { token })
  return (data.check_runs || []).map((item) => ({ name: item.name, status: item.status, conclusion: item.conclusion, detailsUrl: item.details_url || '' }))
}

// --- загрузка репозитория ---

// Без токена берём файлы с raw.githubusercontent.com (только публичные),
// с токеном — через blobs API, который работает и с приватными репозиториями.
async function fileText({ owner, repo, branch, file, token }) {
  if (token) {
    const blob = await gh(`/repos/${owner}/${repo}/git/blobs/${file.sha}`, { token })
    if (blob.encoding !== 'base64') return typeof blob.content === 'string' ? blob.content : null
    return decodeBase64Utf8(blob.content)
  }
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`
  const res = await requestJson({ url, timeout: 60000 })
  return res.ok ? res.text : null
}

export async function cloneRepo({ input, owner: ownerIn, repo: repoIn, branch, token, onProgress }) {
  let owner = ownerIn
  let repo = repoIn
  if (!owner || !repo) {
    const parsed = parseRepoInput(input)
    if (!parsed) throw new Error('укажите owner/repo или ссылку на репозиторий')
    owner = parsed.owner
    repo = parsed.repo
  }

  let br = String(branch || '').trim()
  if (!br) {
    onProgress?.('Читаю информацию репозитория…')
    const meta = await gh(`/repos/${owner}/${repo}`, { token })
    br = meta.default_branch || 'main'
  }

  onProgress?.('Читаю дерево ветки ' + br + '…')
  const tree = await gh(`/repos/${owner}/${repo}/git/trees/${refPath(br)}?recursive=1`, { token })
  if (tree.truncated) throw new Error('репозиторий слишком большой для мобильной загрузки')

  const selected = (tree.tree || [])
    .filter((t) => t.type === 'blob' && t.size <= MAX_FILE && !isBinaryPath(t.path))
    .slice(0, MAX_FILES)

  const out = {}
  let total = 0
  let done = 0
  const queue = [...selected]
  const worker = async () => {
    while (queue.length && total <= MAX_TOTAL) {
      const file = queue.shift()
      try {
        const text = await fileText({ owner, repo, branch: br, file, token })
        if (typeof text === 'string') {
          total += text.length
          out[file.path] = text
        }
      } catch { /* пропускаем файл */ }
      done++
      if (done % 10 === 0 || done === selected.length) {
        onProgress?.(`Загружаю файлы ${done}/${selected.length}…`)
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))

  if (!Object.keys(out).length) throw new Error('не удалось загрузить ни одного файла')
  return { name: repo, owner, repo, branch: br, files: out }
}

// --- коммит и push через Git Data API ---

export async function pushToGitHub({ owner, repo, branch, token, changes, message, onProgress }) {
  if (!token) throw new Error('подключите аккаунт GitHub')
  if (!changes.length) throw new Error('нет изменённых файлов')

  onProgress?.('Читаю ветку ' + branch + '…')
  const ref = await gh(`/repos/${owner}/${repo}/git/ref/heads/${refPath(branch)}`, { token })
  const baseSha = ref.object.sha

  onProgress?.('Читаю дерево репозитория…')
  const baseCommit = await gh(`/repos/${owner}/${repo}/git/commits/${baseSha}`, { token })

  const tree = []
  let i = 0
  for (const f of changes) {
    if (f.content == null) {
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null })
      i++
      onProgress?.(`Удаляю файлы ${i}/${changes.length}…`)
      continue
    }
    const blob = await gh(`/repos/${owner}/${repo}/git/blobs`, {
      token,
      method: 'POST',
      body: { content: f.content, encoding: 'utf-8' },
    })
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha })
    i++
    onProgress?.(`Загружаю файлы ${i}/${changes.length}…`)
  }

  onProgress?.('Создаю коммит…')
  const newTree = await gh(`/repos/${owner}/${repo}/git/trees`, {
    token,
    method: 'POST',
    body: { base_tree: baseCommit.tree.sha, tree },
  })
  const commit = await gh(`/repos/${owner}/${repo}/git/commits`, {
    token,
    method: 'POST',
    body: { message, tree: newTree.sha, parents: [baseSha] },
  })

  onProgress?.('Обновляю ветку…')
  await gh(`/repos/${owner}/${repo}/git/refs/heads/${refPath(branch)}`, {
    token,
    method: 'PATCH',
    body: { sha: commit.sha },
  })
  return { sha: commit.sha }
}

export async function createPullRequest({ owner, repo, token, head, base, title, body }) {
  return gh(`/repos/${owner}/${repo}/pulls`, { token, method: 'POST', body: { title, head, base, body } })
}

export async function createRepository({ token, name, description = '', isPrivate = true }) {
  const clean = String(name || '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(clean)) throw new Error('некорректное имя репозитория')
  const data = await gh('/user/repos', { token, method: 'POST', body: { name: clean, description: String(description || '').trim(), private: !!isPrivate, auto_init: false } })
  return { owner: data.owner?.login || '', repo: data.name, branch: data.default_branch || 'main', url: data.html_url || '' }
}

export async function listIssues({ token, owner, repo, state = 'open' }) {
  const data = await gh(`/repos/${owner}/${repo}/issues?state=${encodeURIComponent(state)}&per_page=50`, { token })
  return (Array.isArray(data) ? data : []).filter((item) => !item.pull_request).map((item) => ({ number: item.number, title: item.title, state: item.state, author: item.user?.login || '', url: item.html_url || '', comments: item.comments || 0 }))
}

export async function createIssue({ token, owner, repo, title, body = '' }) {
  if (!String(title || '').trim()) throw new Error('укажите заголовок Issue')
  return gh(`/repos/${owner}/${repo}/issues`, { token, method: 'POST', body: { title: title.trim(), body: String(body || '').trim() } })
}
