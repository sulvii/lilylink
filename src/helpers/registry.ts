import { LilyFilters } from "../models/filters";
import { LilyNode } from "../models/node";
import { LilyPlayer } from "../models/player";
import { LilyQueue } from "../models/queue";
import { LilyRestHandler } from "../models/rest";
import { LilyTrack } from "../models/track";
import type { LilyManager } from "../services/base-manager";
import { LilyNodeManager } from "../services/node-manager";
import { LilyPlayerManager } from "../services/player-manager";

export interface RegistryStructures {
	Node: typeof LilyNode;
	Rest: typeof LilyRestHandler;
	Player: typeof LilyPlayer;
	Track: typeof LilyTrack;
	Queue: typeof LilyQueue;
	Filters: typeof LilyFilters;
	PlayerManager: typeof LilyPlayerManager;
	NodeManager: typeof LilyNodeManager;
}

export class Registry {
	private static instance: Registry;
	private manager: LilyManager | undefined;
	private structures: Map<
		keyof RegistryStructures,
		RegistryStructures[keyof RegistryStructures]
	>;
	private plugins: Map<string, Plugin>;
	private defaultStructures: Map<
		keyof RegistryStructures,
		RegistryStructures[keyof RegistryStructures]
	>;

	private constructor() {
		this.structures = new Map();
		this.plugins = new Map();
		this.defaultStructures = new Map();
		this.registerDefaults();
	}
	private registerDefaults(): void {
		const defaults: [
			keyof RegistryStructures,
			RegistryStructures[keyof RegistryStructures],
		][] = [
			["Node", LilyNode],
			["Rest", LilyRestHandler],
			["Player", LilyPlayer],
			["Track", LilyTrack],
			["Queue", LilyQueue],
			["Filters", LilyFilters],
			["PlayerManager", LilyPlayerManager],
			["NodeManager", LilyNodeManager],
		];

		for (const [key, value] of defaults) {
			this.structures.set(key, value);
			this.defaultStructures.set(key, value);
		}
	}

	public static getInstance(): Registry {
		if (!Registry.instance) {
			Registry.instance = new Registry();
		}
		return Registry.instance;
	}

	public setManager(manager: LilyManager): void {
		this.manager = manager;
	}

	public getManager(): LilyManager | undefined {
		return this.manager;
	}

	public register<K extends keyof RegistryStructures>(
		name: K,
		structure: RegistryStructures[K],
	): void {
		if (!this.structures.has(name)) {
			throw new Error(`Invalid structure name: ${String(name)}`);
		}
		this.structures.set(name, structure);
	}

	public static get<K extends keyof RegistryStructures>(
		name: K,
	): RegistryStructures[K] {
		const instance = Registry.getInstance();
		const structure = instance.structures.get(name);
		if (!structure) {
			throw new Error(`Structure ${String(name)} not found in registry`);
		}
		return structure as RegistryStructures[K];
	}

	public has<K extends keyof RegistryStructures>(name: K): boolean {
		return this.structures.has(name);
	}

	public unregister<K extends keyof RegistryStructures>(name: K): boolean {
		const defaultStructure = this.defaultStructures.get(name);
		if (defaultStructure) {
			this.structures.set(name, defaultStructure);
			return true;
		}
		return false;
	}

	public async loadPlugin(plugin: Plugin): Promise<void> {
		if (this.plugins.has(plugin.name)) {
			throw new Error(`Plugin ${plugin.name} is already loaded`);
		}

		try {
			await plugin.load(this.manager!);
			this.plugins.set(plugin.name, plugin);
			this.manager?.emit("pluginLoaded", plugin.name);
		} catch (error) {
			throw new Error(`Failed to load plugin ${plugin.name}: ${error}`);
		}
	}

	public async unloadPlugin(pluginName: string): Promise<void> {
		const plugin = this.plugins.get(pluginName);
		if (!plugin) {
			throw new Error(`Plugin ${pluginName} is not loaded`);
		}

		try {
			await plugin.unload(this.manager!);
			this.plugins.delete(pluginName);

			// Restore default structures that might have been modified by the plugin
			for (const [key, value] of this.defaultStructures) {
				this.structures.set(key, value);
			}

			this.manager?.emit("pluginUnloaded", pluginName);
		} catch (error) {
			throw new Error(`Failed to unload plugin ${pluginName}: ${error}`);
		}
	}

	public getPlugin(name: string): Plugin | undefined {
		return this.plugins.get(name);
	}

	public getLoadedPlugins(): string[] {
		return Array.from(this.plugins.keys());
	}

	public clear(): void {
		this.structures.clear();
		this.plugins.clear();
		this.registerDefaults();
	}
}

export abstract class Plugin {
	public abstract readonly name: string;
	protected registry: Registry;

	constructor() {
		this.registry = Registry.getInstance();
	}

	public abstract load(manager: LilyManager): void | Promise<void>;
	public abstract unload(manager: LilyManager): void | Promise<void>;
}
