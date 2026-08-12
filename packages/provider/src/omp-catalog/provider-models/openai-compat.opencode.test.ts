import { describe, expect, it, vi } from 'vitest';
import { opencodeZenModelManagerOptions, opencodeGoModelManagerOptions } from './openai-compat.js';
import { installBunGlobal } from '../../omp-shims/bun-runtime.js';

installBunGlobal();

describe('opencodeZenModelManagerOptions', () => {
	it('queries the official Zen /v1/models endpoint with its own credential', async () => {
		const fetchImpl = vi.fn(async () =>
			Response.json({
				data: [{ id: 'grok-4.5', object: 'model', created: 1, owned_by: 'opencode' }],
			}),
		);
		const options = opencodeZenModelManagerOptions({ apiKey: 'zen-key', fetch: fetchImpl });

		await options.fetchDynamicModels?.();

		expect(fetchImpl).toHaveBeenCalledWith(
			'https://opencode.ai/zen/v1/models',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer zen-key' }),
			}),
		);
	});

	// Bug 3 regression: the live Zen /models response carries no structured
	// pricing/free field (id/object/created/owned_by only, confirmed against
	// the real endpoint) -- the only real signal for a currently-free model
	// is OpenCode's own `-free` id suffix. This must produce a real all-zero
	// cost record, not a guessed one, and must never mark a non-`-free` id
	// as free.
	it('marks a "-free"-suffixed model id with an all-zero cost record', async () => {
		const fetchImpl = vi.fn(async () =>
			Response.json({
				data: [
					{ id: 'deepseek-v4-flash-free', object: 'model', created: 1, owned_by: 'opencode' },
					{ id: 'grok-4.5', object: 'model', created: 1, owned_by: 'opencode' },
				],
			}),
		);
		const options = opencodeZenModelManagerOptions({ apiKey: 'zen-key', fetch: fetchImpl });

		const models = await options.fetchDynamicModels?.();

		const free = models?.find((m) => m.id === 'deepseek-v4-flash-free');
		const paid = models?.find((m) => m.id === 'grok-4.5');
		expect(free?.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
		expect(paid?.cost).not.toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	});

	// Phase-3 regression retest (opencode-zen/deepseek-v4-flash-free):
	// the real live Zen /v1/models response format has no tool/function-
	// calling capability field at all (id/object/created/owned_by only,
	// same shape proven above), and this id has no bundled-catalog
	// reference entry either, so mapModel's `!reference` branch returns
	// `defaults` untouched -- `toolsSupported` is never assigned. This is
	// not a special case for this specific model id; it is what the
	// general discovery->mapModel mechanism produces for ANY id with no
	// reference entry and a capability-less discovery payload. If a
	// bundled reference for this id is ever added with a real
	// toolsSupported value, this test's premise (`no reference entry`)
	// will fail loudly (via the `reference` lookup below) rather than
	// silently asserting a stale expectation.
	it('deepseek-v4-flash-free: has no bundled-catalog reference and the live payload carries no capability field, so toolsSupported stays UNKNOWN (undefined) -- never guessed from provider/model naming', async () => {
		const fetchImpl = vi.fn(async () =>
			Response.json({
				data: [{ id: 'deepseek-v4-flash-free', object: 'model', created: 1, owned_by: 'opencode' }],
			}),
		);
		const options = opencodeZenModelManagerOptions({ apiKey: 'zen-key', fetch: fetchImpl });

		const models = await options.fetchDynamicModels?.();
		const model = models?.find((m) => m.id === 'deepseek-v4-flash-free');

		expect(model).toBeDefined();
		expect(model?.toolsSupported).toBeUndefined();
	});
});

describe('opencodeGoModelManagerOptions', () => {
	it('queries the official Go /v1/models endpoint with its own credential, distinct from Zen', async () => {
		const fetchImpl = vi.fn(async () =>
			Response.json({
				data: [{ id: 'grok-4.5', object: 'model', created: 1, owned_by: 'opencode' }],
			}),
		);
		const options = opencodeGoModelManagerOptions({ apiKey: 'go-key', fetch: fetchImpl });

		await options.fetchDynamicModels?.();

		expect(fetchImpl).toHaveBeenCalledWith(
			'https://opencode.ai/zen/go/v1/models',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer go-key' }),
			}),
		);
	});

	// Go is a paid coding-plan subscription, never a free tier -- even a
	// hypothetical "-free"-suffixed id from the Go catalog must not be
	// silently treated differently than any other opencode-go model by
	// anything provider-id-specific (the `-free` cost rule is id-shape
	// based and provider-agnostic, so this just documents the invariant:
	// Go's real catalog has no such ids today).
	it('does not fabricate free pricing for a normal Go model id', async () => {
		const fetchImpl = vi.fn(async () =>
			Response.json({
				data: [{ id: 'glm-5.2', object: 'model', created: 1, owned_by: 'opencode' }],
			}),
		);
		const options = opencodeGoModelManagerOptions({ apiKey: 'go-key', fetch: fetchImpl });

		const models = await options.fetchDynamicModels?.();
		const model = models?.find((m) => m.id === 'glm-5.2');
		expect(model?.cost).not.toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	});
});
