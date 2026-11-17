import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const external = createRequire(new URL("../package.json", import.meta.url));

export function typescriptLoader(overrides = {}) {
  const cache = new Map();
  function load(filename) {
    let target = path.resolve(root, filename);
    if (!fs.existsSync(target)) target += ".ts";
    if (cache.has(target)) return cache.get(target).exports;
    if (target.endsWith(".json")) return JSON.parse(fs.readFileSync(target, "utf8"));
    const { outputText, diagnostics } = ts.transpileModule(fs.readFileSync(target, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
      reportDiagnostics: true,
    });
    if (diagnostics?.some((entry) => entry.category === ts.DiagnosticCategory.Error)) throw new Error("Test module did not compile");
    const loaded = { exports: {} };
    cache.set(target, loaded);
    const localRequire = (name) => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.startsWith("@/")) return load(path.join("src", name.slice(2)));
      if (name.startsWith(".")) return load(path.resolve(path.dirname(target), name));
      if (name === "server-only") return {};
      return external(name);
    };
    vm.runInNewContext(outputText, {
      module: loaded, exports: loaded.exports, require: localRequire,
      URL, URLSearchParams, Request, Response, Headers, AbortSignal, TextDecoder, TextEncoder, Uint8Array,
      fetch, Buffer, process, console, setTimeout, clearTimeout,
    }, { filename: target });
    return loaded.exports;
  }
  return load;
}
