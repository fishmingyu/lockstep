// The page: course sidebar, lesson head, stage (HUD, scene, legend), step timeline, and the guide on the right.
// Routes: #/learn/<lesson>/<step>, #/run, #/glossary.
import { COURSE, LESSONS } from "./course.js";
import { fold, Scene } from "./engine.js";
import { icon } from "./iso.js";
import { GlossaryPage, RunPage } from "./pages.js";
import { formatEntry, markIndex, TRACES } from "./trace.js";
import { esc, md } from "./util.js";

const $ = (sel, root = document) => root.querySelector(sel);
const store = {
	get(key, fallback) {
		try {
			const value = JSON.parse(localStorage.getItem(`lockstep:${key}`));
			return value ?? fallback;
		} catch {
			return fallback;
		}
	},
	set(key, value) {
		try {
			localStorage.setItem(`lockstep:${key}`, JSON.stringify(value));
		} catch {}
	},
};

const BADGES = { problem: "Problem", setup: "Setup", run: "Run", crash: "Crash", failure: "Failure", recovery: "Recovery", technique: "Technique", check: "Check", recap: "Recap" };
const CALLOUTS = { key: ["Key idea", "sparkle"], tip: ["Good to know", "bulb"], warn: ["Watch out", "warn"] };
const MARKS = { "+": "add", "~": "mod", "-": "del", ok: "ok", bad: "bad" };
const MARK_TEXT = { add: "+", mod: "~", del: "−", ok: "✓", bad: "✗" };

const state = {
	view: "learn",
	lesson: LESSONS[0],
	step: 0,
	tab: store.get("tab", "learn"),
	paused: false,
	visited: store.get("visited", {}),
	open: store.get("open", Object.fromEntries(COURSE.map((m) => [m.id, true]))),
};
let scene;
let shown; // { lesson, step } currently in the scene

// ── layout ───────────────────────────────────────────────────────────────
function buildLearn() {
	$("#body").innerHTML = `
		<aside class="sidebar" id="sidebar">
			<div class="course__head">${icon("folder")}Course <small>${LESSONS.length} lessons</small></div>
			<nav class="course" id="course"></nav>
			<div class="progress"><span>PROGRESS</span><span class="progress__bar"><i id="progress-bar"></i></span><span id="progress-n"></span></div>
		</aside>
		<main class="sheet">
			<header class="lesson-head">
				<div class="crumbs" id="crumbs"></div>
				<div class="lesson-head__row"><h1 class="title" id="title"></h1><div class="tags" id="tags"></div></div>
				<p class="subtitle" id="subtitle"></p>
			</header>
			<section class="stage" id="stage">
				<div class="stage__hud" id="hud"></div>
				<div class="stage__tools">
					<button class="tool" id="replay" title="Replay this step (R)">${icon("replay")}<span>Replay</span></button>
					<button class="tool" id="pause" title="Pause (Space)">${icon("pause")}<span>Pause</span></button>
				</div>
				<div class="stage__canvas" id="canvas"></div>
				<div class="stage__legend" id="legend"></div>
				<div class="stage__draft" id="draft" hidden></div>
			</section>
			<section class="timeline">
				<div class="timeline__head"><span>In this lesson</span><span id="step-of"></span></div>
				<div class="timeline__track" id="track"></div>
			</section>
		</main>
		<aside class="rail">
			<section class="card guide">
				<div class="guide__top"><span id="step-n"></span><span class="badge" id="badge"></span></div>
				<div class="guide__content" id="guide"></div>
				<div class="guide__nav">
					<button class="btn" id="back">${icon("arrowL")}<span>Back</span></button>
					<button class="btn btn--next" id="next"><span id="next-label">Next</span>${icon("arrowR")}</button>
				</div>
				<div class="guide__hint"><kbd>←</kbd><kbd>→</kbd> step · <kbd>R</kbd> replay · <kbd>Space</kbd> pause</div>
			</section>
			<section class="card tabs">
				<div class="tabs__bar">
					<button class="tabs__btn" data-tab="learn">You'll learn</button>
					<button class="tabs__btn" data-tab="log">Run log <small id="log-badge"></small></button>
				</div>
				<div class="tabs__panel" id="tab-panel"></div>
			</section>
		</aside>`;
	scene = new Scene($("#canvas"));
	shown = undefined;
	$("#back").onclick = () => go(state.lesson, state.step - 1);
	$("#next").onclick = () => (state.step < state.lesson.steps.length - 1 ? go(state.lesson, state.step + 1) : nextLesson());
	$("#replay").onclick = replay;
	$("#pause").onclick = togglePause;
	for (const btn of document.querySelectorAll(".tabs__btn")) btn.onclick = () => setTab(btn.dataset.tab);
}

