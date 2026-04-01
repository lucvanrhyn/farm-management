"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Check, CheckSquare } from "lucide-react";

interface Task {
  id: string;
  title: string;
  priority: string;
  status: string;
  dueDate: string;
  assignedTo: string;
}

const PRIORITY_DOT: Record<string, string> = {
  high:   "#DC2626",
  normal: "#3B82F6",
  low:    "#9C8E7A",
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
    // Optimistic update
    setTasks((prev) => prev.filter((t) => t.id !== taskId));

    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
    } catch {
      // If it fails, the task will reappear on next fetch — acceptable for offline-first UX
    }
  }, []);

  if (!userEmail || loading) return null;

  if (tasks.length === 0) {
    return (
      <div
        className="mx-4 mb-4 rounded-xl px-4 py-3 flex items-center gap-2"
        style={{ background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.15)" }}
      >
        <CheckSquare className="w-4 h-4 shrink-0" style={{ color: "#16A34A" }} />
        <p className="text-sm font-medium" style={{ color: "#16A34A" }}>
          No tasks for today ✓
        </p>
      </div>
    );
  }

  return (
    <div className="mx-4 mb-4">
      <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "#5C3D2E" }}>
        Today&apos;s Tasks
      </p>
      <div className="flex flex-col gap-2">
        {tasks.map((task) => {
          const dotColor = PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.normal;
          const overdue = task.dueDate < TODAY;

          return (
            <div
              key={task.id}
              className="rounded-xl px-3 py-2.5 flex items-center gap-3"
              style={{
                background: "#fff",
                border: `1px solid ${overdue ? "rgba(220,38,38,0.2)" : "rgba(0,0,0,0.06)"}`,
              }}
            >
              {/* Priority dot */}
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: dotColor }}
              />

              {/* Title */}
              <span className="flex-1 text-sm" style={{ color: "#1C1815" }}>
                {task.title}
                {overdue && (
                  <span className="ml-2 text-[10px] font-semibold text-red-500">Overdue</span>
                )}
              </span>

              {/* Complete button */}
              <button
                onClick={() => handleComplete(task.id)}
                className="w-6 h-6 rounded-full border flex items-center justify-center shrink-0 transition-colors"
                style={{ borderColor: "rgba(0,0,0,0.2)", background: "transparent" }}
                title="Mark complete"
              >
                <Check className="w-3.5 h-3.5" style={{ color: "#9C8E7A" }} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
