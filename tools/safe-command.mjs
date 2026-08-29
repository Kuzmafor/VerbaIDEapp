import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const SAFE_SCRIPT = /^(build|test|lint|check|typecheck|verify)(:|$)/i
const SHELL_SYNTAX = /[;&|><`$\r\n]/

function tokensOf(command) {
  const tokens = String(command || '').match(/"(?:[^"\\]|\\.)*"|'[^']*'|[^\s]+/g) || []
  return tokens.map((token) => {
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1)
    }
    return token
  })
}

function inside(root, target) {
  const resolved = path.resolve(root, target)
  const rel = path.relative(root, resolved)
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? resolved : null
}

async function packageScripts(root) {
  try {
    const json = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
    return json.scripts || {}
  } catch {
    return {}
  }
}

export async function resolveSafeCommand(command, root = process.cwd()) {
  const raw = String(command || '').trim()
  if (!raw) throw new Error('Пустая команда')
  if (SHELL_SYNTAX.test(raw)) throw new Error('Конвейеры, перенаправления и shell-операторы запрещены')
  const tokens = tokensOf(raw)
  const [bin, ...args] = tokens
  const lower = String(bin || '').toLowerCase()
  const scripts = await packageScripts(root)

  if (lower === 'npm' || lower === 'npm.cmd') {
    let script = null
    if (args[0] === 'test' && args.length === 1) script = 'test'
    if (args[0] === 'run' && args.length === 2) script = args[1]
    if (!script || !SAFE_SCRIPT.test(script)) throw new Error('Разрешены только npm-скрипты build/test/lint/check/typecheck/verify')
    if (!scripts[script]) throw new Error(`В package.json нет скрипта «${script}»`)
    const npmCli = process.env.npm_execpath
    if (process.platform === 'win32' && npmCli) {
      return { bin: process.execPath, args: [npmCli, 'run', script], label: `npm run ${script}` }
    }
    return { bin: 'npm', args: ['run', script], label: `npm run ${script}` }
  }

  if (lower === 'node' && args[0] === '--check' && args.length === 2) {
    const file = inside(root, args[1])
    if (!file || !/\.(c?js|mjs)$/i.test(file)) throw new Error('node --check принимает только JS-файл внутри проекта')
    await stat(file)
    return { bin: process.execPath, args: ['--check', file], label: `node --check ${args[1]}` }
  }

  if (lower === 'git' && args[0] === 'status' && args.slice(1).every((arg) => ['--short', '--porcelain', '-sb'].includes(arg))) {
    return { bin: 'git', args, label: raw }
  }
  if (lower === 'git' && args[0] === 'diff' && args.slice(1).every((arg) => ['--stat', '--check', '--name-only', '--cached'].includes(arg))) {
    return { bin: 'git', args, label: raw }
  }

  if ((lower === 'python' || lower === 'python3') && args[0] === '-m' && args[1] === 'pytest' && args.slice(2).every((arg) => arg === '-q')) {
    return { bin, args, label: raw }
  }
  if (lower === 'pytest' && args.every((arg) => arg === '-q')) return { bin, args, label: raw }
  if (lower === 'cargo' && ['test', 'check'].includes(args[0]) && args.length === 1) return { bin, args, label: raw }
  if (lower === 'go' && args[0] === 'test' && args.length === 2 && args[1] === './...') return { bin, args, label: raw }

  throw new Error('Команда не входит в безопасный список проверок')
}

export async function runSafeCommand(command, root = process.cwd(), timeoutMs = 120000) {
  const resolved = await resolveSafeCommand(command, root)
  return new Promise((resolve, reject) => {
    const child = spawn(resolved.bin, resolved.args, {
      cwd: root,
      shell: false,
      windowsHide: true,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
    })
    let stdout = ''
    let stderr = ''
    const append = (current, chunk) => (current + String(chunk)).slice(-20000)
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk) })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Команда остановлена по тайм-ауту 120 секунд'))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ command: resolved.label, code: code ?? -1, stdout, stderr })
    })
  })
}
