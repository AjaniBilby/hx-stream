(function(){

type SwapSpec = { swapStyle: string };

let binding: {
	swap: (target: Element | string, content: string, swapSpec: SwapSpec) => void,
	getSwapSpecification: (target: Element | string) => SwapSpec,
	getAttributeValue: (node: Element, attribute: string) => string | null,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const htmx = (globalThis as any).htmx;
htmx.defineExtension("hx-stream", {
	init: (config: typeof binding) => { binding = config; },
	onEvent: (name: string, event: CustomEvent) => {
		switch (name) {
			case "htmx:beforeRequest": {
				const source = event.detail.elt as Element;

				if (binding.getAttributeValue(source, "hx-stream") !== "on") return;
				event.preventDefault();

				const formData = event.detail.requestConfig.formData as FormData | undefined;
				const headers  = event.detail.requestConfig.headers as Record<string, string>;
				const url      = event.detail.requestConfig.path as string;
				const method   = event.detail.requestConfig.verb as string;
				const target   = event.detail.target as HTMLElement;

				Process(method, url, headers, formData, target).catch(console.error);

				return;
			}
		}
	}
});

const decoder = new TextDecoder("utf8");
async function Process(method: string, url: string, headers: Record<string, string>, formData: FormData | undefined, source: HTMLElement) {
	source.classList.add("htmx-request");
	const req = await fetch(url, { method, headers, body: formData });

	if (!req.ok) {
		console.error(await req.text());
		source.classList.remove("htmx-request");
		return;
	}

	if (!req.body) {
		console.error("hx-stream response is missing body");
		source.classList.remove("htmx-request");
		return;
	}

	const boundary = req.headers.get("X-Chunk-Boundary");
	if (!boundary) {
		console.error("hx-stream response is chunk boundary header");
		source.classList.remove("htmx-request");
		return;
	}

	const reader = req.body.getReader();
	let buffer = "";
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		const html = decoder.decode(value);

		const search = Math.max(0, buffer.length-boundary.length);
		buffer += html;

		let idx = buffer.indexOf(boundary, search);
		while (idx !== -1) {
			const chunk = buffer.slice(0, idx);

			const a = chunk.indexOf("|");
			if (a === -1) return console.error("hx-stream received invalid chunk");
			const b = chunk.indexOf("|", a+1);
			if (b === -1) return console.error("hx-stream received invalid chunk");

			const retarget = chunk.slice(0, a).trim(); // trim to remove any keep alive spaces
			const swap     = chunk.slice(a+1, b);
			const html     = chunk.slice(b+1);

			const target = htmx.find(source, retarget);

			if (target) binding.swap(target, html, { swapStyle: swap });
			else console.warn(`hx-stream unable to find target ${retarget}`);

			buffer = buffer.slice(idx + boundary.length);
			idx = buffer.indexOf(boundary);
		}

		// binding.swap(target, html, { swapStyle: "beforeend" });
	}

	source.classList.remove("htmx-request");
}

})();