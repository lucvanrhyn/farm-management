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
        className="ft-card mx-4 mb-4 px-4 py-3 flex items-center gap-2"
      >
        <Icon.check size={16} className="shrink-0" style={{ color: "var(--ft-good)" }} />
        <p className="text-sm font-medium" style={{ color: "var(--ft-good)" }}>
          No tasks for today
        </p>
      </div>
    );
  }

  return (
    <div className="ft-card mx-4 mb-4 p-3">
      {/* Header row — Camp Rounds reference: check glyph + "{N} open tasks"
          + a chevron affordance on the right. The count is the number of
          incomplete tasks currently in view (tasks vanish optimistically on
          complete, so `tasks.length` is exactly the open count). */}
      <div className="mb-2 px-1 flex items-center gap-2">
        <Icon.check size={15} className="shrink-0" style={{ color: "var(--ft-accent)" }} />
        <span className="ft-label flex-1" style={{ margin: 0 }}>
          {tasks.length} open task{tasks.length !== 1 ? "s" : ""}
        </span>
        <Icon.chevron size={15} className="shrink-0" style={{ color: "var(--ft-subtle)" }} />
      </div>
      <div className="flex flex-col gap-2">
        {tasks.map((task) => {
          const dotColor = PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.normal;
          const overdue = task.dueDate < TODAY;

          return (
            <div
              key={task.id}
              className="rounded-xl px-3 py-2.5 flex items-center gap-3"
              style={{
                background: "var(--ft-surface2)",
                border: `1px solid ${overdue ? "var(--ft-crit)" : "var(--ft-border)"}`,
              }}
            >
              {/* Priority dot */}
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: dotColor }}
              />

              {/* Title */}
              <span className="flex-1 text-sm" style={{ color: "var(--ft-text)" }}>
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
                  className="ft-mono text-[10px] px-2 py-0.5 rounded-full shrink-0 max-w-[5rem] truncate"
                  style={{ backgroundColor: "var(--ft-surface)", color: "var(--ft-muted)" }}
                  title={task.campId}
                >
                  {task.campId}
                </span>
              )}

              {/* Complete button */}
              <button
                onClick={() => handleComplete(task.id)}
                className="ft-action-btn w-6 h-6 shrink-0"
                style={{ borderRadius: 999, border: "1px solid var(--ft-border2)" }}
                title="Mark complete"
                aria-label="Mark complete"
              >
                <Icon.check size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
