# changs — reserved slices, scan-the-lot consumption and auto-release

2026-10-02 · migration `0098_reserved_slices_and_auto_release`

## Why

Blocked stock is now found by scanning the box it sits in, and reservations a project no longer needs go back to open stock on their own. Before this change, two things went wrong:

- **Partial blocks became unscannable.** Blocking part of a box (say 3 of 10) split the 3 into a new lot with no sticker and no link to the box. The floor team only scans the box sticker, so the blocked 3 could never be found or consumed.
- **Unneeded reservations never came back.** If a project took its stock from a different box, the reservation sat locked for that project until someone noticed it and clicked Unissue.

## The idea

A reserved part (a "slice") now remembers the lot it physically sits in (`source_lot_id`), so one scan of the box sees both its open stock and anything reserved for the scanning project.

```
Scan the box sticker  ->  Read lot + its slices      ->  Take stock
(on a project req)        (reserved for me + open)       (reserved first, then open)
                                                               |
                                                               v
                          Stays reserved   <-- no --  Reserved more than still needed?
                          (for this project)                   |
                                                              yes
                                                               v
                                                     Free the extra
                                                     (back into its source lot)
```

"Still needed" is the bigger of the project's approved BOM and PO quantity, minus what it has already consumed. The check runs after every consumption and when a BOM is approved.

## Business rules

These were agreed with the user one by one; keep them identical in other projects unless that project's owner decides otherwise.

| Rule | Detail | Why |
| --- | --- | --- |
| What a project needs | The **bigger** of its approved BOM quantity and its approved PO quantity, per component. | Protects spares deliberately ordered on top of the BOM (BOM 40, PO 50 keeps 10 reserved). |
| Requisitions don't set the need | A requisition only takes stock out; it never counts as the requirement. | Otherwise a requisition for 5 on a 50-unit order would free the other 45. |
| No BOM and no PO | Nothing is freed automatically; manual Unissue only. | There is nothing to compare against. |
| Job-work components | Never freed automatically. | Their finished parts come back reserved after the raw stock was already counted as used. |
| Taking more than reserved | Allowed; the extra comes from the box's open stock. | Shows as **Over-issued by X** on the project page when it passes the BOM. |
| Where freed stock goes | Back into the lot it was reserved from, not the lot that was scanned. | That is where the pieces physically are. |
| When the check runs | After every consumption, and when a BOM is approved. **Not** on GRN arrival and **not** on scan. | Stock stays reserved until one of those happens or someone unissues it. |
| Empty reserved part | Deleted if nothing was ever used from it; otherwise kept, hidden, and labelled **Returned to open inventory**. | Deleting a used one would erase project consumption and cost. |
| Old blocks | Whole-lot blocks made before this change are included in auto-release. | Their sticker is already the reserved lot, so no data fix is needed. |

## Database changes

All of it is one migration: `supabase/migrations/20261002000000_0098_reserved_slices_and_auto_release.sql`. Copy the file whole.

| Object | What it does | Why |
| --- | --- | --- |
| `inventory_lots.source_lot_id` + index | Links a slice to the lot it physically sits in. Always one level deep. | `parent_lot_id` already means job-work lineage, and the lot page labels it that way. |
| `_make_slice()` (internal) | Moves a quantity out of a lot into a new slice using two `transfer` movements. Copies vendor, cost, location, `jw_stage`, piece dimensions; not `container_no`. | Movements keep the ledger as the source of truth. Without `container_no`, slices never appear as boxes in the GRN add-to-box list. |
| `_release_lot()` (internal) | Slice → quantity moves back into its source lot. Whole lot, all of it → set to open. Whole lot, part of it → the sticker lot goes open and the part still reserved becomes a slice inside it. Deletes an emptied slice that was never used from. | The sticker always points at free stock. If the source lot is reserved for another project, the slice turns open instead of merging, so it isn't handed to that project. |
| `_auto_release()` (internal) | Compares requirement, consumed and reserved for one project + component, and frees the extra, oldest first. Advisory lock per project + component. | Implements the business rules above. |
| `consume_from_lot()` (RPC) | Locks the scanned lot and its slices; takes this project's reservation first, then open stock, never another project's; then runs auto-release. Same role rules as the old consume. | Replaces the app inserting one `issue` row. The locking also fixes an existing risk of two scans pushing stock negative. |
| `release_blocked_lot(lot, qty?)` (RPC) | Manual Unissue, all or part. Admin / team lead only. | The old Unissue only flipped the status, so a slice's stock never went back into its box. |
| `recheck_project_reservations(project)` (RPC) | Runs auto-release for every reserved component on a project. | Called on BOM approval so extra stock is freed straight away. |
| `issue_requisition()` (replaced) | Partial takes go through `_make_slice`; raw job-work lots are skipped; the source lot's `qty_initial` is no longer reduced. | Raw stock could wrongly be blocked; Initial should stay what was received. |
| `process_grn_line()` (replaced) | Project stock added to an existing box becomes a slice reserved for that project, linked to the box, with `grn_line_id` set. | Before, it silently joined the box as open stock and the block was lost. |
| `v_component_on_hand`, `v_project_consumption` (replaced) | Price = own PO rate, else the source lot's PO rate, else unit cost. | Slices have no GRN link, so they were valued at 0 or the wrong rate. |
| `v_bom_variance` (replaced) | A slice counts consumed + still reserved, and isn't counted twice when carved from the project's own GRN stock. | Keeps the reconciliation page's Received figure right. |
| Grants | Internal `_` functions revoked from everyone; the 3 RPCs granted to `authenticated` only. | Same pattern as the other security-definer RPCs. |

