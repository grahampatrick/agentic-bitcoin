import { ADDRESSES, INVOICES, clockAt } from "@agentic-bitcoin/fixtures"
import { FakeExchangeRail, FakeGoodsRail, FakeWalletRail } from "../src/fakes"
import { describeExchangeRail, describeGoodsRail, describeWalletRail } from "./rail-contract"

describeWalletRail(
  "fake-wallet",
  () => new FakeWalletRail({ balanceSats: 1_000_000n, now: clockAt() }),
  {
    payable: INVOICES.small,
    failing: INVOICES.failing,
    address: ADDRESSES.gm,
  },
)

describeExchangeRail("fake-exchange", () => new FakeExchangeRail({ now: clockAt() }))

describeGoodsRail("fake-goods", () => new FakeGoodsRail(), {
  query: "amazon",
  productId: "gift-amazon-us",
  usdCents: 10_00n,
})
