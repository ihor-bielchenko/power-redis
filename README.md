# PowerRedis
Lightweight, type-safe abstraction over Redis for Node.js and TypeScript. It enforces predictable key patterns, safe JSON serialization, atomic list operations, and efficient SCAN/MGET chunking for large datasets.

## It standardizes:
- safe key and pattern construction (strict segment validation),
- JSON payload (de)serialization,
- efficient bulk reads (SCAN + MGET with chunking),
- LPOP key count compatibility (emulated via MULTI when needed),
- convenient list handling (iterators, "safe" batch reads),
- grouped writes (MSET / MULTI SET EX) and pattern-based deletion (UNLINK/DEL).

The class is not tied to a specific client: you provide an object compatible with the IORedisLike interface, and the subclass defines the actual client through the redis field.

## Why is this needed?
- Keys are often built "haphazardly" → making search and cleanup difficult.
- Payloads vary between plain strings and JSON → causing type confusion.
- Bulk operations (SCAN/MGET/deletion) can easily "shoot you in the foot" performance-wise.
- Different client versions handle LPOP count inconsistently.

<b>power-redis</b> addresses all of this in a consistent and clean way, saving your time and reducing the number of bugs.

## API (with examples)
Below are brief excerpts. Full JSDoc: power-redis.docs.ihor.bielchenko.com.

## Fast start
```javascript
import Redis from 'ioredis';
import { PowerRedis } from 'power-redis';
import type { IORedisLike } from 'power-redis';

class MyRedis extends PowerRedis {
	public redis: IORedisLike;
	constructor(conn: IORedisLike) {
		super();
		this.redis = conn;
	}
}

// Create client
const client = new Redis(process.env.REDIS_URL);

// Wrap in PowerRedis
const pr = new MyRedis(client);

(async () => {
	// Build safe key
	const key = pr.toKeyString('user', 'profile', 42); // 'user:profile:42'

	// Write a JSON value with a 1-hour TTL
	await pr.setOne(key, { name: 'Ihor', tz: 'Europe/Madrid' }, 3600);

	// Read it back with automatic parsing
	const user = await pr.getOne(key); // -> { name: 'Ihor', tz: 'Europe/Madrid' }

	// Bulk read of all user profiles (up to 10k items)
	const map = await pr.getMany('user:profile:*', 10_000);

	console.log(user, Object.keys(map).length);
})();
```

## Core Concepts and Terms
#### 1) Safe Keys and Patterns
- ```toKeyString(...parts)``` — builds a strict key in the form ```a:b:c```. The following characters are not allowed in segments: ```:```, spaces, and glob symbols ```*```, ```?```, ```[```, ```]```.

- ```toPatternString(...parts)``` — builds a strict base for SCAN MATCH.<br />
```javascript
const base = pr.toPatternString('queue', 'orders'); // "queue:orders"
const pattern = `${base}:*`;                        // "queue:orders:*"
```
This enforces consistent naming, simplifies navigation, and makes data cleanup easier.

#### 2) Serialization and deserialization
- ```toPayload(value)```
	- objects/arrays → JSON-string,
	- primitives → string,
	- ```null/undefined``` → ''.

- ```fromPayload(str)``` performs the reverse:
	- ```null``` → ```null```,
	- '' → empty string,
	- valid JSON → object/array/number/string/boolean,
	- boolean-like strings (```'true'/'false'/'yes'/'no'```) → ```true/false```,
	- otherwise — returns the original string.

#### 3) Connection readiness model
- ```checkConnection()``` returns ```true```, if:
	- ```status === 'ready'```, or
	- (if the environment variable ```REDIS_STRICT_CHECK_CONNECTION``` is <b>not</b> set) the statuses ```'connecting'/'reconnecting'``` are treated as "conditionally healthy".
- For critical paths, you can explicitly require the ```'ready'``` state (see recommendations below).

#### 4) Bulk operations and performance
- ```keys(pattern, limit, scanSize)``` — uses SCAN with ```COUNT=scanSize``` and early stop at ```limit```.
- ```getMany(pattern, limit, scanSize, chunkSize)``` — SCAN → chunked ```MGET``` (by ```chunkSize```).
- ```dropMany(pattern, size)``` — SCAN in chunks and deletion via ```UNLINK``` (if available) otherwise ```DEL```.

