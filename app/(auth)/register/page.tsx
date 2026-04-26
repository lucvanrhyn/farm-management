"use client";

import { useState } from "react";
import Link from "next/link";
import { clientLogger } from "@/lib/client-logger";

// framer-motion removed for bundle-budget compliance — see P5 perf
// work. CSS-based fade/rise-in is defined in app/globals.css as
// `.auth-rise-in` and `.auth-pop-in`.

export default function RegisterPage() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    username: "",
    password: "",
    confirmPassword: "",
    farmName: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          username: form.username,
          password: form.password,
          farmName: form.farmName,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Registration failed.");
      } else {
        // Anti-enumeration contract: the backend returns an identical shape
        // (`{success:true, pending:true}`) whether the email was new or
        // already registered. Always show the "Check your email" screen —
        // it's the right UX in both cases (new signup → click verify link;
        // duplicate signup → user gets no new mail, but can retry login).
        setSuccess(true);
      }
    } catch (err) {
      clientLogger.error("[register] submit failed", { err });
      setError("Network error. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: "rgba(15,9,3,0.70)",
    border: "1px solid rgba(140,100,60,0.25)",
    borderRadius: "10px",
    padding: "0.625rem 0.875rem",
    color: "#F0DEB8",
    fontFamily: "var(--font-sans)",
    fontSize: "0.9375rem",
    outline: "none",
    width: "100%",
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: "var(--font-sans)",
    color: "#8A6840",
    fontSize: "0.75rem",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  };

  if (success) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-5"
        style={{ background: "#1A1510" }}
      >
        <div
          className="w-full max-w-sm px-8 py-10 flex flex-col items-center gap-6 auth-pop-in"
          style={{
            borderRadius: "2rem",
            background: "#241C14",
            border: "1px solid rgba(196,144,48,0.18)",
            boxShadow: "0 0 48px rgba(196,144,48,0.06), 0 8px 40px rgba(0,0,0,0.55)",
          }}
        >
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              background: "rgba(74,124,89,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4A7C59" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
          </div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              color: "#F0DEB8",
              fontSize: "1.5rem",
              fontWeight: 700,
            }}
          >
            Check Your Email
          </h1>
          <p
            style={{
              color: "#8A6840",
              fontFamily: "var(--font-sans)",
              fontSize: "0.875rem",
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            We sent a verification link to <strong style={{ color: "#F0DEB8" }}>{form.email}</strong>.
            Click the link to activate your account.
          </p>
          <Link
            href="/login"
            style={{
              marginTop: "0.5rem",
              color: "#8A6840",
              fontFamily: "var(--font-sans)",
              fontSize: "0.875rem",
              textDecoration: "underline",
            }}
          >
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5 relative overflow-hidden"
      style={{ background: "#1A1510" }}
    >
      {/* Radial amber glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 60%, rgba(196,144,48,0.10) 0%, transparent 70%)",
          zIndex: 1,
        }}
      />

      {/* Logo */}
      <div
        className="relative flex flex-col items-center gap-1 mb-6 auth-rise-in"
        style={{ zIndex: 10, animationDelay: "0.05s" }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            color: "#F0DEB8",
            fontSize: "2.5rem",
            fontWeight: 700,
            letterSpacing: "0.01em",
            lineHeight: 1.1,
          }}
        >
          FarmTrack
        </h1>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            color: "#6A4E30",
            fontSize: "0.75rem",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Create Your Account
        </p>
        <div className="flex items-center justify-center gap-3 mt-2">
          <div style={{ height: "1px", width: "32px", background: "rgba(196,144,48,0.25)" }} />
          <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: "rgba(196,144,48,0.40)" }} />
          <div style={{ height: "1px", width: "32px", background: "rgba(196,144,48,0.25)" }} />
        </div>
      </div>

      {/* Card */}
      <div
        className="relative w-full max-w-sm px-8 py-8 flex flex-col gap-6 auth-rise-in"
        style={{
          zIndex: 10,
          animationDelay: "0.12s",
          borderRadius: "2rem",
          background: "#241C14",
          border: "1px solid rgba(196,144,48,0.18)",
          boxShadow: "0 0 48px rgba(196,144,48,0.06), 0 8px 40px rgba(0,0,0,0.55)",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-sans)",
            color: "#6A4E30",
            fontSize: "0.8125rem",
            textAlign: "center",
          }}
        >
          Start with our Basic plan at R200/month. Upgrade to Advanced anytime.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          {/* Name */}
          <div className="flex flex-col gap-1">
            <label htmlFor="name" style={labelStyle}>Full Name</label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              required
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="Jan van der Merwe"
              style={inputStyle}
            />
          </div>

          {/* Email */}
          <div className="flex flex-col gap-1">
            <label htmlFor="email" style={labelStyle}>Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={(e) => updateField("email", e.target.value)}
              placeholder="jan@example.com"
              style={inputStyle}
            />
          </div>

          {/* Username */}
          <div className="flex flex-col gap-1">
            <label htmlFor="username" style={labelStyle}>Username</label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              required
              value={form.username}
              onChange={(e) => updateField("username", e.target.value)}
              placeholder="jan"
              style={inputStyle}
            />
          </div>

          {/* Farm Name */}
          <div className="flex flex-col gap-1">
            <label htmlFor="farmName" style={labelStyle}>Farm Name</label>
            <input
              id="farmName"
              type="text"
              required
              value={form.farmName}
              onChange={(e) => updateField("farmName", e.target.value)}
              placeholder="Rietfontein Boerdery"
              style={inputStyle}
            />
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1">
            <label htmlFor="password" style={labelStyle}>Password</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => updateField("password", e.target.value)}
              placeholder="Min 8 characters"
              style={inputStyle}
            />
          </div>

          {/* Confirm Password */}
          <div className="flex flex-col gap-1">
            <label htmlFor="confirmPassword" style={labelStyle}>Confirm Password</label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={form.confirmPassword}
              onChange={(e) => updateField("confirmPassword", e.target.value)}
              placeholder="••••••••"
              style={inputStyle}
            />
          </div>

          {/* Error */}
          {error && (
            <p
              style={{
                fontFamily: "var(--font-sans)",
                color: "#E07060",
                fontSize: "0.8125rem",
                background: "rgba(200,60,40,0.10)",
                border: "1px solid rgba(200,60,40,0.20)",
                borderRadius: "8px",
                padding: "0.5rem 0.75rem",
              }}
            >
              {error}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: "0.25rem",
              background: loading
                ? "rgba(160,100,40,0.35)"
                : "linear-gradient(135deg, rgba(196,144,48,0.90) 0%, rgba(160,100,40,0.90) 100%)",
              border: "1px solid rgba(196,144,48,0.35)",
              borderRadius: "10px",
              padding: "0.75rem 1rem",
              color: loading ? "rgba(240,222,184,0.50)" : "#F0DEB8",
              fontFamily: "var(--font-sans)",
              fontSize: "0.9375rem",
              fontWeight: 500,
              letterSpacing: "0.03em",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "all 0.18s ease",
            }}
          >
            {loading ? "Creating your farm..." : "Create Account"}
          </button>
        </form>

        {/* Login link */}
        <p
          style={{
            fontFamily: "var(--font-sans)",
            color: "#6A4E30",
            fontSize: "0.8125rem",
            textAlign: "center",
          }}
        >
          Already have an account?{" "}
          <Link
            href="/login"
            style={{ color: "#8A6840", textDecoration: "underline" }}
          >
            Sign in
          </Link>
        </p>
      </div>

      <footer
        className="mt-6 text-xs text-center"
        style={{
          color: "#3A2A1A",
          fontFamily: "var(--font-sans)",
          zIndex: 10,
          position: "relative",
        }}
      >
        &copy; {new Date().getFullYear()} FarmTrack
      </footer>
    </div>
  );
}
