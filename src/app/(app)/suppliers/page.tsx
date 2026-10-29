import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatNumber } from "@/lib/utils";
import { requirePathAccess } from "@/lib/auth";

function pct(n: number, d: number): string {
  if (!d) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

export default async function SuppliersPage() {
  await requirePathAccess("/suppliers");
  const supabase = await createClient();
  const { data } = await supabase.from("v_supplier_kpi").select("*");
  const rows = (data ?? []).sort((a, b) => Number(b.total_lines ?? 0) - Number(a.total_lines ?? 0));

  return (
    <div>
      <PageHeader title="Supplier KPIs" description="Vendor scorecard — fulfilment, on-time delivery, lead time. (Price-trend coming later.)" />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Vendor</TableHead>
            <TableHead>POs</TableHead>
            <TableHead>Open</TableHead>
            <TableHead>Completed</TableHead>
            <TableHead>Fulfilled lines</TableHead>
            <TableHead>On-time</TableHead>
            <TableHead>Avg lead</TableHead>
            <TableHead>Rating</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No vendor activity yet.</TableCell></TableRow>
          ) : (
            rows.map((r) => {
              const onTimeDen = Number(r.on_time_lines ?? 0) + Number(r.late_lines ?? 0);
              const onTime = pct(Number(r.on_time_lines ?? 0), onTimeDen);
              const fulfilled = pct(Number(r.received_lines ?? 0), Number(r.total_lines ?? 0));
              return (
                <TableRow key={r.vendor_id}>
                  <TableCell className="font-medium">
                    <Link href={`/masters/vendors/${r.vendor_id}`} className="text-primary hover:underline">{r.name}</Link>
                  </TableCell>
                  <TableCell>{formatNumber(r.total_pos)}</TableCell>
                  <TableCell>{formatNumber(r.open_pos)}</TableCell>
                  <TableCell>{formatNumber(r.completed_pos)}</TableCell>
                  <TableCell>{fulfilled} <span className="text-xs text-muted-foreground">({formatNumber(r.received_lines)}/{formatNumber(r.total_lines)})</span></TableCell>
                  <TableCell>
                    {onTimeDen === 0 ? <span className="text-muted-foreground">—</span>
                      : <Badge variant={Number(r.on_time_lines) >= Number(r.late_lines) ? "success" : "destructive"}>{onTime}</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.avg_lead_time_days ? `${r.avg_lead_time_days}d` : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{r.rating ?? "—"}</TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
