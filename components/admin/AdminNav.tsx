import Link from "next/link";
import { SignOutButton } from "@/components/logger/SignOutButton";

const links = [
  { href: "/admin", label: "Oorsig", icon: "📊" },
  { href: "/admin/animals", label: "Diere", icon: "🐄" },
  { href: "/admin/camps", label: "Kampe", icon: "🌿" },
  { href: "/admin/import", label: "Invoer", icon: "📥" },
];

export default function AdminNav({ active }: { active: string }) {
  return (
    <nav className="w-52 shrink-0 bg-stone-900 min-h-screen p-4 flex flex-col gap-1">
      <div className="mb-6 px-2">
        <p className="text-xs text-stone-500 uppercase tracking-widest font-semibold">Admin</p>
      </div>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          prefetch={false}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
            active === link.href
              ? "bg-stone-700 text-white"
              : "text-stone-400 hover:bg-stone-800 hover:text-stone-200"
          }`}
        >
          <span>{link.icon}</span>
          {link.label}
        </Link>
      ))}
      <div className="mt-auto pt-4">
        <SignOutButton />
      </div>
    </nav>
  );
}
