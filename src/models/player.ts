import { z } from 'zod';
import { validate } from '../helpers/validate';
import type { LilyManager } from '../services/base-manager';
import { LilyFilters } from './filters';
import type { LilyNode } from './node';
import { LilyQueue } from './queue';
import type { VoiceState } from './rest';
import type { LilyTrack } from './track';

export enum PlayerLoop {
  OFF = 0,
  TRACK = 1,
  QUEUE = 2,
}

export interface PlayerConfig {
  guildId: string;
  voiceChannel: string;
  textChannel: string;
  volume?: number;
  loop?: PlayerLoop;
  autoPlay?: boolean;
  autoLeave?: boolean;
  node?: string;
  region: string;
}

export enum PlayerState {
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  BUFFERING = 'BUFFERING',
  NONE = 'NONE',
}

export class LilyPlayer {
  readonly manager!: LilyManager;
  public guildId!: string;
  public voiceChannel!: string;
  public textChannel!: string;
  public voiceState: VoiceState = {};
  public autoPlay!: boolean;
  public autoLeave!: boolean;
  public connected!: boolean;
  public playing!: boolean;
  public paused!: boolean;
  public volume = 80;
  public loop: PlayerLoop | keyof typeof PlayerLoop = PlayerLoop.OFF;
  public current: LilyTrack | null = null;
  public previous: LilyTrack | LilyTrack[] | null = null;
  public ping = 0;
  public queue!: LilyQueue;
  public node!: LilyNode;
  public data: Record<string, unknown> = {};
  public filters: LilyFilters;
  public region: string;
  private get cacheKey() {
    return `player:${this.guildId}`;
  }

  constructor(manager: LilyManager, config: PlayerConfig) {
    this.manager = manager;
    this.guildId = config.guildId;
    this.voiceChannel = config.voiceChannel;
    this.textChannel = config.textChannel;
    this.connected = false;
    this.playing = false;
    this.paused = false;
    this.previous = manager.options.previousInArray
      ? ([] as LilyTrack[])
      : null;
    this.volume = config.volume || 100;
    this.loop = config.loop || PlayerLoop.OFF;
    this.autoPlay = config.autoPlay || false;
    this.autoLeave = config.autoLeave || false;
    this.queue = new LilyQueue(manager.options.queueStartIndex ?? 0);
    this.node = this.manager.nodes.get(config.node as string) as LilyNode;
    this.filters = new LilyFilters(this);
    this.region = config.region;
    this.cacheState();
  }

  private async cacheState(): Promise<void> {
    if (!this.manager.cache) {
      return;
    }

    const state = {
      guildId: this.guildId,
      voiceChannel: this.voiceChannel,
      textChannel: this.textChannel,
      voiceState: this.voiceState,
      autoPlay: this.autoPlay,
      autoLeave: this.autoLeave,
      connected: this.connected,
      playing: this.playing,
      paused: this.paused,
      volume: this.volume,
      loop: this.loop,
      current: this.current,
      previous: this.previous,
      ping: this.ping,
      queue: Array.from(this.queue.values()),
      nodeId: this.node.identifier ?? this.node.host,
      data: this.data,
    };

    await this.manager.cache.set(`${this.cacheKey}:state`, state);
  }

  private async invalidateCache(): Promise<void> {
    if (!this.manager.cache) {
      return;
    }
    await this.manager.cache.delete(`${this.cacheKey}:state`);
  }

