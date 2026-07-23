export default function Loading() {
  return (
    <main className="app-state-page" aria-busy="true" aria-label="Loading">
      <div className="app-state-card app-state-skeleton">
        <span className="app-state-kicker">Value Investment</span>
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line" />
        <div className="skeleton-line skeleton-short" />
      </div>
    </main>
  );
}
