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
	formatToTrim,
	formatToBool,
} from 'full-utils';
import type { 
	IORedisLike,
	Jsonish, 
} from './types';

type ExecTuple<T = any> = [Error | null, T];
type ExecResult<T = any> = Array<ExecTuple<T>> | null;

/**
 * Base helper for working with Redis in a safe and convenient way.
 *
 * @remarks
 * This class wraps a single Redis client and gives you a small, consistent
 * toolkit for the most common operations:
 *
 * - **Keys & patterns**: `toKeyString`, `toPatternString`, `fromKeyString`
 * - **Value (de)serialization**: `toPayload`, `fromPayload` (JSON, numbers, booleans, etc.)
 * - **Simple cache API**: `getOne`, `getMany`, `setOne`, `setMany`
 * - **List helpers**: `pushOne`, `pushMany`, `getList`, `getListIterator`
 * - **Scanning & cleanup**: `keys`, `dropMany`
 * - **Counters & TTL**: `incr`, `expire`, `pttl`
 * - **Streams & scripts**: `script`, `xgroup`, `xreadgroup`
 *
 * The idea is that your business code works with typed JS values
 * (`Jsonish`) instead of raw strings and you get basic safety checks
 * (key format, limits, connection status) out of the box.
 *
 * @example Basic usage
 * ```ts
 * class AppRedis extends PowerRedis {
 *   public redis: IORedisLike;
 *
 *   constructor(client: IORedisLike) {
 *     super();
 *     this.redis = client;
 *   }
 * }
 *
 * const appRedis = new AppRedis(redisClient);
 *
 * // Save object as JSON with TTL
 * await appRedis.setOne('user:1', { id: 1, name: 'Alice' }, 60);
 *
 * // Read it back as a JS object
 * const user = await appRedis.getOne('user:1'); // { id: 1, name: 'Alice' }
 * ```
 *
 * @example Connection safety
 * `checkConnection()` respects the `REDIS_STRICT_CHECK_CONNECTION` env var:
 *
 * - `true` / `on` / `yes` / `y` / `1` → only `status === 'ready'` is accepted
 * - otherwise `connecting` / `reconnecting` are also treated as "ok"
 *
 * This helps avoid subtle bugs where code tries to use Redis before it is ready.
 *
 * @example When to extend this class
 * Extend `PowerRedis` when you want:
 * - a **single place** to configure your Redis client;
 * - **shared helpers** for all your services (queues, caching, lists, etc.);
 * - a **junior-friendly API** where most common Redis patterns are already implemented.
 */
export abstract class PowerRedis {
	/**
	 * Determines whether Redis connection checks should operate in **strict mode**.
	 *
	 * This flag controls the behavior of {@link checkConnection}.  
	 * It is derived from the environment variable:
	 *
	 * ```
	 * REDIS_STRICT_CHECK_CONNECTION
	 * ```
	 *
	 * ---
	 * ### Strict mode (`true`)
	 *
	 * Connection is considered valid **only when**:
	 *
	 * - `redis.status === "ready"`
	 *
	 * Any other status (`"connecting"`, `"reconnecting"`, `"end"`, `"close"`)  
	 * will be treated as **not connected**.
	 *
	 * This mode is useful when:
	 * - Running in production with strict safety guarantees  
	 * - You must never send commands until Redis is fully ready  
	 * - You want predictable error behavior during connection issues  
	 *
	 * ---
	 * ### Non-strict mode (`false`)
	 *
	 * Connection is considered valid when:
	 *
	 * - `redis.status === "ready"`
	 * - **or** `redis.status === "connecting"`  
	 * - **or** `redis.status === "reconnecting"`
	 *
	 * This mode is more flexible and helpful when:
	 * - Running background workers  
	 * - Allowing commands during reconnection  
	 * - Tolerating short connection interruptions  
	 *
	 * ---
	 * ### Environment variable values
	 *
	 * The following values (case-insensitive, trimmed) enable strict mode:
	 *
	 * ```
	 * "true", "on", "yes", "y", "1"
	 * ```
	 *
	 * Any other value disables strict mode.
	 *
	 * ---
	 * ### Example
	 *
	 * ```ts
	 * if (this.isStrictCheckConnection) {
	 *   console.log("Strict Redis connection checks enabled");
	 * }
	 * ```
	 *
	 * ---
	 * @defaultValue `false` unless the environment variable matches a truthy value.
	 */
	public readonly isStrictCheckConnection: boolean = [ 'true', 'on', 'yes', 'y', '1' ].includes(String(process.env.REDIS_STRICT_CHECK_CONNECTION ?? '').trim().toLowerCase());
	
	/**
	 * The underlying Redis client instance used by `PowerRedis`.
	 *
	 * This property is **abstract**, meaning:
	 * - Every class extending `PowerRedis` **must** provide its own implementation.
	 * - It must be assigned a valid object that behaves like an ioredis client.
	 *
	 * ---
	 * ### Expected capabilities
	 *
	 * The client must implement the essential Redis commands used throughout the class:
	 *
	 * - Basic commands (`GET`, `SET`, `MGET`, `DEL`, `UNLINK`, `EXPIRE`, `PEXPIRE`, `PTTL`)
	 * - List operations (`RPUSH`, `LPOP`, `LRANGE`, `LLEN`, `LTRIM`)
	 * - Stream operations (`XGROUP`, `XREADGROUP`)
	 * - Scripting (`SCRIPT LOAD`)
	 * - Scanning (`SCAN`, optional `MULTI`)
	 *
	 * The type {@link IORedisLike} defines the minimal shape required for compatibility.
	 *
	 * ---
	 * ### Responsibility of subclasses
	 *
	 * A subclass must:
	 * - Initialize `redis` inside the constructor.
	 * - Ensure the instance is connected and configured.
	 * - Provide a client whose `status` property reflects connection state
	 *   (`"ready"`, `"connecting"`, `"reconnecting"`, etc.).
	 *
	 * This is required for {@link checkConnection} to work correctly.
	 *
	 * ---
	 * ### Example implementation in a subclass
	 *
	 * ```ts
	 * import IORedis from "ioredis";
	 *
	 * export class MyRedis extends PowerRedis {
	 *   public redis = new IORedis({
	 *     host: "127.0.0.1",
	 *     port: 6379,
	 *   });
	 * }
	 * ```
	 *
	 * ---
	 * ### Notes
	 *
	 * - The instance is treated as "any" internally to support both ioredis and
	 *   compatible Redis clients.
	 * - The class **never** creates its own client; the user must supply one.
	 * - This design allows dependency injection and custom client configurations.
	 *
	 * ---
	 * @abstract
	 */
	public abstract redis: IORedisLike;

