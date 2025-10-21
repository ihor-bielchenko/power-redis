import {
	isStrFilled,
	isStr,
	isStrBool,
	isArrFilled,
	isArr,
	isObj,
	isNum,
	isNumP,
	isNumPZ,
	isBool,
	isFunc,
	jsonDecode,
	jsonEncode,
	formatToBool,
} from 'full-utils';
import type { 
	IORedisLike,
	Jsonish, 
} from './types';

type ExecTuple<T = any> = [Error | null, T];
type ExecResult<T = any> = Array<ExecTuple<T>> | null;

/**
 * PowerRedis — a lightweight abstract wrapper around a Redis client that
 * standardizes:
 *  - safe key and pattern construction (strict segment validation),
 *  - (de)serialization of JSON-like payloads,
 *  - bulk reads (SCAN + MGET with chunking),
 *  - LPOP with `count` compatibility (MULTI-based emulation fallback),
 *  - list operations (iterators, safe batched reading),
 *  - grouped writes (MSET / MULTI SET EX) and pattern-based deletion (UNLINK/DEL).
 *
 * The class is not tied to a specific Redis client implementation: it expects
 * an object compatible with {@link IORedisLike}. A subclass must provide the
 * concrete client via the abstract {@link redis} field.
 *
 * ## Core guarantees & invariants
 * - Key and pattern segments are strictly validated: colons, whitespace,
 *   and (for keys) glob characters are forbidden in segments. This helps keep
 *   a clean and predictable key schema.
 * - Serialization: objects/arrays are stored as JSON; primitives are stringified.
 *   Conversely, {@link fromPayload} can distinguish JSON, boolean-like strings,
 *   and numbers.
 * - List reading via {@link getList}/{@link getListIterator}: when `remove=true`
 *   it uses LPOP with count (or its atomic emulation); when `remove=false` it
 *   uses index windows (not isolated from concurrent mutations).
 *
 * ## Connection readiness model
 * - {@link checkConnection} treats "ready" as healthy.
 *   If the REDIS_STRICT_CHECK_CONNECTION environment variable is not set,
 *   "connecting"/"reconnecting" are considered "conditionally healthy".
 *   For critical paths, a stricter "ready-only" check is recommended.
 *
 * ## Performance
 * - SCAN and deletion are chunked to avoid blocking Redis and to stay within
 *   argument limits. MGET is chunked as well.
 * - Pattern-based deletion prefers UNLINK (asynchronous), falling back to DEL.
 *
 * ## Exceptions
 * - All public methods validate input parameters and connection state.
 *   On errors they throw human-readable `Error`s with context.
 *
 * Inheritance:
 * ```ts
 * class MyRedis extends PowerRedis {
 *   public redis: IORedisLike;
 *   constructor(redis: IORedisLike) {
 *     super();
 *     this.redis = redis;
 *   }
 * }
 * ```
 */
export abstract class PowerRedis {
	/**
	 * When `true`, only `status === "ready"` is considered a healthy connection.
	 * When `false`, transient states like `'connecting'`/`'reconnecting'` are tolerated.
	 *
	 * Parsed from `process.env.REDIS_STRICT_CHECK_CONNECTION` with common truthy
	 * forms: `true|on|yes|y|1` (case/space-insensitive).
	 */
	public readonly isStrictCheckConnection: boolean = [ 'true', 'on', 'yes', 'y', '1' ].includes(String(process.env.REDIS_STRICT_CHECK_CONNECTION ?? '').trim().toLowerCase());
	
	/**
	 * Concrete Redis client instance. Subclasses must provide an implementation
	 * compatible with {@link IORedisLike}.
	 */
	public abstract redis: IORedisLike;

	/**
	 * Lightweight health check for the underlying Redis client.
	 *
	 * @returns `true` if the client is considered healthy; otherwise `false`.
	 *
	 * @remarks
	 * - When the environment variable `REDIS_STRICT_CHECK_CONNECTION` is **truthy**,
	 *   only `status === 'ready'` is treated as healthy.
	 * - Otherwise, transient states `'connecting'`/`'reconnecting'` are tolerated.
	 * - For critical code paths prefer an explicit readiness guard (e.g., throw unless `'ready'`).
	 */
	checkConnection(): boolean {
		return !!this.redis && (this.redis.status === 'ready' || (this.isStrictCheckConnection ? false : (this.redis.status === 'connecting' || this.redis.status === 'reconnecting')));
	}

