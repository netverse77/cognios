// Ambient declaration so the package typechecks before
// `@agentclientprotocol/sdk` is installed in the workspace. The runtime path
// in `acp-client.ts` lazy-imports the SDK and falls back to a clear error if
// it's missing. Once we depend on the real SDK and `pnpm -w install` is the
// universal contract, this stub can be removed and the real types will take
// over (or we'll narrow our wrapper to whatever the SDK exports).
//
// Keeping the surface intentionally narrow — only what `connectClientSide` in
// `acp-client.ts` actually touches — so accidental drift between this stub
// and the real SDK is caught at runtime by the lazy-import wrapper rather
// than silently masked at typecheck time.
declare module "@agentclientprotocol/sdk" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const ClientSideConnection: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type ClientSideConnection = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _default: any;
  export default _default;
}
