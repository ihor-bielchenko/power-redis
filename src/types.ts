/**
 * @public
 * @packageDocumentation
 * Utility type aliases and Redis client façade interfaces used by the
 * `full-utils` Redis helpers and queue primitives.
 *
 * @remarks
 * These definitions are intentionally **library-agnostic** and cover the
 * smallest common subset of features present in popular Redis clients such as
 * `ioredis` and `node-redis`. They let you write reusable logic that can be
 * typed once and executed against different client implementations—handy for
 * testing and for swapping clients without refactoring the rest of your code.
 *
 * @since 1.0.0
 */

/* =================================================================================
 * JSON helpers
 * ================================================================================= */

/**
 * Primitive JSON values as defined by RFC 7159.
 *
 * @remarks
 * This type is useful when you want to model values that can be safely
 * serialized with `JSON.stringify` and deserialized with `JSON.parse`
 * **without lossy conversions**.
 *
 * @example
 * ```ts
 * const value: JsonPrimitive = 'hello';
 * const other: JsonPrimitive = 42;
 * const flag: JsonPrimitive = false;
 * const empty: JsonPrimitive = null;
 * ```
 *
 * @see {@link Jsonish} for a recursive JSON-like structure.
 * @since 1.0.0
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * A recursive, JSON-serializable structure composed of primitives, arrays,
 * and plain objects with string keys.
 *
 * @remarks
 * - Values conforming to `Jsonish` can be round-tripped with
 *   `JSON.stringify` / `JSON.parse`.
 * - Keys are restricted to strings to match how JSON objects are encoded.
 * - This is useful for defining payloads you intend to store in Redis as
 *   strings (for example, via `SET`, `RPUSH`, or in sorted set members).
 *
 * @example
 * ```ts
 * const payload: Jsonish = {
 *   id: 'u_123',
 *   balance: 19.95,
 *   tags: ['new', 'trial'],
 *   meta: { newsletter: false }
 * };
 * ```
 *
 * @since 1.0.0
 */
export type Jsonish =
	| JsonPrimitive
	| { [key: string]: Jsonish }
	| Jsonish[];

/* =================================================================================
 * Redis transaction (MULTI/EXEC) façade
 * ================================================================================= */

/**
 * A **minimal, chainable** interface describing a Redis MULTI transaction.
 *
 * @remarks
 * Instances of this interface are created by calling {@link IORedisLike.multi}.
 * Each method enqueues a command in the transaction and returns `this` so that
 * you can fluently chain multiple operations before calling {@link exec}.
 *
 * The implementation is expected to mirror Redis semantics:
 * - Commands are queued and **not executed** until `exec()` is called.
 * - `exec()` resolves to an array of `[error, reply]` tuples, one per command,
 *   preserving order.
 *
 * @example
 * ```ts
 * const tx = client.multi()
 *   .set('user:1', JSON.stringify({ id: 1 }))
 *   .expire('user:1', 3600)
 *   .rpush('queue:jobs', 'job-1', 'job-2');
 *
 * const results = await tx.exec();
 * // results: Array<[Error | null, any]>
 * ```
 *
 * @see {@link IORedisLike} for the corresponding client surface.
 * @since 1.0.0
 */
export interface RedisMultiLike {
	/**
	 * Queue `SET key value` into the transaction.
	 *
	 * @param key - Redis key to set.
	 * @param value - Raw string value to store (serialize your objects beforehand).
	 * @returns The same transaction instance for chaining.
	 *
	 * @remarks
	 * Use this overload when no TTL is needed.
	 *
	 * @example
	 * ```ts
	 * multi.set('flags:site-enabled', '1');
	 * ```
	 *
	 * @since 1.0.0
	 */
	set(key: string, value: string): this;

	/**
	 * Queue `SET key value EX ttlSec` into the transaction.
	 *
	 * @param key - Redis key to set.
	 * @param value - Raw string value to store.
	 * @param ex - The literal string `'EX'`; included for stricter typing.
	 * @param ttlSec - Time-to-live in seconds.
	 * @returns The same transaction instance for chaining.
	 *
	 * @remarks
	 * This overload configures an **expiry** alongside the write.
	 *
	 * @example
	 * ```ts
	 * multi.set('session:abc', token, 'EX', 1800);
	 * ```
	 *
	 * @since 1.0.0
	 */
	set(key: string, value: string, ex: 'EX', ttlSec: number): this;

