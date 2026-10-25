import os from "node:os";
import path from "node:path";
import { createApp, lanUrls } from "./app.js";

const port = Number(process.env.SETFLOW_PORT ?? process.env.PORT ?? 5280);
const dataDir = process.env.SETFLOW_DATA ?? path.join(os.homedir(), ".setflow");
const staticDir = process.env.SETFLOW_WEB ?? path.resolve(import.meta.dirname, "../../web/dist");

const app = createApp({ dataFile: path.join(dataDir, "setflow.db"), staticDir });
let bound: number;
try {
  bound = await app.listen(port);
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  console.error(
    code === "EADDRINUSE"
      ? `Port ${port} is already in use. Is SetFlow already running? Close it, or start with SETFLOW_PORT=<other port>.`
      : `Could not start the SetFlow host: ${(err as Error).message}`,
  );
  process.exit(1);
}

const urls = lanUrls(bound);
console.log("SetFlow host is running. No Internet connection is needed.\n");
console.log(`  Control:  ${urls[0]}/#/control`);
for (const url of urls.slice(1)) console.log(`  On the LAN: ${url}  (Stage: /#/stage, Musician: /#/musician)`);
console.log(`\n  Library: ${dataDir}`);
if (app.live.status().recovery) {
  console.log("  An unfinished performance was found. Open Control View to resume or discard it.");
}
console.log("\nPress Ctrl+C to stop.");

const shutdown = () => {
  void app.close().then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