This approach balances load and memory usage without blocking Redis.

#### 5) Working with lists
- ```lpopCountCompat(key, count)``` — uses ```LPOP key count``` if supported by the client, otherwise emulates it via ```MULTI (LRANGE + LTRIM)```.
- ```getList(key, limit, remove)``` and ```getListIterator```:
	- ```remove=true``` — destructive batched reading (atomic per batch).
	- ```remove=false``` — windowed reading by indexes (LLEN/LRANGE), not isolated from race conditions.

### ```checkConnection(): boolean```
Checks client readiness: true/false.<br />
<b>Tip:</b> in places where a strictly ready connection is required, explicitly check ```this.redis.status === 'ready'```.
<hr />

### ```toKeyString(...parts): string```
Builds a strict Redis key ```a:b:c```.
```javascript
const key = pr.toKeyString('user','profile',42); // 'user:profile:42'
```
<b>Throws:</b> if a segment is empty, contains ```:```, spaces, ```*```, ```?```, ```[```, ```]```.
<hr />

### ```toPatternString(...parts): string```
Builds a strict base for ```SCAN MATCH```.
```javascript
const base = pr.toPatternString('user','profile');
const pattern = `${base}:*`; // 'user:profile:*'
```
<b>Throws:</b> if a segment is empty or contains ```:```/spaces.
<hr />

### ```fromKeyString(key: string): string[]```
Splits the key ```a:b:c``` into segments.
```javascript
pr.fromKeyString('a::b:c') // ['a','b','c']
```
<hr />

### ```toPayload(value: Jsonish): string / fromPayload(value: string|null): Jsonish```
Convert values to and from strings (see section above).
```javascript
const raw = pr.toPayload({a:1}); // '{"a":1}'
const val = pr.fromPayload(raw); // {a:1}
```
<hr />

### ```lpopCountCompat(key: string, count: number): Promise<string[]>```
Performs paired ```LPOP key count``` or emulates it via ```MULTI```.
```javascript
const raws = await pr.lpopCountCompat('queue:jobs', 100);
```
<b>Throws:</b> in case of invalid arguments or client error.
<hr />

### ```keys(pattern: string, limit = 100, scanSize = 1000): Promise<string[]>```
Iterates SCAN and returns up to ```limit``` unique keys.
```javascript
const ks = await pr.keys('user:profile:*', 5000, 2000);
```
<b>Throws:</b> in case of invalid arguments or connection issues.
<hr />

### ```getOne(key: string): Promise<Jsonish|null>```
```GET``` with automatic ```fromPayload```.
```javascript
const user = await pr.getOne(pr.toKeyString('user', 'profile', 42));
```
<hr />

### ```getMany(pattern, limit=100, scanSize=1000, chunkSize=1000): Promise<Record<string, Jsonish>>```
SCAN → chunked ```MGET``` → ```fromPayload``` for each item.
```javascript
const map = await pr.getMany('session:*', 10_000, 1000, 500);
```
<hr />

### ```getList(key, limit=100, remove=false): Promise<Jsonish[]>```
Collects up to ```limit``` list elements (destructively or non-destructively).
```javascript
const items = await pr.getList('logs:ingest', 500, false);
```
<hr />

### ```getListIterator(key, limit=100, remove=false): AsyncGenerator<Jsonish[]>```
Asynchronous generator iterating through the list in batches.
```javascript
for await (const batch of pr.getListIterator('queue:jobs', 256, true)) {
	await processBatch(batch);
}
```
<hr />

### ```setOne(key, value, ttlSec?): Promise<'OK'>```
```SET``` (+ ```EX``` when ```ttlSec``` is provided).
```javascript
await pr.setOne('config:featureX', { enabled: true }, 3600);
```
<hr />

### ```setMany(values, ttlSec?): Promise<number>```
Bulk write:
	- without TTL — ```MSET```,
	- with TTL — ```MULTI``` using ```SET EX``` for each key.
