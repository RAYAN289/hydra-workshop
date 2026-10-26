export type WorkshopPhase =
  | "idle"
  | "installing"
  | "resolving"
  | "downloading"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkshopErrorCode =
  | "unsupported"
  | "busy"
  | "not-installed"
  | "invalid-url"
  | "unavailable"
  | "collection"
  | "network"
  | "install-failed"
  | "download-failed";

export interface WorkshopItem {
  id: string;
  appId: string;
  title: string;
}

export interface WorkshopGame {
  appId: string;
  name: string | null;
  inHydraLibrary: boolean;
  location: {
    path: string;
    kind: "steam-install" | "hydra-executable";
  } | null;
}

export interface WorkshopInspection {
  item: WorkshopItem;
  game: WorkshopGame;
}

export interface WorkshopState {
  revision: number;
  supported: boolean;
  installed: boolean;
  busy: boolean;
  phase: WorkshopPhase;
  operation: "install" | "download" | null;
  item: WorkshopItem | null;
  game: WorkshopGame | null;
  contentPath: string;
  downloadPath: string | null;
  error: WorkshopErrorCode | null;
  logs: string[];
}

export interface WorkshopResult {
  success: boolean;
  error?: WorkshopErrorCode;
  state: WorkshopState;
}

export interface WorkshopCatalogueItem extends WorkshopItem {
  description: string;
  previewUrl: string | null;
  size: number;
  updatedAt: number;
}

export interface WorkshopBrowseResult {
  items: WorkshopCatalogueItem[];
  total: number;
  page: number;
  hasMore: boolean;
}

export type WorkshopModStatus =
  | "queued"
  | "downloading"
  | "downloaded"
  | "installed"
  | "failed"
  | "cancelled";
export interface WorkshopMod {
  item: WorkshopCatalogueItem;
  status: WorkshopModStatus;
  error: string | null;
  updatedAt: number;
}
export interface WorkshopLibraryState {
  revision: number;
  mods: WorkshopMod[];
  activeId: string | null;
  targets: Record<string, string>;
}
export interface WorkshopPack {
  version: 1;
  appId: string;
  itemIds: string[];
}
