import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import {
  getOrCreateUser,
  updateUser,
  createBillingRecord,
  addBillingRecord,
  getTierLimits,
  type SubscriptionTier,
} from "../storage.js";

registerMainMenuItem({ label: "⭐ Pricing", data: "pricing:show", order: 40 });

const composer = new Composer<Ctx>();

const TIERS = [
  {
    tier: "free" as SubscriptionTier,
    name: "Free",
    price: "$0",
    features: ["3 site generations", "Free subdomain hosting", "Basic editor access"],
    generations: 3,
  },
  {
    tier: "pro" as SubscriptionTier,
    name: "Pro",
    price: "$19/mo",
    features: [
      "50 site generations",
      "Free subdomain hosting",
      "Full visual editor",
      "Priority support",
    ],
    generations: 50,
  },
  {
    tier: "enterprise" as SubscriptionTier,
    name: "Enterprise",
    price: "$49/mo",
    features: [
      "500 site generations",
      "Custom domain hosting",
      "Full visual editor",
      "Priority support",
      "Team collaboration",
    ],
    generations: 500,
  },
];

// Show pricing
composer.callbackQuery("pricing:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id ?? 0;
  const user = getOrCreateUser(userId);
  const currentTier = TIERS.find((t) => t.tier === user.tier);

  const lines = TIERS.map((t) => {
    const isCurrent = t.tier === user.tier;
    const marker = isCurrent ? " ✅ Current" : "";
    return (
      `${t.name} — ${t.price}${marker}\n` +
      t.features.map((f) => `  • ${f}`).join("\n")
    );
  });

  const text = "Choose the plan that fits you:\n\n" + lines.join("\n\n");

  const buttons = TIERS.filter((t) => t.tier !== user.tier).map((t) => [
    inlineButton(`Upgrade to ${t.name}`, `pricing:upgrade:${t.tier}`),
  ]);

  await ctx.reply(text, {
    reply_markup: inlineKeyboard([
      ...buttons,
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

// Start upgrade flow
composer.callbackQuery(/^pricing:upgrade:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const targetTier = ctx.match[1] as SubscriptionTier;
  const userId = ctx.from?.id ?? 0;
  const user = getOrCreateUser(userId);

  const target = TIERS.find((t) => t.tier === targetTier);
  if (!target) {
    await ctx.reply("Plan not found.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  if (targetTier === user.tier) {
    await ctx.reply("You're already on this plan.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  ctx.session.step = "confirming_upgrade";
  ctx.session.upgradeTier = targetTier;

  const limits = getTierLimits(targetTier);
  await ctx.reply(
    `Upgrade to ${target.name}?\n\n` +
      `${target.features.map((f) => `✅ ${f}`).join("\n")}\n\n` +
      `Total: ${target.price}\n\n` +
      `You'll get ${limits.generationQuota} generations per month.`,
    {
      reply_markup: inlineKeyboard([
        [
          inlineButton(`Confirm upgrade`, `pricing:confirm:${targetTier}`),
          inlineButton("Cancel", "menu:main"),
        ],
      ]),
    },
  );
});

// Confirm upgrade
composer.callbackQuery(/^pricing:confirm:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const targetTier = ctx.match[1] as SubscriptionTier;
  const userId = ctx.from?.id ?? 0;
  const user = getOrCreateUser(userId);

  const limits = getTierLimits(targetTier);

  // In production, this would call a real payment processor (Stripe, etc.)
  // For now, we simulate a successful payment and update the tier
  updateUser(userId, {
    tier: targetTier,
    generationQuota: limits.generationQuota,
  });

  const record = createBillingRecord({
    userId,
    tier: targetTier,
    usageCounts: 0,
  });
  addBillingRecord(record);

  ctx.session.step = "idle";
  ctx.session.upgradeTier = undefined;

  await ctx.reply(
    "✅ Payment confirmed!\n\n" +
      `You're now on the ${targetTier.charAt(0).toUpperCase() + targetTier.slice(1)} plan.\n` +
      `Your generation quota has been reset to ${limits.generationQuota}.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("✨ Create a site", "site:new")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

// Handle text input for upgrade (payment details — placeholder)
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "confirming_upgrade") return next();
  // Any text in this step is treated as a confirmation attempt
  const text = ctx.message.text.trim().toLowerCase();
  if (text === "y" || text === "yes" || text === "confirm") {
    const targetTier = ctx.session.upgradeTier as SubscriptionTier;
    if (targetTier) {
      const userId = ctx.from?.id ?? 0;
      const limits = getTierLimits(targetTier);
      updateUser(userId, { tier: targetTier, generationQuota: limits.generationQuota });

      const record = createBillingRecord({ userId, tier: targetTier, usageCounts: 0 });
      addBillingRecord(record);

      ctx.session.step = "idle";
      ctx.session.upgradeTier = undefined;

      await ctx.reply(
        `✅ You're now on the ${targetTier.charAt(0).toUpperCase() + targetTier.slice(1)} plan!`,
        {
          reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
        },
      );
    }
  } else {
    await ctx.reply("Tap a button to confirm or cancel.", {
      reply_markup: inlineKeyboard([
        [inlineButton("Cancel", "menu:main")],
      ]),
    });
  }
});

export default composer;
