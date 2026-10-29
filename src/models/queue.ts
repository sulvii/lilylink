import type { LilyTrack } from "./track";

class QueueNode {
	constructor(
		public value: LilyTrack,
		public prev: QueueNode | null = null,
		public next: QueueNode | null = null,
	) {}
}

export type ShuffleKey = (track: LilyTrack) => string | undefined;

const authorKey: ShuffleKey = (track) => track.author;

function fisherYates(items: LilyTrack[]): void {
	for (let i = items.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[items[i], items[j]] = [items[j], items[i]];
	}
}

export class LilyQueue implements Iterable<LilyTrack> {
	private readonly counts = new Map<LilyTrack, number>();
	private head: QueueNode | null = null;
	private tail: QueueNode | null = null;
	private nodeCount = 0;
	private startIndex: number;

	constructor(queueStartIndex = 0) {
		this.startIndex = Math.max(0, queueStartIndex);
	}

	public setStartIndex(index: number): void {
		this.startIndex = Math.max(0, index);
	}

	public getStartIndex(): number {
		return this.startIndex;
	}

	public get size(): number {
		return this.nodeCount;
	}

	public add(track: LilyTrack): boolean {
		const node = new QueueNode(track, this.tail);
		if (this.tail) {
			this.tail.next = node;
		} else {
			this.head = node;
		}
		this.tail = node;
		this.retain(track);
		this.nodeCount++;
		return true;
	}

	public unshift(track: LilyTrack): boolean {
		const node = new QueueNode(track, null, this.head);
		if (this.head) {
			this.head.prev = node;
		} else {
			this.tail = node;
		}
		this.head = node;
		this.retain(track);
		this.nodeCount++;
		return true;
	}

	public get(position: number): LilyTrack {
		const node = this.nodeAt(position - this.startIndex);
		if (!node) {
			throw new Error("Position out of bounds");
		}
		return node.value;
	}

	public has(track: LilyTrack): boolean {
		return this.counts.has(track);
	}

	public remove(position: number): boolean {
		const node = this.nodeAt(position - this.startIndex);
		if (!node) {
			return false;
		}
		this.unlink(node);
		return true;
	}

	public shift(): LilyTrack {
		const node = this.head;
		if (!node) {
			throw new Error("Queue is empty");
		}
		this.unlink(node);
		return node.value;
	}

	public pop(): LilyTrack {
		const node = this.tail;
		if (!node) {
			throw new Error("Queue is empty");
		}
		this.unlink(node);
		return node.value;
	}

	public clear(): boolean {
		this.counts.clear();
		this.head = null;
		this.tail = null;
		this.nodeCount = 0;
		return true;
	}

	public shuffle(groupBy: ShuffleKey = authorKey): boolean {
		if (this.nodeCount < 2) {
			throw new Error("There must be at least 2 songs in queue!");
		}

		const nodes: QueueNode[] = [];
		const groups = new Map<string, LilyTrack[]>();
		const loners: LilyTrack[] = [];

		for (let current = this.head; current; current = current.next) {
			nodes.push(current);

			const key = groupBy(current.value);
			if (key === undefined) {
				loners.push(current.value);
				continue;
			}

			const group = groups.get(key);
			if (group) {
				group.push(current.value);
			} else {
				groups.set(key, [current.value]);
			}
		}

		const allGroups = [...groups.values(), ...loners.map((track) => [track])];
		const scored: { track: LilyTrack; score: number }[] = [];

		for (const group of allGroups) {
			fisherYates(group);

			const step = 1 / group.length;
			const offset = Math.random() * step;

			for (let i = 0; i < group.length; i++) {
				scored.push({
					track: group[i],
					score: offset + i * step + (Math.random() - 0.5) * step * 0.5,
				});
			}
		}

		scored.sort((a, b) => a.score - b.score);

		for (let i = 0; i < nodes.length; i++) {
			nodes[i].value = scored[i].track;
		}

		return true;
	}

	public *values(): IterableIterator<LilyTrack> {
		for (let current = this.head; current; current = current.next) {
			yield current.value;
		}
	}

	public [Symbol.iterator](): IterableIterator<LilyTrack> {
		return this.values();
	}

	public forEach(callbackfn: (value: LilyTrack, index: number) => void): void {
		let index = this.startIndex;
		for (let current = this.head; current; current = current.next) {
			callbackfn(current.value, index++);
		}
	}

	public map<T>(callbackfn: (value: LilyTrack, index: number) => T): T[] {
		const result: T[] = [];
		let index = this.startIndex;
		for (let current = this.head; current; current = current.next) {
			result.push(callbackfn(current.value, index++));
		}
		return result;
	}

	private nodeAt(index: number): QueueNode | null {
		if (index < 0 || index >= this.nodeCount) {
			return null;
		}

		if (index < this.nodeCount / 2) {
			let current = this.head;
			for (let i = 0; i < index && current; i++) {
				current = current.next;
			}
			return current;
		}

		let current = this.tail;
		for (let i = this.nodeCount - 1; i > index && current; i--) {
			current = current.prev;
		}
		return current;
	}

	private unlink(node: QueueNode): void {
		if (node.prev) {
			node.prev.next = node.next;
		} else {
			this.head = node.next;
		}

		if (node.next) {
			node.next.prev = node.prev;
		} else {
			this.tail = node.prev;
		}

		node.prev = null;
		node.next = null;
		this.release(node.value);
		this.nodeCount--;
	}

	private retain(track: LilyTrack): void {
		this.counts.set(track, (this.counts.get(track) ?? 0) + 1);
	}

	private release(track: LilyTrack): void {
		const count = this.counts.get(track);
		if (count === undefined) {
			return;
		}
		if (count <= 1) {
			this.counts.delete(track);
		} else {
			this.counts.set(track, count - 1);
		}
	}
}