	/**
	 * Builds a strict, colon-separated pattern **base** for SCAN MATCH usage.
	 * Each segment must be non-empty and must not contain `:` or whitespace.
	 *
	 * @param parts - Key/pattern segments to join (validated).
	 * @returns The validated base string joined by `:` (without wildcards).
	 *
	 * @remarks
	 * - This method does **not** append wildcards; add your own (`*`, `?`, etc.) outside.
	 * - Use this to reduce accidental broad scans and keep a predictable namespace.
	 *
	 * @throws Error
	 * - If any segment is empty or contains `:` or whitespace.
	 *
	 * @example
	 * ```ts
	 * const base = pr.toPatternString('queue', 'orders');
	 * const pattern = `${base}:*`; // queue:orders:*
	 * ```
	 */
	toPatternString(...parts: Array<string | number>): string {
		for (const p of parts) {
			const s = String(p).trim();

			if (!isStrFilled(s) || s.includes(':') || /\s/.test(s)) {
				throw new Error(`Pattern segment invalid (no ":", spaces): "${s}"`);
			}
		}
		return parts.join(':');
	}

	/**
	 * Builds a strict Redis key by joining validated segments with `:`.
	 * Disallows wildcards (`* ? [ ]`), spaces, and nested `:` inside segments.
	 *
	 * @param parts - Key segments to join (validated).
	 * @returns The validated key string.
	 *
	 * @remarks
	 * - Helps enforce a clean, searchable key schema and prevents accidental globbing.
	 *
	 * @throws Error
	 * - If any segment is empty or contains `:`, whitespace, or glob characters.
	 *
	 * @example
	 * ```ts
	 * const key = pr.toKeyString('user', 'profile', userId); // user:profile:42
	 * ```
	 */
	toKeyString(...parts: Array<string | number>): string {
		for (const p of parts) {
			const s = String(p).trim();

			if (!isStrFilled(s) || s.includes(':') || /[\*\?\[\]\s]/.test(s)) {
				throw new Error(`Key segment is invalid (no ":", spaces or glob chars * ? [ ] allowed): "${s}"`);
			}
		}
		return parts.join(':');
	}

	/**
	 * Splits a Redis key by `:` into non-empty segments.
	 *
	 * @param key - A full Redis key (e.g., "user:profile:42").
	 * @returns An array of key segments (empty segments are filtered out).
	 *
	 * @example
	 * ```ts
	 * pr.fromKeyString('a::b:c') // -> ['a', 'b', 'c']
	 * ```
	 */
	fromKeyString(key: string): Array<string> {
		return key.split(':').filter(Boolean);
	}

	/**
	 * Decodes a stored payload string into a JSON-like value.
	 *
	 * @param value - Raw string returned by Redis (or `null`).
	 * @returns Decoded value:
	 * - `null` if input is not a string (e.g., `null` from Redis),
	 * - `''` for empty string,
	 * - JSON-parsed value (object/array/number/string/boolean) when valid,
	 * - boolean for boolean-like strings (`'true'`, `'false'`, `'yes'`, `'no'`),
	 * - otherwise the original string.
	 *
	 * @remarks
	 * - Use together with {@link toPayload} to round-trip values.
	 * - Only safe JSON types are returned when parsing succeeds.
	 */
	fromPayload(value: string | null): Jsonish {
		if (!isStr(value)) {
			return null;
		}
		if (!isStrFilled(value)) {
			return '';
		}
		try {
			const parsed = jsonDecode(value);

			if (isNum(parsed) 
				|| isBool(parsed) 
				|| isStr(parsed)
				|| isArr(parsed) 
				|| isObj(parsed)) {
				return parsed;
			}
		}
		catch {
		}
		if (isStrBool(value)) {
			return formatToBool(value);
		}
		return value;
	}

	/**
	 * Serializes a JSON-like value to a string suitable for Redis storage.
	 *
	 * @param value - Any JSON-like value.
	 * @returns String representation:
	 * - objects/arrays → JSON string,
	 * - primitives → stringified,
	 * - `null`/`undefined` → `''`.
	 * 
	 * @example
	 * ```ts
	 * pr.toPayload({a:1}) // -> '{"a":1}'
	 * pr.toPayload(true)  // -> "true"
	 * ```
	 * 
	 * @see fromPayload
	 */
	toPayload(value: Jsonish): string {
		if (isArr(value) || isObj(value)) {
			return jsonEncode(value);
		}
		return String(value ?? '');
	}

