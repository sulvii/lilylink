import { maxValue, minValue, number, optional, pipe, string } from "valibot";
import { Registry } from "../helpers/registry";
import { validate } from "../helpers/validate";
import type { LilyPlayer, PlayerConfig } from "../models/player";
import type { LilyManager } from "./base-manager";

export class LilyPlayerManager {
	readonly manager: LilyManager;
	public cache: Map<string, LilyPlayer> = new Map();
	constructor(manager: LilyManager) {
		this.manager = manager;
	}

	public create(config: PlayerConfig): LilyPlayer | undefined {
		validate(config.guildId, string(), "guildId is required");

		if (this.has(config.guildId)) {
			return this.get(config.guildId);
		}

		validate(config.voiceChannel, string(), "voiceChannelId is required");
		validate(config.textChannel, string(), "textChannelId is required");
		validate(
			config.volume,
			optional(pipe(number(), minValue(0), maxValue(100))),
			"Invalid volume value.",
		);

		if (config.node) {
			if (!this.manager.nodes.get(config.node)) {
				throw new Error("Invalid node");
			}
		} else {
			const node = this.manager.nodes.sortByUsage("players");
			if (!node) {
				throw new Error("No available nodes");
			}

			config.node = node.identifier ?? node.host;
		}

		const player: LilyPlayer = new (Registry.get("Player"))(
			this.manager,
			config,
		);
		this.cache.set(config.guildId, player);

		return player;
	}
	public has(guildId: string): boolean {
		return this.cache.has(guildId);
	}
	public get(guildId: string): LilyPlayer | undefined {
		return this.cache.get(guildId);
	}
	public async delete(guildId: string): Promise<void> {
		if (!this.has(guildId)) {
			return;
		}
		await this.get(guildId)?.node.rest.destroy(guildId);
		this.cache.delete(guildId);
	}
}
