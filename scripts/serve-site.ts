// Serve site/ on http://localhost:5173 (PORT to change it). Any static file server works; this one needs nothing.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../site");
const PORT = Number(process.env.PORT ?? 5173);
const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
	".json": "application/json",
	".png": "image/png",
};

createServer((request, response) => {
	const path = normalize(decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname));
	let file = join(ROOT, path);
	if (!file.startsWith(ROOT)) {
		response.writeHead(403).end();
		return;
	}
	if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
	if (!existsSync(file)) {
		response.writeHead(404).end("not found");
		return;
	}
	response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
	createReadStream(file).pipe(response);
}).listen(PORT, () => console.log(`site: http://localhost:${PORT}`));
