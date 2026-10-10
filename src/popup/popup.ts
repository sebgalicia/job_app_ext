export {};

type JobContext = { company?: string; role?: string };
type Tab = { id?: number; url?: string; title?: string };
type PopupBrowser = {
  tabs: {
    query(query: { active: boolean; currentWindow: boolean }): Promise<Tab[]>;
    sendMessage(tabId: number, message: Record<string, unknown>): Promise<unknown>;
  };
  storage: { local: {
    get(keys: string[]): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
  } };
  runtime: { sendMessage(message: Record<string, unknown>): Promise<{ count?: number }> };
  permissions: { request(permissions: { permissions: string[] }): Promise<boolean> };
  scripting: {
    executeScript(details: { target: { tabId: number; allFrames: boolean }; files: string[] }): Promise<unknown>;
    insertCSS(details: { target: { tabId: number; allFrames: boolean }; files: string[] }): Promise<unknown>;
  };
};

const browserApi = (globalThis as typeof globalThis & { browser: PopupBrowser }).browser;
const siteName = document.querySelector<HTMLParagraphElement>('#site-name')!;
const enabledInput = document.querySelector<HTMLInputElement>('#site-enabled')!;
const companyInput = document.querySelector<HTMLInputElement>('#company')!;
const roleInput = document.querySelector<HTMLInputElement>('#role')!;
const saveContextButton = document.querySelector<HTMLButtonElement>('#save-context')!;
const matchCount = document.querySelector<HTMLParagraphElement>('#match-count')!;
const enableCurrentPage = document.querySelector<HTMLButtonElement>('#enable-current-page')!;
const status = document.querySelector<HTMLParagraphElement>('#popup-status')!;

function isSupportedHost(hostname: string): boolean {
  return hostname.endsWith('.myworkdayjobs.com') || hostname === 'myworkdayjobs.com'
    || hostname.endsWith('.myworkday.com') || hostname === 'myworkday.com'
    || hostname === 'boards.greenhouse.io' || hostname === 'job-boards.greenhouse.io'
    || hostname === 'jobs.lever.co' || hostname === 'jobs.ashbyhq.com';
}

