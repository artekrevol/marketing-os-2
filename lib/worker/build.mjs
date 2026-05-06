import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm } from "node:fs/promises";
import { execSync } from "node:child_process";

globalThis.require = createRequire(import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));

const EXTERNAL = [
  "*.node",
  "sharp",
  "better-sqlite3",
  "sqlite3",
  "canvas",
  "bcrypt",
  "argon2",
  "fsevents",
  "re2",
  "farmhash",
  "pg-native",
];

async function buildAll() {
  const distDir = path.resolve(here, "dist");
  await rm(distDir, { recursive: true, force: true });

  // Build both entry points in parallel.
  await Promise.all([
    // Standalone worker process (run via `node dist/index.mjs`)
    esbuild({
      entryPoints: [path.resolve(here, "src/index.ts")],
      platform: "node",
      bundle: true,
      format: "esm",
      outdir: distDir,
      outExtension: { ".js": ".mjs" },
      logLevel: "info",
      sourcemap: true,
      external: EXTERNAL,
      plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
    }),
    // Embedded entry point (imported by the API server in production).
    // The api-server bundles this .mjs at build time; in production
    // NODE_ENV=production so pino-pretty is never loaded and thread-stream
    // is never spawned, avoiding the extra-port problem.
    esbuild({
      entryPoints: [path.resolve(here, "src/embedded.ts")],
      platform: "node",
      bundle: true,
      format: "esm",
      outdir: distDir,
      outExtension: { ".js": ".mjs" },
      logLevel: "info",
      sourcemap: true,
      external: EXTERNAL,
      plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
    }),
  ]);

  // Emit TypeScript declaration files (.d.ts) so the api-server can
  // import types from @workspace/worker/embedded without errors.
  // emitDeclarationOnly means tsc never overwrites the .mjs outputs above.
  // --force is required because tsc stores its build-info file at
  // lib/worker/tsconfig.tsbuildinfo (outside dist/), so after `rm dist -rf`
  // it thinks everything is still up-to-date and skips re-emission.
  execSync("tsc --build --force tsconfig.json", { cwd: here, stdio: "inherit" });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
