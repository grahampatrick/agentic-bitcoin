/** Typed errors so callers can branch on cause instead of parsing message strings. */

export type WaitlistErrorCode = "INVALID_CONTACT" | "ALREADY_JOINED" | "STORE_UNAVAILABLE"

export class WaitlistError extends Error {
  readonly code: WaitlistErrorCode
  /** HTTP status the API route should map this to. */
  readonly status: number

  constructor(code: WaitlistErrorCode, message: string, status: number) {
    super(message)
    this.name = "WaitlistError"
    this.code = code
    this.status = status
  }

  static invalidContact(): WaitlistError {
    return new WaitlistError(
      "INVALID_CONTACT",
      "That doesn't look like an email address or an npub.",
      400,
    )
  }

  static alreadyJoined(): WaitlistError {
    return new WaitlistError("ALREADY_JOINED", "You're already on the list.", 409)
  }

  static storeUnavailable(): WaitlistError {
    return new WaitlistError("STORE_UNAVAILABLE", "Couldn't reach the waitlist store.", 503)
  }
}