	/**
	 * Checks whether the underlying Redis client is considered "connected" and safe to use.
	 *
	 * The check is based only on the client's `status` property and **does not send** any
	 * network requests (no `PING` is performed).
	 *
	 * - In **strict mode** (`REDIS_STRICT_CHECK_CONNECTION = true|on|yes|y|1`):
	 *   - Returns `true` **only** when `this.redis.status === "ready"`.
	 *
	 * - In **non-strict mode** (any other value):
	 *   - Returns `true` when `this.redis.status` is:
	 *     - `"ready"` – fully connected;
	 *     - `"connecting"` or `"reconnecting"` – connection is in progress, but we still allow commands.
	 *
	 * If the client is missing (`this.redis` is falsy) or its status is different from
	 * the allowed values, the method returns `false`.
	 *
	 * Use this method before executing Redis commands to avoid working with a closed or
	 * uninitialized client.
	 *
	 * @returns `true` if the Redis client exists and its status is acceptable for issuing
	 * Redis commands, otherwise `false`.
	 *
	 * @example
	 * ```ts
	 * if (!this.checkConnection()) {
	 *   throw new Error('Redis connection error.');
	 * }
	 *
	 * const value = await (this.redis as any).get('some:key');
	 * ```
	 */
	checkConnection(): boolean {
		return !!this.redis && ((this.redis as any).status === 'ready' || (this.isStrictCheckConnection ? false : ((this.redis as any).status === 'connecting' || (this.redis as any).status === 'reconnecting')));
	}

	/**
	 * Builds a Redis pattern string by joining multiple segments with `:`  
	 * (for example: `user:profile:123`).  
	 *
	 * This method validates every segment to ensure it is safe to use in Redis
	 * pattern-based commands such as `SCAN`, `KEYS`, or `PUB/SUB` channels.
	 *
	 * **Validation rules for each segment:**
	 * - Must be a non-empty string after trimming.
	 * - Must **not** contain `:` (the delimiter is added automatically).
	 * - Must **not** contain spaces.
	 *
	 * If any segment violates these rules, the method throws an error.  
	 * This helps prevent accidental creation of incorrect patterns and removes
	 * ambiguity in Redis key names.
	 *
	 * **Examples of valid results:**
	 * - `toPatternString("user", "profile", 5)` → `"user:profile:5"`
	 * - `toPatternString("tasks", "pending")` → `"tasks:pending"`
	 *
	 * **Examples of invalid segments (will throw):**
	 * - `" user "` → becomes empty after trimming
	 * - `"some:value"` → contains `:`
	 * - `"my key"` → contains a space
	 *
	 * @param parts - List of string/number segments that form the pattern.
	 * @returns A single pattern string composed of all segments joined by `:`.
	 *
	 * @throws Error if any segment is empty, contains `:`, or contains whitespace.
	 */
	toPatternString(...parts: Array<string | number>): string {
		for (const p of parts) {
			const s = formatToTrim(p);

			if (!isStrFilled(s) || s.includes(':') || /\s/.test(s)) {
				throw new Error(`Pattern segment invalid (no ":", spaces): "${s}"`);
			}
		}
		return parts.join(':');
	}

	/**
	 * Builds a **safe Redis key string** by joining multiple segments with `:`  
	 * (for example: `session:user:42`).  
	 *
	 * Unlike `toPatternString()`, this method is used for **real Redis keys**, not patterns.
	 * Therefore, it performs stricter validation to ensure the final key is always valid,
	 * predictable, and cannot accidentally be interpreted as a wildcard pattern.
	 *
	 * **Validation rules for each segment:**
	 * - Must be a non-empty string after trimming.
	 * - Must **not** contain the separator `:` (added automatically).
	 * - Must **not** contain any whitespace.
	 * - Must **not** contain Redis glob/wildcard characters:
	 *   - `*` (matches multiple characters)
	 *   - `?` (matches one character)
	 *   - `[` or `]` (character groups)
	 *
	 * If a segment violates any rule, the method throws an error to prevent
	 * generating ambiguous or unsafe Redis keys.
	 *
	 * **Examples of valid results:**
	 * - `toKeyString("session", "user", 42)` → `"session:user:42"`
	 * - `toKeyString("cache", "products")` → `"cache:products"`
	 *
	 * **Examples of invalid segments (will throw):**
	 * - `" user "` → becomes empty or contains spaces
	 * - `"role:*"` → contains wildcard `*`
	 * - `"a:b"` → contains `:`
	 * - `"key[name]"` → contains `[` and `]`
	 *
	 * @param parts - List of string/number segments that will form the final key.
	 * @returns A safe, validated Redis key composed of all segments joined by `:`.
	 *
	 * @throws Error if any segment is empty, contains `:`, whitespace,
	 *                or wildcard characters (`* ? [ ]`).
	 */
	toKeyString(...parts: Array<string | number>): string {
		for (const p of parts) {
			const s = formatToTrim(p);

			if (!isStrFilled(s) || s.includes(':') || /[\*\?\[\]\s]/.test(s)) {
				throw new Error(`Key segment is invalid (no ":", spaces or glob chars * ? [ ] allowed): "${s}"`);
			}
		}
		return parts.join(':');
	}

	/**
	 * Splits a Redis key into its individual segments using `:` as the delimiter.
	 *
	 * This method is the opposite of `toKeyString()` and is useful when you need to
	 * extract meaningful parts of a structured Redis key such as:
	 * - `"session:user:42"` → `["session", "user", "42"]`
	 *
	 * Empty segments (for example from `::`) are automatically removed to avoid
	 * returning meaningless values.
	 *
	 * **Important notes:**
	 * - This method performs **no validation** — it simply splits the string.
	 * - Use it only when you trust the key format or when it was generated by
	 *   `toKeyString()` or another safe key-building method.
	 *
	 * @param key - A full Redis key string (e.g., `"cache:product:123"`).
	 * @returns An array of non-empty segments extracted from the key.
	 *
	 * @example
	 * ```ts
	 * fromKeyString("user:profile:1");
	 * // → ["user", "profile", "1"]
	 * ```
	 */
	fromKeyString(key: string): Array<string> {
		return key.split(':').filter(Boolean);
	}

