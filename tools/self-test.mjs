import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { blockPathFromInfo, splitFences } from '../src/lib/fences.js'
import { replaceInText } from '../src/lib/textReplace.js'
import { resolveSafeCommand } from './safe-command.mjs'

const root = process.cwd()
const agentLoopSource = await readFile('src/lib/agentLoop.js', 'utf8')
const names = new Set([...agentLoopSource.matchAll(/name:\s*'([^']+)'/g)].map((match) => match[1]))
for (const required of ['list_files', 'read_file', 'search_project', 'semantic_search', 'write_file', 'patch_file', 'move_file', 'delete_file', 'run_command']) {
  assert(names.has(required), `Нет инструмента ${required}`)
}

const blocks = splitFences('````file:src/demo.md\n# Demo\n```js\nconsole.log(1)\n```\n````').filter((part) => part.type === 'code')
assert.equal(blocks.length, 1)
assert.equal(blockPathFromInfo(blocks[0].info).path, 'src/demo.md')
assert.match(blocks[0].code, /console\.log/)

const allowed = await resolveSafeCommand('npm run build', root)
assert.match(allowed.label, /npm run build/)
await assert.rejects(() => resolveSafeCommand('rm -rf .', root), /безопасный список/)
await assert.rejects(() => resolveSafeCommand('npm run dev', root), /Разрешены только/)

assert.deepEqual(replaceInText('foo FOO bar', 'foo', 'baz'), { content: 'baz baz bar', count: 2 })
assert.deepEqual(replaceInText('item-12 item-7', '/item-(\\d+)/', 'row-$1'), { content: 'row-12 row-7', count: 2 })

const editorSource = await readFile('src/components/CodeEditor.jsx', 'utf8')
const filesPageSource = await readFile('src/pages/FilesPage.jsx', 'utf8')
const chatPageSource = await readFile('src/pages/ChatPage.jsx', 'utf8')
const githubSource = await readFile('src/lib/github.js', 'utf8')
for (const marker of ['editor-minimap', 'collectDiagnostics', 'indentRange', 'F12']) assert.match(editorSource, new RegExp(marker))
for (const marker of ['editor-tabs', 'replaceAcrossProject', 'goToDefinition']) assert.match(filesPageSource, new RegExp(marker))
assert.match(chatPageSource, /fc-download/)
assert.match(chatPageSource, /не отменяем запрос/, 'Фоновая задача должна переживать уход со страницы')
assert.match(githubSource, /commits\?sha=.*\{ token \}/, 'История GitHub должна передавать токен')
assert.match(githubSource, /content == null/, 'GitHub push должен корректно удалять staged-файлы')

const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const gradle = await readFile('android/app/build.gradle', 'utf8')
const androidVersion = gradle.match(/versionName\s+"([^"]+)"/)?.[1]
assert.equal(androidVersion, pkg.version, 'Версии package.json и Android должны совпадать')
assert.match(gradle, /versionCode\s+[1-9]\d*/, 'Android versionCode должен быть положительным')
for (const file of ['public/manifest.webmanifest', 'public/sw.js', 'public/icons/icon-192.png', 'public/icons/icon-512.png']) await access(file)

console.log(`✓ self-test: ${names.size} инструментов, файловые блоки, безопасные команды, PWA и версии`)
