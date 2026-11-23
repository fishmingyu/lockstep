// The scene engine. A lesson declares its nodes and edges once; each step patches what is shown. fold() computes the
// scene at a step from the steps before it, and Scene.render() moves the SVG from whatever it shows to that scene:
// new nodes drop in, removed ones fade out, moved ones glide, and the camera reframes around what is visible.
import { block, cylinder, defs, file, marker, P, person, pill, roundedLine, s, slab, zone } from "./iso.js";

const BUILDERS = { block, slab, cylinder, file, person, zone, marker };
const LAYER = { zone: 0, slab: 1 };

/** The scene after `index` steps: visible nodes and edges with their current props, plus this step's effects. */
export function fold(lesson, index) {
	const nodes = {};
	const edges = {};
	for (const [id, def] of Object.entries(lesson.nodes)) nodes[id] = { ...def, id, visible: false };
	for (const [id, def] of Object.entries(lesson.edges ?? {})) edges[id] = { ...def, id, visible: false };
	const hud = {};
	let order = [];
	let before = {};
	for (let i = 0; i <= index; i++) {
		const step = lesson.steps[i];
		order = [];
		if (i === index) before = Object.fromEntries(Object.entries(nodes).map(([id, n]) => [id, n.visible ? (n.lines ?? 0) : undefined]));
		for (const id of step.show ?? []) {
			const target = nodes[id] ?? edges[id];
			if (target === undefined) throw new Error(`${lesson.id} step ${i + 1}: no node or edge ${id}`);
			if (!target.visible) order.push(id);
			target.visible = true;
		}
		for (const id of step.hide ?? []) {
			const target = nodes[id] ?? edges[id];
			if (target === undefined) throw new Error(`${lesson.id} step ${i + 1}: no node or edge ${id}`);
			target.visible = false;
		}
		for (const [id, patch] of Object.entries(step.set ?? {})) {
			const target = nodes[id] ?? edges[id];
			if (target === undefined) throw new Error(`${lesson.id} step ${i + 1}: no node or edge ${id}`);
			Object.assign(target, patch);
		}
		Object.assign(hud, step.hud ?? {});
	}
	const step = lesson.steps[index];
	// a file that gained lines in this step draws them one by one
	for (const node of Object.values(nodes)) {
		const was = before[node.id];
		if (node.kind === "file" && was !== undefined && (node.lines ?? 0) > was) node.prevLines = was;
	}
	return {
		nodes: Object.fromEntries(Object.entries(nodes).filter(([, n]) => n.visible)),
		edges: Object.fromEntries(Object.entries(edges).filter(([, e]) => e.visible)),
		hud,
		order,
		packets: step.packets ?? [],
		fx: step.fx ?? [],
		focus: step.focus ?? {},
	};
}

const footprint = (node) => {
	const [x, y] = node.at;
	if (node.kind === "cylinder") return [x, y, x + 2 * (node.r ?? 1.2), y + 2 * (node.r ?? 1.2)];
	if (node.kind === "file") return [x, y, x + (node.w ?? 1.25), y + 0.16];
	if (node.kind === "person") return [x, y, x + 1, y + 1];
	if (node.kind === "marker") return [x, y, x, y];
	const [w, d] = node.size ?? (node.kind === "slab" ? [4, 3] : [2.4, 2.4]);
	return [x, y, x + w, y + d];
};

