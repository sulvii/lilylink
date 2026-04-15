import { lilyRequest } from '../helpers/request';
import type { LilyNode } from './node';
import type { Track } from './track';

export enum Source {
  YOUTUBE = 'ytsearch',
  SOUNDCLOUD = 'scsearch',
  YOUTUBE_MUSIC = 'ytmsearch',
  SPOTIFY = 'spsearch',
  BANDCAMP = 'bcsearch',
  DEEZER = 'dzsearch',
  APPLE_MUSIC = 'amsearch',
  QOBUZ = 'qbsearch',
  DEEZER_ISRC = 'dzisrc',
  SPOTIFY_REC = 'sprec',
  QOBUZ_ISRC = 'qbisrc'
}

export enum LoadType {
  Track = 'track',
  Playlist = 'playlist',
  Search = 'search',
  Empty = 'empty',
  Error = 'error',
}

export interface ObjectTrack {
  encoded?: string;
  identifier?: string;
  userData?: unknown;
}

export interface VoiceState {
  token?: string;
  sessionId?: string;
  endpoint?: string;
  channelId?: string;
}

export interface RESTOptions {
  guildId: string;
  data: RESTData;
}

export interface RESTData {
  track?: ObjectTrack;
  identifier?: string;
  startTime?: number;
  endTime?: number;
  volume?: number;
  position?: number;
  paused?: boolean;
  filters?: object;
  voice?: VoiceState;
}
export interface RESTLoadTracks {
  loadType: LoadType;
  data: LoadResultData;
}

export interface LoadResultData {
  info: PlaylistInfo;
  tracks?: Track[];
  pluginInfo: object;
}

export interface PlaylistInfo {
  name: string;
  selectedTrack: number;
  duration: number;
}

export class LilyRestHandler {
  public node: LilyNode | null = null;
  public url: string | null = null;
  public defaultHeaders: Record<string, string> | null = null;

  private get cacheKey() {
    return `rest:${this.node?.identifier ?? this.node?.host}`;
  }