	/**
	 * Queue `RPUSH key ...values`.
	 *
	 * @param key - Target list key.
	 * @param values - One or more string items to append (right push).
	 * @returns The same transaction instance for chaining.
	 *
	 * @remarks
	 * Using lists for queues? Consider pairing with `LMOVE`/`RPOPLPUSH` for
	 * **at-least-once** processing patterns.
	 *
	 * @example
	 * ```ts
	 * multi.rpush('queue:mail', JSON.stringify({ to: 'a@b' }));
	 * ```
	 *
	 * @since 1.0.0
	 */
	rpush(key: string, ...values: string[]): this;

	/**
	 * Queue `LPUSH key ...values`.
	 *
	 * @param key - Target list key.
	 * @param values - One or more string items to prepend (left push).
	 * @returns The same transaction instance for chaining.
	 *
	 * @since 1.0.0
	 */
	lpush(key: string, ...values: string[]): this;

	/**
	 * Queue `LRANGE key start stop`.
	 *
	 * @param key - List key.
	 * @param start - Start index (0-based; `0` is the head).
	 * @param stop - Stop index (inclusive; `-1` for the tail).
	 * @returns The same transaction instance for chaining.
	 *
	 * @since 1.0.0
	 */
	lrange(key: string, start: number, stop: number): this;

	/**
	 * Queue `LTRIM key start stop` to keep only a sub-range of a list.
	 *
	 * @param key - List key.
	 * @param start - Start index to keep.
	 * @param stop - Stop index to keep (inclusive).
	 * @returns The same transaction instance for chaining.
	 *
	 * @example
	 * ```ts
	 * // Keep the most recent 100 items
	 * multi.ltrim('logs:app', -100, -1);
	 * ```
	 *
	 * @since 1.0.0
	 */
	ltrim(key: string, start: number, stop: number): this;

	/**
	 * Queue `LREM key count value` to remove occurrences from a list.
	 *
	 * @param key - List key.
	 * @param count - Removal mode:
	 * `>0` remove from head, `<0` remove from tail, `0` remove all.
	 * @param value - The string to match.
	 * @returns The same transaction instance for chaining.
	 *
	 * @since 1.0.0
	 */
	lrem(key: string, count: number, value: string): this;

	/**
	 * Queue `ZREM key ...members` to remove members from a sorted set.
	 *
	 * @param key - Sorted set key.
	 * @param members - One or more member strings to remove.
	 * @returns The same transaction instance for chaining.
	 *
	 * @since 1.0.0
	 */
	zrem(key: string, ...members: string[]): this;

	/**
	 * Queue `ZADD key score member` to add or update a single member.
	 *
	 * @param key - Sorted set key.
	 * @param score - Numerical score used for ordering.
	 * @param member - Member value (string).
	 * @returns The same transaction instance for chaining.
	 *
	 * @remarks
	 * For bulk `ZADD`, prefer the client method on {@link IORedisLike.zadd}.
	 *
	 * @since 1.0.0
	 */
	zadd(key: string, score: number, member: string): this;

	/**
	 * Queue `EXPIRE key ttlSec` to set an expiry on a key.
	 *
	 * @param key - Any Redis key.
	 * @param ttlSec - Time-to-live in seconds.
	 * @returns The same transaction instance for chaining.
	 *
	 * @since 1.0.0
	 */
	expire(key: string, ttlSec: number): this;

	/**
	 * Execute the queued transaction (`EXEC`) and resolve results.
	 *
	 * @returns A promise resolving to an array of tuples `[error, reply]`,
	 * one per queued command, in the same order.
	 *
	 * @remarks
	 * If the transaction is discarded or aborted by the server, behavior depends
	 * on the underlying client. Many clients reject the promise with an error.
	 *
	 * @example
	 * ```ts
	 * const results = await multi.exec();
	 * for (const [err, reply] of results) {
	 *   if (err) console.error('Command failed:', err.message);
	 * }
	 * ```
	 *
	 * @throws {Error} If the underlying client fails to execute `EXEC`.
	 * @since 1.0.0
	 */
	exec(): Promise<Array<[Error | null, any]>>;
}

