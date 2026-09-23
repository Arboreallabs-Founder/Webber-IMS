import type { ReactNode } from "react";

const MRIN_OUR = {
  tagline: "[Add company tagline]",
  address: "[Add company address]",
  formatNo: "WEC/MRIN/001",
  rev: "Rev.00",
  formDate: "28.07.2026",
};

/**
 * The MRIN (Material Receipt cum Inspection Note) form header, matching the
 * real GRN print's header exactly — used by the Inspection Template's blank
 * preview print so the two always look identical apart from the info-grid
 * values.
 *
 * print:fixed so it's re-emitted on every physical printed page (this app's
 * <thead> repeat-on-page-break never worked here — tried plain markup, no
 * flex/grid, inline border-collapse override, prod build, nothing repeated
 * it — position:fixed is the one mechanism that reliably does).
 */
export function MrinHeader({ title, fields }: { title: string; fields: { label: string; value: ReactNode }[] }) {
  return (
    <div className="border border-black text-[10px] leading-tight print:fixed print:inset-x-0 print:top-0 print:z-10 print:border-0 print:bg-white">
      <div className="flex items-start justify-between border-b border-black p-3">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/webber-masthead.png" alt="Webber Electro Corp" className="h-10 w-auto object-contain" />
          <div>
            <p className="mt-0.5 max-w-md text-[9px]">{MRIN_OUR.tagline}</p>
            <p className="text-[9px]">{MRIN_OUR.address}</p>
          </div>
        </div>
        <div className="whitespace-nowrap text-right text-[9px] leading-snug">
          <p>Format No.: {MRIN_OUR.formatNo}</p>
          <p>{MRIN_OUR.rev}</p>
          <p>Date : {MRIN_OUR.formDate}</p>
        </div>
      </div>
      <h1 className="border-b border-black py-2 text-center text-base font-bold">{title}</h1>
      <div className="grid grid-cols-4 divide-x divide-black border-b border-black">
        {fields.map((f) => (
          <div key={f.label} className="p-2">
            <span className="font-semibold">{f.label}:</span> {f.value}
          </div>
        ))}
      </div>
    </div>
  );
}
