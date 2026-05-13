// ui/src/App.jsx
import { useEffect, useMemo, useState } from 'react'
import Sidebar from './components/Sidebar'
import HomeView from './views/HomeView'
import SubjectsView from './views/SubjectsView'
import LecturesView from './views/LecturesView'
import EditorView from './views/EditorView'
import EditSubjectModal from './components/EditSubjectModal'
import EditLectureModal from './components/EditLectureModal'
import ConfirmModal from './components/ConfirmModal'
import { loadState, saveState } from './lib/store'
import TimetableView from './views/TimetableView'

export default function App() {
  const [{ subjects, lecturesBySubject }, setState] = useState(() => loadState())

  // 'home' | 'subjects' | 'lectures' | 'editor' | 'timetable'
  const [view, setView] = useState('home')

  const [activeSubject, setActiveSubject] = useState(null)
  const [activeLecture, setActiveLecture] = useState(null)
  const [collapsed, setCollapsed] = useState(false)

  // modals
  const [editSubOpen, setEditSubOpen] = useState(false)
  const [editSubject, setEditSubject] = useState(null)
  const [delSubOpen, setDelSubOpen] = useState(false)
  const [delSubject, setDelSubject] = useState(null)
  const [editLecOpen, setEditLecOpen] = useState(false)
  const [editLecture, setEditLecture] = useState(null)
  const [delLecOpen, setDelLecOpen] = useState(false)
  const [delLecture, setDelLecture] = useState(null)

  const subjectsForSidebar = useMemo(
    () => subjects.map(s => ({ ...s, _lectures: lecturesBySubject[s.id] || [] })),
    [subjects, lecturesBySubject]
  )

  useEffect(() => {
    saveState({ subjects, lecturesBySubject })
  }, [subjects, lecturesBySubject])

  // navigation
  const goHome = () => { setView('home'); setActiveSubject(null); setActiveLecture(null) }

  const openSubject = (s) => {
    setActiveSubject(s)
    setView('lectures')
    setState(prev =>
      prev.lecturesBySubject[s.id]
        ? prev
        : { ...prev, lecturesBySubject: { ...prev.lecturesBySubject, [s.id]: [] } }
    )
  }

  const openCreateSubject = () => {
    const id = 'subj-' + Math.random().toString(36).slice(2, 7)
    setEditSubject({ id, name: '', emoji: '📘', colorId: 'blue', lectures: 0, updated: 'Just now' })
    setEditSubOpen(true)
  }

  const saveSubject = ({ name, emoji, colorId }) => {
    setState(prev => {
      const exists = prev.subjects.some(x => x.id === editSubject.id)
      const upd = { ...editSubject, name, emoji, colorId, updated: 'Just now' }
      return {
        ...prev,
        subjects: exists
          ? prev.subjects.map(x => x.id === editSubject.id ? upd : x)
          : [...prev.subjects, upd]
      }
    })
    setEditSubOpen(false)
    if (view === 'home') setView('subjects')
  }

  const confirmDeleteSubject = () => {
    setState(prev => {
      const { [delSubject.id]: _omit, ...rest } = prev.lecturesBySubject
      return { subjects: prev.subjects.filter(x => x.id !== delSubject.id), lecturesBySubject: rest }
    })
    setDelSubOpen(false); setDelSubject(null)
    if (activeSubject?.id === delSubject.id) { setActiveSubject(null); setView('subjects') }
  }

  const openCreateLecture = (forSubject = activeSubject) => {
    if (!forSubject) return
    const id = 'lec-' + Math.random().toString(36).slice(2, 7)
    const lec = {
      id,
      title: 'New lecture',
      date: new Date().toISOString().slice(0, 10),
      duration: '',
      status: 'imported',
      docMd: '',
      lecType: 'summary',
      useAudio: true,
      useVideo: true,
      useSlides: true,
      videoUrl: ''
    }
    setState(prev => {
      const list = prev.lecturesBySubject[forSubject.id] || []
      return {
        ...prev,
        subjects: prev.subjects.map(s =>
          s.id === forSubject.id ? { ...s, lectures: (s.lectures || 0) + 1, updated: 'Just now' } : s
        ),
        lecturesBySubject: { ...prev.lecturesBySubject, [forSubject.id]: [...list, lec] }
      }
    })
    setActiveSubject(forSubject); setActiveLecture(lec); setView('editor')
  }

  const renameLecture = (l) => { setEditLecture({ ...l }); setEditLecOpen(true) }

  const saveLecture = ({ title, date, duration, status }) => {
    if (!activeSubject || !editLecture) return setEditLecOpen(false)
    setState(prev => {
      const list = prev.lecturesBySubject[activeSubject.id] || []
      const next = list.map(x => x.id === editLecture.id ? { ...editLecture, title, date, duration, status } : x)
      return { ...prev, lecturesBySubject: { ...prev.lecturesBySubject, [activeSubject.id]: next } }
    })
    setEditLecOpen(false)
  }

  const deleteLecture = (l) => { setDelLecture(l); setDelLecOpen(true) }

  const confirmDeleteLecture = () => {
    if (!activeSubject || !delLecture) return setDelLecOpen(false)
    setState(prev => {
      const list = prev.lecturesBySubject[activeSubject.id] || []
      const next = list.filter(x => x.id !== delLecture.id)
      return {
        subjects: prev.subjects.map(s =>
          s.id === activeSubject.id ? { ...s, lectures: Math.max(0, (s.lectures || 1) - 1), updated: 'Just now' } : s
        ),
        lecturesBySubject: { ...prev.lecturesBySubject, [activeSubject.id]: next },
      }
    })
    setDelLecOpen(false); setDelLecture(null)
  }

  const updateLectureFromEditor = (updated) => {
    if (!activeSubject || !updated) return
    setState(prev => {
      const list = prev.lecturesBySubject[activeSubject.id] || []
      const next = list.map(x => x.id === updated.id ? updated : x)
      return { ...prev, lecturesBySubject: { ...prev.lecturesBySubject, [activeSubject.id]: next } }
    })
    setActiveLecture(updated)
  }

  return (
    // Full-window app shell
    <div className="h-screen w-screen flex flex-col bg-surface-subtle text-gray-900">
      {/* Two-pane layout: Sidebar | Content */}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden grid grid-cols-[auto,1fr]">
        {/* Sidebar column (no growth, own scroll if needed) */}
        <aside className="shrink-0 overflow-auto">
          <Sidebar
            collapsed={collapsed}
            onToggle={setCollapsed}
            subjects={subjectsForSidebar}
            activeSubjectId={activeSubject?.id}
            activeLectureId={activeLecture?.id}
            onSelectHome={goHome}
            onOpenStorage={() => setView('subjects')}
            onOpenSchedule={() => setView('timetable')}
            onSelectSubject={(s) => openSubject(s)}
            onSelectLecture={(s, l) => { setActiveSubject(s); setActiveLecture(l); setView('editor') }}
            onCreateSubject={openCreateSubject}
            onCreateLecture={(s) => openCreateLecture(s)}
          />
        </aside>

        {/* Content column (flex + internal scrolling) */}
        <main className="min-w-0 min-h-0 overflow-hidden flex flex-col">
          {/* View container gets the scroll, not the whole window */}
          <div className="flex-1 min-h-0 min-w-0 overflow-auto">
            {view === 'home' && (
              <HomeView
                onCreateSubject={openCreateSubject}
                onCreateLectureFirst={() => openCreateLecture(subjects[0])}
              />
            )}

            {view === 'subjects' && (
              <SubjectsView
                subjects={subjects}
                onOpen={(s) => openSubject(s)}
                onCreate={openCreateSubject}
                onRename={(s) => { setEditSubject(s); setEditSubOpen(true) }}
                onDelete={(s) => { setDelSubject(s); setDelSubOpen(true) }}
              />
            )}

            {view === 'lectures' && activeSubject && (
              <LecturesView
                subject={activeSubject}
                lectures={lecturesBySubject[activeSubject.id] || []}
                onBack={() => { setView('subjects'); setActiveSubject(null) }}
                onCreate={() => openCreateLecture(activeSubject)}
                onRename={renameLecture}
                onDelete={deleteLecture}
                onOpenEditor={(l) => { setActiveLecture(l); setView('editor') }}
              />
            )}

            {view === 'editor' && activeSubject && activeLecture && (
              <EditorView
                subject={activeSubject}
                lecture={activeLecture}
                onBack={() => { setView('lectures'); setActiveLecture(null) }}
                onUpdateLecture={updateLectureFromEditor}
                engineUrl="http://127.0.0.1:7861"
                onWantSidebarCollapsed={setCollapsed}
              />
            )}

            {view === 'timetable' && (
              <TimetableView onBack={() => setView('home')} />
            )}
          </div>
        </main>
      </div>

      {/* Modals */}
      <EditSubjectModal
        open={editSubOpen}
        initial={editSubject}
        onClose={() => setEditSubOpen(false)}
        onSave={saveSubject}
      />

      <ConfirmModal
        open={delSubOpen}
        title="Delete subject?"
        message={delSubject ? `«${delSubject.name}» and all related lectures will be deleted (locally).` : ''}
        confirmText="Delete subject"
        onCancel={() => setDelSubOpen(false)}
        onConfirm={confirmDeleteSubject}
      />

      <EditLectureModal
        open={editLecOpen}
        initial={editLecture}
        onClose={() => setEditLecOpen(false)}
        onSave={saveLecture}
      />

      <ConfirmModal
        open={delLecOpen}
        title="Delete lecture?"
        message={delLecture ? `«${delLecture.title}» will be deleted (locally).` : ''}
        confirmText="Delete lecture"
        onCancel={() => setDelLecOpen(false)}
        onConfirm={confirmDeleteLecture}
      />
    </div>
  )
}
