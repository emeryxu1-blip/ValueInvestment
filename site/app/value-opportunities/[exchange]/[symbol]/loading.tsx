export default function SecurityResearchPanelLoading() {
  return (
    <div
      className="security-research-route-loading"
      aria-busy="true"
      aria-live="polite"
    >
      <span aria-hidden="true" />
      <p>Opening research view…</p>
    </div>
  );
}
