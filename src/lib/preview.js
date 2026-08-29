// Предпросмотр веб-проектов: собираем HTML с blob-ссылками на файлы проекта
// и мостом console.log → postMessage в родительское окно.

const MIME = {
  html: 'text/html', css: 'text/css', js: 'application/javascript', mjs: 'application/javascript',
  json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', txt: 'text/plain', md: 'text/plain',
}

const JS_ENTRIES = ['index.js', 'main.js', 'app.js', 'script.js', 'index.mjs']

const BRIDGE =
  '<script>(function(){var send=function(t,a){try{parent.postMessage({__vpreview:1,type:t,args:a},"*")}catch(e){}};' +
  'var fmt=function(x){try{return typeof x==="object"&&x!==null?JSON.stringify(x):String(x)}catch(e){return String(x)}};' +
  '["log","info","warn","error"].forEach(function(k){var o=console[k]?console[k].bind(console):function(){};' +
  'console[k]=function(){send(k,[].map.call(arguments,fmt));o.apply(null,arguments)}});' +
  'window.addEventListener("error",function(e){send("error",[e.message+(e.lineno?" (строка "+e.lineno+")":"")])});' +
  'window.addEventListener("unhandledrejection",function(e){send("error",["Promise: "+((e.reason&&e.reason.message)||e.reason)])})})()</script>'

// Находит файл входной точки: index.html → любой html → типичные js-входы
export function findEntry(filesMap) {
  const paths = Object.keys(filesMap)
  const lower = (p) => p.toLowerCase()
  for (const cand of ['index.html', 'public/index.html', 'src/index.html', 'dist/index.html']) {
    if (paths.some((p) => lower(p) === cand)) return paths.find((p) => lower(p) === cand)
  }
  const byDepth = (a, b) => a.split('/').length - b.split('/').length || a.length - b.length
  const htmls = paths.filter((p) => lower(p).endsWith('.html')).sort(byDepth)
  if (htmls.length) return htmls[0]
  for (const cand of JS_ENTRIES) {
    const hit = paths.find((p) => lower(p) === cand || lower(p).endsWith('/' + cand))
    if (hit) return hit
  }
  const js = paths.filter((p) => /\.(js|mjs)$/i.test(p)).sort(byDepth)
  return js[0] || null
}

// Относительная ссылка → путь внутри проекта
function resolveRef(baseDir, ref) {
  if (!ref || /^(https?:)?\/\//i.test(ref) || /^(data|blob|mailto|javascript):/i.test(ref) || ref.startsWith('#')) return null
  const parts = (baseDir ? baseDir.split('/') : []).concat(ref.split('?')[0].split('#')[0].split('/'))
  const st = []
  for (const seg of parts) {
    if (!seg || seg === '.') continue
    if (seg === '..') st.pop()
    else st.push(seg)
  }
  return st.join('/')
}

export function buildPreview(filesMap, entry) {
  const urls = []
  const made = {}
  const mimeOf = (p) => MIME[(p.split('.').pop() || '').toLowerCase()] || 'text/plain'
  const mkBlob = (content, type) => {
    const u = URL.createObjectURL(new Blob([content], { type }))
    urls.push(u)
    return u
  }
  const resBlob = (p) => {
    if (!made[p]) made[p] = mkBlob(filesMap[p], mimeOf(p))
    return made[p]
  }

  const fm = { ...filesMap }

  // CSS: переписываем url(...) на blob-ссылки
  for (const p of Object.keys(fm)) {
    if (!p.toLowerCase().endsWith('.css')) continue
    const cdir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
    fm[p] = fm[p].replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi, (m, ref) => {
      const t = resolveRef(cdir, ref)
      if (!t || fm[t] === undefined) return m
      return 'url(' + resBlob(t) + ')'
    })
  }

  let html
  if (entry.toLowerCase().endsWith('.html')) {
    const edir = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/')) : ''
    html = fm[entry].replace(/(src|href)\s*=\s*["']([^"']+)["']/gi, (m, attr, ref) => {
      const t = resolveRef(edir, ref)
      if (!t || fm[t] === undefined) return m
      return `${attr}="${resBlob(t)}"`
    })
    // мост консоли — сразу после <head> или в начало
    if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (m) => m + BRIDGE)
    else html = BRIDGE + html
  } else {
    // чистый JS: оборачиваем в страницу с выводом
    const code = fm[entry] || ''
    html =
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      BRIDGE +
      '</head><body><pre id="__out" style="margin:0;padding:10px;font:12px/1.5 monospace;color:#111;white-space:pre-wrap"></pre>' +
      '<script>var __o=document.getElementById("__out");var __w=function(s){__o.textContent+=s+"\\n"};[' +
      '"log","info","warn","error"].forEach(function(k){var f=console[k];console[k]=function(){__w([].map.call(arguments,function(x){try{return typeof x==="object"?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(" "));f&&f.apply(console,arguments)}})<\/script>' +
      '<script>\ntry {\n' + code + '\n} catch (e) { console.error(e && e.message || e) }\n<\/script></body></html>'
  }

  const url = mkBlob(html, 'text/html')
  return { url, urls }
}
