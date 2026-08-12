import { describe, expect, it } from "vitest";

import { createLocaleState, t } from "../src/renderer/i18n.js";

describe("desktop workbench localization", () => {
  it("uses Chinese as the default interface language", () => {
    expect(createLocaleState().locale).toBe("zh-CN");
    expect(t("zh-CN", "workbench.run")).toBe("开始运行");
  });

  it("keeps an English interface option without translating technical evidence", () => {
    expect(t("en-US", "workbench.run")).toBe("Run");
    expect(t("zh-CN", "technical.traceType", { value: "tool_completed" })).toBe("tool_completed");
  });
});
