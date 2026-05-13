// ui/src/views/EditorView.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { summarizeSource, composeFinal } from '../lib/engineClient'
import { Document, Packer, Paragraph, TextRun } from 'docx'

const pipeline = ['Import', 'Audio → Text', 'Video → Clips', 'Slides → Notes', 'Document assembly']

// Глобальный joinUrl (единый для всего файла)
const joinUrl = (base, path) => {
  if (!path) return ''
  return /^https?:\/\//i.test(path) ? path : `${base}${path}`
}

// Хелпер безопасной обрезки подписи
function shortLabel(s, n = 40) {
  const str = (s || '').trim()
  return str.length > n ? str.slice(0, n - 1) + '…' : str
}

// Тип источника: audio | video | slides | doc | youtube | gdoc | web
function mkSource(partial) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'audio',          // обязателен
    name: '',               // отображаемое имя
    file: null,             // File | null
    url: '',                // строка URL (YouTube / Google Docs / WEB)
    enabled: true,          // участвует в обработке
    status: 'idle',         // idle | uploading | ok | empty | error
    statusText: '',
    artifacts: {},          // { vtt, json, doc_md } — для UI
    artifactsUrl: {},       // явные URL артефактов (если бэкенд их дал)
    artifactsAbs: {},       // абсолютные пути (для summarizeSource)
    jobId: null,            // job источника (если бэкенд вернул)
    language: 'unk',
    segments: 0,
    // ← Новые поля для сохранения сведений о саммари
    summaryRel: null,
    summaryName: null,
    ...partial,
  }
}

