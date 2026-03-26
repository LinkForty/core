import { describe, it, expect, vi } from 'vitest';
import { invalidateLinkResolutionCache } from './link-resolution-cache';

describe('invalidateLinkResolutionCache', () => {
  it('no-ops when redis is null', async () => {
    await expect(invalidateLinkResolutionCache(null, 'abc')).resolves.toBeUndefined();
  });

  it('no-ops when redis is undefined', async () => {
    await expect(invalidateLinkResolutionCache(undefined, 'abc')).resolves.toBeUndefined();
  });

  it('deletes legacy key when no templateSlug', async () => {
    const del = vi.fn().mockResolvedValue(1);
    await invalidateLinkResolutionCache({ del } as any, 'abc');
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('link:abc');
  });

  it('deletes both legacy and template keys when templateSlug is provided', async () => {
    const del = vi.fn().mockResolvedValue(2);
    await invalidateLinkResolutionCache({ del } as any, 'abc', 'mytemplate');
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('link:abc', 'link:mytemplate:abc');
  });

  it('skips template key when templateSlug is null', async () => {
    const del = vi.fn().mockResolvedValue(1);
    await invalidateLinkResolutionCache({ del } as any, 'abc', null);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('link:abc');
  });

  it('skips template key when templateSlug is empty string', async () => {
    const del = vi.fn().mockResolvedValue(1);
    await invalidateLinkResolutionCache({ del } as any, 'abc', '');
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('link:abc');
  });

  it('swallows errors from redis.del without throwing', async () => {
    const del = vi.fn().mockRejectedValue(new Error('connection lost'));
    await expect(invalidateLinkResolutionCache({ del } as any, 'abc')).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledTimes(1);
  });
});
