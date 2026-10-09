# Tradie Takeoff · Material Calculator V1

A manual-first, browser-only V1 for fixture counts, calibrated run measurements, an editable material summary, local save/restore, idempotent takeoff application, and CSV export. The drawing and material list are shown together, with a collapsible materials sheet on narrow screens.

## Start locally

```sh
npm install
npm run dev
```

Open the Vite URL. No API key, model credential, account, or server is used by this prototype. Uploaded PDFs and workspace data are kept in the current browser profile (IndexedDB for the PDF, local storage for workspace data).

## Try the sample flow

1. The built-in two-sheet plumbing sample opens by default. On P-01, use **Find symbols**, drag around a physical WC, then search the current sheet or all sheets. Review the group and accept or remove candidates. Candidates are excluded from totals until accepted.
2. Or choose **Count**, select a category, and click each physical symbol. Select a marker or a material row to reveal its source sheet. Marks can be corrected or removed; **Edit group** applies a material/size/category correction to a grouped set.
3. On P-01, select **Calibrate** and click the two ends of the dimension line labelled 6,000 mm. Confirm the known distance. Scale is stored per sheet; counts remain usable without it.
4. Select **Measure run**, click route vertices, then **Finish run** and enter the material/diameter. Shared collinear segments on the same page/material/size are included once. Uncalibrated traces are retained but do not contribute a length. **Measure area** uses a polygon and the same page calibration; uncalibrated polygons are retained but excluded from m².
5. Review the live list and source references. Optional waste, clip, trench, bedding, backfill and spoil outputs appear only after entering the relevant assumptions. Add unspecified items manually.
6. **Save** or wait for local auto-save. **Restore** reloads the last saved workspace. **Add to takeoff** upserts only calculator-linked rows; it does not duplicate those rows on re-apply. CSV includes item, material, size, quantity, unit, source page/reference and quantity basis.

## Sample reference count

The synthetic sample is deliberately labelled for verification. Its manually checked *physical* count is **3 toilets, 2 basins and 2 floor wastes** on P-01. P-02 repeats WC-01 and BAS-01 as enlarged views, so there are 7 distinct physical fixtures across the drawing, not 9. The schedule and notes intentionally say “4 typical” for toilets/basins and are not takeoff evidence. The sample finder reads a hand-authored physical-symbol index; it is not a vision-model result. Against that index the built-in search has 0 missed physical records and 0 false positives from notes/schedule, by construction. The PDF pixel matcher has not been evaluated against an external reference drawing.

## Verification

```sh
npm test
npm run build
npm audit --audit-level=moderate
```

The 14 automated tests include a Happy DOM browser-journey test that opens the sample plan, manually counts and corrects a fixture, searches/reviews the group, calibrates, measures, saves/restores, applies twice, and triggers CSV download. Canvas/Image/PDF APIs are mocked for that journey. Core tests cover the sample reference count/repeated-view collapse, review-only candidates, `6,000 mm` parsing, normalized mark alignment across page zoom/resizes, scale-dependent lengths and areas, shared-segment union, explicit quantity calculations, duplicate search handling, same-scale visual matching mechanics, CSV references/escaping, idempotent apply with preservation of non-calculator entries, and local save/reopen plus a simulated failed-save retry. All checks use synthetic fixtures or mocked browser/storage APIs; no customer plan, real PDF, PDF service, company account, or takeoff API was available or exercised.

## Repository / integration notes

The supplied checkout is `armeng2406-debug/tradie-takeoff-` (trailing hyphen), while the request links `armeng2406-debug/tradie-takeoff` (without it). Work is on the session feature branch **`arena/3754286d-tradie-takeoff`**. The checked-out repository started at **`32bf62d5dddd18174408cb33dcde37d4af0d8833`** and contained only this README. There was no existing PDF viewer, scale/tracing implementation, takeoff model, login/ownership layer, or Android startup/signing/release configuration to reuse or preserve. The checked-out repository had no open PRs when inspected. Read/write access to the no-hyphen repository was not available in this environment.

The requested screen recording was not present in the attached workspace files, so the implementation follows the written functional brief rather than claiming to reproduce unseen recording interactions. This V1 is consequently a standalone web prototype, not yet wired into the authenticated Tradie Takeoff app or its production takeoff store.

## Limitations and safety

- Manual count and trace remain available if search is unavailable. For user PDFs, symbol search is an experimental same-scale pixel-template matcher. It does not OCR or understand fixture semantics; notes, legends, schedules and repeated views may match. Candidates are visibly uncertain and never count until reviewed. All-pages PDF matches require an explicit repeated-view decision. Search quality can vary with zoom, scan quality and symbol size.
- The included sample uses its annotated symbol index to provide deterministic demonstration behavior; it does not prove recognition accuracy for actual construction documents.
- Calibration is page-specific. It must be entered by a person from a known dimension. There is no certified scale detection, shared route identity across independent sheets, or certified pipe/design logic.
- Fittings and other materials are entered manually. Waste, clips and excavation-related quantities are estimates from the exact editable inputs shown in the UI; backfill does not subtract pipe displacement. No size, depth, fitting, bedding, installation method or code requirement is silently supplied. This list is not a certified plumbing design or bill of materials.
- Since the supplied repository had no auth, document permission, server, or existing takeoff API, V1 cannot enforce company/project ownership or sync/apply to production data. Its “Add to takeoff” action is a local linked-row model for integration; server-side authorization and transactional upsert must be added when the real app/service is available.
- “Saved” means saved in this browser profile. Clearing browser storage, using another device/profile, or losing the local PDF can prevent restoration. If the PDF is not available on reopen, choose the same file again; marks remain scoped to its content fingerprint, project and pages.
