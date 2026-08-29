import { Capacitor, registerPlugin } from '@capacitor/core'

// Android WebView does not reliably honour `a.download` for Blob URLs.  On a
// real device the native plugin opens the system "Save as" dialog instead.
const DeviceSave = registerPlugin('DeviceSave')

export function mimeForPath(path = '') {
  const ext = String(path).split('.').pop()?.toLowerCase()
  const types = {
    html: 'text/html', htm: 'text/html', css: 'text/css', json: 'application/json',
    js: 'text/javascript', jsx: 'text/javascript', ts: 'text/plain', tsx: 'text/plain',
    md: 'text/markdown', csv: 'text/csv', xml: 'application/xml', svg: 'image/svg+xml',
    py: 'text/x-python', java: 'text/x-java-source', kt: 'text/plain', yml: 'text/yaml', yaml: 'text/yaml',
  }
  return types[ext] || 'text/plain'
}

function fileName(value) {
  const name = String(value || 'file.txt').split(/[\\/]/).pop() || 'file.txt'
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

export async function saveTextFile({ name, content, mime }) {
  const safeName = fileName(name)
  const type = mime || mimeForPath(safeName)
  if (Capacitor.isNativePlatform()) {
    await DeviceSave.save({ name: safeName, content: String(content ?? ''), mime: type })
    return
  }

  const blob = new Blob([content ?? ''], { type: `${type};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = safeName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
