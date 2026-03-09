"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Verkeerde e-pos of wagwoord. Probeer weer.");
      } else if (result?.ok) {
        router.push("/home");
      } else {
        setError("Aanmelding het misluk. Probeer later weer.");
      }
    } catch {
      setError("Netwerkfout. Kontroleer jou verbinding.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5 relative overflow-hidden"
      style={{
        backgroundImage: 'url("/brangus.jpg")',
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Gradient overlay — darker than home for focus */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(8,5,2,0.80) 0%, rgba(8,5,2,0.55) 45%, rgba(8,5,2,0.85) 100%)",
          zIndex: 1,
        }}
      />

      {/* Login card */}
      <div
        className="relative w-full max-w-sm rounded-3xl px-8 py-10 flex flex-col gap-8"
        style={{
          zIndex: 10,
          background: "rgba(5,3,1,0.58)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          border: "1px solid rgba(255,255,255,0.07)",
          boxShadow: "0 8px 48px rgba(0,0,0,0.55)",
        }}
      >
        {/* Heading */}
        <div className="flex flex-col gap-2 text-center">
          <h1
            style={{
              fontFamily: "var(--font-display)",
              color: "#F0DEB8",
              fontSize: "2rem",
              fontWeight: 700,
              letterSpacing: "0.01em",
              lineHeight: 1.2,
            }}
          >
            Delta Livestock
          </h1>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              color: "#7A5840",
              fontSize: "0.8125rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Brangus Cattle · Limpopo
          </p>

          {/* Decorative divider */}
          <div className="flex items-center justify-center gap-3 mt-1">
            <div style={{ height: "1px", width: "32px", background: "rgba(196,144,48,0.30)" }} />
            <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "rgba(196,144,48,0.45)" }} />
            <div style={{ height: "1px", width: "32px", background: "rgba(196,144,48,0.30)" }} />
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="email"
              style={{
                fontFamily: "var(--font-sans)",
                color: "#8A6840",
                fontSize: "0.75rem",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              E-posadres
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              style={{
                background: "rgba(15,9,3,0.70)",
                border: "1px solid rgba(140,100,60,0.25)",
                borderRadius: "10px",
                padding: "0.625rem 0.875rem",
                color: "#F0DEB8",
                fontFamily: "var(--font-sans)",
                fontSize: "0.9375rem",
                outline: "none",
                width: "100%",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "rgba(196,144,48,0.55)";
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(196,144,48,0.08)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "rgba(140,100,60,0.25)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              style={{
                fontFamily: "var(--font-sans)",
                color: "#8A6840",
                fontSize: "0.75rem",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              Wagwoord
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                background: "rgba(15,9,3,0.70)",
                border: "1px solid rgba(140,100,60,0.25)",
                borderRadius: "10px",
                padding: "0.625rem 0.875rem",
                color: "#F0DEB8",
                fontFamily: "var(--font-sans)",
                fontSize: "0.9375rem",
                outline: "none",
                width: "100%",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "rgba(196,144,48,0.55)";
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(196,144,48,0.08)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "rgba(140,100,60,0.25)";
                e.currentTarget.style.boxShadow = "none";
              }}
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
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.background =
                  "linear-gradient(135deg, rgba(212,160,56,0.95) 0%, rgba(180,115,45,0.95) 100%)";
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 4px 16px rgba(196,144,48,0.25)";
              }
            }}
            onMouseLeave={(e) => {
              if (!loading) {
                e.currentTarget.style.background =
                  "linear-gradient(135deg, rgba(196,144,48,0.90) 0%, rgba(160,100,40,0.90) 100%)";
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "none";
              }
            }}
          >
            {loading ? "Besig..." : "Teken in"}
          </button>
        </form>
      </div>

      {/* Footer */}
      <footer
        className="mt-8 text-xs text-center"
        style={{
          color: "#4A3020",
          fontFamily: "var(--font-sans)",
          zIndex: 10,
          position: "relative",
        }}
      >
        © {new Date().getFullYear()} Delta Livestock CC
      </footer>
    </div>
  );
}
