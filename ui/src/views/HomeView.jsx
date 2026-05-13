export default function HomeView({ onCreateSubject, onCreateLectureFirst }) {
  return (
    <div className="mx-auto max-w-4xl px-6 py-14">
      <div className="mx-auto max-w-xl text-center">
        <div className="mb-2 text-4xl">🦉</div>
        <h1 className="text-3xl font-semibold">Welcome to SOVA</h1>
        <p className="mt-2 text-sm text-gray-600">
          Create subjects, upload audio/video/slides — and get neatly organized summaries.
        </p>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <button
          onClick={onCreateSubject}
          className="rounded-2xl border p-6 text-left hover:shadow"
        >
          <div className="text-2xl">📁</div>
          <div className="mt-2 text-lg font-medium">Create first subject</div>
          <div className="text-sm text-gray-600">Name, icon, color — everything is customizable.</div>
        </button>

        <button
          onClick={onCreateLectureFirst}
          className="rounded-2xl border p-6 text-left hover:shadow"
        >
          <div className="text-2xl">📝</div>
          <div className="mt-2 text-lg font-medium">Create first lecture</div>
          <div className="text-sm text-gray-600">We will create a temporary subject and open the editor.</div>
        </button>
      </div>
    </div>
  );
}
