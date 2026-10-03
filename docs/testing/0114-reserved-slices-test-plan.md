# Test plan: reserved slices (scan the box to consume blocked stock)

Branch `reserved-slices` · migrations `0113` + `0114` · 2026-10-02

## What changed, in one paragraph

Blocking **part** of a box used to cut the blocked quantity into a new lot with no sticker, so nobody could ever scan it. Now the blocked part (a "reserved part") stays linked to its box. You scan the **box sticker**, and the app uses the stock reserved for your project first, then the box's open stock. It never touches another project's reserved stock. If a project no longer needs what it reserved, that stock goes back into the box by itself.

---

## 1. Setup

### 1.1 Choose where to test (recommended: a copy, not live)

| Option | How | When |
| --- | --- | --- |
| **A. Test copy (recommended)** | Supabase dashboard → your project → **Branches** → create a branch, or create a new project and restore last night's backup into it. | Before going live. |
| B. Live, with a backup | Supabase dashboard → Database → **Backups**: confirm there's a backup from today. If there isn't one, take one. | Only once A has passed. |

### 1.2 Apply the database changes, in this order

In the Supabase **SQL editor** of the test database:

1. Run `supabase/migrations/20261002060000_0113_req_status_missing_values.sql` on its own and let it finish. It adds the requisition statuses that 0114 uses.
2. Run `supabase/migrations/20261002070000_0114_reserved_slices_and_auto_release.sql`.

Both should finish with "Success. No rows returned".

### 1.3 Preview what the first auto-release would free (read-only)

Run `supabase/tests/0114_reserved_slices/preview.sql`. You can run it on live too, because it changes nothing.

- **Expected:** a list of project + component rows. `would_free` is how much reserved stock goes back to open the first time that project is checked (when someone consumes against it, or a BOM is approved).
- **Check with the team:** is every row on this list really not needed? If a row looks wrong, the BOM or PO for that project is probably wrong. Fix that first.

### 1.4 Run the app against the test database

```bash
git fetch
git switch reserved-slices
npm install
# .env.local: point NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY at the TEST database
npm run dev
```

Open http://localhost:3000.

### 1.5 Users you need

Create these in **Admin → Users** if they don't exist on the test database:

| User | Role | Used for |
| --- | --- | --- |
| Admin | admin | everything, reversing a consumption |
| Lead | team_lead | approving BOMs, blocking stock, unissue |
| Floor | team_member | scanning and consuming (the real floor user) |
| Store | inventory_admin | GRN, unissue, stock-take, transfer |

Tip: open each user in a different browser or a private window, so you can switch quickly.

### 1.6 Test data to create

Use a test component so real stock isn't confused with test stock.

1. **Masters → Components:** create **TEST-BOLT** (tracking: Box) with two MPNs: **MPN-A** and **MPN-B**.
2. **Projects:** create **TEST-P1**, **TEST-P2** and **TEST-P3**. Give each a BOM line **TEST-BOLT**: **10** for P1, **5** for P2, **10** for P3. Don't approve the BOMs yet.
3. **GRN (Store):** receive **60 × TEST-BOLT, MPN-A**, untagged, into a new box. This is **Box A**. Write down its lot code.
4. **GRN (Store):** receive **40 × TEST-BOLT, MPN-B**, untagged, **into Box A** (add to existing box). Box A should show **On hand 100**.
5. **GRN (Store):** receive **50 × TEST-BOLT, MPN-A**, untagged, into a new box. This is **Box B**.

**Box A must be received before Box B.** Blocking takes stock from the oldest box first, and the steps below rely on that.

**Handy while testing:** paste a box's lot code into `supabase/tests/0114_reserved_slices/inspect-box.sql` and run it in the SQL editor. It lists the box and every reserved part inside it, with project, quantity and MPN. The numbers there should always match the screens.

---

## 2. Checklist: the new behaviour

Do the sections **in order**; each one starts from where the previous one ended. Tick each row. If you see something different from "Expected", note the step number.

**How requisitions get lines:** "Requisitions → New requisition" creates an empty requisition with no lines. On it, every scanned part has a **typed** qty (see B8). Requisitions that have lines come from **Block stock for BOM**, or from the project page's **in-stock requisition** button. On those, the qty is **locked** to what's still outstanding. Most steps below use requisitions with lines.

### A. Blocking part of a box

