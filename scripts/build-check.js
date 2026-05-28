import { existsSync } from "node:fs";

const requiredFiles = ["index.html", "src/main.js", "src/styles.css", "server.js"];
const missingFiles = requiredFiles.filter((file) => !existsSync(new URL(`../${file}`, import.meta.url)));

if (missingFiles.length > 0) {
  console.error(`Missing required files: ${missingFiles.join(", ")}`);
  process.exit(1);
}

console.log("Build check passed.");
