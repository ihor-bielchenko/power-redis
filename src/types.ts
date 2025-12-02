
/**
 * Represents the simplest JSON-compatible value types.
 *
 * This type includes only the scalar (primitive) values that can appear
 * in valid JSON: strings, numbers, booleans, and `null`.
 *
 * @remarks
 * `JsonPrimitive` is a foundational building block for more complex
 * recursive JSON structures such as {@link Jsonish}. It ensures that
 * the value is strictly JSON-serializable without any custom logic.
 *
 * This type intentionally excludes:
 * - `undefined` (not valid JSON)
 * - functions
 * - symbols
 * - BigInt values
 * - non-serializable objects
 *
 * @example
 * ```ts
 * const a: JsonPrimitive = "hello";   // ok
 * const b: JsonPrimitive = 123;       // ok
 * const c: JsonPrimitive = true;      // ok
 * const d: JsonPrimitive = null;      // ok
 *
 * const e: JsonPrimitive = undefined; // not allowed
 * const f: JsonPrimitive = { x: 1 };  // not allowed
 * ```
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * Extends {@link JsonPrimitive} by allowing `undefined`.
 *
 * This type is useful in situations where a value may be:
 * - a valid JSON primitive (string, number, boolean, null), or
 * - intentionally `undefined` (for example, missing fields,
 *   optional parameters, or uninitialized variables).
 *
 * @remarks
 * Although `undefined` is not valid JSON, it often appears in real-world
 * TypeScript code—especially when building objects before serialization
 * or handling optional values.  
 *
 * `JsonPrimitiveOrUndefined` is typically used in parsing, mapping,
 * or transforming data where a field may or may not exist yet.
 *
 * @example
 * ```ts
 * const a: JsonPrimitiveOrUndefined = "hello";   // ok
 * const b: JsonPrimitiveOrUndefined = null;      // ok
 * const c: JsonPrimitiveOrUndefined = 42;        // ok
 * const d: JsonPrimitiveOrUndefined = undefined; // ok
 *
 * const e: JsonPrimitiveOrUndefined = { x: 1 };  // not allowed
 * ```
 */
export type JsonPrimitiveOrUndefined = JsonPrimitive | undefined;

/**
 * Represents any valid JSON-like structure.
 *
 * `Jsonish` is a recursive type that includes:
 * - JSON primitives: {@link JsonPrimitive}
 * - JSON objects (key-value pairs where values are also `Jsonish`)
 * - JSON arrays containing `Jsonish` elements
 *
 * @remarks
 * This type models the full shape of JSON data while remaining flexible
 * enough for general-purpose serialization/deserialization workflows.
 *
 * It allows building complex nested structures such as:
 * - arrays of objects  
 * - objects containing arrays  
 * - deeply recursive trees  
 *
 * It is used throughout {@link PowerRedis} to represent structured values
 * stored in Redis (after encoding/decoding with `jsonEncode` / `jsonDecode`).
 *
 * @example
 * ```ts
 * const a: Jsonish = "hello";                  // primitive
 * const b: Jsonish = [1, "two", true];         // array of primitives
 * const c: Jsonish = { x: 1, y: "text" };      // simple object
 * const d: Jsonish = {                         // deeply nested structure
 *   user: {
 *     id: 123,
 *     tags: ["admin", "active"],
 *     profile: {
 *       name: "Alice",
 *       meta: { verified: true }
 *     }
 *   }
 * };
 *
 * const e: Jsonish = undefined; // not allowed (undefined is not valid JSON)
 * ```
 *
 * Unlike JavaScript objects, JSON objects:
 * - must have string keys  
 * - must not contain functions, symbols, or undefined values  
 * - must not contain circular references  
 *
 * If you need to represent optional or undefined values before serialization,
 * consider using {@link JsonPrimitiveOrUndefined}.
 */
export type Jsonish =
	| JsonPrimitive
	| { [key: string]: Jsonish }
	| Jsonish[];

