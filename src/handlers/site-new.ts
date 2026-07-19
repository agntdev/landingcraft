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
  createProject,
  createGenerationJob,
  updateGenerationJob,
  updateProject,
  now,
} from "../storage.js";

registerMainMenuItem({ label: "✨ New site", data: "site:new", order: 10 });

const composer = new Composer<Ctx>();

// Entry point — start the site-generation wizard
composer.callbackQuery("site:new", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "awaiting_description";
  ctx.session.newSite = {};
  await ctx.reply(
    "Great — let's build your site!\n\nWhat does your product or business do? Describe it in a sentence or two so the AI knows what to generate.",
  );
});

// Step 1 — product description
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_description") return next();
  const text = ctx.message.text.trim();
  if (text.length < 5) {
    await ctx.reply("Tell me a bit more — at least a short sentence about what you do.");
    return;
  }
  ctx.session.newSite = { ...ctx.session.newSite, description: text };
  ctx.session.step = "awaiting_audience";
  await ctx.reply(
    "Who is your target audience? (e.g. small business owners, fitness enthusiasts, local customers)",
  );
});

// Step 2 — target audience
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_audience") return next();
  const text = ctx.message.text.trim();
  if (text.length < 2) {
    await ctx.reply("Just a quick note — who would use your product?");
    return;
  }
  ctx.session.newSite = { ...ctx.session.newSite, audience: text };
  ctx.session.step = "awaiting_style";
  await ctx.reply(
    "What style do you prefer? Pick one or describe your own:\n\n" +
      "• Clean & minimal\n" +
      "• Bold & modern\n" +
      "• Friendly & colorful\n" +
      "• Professional & corporate",
  );
});

// Step 3 — style preference
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_style") return next();
  const text = ctx.message.text.trim();
  if (text.length < 2) {
    await ctx.reply("Pick a style or describe what you're going for.");
    return;
  }
  ctx.session.newSite = { ...ctx.session.newSite, style: text };
  ctx.session.step = "confirming_site";

  const { description, audience, style } = ctx.session.newSite!;
  const summary =
    "Here's what I'll generate:\n\n" +
    `📝 Description: ${description}\n` +
    `👥 Audience: ${audience}\n` +
    `🎨 Style: ${style}\n\n` +
    "Ready to generate?";

  await ctx.reply(summary, {
    reply_markup: inlineKeyboard([
      [inlineButton("✨ Generate site", "site:confirm")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

// Confirm and kick off generation
composer.callbackQuery("site:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id ?? 0;
  const user = getOrCreateUser(userId);
  const siteData = ctx.session.newSite;

  if (!siteData?.description || !siteData?.audience || !siteData?.style) {
    await ctx.editMessageText(
      "Something went wrong — let's start over.",
      { reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]) },
    );
    ctx.session.step = "idle";
    ctx.session.newSite = {};
    return;
  }

  if (user.generationQuota <= 0) {
    await ctx.editMessageText(
      "You've used all your free generations. Upgrade your plan to keep building!",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⭐ View plans", "pricing:show")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    ctx.session.step = "idle";
    ctx.session.newSite = {};
    return;
  }

  const prompt = `${siteData.description} | audience: ${siteData.audience} | style: ${siteData.style}`;

  const project = createProject({
    ownerId: userId,
    prompt,
    audience: siteData.audience,
    style: siteData.style,
  });

  const job = createGenerationJob({
    projectId: project.id,
    ownerId: userId,
    inputPrompt: prompt,
  });

  updateProject(project.id, { jobId: job.id, status: "generating" });
  updateGenerationJob(job.id, { status: "generating" });

  // Deduct quota
  getOrCreateUser(userId);
  updateUser(userId, { generationQuota: user.generationQuota - 1 });

  ctx.session.step = "idle";
  ctx.session.newSite = {};

  await ctx.editMessageText(
    "⏳ Generating your site… This usually takes about 30 seconds.",
  );

  // Simulate generation completion (in production, this would be a webhook/poll)
  // We mark it as ready after a short delay via a second message
  await new Promise((r) => setTimeout(r, 100));

  updateGenerationJob(job.id, {
    status: "completed",
    completedAt: now().toISOString(),
  });
  updateProject(project.id, {
    status: "ready",
    generatedFiles: ["index.html", "style.css", "script.js"],
  });

  await ctx.reply(
    "✅ Your site is ready!\n\n" +
      `📁 ${project.prompt.split("|")[0].trim()}\n\n` +
      "What would you like to do next?",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("🌐 Publish", `site:publish:${project.id}`)],
        [inlineButton("✏️ Open editor", `site:edit:${project.id}`)],
        [inlineButton("📦 Download ZIP", `site:download:${project.id}`)],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

// Editor link
composer.callbackQuery(/^site:edit:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const projectId = ctx.match[1];
  await ctx.reply(
    `🔗 Open the visual editor to customize your site:\n\nhttps://editor.example.com/project/${projectId}`,
    {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    },
  );
});

// Download ZIP
composer.callbackQuery(/^site:download:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const projectId = ctx.match[1];
  const hostingUrl = process.env.HOSTING_SERVICE_URL ?? "https://host.example.com";
  await ctx.reply(
    `📦 Your ZIP is ready for download:\n\n${hostingUrl}/api/projects/${projectId}/zip`,
    {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    },
  );
});

export default composer;
