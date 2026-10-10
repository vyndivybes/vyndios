import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultConfiguration,
  FRAME_SIZES,
  validateFrameSize,
  optionsFor,
  validateConfiguration,
} from "./product-configuration.ts";

test("catalogue options remain eligible at zero physical stock", () => {
  const options = optionsFor("core", "groupset");
  assert.ok(options.length > 0);
  assert.ok(options.every((option) => option.stockQty === 0));
});

test("variant fixes its groupset while retaining model option restrictions", () => {
  const configuration = defaultConfiguration("pro-rival-axs");
  assert.equal(configuration.groupset, "gs-rival-axs");
  assert.doesNotThrow(() => validateConfiguration("pro-rival-axs", configuration));
  assert.throws(
    () => validateConfiguration("pro-rival-axs", { ...configuration, groupset: "gs-105-r7150" }),
    /must match/,
  );
  assert.throws(
    () =>
      validateConfiguration("core-105", {
        ...defaultConfiguration("core-105"),
        wheelset: "ws-carbon-flagship",
      }),
    /not allowed/,
  );
});


test("sizes remain build attributes on the same variant and component BOM", () => {
  const baseline = validateConfiguration("pro-rival-axs", defaultConfiguration("pro-rival-axs"));
  for (const frameSize of FRAME_SIZES) {
    const configuration = defaultConfiguration("pro-rival-axs", frameSize);
    assert.equal(configuration.frameSize, frameSize);
    assert.deepEqual(validateConfiguration("pro-rival-axs", configuration), baseline);
    const revised = defaultConfiguration("pro-105-di2", configuration.frameSize);
    assert.equal(revised.frameSize, frameSize);
    assert.equal(revised.groupset, "gs-105-r7150");
  }
});

test("unknown historical size is preserved and unsupported sizes are rejected", () => {
  assert.equal(defaultConfiguration("core-105").frameSize, undefined);
  assert.doesNotThrow(() => validateFrameSize({}));
  assert.doesNotThrow(() => validateFrameSize({ frameSize: "" }));
  for (const frameSize of ["XXL", "s", "M/L", null, 42]) {
    assert.throws(() => validateFrameSize({ frameSize }), /Frame size must/);
  }
  assert.throws(() => validateConfiguration("core-105", {
    ...defaultConfiguration("core-105"), frameSize: "XXL" as never,
  }), /Frame size must/);
});