/**
 * Transaction / pipeline interface used by {@link PowerRedis}.
 *
 * This interface represents a minimal subset of a Redis `MULTI` object
 * (for example from `ioredis`), which allows you to queue multiple
 * commands and then execute them in one go with {@link exec}.
 *
 * @remarks
 * - All modifier methods (`set`, `rpush`, `lrange`, etc.) must be chainable:
 *   they return `this` so you can write `multi.set(...).expire(...).exec()`.
 * - `exec()` actually sends all queued commands to Redis and resolves with
 *   their results.
 * - The real atomicity and behaviour depend on the underlying client
 *   (some clients use true Redis `MULTI/EXEC`, others may simulate a batch).
 */
export interface RedisMultiLike {
	/**
	 * Queues a `SET` command with expiration in seconds.
	 *
	 * @param key - Exact key name.
	 * @param value - Value to store (already serialized to string).
	 * @param ex - Literal `'EX'` keyword (expire in seconds).
	 * @param ttlSec - Time-to-live in seconds.
	 * @returns `this` for chaining.
	 *
	 * @remarks
	 * Equivalent to `SET key value EX ttlSec` inside a transaction.
	 */
	set(key: string, value: string, ex: 'EX', ttlSec: number): this;

	/**
	 * Queues an `RPUSH` command (push to the tail/right of a list).
	 *
	 * @param key - List key.
	 * @param values - One or more values to push (already serialized).
	 * @returns `this` for chaining.
	 *
	 * @remarks
	 * Equivalent to `RPUSH key value1 value2 ...` inside a transaction.
	 */
	rpush(key: string, ...values: string[]): this;

	/**
	 * Queues an `LPUSH` command (push to the head/left of a list).
	 *
	 * @param key - List key.
	 * @param values - One or more values to push (already serialized).
	 * @returns `this` for chaining.
	 *
	 * @remarks
	 * Equivalent to `LPUSH key value1 value2 ...` inside a transaction.
	 */
	lpush(key: string, ...values: string[]): this;

	/**
	 * Queues an `LRANGE` command.
	 *
	 * @param key - List key.
	 * @param start
	 * Zero-based start index (inclusive). Negative values are allowed.
	 * @param stop
	 * Zero-based end index (inclusive). Negative values are allowed.
	 * @returns `this` for chaining.
	 *
	 * @remarks
	 * Equivalent to `LRANGE key start stop` inside a transaction.
	 * The resulting list of elements will be part of the `exec()` result.
	 */
	lrange(key: string, start: number, stop: number): this;

	/**
	 * Queues an `LTRIM` command.
	 *
	 * @param key - List key.
	 * @param start
	 * Zero-based start index (inclusive). Negative values are allowed.
	 * @param stop
	 * Zero-based end index (inclusive). Negative values are allowed.
	 * @returns `this` for chaining.
	 *
	 * @remarks
	 * Equivalent to `LTRIM key start stop` inside a transaction.
	 * Elements outside the range are removed.
	 */
	ltrim(key: string, start: number, stop: number): this;

	/**
	 * Queues an `LREM` command.
	 *
	 * @param key - List key.
	 * @param count
	 * Controls how many elements to remove:
	 * - `> 0` - remove up to `count` occurrences from head to tail.
	 * - `< 0` - remove up to `|count|` occurrences from tail to head.
	 * - `0` - remove all occurrences.
	 * @param value - Value to remove (already serialized).
	 * @returns `this` for chaining.
	 *
	 * @remarks
	 * Equivalent to `LREM key count value` inside a transaction.
	 */
	lrem(key: string, count: number, value: string): this;

	/**
	 * Queues a `ZREM` command on a sorted set.
	 *
	 * @param key - Sorted set key.
	 * @param members - Members to remove.
	 * @returns `this` for chaining.
	 *
	 * @remarks
	 * Equivalent to `ZREM key member1 member2 ...` inside a transaction.
	 */
	zrem(key: string, ...members: string[]): this;

