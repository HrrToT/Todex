import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { WorkbenchApp } from "./App.js";
import { preloadApprovalBridge } from "./bridge.js";

const root = document.getElementById("root");
if (!root) throw new Error("renderer_root_missing");

createRoot(root).render(<StrictMode><WorkbenchApp approvalBridge={preloadApprovalBridge()} /></StrictMode>);
