"use client";

/**
 * src/components/admin/upload-form.tsx
 *
 * PR 003C — Client component for the monthly board report upload form.
 *
 * Responsibilities (UI-only — the auth gate and pipeline live server-side):
 *   - Single-file picker, .xlsx only.
 *   - Double-submit guard via isUploading state.
 *   - POST multipart/form-data to /api/admin/upload.
 *   - Render feedback via formatUploadResponse() (pure mapper module).
 *   - On success, reset the file input and trigger router.refresh()
 *     so the history table re-renders with the new row.
 */
import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  formatUploadResponse,
  type Feedback,
} from "@/lib/upload/format-upload-feedback";
import { getDict } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locale";

const ACCEPT = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function UploadForm({ locale = "en" }: { locale?: Locale }) {
  const t = getDict(locale).upload;
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [, startTransition] = useTransition();

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    // Selecting a new file clears any prior feedback so the user is not
    // confused by a stale success/error banner.
    if (feedback) setFeedback(null);
  }, [feedback]);

  const handleSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file || isUploading) return;

    setIsUploading(true);
    setFeedback(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        body: formData,
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        // Body wasn't JSON (HTML error page from upstream proxy, network blip).
        body = { error: "non_json_response", message: "Server returned a non-JSON response." };
      }
      const fb = formatUploadResponse(res.status, body, locale);
      setFeedback(fb);

      if (fb.kind === "success") {
        // Clear the file input so the operator doesn't accidentally re-submit
        // the same file with a click. Refresh the route so the history table
        // picks up the new row without a full reload.
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        startTransition(() => router.refresh());
      }
    } catch (err) {
      // Network-level failure before the server could respond.
      setFeedback({
        kind: "error",
        severity: "error",
        title: t.networkErrorTitle,
        body:
          err instanceof Error
            ? t.networkErrorBody(err.message)
            : t.networkErrorBodyGeneric,
      });
    } finally {
      setIsUploading(false);
    }
  }, [file, isUploading, router, t]);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label
          htmlFor="upload-file"
          className="block text-[11px] uppercase tracking-wider text-gray-500 mb-2"
        >
          {t.fileLabel}
        </label>
        <input
          ref={fileInputRef}
          id="upload-file"
          name="file"
          type="file"
          accept={ACCEPT}
          required
          disabled={isUploading}
          onChange={handleFileChange}
          className="block w-full text-sm text-gray-900 border border-gray-300 rounded-sm bg-white file:mr-4 file:py-2 file:px-4 file:border-0 file:bg-navy file:text-white file:text-sm file:font-medium hover:file:bg-navy-deep cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        />
        {file && (
          <p className="mt-2 text-xs text-gray-500">
            {t.selectedPrefix} <span className="font-medium text-navy">{file.name}</span>{" "}
            ({(file.size / 1024).toLocaleString(locale === "es" ? "es-ES" : "en-US", { maximumFractionDigits: 1 })} KB)
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!file || isUploading}
          aria-busy={isUploading}
          className="inline-flex items-center justify-center gap-2 bg-navy hover:bg-navy-deep text-white font-medium text-sm px-5 py-2.5 rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isUploading && (
            <svg
              aria-hidden="true"
              className="animate-spin h-4 w-4 text-white"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
              <path d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" fill="currentColor" />
            </svg>
          )}
          {isUploading ? t.uploading : t.uploadBtn}
        </button>
        {isUploading && (
          <span className="text-xs text-gray-500 italic">
            {t.parsingNote}
          </span>
        )}
      </div>

      {feedback && (
        <FeedbackBanner feedback={feedback} />
      )}
    </form>
  );
}

function FeedbackBanner({ feedback }: { feedback: Feedback }) {
  const palette = (() => {
    switch (feedback.severity) {
      case "success":
        return "bg-emerald-50 border-emerald-200 text-emerald-900";
      case "warn":
        return "bg-amber-50 border-amber-200 text-amber-900";
      case "error":
      default:
        return "bg-red-50 border-red-200 text-red-900";
    }
  })();

  return (
    <div
      role={feedback.kind === "error" ? "alert" : "status"}
      aria-live="polite"
      className={`border rounded-sm px-4 py-3 ${palette}`}
    >
      <div className="font-semibold text-sm">{feedback.title}</div>
      <div className="text-sm mt-1">{feedback.body}</div>
      {feedback.details && feedback.details.length > 0 && (
        <ul className="text-xs mt-2 list-disc list-inside space-y-1">
          {feedback.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
