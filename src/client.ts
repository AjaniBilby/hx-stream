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

	const open  = `<${boundary}>`;
	const close = `</${boundary}>`;

	const reader = req.body.getReader();
	let buffer = "";
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		const html = decoder.decode(value);

		const search = Math.max(0, buffer.length-close.length);
		buffer += html;

		let idx = buffer.indexOf(close, search);
		while (idx !== -1) {
			let a = buffer.lastIndexOf(open, idx);
			if (a === -1) return console.error("hx-stream received invalid chunk");
			a += open.length;

			const b = buffer.indexOf("|", a);
			if (b === -1) return console.error("hx-stream received invalid chunk");
			const c = buffer.indexOf("|", b+1);
			if (c === -1) return console.error("hx-stream received invalid chunk");

			const retarget = buffer.slice(a, b).trim();
			const swap     = buffer.slice(b+1, c).trim();
			const html     = buffer.slice(c+1, idx);

			const target = htmx.find(source, retarget);

			if (target) binding.swap(target, html, { swapStyle: swap });
			else console.warn(`hx-stream unable to find target ${retarget}`);

			buffer = buffer.slice(idx + close.length);
			idx = buffer.indexOf(close);
		}
	}

	source.classList.remove("htmx-request");
}

})();