function exitT(p0, p1, rect) {
	const d = [p1[0] - p0[0], p1[1] - p0[1]];
	let t = Infinity;
	for (const axis of [0, 1]) {
		if (Math.abs(d[axis]) < 1e-9) continue;
		const lo = rect[axis];
		const hi = rect[axis + 2];
		t = Math.min(t, Math.max((lo - p0[axis]) / d[axis], (hi - p0[axis]) / d[axis]));
	}
	return Math.max(0, Math.min(1, t === Infinity ? 0 : t));
}
function enterT(p0, p1, rect) {
	const d = [p1[0] - p0[0], p1[1] - p0[1]];
	let t = -Infinity;
	for (const axis of [0, 1]) {
		if (Math.abs(d[axis]) < 1e-9) continue;
		const lo = rect[axis];
		const hi = rect[axis + 2];
		t = Math.max(t, Math.min((lo - p0[axis]) / d[axis], (hi - p0[axis]) / d[axis]));
	}
	return Math.max(0, Math.min(1, t === -Infinity ? 1 : t));
}
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const grow = (r, g) => [r[0] - g, r[1] - g, r[2] + g, r[3] + g];

/** The grid polyline of an edge, trimmed to the two footprints. */
function route(edge, from, to) {
	const a = footprint(from);
	const b = footprint(to);
	const lane = edge.lane ?? 0;
	const ca = [(a[0] + a[2]) / 2 + (edge.dx0 ?? 0), (a[1] + a[3]) / 2 + (edge.dy0 ?? 0)];
	const cb = [(b[0] + b[2]) / 2 + (edge.dx1 ?? 0), (b[1] + b[3]) / 2 + (edge.dy1 ?? 0)];
	let pts;
	if (edge.via) pts = [ca, ...edge.via, cb];
	else if (edge.bend === "yx") {
		ca[0] += lane;
		cb[1] += lane;
		pts = [ca, [ca[0], cb[1]], cb];
	} else if (edge.bend === "straight" || Math.abs(ca[1] - cb[1]) < 0.05 || Math.abs(ca[0] - cb[0]) < 0.05) {
		if (Math.abs(ca[1] - cb[1]) < 0.05) {
			ca[1] += lane;
			cb[1] += lane;
		} else if (Math.abs(ca[0] - cb[0]) < 0.05) {
			ca[0] += lane;
			cb[0] += lane;
		}
		pts = [ca, cb];
	} else {
		ca[1] += lane;
		cb[0] += lane;
		pts = [ca, [cb[0], ca[1]], cb];
	}
	const gap = edge.gap ?? 0.35;
	const ra = grow(a, gap);
	const rb = grow(b, gap);
	pts[0] = lerp(pts[0], pts[1], exitT(pts[0], pts[1], ra));
	const n = pts.length;
	pts[n - 1] = lerp(pts[n - 2], pts[n - 1], enterT(pts[n - 2], pts[n - 1], rb));
	return pts;
}

