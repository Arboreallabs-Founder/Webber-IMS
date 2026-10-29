# Webber IMS — change log from the original YAHA IMS

Starting point: commit `1343ea3` "Initial commit: YAHA Waters IMS" (8 Jul 2026).
Last updated: 28 Oct 2026.

There are two kinds of change:

- **Code changes.** These are tracked in git (`git log`). Each line below shows the commit id so it can be looked up or reverted.
- **Live database data changes.** These are *not* in git. They were made with scripts in `supabase/scripts/` (on this laptop only), with backups in `backups/`.

---

## Part 1 — Code changes (git, branch `main`)

### Phase 1 — YAHA IMS build-out (8 Jul – 20 Sep 2026, by sidajayb1822)

**Foundation (Jul)**
- `040ebda` Removed the Production Schedule feature
- `ba3f578` Big overhaul of BOMs and components. Added Job Work, stock blocking, PO printing and mobile support.
- `80e50f0`, `fa21157` Security patches for Next.js
- `f9fbb55` GRN made always-open for receiving. Fixed the sticker print size.
- `58d70dc`, `8797f55`, `9943e92` Shown on requisitions and projects: what was scan-consumed, job-work visibility and the shortfall fix
- `53fddc4` Added labels for job-work raw stock, the Site Purchase module and the IRN inspection gate

**Masters, POs and GRN rules (Aug)**
- `91c13c7` Added the Master Data hub. `e10de42` made customer onboarding stricter.
- `cafe28d`, `4d71d37`, `4b80b37` BOM imports and supplier sync
- `122605b` Manual PO numbering, plus PO delete (admin/founder only)
- `38eee64` GRN now requires a challan/invoice and blocks receiving without a PO. `74df90b` made challan/invoice numbers unique per vendor.
- `84f34ed`, `866495d` PO price approval and revisions. POs can be edited after sending.
- `48c187a`, `98138c5` MRIN/IRN consolidation, box tracking, custom BOMs and weight/length quantities
- `4db358e` **Inventory valued at the approved PO rate** (not the GRN typed price)
- `b7ed103`, `cf0a174`, `b53f136`, `d6f6c9f`, `e1e43e4` Job-work receiving through GRN, with fixes
- `0b7c3d5` Per-PO delivery address. `dedc72e` and `8a75fd3` were print fixes.
- `f4401e9` Fixed stock blocking corrupting qty on partial blocks
- `5ed9f32` Admin can reverse a consumption back to stock
- `2a902ac`, `ec6655e`, `0d62bca`, `525f069` Digital signatures and multi-approver sign-off. Printing is blocked until signed.
- `7933f6c` Activity log under Users
- `6f8193f` Web push notifications

**Reports and exports (Aug–Sep)**
- `088ca4e`, `6050f60`, `545265e`, `9f18dc0`, `44dbb0f` Inventory Excel export
- `6fc6542`, `5ccf2d9`, `e6e6350` PO Register export
- `cd73038` Project report downloads and GRN search
- `5af46f6`, `5742f90`, `6c8725a` Material status and variance fixes
- `10b173f` Printable system-overview document

**Inspection, BOM Builder and traceability (Sep)**
- `0937d26`, `ffe7098`, `dd4a161`, `86f779a` Inspection templates, GRN print and traceability
- `52de3dc` Unified BOM Builder (replaced Products/Categories/BOM Templates)
- `ff6275b` Pressing a lot's QR opens its traceability
- `851cb62`, `0d4047a`, `93c67cb` "WIP" naming and the WIP per project/lot view. Reversals return a lot to how it was held.

**Speed (Sep)**
- `8898f07`, `e4e3f51`, `5d683ea`, `ed561a9`, `30accad`, `79fecc5`, `9a42307` Caching, loading spinners, lazy-loaded libraries, middleware auth and 76 new DB indexes

**Smaller fixes:** `f8f662d`, `9af10b8`, `e9d4206`, `f734239`, `1d23d25`, `5cd522a`, `b1a9581`, `8824da5`, `6817640`, `5659128`, `e53878e`, `9ff4726`, `508d1b7`, `ee43284`, `1fe3f6f`, `7334755`, `7798876`

### Phase 2 — Conversion to Webber Electro Corp (24 Sep – 3 Oct 2026, by Siddhant Baliga)

**Rebrand and simplification**
- `397d2c3` Fixed gaps in the migration history
- `0f8f7e0` **Rebranded to Webber Electro Corp.** Component tracking is locked to box / Nos.
- `82f8158` Removed Job Work from the frontend
- `8fef933` Removed the MRIN blank-template preview
- `d8facc4` "Component No." renamed to **WPC**. Added MPN. Dropped the UoM label and reorder level.
- `5b6c38a` One-time Components.xlsx import
- `a1ff539` Fixed a stale enum in the stock recompute

