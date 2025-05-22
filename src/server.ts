const encoder = new TextEncoder();
const headers: ResponseInit["headers"] = {
	// Chunked encoding with immediate forwarding by proxies (i.e. nginx)
	"X-Accel-Buffering": "no",
	"Transfer-Encoding": "chunked",
	"Content-Type": "text/html",
	// the maximum keep alive chrome shouldn't ignore
	"Keep-Alive": "timeout=60",
	"Connection": "keep-alive",
}

export class StreamResponse {
	#controller: ReadableStreamDefaultController | null;
	#timer: number | null;
	#state: number;

	readonly response: Response;


	// just to make it polyfill
	readonly withCredentials: boolean;
	readonly url: string;

	get readyState() { return this.#state; }

	static CONNECTING = 0;
	static OPEN       = 1;
	static CLOSED     = 2;



	constructor(request: Request, keepAlive = 30_000) {
		this.#controller = null;
		this.#state = StreamResponse.CONNECTING;
		this.withCredentials = request.mode === "cors";
		this.url = request.url;

		// immediate prepare for abortion
		const cancel = () => { this.close(); };
		request.signal.addEventListener('abort', cancel);

		const start  = (c: ReadableStreamDefaultController<Uint8Array>) => { this.#controller = c; this.#state = StreamResponse.OPEN; };
		const stream = new ReadableStream<Uint8Array>({ start, cancel }, { highWaterMark: 0 });

		this.response = new Response(stream, { headers });
		this.#timer = setInterval(() => this.keepAlive(), keepAlive);
	}

	private sendBytes(chunk: Uint8Array) {
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

	send (target: string, swap: string, html: string) {
		if (this.#state === StreamResponse.CLOSED) {
			const err = new Error(`Warn: Attempted to send data on closed stream for: ${this.url}`);
			console.warn(err);
		}
		return this.sendText(`<div hx-swap-oob="${swap}:${target}">${html}</div>`);
	}

	close () {
		if (this.#state === StreamResponse.CLOSED) {
			this.#controller = null;
			return false;
		}

		if (this.#controller) {
			try { this.#controller.close(); }
			catch (e) { console.error(e); }
			this.#controller = null;
		}

		// Cleanup
		if (this.#timer) clearInterval(this.#timer);

		// Mark closed
		this.#state = StreamResponse.CLOSED;

		return true;
	}
}