"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Bell, X, CheckCheck } from "lucide-react";

interface NotificationItem {
  id: string;
  type: string;
  severity: "red" | "amber";
  message: string;
  href: string;
  isRead: boolean;
  createdAt: string;
}

const SEVERITY_COLORS = {
  red: { dot: "#C0574C", bg: "rgba(192,87,76,0.1)", border: "rgba(192,87,76,0.2)" },
  amber: { dot: "#8B6914", bg: "rgba(139,105,20,0.1)", border: "rgba(139,105,20,0.25)" },
};

export default function NotificationBell({ farmSlug }: { farmSlug: string }) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch(`/api/notifications`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json() as { notifications: NotificationItem[]; unreadCount: number };
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // Silently ignore network errors
    }
  }, []);

  useEffect(() => {
    void fetchNotifications();
    // Poll every 120s. /api/notifications is now browser-cached for 15s and
    // server-cached for 30s with tag-based invalidation on writes, so we can
    // halve the request rate without sacrificing freshness — fresh alerts
    // land via cache-tag invalidation, not this poll.
    const interval = setInterval(() => void fetchNotifications(), 120_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function markRead(id: string) {
    await fetch(`/api/notifications/${id}`, { method: "PATCH", credentials: "include" });
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
  }

  async function markAllRead() {
    await fetch(`/api/notifications/read-all`, { method: "POST", credentials: "include" });
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center w-8 h-8 rounded-lg transition-colors"
        style={{ color: "rgba(210,180,140,0.65)" }}
        title="Notifications"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span
            className="absolute top-0.5 right-0.5 flex items-center justify-center text-[9px] font-bold rounded-full min-w-[14px] h-[14px] px-0.5"
            style={{ background: "#C0574C", color: "#FFFFFF" }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 mb-2 w-72 rounded-xl shadow-xl z-50 overflow-hidden"
          style={{ background: "#1C1815", border: "1px solid rgba(139,105,20,0.25)" }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-3 py-2.5 border-b"
            style={{ borderColor: "rgba(139,105,20,0.2)" }}
          >
            <span className="text-xs font-semibold" style={{ color: "#F5EBD4" }}>
              Notifications
            </span>
            <div className="flex items-center gap-1.5">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
                  style={{ color: "#8B6914", background: "rgba(139,105,20,0.12)" }}
                  title="Mark all as read"
                >
                  <CheckCheck className="w-3 h-3" />
                  All read
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ color: "rgba(210,180,140,0.5)" }}
                aria-label="Close notifications"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3 py-5 text-xs text-center" style={{ color: "rgba(210,180,140,0.5)" }}>
                No notifications
              </p>
            ) : (
              notifications.map((n) => {
                const colors = SEVERITY_COLORS[n.severity];
                return (
                  <div
                    key={n.id}
                    className="flex items-start gap-2.5 px-3 py-2.5 border-b transition-colors"
                    style={{
                      borderColor: "rgba(139,105,20,0.1)",
                      background: n.isRead ? "transparent" : "rgba(139,105,20,0.05)",
                    }}
                  >
                    <span
                      className="mt-1 w-2 h-2 rounded-full shrink-0"
                      style={{ background: n.isRead ? "rgba(210,180,140,0.2)" : colors.dot }}
                    />
                    <Link
                      href={`/${farmSlug}${new URL(n.href, "http://x").pathname.replace(`/${farmSlug}`, "")}`}
                      onClick={() => {
                        if (!n.isRead) void markRead(n.id);
                        setOpen(false);
                      }}
                      className="flex-1 min-w-0"
                    >
                      <p
                        className="text-xs leading-snug"
                        style={{ color: n.isRead ? "rgba(210,180,140,0.55)" : "rgba(210,180,140,0.9)" }}
                      >
                        {n.message}
                      </p>
                    </Link>
                    {!n.isRead && (
                      <button
                        type="button"
                        onClick={() => void markRead(n.id)}
                        className="shrink-0 p-0.5 rounded"
                        style={{ color: "rgba(210,180,140,0.4)" }}
                        title="Mark as read"
                        aria-label="Mark notification as read"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-2" style={{ borderTop: "1px solid rgba(139,105,20,0.1)" }}>
            <Link
              href={`/${farmSlug}/admin/alerts`}
              onClick={() => setOpen(false)}
              className="text-[10px] font-medium"
              style={{ color: "#8B6914" }}
            >
              View all alerts →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
