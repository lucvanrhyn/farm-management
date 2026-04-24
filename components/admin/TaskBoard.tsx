"use client";

import { useState, useCallback } from "react";
import { CheckSquare, Plus, X, Calendar, AlertCircle, Clock, Check, Trash2 } from "lucide-react";

interface Task {
  id: string;
  title: string;
  description?: string | null;
  campId?: string | null;
  assignedTo: string;
  createdBy: string;
  dueDate: string;
  status: string;
  priority: string;
  completedAt?: string | null;
  createdAt: string;
}

interface Camp {
  camp_id: string;
  camp_name: string;
}

interface TaskBoardProps {
  initialTasks: Task[];
  camps: Camp[];
  /**
   * Opaque cursor pointing one-past the last SSR-hydrated row. When null,
   * there are no more tasks to stream from /api/tasks. Optional so callers
   * that pre-date Phase I.1 pagination still compile.
   */
  nextCursor?: string | null;
  /**
   * Whether the SSR query saw a `take + 1` lookahead row. Drives whether
   * the "Load more" control is rendered at all.
   */
  hasMore?: boolean;
}

const PAGE_SIZE = 50;

const PRIORITY_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  low:    { label: "Low",    bg: "rgba(156,142,122,0.12)", text: "#9C8E7A" },
  normal: { label: "Normal", bg: "rgba(59,130,246,0.1)",  text: "#3B82F6" },
  high:   { label: "High",   bg: "rgba(220,38,38,0.1)",   text: "#DC2626" },
};

const STATUS_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  pending:     { label: "Pending",     bg: "rgba(234,179,8,0.1)",  text: "#CA8A04" },
  in_progress: { label: "In Progress", bg: "rgba(59,130,246,0.1)", text: "#3B82F6" },
  completed:   { label: "Completed",   bg: "rgba(34,197,94,0.1)",  text: "#16A34A" },
};

const FILTER_STATUSES = ["all", "pending", "in_progress", "completed"] as const;
type FilterStatus = (typeof FILTER_STATUSES)[number];

const TODAY = new Date().toISOString().slice(0, 10);

interface CreateFormState {
  title: string;
  description: string;
  dueDate: string;
  assignedTo: string;
  priority: string;
  campId: string;
}

const EMPTY_FORM: CreateFormState = {
  title: "",
  description: "",
  dueDate: TODAY,
  assignedTo: "",
  priority: "normal",
  campId: "",
};

