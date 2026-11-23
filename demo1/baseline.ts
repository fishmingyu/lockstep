// The control group: Pi's own CodingTools on a plain directory through NodeExecutionEnv. bash is not replay-safe, so
// a crash mid-command leaves whatever the command had written, and the model is told only "interrupted".
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import type { Setup } from "./host.ts";

export function baseline(runDir: string): Setup {
	const cwd = join(runDir, "work");
	return { extension: CodingTools, env: () => new NodeExecutionEnv({ cwd }) };
}
