import { readFileSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(
	readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
) as { version: string };
export const version = pkg.version || "unknown";
