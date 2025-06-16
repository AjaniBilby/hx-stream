const encoder = new TextEncoder();
const headers: ResponseInit["headers"] = {
	// Chunked encoding with immediate forwarding by proxies (i.e. nginx)
	"X-Content-Type-Options": "nosniff",
	"X-Accel-Buffering": "no",
	"Transfer-Encoding": "chunked",
	"Content-Type": "text/html",
	// the maximum keep alive chrome shouldn't ignore
	"Keep-Alive": "timeout=60",
	"Connection": "keep-alive",
}

type Options<T extends boolean> = T extends true ? RenderOptions : DefaultOptions;
type DefaultOptions = { keepAlive?: number, highWaterMark?: number };
type RenderOptions  = { render: (jsx: JSX.Element) => string } & DefaultOptions;

type HasRender<O> = O extends { render: (jsx: JSX.Element) => string } ? true : false;


const SCALE = 36**6;
function MakeBoundary() {
	return "hx-"+Math.floor(Math.random()*SCALE).toString(36);
}


export class StreamResponse<JsxEnabled extends boolean> {
	#controller: ReadableStreamDefaultController | null;
	#signal: AbortSignal;
	#timer: number | null;
	#state: number;
	#boundary: string;
	#render?: (jsx: JSX.Element) => string;

	readonly response: Response;


	// just to make it polyfill
	readonly withCredentials: boolean;
	readonly url: string;

	get readyState() { return this.#state; }

	static CONNECTING = 0;
	static OPEN       = 1;
	static CLOSED     = 2;

	constructor(request: Request, options: Options<JsxEnabled>) {
		this.#controller = null;
		this.#state = StreamResponse.CONNECTING;
		this.#render = (options as Options<true>).render;
		this.#boundary = MakeBoundary();
		this.withCredentials = request.mode === "cors";
		this.url = request.url;

		// immediate prepare for abortion
		const cancel = () => { this.close(); request.signal.removeEventListener("abort", cancel) };
		request.signal.addEventListener('abort', cancel);
		this.#signal = request.signal;

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
			const err = new Error(`Warn: Attempted to send data on closed stream for: ${this.url}`);
			console.warn(err);
		}

		if (this.#signal.aborted) {
			this.close();
			return false;
		}

		if (!this.#controller) return false;

		try {
			this.#controller.enqueue(chunk);
			return true;
		} catch (e) {
			console.error(e);
			this.close(); // unbind on failure
			return false;
		}
	}

	private sendText(chunk: string) {
		return this.sendBytes(encoder.encode(chunk));
	}

	private keepAlive() { return this.sendText(" "); }

	send (target: string, swap: string, html: JsxEnabled extends true ? (JSX.Element | string) : string) {
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


export function MakeRawStream<O extends (DefaultOptions | RenderOptions)>(
	request: Request,
	options: O
): StreamResponse<HasRender<O>> {
	return new StreamResponse(request, options as any);
}

export function MakeStream<T extends Partial<RenderOptions>>(
	request: Request,
	props: T,
	cb: (stream: StreamResponse<HasRender<T>>, props: T) => Promise<void> | void
): Response {
	const stream = MakeRawStream(request, props);

	queueMicrotask(() => {
		const p = cb(stream, props);
		if (p instanceof Promise) p.catch(console.error);
	})

	return stream.response;
}