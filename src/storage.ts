import { MemorySessionStorage } from "./toolkit/index.js";

// ---------------------------------------------------------------------------
// Durable domain storage — backs User, Project, GenerationJob, BillingRecord
// onto the toolkit's MemorySessionStorage (auto-Redis when REDIS_URL is set).
// Keys are namespaced; indices track collections to avoid keyspace scans.
// ---------------------------------------------------------------------------

// ── Entity types ──────────────────────────────────────────────────────────

export type SubscriptionTier = "free" | "pro" | "enterprise";

export interface UserData {
  telegramId: number;
  tier: SubscriptionTier;
  generationQuota: number;   // remaining generations
  projectIds: string[];       // index — owned project IDs
}

export interface Project {
  id: string;
  ownerId: number;
  prompt: string;
  audience: string;
  style: string;
  status: "draft" | "generating" | "ready" | "published";
  generatedFiles?: string[];
  publishedUrl?: string;
  customDomain?: string;
  createdAt: string;          // ISO-8601
  jobId?: string;
}

export interface GenerationJob {
  id: string;
  projectId: string;
  ownerId: number;
  inputPrompt: string;
  status: "queued" | "generating" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface BillingRecord {
  id: string;
  userId: number;
  tier: SubscriptionTier;
  purchaseDate: string;
  usageCounts: number;
}

// ── Store instances ───────────────────────────────────────────────────────

const userStore = new MemorySessionStorage<UserData>();
const projectStore = new MemorySessionStorage<Project>();
const jobStore = new MemorySessionStorage<GenerationJob>();
const billingStore = new MemorySessionStorage<BillingRecord>();

// ── Helpers ───────────────────────────────────────────────────────────────

let idCounter = 0;
export function generateId(): string {
  return `id_${Date.now().toString(36)}_${(++idCounter).toString(36)}`;
}

export function now(): Date {
  return new Date();
}

// ── User CRUD ─────────────────────────────────────────────────────────────

export function getOrCreateUser(telegramId: number): UserData {
  const key = `user:${telegramId}`;
  let existing = userStore.read(key);
  if (!existing) {
    existing = {
      telegramId,
      tier: "free",
      generationQuota: 3,
      projectIds: [],
    };
    userStore.write(key, existing);
  }
  return existing;
}

export function getUser(telegramId: number): UserData | undefined {
  return userStore.read(`user:${telegramId}`);
}

export function updateUser(telegramId: number, patch: Partial<UserData>): UserData {
  const key = `user:${telegramId}`;
  const existing = getOrCreateUser(telegramId);
  const updated = { ...existing, ...patch };
  userStore.write(key, updated);
  return updated;
}

// ── Project CRUD ──────────────────────────────────────────────────────────

export function createProject(data: Omit<Project, "id" | "createdAt" | "status">): Project {
  const id = generateId();
  const project: Project = {
    ...data,
    id,
    status: "draft",
    createdAt: now().toISOString(),
  };
  projectStore.write(`project:${id}`, project);

  // Update user index
  const user = getOrCreateUser(data.ownerId);
  const projectIds = [...user.projectIds, id];
  updateUser(data.ownerId, { projectIds });

  return project;
}

export function getProject(id: string): Project | undefined {
  return projectStore.read(`project:${id}`);
}

export function updateProject(id: string, patch: Partial<Project>): Project | undefined {
  const existing = getProject(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...patch };
  projectStore.write(`project:${id}`, updated);
  return updated;
}

export function deleteProject(id: string, ownerId: number): boolean {
  const existing = getProject(id);
  if (!existing || existing.ownerId !== ownerId) return false;
  projectStore.delete(`project:${id}`);

  // Remove from user index
  const user = getOrCreateUser(ownerId);
  const projectIds = user.projectIds.filter((pid) => pid !== id);
  updateUser(ownerId, { projectIds });
  return true;
}

export function listProjects(ownerId: number): Project[] {
  const user = getOrCreateUser(ownerId);
  return user.projectIds
    .map((id) => getProject(id))
    .filter((p): p is Project => p !== undefined);
}

export function duplicateProject(id: string, ownerId: number): Project | undefined {
  const original = getProject(id);
  if (!original || original.ownerId !== ownerId) return undefined;
  return createProject({
    ownerId,
    prompt: original.prompt,
    audience: original.audience,
    style: original.style,
    generatedFiles: original.generatedFiles ? [...original.generatedFiles] : undefined,
  });
}

// ── GenerationJob CRUD ────────────────────────────────────────────────────

export function createGenerationJob(data: {
  projectId: string;
  ownerId: number;
  inputPrompt: string;
}): GenerationJob {
  const id = generateId();
  const job: GenerationJob = {
    ...data,
    id,
    status: "queued",
    createdAt: now().toISOString(),
  };
  jobStore.write(`job:${id}`, job);
  return job;
}

export function getGenerationJob(id: string): GenerationJob | undefined {
  return jobStore.read(`job:${id}`);
}

export function updateGenerationJob(
  id: string,
  patch: Partial<GenerationJob>,
): GenerationJob | undefined {
  const existing = getGenerationJob(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...patch };
  jobStore.write(`job:${id}`, updated);
  return updated;
}

// ── BillingRecord CRUD ────────────────────────────────────────────────────

export function createBillingRecord(data: {
  userId: number;
  tier: SubscriptionTier;
  usageCounts: number;
}): BillingRecord {
  const id = generateId();
  const record: BillingRecord = {
    ...data,
    id,
    purchaseDate: now().toISOString(),
  };
  billingStore.write(`billing:${id}`, record);
  return record;
}

export function listBillingRecords(userId: number): BillingRecord[] {
  // Use index-based lookup — we need to scan for billing records by userId
  // Since we store by billing:<id>, we need an index
  const indexKey = `billing_index:${userId}`;
  const indexData = userStore.read(indexKey) as { ids: string[] } | undefined;
  if (!indexData) return [];
  return indexData.ids
    .map((id) => billingStore.read(`billing:${id}`))
    .filter((r): r is BillingRecord => r !== undefined);
}

export function addBillingRecord(record: BillingRecord): void {
  const indexKey = `billing_index:${record.userId}`;
  const existing = userStore.read(indexKey) as { ids: string[] } | undefined;
  const ids = existing?.ids ?? [];
  ids.push(record.id);
  userStore.write(indexKey as any, { ids } as any);
  billingStore.write(`billing:${record.id}`, record);
}

// ── Tier helpers ──────────────────────────────────────────────────────────

export function getTierLimits(tier: SubscriptionTier): { generationQuota: number } {
  switch (tier) {
    case "free":
      return { generationQuota: 3 };
    case "pro":
      return { generationQuota: 50 };
    case "enterprise":
      return { generationQuota: 500 };
  }
}
