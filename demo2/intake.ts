// Intake: admit the event, then hand it to the router. The request ID is the outbox: delivering the same event twice
// (a webhook retry, a restarted poller) returns the submission the first delivery made, so there is one run.
import type { Context } from "@earendil-works/chord/context";
import type { Conversation, Submission } from "@earendil-works/pi-durable";
import { admit, type IssueEvent } from "./admission.ts";

export type Intake =
	| { readonly admitted: true; readonly submission: Submission }
	| { readonly admitted: false; readonly reason: string };

export async function intake(router: Conversation, event: IssueEvent, context: Context): Promise<Intake> {
	const admission = admit(event);
	if (!admission.ok) return { admitted: false, reason: admission.reason };
	const content = `[router] Issue ${event.id}: ${event.title}\n\n${event.body}`;
	const submission = await router.submit({ type: "input", content, requestId: `event:${event.id}` }, context);
	return { admitted: true, submission };
}