/* =================================================================================
 * Redis client façade
 * ================================================================================= */

/**
 * A **lightweight, promise-based** interface describing the subset of methods
 * used by this library from a Redis client such as `ioredis`.
 *
 * @remarks
 * - All methods return promises and are expected to be **single-command** calls
 *   unless otherwise stated.
 * - Optional methods (marked with `?`) may not be present in older servers or
 *   client versions; you should feature-detect before using them.
 * - Keys and values are typed as strings to keep the surface area minimal.
 *
 * @example
 * ```ts
 * async function pushJob(client: IORedisLike, queue: string, job: Jsonish) {
 *   await client.rpush(queue, JSON.stringify(job));
 * }
 * ```
 *
 * @since 1.0.0
 */
export interface IORedisLike {
	/**
	 * Current client status string (e.g. `'ready'`, `'connecting'`).
	 *
	 * @remarks
	 * Intended for simple health checks or readiness gates.
	 *
	 * @since 1.0.0
	 */
	status: 'ready' | 'connecting' | 'reconnecting' | string;

	/**
	 * Cursor-based key scan: `SCAN cursor MATCH pattern COUNT count`.
	 *
	 * @param cursor - The cursor from the previous call, or `'0'` to start.
	 * @param matchKeyword - The literal `'MATCH'` (typed for clarity).
	 * @param pattern - Glob-style pattern (e.g. `logs:*`).
	 * @param countKeyword - The literal `'COUNT'` (typed for clarity).
	 * @param count - Hint for how many keys to return per step.
	 * @returns A tuple `[nextCursor, keys]`. Iteration ends when `nextCursor === '0'`.
	 *
	 * @example
	 * ```ts
	 * let cursor = '0';
	 * do {
	 *   const [next, keys] = await client.scan(cursor, 'MATCH', 'queue:*', 'COUNT', 100);
	 *   // process keys...
	 *   cursor = next;
	 * } while (cursor !== '0');
	 * ```
	 *
	 * @since 1.0.0
	 */
	scan(
		cursor: string,
		matchKeyword: 'MATCH',
		pattern: string,
		countKeyword: 'COUNT',
		count: number
	): Promise<[nextCursor: string, keys: string[]]>;

	/* ----------------------------- String commands ----------------------------- */

	/**
	 * Get the string value of a key: `GET key`.
	 *
	 * @param key - Key to read.
	 * @returns The stored string or `null` if the key does not exist.
	 * @since 1.0.0
	 */
	get(key: string): Promise<string | null>;

	/**
	 * Get multiple keys at once: `MGET key [key ...]`.
	 *
	 * @param keys - One or more keys.
	 * @returns Array of string values or `null` for missing keys, matching the
	 * input order.
	 * @since 1.0.0
	 */
	mget(...keys: string[]): Promise<Array<string | null>>;

	/**
	 * Set a key to a string value: `SET key value`.
	 *
	 * @param key - Key to write.
	 * @param value - Raw string value (serialize complex objects yourself).
	 * @returns `'OK'` if successful.
	 * @since 1.0.0
	 */
	set(key: string, value: string): Promise<'OK'>;

	/**
	 * Set a key with expiry: `SET key value EX ttlSec`.
	 *
	 * @param key - Key to write.
	 * @param value - Raw string value.
	 * @param ex - The literal `'EX'` (seconds).
	 * @param ttlSec - Time-to-live in seconds.
	 * @returns `'OK'` if successful.
	 * @since 1.0.0
	 */
	set(key: string, value: string, ex: 'EX', ttlSec: number): Promise<'OK'>;

	/**
	 * Set multiple keys in one call: `MSET key value [key value ...]`.
	 *
	 * @param keyValues - An even list of alternating keys and values.
	 * @returns `'OK'` if successful.
	 * @since 1.0.0
	 */
	mset(...keyValues: string[]): Promise<'OK'>;

	/**
	 * Atomically increment a key: `INCR key`.
	 *
	 * @param key - Counter key (created as `0` if it does not exist).
	 * @returns The new value after increment.
	 * @since 1.0.0
	 */
	incr(key: string): Promise<number>;

	/* -------------------------------- List API -------------------------------- */

