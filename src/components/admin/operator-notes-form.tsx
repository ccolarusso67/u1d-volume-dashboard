"use client";

/**
 * src/components/admin/operator-notes-form.tsx
 *
 * Client component for the operator-notes editor.
 *
 * Three actions:
 *   - Save draft      → POST mode=draft
 *   - Mark complete   → POST mode=mark_complete (server refuses if any
 *                       section is blank after merge)
 *   - Reopen          → POST mode=reopen (clears completed_at/_by)
 *
 * Posts JSON, parses response, surfaces inline feedback.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OperatorNotes, SectionKey } from "@/lib/operator-notes/types";
import { SECTION_KEYS, SECTION_LABELS } from "@/lib/operator-notes/types";

type Feedback =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

export function OperatorNotesForm({
  year,
  month,
  initialNotes,
}: {
  year: number;
  month: number;
  initialNotes: OperatorNotes;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<SectionKey, string>>(() =>
    Object.fromEntries(
      SECTION_KEYS.map((k) => [k, initialNotes.sections[k] ?? ""])
    ) as Record<SectionKey, string>
  );
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });
  const [, startTransition] = useTransition();

  const isLocked = initialNotes.is_complete;

  async function submit(mode: "draft" | "mark_complete" | "reopen") {
    setFeedback({ kind: "saving" });
    try {
      const sections =
        mode === "reopen"
          ? {} // reopen does not need section deltas
          : Object.fromEntries(
              SECTION_KEYS.map((k) => [k, values[k] ?? ""])
            );
      const res = await fetch(`/api/admin/operator-notes/${year}/${month}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, sections }),
      });
      const j = (await res.json()) as {
        ok: boolean;
        reason?: string;
        notes?: OperatorNotes;
      };
      if (!res.ok || !j.ok) {
        const msg =
          j.reason === "sections_incomplete"
            ? "Cannot mark complete: all five sections must have content."
            : j.reason ?? `HTTP ${res.status}`;
        setFeedback({ kind: "error", message: msg });
        return;
      }
      const successMsg =
        mode === "mark_complete"
          ? "Notes marked complete. The period can be locked once alerts are resolved."
          : mode === "reopen"
          ? "Notes reopened. Edit and mark complete again to re-lock the period."
          : "Draft saved.";
      setFeedback({ kind: "ok", message: successMsg });
      // Reflect server-truth sections back into the form (server may have
      // normalized whitespace).
      if (j.notes?.sections) {
        setValues(
          Object.fromEntries(
            SECTION_KEYS.map((k) => [k, j.notes!.sections[k] ?? ""])
          ) as Record<SectionKey, string>
        );
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  const saving = feedback.kind === "saving";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit("draft");
      }}
      className="space-y-5"
    >
      {SECTION_KEYS.map((k) => (
        <div key={k}>
          <label
            htmlFor={`section-${k}`}
            className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1"
          >
            {SECTION_LABELS[k]}
          </label>
          <textarea
            id={`section-${k}`}
            value={values[k] ?? ""}
            disabled={saving}
            onChange={(e) =>
              setValues((s) => ({ ...s, [k]: e.target.value }))
            }
            rows={6}
            className="block w-full text-sm font-mono border border-gray-300 rounded-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-navy/30 disabled:opacity-60"
            placeholder={`Markdown for ${SECTION_LABELS[k]}…`}
          />
          <div className="text-[11px] text-gray-400 mt-1 tabular-nums">
            {(values[k] ?? "").trim().length} chars
            {((values[k] ?? "").trim().length === 0) && (
              <span className="text-amber-700 ml-2">required for completion</span>
            )}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-3 items-center pt-2 border-t border-gray-100">
        <button
          type="submit"
          disabled={saving}
          className="bg-gray-100 hover:bg-gray-200 text-navy text-sm font-medium px-4 py-2 rounded-sm disabled:opacity-50"
        >
          Save draft
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => submit("mark_complete")}
          className="bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium px-4 py-2 rounded-sm disabled:opacity-50"
        >
          Mark complete
        </button>
        {isLocked && (
          <button
            type="button"
            disabled={saving}
            onClick={() => submit("reopen")}
            className="bg-white text-amber-900 border border-amber-300 hover:bg-amber-50 text-sm font-medium px-4 py-2 rounded-sm disabled:opacity-50"
          >
            Reopen for editing
          </button>
        )}
        {feedback.kind === "saving" && (
          <span className="text-xs text-gray-500 italic">Saving…</span>
        )}
      </div>

      {feedback.kind === "ok" && (
        <div
          role="status"
          className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-sm px-4 py-3 text-sm"
        >
          {feedback.message}
        </div>
      )}
      {feedback.kind === "error" && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 text-red-900 rounded-sm px-4 py-3 text-sm"
        >
          {feedback.message}
        </div>
      )}
    </form>
  );
}
