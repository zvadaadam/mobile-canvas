/** Data displayed by the embedded review UI; the runtime owns all project state. */
export interface CanvasAppView {
  workspaceId: string;
  sequence: number;
  codeVersion: string;
  name: string;
  kind: "expo" | "swift";
  host: {
    id: string | null;
    connected: boolean;
    ready: boolean;
    starting: boolean;
    error: string | null;
  };
  screens: {
    id: string;
    key: string;
    name: string;
    source: string;
    notes: string;
    links: string[];
    x: number;
    y: number;
    width: number;
    height: number;
    issue: string | null;
  }[];
}

export interface CanvasAppCapture {
  data: string;
  screenId: string;
  codeVersion: string;
  sequence: number;
  capturedAt: number;
  width: number;
  height: number;
  error: string | null;
}