	/**
	 * Length of a list: `LLEN key`.
	 *
	 * @param key - List key.
	 * @returns Number of elements in the list.
	 * @since 1.0.0
	 */
	llen(key: string): Promise<number>;

	/**
	 * Get a range from a list: `LRANGE key start stop`.
	 *
	 * @param key - List key.
	 * @param start - Start index (0-based).
	 * @param stop - Stop index (inclusive; `-1` for tail).
	 * @returns Array of string elements.
	 * @since 1.0.0
	 */
	lrange(key: string, start: number, stop: number): Promise<string[]>;

	/**
	 * Pop from the left: `LPOP key [count]`.
	 *
	 * @param key - List key.
	 * @param count - Optional number of elements to pop (server ≥ 6.2).
	 * @returns A single string, an array of strings (when `count` is provided),
	 * or `null` if the list is empty.
	 * @since 1.0.0
	 */
	lpop(key: string, count?: number): Promise<string[] | string | null>;

	/**
	 * Push to the right: `RPUSH key ...values`.
	 *
	 * @param key - List key.
	 * @param values - One or more items to append.
	 * @returns New length of the list.
	 * @since 1.0.0
	 */
	rpush(key: string, ...values: string[]): Promise<number>;

	/**
	 * Push to the left: `LPUSH key ...values`.
	 *
	 * @param key - List key.
	 * @param values - One or more items to prepend.
	 * @returns New length of the list.
	 * @since 1.0.0
	 */
	lpush(key: string, ...values: string[]): Promise<number>;

	/**
	 * Trim a list to a sub-range: `LTRIM key start stop`.
	 *
	 * @param key - List key.
	 * @param start - Start index to keep.
	 * @param stop - Stop index to keep (inclusive).
	 * @returns `'OK'` on success.
	 * @since 1.0.0
	 */
	ltrim(key: string, start: number, stop: number): Promise<'OK'>;

	/**
	 * Remove occurrences from a list: `LREM key count value`.
	 *
	 * @param key - List key.
	 * @param count - `>0` from head, `<0` from tail, `0` remove all.
	 * @param value - String to match.
	 * @returns Number of removed elements.
	 * @since 1.0.0
	 */
	lrem(key: string, count: number, value: string): Promise<number>;

	/**
	 * Move one element atomically between lists: `LMOVE`.
	 *
	 * @param source - Source list key.
	 * @param destination - Destination list key.
	 * @param whereFrom - `'LEFT'` or `'RIGHT'` side of the source.
	 * @param whereTo - `'LEFT'` or `'RIGHT'` side of the destination.
	 * @returns The moved element, or `null` if the source was empty.
	 *
	 * @remarks
	 * Optional: may be unavailable in older Redis versions (< 6.2).
	 * Feature-detect before using.
	 *
	 * @since 1.0.0
	 */
	lmove?(
		source: string,
		destination: string,
		whereFrom: 'LEFT' | 'RIGHT',
		whereTo: 'LEFT' | 'RIGHT'
	): Promise<string | null>;

	/**
	 * Fallback atomic move: `RPOPLPUSH source destination`.
	 *
	 * @param source - Source list key (pop from right).
	 * @param destination - Destination list key (push to left).
	 * @returns The moved element or `null` if the source was empty.
	 *
	 * @remarks
	 * Optional: older pattern used before `LMOVE` existed.
	 *
	 * @since 1.0.0
	 */
	rpoplpush?(source: string, destination: string): Promise<string | null>;

	/* ---------------------------- Sorted set commands --------------------------- */

	/**
	 * Add elements to a sorted set: `ZADD key ...args`.
	 *
	 * @param args - A sequence of options and/or `score member` pairs.
	 * Common patterns:
	 * - `score1, member1, score2, member2, ...`
	 * - with modifiers like `'NX' | 'XX' | 'CH' | 'INCR'` depending on the client.
	 * @returns The number of new elements added (not including updated ones).
	 *
	 * @example
	 * ```ts
	 * await client.zadd('schedule', 1690000000, 'job-1', 1690000100, 'job-2');
	 * ```
	 *
	 * @since 1.0.0
	 */
	zadd(key: string, ...args: (string | number)[]): Promise<number>;

