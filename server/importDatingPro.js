// Import DatingPro (PG Dating Pro) members into cupidsCorner.
//
//   npm run import:datingpro -- --sql path/to/dump.sql [--dry-run]
//   DATINGPRO_DATABASE_URL=mysql://user:pass@host/db npm run import:datingpro [-- --dry-run]
//
// Members sign in afterwards with their DatingPro email or nickname and
// their existing password.
import { db, initDb } from "./db.js";
import { importDatingProUsers, rowsFromMysql, rowsFromSqlFile } from "./datingpro.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sqlIdx = args.indexOf("--sql");
const sqlFile = sqlIdx >= 0 ? args[sqlIdx + 1] : null;
const mysqlUrl = process.env.DATINGPRO_DATABASE_URL;

if (!sqlFile && !mysqlUrl) {
  console.error("Give a dump with --sql <file>, or set DATINGPRO_DATABASE_URL to the DatingPro MySQL database.");
  process.exit(1);
}

initDb();
const rows = sqlFile ? rowsFromSqlFile(sqlFile) : await rowsFromMysql(mysqlUrl);
const report = importDatingProUsers(db, rows, { dryRun });

console.log(`${dryRun ? "[dry run] would import" : "Imported"} ${report.imported.length} of ${rows.length} DatingPro members.`);
if (report.alreadyLinked) console.log(`${report.alreadyLinked} were already imported earlier.`);
if (report.needPasswordReset) console.log(`${report.needPasswordReset} had no bcrypt password and need a new one.`);
const reasons = {};
for (const s of report.skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
for (const [r, n] of Object.entries(reasons)) console.log(`Skipped ${n}: ${r}`);
