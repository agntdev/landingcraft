import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  urlButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import {
  getProject,
  updateProject,
  getOrCreateUser,
  type SubscriptionTier,
} from "../storage.js";

registerMainMenuItem({ label: "🌐 Publish", data: "site:publish:menu", order: 30 });

const composer = new Composer<Ctx>();

// Entry from main menu — pick a project to publish
composer.callbackQuery("site:publish:menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id ?? 0;
  const { listProjects } = await import("../storage.js");
  const projects = listProjects(userId).filter(
    (p) => p.status === "ready" || p.status === "published",
  );

  if (projects.length === 0) {
    await ctx.reply(
      "No publishable sites yet. Create a site first, then come back to publish it.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("✨ New site", "site:new")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  const rows = projects.map((p) => [
    inlineButton(p.prompt.split("|")[0].trim(), `site:publish:${p.id}`),
  ]);

  await ctx.reply("Which site would you like to publish?", {
    reply_markup: inlineKeyboard([
      ...rows,
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

// Start publish flow for a specific project
composer.callbackQuery(/^site:publish:(.+)$/, async (ctx) => {
  // Skip if this is the menu entry
  if (ctx.match[1] === "menu") return;

  await ctx.answerCallbackQuery();
  const projectId = ctx.match[1];
  const userId = ctx.from?.id ?? 0;
  const project = getProject(projectId);

  if (!project || project.ownerId !== userId) {
    await ctx.reply("Project not found.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  if (project.status === "published" && project.publishedUrl) {
    await ctx.reply(
      `🌐 This site is already live:\n\n${project.publishedUrl}\n\n` +
        "Would you like to update it or use a custom domain?",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("🔄 Update", `site:publish-confirm:${projectId}`)],
          [inlineButton("🔗 Custom domain", `site:publish-domain:${projectId}`)],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  ctx.session.step = "awaiting_publish";
  ctx.session.publishProjectId = projectId;

  const user = getOrCreateUser(userId);
  if (user.tier === "free") {
    await ctx.reply(
      "This site will be published to a free subdomain.\n\n" +
        "Upgrade to Pro or Enterprise for a custom domain and priority hosting.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("🚀 Publish anyway", `site:publish-confirm:${projectId}`)],
          [inlineButton("⭐ View plans", "pricing:show")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
  } else {
    await ctx.reply(
      "Ready to publish! Your plan includes " +
        (user.tier === "enterprise" ? "a custom domain and " : "") +
        "hosted subdomain.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("🚀 Publish", `site:publish-confirm:${projectId}`)],
          ...(user.tier === "enterprise"
            ? [[inlineButton("🔗 Use custom domain", `site:publish-domain:${projectId}`)]]
            : []),
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
  }
});

// Confirm publish (free subdomain)
composer.callbackQuery(/^site:publish-confirm:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const projectId = ctx.match[1];
  const userId = ctx.from?.id ?? 0;
  const project = getProject(projectId);

  if (!project || project.ownerId !== userId) {
    await ctx.reply("Project not found.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  const hostingUrl = process.env.HOSTING_SERVICE_URL ?? "https://host.example.com";
  const subdomain = `site-${projectId.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`;
  const publishedUrl = `${hostingUrl.replace(/^https?:\/\//, "")}${subdomain}.example.com`;

  updateProject(projectId, {
    status: "published",
    publishedUrl: `https://${publishedUrl}`,
    customDomain: undefined,
  });

  ctx.session.step = "idle";
  ctx.session.publishProjectId = undefined;

  await ctx.reply(
    "✅ Your site is live!\n\n" +
      `🌐 https://${publishedUrl}\n\n` +
      "Share this link or open it in a browser.",
    {
      reply_markup: inlineKeyboard([
        [urlButton("🔗 Open site", `https://${publishedUrl}`)],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

// Custom domain entry (paid tier)
composer.callbackQuery(/^site:publish-domain:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const projectId = ctx.match[1];
  const userId = ctx.from?.id ?? 0;
  const user = getOrCreateUser(userId);

  if (user.tier === "free") {
    await ctx.reply(
      "Custom domains are available on Pro and Enterprise plans.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⭐ View plans", "pricing:show")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  ctx.session.step = "awaiting_custom_domain";
  ctx.session.publishProjectId = projectId;

  await ctx.reply(
    "What custom domain would you like to use?\n\n" +
      "Example: mysite.com",
  );
});

// Handle custom domain input
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_custom_domain") return next();
  const domain = ctx.message.text.trim().toLowerCase();
  const projectId = ctx.session.publishProjectId;

  if (!projectId) {
    await ctx.reply("Something went wrong. Let's start over.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    ctx.session.step = "idle";
    return;
  }

  // Basic domain validation
  const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$/;
  if (!domainRegex.test(domain)) {
    await ctx.reply(
      "That doesn't look like a valid domain. Please try again.\n\nExample: mysite.com",
    );
    return;
  }

  const project = getProject(projectId);
  if (!project) {
    await ctx.reply("Project not found.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    ctx.session.step = "idle";
    return;
  }

  updateProject(projectId, {
    status: "published",
    publishedUrl: `https://${domain}`,
    customDomain: domain,
  });

  ctx.session.step = "idle";
  ctx.session.publishProjectId = undefined;

  await ctx.reply(
    "✅ Your site is live on your custom domain!\n\n" +
      `🌐 https://${domain}\n\n` +
      "DNS propagation may take a few minutes.",
    {
      reply_markup: inlineKeyboard([
        [urlButton("🔗 Open site", `https://${domain}`)],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

export default composer;
