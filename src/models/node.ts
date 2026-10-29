import { autoPlayProvider } from "../helpers/autoPlay";
import { Registry } from "../helpers/registry";
import { type LilyManager, TrackEndReason } from "../services/base-manager";
import { type LilyPlayer, PlayerLoop } from "./player";
import { LoadType, LilyRestHandler, Source } from "./rest";
import type { LilyTrack, Track as RawTrack } from "./track";

const DEFAULT_PASSWORD = "youshallnotpass";
const DEFAULT_RETRY_DELAY = 30000;
const DEFAULT_RETRY_AMOUNT = 5;

export interface NodeStats {
	players: number;
	playingPlayers: number;
	uptime: number;
	memory: {
		free: number;
		used: number;
		allocated: number;
		reservable: number;
	};
	cpu: {
		cores: number;
		systemLoad: number;
		lavalinkLoad: number;
	};
	frameStats: {
		sent: number;
		nulled: number;
		deficit: number;
	};
}

export interface LilyNodeOptions {
	host: string;
	id?: number;
	identifier?: string;
	port: number;
	password?: string;
	retryDelay?: number;
	retryAmount?: number;
	regions?: string[];
	secure?: boolean;
	sessionId?: string;
}

export enum LilyNodeState {
	CONNECTING = 0,
	CONNECTED = 1,
	DISCONNECTING = 2,
	DISCONNECTED = 3,
}

interface NodeInfo {
	version: string;
}

interface TrackException {
	message: string | null;
	severity: string;
	cause: string;
}

interface ReadyPayload {
	op: "ready";
	resumed: boolean;
	sessionId: string;
}

interface StatsPayload extends NodeStats {
	op: "stats";
}

interface PlayerUpdatePayload {
	op: "playerUpdate";
	guildId: string;
	state: {
		time: number;
		position: number;
		connected: boolean;
		ping: number;
	};
}

interface TrackStartEvent {
	op: "event";
	type: "TrackStartEvent";
	guildId: string;
	track: RawTrack;
}

interface TrackEndEvent {
	op: "event";
	type: "TrackEndEvent";
	guildId: string;
	track: RawTrack;
	reason: TrackEndReason;
}

interface TrackStuckEvent {
	op: "event";
	type: "TrackStuckEvent";
	guildId: string;
	track: RawTrack;
	thresholdMs: number;
}

interface TrackExceptionEvent {
	op: "event";
	type: "TrackExceptionEvent";
	guildId: string;
	track: RawTrack;
	exception: TrackException;
}

interface WebSocketClosedEvent {
	op: "event";
	type: "WebSocketClosedEvent";
	guildId: string;
	code: number;
	reason: string;
	byRemote: boolean;
}

type EventPayload =
	| TrackStartEvent
	| TrackEndEvent
	| TrackStuckEvent
	| TrackExceptionEvent
	| WebSocketClosedEvent;

type NodePayload =
	| ReadyPayload
	| StatsPayload
	| PlayerUpdatePayload
	| EventPayload;

interface AutoPlayRequest {
	query: string;
	source?: Source;
	requester: string;
	isSameTrack: (track: LilyTrack) => boolean;
}

export class LilyNode {
	public readonly manager: LilyManager | null = null;

	public host: string;
	public port: number;
	public identifier: string;
	public password: string;
	public state: LilyNodeState = LilyNodeState.CONNECTING;
	public reconnectTimeout?: NodeJS.Timeout;
	public reconnectAttempts = 0;
	public retryAmount: number;
	public retryDelay: number;
	public regions: string[];
	public secure: boolean;
	public sessionId: string;
	public socket: WebSocket | null;
	public info?: NodeInfo;
	public version?: string;
	public url: string;
	public rest: LilyRestHandler;
	public stats: NodeStats;

	constructor(
		manager: LilyManager,
		{
			host,
			port,
			identifier = "",
			password = DEFAULT_PASSWORD,
			regions = undefined,
			retryDelay = DEFAULT_RETRY_DELAY,
			retryAmount = DEFAULT_RETRY_AMOUNT,
			secure = false,
			sessionId = "",
		}: LilyNodeOptions,
	) {
		this.manager = manager;
		this.host = host;
		this.port = port;
		this.identifier = identifier;
		this.password = password;
		this.regions = regions?.map?.((x) => x?.toLowerCase?.()) || [];
		this.retryDelay = retryDelay;
		this.retryAmount = retryAmount;
		this.secure = secure;
		this.sessionId = sessionId;
		this.socket = null;
		this.url = this.buildUrl();
		this.rest = new LilyRestHandler(this);
		this.stats = this.initializeStats();
	}

	private buildUrl(): string {
		const protocol = this.secure ? "https" : "http";
		return `${protocol}://${this.address}/v4/`;
	}

	private initializeStats(): NodeStats {
		return {
			players: 0,
			playingPlayers: 0,
			uptime: 0,
			memory: {
				free: 0,
				used: 0,
				allocated: 0,
				reservable: 0,
			},
			cpu: {
				cores: 0,
				systemLoad: 0,
				lavalinkLoad: 0,
			},
			frameStats: {
				sent: 0,
				nulled: 0,
				deficit: 0,
			},
		};
	}

