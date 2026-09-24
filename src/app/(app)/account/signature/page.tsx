import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { SignatureManager } from "./signature-manager";
import { PushNotificationsToggle } from "../push-notifications-toggle";

export default async function MySignaturePage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data: signatures } = await supabase
    .from("signatures")
    .select("*")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <Link href="/" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Home
      </Link>
      <PageHeader
        title="My Signature"
        description="Saved here, used to sign off Purchase Orders and GRNs."
      />
      <SignatureManager signatures={signatures ?? []} />

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Notifications
      </h2>
      <PushNotificationsToggle />
    </div>
  );
}
