// The course: modules in sidebar order, each with its lessons.
import { DEMO1 } from "./lessons/demo1.js";
import { DEMO2 } from "./lessons/demo2.js";
import { OVERVIEW } from "./lessons/overview.js";

export const COURSE = [
	{ id: "start", title: "01. Start here", color: "#e8a33a", lessons: OVERVIEW },
	{ id: "demo1", title: "02. Execution layer", color: "#7fc278", lessons: DEMO1 },
	{ id: "demo2", title: "03. Orchestration", color: "#9b85e0", lessons: DEMO2 },
];

export const LESSONS = COURSE.flatMap((mod) => mod.lessons);