| # | Who | Do | Expected |
| --- | --- | --- | --- |
| A1 | Lead | TEST-P1 → BOM → **Approve** | BOM shows **Approved**. |
| A2 | Lead | TEST-P1 → Stock status → **Block stock for BOM** | Message "Blocked all required stock for 1 component(s)". A requisition is created for TEST-P1 (TEST-BOLT × 10). Call it **REQ-P1**. |
| A3 | Admin | Inventory → TEST-BOLT | **Open 140** (Box A 90 + Box B 50), **Issued (frozen) 10**. The issued row reads **"LOT-xxxx in LOT-(Box A)"**, project TEST-P1. |
| A4 | Admin | Box A's lot page | On hand **90**. **Initial stays 60** (it used to drop to 50). New field **Reserved inside: 10**. A card **"Reserved inside this box"** shows **TEST-P1 × 10**. |
| A5 | Admin | Click the **TEST-P1 × 10** badge | The reserved part's page: **no QR and no "Print sticker"**. It reads "Reserved part of a box — no sticker of its own. Scan lot LOT-(Box A)". No Stock-take or Transfer section. |
| A6 | Admin | MPN cards on both pages | Box A: **MPN-A × 60, MPN-B × 30**. Reserved part: **MPN-B × 10** (the newest MPN is used first). |
| A7 | Lead | TEST-P2 → approve BOM → **Block stock for BOM** | Box A: on hand **85**; reserved inside **TEST-P1 × 10, TEST-P2 × 5**. Requisition **REQ-P2** created. |
| A8 | Lead | TEST-P1 → **Block stock for BOM** again | Success message, but **nothing new is reserved**. Box A still 85, TEST-P1 still × 10. (It does create another requisition; ignore it.) |

### B. Scanning the box and consuming (the original problem)

| # | Who | Do | Expected |
| --- | --- | --- | --- |
| B1 | Store | Inventory → TEST-BOLT → Issued → TEST-P1's row → unlock icon → enter **4** | TEST-P1 reserved drops to **6**. Box A on hand goes up to **89**. This sets up a mix of reserved and open stock for the next step. |
| B2 | Floor | Requisitions → open **REQ-P1** → Scan to consume → scan **Box A's sticker** (or type its lot code) | **Available 95**, with **"6 reserved for this project + 89 open"**. Amber note: "Also in this box, reserved for other projects (not usable here): TEST-P2 × 5". **Qty to consume = 10** (locked). |
| B3 | Floor | Press **Consume** | Green message: **"Consumed 10 (6 from reserved stock + 4 from open stock)."** |
| B4 | Admin | Box A's lot page | On hand **85**. TEST-P1 is gone from "Reserved inside". **TEST-P2 × 5 is untouched.** MPN-A + MPN-B add up to 85. |
| B5 | Floor | REQ-P1 → "Issued in this requisition" | Two rows: **6** from **"LOT-xxxx (in LOT-Box A)"** and **4** from **LOT-(Box A)**. The line shows 10 / 10 done. |
| B6 | Floor | Scan Box A again on REQ-P1 | "Nothing outstanding for this component on this requisition." Consume is disabled. |
| B7 | Lead | TEST-P1 → un-approve the BOM → change TEST-BOLT to **8** → approve | Project page → Materials issued: TEST-BOLT planned 8, issued 10, **"Over-issued by 2"**. The project's **Reports** page shows the same under WIP. |
| B8 | Floor | Requisitions → **New requisition** for TEST-P2 (empty, no lines) → scan **Box A** | Note: **"Not on this requisition — enter the qty to consume (up to N available in this box)."** The qty box is **editable**. Typing more than N is capped at N. Don't consume yet; just check, then close it. |

### C. Auto-release (stock goes back to the box by itself)