	/**
	 * Converts a raw Redis string value into a typed JavaScript value.
	 *
	 * Redis stores everything as strings, so this method helps restore
	 * the original data type when reading values from Redis.
	 *
	 * **Conversion rules:**
	 * 1. If the input is not a string → returns `null`.
	 * 2. If the string is empty after trimming → returns an empty string `""`.
	 * 3. Tries to `JSON.parse` the value:
	 *    - If it becomes a number, boolean, string, array, or object → returns it.
	 *    - If parsing fails → continues to fallback rules.
	 * 4. If the string looks like a boolean (`"true"`, `"false"`, `"yes"`, `"no"`, etc.)  
	 *    → returns a proper `boolean`.
	 * 5. Otherwise → returns the original string unchanged.
	 *
	 * This makes the method safe, predictable, and convenient for storing
	 * mixed-type data in Redis without having to manually decode it each time.
	 *
	 * **Examples:**
	 * - `"123"` → `123`
	 * - `"true"` → `true`
	 * - `"{\"a\":1}"` → `{ a: 1 }`
	 * - `"hello"` → `"hello"`
	 * - `null` → `null`
	 *
	 * @param value - Raw string returned from Redis (or `null`).
	 * @returns Parsed JSON, boolean, primitive, or the original string.
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
	 * Converts a JavaScript value into a string that is safe to store in Redis.
	 *
	 * Since Redis can only store strings, this method prepares any value for storage
	 * while keeping enough information to restore the original type using `fromPayload()`.
	 *
	 * **Conversion rules:**
	 * - If the value is an **array** or **object** → serializes it to JSON.
	 *   This preserves structure for non-primitive data.
	 * - For all other types (number, string, boolean, null, undefined) →  
	 *   converts the value to a string using `String(value ?? "")`.
	 *
	 * This ensures consistent and reversible encoding, making it easy to store
	 * mixed-type data in Redis without manually calling `JSON.stringify`.
	 *
	 * **Examples:**
	 * - `{ a: 1 }` → `"{"a":1}"`
	 * - `[1, 2, 3]` → `"[1,2,3]"`
	 * - `true` → `"true"`
	 * - `42` → `"42"`
	 * - `null` → `""`
	 * - `undefined` → `""`
	 *
	 * @param value - Any JSON-compatible value.
	 * @returns A string ready to be stored in Redis.
	 */
	toPayload(value: Jsonish): string {
		if (isArr(value) || isObj(value)) {
			return jsonEncode(value);
		}
		return String(value ?? '');
	}

	/**
	 * Compatibility wrapper for removing multiple items from a Redis list using `LPOP`.
	 *
	 * Modern Redis versions support `LPOP key count`, which pops multiple elements
	 * in a single command. However, older Redis versions **do not support** the
	 * `count` argument.  
	 *
	 * This method detects support at runtime:
	 *
	 * **1. Fast path (Redis ≥ 6.2):**  
	 *    - Calls `LPOP key count` directly.  
	 *    - If Redis returns:
	 *      - an array → returns it as a list of strings;
	 *      - a single string → wraps it into an array.
	 *
	 * **2. Fallback path (older Redis versions):**  
	 *    Uses a `MULTI` transaction to emulate multi-pop:
	 *    - `LRANGE key 0 count-1` — read the items
	 *    - `LTRIM key count -1` — remove them
	 *
	 * This guarantees consistent behavior even on older servers or restricted
	 * hosting environments.
	 *
	 * **Return value:**
	 * - Always an array of popped string items.
	 * - Empty array if the key does not exist or no items are available.
	 *
	 * **Usage example:**
	 * ```ts
	 * const items = await this.lpopCountCompat("queue:tasks", 100);
	 * for (const raw of items) {
	 *   const payload = this.fromPayload(raw);
	 *   // process payload...
	 * }
	 * ```
	 *
	 * @param key - Redis list key to pop items from.
	 * @param count - Number of items to remove.
	 * @returns Array of popped string values (may be empty).
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
		const tx = (this.redis as any).multi();
		
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
	 * Finds Redis keys that match a given pattern using an efficient `SCAN` loop.
	 *
	 * This method is a safe alternative to the Redis `KEYS` command:
	 * - `KEYS` scans **the entire database at once** and can block Redis.
	 * - `SCAN` iterates through the keyspace in small chunks and is non-blocking.
	 *
	 * **How it works:**
	 * - Uses `SCAN cursor MATCH pattern COUNT scanSize`.
	 * - Iterates until either:
	 *   - the internal cursor returns `"0"` (end of scan), or
	 *   - the number of collected keys reaches `limit`.
	 * - Uses a `Set` internally to avoid duplicates, because `SCAN`
	 *   *may return the same key more than once*.
	 *
	 * **Parameters:**
	 * - `pattern` — Redis glob pattern (e.g. `"user:*"`).  
	 *   Must be a non-empty string.
	 * - `limit` — maximum number of keys to return  
	 *   (prevents scanning the entire DB when you only need a few).
	 * - `scanSize` — how many keys Redis *attempts* to return per iteration  
	 *   (larger = faster but heavier; smaller = safer but slower).
	 *
	 * **Returns:**
	 * - An array of unique keys matching the pattern.
	 * - Length is at most `limit`.
	 *
	 * **Why not return a Set?**  
	 * Arrays are easier to use and serialize, and order is not important here.
	 *
	 * **Example:**
	 * ```ts
	 * const keys = await this.keys("cache:user:*", 200);
	 *
	 * for (const key of keys) {
	 *   const value = await this.getOne(key);
	 *   console.log(key, value);
	 * }
	 * ```
	 *
	 * @throws Error if the pattern or numeric parameters are invalid,
	 *         or if Redis is not connected.
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
			const [ nextCursor, found ] = await (this.redis as any).scan(cursor, 'MATCH', pattern, 'COUNT', scanSize);

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
	 * Reads a single key from Redis and automatically converts the stored
	 * string value into a typed JavaScript value.
	 *
	 * This method is a convenience wrapper around:
	 * - `GET key`
	 * - automatic decoding using `fromPayload()`
	 *
	 * **Validation & safety:**
	 * - The `key` argument must be a non-empty string.
	 * - Before executing the command, the method checks the Redis connection
	 *   using `checkConnection()`.
	 *
	 * **Decoding logic:**
	 * The raw Redis string is passed through `fromPayload()`, which:
	 * - tries to parse JSON,
	 * - recognizes booleans,
	 * - converts numbers,
	 * - returns arrays/objects,
	 * - or simply returns the original string if nothing else matches.
	 *
	 * **Return value:**
	 * - Parsed value: object, array, number, boolean, string — depending on
	 *   what was stored.
	 * - `null` if:
	 *   - the key does not exist,
	 *   - the Redis client returned `null`,
	 *   - or decoding rules map it to `null`.
	 *
	 * **Example:**
	 * ```ts
	 * const data = await redis.getOne("user:42:profile");
	 *
	 * if (data) {
	 *   console.log("User profile:", data);
	 * }
	 * ```
	 *
	 * @param key - Redis key to read.
	 * @returns The decoded JavaScript value or `null`.
	 * @throws Error if the key is invalid or the Redis connection is unavailable.
	 */
	async getOne(key: string): Promise<Jsonish | null> {
		if (!isStrFilled(key)) {
			throw new Error('Key format error.');
		}
		if (!this.checkConnection()) {
			throw new Error('Redis connection error.');
		}
		return this.fromPayload(await (this.redis as any).get(key));
	}

