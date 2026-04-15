import { EventEmitter } from 'node:events';
import { type CacheAdapter, WeakMapAdapter } from '../cache';
import { Plugin, Registry } from '../helpers/registry';
import {
  type LilyNode,
  LilyNodeState,
  type LilyNodeOptions as NodeOptions,
  type NodeStats,
} from '../models/node';
import type {
  PlayerLoop as Loop,
  LilyPlayer as Player,
  PlayerConfig,
} from '../models/player';
import { LoadType, Source } from '../models/rest';
import { LilyTrack, type LilyTrack as Track } from '../models/track';
import { version } from '../utils';
import type { LilyNodeManager as NodeManager } from './node-manager';
import type { LilyPlayerManager as PlayerManager } from './player-manager';

export enum TrackEndReason {
  QueueEnd = 'queueEnd',
  LoadFailed = 'loadFailed',
  Stopped = 'stopped',
  Replaced = 'replaced',
  Cleanup = 'cleanup',
  Finished = 'finished',
}

export interface VoicePacket {
  readonly t: 'VOICE_STATE_UPDATE' | 'VOICE_SERVER_UPDATE';
  readonly d: {
    readonly guild_id: string;
    readonly token?: string;
    readonly endpoint?: string;
    readonly session_id?: string;
    readonly channel_id?: string;
    readonly user_id?: string;
  };
}

export interface ManagerConfig {
  readonly nodes: readonly NodeOptions[];
  readonly options: ManagerOptions;
  readonly sendPayload: <T>(guildId: string, payload: T) => Promise<void>;
}

export interface ManagerOptions {
  readonly clientName?: string;
  readonly clientId?: string;
  readonly defaultPlatformSearch?: Source;
  readonly sortPlayersByRegion?: boolean;
  readonly plugins?: readonly Plugin[];
  readonly previousInArray?: boolean;
  readonly queueStartIndex?: number;
  readonly cache?: {
    adapter?: CacheAdapter;
    options?: {
      ttl?: number;
      revalidate?: boolean;
    };
  };
}

interface PlaylistInfo {
  readonly name: string;
  readonly selectedTrack: number;
  readonly duration: number;
}

export interface SearchResult {
  readonly loadType: LoadType;
  readonly tracks: Track[];
  readonly playlistInfo: PlaylistInfo;
  readonly data: {
    readonly playlistInfo: PlaylistInfo;
    readonly tracks: readonly Track[];
    readonly pluginInfo: Record<string, unknown>;
  };
  readonly exception?: {
    readonly message: string;
    readonly severity: string;
  };
}

export interface Events {
  readonly nodeRaw: <T>(node: NodeOptions, player: Player, payload: T) => void;
  readonly nodeCreate: (node: NodeOptions) => void;
  readonly nodeReady: (node: NodeOptions, stats: NodeStats) => void;
  readonly nodeConnected: (node: NodeOptions) => void;
  readonly nodeError: <T>(node: NodeOptions, error: T) => void;
  readonly nodeReconnect: (node: NodeOptions) => void;
  readonly nodeDisconnect: (
    node: NodeOptions,
    code: number,
    reason: string
  ) => void;
  readonly nodeDestroy: (identifier: string) => void;
  readonly playerCreate: (player: Player) => void;
  readonly playerUpdate: <T>(player: Player, track: Track, payload: T) => void;
  readonly playerDestroy: (player: Player) => void;
  readonly playerTriggeredPlay: (player: Player, track: Track) => void;
  readonly playerTriggeredPause: (player: Player) => void;
  readonly playerTriggeredResume: (player: Player) => void;
  readonly playerTriggeredStop: (player: Player) => void;
  readonly playerTriggeredSkip: (
    player: Player,
    oldTrack: Track,
    currentTrack: Track,
    position: number
  ) => void;
  readonly playerTriggeredSeek: (player: Player, position: number) => void;
  readonly playerTriggeredShuffle: (
    player: Player,
    oldQueue: readonly Track[],
    currentQueue: readonly Track[]
  ) => void;
  readonly playerChangedVolume: (
    player: Player,
    oldVolume: number,
    volume: number
  ) => void;
  readonly playerChangedLoop: (
    player: Player,
    oldLoop: Loop | keyof typeof Loop,
    loop: Loop | keyof typeof Loop
  ) => void;
  readonly playerAutoPlaySet: (player: Player, autoPlay: boolean) => void;
  readonly playerAutoLeaveSet: (player: Player, autoLeave: boolean) => void;
  readonly playerTextChannelSet: (
    player: Player,
    oldChannel: string,
    newChannel: string
  ) => void;
  readonly playerVoiceChannelSet: (
    player: Player,
    oldChannel: string,
    newChannel: string
  ) => void;
  readonly playerNodeSet: (
    player: Player,
    oldNode: string,
    newNode: string
  ) => void;
  readonly playerConnected: (player: Player) => void;
  readonly playerDisconnected: (player: Player) => void;
  readonly playerMoved: (
    player: Player,
    oldChannel: string,
    newChannel: string
  ) => void;
  readonly playerDestroyed: (player: Player) => void;
  readonly trackStart: (player: Player, track: Track) => void;
  readonly trackEnd: (
    player: Player,
    track: Track,
    type: TrackEndReason,
    payload?: unknown
  ) => void;
  readonly trackStuck: (
    player: Player,
    track: Track,
    threshold: number
  ) => void;
  readonly trackException: (
    player: Player,
    track: Track,
    exception: unknown
  ) => void;
  readonly socketClosed: (
    player: Player,
    code: number,
    reason: string,
    byRemote: boolean
  ) => void;
  readonly queueEnd: (player: Player) => void;
  readonly pluginLoaded: (pluginName: string) => void;
  readonly pluginUnloaded: (pluginName: string) => void;
  readonly pluginError: (pluginName: string, error: Error) => void;
}