	/**
	 * Queues a `ZADD` command on a sorted set.
	 *
	 * @param key - Sorted set key.
	 * @param score - Numeric score associated with the member.
	 * @param member - Member value (already serialized).
	 * @returns `this` for chaining.
	 *
	 * @remarks
	 * This minimal signature corresponds to the common pattern
	 * `ZADD key score member` inside a transaction.
	 */
	zadd(key: string, score: number, member: string): this;

	/**
	 * Queues an `EXPIRE` command.
	 *
	 * @param key - Key to set expiration for.
	 * @param ttlSec - Time-to-live in seconds.
	 * @returns `this` for chaining.
	 *
	 * @remarks
	 * Equivalent to `EXPIRE key ttlSec` inside a transaction.
	 */
	expire(key: string, ttlSec: number): this;

	/**
	 * Executes all queued commands in the transaction.
	 *
	 * @returns
	 * A promise that resolves to an array of tuples:
	 * `[error, result]` for each queued command, in the same order
	 * they were added.
	 *
	 * - `error` is `null` if the command succeeded, or an `Error`
	 *   instance if the command failed.
	 * - `result` is the raw reply from Redis (string, number, array, etc.),
	 *   depending on the command.
	 *
	 * @example
	 * ```ts
	 * const multi = client.multi();
	 *
	 * multi
	 *   .set('key', 'value')
	 *   .expire('key', 60);
	 *
	 * const replies = await multi.exec();
	 * // replies[0] -> [null, 'OK']
	 * // replies[1] -> [null, 1]
	 * ```
	 *
	 * @remarks
	 * This should correspond to the Redis `EXEC` command for a `MULTI`
	 * transaction, or a similar batch execution in the underlying client.
	 */
	exec(): Promise<Array<[Error | null, any]>>;
}

/**
 * Minimal Redis client contract used by {@link PowerRedis}.
 *
 * This interface describes only the subset of Redis commands that
 * `PowerRedis` depends on. Any real Redis client (for example `ioredis`)
 * can be wrapped/adapted to match this shape.
 *
 * @remarks
 * - All methods are asynchronous and return `Promise` results.
 * - Error handling is left to the concrete implementation
 *   (network errors, timeouts, etc.).
 * - This interface is intentionally generic and does **not** depend
 *   on a specific Redis client library.
 */
export interface IORedisLike {
	/**
	 * Current connection status of the Redis client.
	 *
	 * @remarks
	 * Typical values:
	 * - `'ready'` - connection established and ready to use.
	 * - `'connecting'` - connecting and not yet ready.
	 * - `'reconnecting'` - trying to reconnect after a failure.
	 * - Any other string is implementation-specific.
	 *
	 * `PowerRedis.checkConnection()` uses this field to decide whether
	 * it is safe to send commands.
	 */
	status: 'ready' | 'connecting' | 'reconnecting' | string;

	/**
	 * Incrementally scans the keyspace and returns a "page" of keys.
	 *
	 * @param cursor
	 * Starting cursor. Use `'0'` for the initial call. The returned
	 * `nextCursor` must be passed to the next `scan` call until it
	 * becomes `'0'`, which means the scan is complete.
	 * @param matchKeyword
	 * Literal `'MATCH'` keyword. Kept to mirror the Redis command
	 * signature and avoid magic strings in callers.
	 * @param pattern
	 * Glob pattern to filter keys (for example: `"user:*"`).
	 * @param countKeyword
	 * Literal `'COUNT'` keyword. Kept for API symmetry.
	 * @param count
	 * Hint for how many keys Redis should try to return in this batch.
	 * Not a hard limit; Redis may return fewer or more.
	 *
	 * @returns
	 * A tuple `[nextCursor, keys]`:
	 * - `nextCursor` - cursor for the next call or `'0'` if finished.
	 * - `keys` - list of keys matching the pattern for this batch.
	 *
	 * @remarks
	 * This method should be a thin wrapper around the Redis `SCAN`
	 * command. It must never block on scanning the entire keyspace.
	 */
	scan(
		cursor: string,
		matchKeyword: 'MATCH',
		pattern: string,
		countKeyword: 'COUNT',
		count: number
	): Promise<[nextCursor: string, keys: string[]]>;