| # | Who | Do | Expected |
| --- | --- | --- | --- |
| C1 | Lead | TEST-P3 → approve BOM → **Block stock for BOM** | 10 reserved for TEST-P3, taken from **Box A** (the oldest box). Box A open **75**. Requisition **REQ-P3** created. |
| C2 | Floor | Open **REQ-P3** → scan **Box B** (not Box A) | **Available 50** (no reserved line, because P3's reservation is in Box A). Qty 10. |
| C3 | Floor | **Consume** | Green message ends with **"10 reserved elsewhere was no longer needed and went back to open stock."** |
| C4 | Admin | Box A's lot page | TEST-P3's reserved part is **gone**, and Box A's on hand is back to **85**. Box B is **40**. |
| C5 | Lead + Store | Raise and approve a PO **for TEST-P3**: TEST-BOLT × **15**. Store receives **5** against it, into a **new box** (**Box C**). | Box C is a whole box reserved for TEST-P3 (×5), with its own sticker. |
| C6 | Lead | TEST-P3 → un-approve and re-approve the BOM | **No** "went back to open stock" message. Box C stays reserved, because the PO's 5 extra (15 vs BOM 10) are protected. |

These are also covered by the automated test, so they're optional here:
- A component with **no BOM line and no PO line** for a project is never freed automatically.
- A **job-work** component is never freed automatically.

### D. Unissue (manual release)

| # | Who | Do | Expected |
| --- | --- | --- | --- |
| D1 | Store | Inventory → TEST-BOLT → Issued → TEST-P2's row → unlock → enter **2** | TEST-P2 reserved **3**. Box A on hand **87**. |
| D2 | Store | Unlock TEST-P2 again, leave it **blank** | TEST-P2's reserved part disappears. Box A on hand **90**. |
| D3 | Floor | Inventory → TEST-BOLT | **No unlock icon** for this role. |
| D4 | Lead + Store | PO for **TEST-P1**, TEST-BOLT × 20, approved. Store receives all **20** into a **new box** (**Box D**). Then Store unissues **5** of Box D. | Box D's sticker lot becomes **open with 5**. Box D's page shows **"Reserved inside: 15"** (TEST-P1). The sticker never points at reserved stock. |
| D5 | Floor | Open **REQ-P2** → scan **Box C** (everything in it is reserved for P3) | Available **0**. "Everything in this box is reserved for project TEST-P3 — can't consume here." Consume disabled. |

### E. GRN into an existing box, for a project

| # | Who | Do | Expected |
| --- | --- | --- | --- |
| E1 | Lead + Store | PO for **TEST-P2**, TEST-BOLT × 8, approved. Store receives **8 (MPN-B) into Box B** (add to existing box). | The GRN line shows **Box B's** lot code. |
| E2 | Admin | Box B's lot page | Box B's own on hand stays **40**. "Reserved inside" shows **TEST-P2 × 8**. Before this change those 8 silently became open stock. |
| E3 | Store | That GRN page → print stickers | **No new sticker** is offered for this line. The 8 sit in Box B, which already has its sticker. |

### F. Stock-take and transfer on a box

| # | Who | Do | Expected |
| --- | --- | --- | --- |
| F1 | Store | Box B's lot page → Stock-take | The placeholder shows **48** (40 open + 8 reserved). The hint says "Count the whole box, reserved parts included." |
| F2 | Store | Enter **48** | Nothing recorded (no difference). |
| F3 | Store | Enter **47** | One **adjustment −1** on Box B. Box B on hand **39**. TEST-P2's 8 is untouched. |
| F4 | Store | Enter **5** (less than the 8 reserved) | Refused: "Counted 5, but 8 in this box is reserved for projects…". |
| F5 | Store | Transfer Box B to **Rack-9** | Box B **and its reserved part** both show location Rack-9 (Inventory → TEST-BOLT lists). |

### G. Reports and money

| # | Who | Do | Expected |
| --- | --- | --- | --- |
| G1 | Admin | **Inventory** (main list) → TEST-BOLT and its Excel export | **Received 143** (60 + 50 + 5 + 20 + 8). Blocking and unissuing add **no** extra "receipt" rows. **Balance** = total on hand. The 40 topped up into Box A isn't in Received: that's how add-to-box already worked before this change. |
| G2 | Admin | Inventory → TEST-BOLT → value | A reserved part is valued like the box it came from: the box's PO rate, or the box's unit cost if the box had no PO. |
| G3 | Admin | TEST-P1 project page → consumption value | The 6 taken from the reserved part is costed at Box A's rate, the same as the 4 taken from Box A directly. |
| G4 | Admin | **Reconciliation** | TEST projects' Received figures aren't doubled. No new false "Missing PO" rows. |
| G5 | Admin | **Traceability** → Box A's code | Opens as before. |

### H. Reverse a consumption

| # | Who | Do | Expected |
| --- | --- | --- | --- |
| H1 | Admin | REQ-P1 → click the **"LOT-xxxx (in LOT-Box A)"** link (the 6) → in its ledger, **Reverse** the issue of 6, with a reason | Box A's page shows **"Reserved inside: TEST-P1 × 6"** again. Scanning Box A on a TEST-P1 requisition shows those 6 as reserved. |

---

## 3. Checklist: make sure nothing else broke

Quick smoke test of the areas around this change. Each should behave exactly as before.

| # | Area | Do | Expected |
| --- | --- | --- | --- |
| R1 | Dashboard | Open it | Loads. "Components in inventory" looks right. |
| R2 | Purchase orders | Create, approve, sign, print a PO | Same as before. |
| R3 | GRN, new box | Receive untagged stock into a new box | New lot with a sticker, status open. |
| R4 | GRN, add to box | Receive untagged stock into an existing box | Box qty goes up and its MPN breakdown updates. |
| R5 | GRN, project, new box | Receive project-tagged stock into a new box | Whole box reserved for the project, with its own sticker. |
| R6 | GRN, item tracking | Receive an item-tracked component (if you have any) | One lot per piece, as before. |
| R7 | IRN / inspection | Submit and approve an IRN | Same as before. |
| R8 | Job work | Send raw stock for job work, receive it back | Same as before. Scanning a raw lot: "Raw job-work stock — send it for job work before consuming." |
| R9 | Site purchase | Record one on a project | Same as before. |
| R10 | In-stock requisition | Project page → raise the in-stock requisition → scan a box on it | Lines and quantities as before. Scanning follows section B. |
| R11 | Internal consumption | Raise one and scan-consume | Works. Uses open stock only. |
| R12 | Stickers | Inventory → Stickers → print | Box stickers print as before. |
| R13 | Alternatives | Substitute an alternative on a short component | Same as before. |
| R14 | Roles | Log in as each of the 4 users | Each sees the same menus as before. |

---

## 4. Undoing this (rollback)

You can undo it at two levels. Do both if the change has to come out completely.

### 4.1 Code

- **Before merging:** do nothing. `main` doesn't have this code; just don't merge `reserved-slices`.
- **After merging:** `git revert <merge commit>` and redeploy.

### 4.2 Database

1. **Optional but recommended first:** run the query at the top of `supabase/rollback/0114_rollback.sql` to list reserved parts. Unissue them in the app **while 0114 is still in place**, so their stock goes back into their boxes. After the rollback, any reserved part left over goes back to the old behaviour: still reserved, but not findable by scanning the box.
2. Run `supabase/rollback/0114_rollback.sql` in the SQL editor. It:
   - restores the old `issue_requisition`, GRN trigger and the 4 views exactly as they were (copied from migrations 0068, 0105, 0079, 0069 and 0084),
   - removes the 7 new functions,
   - **keeps all stock and history.** The `source_lot_id` column stays; nothing old reads it.
3. **Don't roll back 0113.** It only adds two requisition statuses that the old code already needed.

The rollback has been tested: it was run on top of a database full of test reservations. Stock counts still matched history afterwards, the old blocking behaviour came back, and 0114 could be applied again cleanly.

---

## 5. Automated test (for developers)

Every database rule in section 2, plus the rollback, runs automatically against real Postgres (in-process, no database connection needed):

```bash
npm i --no-save @electric-sql/pglite@0.5.8
node supabase/tests/0114_reserved_slices/test.mjs .
```

It ends with `ALL PASSED` (exit code 0). If 0068/0079/0069/0084/0105 ever change before this ships, regenerate the rollback with `node supabase/tests/0114_reserved_slices/build-rollback.mjs .`.

## 6. Known limits

- **Not yet clicked through in a browser.** Only the database scenarios and the build have been checked. That's what this plan is for.
- **The qty is only locked for parts that are on the requisition.** On an empty "New requisition", or for a part not on the requisition, the floor types the qty (up to what's available in the box). That's where over-issue usually comes from; it's flagged as "Over-issued by X" on the project page.
- **Consuming without a project** (admin, with a reason) still works in the database, but the app no longer offers it: every requisition must have a project. It's covered by the automated test only.
- An **empty** box (all of it reserved) drops out of the GRN "add to existing box" list, the same as any empty box today.
- Reserved stock is only released automatically after a consumption or a BOM approval. Cancelling a PO or a project frees nothing until one of those happens. Use Unissue for that.
