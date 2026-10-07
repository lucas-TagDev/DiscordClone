/**
 * Copia os assets WASM do RNNoise para a pasta pública do Next.js.
 * Executado automaticamente via "postinstall" (depois de npm install).
 *
 * Assim o build funciona em qualquer servidor sem copiar arquivos manualmente.
 */

const fs = require("fs");
const path = require("path");

const pkgDir = path.join(
  __dirname,
  "..",
  "node_modules",
  "@sapphi-red",
  "web-noise-suppressor",
  "dist",
);
const publicWasmDir = path.join(__dirname, "..", "public", "wasm");

fs.mkdirSync(publicWasmDir, { recursive: true });

const files = [
  // [caminho de origem no pacote, nome no destino em public/wasm]
  ["rnnoise.wasm", "rnnoise.wasm"],
  ["rnnoise_simd.wasm", "rnnoise_simd.wasm"],
  [path.join("rnnoise", "workletProcessor.js"), "rnnoiseWorklet.js"],
  [path.join("noiseGate", "workletProcessor.js"), "noiseGateWorklet.js"],
];

let copied = 0;
for (const [src, dest] of files) {
  const from = path.join(pkgDir, src);
  const to = path.join(publicWasmDir, dest);
  if (!fs.existsSync(from)) {
    console.warn(`[setup-rnnoise] Aviso: arquivo não encontrado -> ${from}`);
    continue;
  }
  fs.copyFileSync(from, to);
  copied += 1;
  console.log(`[setup-rnnoise] Copiado: public/wasm/${dest}`);
}

if (copied === 0) {
  console.error(
    "[setup-rnnoise] ERRO: nenhum asset do RNNoise foi copiado. " +
      "Verifique se @sapphi-red/web-noise-suppressor foi instalado.",
  );
  process.exit(1);
}

console.log("[setup-rnnoise] RNNoise WASM pronto para uso.");
