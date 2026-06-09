interface ReaperTab {
	index: number;
	name: string;
	length: number;
	dirty: boolean;
}

interface TabsResponse {
	tabs: ReaperTab[];
	activeIndex: number;
}

interface TestProjectsFolderResponse {
	valid: boolean;
	message: string;
}

type Chunkable<T> = T & { __chunkable: true };

export interface ScriptOperations {
	listProjects: () => { projects: string[] };
	testProjectsFolder: (folderPath: string) => TestProjectsFolderResponse;
	openProject: (projectPath: string) => void;
	testActionId: (testNonce: string) => { testOutput: string };
	getProjectLength: () => { projectLength: number };
	getOpenTabs: () => TabsResponse;
	writeChunkedData: <T>(section: string, key: string, chunks: Chunkable<T>) => void;
	deleteState: (section: string, key: string) => void;
	/**
	 * Whether Reaper's "Project tabs: Run background projects" mode (action
	 * 41816) is currently enabled. The playback engine uses this to decide
	 * whether crossover mode can audibly overlap songs.
	 */
	isBackgroundProjectsEnabled: () => { enabled: boolean };
}
