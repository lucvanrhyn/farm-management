import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard — FarmTrack",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-screen overflow-hidden">{children}</div>;
}
