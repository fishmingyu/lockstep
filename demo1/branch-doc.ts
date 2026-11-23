// Which LayerFS branch a conversation works on, written the same way as Demo 2's Workdir doc. `fork: "initial"`: a
// forked conversation gets no branch until forkWithBranch() gives it its own, so it can never write to its parent's.
import { defineDoc } from "@earendil-works/pi-durable";

export const Branch = defineDoc<{ name?: string }>({
	checkpointWhen: () => false,
	kind: "lockstep.branch",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({}),
});
