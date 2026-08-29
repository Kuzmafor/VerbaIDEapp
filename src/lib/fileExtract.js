const MAX_EXTERNAL = 18 * 1024 * 1024

function ext(path = '') {
  return path.toLowerCase().split('.').pop() || ''
}

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать изображение'))
    reader.readAsDataURL(file)
  })
}

async function imageData(file) {
  const src = await readDataUrl(file)
  if (file.type === 'image/gif' || file.size < 700 * 1024) return src
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 1400 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      let ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      let result = canvas.toDataURL('image/jpeg', 0.8)
      while (result.length > 720000 && canvas.width > 520) {
        const prev = document.createElement('canvas')
        prev.width = canvas.width
        prev.height = canvas.height
        prev.getContext('2d').drawImage(canvas, 0, 0)
        canvas.width = Math.round(canvas.width * 0.82)
        canvas.height = Math.round(canvas.height * 0.82)
        ctx = canvas.getContext('2d')
        ctx.drawImage(prev, 0, 0, canvas.width, canvas.height)
        result = canvas.toDataURL('image/jpeg', 0.74)
      }
      resolve(result)
    }
    img.onerror = () => resolve(src)
    img.src = src
  })
}

async function pdfText(file) {
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const pages = []
  for (let i = 1; i <= Math.min(pdf.numPages, 160); i++) {
    const page = await pdf.getPage(i)
    const data = await page.getTextContent()
    pages.push(`[Страница ${i}]\n` + data.items.map((x) => x.str).join(' '))
  }
  return pages.join('\n\n')
}

async function docxText(file) {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  return result.value || ''
}

async function sheetText(file) {
  const { default: readExcelFile } = await import('read-excel-file/browser')
  const sheets = await readExcelFile(file)
  return sheets.map(({ sheet, data }) => {
    const csv = data.map((row) => row.map((cell) => {
      const value = cell instanceof Date ? cell.toISOString() : String(cell ?? '')
      return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
    }).join(',')).join('\n')
    return `[Лист: ${sheet}]\n${csv}`
  }).join('\n\n')
}

export async function extractExternalFile(file) {
  if (file.size > MAX_EXTERNAL) throw new Error(`${file.name}: файл больше 18 МБ`)
  const path = file.webkitRelativePath || file.name
  const type = file.type || ''
  const extension = ext(path)
  if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'].includes(extension)) {
    return { path, external: true, kind: 'image', mimeType: type || `image/${extension}`, size: file.size, dataUrl: await imageData(file), content: '' }
  }
  let content = ''
  let kind = 'text'
  if (extension === 'pdf' || type === 'application/pdf') {
    kind = 'document'; content = await pdfText(file)
  } else if (extension === 'docx') {
    kind = 'document'; content = await docxText(file)
  } else if (extension === 'xlsx') {
    kind = 'table'; content = await sheetText(file)
  } else if (['xls', 'ods'].includes(extension)) {
    throw new Error(`${file.name}: этот формат таблицы не поддержан, сохраните как XLSX или CSV`)
  } else {
    content = await file.text()
    if (['csv', 'tsv'].includes(extension)) kind = 'table'
  }
  return { path, external: true, kind, mimeType: type || 'text/plain', size: file.size, content: content.slice(0, 300000) }
}
