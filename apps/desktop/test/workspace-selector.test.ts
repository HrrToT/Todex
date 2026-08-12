import { describe, expect, it, vi } from "vitest";

import { WorkspaceSelector } from "../src/main/workspace-selector.js";

describe("WorkspaceSelector", () => {
  it("returns the canonical selected directory and its display name", async () => {
    const showOpenDialog = vi.fn().mockResolvedValue({ canceled: false, filePaths: ["C:\\picked\\node"] });
    const realpath = vi.fn().mockResolvedValue("C:\\fixtures\\node");
    const selector = new WorkspaceSelector({ showOpenDialog, realpath });

    await expect(selector.choose()).resolves.toEqual({ workspaceRoot: "C:\\fixtures\\node", displayName: "node" });
    expect(showOpenDialog).toHaveBeenCalledWith({ properties: ["openDirectory"] });
    expect(realpath).toHaveBeenCalledWith("C:\\picked\\node");
  });

  it("returns undefined when the user cancels the native chooser", async () => {
    const selector = new WorkspaceSelector({
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
      realpath: vi.fn(),
    });

    await expect(selector.choose()).resolves.toBeUndefined();
  });
});
