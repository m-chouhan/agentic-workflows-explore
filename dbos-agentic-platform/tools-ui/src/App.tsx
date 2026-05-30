import VulnScanner from "./components/VulnScanner";
import "./App.css";

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="logo">
            <div className="logo-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <div>
              <span className="logo-text">AI Agent Tools</span>
              <span className="logo-sub">DBOS + Gemini · Local</span>
            </div>
          </div>
          <div className="header-meta">
            <span className="badge-dbos">DBOS</span>
            <span className="badge-gemini">Gemini 2.5</span>
          </div>
        </div>
      </header>

      <main className="app-main">
        <div className="tab-content">
          <VulnScanner />
        </div>

        <footer className="app-footer">
          <p>
            Powered by{" "}
            <a href="https://dbos.dev" target="_blank" rel="noreferrer">DBOS</a>
            {" "}durable workflows ·{" "}
            <a href="https://deepmind.google/technologies/gemini/" target="_blank" rel="noreferrer">Gemini 2.5 Flash</a>
            {" "}· Trivy · Local Docker stack
          </p>
        </footer>
      </main>
    </div>
  );
}
