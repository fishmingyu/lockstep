// Text helpers shared by the page and the lessons' prose.
export const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Lesson text: **bold**, `code`, *em*, ==highlight==. */
export const md = (text) =>
	esc(text)
		.replace(/`([^`]+)`/g, (_, c) => `<code${c.length > 30 ? ' class="long"' : ""}>${c}</code>`)
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/==([^=]+)==/g, '<span class="u">$1</span>')
		.replace(/\*([^*]+)\*/g, "<em>$1</em>");
