"use client";

/**
 * TaskSettingsClient — /admin/settings/tasks two-tab UI.
 *
 * Templates tab: table of installed task templates with Install / Edit / Delete.
 * Defaults tab:  form for reminder offset / auto-observation / horizon.
 *
 * All writes go through /api/task-templates/[id] (PATCH/DELETE),
 * /api/task-templates/install (POST), and /api/farm-settings/tasks (PUT).
 *
 * No module-load env reads, no mutation of incoming props — all edits
 * produce fresh state objects.
 */

import { useCallback, useState } from "react";
import type { FarmTaskSettings } from "@/app/api/farm-settings/tasks/schema";

export interface TaskTemplateRow {
  id: string;
  name: string;
  name_af: string | null;
  taskType: string;
  description: string | null;
  description_af: string | null;
  priorityDefault: string | null;
  recurrenceRule: string | null;
  reminderOffset: number | null;
  species: string | null;
  isPublic: boolean;
}

interface Props {
  farmSlug: string;
  initialTemplates: TaskTemplateRow[];
  initialSettings: FarmTaskSettings;
}

type TabKey = "templates" | "defaults";

// ── Helpers ─────────────────────────────────────────────────────────────────

function humaniseMinutes(min: number | null): string {
  if (min === null || min === undefined) return "—";
  if (min < 60) return `${min} min`;
  if (min < 1440) {
    const h = Math.round(min / 60);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.round(min / 1440);
  return `${d} day${d === 1 ? "" : "s"}`;
}

function humaniseRecurrence(rule: string | null): string {
  if (!rule) return "One-off";
  // Keep the rule as-is for advanced users; trim overly-long RRULEs.
  if (rule.length > 40) return `${rule.slice(0, 37)}…`;
  return rule;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function TaskSettingsClient({
  farmSlug: _farmSlug,
  initialTemplates,
  initialSettings,
}: Props) {
  // farmSlug isn't needed on the client — all routes are cookie-scoped.
  void _farmSlug;

  const [tab, setTab] = useState<TabKey>("templates");

  return (
    <div>
      <div
        role="tablist"
        aria-label="Task settings tabs"
        className="flex gap-1 border-b mb-6"
        style={{ borderColor: "rgba(156,142,122,0.25)" }}
      >
        <TabButton
          tab="templates"
          current={tab}
          onSelect={setTab}
          label="Templates"
        />
        <TabButton
          tab="defaults"
          current={tab}
          onSelect={setTab}
          label="Defaults"
        />
      </div>

      {tab === "templates" ? (
        <TemplatesTab initialTemplates={initialTemplates} />
      ) : (
        <DefaultsTab initialSettings={initialSettings} />
      )}
    </div>
  );
}

function TabButton({
  tab,
  current,
  onSelect,
  label,
}: {
  tab: TabKey;
  current: TabKey;
  onSelect: (t: TabKey) => void;
  label: string;
}) {
  const isActive = tab === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      aria-controls={`tab-panel-${tab}`}
      id={`tab-${tab}`}
      onClick={() => onSelect(tab)}
      className="px-4 py-2 text-sm font-medium transition-colors"
      style={{
        color: isActive ? "#1C1815" : "#9C8E7A",
        borderBottom: isActive ? "2px solid #8B6914" : "2px solid transparent",
        marginBottom: -1,
      }}
    >
      {label}
    </button>
  );
}

// ── Templates tab ──────────────────────────────────────────────────────────

function TemplatesTab({
  initialTemplates,
}: {
  initialTemplates: TaskTemplateRow[];
}) {
  const [rows, setRows] = useState<TaskTemplateRow[]>(initialTemplates);
  const [installing, setInstalling] = useState(false);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaskTemplateRow | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const runInstall = useCallback(async () => {
    setInstalling(true);
    setInstallMessage(null);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/task-templates/install", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
        const code = body.code ?? "INSTALL_FAILED";
        setErrorMessage(
          code === "MISSING_ADMIN_SESSION"
            ? "Please sign in again."
            : code === "FORBIDDEN"
              ? "Only admins can install templates."
              : (body.error ?? "Install failed — try again."),
        );
        return;
      }
      const data = (await res.json()) as { installed: number; skipped: number };
      setInstallMessage(`Installed ${data.installed}, skipped ${data.skipped}.`);
      // Hard reload to refresh the row set from the server. Replaces the row
      // array with fresh data — no mutation.
      window.location.reload();
    } catch {
      setErrorMessage("Network error during install — try again.");
    } finally {
      setInstalling(false);
    }
  }, []);

  const runDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this template? This can't be undone.")) return;
      setErrorMessage(null);
      try {
        const res = await fetch(`/api/task-templates/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
          const code = body.code ?? "DELETE_FAILED";
          setErrorMessage(
            code === "TEMPLATE_NOT_FOUND"
              ? "Template already gone."
              : code === "MISSING_ADMIN_SESSION"
                ? "Please sign in again."
                : code === "FORBIDDEN"
                  ? "Only admins can delete templates."
                  : (body.error ?? "Delete failed — try again."),
          );
          return;
        }
        // Drop row by creating a new array — no in-place splice.
        setRows((prev) => prev.filter((r) => r.id !== id));
      } catch {
        setErrorMessage("Network error during delete — try again.");
      }
    },
    [],
  );

  const onEditSaved = useCallback((updated: TaskTemplateRow) => {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setEditing(null);
  }, []);

  return (
    <div id="tab-panel-templates" role="tabpanel" aria-labelledby="tab-templates">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm" style={{ color: "#6B5E48" }}>
          {rows.length === 0
            ? "No templates yet. Install the SA template pack to get started."
            : `${rows.length} template${rows.length === 1 ? "" : "s"} installed.`}
        </p>
        <button
          type="button"
          onClick={runInstall}
          disabled={installing}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          style={{ background: "#8B6914", color: "#F5EBD4" }}
        >
          {installing ? "Installing…" : "Install template pack"}
        </button>
      </div>

      {installMessage && (
        <div
          role="status"
          className="mb-4 rounded-lg border px-4 py-2 text-sm"
          style={{
            background: "rgba(139,105,20,0.08)",
            borderColor: "rgba(139,105,20,0.3)",
            color: "#1C1815",
          }}
        >
          {installMessage}
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="mb-4 rounded-lg border px-4 py-2 text-sm"
          style={{
            background: "rgba(220,38,38,0.08)",
            borderColor: "rgba(220,38,38,0.4)",
            color: "#b91c1c",
          }}
        >
          {errorMessage}
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "rgba(156,142,122,0.25)" }}>
          <table className="w-full text-sm">
            <thead style={{ background: "rgba(156,142,122,0.08)" }}>
              <tr>
                <Th>Name</Th>
                <Th>Task Type</Th>
                <Th>Recurrence</Th>
                <Th>Reminder</Th>
                <Th>Species</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr
                  key={t.id}
                  className="border-t"
                  style={{ borderColor: "rgba(156,142,122,0.15)" }}
                >
                  <td className="px-3 py-2">
                    <div style={{ color: "#1C1815", fontWeight: 500 }}>{t.name}</div>
                    {t.name_af && (
                      <div className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
                        {t.name_af}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs" style={{ color: "#6B5E48" }}>
                    {t.taskType}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs" style={{ color: "#6B5E48" }}>
                    {humaniseRecurrence(t.recurrenceRule)}
                  </td>
                  <td className="px-3 py-2" style={{ color: "#6B5E48" }}>
                    {humaniseMinutes(t.reminderOffset)}
                  </td>
                  <td className="px-3 py-2" style={{ color: "#6B5E48" }}>
                    {t.species ?? "any"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing(t)}
                        className="text-xs px-2 py-1 rounded border"
                        style={{
                          borderColor: "rgba(139,105,20,0.4)",
                          color: "#8B6914",
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => runDelete(t.id)}
                        className="text-xs px-2 py-1 rounded border"
                        style={{
                          borderColor: "rgba(220,38,38,0.4)",
                          color: "#b91c1c",
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditTemplateDialog
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={onEditSaved}
        />
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider"
      style={{ color: "#6B5E48" }}
    >
      {children}
    </th>
  );
}

function EditTemplateDialog({
  template,
  onClose,
  onSaved,
}: {
  template: TaskTemplateRow;
  onClose: () => void;
  onSaved: (t: TaskTemplateRow) => void;
}) {
  const [name, setName] = useState(template.name);
  const [nameAf, setNameAf] = useState(template.name_af ?? "");
  const [description, setDescription] = useState(template.description ?? "");
  const [priorityDefault, setPriorityDefault] = useState(
    template.priorityDefault ?? "medium",
  );
  const [reminderOffset, setReminderOffset] = useState<string>(
    template.reminderOffset === null ? "" : String(template.reminderOffset),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);
      setError(null);

      // Build immutable patch payload — only send changed fields.
      const patch: Record<string, unknown> = {};
      if (name !== template.name) patch.name = name;
      if ((nameAf || null) !== template.name_af)
        patch.name_af = nameAf.trim() ? nameAf : null;
      if ((description || null) !== template.description)
        patch.description = description.trim() ? description : null;
      if (priorityDefault !== template.priorityDefault)
        patch.priorityDefault = priorityDefault;

      const parsedReminder = reminderOffset.trim() ? Number(reminderOffset) : null;
      if (parsedReminder !== template.reminderOffset) {
        patch.reminderOffset = parsedReminder;
      }

      if (Object.keys(patch).length === 0) {
        setSaving(false);
        onClose();
        return;
      }

      try {
        const res = await fetch(`/api/task-templates/${template.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
          const code = body.code ?? "PATCH_FAILED";
          setError(
            code === "INVALID_FIELD"
              ? (body.error ?? "Invalid field value.")
              : code === "MISSING_ADMIN_SESSION"
                ? "Please sign in again."
                : code === "FORBIDDEN"
                  ? "Only admins can edit templates."
                  : code === "TEMPLATE_NOT_FOUND"
                    ? "Template not found — it may have been deleted."
                    : (body.error ?? "Save failed — try again."),
          );
          setSaving(false);
          return;
        }
        const updated = (await res.json()) as TaskTemplateRow;
        onSaved(updated);
      } catch {
        setError("Network error — try again.");
        setSaving(false);
      }
    },
    [name, nameAf, description, priorityDefault, reminderOffset, template, onClose, onSaved],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-template-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl"
        style={{ border: "1px solid rgba(156,142,122,0.2)" }}
      >
        <h2
          id="edit-template-title"
          className="text-lg font-semibold mb-4"
          style={{ color: "#1C1815" }}
        >
          Edit template
        </h2>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded border px-3 py-2 text-sm"
              style={{ borderColor: "rgba(156,142,122,0.4)" }}
            />
          </Field>
          <Field label="Name (Afrikaans)">
            <input
              type="text"
              value={nameAf}
              onChange={(e) => setNameAf(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm"
              style={{ borderColor: "rgba(156,142,122,0.4)" }}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded border px-3 py-2 text-sm"
              style={{ borderColor: "rgba(156,142,122,0.4)" }}
            />
          </Field>
          <Field label="Priority default">
            <select
              value={priorityDefault}
              onChange={(e) => setPriorityDefault(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm"
              style={{ borderColor: "rgba(156,142,122,0.4)" }}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Field>
          <Field label="Reminder offset (minutes)">
            <input
              type="number"
              min={0}
              value={reminderOffset}
              onChange={(e) => setReminderOffset(e.target.value)}
              placeholder="Leave blank for no reminder"
              className="w-full rounded border px-3 py-2 text-sm"
              style={{ borderColor: "rgba(156,142,122,0.4)" }}
            />
          </Field>

          {error && (
            <div
              role="alert"
              className="rounded-lg border px-3 py-2 text-sm"
              style={{
                background: "rgba(220,38,38,0.08)",
                borderColor: "rgba(220,38,38,0.4)",
                color: "#b91c1c",
              }}
            >
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded border"
              style={{ borderColor: "rgba(156,142,122,0.4)", color: "#6B5E48" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm rounded font-medium disabled:opacity-50"
              style={{ background: "#8B6914", color: "#F5EBD4" }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium" style={{ color: "#6B5E48" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

// ── Defaults tab ───────────────────────────────────────────────────────────

function DefaultsTab({ initialSettings }: { initialSettings: FarmTaskSettings }) {
  const [settings, setSettings] = useState<FarmTaskSettings>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const update = useCallback(<K extends keyof FarmTaskSettings>(
    key: K,
    value: FarmTaskSettings[K],
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setStatus("idle");
  }, []);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);
      setErrorMessage(null);
      try {
        const res = await fetch("/api/farm-settings/tasks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settings),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
          const code = body.code ?? "SAVE_FAILED";
          setErrorMessage(
            code === "INVALID_FIELD"
              ? (body.error ?? "Invalid value.")
              : code === "MISSING_ADMIN_SESSION"
                ? "Please sign in again."
                : code === "FORBIDDEN"
                  ? "Only admins can change task defaults."
                  : (body.error ?? "Save failed — try again."),
          );
          setStatus("error");
          return;
        }
        const next = (await res.json()) as FarmTaskSettings;
        setSettings(next);
        setStatus("saved");
      } catch {
        setErrorMessage("Network error — try again.");
        setStatus("error");
      } finally {
        setSaving(false);
      }
    },
    [settings],
  );

  return (
    <form
      id="tab-panel-defaults"
      role="tabpanel"
      aria-labelledby="tab-defaults"
      onSubmit={onSubmit}
      className="flex flex-col gap-4 max-w-lg"
    >
      <Field label="Default reminder offset (minutes before due)">
        <input
          type="number"
          min={0}
          max={10080}
          value={settings.defaultReminderOffset}
          onChange={(e) =>
            update("defaultReminderOffset", Math.max(0, Number(e.target.value) || 0))
          }
          className="w-full rounded border px-3 py-2 text-sm"
          style={{ borderColor: "rgba(156,142,122,0.4)" }}
        />
        <span className="text-xs" style={{ color: "#9C8E7A" }}>
          {humaniseMinutes(settings.defaultReminderOffset)}
        </span>
      </Field>

      <label className="flex items-center gap-3 py-1 cursor-pointer">
        <input
          type="checkbox"
          checked={settings.autoObservation}
          onChange={(e) => update("autoObservation", e.target.checked)}
        />
        <span className="flex flex-col">
          <span className="text-sm font-medium" style={{ color: "#1C1815" }}>
            Auto-observation on completion
          </span>
          <span className="text-xs" style={{ color: "#9C8E7A" }}>
            When enabled, completing a task with a valid payload auto-creates the matching observation.
          </span>
        </span>
      </label>

      <Field label="Occurrence materialisation horizon">
        <select
          value={settings.horizonDays}
          onChange={(e) =>
            update("horizonDays", Number(e.target.value) as FarmTaskSettings["horizonDays"])
          }
          className="w-full rounded border px-3 py-2 text-sm"
          style={{ borderColor: "rgba(156,142,122,0.4)" }}
        >
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
        </select>
      </Field>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-lg border px-3 py-2 text-sm"
          style={{
            background: "rgba(220,38,38,0.08)",
            borderColor: "rgba(220,38,38,0.4)",
            color: "#b91c1c",
          }}
        >
          {errorMessage}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm rounded font-medium disabled:opacity-50"
          style={{ background: "#8B6914", color: "#F5EBD4" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {status === "saved" && (
          <span className="text-xs" style={{ color: "#0f766e" }}>
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}