**WPC / MPN model**
- `b8f95db`, `9b6f19b` One component keeps one WPC, and MPN is now a list (one per manufacturer)
- `c8c5342`, `6af69bc`, `8f8bb1e`, `87c844f` GRN: pick or add an MPN with type-ahead
- `5a6b65f` A box can hold more than one MPN
- `421460d` Lot page shows all MPNs

**GRN**
- `5750378` **PO price overrides the typed Unit cost.** Live total cost. Components can be created inline.
- `6951a0e` Storage location is captured at receiving

**Alternatives and shortfall**
- `c8a1fa1` Approved alternative components
- `329a7ef`, `b4a9a56` Shortfall panel shows alternatives, with a "Replace with in-stock alternative" button

**Projects, roles and dashboard**
- `7ce14b0`, `79ec7ba` Internal Consumption projects, with their own page. GRN numbering was reset.
- `fa1ffed` New **Inventory Admin** role
- `ede4777` "Components in inventory" dashboard card

**Requisitions and scan-to-consume**
- `e694f70` Requisitions are now made from in-stock material (not shortfall). tracking_mode/uom are locked.
- `b58b36a` Scan-to-consume qty is locked to what's left on the requisition
- `9aac06a` Qty can be typed when the scanned part isn't on the requisition

**Other fixes:** `2c757ba`, `e58656c`

### Other branches

| Branch | Where | Status | Commits |
|---|---|---|---|
| `reserved-slices` | Pushed to GitHub | **Not merged, not applied to the live DB** | `991a593`, `b015834`, `a93433d` |
| `demo` | Local only, never pushed | Not used (demo was reversed) | `20901d6` |

- **`reserved-slices`** (migration 0114): blocked stock stays inside the original box, so it keeps its QR, MPN and GRN link. It also auto-releases reservations that aren't needed. It has a test plan, a rollback SQL and automated tests.
- **`demo`**: the temporary rebrand to "Demo Company".

---

## Part 2 — Live database data changes (not in git)

| Date | What was done | Record / how to undo |
|---|---|---|
| 6 Oct 2026 | **Reset:** deleted all inventory, POs, GRNs, requisitions, internal consumptions, job-work and site purchases. Numbering restarted. The components master was kept. | Backup: `backups/2026-10-06_before_reset/`. Scripts: `export_before_reset.mjs`, `run_reset_via_api.mjs`, `reset_inventory_po_grn_req.sql` |
| 6 Oct 2026 | Deleted all projects and BOMs | Backup: `backups/2026-10-06_before_project_delete/`. Script: `delete_projects_via_api.mjs` |
| 6 Oct 2026 | Deleted the BOM template | Backup: `backups/2026-10-06_before_bom_template_delete/`. Script: `delete_bom_templates_and_list_users.mjs` |
| Oct 2026 | **Opening stock import** from `INV 5-10-26.xlsx`: one GRN with 190 lines, box lots, new components box-tracked, new MPNs added | Script: `import_inventory_grn.mjs` |
| Oct 2026 | Opening GRN renamed to **GRN/26-27/0001** | Done directly; no script |
| Oct 2026 | Number sequences reset (next GRN = 0002; PO, REQ, IRN, JW, JWGRN and SP start at 0001) | Script: `reset_numbering.mjs` |
| 13 Oct 2026 | **Demo:** dummy "Demo Company" data added, then **fully reversed** | `supabase/scripts/demo/` (seed, reverse, verify, manifest) |
| Oct 2026 | Password changed for the admin login `sidajayb@gmail.com` | Done through the Supabase admin API; no script |
| 28 Oct 2026 | REQ/26-27/0001 (its project had been deleted): its 2 split lots were put back into their boxes and the requisition was **closed**. LOT-261024-402f48d4 (100 pcs) went back to box LOT-261005-07099b95. LOT-261024-32255767 (20 pcs) went back to box LOT-261005-d14c0b18. | Script: `return_req0001_split_lots.mjs`. To undo: delete the 4 movements with `reference_type = 'requisition_unblock'` and set the requisition back to `issued` |

---

## Part 3 — Known open issues (not changed)

1. **`v_project_costing` view is missing in the live DB.** The project costing card on the dashboard and project page is always empty.
2. **Blocking stock creates split lots with no MPN, GRN link or box number.** This makes them show no MPN and count as ₹0 in WIP. It is fixed on `reserved-slices`, which is not live yet.
3. **Lots received against a PO show "—" for unit cost** on the lot and traceability pages. This is only how it's displayed; stock value correctly uses the PO rate.
4. **Component names:** 15 component names differ from the Excel, and one 16EL MPN (`1206W4F604JT5E`) looks wrong. These were reported but not changed.
5. **Security:** rotate the database password and revoke the Supabase access token that were shared during the work.
