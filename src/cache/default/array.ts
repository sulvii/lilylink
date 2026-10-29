import { CacheAdapter, type CacheEntry, type CacheOptions } from "../adapter";

export class ArrayAdapter extends CacheAdapter {
	private cache: CacheEntry<unknown>[];
	private Keys: Map<string, number>;

	constructor(options?: CacheOptions) {
		super(options);
		this.cache = [];
		this.Keys = new Map();
	}

	public async init(): Promise<void> {
		this.emit("cacheInitialized");
	}

	public async get<T>(key: string): Promise<T | undefined> {
		const index = this.Keys.get(key);
		if (index === undefined) {
			return undefined;
		}

		const entry = this.cache[index] as CacheEntry<T>;
		if (!entry) {
			return undefined;
		}

		if (this.isExpired(entry)) {
			this.cache.splice(index, 1);
			this.Keys.delete(key);
			this.updateIndices(index);
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
		const existingIndex = this.Keys.get(key);

		if (existingIndex !== undefined) {
			this.cache[existingIndex] = entry;
		} else {
			this.Keys.set(key, this.cache.length);
			this.cache.push(entry);
		}

		this.emit("cacheSet", key, value);
	}

	public async has(key: string): Promise<boolean> {
		const index = this.Keys.get(key);
		if (index === undefined) {
			return false;
		}

		const entry = this.cache[index];
		if (!entry) {
			return false;
		}

		if (this.isExpired(entry)) {
			this.cache.splice(index, 1);
			this.Keys.delete(key);
			this.updateIndices(index);
			this.emit("cacheExpired", key);
			return false;
		}

		return true;
	}

	public async delete(key: string): Promise<boolean> {
		const index = this.Keys.get(key);
		if (index !== undefined) {
			this.cache.splice(index, 1);
			this.Keys.delete(key);
			this.updateIndices(index);
			this.emit("cacheDelete", key);
			return true;
		}
		return false;
	}

	public async clear(): Promise<void> {
		this.cache = [];
		this.Keys.clear();
		this.emit("cacheClear");
	}

	public async size(): Promise<number> {
		return this.cache.length;
	}

	public async keys(): Promise<string[]> {
		return Array.from(this.Keys.keys());
	}

	public async values<T>(): Promise<T[]> {
		const values: T[] = [];
		for (const [key, index] of this.Keys.entries()) {
			const entry = this.cache[index] as CacheEntry<T>;
			if (this.isExpired(entry)) {
				this.cache.splice(index, 1);
				this.Keys.delete(key);
				this.updateIndices(index);
				this.emit("cacheExpired", key);
			} else {
				values.push(entry.value);
			}
		}
		return values;
	}

	public async entries<T>(): Promise<[string, T][]> {
		const entries: [string, T][] = [];
		for (const [key, index] of this.Keys.entries()) {
			const entry = this.cache[index] as CacheEntry<T>;
			if (this.isExpired(entry)) {
				this.cache.splice(index, 1);
				this.Keys.delete(key);
				this.updateIndices(index);
				this.emit("cacheExpired", key);
			} else {
				entries.push([key, entry.value]);
			}
		}
		return entries;
	}

	private updateIndices(deletedIndex: number): void {
		for (const [key, index] of this.Keys.entries()) {
			if (index > deletedIndex) {
				this.Keys.set(key, index - 1);
			}
		}
	}
}
