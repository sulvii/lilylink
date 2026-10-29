import {
	array,
	boolean,
	getDotPath,
	type InferOutput,
	integer,
	maxValue,
	minLength,
	minValue,
	number,
	optional,
	parse,
	picklist,
	pipe,
	safeParse,
	strictObject,
	string,
} from "valibot";
import { Registry } from "../helpers/registry";
import {
	type LilyNode,
	type LilyNodeOptions,
	LilyNodeState,
	type NodeStats,
} from "../models/node";
import type { LilyManager } from "./base-manager";

const nonEmptyString = pipe(string(), minLength(1));

const nodeOptionsSchema = strictObject({
	host: nonEmptyString,
	id: optional(pipe(number(), integer(), minValue(1))),
	identifier: optional(nonEmptyString),
	port: pipe(number(), integer(), minValue(1), maxValue(65535)),
	password: optional(nonEmptyString),
	retryDelay: optional(
		pipe(number(), integer(), minValue(100), maxValue(60000)),
		5000,
	),
	retryAmount: optional(
		pipe(number(), integer(), minValue(1), maxValue(10)),
		3,
	),
	regions: optional(array(nonEmptyString), []),
	secure: optional(boolean(), false),
	sessionId: optional(nonEmptyString),
});

export type ValidatedNodeOptions = InferOutput<typeof nodeOptionsSchema>;

export const SortTypeNodeEnum = picklist([
	"players",
	"playingPlayers",
	"memory",
	"cpuLavalink",
	"cpuSystem",
	"uptime",
	"random",
]);

export type SortTypeNode = InferOutput<typeof SortTypeNodeEnum>;

export class LilyNodeManager {
	private readonly manager: LilyManager;
	public cache: Map<string | number, LilyNode>;
	private readonly maxCacheSize = 100;

	constructor(manager: LilyManager, nodes: LilyNodeOptions[]) {
		this.manager = manager;
		this.cache = new Map();

		if (nodes.length === 0) {
			throw new Error("At least one node configuration is required");
		}

		// Validate everything first so a bad config doesn't leave a half-filled cache
		const validatedNodes = nodes.map((node) => this.validateNode(node));

		for (const node of validatedNodes) {
			this.register(node);
		}
	}

	private validateNode(options: LilyNodeOptions): ValidatedNodeOptions {
		const result = safeParse(nodeOptionsSchema, options);

		if (!result.success) {
			const issues = result.issues
				.map((issue) => `${getDotPath(issue) ?? "root"}: ${issue.message}`)
				.join(", ");
			throw new Error(`Invalid node configuration: ${issues}`);
		}

		return result.output;
	}

	private register(options: ValidatedNodeOptions): void {
		if (this.cache.size >= this.maxCacheSize) {
			throw new Error(
				`Cannot add more nodes. Maximum capacity (${this.maxCacheSize}) reached`,
			);
		}

		const identifier = options.identifier ?? options.host;

		if (this.cache.has(identifier)) {
			throw new Error(`Node with identifier "${identifier}" already exists`);
		}

		const NodeClass = Registry.get("Node");
		const node = new NodeClass(this.manager, options);
		this.cache.set(identifier, node);

		this.manager.emit("nodeCreate", node);
	}

	public init(): void {
		if (this.cache.size === 0) {
			throw new Error("No nodes available to initialize");
		}

		for (const node of this.cache.values()) {
			try {
				node.connect();
			} catch (error) {
				this.manager.emit("nodeError", node, error);
			}
		}
	}

	public add(options: LilyNodeOptions): void {
		this.register(this.validateNode(options));
	}

	public remove(identifier: string): void {
		const node = this.cache.get(identifier);
		if (!node) {
			throw new Error(`Node with identifier "${identifier}" not found`);
		}

		try {
			node.destroy();
			this.cache.delete(identifier);
			this.manager.emit("nodeDestroy", identifier);
		} catch (error) {
			throw new Error(
				`Failed to remove node "${identifier}": ${(error as Error).message}`,
			);
		}
	}

	public get(identifier: string | number): LilyNode | undefined {
		if (identifier === "default" && this.cache.size === 1) {
			return this.cache.values().next().value;
		}

		const node = this.cache.get(identifier);
		if (!node) {
			throw new Error(`Node with identifier "${identifier}" not found`);
		}

		return node;
	}

	public get best(): LilyNode {
		return this.sortByUsage("players");
	}

	public sortByUsage(sortType: SortTypeNode): LilyNode {
		// Types can't protect JS callers, so check at runtime too
		parse(SortTypeNodeEnum, sortType);

		const [first, ...rest] = [...this.cache.values()].filter(
			(node) => node.state === LilyNodeState.CONNECTED,
		);

		if (!first) {
			throw new Error("No connected nodes available");
		}

		const getSortValue = (node: LilyNode): number => {
			const stats: NodeStats = node.stats;
			switch (sortType) {
				case "players":
					return stats.players;
				case "playingPlayers":
					return stats.playingPlayers;
				case "memory":
					return stats.memory.used;
				case "cpuLavalink":
					return stats.cpu.lavalinkLoad;
				case "cpuSystem":
					return stats.cpu.systemLoad;
				case "uptime":
					return stats.uptime;
				case "random":
					return Math.random();
			}
		};

		// One pass, each node scored once: O(n) instead of sorting
		let lowest = first;
		let lowestValue = getSortValue(first);

		for (const node of rest) {
			const value = getSortValue(node);
			if (value < lowestValue) {
				lowest = node;
				lowestValue = value;
			}
		}

		return lowest;
	}

	public cleanup(): void {
		for (const [identifier, node] of this.cache) {
			try {
				node.destroy();
				this.cache.delete(identifier);
			} catch (error) {
				this.manager.emit("nodeError", node, error);
			}
		}
	}
}