function renderSidebar() {
	const course = $("#course");
	course.innerHTML = COURSE.map((mod) => {
		const done = mod.lessons.filter((l) => isDone(l)).length;
		return `<div class="mod ${state.open[mod.id] ? "is-open" : ""}" data-mod="${mod.id}">
			<button class="mod__head">${icon("chevR", "i mod__chev")}<svg class="mod__folder" viewBox="0 0 24 24"><path d="M2.5 6.5A1.5 1.5 0 0 1 4 5h5l2 2.2h9A1.5 1.5 0 0 1 21.5 8.7v9.8A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5z" fill="${mod.color}" stroke="var(--stroke)" stroke-width="1.4"/></svg><span>${esc(mod.title)}</span><span class="mod__count">${done}/${mod.lessons.length}</span></button>
			<div class="mod__body"><div class="mod__clip"><ul class="mod__lessons">${mod.lessons
				.map(
					(l) => `<li class="lesson ${l === state.lesson && state.view === "learn" ? "is-current" : ""} ${isDone(l) ? "is-done" : ""}">
				<a href="#/learn/${l.id}">${icon(isDone(l) ? "check" : "file", "i lesson__mark")}<span class="lesson__title">${esc(l.nav ?? l.title)}</span>${l.draft ? '<span class="lesson__badge">draft</span>' : ""}</a></li>`,
				)
				.join("")}</ul></div></div></div>`;
	}).join("");
	for (const mod of course.querySelectorAll(".mod")) {
		mod.querySelector(".mod__head").onclick = () => {
			state.open[mod.dataset.mod] = !mod.classList.contains("is-open");
			mod.classList.toggle("is-open");
			store.set("open", state.open);
		};
	}
	for (const a of course.querySelectorAll("a")) a.addEventListener("click", () => document.documentElement.classList.remove("is-drawer"));
	const done = LESSONS.filter(isDone).length;
	$("#progress-n").textContent = `${done} / ${LESSONS.length}`;
	$("#progress-bar").style.width = `${(done / LESSONS.length) * 100}%`;
}

const isDone = (lesson) => (state.visited[lesson.id] ?? -1) >= lesson.steps.length - 1;

