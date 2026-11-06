import {
  MEDIA_PATH,
  SOCIAL_ACCOUNTS_PATH,
  SOCIAL_ANALYTICS_PATH,
  SOCIAL_MEDIA_PATH,
  SOCIAL_OVERVIEW_PATH,
  SOCIAL_POSTS_PATH,
  SOCIAL_SETTINGS_PATH,
  mediaFileSchema,
  pinterestBoardsSchema,
  socialAccountsResponseSchema,
  socialAnalyticsSchema,
  socialLibrarySchema,
  socialMediaPath,
  socialOverviewSchema,
  socialPinterestBoardsPath,
  socialPostPath,
  socialPostReschedulePath,
  socialPostResultSchema,
  socialPostRetryPath,
  socialPostSchema,
  socialPostsResponseSchema,
  socialPostUnpublishPath,
  socialSettingsSchema,
  type MediaFile,
  type PinterestBoards,
  type SocialAccountsResponse,
  type SocialAnalytics,
  type SocialLibrary,
  type SocialOverview,
  type SocialPost,
  type SocialPostInput,
  type SocialPostResult,
  type SocialPostsQuery,
  type SocialPostsResponse,
  type SocialSettings,
} from '@disparazap/contracts';
import { request, type ApiResult } from '../platform/platform-api';

/** Redes Sociais (publicar, agendar e acompanhar pela Zernio da empresa). A chave fica só no servidor. Os testes trocam. */
export interface SocialApi {
  overview(signal?: AbortSignal): Promise<ApiResult<SocialOverview>>;
  accounts(signal?: AbortSignal): Promise<ApiResult<SocialAccountsResponse>>;
  posts(query: SocialPostsQuery, signal?: AbortSignal): Promise<ApiResult<SocialPostsResponse>>;
  getPost(id: string, signal?: AbortSignal): Promise<ApiResult<SocialPost>>;
  create(input: SocialPostInput): Promise<ApiResult<SocialPostResult>>;
  update(id: string, input: SocialPostInput): Promise<ApiResult<SocialPostResult>>;
  reschedule(id: string, scheduledAt: string): Promise<ApiResult<SocialPostResult>>;
  remove(id: string): Promise<ApiResult<null>>;
  retry(id: string): Promise<ApiResult<SocialPostResult>>;
  unpublish(id: string, platform: string, accountId: string): Promise<ApiResult<SocialPostResult>>;
  settings(signal?: AbortSignal): Promise<ApiResult<SocialSettings>>;
  saveSettings(timezone: string): Promise<ApiResult<SocialSettings>>;
  analytics(days: number, signal?: AbortSignal): Promise<ApiResult<SocialAnalytics>>;
  library(signal?: AbortSignal): Promise<ApiResult<SocialLibrary>>;
  uploadMedia(file: File): Promise<ApiResult<MediaFile>>;
  deleteMedia(id: string): Promise<ApiResult<null>>;
  pinterestBoards(accountId: string, signal?: AbortSignal): Promise<ApiResult<PinterestBoards>>;
}

const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {});

function queryString(query: SocialPostsQuery): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== '') params.set(name, String(value));
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const httpSocialApi: SocialApi = {
  overview: (signal) => request(SOCIAL_OVERVIEW_PATH, { method: 'GET', ...withSignal(signal) }, (body) => socialOverviewSchema.parse(body)),
  accounts: (signal) => request(SOCIAL_ACCOUNTS_PATH, { method: 'GET', ...withSignal(signal) }, (body) => socialAccountsResponseSchema.parse(body)),
  posts: (query, signal) => request(`${SOCIAL_POSTS_PATH}${queryString(query)}`, { method: 'GET', ...withSignal(signal) }, (body) => socialPostsResponseSchema.parse(body)),
  getPost: (id, signal) => request(socialPostPath(id), { method: 'GET', ...withSignal(signal) }, (body) => socialPostSchema.parse(body)),
  create: (input) => request(SOCIAL_POSTS_PATH, { method: 'POST', body: JSON.stringify(input) }, (body) => socialPostResultSchema.parse(body)),
  update: (id, input) => request(socialPostPath(id), { method: 'PUT', body: JSON.stringify(input) }, (body) => socialPostResultSchema.parse(body)),
  reschedule: (id, scheduledAt) => request(socialPostReschedulePath(id), { method: 'POST', body: JSON.stringify({ scheduledAt }) }, (body) => socialPostResultSchema.parse(body)),
  remove: (id) => request(socialPostPath(id), { method: 'DELETE' }, () => null),
  retry: (id) => request(socialPostRetryPath(id), { method: 'POST', body: '{}' }, (body) => socialPostResultSchema.parse(body)),
  unpublish: (id, platform, accountId) => request(socialPostUnpublishPath(id), { method: 'POST', body: JSON.stringify({ platform, accountId }) }, (body) => socialPostResultSchema.parse(body)),
  settings: (signal) => request(SOCIAL_SETTINGS_PATH, { method: 'GET', ...withSignal(signal) }, (body) => socialSettingsSchema.parse(body)),
  saveSettings: (timezone) => request(SOCIAL_SETTINGS_PATH, { method: 'PUT', body: JSON.stringify({ timezone }) }, (body) => socialSettingsSchema.parse(body)),
  analytics: (days, signal) => request(`${SOCIAL_ANALYTICS_PATH}?days=${days}`, { method: 'GET', ...withSignal(signal) }, (body) => socialAnalyticsSchema.parse(body)),
  library: (signal) => request(SOCIAL_MEDIA_PATH, { method: 'GET', ...withSignal(signal) }, (body) => socialLibrarySchema.parse(body)),
  // Mesmo envio das imagens do Envio de Mensagens, com o nome do arquivo para a busca da biblioteca
  uploadMedia: (file) => request(`${MEDIA_PATH}?name=${encodeURIComponent(file.name.slice(0, 120))}`, { method: 'POST', body: file }, (body) => mediaFileSchema.parse(body), file.type),
  deleteMedia: (id) => request(socialMediaPath(id), { method: 'DELETE' }, () => null),
  pinterestBoards: (accountId, signal) => request(socialPinterestBoardsPath(accountId), { method: 'GET', ...withSignal(signal) }, (body) => pinterestBoardsSchema.parse(body)),
};
