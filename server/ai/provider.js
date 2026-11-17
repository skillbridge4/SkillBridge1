export function isProviderEnabled(env = process.env) {
  return env.AI_ENABLED === 'true'
    && Boolean(env.AI_API_KEY?.trim())
    && Boolean(env.AI_MODEL?.trim())
    && ['openai', 'anthropic'].includes(env.AI_PROVIDER);
}

export async function generateStructuredText(prompt, env = process.env, fetchImpl = fetch) {
  if (!isProviderEnabled(env)) throw new Error('AI provider is not configured.');
  const timeout = Math.min(30_000, Math.max(5_000, Number(env.AI_TIMEOUT_MS) || 20_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    if (env.AI_PROVIDER === 'anthropic') {
      return await requestAnthropic(prompt, env, controller.signal, fetchImpl);
    }
    return await requestOpenAI(prompt, env, controller.signal, fetchImpl);
  } catch {
    throw new Error('The AI provider could not complete the request.');
  } finally {
    clearTimeout(timer);
  }
}

async function requestOpenAI(prompt, env, signal, fetchImpl) {
  const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${env.AI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: env.AI_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ]
    })
  });
  if (!response.ok) throw new Error('Provider request failed.');
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Provider response was empty.');
  return content;
}

async function requestAnthropic(prompt, env, signal, fetchImpl) {
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'x-api-key': env.AI_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: env.AI_MODEL,
      max_tokens: 5000,
      temperature: 0.2,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }]
    })
  });
  if (!response.ok) throw new Error('Provider request failed.');
  const data = await response.json();
  const content = data.content?.filter(item => item.type === 'text').map(item => item.text).join('');
  if (typeof content !== 'string' || !content) throw new Error('Provider response was empty.');
  return content;
}