function renderLessonHead() {
	const l = state.lesson;
	const mod = COURSE.find((m) => m.lessons.includes(l));
	$("#crumbs").innerHTML = `<span>${esc(mod.title)}</span><span>Lesson ${mod.lessons.indexOf(l) + 1} of ${mod.lessons.length}</span>`;
	$("#title").textContent = l.title;
	$("#subtitle").textContent = l.subtitle;
	const run = l.scenario ? TRACES[l.scenario] : undefined;
	$("#tags").innerHTML = [
		`<span class="tag tag--time">${icon("clock")}${l.minutes} min</span>`,
		l.scenario ? (l.draft ? `<span class="tag tag--draft">${icon("warn")}draft · not run</span>` : run ? `<span class="tag tag--live">${icon("check")}recorded run</span>` : "") : `<span class="tag tag--level">${icon("gauge")}overview</span>`,
		`<span class="tag tag--steps">${icon("list")}${l.steps.length} steps</span>`,
	].join("");
	$("#legend").innerHTML = (l.legend ?? []).map(([color, text]) => `<span><i style="background:${color}"></i>${esc(text)}</span>`).join("");
	const draft = $("#draft");
	draft.hidden = !l.draft;
	if (l.draft) draft.innerHTML = `${icon("warn")}<span>${md(l.draft)}</span>`;
	$("#track").innerHTML =
		`<div class="timeline__rail"></div><div class="timeline__fill" id="fill"></div>` +
		l.steps.map((s, i) => `<button class="timeline__step ${s.badge === "crash" ? "is-crash" : ""}" data-i="${i}" title="${esc(s.title)}"><span class="timeline__dot">${i + 1}</span><span class="timeline__label">${esc(s.short ?? s.title)}</span></button>`).join("");
	for (const b of document.querySelectorAll(".timeline__step")) b.onclick = () => go(state.lesson, Number(b.dataset.i));
	document.title = `${l.title} — Lockstep`;
}

function renderStep(dir) {
	const l = state.lesson;
	const i = state.step;
	const step = l.steps[i];
	// timeline
	const steps = document.querySelectorAll(".timeline__step");
	steps.forEach((el, k) => {
		el.classList.toggle("is-past", k < i);
		el.classList.toggle("is-current", k === i);
	});
	const n = l.steps.length;
	placeFill();
	$("#step-of").textContent = `Step ${i + 1} of ${n}`;
	// guide
	$("#step-n").textContent = `STEP ${i + 1} / ${n}`;
	const badge = $("#badge");
	badge.className = `badge badge--${step.badge ?? "run"}`;
	badge.textContent = BADGES[step.badge ?? "run"];
	const callout = step.callout
		? `<div class="callout callout--${step.callout[0]}"><span class="callout__icon">${icon(CALLOUTS[step.callout[0]][1])}</span><div><div class="callout__title">${CALLOUTS[step.callout[0]][0]}</div><p>${md(step.callout[1])}</p></div></div>`
		: "";
	const changed = step.changed?.length
		? `<div class="changed__title">What changed</div><ul class="changed">${step.changed
				.map(([m, text]) => {
					const cls = MARKS[m] ?? "add";
					return `<li><i class="${cls}">${MARK_TEXT[cls]}</i><span>${md(text)}</span></li>`;
				})
				.join("")}</ul>`
		: "";
	const guide = $("#guide");
	guide.innerHTML = `<h2 class="guide__title">${md(step.title)}</h2>${step.body.map((p) => `<p>${md(p)}</p>`).join("")}${callout}${changed}`;
	guide.scrollTop = 0;
	guide.classList.remove("is-swap");
	void guide.offsetWidth;
	guide.classList.add("is-swap");
	$("#back").disabled = i === 0;
	const nextLesson = LESSONS[LESSONS.indexOf(l) + 1];
	$("#next-label").textContent = i < n - 1 ? `Next: ${l.steps[i + 1].short ?? l.steps[i + 1].title}` : nextLesson ? `Next lesson: ${nextLesson.nav ?? nextLesson.title}` : "Finished";
	$("#next").disabled = i === n - 1 && !nextLesson;
	// scene + HUD
	const folded = fold(l, i);
	renderHud(l, folded.hud, i > 0 ? fold(l, i - 1).hud : {});
	scene.render(folded, { instant: false, dir });
	shown = { lesson: l, step: i };
	renderTab();
	// progress
	if ((state.visited[l.id] ?? -1) < i) {
		state.visited[l.id] = i;
		store.set("visited", state.visited);
		renderSidebar();
	}
}

