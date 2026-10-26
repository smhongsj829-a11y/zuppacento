// Vercel serverless function: reads a receipt photo with Claude and returns JSON.
// Needs the ANTHROPIC_API_KEY environment variable (Vercel → Project → Settings → Environment Variables).

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const PROMPT = "이 사진은 일본 매장에서 면세(Tax-Free) 구매 후 받은 결제 영수증(レシート)입니다. 영수증을 읽어 아래 JSON 하나만 답하세요. 다른 문장은 쓰지 마세요.\n\n{\"store\":\"매장명(영수증 표기 그대로, 지점명 포함)\",\"date\":\"YYYY-MM-DD 또는 null\",\"items\":[{\"name\":\"품목명 원문\",\"nameKo\":\"한국어로 짧게 무엇인지(예: 눈 피로 안약)\",\"price\":세금포함 줄금액(정수, 수량 반영),\"rate\":10 또는 8,\"bag\":\"checked\" 또는 \"cabin\"}],\"printedTotal\":영수증의 합계 정수 또는 null,\"printedTax\":영수증에 찍힌 소비세 합계 정수 또는 null,\"taxFreeMarked\":영수증에 免税/Tax-Free/輸出免税 표시가 있으면 true,\"note\":\"읽기 어려웠던 부분이 있으면 한국어 한 줄, 없으면 빈 문자열\"}\n\n규칙:\n- price는 항상 세금 포함 금액입니다. 영수증이 세전가(外税/税抜)로 찍혀 있으면 세율을 더해 세금 포함으로 바꾸세요.\n- 할인·쿠폰 줄은 해당 품목 금액에서 빼고 별도 품목으로 넣지 마세요.\n- ※, *, 軽, 軽減 표시가 붙은 품목이나 식품·무알코올 음료는 rate 8, 술·화장품·의약품·잡화 등은 rate 10.\n- 결제수단, 거스름돈, 포인트, 소계 줄은 품목에 넣지 마세요.\n- bag은 넣을 가방 추천입니다. 보조배터리·리튬배터리 제품, 깨지기 쉬운 고가 전자기기·시계·귀금속은 \"cabin\", 100ml 넘는 액체·젤·스프레이(술, 화장수, 샴푸, 선크림 등)와 부피 큰 물건은 \"checked\", 나머지 작은 물건은 \"checked\".\n- 날짜가 연도 없이 보이면 2026년으로 가정하세요.";

function extractJson(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch (e) {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch (e) {} }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ code: 'method_not_allowed' }); }
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ code: 'not_configured', message: 'ANTHROPIC_API_KEY is not set' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const image = body.image;
  const mediaType = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(body.mediaType) ? body.mediaType : 'image/jpeg';
  if (typeof image !== 'string' || image.length < 100 || image.length > 6_000_000) return res.status(400).json({ code: 'image_rejected' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: PROMPT }
        ] }]
      })
    });
    if (r.status === 429) return res.status(429).json({ code: 'rate_limited' });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ code: 'upstream_error', message: j && j.error && j.error.message });
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const data = extractJson(text);
    if (!data) return res.status(422).json({ code: 'invalid_json' });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ code: 'upstream_error' });
  }
}
