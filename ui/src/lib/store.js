// ui/src/lib/store.js

// Основной ключ хранилища (единый и стабильный)
const STORAGE_PRIMARY_KEY = 'sova:v1';

// Legacy-ключи (на случай старых версий/названий)
const STORAGE_LEGACY_KEYS = [
  'sova_state',
  'app_state',
  'lectures_state',
  'state', // про запас
];

const defaultState = Object.freeze({
  subjects: [],
  lecturesBySubject: {}, // { [subjectId]: Lecture[] }
});

// Простая валидация/миграция формы
function normalizeState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const subjects = Array.isArray(s.subjects) ? s.subjects : [];
  const lecturesBySubject =
    s.lecturesBySubject && typeof s.lecturesBySubject === 'object'
      ? s.lecturesBySubject
      : {};

  // Мини-миграция полей предметов
  const fixedSubjects = subjects.map((subj) => ({
    id: subj.id || `subj-${Math.random().toString(36).slice(2, 7)}`,
    name: subj.name || 'Untitled',
    emoji: subj.emoji || '📘',
    colorId: subj.colorId || 'blue',
    lectures: typeof subj.lectures === 'number' ? subj.lectures : 0,
    updated: subj.updated || '—',
  }));

  // Мини-миграция массива лекций
  const fixedLecturesBySubject = {};
  for (const [sid, list] of Object.entries(lecturesBySubject)) {
    fixedLecturesBySubject[sid] = Array.isArray(list)
      ? list.map((lec) => ({
          id: lec.id || `lec-${Math.random().toString(36).slice(2, 7)}`,
          title: lec.title || 'Lecture',
          date: lec.date || new Date().toISOString().slice(0, 10),
          duration: lec.duration || '',
          status: lec.status || 'imported',
          docMd: typeof lec.docMd === 'string' ? lec.docMd : '',
          lecType: lec.lecType || 'summary',
          useAudio: 'useAudio' in lec ? !!lec.useAudio : true,
          useVideo: 'useVideo' in lec ? !!lec.useVideo : true,
          useSlides: 'useSlides' in lec ? !!lec.useSlides : true,
          videoUrl: lec.videoUrl || '',
          // прокидываем любые новые поля «как есть»
          ...lec,
        }))
      : [];
  }

  return {
    subjects: fixedSubjects,
    lecturesBySubject: fixedLecturesBySubject,
  };
}

function readFromKey(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch {
    // битый JSON — не падаем
    return null;
  }
}

/**
 * Loads state:
 * 1) tries the main key;
 * 2) if empty — tries legacy keys, migrates and stores in the main key;
 * 3) if nothing found — returns default.
 */
export function loadState() {
  // 1) основной ключ
  const primary = readFromKey(STORAGE_PRIMARY_KEY);
  if (primary) return primary;

  // 2) legacy-ключи
  for (const legacyKey of STORAGE_LEGACY_KEYS) {
    const legacy = readFromKey(legacyKey);
    if (legacy) {
      // мигрируем в основной ключ
      try {
        localStorage.setItem(STORAGE_PRIMARY_KEY, JSON.stringify(legacy));
      } catch { /* ignore quota */ }
      return legacy;
    }
  }

  // 3) по умолчанию
  return { ...defaultState };
}

/**
 * Saves state strictly to the main key.
 * Always wrap in try/catch in case of quota exceeded.
 */
export function saveState(state) {
  const safe = normalizeState(state);
  try {
    localStorage.setItem(STORAGE_PRIMARY_KEY, JSON.stringify(safe));
  } catch {
    // можно добавить всплывашку «закончилась квота localStorage»
  }
}
