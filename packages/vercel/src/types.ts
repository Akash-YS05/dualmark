export type { AIRequestInfo, MissInfo, TrailingSlashMode } from "@dualmark/core";

import type { AIRequestInfo, MissInfo, TrailingSlashMode } from "@dualmark/core";

export interface MinimalExecutionContext {
  waitUntil: (promise: Promise<unknown>) => void;
}

export interface VercelEdgeEventLike {
  waitUntil?: (promise: Promise<unknown>) => void;
}

export interface UpstreamMiddleware {
  fetch: (request: Request, ctx: MinimalExecutionContext) => Promise<Response> | Response;
}

export interface VercelAnalyticsEvent {
  kind: "hit" | "miss";
  indexKey: string;
  pathname: string;
  botName: string | null;
  botVendor: string | null;
  userAgent: string;
  country: string;
  tokens: number;
  acceptHeader: string;
}

export type VercelEdgeMiddleware = (
  request: Request,
  event?: VercelEdgeEventLike,
) => Promise<Response> | Response;

export interface CreateAEOMiddlewareOptions {
  upstream: UpstreamMiddleware;
  redirects?: {
    internal?: Record<string, string>;
    external?: Record<string, string>;
  };
  skip?: {
    prefixes?: ReadonlyArray<string>;
    extensions?: ReadonlyArray<string>;
  };
  analytics?: {
    onEvent?: (event: VercelAnalyticsEvent) => void | Promise<void>;
  };
  trailingSlash?: TrailingSlashMode;
  headers?: {
    cacheControl?: string;
  };
  hooks?: {
    onAIRequest?: (info: AIRequestInfo) => void | Promise<void>;
    onMiss?: (info: MissInfo) => void | Promise<void>;
  };
  enableLinkHeader?: boolean;
}