	/**
	 * Fetches the string value stored at the given key.
	 *
	 * @param key - Exact key name.
	 * @returns
	 * - The stored string value, if the key exists.
	 * - `null` if the key does not exist.
	 */
	get(key: string): Promise<string | null>;

	/**
	 * Fetches the string values for multiple keys at once.
	 *
	 * @param keys - List of keys to retrieve.
	 * @returns
	 * Array of values in the same order as the keys:
	 * - Each element is a string value or `null` if the key is missing.
	 */
	mget(...keys: string[]): Promise<Array<string | null>>;

	/**
	 * Sets the value of a key with a TTL (time-to-live).
	 *
	 * @param key - Exact key name.
	 * @param value - Value to store (already serialized to string).
	 * @param ex - Literal `'EX'` keyword (expire in seconds).
	 * @param ttlSec - Expiration time in seconds.
	 * @returns `'OK'` on success.
	 *
	 * @remarks
	 * This should correspond to the Redis
	 * `SET key value EX ttlSec` command.
	 */
	set(key: string, value: string, ex: 'EX', ttlSec: number): Promise<'OK'>;

	/**
	 * Sets multiple key-value pairs in one call.
	 *
	 * @param keyValues
	 * Flat list of alternating key and value: `[key1, value1, key2, value2, ...]`.
	 * All values must already be serialized to strings.
	 * @returns `'OK'` on success.
	 *
	 * @remarks
	 * This should correspond to the Redis `MSET` command.
	 */
	mset(...keyValues: string[]): Promise<'OK'>;

	/**
	 * Atomically increments a numeric counter stored at the given key.
	 *
	 * @param key - Counter key.
	 * @param ttl
	 * Optional TTL in **milliseconds** that the implementation may choose
	 * to apply after incrementing (for example via `PEXPIRE`). Some
	 * clients may ignore this parameter.
	 * @returns
	 * The new counter value after increment.
	 *
	 * @remarks
	 * This is usually a wrapper around the Redis `INCR` command.
	 * The optional `ttl` argument is an extension specific to this
	 * interface and is not part of the native Redis protocol.
	 */
	incr(key: string, ttl?: number): Promise<number>;

	/**
	 * Returns the length of a list (number of elements).
	 *
	 * @param key - List key.
	 * @returns
	 * - Number of elements in the list.
	 * - `0` if the key does not exist or is empty.
	 */
	llen(key: string): Promise<number>;

	/**
	 * Returns a range of elements from a list.
	 *
	 * @param key - List key.
	 * @param start
	 * Zero-based start index (inclusive). Negative values are allowed
	 * and follow Redis behaviour.
	 * @param stop
	 * Zero-based end index (inclusive). Negative values are allowed.
	 * @returns
	 * Array of string elements in the requested range (may be empty).
	 *
	 * @remarks
	 * This should correspond to the Redis `LRANGE` command.
	 */
	lrange(key: string, start: number, stop: number): Promise<string[]>;

	/**
	 * Pops one or multiple elements from the head (left side) of a list.
	 *
	 * @param key - List key.
	 * @param count
	 * Optional number of items to pop. If omitted, only one element should
	 * be removed and returned.
	 * @returns
	 * - A single string or an array of strings depending on the client
	 *   implementation and the `count` parameter.
	 * - `null` if the list is empty or the key does not exist.
	 *
	 * @remarks
	 * This should correspond to Redis `LPOP` (with or without count).
	 * `PowerRedis.lpopCountCompat` is designed to work around different
	 * client behaviours for this command.
	 */
	lpop(key: string, count?: number): Promise<string[] | string | null>;

	/**
	 * Pushes one or more elements to the tail (right side) of a list.
	 *
	 * @param key - List key.
	 * @param values - One or more values to push (already serialized).
	 * @returns
	 * New length of the list after the push.
	 *
	 * @remarks
	 * This should correspond to the Redis `RPUSH` command.
	 */
	rpush(key: string, ...values: string[]): Promise<number>;

