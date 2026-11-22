export interface ReadOptions {
  /** Public routing hint. The gateway authorizes this space on every read. */
  space?: string
  signal?: AbortSignal
  /** Current caller's preprovisioned Memory credential, never a cell key. */
  token?: string
}
export interface GetQuery { ids?: string[]; paths?: string[] }
export type StringFilter = string | string[]
export interface ListQuery {
  kind?: StringFilter
  type?: StringFilter
  status?: StringFilter
  path_prefix?: string
  limit?: number
  cursor?: string
  full?: boolean
  created_after?: string
  created_before?: string
  updated_after?: string
  updated_before?: string
  author_agent?: StringFilter
  task?: StringFilter
  stated_by?: StringFilter
  source_session?: StringFilter
  contains?: string
}
/** Existing public records DTO. Additional gateway fields pass through. */
export interface RecordDTO {
  id: string
  kind: string
  type: string
  body: string
  [key: string]: unknown
}
export interface GetResult { records: RecordDTO[]; missing: string[] }
export interface ListResult { records: RecordDTO[]; cursor: string | null; filters: string[] }
export interface MemoryReads {
  readonly records: {
    get(query: GetQuery, options?: ReadOptions): Promise<GetResult>
    list(query?: ListQuery, options?: ReadOptions): Promise<ListResult>
  }
  /** Public /v1/context verification at the same configured gateway. */
  gatewayAuthorize(options: ReadOptions): Promise<Readonly<{ principal: string }>>
}
export function createMemoryReads(config: {
  origin: string
  credential?: () => string | Promise<string>
  fetchImpl?: typeof fetch
  /** 1–10000 ms. No automatic read retries in this experimental profile. */
  deadlineMs?: number
}): MemoryReads
export class ReadError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, status?: number)
  toJSON(): { code: string; status: number; message: string }
}
export const readRegistry: readonly {
  readonly name: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
}[]
export function trustedOrigin(origin: string): string
export function credentialToken(token: unknown): string
