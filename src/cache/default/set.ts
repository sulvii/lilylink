import { CacheAdapter, type CacheEntry, type CacheOptions } from "../adapter";

export class SetAdapter extends CacheAdapter {
	private cache: Set<CacheEntry<unknown>>;
	private Keys: Map<string, CacheEntry<unknown>>;

	constructor(options?: CacheOptions) {
		super(options);
		this.cache = new Set();
		this.Keys = new Map();
	}

	public async init(): Promise<void> {
		this.emit("cacheInitialized");
	}

	public async get<T>(key: string): Promise<T | undefined> {
		const entry = this.Keys.get(key) as CacheEntry<T>;
		if (!entry) {
			return undefined;
		}

		if (this.isExpired(entry)) {
			this.cache.delete(entry);
			this.Keys.delete(key);
			this.emit("cacheExpired", key);
			return undefined;
		}

		return entry.value;
	}

	public async set<T>(
		key: string,
		value: T,
		options?: CacheOptions,
	): Promise<void> {
		const entry = this.createEntry(value, options);
		this.cache.add(entry);
		this.Keys.set(key, entry);
		this.emit("cacheSet", key, value);
	}

	public async has(key: string): Promise<boolean> {
		const entry = this.Keys.get(key);
		if (!entry) {
			return false;
		}

		if (this.isExpired(entry)) {
			this.cache.delete(entry);
			this.Keys.delete(key);
			this.emit("cacheExpired", key);
			return false;
		}

		return true;
	}

	public async delete(key: string): Promise<boolean> {
		const entry = this.Keys.get(key);
		if (entry) {
			this.cache.delete(entry);
			const result = this.Keys.delete(key);
			if (result) {
				this.emit("cacheDelete", key);
			}
			return result;
		}
		return false;
	}

	public async clear(): Promise<void> {
		this.cache.clear();
		this.Keys.clear();
		this.emit("cacheClear");
	}

	public async size(): Promise<number> {
		return this.cache.size;
	}

	public async keys(): Promise<string[]> {
		return Array.from(this.Keys.keys());
	}

	public async values<T>(): Promise<T[]> {
		const values: T[] = [];
		for (const [key, entry] of this.Keys.entries()) {
			if (this.isExpired(entry)) {
				this.cache.delete(entry);
				this.Keys.delete(key);
				this.emit("cacheExpired", key);
			} else {
				values.push((entry as CacheEntry<T>).value);
			}
		}
		return values;
	}

	public async entries<T>(): Promise<[string, T][]> {
		const entries: [string, T][] = [];
		for (const [key, entry] of this.Keys.entries()) {
			if (this.isExpired(entry)) {
				this.cache.delete(entry);
				this.Keys.delete(key);
				this.emit("cacheExpired", key);
			} else {
				entries.push([key, (entry as CacheEntry<T>).value]);
			}
		}
		return entries;
	}
}