	/**
	 * Pushes one or more elements to the head (left side) of a list.
	 *
	 * @param key - List key.
	 * @param values - One or more values to push (already serialized).
	 * @returns
	 * New length of the list after the push.
	 *
	 * @remarks
	 * This should correspond to the Redis `LPUSH` command.
	 */
	lpush(key: string, ...values: string[]): Promise<number>;

	/**
	 * Trims a list to keep only the specified range of elements.
	 *
	 * @param key - List key.
	 * @param start
	 * Zero-based start index (inclusive). Negative values are allowed.
	 * @param stop
	 * Zero-based end index (inclusive). Negative values are allowed.
	 * @returns `'OK'` on success.
	 *
	 * @remarks
	 * This should correspond to the Redis `LTRIM` command.
	 * Elements outside the range are removed.
	 */
	ltrim(key: string, start: number, stop: number): Promise<'OK'>;

	/**
	 * Removes elements equal to the given value from a list.
	 *
	 * @param key - List key.
	 * @param count
	 * Controls how many elements to remove:
	 * - `> 0` - remove up to `count` occurrences from head to tail.
	 * - `< 0` - remove up to `|count|` occurrences from tail to head.
	 * - `0` - remove all occurrences.
	 * @param value - Value to remove (already serialized).
	 * @returns
	 * Number of removed elements (may be `0`).
	 *
	 * @remarks
	 * This should correspond to the Redis `LREM` command.
	 */
	lrem(key: string, count: number, value: string): Promise<number>;

	/**
	 * Moves an element from one list to another.
	 *
	 * @param source - Source list key.
	 * @param destination - Destination list key.
	 * @param whereFrom
	 * Side to pop from the source list (`'LEFT'` or `'RIGHT'`).
	 * @param whereTo
	 * Side to push into the destination list (`'LEFT'` or `'RIGHT'`).
	 * @returns
	 * - The moved element as a string.
	 * - `null` if the source list is empty or does not exist.
	 *
	 * @remarks
	 * This should correspond to the Redis `LMOVE` command.
	 * The method is optional (`?`) because some clients may not support it.
	 */
	lmove?(
		source: string,
		destination: string,
		whereFrom: 'LEFT' | 'RIGHT',
		whereTo: 'LEFT' | 'RIGHT'
	): Promise<string | null>;

	/**
	 * Pops an element from one list and pushes it into another.
	 *
	 * @param source - Source list key.
	 * @param destination - Destination list key.
	 * @returns
	 * - The moved element as a string.
	 * - `null` if the source list is empty or does not exist.
	 *
	 * @remarks
	 * This should correspond to the Redis `RPOPLPUSH` command.
	 * The method is optional (`?`) because some clients may not support it.
	 */
	rpoplpush?(source: string, destination: string): Promise<string | null>;

	/**
	 * Adds one or more members with scores to a sorted set.
	 *
	 * @param key - Sorted set key.
	 * @param args
	 * List of arguments following the Redis `ZADD` syntax, for example:
	 * `score1, member1, score2, member2, ...`.
	 * @returns
	 * Number of elements added to the sorted set (excluding updated members).
	 *
	 * @remarks
	 * This should correspond to the Redis `ZADD` command.
	 */
	zadd(key: string, ...args: (string | number)[]): Promise<number>;

	/**
	 * Removes one or more members from a sorted set.
	 *
	 * @param key - Sorted set key.
	 * @param members - Members to remove.
	 * @returns
	 * Number of removed members (may be `0`).
	 *
	 * @remarks
	 * This should correspond to the Redis `ZREM` command.
	 */
	zrem(key: string, ...members: string[]): Promise<number>;