	/**
	 * Compatibility wrapper for `LPOP key count`.
	 *
	 * If the client supports the multi-arity form (`LPOP key count`), it is used.
	 * Otherwise, performs an atomic emulation via `MULTI`:
	 * `LRANGE key 0 count-1` + `LTRIM key count -1`.
	 *
	 * @param key - List key to pop from.
	 * @param count - Maximum number of items to pop (≥ 1).
	 * @returns An array of raw strings popped in the original order (may be empty).
	 *
	 * @remarks
	 * - Emulation guarantees atomicity within a single Redis transaction.
	 * - Returns `[]` when the list is empty.
	 *
	 * @throws Error
	 * - On invalid parameters or client errors.
	 *
	 * @example
	 * ```ts
	 * const rawItems = await pr.lpopCountCompat('queue:jobs', 100);
	 * ```
	 */
	async lpopCountCompat(key: string, count: number): Promise<string[]> {
		const cli: any = this.redis;

		if (isFunc(cli.lpop)) {
			try {
				const res = await cli.lpop(key, count);
				
				if (isArr(res)) {
					return Array.from(res as ReadonlyArray<string>);
				}
				if (isStr(res)) {
					return [res];
				}
			}
			catch {
			}
		}
		const tx = this.redis.multi();
		
		tx.lrange(key, 0, count - 1);
		tx.ltrim(key, count, -1);

		const execRes = await tx.exec();

		if (!isArrFilled(execRes)) {
			return [];
		}
		const firstTuple = execRes[0] as ExecTuple<string[] | string> | undefined;
		const first = firstTuple?.[1];

		if (isArr(first)) {
			return Array.from(first as ReadonlyArray<string>);
		}
		return [];
	}

	/**
	 * Iteratively scans for keys matching a SCAN/MATCH pattern and returns
	 * up to `limit` unique keys (using `COUNT = scanSize` hints).
	 *
	 * @param pattern - A SCAN MATCH pattern (may include wildcards).
	 * @param limit - Max number of unique keys to return (default `100`).
	 * @param scanSize - COUNT hint for SCAN (default `1000`).
	 * @returns An array of unique keys up to `limit`.
	 *
	 * @remarks
	 * - Use {@link toPatternString} to build the stable base, then append wildcards manually.
	 * - Stops early once `limit` is reached; not guaranteed to be a snapshot.
	 *
	 * @throws Error
	 * - If parameters are invalid.
	 * - If Redis connection is not considered healthy.
	 *
	 * @example
	 * ```ts
	 * const keys = await pr.keys('user:profile:*', 5000, 2000);
	 * ```
	 * 
	 * @see getMany
	 * @see dropMany
	 */
	async keys(pattern: string, limit: number = 100, scanSize: number = 1000): Promise<string[]> {
		if (!isStrFilled(pattern)) {
			throw new Error('Pattern format error.');
		}
		if (!isNumP(limit)) {
			throw new Error('Limit format error.');
		}
		if (!isNumP(scanSize)) {
			throw new Error('Size format error.');
		}
		if (!this.checkConnection()) {
			throw new Error('Redis connection error.');
		}
		const keys: Set<string> = new Set();
		let cursor = '0';

		do {
			const [ nextCursor, found ] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', scanSize);

			cursor = nextCursor;
			
			for (const k of found) {
				if (!keys.has(k)) {
					keys.add(k);

					if (keys.size >= limit) {
						return Array.from(keys);
					}
				}
			}
		} 
		while (cursor !== '0');
		return Array.from(keys);
	}

	/**
	 * Reads a single key via `GET` and decodes it with {@link fromPayload}.
	 *
	 * @param key - Exact key to read.
	 * @returns Decoded value or `null` when the key does not exist.
	 *
	 * @remarks
	 * - Distinguishes between "missing" (`null`) and "existing but empty" (`''`).
	 *
	 * @throws Error
	 * - If `key` is invalid.
	 * - If Redis connection is not considered healthy.
	 *
	 * @example
	 * ```ts
	 * const user = await pr.getOne(pr.toKeyString('user','profile',42));
	 * ```
	 */
	async getOne(key: string): Promise<Jsonish | null> {
		if (!isStrFilled(key)) {
			throw new Error('Key format error.');
		}
		if (!this.checkConnection()) {
			throw new Error('Redis connection error.');
		}
		return this.fromPayload(await this.redis.get(key));
	}