export default function EditorView({ subject, lecture, onBack, onUpdateLecture, engineUrl = 'http://127.0.0.1:7861', onWantSidebarCollapsed }) {
  const [docMd, setDocMd] = useState(lecture?.docMd || '')
  const [lecType, setLecType] = useState(lecture?.lecType || 'summary')

  // Массив источников
  const [sources, setSources] = useState([])

  // Какой источник открыт в просмотрщике текста
  const [showSourcePane, setShowSourcePane] = useState(false)
  const [activeSourceId, setActiveSourceId] = useState(null)

  // Прочее состояние
  const [busy, setBusy] = useState(false)
  const [statusText, setStatusText] = useState('')

  // 🔑 Общий job для компоновки саммари
  const [composeJobId, setComposeJobId] = useState(() => lecture?.composeJobId || null)

  // формат экспорта: 'pdf' | 'docx' | null
  const [exportFormat, setExportFormat] = useState('docx')

  // Refs для инпутов (множественные)
  const audioRef = useRef(null)
  const videoRef = useRef(null)
  const slidesRef = useRef(null)
  const docsRef = useRef(null)

  const baseUrl = useMemo(() => engineUrl.replace(/\/$/, ''), [engineUrl])

  useEffect(() => {
    onWantSidebarCollapsed?.(true)
    return () => onWantSidebarCollapsed?.(false)
  }, [onWantSidebarCollapsed])

  // ⚠️ Не затираем редактор пустым текстом при смене лекции
  useEffect(() => {
    if (!lecture) return
    setLecType(lecture.lecType || 'summary')

    // ✅ Генерим composeJobId один раз и сразу сохраняем в лекцию, если его нет
    if (!lecture.composeJobId) {
      const base = lecture?.id ?? (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))
      const cj = `cj-${String(base).replace(/[^a-z0-9]/gi, '').slice(0, 12)}`
      setComposeJobId(cj)
      onUpdateLecture?.({ ...lecture, composeJobId: cj })
    } else {
      setComposeJobId(lecture.composeJobId)
    }

    if (Array.isArray(lecture.sources)) setSources(lecture.sources)

    // важное: не перезатираем editor, если сверху пусто
    if (lecture.docMd && lecture.docMd.trim()) {
      setDocMd(lecture.docMd)
    }
  }, [lecture?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // =================== Обработчики добавления источников ===================
  function addFiles(kind, fileList) {
    const arr = Array.from(fileList || [])
    if (!arr.length) return
    setSources(prev => ([
      ...prev,
      ...arr.map(f => mkSource({
        kind,
        name: f.name,
        file: f,
        enabled: true,
      }))
    ]))
  }

  function addUrl(kind, url) {
    const clean = (url || '').trim()
    if (!clean) return
    setSources(prev => ([
      ...prev,
      mkSource({ kind, url: clean, name: clean })
    ]))
  }

  function toggleSource(id, enabled) {
    setSources(prev => prev.map(s => s.id === id ? { ...s, enabled } : s))
  }

  function removeSource(id) {
    setSources(prev => prev.filter(s => s.id !== id))
    if (activeSourceId === id) setActiveSourceId(null)
  }

  // =================== Последовательная обработка ===================
  async function handleProcessSequential() {
    // отбираем onюченные источники
    const queue = sources.filter(s => s.enabled)
    if (!queue.length) {
      setStatusText('No enabled sources')
      return
    }

    setBusy(true)
    setStatusText('Starting source processing…')

    try {
      // Локальная копия, чтобы гарантированно передать актуальные sources наружу
      let latest = [...sources]
      // Храним последнее значение документа, которое положили в editor (для прокидывания наверх)
      let lastNextDoc = (docMd || '').trim() ? docMd : ''

      for (let i = 0; i < queue.length; i++) {
        const src = queue[i]
        // локально пометим статус загрузки
        setSources(prev => prev.map(s => s.id === src.id ? { ...s, status: 'uploading', statusText: 'Uploading…' } : s))
        latest = latest.map(s => s.id === src.id ? { ...s, status: 'uploading', statusText: 'Uploading…' } : s)

        const form = new FormData()
        // ВАЖНО: lecture_type задаём покомпонентно.
        // Для веб-ветки движка нужно явно 'web', иначе используем выбранный тип структуры.
        const perSourceLectureType = (src.kind === 'web') ? 'web' : lecType
        form.append('lecture_type', perSourceLectureType)

        // Разводим по видам
        if (src.file) {
          form.append('media', src.file)
        } else if (src.kind === 'youtube') {
          form.append('youtube_url', src.url)
        } else if (src.kind === 'gdoc') {
          // ✅ Бэкенд ждёт doc_url
          form.append('doc_url', src.url)
        } else if (src.kind === 'doc' && src.url) {
          // на случай, если даём удалённый файл документа ссылкой
          form.append('doc_url', src.url)
        } else if (src.kind === 'web') {
          // новая ветка: веб-источник (URL)
          // движок waiting поле 'url' при lecture_type=web
          form.append('url', src.url)
        }

        // для простоты считаем, что один унифицированный эндпоинт /process
        const res = await fetch(`${baseUrl}/process`, { method: 'POST', body: form })

        let data
        try {
          data = await res.json()
        } catch (e) {
          const t = await res.text().catch(() => '')
          console.error('Non-JSON response:', t)
          throw new Error('Engine returned non-JSON')
        }

        if (!res.ok || (data.status !== 'ok' && data.status !== 'empty')) {
          const msg = data.message || `${res.status} ${res.statusText ?? ''}`
          const updatedObjErr = { ...src, status: 'error', statusText: msg }
          setSources(prev => prev.map(s => s.id === src.id ? updatedObjErr : s))
          latest = latest.map(s => s.id === src.id ? updatedObjErr : s)
          // 🛠 ФИКС: s → src
          setStatusText(`Source error «${src.name || src.kind}»: ${msg}`)
          continue
        }

        // Превью, которое может прийти от бэкенда
        const preview = (data.doc_preview || '').trim()

        // ⛔️ ВАЖНО: для web-источника не трогаем главный документ.
        // Для остальных источников прежняя логика: если редактор пуст — подставим превью.
        if (src.kind !== 'web') {
          const nextDoc = (docMd && docMd.trim()) ? docMd : (preview || '(Empty)')
          setDocMd(nextDoc)
          lastNextDoc = nextDoc
        } else {
          // для web оставляем документ как есть
          lastNextDoc = (lastNextDoc && lastNextDoc.trim()) ? lastNextDoc : (docMd || '')
        }

        // Разводим артефакты на URL (для просмотра) и ABS (для summarize_source)
        const artifactsUrl = data.artifacts_url ?? {}
        const artifactsAbs = data.artifacts ?? {}
        // Для web-источника пробросим inline превью исключительно в UI-артефакты
        const artifactsForUi =
          (src.kind === 'web' && preview)
            ? { ...artifactsUrl, doc_md_inline: preview }
            : artifactsUrl

        const updatedObjOk = {
          ...src,
          status: data.status,
          statusText: data.status === 'ok' ? 'Done' : 'Empty',
          artifacts: artifactsForUi,   // относительные URL (для панели «Text»)
          artifactsUrl,                // явные URL
          artifactsAbs,                // АБСОЛЮТНЫЕ пути (для summarize_source)
          jobId: data.job_id,          // индивидуальный job источника (информативно)
          language: data.language || 'unk',
          segments: data.segments ?? 0,
        }

        // сохраним артефакты в источник
        setSources(prev => prev.map(s => s.id === src.id ? updatedObjOk : s))
        latest = latest.map(s => s.id === src.id ? updatedObjOk : s)

        setStatusText(`Done: «${src.name || src.kind}» — ${data.segments ?? 0} segments, язык: ${data.language || 'unk'}`)
      }

      // апдейт карточки лекции — передаём актуальные sources и то же значение документа
      onUpdateLecture?.({
        ...lecture,
        status: 'processed',
        docMd: lastNextDoc,   // ← прокидываем то же значение (для web не изменялось)
        lecType,
        sources: latest,
        composeJobId: composeJobId || lecture?.composeJobId
      })
    } catch (e) {
      console.error(e)
      setStatusText(e.message || 'Network/engine error')
    } finally {
      setBusy(false)
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function exportAsDocx() {
    // Простой DOCX: каждая строка — отдельный абзац
    const lines = (docMd || '').split('\n')
    const paragraphs = lines.map((line) => new Paragraph({ children: [new TextRun(line || '')] }))
    const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] })
    const blob = await Packer.toBlob(doc)
    const baseName = (lecture?.title || subject?.name || 'document').toString().replace(/[^a-zA-Z0-9._-]+/g,'_')
    downloadBlob(blob, `${baseName}.docx`)
  }

  // Export в PDF через системный диалог печати (Save as PDF)
  function exportAsPdf() {
    const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${(lecture?.title || subject?.name || 'document')}</title>
<style>
  @page { size: A4; margin: 20mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
         line-height: 1.45; font-size: 12pt; color: #111; }
  pre { white-space: pre-wrap; word-wrap: break-word; }
</style>
</head>
<body>
<pre>${(docMd || '').replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s]))}</pre>
<script>
  setTimeout(() => { window.print(); }, 50);
  window.onafterprint = () => { try { window.close(); } catch(e) {} };
