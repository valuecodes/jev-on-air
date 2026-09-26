// No module-level singleton on purpose. Building one would open a stream on
// fd 1 as an import side effect for every consumer, including those that go on
// to construct their own with bindings — which is what an app should do, in one
// place it owns.
export type { LoggerOptions } from "./logger.ts";
export { Logger } from "./logger.ts";
export type { TraceFields, TraceHeaders, TraceOptions } from "./trace.ts";
export { parseTraceHeaders } from "./trace.ts";
export type { LogFields, LoggerLike, LogLevel, LogMethod } from "./types.ts";
