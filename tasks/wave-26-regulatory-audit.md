# Wave 26 — Regulatory Compliance Audit (NVD + SARS IT3)

**Issue:** #26 — regulatory accuracy of NVD and SARS IT3 outputs
**Author:** research agent (read-only)
**Date:** 2026-04-30
**Scope:** field-by-field comparison of FarmTrack output vs. SA legal requirements. No code changes proposed.

---

## Executive summary

- **NVD compliance: ~55%** — covers identity, animals and a vendor-declaration block, but is **mis-modelled as an Australian-style NVD** rather than the SA "Removal Certificate" required by Stock Theft Act 57/1959 §8. Several mandatory fields (driver/transporter, vehicle reg, owner identification mark / brand registration #, departure-to-destination geocoding) are missing.
- **IT3 compliance: ~30%** — schedule structure (income/expense lines + net) is correct in shape, but **every SARS source code in `IT3_SCHEDULE_MAP` is fabricated**. SARS farming codes are 4-digit profit/loss codes in the `01xx` range (e.g. `0104` Livestock Farming Profit, `0105` Loss). Codes `4101..4207, 4199, 4299` shown in FarmTrack do not exist on the ITR12 — `4101/4102` are PAYE codes on the IRP5/IT3(a). Also missing: opening/closing livestock standard values per First Schedule paragraph 2 (the entire "stock-on-hand at standard value" reconciliation that defines a farming return).
- **Top blocker:** the IT3 PDF will be **rejected or laughed at** by any SA tax practitioner because the source codes are wrong and there is no opening/closing stock standard-value section. The NVD will not satisfy a roadblock inspection because it does not name the transporter or vehicle.

---

## NVD — Field-by-field comparison

Legal anchors: **Stock Theft Act 57/1959 §6+§8**, **Animal Identification Act 6/2002**, regulations published by DALRRD (formerly DAFF).

| # | Required field (SA law) | FarmTrack field | Match | Justification |
|---|-------------------------|-----------------|-------|---------------|
| 1 | Name & address of certificate **issuer** | `seller.farmName`, `seller.physicalAddress` | ✅ | Captured from FarmSettings. |
| 2 | Name & address of **owner** of stock | `seller.ownerName`, `seller.physicalAddress` | ✅ | OK if owner = farm operator. Edge case: leased animals (owner ≠ farm) is not modelled. |
| 3 | **Owner identification mark** (registered brand/tattoo per AIA 2002, max 3 chars) | `seller.propertyRegNumber` | ⚠️ | "Property registration number" is not the same as the registered animal-ID mark. The AIA mark is a separate gov.za-issued asset registered with DALRRD's BrandsAIS. |
| 4 | Place **from** which stock is being moved | `seller.physicalAddress` | ✅ | Address line covers it. |
| 5 | Place **to** which stock is being moved | `record.destinationAddress` | ✅ | Optional in the schema — should be required when issuing. |
| 6 | Name of **driver / conveyer / transporter** | — | ❌ | Not captured in `NvdIssueInput` or PDF. Mandatory under §8. |
| 7 | **Vehicle registration**, model & make | — | ❌ | Not captured. Mandatory if conveyed by vehicle. |
| 8 | **Date of issue** of certificate | `record.issuedAt` | ✅ | Auto-stamped. |
| 9 | **Sale / movement date** | `record.saleDate` | ✅ | Captured. |
| 10 | **Number** of animals | computed from `animalSnapshot.length` | ✅ | OK. |
| 11 | **Sex** of animals | `animalSnapshot[].sex` | ✅ | OK. |
| 12 | **Colour** of animals (only if not marked / mark not registered) | — | ⚠️ | Not captured. Acceptable IF every animal carries a registered mark, but the form has no enforcement of that. |
| 13 | **Breed / type / kind** | `animalSnapshot[].breed`, `category` | ✅ | OK. |
| 14 | **Identification marks** on each animal (brand, tattoo, EID) | `animalSnapshot[].animalId` | ⚠️ | The internal `animalId` is FarmTrack's PK, not necessarily the legally-registered mark. Animal ear-tag # / tattoo / brand sequence is missing as a distinct field. |
| 15 | **Buyer / consignee** name + address | `record.buyerName`, `record.buyerAddress` | ✅ | OK. |
| 16 | **Owner's signature** (or duly-authorised agent) | placeholder line in PDF | ⚠️ | PDF has a "Signature: ___" line. No e-sign capture, no audit trail of who signed. Legally a wet signature is still acceptable; but the document only has space for 1 signature, no buyer counter-sign. |
| 17 | **Vendor declarations** (health, withdrawal, identification, accuracy) | 7 declaration booleans | ✅ | This is the *one* place FarmTrack over-delivers vs. baseline removal cert — these declarations come from the AU NVD playbook and are good practice, even if not strictly required by §8. |
| 18 | **Retention 1 year** by holder | n/a (DB row immutable + voidable) | ✅ | DB retention satisfies. |
| 19 | **Veterinary movement permit** (separate doc — required for FMD-controlled zones) | — | ❌ | Out of scope of removal cert; but FarmTrack does not flag when the destination is in an FMD red-line zone. Worth flagging as an enhancement. |

**NVD verdict:** the document is **fit-for-purpose for record-keeping** but **fails as a roadworthy §8 removal certificate** without driver + vehicle fields. Critically: the *name* "National Vendor Declaration" is misleading — that is the Australian MLA term. SA's legal name is "Removal Certificate" (or "Stock Removal Certificate").

---

## SARS IT3 — Field-by-field comparison

Legal anchors: **Income Tax Act 58/1962, First Schedule** (taxation of farming operations); **ITR12 / IT48** (individual / company farming schedule); **SARS source code register** (sars.gov.za "Find a Source Code"); **SARS Live-stock values** doc (paragraph 2 standard values).

> **Naming note:** "IT3" in FarmTrack is a misnomer. Forms in the IT3-series (IT3(a), IT3(b), IT3(c), IT3(s), IT3-01 etc.) are **third-party data submission certificates** (employer payroll, dividends, retirement, brokerage), NOT the farming schedule. The right name for what FarmTrack generates is **ITR12 Farming Schedule** (individuals) or **IT48 Farming Schedule** (companies). This wording mismatch is itself an audit risk because clients may copy the title onto the wrong SARS form.

### Schedule lines

| # | Required (SARS ITR12 farming schedule + First Schedule) | FarmTrack field | Match | Justification |
|---|---------------------------------------------------------|-----------------|-------|---------------|
| 1 | **Year of assessment** = 1 Mar → end Feb (leap-aware) | `payload.taxYear`, `periodStart`, `periodEnd` | ✅ | Code in `getSaTaxYearRange` is correct, leap-year tested. |
| 2 | **Profit code** (e.g. 0104 Livestock Farming, 0142 Game Farming, 0140 Wool, 0108 Milk, 0114 Poultry, 0112 Mixed <50%) | — | ❌ | FarmTrack does not surface the SARS profit code at all. The user has to know it themselves. |
| 3 | **Loss code** (paired with profit code, e.g. 0105 for Livestock loss) | — | ❌ | Same. The income/expense PDF rows don't carry the SARS code. |
| 4 | **Sales of livestock** (gross) | `IT3_SCHEDULE_MAP["Animal Sales"]` → code `4101` | ❌ | `4101` is the **PAYE/SITE source code on IT3(a)**, not a farming line. Real schedule has no 4-digit row code; the totals roll into the `0104` profit/loss for "Livestock Farming". |
| 5 | **Livestock purchases** (cost of sales) | `IT3_SCHEDULE_MAP["Animal Purchases"]` → code `4201` | ❌ | `4201` does not exist as a SARS code. Correct treatment: livestock purchases form part of the IT48 farming schedule's expenses block — there's no public per-line code, the line is described by name. |
| 6 | **Opening stock — livestock at standard values** (First Schedule para 2) | — | ❌ | **Missing entirely.** Standard values are gazetted (e.g. cattle bull R200, ewe R30 etc., regulated). This is the heart of a farming return — without it the IT3 cannot reconcile. |
| 7 | **Closing stock — livestock at standard values** | inventory `byCategory[]` count | ⚠️ | FarmTrack lists *current head count by category*, but does NOT multiply by standard value, NOT capture period-end count (memory note confirms: "V1 doesn't replay period-end"), and NOT roll into the income reconciliation. |
| 8 | **Adopted-value election** (taxpayer can deviate ±20% from gazetted standard value, election is binding) | — | ❌ | No mechanism to record adopted vs. standard value. |
| 9 | **Livestock acquired by donation/inheritance** (paragraph 11 — special inclusion) | — | ❌ | Not modelled. |
| 10 | **Game farming election** (Practice Note 6 / IN 69) | — | ❌ | Game animals are not separated from livestock; no election toggle. (Multi-species spec issue #28 will help; currently merged.) |
| 11 | **Capital improvements — farming operations** (deduction code **4407**) | — | ❌ | Real code that FarmTrack should be using is missing; transactions categorised as "Equipment/Repairs" go into a fictional 4206 line. |
| 12 | **Veterinary services / medicine** | code `4203` "Medication/Vet" | ❌ code | Code is fabricated. Description is fine. SARS treats this as a normal P&L expense, no per-line code on individual ITR12. |
| 13 | **Feed and supplements** | code `4202` | ❌ code | Same — code does not exist. |
| 14 | **Wages & salaries (farm labour)** | code `4204` | ❌ code | Same. |
| 15 | **Fuel & transport** | code `4205` | ❌ code | Same. |
| 16 | **Repairs & maintenance** | code `4206` | ❌ code | Same. |
| 17 | **Camp & land maintenance** | code `4207` | ❌ code | Same; SARS doesn't separate camp from general repairs. |
| 18 | **Subsidies / govt grants** | code `4103` | ❌ code | Fabricated. |
| 19 | **Other farming income** | code `4199` | ❌ code | Fabricated. |
| 20 | **Other farming expenses** | code `4299` | ❌ code | Fabricated. |
| 21 | **Net farming income** (income − expenses ± stock movement) | `schedules.netFarmingIncome` | ⚠️ | Computed as totalIncome − totalExpenses only. **Excludes** opening↔closing stock movement, which is a P&L item under the First Schedule. Will materially mis-state the result for any farm whose herd grew or shrank during the year. |
| 22 | **Foreign farming income** code `0192` | — | ❌ | Not modelled. |
| 23 | **Farmer's name + ID number + tax ref** | `farm.ownerName`, `farm.ownerIdNumber` | ⚠️ | ID is captured. **Tax reference number is NOT captured anywhere in FarmSettings** — that's the actual SARS-facing identifier. |
| 24 | **Farm physical address + farming-area code** | `farm.physicalAddress`, `farm.farmRegion` | ✅ | OK. |
| 25 | **Period of farming** (start/end of year of assessment) | `periodStart`, `periodEnd` | ✅ | OK. |
| 26 | **Drought-relief / disaster deferment** elections (s 26(7), para 13A) | — | ❌ | Not modelled. Common in SA droughts; tax-significant. |
| 27 | **Plantation / orchard** capital deductions | — | ❌ | Out of scope for livestock app, OK to skip. |
| 28 | **PDF disclaimer** (advisory not e-filing) | footer "Confirm current codes on the SARS ITR12…" | ✅ | Disclaimer exists, which mitigates legal exposure. |

---

## Discrepancies — categorised

### Critical (blocks legal/tax compliance)

1. **NVD missing driver + vehicle fields** — Stock Theft Act §8 mandatory. A FarmTrack-issued NVD shown at a roadblock can be rejected.
2. **IT3 source codes are entirely fabricated** — codes 4101/4102/etc. clash with PAYE codes on IT3(a) and do not exist on the farming schedule. Any user pasting these into eFiling will land them in the wrong field.
3. **IT3 has no opening/closing livestock at standard values** — this is the *defining* line of a SA farming return (First Schedule para 2). Without it, net farming income is materially wrong for any farm with herd growth/decline.
4. **"IT3" naming** — the form is not in the IT3-series; correct name is ITR12/IT48 Farming Schedule. Risk: user attaches FarmTrack PDF to the wrong SARS submission.

### High (audit-flag risk)

5. **Owner registered animal-ID mark (AIA 2002)** — distinct asset from `propertyRegNumber`, registered with DALRRD BrandsAIS. Should be captured in FarmSettings as `aiaIdentificationMark`.
6. **Per-animal ear-tag / tattoo / brand sequence** — separate field from FarmTrack's internal `animalId` PK. Required under AIA 2002.
7. **No tax reference number on IT3 PDF** — the *one* number SARS uses to key the return.
8. **No SARS profit/loss code (0104/0105 etc.) on IT3** — the user must know which 4-digit code their farming category maps to. FarmTrack already has multi-species classification — this should be a 1-line lookup.
9. **Net income excludes stock-movement** — inventory delta should flow into the P&L reconciliation, not just be displayed as an end-of-period count.

### Medium (cosmetic field-name mismatch)

10. **"Property registration number"** — ambiguous label. Should clarify whether this is the SG21-Diagram cadastral # or something else; the AIA mark is a separate field.
11. **Buyer counter-signature** missing on NVD — not strictly required, but standard practice for stock-removal certs to have buyer acknowledgement.
12. **Colour field** on animal snapshot — only required when the animal is not marked, but its absence creates an edge case.
13. **Foreign farming income (0192)** not modelled — niche, but FarmTrack hosts SA farms that sometimes lease cross-border (Lesotho/Eswatini).
14. **PDF advisory footer** is good but should explicitly say "**This is NOT an IT3-series form.**"

---

## Recommended fixes (ordered by severity)

1. **CRITICAL** — Add `driverName`, `vehicleRegNumber`, `vehicleMakeModel` to `NvdIssueInput` + form + PDF. Renderer should print a "transport" block.
2. **CRITICAL** — Replace the fictional `4101..4299` codes in `IT3_SCHEDULE_MAP`. Use SARS profit codes `0102/0104/0108/0114/0140/0142` etc. as a top-level **farming activity classifier**, then drop per-line codes (real schedule doesn't have them) and rely on the line *names* alone. Update PDF to show profit code prominently.
3. **CRITICAL** — Add opening- and closing-stock blocks at gazetted standard values to `It3SnapshotPayload`. Replay movement/sale/birth observations to build period-end count (or accept user-entered count). Surface elected adopted value (±20%).
4. **CRITICAL** — Rename "SARS IT3" to "SARS ITR12 Farming Schedule" everywhere (route name `/tools/tax/it3` can stay for URL stability; UI labels + PDF title must change). Update PDF disclaimer to say "Not an IT3(a)/(b)/(c) form."
5. **HIGH** — Add `aiaIdentificationMark` field to FarmSettings and surface on NVD PDF; capture per-animal `tagNumber` / `brandSequence` as distinct from FarmTrack `animalId`.
6. **HIGH** — Add `taxReferenceNumber` to FarmSettings; render on IT3 PDF header.
7. **HIGH** — Roll opening↔closing stock-value delta into `netFarmingIncome` calculation in `computeIt3Schedules`.
8. **MEDIUM** — Add `colour` to `AnimalSnapshotEntry` (optional), `buyerSignature` placeholder line on NVD PDF, drought-relief election toggle on IT3 form.
9. **MEDIUM** — In FAQ + PDF: link to DALRRD BrandsAIS portal and SARS "Find a Source Code" page so users know where their identifiers come from.
10. **OPTIONAL** — FMD red-line zone awareness on NVD destination address.

---

## Sources

Retrieved 2026-04-30:

- [Removal Certificate — eAnimaltrack Services](https://www.eanimaltrack.co.za/HowToComply/RemovalCertificate) — field list per Stock Theft Act §8
- [Removal Certificate — Stock Theft Prevention](https://www.stocktheftprevent.co.za/bemarking-van-diere/removal-certificate/) — confirmation of issuer/owner/transporter requirements
- [Understanding South Africa's animal identification laws — Farmer's Weekly](https://www.farmersweekly.co.za/farming-tips/how-to-livestock/understanding-south-africas-animal-identification-laws/) — AIA 2002 + Stock Theft Act 57/1959 overview
- [SAPS Stock Theft Unit Information Brochure (KwaNalu)](https://www.kwanalu.co.za/upload/files/SAPSStockTheftBrochure.pdf) — §6/§8 enforcement context
- [Register an animal identification mark — gov.za](https://www.gov.za/services/services-organisations/permits-licences-and-rights/animal-improvement/register-animal) — DALRRD BrandsAIS process
- [Animal Identification System — DALRRD BrandsAIS](http://webapps1.dalrrd.gov.za/BrandsAIS_OnlineApplication/) — official mark registry
- [SARS Find a Source Code](https://www.sars.gov.za/types-of-tax/personal-income-tax/filing-season/find-a-source-code/) — authoritative source for farming codes 0102/0104/0140/0142/4407 etc.
- [SARS Live-stock values (PDF)](https://www.sars.gov.za/wp-content/uploads/Docs/LiveStockValues/Live-stock-values.pdf) — gazetted standard values per First Schedule para 2 (binary, not text-extracted)
- [SARS Comprehensive Guide to the ITR12 (PDF, 19 Aug 2025)](https://www.sars.gov.za/wp-content/uploads/Ops/Guides/IT-AE-36-G05-Comprehensive-Guide-to-the-ITR12-Income-Tax-Return-for-Individuals-External-Guide.pdf) — current ITR12 guide
- [SARS Draft Guide on the Taxation of Farming Operations (2022)](https://www.sars.gov.za/wp-content/uploads/Legal/Drafts/Legal-LPrep-Draft-2022-57-Draft-Guide-on-the-Taxation-of-Farming-Operations.pdf) — First Schedule para 2 standard values, ±20% adopted-value election
- [SARS Income Tax Guide on Taxation of Farming Operations (IT35)](https://www.sars.gov.za/wp-content/uploads/Ops/Guides/Legal-Pub-Guide-IT35-Guide-on-the-Taxation-of-Farming-Operations.pdf) — opening/closing stock framework
- [SARS Interpretation Note 69 — Game Farming](https://www.sars.gov.za/wp-content/uploads/Legal/Notes/Legal-IntR-IN-69-Game-Farming.pdf) — game-farming election
- [SARS FAQ: What does IT48 stand for?](https://www.sars.gov.za/faq/faq-what-does-it48-stand-for/) — IT48 = company farming schedule
- [SARS ITR12 example return (PDF)](https://www.sars.gov.za/wp-content/uploads/Ops/Forms/SARS_2021_LookFeel_ITR12_v2021.00.10-Example.pdf) — actual form layout for cross-reference
- [Tax Faculty — clarity on taxation of farmers](https://taxfaculty.ac.za/news/read/welcome-clarity-on-the-taxation-of-farmers-in-south-africa) — practitioner perspective
- [Cliffe Dekker Hofmeyr — taxation of farmers in SA](https://www.cliffedekkerhofmeyr.com/en/news/publications/2022/Practice/Tax/tax-and-exchange-control-alert-6-october-Welcome-clarity-on-the-taxation-of-farmers-in-South-Africa.html) — First Schedule interpretation
- [Stock Theft Act §8 farmer-declaration PDF (Elsenburg)](https://www.elsenburg.com/wp-content/uploads/2024/08/Stock-Theft-Act-Article-8-Livestock-removal-and-Farmer-declaration.pdf) — official Western Cape gov restatement (binary, not text-extracted)

---

## Appendix — files reviewed

- `lib/server/nvd.ts` — NVD aggregator + snapshot
- `lib/server/nvd-pdf.ts` — NVD PDF renderer
- `components/nvd/NvdIssueForm.tsx` — issue form
- `lib/server/sars-it3.ts` — IT3 aggregator
- `lib/calculators/sars-it3.ts` — `IT3_SCHEDULE_MAP` (codes 4101..4299)
- `lib/server/sars-it3-pdf.ts` — IT3 PDF renderer
- Memory: `it3-tax-export.md` (T3-8 shipped 2026-04-14, commit 5967722)
