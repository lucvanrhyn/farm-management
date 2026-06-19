"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Icon } from "@/components/ds";

interface Task {
  id: string;
  title: string;
  priority: string;
  status: string;
  dueDate: string;
  assignedTo: string;
  // `/api/tasks` (unbounded) spreads the full task row, so `campId` is on
  // the wire. Optional/nullable because a task may be farm-wide (no camp).
  // Rendered as a small mono camp tag — see the task row below. No invented
  // data: when absent the tag is skipped entirely.
  campId?: string | null;
}

// Map task priority onto the warm token status scale (var(--ft-crit/info/subtle)).
const PRIORITY_DOT: Record<string, string> = {
  high:   "var(--ft-crit)",
  normal: "var(--ft-info)",
  low:    "var(--ft-subtle)",
};

const TODAY = new Date().toISOString().slice(0, 10);

export function TodaysTasks() {
  const { data: session } = useSession();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const userEmail = session?.user?.email ?? null;

  const fetchTasks = useCallback(async (email: string) => {
    try {
      const url = `/api/tasks?status=pending,in_progress&assignee=${encodeURIComponent(email)}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const all: Task[] = await res.json();
      // Show only tasks due today or overdue
      const relevant = all.filter((t) => t.dueDate <= TODAY);
      setTasks(relevant);
    } catch {
      // Silently ignore network errors — logger works offline
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userEmail) {
      setLoading(false);
      return;
    }
    fetchTasks(userEmail);
  }, [userEmail, fetchTasks]);

  const handleComplete = useCallback(async (taskId: string) => {
    // Optimistic update — snapshot the task so we can restore it on failure.
    // Without the rollback the task vanishes from the UI until the next refetch
    // cycle (or forever, if the user is offline and the fetch is swallowed).
    let snapshot: Task | undefined;
    setTasks((prev) => {
      snapshot = prev.find((t) => t.id === taskId);
      return prev.filter((t) => t.id !== taskId);
    });

    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!res.ok) throw new Error(`PATCH /api/tasks/${taskId} failed: ${res.status}`);
    } catch {
      // Restore the task so the user can retry. We deliberately append at the
      // end rather than re-sorting — the list is short-lived and re-sort on
      // every retry would be noisier than a stable "retry here" affordance.
      if (snapshot) {
        setTasks((prev) => (prev.some((t) => t.id === taskId) ? prev : [...prev, snapshot!]));
      }
    }
  }, []);

  if (!userEmail || loading) return null;

  if (tasks.length === 0) {
    return (
      <div
        className="ft-card mx-4 mb-4 flex items-center gap-2"
        style={{ padding: "13px 15px" }}
      >
        <Icon.check size={16} className="shrink-0" style={{ color: "var(--ft-good)" }} />
        <p className="text-sm font-medium" style={{ color: "var(--ft-good)" }}>
          No tasks for today
        </p>
      </div>
    );
  }

  return (
    <div className="ft-card mx-4 mb-4" style={{ padding: "13px 15px" }}>
      {/* Header row — Camp Rounds reference (phone_3.jpg): check glyph +
          "{N} open tasks" (sentence case, medium weight — NOT an uppercase
          label) + a chevron affordance on the right. The count is the number
          of incomplete tasks currently in view (tasks vanish optimistically
          on complete, so `tasks.length` is exactly the open count). */}
      <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
        <Icon.check size={14} className="shrink-0" style={{ color: "var(--ft-good)" }} />
        <span className="flex-1 whitespace-nowrap" style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ft-text)" }}>
          {tasks.length} open task{tasks.length !== 1 ? "s" : ""}
        </span>
        <Icon.chevron size={14} className="shrink-0" style={{ color: "var(--ft-subtle)" }} />
      </div>
      {/* Flat bullet rows — the reference renders each task as a borderless
          row: small accent bullet + label + a right-aligned mono camp code.
          No surface2 box, no border, no trailing button. Completion is
          preserved by making the whole row a tappable button (tap to mark
          done) — the real `handleComplete` behaviour is unchanged. */}
      <div className="flex flex-col" style={{ gap: 7 }}>
        {tasks.map((task) => {
          const dotColor = PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.normal;
          const overdue = task.dueDate < TODAY;

          return (
            <button
              key={task.id}
              type="button"
              onClick={() => handleComplete(task.id)}
              className="flex w-full items-center text-left active:opacity-60 transition-opacity"
              style={{ gap: 9, fontSize: 12, color: "var(--ft-muted)" }}
              title="Mark complete"
              aria-label={`Mark complete: ${task.title}`}
            >
              {/* Priority bullet — 4px accent-scale dot per the reference. */}
              <span
                className="rounded-full shrink-0"
                style={{ width: 4, height: 4, background: overdue ? "var(--ft-crit)" : dotColor }}
              />

              {/* Title */}
              <span className="truncate flex-1">
                {task.title}
                {overdue && (
                  <span className="ft-mono ml-2 text-[10px] font-semibold" style={{ color: "var(--ft-crit)" }}>Overdue</span>
                )}
              </span>

              {/* Camp tag — Camp Rounds reference: small mono camp code,
                  right-aligned. Rendered ONLY when the task carries a
                  `campId` (farm-wide tasks have none). The campId is the
                  human-meaningful camp code used elsewhere in the app
                  (e.g. VeldCampSummaryCards renders it as the camp name);
                  no fabricated label. */}
              {task.campId && (
                <span
                  className="ft-mono shrink-0 max-w-[5rem] truncate"
                  style={{ fontSize: 11, color: "var(--ft-subtle)" }}
                  title={task.campId}
                >
                  {task.campId}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
