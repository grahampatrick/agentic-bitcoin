/**
 * Breez SDK (Nodeless) wallet rail — STUB. See ADR-0006: NWC is the wallet socket; Breez is the
 * fallback only if NWC proves insufficient (e.g. a user with no NWC-capable wallet who wants an
 * embedded one). Implementing it means holding a seed, which crosses the custody line unless the
 * seed lives on the user's device — so this stays a stub until that design exists.
 */
import { RailError, type WalletRail } from "@agentic-bitcoin/core"

export function createBreezWalletRail(): WalletRail {
  throw new RailError("breez", "BAD_CONFIG", "Breez rail is not implemented (ADR-0006: NWC first)")
}
