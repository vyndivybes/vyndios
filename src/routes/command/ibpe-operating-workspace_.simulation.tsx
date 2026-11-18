import { createFileRoute, redirect } from "@tanstack/react-router";

/** Retired demo-only route: preserve old bookmarks without exposing a test console. */
export const Route = createFileRoute("/command/ibpe-operating-workspace_/simulation")({
  beforeLoad: () => {
    throw redirect({ to: "/command/ibpe-operating-workspace/optimizer" });
  },
  component: () => null,
});
