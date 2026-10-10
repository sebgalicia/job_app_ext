export {};

type RuntimeMessage = { type?: string; tabId?: number };
type Sender = { tab?: { id?: number } };
type ExtensionBrowser = {
  runtime: { onMessage: { addListener(listener: (message: RuntimeMessage, sender: Sender) => unknown): void } };
};

const browserApi = (globalThis as typeof globalThis & { browser: ExtensionBrowser }).browser;
const matchCounts = new Map<number, number>();

browserApi.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'field-matched' && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    const count = (matchCounts.get(tabId) ?? 0) + 1;
    matchCounts.set(tabId, count);
    return { count };
  }
  if (message.type === 'get-match-count' && typeof message.tabId === 'number') {
    return { count: matchCounts.get(message.tabId) ?? 0 };
  }
  if (message.type === 'reset-match-count' && sender.tab?.id !== undefined) {
    matchCounts.delete(sender.tab.id);
  }
  return undefined;
});
