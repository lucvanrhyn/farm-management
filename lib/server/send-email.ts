// lib/server/send-email.ts — Phase J generalised email helper (J4a).
//
// Purpose: single lazy-Resend + per-template renderer registry. Extracts the
// pattern from lib/email-verification.ts so the alert digest, verification
// email, quote email, and consulting lead email all share one transport —
// and the "missing RESEND_API_KEY" branch is uniform (warn + skip, don't
// throw) per memory/silent-failure-pattern.md.
//
// Backward compatibility: lib/email-verification.ts continues to export
// sendVerificationEmail with its existing signature. That export now
// delegates to sendEmail({ template: "verify-email", ... }) so the on-the-
// wire HTML and subject line remain identical.

import { Resend } from "resend";
import { logger } from "@/lib/logger";

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function getFrom(): string {
  return process.env.EMAIL_FROM ?? "FarmTrack <noreply@farmtrack.app>";
}

function getBaseUrl(): string {
  return process.env.NEXTAUTH_URL ?? "https://farm-management-lilac.vercel.app";
}

export type EmailTemplate =
  | "verify-email"
  | "alert-digest"
  | "quote"
  | "consulting-lead";

export interface SendEmailOptions<T = Record<string, unknown>> {
  to: string;
  template: EmailTemplate;
  data: T;
  subject?: string;
  from?: string;
}

export interface SendEmailResult {
  sent: boolean;
  skipped?: "no-api-key" | "no-recipient";
  id?: string;
  error?: string;
}

// ── Template registry ───────────────────────────────────────────────────────

interface Rendered {
  subject: string;
  html: string;
}

type Renderer = (data: Record<string, unknown>) => Rendered;

const verifyEmailRenderer: Renderer = (data) => {
  const token = String(data.token ?? "");
  const verifyUrl = `${getBaseUrl()}/verify-email?token=${token}`;
  return {
    subject: "Verify your FarmTrack account",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h1 style="color: #1A1510; font-size: 24px;">Welcome to FarmTrack</h1>
        <p style="color: #4A3A2A; font-size: 16px; line-height: 1.5;">
          Click the button below to verify your email address and activate your account.
        </p>
        <a href="${verifyUrl}" style="
          display: inline-block;
          background: #8B6914;
          color: #F0DEB8;
          padding: 12px 24px;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 500;
          margin: 16px 0;
        ">Verify Email</a>
        <p style="color: #8A8A8A; font-size: 13px; margin-top: 24px;">
          This link expires in 24 hours. If you didn't create a FarmTrack account, ignore this email.
        </p>
      </div>
    `,
  };
};

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface DigestGroup {
  category: string;
  items: Array<{ message: string; href: string; severity: string }>;
}

const alertDigestRenderer: Renderer = (data) => {
  const farmSlug = String(data.farmSlug ?? "");
  const farmName = String(data.farmName ?? farmSlug);
  const groups = Array.isArray(data.groups) ? (data.groups as DigestGroup[]) : [];
  const baseUrl = getBaseUrl();

  const sectionsHtml = groups
    .map((g) => {
      const items = g.items
        .map((item) => {
          const color = item.severity === "red" ? "#B91C1C" : "#B45309";
          const href = item.href.startsWith("http")
            ? item.href
            : `${baseUrl}/${farmSlug}${item.href.startsWith("/") ? "" : "/"}${item.href}`;
          return `<li style="margin:6px 0;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:8px;"></span>
            <a href="${href}" style="color:#1A1510;text-decoration:none;">${escapeHtml(item.message)}</a>
          </li>`;
        })
        .join("");
      return `<div style="margin:16px 0;">
        <h2 style="font-size:15px;color:#4A3A2A;margin:8px 0;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(g.category)}</h2>
        <ul style="list-style:none;padding:0;margin:0;">${items}</ul>
      </div>`;
    })
    .join("");

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return {
    subject: `FarmTrack daily digest — ${total} alert${total === 1 ? "" : "s"} for ${farmName}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#1A1510;">
        <h1 style="font-size:22px;margin:0 0 4px;">Daily alert digest</h1>
        <p style="color:#6B5B43;margin:0 0 16px;">${escapeHtml(farmName)} · ${total} open alert${total === 1 ? "" : "s"}</p>
        ${sectionsHtml || "<p style='color:#8A8A8A;'>No open alerts. Nice work.</p>"}
        <p style="color:#8A8A8A;font-size:12px;margin-top:32px;">
          You received this digest because alert emails are enabled on your FarmTrack account.
          Change preferences at <a href="${baseUrl}/${farmSlug}/admin/settings/alerts">/${farmSlug}/admin/settings/alerts</a>.
        </p>
      </div>
    `,
  };
};

const quoteRenderer: Renderer = (data) => {
  const subject = String(data.subject ?? "FarmTrack quote");
  const body = String(data.body ?? "");
  return {
    subject,
    html: `<div style="font-family:sans-serif;white-space:pre-wrap;">${escapeHtml(body)}</div>`,
  };
};

const consultingLeadRenderer: Renderer = (data) => {
  const name = String(data.name ?? "");
  const email = String(data.email ?? "");
  return {
    subject: `New consulting lead: ${name}`,
    html: `<div style="font-family:sans-serif;">
      <p>New FarmTrack consulting lead:</p>
      <ul>
        <li>Name: ${escapeHtml(name)}</li>
        <li>Email: ${escapeHtml(email)}</li>
      </ul>
    </div>`,
  };
};

const RENDERERS: Record<EmailTemplate, Renderer> = {
  "verify-email": verifyEmailRenderer,
  "alert-digest": alertDigestRenderer,
  quote: quoteRenderer,
  "consulting-lead": consultingLeadRenderer,
};

// ── Public API ──────────────────────────────────────────────────────────────

export async function sendEmail(
  opts: SendEmailOptions,
): Promise<SendEmailResult> {
  if (!opts.to) return { sent: false, skipped: "no-recipient" };
  const resend = getResend();
  if (!resend) {
    logger.warn('[send-email] RESEND_API_KEY missing — skipping template', { template: opts.template });
    return { sent: false, skipped: "no-api-key" };
  }
  const renderer = RENDERERS[opts.template];
  if (!renderer) {
    // Shouldn't happen at runtime because EmailTemplate is a union, but defend
    // against runtime callers with weaker types (e.g. JSON-driven sends).
    return { sent: false, error: `Unknown template: ${opts.template}` };
  }
  const rendered = renderer(opts.data as Record<string, unknown>);
  try {
    const res = await resend.emails.send({
      from: opts.from ?? getFrom(),
      to: opts.to,
      subject: opts.subject ?? rendered.subject,
      html: rendered.html,
    });
    // Resend SDK returns { data, error } in v4+; treat data.id as the id, error
    // as a failure signal.
    const anyRes = res as unknown as { data?: { id?: string }; error?: unknown };
    if (anyRes.error) {
      return {
        sent: false,
        error: anyRes.error instanceof Error ? anyRes.error.message : String(anyRes.error),
      };
    }
    return { sent: true, id: anyRes.data?.id };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Exported for the digest-email module to type-check its group shape.
export type { DigestGroup };
