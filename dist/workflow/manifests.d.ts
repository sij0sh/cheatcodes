import { type HarvestPacket } from "../harvest.js";
import { type FileCursor } from "../state.js";
export declare const MANIFEST_VERSION = 1;
export declare const MAX_MANIFEST_PACKETS = 8;
export declare const workflowDir: (root: string) => string;
export declare const manifestPath: (root: string, id: string) => string;
export interface EpisodeManifest {
    version: 1;
    id: string;
    projectKey: string;
    corpusRevision: string;
    createdAt: string;
    packets: HarvestPacket[];
    cursors: Record<string, FileCursor>;
}
/** Manifest ids are content hashes; anything else is rejected before it touches the filesystem. */
export declare function isManifestId(id: string): boolean;
export declare function readManifest(root: string, id: string): Promise<EpisodeManifest | undefined>;
export interface ManifestBuild {
    manifest?: EpisodeManifest;
    scannedFiles: number;
    warnings: string[];
}
/**
 * Collect harvested episodes into one immutable, content-addressed manifest.
 * Cursors are recorded but not committed; the host commits them only after the
 * workflow reaches terminal success, so a parked run replays the same manifest.
 */
export declare function buildManifest(options?: {
    root?: string;
    env?: NodeJS.ProcessEnv;
}): Promise<ManifestBuild>;
/** Commit the cursors recorded by a manifest; only ever moves offsets forward. */
export declare function commitManifestCursors(options: {
    root?: string;
    env?: NodeJS.ProcessEnv;
    manifest: EpisodeManifest;
}): Promise<number>;
