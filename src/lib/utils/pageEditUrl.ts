import { base } from '$app/paths';
import { contentLang } from '$lib/stores/contentLang.svelte';

/**
 * URL of the page editor for `route`, carrying the content language as `?lang=`
 * so the link opens the page in that language wherever it is shared.
 *
 * `lang` defaults to the active content language when the site is multilingual
 * and is left off otherwise. Pass `null` to build a link with no language.
 */
export function pageEditUrl(route: string, lang?: string | null): string {
	const path = `${base}/pages/edit${route.startsWith('/') ? route : '/' + route}`;
	const code = lang === undefined ? (contentLang.enabled ? contentLang.activeLang : '') : lang;
	return code ? `${path}?lang=${encodeURIComponent(code)}` : path;
}