function placeFill() {
	const steps = document.querySelectorAll(".timeline__step");
	const first = steps[0];
	const cur = steps[state.step];
	if (!first || !cur) return;
	const x0 = first.offsetLeft + first.offsetWidth / 2;
	$("#fill").style.left = `${x0}px`;
	$("#fill").style.width = `${cur.offsetLeft + cur.offsetWidth / 2 - x0}px`;
}

function renderHud(lesson, hud, before) {
	$("#hud").innerHTML = (lesson.hud ?? [])
		.map(({ key, label, icon: name }) => {
			const raw = hud[key];
			const value = raw === undefined ? "—" : typeof raw === "object" ? raw.v : raw;
			const tone = typeof raw === "object" ? raw.tone : undefined;
			const prev = before[key];
			const changed = raw !== undefined && JSON.stringify(prev) !== JSON.stringify(raw);
			return `<div class="chip ${changed && tone !== "bad" ? "is-new" : ""} ${tone === "bad" ? "is-bad" : tone === "good" ? "is-good" : ""}"><span class="chip__label">${icon(name ?? "hash")}${esc(label)}</span><span class="chip__value ${changed ? "is-swap" : ""}">${esc(value)}</span></div>`;
		})
		.join("");
}

function setTab(tab) {
	state.tab = tab;
	store.set("tab", tab);
	renderTab();
}

