import { randomUUID } from "node:crypto";
import { identityOf, type Operation, type Session } from "../shared/model";
export class CanvasClient {
  constructor(readonly url: string) {}
  async request<T = any>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(
      `${this.url}/api${path}`,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    const value = (await response.json()) as any;
    if (!response.ok)
      throw new Error(
        `${value.error?.code ?? "request_failed"}: ${value.error?.message ?? response.statusText}`,
      );
    return value;
  }
  read() {
    return this.request<Session>("/session");
  }
  async batch(operations: Operation[], label: string) {
    const session = await this.read();
    return this.request("/command", {
      ...identityOf(session),
      requestId: randomUUID(),
      operations,
      label,
    });
  }
}
