import { EventEmitter } from "node:events";

export interface CacheOptions {
	ttl?: number;
	revalidate?: boolean;
}

export interface CacheEntry<T> {
	value: T;
	expires?: number;
	createdAt: number;
}

export interface CacheEventMap {
	readonly cacheInitialized: undefined;
	readonly cacheExpired: string;
	readonly cacheSet: [string, unknown];
	readonly cacheDelete: string;
	readonly cacheClear: undefined;
}

export abstract class CacheAdapter extends EventEmitter {
	protected options: CacheOptions;

	constructor(options: CacheOptions = {}) {
		super();
		this.options = {
			ttl: options.ttl,
			revalidate: options.revalidate ?? false,
		};
	}

	abstract init(): Promise<void>;
	abstract get<T>(key: string): Promise<T | undefined>;
	abstract set<T>(key: string, value: T, options?: CacheOptions): Promise<void>;
	abstract has(key: string): Promise<boolean>;
	abstract delete(key: string): Promise<boolean>;
	abstract clear(): Promise<void>;
	abstract size(): Promise<number>;
	abstract keys(): Promise<string[]>;
	abstract values<T>(): Promise<T[]>;
	abstract entries<T>(): Promise<[string, T][]>;

	protected isExpired(entry: CacheEntry<unknown>): boolean {
		if (!entry.expires) {
			return false;
		}
		return Date.now() > entry.expires;
	}

	protected createEntry<T>(value: T, options?: CacheOptions): CacheEntry<T> {
		const ttl = options?.ttl ?? this.options.ttl;
		return {
			value,
			expires: ttl ? Date.now() + ttl : undefined,
			createdAt: Date.now(),
		};
	}

	public async revalidate<T>(
		key: string,
		revalidateFn: () => Promise<T>,
	): Promise<T> {
		const existing = await this.get<T>(key);
		if (existing && !this.options.revalidate) {
			return existing;
		}

		const fresh = await revalidateFn();
		await this.set(key, fresh);
		return fresh;
	}
}
