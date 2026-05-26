// Deterministic mock LLM. Routes user messages to tools by pattern matching.
// Used when neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is funded.
import { tools, type ToolContext } from './assistant.tools.js';
import type { AgentEvent, ChatMessage } from './assistant.js';

const findTool = (name: string) => tools.find((t) => t.name === name);

interface Intent {
  reply: string;
  toolName?: string;
  toolInput?: any;
  followUp?: string;
}

function classify(text: string): Intent {
  const t = text.toLowerCase().trim();
  const urlMatches = [...text.matchAll(/https?:\/\/[^\s,]+/g)].map((m) => m[0]);
  const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  const targetMatch = text.match(/(\d+)\s*(?:leads?|emails?|contacts?)/i);

  // create_extraction_job
  if ((t.includes('extract') || t.includes('scrape') || t.includes('run a job') || t.includes('crawl')) && urlMatches.length > 0) {
    return {
      reply: `On it — starting an extraction across ${urlMatches.length} URL${urlMatches.length > 1 ? 's' : ''} now.`,
      toolName: 'create_extraction_job',
      toolInput: {
        name: `Chat-initiated · ${new Date().toISOString().slice(0, 16)}`,
        urls: urlMatches,
        target_leads: targetMatch ? Math.min(parseInt(targetMatch[1]!), 200) : 50,
      },
      followUp: "I'll open the job for you — watch progress on that page.",
    };
  }

  // guess_emails — "guess … for Patrick Collison at stripe.com"
  const guessMatch = text.match(/(?:guess|find|what is)\s+(?:the\s+)?email[^a-z]+(?:for\s+)?([A-Z][a-z]+)\s+([A-Z][a-z]+)[^a-z]+(?:at|@|on)\s+([a-z0-9.-]+\.[a-z]{2,})/i);
  if (guessMatch) {
    return {
      reply: `Looking for ${guessMatch[1]} ${guessMatch[2]}'s email at ${guessMatch[3]}…`,
      toolName: 'guess_emails',
      toolInput: { first_name: guessMatch[1], last_name: guessMatch[2], domain: guessMatch[3] },
    };
  }

  // verify_email — "verify foo@bar.com" / "is foo@bar.com valid"
  if (emailMatch && (t.includes('verify') || t.includes('valid') || t.includes('check'))) {
    return {
      reply: `Verifying ${emailMatch[0]} now…`,
      toolName: 'verify_email',
      toolInput: { email: emailMatch[0] },
    };
  }

  // list_recent_jobs
  if (t.includes('my job') || t.includes('show job') || t.includes('list job') || t.includes('recent job') || t.includes('last job')) {
    const limitMatch = text.match(/(?:last|recent|show)\s+(\d+)/i);
    return {
      reply: 'Here are your recent jobs:',
      toolName: 'list_recent_jobs',
      toolInput: { limit: limitMatch ? parseInt(limitMatch[1]!) : 10 },
    };
  }

  // search_leads
  if (t.includes('lead') && (t.includes('search') || t.includes('show') || t.includes('find') || t.includes('list') || t.includes('top') || t.includes('best') || t.includes('highest'))) {
    const limitMatch = text.match(/(?:top|first|show|give me)\s+(\d+)/i);
    const minScoreMatch = text.match(/(?:score|quality)[^0-9]*([0-9]+)/i);
    const valid = t.includes('valid') || t.includes('verified');
    const countryMatch = text.match(/\bin\s+(US|UK|CA|DE|FR|AU|JP|UAE|IN)\b/i);
    return {
      reply: 'Searching your leads…',
      toolName: 'search_leads',
      toolInput: {
        limit: limitMatch ? parseInt(limitMatch[1]!) : 20,
        ...(minScoreMatch && { min_quality_score: parseInt(minScoreMatch[1]!) }),
        ...(valid && { verification_status: 'VALID' }),
        ...(countryMatch && { country: countryMatch[1]!.toUpperCase() }),
      },
    };
  }

  // create_export — "export ... as CSV/XLSX/JSON"
  const exportFormat = t.match(/export.*\b(csv|xlsx|json)\b/i)?.[1]?.toUpperCase();
  const jobIdMatch = text.match(/\b(cmpi[a-z0-9]+)\b/);
  if (exportFormat || (t.includes('export') && jobIdMatch)) {
    return {
      reply: `Queuing ${exportFormat ?? 'CSV'} export${jobIdMatch ? ` for job ${jobIdMatch[1]!.slice(-8)}` : ''}.`,
      toolName: 'create_export',
      toolInput: { format: exportFormat ?? 'CSV', ...(jobIdMatch && { job_id: jobIdMatch[1] }) },
    };
  }

  // push_to_hubspot — "push to hubspot", "sync job X to hubspot"
  if (t.includes('hubspot') && (t.includes('push') || t.includes('sync') || t.includes('send'))) {
    const jobIdMatch = text.match(/\b(cmpi[a-z0-9]+)\b/);
    return {
      reply: `Pushing leads to HubSpot${jobIdMatch ? ` from job ${jobIdMatch[1]!.slice(-8)}` : ''}.`,
      toolName: 'push_to_hubspot',
      toolInput: jobIdMatch ? { job_id: jobIdMatch[1] } : {},
    };
  }

  // web_search — "search for X", "find sites about Y"
  if ((t.startsWith('search') || t.startsWith('find ') || t.startsWith('look up')) && !t.includes('lead')) {
    const q = text.replace(/^(search( for)?|find|look up)\s*/i, '').trim();
    if (q.length > 2) {
      return { reply: `Searching for "${q}"…`, toolName: 'web_search', toolInput: { query: q, limit: 10 } };
    }
  }

  // write_cold_email — "write an email to lead X about Y"
  const writeMatch = text.match(/(?:write|draft).*email.*(?:to|for).*(cmphj?[a-z0-9]+)/i);
  if (writeMatch) {
    return {
      reply: 'Drafting a cold email…',
      toolName: 'write_cold_email',
      toolInput: { lead_id: writeMatch[1], goal: 'book a 15-minute intro call', tone: 'professional' },
    };
  }

  // generate_icebreaker
  const iceMatch = text.match(/(?:icebreaker|opener|opening line).*(cmphj?[a-z0-9]+)/i);
  if (iceMatch) {
    return {
      reply: 'Generating icebreaker options…',
      toolName: 'generate_icebreaker',
      toolInput: { lead_id: iceMatch[1] },
    };
  }

  // add_leads_to_list
  const listNameMatch = text.match(/add.*to (?:list |the )?["']?([\w\s\-]+?)["']?$/i);
  if (listNameMatch && t.includes('list')) {
    return {
      reply: `Head to the Leads page, select the ones you want, and use the "Add to list" action — easiest way to do this.`,
    };
  }

  // get_team_usage
  if (t.includes('credit') || t.includes('usage') || t.includes('balance') || t.includes('plan') || t.includes('how many')) {
    return { reply: 'Here\'s your team\'s usage:', toolName: 'get_team_usage', toolInput: {} };
  }

  // Fallback: short, conversational, never leak tool names or false claims.
  return {
    reply:
      "Could you tell me a little more? For example, are you looking for new leads, want to verify an email, check a campaign, or draft outreach? Once I know what you're working on, I can take it from there.",
  };
}

export async function runMockAgent(
  history: ChatMessage[],
  ctx: ToolContext,
  onEvent: (e: AgentEvent) => void | Promise<void>,
): Promise<void> {
  // Extract last user message
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  if (!lastUser) {
    await onEvent({ type: 'text', data: 'No user message.' });
    await onEvent({ type: 'done', data: null });
    return;
  }
  const userText =
    typeof lastUser.content === 'string'
      ? lastUser.content
      : (lastUser.content as any[]).filter((c: any) => c.type === 'text').map((c: any) => c.text).join(' ');

  const intent = classify(userText);
  await onEvent({ type: 'text', data: intent.reply });

  if (intent.toolName) {
    const tool = findTool(intent.toolName);
    if (!tool) {
      await onEvent({ type: 'error', data: `Tool ${intent.toolName} not found` });
      await onEvent({ type: 'done', data: null });
      return;
    }
    const id = `mock_${Date.now()}`;
    await onEvent({ type: 'tool_use', data: { id, name: tool.name, input: intent.toolInput } });
    try {
      const result = await tool.handler(intent.toolInput, ctx);
      await onEvent({ type: 'tool_result', data: { id, name: tool.name, ok: true, result } });
    } catch (err) {
      const msg = (err as Error).message ?? 'Tool error';
      await onEvent({ type: 'tool_result', data: { id, name: tool.name, ok: false, error: msg } });
    }
  }

  if (intent.followUp) await onEvent({ type: 'text', data: intent.followUp });
  await onEvent({ type: 'done', data: null });
}
