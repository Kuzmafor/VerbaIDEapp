const SETTINGS_KEY = 'verbaide.settings'
const CHATS_KEY = 'verbaide.chats'

export const DEFAULT_SETTINGS = {
  providers: [], // { id, name, baseUrl, apiKey, format: 'anthropic'|'openai', models: [] }
  selected: null, // { providerId, model }
  effort: 'high', // low | medium | high
  confirmForMe: true,
  showThinking: true, // показывать размышления модели в чате
  anthropicThinking: false, // запрашивать extended thinking у Anthropic
  customInstructions: '', // доп. системная инструкция агенту
  maxFileChars: 24000, // максимум символов на файл в контексте
  fileAccessPrompted: false,
  memories: [], // {id,text,scope:'global'|'project',projectId,createdAt}
  projectInstructions: {}, // projectId -> instructions
  autoSummarize: true,
  contextLimit: 128000,
  favoriteModels: [], // `${providerId}:${model}`
  projectModels: {}, // projectId -> { providerId, model }
  modelPrices: {}, // `${providerId}:${model}` -> { input, output } за 1M токенов
  maxOutputTokens: 32000, // потолок длины ответа — влияет на длинные файлы
  theme: 'black', // black | graphite | midnight | light
  locale: 'ru', // ru | en
  fontScale: 100, // 90 | 100 | 110 | 120
  haptics: true,
  reduceMotion: false,
  autoRotate: true,
  highContrast: false,
  agentLimits: { maxMinutes: 12, maxTokens: 24000, notify: true },
  taskQueue: [],
  gitStaging: {},
  gitStashes: {},
  skillsEnabledByDefaultV021: true,
  plugins: [
    {
      id: 'project-guide',
      name: 'Навигатор проекта',
      description: 'ИИ сначала изучает структуру и связанные файлы, а затем предлагает правки.',
      instructions: 'Перед изменением кода сначала изучи структуру проекта и прочитай связанные файлы. Учитывай существующий стиль и архитектуру.',
      enabled: true,
      builtIn: true,
    },
    {
      id: 'code-review',
      name: 'Ревьюер кода',
      description: 'Ищет ошибки, уязвимости и возможные регрессии в предлагаемых изменениях.',
      instructions: 'Проверяй решения как строгий code reviewer: ищи ошибки, регрессии, проблемы безопасности и производительности. Явно сообщай о рисках.',
      enabled: true,
      builtIn: true,
    },
    {
      id: 'test-engineer',
      name: 'Инженер тестирования',
      description: 'Предлагает проверки и тесты для изменяемого функционала.',
      instructions: 'Для каждого существенного изменения продумывай проверки и тесты. Если в проекте есть тестовая инфраструктура, обновляй или добавляй тесты.',
      enabled: true,
      builtIn: true,
    },
    {
      id: 'ui-polish',
      name: 'UI-полировка',
      description: 'Следит за адаптивностью, доступностью и визуальной целостностью интерфейса.',
      instructions: 'При работе с интерфейсом проверяй мобильную адаптивность, safe-area, доступность, состояния загрузки и визуальную согласованность компонентов.',
      enabled: true,
      builtIn: true,
    },
  ],
}

// Набор встроенных плагинов пополняется в новых версиях, а сохранённый массив
// целиком перекрывал дефолтный — новые плагины не появлялись никогда. Поэтому
// список сливаем: от пользователя берём только флаг enabled, тексты — из кода.
function mergePlugins(saved) {
  if (!Array.isArray(saved)) return DEFAULT_SETTINGS.plugins
  const byId = new Map(saved.filter((p) => p && p.id).map((p) => [p.id, p]))
  const merged = DEFAULT_SETTINGS.plugins.map((base) => {
    const prev = byId.get(base.id)
    byId.delete(base.id)
    return prev ? { ...base, enabled: !!prev.enabled } : base
  })
  return [...merged, ...[...byId.values()].filter((p) => !p.builtIn)]
}

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    const plugins = mergePlugins(saved.plugins)
    // Одноразовая миграция для уже установленных копий: в 0.2.1 встроенные
    // навыки впервые стали включены по умолчанию. После миграции выбор
    // пользователя снова сохраняется как обычно.
    const migratedPlugins = saved.skillsEnabledByDefaultV021
      ? plugins
      : plugins.map((plugin) => plugin.builtIn ? { ...plugin, enabled: true } : plugin)
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      skillsEnabledByDefaultV021: true,
      plugins: migratedPlugins,
      memories: Array.isArray(saved.memories) ? saved.memories : [],
      projectInstructions: saved.projectInstructions && typeof saved.projectInstructions === 'object' ? saved.projectInstructions : {},
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch (e) {
    console.warn('saveSettings', e)
  }
}

export function loadChats() {
  try {
    const chats = JSON.parse(localStorage.getItem(CHATS_KEY) || '[]')
    if (!Array.isArray(chats)) return []
    // Старые сетевые ошибки сохранялись как обычный текст ассистента и затем
    // снова попадали в контекст модели. Переводим только сообщения, целиком
    // состоящие из предупреждения, в отдельное состояние ошибки.
    return chats.map((chat) => ({
      ...chat,
      messages: (chat.messages || []).map((message) => {
        if (message.role !== 'assistant' || message.providerError) return message
        const legacy = String(message.content || '').trim().match(/^⚠️\s*([\s\S]+)$/)
        if (!legacy) return message
        return {
          ...message,
          content: '',
          providerError: { kind: 'provider', message: legacy[1].trim(), at: message.ts || Date.now() },
          stats: null,
        }
      }),
    }))
  } catch {
    return []
  }
}

// content может отсутствовать — у черновика или у сообщения, собранного частично.
// Без приведения к строке исключение вылетит внутри saveChats, и тогда не
// сохранится вообще вся история, а не одно сообщение.
function clipContent(content, limit = 200_000) {
  const text = String(content ?? '')
  return text.length > limit ? text.slice(0, limit) + '\n…' : text
}

export function saveChats(chats) {
  try {
    // ограничиваем размер сообщений, чтобы не переполнить localStorage
    const slim = chats.slice(0, 60).map((c) => ({
      ...c,
      messages: (c.messages || []).map((m) => ({
        ...m,
        content: clipContent(m.content),
      })),
    }))
    localStorage.setItem(CHATS_KEY, JSON.stringify(slim))
  } catch (e) {
    console.warn('saveChats', e)
    try {
      // Если история с изображениями превысила квоту localStorage, сохраняем
      // текст и метаданные вложений, не теряя сами диалоги.
      const withoutImageData = chats.slice(0, 60).map((c) => ({
        ...c,
        messages: (c.messages || []).map((m) => ({
          ...m,
          images: (m.images || []).map(({ dataUrl, ...meta }) => meta),
          content: clipContent(m.content),
        })),
      }))
      localStorage.setItem(CHATS_KEY, JSON.stringify(withoutImageData))
    } catch (fallbackError) {
      console.warn('saveChats fallback', fallbackError)
    }
  }
}

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)
}
