export { execute, getDefaultHermesProcessRegistry } from "./execute.js";
export { testEnvironment } from "./test.js";
export { sessionCodec } from "./session-codec.js";
export {
  buildPrompt,
  PAPERCLIP_AUTH_GUARD_PROMPT,
  type BuildPromptInput,
  type BuiltPrompt,
} from "./prompt-builder.js";
export {
  HermesProcessRegistry,
  buildHermesProcessSpec,
  type HermesProcessSpec,
  type HermesProcessHandle,
  type HermesProcessSnapshot,
} from "./process-registry.js";
export {
  searchFacts,
  type MemorySnippet,
  type AcpExtMethodConnection,
  type HermesProcessHandleWithConnection,
} from "./memory.js";