interface CacheEventMap {
  readonly cacheInitialized: [];
  readonly cacheExpired: [key: string];
  readonly cacheSet: [key: string, value: unknown];
  readonly cacheDelete: [key: string];
  readonly cacheClear: [];
}

export class LilyManager extends EventEmitter {
  public readonly version = version;
  private initialized = false;
  public options: Readonly<ManagerOptions>;
  public readonly sendPayload: <T>(
    guildId: string,
    payload: T
  ) => Promise<void>;
  public readonly nodes: NodeManager;
  public readonly players: PlayerManager;
  public readonly cache: CacheAdapter;
  private readonly registry: Registry;

  constructor(config: Readonly<ManagerConfig>) {
    super();

    this.registry = Registry.getInstance();
    this.registry.setManager(this);

    this.sendPayload = config.sendPayload;
    this.options = Object.freeze({
      clientName: `LilyLink/${this.version} (Flowery, v${this.version.split('.')[0]}.${this.version.split('.')[1]})`,
      defaultPlatformSearch: Source.YOUTUBE,
      sortPlayersByRegion: false,
      ...config.options,
    });

    this.cache =
      this.options.cache?.adapter ??
      new WeakMapAdapter(this.options.cache?.options);
    this.bindCacheEvents();
    const NodeManagerClass = Registry.get('NodeManager');
    this.nodes = new NodeManagerClass(this, [...config.nodes]);

    const PlayerManagerClass = Registry.get('PlayerManager');
    this.players = new PlayerManagerClass(this);

    // Load plugins
    if (this.options.plugins?.length) {
      this.loadPlugins(this.options.plugins).catch((error) => {
        console.error('Failed to load plugins:', error);
      });
    }
  }

  private bindCacheEvents(): void {
    this.cache.on('cacheInitialized', () => {
      this.emit('cacheInitialized', []);
    });

    this.cache.on('cacheExpired', (key: string) => {
      this.emit('cacheExpired', [key]);
    });
    this.cache.on('cacheSet', (key: string, value: unknown) => {
      this.emit('cacheSet', [key, value]);
    });

    this.cache.on('cacheDelete', (key: string) => {
      this.emit('cacheDelete', [key]);
    });

    this.cache.on('cacheClear', () => {
      this.emit('cacheClear', []);
    });
  }

  public async init(clientId: string): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.options = Object.freeze({
      ...this.options,
      clientId,
    });