function companyFromUrl(url: URL): string | undefined {
  let slug: string | undefined;
  if (url.hostname.endsWith('.myworkdayjobs.com')) slug = url.hostname.split('.')[0];
  else if (url.hostname === 'boards.greenhouse.io' || url.hostname === 'job-boards.greenhouse.io') slug = url.pathname.split('/').filter(Boolean)[0];
  else if (['jobs.lever.co', 'jobs.ashbyhq.com'].includes(url.hostname)) slug = url.pathname.split('/').filter(Boolean)[0];
  if (!slug) return undefined;
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

function contextFromTitle(title: string, url: URL): JobContext {
  const atMatch = title.match(/^(.+?)\s+(?:at|@)\s+([^|–—-]+)(?:\s*[|–—-].*)?$/i);
  const pieces = title.split(/[|–—]/).map((part) => part.trim()).filter(Boolean);
  const titleRole = atMatch?.[1]?.trim();
  const genericRole = Boolean(titleRole && /^(careers?|jobs?|open positions|job openings)$/i.test(titleRole));
  return {
    role: (!genericRole && titleRole) || pieces.find((part) => !/^(careers?|jobs?)(?:\s+at\s+.*)?$/i.test(part)) || undefined,
    company: atMatch?.[2]?.trim() || companyFromUrl(url),
  };
}

function mergeContext(...contexts: Array<JobContext | undefined>): JobContext {
  const result: JobContext = {};
  for (const context of contexts) {
    if (context?.company?.trim()) result.company = context.company.trim();
    if (context?.role?.trim()) result.role = context.role.trim();
  }
  return result;
}

function showStatus(message: string, error = false): void {
  status.textContent = message;
  status.className = error ? 'error' : 'success';
}

let activeTab: Tab;
let hostname: string;
let pageUrl: URL | undefined;
let contextStorageKey: string;
let siteEnabled: Record<string, boolean>;
let contextOverrides: Record<string, JobContext>;
let contentScriptAvailable = false;

async function persistSiteEnabled(enabled: boolean): Promise<void> {
  siteEnabled[hostname] = enabled;
  await browserApi.storage.local.set({ siteEnabled });
  if (activeTab.id !== undefined) {
    try { await browserApi.tabs.sendMessage(activeTab.id, { type: 'site-state', enabled }); } catch { /* no content script is active here */ }
  }
}

enabledInput.addEventListener('change', () => {
  void persistSiteEnabled(enabledInput.checked).then(() => showStatus(enabledInput.checked ? 'Enabled on this site.' : 'Disabled on this site.'));
});

saveContextButton.addEventListener('click', async () => {
  contextOverrides[contextStorageKey] = { company: companyInput.value.trim() || undefined, role: roleInput.value.trim() || undefined };
  await browserApi.storage.local.set({ jobContextOverrides: contextOverrides });
  if (activeTab.id !== undefined) {
    try { await browserApi.tabs.sendMessage(activeTab.id, { type: 'refresh-focused-preview' }); } catch { /* no content script is active here */ }
  }
  showStatus('Company and role saved for this site.');
});

enableCurrentPage.addEventListener('click', async () => {
  if (activeTab.id === undefined) return;
  try {
    const allowed = await browserApi.permissions.request({ permissions: ['scripting'] });
    if (!allowed) {
      showStatus('Page access was not granted, so previews were not enabled.', true);
      return;
    }
    const target = { tabId: activeTab.id, allFrames: true };
    await browserApi.scripting.executeScript({ target, files: ['content.js'] });
    await browserApi.scripting.insertCSS({ target, files: ['content.css'] });
    await persistSiteEnabled(true);
    contentScriptAvailable = true;
    enabledInput.checked = true;
    enabledInput.disabled = false;
    enableCurrentPage.hidden = true;
    showStatus('Previews enabled for this tab.');
  } catch {
    showStatus('Could not enable previews on this page.', true);
  }
});

async function initialize(): Promise<void> {
  const [tab] = await browserApi.tabs.query({ active: true, currentWindow: true });
  activeTab = tab ?? {};
  try { pageUrl = new URL(activeTab.url ?? ''); } catch { /* browser internal page */ }
  hostname = pageUrl?.hostname || 'current-page';
  contextStorageKey = `${hostname}${pageUrl?.pathname ?? ''}`;
  siteName.textContent = pageUrl ? (hostname || 'Browser internal page') : 'This browser page cannot be accessed';
  const stored = await browserApi.storage.local.get(['siteEnabled', 'jobContextOverrides', 'detectedPageContexts']);
  siteEnabled = (stored.siteEnabled as Record<string, boolean> | undefined) ?? {};
  contextOverrides = (stored.jobContextOverrides as Record<string, JobContext> | undefined) ?? {};
  const detectedContexts = (stored.detectedPageContexts as Record<string, JobContext> | undefined) ?? {};
  const inferred = pageUrl ? contextFromTitle(activeTab.title ?? '', pageUrl) : {};
  const context = mergeContext(inferred, detectedContexts[contextStorageKey], contextOverrides[contextStorageKey]);
  companyInput.value = context.company ?? '';
  roleInput.value = context.role ?? '';
  enabledInput.checked = siteEnabled[hostname] !== false;
  const supported = Boolean(pageUrl && isSupportedHost(hostname));
  if (!supported && activeTab.id !== undefined) {
    try {
      const reply = await browserApi.tabs.sendMessage(activeTab.id, { type: 'content-ping' }) as { ready?: boolean };
      contentScriptAvailable = reply?.ready === true;
    } catch { contentScriptAvailable = false; }
  }
  enableCurrentPage.hidden = !pageUrl || supported || contentScriptAvailable;
  enabledInput.disabled = !pageUrl || (!supported && !contentScriptAvailable);

  if (activeTab.id !== undefined) {
    const result = await browserApi.runtime.sendMessage({ type: 'get-match-count', tabId: activeTab.id });
    matchCount.textContent = `Matched fields on this page: ${result?.count ?? 0}`;
  }
}

void initialize().catch(() => showStatus('Could not read this page’s extension settings.', true));
