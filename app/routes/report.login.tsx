import { useState, useEffect } from "react";
import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { getReportUser } from "../lib/report-auth.server";

// ── Loader: redirect to dashboard if already logged in ────────────────────────
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getReportUser(request);
  if (user) throw redirect("/apps/submit/report/dashboard");
  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ReportLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shop, setShop] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const shopParam = params.get("shop");
    if (shopParam) setShop(shopParam);

    try {
      if (window.top && window.top !== window.self) {
        window.top.location.href = window.location.href;
        return;
      }
    } catch (e) {
      // cross-origin — already top-level, do nothing
    }
  }

  const t = setTimeout(() => setMounted(true), 50);
  return () => clearTimeout(t);
}, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/apps/submit/api/report-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, shop }),
        redirect: "follow",
      });

      if (res.redirected) {
        window.location.href = res.url;
        return;
      }

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError((json as { error?: string }).error ?? "Login failed. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

        body {
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          background: #0f172a;
          min-height: 100vh;
          overflow: hidden;
        }

        .rl-root {
          min-height: 100vh;
          display: flex;
          background: #0f172a;
          position: relative;
          overflow: hidden;
        }

        /* ── Ambient background ── */
        .rl-bg-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          pointer-events: none;
          z-index: 0;
        }
        .rl-bg-orb-1 {
          width: 600px; height: 600px;
          top: -200px; left: -150px;
          background: radial-gradient(circle, rgba(37,99,235,0.18) 0%, transparent 70%);
        }
        .rl-bg-orb-2 {
          width: 400px; height: 400px;
          bottom: -100px; right: -100px;
          background: radial-gradient(circle, rgba(99,102,241,0.14) 0%, transparent 70%);
        }
        .rl-bg-orb-3 {
          width: 300px; height: 300px;
          top: 40%; left: 50%;
          background: radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 70%);
        }

        /* ── Left panel — brand ── */
        .rl-left {
          display: none;
          flex: 1;
          flex-direction: column;
          justify-content: space-between;
          padding: 48px 52px;
          position: relative;
          z-index: 1;
          border-right: 1px solid rgba(255,255,255,0.06);
        }
        @media (min-width: 900px) {
          .rl-left { display: flex; }
        }

        .rl-brand {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .rl-brand-box {
          width: 36px; height: 36px;
          background: #2563eb;
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          font-size: 16px; font-weight: 800; color: #fff;
          letter-spacing: -0.5px;
          box-shadow: 0 0 0 1px rgba(37,99,235,0.4), 0 4px 12px rgba(37,99,235,0.3);
        }
        .rl-brand-name {
          font-size: 15px; font-weight: 700; color: #f8fafc;
          letter-spacing: -0.3px;
        }
        .rl-brand-sub {
          font-size: 11px; color: #64748b; font-weight: 500;
          letter-spacing: 0.5px; text-transform: uppercase;
        }

        .rl-left-body {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          max-width: 380px;
        }
        .rl-left-eyebrow {
          font-size: 11px; font-weight: 600; color: #2563eb;
          letter-spacing: 1.5px; text-transform: uppercase;
          margin-bottom: 16px;
        }
        .rl-left-heading {
          font-size: 38px; font-weight: 700; color: #f8fafc;
          line-height: 1.15; letter-spacing: -1px;
          margin-bottom: 16px;
        }
        .rl-left-heading em {
          font-style: normal;
          background: linear-gradient(135deg, #3b82f6, #60a5fa);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .rl-left-desc {
          font-size: 14px; color: #94a3b8; line-height: 1.65;
          margin-bottom: 36px;
        }

        .rl-stat-row {
          display: flex; gap: 20px; flex-wrap: wrap;
        }
        .rl-stat {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px;
          padding: 14px 20px;
          min-width: 110px;
        }
        .rl-stat-val {
          font-size: 22px; font-weight: 700; color: #f8fafc;
          letter-spacing: -0.5px;
        }
        .rl-stat-lbl {
          font-size: 11px; color: #64748b; margin-top: 3px; font-weight: 500;
        }

        .rl-left-footer {
          display: flex; align-items: center; gap: 8px;
        }
        .rl-footer-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: #10b981;
          box-shadow: 0 0 8px rgba(16,185,129,0.5);
        }
        .rl-footer-txt {
          font-size: 12px; color: #475569;
        }

        /* ── Right panel — form ── */
        .rl-right {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 100%;
          max-width: 480px;
          margin: 0 auto;
          padding: 32px 24px;
          position: relative;
          z-index: 1;
        }
        @media (min-width: 900px) {
          .rl-right {
            width: 480px;
            flex: none;
            border-left: none;
          }
        }

        .rl-card {
          width: 100%;
          max-width: 400px;
          opacity: 0;
          transform: translateY(16px);
          transition: opacity 0.4s ease, transform 0.4s ease;
        }
        .rl-card.mounted {
          opacity: 1;
          transform: translateY(0);
        }

        /* Mobile-only brand */
        .rl-mobile-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 32px;
          justify-content: center;
        }
        @media (min-width: 900px) { .rl-mobile-brand { display: none; } }

        .rl-card-title {
          font-size: 22px; font-weight: 700; color: #f8fafc;
          letter-spacing: -0.5px;
          margin-bottom: 6px;
        }
        .rl-card-sub {
          font-size: 13px; color: #64748b; margin-bottom: 28px;
        }

        .rl-field {
          margin-bottom: 16px;
        }
        .rl-label {
          display: block;
          font-size: 12px; font-weight: 600; color: #94a3b8;
          letter-spacing: 0.3px;
          margin-bottom: 7px;
        }
        .rl-input-wrap {
          position: relative;
        }
        .rl-input {
          width: 100%;
          padding: 11px 14px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          font-size: 13px; color: #f1f5f9;
          font-family: inherit;
          outline: none;
          transition: border-color 0.2s, background 0.2s;
        }
        .rl-input::placeholder { color: #475569; }
        .rl-input:focus {
          border-color: #2563eb;
          background: rgba(37,99,235,0.06);
        }
        .rl-input.has-toggle { padding-right: 44px; }

        .rl-show-pw {
          position: absolute;
          right: 12px; top: 50%;
          transform: translateY(-50%);
          background: none; border: none; cursor: pointer;
          color: #475569; padding: 4px;
          display: flex; align-items: center;
          transition: color 0.15s;
        }
        .rl-show-pw:hover { color: #94a3b8; }

        .rl-error {
          display: flex; align-items: center; gap: 8px;
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.25);
          border-radius: 8px;
          padding: 10px 12px;
          margin-bottom: 16px;
          font-size: 13px; color: #fca5a5;
        }

        .rl-submit {
          width: 100%;
          padding: 12px;
          background: #2563eb;
          border: none;
          border-radius: 8px;
          font-size: 13px; font-weight: 600; color: #fff;
          font-family: inherit;
          cursor: pointer;
          margin-top: 4px;
          transition: background 0.2s, opacity 0.2s;
          display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .rl-submit:hover:not(:disabled) { background: #1d4ed8; }
        .rl-submit:disabled { opacity: 0.6; cursor: not-allowed; }

        .rl-divider {
          display: flex; align-items: center; gap: 12px;
          margin: 20px 0;
        }
        .rl-divider-line {
          flex: 1; height: 1px;
          background: rgba(255,255,255,0.07);
        }
        .rl-divider-txt {
          font-size: 11px; color: #475569; font-weight: 500;
        }

        .rl-footer-note {
          text-align: center;
          font-size: 12px; color: #475569; margin-top: 20px;
        }
        .rl-footer-note a {
          color: #3b82f6; text-decoration: none;
        }
        .rl-footer-note a:hover { text-decoration: underline; }

        /* spinner */
        @keyframes spin { to { transform: rotate(360deg); } }
        .rl-spinner {
          width: 14px; height: 14px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }

        /* grid lines decoration */
        .rl-grid-deco {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
          background-size: 48px 48px;
          pointer-events: none;
          z-index: 0;
          mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%);
        }
      `}</style>

      <div className="rl-root">
        {/* Ambient orbs */}
        <div className="rl-bg-orb rl-bg-orb-1" />
        <div className="rl-bg-orb rl-bg-orb-2" />
        <div className="rl-bg-orb rl-bg-orb-3" />
        <div className="rl-grid-deco" />

        {/* ── Left Brand Panel ── */}
        <div className="rl-left">
          <div className="rl-brand">
            <div className="rl-brand-box">F</div>
            <div>
              <div className="rl-brand-name">Freight OMS</div>
              <div className="rl-brand-sub">Operations Portal</div>
            </div>
          </div>

          <div className="rl-left-body">
            <div className="rl-left-eyebrow">External Access</div>
            <h1 className="rl-left-heading">
              Manage freight <em>operations</em> in one place
            </h1>
            <p className="rl-left-desc">
              Track line items, update delivery dates, add tracking numbers,
              and communicate with customers — all without needing Shopify admin access.
            </p>
            <div className="rl-stat-row">
              {[
                { val: "Real-time", lbl: "Order sync" },
                { val: "Per-item", lbl: "EDD tracking" },
                { val: "Full", lbl: "Notes history" },
              ].map(({ val, lbl }) => (
                <div className="rl-stat" key={lbl}>
                  <div className="rl-stat-val">{val}</div>
                  <div className="rl-stat-lbl">{lbl}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rl-left-footer">
            <div className="rl-footer-dot" />
            <span className="rl-footer-txt">Systems operational · Freight OMS v1.0</span>
          </div>
        </div>

        {/* ── Right Form Panel ── */}
        <div className="rl-right">
          <div className={`rl-card${mounted ? " mounted" : ""}`}>

            {/* Mobile brand */}
            <div className="rl-mobile-brand">
              <div className="rl-brand-box">F</div>
              <div>
                <div className="rl-brand-name">Freight OMS</div>
                <div className="rl-brand-sub">Operations Portal</div>
              </div>
            </div>

            <div className="rl-card-title">Sign in to your account</div>
            <div className="rl-card-sub">Enter your credentials to access the dashboard</div>

            {error && (
              <div className="rl-error">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="rl-field">
                <label className="rl-label" htmlFor="email">Email address</label>
                <div className="rl-input-wrap">
                  <input
                    id="email"
                    type="email"
                    className="rl-input"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="rl-field">
                <label className="rl-label" htmlFor="password">Password</label>
                <div className="rl-input-wrap">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    className="rl-input has-toggle"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="rl-show-pw"
                    onClick={() => setShowPassword((p) => !p)}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <button type="submit" className="rl-submit" disabled={loading}>
                {loading ? (
                  <>
                    <div className="rl-spinner" />
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign in
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                    </svg>
                  </>
                )}
              </button>
            </form>

            <div className="rl-divider">
              <div className="rl-divider-line" />
              <span className="rl-divider-txt">Secured access</span>
              <div className="rl-divider-line" />
            </div>

            <div className="rl-footer-note">
              No account? Contact your administrator to get access.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}