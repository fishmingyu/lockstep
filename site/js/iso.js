// Isometric geometry and the SVG pieces every scene is built from: blocks, slabs, cylinders, files, people, zones,
// pills, and glyphs. Grid x runs to the lower right, grid y to the lower left, z up; one grid unit is U pixels.
export const U = 34;
const C = Math.cos(Math.PI / 6);
const R2 = Math.SQRT2;
export const NS = "http://www.w3.org/2000/svg";

/** Grid point → screen point. */
export const P = (x, y, z = 0) => [(x - y) * C * U, (x + y) * 0.5 * U - z * U];

export function s(tag, attrs = {}, ...children) {
	const el = document.createElementNS(NS, tag);
	for (const [key, value] of Object.entries(attrs)) if (value !== undefined && value !== null && value !== false) el.setAttribute(key, String(value));
	for (const child of children.flat()) if (child) el.append(child);
	return el;
}

const f = (n) => (Math.round(n * 10) / 10).toString();
const pt = ([x, y]) => `${f(x)},${f(y)}`;
export const points = (list) => list.map(pt).join(" ");

function toward(p, q, r) {
	const dx = q[0] - p[0];
	const dy = q[1] - p[1];
	const len = Math.hypot(dx, dy) || 1;
	const t = Math.min(r, len / 2) / len;
	return [p[0] + dx * t, p[1] + dy * t];
}

/** A closed polygon with rounded corners. */
export function rounded(list, r) {
	const n = list.length;
	let d = "";
	for (let i = 0; i < n; i++) {
		const prev = list[(i - 1 + n) % n];
		const at = list[i];
		const next = list[(i + 1) % n];
		d += `${i === 0 ? "M" : "L"}${pt(toward(at, prev, r))}Q${pt(at)} ${pt(toward(at, next, r))}`;
	}
	return `${d}Z`;
}

/** An open polyline with rounded bends. */
export function roundedLine(list, r) {
	let d = `M${pt(list[0])}`;
	for (let i = 1; i < list.length - 1; i++) d += `L${pt(toward(list[i], list[i - 1], r))}Q${pt(list[i])} ${pt(toward(list[i], list[i + 1], r))}`;
	return `${d}L${pt(list.at(-1))}`;
}

