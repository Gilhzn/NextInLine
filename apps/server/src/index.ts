import { buildApp } from "./app";
import { seedCatalog } from "./catalog";
import { loadConfig } from "./config";
import type { Deps } from "./context";
import { Crypto } from "./crypto";
import { createSql, migrate } from "./db";
import { ClaudeExtractor, ManualExtractor } from "./extraction";
import { ConsoleEmail, ConsoleSms, ExpoPushProvider, LocalDiskStorage, MockPayments } from "./providers";
import { startWorker } from "./services/jobs";
import "./services/register";

async function main(): Promise<void> {
  const config = loadConfig();
  const sql = createSql(config.DATABASE_URL);
  const applied = await migrate(sql);
  if (applied.length) console.info(`applied migrations: ${applied.join(", ")}`);
  await seedCatalog(sql);

  const deps: Deps = {
    config,
    sql,
    crypto: new Crypto(config.MASTER_KEY),
    // Production adapters (SMS gateway, S3, PSP, email) implement the same interfaces in providers.ts.
    sms: new ConsoleSms(),
    storage: new LocalDiskStorage(config.STORAGE_DIR),
    push: new ExpoPushProvider(),
    payments: new MockPayments(),
    email: new ConsoleEmail(),
    extractor: config.extractionProvider === "claude" ? new ClaudeExtractor(config.ANTHROPIC_API_KEY) : new ManualExtractor(),
    now: () => new Date(),
  };

  const stops: Array<() => Promise<void>> = [];
  if (config.ROLE === "api" || config.ROLE === "all") {
    const app = await buildApp(deps, { logger: true });
    await app.listen({ port: config.PORT, host: config.HOST });
    stops.push(() => app.close());
  }
  if (config.ROLE === "worker" || config.ROLE === "all") {
    const worker = startWorker(deps);
    stops.push(worker.stop);
    console.info(`worker started (extraction: ${deps.extractor.name})`);
  }

  const shutdown = async () => {
    for (const stop of stops) await stop();
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
