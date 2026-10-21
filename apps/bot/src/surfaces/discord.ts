/**
 * Discord (M16): the player surface. DMs only — anything that moves sats never happens in a channel.
 * Confirmations are buttons; secrets pasted in DMs are deleted when Discord lets us.
 */
import {
  ButtonStyle,
  ChannelType,
  Client,
  ComponentType,
  GatewayIntentBits,
  type MessageCreateOptions,
  Partials,
} from "discord.js"
import type { ChatSurface, InboundMessage, OutboundMessage } from "./surface"

export class DiscordSurface implements ChatSurface {
  readonly kind = "discord"
  private readonly client: Client
  constructor(private readonly token: string) {
    this.client = new Client({
      intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
      partials: [Partials.Channel, Partials.Message],
    })
  }
  async start(onMessage: (m: InboundMessage) => Promise<void>) {
    this.client.on("messageCreate", async (msg) => {
      if (msg.author.bot) return
      if (msg.channel.type !== ChannelType.DM) {
        // never in public: point them to a DM
        if (msg.mentions.has(this.client.user ?? ""))
          await msg.reply("DM me — I only move money in private.").catch(() => {})
        return
      }
      await onMessage({ userId: `discord:${msg.author.id}`, text: msg.content, messageId: msg.id })
    })
    this.client.on("interactionCreate", async (i) => {
      if (!i.isButton()) return
      const [verb, hash] = i.customId.split(":")
      await i.deferUpdate().catch(() => {})
      if ((verb === "yes" || verb === "no") && hash)
        await onMessage({
          userId: `discord:${i.user.id}`,
          text: verb,
          decision: { actionHash: hash, approve: verb === "yes" },
        })
    })
    await this.client.login(this.token)
  }
  async send(userId: string, m: OutboundMessage) {
    const user = await this.client.users.fetch(userId.replace(/^discord:/, ""))
    const payload: MessageCreateOptions = { content: m.text }
    if (m.confirm) {
      const hash = m.confirm.actionHash
      payload.components = [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              customId: `yes:${hash}`,
              label: "Confirm",
              style: ButtonStyle.Success,
            },
            {
              type: ComponentType.Button,
              customId: `no:${hash}`,
              label: "Cancel",
              style: ButtonStyle.Secondary,
            },
          ],
        },
      ]
    }
    await user.send(payload)
  }
  async redact(userId: string, messageId: string) {
    try {
      const user = await this.client.users.fetch(userId.replace(/^discord:/, ""))
      const dm = await user.createDM()
      const msg = await dm.messages.fetch(messageId)
      await msg.delete()
    } catch {
      /* bots cannot delete a user's DM message; the reply tells them to delete it themselves */
    }
  }
  async stop() {
    await this.client.destroy()
  }
}
