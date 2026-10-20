import type { Action } from 'svelte/action';

interface RevealOptions {
	delay?: number;
}

const prefersReducedMotion =
	typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Fades/slides an element in the first time it enters the viewport. */
export const reveal: Action<HTMLElement, RevealOptions | undefined> = (node, opts) => {
	node.classList.add('reveal');
	if (opts?.delay) node.style.transitionDelay = `${opts.delay}ms`;

	if (prefersReducedMotion) {
		node.classList.add('is-visible');
		return;
	}

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					node.classList.add('is-visible');
					observer.unobserve(node);
				}
			}
		},
		{ threshold: 0.15 }
	);
	observer.observe(node);

	return {
		destroy() {
			observer.disconnect();
		}
	};
};