	/**
	 * Reads multiple Redis keys that match a given pattern and returns their
	 * decoded values as a key–value object.
	 *
	 * This method is a high-level utility that combines:
	 *
	 * 1. **Key discovery** via `SCAN`  
	 *    (`keys()` is used internally to find matching keys up to a given limit)
	 *
	 * 2. **Batch value retrieval** via `MGET`  
	 *    Keys are processed in chunks (controlled by `chunkSize`) to avoid
	 *    sending one huge MGET command or exceeding argument limits.
	 *
	 * 3. **Automatic decoding** via `fromPayload()`  
	 *    Every raw Redis string is converted into the appropriate JS type:
	 *    numbers, booleans, objects, arrays, or plain strings.
	 *
	 * ---
	 * ### Parameters
	 *
	 * - `pattern` — Redis glob key pattern (e.g. `"cache:user:*"`).  
	 * - `limit` — maximum number of keys to return from SCAN.
	 * - `scanSize` — how many keys Redis attempts to return per SCAN iteration.
	 * - `chunkSize` — how many keys to fetch via MGET at once.
	 *
	 * These parameters allow the method to scale safely even in large databases.
	 *
	 * ---
	 * ### Return Value
	 *
	 * Returns an object:
	 *
	 * ```ts
	 * {
	 *   "key1": <decoded value>,
	 *   "key2": <decoded value>,
	 *   ...
	 * }
	 * ```
	 *
	 * - Keys with `null` values are included as `null`.
	 * - If no keys match, an empty object `{}` is returned.
	 *
	 * ---
	 * ### Example
	 * ```ts
	 * const items = await redis.getMany("session:*", 500);
	 *
	 * for (const [key, value] of Object.entries(items)) {
	 *   console.log("Session:", key, value);
	 * }
	 * ```
	 *
	 * ---
	 * ### Behavior Notes
	 *
	 * - The method **never blocks** Redis (uses SCAN, not KEYS).
	 * - Values are processed in controlled batches via `MGET`.
	 * - Each value is decoded into a real JS type using `fromPayload()`.
	 *
	 * @param pattern - Glob-style Redis key pattern to search for.
	 * @param limit - Maximum number of keys to read.
	 * @param scanSize - SCAN batch size.
	 * @param chunkSize - Number of keys to fetch per MGET batch.
	 * @returns An object where each property is a Redis key and its decoded value.
	 * @throws Error if arguments are invalid or Redis is not connected.
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
			const values: Array<string | null> = await (this.redis as any).mget(...chunk);

			for (let j = 0; j < chunk.length; j++) {
				result[chunk[j]] = this.fromPayload(values[j] ?? null);
			}
		}
		return result;
	}

	/**
	 * Reads multiple items from a Redis list and returns them as an array of
	 * decoded JavaScript values.
	 *
	 * This method is a high-level wrapper around the asynchronous iterator
	 * `getListIterator()`, which reads list items in chunks.  
	 * It simplifies typical use cases where you only need the final array.
	 *
	 * ---
	 * ### Modes of operation
	 *
	 * #### 1. **Non-destructive mode** (`remove = false`)
	 * - The list is read using `LRANGE` in chunks.
	 * - **No items are removed** from Redis.
	 * - Useful for inspecting queues, debugging, or read-only operations.
	 *
	 * #### 2. **Destructive mode** (`remove = true`)
	 * - Items are removed from the list using `LPOP` batches via `lpopCountCompat()`.
	 * - Stops when the list is empty or no more items are returned.
	 * - Useful for consuming a queue safely and efficiently.
	 *
	 * ---
	 * ### Parameters
	 *
	 * - `key` — Redis list key.
	 * - `limit` — maximum number of items to process per iteration
	 *   (affects chunk size, not the final array size).
	 * - `remove` — whether to **destroy** items while reading.
	 *
	 * ---
	 * ### Return value
	 *
	 * Returns a flat array of decoded values:
	 *
	 * ```ts
	 * [ <item1>, <item2>, <item3>, ... ]
	 * ```
	 *
	 * - Items are decoded with `fromPayload()`.
	 * - Order is preserved as in Redis.
	 *
	 * ---
	 * ### Example (non-destructive)
	 * ```ts
	 * const items = await redis.getList("queue:logs", 100);
	 * console.log(items);
	 * ```
	 *
	 * ### Example (destructive)
	 * ```ts
	 * const tasks = await redis.getList("queue:tasks", 500, true);
	 * for (const task of tasks) {
	 *   await processTask(task);
	 * }
	 * ```
	 *
	 * ---
	 * @param key - Redis list key to read.
	 * @param limit - Number of items to fetch per chunk.
	 * @param remove - Whether to remove items from the list while reading.
	 * @returns A flat array of decoded list items.
	 * @throws Error if the key format is invalid.
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
	 * Asynchronous iterator that streams items from a Redis list in chunks.
	 *
	 * This is a low-level building block used by {@link getList}.  
	 * It allows you to process list items **chunk by chunk** without loading
	 * everything into memory at once.
	 *
	 * ---
	 * ### Modes of operation
	 *
	 * #### 1. **Destructive mode** (`remove = true`)
	 * - Uses {@link lpopCountCompat} internally.
	 * - Repeatedly pops up to `limit` items from the head of the list.
	 * - Yields each batch as an array of decoded values.
	 * - Stops when no more items are returned (list is empty).
	 *
	 * #### 2. **Non-destructive mode** (`remove = false`)
	 * - Reads the list using `LLEN` + `LRANGE` in pages of size `limit`.
	 * - **Does not remove** any items from Redis.
	 * - Yields each page as an array of decoded values.
	 *
	 * ---
	 * ### Important notes
	 *
	 * - `limit` controls the **chunk size per iteration**, not the total number
	 *   of items returned by the iterator.
	 * - Each yielded item is already converted from a raw Redis string using
	 *   {@link fromPayload}.
	 * - The method checks the Redis connection first via {@link checkConnection}.
	 *
	 * ---
	 * ### Usage example
	 *
	 * ```ts
	 * // Non-destructive streaming read
	 * for await (const chunk of redis.getListIterator("queue:logs", 100)) {
	 *   for (const item of chunk) {
	 *     console.log("Log:", item);
	 *   }
	 * }
	 *
	 * // Destructive queue consumption
	 * for await (const tasks of redis.getListIterator("queue:tasks", 500, true)) {
	 *   await Promise.all(tasks.map(processTask));
	 * }
	 * ```
	 *
	 * @param key - Redis list key to read.
	 * @param limit - Maximum number of items to read per iteration (chunk size).
	 * @param remove - Whether to remove items from the list while reading.
	 * @yields Arrays of decoded list items (chunks).
	 * @throws Error if Redis is not connected or arguments are invalid.
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
		const n = await (this.redis as any).llen(key);

		if (!isNumP(n)) {
			return;
		}
		let start = 0;
		
		while (start < n) {
			const stop = Math.min(start + limit - 1, n - 1);
			const chunk = await (this.redis as any).lrange(key, start, stop);

			if (chunk.length === 0) {
				start += limit;
				continue;
			}
			yield chunk.map((item: any) => this.fromPayload(item));

			start += limit;
		}
	}

	/**
	 * Sets a single key in Redis with an optional TTL (time-to-live).
	 *
	 * This is a convenience wrapper around the Redis `SET` command that:
	 * - validates the key,
	 * - checks the Redis connection,
	 * - converts the value using {@link toPayload},
	 * - optionally sets expiration in **seconds**.
	 *
	 * ---
	 * ### Behavior
	 *
	 * - If `ttlSec` is a positive number → sends:
	 *   - `SET key value EX ttlSec`
	 * - If `ttlSec` is not provided or not a positive number → sends:
	 *   - `SET key value`
	 *
	 * The value is always converted to a string using {@link toPayload}, which:
	 * - JSON-encodes arrays and objects,
	 * - stringifies primitives (number, boolean, string, null, undefined).
	 *
	 * ---
	 * ### Parameters
	 *
	 * - `key` — Redis key to set (must be a non-empty string).
	 * - `value` — Any JSON-compatible value to store.
	 * - `ttlSec` — Optional TTL in **seconds**. If provided and valid, the key
	 *   will automatically expire after this time.
	 *
	 * ---
	 * ### Return value
	 *
	 * - Resolves to `"OK"` if Redis successfully stores the value.
	 *
	 * ---
	 * ### Example
	 *
	 * ```ts
	 * // Store an object for 1 hour
	 * await redis.setOne("session:user:42", { token: "abc", role: "admin" }, 3600);
	 *
	 * // Store a simple string without expiration
	 * await redis.setOne("config:mode", "production");
	 * ```
	 *
	 * @param key - Redis key to set.
	 * @param value - Value to store under the given key.
	 * @param ttlSec - Optional expiration time in seconds.
	 * @returns `"OK"` on success.
	 * @throws Error if the key is invalid or Redis is not connected.
	 */
	async setOne(key: string, value: any, ttlSec?: number): Promise<'OK'> {
		if (!isStrFilled(key)) {
			throw new Error('Key format error.');
		}
		if (!this.checkConnection()) {
			throw new Error('Redis connection error.');
		}
		return isNumP(ttlSec)
			? await (this.redis as any).set(key, this.toPayload(value), 'EX', ttlSec)
			: await (this.redis as any).set(key, this.toPayload(value));
	}

