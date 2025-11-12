export type JsonPrimitive = string | number | boolean | null;

export type JsonPrimitiveOrUndefined = JsonPrimitive | undefined;

export type Jsonish =
	| JsonPrimitive
	| { [key: string]: Jsonish }
	| Jsonish[];

export interface RedisMultiLike {
	set(key: string, value: string): this;

	set(key: string, value: string, ex: 'EX', ttlSec: number): this;

	rpush(key: string, ...values: string[]): this;

	lpush(key: string, ...values: string[]): this;

	lrange(key: string, start: number, stop: number): this;

	ltrim(key: string, start: number, stop: number): this;

	lrem(key: string, count: number, value: string): this;

	zrem(key: string, ...members: string[]): this;

	zadd(key: string, score: number, member: string): this;

	expire(key: string, ttlSec: number): this;

	exec(): Promise<Array<[Error | null, any]>>;
}

export interface IORedisLike {
	status: 'ready' | 'connecting' | 'reconnecting' | string;

	scan(
		cursor: string,
		matchKeyword: 'MATCH',
		pattern: string,
		countKeyword: 'COUNT',
		count: number
	): Promise<[nextCursor: string, keys: string[]]>;

	get(key: string): Promise<string | null>;

	mget(...keys: string[]): Promise<Array<string | null>>;

	set(key: string, value: string): Promise<'OK'>;

	set(key: string, value: string, ex: 'EX', ttlSec: number): Promise<'OK'>;

	mset(...keyValues: string[]): Promise<'OK'>;

	incr(key: string): Promise<number>;

	llen(key: string): Promise<number>;

	lrange(key: string, start: number, stop: number): Promise<string[]>;

	lpop(key: string, count?: number): Promise<string[] | string | null>;

	rpush(key: string, ...values: string[]): Promise<number>;

	lpush(key: string, ...values: string[]): Promise<number>;

	ltrim(key: string, start: number, stop: number): Promise<'OK'>;

	lrem(key: string, count: number, value: string): Promise<number>;

	lmove?(
		source: string,
		destination: string,
		whereFrom: 'LEFT' | 'RIGHT',
		whereTo: 'LEFT' | 'RIGHT'
	): Promise<string | null>;

	rpoplpush?(source: string, destination: string): Promise<string | null>;

	zadd(key: string, ...args: (string | number)[]): Promise<number>;

	zrem(key: string, ...members: string[]): Promise<number>;

	zrangebyscore(
		key: string,
		min: number | string,
		max: number | string,
		...args: (string | number)[]
	): Promise<string[]>;

	expire(key: string, ttlSec: number): Promise<number>;

	unlink?(...keys: string[]): Promise<number>;

	del(...keys: string[]): Promise<number>;

	multi(): RedisMultiLike;

	script?(
		subcommand: 'LOAD',
		script: string
	): Promise<string>;

	evalsha?(
		sha1: string,
		numKeys: number,
		...args: string[]
	): Promise<any>;

	eval?(
		script: string,
		numKeys: number,
		...args: string[]
	): Promise<any>;

	xgroup?(
		script: string, 
		stream: string, 
		group: string, 
		from: string, 
		mkstream: string
	): Promise<void>;

	xreadgroup?(
		groupKey: string,
		group: string,
		consumer: string,
		blockKey: string,
		block: number,
		countKey: string,
		count: number,
		streamKey: string,
		stream: string,
		condition: string
	): Promise<Array<any>>;

	pttl?(key: string): Promise<number>;
}