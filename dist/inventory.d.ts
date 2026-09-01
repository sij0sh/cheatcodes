export declare const TREE_LIMITS: {
    readonly depth: 4;
    readonly entries: 400;
    readonly bytes: 16384;
};
export declare const SKIP_DIRS: Set<string>;
export interface InventoryEntry {
    path: string;
    bytes?: number;
    sha256?: string;
}
export interface Inventory {
    root: string;
    entries: InventoryEntry[];
    totalFiles: number;
    truncated: boolean;
}
export declare function walkInventory(root: string): Promise<Inventory>;
export declare function inventoryDigest(root: string): Promise<string>;
