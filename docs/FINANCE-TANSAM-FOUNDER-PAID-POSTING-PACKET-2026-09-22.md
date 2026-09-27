# TANSAM Founder-Paid Production Posting Packet

**Entity:** Vāyú Shastr Pvt Ltd  
**System:** VYNDI OS · People & Office Actual Spend / Finance  
**Event:** TANSAM technical visit · Anna University, Chennai  
**Visit date:** 22 September 2026  
**Funding source:** Founder / Director personal funds  
**Posting status:** HOLD — production deployment not yet completed  
**Governance mode:** Sole-Operator authority  
**Required governance marker:** `SOLE_OPERATOR_SELF_APPROVAL`

## 1. Authoritative reconciled amount

| Category | Evidence basis | Amount (INR) |
|---|---|---:|
| Fuel | Hari Janani Co ₹3,000; Sri Vinayaga Muruga Agencies ₹2,000; N.P & CO ₹1,000 | 6,000.00 |
| FASTag / toll | IDFC FIRST FASTag ₹1,003 + ₹803 | 1,806.00 |
| Accommodation | MakeMyTrip · Raja's Paradise Inn · 21–22 Sep 2026 | 1,551.00 |
| Travel meal | Zomato · 21 Sep 2026 | 521.69 |
| **Total** |  | **9,878.69** |

The earlier rough estimate of ₹11,000 is contextual only. The unreconciled difference of ₹1,121.31 must not be posted unless new evidence is produced.

## 2. Evidence references

- Fuel · Hari Janani Co · 20 Sep 2026 22:12 · PhonePe transaction `T2609202212273924347457` · UTR `730598451114` · ₹3,000
- FASTag · 21 Sep 2026 06:48 · PhonePe transaction `NB26092106483803439597702` · UTR `106468497279` · ₹1,003
- Meal · Zomato · 21 Sep 2026 14:32 · PhonePe transaction `T2609211432428921963407` · UTR `795402348022` · ₹521.69
- FASTag · 22 Sep 2026 17:41 · PhonePe transaction `NB26092217405630341110932` · UTR `043690641177` · ₹803
- Fuel · Sri Vinayaga Muruga Agencies · 22 Sep 2026 18:13 · PhonePe transaction `T2609221813322611190823` · UTR `597572072821` · ₹2,000
- Fuel · N.P & CO · 23 Sep 2026 00:44 · PhonePe transaction `T2609230044066428613325` · UTR `371694449583` · ₹1,000
- Accommodation · MakeMyTrip · Raja's Paradise Inn · check-in 21 Sep 2026 / check-out 22 Sep 2026 · ₹1,551

Duplicate Zomato screenshot/evidence, if encountered, must be referenced once only.

## 3. Upstream source control

The People & Office source must be:

- Source type: `cost_item`
- Source ID: `office-travel`
- Name: `Travel and local transport`
- Controlled accounting classification after PR #306: account `6250 Travel / Business Development Expense`
- Lifecycle requirement before actual-spend creation: `approved`

The production source is presently known to be draft and therefore must not be bypassed.

## 4. Intended production posting

After PR #306 is deployed and `office-travel` is approved, create the actual expenditure with:

- Description: `TANSAM technical visit · Anna University, Chennai · 22 Sep 2026`
- Amount: `9878.69`
- Funding source: `founder_personal`
- Source evidence: this posting packet plus original supporting receipts / PhonePe evidence
- Governance: explicit sole-operator self-approval

Expected obligation journal:

```
Dr 6250 Travel / Business Development Expense     ₹9,878.69
Cr 2400 Founder / Director Current Account        ₹9,878.69
```

## 5. Mandatory cash invariant

At expense recognition:

- Bank 1000 movement: **₹0**
- Canonical company cash movement: **₹0**
- Founder / Director Current Account liability created: **₹9,878.69**

The legacy company-payment route must reject this founder-paid expenditure.

## 6. Later reimbursement only when actually paid by company

When the company later reimburses the founder/director:

```
Dr 2400 Founder / Director Current Account        ₹9,878.69
Cr 1000 Bank                                      ₹9,878.69
```

Only this reimbursement event may reduce company cash for this founder-paid expense.

## 7. Release prerequisites

PR #306 local validation evidence:

- Focused finance suite: **23 / 23 pass**
- Full VYNDI suite: **178 / 178 pass**
- Failures: **0**
- Migration syntax: **pass**
- Typecheck: **pass**
- Production bundle: **pass**
- Isolated Neon founder-paid approval test: **pass**
- Wrong company-payment-path rejection: **pass**
- Founder reimbursement accounting test: **pass**
- Windows CRLF portability regression: **fixed**

## 8. Production release hold

Do not perform the real posting until all of the following are true:

1. GitHub billing-cycle freeze is cleared.
2. PR #306 is merged through the normal controlled path.
3. Production deployment and migration complete successfully.
4. VYNDI reports the founder-paid finance controls as available.
5. `office-travel` is explicitly approved.
6. Live GL and canonical cash are checked immediately after posting.

## 9. Live verification after posting

Verify the actual expenditure record shows:

- `amount_inr = 9878.69`
- `funding_source = founder_personal`
- `liability_account_code = 2400`
- `debit_account_code = 6250`
- `governance_marker = SOLE_OPERATOR_SELF_APPROVAL`
- lifecycle status = `approved` unless a later reimbursement has occurred

Verify the posted journal contains exactly the intended expense and founder-current-account lines.

Verify canonical company cash is unchanged by the expense approval.

## 10. Authority statement

This packet authorizes no production mutation by itself. It is a controlled posting instruction and verification checklist for use only after the corresponding application and database authority are deployed.
