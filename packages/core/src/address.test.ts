import { describe, expect, it } from "vitest"
import { AddressError, parseAddress } from "./address"

describe("parseAddress", () => {
  it.each([
    ["bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", "mainnet", "p2wpkh"],
    ["BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4", "mainnet", "p2wpkh"],
    ["bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3", "mainnet", "p2wsh"],
    ["bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0", "mainnet", "p2tr"],
    ["tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", "testnet", "p2wpkh"],
    ["bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080", "regtest", "p2wpkh"],
    ["1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", "mainnet", "p2pkh"],
    ["3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", "mainnet", "p2sh"],
    ["mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn", "testnet", "p2pkh"],
  ])("accepts %s", async (a, network, kind) => {
    expect(await parseAddress(a)).toEqual({ network, kind })
  })
  it.each([
    "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5", // bad checksum
    "bc1qW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // mixed case
    "bc1zw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // v1 with bech32 (not bech32m) checksum
    "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3", // bad base58 checksum
    "gm@getalby.com",
    "lnbc1...",
    "",
  ])("rejects %s", async (a) => {
    await expect(parseAddress(a)).rejects.toBeInstanceOf(AddressError)
  })
})
