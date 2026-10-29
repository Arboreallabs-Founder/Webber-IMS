import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Indian-style number formatting for amounts (₹). */
export function formatINR(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN").format(value);
}

/**
 * Every date is shown in India time. Without a fixed zone the server (UTC on
 * Vercel) and the browser render different text — a hydration mismatch, and
 * server-rendered times 5½ hours off.
 */
export const APP_TIME_ZONE = "Asia/Kolkata";

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  });
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
  });
}

/** "PN-1234 — Acme Corp" (or just the project no. if no customer is tagged). */
export function projectLabel(p: { project_no: string; customer_name?: string | null }) {
  return p.customer_name ? `${p.project_no} — ${p.customer_name}` : p.project_no;
}
