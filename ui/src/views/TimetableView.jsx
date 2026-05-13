// ui/src/views/TimetableView.jsx
import React, { useEffect, useMemo, useState } from "react";
import { format, startOfWeek, addWeeks } from "date-fns";
import { enUS } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Calendar as CalendarIcon,
  Clock,
  Download,
  Upload,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  ChevronDown,
  Filter,
} from "lucide-react";
import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------
// Lightweight UI primitives (inline)
// ---------------------------------------------
function UIButton({ variant = "default", size = "md", className = "", ...props }) {
  const base =
    "inline-flex items-center justify-center rounded-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50";
  const sizes = { icon: "p-2", sm: "px-2.5 py-1.5 text-sm", md: "px-3 py-2", lg: "px-4 py-2.5" };
  const variants = {
    default: "bg-slate-900 text-white hover:bg-slate-800",
    outline: "border border-slate-200 bg-white hover:bg-slate-50",
    ghost: "hover:bg-slate-100",
    secondary: "bg-slate-100 hover:bg-slate-200",
    destructive: "bg-rose-600 text-white hover:bg-rose-700",
  };
  return (
    <button
      className={`${base} ${sizes[size] || sizes.md} ${variants[variant] || variants.default} ${className}`}
      {...props}
    />
  );
}
function Input(props) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border bg-white px-3 py-2 text-sm ${props.className || ""}`}
    />
  );
}
function Label({ className = "", ...props }) {
  return <label className={`text-sm text-slate-700 ${className}`} {...props} />;
}
function Card({ className = "", ...props }) {
  return <div className={`rounded-2xl border ${className}`} {...props} />;
}
function CardHeader({ className = "", ...props }) {
  return <div className={`px-4 pt-4 ${className}`} {...props} />;
}
function CardContent({ className = "", ...props }) {
  return <div className={`px-4 pb-4 ${className}`} {...props} />;
}
function CardTitle({ className = "", ...props }) {
  return <div className={`font-medium ${className}`} {...props} />;
}
function Switch({ id, checked, onCheckedChange }) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={!!checked}
      onClick={() => onCheckedChange(!checked)}
      className={`h-6 w-10 rounded-full transition relative ${checked ? "bg-slate-900" : "bg-slate-300"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
          checked ? "left-5" : "left-0.5"
        }`}
      />
    </button>
  );
}
function Modal({ open, onClose, children }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/30" onClick={onClose} />
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 10, opacity: 0 }}
            className="absolute inset-x-0 top-14 mx-auto w-full max-w-xl rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 overflow-hidden"
          >
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ---------------------------------------------
// Lightweight Dialog (shadcn-like markup)
// ---------------------------------------------
function Dialog({ open, onOpenChange, children }) {
  return <Modal open={open} onClose={() => onOpenChange && onOpenChange(false)}>{children}</Modal>;
}
function DialogContent({ className = "", children }) {
  return <div className={`rounded-2xl sm:max-w-xl w-full bg-white ${className}`}>{children}</div>;
}
function DialogHeader({ className = "", children }) {
  return <div className={("px-4 pt-4 " + (className || "")).trim()}>{children}</div>;
}
function DialogTitle({ children }) {
  return <div className="text-lg font-semibold">{children}</div>;
}
function DialogFooter({ className = "", children }) {
  return <div className={("px-4 pb-4 pt-2 flex items-center gap-2 " + (className || "")).trim()}>{children}</div>;
}

// ---------------------------------------------
// App store glue
// ---------------------------------------------
import { loadState, saveState } from "../lib/store";

// -------------------------------------------------
// TimetableView — MERGE (JS/JSX without types)
// • System logic (shared subjects store, local lessons)
// • Full visuals — from the shadcn/framer variant
// -------------------------------------------------

// ---------- Constants & utils ----------
const TT_STORAGE_KEY = "sova:timetable:v1";
const NOTES_STORAGE_KEY = "sova:timetable:notes";

const DAYS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6];
const TODAY_IDX = (new Date().getDay() + 6) % 7; // 0=Mon

const HALF_HOURS = Array.from({ length: 29 }, (_, i) => 6 * 60 + i * 30); // 06:00..20:00

function parseHHMM(s) {
  const [h, m] = String(s || "").split(":").map((n) => +n || 0);
  return h * 60 + m;
}
function clampTime(str) {
  const [h, m] = String(str || "00:00").split(":").map(Number);
  const hh = Math.min(23, Math.max(0, h || 0));
  const mm = Math.min(59, Math.max(0, m || 0));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
function useLocalStorage(key, initial) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);
  return [state, setState];
}

// ---------- Colors ----------
const COLOR_MAP = {
  blue: { token: "bg-blue-500", soft: "bg-blue-50", ring: "ring-blue-300", text: "text-blue-800" },
  indigo: { token: "bg-indigo-500", soft: "bg-indigo-50", ring: "ring-indigo-300", text: "text-indigo-800" },
  violet: { token: "bg-violet-500", soft: "bg-violet-50", ring: "ring-violet-300", text: "text-violet-800" },
  emerald: { token: "bg-emerald-500", soft: "bg-emerald-50", ring: "ring-emerald-300", text: "text-emerald-800" },
  teal: { token: "bg-teal-500", soft: "bg-teal-50", ring: "ring-teal-300", text: "text-teal-800" },
  amber: { token: "bg-amber-500", soft: "bg-amber-50", ring: "ring-amber-300", text: "text-amber-900" },
  rose: { token: "bg-rose-500", soft: "bg-rose-50", ring: "ring-rose-300", text: "text-rose-800" },
};

// ---------- Store helpers ----------
function readSubjectsFromStore() {
  const st = loadState();
  return Array.isArray(st.subjects) ? st.subjects : [];
}
function writeSubjectsToStore(next) {
  const st = loadState();
  saveState({ ...st, subjects: next });
}
function subjectById(subjects, id) {
  return subjects.find((s) => s.id === id);
}
function subjectColor(subject) {
  return COLOR_MAP[subject?.colorId || "blue"] || COLOR_MAP.blue;
}

// ---------------------------------------------
// UI atoms
// ---------------------------------------------
function SubjectBadge({ subj, className = "" }) {
  const c = subjectColor(subj);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium shadow-sm ring-1 ${c.soft} ${c.text} ${c.ring} ${className}`}
    >
      <span className="select-none">{subj?.emoji || "📘"}</span>
      <span className="truncate max-w-[160px]">{subj?.name || "Untitled"}</span>
    </span>
  );
}

