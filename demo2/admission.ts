// Deterministic admission: a pure function of the event, run before anything is submitted. No model is asked.
export type IssueEvent = {
	readonly id: string;
	readonly author: string;
	readonly labels: readonly string[];
	readonly title: string;
	readonly body: string;
};

export type Admission = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export const ALLOWED_AUTHORS: readonly string[] = ["alice", "bob"];

export function admit(event: IssueEvent): Admission {
	if (!event.labels.includes("agent")) return { ok: false, reason: "missing the agent label" };
	if (!ALLOWED_AUTHORS.includes(event.author)) return { ok: false, reason: `author ${event.author} is not allowed` };
	return { ok: true };
}
