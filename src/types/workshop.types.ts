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

export interface WorkshopState {
  revision: number;
  supported: boolean;
  installed: boolean;
  busy: boolean;
  phase: WorkshopPhase;
  operation: "install" | "download" | null;
  item: WorkshopItem | null;
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