	/**
	 * Batch MGET over keys discovered by SCAN, with chunking to avoid
	 * argument explosion. Each value is decoded via {@link fromPayload}.
	 *
	 * @param pattern - SCAN MATCH pattern used to discover keys.
	 * @param limit - Max number of keys to read (default `100`).
	 * @param scanSize - COUNT hint for SCAN (default `1000`).
	 * @param chunkSize - Max keys per `MGET` batch (default `1000`).
	 * @returns A map `{ key: decodedValue }`.
	 *
	 * @remarks
	 * - Designed for large keyspaces; keeps individual commands reasonably sized.
	 * - If no keys match, returns `{}`.
	 *
	 * @throws Error
	 * - If arguments are invalid.
	 * - If Redis connection is not considered healthy.
	 *
	 * @example
	 * ```ts
	 * const map = await pr.getMany('session:*', 10_000, 1000, 500);
	 * ```
	 */
	async getMany(pattern: string, limit: number = 100, scanSize: number = 1000, chunkSize: number = 1000): Promise<Record<string, Jsonish>> {
		if (!isNumP(chunkSize)) {
			throw new Error('Property "chunkSize" format error.');
		}
		const keys = await this.keys(pattern, limit, scanSize);
		const result: Record<string, Jsonish> = {};

		if (!isArrFilled(keys)) {
			return result;
		}
		for (let i = 0; i < keys.length; i += chunkSize) {
			const chunk = keys.slice(i, i + chunkSize);
			const values: Array<string | null> = await this.redis.mget(...chunk);

			for (let j = 0; j < chunk.length; j++) {
				result[chunk[j]] = this.fromPayload(values[j] ?? null);
			}
		}
		return result;
	}

	/**
	 * Collects up to `limit` items from a Redis list.
	 *
	 * @param key - List key.
	 * @param limit - Maximum number of items to collect (default `100`).
	 * @param remove - Whether to delete items as they are read (default `false`).
	 * @returns An array of decoded items.
	 *
	 * @remarks
	 * - When `remove=true`, performs destructive reads in batches using
	 *   {@link getListIterator} → {@link lpopCountCompat}.
	 * - When `remove=false`, reads by index windows (`LLEN` + `LRANGE`), which is
	 *   **not snapshot-isolated**; concurrent list changes may affect paging.
	 *
	 * @throws Error
	 * - If parameters are invalid.
	 * - If Redis connection is not considered healthy.
	 *
	 * @example
	 * ```ts
	 * // Non-destructive peek at up to 500 items:
	 * const items = await pr.getList('logs:ingest', 500, false);
	 *
	 * // Destructive drain of 1k items:
	 * const drained = await pr.getList('queue:jobs', 1000, true);
	 * ```
	 */
	async getList(key: string, limit: number = 100, remove: boolean = false): Promise<Jsonish[]> {
		if (!isStrFilled(key)) {
			throw new Error('Key format error.');
		}
		if (!isNumP(limit)) {
			throw new Error('Limit format error.');
		}
		const result: Jsonish[] = [];

		for await (const chunk of this.getListIterator(key, limit, remove)) {
			result.push(...chunk);
		}
		return result;
	}

