import type {
  ExtensionSettings,
  DictionaryLookupRequest,
  DictionaryLookupResult,
  RecordHitPayload,
  RecordsQuery,
  RecordsQueryResult,
  TranslationRequest,
  TranslationResponse,
} from './types';

export type RuntimePingMessage = { type: 'runtime:ping' };
export type RuntimeToggleMessage = { type: 'runtime:toggle' };
export type RuntimeReadyMessage = { type: 'runtime:ready'; href: string };
export type SettingsGetMessage = { type: 'settings:get' };
export type SettingsSaveMessage = {
  type: 'settings:save';
  payload: ExtensionSettings;
};
export type TranslateBlocksMessage = {
  type: 'translation:translate-blocks';
  payload: TranslationRequest;
};
export type RecordHitMessage = {
  type: 'record:hover-hit';
  payload: RecordHitPayload;
};
export type RecordsQueryMessage = {
  type: 'records:query';
  payload: RecordsQuery;
};
export type DictionaryLookupMessage = {
  type: 'dictionary:lookup';
  payload: DictionaryLookupRequest;
};
export type TabToggleMessage = {
  type: 'tab:toggle';
  tabId: number;
};

export type RuntimeInboundMessage = RuntimePingMessage | RuntimeToggleMessage;

export type BackgroundMessage =
  | RuntimeReadyMessage
  | SettingsGetMessage
  | SettingsSaveMessage
  | TranslateBlocksMessage
  | RecordHitMessage
  | RecordsQueryMessage
  | DictionaryLookupMessage
  | TabToggleMessage;

export interface RuntimeStatusResponse {
  ok: true;
  enabled: boolean;
}

export interface SettingsGetResponse {
  settings: ExtensionSettings;
}

export interface SettingsSaveResponse {
  settings: ExtensionSettings;
}

export interface RecordsQueryResponse extends RecordsQueryResult {}

export interface DictionaryLookupResponse extends DictionaryLookupResult {}

export interface ErrorResponse {
  error: string;
}

export type BackgroundResponse =
  | RuntimeStatusResponse
  | SettingsGetResponse
  | SettingsSaveResponse
  | TranslationResponse
  | RecordsQueryResponse
  | DictionaryLookupResponse
  | { ok: true }
  | ErrorResponse;
