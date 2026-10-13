import entries from "./content-index.js";

const byPath = new Map(entries.map((entry) => [entry.path, entry]));
const directories = new Set([""]);

// Build each parent directory from all path prefixes.
for (const entry of entries) {
	const parts = entry.path.split("/");
	for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join("/"));
}

const childrenByDirectory = new Map();
for (const entry of entries) {
	const parts = entry.path.split("/");
	const name = parts.pop();
	const parent = parts.join("/");
	if (!childrenByDirectory.has(parent)) childrenByDirectory.set(parent, new Map());
	childrenByDirectory.get(parent).set(name, { ...entry, name, directory: false });
}
for (const directory of directories) {
	const parts = directory ? directory.split("/") : [];
	const name = parts.at(-1);
	if (!name) continue;
	const parent = parts.slice(0, -1).join("/");
	if (!childrenByDirectory.has(parent)) childrenByDirectory.set(parent, new Map());
	childrenByDirectory.get(parent).set(name, { path: directory, name, directory: true });
}

const encoder = new TextEncoder();
const DATE_WIDTH = 19;

function humanSize(size) {
	if (size < 1024) return `${size}B`;
	const units = ["K", "M", "G", "T"];
	let value = size;
	let unit = -1;
	do {
		value /= 1024;
		unit++;
	} while (value >= 1024 && unit < units.length - 1);
	return `${value < 10 ? value.toFixed(1) : Math.round(value)}${units[unit]}`;
}

function escapePath(path) {
	return path.split("/").map(encodeURIComponent).join("/");
}

function escapeHtml(value) {
	return value.replace(/[&<>"']/g, (character) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;",
	})[character]);
}

function listing(path, asHtml) {
	const children = [...(childrenByDirectory.get(path) ?? new Map()).values()]
		.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "variant", numeric: true }));
	const current = { path, name: ".", directory: true };
	const parentPath = path ? path.split("/").slice(0, -1).join("/") : "";
	const parent = { path: parentPath, name: "..", directory: true };
	const sizeWidth = Math.max(6, ...children.map((item) => (item.directory ? 1 : humanSize(item.size).length)));
	const renderedRows = [
		current,
		parent,
		...children,
	].map((item) => {
		const isDirectory = item.directory;
		const mode = isDirectory ? "drwxr-xr-x" : "-rw-r--r--";
		const size = (isDirectory ? "-" : humanSize(item.size)).padStart(sizeWidth);
		const modified = isDirectory || !item.modified
			? " ".repeat(DATE_WIDTH)
			: item.modified.padEnd(DATE_WIDTH).slice(0, DATE_WIDTH);
		const marker = isDirectory ? "/" : "";
		const label = `${item.name}${marker}`;
		const prefix = `${mode} 1 blog blog ${size} ${modified} `;
		const href = `/${escapePath(item.path)}${isDirectory && item.path ? "/" : ""}`;
		return {
			plain: `${prefix}${label}`,
			html: `${prefix}<a href="${href}">${escapeHtml(label)}</a>`,
		};
	});
	const totalBlocks = Math.ceil(children.reduce((total, item) => total + (item.size ?? 0), 0) / 512);
	const plainBody = `total ${totalBlocks}\n${renderedRows.map((row) => row.plain).join("\n")}\n`;
	const body = asHtml
		? `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Index of /${escapeHtml(path)}</title><style>body{margin:1rem}pre{box-sizing:border-box;max-width:100%;overflow-x:auto;white-space:pre;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:clamp(.72rem,2.5vw,1rem)}</style></head><body><h1>Index of /${escapeHtml(path)}</h1><pre>total ${totalBlocks}\n${renderedRows.map((row) => row.html).join("\n")}\n</pre></body></html>`
		: plainBody;
	return new Response(body, {
		headers: {
			"content-type": asHtml ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
			"content-length": String(encoder.encode(body).byteLength),
			"x-content-type-options": "nosniff",
			"cache-control": "public, max-age=60",
		},
	});
}

export default {
	async fetch(request, env) {
		if (request.method !== "GET" && request.method !== "HEAD") {
			return new Response("Method Not Allowed\n", {
				status: 405,
				headers: { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" },
			});
		}

		const url = new URL(request.url);
		let path;
		try {
			path = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, "");
		} catch {
			return new Response("Bad Request\n", { status: 400 });
		}
		if (path.split("/").some((part) => part === "." || part === ".." || part.includes("\\"))) {
			return new Response("Bad Request\n", { status: 400 });
		}

		if (directories.has(path)) {
			if (path && !url.pathname.endsWith("/")) {
				url.pathname = `/${escapePath(path)}/`;
				return Response.redirect(url, 308);
			}
			const acceptsHtml = request.headers.get("accept")?.includes("text/html") ?? false;
			const response = listing(path, acceptsHtml);
			if (request.method === "HEAD") return new Response(null, response);
			return response;
		}

		if (!byPath.has(path)) return new Response("Not Found\n", {
			status: 404,
			headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" },
		});

		const assetResponse = await env.ASSETS.fetch(request);
		const headers = new Headers(assetResponse.headers);
		headers.set("x-content-type-options", "nosniff");
		headers.set("cache-control", "public, max-age=300");
		return new Response(request.method === "HEAD" ? null : assetResponse.body, {
			status: assetResponse.status,
			statusText: assetResponse.statusText,
			headers,
		});
	},
};