	public get address(): string {
		return `${this.host}:${this.port}`;
	}

	public connect(): void {
		const headers = {
			Authorization: this.password,
			"User-Id": this.manager?.options.clientId ?? "",
			"Client-Name": this.manager?.options.clientName ?? "",
		};

		const wsUrl = `${this.secure ? "wss" : "ws"}://${this.address}/v4/websocket`;
		const socket = new WebSocket(wsUrl, { headers });

		this.socket = socket;
		this.bindSocketEvents(socket);
	}

	private bindSocketEvents(socket: WebSocket): void {
		socket.onopen = () => this.open();
		socket.onclose = (event) => this.close(event.code, event.reason);
		socket.onmessage = (event) => void this.message(event.data);
		socket.onerror = () => this.error(new Error("WebSocket error"));
	}

	public reconnect(): void {
		this.reconnectTimeout = setTimeout(() => {
			this.reconnectAttempts++;
			this.connect();
		}, this.retryDelay);

		this.manager?.emit("nodeReconnect", this);
	}

	protected open(): void {
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
		}
		this.state = LilyNodeState.CONNECTED;
		this.manager?.emit("nodeConnected", this);
	}

	protected close(code: number, reason: string): void {
		if (this.state === LilyNodeState.CONNECTED) {
			this.state = LilyNodeState.DISCONNECTED;
		}

		this.cleanupSocket();

		if (this.retryAmount > this.reconnectAttempts) {
			this.reconnect();
		} else {
			this.socket = null;
			this.state = LilyNodeState.DISCONNECTED;
		}

		this.manager?.emit("nodeDisconnect", this, code, reason);
	}

	private cleanupSocket(): void {
		if (!this.socket) {
			return;
		}

		this.socket.onopen = null;
		this.socket.onclose = null;
		this.socket.onmessage = null;
		this.socket.onerror = null;
		this.socket.close();
	}

	protected async message(data: unknown): Promise<void> {
		const payload = this.parsePayload(data);
		if (!payload) {
			return;
		}

		switch (payload.op) {
			case "ready":
				await this.handleReadyPayload(payload);
				break;
			case "stats":
				this.handleStatsPayload(payload);
				break;
			case "playerUpdate":
				this.handlePlayerUpdatePayload(payload);
				break;
			case "event":
				await this.handleEventPayload(payload);
				break;
		}
	}

	private parsePayload(data: unknown): NodePayload | null {
		try {
			const text =
				typeof data === "string"
					? data
					: data instanceof ArrayBuffer
						? new TextDecoder().decode(data)
						: null;

			if (text === null) {
				throw new Error("Unsupported message type");
			}

			return JSON.parse(text);
		} catch (error) {
			console.error(error);
			this.error(new Error("Failed to parse payload"));
			return null;
		}
	}

	private toTrack(raw: RawTrack, encoded?: string): LilyTrack {
		const TrackClass = Registry.get("Track");
		return new TrackClass({ ...raw, encoded: encoded ?? raw.encoded });
	}

	private isLoop(player: LilyPlayer, mode: "TRACK" | "QUEUE"): boolean {
		return player.loop === PlayerLoop[mode] || player.loop === mode;
	}

	private async handleReadyPayload(payload: ReadyPayload): Promise<void> {
		this.sessionId = payload.sessionId;
		this.info = await this.rest.getInfo<NodeInfo>();
		this.version = this.info?.version;
		this.manager?.emit("nodeReady", this, this.stats);
	}

	private handleStatsPayload(payload: StatsPayload): void {
		const { op: _op, ...stats } = payload;
		this.stats = stats;
	}

	private handlePlayerUpdatePayload(payload: PlayerUpdatePayload): void {
		const player = this.manager?.getPlayer(payload.guildId);
		if (!player?.current) {
			return;
		}

		player.connected = payload.state.connected;
		player.current.position = payload.state.position;
		player.current.time = payload.state.time;
		player.ping = payload.state.ping;

		this.manager?.emit("playerUpdate", player, player.current, payload);
	}

	private async handleEventPayload(payload: EventPayload): Promise<void> {
		const player = this.manager?.getPlayer(payload.guildId);
		if (!player) {
			return;
		}

		this.manager?.emit("nodeRaw", this, player, payload);

		switch (payload.type) {
			case "TrackStartEvent":
				this.handleTrackStart(player);
				break;
			case "TrackEndEvent":
				await this.handleTrackEnd(player, payload);
				break;
			case "TrackStuckEvent":
				this.handleTrackStuck(player, payload);
				break;
			case "TrackExceptionEvent":
				this.handleTrackException(player, payload);
				break;
			case "WebSocketClosedEvent":
				this.handleWebSocketClosed(player, payload);
				break;
		}
	}

	private handleTrackStart(player: LilyPlayer): void {
		player.playing = true;
		player.paused = false;

		if (player.current) {
			this.manager?.emit("trackStart", player, player.current);
		}
	}

	private async handleTrackEnd(
		player: LilyPlayer,
		payload: TrackEndEvent,
	): Promise<void> {
		player.playing = false;
		player.paused = false;

		const ended = this.toTrack(payload.track, player.current?.encoded);
		if (Array.isArray(player.previous)) {
			player.previous.push(ended);
		} else {
			player.previous = ended;
		}

		if (player.current) {
			this.manager?.emit(
				"trackEnd",
				player,
				player.current,
				payload.reason,
				payload,
			);
		}

		switch (payload.reason) {
			case TrackEndReason.LoadFailed:
			case TrackEndReason.Cleanup:
				await this.handleFailedTrack(player);
				return;
			case TrackEndReason.Replaced:
				return;
		}

		if (this.isLoop(player, "TRACK")) {
			await this.handleTrackLoop(player);
			return;
		}

		if (this.isLoop(player, "QUEUE") && player.current) {
			await this.handleQueueLoop(player, player.current);
			return;
		}

		if (player.queue.size) {
			await player.play();
			return;
		}

		if (player.autoPlay) {
			await this.handleAutoPlay(player, payload.reason);
			return;
		}

		player.current = null;
		this.manager?.emit("queueEnd", player);

		if (player.autoLeave) {
			await player.destroy();
		}
	}

	private async handleFailedTrack(player: LilyPlayer): Promise<void> {
		if (player.queue.size) {
			await player.play();
		} else {
			player.queue.clear();
		}
	}

	private async handleTrackLoop(player: LilyPlayer): Promise<void> {
		await this.rest.update({
			guildId: player.guildId,
			data: {
				track: {
					encoded: player.current?.encoded,
				},
			},
		});
	}

	private async handleQueueLoop(
		player: LilyPlayer,
		current: LilyTrack,
	): Promise<void> {
		current.position = 0;
		current.time = 0;
		player.queue.add(current);
		await player.play();
	}

	private async buildAutoPlayRequest(
		current: LilyTrack,
	): Promise<AutoPlayRequest | null> {
		switch (current.sourceName) {
			case "youtube":
				return {
					query: `https://www.youtube.com/watch?v=${current.identifier}&list=RD${current.identifier}`,
					requester: "AutoPlay(YouTube)",
					isSameTrack: (track) => track.identifier === current.identifier,
				};
			case "spotify": {
				const id = await autoPlayProvider("spotify", current.identifier ?? "");
				return {
					query: `https://open.spotify.com/track/${id}`,
					requester: "AutoPlay(Spotify)",
					isSameTrack: (track) => track.identifier === current.identifier,
				};
			}
			case "soundcloud": {
				const urls = await autoPlayProvider("soundcloud", current.url ?? "");
				const picked = Array.isArray(urls)
					? urls[Math.floor(Math.random() * urls.length)]
					: urls;

				if (!picked) {
					return null;
				}

				return {
					query: picked,
					source: Source.SOUNDCLOUD,
					requester: "AutoPlay(SoundCloud)",
					isSameTrack: (track) => track.url === current.url,
				};
			}
			default:
				return null;
		}
	}

	private async handleAutoPlay(
		player: LilyPlayer,
		reason: TrackEndReason,
	): Promise<void> {
		const current = player.current;
		if (!current || reason === TrackEndReason.Stopped || !player.autoPlay) {
			return;
		}

		try {
			const request = await this.buildAutoPlayRequest(current);
			if (!request) {
				return;
			}

			const res = await this.manager?.search({
				query: request.query,
				source: request.source,
				requester: request.requester,
			});

			if (
				!res ||
				res.loadType === LoadType.Error ||
				res.loadType === LoadType.Empty
			) {
				return;
			}

			const candidates = res.tracks?.filter(
				(track) => !request.isSameTrack(track),
			);
			if (!candidates?.length) {
				return;
			}

			const next = candidates[Math.floor(Math.random() * candidates.length)];
			player.queue.add(next);
			await player.play();
		} catch (error) {
			console.error("AutoPlay error:", error);
			await player.destroy();
		}
	}

	private handleTrackStuck(player: LilyPlayer, payload: TrackStuckEvent): void {
		if (!player.current) {
			return;
		}
		this.manager?.emit(
			"trackStuck",
			player,
			player.current,
			payload.thresholdMs,
		);
	}

	private handleTrackException(
		player: LilyPlayer,
		payload: TrackExceptionEvent,
	): void {
		if (!player.current) {
			return;
		}
		this.manager?.emit(
			"trackException",
			player,
			player.current,
			payload.exception,
		);
	}

	private handleWebSocketClosed(
		player: LilyPlayer,
		payload: WebSocketClosedEvent,
	): void {
		this.manager?.emit(
			"socketClosed",
			player,
			payload.code,
			payload.reason,
			payload.byRemote,
		);
	}

	protected error(error: Error): void {
		this.manager?.emit("nodeError", this, error);
	}

	public destroy(): void {
		this.socket?.close();
		this.state = LilyNodeState.DISCONNECTED;
	}
}
