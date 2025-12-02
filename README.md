# PowerRedis — A Safe, Consistent, High‑Performance Redis Abstraction for Node.js Microservices

PowerRedis is a lightweight, reliable, and extensible abstraction layer built on top of Redis for production‑grade Node.js and TypeScript applications.  
It provides a consistent key format system, safe serialization, predictable list operations, SCAN‑based pattern utilities, TTL helpers, and convenience methods missing from raw Redis clients.

This library focuses on **stability, clarity, and real‑world microservice needs**, making Redis usage more maintainable across large distributed systems.

---

## Key Features & Advantages

### ✔ Strict and Predictable Key Formatting  
PowerRedis enforces a consistent, error‑free key style:
- Disallows invalid characters, spaces, forbidden segments, and empty sections  
- Prevents accidental wildcard collisions  
- Ensures uniform key naming across services  

This dramatically reduces debugging time in multi‑team and multi‑service environments.

---

### ✔ Safe and Reliable Payload Serialization  
Built‑in helpers (`toPayload`, `fromPayload`) handle:
- JSON objects  
- Arrays  
- Numeric and boolean primitives  
- String boolean formats (`"yes"`, `"no"`, `"true"`, `"false"`)  
- Empty strings  
- Graceful fallbacks  

This prevents the classic `[object Object]` and malformed JSON issues.

---

### ✔ High‑Level List Operations (Queues, Buffers, Streams)  
Includes utilities not found in basic Redis clients:

- **lpopCountCompat** — a safe polyfill for `LPOP key count`  
- **getListIterator** — async chunk‑based iteration over large lists  
- **pushOne / pushMany** — with optional TTL support  
- **getList(remove=true/false)** — consumption or read‑only mode  

These features are ideal for queueing, batch processing, schedulers, and background jobs.

---

### ✔ SCAN‑Based Pattern Tools (Safe Alternative to KEYS)  
PowerRedis offers efficient mass‑operations without blocking Redis:

- `keys(pattern, limit, scanSize)` — safe pattern scanning  
- `getMany(pattern)` — batch MGET with chunking  
- `dropMany(pattern)` — deletion via `SCAN + UNLINK`  

Usage of `UNLINK` improves performance for large keysets.

---

### ✔ Connection Safety Built In  
`checkConnection()` ensures Redis is ready before any command is executed.

Environment variable `REDIS_STRICT_CHECK_CONNECTION` enables strict or soft connection modes.

---

### ✔ TTL Helpers & Semi‑Atomic Behaviors  
- `setOne` / `setMany` — automatic TTL support  
- `pushOne` / `pushMany` — TTL for lists  
- `incr(key, ttl)` — counter with TTL reset  

These are extremely useful for rate‑limiters, counters, and expiring caches.

---

### ✔ Redis Streams Support  
Convenience wrappers for:
- `XGROUP`
- `XREADGROUP`
- `SCRIPT LOAD`

Works well alongside queue systems or event pipelines.

---

## Installation

```bash
npm install power-redis
```

or

```bash
yarn add power-redis
```

---

## Basic Usage Example

```ts
import { PowerRedis } from 'power-redis';
import Redis from 'ioredis';

class MyRedis extends PowerRedis {
  public redis = new Redis({ host: '127.0.0.1', port: 6379 });
}

const redis = new MyRedis();

(async () => {
  await redis.setOne(
    redis.toKeyString('user', 1, 'profile'),
    { name: 'Alice' },
    3600
  );

  const user = await redis.getOne('user:1:profile');
  console.log(user);
})();
```

---

## Why Not Use Raw ioredis/node‑redis?

Typical Redis clients only expose low‑level commands.  
Real‑world applications quickly accumulate duplicated logic, such as:

- inconsistent key naming  
- unsafe SCAN/KEYS usage  
- repeated JSON encode/decode  
- list pagination boilerplate  
- TTL handling logic  
- mismatched connection state checks  

PowerRedis solves these problems with a clean, unified API layer that keeps your microservices consistent and safe.

---

## Ideal Use Cases

- Node.js / TypeScript microservice ecosystems  
- Distributed architectures  
- High‑volume Redis workloads  
- Queueing and background processing  
- Monitoring, tracking, real‑time data pipelines  
- Systems requiring predictable Redis key structure  

---

## SEO‑Friendly Keywords (naturally integrated)

Redis abstraction layer, Node.js Redis helper, Redis SCAN alternative,  
Redis list utilities, Redis batch operations, high‑performance Redis wrapper,  
safe Redis key builder, Redis TTL manager, Redis queue helper,  
Redis JSON serialization, Redis UNLINK vs DEL, Redis microservice architecture,  
Redis production best practices, Redis Streams wrapper.

---

## License  
MIT
