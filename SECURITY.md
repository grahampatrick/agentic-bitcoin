# Security

Agentic Bitcoin is non-custodial, but it will hold *scoped* wallet connections and exchange keys on
users' behalf once the agent ships. Treat any bug that could move funds, leak a connection string,
or bypass a budget as critical.

## Reporting

Email **security@agenticbitcoin.com** (until that mailbox exists: open a GitHub Security Advisory on
the repository — those are private). Please include steps to reproduce and the commit hash.

We will acknowledge within 72 hours, and we will not pursue anyone who reports in good faith.

## Scope

In scope: anything in this repository, the deployed landing site, and (later) the hosted agent.
Out of scope: third-party wallets, exchanges, and merchants the adapters talk to — report those
to the respective projects, and tell us too if our adapter made it worse.