  public async restoreState(): Promise<boolean> {
    if (!this.manager.cache) {
      return false;
    }

    const state = await this.manager.cache.get<{
      guildId: string;
      voiceChannel: string;
      textChannel: string;
      voiceState: VoiceState;
      autoPlay: boolean;
      autoLeave: boolean;
      connected: boolean;
      playing: boolean;
      paused: boolean;
      volume: number;
      loop: PlayerLoop | keyof typeof PlayerLoop;
      current: LilyTrack | null;
      previous: LilyTrack | LilyTrack[] | null;
      ping: number;
      queue: LilyTrack[];
      nodeId: string;
      data: Record<string, unknown>;
    }>(`${this.cacheKey}:state`);

    if (!state) {
      return false;
    }

    this.voiceChannel = state.voiceChannel;
    this.textChannel = state.textChannel;
    this.voiceState = state.voiceState;
    this.autoPlay = state.autoPlay;
    this.autoLeave = state.autoLeave;
    this.connected = state.connected;
    this.playing = state.playing;
    this.paused = state.paused;
    this.volume = state.volume;
    this.loop = state.loop;
    this.current = state.current;
    this.previous = state.previous;
    this.ping = state.ping;
    this.data = state.data;

    this.queue.clear();
    for (const track of state.queue) {
      this.queue.add(track);
    }

    if (
      this.node.identifier !== state.nodeId &&
      this.node.host !== state.nodeId
    ) {
      const newNode = this.manager.nodes.get(state.nodeId);
      if (newNode) {
        this.node = newNode;
      }
    }

    return true;
  }

  public set(key: string, data: unknown): void {
    this.data[key] = data;
    this.cacheState();
  }

  public get<T>(key: string): T {
    return this.data[key] as T;
  }

  public setVoiceChannel(voiceChannelId: string): boolean {
    validate(
      voiceChannelId,
      z.string(),
      'voiceChannelId is invalid',
      TypeError
    );
    const oldVoiceChannelId = String(this.voiceChannel);

    this.voiceChannel = voiceChannelId;
    this.manager.emit(
      'playerVoiceChannelSet',
      this,
      oldVoiceChannelId,
      voiceChannelId
    );
    this.cacheState();
    return true;
  }

  public setTextChannel(textChannelId: string): boolean {
    validate(textChannelId, z.string(), 'textChannelId is invalid', TypeError);
    const oldTextChannelId = String(this.textChannel);
    this.textChannel = textChannelId;
    this.manager.emit(
      'playerTextChannelSet',
      this,
      oldTextChannelId,
      textChannelId
    );
    this.cacheState();
    return true;
  }

  public setAutoPlay(autoPlay: boolean): boolean {
    validate(autoPlay, z.boolean(), 'autoPlay is invalid');

    this.autoPlay = autoPlay;
    this.manager.emit('playerAutoPlaySet', this, autoPlay);
    this.cacheState();
    return true;
  }

  public setAutoLeave(autoLeave: boolean): boolean {
    validate(autoLeave, z.boolean(), 'invalid autoLeave');

    this.autoLeave = autoLeave;
    this.manager.emit('playerAutoLeaveSet', this, autoLeave);
    this.cacheState();
    return true;
  }

  public connect(options: { setMute?: boolean; setDeaf?: boolean }): boolean {
    this.manager.sendPayload(
      this.guildId,
      JSON.stringify({
        op: 4,
        d: {
          guild_id: this.guildId,
          channel_id: this.voiceChannel,
          channelId: this.voiceChannel,
          self_mute: options?.setMute || false,
          self_deaf: options?.setDeaf || false,
        },
      })
    );

    this.connected = true;
    this.manager.emit('playerConnected', this);
    this.cacheState();
    return true;
  }

  public disconnect(): boolean {
    this.manager.sendPayload(
      this.guildId,
      JSON.stringify({
        op: 4,
        d: {
          guild_id: this.guildId,
          channel_id: null,
          channelId: null,
          self_mute: false,
          self_deaf: false,
        },
      })
    );

    this.connected = false;
    this.manager.emit('playerDisconnected', this);
    this.cacheState();
    return true;
  }

  public play(): boolean {
    if (!this.queue.size) {
      return false;
    }

    this.current = this.queue.shift();

    this.node.rest.update({
      guildId: this.guildId,
      data: {
        track: {
          encoded: this.current.encoded,
        },
        volume: this.volume,
      },
    });

    this.playing = true;
    this.manager.emit('playerTriggeredPlay', this, this.current);
    this.cacheState();
    return true;
  }

