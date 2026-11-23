// Types for the part of @layerfs/agent (vendor/layerfs/api/agent, plain JavaScript) the demos call. Shapes follow
// api/docs/agent.md and what the S0 probe saw at LayerFS 7d42d0b.
declare module "@layerfs/agent" {
	export type Page<T> = { items: T[]; hasMore: boolean };
	export type Commit = { id: string; parent: string | null; secondParent: string | null; via: string; message: string };
	export type BranchEntry = { name: string; base: string; head: string | null; forkedFrom?: string };
	export type Workspace = { sandbox: string; path: string };
	export type WorkspaceEntry = Workspace & {
		branch: string;
		base: string | null;
		activity: "Idle" | "Busy";
		changed: boolean;
		dirty?: { inodes: number; entries: number };
	};
	export type ExecResult = { kind: string; exitCode: number; stdout: string; stderr: string };
	export type Committed = { kind: "Committed"; head: string; commit?: Commit };
	export type UpToDate = { kind: "UpToDate"; head: string };
	export type Change =
		| { op: "write"; path: string; content: string }
		| { op: "edit"; path: string; oldText: string; newText: string }
		| { op: "mkdir"; path: string }
		| { op: "rm"; path: string };

	export class LayerFSError extends Error {
		code: string;
		detail: unknown;
	}
	export function isRefusal(error: unknown, code?: string): error is LayerFSError;

	export class LayerFS {
		static open(name: string): Promise<LayerFS>;
		static init(name: string, folder: string, timeout?: number): Promise<LayerFS>;
		readonly created: { kind: string };
		close(): Promise<void>;
		project: {
			list_branches(pageSize?: number, pagePos?: number): Promise<Page<BranchEntry>>;
			list_sandboxes(pageSize?: number, pagePos?: number): Promise<Page<{ sandbox: string; image: string; workspaces: number | unknown[] }>>;
		};
		fs: {
			read(ref: string, path: string, startLine?: number, endLine?: number): Promise<{ text: string; nextLine: number | null }>;
			list(ref: string, path?: string, pageSize?: number, pagePos?: number): Promise<Page<{ name: string; path: string; type: string }>>;
			apply(branch: string, changes: Change[], message?: string): Promise<Committed | UpToDate>;
		};
		branch: {
			fork(name: string, fromRef?: string): Promise<{ kind: string; branch: string; head: string | null }>;
			list_commits(branch: string, pageSize?: number, pagePos?: number): Promise<Page<Commit>>;
			merge(a: string, b: string, name: string, message?: string): Promise<{ kind: string; head: string; fastForward: boolean }>;
			publish(branch: string, commit?: string): Promise<{ kind: "Added" | "UpToDate" }>;
		};
		sandbox: {
			create(): Promise<{ sandbox: string; image: string }>;
			list_workspaces(sandbox: string, pageSize?: number, pagePos?: number): Promise<Page<WorkspaceEntry>>;
			close(sandbox: string): Promise<{ kind: string }>;
		};
		workspace: {
			mount(sandbox: string, branch: string): Promise<Workspace & { image: string }>;
			exec(ws: Workspace, command: string, message?: string): Promise<ExecResult>;
			commit(ws: Workspace, message?: string, force?: boolean): Promise<Committed | UpToDate>;
			unmount(ws: Workspace, discard?: boolean, force?: boolean): Promise<{ kind: string }>;
		};
	}
}
