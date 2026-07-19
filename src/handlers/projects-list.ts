import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
  paginate,
} from "../toolkit/index.js";
import {
  listProjects,
  deleteProject,
  duplicateProject,
  type Project,
} from "../storage.js";

registerMainMenuItem({ label: "📁 My projects", data: "projects:list", order: 20 });

const composer = new Composer<Ctx>();
const PER_PAGE = 5;

// Show project list
composer.callbackQuery("projects:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id ?? 0;
  await showProjects(ctx, userId, 0);
});

// Pagination
composer.callbackQuery(/^projects:page:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const page = parseInt(ctx.match[1], 10);
  const userId = ctx.from?.id ?? 0;
  await showProjects(ctx, userId, page);
});

// Project actions menu
composer.callbackQuery(/^project:actions:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const projectId = ctx.match[1];
  const userId = ctx.from?.id ?? 0;
  const { getProject } = await import("../storage.js");
  const project = getProject(projectId);
  if (!project || project.ownerId !== userId) {
    await ctx.reply("Project not found.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }
  const statusEmoji = project.status === "published" ? "🟢" : project.status === "ready" ? "🔵" : "⚪";
  await ctx.reply(
    `${statusEmoji} ${project.prompt.split("|")[0].trim()}\n\n` +
      `Status: ${project.status}\n` +
      `Created: ${new Date(project.createdAt).toLocaleDateString()}`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("✏️ Open editor", `site:edit:${projectId}`)],
        [
          inlineButton("📋 Duplicate", `project:dup:${projectId}`),
          inlineButton("🗑 Delete", `project:del:${projectId}`),
        ],
        ...(project.status === "ready" || project.status === "published"
          ? [[inlineButton("🌐 Publish", `site:publish:${projectId}`)]]
          : []),
        [inlineButton("⬅️ Back to projects", "projects:list")],
      ]),
    },
  );
});

// Duplicate
composer.callbackQuery(/^project:dup:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const projectId = ctx.match[1];
  const userId = ctx.from?.id ?? 0;
  const dup = duplicateProject(projectId, userId);
  if (!dup) {
    await ctx.reply("Couldn't duplicate that project.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }
  await ctx.reply("✅ Project duplicated.", {
    reply_markup: inlineKeyboard([
      [inlineButton("✏️ Open editor", `site:edit:${dup.id}`)],
      [inlineButton("⬅️ Back to projects", "projects:list")],
    ]),
  });
});

// Delete with confirmation
composer.callbackQuery(/^project:del:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const projectId = ctx.match[1];
  const userId = ctx.from?.id ?? 0;
  const { getProject } = await import("../storage.js");
  const project = getProject(projectId);
  if (!project || project.ownerId !== userId) {
    await ctx.reply("Project not found.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }
  await ctx.reply(
    `Delete "${project.prompt.split("|")[0].trim()}"?\n\nThis can't be undone.`,
    {
      reply_markup: inlineKeyboard([
        [
          inlineButton("🗑 Delete", `project:delconfirm:${projectId}`),
          inlineButton("Cancel", `project:actions:${projectId}`),
        ],
      ]),
    },
  );
});

// Confirm delete
composer.callbackQuery(/^project:delconfirm:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const projectId = ctx.match[1];
  const userId = ctx.from?.id ?? 0;
  const deleted = deleteProject(projectId, userId);
  if (deleted) {
    await ctx.reply("✅ Project deleted.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
  } else {
    await ctx.reply("Couldn't delete that project.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
  }
});

async function showProjects(ctx: Ctx, userId: number, page: number) {
  const projects = listProjects(userId);
  if (projects.length === 0) {
    await ctx.reply(
      "No projects yet — tap ✨ New site to create your first one.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("✨ New site", "site:new")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  const { pageItems, page: actualPage, totalPages, controls } = paginate(projects, {
    page,
    perPage: PER_PAGE,
    callbackPrefix: "projects:page",
  });

  const rows = pageItems.map((p: Project) => {
    const statusEmoji = p.status === "published" ? "🟢" : p.status === "ready" ? "🔵" : "⚪";
    return [inlineButton(`${statusEmoji} ${p.prompt.split("|")[0].trim()}`, `project:actions:${p.id}`)];
  });

  const keyboard = inlineKeyboard([
    ...rows,
    ...controls.inline_keyboard,
    [inlineButton("⬅️ Back to menu", "menu:main")],
  ]);

  const header = totalPages > 1
    ? `Your projects (page ${actualPage + 1}/${totalPages}):`
    : "Your projects:";

  if (ctx.editMessageText) {
    await ctx.editMessageText(header, { reply_markup: keyboard });
  } else {
    await ctx.reply(header, { reply_markup: keyboard });
  }
}

export default composer;
