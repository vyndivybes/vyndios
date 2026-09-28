export const MANUAL_EXPENSE_CATEGORIES = [
  { id: "office_facility", label: "Office / facility / utilities", sourceCategory: "office", debitAccountCode: "6200" },
  { id: "digital_services", label: "Digital services / domains & hosting", sourceCategory: "office", debitAccountCode: "6200" },
  { id: "travel_business_dev", label: "Travel / business development", sourceCategory: "travel", debitAccountCode: "6250" },
  { id: "professional_statutory", label: "Professional / statutory", sourceCategory: "professional_statutory", debitAccountCode: "6300" },
  { id: "outsourcing_external", label: "Outsourcing / external services", sourceCategory: "outsourcing", debitAccountCode: "6400" },
  { id: "manufacturing_overhead", label: "Manufacturing overhead / consumables", sourceCategory: "manufacturing_overhead", debitAccountCode: "5200" },
  { id: "finance_cost", label: "Finance cost / bank charges", sourceCategory: "finance_cost", debitAccountCode: "6600" },
] as const;

export type ManualExpenseCategoryId = (typeof MANUAL_EXPENSE_CATEGORIES)[number]["id"];

export const THIRD_PARTY_PAYER_TYPES = [
  "employee",
  "director",
  "consultant",
  "friend",
  "family",
  "supplier",
  "other",
] as const;

export type ThirdPartyPayerType = (typeof THIRD_PARTY_PAYER_TYPES)[number];

export const REPAYMENT_STATUSES = ["required", "not_required", "undecided"] as const;
export type RepaymentStatus = (typeof REPAYMENT_STATUSES)[number];

export const EXTERNAL_SUPPORT_DESTINATIONS = ["company_bank", "founder_personal", "vendor_direct"] as const;
export type ExternalSupportDestination = (typeof EXTERNAL_SUPPORT_DESTINATIONS)[number];

export function manualExpenseCategory(id: string) {
  return MANUAL_EXPENSE_CATEGORIES.find((category) => category.id === id);
}

export function thirdPartyLiabilityAccount(repaymentStatus: RepaymentStatus) {
  return repaymentStatus === "required" ? "2450" : "2460";
}