    await this.cache.init();
    this.nodes.init();
    this.initialized = true;
  }

  public async search({
    query,
    source = this.options.defaultPlatformSearch as Source,
    node,
    requester = null,
  }: {
    query: string;
    source?: Source;
    node?: string;
    requester?: unknown;
  }): Promise<SearchResult> {
    const availableNodes = [...this.nodes.cache.values()].filter(
      (n) => n.state === LilyNodeState.CONNECTED
    );
    if (!availableNodes.length) {
      throw new Error('No available nodes to search from.');
    }

    const selectedNode =
      node && this.nodes.cache.has(node)
        ? this.nodes.get(node)
        : this.nodes.best;

    const response = await selectedNode?.rest.loadTracks(source, query);

    if (
      response?.loadType === LoadType.Error ||
      response?.loadType === LoadType.Empty
    ) {
      return response as unknown as SearchResult;
    }

    if (response?.loadType && response?.loadType === LoadType.Track) {
      // @ts-expect-error: undefined error lol
      response.data.tracks = [response.data];
    }

    if (response?.loadType === LoadType.Search) {
      // @ts-expect-error: undefined error lol
      response.data.tracks = response.data;
    }
    if (response?.loadType && response.loadType === LoadType.Playlist) {
      const playlistTracks = response.data.tracks || [];
      const playlistDuration = playlistTracks.reduce(
        (acc, track) => acc + (track.info.length || 0),
        0
      );

      const playlistInfo: PlaylistInfo = {
        name: response.data.info.name,
        selectedTrack: response.data.info.selectedTrack || -1,
        duration: playlistDuration,
      };

      return {
        loadType: response.loadType,
        tracks: playlistTracks.map((track) => new LilyTrack(track, requester)),
        playlistInfo,
      } as SearchResult;
    }

    const tracks = response?.data?.tracks?.map(
      (track) => new LilyTrack(track, requester)
    );

    return Object.freeze({
      loadType: response?.loadType,
      tracks: Object.freeze(tracks ?? []),
      playlistInfo:
        response?.loadType === LoadType.Playlist
          ? {
              name: response.data.info.name,
              selectedTrack: response.data.info.selectedTrack || -1,
              duration:
                response.data.tracks?.reduce(
                  (acc, cur) => acc + (cur.info.length || 0),
                  0
                ) || 0,
            }
          : undefined,
    }) as SearchResult;
  }

  public async packetUpdate(packet: VoicePacket): Promise<void> {
    if (!['VOICE_STATE_UPDATE', 'VOICE_SERVER_UPDATE'].includes(packet.t)) {
      return;
    }

    const player = this.getPlayer(packet.d.guild_id);
    if (!player) {
      return;
    }

    player.voiceState ??= {};

    if (packet.t === 'VOICE_SERVER_UPDATE') {
      player.voiceState = {
        ...player.voiceState,
        token: packet.d.token,
        endpoint: packet.d.endpoint,
        channelId: packet.d.channel_id
      };
      if (packet.d.endpoint) {
        const match = packet.d.endpoint.match(
          /^([a-z-]+)[0-9]*\.discord\.media/i
        );
        if (match) {
          const region = match[1];
          player.region = region;
          if (
            this.options.sortPlayersByRegion &&
            !player.node.regions.includes(region)
          ) {
            const hasNode = [...this.nodes.cache.values()].some((node) =>
              node.regions.includes(region)
            );
            if (hasNode) {
              const newNode = [...this.nodes.cache.values()].find((node) =>
                node.regions.includes(region)
              );
              player.node = newNode as LilyNode;
            }
          }
        }
      }
      await this.attemptConnection(packet.d.guild_id);
    } else if (
      packet.t === 'VOICE_STATE_UPDATE' &&
      packet.d.user_id === this.options.clientId
    ) {
      if (!packet.d.channel_id) {
        player.connected = false;
        player.playing = false;
        player.voiceChannel = '';
        player.voiceState = {};

        this.emit('playerDisconnected', player);
        return;
      }

      if (packet.d.channel_id !== player.voiceChannel) {
        this.emit(
          'playerMoved',
          player,
          player.voiceChannel,
          packet.d.channel_id
        );
        player.voiceChannel = packet.d.channel_id;
      }

      player.voiceState = {
        ...player.voiceState,
        sessionId: packet.d.session_id,
        channelId: packet.d.channel_id
      };

      await this.attemptConnection(packet.d.guild_id);
    }
  }

  private async attemptConnection(guildId: string): Promise<boolean> {
    const player = this.getPlayer(guildId);
    if (!player) {
      return false;
    }

    const { token, sessionId, endpoint, channelId } = player.voiceState;
    if (!token || !sessionId || !endpoint || !channelId) {
      return false;
    }

    await player.node.rest.update({
      guildId,
      data: {
        voice: { sessionId, token, endpoint, channelId },
      },
    });

    return true;
  }

  public createPlayer(config: Readonly<PlayerConfig>): Player | undefined {
    return this.players.create(config);
  }

  public getPlayer(guildId: string): Player | undefined {
    return this.players.get(guildId);
  }

  // Type-safe event methods
  public on<T extends keyof (Events & CacheEventMap)>(
    event: T,
    listener: T extends keyof Events
      ? Events[T]
      : T extends keyof CacheEventMap
        ? (
            ...args: CacheEventMap[T] extends undefined
              ? []
              : [CacheEventMap[T]]
          ) => void
        : never
  ): this {
    return super.on(event, listener);
  }

  public emit<T extends keyof (Events & CacheEventMap)>(
    event: T,
    ...args: T extends keyof Events
      ? Parameters<Events[T]>
      : T extends keyof CacheEventMap
        ? CacheEventMap[T] extends undefined
          ? []
          : [CacheEventMap[T]]
        : never
  ): boolean {
    return super.emit(event, ...args);
  }

  public once<T extends keyof Events>(event: T, listener: Events[T]): this {
    return super.once(event, listener);
  }

  public off<T extends keyof Events>(event: T, listener: Events[T]): this {
    return super.off(event, listener);
  }

  private async loadPlugins(plugins: readonly Plugin[]): Promise<void> {
    for (const plugin of plugins) {
      if (plugin instanceof Plugin) {
        try {
          await this.registry.loadPlugin(plugin);
        } catch (error) {
          this.emit('pluginError', plugin.name, error as Error);
        }
      }
    }
  }

  public async unloadPlugin(pluginName: string): Promise<void> {
    await this.registry.unloadPlugin(pluginName);
  }

  public getLoadedPlugins(): string[] {
    return this.registry.getLoadedPlugins();
  }
}
