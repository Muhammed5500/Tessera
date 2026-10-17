#!/usr/bin/env node
// contracts/out içindeki ABI'ları agent ve web için TypeScript dosyalarına yazar.
// Kullanım (repo kökünden): cd contracts && forge build && cd .. && node scripts/export-abi.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const contracts = [
  { name: "PredictionMarket", exportName: "predictionMarketAbi" },
  { name: "MockUSDC", exportName: "mockUsdcAbi" },
];

const body = contracts
  .map(({ name, exportName }) => {
    const artifact = JSON.parse(readFileSync(join(root, "contracts", "out", `${name}.sol`, `${name}.json`), "utf8"));
    return `export const ${exportName} = ${JSON.stringify(artifact.abi, null, 2)} as const;\n`;
  })
  .join("\n");

const content = `// Bu dosya scripts/export-abi.mjs tarafından üretilir. Elle düzenleme.\n\n${body}`;

for (const target of [join(root, "agent", "src", "chain", "abi.ts"), join(root, "web", "lib", "abi.ts")]) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log("yazıldı:", target);
}
