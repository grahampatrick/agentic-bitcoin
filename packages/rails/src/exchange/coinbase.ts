/**
 * Coinbase Advanced Trade — INTERFACE-ONLY STUB. Exists to prove `ExchangeRail` fits a second
 * venue (quote → execute maps onto a market order preview → order). Not implemented until a user
 * needs it; the Strike adapter is the reference implementation.
 */
import { type ExchangeRail, RailError } from "@agentic-bitcoin/core"

export function createCoinbaseExchangeRail(): ExchangeRail {
  throw new RailError(
    "coinbase",
    "BAD_CONFIG",
    "Coinbase rail is not implemented (M5: Strike is the reference)",
  )
}
