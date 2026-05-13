import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";

// IDL is vendored into the package so the SDK is browser-safe. Refresh
// the file with `pnpm refresh:idl` from the workspace root whenever the
// program changes (it copies target/idl/cc_vrf.json here).
import idl from "./idl/cc_vrf.json";

/**
 * Build an Anchor Program handle for cc-vrf. Pass an AnchorProvider with a
 * Connection and Wallet — operations that mutate state (init/freeze/etc)
 * use this provider's wallet as signer.
 */
export function getProgram(provider: anchor.AnchorProvider): Program {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Program(idl as any, provider);
}
