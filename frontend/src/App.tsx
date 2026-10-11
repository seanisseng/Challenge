/**
 * Application shell. The join screen, live challenge board, clue inventory,
 * and admin review console will be built on top of the database layer.
 */
export default function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-bold text-white">Challenge</h1>
      <p className="text-slate-400">
        Real-time competitive scavenger hunt. Join a session, complete photo
        challenges, and unlock tiered clues to reach the final destination.
      </p>
      <span className="rounded-full bg-brand/20 px-4 py-1 text-sm text-brand">
        Database layer ready — UI coming next
      </span>
    </main>
  );
}
