"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { QrScanner } from "@/components/qr-scanner";
import { TraceabilityResult } from "./traceability-result";
import type { Traceability } from "@/lib/traceability";

export function TraceabilityScanner({
  lookupAction,
  finance,
}: {
  lookupAction: (lotCode: string) => Promise<{ ok?: true; error?: string; data?: unknown; redirect?: string }>;
  finance: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Traceability | null>(null);

  async function onDetect(code: string) {
    setPending(true);
    setError(null);
    setResult(null);
    const res = await lookupAction(code);
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    if (res?.redirect) { router.push(res.redirect); return; }
    setResult(res.data as Traceability);
  }

  return (
    <div className="space-y-6">
      <QrScanner onDetect={onDetect} pending={pending} />
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {result && <TraceabilityResult data={result} finance={finance} />}
    </div>
  );
}
