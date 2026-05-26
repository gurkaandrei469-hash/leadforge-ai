import axios from 'axios';
import robotsParser from 'robots-parser';
import * as cheerio from 'cheerio';

const UA = 'Mozilla/5.0 (compatible; LeadForgeBot/1.0; +https://leadforge.ai/bot)';
const robotsCache = new Map<string, ReturnType<typeof robotsParser>>();

export interface ScrapedPage {
  url: string;
  title: string;
  html: string;
  text: string;
  $: cheerio.CheerioAPI;
}

async function isAllowed(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    const robotsUrl = `${u.origin}/robots.txt`;
    let parser = robotsCache.get(u.origin);
    if (!parser) {
      const resp = await axios.get(robotsUrl, { timeout: 5000, validateStatus: () => true });
      parser = robotsParser(robotsUrl, resp.status === 200 ? resp.data : '');
      robotsCache.set(u.origin, parser);
    }
    return parser.isAllowed(url, UA) !== false;
  } catch {
    return true;
  }
}

export async function scrapePage(url: string): Promise<ScrapedPage> {
  if (!(await isAllowed(url))) throw new Error('robots_disallow');

  const res = await axios.get(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
    timeout: 15_000,
    validateStatus: (s) => s < 400,
    maxContentLength: 5_000_000,
  });
  const html = String(res.data);
  const $ = cheerio.load(html);
  return {
    url,
    title: $('title').first().text().trim(),
    html,
    text: $('body').text().replace(/\s+/g, ' ').trim(),
    $,
  };
}
