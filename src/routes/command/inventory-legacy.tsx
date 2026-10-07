import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Compatibility route only.
 * Master Inventory is the canonical inventory workspace; legacy specialist
 * controls remain reachable from its governed navigation where still required.
 */
export const Route = createFileRoute("/command/inventory-legacy")({
  beforeLoad: () => {
    throw redirect({ to: "/command/inventory", replace: true });
  },
  component: () => null,
});
