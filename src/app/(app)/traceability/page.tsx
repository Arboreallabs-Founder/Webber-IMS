import { PageHeader } from "@/components/page-header";
import { getProfile, canSeeFinancials } from "@/lib/auth";
import { TraceabilityScanner } from "./traceability-scanner";
import { lookupTraceability } from "./actions";

export default async function TraceabilityPage() {
  const profile = await getProfile();
  const finance = canSeeFinancials(profile?.role);

  return (
    <div>
      <PageHeader
        title="Traceability"
        description="Scan a component's QR to see its full history — PO, supplier, inspection (IRN), and consumption."
      />
      <TraceabilityScanner lookupAction={lookupTraceability} finance={finance} />
    </div>
  );
}
