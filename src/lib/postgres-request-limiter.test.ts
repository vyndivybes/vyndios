import assert from "node:assert/strict";
import test from "node:test";
import { createRequestPostgresLimiter } from "./postgres-pool.ts";

test("request PostgreSQL limiter caps aggregate concurrent work at five", async () => {
  const withPermit = createRequestPostgresLimiter(5);
  let active = 0;
  let maxActive = 0;
  let releaseWave!: () => void;
  const wave = new Promise<void>((resolve) => {
    releaseWave = resolve;
  });

  const tasks = Array.from({ length: 12 }, (_, index) =>
    withPermit(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (index < 5) await wave;
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return index;
    }),
  );

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(maxActive, 5);
  releaseWave();
  const result = await Promise.all(tasks);
  assert.deepEqual(result, Array.from({ length: 12 }, (_, index) => index));
  assert.ok(maxActive <= 5);
});
