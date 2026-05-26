// One-off: prove our DDG client actually returns real results
import { ddgSearch, findLinkedInProfile } from '../src/scraping/searchEngines.js';

async function main() {
  console.log('--- 1. Generic search: "stripe.com careers" ---');
  const r1 = await ddgSearch('stripe.com careers', 5);
  for (const r of r1) console.log(`  ${r.url}\n    ${r.title.slice(0, 80)}`);

  console.log('\n--- 2. Site-scoped: SaaS founders email contact ---');
  const r2 = await ddgSearch('SaaS founder team contact email', 5);
  for (const r of r2) console.log(`  ${r.url}\n    ${r.title.slice(0, 80)}`);

  console.log('\n--- 3. LinkedIn URL discovery: "Patrick Collison" at stripe ---');
  const li = await findLinkedInProfile('Patrick Collison', 'Stripe');
  console.log('  →', li ?? '(not found)');

  console.log('\n--- 4. LinkedIn URL discovery: "Tobias Lutke" at shopify ---');
  const li2 = await findLinkedInProfile('Tobias Lütke', 'Shopify');
  console.log('  →', li2 ?? '(not found)');

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