	/**
	 * Remove members from a sorted set: `ZREM key ...members`.
	 *
	 * @param members - One or more member strings to remove.
	 * @returns The number of removed elements.
	 * @since 1.0.0
	 */
	zrem(key: string, ...members: string[]): Promise<number>;

	/**
	 * Range query by score: `ZRANGEBYSCORE key min max [WITHSCORES] [LIMIT offset count]`.
	 *
	 * @param key - Sorted set key.
	 * @param min - Minimum score (number or string like `'(42'` for exclusive).
	 * @param max - Maximum score (number or string like `'(100'` for exclusive).
	 * @param args - Optional flags such as `'WITHSCORES'`, `'LIMIT'`, etc.
	 * @returns Array of members (and optionally scores, depending on flags).
	 *
	 * @example
	 * ```ts
	 * // Get due jobs
	 * const now = Date.now();
	 * const jobs = await client.zrangebyscore('schedule', 0, now, 'LIMIT', 0, 100);
	 * ```
	 *
	 * @since 1.0.0
	 */
	zrangebyscore(
		key: string,
		min: number | string,
		max: number | string,
		...args: (string | number)[]
	): Promise<string[]>;

	/* --------------------------------- Key TTL --------------------------------- */

	/**
	 * Set a key expiry in seconds: `EXPIRE key ttlSec`.
	 *
	 * @param key - Any key.
	 * @param ttlSec - Time-to-live in seconds.
	 * @returns `1` if the timeout was set, `0` if the key does not exist.
	 * @since 1.0.0
	 */
	expire(key: string, ttlSec: number): Promise<number>;

	/* ---------------------------- Deletion/Unlinking ---------------------------- */

	/**
	 * Asynchronously unlink (free) keys: `UNLINK ...keys`.
	 *
	 * @param keys - One or more keys to unlink.
	 * @returns Number of keys unlinked.
	 *
	 * @remarks
	 * Optional: Some clients expose `UNLINK`; use `DEL` as a fallback.
	 *
	 * @since 1.0.0
	 */
	unlink?(...keys: string[]): Promise<number>;

	/**
	 * Synchronously delete keys: `DEL ...keys`.
	 *
	 * @param keys - One or more keys to delete.
	 * @returns Number of keys removed.
	 * @since 1.0.0
	 */
	del(...keys: string[]): Promise<number>;

	/* --------------------------------- MULTI/EXEC ------------------------------- */

	/**
	 * Start a transaction: `MULTI`.
	 *
	 * @returns A chainable transaction object; call {@link RedisMultiLike.exec}
	 * to actually run the queued commands.
	 *
	 * @since 1.0.0
	 */
	multi(): RedisMultiLike;

	/* ---------------------------------- Scripts -------------------------------- */

	/**
	 * Load a Lua script into the script cache: `SCRIPT LOAD script`.
	 *
	 * @param subcommand - Must be the literal `'LOAD'`.
	 * @param script - The Lua source code.
	 * @returns The SHA1 digest string of the script.
	 *
	 * @remarks
	 * Optional: Not all client builds expose `script()`. Use `eval` as a fallback.
	 *
	 * @since 1.0.0
	 */
	script?(
		subcommand: 'LOAD',
		script: string
	): Promise<string>;

	/**
	 * Execute a cached script by SHA1: `EVALSHA sha1 numKeys ...args`.
	 *
	 * @param sha1 - SHA1 of a previously loaded script.
	 * @param numKeys - Number of key arguments that follow.
	 * @param args - Keys first, then other arguments, as strings.
	 * @returns Script result (type depends on the script).
	 *
	 * @remarks
	 * Optional: Make sure the script is loaded (or catch `NOSCRIPT` and fall back
	 * to {@link eval}).
	 *
	 * @since 1.0.0
	 */
	evalsha?(
		sha1: string,
		numKeys: number,
		...args: string[]
	): Promise<any>;

	/**
	 * Execute a Lua script directly: `EVAL script numKeys ...args`.
	 *
	 * @param script - Lua source code.
	 * @param numKeys - Number of key arguments that follow.
	 * @param args - Keys first, then other arguments, as strings.
	 * @returns Script result (type depends on the script).
	 *
	 * @since 1.0.0
	 */
	eval?(
		script: string,
		numKeys: number,
		...args: string[]
	): Promise<any>;
}
