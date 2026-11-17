import { existsSync } from "node:fs";
import path from "node:path";

const filename = path.join(process.cwd(), ".env.local");
if (existsSync(filename)) process.loadEnvFile(filename);
