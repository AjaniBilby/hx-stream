(function(){

type SwapSpec = { swapStyle: string };

let binding: {
	swap: (target: Element | string, content: string, swapSpec: SwapSpec) => void,
	getSwapSpecification: (target: Element | string) => SwapSpec,
	getAttributeValue: (node: Element, attribute: string) => string | null,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).htmx.defineExtension("hx-stream", {
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
async function Process(method: string, url: string, headers: Record<string, string>, formData: FormData | undefined, target: HTMLElement) {
	target.classList.add("htmx-request");
	const req = await fetch(url, { method, headers, body: formData });

	if (!req.ok) {
		console.error(await req.text());
		target.classList.remove("htmx-request");
		return;
	}

	if (!req.body) {
		console.error("hx-stream response is missing body");
		target.classList.remove("htmx-request");
		return;
	}

	const reader = req.body.getReader();
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const { done, value: buffer } = await reader.read();
		if (done) break;

		const html = decoder.decode(buffer).trim();
		if (html === "") continue; // ignore keepalive byte

		binding.swap(target, html, { swapStyle: "beforeend" });
	}

	target.classList.remove("htmx-request");
}

})()