const bboxOf = (list) => {
	const xs = list.map((p) => p[0]);
	const ys = list.map((p) => p[1]);
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

// ── glyphs: 24×24 line icons ─────────────────────────────────────────────
export const GLYPHS = {
	server: "M5 4h14v6H5zM5 14h14v6H5zM8.5 7h.01M8.5 17h.01M12 7h4M12 17h4",
	db: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
	cpu: "M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4",
	bot: "M5 9h14v10H5zM12 5.5V9M9.5 13.5h.01M14.5 13.5h.01M9.5 16.5h5M2.5 13v3M21.5 13v3M12 3.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z",
	terminal: "M4 5h16v14H4zM7.5 10l3 2.2-3 2.2M12.5 15h4.5",
	file: "M6 3h8l4 4v14H6zM14 3v4h4",
	branch: "M6 3v12.5M6 20.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zM18 8.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zM18 8.5c0 5.5-12 2.5-12 7",
	shield: "M12 3l7 3v5.5c0 4.5-3 7.5-7 9.5-4-2-7-5-7-9.5V6zM9 12l2 2 4-4",
	filter: "M4 5h16l-6 7.5v5.5l-4 2v-7.5z",
	inbox: "M4 13l3-8h10l3 8v6H4zM4 13h5l1 2h4l1-2h5",
	user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5",
	zap: "M13 2 4 14h7l-1 8 9-12h-7z",
	layers: "M12 3 3 8l9 5 9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5",
	box: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
	folder: "M3 6h6l2 2h10v11H3z",
	commit: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 12h6M15 12h6",
	check: "M5 12.5l4.5 4.5L19 7",
	x: "M6 6l12 12M18 6 6 18",
	refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4.5V11h-6.5",
	clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2",
	split: "M3 12h6l4-6h7M9 12l4 6h7M17 3l3 3-3 3M17 15l3 3-3 3",
	hash: "M5 9h14M5 15h14M10 4 8 20M16 4l-2 16",
	alert: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v5.5M12 16.5h.01",
	lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
	merge: "M7 4v16M17 20.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zM7 7.5c0 6 10 3.5 10 8",
	copy: "M9 9h11v11H9zM5 15V4h11",
	bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z",
	sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
	warn: "M12 4 2.5 20h19zM12 10v4.5M12 17.5h.01",
	list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
	gauge: "M4 18a8 8 0 1 1 16 0M12 18l4-5",
	skull: "M12 3a8 8 0 0 0-5 14.2V20h10v-2.8A8 8 0 0 0 12 3zM9 11h.01M15 11h.01M10 20v-2M14 20v-2",
	play: "M7 5v14l11-7z",
	pause: "M8 5v14M16 5v14",
	replay: "M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4v4.5h4.5",
	arrowR: "M5 12h14M13 6l6 6-6 6",
	arrowL: "M19 12H5M11 6l-6 6 6 6",
	chevR: "M9 6l6 6-6 6",
	book: "M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z",
	git: "M12 3l9 9-9 9-9-9zM12 8v8M9 12h6",
	gate: "M4 20V8l8-4 8 4v12M8 20v-8h8v8M4 12h4M16 12h4",
	send: "M4 12 20 4l-4 16-4-6zM12 14l8-10",
	mail: "M3 6h18v12H3zM3 6l9 7 9-7",
	signal: "M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0M12 12v9",
};

/** An icon as an HTML-ready SVG string, for the page chrome. */
export const icon = (name, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${GLYPHS[name] ?? ""}"/></svg>`;

/** A flat glyph centered at (x, y), size px. */
export function glyph(name, x, y, size = 22, color = "currentColor") {
	const k = size / 24;
	return s("path", {
		class: "glyph",
		d: GLYPHS[name] ?? GLYPHS.box,
		transform: `translate(${f(x - 12 * k)} ${f(y - 12 * k)}) scale(${k})`,
		stroke: color,
		"vector-effect": "non-scaling-stroke",
	});
}

const TONES = ["blue", "orange", "yellow", "green", "violet", "rose", "paper", "grey"];

/** Gradient, filter and marker definitions, added to the scene's <defs> once. */
export function defs() {
	const out = [];
	for (const tone of TONES) {
		const stops = (a, b) => [s("stop", { offset: "0", style: `stop-color:var(--${tone}-${a})` }), s("stop", { offset: "1", style: `stop-color:var(--${tone}-${b})` })];
		out.push(s("linearGradient", { id: `g-${tone}-t`, x1: "0", y1: "0", x2: "1", y2: "1" }, stops("t1", "t2")));
		out.push(s("linearGradient", { id: `g-${tone}-l`, x1: "0", y1: "0", x2: "0", y2: "1" }, stops("l1", "l2")));
		out.push(s("linearGradient", { id: `g-${tone}-r`, x1: "0", y1: "0", x2: "0", y2: "1" }, stops("r1", "r2")));
		out.push(s("linearGradient", { id: `g-${tone}-c`, x1: "0", y1: "0", x2: "1", y2: "0" }, stops("l1", "r2")));
	}
	out.push(s("filter", { id: "soft", x: "-20%", y: "-40%", width: "140%", height: "180%" }, s("feGaussianBlur", { stdDeviation: "4" })));
	const marker = (id, color) =>
		s(
			"marker",
			{ id, viewBox: "0 0 10 10", refX: "7.5", refY: "5", markerWidth: "4.2", markerHeight: "4.2", orient: "auto-start-reverse", markerUnits: "strokeWidth" },
			s("path", { d: "M0.5 0.8 9.5 5 0.5 9.2 2.6 5z", style: `fill:${color}`, "stroke-linejoin": "round" }),
		);
	out.push(marker("arrow-ink", "var(--stroke)"), marker("arrow-rust", "var(--rust)"), marker("arrow-green", "#5fae57"), marker("arrow-muted", "var(--muted-2)"), marker("arrow-violet", "#7c63d0"));
	return out;
}

const ink = (tone) => `var(--${tone}-k)`;

function shadow(w, d) {
	return s("path", { class: "ground-shadow", d: rounded([P(0.1, 0.25), P(w + 0.4, 0.25), P(w + 0.4, d + 0.5), P(0.1, d + 0.5)], 10), filter: "url(#soft)" });
}

function labelLines(x, y, lines, color, { size = 13, sub } = {}) {
	const g = s("g", {});
	const all = lines.filter((line) => line !== "");
	const lh = size * 1.2;
	const subH = sub ? 13 : 0;
	const y0 = y - (all.length * lh + subH) / 2;
	all.forEach((line, k) => g.append(s("text", { class: "label", x: f(x), y: f(y0 + lh * (k + 0.5)), style: `fill:${color};font-size:${size}px` }, line)));
	if (sub) g.append(s("text", { class: "label label--sub", x: f(x), y: f(y0 + all.length * lh + subH / 2 + 1), style: `fill:${color}` }, sub));
	return g;
}

// ── node builders: each returns { el, box: [x0,y0,x1,y1], at: anchor points, center } in local screen coords ──

let clipSeq = 0;

/** A rounded isometric block; the workhorse for processes, models, gates. */
export function block({ size = [2.4, 2.4, 2], tone = "blue", icon: name, label = "", sub, labelSize }) {
	const [w, d, h] = size;
	const A = P(0, 0, h), B = P(w, 0, h), Cc = P(w, d, h), D = P(0, d, h), E = P(w, 0, 0), F = P(w, d, 0), G = P(0, d, 0);
	const sil = [A, B, E, F, G, D];
	const r = Math.min(10, h * U * 0.22 + 3);
	const id = `clip${++clipSeq}`;
	const shape = rounded(sil, r);
	const el = s("g", {}, shadow(w, d), s("clipPath", { id }, s("path", { d: shape })));
	const body = s(
		"g",
		{ class: "body", "clip-path": `url(#${id})` },
		s("polygon", { points: points([A, B, Cc, D]), fill: `url(#g-${tone}-t)` }),
		s("polygon", { points: points([B, E, F, Cc]), fill: `url(#g-${tone}-r)` }),
		s("polygon", { points: points([D, Cc, F, G]), fill: `url(#g-${tone}-l)` }),
		s("polyline", { class: "rim", points: points([D, Cc, B].map(([x, y]) => [x, y + 2.2])) }),
		s("polyline", { class: "crease", points: points([D, Cc, B]) }),
	);
	el.append(body, s("path", { class: "outline", d: shape }));
	const lines = String(label).split("\n");
	const T = P(w / 2, d / 2, h);
	const midFront = [Cc[0], Cc[1] + (F[1] - Cc[1]) * 0.47];
	if (name) el.append(glyph(name, T[0], T[1], Math.min(26, w * 10.5), ink(tone)));
	if (label) el.append(labelLines(midFront[0], midFront[1], lines, ink(tone), { size: labelSize ?? (lines.some((l) => l.length > 9) ? 12 : 13.5), sub }));
	const box = bboxOf(sil);
	return { el, box, at: anchors(box, A, F, D, G, B, E), center: [(A[0] + F[0]) / 2, (A[1] + F[1]) / 2] };
}

/** A thin platform: a directory, a workspace, a sandbox floor. Its label becomes a pill. */
export function slab({ size = [4, 3, 0.35], tone = "paper" }) {
	const [w, d, h] = size;
	const A = P(0, 0, h), B = P(w, 0, h), Cc = P(w, d, h), D = P(0, d, h), E = P(w, 0, 0), F = P(w, d, 0), G = P(0, d, 0);
	const sil = [A, B, E, F, G, D];
	const id = `clip${++clipSeq}`;
	const shape = rounded(sil, 9);
	const el = s("g", {}, shadow(w, d), s("clipPath", { id }, s("path", { d: shape })));
	el.append(
		s(
			"g",
			{ class: "body", "clip-path": `url(#${id})` },
			s("polygon", { points: points([A, B, Cc, D]), fill: `url(#g-${tone}-t)` }),
			s("polygon", { points: points([B, E, F, Cc]), fill: `url(#g-${tone}-r)` }),
			s("polygon", { points: points([D, Cc, F, G]), fill: `url(#g-${tone}-l)` }),
			s("polyline", { class: "crease", points: points([D, Cc, B]) }),
		),
		s("path", { class: "outline", d: shape }),
	);
	const box = bboxOf(sil);
	return { el, box, at: anchors(box, A, F, D, G, B, E), center: P(w / 2, d / 2, h) };
}

/** A cylinder: a store. */
export function cylinder({ r = 1.2, h = 1.9, tone = "violet", icon: name, label, bands = 2 }) {
	const c = [r, r];
	const top = P(c[0], c[1], h);
	const bot = P(c[0], c[1], 0);
	const rx = r * C * U * R2;
	const ry = r * 0.5 * U * R2;
	const side = `M${f(top[0] - rx)},${f(top[1])}L${f(bot[0] - rx)},${f(bot[1])}A${f(rx)} ${f(ry)} 0 0 0 ${f(bot[0] + rx)},${f(bot[1])}L${f(top[0] + rx)},${f(top[1])}Z`;
	const el = s("g", {}, s("ellipse", { class: "ground-shadow", cx: f(bot[0] + 6), cy: f(bot[1] + 6), rx: f(rx + 4), ry: f(ry + 3), filter: "url(#soft)" }));
	const body = s("g", { class: "body" }, s("path", { d: side, fill: `url(#g-${tone}-c)` }));
	for (let i = 1; i <= bands; i++) {
		const y = top[1] + ((bot[1] - top[1]) * i) / (bands + 1);
		body.append(s("path", { class: "crease", d: `M${f(top[0] - rx)},${f(y)}A${f(rx)} ${f(ry)} 0 0 0 ${f(top[0] + rx)},${f(y)}`, opacity: ".45" }));
	}
	body.append(s("ellipse", { cx: f(top[0]), cy: f(top[1]), rx: f(rx), ry: f(ry), fill: `url(#g-${tone}-t)` }));
	body.append(s("path", { class: "rim", d: `M${f(top[0] - rx + 3)},${f(top[1] + 3)}A${f(rx - 3)} ${f(ry - 2)} 0 0 0 ${f(top[0] + rx - 3)},${f(top[1] + 3)}` }));
	el.append(body, s("path", { class: "outline", d: side }), s("ellipse", { class: "outline", cx: f(top[0]), cy: f(top[1]), rx: f(rx), ry: f(ry) }));
	if (name) el.append(glyph(name, top[0], top[1] + (bot[1] - top[1]) * 0.52 + ry * 0.35, 22, ink(tone)));
	if (label) el.append(labelLines(top[0], top[1], [label], ink(tone), { size: 11.5 }));
	const box = [top[0] - rx, top[1] - ry, top[0] + rx, bot[1] + ry];
	return {
		el,
		box,
		at: { top: [top[0], top[1] - ry], bottom: [bot[0], bot[1] + ry], left: [top[0] - rx, (top[1] + bot[1]) / 2], right: [top[0] + rx, (top[1] + bot[1]) / 2] },
		center: [top[0], (top[1] + bot[1]) / 2],
	};
}

const LINE_LENGTHS = [1, 0.84, 0.95, 0.68, 1, 0.9, 0.62, 0.96, 0.8, 0.74];

/** An upright sheet of paper; `lines` draws that many lines of text on it, growing taller past ten. */
export function file({ w = 1.25, tone = "paper", lines = 0, prevLines, expect = 10, text, grow = 0.32 }) {
	const d = 0.16;
	const rows = Math.max(lines, 0);
	const h = 1.45 + Math.max(0, rows - 10) * 0.105;
	const k = 0.3;
	const p = (x, y, z) => P(x, y, z);
	const big = [p(0, d, 0), p(w, d, 0), p(w, d, h - k), p(w - k, d, h), p(0, d, h)];
	const right = [p(w, 0, 0), p(w, d, 0), p(w, d, h - k), p(w, 0, h - k)];
	const top = [p(0, 0, h), p(w - k, 0, h), p(w - k, d, h), p(0, d, h)];
	const bevel = [p(w - k, 0, h), p(w, 0, h - k), p(w, d, h - k), p(w - k, d, h)];
	const fold = [p(w - k, d, h), p(w - k, d, h - k), p(w, d, h - k)];
	const sil = [p(0, 0, h), p(w - k, 0, h), p(w, 0, h - k), p(w, 0, 0), p(w, d, 0), p(0, d, 0), p(0, d, h)];
	const el = s("g", {}, s("path", { class: "ground-shadow", d: rounded([p(0.05, 0.2, 0), p(w + 0.35, 0.2, 0), p(w + 0.35, d + 0.55, 0), p(0.05, d + 0.55, 0)], 6), filter: "url(#soft)" }));
	const body = s(
		"g",
		{ class: "body" },
		s("polygon", { points: points(top), fill: `url(#g-${tone}-t)` }),
		s("polygon", { points: points(right), fill: `url(#g-${tone}-r)` }),
		s("polygon", { points: points(bevel), fill: `url(#g-${tone}-r)` }),
		s("polygon", { points: points(big), fill: `url(#g-${tone}-t)` }),
		s("polygon", { points: points(fold), fill: `url(#g-${tone}-r)`, class: "crease", style: "fill-opacity:1" }),
	);
	let z = h - 0.36;
	if (text) {
		const [tx, ty] = p(0.14, d, h - 0.33);
		body.append(s("text", { transform: `matrix(${C} 0.5 0 1 ${f(tx)} ${f(ty)})`, style: `font-size:9.5px;font-weight:800;fill:${ink(tone)}` }, text));
		z -= 0.24;
	}
	const before = prevLines ?? rows;
	for (let i = 0; i < rows; i++) {
		const len = (w - 0.28) * LINE_LENGTHS[i % 10];
		const [x0, y0] = p(0.14, d, z - i * 0.105);
		const [x1, y1] = p(0.14 + len, d, z - i * 0.105);
		const cls = `file-line${i >= expect ? " is-extra" : ""}${i >= before ? " is-grow" : ""}`;
		body.append(s("line", { class: cls, x1: f(x0), y1: f(y0), x2: f(x1), y2: f(y1), stroke: ink(tone), style: i >= before ? `animation-delay:${Math.round((i - before) * grow * 1000)}ms` : undefined }));
	}
	el.append(body, s("path", { class: "outline", d: rounded(sil, 3) }));
	const box = bboxOf(sil);
	return { el, box, at: anchors(box, sil[0], p(w, d, 0), p(0, d, h), p(0, d, 0), p(w, 0, h - k), p(w, 0, 0)), center: p(w / 2, d / 2, h / 2) };
}

/** A person: the approver. */
export function person({ tone = "green", icon: name }) {
	const [x, y] = P(0.5, 0.5, 0);
	const body = `M${x - 13},${y}v-17a13 13 0 0 1 26 0v17z`;
	const el = s(
		"g",
		{},
		s("ellipse", { class: "ground-shadow", cx: x + 4, cy: y + 3, rx: 18, ry: 7, filter: "url(#soft)" }),
		s("g", { class: "body" }, s("path", { d: body, fill: `url(#g-${tone}-c)` }), s("circle", { cx: x, cy: y - 40, r: 9.5, fill: `url(#g-${tone}-t)` })),
		s("path", { class: "outline", d: body }),
		s("circle", { class: "outline", cx: x, cy: y - 40, r: 9.5 }),
	);
	if (name) el.append(glyph(name, x, y - 13, 14, ink(tone)));
	const box = [x - 14, y - 51, x + 14, y + 2];
	return { el, box, at: { top: [x, y - 51], bottom: [x, y + 4], left: [x - 15, y - 20], right: [x + 15, y - 20] }, center: [x, y - 22] };
}

/** A dashed area on the ground: a process boundary, a sandbox. */
export function zone({ size = [6, 5], label, tone }) {
	const [w, d] = size;
	const corners = [P(0, 0), P(w, 0), P(w, d), P(0, d)];
	const el = s("g", {}, s("path", { class: "zone", d: rounded(corners, 10), style: tone ? `fill:var(--${tone}-t1);fill-opacity:.55` : undefined }));
	if (label) {
		const [x, y] = P(0.35, 0.25);
		el.append(s("text", { class: "zone-label", transform: `matrix(${C} 0.5 0 1 ${f(x)} ${f(y + 13)})` }, label.toUpperCase()));
	}
	const box = bboxOf(corners);
	return { el, box, at: anchors(box, corners[0], corners[2], corners[3], corners[3], corners[1], corners[1]), center: P(w / 2, d / 2) };
}

/** No body: only pills, pinned to a grid point. */
export function marker() {
	return { el: s("g", {}), box: [0, 0, 0, 0], at: { top: [0, 0], bottom: [0, 0], left: [0, 0], right: [0, 0] }, center: [0, 0] };
}

function anchors(box, top, bottom, leftTop, leftBottom, rightTop, rightBottom) {
	return {
		top: [top[0], box[1]],
		bottom: [bottom[0], box[3]],
		left: [box[0], (leftTop[1] + leftBottom[1]) / 2],
		right: [box[2], (rightTop[1] + rightBottom[1]) / 2],
	};
}

// ── pills ──────────────────────────────────────────────────────────────────
const CHAR = 7.22;

/** A label pill. Returns its element and size; (0,0) is its anchor per `align`. */
export function pill(tag, align = "center") {
	const text = String(tag.text ?? "");
	const hasIcon = Boolean(tag.icon);
	const meter = tag.meter;
	const h = 25;
	const w = Math.round(text.length * CHAR + 22 + (hasIcon ? 18 : 0) + (meter ? 44 : 0));
	const x0 = align === "center" ? -w / 2 : align === "end" ? -w : 0;
	const g = s("g", { class: `pill pill--${tag.tone ?? "plain"}` });
	g.append(s("rect", { class: "pill-shadow", x: x0 + 1.5, y: -h / 2 + 2.5, width: w, height: h, rx: h / 2 }));
	g.append(s("rect", { class: "pill-bg", x: x0, y: -h / 2, width: w, height: h, rx: h / 2 }));
	let cx = x0 + 11;
	if (hasIcon) {
		g.append(glyph(tag.icon, cx + 6, 0, 14, "currentColor"));
		g.lastChild.setAttribute("stroke", tag.tone === "rust" ? "var(--red-ink)" : tag.tone === "ink" ? "var(--paper)" : "var(--ink)");
		cx += 18;
	}
	if (meter) {
		const ratio = Math.max(0, Math.min(1, meter.value / meter.max));
		g.append(s("rect", { class: "meter-track", x: cx, y: -3.5, width: 34, height: 7, rx: 3.5 }));
		g.append(s("rect", { class: `meter-fill${meter.bad ? " is-bad" : ""}`, x: cx, y: -3.5, width: Math.max(4, 34 * ratio), height: 7, rx: 3.5 }));
		cx += 44;
	}
	g.append(s("text", { class: "pill-text", x: cx, y: 0.5 }, text));
	return { el: g, w, h };
}
