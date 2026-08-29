import fs from "node:fs";
import path from "node:path";

const preloadJsPath = path.resolve("dist-electron/electron/preload.js");
const preloadCjsPath = path.resolve("dist-electron/electron/preload.cjs");

if (fs.existsSync(preloadJsPath)) {
  let code = fs.readFileSync(preloadJsPath, "utf8");
  code = code.replace(
    /import\s*\{\s*contextBridge\s*,\s*ipcRenderer\s*\}\s*from\s*["']electron["'];?/,
    'const { contextBridge, ipcRenderer } = require("electron");'
  );
  fs.writeFileSync(preloadCjsPath, code, "utf8");
  console.log("[build-preload] Generated preload.cjs for sandboxed renderer successfully.");
}
