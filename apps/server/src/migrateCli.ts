import { seedCatalog } from "./catalog";
import { createSql, migrate } from "./db";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = createSql(url, { max: 1 });
const applied = await migrate(sql);
await seedCatalog(sql);
console.info(applied.length ? `applied: ${applied.join(", ")}` : "database is up to date");
await sql.end();
