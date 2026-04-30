import { getDefaultLocalOllamaUrlFilter, isDefaultLocalOllamaUrl } from './localOllama.ts';

const LOCAL_OLLAMA_CORS_BYPASS_RULE_ID = 920001;
const EMPTY_RULE_SIGNATURE = '[]';

let configuredRuleSignature = '';
let sessionRuleUpdateQueue = Promise.resolve();

export const LOCAL_OLLAMA_CORS_BYPASS_RULE_IDS = [LOCAL_OLLAMA_CORS_BYPASS_RULE_ID];

export async function configureLocalOllamaCorsBypass(baseUrl: string): Promise<void> {
  const chromeApi = getChromeApi();
  const declarativeNetRequest = chromeApi?.declarativeNetRequest;

  if (!declarativeNetRequest?.updateSessionRules) {
    return;
  }

  const tabIdNone = chromeApi?.tabs?.TAB_ID_NONE ?? -1;
  const rules = buildLocalOllamaCorsBypassRules(baseUrl, tabIdNone);
  const signature = buildRuleSignature(rules);

  if (signature === configuredRuleSignature) {
    return;
  }

  sessionRuleUpdateQueue = sessionRuleUpdateQueue
    .catch(() => undefined)
    .then(async () => {
      if (signature === configuredRuleSignature) {
        return;
      }

      try {
        await declarativeNetRequest.updateSessionRules({
          removeRuleIds: LOCAL_OLLAMA_CORS_BYPASS_RULE_IDS,
          addRules: rules,
        });
        configuredRuleSignature = signature;
      } catch (error) {
        console.warn('[metatranslation] Failed to update local Ollama request rules.', error);
      }
    });

  await sessionRuleUpdateQueue;
}

export function buildLocalOllamaCorsBypassRules(
  baseUrl: string,
  tabIdNone = -1,
): chrome.declarativeNetRequest.Rule[] {
  const urlFilter = getDefaultLocalOllamaUrlFilter(baseUrl);
  if (!urlFilter) {
    return [];
  }

  return [
    {
      id: LOCAL_OLLAMA_CORS_BYPASS_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          {
            header: 'origin',
            operation: 'remove',
          },
        ],
      },
      condition: {
        urlFilter,
        tabIds: [tabIdNone],
        requestMethods: ['options', 'post'],
        resourceTypes: ['xmlhttprequest', 'other'],
      },
    },
  ];
}

export function isLocalOllamaBaseUrl(baseUrl: string): boolean {
  return isDefaultLocalOllamaUrl(baseUrl);
}

function buildRuleSignature(rules: chrome.declarativeNetRequest.Rule[]): string {
  if (rules.length === 0) {
    return EMPTY_RULE_SIGNATURE;
  }

  return JSON.stringify(
    rules.map((rule) => ({
      id: rule.id,
      urlFilter: rule.condition.urlFilter,
      tabIds: rule.condition.tabIds,
    })),
  );
}

function getChromeApi(): typeof chrome | undefined {
  return typeof chrome === 'undefined' ? undefined : chrome;
}