	/**
	 * Async generator that pages through a Redis list.
	 *
	 * @param key - List key.
	 * @param limit - Batch size per page (default `100`).
	 * @param remove - Destructive read toggle (default `false`).
	 * @yields Arrays of decoded items for each page.
	 *
	 * @remarks
	 * - `remove=true`: repeatedly pops up to `limit` items via {@link lpopCountCompat}
	 *   until the list is drained (or a short batch is read). Atomic per batch.
	 * - `remove=false`: pages by index windows (`LLEN`/`LRANGE`), which may observe
	 *   concurrent mutations (not snapshot-isolated).
	 *
	 * @throws Error
	 * - If parameters are invalid.
	 * - If Redis connection is not considered healthy.
	 *
	 * @example
	 * ```ts
	 * for await (const batch of pr.getListIterator('queue:jobs', 256, true)) {
	 *   await processBatch(batch);
	 * }
	 * ```
	 */
	async *getListIterator(key: string, limit: number = 100, remove: boolean = false): AsyncGenerator<Jsonish[], void, unknown> {
		if (!this.checkConnection()) {
			throw new Error('Redis connection error.');
		}
		if (!isStrFilled(key)) {
					throw new Error('Key format error.');
		}
		if (!isNumP(limit)) {
			throw new Error('Limit format error.');
		}
		if (remove) {
			while (true) {
				const items = await this.lpopCountCompat(key, limit);

				if (!isArr(items) || items.length === 0) {
					break;
				}
				yield items.map((item) => this.fromPayload(item));

				if (items.length < limit) {
					break;
				}
			}
			return;
		}
		const n = await this.redis.llen(key);

		if (!isNumP(n)) {
			return;
		}
		let start = 0;
		
		while (start < n) {
			const stop = Math.min(start + limit - 1, n - 1);
			const chunk = await this.redis.lrange(key, start, stop);

			if (chunk.length === 0) {
				start += limit;
				continue;
			}
			yield chunk.map((item) => this.fromPayload(item));

			start += limit;
		}
	}

	/**
	 * Sets a single key via `SET`, optionally with TTL (`EX`).
	 *
	 * @param key - Exact key to write.
	 * @param value - JSON-like value to store (serialized via {@link toPayload}).
	 * @param ttlSec - Optional TTL in seconds.
	 * @returns `'OK'` on success.
	 *
	 * @remarks
	 * - TTL applies to the key as a whole (not to elements of list/hash/etc.).
	 * - Overwrites the previous value if the key exists.
	 *
	 * @throws Error
	 * - If `key` is invalid.
	 * - If Redis connection is not considered healthy.
	 *
	 * @example
	 * ```ts
	 * await pr.setOne('config:featureX', { enabled: true }, 3600);
	 * ```
	 */
	async setOne(key: string, value: any, ttlSec?: number): Promise<'OK'> {
		if (!isStrFilled(key)) {
			throw new Error('Key format error.');
		}
		if (!this.checkConnection()) {
			throw new Error('Redis connection error.');
		}
		return isNumP(ttlSec)
			? await this.redis.set(key, this.toPayload(value), 'EX', ttlSec)
			: await this.redis.set(key, this.toPayload(value));
	}

	/**
	 * Sets multiple keys in one shot.
	 * - Without TTL uses `MSET`.
	 * - With TTL uses a `MULTI` block of individual `SET EX` operations.
	 *
	 * @param values - Array of `{ key, value }` pairs.
	 * @param ttlSec - Optional TTL in seconds to apply uniformly to all keys.
	 * @returns Number of successful writes (`values.length` on full success).
	 *
	 * @remarks
	 * - With TTL, each `SET` and the shared `EXPIRE` per key are executed in a transaction.
	 * - Values are serialized via {@link toPayload}.
	 *
	 * @throws Error
	 * - If arguments are invalid (e.g., bad keys).
	 * - If Redis connection is not considered healthy.
	 *
	 * @example
	 * ```ts
	 * await pr.setMany([
	 *   { key: 'cfg:a', value: 1 },
	 *   { key: 'cfg:b', value: { x: true } },
	 * ], 600);
	 * ```
	 */
	async setMany(values: Array<{ key: string; value: any; }>, ttlSec?: number): Promise<number> {
		if (!isArrFilled(values)) {
			throw new Error('Payload format error.');
		}
		if (!this.checkConnection()) {
			throw new Error('Redis connection error.');
		}
		if (!isNumP(ttlSec)) {
			const kv: string[] = [];

			for (const { key, value } of values) {
				if (!isStrFilled(key)) {
					throw new Error('Key format error.');
				}
				kv.push(key, this.toPayload(value));
			}
			const res = await this.redis.mset(...kv);

			return res === 'OK' 
				? values.length 
				: 0;
		}
		const tx = this.redis.multi();

		for (const { key, value } of values) {
			if (!isStrFilled(key)) {
				throw new Error('Key format error.');
			}
			tx.set(key, this.toPayload(value), 'EX', ttlSec);
		}
		const res = await tx.exec();

		if (!isArrFilled(res)) {
			return 0;
		}
		let ok = 0;

		for (const item of res) {
			if (!isArrFilled(item)) {
				continue;
			}
			const [ err, reply ] = item as [ Error | null, any ];

			if (!err && reply === 'OK') {
				ok++;
			}
		}
		return ok;
	}

