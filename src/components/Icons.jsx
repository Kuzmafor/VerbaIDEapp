import React from 'react'

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export const IconMenu = (p) => (
  <svg {...base} {...p}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
)
export const IconPlus = (p) => (
  <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>
)
export const IconShieldCheck = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8.4-7 9.5C8 19.4 5 15.5 5 11V6l7-3z" />
    <path d="M9.2 11.6l2 2 3.6-3.8" />
  </svg>
)
export const IconChevronDown = (p) => (
  <svg {...base} {...p}><path d="M6 9l6 6 6-6" /></svg>
)
export const IconMic = (p) => (
  <svg {...base} {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
)
export const IconArrowUp = (p) => (
  <svg {...base} strokeWidth={2.2} {...p}><path d="M12 19V5M5 12l7-7 7 7" /></svg>
)
export const IconStop = (p) => (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" {...p}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />
  </svg>
)
export const IconClose = (p) => (
  <svg {...base} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>
)
export const IconFolder = (p) => (
  <svg {...base} {...p}>
    <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18V6.5z" />
  </svg>
)
export const IconFile = (p) => (
  <svg {...base} {...p}>
    <path d="M6.5 3.5h7L18 8v12.5h-11.5V3.5z" />
    <path d="M13 3.5V8h5" />
  </svg>
)
export const IconGear = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19 12a7 7 0 0 0-.14-1.4l2-1.55-2-3.46-2.36.95a7 7 0 0 0-2.42-1.4L13.7 2.6h-3.4l-.38 2.54a7 7 0 0 0-2.42 1.4l-2.36-.95-2 3.46 2 1.55A7 7 0 0 0 5 12c0 .48.05.94.14 1.4l-2 1.55 2 3.46 2.36-.95a7 7 0 0 0 2.42 1.4l.38 2.54h3.4l.38-2.54a7 7 0 0 0 2.42-1.4l2.36.95 2-3.46-2-1.55c.09-.46.14-.92.14-1.4z" />
  </svg>
)
export const IconChat = (p) => (
  <svg {...base} {...p}>
    <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V6z" />
  </svg>
)
export const IconEdit = (p) => (
  <svg {...base} {...p}>
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
    <path d="M13.5 6.5l3 3" />
  </svg>
)
export const IconTrash = (p) => (
  <svg {...base} {...p}>
    <path d="M4.5 6.5h15M9.5 6V4.5h5V6M7 6.5l.7 13h8.6l.7-13M10 10v6M14 10v6" />
  </svg>
)
export const IconBack = (p) => (
  <svg {...base} strokeWidth={2} {...p}><path d="M15 5l-7 7 7 7" /></svg>
)
export const IconRefresh = (p) => (
  <svg {...base} {...p}>
    <path d="M20 12a8 8 0 1 1-2.3-5.6M20 3.5V8h-4.5" />
  </svg>
)
export const IconCopy = (p) => (
  <svg {...base} {...p}>
    <rect x="8" y="8" width="11" height="11" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </svg>
)
export const IconCode = (p) => (
  <svg {...base} {...p}><path d="M8.5 8L4.5 12l4 4M15.5 8l4 4-4 4M13.5 5l-3 14" /></svg>
)
export const IconPuzzle = (p) => (
  <svg {...base} {...p}>
    <path d="M9 4.5h2a2.5 2.5 0 1 1 5 0h2a1.5 1.5 0 0 1 1.5 1.5v4h-2a2.5 2.5 0 1 0 0 5h2v3A1.5 1.5 0 0 1 18 19.5h-4v-2a2.5 2.5 0 1 0-5 0v2H6A1.5 1.5 0 0 1 4.5 18v-4h2a2.5 2.5 0 1 0 0-5h-2V6A1.5 1.5 0 0 1 6 4.5h3z" />
  </svg>
)
export const IconSparkles = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3l1.2 3.3L16.5 7.5l-3.3 1.2L12 12l-1.2-3.3-3.3-1.2 3.3-1.2L12 3z" />
    <path d="M18.5 13l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2zM6 13l.7 1.8 1.8.7-1.8.7L6 18l-.7-1.8-1.8-.7 1.8-.7L6 13z" />
  </svg>
)
export const IconCheck = (p) => (
  <svg {...base} strokeWidth={2.2} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
)
export const IconUpload = (p) => (
  <svg {...base} {...p}>
    <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
    <path d="M4.5 15.5v3A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-3" />
  </svg>
)
export const IconBranch = (p) => (
  <svg {...base} {...p}>
    <circle cx="6" cy="5" r="2.2" />
    <circle cx="6" cy="19" r="2.2" />
    <circle cx="18" cy="8" r="2.2" />
    <path d="M6 7.2v9.6M18 10.2c0 3.5-3 4.3-6 4.8-2.5.4-4.5 1-5.2 2.6M18 10.2" />
  </svg>
)
export const IconPlay = (p) => (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" {...p}>
    <path d="M8.5 5.8v12.4a.6.6 0 0 0 .92.5l9.4-6.2a.6.6 0 0 0 0-1l-9.4-6.2a.6.6 0 0 0-.92.5z" />
  </svg>
)
// Отдельная иконка очереди задач — вместо треугольника «play» в меню.
export const IconTasks = (p) => (
  <svg {...base} {...p}>
    <rect x="4" y="3.5" width="16" height="17" rx="3" />
    <path d="m7.3 9 1.5 1.5 2.4-2.8M12.5 9h4M7.3 15 8.8 16.5l2.4-2.8M12.5 15h4" />
  </svg>
)
export const IconSearch = (p) => (
  <svg {...base} {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </svg>
)
export const IconCommit = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M3.5 12h5.3M15.2 12h5.3" />
  </svg>
)
export const IconDownload = (p) => (
  <svg {...base} {...p}>
    <path d="M12 4v11M7.5 11.5L12 16l4.5-4.5" />
    <path d="M4.5 19.5h15" />
  </svg>
)
export const IconUndo = (p) => (
  <svg {...base} {...p}>
    <path d="M9 7H4v-5" />
    <path d="M4.5 7.5A8 8 0 1 1 5 17" />
  </svg>
)
export const IconCamera = (p) => (
  <svg {...base} {...p}>
    <path d="M4 7.5h3l1.5-2h7l1.5 2h3v11H4v-11z" />
    <circle cx="12" cy="13" r="3.2" />
  </svg>
)
export const IconBrain = (p) => (
  <svg {...base} {...p}>
    <path d="M9.5 5a3 3 0 0 0-5 2.2A3 3 0 0 0 4 13a3 3 0 0 0 2.5 4.7A3 3 0 0 0 12 19V7.5A2.5 2.5 0 0 0 9.5 5z" />
    <path d="M14.5 5a3 3 0 0 1 5 2.2A3 3 0 0 1 20 13a3 3 0 0 1-2.5 4.7A3 3 0 0 1 12 19M8 9.5c1.7 0 3 1.3 3 3M16 9.5c-1.7 0-3 1.3-3 3" />
  </svg>
)
export const IconStar = ({ filled = false, ...p }) => (
  <svg {...base} {...p} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 3.5l2.65 5.37 5.93.86-4.29 4.18 1.01 5.9L12 17.02 6.7 19.81l1.01-5.9-4.29-4.18 5.93-.86L12 3.5z" />
  </svg>
)
export const IconArrowDown = (p) => (
  <svg {...base} strokeWidth={2.1} {...p}><path d="M12 5v14M5.5 12.5L12 19l6.5-6.5" /></svg>
)
export const IconGitHub = (p) => (
  <svg {...base} fill="currentColor" stroke="none" {...p}>
    <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03a9.6 9.6 0 0 1 5 0c1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.85-2.34 4.7-4.57 4.95.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
  </svg>
)

// Лампочка — помечает заголовки второго уровня в ответе модели, чтобы «##»
// не торчало в тексте служебными символами.
export const IconBulb = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .9 1.6l.1.5h5l.1-.5c.1-.6.4-1.2.9-1.6A6 6 0 0 0 12 3z" />
    <path d="M9.5 18h5M10.5 21h3" />
  </svg>
)

// Анимация «агент думает»: три прыгающие точки
export const ThinkingDots = () => (
  <span className="think-dots" aria-hidden="true">
    <i />
    <i />
    <i />
  </span>
)
