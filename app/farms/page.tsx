import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import type { SessionFarm } from "@/types/next-auth";
import { FarmCard } from "./FarmCard";

export default async function FarmsPage() {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const farms: SessionFarm[] = session.user.farms ?? [];

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5 relative overflow-hidden"
      style={{
        backgroundImage: 'url("/brangus.jpg")',
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(8,5,2,0.78) 0%, rgba(8,5,2,0.48) 45%, rgba(8,5,2,0.82) 100%)",
          zIndex: 1,
        }}
      />

      <div
        className="relative w-full max-w-lg flex flex-col items-center gap-8"
        style={{ zIndex: 10 }}
      >
        {/* Heading */}
        <div className="flex flex-col items-center gap-2 text-center">
          <h1
            style={{
              fontFamily: "var(--font-display)",
              color: "#F0DEB8",
              fontSize: "1.75rem",
              fontWeight: 700,
              letterSpacing: "0.01em",
            }}
          >
            Select a Farm
          </h1>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              color: "#7A5840",
              fontSize: "0.8125rem",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Welcome, {session.user.name ?? session.user.username}
          </p>
          <div className="flex items-center justify-center gap-3 mt-1">
            <div style={{ height: "1px", width: "32px", background: "rgba(196,144,48,0.30)" }} />
            <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "rgba(196,144,48,0.45)" }} />
            <div style={{ height: "1px", width: "32px", background: "rgba(196,144,48,0.30)" }} />
          </div>
        </div>

        {/* Farm cards */}
        {farms.length === 0 ? (
          <p
            style={{
              fontFamily: "var(--font-sans)",
              color: "#7A5840",
              fontSize: "0.9rem",
              background: "rgba(5,3,1,0.52)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "16px",
              padding: "1.5rem 2rem",
            }}
          >
            No farms assigned to your account. Contact your administrator.
          </p>
        ) : (
          <div className="flex flex-col gap-3 w-full">
            {farms.map((farm) => (
              <FarmCard key={farm.slug} farm={farm} />
            ))}
          </div>
        )}
      </div>

      <footer
        className="absolute bottom-6 text-xs text-center"
        style={{ color: "#4A3020", fontFamily: "var(--font-sans)", zIndex: 10 }}
      >
        © {new Date().getFullYear()} FarmTrack
      </footer>
    </div>
  );
}
