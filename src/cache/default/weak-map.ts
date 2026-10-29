import { CacheAdapter, type CacheEntry, type CacheOptions } from "../adapter";

export class WeakMapAdapter extends CacheAdapter {
	private cache: WeakMap<object, CacheEntry<unknown>>;
	private Keys: Set<object>;

	constructor(options?: CacheOptions) {
		super(options);
		this.cache = new WeakMap();
		this.Keys = new Set();
	}

	private getKeyObject(key: string): object {
		const obj = { key };
		this.Keys.add(obj);
		return obj;
	}

	public async init(): Promise<void> {
		this.emit("cacheInitialized");
	}

	public async get<T>(key: string): Promise<T | undefined> {
		for (const keyObj of this.Keys) {
			if ((keyObj as { key: string }).key === key) {
				const entry = this.cache.get(keyObj) as CacheEntry<T>;
				if (!entry) {
					return undefined;
				}

				if (this.isExpired(entry)) {
					this.cache.delete(keyObj);
					this.Keys.delete(keyObj);
					this.emit("cacheExpired", key);
					return undefined;
				}

				return entry.value;
			}
		}
		return undefined;
	}

	public async set<T>(
		key: string,
		value: T,
		options?: CacheOptions,
	): Promise<void> {
		const keyObj = this.getKeyObject(key);
		const entry = this.createEntry(value, options);
		this.cache.set(keyObj, entry);
		this.emit("cacheSet", key, value);
	}

	public async has(key: string): Promise<boolean> {
		for (const keyObj of this.Keys) {
			if ((keyObj as { key: string }).key === key) {
				const entry = this.cache.get(keyObj);
				if (!entry) {
					return false;
				}

				if (this.isExpired(entry)) {
					this.cache.delete(keyObj);
					this.Keys.delete(keyObj);
					this.emit("cacheExpired", key);
					return false;
				}

				return true;
			}
		}
		return false;
	}

	public async delete(key: string): Promise<boolean> {
		for (const keyObj of this.Keys) {
			if ((keyObj as { key: string }).key === key) {
				const result = this.cache.delete(keyObj);
				if (result) {
					this.Keys.delete(keyObj);
					this.emit("cacheDelete", key);
				}
				return result;
			}
		}
		return false;
	}

	public async clear(): Promise<void> {
		this.Keys.clear();
		this.emit("cacheClear");
	}

	public async size(): Promise<number> {
		return this.Keys.size;
	}

	public async keys(): Promise<string[]> {
		return Array.from(this.Keys).map((obj) => (obj as { key: string }).key);
	}

	public async values<T>(): Promise<T[]> {
		const values: T[] = [];
		for (const keyObj of this.Keys) {
			const entry = this.cache.get(keyObj) as CacheEntry<T>;
			if (this.isExpired(entry)) {
				this.cache.delete(keyObj);
				this.Keys.delete(keyObj);
				this.emit("cacheExpired", (keyObj as { key: string }).key);
			} else {
				values.push(entry.value);
			}
		}
		return values;
	}

	public async entries<T>(): Promise<[string, T][]> {
		const entries: [string, T][] = [];
		for (const keyObj of this.Keys) {
			const entry = this.cache.get(keyObj) as CacheEntry<T>;
			if (this.isExpired(entry)) {
				this.cache.delete(keyObj);
				this.Keys.delete(keyObj);
				this.emit("cacheExpired", (keyObj as { key: string }).key);
			} else {
				entries.push([(keyObj as { key: string }).key, entry.value]);
			}
		}
		return entries;
	}
}
