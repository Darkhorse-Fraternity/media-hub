import { describe, expect, it } from "vitest";

import { isMediaGenerationWorkerEnabled } from "./worker-config";

describe("isMediaGenerationWorkerEnabled", () => {
  it.each([undefined, "", "1", "true", "yes"])(
    "enables the worker for %s",
    (value) => {
      expect(isMediaGenerationWorkerEnabled(value)).toBe(true);
    },
  );

  it.each(["0", "false", "FALSE", " no ", "off"])(
    "disables the worker for %s",
    (value) => {
      expect(isMediaGenerationWorkerEnabled(value)).toBe(false);
    },
  );
});
