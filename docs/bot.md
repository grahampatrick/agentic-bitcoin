# How to talk to it

In plain words. There are no commands to learn. This page lists what you can say and what the
assistant does with it. The reasoning is in [ADR-0029](./adr/0029-plain-words-and-the-desk.md).

## The first five minutes

1. **Say hi.** It asks three questions: your daily cap, the amount above which it asks you first,
   and what it may do.
2. **Connect your wallet.** Say “connect my wallet” for the steps, then paste the connection string
   (it starts with `nostr+walletconnect://`) as a message of its own. It is removed from the chat
   before the model sees it and stored encrypted. Strings without a budget are refused; reply
   “connect anyway” within a few minutes if you really mean it.
3. **Ask.** “What's my balance?” Then “pay 500 sats to gm@getalby.com”.

## What you can say

| You want | Say something like |
|---|---|
| Pay someone | “pay 500 sats to gm@getalby.com”, or paste an invoice |
| Get paid | “make an invoice for 2,000 sats for lunch” |
| See what happened | “what did I spend today?”, “did that go through?” |
| See your limits | “what are my limits?” |
| Change a limit | “set my daily cap to 50,000 sats”, “ask me above 5,000”, “always ask me first” |
| Choose who can be paid | “only let me pay *@getalby.com”, “never pay anyone at evil.example” |
| Switch something on or off | “turn on buying bitcoin”, “turn off shopping” |
| Stop everything | “stop everything” (or “freeze”, or just “stop”) |
| Start again | “resume”, then “yes” |
| Buy bitcoin | “connect Strike”, paste the key, then “buy $25 of bitcoin every Friday” |
| Buy back what you spend | “replace the bitcoin I spend”, “replace half”, “stop replacing” |
| Cold storage | “my cold storage address is bc1…”, then “sweep everything above 200,000 sats” |
| Give | “tithe 20,000 sats to grace-fellowship every Sunday”, “add give@mychurch.org as My Church” |
| A year of giving | “export my giving for 2026” |
| Shop | “find me a study bible”, “show my orders” |
| Cards | “create a card for steam with a 50,000 sat monthly limit”, “pause my steam card” |
| Bills | “pay my rent, $450 to landlord@example.com on the 1st”, “stop paying rent” |
| Invoices | “invoice Bob $200 for the deck due Friday”, “export my invoices” |
| Notes | “add a note to my last payment: plumber deposit”, “show my notes” |
| Your address | “I want the address graham”, “what's my lightning address?” |
| Invite a friend | “how do I invite a friend?”, “a friend invited me, code ABC234” |
| The web | “open my account”, “log me out of the web everywhere” |
| Check connections | “is my wallet connected?”, “disconnect my wallet”, “remove my Strike key” |

## What happens to a change

- **It narrows** (a lower cap, something switched off, a blocked destination, stop): it applies at
  once and the assistant says what changed.
- **It widens** (a higher cap, something switched on, resume, a new cold address or recipient, your
  Lightning address, a wallet or key removed, an invite code): the assistant shows one line and
  waits. Only your own “yes” applies it. The model can propose a change; it cannot approve one.
- **It cannot be made** (not a number, an address that does not answer): you are told why, and
  nothing is left waiting.

## What never reaches the model

- **Secrets.** A pasted connection string or API key is redacted and stored before the model runs.
  If the assistant cannot tell which service a key is for, it asks once (“strike or bitrefill?”)
  and forgets the key if you say anything else. It never shows any part of a stored secret back.
- **Stop.** “Stop everything” sets the kill switch in code. It works when the model is down.
- **Yes and no.** A yes is matched to the exact thing you were shown.
- **Your invite code** at first contact.
- **Private links.** “Open my account” sends the link to you directly; the model is told only that
  it was sent.

## For operators

`/verify <slug>` lists and verifies directory recipients. It is the one command an operator needs.

## The old commands

Every slash command from before M25 still works as an alias and applies at once, because you typed
it yourself: `/budget`, `/kill`, `/resume`, `/pair`, `/key`, `/cold`, `/ledger`, `/cards`, `/bills`,
`/replace`, `/note`, `/notes`, `/recipients`, `/recipient`, `/statement`, `/campaigns`, `/follow`,
`/unfollow`, `/address`, `/web`, `/refer`, `/join`, `/invoices`, `/rewards`, `/orders`, `/shop`,
`/setup`, `/help`. Nothing in the product teaches them any more.
