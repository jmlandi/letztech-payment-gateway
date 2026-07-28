import { AsyncLocalStorage } from 'async_hooks';

/**
 * Per-request correlation context.
 *
 * Carries the trace id across async boundaries (controller → service →
 * provider adapter) without threading it through every call signature, so an
 * outbound Zoop call can be tied back to the inbound request that caused it.
 *
 * Backed by Node's AsyncLocalStorage — no external dependency, and it survives
 * awaits. Outside a request (cron relay, BullMQ worker) the store is simply
 * absent and `getTraceId()` returns undefined.
 */
export interface RequestContext {
  traceId: string;
  /** Set once the request is resolved to a store, when known. */
  storeId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `context` bound for the whole async call tree beneath it. */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

/** Attaches the store id to the active context, if there is one. */
export function setContextStoreId(storeId: string): void {
  const ctx = storage.getStore();
  if (ctx) ctx.storeId = storeId;
}
