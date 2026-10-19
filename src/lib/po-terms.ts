/**
 * The Terms & Conditions every PO starts with — one term per line. Each PO
 * keeps its own copy (purchase_orders.terms_conditions, whose column default
 * is this same text, set in migration 0103), so editing this list later only
 * changes what *new* POs start with and the editor's "Reset to default";
 * POs already raised keep the text they were sent with.
 */
export const DEFAULT_PO_TERMS = [
  "The material is accepted subject to inspection. Please mention our PO no. on your delivery challan & Invoice.",
  "The material should be labelled with it's grade, Batch/Lot No., MFG/Expiry date.",
  "The MTC (Material Test Certificate) should be sent along with the supply.",
  "The failure due to poor work man ship or any other defect shall be replace free of cost with in the warranty period.",
  "PO price are firm and final till the exection of contract, no escalation or reqest in increase the price will be entertain.",
  "The seller shall be liable to pay to buyer LD, a sum equivalent to 0.5% of the Ex work contract value for each week of delay or any part thereof. However, total amount of LD for delay in completion of contract shall be subject to a maximum of 5% fo Ex work contract price.",
].join("\n");

/** Normalises textarea input the same way on every save path, so an untouched box never counts as a change. */
export function normalizePoTerms(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
}

/** The printed numbered list: one point per non-blank line. */
export function poTermsLines(terms: string | null | undefined): string[] {
  return (terms ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
