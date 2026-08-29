// Checkpoint AI-сессии в IndexedDB.
//
// Сам checkpoint живёт в useState, но перезагрузка страницы или выгруженное
// системой приложение стирают его целиком — и кнопка «Отменить всю AI-сессию»
// остаётся ни с чем: откатывать уже нечего. Здесь он переживает перезагрузку.
//
// Хранилище намеренно примитивное и без внешних зависимостей: одна запись
// на проект. Любая ошибка (нет IndexedDB, нет квоты) не ломает приложение —
// вызывающий просто помечает сессию как несохранённую и честно говорит об этом.

const DB_NAME = 'verbaide'
const STORE = 'ai-checkpoints'
const DB_VERSION = 1

// Чекпойнт виртуального проекта хранит содержимое всех файлов целиком,
// поэтому ограничиваем запись: больше этого порога — не сохраняем вовсе,
// иначе можно вытеснить из квоты сам проект.
const MAX_BYTES = 8 * 1024 * 1024

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступна'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Не удалось открыть IndexedDB'))
  })
}

function wait(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Ошибка IndexedDB'))
  })
}

// Возвращает true, если сессия записана. false означает не ошибку, а «не
// сохранили» — слишком большой объём или нет хранилища. Вызывающий должен
// предупредить пользователя, что откат живёт только до перезагрузки.
export async function saveCheckpoint(projectId, session) {
  if (!projectId || !session) return false
  try {
    if (JSON.stringify(session).length > MAX_BYTES) return false
    const db = await openDb()
    await wait(db.transaction(STORE, 'readwrite').objectStore(STORE).put({ savedAt: Date.now(), session }, projectId))
    return true
  } catch {
    return false
  }
}

export async function loadCheckpoint(projectId) {
  if (!projectId) return null
  try {
    const db = await openDb()
    const record = await wait(db.transaction(STORE, 'readonly').objectStore(STORE).get(projectId))
    return record?.session || null
  } catch {
    return null
  }
}

export async function clearCheckpoint(projectId) {
  if (!projectId) return false
  try {
    const db = await openDb()
    await wait(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(projectId))
    return true
  } catch {
    return false
  }
}