function renderTab() {
	for (const b of document.querySelectorAll(".tabs__btn")) b.classList.toggle("is-active", b.dataset.tab === state.tab);
	const l = state.lesson;
	const panel = $("#tab-panel");
	const trace = l.scenario ? TRACES[l.scenario] : undefined;
	$("#log-badge").textContent = trace && !l.draft ? `· ${l.scenario}` : "";
	if (state.tab === "learn") {
		panel.innerHTML = `<ul class="learn">${(l.learn ?? [])
			.map(([at, text]) => `<li class="${state.step >= at ? "is-done" : ""}"><span class="box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span><span>${md(text)}</span></li>`)
			.join("")}</ul>`;
		return;
	}
	if (!l.scenario) {
		panel.innerHTML = `<p class="log__empty">This lesson is an overview; it has no run of its own. Each scenario lesson replays the run that <code>npm run demo1</code> / <code>npm run demo2</code> recorded.</p>`;
		return;
	}
	if (l.draft || !trace) {
		panel.innerHTML = `<p class="log__empty">No recorded run for scenario ${esc(l.scenario)} yet.</p>${
			l.draft
				? `<p class="log__empty">This is a draft: its values are what the checks expect, not a recorded run.</p>`
				: ""
		}<p class="log__empty">Once the scenario runs, <code>npm run site:bake</code> brings its log here.</p>`;
		return;
	}
	const marks = l.steps.map((s) => markIndex(trace.trace, s.log));
	// a step without its own mark shows the log up to the last mark before it
	let end = -1;
	let start = -1;
	for (let k = 0; k <= state.step; k++) {
		if (marks[k] >= 0) {
			if (k === state.step) start = end;
			end = Math.max(end, marks[k]);
		}
	}
	if (marks[state.step] < 0) start = end;
	const rows = trace.trace.slice(0, end + 1);
	panel.innerHTML =
		`<div class="log__meta">scenario ${esc(trace.scenario)} · ${trace.passed ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>'} · recorded ${esc(trace.recordedAt.slice(0, 16).replace("T", " "))} UTC</div>` +
		(rows.length === 0
			? `<p class="log__empty">Nothing logged yet at this step.</p>`
			: `<div class="log">${rows.map((e, k) => `<div class="log__row ${k > start ? "is-now" : ""}"><span class="log__t">${(e.t / 1000).toFixed(2)}s</span><span>${formatEntry(e)}</span></div>`).join("")}</div>`);
	const last = panel.querySelector(".log__row:last-child");
	if (last) panel.scrollTop = last.offsetTop - panel.clientHeight + last.offsetHeight + 40;
}

// ── navigation ───────────────────────────────────────────────────────────
function go(lesson, step, { replace = false } = {}) {
	const i = Math.max(0, Math.min(lesson.steps.length - 1, step));
	const hash = `#/learn/${lesson.id}/${i + 1}`;
	if (location.hash !== hash) (replace ? history.replaceState(null, "", hash) : history.pushState(null, "", hash));
	route();
}

function nextLesson() {
	const next = LESSONS[LESSONS.indexOf(state.lesson) + 1];
	if (next) go(next, 0);
}

function replay() {
	if (state.view !== "learn") return;
	const l = state.lesson;
	if (state.step > 0) scene.render(fold(l, state.step - 1), { instant: true });
	else scene.clear();
	requestAnimationFrame(() => scene.render(fold(l, state.step)));
}

function togglePause() {
	state.paused = !state.paused;
	scene.setPaused(state.paused);
	$("#stage").classList.toggle("is-paused", state.paused);
	$("#pause").innerHTML = state.paused ? `${icon("play")}<span>Play</span>` : `${icon("pause")}<span>Pause</span>`;
}

function route() {
	const parts = location.hash.replace(/^#\/?/, "").split("/");
	const view = parts[0] === "run" || parts[0] === "glossary" ? parts[0] : "learn";
	for (const a of document.querySelectorAll(".nav__item")) a.classList.toggle("is-active", a.dataset.view === view);
	if (view !== "learn") {
		state.view = view;
		scene = undefined;
		$("#body").innerHTML = view === "run" ? RunPage() : GlossaryPage();
		$("#body").scrollTop = 0;
		document.title = `${view === "run" ? "Run it" : "Glossary"} — Lockstep`;
		return;
	}
	const lesson = LESSONS.find((l) => l.id === parts[1]) ?? state.lesson ?? LESSONS[0];
	const step = Math.max(0, Math.min(lesson.steps.length - 1, (Number(parts[2]) || 1) - 1));
	if (state.view !== "learn" || !scene) {
		state.view = "learn";
		buildLearn();
		shown = undefined;
	}
	const lessonChanged = state.lesson !== lesson || !shown;
	const dir = shown && shown.lesson === lesson ? Math.sign(step - shown.step) : 0;
	state.lesson = lesson;
	state.step = step;
	if (lessonChanged) {
		scene.clear();
		if (state.paused) togglePause();
		renderLessonHead();
		renderSidebar();
	}
	if (!shown || shown.lesson !== lesson || shown.step !== step || lessonChanged) renderStep(dir);
}

// ── chrome ───────────────────────────────────────────────────────────────
$("#theme").onclick = () => {
	const dark = document.documentElement.dataset.theme !== "dark";
	if (dark) document.documentElement.dataset.theme = "dark";
	else delete document.documentElement.dataset.theme;
	store.set("theme", dark ? "dark" : "light");
	$('meta[name="theme-color"]').setAttribute("content", dark ? "#211e1a" : "#f4ebe0");
};
$("#menu").onclick = () => document.documentElement.classList.toggle("is-drawer");
$("#backdrop").onclick = () => document.documentElement.classList.remove("is-drawer");
document.addEventListener("keydown", (event) => {
	if (state.view !== "learn" || event.metaKey || event.ctrlKey || event.altKey) return;
	if (event.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(event.target.tagName)) return;
	if (event.key === "ArrowRight") {
		event.preventDefault();
		$("#next").click();
	} else if (event.key === "ArrowLeft") {
		event.preventDefault();
		if (state.step > 0) go(state.lesson, state.step - 1);
	} else if (event.key === "r" || event.key === "R") replay();
	else if (event.key === " ") {
		event.preventDefault();
		togglePause();
	}
});
window.addEventListener("hashchange", route);
window.addEventListener("popstate", route);
window.addEventListener("resize", () => state.view === "learn" && placeFill());
if (!location.hash) history.replaceState(null, "", `#/learn/${LESSONS[0].id}/1`);
route();