export function TaskBoard({
  initialTasks,
  camps,
  nextCursor: initialNextCursor = null,
  hasMore: initialHasMore = false,
}: TaskBoardProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateFormState>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [hasMore, setHasMore] = useState<boolean>(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const url = new URL("/api/tasks", window.location.origin);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("cursor", nextCursor);
      const res = await fetch(url.pathname + url.search);
      if (!res.ok) return;
      const data = (await res.json()) as {
        tasks: Task[];
        nextCursor: string | null;
        hasMore: boolean;
      };
      setTasks((prev) => [...prev, ...data.tasks]);
      setNextCursor(data.hasMore ? data.nextCursor : null);
      setHasMore(data.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  const filtered = tasks.filter((t) => {
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    if (filterAssignee && !t.assignedTo.toLowerCase().includes(filterAssignee.toLowerCase())) return false;
    return true;
  });

  const handleComplete = useCallback(async (taskId: string, currentStatus: string) => {
    const newStatus = currentStatus === "completed" ? "pending" : "completed";
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) return;
    const updated: Task = await res.json();
    setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
  }, []);

  const handleStatusChange = useCallback(async (taskId: string, newStatus: string) => {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) return;
    const updated: Task = await res.json();
    setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
  }, []);

  const handleDelete = useCallback(async (taskId: string) => {
    if (!confirm("Delete this task?")) return;
    const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    if (!res.ok) return;
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  const handleCreate = useCallback(async () => {
    setCreateError(null);
    if (!form.title.trim()) { setCreateError("Title is required"); return; }
    if (!form.dueDate) { setCreateError("Due date is required"); return; }
    if (!form.assignedTo.trim()) { setCreateError("Assigned to is required"); return; }

    setCreating(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description || null,
          dueDate: form.dueDate,
          assignedTo: form.assignedTo.trim(),
          priority: form.priority,
          campId: form.campId || null,
        }),
      });
      if (!res.ok) {
        const err: { error?: string } = await res.json();
        setCreateError(err.error ?? "Failed to create task");
        return;
      }
      const newTask: Task = await res.json();
      setTasks((prev) => [newTask, ...prev]);
      setForm(EMPTY_FORM);
      setShowCreate(false);
    } catch {
      setCreateError("Network error — please try again");
    } finally {
      setCreating(false);
    }
  }, [form]);

  const campName = (campId: string | null | undefined) => {
    if (!campId) return null;
    return camps.find((c) => c.camp_id === campId)?.camp_name ?? campId;
  };

  const isOverdue = (task: Task) => task.status !== "completed" && task.dueDate < TODAY;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Status filter pills */}
        <div className="flex gap-1.5">
          {FILTER_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
              style={{
                background: filterStatus === s ? "#1C1815" : "rgba(0,0,0,0.05)",
                color: filterStatus === s ? "#F5EBD4" : "#5C3D2E",
              }}
            >
              {s === "all" ? "All" : STATUS_STYLES[s]?.label ?? s}
            </button>
          ))}
        </div>

        {/* Assignee filter */}
        <input
          type="text"
          placeholder="Filter by assignee..."
          value={filterAssignee}
          onChange={(e) => setFilterAssignee(e.target.value)}
          className="px-3 py-1.5 text-xs rounded-lg border outline-none"
          style={{ borderColor: "rgba(0,0,0,0.12)", background: "#fff", color: "#1C1815", minWidth: 160 }}
        />

        <div className="ml-auto">
          <button
            onClick={() => { setShowCreate((v) => !v); setCreateError(null); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: "#1C1815", color: "#F5EBD4" }}
          >
            {showCreate ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {showCreate ? "Cancel" : "New Task"}
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div
          className="rounded-xl p-4 mb-5"
          style={{ background: "#F5F2EE", border: "1px solid rgba(0,0,0,0.08)" }}
        >
          <h3 className="text-sm font-semibold mb-3" style={{ color: "#1C1815" }}>Create Task</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium mb-1" style={{ color: "#5C3D2E" }}>
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Task title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border outline-none"
                style={{ borderColor: "rgba(0,0,0,0.12)", background: "#fff", color: "#1C1815" }}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium mb-1" style={{ color: "#5C3D2E" }}>Description</label>
              <textarea
                placeholder="Optional description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 text-sm rounded-lg border outline-none resize-none"
                style={{ borderColor: "rgba(0,0,0,0.12)", background: "#fff", color: "#1C1815" }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "#5C3D2E" }}>
                Due Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border outline-none"
                style={{ borderColor: "rgba(0,0,0,0.12)", background: "#fff", color: "#1C1815" }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "#5C3D2E" }}>
                Assigned To <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. john@farm.com"
                value={form.assignedTo}
                onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border outline-none"
                style={{ borderColor: "rgba(0,0,0,0.12)", background: "#fff", color: "#1C1815" }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "#5C3D2E" }}>Priority</label>
              <select
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border outline-none"
                style={{ borderColor: "rgba(0,0,0,0.12)", background: "#fff", color: "#1C1815" }}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "#5C3D2E" }}>Camp (optional)</label>
              <select
                value={form.campId}
                onChange={(e) => setForm((f) => ({ ...f, campId: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-lg border outline-none"
                style={{ borderColor: "rgba(0,0,0,0.12)", background: "#fff", color: "#1C1815" }}
              >
                <option value="">No camp</option>
                {camps.map((c) => (
                  <option key={c.camp_id} value={c.camp_id}>{c.camp_name}</option>
                ))}
              </select>
            </div>
          </div>

          {createError && (
            <p className="mt-2 text-xs text-red-600 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" /> {createError}
            </p>
          )}

          <div className="mt-3 flex justify-end">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: "#1C1815", color: "#F5EBD4", opacity: creating ? 0.6 : 1 }}
            >
              {creating ? "Creating..." : "Create Task"}
            </button>
          </div>
        </div>
      )}

      {/* Task list */}
      {filtered.length === 0 ? (
        <div
          className="rounded-xl p-8 text-center"
          style={{ background: "#F5F2EE", border: "1px solid rgba(0,0,0,0.06)" }}
        >
          <CheckSquare className="w-8 h-8 mx-auto mb-2" style={{ color: "#9C8E7A" }} />
          <p className="text-sm font-medium" style={{ color: "#9C8E7A" }}>No tasks found</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((task) => {
            const priorityStyle = PRIORITY_STYLES[task.priority] ?? PRIORITY_STYLES.normal;
            const statusStyle = STATUS_STYLES[task.status] ?? STATUS_STYLES.pending;
            const overdue = isOverdue(task);

            return (
              <div
                key={task.id}
                className="rounded-xl p-4 flex gap-3 items-start"
                style={{
                  background: "#fff",
                  border: `1px solid ${overdue ? "rgba(220,38,38,0.2)" : "rgba(0,0,0,0.06)"}`,
                }}
              >
                {/* Checkbox */}
                <button
                  onClick={() => handleComplete(task.id, task.status)}
                  className="mt-0.5 w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors"
                  style={{
                    borderColor: task.status === "completed" ? "#16A34A" : "rgba(0,0,0,0.2)",
                    background: task.status === "completed" ? "#16A34A" : "transparent",
                  }}
                  title={task.status === "completed" ? "Mark as pending" : "Mark as completed"}
                >
                  {task.status === "completed" && <Check className="w-3 h-3 text-white" />}
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-0.5">
                    <span
                      className="text-sm font-medium"
                      style={{
                        color: "#1C1815",
                        textDecoration: task.status === "completed" ? "line-through" : "none",
                        opacity: task.status === "completed" ? 0.6 : 1,
                      }}
                    >
                      {task.title}
                    </span>
                    {/* Priority badge */}
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                      style={{ background: priorityStyle.bg, color: priorityStyle.text }}
                    >
                      {priorityStyle.label}
                    </span>
                    {/* Status pill */}
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                      style={{ background: statusStyle.bg, color: statusStyle.text }}
                    >
                      {statusStyle.label}
                    </span>
                    {overdue && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">
                        Overdue
                      </span>
                    )}
                  </div>

                  {task.description && (
                    <p className="text-xs mt-0.5 mb-1" style={{ color: "#9C8E7A" }}>{task.description}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-3 mt-1">
                    <span className="flex items-center gap-1 text-xs" style={{ color: "#9C8E7A" }}>
                      <Calendar className="w-3 h-3" /> {task.dueDate}
                    </span>
                    <span className="flex items-center gap-1 text-xs" style={{ color: "#9C8E7A" }}>
                      <Clock className="w-3 h-3" /> {task.assignedTo}
                    </span>
                    {campName(task.campId) && (
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(0,0,0,0.04)", color: "#5C3D2E" }}>
                        {campName(task.campId)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Status dropdown + delete */}
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={task.status}
                    onChange={(e) => handleStatusChange(task.id, e.target.value)}
                    className="text-xs rounded-lg border px-2 py-1 outline-none"
                    style={{ borderColor: "rgba(0,0,0,0.12)", background: "#F5F2EE", color: "#1C1815" }}
                  >
                    <option value="pending">Pending</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                  </select>
                  <button
                    onClick={() => handleDelete(task.id)}
                    className="p-1 rounded hover:bg-red-50 transition-colors"
                    title="Delete task"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Server-side "Load more" — fetches the next cursor window from
          /api/tasks. Rendered only when the SSR page hinted there's more
          beyond the initial PAGE_SIZE rows. */}
      {hasMore && nextCursor && (
        <div className="flex justify-center pt-4">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-4 py-2 text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
            style={{
              border: "1px solid #E0D5C8",
              color: "#6B5C4E",
              background: "#FFFFFF",
            }}
          >
            {loadingMore ? "Loading…" : `Load more (${tasks.length.toLocaleString()} loaded)`}
          </button>
        </div>
      )}
    </div>
  );
}