const sig = (value) => JSON.stringify(value);
const nodeSig = ({ at, tags, state, visible, prevLines, id, halo, bob, ...rest }) => sig(rest);
const isAt = (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && (a[2] ?? 0) === (b[2] ?? 0);

export class Scene {
	constructor(host) {
		this.svg = s("svg", { class: "scene", viewBox: "-400 -250 800 500", preserveAspectRatio: "xMidYMid meet", role: "img" });
		this.svg.append(s("defs", {}, defs()));
		this.layers = {};
		for (const name of ["floor", "edges", "packets", "nodes", "tags", "fx"]) {
			this.layers[name] = s("g", { class: `layer-${name}` });
			this.svg.append(this.layers[name]);
		}
		host.append(this.svg);
		this.nodes = new Map();
		this.edges = new Map();
		this.packets = [];
		this.view = [-400, -250, 800, 500];
		this.paused = false;
		this.clock = 0;
		this.last = performance.now();
		const tick = (now) => {
			const dt = now - this.last;
			this.last = now;
			if (!this.paused) this.clock += dt;
			this.tickPackets();
			this.tickCamera(now);
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}

	clear() {
		for (const layer of Object.values(this.layers)) layer.replaceChildren();
		this.nodes.clear();
		this.edges.clear();
		this.packets = [];
	}

	setPaused(paused) {
		this.paused = paused;
		for (const animation of this.svg.getAnimations({ subtree: true })) paused ? animation.pause() : animation.play();
	}

	/** Show `scene`. `instant` skips every transition (used before a replay). */
	render(scene, { instant = false } = {}) {
		const enterDelay = new Map(scene.order.map((id, i) => [id, i * 130]));

		// nodes
		for (const [id, r] of this.nodes) {
			if (scene.nodes[id]) continue;
			this.nodes.delete(id);
			this.layers.tags.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
			if (instant) r.g.remove();
			else {
				r.g.classList.add("leaving");
				r.pop.classList.remove("pop");
				r.pop.classList.add("leave");
				setTimeout(() => r.g.remove(), 430);
			}
		}
		const sorted = Object.values(scene.nodes).sort((a, b) => {
			const la = LAYER[a.kind] ?? 2;
			const lb = LAYER[b.kind] ?? 2;
			if (la !== lb) return la - lb;
			const fa = footprint(a);
			const fb = footprint(b);
			return fa[0] + fa[2] + fa[1] + fa[3] + (a.at[2] ?? 0) * 3 - (fb[0] + fb[2] + fb[1] + fb[3] + (b.at[2] ?? 0) * 3);
		});
		for (const node of sorted) {
			let r = this.nodes.get(node.id);
			const nsig = nodeSig(node);
			const fresh = r === undefined || r.key !== node.key;
			if (fresh && r) {
				const old = r;
				old.g.classList.add("leaving");
				old.pop.classList.remove("pop");
				old.pop.classList.add("leave");
				setTimeout(() => old.g.remove(), 430);
				old.tagWrap.remove();
			}
			if (fresh) {
				r = { key: node.key, sig: "", at: node.at };
				r.g = s("g", { class: "node", "data-id": node.id });
				r.pop = s("g", { class: instant ? "" : "pop" });
				// once in, a node must not replay its entrance when it is moved in the DOM
				r.pop.addEventListener("animationend", (event) => {
					if (event.animationName === "pop-in") r.pop.classList.remove("pop");
					if (event.animationName === "shake") r.pop.classList.remove("shake");
				});
				r.halo = s("g", {});
				r.content = s("g", {});
				r.pop.append(r.halo, r.content);
				r.g.append(r.pop);
				if (!instant) r.pop.style.animationDelay = `${enterDelay.get(node.id) ?? 0}ms`;
				r.tagWrap = s("g", { class: "tagwrap", "data-id": node.id });
				this.layers.tags.append(r.tagWrap);
				this.nodes.set(node.id, r);
			}
			if (r.sig !== nsig) {
				const built = BUILDERS[node.kind]({ ...node });
				r.content.replaceChildren(built.el);
				r.built = built;
				r.sig = nsig;
			} else if (node.prevLines !== undefined) {
				// same file, more lines: rebuild so the new lines animate
				const built = BUILDERS[node.kind]({ ...node });
				r.content.replaceChildren(built.el);
				r.built = built;
			}
			// position
			const [px, py] = P(...node.at);
			r.pos = [px, py];
			r.g.style.transform = `translate(${px}px, ${py}px)`;
			r.tagWrap.style.transform = `translate(${px}px, ${py}px)`;
			if (instant || fresh) {
				r.g.style.transition = "none";
				r.tagWrap.style.transition = "none";
				void r.g.getBoundingClientRect();
				r.g.style.transition = "";
				r.tagWrap.style.transition = "";
			}
			// state
			r.g.classList.toggle("is-dead", node.state === "dead");
			r.g.classList.toggle("is-ghost", node.state === "ghost");
			r.g.classList.toggle("is-dim", node.state === "dim");
			r.content.classList.toggle("bob", Boolean(node.bob));
			// halo (this step only)
			const halo = scene.focus[node.id] ?? node.halo;
			const haloSig = sig(halo ?? null);
			if (r.haloSig !== haloSig) {
				r.halo.replaceChildren();
				if (halo) r.halo.append(haloShape(node, halo));
				r.haloSig = haloSig;
			}
			// tags
			const tsig = sig(node.tags ?? []) + sig(r.built.box);
			if (r.tagSig !== tsig) {
				r.tagWrap.replaceChildren(this.buildTags(node, r.built, instant ? -1 : (enterDelay.get(node.id) ?? 0) + 200));
				r.tagSig = tsig;
			}
		}
		// painter's order, moving only what is out of place; platforms go under the edges
		for (const [layer, list] of [
			[this.layers.floor, sorted.filter((n) => LAYER[n.kind] !== undefined)],
			[this.layers.nodes, sorted.filter((n) => LAYER[n.kind] === undefined)],
		]) {
			let cursor = layer.firstElementChild;
			for (const node of list) {
				const g = this.nodes.get(node.id).g;
				while (cursor && cursor.classList.contains("leaving")) cursor = cursor.nextElementSibling;
				if (cursor === g) cursor = cursor.nextElementSibling;
				else layer.insertBefore(g, cursor);
			}
		}

		// edges
		for (const [id, r] of this.edges) {
			if (scene.edges[id]) continue;
			this.edges.delete(id);
			r.label?.remove();
			if (instant) r.g.remove();
			else {
				r.g.style.transition = "opacity .35s";
				r.g.style.opacity = "0";
				setTimeout(() => r.g.remove(), 360);
			}
		}
		const lastNodeDelay = Math.max(0, ...scene.order.filter((id) => scene.nodes[id]).map((id) => enterDelay.get(id) ?? 0));
		let edgeIndex = 0;
		for (const edge of Object.values(scene.edges)) {
			const from = scene.nodes[edge.from];
			const to = scene.nodes[edge.to];
			if (!from || !to) continue;
			const pts = route(edge, from, to).map(([x, y]) => P(x, y, edge.z ?? 0.3));
			const esig = sig({ pts, tone: edge.tone, dashed: edge.dashed, flow: edge.flow, arrow: edge.arrow, label: edge.label, labelTone: edge.labelTone, labelAt: edge.labelAt });
			const prev = this.edges.get(edge.id);
			if (prev && prev.sig === esig) continue;
			const isNew = !prev;
			if (prev) {
				prev.g.remove();
				prev.label?.remove();
			}
			const tone = edge.tone ?? "ink";
			const arrow = edge.arrow ?? "end";
			const path = s("path", {
				class: `edge${edge.tone ? ` edge--${edge.tone}` : ""}${edge.dashed ? " edge--dashed" : ""}${edge.flow ? " is-flow" : ""}`,
				d: roundedLine(pts, 12),
				"marker-end": arrow === "end" || arrow === "both" ? `url(#arrow-${tone})` : undefined,
				"marker-start": arrow === "start" || arrow === "both" ? `url(#arrow-${tone})` : undefined,
			});
			const g = s("g", { class: "edge-wrap", "data-id": edge.id }, path);
			this.layers.edges.append(g);
			const r = { sig: esig, g, path, pts };
			if (isNew && !instant && !edge.dashed && !edge.flow) {
				const len = path.getTotalLength();
				const delay = (enterDelay.get(edge.id) ?? lastNodeDelay + 180 + edgeIndex * 90) + 120;
				path.animate([{ strokeDasharray: `${len} ${len}`, strokeDashoffset: len }, { strokeDasharray: `${len} ${len}`, strokeDashoffset: 0 }], { duration: 560, delay, easing: "cubic-bezier(.4,0,.2,1)", fill: "backwards" });
				g.style.animationDelay = `${delay}ms`;
				edgeIndex++;
			} else if (instant) g.style.animation = "none";
			else if (!isNew) g.style.animationDelay = "520ms";
			if (edge.label) {
				const at = midpoint(pts, edge.labelAt ?? 0.5);
				const p = pill({ text: edge.label, tone: edge.labelTone, icon: edge.labelIcon });
				p.el.setAttribute("transform", `translate(${at[0]} ${at[1]})`);
				r.label = s("g", { class: "tagset" }, p.el);
				r.labelBox = [at[0] - p.w / 2, at[1] - p.h / 2, at[0] + p.w / 2, at[1] + p.h / 2];
				if (instant) r.label.style.animation = "none";
				else r.label.style.animationDelay = isNew ? `${(enterDelay.get(edge.id) ?? lastNodeDelay + 300) + 200}ms` : "520ms";
				this.layers.tags.prepend(r.label);
			}
			this.edges.set(edge.id, r);
		}

		// packets (this step only)
		this.layers.packets.replaceChildren();
		this.packets = [];
		for (const packet of scene.packets) {
			const r = this.edges.get(packet.edge);
			if (!r) continue;
			const count = packet.count ?? 1;
			for (let i = 0; i < count; i++) {
				const dot = s("circle", { class: "packet", r: packet.r ?? 5.5, style: `fill:${packetColor(packet.tone)};opacity:0` });
				this.layers.packets.append(dot);
				this.packets.push({
					...packet,
					dot,
					path: r.path,
					start: this.clock + (instant ? 0 : 700) + (packet.delay ?? 0) + i * (packet.spacing ?? 260),
				});
			}
		}

		// effects (this step only, and only when moving to it)
		this.layers.fx.replaceChildren();
		if (!instant) {
			for (const fx of scene.fx) {
				const r = this.nodes.get(fx.at);
				if (!r) continue;
				const [cx, cy] = r.built.center;
				const delay = fx.delay ?? 450;
				setTimeout(() => {
					if (this.nodes.get(fx.at) !== r) return;
					const ring = s("circle", { class: "burst", cx: r.pos[0] + cx, cy: r.pos[1] + cy, r: 46, style: fx.kind === "ping" ? "stroke:var(--green-3)" : undefined });
					this.layers.fx.append(ring);
					if (fx.kind === "kill") {
						r.pop.classList.remove("shake");
						void r.pop.getBoundingClientRect();
						r.pop.classList.add("shake");
					}
					setTimeout(() => ring.remove(), 1000);
				}, delay);
			}
		}

		this.frame(scene, instant);
	}

	buildTags(node, built, delay) {
		const set = s("g", { class: "tagset" });
		if (delay < 0) set.style.animation = "none";
		else if (delay) set.style.animationDelay = `${delay}ms`;
		const stacks = {};
		const boxes = [];
		for (const tag of node.tags ?? []) {
			const pos = tag.pos ?? "top";
			const k = (stacks[pos] = (stacks[pos] ?? -1) + 1);
			const anchor = built.at[pos === "front" ? "bottom" : pos] ?? built.at.top;
			let x = anchor[0] + (tag.dx ?? 0);
			let y = anchor[1] + (tag.dy ?? 0);
			let align = "center";
			if (pos === "top") y -= 18 + k * 31;
			if (pos === "bottom" || pos === "front") y += 19 + k * 31;
			if (pos === "left") {
				x -= 12;
				y += k * 31;
				align = "end";
			}
			if (pos === "right") {
				x += 12;
				y += k * 31;
				align = "start";
			}
			const p = pill(tag, align);
			p.el.setAttribute("transform", `translate(${x} ${y})`);
			set.append(p.el);
			const x0 = align === "center" ? x - p.w / 2 : align === "end" ? x - p.w : x;
			boxes.push([x0, y - p.h / 2, x0 + p.w, y + p.h / 2 + 3]);
		}
		this.tagBoxes ??= new Map();
		this.tagBoxes.set(node.id, boxes);
		return set;
	}

	/** Point the camera at everything visible. */
	frame(scene, instant) {
		let box = [Infinity, Infinity, -Infinity, -Infinity];
		const add = (b, dx = 0, dy = 0) => {
			box = [Math.min(box[0], b[0] + dx), Math.min(box[1], b[1] + dy), Math.max(box[2], b[2] + dx), Math.max(box[3], b[3] + dy)];
		};
		for (const [id, r] of this.nodes) {
			if (!scene.nodes[id]) continue;
			add(r.built.box, r.pos[0], r.pos[1]);
			for (const b of this.tagBoxes?.get(id) ?? []) add(b, r.pos[0], r.pos[1]);
		}
		for (const r of this.edges.values()) {
			for (const p of r.pts) add([p[0], p[1], p[0], p[1]]);
			if (r.labelBox) add(r.labelBox);
		}
		if (box[0] === Infinity) box = [-300, -200, 300, 200];
		const pad = 26;
		let [x0, y0, x1, y1] = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
		const minW = 560;
		const minH = 330;
		if (x1 - x0 < minW) {
			const c = (x0 + x1) / 2;
			[x0, x1] = [c - minW / 2, c + minW / 2];
		}
		if (y1 - y0 < minH) {
			const c = (y0 + y1) / 2;
			[y0, y1] = [c - minH / 2, c + minH / 2];
		}
		const target = [x0, y0, x1 - x0, y1 - y0];
		if (instant) {
			this.view = target;
			this.cam = undefined;
			this.svg.setAttribute("viewBox", target.map((n) => n.toFixed(1)).join(" "));
		} else this.cam = { from: [...this.view], to: target, start: performance.now(), dur: 820 };
	}

	tickCamera(now) {
		if (!this.cam) return;
		const t = Math.min(1, (now - this.cam.start) / this.cam.dur);
		const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
		this.view = this.cam.from.map((a, i) => a + (this.cam.to[i] - a) * e);
		this.svg.setAttribute("viewBox", this.view.map((n) => n.toFixed(1)).join(" "));
		if (t >= 1) this.cam = undefined;
	}

	tickPackets() {
		for (const p of this.packets) {
			const dur = p.dur ?? 1500;
			const cycle = dur + (p.pause ?? 500);
			const since = this.clock - p.start;
			if (since < 0 || (p.once && since > dur)) {
				p.dot.style.opacity = "0";
				continue;
			}
			let t = (since % cycle) / dur;
			if (t > 1) {
				p.dot.style.opacity = "0";
				continue;
			}
			if (p.reverse) t = 1 - t;
			const len = p.path.getTotalLength();
			const at = p.path.getPointAtLength(len * t);
			p.dot.setAttribute("cx", at.x.toFixed(1));
			p.dot.setAttribute("cy", at.y.toFixed(1));
			p.dot.style.opacity = String(Math.min(1, t * 10, (1 - t) * 10));
		}
	}
}

const packetColor = (tone) =>
	({ rust: "var(--rust)", green: "#7fc278", violet: "#9b85e0", yellow: "#e8a33a", blue: "#6ea4dc", ink: "var(--ink)" })[tone ?? "rust"] ?? tone;

function midpoint(pts, at) {
	let total = 0;
	const segs = [];
	for (let i = 1; i < pts.length; i++) {
		const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
		segs.push(len);
		total += len;
	}
	let want = total * at;
	for (let i = 0; i < segs.length; i++) {
		if (want <= segs[i]) return lerp(pts[i], pts[i + 1], segs[i] === 0 ? 0 : want / segs[i]);
		want -= segs[i];
	}
	return pts.at(-1);
}

function haloShape(node, halo) {
	const [x0, y0, x1, y1] = footprint(node);
	const g = 0.55;
	const [ox, oy] = [node.at[0], node.at[1]];
	const corners = [P(x0 - g - ox, y0 - g - oy), P(x1 + g - ox, y0 - g - oy), P(x1 + g - ox, y1 + g - oy), P(x0 - g - ox, y1 + g - oy)];
	const cls = halo === "bad" ? "halo halo--bad" : halo === "violet" ? "halo halo--violet" : "halo";
	const d = corners.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("") + "Z";
	return s("path", { class: cls, d, "stroke-linejoin": "round" });
}