## App code changes

The rules live in the database; the app only calls the new functions and shows the results.

| File | Change | Why |
| --- | --- | --- |
| `src/app/(app)/inventory/actions.ts` | `resolveLot(code, projectId)` reads the lot plus its slices and returns reserved / open / available. `consumeLot` calls `consume_from_lot` and returns how much was released. `unissueLot` calls `release_blocked_lot` with an optional quantity. | One place for the scan, consume and unissue logic. |
| `src/app/(app)/requisitions/[id]/scan-consume.tsx` | Shows "Available — X reserved for this project + Y open", pre-fills the reserved quantity, and notes when stock was auto-released. | The floor team only scans the box. |
| `src/app/(app)/inventory/[id]/unissue-button.tsx` | Asks for a quantity (blank = all); new `qtyOnHand` prop. | Partial unissue. |
| `src/app/(app)/inventory/[id]/page.tsx` | Shows "in LOT-xxx" beside reserved parts; passes the quantity to Unissue. | A reserved part has no sticker, so the page names the lot to scan. |
| `src/app/(app)/inventory/lots/[id]/page.tsx` | A reserved part shows no QR or Print sticker, only "scan lot LOT-xxx". A lot lists the parts reserved inside it. An emptied part reads **Returned to open inventory**. | "Consumed" would confuse people for stock that was handed back. |
| `src/app/(app)/requisitions/[id]/page.tsx` | Issued list shows "LOT-part (in LOT-box)". | Matches what was scanned. |
| `src/app/(app)/grn/[id]/page.tsx` | A receipt added to a box shows the box; reserved parts are left out of sticker printing. | Matches the GRN database change. |
| `src/app/(app)/projects/[id]/actions.ts` | Block stock for BOM reserves BOM quantity minus what's already consumed. BOM approval calls `recheck_project_reservations`. | Stops double-reserving after work has started, and frees stock on approval. |
| `src/app/(app)/projects/[id]/issued-panel.tsx`, `src/app/(app)/projects/[id]/reports/page.tsx` | **Over-issued by X** when consumed is more than the BOM quantity. | Taking more than reserved is allowed, so it needs flagging. |
| `src/lib/database.types.ts` | Regenerated for the new column and functions. | Type check. |

## Porting checklist

The migration replaces two functions and three views wholesale, so compare before you apply it.

1. **Check prerequisites** in the target database: `auth_role()`, the `recompute_lot_on_hand` trigger (flips consumed to open, keeps issued), `lot_status` = open / issued / consumed, `po_lines.approval_status` and `line_status`, `boms.status = 'approved'`.
2. **Diff before replacing.** Compare the target's `issue_requisition`, `process_grn_line`, `v_component_on_hand`, `v_project_consumption` and `v_bom_variance` with the versions in the migration. They come from this repo's latest (0097 and the deferred-GRN 0096). If a project has diverged, merge by hand.
3. **Apply the migration** and regenerate `database.types.ts`.
4. **Copy the app changes** in the table above.
5. **Dry run on real data** inside a transaction that ends in `RAISE EXCEPTION`, so nothing is saved. It lists what the first checks will free. In this repo that was CONSUMABLE: filler wire 25 kg, oxygen 3, welding rod 7018 × 1. Confirm that list with the owner.
6. **Type check, build, then click-test** scan, Unissue and BOM approval in a browser. This was not browser-tested here.

Worth fixing separately: any logged-in user can call `process_grn_line` directly, which turns a GRN line into stock before its signatures are done. This predates the change.
