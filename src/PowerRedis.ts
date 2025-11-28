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

export abstract class PowerRedis {
	public readonly isStrictCheckConnection: boolean = [ 'true', 'on', 'yes', 'y', '1' ].includes(String(process.env.REDIS_STRICT_CHECK_CONNECTION ?? '').trim().toLowerCase());
	public abstract redis: IORedisLike;

	checkConnection(): boolean {
		return !!this.redis && ((this.redis as any).status === 'ready' || (this.isStrictCheckConnection ? false : ((this.redis as any).status === 'connecting' || (this.redis as any).status === 'reconnecting')));
	}

	toPatternString(...parts: Array<string | number>): string {
		for (const p of parts) {
			const s = formatToTrim(p);

			if (!isStrFilled(s) || s.includes(':') || /\s/.test(s)) {
				throw new Error(`Pattern segment invalid (no ":", spaces): "${s}"`);
			}
		}
		return parts.join(':');
	}

	toKeyString(...parts: Array<string | number>): string {
		for (const p of parts) {
			const s = formatToTrim(p);

			if (!isStrFilled(s) || s.includes(':') || /[\*\?\[\]\s]/.test(s)) {
				throw new Error(`Key segment is invalid (no ":", spaces or glob chars * ? [ ] allowed): "${s}"`);
			}
		}
		return parts.join(':');
	}

	fromKeyString(key: string): Array<string> {
		return key.split(':').filter(Boolean);
	}

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

	toPayload(value: Jsonish): string {
		if (isArr(value) || isObj(value)) {
			return jsonEncode(value);
		}
		return String(value ?? '');
	}

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

	async getOne(key: string): Promise<Jsonish | null> {
		if (!isStrFilled(key)) {
			throw new Error('Key format error.');
		}
		if (!this.checkConnection()) {
			throw new Error('Redis connection error.');
		}
		return this.fromPayload(await (this.redis as any).get(key));
	}

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

	async incr(key: string, ttl?: number): Promise<number> { 
		const result = await (this.redis as any).incr(key); 

		if (isNumP(ttl)) {
			await (this.redis as any).pexpire(key, ttl);
		}
		return result;
	}

	async expire(key: string, ttl: number): Promise<number> { 
		return await (this.redis as any).expire(key, ttl); 
	}

	async script(subcommand: 'LOAD', script: string): Promise<string> {
		return await (this.redis as any).script('LOAD', script); 
	}

	async xgroup(script: string, stream: string, group: string, from: string, mkstream: string): Promise<void> {
		await (this.redis as any).xgroup(script, stream, group, from, mkstream);
	}

	async xreadgroup(groupKey: string, group: string, consumer: string, blockKey: string, block: number, countKey: string, count: number, streamKey: string, stream: string, condition: string): Promise<Array<any>> {
		return await (this.redis as any).xreadgroup(groupKey, group, consumer, blockKey, block, countKey, count, streamKey, stream, condition);
	}

	async pttl(key: string): Promise<number> {
		return await (this.redis as any).pttl(key);
	}
}
