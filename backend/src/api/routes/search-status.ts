import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { activeSearchBackend, ddgSearch } from '../../scraping/searchEngines.js';

const r = Router();

r.get('/status', authenticate, async (_req, res, next) => {
  try {
    const backend = activeSearchBackend();
    // Live probe with a cheap query
    const results = await ddgSearch('hello world', 3).catch(() => []);
    res.json({
      backend,
      ok: results.length > 0,
      message:
        results.length > 0
          ? `Live search working via ${backend}`
          : backend === 'ddg'
            ? 'DuckDuckGo is currently blocking our requests. Add a free BRAVE_SEARCH_API_KEY for reliable search.'
            : `${backend} configured but returned no results — check your API key`,
      sampleResults: results.slice(0, 3),
    });
  } catch (e) { next(e); }
});

export default r;
