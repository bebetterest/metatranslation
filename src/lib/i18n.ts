export function getUiMessage(key: string, substitutions?: string | string[]): string {
  try {
    const message = chrome.i18n.getMessage(key, substitutions);
    return message || key;
  } catch {
    return key;
  }
}

export function getUiLocale(): 'en' | 'zh-CN' {
  const language = getUiLanguage().toLowerCase();
  return language.startsWith('zh') ? 'zh-CN' : 'en';
}

function getUiLanguage(): string {
  try {
    return chrome.i18n.getUILanguage() || getNavigatorLanguage();
  } catch {
    return getNavigatorLanguage();
  }
}

function getNavigatorLanguage(): string {
  return typeof navigator === 'undefined' ? 'en' : navigator.language || 'en';
}
