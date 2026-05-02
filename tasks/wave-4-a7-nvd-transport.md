# Wave 4 A7 — NVD transport regression

Codex 2026-05-02 HIGH finding: `app/api/[farmSlug]/nvd/route.ts` does not extract `body.transport` from the POST payload, so the UI's `driverName` + `vehicleRegNumber` (+ optional `vehicleMakeModel`) get dropped on the server. The persisted `NvdRecord.transportJson` ends up null, so generated PDFs lack Stock Theft Act 57/1959 §8 transport rows — a regulatory non-compliance.

## Confirmed UI contract (components/nvd/NvdIssueForm.tsx lines 165-188)

```ts
transport: driverName.trim() || vehicleRegNumber.trim()
  ? {
      driverName: driverName.trim(),
      vehicleRegNumber: vehicleRegNumber.trim(),
      vehicleMakeModel: vehicleMakeModel.trim() || undefined,
    }
  : undefined
```

Field name on the wire is `transport`. Shape matches `NvdTransportDetails` in `lib/server/nvd.ts` (driverName: string, vehicleRegNumber: string, vehicleMakeModel?: string). `issueNvd` already accepts `input.transport` and writes `transportJson: JSON.stringify(input.transport)` — only the route was failing to forward it.

## Plan (TDD red-green-refactor)

- [x] Confirm UI sends `transport: { driverName, vehicleRegNumber, vehicleMakeModel? }` (NvdIssueForm.tsx)
- [x] Confirm `issueNvd(input.transport)` already persists to `transportJson` (lib/server/nvd.ts)
- [x] Write failing test `__tests__/api/nvd-transport-route.test.ts`:
  - POST with valid transport -> issueNvd called with `transport: { driverName, vehicleRegNumber, vehicleMakeModel }`
  - POST without transport -> issueNvd called WITHOUT `transport` (undefined), 201 OK (optional field)
  - POST with transport but driverName not a string -> 400
  - POST with transport but vehicleRegNumber empty string -> 400
- [x] Implement: extract + validate `body.transport` in route, pass through
- [x] Verify: lint + tsc + new vitest + build all green
- [x] Commit + push + open PR with Codex citation

## Files in allow-list

- `app/api/[farmSlug]/nvd/route.ts` — primary fix
- `__tests__/api/nvd-transport-route.test.ts` — NEW failing test first
- `tasks/wave-4-a7-nvd-transport.md` — this checklist

## Out of scope (do NOT touch)

- `lib/server/nvd-pdf.ts` — renderer is correct
- `components/nvd/NvdIssueForm.tsx` — UI already sending the field
- migration files — column already exists per `migrate-nvd-fields.ts`