</script>
</body>
</html>`
    const w = window.open('', '_blank')
    if (!w) throw new Error('Browser blocked a popup window')
    w.document.open()
    w.document.write(html)
    w.document.close()
  }

  async function handleSave() {
    // сохраняем состояние лекции как было
    onUpdateLecture?.({ ...lecture, docMd, lecType, sources, composeJobId })
    if (!exportFormat) {
      setStatusText('Select format')
      return
    }
    try {
      if (exportFormat === 'docx') {
        await exportAsDocx()
        setStatusText('DOCX downloaded')
      } else if (exportFormat === 'pdf') {
        exportAsPdf()
        setStatusText('Print window opened: save as PDF')
      }
    } catch (e) {
      console.error(e)
      setStatusText(`Export error: ${e.message || e}`)
    }
  }

  // =================== Рендер ===================
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border px-2 py-1 hover:bg-gray-50 active:scale-[0.98] transition"
          >
            ← Lectures
          </button>
          <span>/</span>
          <span>{subject?.emoji || '📘'} {subject?.name}</span>
        </div>
      </div>

      {/* Status */}
      <div className="mb-4 flex items-center gap-3">
        {busy && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary-600" />}
        <span className="text-sm text-gray-600">{busy ? statusText : `Done · ${docMd.length} chars`}</span>
      </div>
      {busy && <div className="mb-4 h-1 w-full overflow-hidden rounded bg-gray-100"><div className="h-1 w-1/2 animate-[pulse_1.2s_ease-in-out_infinite] bg-primary-600"></div></div>}

      <div className="grid grid-cols-12 gap-6">
        {/* LEFT: import sources only */}
        <aside className="col-span-12 lg:col-span-3 space-y-4">
          {/* Web (URL) — NEW */}
          <SectionCard title="Web (URL, multi)">
            <UrlAdder label="Web page link" placeholder="https://example.com/article..." onAdd={(u)=>addUrl('web', u)} />
            <div className="mt-2 text-[11px] text-gray-500">
              For this branch, the engine uses <code>lecture_type=web</code> and field <code>url</code>.
            </div>
          </SectionCard>

          {/* Audio */}
          <SectionCard title="Audio (multi)">
            <DropBox
              multiple
              accept="audio/*"
              placeholder="Drag .mp3/.wav here or select multiple files"
              onFiles={(files)=>addFiles('audio', files)}
              onPick={()=>audioRef.current?.click()}
            />
            <input ref={audioRef} type="file" accept="audio/*" className="hidden" multiple onChange={e=>addFiles('audio', e.target.files)} />
          </SectionCard>

          {/* Video */}
          <SectionCard title="Video (multi + YouTube)">
            <DropBox
              multiple
              accept="video/*"
              placeholder="Drag .mp4/.mov or select multiple files"
              onFiles={(files)=>addFiles('video', files)}
              onPick={()=>videoRef.current?.click()}
            />
            <input ref={videoRef} type="file" accept="video/*" className="hidden" multiple onChange={e=>addFiles('video', e.target.files)} />
            <UrlAdder label="YouTube link" placeholder="https://youtube.com/watch?v=..." onAdd={(u)=>addUrl('youtube', u)} />
          </SectionCard>

          {/* Slides */}
          <SectionCard title="Slides (PDF/PPTX, multi)">
            <DropBox
              multiple
              accept=".pdf,.ppt,.pptx,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              placeholder="Drag PDF/PPTX or select multiple files"
              onFiles={(files)=>addFiles('slides', files)}
              onPick={()=>slidesRef.current?.click()}
            />
            <input ref={slidesRef} type="file" className="hidden" multiple onChange={e=>addFiles('slides', e.target.files)} />
          </SectionCard>

          {/* Documents */}
          <SectionCard title="Documents (DOC/DOCX/MD/TXT + Google Docs)">
            <DropBox
              multiple
              accept=".doc,.docx,.md,.txt,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
              placeholder="Drag documents or select multiple files"
              onFiles={(files)=>addFiles('doc', files)}
              onPick={()=>docsRef.current?.click()}
            />
            <input ref={docsRef} type="file" className="hidden" multiple onChange={e=>addFiles('doc', e.target.files)} />
            <UrlAdder label="Google Docs" placeholder="https://docs.google.com/document/d/..." onAdd={(u)=>addUrl('gdoc', u)} />
          </SectionCard>
        </aside>

        {/* CENTER: document or source panel */}
        <main className="col-span-12 lg:col-span-6">
          {showSourcePane ? (
            <SectionCard title="Source → Text view (switchable)">
              <SourceTextPane
                baseUrl={baseUrl}
                sources={sources}
                activeSourceId={activeSourceId}
                onChangeActive={(id)=>setActiveSourceId(id)}
                onBack={()=>setShowSourcePane(false)}
                onInsertToDoc={(text) =>
                  setDocMd(prev => {
                    const nl = '\n'
                    return `${prev}${!prev || prev.endsWith(nl) ? '' : nl}${text}${nl}`
                  })
                }
                composeJobId={composeJobId}
              />
            </SectionCard>
          ) : (
            <SectionCard title="Lecture document">
              <div className="mb-3 text-xs text-gray-500">
                Structure type:&nbsp;
                <select className="rounded-lg border px-2 py-1" value={lecType} onChange={e=>setLecType(e.target.value)}>
                  <option value="summary">Summary</option>
                  <option value="transcript">Transcript-first</option>
                  <option value="cheatsheet">Cheatsheet/exam</option>
                  <option value="slides">Material-centered</option>
                  {/* Do not add 'web' сюда, because the web branch is selected automatically by the source */}
                </select>
              </div>
              <textarea
                className="h-[520px] w-full resize-none rounded-xl border p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="The assembled document will appear here..."
                value={docMd}
                onChange={e=>setDocMd(e.target.value)}
              />
            </SectionCard>
          )}
        </main>

        {/* RIGHT: management → export → source list */}
        <aside className="col-span-12 lg:col-span-3 space-y-4">
          <SectionCard title="Management">
            <div className="flex gap-2">
              <button
                type="button"
                className="w-full rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 active:scale-[0.98] transition"
                onClick={handleProcessSequential}
                disabled={busy}
                title="Rebuild all sources"
              >
                🔁 Rebuild all
              </button>
              <button
                type="button"
                className="w-full rounded-xl bg-primary-600 px-3 py-2 text-sm text-white shadow hover:bg-primary-700 active:scale-[0.98] transition"
                onClick={handleSave}
                disabled={busy}
                title={!exportFormat ? 'Select format below' : 'Download document'}
              >
                ⬇️ Download
              </button>
            </div>
            <div className="mt-3">
              <button
                type="button"
                className="w-full rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 active:scale-[0.98] transition"
                disabled={!composeJobId || busy}
                onClick={async ()=>{
                  try{
                    setBusy(true); setStatusText('Assembling final…')
                    const r = await composeFinal({ jobId: composeJobId })
                    const url = `${baseUrl}/workspace/${composeJobId}/final_compiled.md`
                    const md = await fetch(url).then(r=>r.text()).catch(()=>r.preview||'')
                    setDocMd(md || r.preview || '(empty)')
                    setStatusText(`Final ready`)
                  }catch(e){
                    setStatusText(`Final error: ${e.message || e}`)
                  }finally{
                    setBusy(false)
                  }
                }}
              >
                🧩 Compose final
              </button>
            </div>
          </SectionCard>

          {/* Export — segmentsнтные кнопки вместо радио */}
          <SectionCard title="Export">
            <div className="mb-2 text-xs text-gray-600">File format:</div>

            <div className="inline-flex overflow-hidden rounded-xl border shadow-sm">
              <button
                type="button"
                aria-pressed={exportFormat==='docx'}
                onClick={()=>setExportFormat('docx')}
                className={`px-3 py-1.5 text-sm transition ${
                  exportFormat==='docx'
                    ? 'bg-primary-600 text-white'
                    : 'bg-white text-gray-800 hover:bg-gray-50'
                }`}
              >
                DOCX
              </button>
              <button
                type="button"
                aria-pressed={exportFormat==='pdf'}
                onClick={()=>setExportFormat('pdf')}
                className={`px-3 py-1.5 text-sm border-l transition ${
                  exportFormat==='pdf'
                    ? 'bg-primary-600 text-white'
                    : 'bg-white text-gray-800 hover:bg-gray-50'
                }`}
              >
                PDF
              </button>
            </div>

            <div className="mt-2 text-[11px] text-gray-500">
              Select format, then click “Download” in the “Management” block.
            </div>
          </SectionCard>

          {/* ==== SELECTED SOURCES ==== */}
          <SectionCard title="Selected sources">
            {sources.length === 0 ? (
              <div className="text-xs text-gray-500">No sources added.</div>
            ) : (
              <div className="space-y-2">
                {sources.map(s => {
                  const hasArtifacts = !!(s.artifacts && Object.keys(s.artifacts).length > 0)
                  const canSummarize = !!(s.artifactsAbs && Object.keys(s.artifactsAbs).length > 0)
                  return (
                    <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0 flex-1">
                        <div className="truncate max-w-[230px]">
                          <span className="text-gray-500">[{s.kind}]</span> {s.name || s.url || 'untitled'}
                        </div>
                        <div className="text-[11px] text-gray-500">
                          {s.status !== 'idle' ? `${s.status}: ${s.statusText}` : 'waiting'}
                        </div>
                      </div>

                      {/* toggle switch */}
                      <label className="inline-flex items-center gap-1 shrink-0">
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          onChange={(e)=>toggleSource(s.id, e.target.checked)}
                        />
                        <span>on</span>
                      </label>

                      {/* компактный segmented control: Text / Summary — одна строка */}
                      <div className="shrink-0">
                        <div className="inline-flex items-stretch overflow-hidden rounded-full border">
                          <button
                            className="px-2 py-1 text-[11px] leading-none hover:bg-gray-50"
                            title="Show source text"
                            disabled={!hasArtifacts}
                            onClick={() => { setActiveSourceId(s.id); setShowSourcePane(true) }}
                          >
                            Text
                          </button>
                          <div className="w-px bg-gray-200" />
                          <button
                            className="px-2 py-1 text-[11px] leading-none hover:bg-gray-50"
                            title="Source summary to overall outline"
                            disabled={!canSummarize || !composeJobId || busy}
                            onClick={async ()=>{
                              try{
                                setBusy(true); setStatusText('Summarizing source…')
                                const name = (s.name || s.url || s.kind || 'source').toString().slice(0,80)
                                const resp = await summarizeSource({ jobId: composeJobId, name, artifactsAbs: s.artifactsAbs })
                                setSources(prev => prev.map(it => it.id === s.id
                                  ? { ...it, summaryRel: resp.summary_rel, summaryName: resp.summary_name }
                                  : it
                                ))
                                setStatusText('Summary OK')
                              }catch(e){
                                setStatusText(`Summary error: ${e.message || e}`)
                              }finally{
                                setBusy(false)
                              }
                            }}
                          >
                            Summary
                          </button>
                        </div>
                      </div>

                      {/* delete */}
                      <button
                        className="text-red-600 hover:bg-red-50 rounded px-2 py-1 shrink-0"
                        title="Delete"
                        onClick={()=>removeSource(s.id)}
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>
          {/* ==== /SELECTED SOURCES ==== */}
        </aside>
      </div>
    </div>
  )
}

function SectionCard({ title, children }) {
  return (
    <div className="card p-4 rounded-2xl border">
      <div className="mb-2 text-sm font-medium">{title}</div>
      {children}
    </div>
  )
}

function DropBox({ accept, placeholder, onFiles, onPick, multiple }) {
  function onKeyDown(e){
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPick?.();
    }
  }
  function onDrop(ev){
    ev.preventDefault()
    const files = ev.dataTransfer?.files
    if (files?.length) onFiles?.(files)
  }
  return (
    <div
      role="button"
      tabIndex={0}
      className="flex min-h-28 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed bg-gray-50 text-xs text-gray-500 hover:bg-gray-100 active:scale-[0.99] transition outline-none focus:ring-2 focus:ring-primary-500 px-3 py-4 text-center"
      onDragOver={(e)=>e.preventDefault()}
      onDrop={onDrop}
      onClick={onPick}
      onKeyDown={onKeyDown}
      title={multiple ? 'Drag files or click to select (multiple)' : 'Drag file or click to select'}
    >
      {placeholder}
    </div>
  )
}

function UrlAdder({ label, placeholder, onAdd }) {
  const [val, setVal] = useState('')
  return (
    <div className="mt-2 text-xs text-gray-600">
      <div className="mb-1">{label}:</div>
      <div className="flex gap-2">
        <input
          type="url"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border px-2 py-1"
        />
        <button
          type="button"
          className="rounded-xl border px-3 py-1 hover:bg-gray-50 active:scale-[0.98] transition"
          onClick={()=>{ if (val.trim()) { onAdd?.(val); setVal('') } }}
        >
          Add
        </button>
      </div>
    </div>
  )
}

/** Панель просмотра текста с переключателем источника
 *  Shows raw WEBVTT, otherwise JSON merge, otherwise doc_md or doc_md_inline.
 */
function SourceTextPane({ baseUrl, sources, activeSourceId, onChangeActive, onBack, onInsertToDoc, composeJobId }) {
  const processed = sources.filter(s => s.artifacts && Object.keys(s.artifacts).length > 0)
  const active = processed.find(s => s.id === activeSourceId) || processed[0]

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [insertBuf, setInsertBuf] = useState('')
  const [viewMode, setViewMode] = useState('source') // 'source' | 'summary'

  function safeName(name='src'){
    const base = (name || 'src').toString().replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0,80) || 'src'
    return `${base}.md`
  }

  // Автовыбор первого обработанного источника
  useEffect(() => {
    if (!active && processed.length) {
      onChangeActive?.(processed[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processed.length])

  // Лоадер текста — учитываем viewMode === 'summary'
  useEffect(() => {
    if (!active) return
    let cancelled = false
    async function load() {
      try {
        setLoading(true); setError(''); setText('')

        if (viewMode === 'summary') {
          if (!composeJobId) { setError('No composeJobId'); return }
          const url = active.summaryRel
            ? `${baseUrl}${active.summaryRel}`
            : `${baseUrl}/workspace/${composeJobId}/summaries/${safeName(active.name || active.url || active.kind || 'source')}`
          const res = await fetch(url)
          if (!res.ok) {
            setError('No summary yet (click “Summary” at the source first)')
          } else {
            const t = await res.text()
            setText(t || '(empty)')
          }
          return
        }

        // режим просмотра «сырого» текста источника
        const aRaw = active.artifacts || {}
        const a = (typeof aRaw === 'string') ? { doc_md: aRaw } : aRaw

        // 🔹 Приоритет: inline-текст превью (для web), затем vtt/json/doc_md
        if (a.doc_md_inline) {
          setText(a.doc_md_inline)
          setLoading(false)
          return
        }

        if (a.vtt) {
          const res = await fetch(joinUrl(baseUrl, a.vtt))
          const vtt = await res.text()
          setText(vtt)
        } else if (a.json) {
          const res = await fetch(joinUrl(baseUrl, a.json))
          const j = await res.json()
          let flat = ''
          if (Array.isArray(j?.segments)) {
            flat = j.segments.map(s => (s.text || '').trim()).filter(Boolean).join('\n')
          } else if (Array.isArray(j)) {
            flat = j.map(s => (s?.text || '').trim()).filter(Boolean).join('\n')
          }
          setText(flat)
        } else if (a.doc_md) {
          const res = await fetch(joinUrl(baseUrl, a.doc_md))
          const t = await res.text()
          setText(t)
        } else {
          setError('No artifacts to display')
        }
      } catch (e) {
        console.error(e)
        setError('Text loading error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
  }, [
    baseUrl,
    active?.id,
    active?.artifacts?.vtt,
    active?.artifacts?.json,
    active?.artifacts?.doc_md,
    active?.artifacts?.doc_md_inline,
    active?.summaryRel,
    viewMode,
    composeJobId
  ])

  async function copyAll(){
    try { await navigator.clipboard?.writeText(text || '') } catch { console.warn('Clipboard unavailable') }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        {/* Обновлённый селект с ограничением ширины и безопасной обрезкой */}
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>Source:</span>
          <div className="max-w-[360px]">
            <select
              className="w-full truncate rounded-lg border px-2 py-1 text-xs"
              value={active?.id || ''}
              onChange={(e)=>onChangeActive?.(e.target.value)}
            >
              {processed.map(s => {
                const full = `[${s.kind}] ${s.name || s.url || 'untitled'}`
                return (
                  <option key={s.id} value={s.id} title={full}>
                    {shortLabel(full, 40)}
                  </option>
                )
              })}
            </select>
          </div>
        </div>
        <button type="button" className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50 active:scale-[0.98] transition" onClick={onBack}>
          ← Back to document
        </button>
      </div>

      {/* View switcher */}
      <div className="mb-2 flex gap-2 text-xs">
        <button
          type="button"
          className={`rounded-lg border px-2 py-1 ${viewMode==='source'?'ring-1 ring-primary-500 bg-white':'hover:bg-gray-50'}`}
          onClick={()=>setViewMode('source')}
        >
          Source
        </button>
        <button
          type="button"
          className={`rounded-lg border px-2 py-1 ${viewMode==='summary'?'ring-1 ring-primary-500 bg-white':'hover:bg-gray-50'}`}
          onClick={()=>setViewMode('summary')}
        >
          Summary
        </button>
      </div>

      {!active ? (
        <div className="text-sm text-gray-500">No processed sources.</div>
      ) : loading ? (
        <div className="text-sm text-gray-500">Loading text…</div>
      ) : error ? (
        <div className="text-sm text-red-600">{error}</div>
      ) : (
        <>
          <textarea
            className="mb-3 h-64 w-full resize-y rounded-xl border p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-primary-500"
            value={text}
            onChange={e=>setText(e.target.value)}
            placeholder={viewMode==='summary' ? 'Source summary…' : 'Source text…'}
          />
          <div className="mb-2 text-xs text-gray-500">Insert field (assemble a fragment and add to document):</div>
          <textarea
            className="mb-2 h-40 w-full resize-y rounded-xl border p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-primary-500"
            value={insertBuf}
            onChange={e=>setInsertBuf(e.target.value)}
            placeholder="You can copy part of the text above here, edit it, and insert into the document…"
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-xl bg-primary-600 px-3 py-2 text-sm text-white shadow hover:bg-primary-700 active:scale-[0.98] transition"
              onClick={() => { if (insertBuf.trim()) onInsertToDoc(insertBuf) }}
              disabled={!insertBuf.trim()}
              title={!insertBuf.trim() ? 'Enter text to insert' : 'Insert into document'}
            >
              Insert into document
            </button>
            <button type="button" className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 active:scale-[0.98] transition" onClick={copyAll}>
              Copy all
            </button>
          </div>
        </>
      )}
    </div>
  )
}
