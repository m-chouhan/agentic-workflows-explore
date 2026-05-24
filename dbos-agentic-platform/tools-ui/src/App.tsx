import { useState } from "react";
import SalesAnalysis from "./components/SalesAnalysis";
import VulnScanner from "./components/VulnScanner";
import "./App.css";

type Tab = "sales" | "vuln";

export default function App() {
  const [tab, setTab] = useState<Tab>("sales");

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
        <div className="tabs">
          <button
            className={`tab-btn ${tab === "sales" ? "active" : ""}`}
            onClick={() => setTab("sales")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22,7 13.5,15.5 8.5,10.5 2,17" />
              <polyline points="16,7 22,7 22,13" />
            </svg>
            Sales Analysis
          </button>
          <button
            className={`tab-btn ${tab === "vuln" ? "active" : ""}`}
            onClick={() => setTab("vuln")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            PR / Security Scanner
          </button>
        </div>

        <div className="tab-content">
          {tab === "sales" ? <SalesAnalysis /> : <VulnScanner />}
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
