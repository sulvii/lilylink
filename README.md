# LilyLink

A high-performance, memory-safe Lavalink client written in TypeScript.

## Key Features

- Exceptional performance and low latency
- Memory-safe architecture with robust error handling
- Modern TypeScript implementation with full type safety
- Clean and intuitive API design
- Comprehensive documentation and examples
- Advanced cache system with multiple adapters
- Built-in Queue system
- AutoPlay features
- Player Filters
- More sources
- Player and node regions
## Getting Started

For a complete implementation example, please refer to our [example bot](./testBot/index.js).

## Cache Adapters

- `WeakMapAdapter`: Uses `WeakMap` to store data.
- `MapAdapter`: Uses `Map` to store data.
- `SetAdapter`: Uses `Set` to store data.
- `ArrayAdapter`: Uses `Array` to store data.
- `ObjectAdapter`: Uses `Object` to store data.

## Making your own cache adapter

To make your own cache adapter, you can extend the `CacheAdapter` class and implement the `init()`, `get()`, `set()`, and `delete()` methods (the base ones). You may also want to add: has, clear, size, keys, values, entries and last but not least revalidate.

Example RedisAdapter:

```ts
import { CacheAdapter } from "lilylink";
import { Redis } from "ioredis";

class RedisAdapter extends CacheAdapter {
  private cache: Redis;

  constructor(options?: CacheOptions) {
    super(options);
    this.cache = new Redis({
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      password: process.env.REDIS_PASSWORD,
    });
  }

  public async init(): Promise<void> {
    this.emit('cacheInitialized');
  }

  public async get<T>(key: string): Promise<T | undefined> {
    const value = await this.cache.get(key);
    return value ? JSON.parse(value) : undefined;
  }

  public async set(key: string, value: unknown): Promise<void> {
    await this.cache.set(key, JSON.stringify(value));
  }

  public async delete(key: string): Promise<void> {
    await this.cache.del(key);
  }

  public async has(key: string): Promise<boolean> {
    const value = await this.cache.get(key);
    return value !== null && value !== undefined;
  }

  public async clear(): Promise<void> {
    await this.cache.flushall();
  }

  public async size(): Promise<number> {
    return await this.cache.dbsize();
  }

  public async keys(): Promise<string[]> {
    return await this.cache.keys('*');
  }

  public async values(): Promise<unknown[]> {
    return await this.cache.mget(...(await this.keys()));
  }

  public async entries(): Promise<[string, unknown][]> {
    return (await this.keys()).map((key, index) => [key, await this.values()[index]]);
  }

  public async revalidate(key: string, revalidateFn: () => Promise<unknown>): Promise<void> {
    const value = await revalidateFn();
    await this.set(key, value);
  }
}
```

Note this is a simple example with Redis, you should handle errors and edge cases (i.e: expiry, json-check, emitting events, etc.) in your own implementation.
