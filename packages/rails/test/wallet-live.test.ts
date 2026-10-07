/**
 * Opt-in live contract run against a real wallet. Skipped unless RUN_WALLET_CONTRACT=1 and
 * NWC_URL are set. Pays ~21 sats three times to NWC_TEST_ADDRESS. See docs/testing.md.
 */
import { describeWalletRail } from "@agentic-bitcoin/core/contract"
import { describe, it } from "vitest"
import { NwcWalletRail, describeConnectionString } from "../src/wallet/nwc"

const url = process.env.NWC_URL
const address = process.env.NWC_TEST_ADDRESS ?? "gm@getalby.com"
const enabled = process.env.RUN_WALLET_CONTRACT === "1" && !!url

if (!enabled) {
  describe("WalletRail contract: nwc (live)", () => {
    it.skip("skipped: set RUN_WALLET_CONTRACT=1 and NWC_URL", () => {})
  })
} else {
  const rail = new NwcWalletRail({ connectionString: url as string })
  console.log(`live wallet: ${describeConnectionString(url as string)} · paying ${address}`)
  describeWalletRail("nwc (live)", () => rail, {
    payable: async () => ({
      ...(await rail.resolveAddress(address, 21n, "contract")),
      amountSats: 21n,
    }),
    address,
  })
}