```javascript
await pr.setMany([
	{ key: 'cfg:a', value: 1 },
	{ key: 'cfg:b', value: { x: true } },
], 600);
```
Returns the number of successfully written elements.
<hr />

### ```pushOne(key, value, ttlSec?): Promise<number>```
```RPUSH``` 1 item (+ ```EXPIRE``` in ```MULTI```, if ```ttlSec``` is provided).
```javascript
await pr.pushOne('logs:ingest', { msg: 'hello' }, 86400);
```
Returns the new length of the list.
<hr />

### ```pushMany(key, values, ttlSec?): Promise<number>```
```RPUSH ...values``` (+ ```EXPIRE``` in ```MULTI```, if ```ttlSec``` is provided).
```javascript
await pr.pushMany('queue:jobs', [{ id:1 }, { id:2 }, { id:3 }], 3600);
```
<hr />

### ```dropMany(pattern: string, size = 1000): Promise<number>```
Deletes keys by pattern in chunks:
	- prefers ```UNLINK``` (asynchronous cleanup),
	- otherwise uses ```DEL```.
```javascript
const n = await pr.dropMany('tmp:*', 2000);
```
<hr />

### ```incr(key: string): Promise<number>```
Atomically increments an integer value by 1 (```INCR```).
```javascript
const n = await pr.incr(pr.toKeyString('rate', 'ip', '203.0.113.7'));
```
If the key doesn’t exist, it becomes 1. If it stores a non-numeric value, Redis will return a type error.
<hr />

### ```expire(key: string, ttl: number): Promise<number>```
Sets TTL in seconds (EXPIRE).
```javascript
await pr.expire('logs:ingest', 86400); // сутки
```
Returns 1 if set, or 0 if the key doesn’t exist / TTL wasn’t applied.
<hr />

## Best Practices

#### Keys and patterns
- Always build them using ```toKeyString```/```toPatternString```.
- Add wildcards (```'*'```), to patterns manually, not through the helper methods.

#### Connection readiness
- For critical paths (money, billing, non-retryable operations), always check strictly:
```javascript
if (pr.redis.status !== 'ready') {
	throw new Error('Redis not ready');
}
```

#### Bulk operations
- Don’t set ```scanSize```/```chunkSize``` too high — usually 1000–5000 is sufficient.
- Remember: SCAN is <b>cursor-iterated</b>, not an instantaneous snapshot.

#### Lists
- If you need guaranteed "take-and-remove" behavior, use ```remove=true``` in ```getList```/```getListIterator```.
- If you just want to "peek", use ```remove=false```, but keep in mind that the list may change.

#### TTL
- TTL always applies to the <b>key</b> level, not to individual list elements.

#### Logging
- In ```catch```, include context (pattern, chunk sizes, key) — it saves hours during incident debugging.

## Common mistakes and how to avoid them

#### "Why did getMany return an empty object?"
The pattern is too narrow, or SCAN didn’t find any keys within the specified ```limit```. Increase ```limit```/```scanSize``` and verify your pattern.

#### "Why is the value a string instead of an object?"
You wrote the value directly through the client, bypassing ```toPayload```. Use ```setOne```/```setMany``` or serialize it to JSON yourself.

#### "Lists are read with gaps"
That’s normal for ```remove=false``` (index-based reading). If you need deterministic results, read with ```remove=true```.

#### "Pattern-based deletion is slow"
Use a reasonable ```size``` (for example, 1000–5000) and give background ```UNLINK``` operations time to complete. Avoid running many ```dropMany``` calls in parallel.

## FAQ

#### "Does this work only with ioredis?"
No. Any client implementing ```IORedisLike``` will work (just implement methods like ```get```/```mget```/```set```/```mset```/```scan```/... and ```multi()``` with the required commands).

#### "How to store complex objects?"
Store them as JSON — ```setOne``` and ```toPayload``` handle this for you. Read them back using ```getOne```/```fromPayload```.

#### "How to clean data by pattern?"
```dropMany('prefix:*', 2000)```. Remember that ```UNLINK``` is asynchronous, so deletion may take some time.

## License
Use freely in your own projects. Add proper notices if you publish a package (MIT/Apache-2.0, etc.).