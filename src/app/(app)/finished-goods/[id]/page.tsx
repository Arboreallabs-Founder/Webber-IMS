import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canSeeFinancials, requirePathAccess } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QrCode } from "@/components/qr-code";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDate, formatINR, formatNumber } from "@/lib/utils";

/**
 * One finished good — what its QR opens. Shows the project and dispatch it
 * went out with, and every component in it down to the lots used, each lot
 * linking on to its own traceability (GRN, PO, vendor, inspection).
 */
export default async function FinishedGoodPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePathAccess("/finished-goods");
  const { id } = await params;
  const profile = await getProfile();
  const finance = canSeeFinancials(profile?.role);
  const supabase = await createClient();

  const { data: fg } = await supabase.from("finished_goods").select("*").eq("id", id).maybeSingle();
  if (!fg) notFound();

  const [{ data: project }, { data: product }, { data: dispatch }, { data: lines }] = await Promise.all([
    fg.project_id ? supabase.from("projects").select("id, project_no").eq("id", fg.project_id).maybeSingle() : Promise.resolve({ data: null }),
    fg.product_id ? supabase.from("products").select("sku_code, model_name").eq("id", fg.product_id).maybeSingle() : Promise.resolve({ data: null }),
    fg.dispatch_id
      ? supabase.from("dispatches").select("dispatch_no, dispatch_date, challan_no, vehicle_no").eq("id", fg.dispatch_id).maybeSingle()
      : Promise.resolve({ data: null }),
    fg.dispatch_id
      ? supabase.from("dispatch_lines").select("component_id, lot_id, qty").eq("dispatch_id", fg.dispatch_id)
      : Promise.resolve({ data: [] }),
  ]);

  const componentIds = [...new Set((lines ?? []).map((l) => l.component_id))];
  const lotIds = [...new Set((lines ?? []).map((l) => l.lot_id))];
  const [{ data: comps }, { data: lots }, { data: rates }, { count: unitsInDispatch }] = await Promise.all([
    componentIds.length ? supabase.from("components").select("id, component_no, name, uom").in("id", componentIds) : Promise.resolve({ data: [] }),
    lotIds.length ? supabase.from("inventory_lots").select("id, lot_code, source_lot_id").in("id", lotIds) : Promise.resolve({ data: [] }),
    finance && lotIds.length ? supabase.from("v_lot_rates").select("lot_id, rate").in("lot_id", lotIds) : Promise.resolve({ data: [] }),
    fg.dispatch_id
      ? supabase.from("finished_goods").select("id", { count: "exact", head: true }).eq("dispatch_id", fg.dispatch_id)
      : Promise.resolve({ count: 0 }),
  ]);
  // A reserved slice is labelled with the box it sits in — the sticker that was scanned.
  const sourceIds = [...new Set((lots ?? []).map((l) => l.source_lot_id).filter((v): v is string => !!v))];
  const { data: sourceLots } = sourceIds.length
    ? await supabase.from("inventory_lots").select("id, lot_code").in("id", sourceIds)
    : { data: [] };
  const sourceCode = new Map((sourceLots ?? []).map((l) => [l.id, l.lot_code]));
  const lotCode = new Map((lots ?? []).map((l) => [l.id, l.source_lot_id ? sourceCode.get(l.source_lot_id) ?? l.lot_code : l.lot_code]));
  const compById = new Map((comps ?? []).map((c) => [c.id, c]));
  const rateByLot = new Map((rates ?? []).map((r) => [r.lot_id, Number(r.rate ?? 0)]));

  const byComponent = new Map<string, { qty: number; value: number; lots: { code: string; qty: number }[] }>();
  for (const l of lines ?? []) {
    const cur = byComponent.get(l.component_id) ?? { qty: 0, value: 0, lots: [] };
    cur.qty += Number(l.qty);
    cur.value += Number(l.qty) * (rateByLot.get(l.lot_id) ?? 0);
    cur.lots.push({ code: lotCode.get(l.lot_id) ?? "—", qty: Number(l.qty) });
    byComponent.set(l.component_id, cur);
  }
  const rows = [...byComponent]
    .map(([cid, v]) => ({ cid, comp: compById.get(cid), ...v }))
    .sort((a, b) => (a.comp?.component_no ?? "").localeCompare(b.comp?.component_no ?? ""));
  const total = rows.reduce((s, r) => s + r.value, 0);

  const name = fg.custom_name ?? (product ? `${product.sku_code} — ${product.model_name}` : "Finished good");

  return (
    <div>
      <Link href="/finished-goods" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All finished goods
      </Link>
      <PageHeader title={fg.serial_no} description={name} action={<Badge variant={fg.status === "dispatched" ? "success" : "secondary"}>{fg.status.replace("_", " ")}</Badge>} />

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-start gap-6 p-5 text-sm">
          <QrCode value={fg.serial_no} size={96} />
          <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Info label="Project" value={project ? <Link href={`/projects/${project.id}`} className="text-primary hover:underline">{project.project_no}</Link> : "—"} />
            <Info label="Logged" value={formatDate(fg.created_at)} />
            <Info label="Dispatch" value={dispatch?.dispatch_no ?? "Not dispatched"} />
            <Info label="Dispatch date" value={dispatch ? formatDate(dispatch.dispatch_date) : "—"} />
            <Info label="Challan / invoice" value={dispatch?.challan_no ?? "—"} />
            <Info label="Vehicle" value={dispatch?.vehicle_no ?? "—"} />
          </div>
        </CardContent>
      </Card>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Components</h2>
      {!dispatch ? (
        <p className="text-sm text-muted-foreground">
          Not dispatched yet — its components are attached when it is dispatched from the project&apos;s Materials issued tab.
        </p>
      ) : (
        <>
          {(unitsInDispatch ?? 0) > 1 && (
            <p className="mb-3 text-sm text-muted-foreground">
              Shipped together with {(unitsInDispatch ?? 1) - 1} other unit(s) in {dispatch.dispatch_no}; this list covers the whole dispatch.
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Component</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Lots used</TableHead>
                {finance && <TableHead>Value</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.cid}>
                  <TableCell className="font-medium">{r.comp ? `${r.comp.component_no} — ${r.comp.name}` : "—"}</TableCell>
                  <TableCell>{formatNumber(r.qty)} {r.comp?.uom ?? ""}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {r.lots.map((l, i) => (
                        <Link key={i} href={`/traceability/${encodeURIComponent(l.code)}`} className="font-mono text-xs text-primary hover:underline">
                          {l.code}{r.lots.length > 1 ? ` ×${formatNumber(l.qty)}` : ""}
                        </Link>
                      ))}
                    </div>
                  </TableCell>
                  {finance && <TableCell>{formatINR(r.value)}</TableCell>}
                </TableRow>
              ))}
              {finance && rows.length > 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-right font-semibold">Total</TableCell>
                  <TableCell className="font-semibold">{formatINR(total)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}