	/**
	 * Pushes a single item to the tail of a list (`RPUSH`).
	 * If `ttlSec` is provided, wraps `RPUSH` and `EXPIRE` in a `MULTI` block.
	 *
	 * @param key - List key.
	 * @param value - JSON-like value to append (serialized via {@link toPayload}).
	 * @param ttlSec - Optional TTL for the **list key** in seconds.
	 * @returns The new list length on success, `0` if the MULTI branch fails validation.
	 *
	 * @remarks
	 * - TTL applies to the **list key**, not to individual list items.
	 * - When `ttlSec` is omitted, a single `RPUSH` call is issued.
	 *
	 * @throws Error
	 * - If `key` or `value` are invalid.
	 * - If Redis connection is not considered healthy.
	 *
	 * @example
	 * ```ts
	 * await pr.pushOne('logs:ingest', { msg: 'hello' }, 86400);
	 * ```
	 * 
	 * @see pushMany
	 * @see expire
	 */
	async pushOne(key: string, value: any, ttlSec?: number): Promise<number> {
		if (!isStrFilled(key)) {
			throw new Error('Key format error.');
		}
		if (!this.checkConnection()) {
			throw new Error('Redis connection error.');
		}
		if (isNumP(ttlSec)) {
			const tx = this.redis.multi();
				
			tx.rpush(key, this.toPayload(value));
			tx.expire(key, ttlSec);

			const res = await tx.exec();

			if (isArrFilled(res)) {
				const [[ err1, pushReply ], [ err2, expireReply ]] = res as any;

				if (!err1 && !err2 && isNumPZ(Number(pushReply)) && isNumPZ(Number(expireReply))) {
					return Number(pushReply);
				}
			}
			return 0;
		}
		return await this.redis.rpush(key, this.toPayload(value));
	}

	/**
	 * Pushes multiple items to the tail of a list (`RPUSH ...values`).
	 * If `ttlSec` is provided, wraps `RPUSH` and `EXPIRE` in a `MULTI` block.
	 *
	 * @param key - List key.
	 * @param values - Array of JSON-like values to append (serialized via {@link toPayload}).
	 * @param ttlSec - Optional TTL for the **list key** in seconds.
	 * @returns The new list length on success, `0` if the MULTI branch fails validation.
	 *
	 * @remarks
	 * - TTL applies to the **list key**, not to individual list items.
	 * - Uses a single `RPUSH` with many arguments for efficiency.
	 *
	 * @throws Error
	 * - If `key` is invalid or `values` is empty/invalid.
	 * - If Redis connection is not considered healthy.
	 *
	 * @example
	 * ```ts
	 * await pr.pushMany('queue:jobs', [{id:1},{id:2},{id:3}], 3600);
	 * ```
	 */
	async pushMany(key: string, values: Array<any>, ttlSec?: number): Promise<number> {
		if (!isStrFilled(key)) {
			throw new Error('Key format error.');
		}
		if (!isArrFilled(values)) {
			throw new Error('Payload format error.');
		}
		if (!this.checkConnection()) {
			throw new Error('Redis connection error.');
		}
		if (isNumP(ttlSec)) {
			const tx = this.redis.multi();
			
			tx.rpush(key, ...values.map((value) => this.toPayload(value)));
			tx.expire(key, ttlSec);

			const res = await tx.exec();

			if (isArrFilled(res)) {
				const rpushRes  = res[0] as [ Error | null, number ];
				const expireRes = res[1] as [ Error | null, number ];
				const [ err1, pushReply ] = rpushRes ?? [ new Error('rpush missing'), 0 ];
				const [ err2, expireReply ] = expireRes ?? [ new Error('expire missing'), 0 ];

				if (!err1 && !err2 && isNumPZ(Number(pushReply)) && isNumPZ(Number(expireReply))) {
					return Number(pushReply);
				}
			}
			return 0;
		}
		return await this.redis.rpush(key, ...values.map((value) => this.toPayload(value)));
	}

