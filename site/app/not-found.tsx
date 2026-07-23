import Link from "next/link";

export default function NotFound() {
  return (
    <main className="app-state-page">
      <section className="app-state-card">
        <span className="app-state-kicker">Security unavailable</span>
        <h1>We couldn’t find that listing.</h1>
        <p>
          Check the exchange and ticker, or return to the opportunity finder to
          browse the supported market universe.
        </p>
        <Link className="app-state-button" href="/value-opportunities">
          Explore value opportunities
        </Link>
      </section>
    </main>
  );
}
