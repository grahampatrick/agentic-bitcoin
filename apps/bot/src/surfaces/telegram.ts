/** Telegram via grammY — the dev surface. Inline Confirm/Deny buttons carry the action hash. */
import { Bot, InlineKeyboard } from "grammy"
import type { ChatSurface, InboundMessage, OutboundMessage } from "./surface"

export class TelegramSurface implements ChatSurface {
  readonly kind = "telegram"
  private readonly bot: Bot
  constructor(token: string) {
    this.bot = new Bot(token)
  }
  async start(onMessage: (m: InboundMessage) => Promise<void>) {
    this.bot.on("message:text", async (ctx) => {
      await onMessage({ userId: `tg:${ctx.from.id}`, text: ctx.message.text })
    })
    this.bot.on("callback_query:data", async (ctx) => {
      const [verb, hash] = ctx.callbackQuery.data.split(":")
      await ctx.answerCallbackQuery()
      if ((verb === "yes" || verb === "no") && hash) {
        await onMessage({
          userId: `tg:${ctx.from.id}`,
          text: verb,
          decision: { actionHash: hash, approve: verb === "yes" },
        })
      }
    })
    void this.bot.start()
  }
  async send(userId: string, m: OutboundMessage) {
    const chatId = Number(userId.replace(/^tg:/, ""))
    const keyboard = m.confirm
      ? new InlineKeyboard()
          .text("Confirm", `yes:${m.confirm.actionHash}`)
          .text("Cancel", `no:${m.confirm.actionHash}`)
      : undefined
    await this.bot.api.sendMessage(
      chatId,
      m.text,
      keyboard ? { reply_markup: keyboard } : undefined,
    )
  }
  async stop() {
    await this.bot.stop()
  }
}
