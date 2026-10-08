/** Where the CTA sends people. Set in the deployment; when neither exists the waitlist shows. */
export function chatLinks(): {
  signal?: { number: string; url: string }
  telegram?: { handle: string; url: string }
} {
  const number = process.env.NEXT_PUBLIC_SIGNAL_NUMBER?.trim()
  const handle = process.env.NEXT_PUBLIC_TELEGRAM_BOT?.trim().replace(/^@/, "")
  return {
    signal:
      number && /^\+\d{8,15}$/.test(number)
        ? { number, url: `https://signal.me/#p/${number}` }
        : undefined,
    telegram:
      handle && /^[A-Za-z0-9_]{5,32}$/.test(handle)
        ? { handle, url: `https://t.me/${handle}` }
        : undefined,
  }
}