	/**
	 * Returns members in a sorted set within a score range.
	 *
	 * @param key - Sorted set key.
	 * @param min
	 * Minimum score (inclusive by default). Can be a number or a string
	 * like `"-inf"` or `"(10"` (exclusive).
	 * @param max
	 * Maximum score (inclusive by default). Can be a number or a string
	 * like `"+inf"` or `"(20"` (exclusive).
	 * @param args
	 * Additional options (for example `'WITHSCORES'`, `LIMIT`, etc.),
	 * passed directly to the underlying client.
	 * @returns
	 * Array of members (and possibly scores, depending on `args`).
	 *
	 * @remarks
	 * This should correspond to the Redis `ZRANGEBYSCORE` command.
	 */
	zrangebyscore(
		key: string,
		min: number | string,
		max: number | string,
		...args: (string | number)[]
	): Promise<string[]>;

	/**
	 * Sets a key expiration in seconds.
	 *
	 * @param key - Key to expire.
	 * @param ttlSec - Time-to-live in seconds.
	 * @returns
	 * - `1` if the timeout was set.
	 * - `0` if the key does not exist or the timeout could not be set.
	 *
	 * @remarks
	 * This should correspond to the Redis `EXPIRE` command.
	 */
	expire(key: string, ttlSec: number): Promise<number>;

	/**
	 * Removes keys asynchronously using the Redis `UNLINK` command.
	 *
	 * @param keys - One or more keys to remove.
	 * @returns
	 * Number of keys that were unlinked (may be `0`).
	 *
	 * @remarks
	 * This method is optional (`?`) because some clients or Redis
	 * versions may not support `UNLINK`. When not available, callers
	 * should fallback to `del`.
	 */
	unlink?(...keys: string[]): Promise<number>;

	/**
	 * Removes keys synchronously using the Redis `DEL` command.
	 *
	 * @param keys - One or more keys to delete.
	 * @returns
	 * Number of keys that were deleted (may be `0`).
	 */
	del(...keys: string[]): Promise<number>;

	/**
	 * Starts a Redis transaction / batch of commands.
	 *
	 * @returns
	 * A `RedisMultiLike` instance used to queue multiple commands and
	 * execute them atomically with `.exec()`.
	 *
	 * @remarks
	 * This should correspond to the `MULTI` pattern in Redis clients.
	 * The exact atomicity semantics depend on the underlying client.
	 */
	multi(): RedisMultiLike;

	/**
	 * Loads a Lua script into Redis and returns its SHA1 hash.
	 *
	 * @param subcommand
	 * Literal `'LOAD'` keyword (only subcommand used here).
	 * @param script
	 * Lua script source code.
	 * @returns
	 * SHA1 hash of the stored script, which can be used with `EVALSHA`.
	 *
	 * @remarks
	 * This should correspond to the Redis `SCRIPT LOAD` command.
	 * The method is optional (`?`) because some clients may not
	 * expose Redis scripting.
	 */
	script?(
		subcommand: 'LOAD',
		script: string
	): Promise<string>;

	/**
	 * Executes a previously loaded Lua script by its SHA1 hash.
	 *
	 * @param sha1 - SHA1 hash returned by `SCRIPT LOAD`.
	 * @param numKeys
	 * Number of key arguments that follow. The first `numKeys` items
	 * in `args` are treated as keys, the rest as additional arguments.
	 * @param args
	 * Keys and arguments passed to the Lua script.
	 * @returns
	 * Script result (type depends on the script logic).
	 *
	 * @remarks
	 * This should correspond to the Redis `EVALSHA` command.
	 * The method is optional (`?`) because some clients may not
	 * expose Redis scripting.
	 */
	evalsha?(
		sha1: string,
		numKeys: number,
		...args: string[]
	): Promise<any>;

	/**
	 * Executes an inline Lua script.
	 *
	 * @param script - Lua script source code.
	 * @param numKeys
	 * Number of key arguments that follow. The first `numKeys` items
	 * in `args` are treated as keys, the rest as additional arguments.
	 * @param args
	 * Keys and arguments passed to the Lua script.
	 * @returns
	 * Script result (type depends on the script logic).
	 *
	 * @remarks
	 * This should correspond to the Redis `EVAL` command.
	 * The method is optional (`?`) because some clients may not
	 * expose Redis scripting.
	 */
	eval?(
		script: string,
		numKeys: number,
		...args: string[]
	): Promise<any>;
}