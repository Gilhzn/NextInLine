import { buildApp } from "./app";
import { seedCatalog } from "./catalog";
import { loadConfig } from "./config";
import { createSql, migrate } from "./db";
import { captureError, flushMonitoring, initMonitoring } from "./monitoring";
import { ensureDailyMaintenance } from "./services/maintenance";
import { startWorker } from "./services/jobs";
import { createDeps } from "./wiring";
import "./services/register";

async function main(): Promise<void> {
  const config = loadConfig();
  initMonitoring(config);
  const sql = createSql(config.DATABASE_URL);
  const applied = await migrate(sql);
  if (applied.length) console.info(`applied migrations: ${applied.join(", ")}`);
  await seedCatalog(sql);

  const { deps, summary } = createDeps(config, sql);
  console.info(`services: ${Object.entries(summary).map(([k, v]) => `${k}=${v}`).join(" · ")}`);

  const stops: Array<() => Promise<void>> = [];
  if (config.ROLE === "api" || config.ROLE === "all") {
    const app = await buildApp(deps, { logger: true });
    await app.listen({ port: config.PORT, host: config.HOST });
    stops.push(() => app.close());
  }
  if (config.ROLE === "worker" || config.ROLE === "all") {
    await ensureDailyMaintenance(deps);
    const worker = startWorker(deps);
    stops.push(worker.stop);
    console.info(`worker started (extraction: ${deps.extractor.name})`);
  }

  const shutdown = async () => {
    for (const stop of stops) await stop();
    await flushMonitoring();
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch(async (error) => {
  console.error(error);
  captureError(error, { tags: { phase: "startup" } });
  await flushMonitoring();
  process.exit(1);
});
