/** What the twin's control plane answers (src/control/operations.ts), as the dashboard reads it. */

export interface TwinStatus {
  company: { name: string; trade: string; city: string; state: string; utcOffsetHours: number };
  seed: number;
  scenario: string | null;
  twinTime: string;
  eventCount: number;
  vendors: string[];
  authMode: AuthMode;
  activeFaults: string[];
  webhookSubscriptions: number;
  checkpoints: { name: string; time: string }[];
  upcoming: { at: string; vendor: string; action: string; params: unknown }[];
}

export type AuthMode = "any-token" | "oauth";

export interface ScenarioInfo {
  name: string; // "flaky-apis", what POST /_twin/scenarios/:name takes
  title: string;
  description: string;
}

export interface TwinEvent {
  seq: number;
  at: string;
  source: string; // "seed", "scenario", "api", or "control"
  vendor: string;
  type: string;
  data: unknown;
}

export interface Change extends TwinEvent {
  summary: string;
}

export interface WebhookReport {
  subscriptions: { vendor: string; url: string; topics: string[]; clientId: string }[];
  deliveries: Delivery[];
}

export interface Delivery {
  id: number;
  vendor: string;
  topic: string;
  itemId: string;
  url: string;
  dueAt: string;
  attempts: number;
  status: "pending" | "delivered" | "failed";
  lastAnswer: string | null;
  fault: string | null;
}
