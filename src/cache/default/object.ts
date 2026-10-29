import { CacheAdapter, type CacheEntry, type CacheOptions } from "../adapter";

export class ObjectAdapter extends CacheAdapter {
	private cache: Record<string, CacheEntry<unknown>>;

	constructor(options?: CacheOptions) {
		super(options);
		this.cache = Object.create(null);
	}

	public async init(): Promise<void> {
		this.emit("cacheInitialized");
	}

	public async get<T>(key: string): Promise<T | undefined> {
		const entry = this.cache[key] as CacheEntry<T>;
		if (!entry) {
			return undefined;
		}

		if (this.isExpired(entry)) {
			delete this.cache[key];
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
		this.cache[key] = entry;
		this.emit("cacheSet", key, value);
	}

	public async has(key: string): Promise<boolean> {
		const entry = this.cache[key];
		if (!entry) {
			return false;
		}

		if (this.isExpired(entry)) {
			delete this.cache[key];
			this.emit("cacheExpired", key);
			return false;
		}

		return true;
	}

	public async delete(key: string): Promise<boolean> {
		const exists = key in this.cache;
		if (exists) {
			delete this.cache[key];
			this.emit("cacheDelete", key);
		}
		return exists;
	}

	public async clear(): Promise<void> {
		this.cache = Object.create(null);
		this.emit("cacheClear");
	}

	public async size(): Promise<number> {
		return Object.keys(this.cache).length;
	}

	public async keys(): Promise<string[]> {
		return Object.keys(this.cache);
	}

	public async values<T>(): Promise<T[]> {
		const values: T[] = [];
		for (const [key, entry] of Object.entries(this.cache)) {
			if (this.isExpired(entry)) {
				delete this.cache[key];
				this.emit("cacheExpired", key);
			} else {
				values.push((entry as CacheEntry<T>).value);
			}
		}
		return values;
	}

	public async entries<T>(): Promise<[string, T][]> {
		const entries: [string, T][] = [];
		for (const [key, entry] of Object.entries(this.cache)) {
			if (this.isExpired(entry)) {
				delete this.cache[key];
				this.emit("cacheExpired", key);
			} else {
				entries.push([key, (entry as CacheEntry<T>).value]);
			}
		}
		return entries;
	}
}
