const WIKILINK_RE = /^!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/;
const MARKDOWN_IMAGE_RE =
	/^!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)$/;

function isHttpOrDataUrl(value: string): boolean {
	return /^(?:https?:\/\/|data:image\/)/i.test(value.trim());
}

function unwrapImageMarkup(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return '';

	const wikilinkMatch = trimmed.match(WIKILINK_RE);
	if (wikilinkMatch) return wikilinkMatch[1].trim();

	const markdownMatch = trimmed.match(MARKDOWN_IMAGE_RE);
	if (markdownMatch) return (markdownMatch[1] ?? markdownMatch[2]).trim();

	return trimmed;
}

function cleanLinkText(raw: string): string {
	let target = unwrapImageMarkup(raw);
	target = target.split('#')[0].split('|')[0].trim();

	try {
		target = decodeURIComponent(target);
	} catch {
		// Keep original if decoding fails.
	}
	return target;
}

export interface CoverCandidate {
	kind: 'url' | 'path';
	value: string;
}

export function parseCoverCandidate(raw: unknown): CoverCandidate | null {
	if (raw == null) return null;
	const text = String(raw).trim();
	if (!text) return null;

	const unwrapped = unwrapImageMarkup(text);
	if (isHttpOrDataUrl(unwrapped)) {
		return { kind: 'url', value: unwrapped };
	}

	const cleaned = cleanLinkText(text);
	if (!cleaned) return null;

	return { kind: 'path', value: cleaned };
}

interface CoverLike {
	parentElement: { classList: { add: (className: string) => void } } | null;
	remove: () => void;
}

export function hideBrokenCover(cover: CoverLike): void {
	const card = cover.parentElement;
	cover.remove();
	card?.classList.add('is-text-only');
}
