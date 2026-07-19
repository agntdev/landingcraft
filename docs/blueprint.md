# AI Website Builder Bot — Bot specification

**Archetype:** custom

**Voice:** professional and encouraging — write every user-facing message, button label, error, and empty state in this voice.

Telegram bot enabling non-technical founders to generate marketing websites via natural language prompts, edit them with a visual web editor, and download/host the result. Includes tiered pricing for generation quotas, hosting, and custom domains.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- non-technical founders
- small startup teams

## Success criteria

- User generates and downloads a functional website ZIP
- User publishes a hosted site with subdomain
- User upgrades to paid tier for additional features

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu with New site, My projects, Pricing
- **New site** (button, actor: user, callback: site:new) — Initiate site generation flow
  - inputs: product description, target audience, style preferences
  - outputs: generation job status, editor access link
- **My projects** (button, actor: user, callback: projects:list) — List all projects with actions: edit, duplicate, delete
- **Publish to hosted URL** (button, actor: user, callback: site:publish) — Publish current project to hosted subdomain
  - inputs: custom domain (paid tier)
  - outputs: published URL, hosting status

## Flows

### Site generation
_Trigger:_ /start or New site button

1. Request product description and preferences
2. Enqueue generation job
3. Notify when complete
4. Show preview with editor/editor access

_Data touched:_ Project, GenerationJob

### Editor workflow
_Trigger:_ Open editor button

1. Launch web-based visual editor
2. Save layout/SEO changes
3. Export ZIP or publish

_Data touched:_ Project, GenerationJob

### Billing upgrade
_Trigger:_ /pricing or Pricing button

1. Show tier options
2. Process payment confirmation
3. Update user tier

_Data touched:_ User, BillingRecord

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **User** _(retention: persistent)_ — Telegram account with subscription tier and usage quotas
  - fields: telegram_id, subscription_tier, generation_quota
- **Project** _(retention: persistent)_ — Website project with generated files and editor state
  - fields: prompt, generated_files, published_url
- **GenerationJob** _(retention: persistent)_ — Site generation request and status tracking
  - fields: input_prompt, status, timestamp
- **BillingRecord** _(retention: persistent)_ — Subscription and payment history
  - fields: tier, purchase_date, usage_counts

## Integrations

- **Telegram** (required) — Bot API messaging and notifications
- **Static Hosting Service** (required) — Host published sites on subdomains
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Create/delete projects
- Edit project content via visual editor
- Upgrade/downgrade subscription tier

## Notifications

- Generation completion with preview
- Hosting status updates
- Billing confirmation and renewal alerts

## Permissions & privacy

- User data stored securely with payment info encrypted
- Editor state saved server-side with autosave

## Edge cases

- Generation job failure with retry option
- Payment failure during upgrade
- Concurrent edits to same project

## Required tests

- End-to-end site generation workflow
- Billing tier upgrade/downgrade flow
- Hosted site publishing and custom domain setup

## Assumptions

- Web-based visual editor accessible via external link
- Generated sites are static HTML/CSS/JS only
- Notifications sent only to initiating user
