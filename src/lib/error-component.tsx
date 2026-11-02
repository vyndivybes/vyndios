import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";

export function AppErrorComponent({ error }: ErrorComponentProps) {
  // TanStack Router may deliver any thrown value here, including primitives.
  // Never access properties before narrowing; preserve the 401 redirect boundary.
  const objectError = typeof error === "object" && error !== null;
  const message = typeof error === "string" ? error
    : objectError && "message" in error && typeof error.message === "string"
      ? error.message : "";
  const status = objectError && "status" in error ? error.status : undefined;
  const unauthenticated = message === "Unauthorized" || status === 401;

  useEffect(() => {
    if (!unauthenticated) return;
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }, [unauthenticated]);

  if (unauthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 text-sm text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">
        Redirecting to sign in…
      </main>
    );
  }

  return (
    <main
      className={
        "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center " +
        "bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50"
      }
    >
      <span className="text-red-500" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm break-words text-zinc-500 dark:text-zinc-400">
        {message || "An unexpected error occurred. Try reloading the page."}
      </p>
    </main>
  );
}