  public pause(): boolean {
    if (this.paused) {
      return true;
    }

    this.node.rest.update({
      guildId: this.guildId,
      data: {
        paused: true,
      },
    });

    this.paused = true;
    this.manager.emit('playerTriggeredPause', this);
    this.cacheState();
    return true;
  }

  public resume(): boolean {
    if (!this.paused) {
      return true;
    }

    this.node.rest.update({
      guildId: this.guildId,
      data: {
        paused: false,
      },
    });

    this.paused = false;
    this.manager.emit('playerTriggeredResume', this);
    this.cacheState();
    return true;
  }

  public stop(options?: {
    destroy?: boolean;
  }): boolean {
    if (!this.playing) {
      return false;
    }

    this.node.rest.update({
      guildId: this.guildId,
      data: {
        track: {
          encoded: undefined,
        },
      },
    });

    options?.destroy ? this.destroy() : this.queue.clear();

    this.playing = false;
    this.manager.emit('playerTriggeredStop', this);
    this.cacheState();
    return true;
  }

  public async skip(position?: number): Promise<boolean> {
    if (!this.queue.size && this.autoPlay) {
      await this.node.rest.update({
        guildId: this.guildId,
        data: {
          track: {
            encoded: undefined,
          },
        },
      });
    } else if (!this.queue.size) {
      return false;
    }

    validate(
      position,
      z.number().min(1).max(this.queue.size).optional(),
      'Invalid position'
    );
    const oldTrack = { ...this.current };
    if (position) {
      this.current = this.queue.get(position);
      this.queue.remove(position);

      this.node.rest.update({
        guildId: this.guildId,
        data: {
          track: {
            encoded: this.current.encoded,
          },
        },
      });
    } else {
      this.play();
    }

    this.manager.emit(
      'playerTriggeredSkip',
      this,
      oldTrack as LilyTrack,
      this.current as LilyTrack,
      position ?? 0
    );
    this.cacheState();
    return true;
  }

  public seek(position: number): boolean {
    validate(
      position,
      z
        .number()
        .min(0)
        .max(this.current?.duration || 0),
      'Invalid position'
    );

    this.node.rest.update({
      guildId: this.guildId,
      data: {
        position: position,
      },
    });

    this.manager.emit('playerTriggeredSeek', this, position);
    this.cacheState();
    return true;
  }

  public shuffle(): boolean {
    if (this.queue.size < 2) {
      return false;
    }

    const oldQueue = { ...Array.from(this.queue.values()) };
    this.queue.shuffle();
    this.manager.emit(
      'playerTriggeredShuffle',
      this,
      oldQueue,
      Array.from(this.queue.values())
    );
    this.cacheState();
    return true;
  }

  public setVolume(volume: number): boolean {
    validate(volume, z.number().min(1).max(100), 'volume is invalid');
    const oldVolume = Number(this.volume);
    this.volume = volume;

    this.node.rest.update({
      guildId: this.guildId,
      data: {
        volume: this.volume,
      },
    });

    this.manager.emit('playerChangedVolume', this, oldVolume, volume);
    this.cacheState();
    return true;
  }

  public setLoop(loop: PlayerLoop | keyof typeof PlayerLoop): boolean {
    validate(loop, z.nativeEnum(PlayerLoop), 'Loop is invalid', TypeError);
    const oldLoop: PlayerLoop | keyof typeof PlayerLoop = this.loop;

    this.loop = loop;
    this.manager.emit('playerChangedLoop', this, oldLoop, loop);
    this.cacheState();
    return true;
  }

  public destroy(): boolean {
    if (this.connected) {
      this.disconnect();
    }
    this.queue.clear();
    this.manager.players.delete(this.guildId);
    this.invalidateCache();

    this.manager.emit('playerDestroyed', this);
    return true;
  }
}
