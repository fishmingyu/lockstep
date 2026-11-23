// Which directory a conversation works in, as in example 28's Sandbox doc. `fork: "initial"`: a fork gets no
// directory until the app assigns one, so it can never write into its parent's.
import { defineDoc } from "@earendil-works/pi-durable";

export const Workdir = defineDoc<{ path?: string }>({
	checkpointWhen: () => false,
	kind: "lockstep.workdir",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({}),
});