function Drawer({ open, title, children, onClose }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/25" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl rounded-l-2xl overflow-hidden"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="text-sm font-medium">{title}</div>
              <button className="rounded-full p-1 hover:bg-gray-100" onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="h-[calc(100%-56px)] overflow-auto p-4">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------
// Forms
// ---------------------------------------------
function ColorPicker({ value, onChange }) {
  return (
    <div className="grid grid-cols-7 gap-2">
      {Object.keys(COLOR_MAP).map((id) => {
        const c = COLOR_MAP[id];
        const active = id === value;
        return (
          <button
            key={id}
            type="button"
            title={id}
            className={`h-8 rounded-lg ${c.token} ${active ? "ring-2 ring-offset-2 ring-black/60" : ""}`}
            onClick={() => onChange(id)}
            aria-pressed={active}
          />
        );
      })}
    </div>
  );
}

function SubjectForm({ subjects, initial, onSave, onDelete }) {
  const [name, setName] = useState(initial?.name || "");
  const [emoji, setEmoji] = useState(initial?.emoji || "📘");
  const [colorId, setColorId] = useState(initial?.colorId || "blue");
  const [err, setErr] = useState("");

  useEffect(() => {
    setErr("");
  }, [name]);

  function submit(e) {
    e.preventDefault();
    const n = name.trim();
    if (!n) {
      setErr("Provide subject name");
      return;
    }
    const dupe = subjects.some(
      (s) => s.id !== initial?.id && s.name.trim().toLowerCase() === n.toLowerCase()
    );
    if (dupe) {
      setErr("This subject already exists");
      return;
    }
    onSave({ name: n, emoji, colorId });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid grid-cols-[6rem,1fr] gap-3 items-center">
        <Label className="text-xs text-gray-600">Emoji</Label>
        <Input value={emoji} onChange={(e) => setEmoji(e.target.value.slice(0, 2))} className="w-24" />
      </div>
      <div>
        <Label className="block text-xs text-gray-600 mb-1">Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, History" />
      </div>
      <div>
        <Label className="block text-xs text-gray-600 mb-1">Color</Label>
        <ColorPicker value={colorId} onChange={setColorId} />
      </div>
      {err && <div className="text-xs text-red-600">{err}</div>}
      <div className="flex gap-2 pt-2">
        <UIButton type="submit" className="w-full">
          Save
        </UIButton>
        {onDelete && (
          <UIButton type="button" variant="destructive" className="w-32" onClick={onDelete}>
            Delete
          </UIButton>
        )}
      </div>
    </form>
  );
}

function LessonForm({ subjects, initial, onSave, onDelete }) {
  const sortedSubjects = useMemo(
    () => [...subjects].sort((a, b) => a.name.localeCompare(b.name, "en")),
    [subjects]
  );

  const [subjectId, setSubjectId] = useState(initial?.subjectId || sortedSubjects[0]?.id || "");
  const [title, setTitle] = useState(initial?.title || "");
  const [day, setDay] = useState(initial?.day ?? TODAY_IDX);
  const [start, setStart] = useState(initial?.start || "08:00");
  const [end, setEnd] = useState(initial?.end || "09:30");
  const [place, setPlace] = useState(initial?.place || "");
  const [note, setNote] = useState(initial?.note || "");

  const hasSubjects = sortedSubjects.length > 0;
  const validTime = parseHHMM(end) > parseHHMM(start);
  const valid = hasSubjects && subjectId && validTime;

  function submit(e) {
    e.preventDefault();
    if (!valid) return;
    onSave({
      subjectId,
      title,
      day: +day,
      start: clampTime(start),
      end: clampTime(end),
      place,
      note,
    });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div>
        <Label className="block text-xs text-gray-600 mb-1">Subject</Label>
        <div className="relative">
          <select
            className="w-full appearance-none rounded-lg border bg-white px-3 py-2 pr-9"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            disabled={!hasSubjects}
          >
            {hasSubjects ? (
              sortedSubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.emoji} {s.name}
                </option>
              ))
            ) : (
              <option>Create a subject first</option>
            )}
          </select>
          <ChevronDown
            size={16}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="block text-xs text-gray-600 mb-1">Day</Label>
          <select
            className="w-full rounded-lg border bg-white px-2 py-1"
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
          >
            {DAY_INDEXES.map((i) => (
              <option key={i} value={i}>
                {DAYS_EN[i]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="block text-xs text-gray-600 mb-1">Lesson name (optional)</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lecture / Seminar" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="block text-xs text-gray-600 mb-1">Start</Label>
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <Label className="block text-xs text-gray-600 mb-1">End</Label>
          <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="block text-xs text-gray-600 mb-1">Room</Label>
          <Input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Room 210" />
        </div>
        <div>
          <Label className="block text-xs text-gray-600 mb-1">Note</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notes/reminder" />
        </div>
      </div>
      {!validTime && <div className="text-xs text-red-600">Check time: end must be after start.</div>}
      {!hasSubjects && <div className="text-xs text-amber-600">Create at least one subject first.</div>}
      <div className="flex gap-2 pt-2">
        <UIButton type="submit" className="w-full" disabled={!valid}>
          Save
        </UIButton>
        {onDelete && (
          <UIButton type="button" variant="destructive" className="w-32" onClick={onDelete}>
            Delete
          </UIButton>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------
// Grid / Cards
// ---------------------------------------------
function LessonCard({ lesson, subject, compact = false, onClick }) {
  const c = subjectColor(subject);
  return (
    <button
      className={`group relative w-full text-left rounded-xl ${c.soft} ${c.text} ring-1 ${c.ring} hover:shadow-sm`}
      onClick={onClick}
      title={`${subject?.name || ""} • ${lesson.start}–${lesson.end}`}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-xl opacity-90" style={{ background: "currentColor" }} />
      <div className={`px-3 ${compact ? "py-1.5" : "py-2"}`}>
        <div className="text-xs text-slate-500 tabular-nums">
          {lesson.start}–{lesson.end}
        </div>
        <div className={`font-medium truncate flex items-center gap-2 ${c.text}`}>
          <span className={`inline-block size-2.5 rounded-full ${c.token}`}></span>
          <span className="select-none">{subject?.emoji || "📘"}</span>
          <span className="truncate">
            {subject?.name || "Subject"}
            {lesson.title ? ` — ${lesson.title}` : ""}
          </span>
        </div>
        {(lesson.place || lesson.note) && (
          <div className="text-xs text-slate-500 line-clamp-2 mt-1">
            {lesson.place ? `Room: ${lesson.place}` : null}
            {lesson.place && lesson.note ? " • " : ""}
            {lesson.note || ""}
          </div>
        )}
      </div>
    </button>
  );
}

function WeekGrid({ lessons, subjects, compact, onOpen }) {
  const MINUTES_START = 6 * 60,
    MINUTES_END = 20 * 60; // 06:00..20:00

  const byDay = useMemo(() => {
    const map = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    for (const l of lessons || []) map[l.day || 0].push(l);
    for (const k in map) map[k].sort((a, b) => parseHHMM(a.start) - parseHHMM(b.start));
    return map;
  }, [lessons]);

  return (
    <div className={`rounded-2xl border border-slate-200 overflow-hidden ${compact ? "text-[13px]" : "text-sm"}`}>
      {/* Headers */}
      <div className="grid" style={{ gridTemplateColumns: "80px repeat(7, minmax(0, 1fr))" }}>
        <div className="bg-slate-50/60 border-b border-slate-200 px-3 py-2 text-slate-400">Time</div>
        {DAY_INDEXES.map((i) => (
          <div key={i} className="bg-slate-50/60 border-b border-slate-200 px-3 py-2 font-medium">
            <span className={`${i === TODAY_IDX ? "text-blue-700" : ""}`}>{DAYS_EN[i]}</span>
          </div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "80px repeat(7, minmax(0, 1fr))" }}>
        {/* time column */}
        <div className="relative">
          <div className="grid" style={{ gridTemplateRows: `repeat(${HALF_HOURS.length}, 36px)` }}>
            {HALF_HOURS.map((m, idx) => (
              <div
                key={m}
                className={`border-b border-slate-100 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}
              >
                {idx % 2 === 0 && (
                  <div className="sticky left-0 h-full px-3 py-2 text-xs text-slate-400 tabular-nums">
                    {String(Math.floor(m / 60)).padStart(2, "0")}:00
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 7 day columns */}
        {DAY_INDEXES.map((day) => (
          <div key={day} className="relative">
            <div className="grid" style={{ gridTemplateRows: `repeat(${HALF_HOURS.length}, 36px)` }}>
              {HALF_HOURS.map((m, idx) => (
                <div
                  key={m}
                  className={`border-b border-slate-100 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}
                ></div>
              ))}
            </div>

            {/* Lessons layer */}
            <div className="absolute inset-0 p-1">
              <AnimatePresence>
                {byDay[day].map((l) => {
                  const rowStart = Math.max(1, Math.round((parseHHMM(l.start) - MINUTES_START) / 30) + 1);
                  const rowEnd = Math.max(
                    rowStart + 1,
                    Math.round((parseHHMM(l.end) - MINUTES_START) / 30) + 1
                  );
                  const subj = subjectById(subjects, l.subjectId);
                  return (
                    <motion.button
                      key={l.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      onClick={() => onOpen(l)}
                      className="w-full"
                      style={{
                        gridRowStart: rowStart,
                        gridRowEnd: rowEnd,
                        position: "absolute",
                        top: (rowStart - 1) * 36 + 4,
                        height: (rowEnd - rowStart) * 36 - 8,
                        left: 6,
                        right: 6,
                      }}
                    >
                      <LessonCard lesson={l} subject={subj} compact={compact} onClick={() => onOpen(l)} />
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SubjectsStrip({ subjects, onCreate, onEdit, onFilter, activeFilter }) {
  const sorted = useMemo(() => [...subjects].sort((a, b) => a.name.localeCompare(b.name, "en")), [subjects]);
  return (
    <div className="rounded-2xl ring-1 ring-gray-200 p-3 bg-white">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 text-sm font-medium">
          <Filter size={16} className="text-gray-500" /> Subjects
        </div>
        <UIButton variant="outline" onClick={onCreate}>
          Manage subjects
        </UIButton>
      </div>
      {sorted.length === 0 ? (
        <div className="text-xs text-gray-500">No subjects yet. Create a subject, then add lessons.</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <UIButton
            variant="secondary"
            className={`${!activeFilter ? "font-semibold" : "opacity-70 hover:opacity-100"}`}
            onClick={() => onFilter(null)}
          >
            All
          </UIButton>
          {sorted.map((s) => (
            <button
              key={s.id}
              className="hover:opacity-90"
              onClick={() => onEdit(s)}
              onDoubleClick={() => onFilter(s.id)}
              title="Double-click — filter by subject"
            >
              <SubjectBadge subj={s} className={activeFilter === s.id ? "ring-2 ring-blue-500/60" : ""} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------
// Notes panel
// ---------------------------------------------
function NotesPanel() {
  const [notes, setNotes] = useLocalStorage(NOTES_STORAGE_KEY, "");
  return (
    <div className="rounded-xl border p-3 focus-within:ring-2 focus-within:ring-slate-200">
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Quick notes (Markdown-friendly)"
        rows={8}
        className="w-full resize-y outline-none text-sm"
      />
    </div>
  );
}

// ---------------------------------------------
// Main
// ---------------------------------------------
export default function TimetableView() {
  // subjects from shared store
  const [subjects, setSubjects] = useState(() => readSubjectsFromStore());
  // timetable (local)
  const [timetable, setTimetable] = useLocalStorage(TT_STORAGE_KEY, []);

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [search, setSearch] = useState("");
  const [compact, setCompact] = useState(false);
  const [filterSubj, setFilterSubj] = useState(null);

  // Drawer/Dialogs
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState("lesson"); // 'lesson' | 'subject'
  const [editingLesson, setEditingLesson] = useState(null);
  const [editingSubject, setEditingSubject] = useState(null);
  const [lessonDialogOpen, setLessonDialogOpen] = useState(false);

  // sync subjects → shared store
  useEffect(() => {
    writeSubjectsToStore(subjects);
  }, [subjects]);

  // filtered lessons
  const visibleLessons = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = filterSubj ? timetable.filter((l) => l.subjectId === filterSubj) : timetable;
    return base.filter(
      (l) =>
        !q ||
        (l.title || "").toLowerCase().includes(q) ||
        (l.place || "").toLowerCase().includes(q) ||
        (subjectById(subjects, l.subjectId)?.name || "").toLowerCase().includes(q)
    );
  }, [timetable, filterSubj, search, subjects]);

  // subject actions
  function openManageSubjects() {
    setDrawerMode("subject");
    setEditingSubject({ id: "subj-" + uuidv4(), name: "", emoji: "📘", colorId: "blue" });
    setDrawerOpen(true);
  }
  function openEditSubject(subj) {
    setDrawerMode("subject");
    setEditingSubject(subj);
    setDrawerOpen(true);
  }
  function saveSubject(payload) {
    const initial = editingSubject;
    const exists = subjects.some((s) => s.id === initial.id);
    const next = exists
      ? subjects.map((s) => (s.id === initial.id ? { ...s, ...payload } : s))
      : [...subjects, { ...initial, ...payload }];
    setSubjects(next);
    setDrawerOpen(false);
  }
  function deleteSubject() {
    const id = editingSubject?.id;
    if (!id) return;
    setTimetable((prev) => prev.filter((l) => l.subjectId !== id));
    setSubjects((prev) => prev.filter((s) => s.id !== id));
    if (filterSubj === id) setFilterSubj(null);
    setDrawerOpen(false);
  }

  // lesson actions
  function openCreateLesson() {
    if (subjects.length === 0) {
      openManageSubjects();
      return;
    }
    const first = subjects[0]?.id || "";
    setEditingLesson({
      id: "les-" + uuidv4(),
      subjectId: first,
      day: TODAY_IDX,
      start: "08:00",
      end: "09:30",
      title: "",
      place: "",
      note: "",
    });
    setLessonDialogOpen(true);
  }
  function openEditLesson(lesson) {
    setEditingLesson(lesson);
    setLessonDialogOpen(true);
  }
  function saveLesson(payload) {
    const initial = editingLesson;
    const exists = timetable.some((l) => l.id === initial.id);
    const next = exists
      ? timetable.map((l) => (l.id === initial.id ? { ...l, ...payload } : l))
      : [...timetable, { ...initial, ...payload }];
    setTimetable(next);
    setLessonDialogOpen(false);
    setEditingLesson(null);
  }
  function deleteLesson() {
    const id = editingLesson?.id;
    if (!id) return;
    setTimetable((prev) => prev.filter((l) => l.id !== id));
    setLessonDialogOpen(false);
    setEditingLesson(null);
  }

  // export / import
  function exportJSON() {
    const blob = new Blob([JSON.stringify(timetable, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timetable-${format(new Date(), "yyyyMMdd-HHmm")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) || [];
        if (!Array.isArray(data)) throw new Error("Invalid file");
        const cleaned = data.map((d) => ({
          ...d,
          id: d.id ?? "les-" + uuidv4(),
          subjectId: d.subjectId,
          day: typeof d.day === "number" && d.day >= 0 && d.day <= 6 ? d.day : 0,
          start: clampTime(d.start ?? "09:00"),
          end: clampTime(d.end ?? "10:00"),
          title: d.title || "",
          place: d.place || "",
          note: d.note || "",
        }));
        setTimetable(cleaned);
      } catch {
        alert("Failed to import JSON");
      }
    };
    reader.readAsText(file);
  }

  const isExistingLesson = !!(editingLesson && timetable.some((l) => l.id === editingLesson.id));
  const isExistingSubject = !!(editingSubject && subjects.some((s) => s.id === editingSubject.id));

  return (
    <div className="h-full w-full min-w-0 min-h-0 overflow-hidden flex flex-col bg-white text-slate-900 antialiased">
      {/* Top Nav */}
      <header className="sticky top-0 z-30 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-b border-slate-200">
        <div className="w-full px-4 py-3 flex items-center gap-2">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-xl bg-slate-900 text-white grid place-items-center">🗓️</div>
            <span className="font-semibold tracking-[-0.02em]">Timetable</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <UIButton variant="ghost" size="icon" onClick={() => setWeekStart(addWeeks(weekStart, -1))}>
              <ChevronLeft className="size-4" />
            </UIButton>
            <div className="px-3 py-1 rounded-xl border text-sm flex items-center gap-2">
              <CalendarIcon className="size-4" />
              <span className="tabular-nums">
                {format(weekStart, "d MMM", { locale: enUS })} –{" "}
                {format(addWeeks(weekStart, 1), "d MMM yyyy", { locale: enUS })}
              </span>
            </div>
            <UIButton variant="ghost" size="icon" onClick={() => setWeekStart(addWeeks(weekStart, 1))}>
              <ChevronRight className="size-4" />
            </UIButton>

            <div className="relative">
              <Search className="size-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className="pl-8 w-40 md:w-64"
              />
            </div>

            <div className="flex items-center gap-2 px-2">
              <Label htmlFor="compact" className="text-sm text-slate-600">
                Compact
              </Label>
              <Switch id="compact" checked={compact} onCheckedChange={setCompact} />
            </div>

            <UIButton onClick={exportJSON} variant="ghost">
              <Download className="size-4 mr-2" />
              Export
            </UIButton>

            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer hover:bg-slate-50">
              <Upload className="size-4" />
              <span className="text-sm">Import</span>
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => e.target.files && importJSON(e.target.files[0])}
              />
            </label>

            <UIButton variant="outline" onClick={openManageSubjects}>
              Subjects
            </UIButton>

            <UIButton onClick={openCreateLesson} className="rounded-2xl">
              <Plus className="size-4 mr-2" />
              Lesson
            </UIButton>
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="px-3 md:px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0 min-w-0 overflow-hidden">
        {/* Sidebar */}
        <aside className="lg:col-span-3 space-y-4 min-w-0">
          <Card className="rounded-2xl border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Today</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(() => {
                const today = visibleLessons
                  .filter((l) => l.day === TODAY_IDX)
                  .sort((a, b) => parseHHMM(a.start) - parseHHMM(b.start));
                if (today.length === 0) return <p className="text-sm text-slate-500">No lessons today.</p>;
                return today.map((l) => {
                  const subj = subjectById(subjects, l.subjectId);
                  const c = subjectColor(subj);
                  return (
                    <button
                      key={l.id}
                      onClick={() => openEditLesson(l)}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50 border flex items-center gap-3"
                    >
                      <span className={`size-2.5 rounded-full ${c.token}`}></span>
                      <div className="min-w-0">
                        <div className="text-sm truncate font-medium">
                          {subj?.emoji ? `${subj.emoji} ` : ""}
                          {subj?.name}
                          {l.title ? ` — ${l.title}` : ""}
                        </div>
                        <div className="text-xs text-slate-500 tabular-nums">
                          <Clock className="inline size-3 mr-1" />
                          {l.start}–{l.end}
                          {l.place ? ` • ${l.place}` : ""}
                        </div>
                      </div>
                    </button>
                  );
                });
              })()}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <NotesPanel />
            </CardContent>
          </Card>

          <SubjectsStrip
            subjects={subjects}
            onCreate={openManageSubjects}
            onEdit={openEditSubject}
            onFilter={setFilterSubj}
            activeFilter={filterSubj}
          />
        </aside>

        {/* Week Grid */}
        <section className="lg:col-span-9 min-w-0 min-h-0 overflow-auto">
          <WeekGrid lessons={visibleLessons} subjects={subjects} compact={compact} onOpen={openEditLesson} />
        </section>
      </main>

      <footer className="px-4 pb-8 text-center text-xs text-slate-400">
        Local only; your data stays in the browser.
      </footer>

      {/* Drawer — Subjects */}
      <Drawer
        open={drawerOpen}
        title={drawerMode === "subject" ? (isExistingSubject ? "Subject" : "Add subject") : ""}
        onClose={() => setDrawerOpen(false)}
      >
        {drawerMode === "subject" && editingSubject && (
          <SubjectForm
            subjects={subjects}
            initial={editingSubject}
            onSave={saveSubject}
            onDelete={isExistingSubject ? deleteSubject : undefined}
          />
        )}
      </Drawer>

      {/* Dialog — Lesson Editor */}
      <Dialog
        open={lessonDialogOpen}
        onOpenChange={(o) => {
          setLessonDialogOpen(o);
          if (!o) setEditingLesson(null);
        }}
      >
        <DialogContent className="rounded-2xl sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{isExistingLesson ? "Lesson" : "Add lesson"}</DialogTitle>
          </DialogHeader>
          {editingLesson && (
            <LessonForm
              subjects={subjects}
              initial={editingLesson}
              onSave={saveLesson}
              onDelete={isExistingLesson ? deleteLesson : undefined}
            />
          )}
          <DialogFooter className="justify-end">
            <UIButton
              variant="ghost"
              onClick={() => {
                setLessonDialogOpen(false);
                setEditingLesson(null);
              }}
            >
              Close
            </UIButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
