import { useMemo, useState } from "react";
import {
  Home, Database, Calendar,
  ChevronLeft, ChevronRight, Plus,
  Bell, HelpCircle, Settings
} from "lucide-react";

/**
 * Compact sidebar SOVA:
 *  - collapsed / onToggle
 *  - subjects: [{ id, name, _lectures? }]
 *  - activeSubjectId / activeLectureId
 *  - onSelectHome, onOpenStorage, onOpenSchedule
 *  - onSelectSubject(s), onSelectLecture(s,l)
 *  - onCreateSubject()
 */
export default function Sidebar({
  collapsed = false,
  onToggle,
  subjects = [],
  activeSubjectId,
  activeLectureId,
  onSelectHome,
  onOpenStorage,
  onOpenSchedule,
  onSelectSubject,
  onSelectLecture,
  onCreateSubject,
}) {
  const [openSubjects, setOpenSubjects] = useState(true);
  const list = useMemo(() => subjects.map(s => ({ ...s, _lectures: s._lectures || [] })), [subjects]);

  const W = collapsed ? "w-16" : "w-64";
  const show = !collapsed;

  return (
    <aside
      className={`${W} shrink-0 self-start sticky top-0 h-screen overflow-y-auto border-r border-surface-border bg-white transition-all duration-200 flex flex-col`}
    >
      {/* Шапка: логотип + кнопка свернуть */}
      <div className="flex items-center justify-between px-2 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-600 text-white text-[10px] font-bold tracking-widest">
            SOVA
          </div>
          {show && <span className="text-[12px] font-semibold tracking-tight text-gray-800">Studio</span>}
        </div>
        <button
          onClick={() => onToggle?.(!collapsed)}
          className="h-8 w-8 rounded-xl border border-surface-border bg-white hover:bg-gray-50 flex items-center justify-center"
          title={collapsed ? "Show panel" : "Hide panel"}
        >
          {collapsed ? <ChevronRight size={16}/> : <ChevronLeft size={16}/>}
        </button>
      </div>

      {/* Top navigation */}
      <div className="px-2 pt-2">
        <NavItem
          icon={<Home size={18} />}
          label="Home"
          collapsed={collapsed}
          active={!activeSubjectId && !activeLectureId}
          onClick={onSelectHome}
        />
        <NavItem
          icon={<Database size={18} />}
          label="Storage"
          collapsed={collapsed}
          onClick={onOpenStorage}
        />
        <NavItem
          icon={<Calendar size={18} />}
          label="Timetable"
          collapsed={collapsed}
          onClick={onOpenSchedule}
        />
      </div>

      {/* SUBJECTS */}
      <div className="mt-4 px-2">
        {/* Заголовок-секция: таким же цветом, кликается для раскрытия; справа + для создания */}
        <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"} px-2`}>
          {!collapsed ? (
            <button
              onClick={() => setOpenSubjects(v => !v)}
              className="py-2 text-[12px] font-semibold text-gray-800 hover:text-primary-700"
              title="Show/hide subjects"
            >
              SUBJECTS
            </button>
          ) : (
            <button
              onClick={() => setOpenSubjects(v => !v)}
              className="h-8 w-8 rounded-lg hover:bg-primary-50 flex items-center justify-center"
              title="Show/hide subjects"
            >
              {/* thin section marker when collapsed */}
              <div className="h-1.5 w-4 rounded bg-gray-300" />
            </button>
          )}
          {!collapsed && (
            <button
              onClick={onCreateSubject}
              className="inline-flex h-7 items-center justify-center rounded-full border border-surface-border bg-white px-2.5 text-xs hover:bg-gray-50"
              title="Create subject"
            >
              <Plus size={14} className="mr-1"/> Subject
            </button>
          )}
        </div>

        {/* Subjects list — only names (no counts) */}
        {openSubjects && (
          <div className={`${collapsed ? "pl-0" : "pl-2"} pr-1`}>
            {list.map(s => (
              <button
                key={s.id}
                onClick={() => onSelectSubject?.(s)}
                className={`flex w-full items-center ${collapsed ? "justify-center" : "justify-start gap-2"} rounded-lg px-2 py-2.5 hover:bg-primary-50 ${
                  s.id === activeSubjectId ? "bg-primary-50 text-primary-800" : "text-gray-800"
                }`}
                title={s.name}
              >
                {/* Avatar with first letter */}
                <LetterAvatar name={s.name} collapsed={collapsed} />
                {!collapsed && <span className="truncate text-[13px]">{s.name}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bottom block (OTHER) — same color as others, with icons */}
      <div className="mt-auto border-t border-surface-border px-2 py-3">
        {!collapsed && (
          <div className="px-2 pb-2 text-[12px] font-semibold text-gray-800">
            OTHER
          </div>
        )}
        <NavItem icon={<Bell size={18} />} label="Notifications" collapsed={collapsed} />
        <NavItem icon={<HelpCircle size={18} />} label="Support" collapsed={collapsed} />
        <NavItem icon={<Settings size={18} />} label="Settings" collapsed={collapsed} />
      </div>
    </aside>
  );
}

/* ===== elements ===== */

function NavItem({ icon, label, onClick, active, collapsed }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center ${collapsed ? "justify-center" : "justify-start gap-2"} rounded-lg px-2 py-2.5 transition ${
        active ? "bg-primary-50 text-primary-800" : "text-gray-800 hover:bg-primary-50"
      }`}
      title={label}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {!collapsed && <span className="truncate text-[13px]">{label}</span>}
    </button>
  );
}

function LetterAvatar({ name = "", collapsed }) {
  const letter = (name.trim()[0] || "?").toUpperCase();
  return (
    <div
      className={`flex h-6 w-6 items-center justify-center rounded-full ${
        collapsed ? "" : "border"
      } border-surface-border bg-white text-[12px] font-semibold text-gray-700`}
    >
      {letter}
    </div>
  );
}