	/**
	 * Deletes keys matching a SCAN/MATCH pattern by iterating with `SCAN` and
	 * removing in chunks via `UNLINK` (if available) or `DEL` (fallback).
	 *
	 * @param pattern - SCAN MATCH pattern to select keys.
	 * @param size - Chunk size for deletion and the SCAN COUNT hint (default `1000`).
	 * @returns Approximate number of keys matched (attempted for deletion).
	 *
	 * @remarks
	 * - Prefers `UNLINK` for asynchronous deletion to reduce blocking.
	 * - Operates in chunks to avoid large command payloads and blocking scans.
	 *
	 * @throws Error
	 * - If Redis connection is not considered healthy.
	 * - On unexpected errors during scanning/deletion (re-thrown with context).
	 *
	 * @example
	 * ```ts
	 * const n = await pr.dropMany('tmp:*', 2000);
	 * ```
	 */
	async dropMany(pattern: string, size: number = 1000): Promise<number> {
		if (!this.checkConnection()) {
			throw new Error('Redis connection error.');
		}
		try {
			let cursor = '0',
				total = 0;

			do {
				const [ next, keys ] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', size);

				cursor = next;

				if (isArrFilled(keys)) {
					total += keys.length;

					for (let i = 0; i < keys.length; i += size) {
						const chunk = keys.slice(i, i + size);

						isFunc(this.redis.unlink)
							? (await this.redis.unlink(...chunk))
							: (await this.redis.del(...chunk));
					}
				}
			} 
			while (cursor !== '0');
			return total;
		} 
		catch (err) {
		}
		throw new Error('Redis drop many error.');
	}

	/**
	 * Atomically increments an integer value stored at the given key.
	 *
	 * If the key does not exist, Redis initializes it to `0` before performing the
	 * increment, so the first call returns `1`. If the key exists but contains a
	 * non-integer (e.g., JSON/string), Redis will throw a type error.
	 *
	 * @param key - Exact Redis key to increment.
	 * @returns A promise that resolves to the new integer value after increment.
	 *
	 * @remarks
	 * - This is a thin wrapper over Redis `INCR`.
	 * - Operation is atomic on the Redis side.
	 * - Use TTL (`expire`) separately if you need the counter to auto-expire.
	 *
	 * @throws Error
	 * - If the key format is invalid in upstream validation (not enforced here).
	 * - If the Redis connection is down (depending on the client configuration).
	 * - If the key holds a non-integer value (Redis type error).
	 *
	 * @example
	 * ```ts
	 * const counterKey = pr.toKeyString('rate', 'ip', '203.0.113.7');
	 * const n1 = await pr.incr(counterKey); // -> 1 (if no key before)
	 * const n2 = await pr.incr(counterKey); // -> 2
	 * ```
	 */
	async incr(key: string): Promise<number> { 
		return this.redis.incr(key); 
	}

	/**
	 * Sets a time-to-live (TTL) for a key in seconds.
	 *
	 * After the TTL elapses, the key is automatically removed by Redis. If the key
	 * does not exist at the moment of the call, Redis returns `0` and does nothing.
	 *
	 * @param key - Exact Redis key to expire.
	 * @param ttl - Time-to-live in seconds (must be a positive integer).
	 * @returns A promise that resolves to:
	 * - `1` if the timeout was set,
	 * - `0` if the key does not exist or the timeout could not be set.
	 *
	 * @remarks
	 * - This is a thin wrapper over Redis `EXPIRE`.
	 * - Repeated calls update the remaining TTL to the new value.
	 * - To remove expiration (make persistent), use `PERSIST` (не реализовано здесь).
	 * - Expiration applies to the **key as a whole**, not to individual list items.
	 *
	 * @throws Error
	 * - If the Redis connection is down (depending on the client configuration).
	 * - If the client rejects invalid arguments (e.g., negative TTL).
	 *
	 * @example
	 * ```ts
	 * const listKey = pr.toKeyString('logs', 'ingest');
	 * await pr.pushMany(listKey, [{a:1}, {a:2}], 0); // no TTL at push time
	 * const applied = await pr.expire(listKey, 86400); // -> 1 (TTL set to 24h)
	 * ```
	 */
	async expire(key: string, ttl: number): Promise<number> { 
		return this.redis.expire(key, ttl); 
	}
}
