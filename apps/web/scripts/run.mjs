// Cross-platform launcher: `pnpm dev` / `pnpm start` use PORT if set, else 3100 (3000 is often taken by other tools).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const mode = process.argv[2] === "start" ? "start" : "dev";
const port = process.env.PORT ?? "3100";
const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
console.log(`Gatehouse web (${mode}) on http://localhost:${port}`);
const child = spawn(process.execPath, [next, mode, "-p", port], { stdio: "inherit", env: { ...process.env, PORT: port } });
child.on("exit", (code) => process.exit(code ?? 0));
