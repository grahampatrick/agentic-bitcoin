# Private transaction notes

A private note is a line you keep on a payment for your own records. It stays in your own ledger.
The payee never sees it, it is not on the invoice, and nothing about it leaves the server.

**In chat:** "pay 500 sats to gm@getalby.com, note: plumber deposit" pays and notes it. "for coffee"
or "memo: coffee" is the memo the payee reads; "note: …" or "note to self: …" is private. Later:
"add a note to my last payment: reimbursed by work", "note on my payment to gm@getalby.com: plumber",
"remove the note from my last payment".

**Commands:** `/note <text>` notes your last payment · `/note <id> <text>` notes that entry (ids are in
`/notes` and `/ledger`) · `/note clear [id]` removes one · `/notes` lists payments with notes · `/ledger`
shows each note after its payment.

**With a confirmation:** if the payment needs your yes, the note is attached while it waits and
follows the payment when you approve it.

**At rest:** on a server with `SECRETS_KEY` notes are stored encrypted (AES-256-GCM, the same key
that seals wallet strings) and opened only for you. Without a key they are stored in plain, like a
memo. Notes are at most 280 characters; a new note replaces the old one; a note is never sent to
anyone and is never an instruction to the assistant.

**Not here yet:** notes on schedules and bills, search across notes, a web view. See ADR-0024.
