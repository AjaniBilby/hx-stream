const encoder = new TextEncoder();
const headers: ResponseInit["headers"] = {
	// Chunked encoding with immediate forwarding by proxies (i.e. nginx)
	"X-Content-Type-Options": "nosniff",
	"X-Accel-Buffering": "no",
	"Transfer-Encoding": "chunked",
	"Content-Type": "text/event-stream",
	// the maximum keep alive chrome shouldn't ignore
	"Keep-Alive": "timeout=60",
	"Connection": "keep-alive",
}

type Options<T extends boolean> = T extends true ? RenderOptions : DefaultOptions;
type DefaultOptions = {
	abortSignal?: AbortSignal;
	highWaterMark?: number
	keepAlive?: number,
};
type RenderOptions = { render: (jsx: JSX.Element) => string } & DefaultOptions;

type HasRender<O> = O extends { render: (jsx: JSX.Element) => string } ? true : false;


const SCALE = 36**6;
function MakeBoundary() {
	return "hx-"+Math.floor(Math.random()*SCALE).toString(36);
}


export class StreamResponse<JsxEnabled extends boolean> {
	#controller: ReadableStreamDefaultController | null;
	#signal?: AbortSignal;
	#timer: number | null;
	#state: number;
	#boundary: string;
	#render?: (jsx: JSX.Element) => string;

	readonly response: Response;

	get readyState() { return this.#state; }

	static CONNECTING = 0;
	static OPEN       = 1;
	static CLOSED     = 2;

	constructor(options: Options<JsxEnabled>) {
		this.#controller = null;
		this.#state = StreamResponse.CONNECTING;
		this.#render = (options as Options<true>).render;
		this.#boundary = MakeBoundary();

		// immediate prepare for abortion
		this.#signal = options.abortSignal;
		const cancel = () => { this.close(); this.#signal?.removeEventListener("abort", cancel) };
		this.#signal?.addEventListener('abort', cancel);

		const start  = (c: ReadableStreamDefaultController<Uint8Array>) => { this.#controller = c; this.#state = StreamResponse.OPEN; };
		const stream = new ReadableStream<Uint8Array>({ start, cancel }, { highWaterMark: options.highWaterMark });

		this.response = new Response(stream, { headers });
		this.response.headers.set("X-Chunk-Boundary", this.#boundary);

		this.#timer = setInterval(() => this.keepAlive(), options.keepAlive || 30_000);
	}

	bind(controller: ReadableByteStreamController) {
		this.#controller = controller;
	}

	private sendBytes(chunk: Uint8Array) {
		if (this.#state === StreamResponse.CLOSED) {
			const err = new Error(`Warn: Attempted to send data on closed hx-stream`);
			console.warn(err);
			return false;
		}

		if (this.#signal?.aborted) {
			this.close();
			return false;
		}

		if (!this.#controller) return false;

		try {
			this.#controller.enqueue(chunk);
		} catch (e) {
			console.error(e);
			this.close(); // unbind on failure
			return false;
		}

		return true;
	}

	private sendText(chunk: string) {
		return this.sendBytes(encoder.encode(chunk));
	}

	private keepAlive() { return this.sendText(" "); }

	send(target: string, swap: string, html: JsxEnabled extends true ? (JSX.Element | string) : string) {
		if (typeof html !== "string") {
			if (!this.#render) throw new Error(`Cannot render to JSX when no renderer provided during class initialization`);
			html = this.#render(html);
		}

		return this.sendText(`<${this.#boundary}>${target}|${swap}|${html}</${this.#boundary}>\n`);
	}

	close () {
		if (this.#controller) {
			try { this.#controller.close(); }
			catch (e) { console.error(e); }
			this.#controller = null;
		}

		// Cleanup
		if (this.#timer) clearInterval(this.#timer);

		// was already closed
		if (this.#state === EventSource.CLOSED) return false;

		// Mark closed
		this.#state = StreamResponse.CLOSED;

		return true;
	}
}



export function MakeStream<T extends Partial<RenderOptions>>(
	props: T,
	cb: (stream: StreamResponse<HasRender<T>>, props: T) => Promise<void> | void
): Response {
	const stream = new StreamResponse(props);

	queueMicrotask(() => {
		const p = cb(stream, props);
		if (p instanceof Promise) p.catch(console.error);
	})

	return stream.response;
}