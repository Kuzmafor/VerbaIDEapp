// Построчный diff на LCS. Один модуль на весь проект.
//
// Раньше каждый экран считал diff по-своему, обрезая только общий префикс
// и суффикс. Из-за этого правка в двух разных местах файла выглядела как
// «удалено 500 / добавлено 500» — пользователь не мог понять, что именно
// предлагает модель, и переставал доверять просмотру правок.

// Порог ячеек DP-матрицы. Выше него память в мобильном WebView уже заметна:
// 2 млн ячеек = 8 МБ под Uint32Array. Перед подсчётом срезается общий
// префикс и суффикс, поэтому в порог укладываются файлы куда больше 1400 строк.
const MAX_CELLS = 2_000_000

// Середина файла: то, что осталось после срезки общего префикса и суффикса.
// offset нужен, чтобы номера строк в результате считались от начала файла.
function diffMiddle(a, b, offset) {
  const rows = []
  if (!a.length && !b.length) return rows
  if (!a.length) return b.map((text, j) => ({ type: 'add', text, newLine: offset + j + 1 }))
  if (!b.length) return a.map((text, i) => ({ type: 'remove', text, oldLine: offset + i + 1 }))

  if (a.length * b.length > MAX_CELLS) {
    // Матрица не влезает в разумную память. Показываем замену блока целиком —
    // это честнее, чем молча выдать «файл переписан» без всякой пометки.
    return [
      ...a.map((text, i) => ({ type: 'remove', text, oldLine: offset + i + 1 })),
      ...b.map((text, j) => ({ type: 'add', text, newLine: offset + j + 1 })),
    ]
  }

  const n = a.length
  const m = b.length
  const width = m + 1
  const dp = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = a[i] === b[j]
        ? dp[(i + 1) * width + j + 1] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1])
    }
  }

  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      rows.push({ type: 'same', text: a[i], oldLine: offset + i + 1, newLine: offset + j + 1 })
      i++
      j++
    } else if (j < m && (i === n || dp[i * width + j + 1] >= dp[(i + 1) * width + j])) {
      rows.push({ type: 'add', text: b[j], newLine: offset + j + 1 })
      j++
    } else {
      rows.push({ type: 'remove', text: a[i], oldLine: offset + i + 1 })
      i++
    }
  }
  return rows
}

// Возвращает строки: { type: 'same'|'add'|'remove', text, oldLine?, newLine? }
// У добавленной строки нет oldLine, у удалённой — newLine.
export function diffLines(before, after) {
  const a = String(before ?? '').split('\n')
  const b = String(after ?? '').split('\n')

  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) suffix++

  const rows = []
  for (let i = 0; i < prefix; i++) {
    rows.push({ type: 'same', text: a[i], oldLine: i + 1, newLine: i + 1 })
  }
  for (const row of diffMiddle(a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix), prefix)) {
    rows.push(row)
  }
  for (let i = 0; i < suffix; i++) {
    rows.push({
      type: 'same',
      text: a[a.length - suffix + i],
      oldLine: a.length - suffix + i + 1,
      newLine: b.length - suffix + i + 1,
    })
  }
  return rows
}

export function diffStats(rows) {
  let added = 0
  let removed = 0
  let unchanged = 0
  for (const row of rows || []) {
    if (row.type === 'add') added++
    else if (row.type === 'remove') removed++
    else unchanged++
  }
  return { added, removed, unchanged }
}

// Собирает изменённые места в ханки с контекстом, чтобы в просмотре правок
// показывать не файл целиком, а только то, что вокруг правок.
// Близкие изменения склеиваются: разрыв больше context*2 считается отдельным.
export function diffHunks(rows, context = 2) {
  const all = rows || []
  const changed = []
  for (let i = 0; i < all.length; i++) {
    if (all[i].type !== 'same') changed.push(i)
  }
  if (!changed.length) return []

  const ranges = []
  let start = Math.max(0, changed[0] - context)
  let end = changed[0] + context
  for (const index of changed.slice(1)) {
    if (index - context <= end + 1) end = index + context
    else {
      ranges.push([start, end])
      start = index - context
      end = index + context
    }
  }
  ranges.push([start, end])

  return ranges.map(([from, to]) => {
    const slice = all.slice(Math.max(0, from), Math.min(all.length, to + 1))
    return { start: Math.max(0, from), rows: slice, ...diffStats(slice) }
  })
}