	/**
	 * Sets multiple keys in Redis in one call, with an optional TTL (time-to-live) for all of them.
	 *
	 * This method is a bulk version of {@link setOne} and is useful when you need
	 * to write many keys at once.
	 *
	 * ---
	 * ### Behavior without TTL
	 *
	 * If `ttlSec` is **not** a positive number:
	 *
	 * - The method:
	 *   - Validates all keys.
	 *   - Converts each value via {@link toPayload}.
	 *   - Uses a single `MSET` call:
	 *     - `MSET key1 value1 key2 value2 ...`
	 * - If `MSET` returns `"OK"`, it returns the number of keys written.
	 * - Otherwise returns `0`.
	 *
	 * This is the fastest way to set many keys at once when you **do not**
	 * need expiration.
	 *
	 * ---
	 * ### Behavior with TTL
	 *
	 * If `ttlSec` **is** a positive number:
	 *
	 * - The method:
	 *   - Validates all keys.
	 *   - Creates a Redis transaction (`MULTI`).
	 *   - For every pair `{ key, value }` adds:
	 *     - `SET key value EX ttlSec`
	 *   - Executes the transaction with `EXEC`.
	 * - Then it:
	 *   - Checks each reply from Redis.
	 *   - Counts how many `SET` commands returned `"OK"`.
	 * - Returns the count of successfully written keys.
	 *
	 * This approach is slightly heavier but lets you assign the **same TTL**
	 * to all keys in a safe, atomic way.
	 *
	 * ---
	 * ### Parameters
	 *
	 * - `values` — Array of objects, each with:
	 *   - `key` — non-empty Redis key string.
	 *   - `value` — any JSON-compatible value.
	 * - `ttlSec` — Optional TTL in **seconds**. If valid, all keys will get
	 *   this expiration time.
	 *
	 * ---
	 * ### Return value
	 *
	 * - Number of keys that were successfully written:
	 *   - With `MSET` → either `values.length` or `0`.
	 *   - With `MULTI/EXEC` → count of `"OK"` replies from `SET`.
	 *
	 * ---
	 * ### Example
	 *
	 * ```ts
	 * await redis.setMany([
	 *   { key: "config:mode", value: "production" },
	 *   { key: "config:maxWorkers", value: 8 },
	 * ]);
	 *
	 * await redis.setMany(
	 *   [
	 *     { key: "session:user:1", value: { token: "a" } },
	 *     { key: "session:user:2", value: { token: "b" } },
	 *   ],
	 *   3600, // TTL: 1 hour
	 * );
	 * ```
	 *
	 * @param values - List of key-value pairs to store.
	 * @param ttlSec - Optional TTL in seconds applied to all keys.
	 * @returns Number of successfully written keys.
	 * @throws Error if payload format is invalid, a key is invalid,
	 *               or Redis is not connected.
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
			const res = await (this.redis as any).mset(...kv);

			return res === 'OK' 
				? values.length 
				: 0;
		}
		const tx = (this.redis as any).multi();

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
	 * Pushes a single value to the **end** of a Redis list (`RPUSH`) with an optional TTL.
	 *
	 * This method is similar to {@link setOne}, but specifically for **list** operations.
	 * It always appends the value to the end of the list and optionally applies expiration.
	 *
	 * ---
	 * ### Behavior
	 *
	 * #### 1. Without TTL (`ttlSec` not provided or invalid)
	 * - Executes:
	 *   - `RPUSH key value`
	 * - Returns the new length of the list.
	 *
	 * #### 2. With TTL (`ttlSec` is a positive number)
	 * - Executes a Redis transaction (`MULTI`):
	 *   - `RPUSH key value`
	 *   - `EXPIRE key ttlSec`
	 * - After `EXEC`:
	 *   - Validates both replies.
	 *   - Returns the list length reported by `RPUSH`.
	 *
	 * TTL is useful when the list is used as a temporary buffer or queue that should
	 * disappear after some time.
	 *
	 * ---
	 * ### Value conversion
	 *
	 * The value is first passed through {@link toPayload}, which:
	 * - JSON-encodes arrays or objects;
	 * - stringifies numbers, booleans, null, undefined, etc.
	 *
	 * ---
	 * ### Return value
	 *
	 * Returns the **new length** of the list after pushing the element.
	 * If the transaction fails or TTL cannot be set → returns `0`.
	 *
	 * ---
	 * ### Example
	 *
	 * ```ts
	 * // Push a single message to a queue
	 * await redis.pushOne("queue:events", { type: "login", userId: 5 });
	 *
	 * // Push a value with expiration (list will auto-delete after TTL)
	 * await redis.pushOne("tmp:cache:list", "hello", 30);
	 * ```
	 *
	 * @param key - Redis list key.
	 * @param value - Value to push to the end of the list.
	 * @param ttlSec - Optional TTL in seconds applied to the entire list.
	 * @returns New list length or `0` if TTL mode failed.
	 * @throws Error if the key is invalid or Redis is not connected.
	 */
	async pushOne(key: string, value: any, ttlSec?: number): Promise<number> {
		if (!isStrFilled(key)) {
			throw new Error('Key format error.');
		}
		if (!this.checkConnection()) {
			throw new Error('Redis connection error.');
		}
		if (isNumP(ttlSec)) {
			const tx = (this.redis as any).multi();
				
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
		return await (this.redis as any).rpush(key, this.toPayload(value));
	}

	/**
	 * Pushes **multiple values** to the **end** of a Redis list (`RPUSH`) with an optional TTL.
	 *
	 * This is a bulk version of {@link pushOne}.  
	 * It always appends all provided values to the end of the list and can optionally
	 * set an expiration time for the entire list.
	 *
	 * ---
	 * ### Behavior
	 *
	 * #### 1. Without TTL (`ttlSec` not provided or invalid)
	 * - Validates:
	 *   - `key` must be a non-empty string.
	 *   - `values` must be a non-empty array.
	 * - Converts each value using {@link toPayload}.
	 * - Executes:
	 *   - `RPUSH key value1 value2 value3 ...`
	 * - Returns the **new length** of the list after all pushes.
	 *
	 * #### 2. With TTL (`ttlSec` is a positive number)
	 * - Validates the same inputs.
	 * - Creates a Redis transaction (`MULTI`):
	 *   - `RPUSH key value1 value2 ...`
	 *   - `EXPIRE key ttlSec`
	 * - Executes `EXEC` and:
	 *   - Checks both replies (`RPUSH` and `EXPIRE`).
	 *   - If both succeed and return valid numeric results:
	 *     - Returns the list length from `RPUSH`.
	 *   - Otherwise returns `0`.
	 *
	 * TTL is applied to the **entire list key**, not to individual items.
	 *
	 * ---
	 * ### Value conversion
	 *
	 * Each value is passed through {@link toPayload}, which:
	 * - JSON-encodes arrays/objects;
	 * - stringifies numbers, booleans, strings, null, undefined, etc.
	 *
	 * ---
	 * ### Return value
	 *
	 * - Without TTL: new length of the list after the `RPUSH`.
	 * - With TTL: new length if both `RPUSH` and `EXPIRE` succeed, otherwise `0`.
	 *
	 * ---
	 * ### Example
	 *
	 * ```ts
	 * // Add multiple log entries to the list
	 * await redis.pushMany("logs:events", [
	 *   { type: "login", userId: 1 },
	 *   { type: "logout", userId: 2 },
	 * ]);
	 *
	 * // Add a batch of tasks with auto-expiration after 5 minutes
	 * await redis.pushMany("queue:tasks", [
	 *   { id: 1, action: "sync" },
	 *   { id: 2, action: "rebuild" },
	 * ], 300);
	 * ```
	 *
	 * @param key - Redis list key.
	 * @param values - Non-empty array of values to push to the end of the list.
	 * @param ttlSec - Optional TTL in seconds applied to the list key.
	 * @returns New list length, or `0` if TTL mode fails.
	 * @throws Error if the key or payload format is invalid, or Redis is not connected.
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
			const tx = (this.redis as any).multi();
			
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
		return await (this.redis as any).rpush(key, ...values.map((value) => this.toPayload(value)));
	}

	/**
	 * Deletes **all Redis keys matching a given pattern**, using an efficient SCAN-based loop.
	 *
	 * This method is a safe and scalable alternative to using `KEYS pattern | DEL`:
	 * - `KEYS` is **blocking** and can freeze Redis on large databases.
	 * - `SCAN` is **non-blocking** and returns keys in small batches.
	 *
	 * The method iterates through the keyspace, finds matching keys, and deletes them
	 * in chunks using `UNLINK` (non-blocking delete) when available, falling back to
	 * `DEL` otherwise.
	 *
	 * ---
	 * ### How it works
	 *
	 * 1. Starts a `SCAN` cursor loop:
	 *    - `SCAN cursor MATCH pattern COUNT size`
	 * 2. Collects keys returned on each iteration.
	 * 3. Deletes them in batches:
	 *    - If `UNLINK` is supported → calls `UNLINK key1 key2 ...`
	 *    - Otherwise → calls `DEL key1 key2 ...`
	 * 4. Continues until `SCAN` cursor returns `"0"`.
	 *
	 * ---
	 * ### Performance notes
	 *
	 * - `UNLINK` is preferred because it deletes keys **asynchronously**, preventing
	 *   long blocking operations (very important for production).
	 * - Keys are processed in chunks of `size` to avoid sending extremely large commands.
	 * - The method **counts** the total number of deleted keys and returns it.
	 *
	 * ---
	 * ### Parameters
	 *
	 * - `pattern` — Redis glob pattern (`user:*`, `cache:*:meta`, etc.).
	 * - `size` — SCAN batch size and deletion chunk size (default: `1000`).
	 *
	 * ---
	 * ### Return value
	 *
	 * Returns the **number of keys matched**, not the number of deletion commands.
	 *
	 * ```ts
	 * const removed = await redis.dropMany("cache:user:*");
	 * console.log(`Deleted ${removed} cache keys`);
	 * ```
	 *
	 * ---
	 * ### Example
	 *
	 * ```ts
	 * // Delete all temporary keys
	 * await redis.dropMany("tmp:*");
	 *
	 * // Delete all queue items across shards
	 * await redis.dropMany("queue:*", 500);
	 * ```
	 *
	 * ---
	 * ### Error handling
	 *
	 * - If SCAN or deletion fails, the method catches internal errors and then throws
	 *   a general `Redis drop many error.`  
	 * - The returned value is only counted when deletion operations succeed.
	 *
	 * @param pattern - Glob-style key pattern to match for deletion.
	 * @param size - Number of keys to process per SCAN and deletion batch.
	 * @returns Number of keys matched and deleted.
	 * @throws Error if Redis is not connected or an unexpected error occurs.
	 */
	async dropMany(pattern: string, size: number = 1000): Promise<number> {
		if (!this.checkConnection()) {
			throw new Error('Redis connection error.');
		}
		try {
			let cursor = '0',
				total = 0;

			do {
				const [ next, keys ] = await (this.redis as any).scan(cursor, 'MATCH', pattern, 'COUNT', size);

				cursor = next;

				if (isArrFilled(keys)) {
					total += keys.length;

					for (let i = 0; i < keys.length; i += size) {
						const chunk = keys.slice(i, i + size);

						isFunc((this.redis as any).unlink)
							? (await (this.redis as any).unlink(...chunk))
							: (await (this.redis as any).del(...chunk));
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
	 * Atomically increments a numeric Redis key by **1** and optionally sets a TTL.
	 *
	 * This method wraps the Redis `INCR` command and adds a convenient optional
	 * expiration using `PEXPIRE` (TTL in **milliseconds**).
	 *
	 * ---
	 * ### Behavior
	 *
	 * 1. Executes:
	 *    - `INCR key`
	 *      - If the key does not exist → Redis creates it with value `1`.
	 *      - If the key contains a non-numeric value → Redis throws an error.
	 *
	 * 2. If `ttl` is a positive number:
	 *    - Executes:
	 *      - `PEXPIRE key ttl`
	 *    - TTL is applied **after** the increment.
	 *    - TTL is in **milliseconds**, not seconds.
	 *
	 * ---
	 * ### Value type
	 *
	 * - The returned value is the new numeric value of the key after increment.
	 * - Always a number.
	 *
	 * ---
	 * ### Use cases
	 *
	 * - Rate limiting counters  
	 * - Counting events per user  
	 * - Tracking queue attempts  
	 * - Generating monotonic IDs (non-distributed)
	 *
	 * Example:
	 *
	 * ```ts
	 * // Increment login attempts and apply a 5-minute TTL
	 * const attempts = await redis.incr("login:attempts:42", 5 * 60 * 1000);
	 * console.log(attempts); // → 1, 2, 3, ...
	 * ```
	 *
	 * ---
	 * @param key - Redis key to increment.
	 * @param ttl - Optional TTL in **milliseconds** set via `PEXPIRE`.
	 * @returns New numeric value after increment.
	 */
	async incr(key: string, ttl?: number): Promise<number> { 
		const result = await (this.redis as any).incr(key); 

		if (isNumP(ttl)) {
			await (this.redis as any).pexpire(key, ttl);
		}
		return result;
	}

	/**
	 * Sets a TTL (time-to-live) on a Redis key.
	 *
	 * This is a thin wrapper around the Redis `EXPIRE` command.
	 * It assigns an expiration time in **seconds**, after which
	 * the key will be automatically removed by Redis.
	 *
	 * ---
	 * ### Behavior
	 *
	 * Executes:
	 *
	 * ```
	 * EXPIRE key ttl
	 * ```
	 *
	 * - `ttl` must be a positive integer (in **seconds**).
	 * - If the key exists and the TTL is applied → returns `1`.
	 * - If the key does not exist or TTL cannot be set → returns `0`.
	 *
	 * Redis expiration is updated *regardless* of the key’s type
	 * (string, list, hash, set, etc.).
	 *
	 * ---
	 * ### Use cases
	 *
	 * - Expiring temporary caches  
	 * - Soft-deleting resources  
	 * - Time-bound sessions or tokens  
	 * - Auto-cleaning queues  
	 *
	 * ---
	 * ### Example
	 *
	 * ```ts
	 * // Key will expire after 60 seconds
	 * await redis.expire("cache:tmp:data", 60);
	 * ```
	 *
	 * ---
	 * @param key - Redis key to expire.
	 * @param ttl - TTL in **seconds**.
	 * @returns `1` if the TTL was set, `0` otherwise.
	 */
	async expire(key: string, ttl: number): Promise<number> { 
		return await (this.redis as any).expire(key, ttl); 
	}

	/**
	 * Loads a Lua script into Redis and returns its SHA1 hash.
	 *
	 * This is a wrapper around the Redis command:
	 *
	 * ```
	 * SCRIPT LOAD "<lua script>"
	 * ```
	 *
	 * Redis stores the script in its internal script cache and returns a
	 * **SHA1 hash**, which can later be used with:
	 *
	 * - `EVALSHA <sha1> ...` — execute by hash  
	 * - avoids sending the entire script string every time  
	 * - improves performance and reduces bandwidth  
	 *
	 * ---
	 * ### Behavior
	 *
	 * - Accepts a Lua script as a plain string.
	 * - Sends `SCRIPT LOAD` to Redis.
	 * - Returns a SHA1 hash (always a string).
	 * - Does **not** execute the script; it only registers it.
	 *
	 * ---
	 * ### Use cases
	 *
	 * - Preloading Lua scripts for:
	 *   - Atomic queue operations  
	 *   - Locks  
	 *   - Counters  
	 *   - Custom batch commands  
	 * - Required by `EVALSHA` calls elsewhere in your application.
	 *
	 * ---
	 * ### Example
	 *
	 * ```ts
	 * const sha = await redis.script('LOAD', `
	 *   return redis.call("INCR", KEYS[1])
	 * `);
	 *
	 * console.log(sha); // → "e0f1c1f9c6d42..."
	 *
	 * // Later:
	 * await redisClient.evalsha(sha, 1, "counter:key");
	 * ```
	 *
	 * ---
	 * @param subcommand - Only `"LOAD"` is supported by this wrapper.
	 * @param script - The Lua script to cache inside Redis.
	 * @returns SHA1 hash of the cached script.
	 */
	async script(subcommand: 'LOAD', script: string): Promise<string> {
		return await (this.redis as any).script('LOAD', script); 
	}

	/**
	 * Wrapper around the Redis `XGROUP` command used for managing
	 * **consumer groups** in Redis Streams.
	 *
	 * This method provides a simple, typed interface to create groups
	 * or perform other `XGROUP` subcommands, depending on the arguments passed.
	 *
	 * It is typically used to **create a consumer group** for a stream:
	 *
	 * ```
	 * XGROUP CREATE <stream> <group> <id> <MKSTREAM?>
	 * ```
	 *
	 * ---
	 * ### Common use case: creating a consumer group
	 *
	 * When called like:
	 *
	 * ```ts
	 * await redis.xgroup("CREATE", "mystream", "workers", "$", "MKSTREAM");
	 * ```
	 *
	 * This will:
	 * - Create the consumer group `workers` on stream `mystream`.
	 * - Start reading from the latest message (`$`).
	 * - Automatically create the stream if it doesn't exist (`MKSTREAM`).
	 *
	 * ---
	 * ### Parameters
	 *
	 * - `script` — The `XGROUP` subcommand (most often `"CREATE"`).
	 * - `stream` — The Redis stream key (e.g., `"tasks:stream"`).
	 * - `group` — The name of the consumer group.
	 * - `from` — The starting ID position:
	 *   - `"$"` to start from the latest entry
	 *   - `"0"` to read from the beginning
	 *   - or any specific message ID
	 * - `mkstream` — Typically `"MKSTREAM"` to auto-create the stream if missing.
	 *
	 * ---
	 * ### Return value
	 *
	 * - Resolves to `void`.  
	 *   Redis returns `"OK"` on success or an error if the group already exists
	 *   (unless using `CREATE` with `MKSTREAM` safely).
	 *
	 * ---
	 * ### Example: safe group creation
	 *
	 * ```ts
	 * await redis.xgroup(
	 *   "CREATE",
	 *   "queue:events",
	 *   "consumers",
	 *   "$",
	 *   "MKSTREAM"
	 * );
	 * ```
	 *
	 * ---
	 * ### Notes
	 *
	 * - You should call this **before consuming the stream** using `XREADGROUP`.
	 * - If the group already exists, Redis will throw an error unless a different
	 *   subcommand is used.
	 * - This method does not validate the subcommand; it simply forwards arguments
	 *   to `XGROUP`.
	 *
	 * @param script - XGROUP subcommand (commonly `"CREATE"`).
	 * @param stream - Redis stream key.
	 * @param group - Consumer group name.
	 * @param from - ID position to start from (`"0"`, `"$"`, or explicit ID).
	 * @param mkstream - Usually `"MKSTREAM"` to create the stream if missing.
	 */
	async xgroup(script: string, stream: string, group: string, from: string, mkstream: string): Promise<void> {
		await (this.redis as any).xgroup(script, stream, group, from, mkstream);
	}

	/**
	 * Reads messages from a Redis Stream **as part of a consumer group** using the
	 * `XREADGROUP` command.
	 *
	 * This method is a lightweight wrapper over:
	 *
	 * ```
	 * XREADGROUP GROUP <group> <consumer>
	 *   BLOCK <ms> COUNT <n> STREAMS <stream> <id>
	 * ```
	 *
	 * It is used for **group-based, distributed consumption** of stream messages.
	 *
	 * ---
	 * ### How it works
	 *
	 * `XREADGROUP` ensures:
	 * - Messages are **assigned** to a specific consumer.
	 * - Messages are not delivered twice within the same group unless pending.
	 * - Consumers can read from:
	 *   - `">"` — only new messages
	 *   - `"0"` — read pending messages
	 *
	 * The method simply forwards all arguments directly to Redis, allowing flexible
	 * configuration (BLOCK, COUNT, STREAMS, IDs).
	 *
	 * ---
	 * ### Parameters
	 *
	 * - `groupKey` — The `"GROUP"` keyword (always `"GROUP"`).
	 * - `group` — Name of the consumer group.
	 * - `consumer` — Name of the individual consumer (unique per worker).
	 * - `blockKey` — `"BLOCK"` keyword.
	 * - `block` — Block timeout in **milliseconds** (0 = block indefinitely).
	 * - `countKey` — `"COUNT"` keyword.
	 * - `count` — Maximum number of messages to return.
	 * - `streamKey` — `"STREAMS"` keyword.
	 * - `stream` — Name of the stream.
	 * - `condition` — ID to start from:
	 *   - `">"` for new messages
	 *   - last delivered ID for reprocessing
	 *
	 * ---
	 * ### Return value
	 *
	 * Returns the raw Redis `XREADGROUP` response:
	 *
	 * ```
	 * [
	 *   [
	 *     "<stream>",
	 *     [
	 *       ["<id1>", [field, value, field, value, ...]],
	 *       ["<id2>", [...]],
	 *       ...
	 *     ]
	 *   ]
	 * ]
	 * ```
	 *
	 * If no messages arrive before the BLOCK timeout → returns `null`.
	 *
	 * ---
	 * ### Example
	 *
	 * ```ts
	 * const entries = await redis.xreadgroup(
	 *   "GROUP", "workers", "worker-1",
	 *   "BLOCK", 5000,
	 *   "COUNT", 10,
	 *   "STREAMS", "queue:events", ">"
	 * );
	 *
	 * if (entries) {
	 *   for (const [stream, messages] of entries) {
	 *     for (const [id, fields] of messages) {
	 *       console.log("Message ID:", id);
	 *       console.log("Payload:", fields);
	 *     }
	 *   }
	 * }
	 * ```
	 *
	 * ---
	 * ### Notes
	 *
	 * - Consumers must be registered via `XGROUP CREATE` beforehand.
	 * - Pending messages should be acknowledged later using `XACK`.
	 * - This method **does not parse** field-value pairs; it returns Redis raw data.
	 *   Parsing is usually handled at a higher layer.
	 *
	 * @returns The raw Redis response for XREADGROUP, or `null` on timeout.
	 */
	async xreadgroup(groupKey: string, group: string, consumer: string, blockKey: string, block: number, countKey: string, count: number, streamKey: string, stream: string, condition: string): Promise<Array<any>> {
		return await (this.redis as any).xreadgroup(groupKey, group, consumer, blockKey, block, countKey, count, streamKey, stream, condition);
	}

	/**
	 * Returns the remaining TTL (time-to-live) of a Redis key in **milliseconds**.
	 *
	 * This is a simple wrapper around the Redis `PTTL` command:
	 *
	 * ```
	 * PTTL key
	 * ```
	 *
	 * Redis returns:
	 * - a positive number → milliseconds remaining before expiration  
	 * - `0` → key has no remaining time (expires now)  
	 * - `-1` → key exists but **has no expiration**  
	 * - `-2` → key **does not exist**  
	 *
	 * ---
	 * ### Behavior
	 *
	 * The method forwards the call directly to Redis and returns the raw numeric result.
	 * No additional processing or validation is applied to the response.
	 *
	 * ---
	 * ### Use cases
	 *
	 * - Checking when session keys expire  
	 * - Monitoring cache freshness  
	 * - Debugging queue message TTL  
	 * - Conditional logic based on expiration  
	 *
	 * Example:
	 *
	 * ```ts
	 * const ttlMs = await redis.pttl("session:user:42");
	 *
	 * if (ttlMs === -2) {
	 *   console.log("Key does not exist");
	 * } else if (ttlMs === -1) {
	 *   console.log("Key has no expiration");
	 * } else {
	 *   console.log(`Expires in ${ttlMs}ms`);
	 * }
	 * ```
	 *
	 * ---
	 * @param key - Redis key to query.
	 * @returns TTL in milliseconds, or a negative code described above.
	 */
	async pttl(key: string): Promise<number> {
		return await (this.redis as any).pttl(key);
	}
}