  private async makeRequest<T>(
    url: string,
    options: RequestInit = {},
    json = true,
    cache = true
  ) {
    const cacheKey = `${this.cacheKey}:${url}`;
    const manager = this.node?.manager;

    if (cache && options.method === 'GET' && manager?.cache) {
      const cached = await manager.cache.get<T>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const [res, error] = await lilyRequest<T, Error>(url, options, json);
    if (error) {
      throw error;
    }

    if (cache && options.method === 'GET' && manager?.cache) {
      await manager.cache.set(cacheKey, res);
    }

    return res;
  }

  constructor(node: LilyNode) {
    this.node = node;
    this.url = `${this.node.secure ? 'https' : 'http'}://${this.node.address}/v4`;
    this.defaultHeaders = {
      Authorization: this.node.password as string,
      Accept: 'application/json',
      'User-Agent': `LilyLink/${node.manager?.version} (Flowery, v${node.manager?.version.split('.')[0]}.${node.manager?.version.split('.')[1]})`,
      'Content-Type': 'application/json',
      'accept-encoding': 'br, gzip, deflate',
    };
  }

  public async loadTracks(source: Source, query: string) {
    const sources: Record<Source, string> = {
      [Source.YOUTUBE]: 'ytsearch',
      [Source.SOUNDCLOUD]: 'scsearch',
      [Source.YOUTUBE_MUSIC]: 'ytmsearch',
      [Source.SPOTIFY]: 'spsearch',
      [Source.BANDCAMP]: 'bcsearch',
      [Source.DEEZER]: 'dzsearch',
      [Source.APPLE_MUSIC]: 'amsearch',
      [Source.QOBUZ]: 'qbsearch',
      [Source.DEEZER_ISRC]: 'dzisrc',
      [Source.SPOTIFY_REC]: 'sprec',
      [Source.QOBUZ_ISRC]: 'qbisrc'
    };
    const searchIdentifier =
      query.startsWith('http://') || query.startsWith('https://')
        ? query
        : source
          ? sources[source]
            ? `${sources[source]}:${query}`
            : `${source}:${query}`
          : `ytsearch:${query}`;

    const params = new URLSearchParams({ identifier: searchIdentifier });

    const cacheKey = `${this.cacheKey}:loadTracks:${searchIdentifier}`;
    const manager = this.node?.manager;

    if (manager?.cache) {
      return manager.cache.revalidate<RESTLoadTracks | undefined>(
        cacheKey,
        async () => {
          return this.makeRequest<RESTLoadTracks>(
            `${this.url}/loadtracks?${params}`,
            { headers: this.defaultHeaders as HeadersInit },
            true,
            false // Don't cache in makeRequest since we're using revalidate
          );
        }
      );
    }

    return this.makeRequest<RESTLoadTracks>(
      `${this.url}/loadtracks?${params.toString()}`,
      { headers: this.defaultHeaders as HeadersInit }
    );
  }

  public async update<T>(data: RESTOptions) {
    const res = await this.makeRequest<T>(
      `${this.url}/sessions/${this.node?.sessionId}/players/${data.guildId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data.data),
        headers: this.defaultHeaders as HeadersInit,
      },
      true,
      false // Don't cache mutations
    );

    // Invalidate related caches
    if (this.node?.manager?.cache) {
      const playerCacheKey = `${this.cacheKey}:player:${data.guildId}`;
      await this.node.manager.cache.delete(playerCacheKey);
    }

    return res;
  }

  public async destroy<T>(guildId: string) {
    const res = await this.makeRequest<T>(
      `${this.url}/sessions/${this.node?.sessionId}/players/${guildId}`,
      {
        method: 'DELETE',
        headers: this.defaultHeaders as HeadersInit,
      },
      false
    );

    // Invalidate related caches
    if (this.node?.manager?.cache) {
      const playerCacheKey = `${this.cacheKey}:player:${guildId}`;
      await this.node.manager.cache.delete(playerCacheKey);
    }

    return res;
  }

  public getInfo<T>() {
    return this.makeRequest<T>(`${this.url}/info`, {
      method: 'GET',
      headers: this.defaultHeaders as HeadersInit,
    });
  }

  public getStats<T>(): Promise<unknown> {
    return this.makeRequest<T>(`${this.url}/stats`, {
      method: 'GET',
      headers: this.defaultHeaders as HeadersInit,
    });
  }

  public getVersion<T>(): Promise<unknown> {
    const cacheKey = `${this.cacheKey}:version`;
    const manager = this.node?.manager;

    if (manager?.cache) {
      return manager.cache.revalidate<T | undefined>(cacheKey, () => {
        return this.makeRequest<T>(
          `${this.node?.secure ? 'https' : 'http'}://${this.node?.address}/version`,
          {
            method: 'GET',
            headers: this.defaultHeaders as HeadersInit,
          },
          true,
          false
        );
      });
    }

    return this.makeRequest<T>(
      `${this.node?.secure ? 'https' : 'http'}://${this.node?.address}/version`,
      {
        method: 'GET',
        headers: this.defaultHeaders as HeadersInit,
      }
    );
  }

  public async decodeTrack<T>(encodedTrack: string) {
    const cacheKey = `${this.cacheKey}:decode:${encodedTrack}`;
    const manager = this.node?.manager;

    if (manager?.cache) {
      return manager.cache.revalidate<T | undefined>(cacheKey, () => {
        return this.makeRequest<T>(
          `${this.url}/decodetrack?encodedTrack=${encodeURIComponent(encodedTrack)}`,
          {
            method: 'GET',
            headers: this.defaultHeaders as HeadersInit,
          },
          true,
          false
        );
      });
    }

    return this.makeRequest<T>(
      `${this.url}/decodetrack?encodedTrack=${encodeURIComponent(encodedTrack)}`,
      {
        method: 'GET',
        headers: this.defaultHeaders as HeadersInit,
      }
    );
  }

  public async decodeTracks<T>(encodedTracks: string[]) {
    return this.makeRequest<T>(
      `${this.url}/decodetracks`,
      {
        method: 'POST',
        body: JSON.stringify(encodedTracks),
        headers: this.defaultHeaders as HeadersInit,
      },
      true,
      false // Don't cache POST requests
    );
  }

  public async getPlayers<T>(sessionId: string) {
    const cacheKey = `${this.cacheKey}:players:${sessionId}`;
    const manager = this.node?.manager;

    if (manager?.cache) {
      return manager.cache.revalidate<T | undefined>(cacheKey, () => {
        return this.makeRequest<T>(
          `${this.url}/sessions/${sessionId}/players`,
          {
            method: 'GET',
            headers: this.defaultHeaders as HeadersInit,
          },
          true,
          false
        );
      });
    }

    return this.makeRequest<T>(`${this.url}/sessions/${sessionId}/players`, {
      method: 'GET',
      headers: this.defaultHeaders as HeadersInit,
    });
  }

  public async getPlayer<T>(sessionId: string, guildId: string) {
    const cacheKey = `${this.cacheKey}:player:${guildId}`;
    const manager = this.node?.manager;

    if (manager?.cache) {
      return manager.cache.revalidate<T | undefined>(cacheKey, () => {
        return this.makeRequest<T>(
          `${this.url}/sessions/${sessionId}/players/${guildId}`,
          {
            method: 'GET',
            headers: this.defaultHeaders as HeadersInit,
          },
          true,
          false
        );
      });
    }

    return this.makeRequest<T>(
      `${this.url}/sessions/${sessionId}/players/${guildId}`,
      {
        method: 'GET',
        headers: this.defaultHeaders as HeadersInit,
      }
    );
  }

  public async getRoutePlannerStatus<T>() {
    const cacheKey = `${this.cacheKey}:routeplanner:status`;
    const manager = this.node?.manager;

    if (manager?.cache) {
      return manager.cache.revalidate<T | undefined>(cacheKey, () => {
        return this.makeRequest<T>(
          `${this.url}/routeplanner/status`,
          {
            method: 'GET',
            headers: this.defaultHeaders as HeadersInit,
          },
          true,
          false
        );
      });
    }

    return this.makeRequest<T>(`${this.url}/routeplanner/status`, {
      method: 'GET',
      headers: this.defaultHeaders as HeadersInit,
    });
  }

  public async unmarkFailedAddress<T>(address: string) {
    return this.makeRequest<T>(
      `${this.url}/routeplanner/free/address`,
      {
        method: 'POST',
        body: JSON.stringify({ address }),
        headers: this.defaultHeaders as HeadersInit,
      },
      true,
      false // Don't cache POST requests
    );
  }

  public async unmarkAllFailedAddresses<T>() {
    return this.makeRequest<T>(
      `${this.url}/routeplanner/free/all`,
      {
        method: 'POST',
        headers: this.defaultHeaders as HeadersInit,
      },
      true,
      false // Don't cache POST requests
    );
  }
}
