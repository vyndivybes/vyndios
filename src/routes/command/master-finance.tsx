import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Compatibility route. The canonical Finance overview is the Financial Cockpit;
 * this legacy route now lands on the canonical consolidated Financial Cockpit.
 */
export const Route = createFileRoute("/command/master-finance")({
  beforeLoad: () => {
    throw redirect({ to: "/command/financial-cockpit", replace: true });
  },
  component: () => null,
});
