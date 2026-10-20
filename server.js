// خادم امتحاني AI — Node.js 20+
// لا تضع مفتاح API داخل HTML. استخدم متغيرات البيئة فقط.
import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '12kb' }));

// سقف مبدئي للمنصة كلها: 30 طلبًا في 24 ساعة، بالإضافة إلى حماية قصيرة المدى.
// التخزين هنا في الذاكرة؛ عند إعادة تشغيل الخادم يبدأ العد من جديد، لذلك يلزم تخزين دائم قبل النشر العام.
const dailyLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'وصلت المنصة إلى حدّها اليومي التجريبي (30 طلبًا). جرّب غدًا.' }
});
const shortLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'طلبات كثيرة خلال دقيقة واحدة. انتظر قليلًا ثم حاول مجددًا.' }
});

const API_KEY = process.env.OPENROUTER_API_KEY || '';
const DEFAULT_FREE_MODELS = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'google/gemma-4-26b-a4b-it:free',
  'openai/gpt-oss-20b:free'
];
const FREE_MODELS = (process.env.OPENROUTER_FREE_MODELS || DEFAULT_FREE_MODELS.join(','))
  .split(',').map(x => x.trim()).filter(Boolean);
// Fail closed: do not send requests if any configured model is not explicitly marked free.
const FREE_ONLY = FREE_MODELS.length > 0 && FREE_MODELS.every(id => id.endsWith(':free'));

app.get('/api/health', (_req, res) => {
  res.json({ service: 'imtihani-ai', configured: Boolean(API_KEY && FREE_ONLY), freeModelsConfigured: FREE_ONLY ? FREE_MODELS.length : 0 });
});

app.post('/api/tutor', shortLimit, dailyLimit, async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'اكتب سؤالك أولًا.' });
  if (text.length > 10000) return res.status(413).json({ error: 'النص طويل جدًا؛ اختصره إلى 10000 حرف.' });
  if (!API_KEY) return res.status(503).json({ error: 'الذكاء غير مفعّل بعد: أضف مفتاح OpenRouter إلى إعدادات الخادم فقط.' });
  if (!FREE_ONLY) return res.status(503).json({ error: 'إعدادات النماذج غير آمنة. كل نموذج يجب أن ينتهي معرّفه بـ :free. لم يُرسل الطلب.' });

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'X-OpenRouter-Title': 'Imtihani AI'
      },
      body: JSON.stringify({
        models: FREE_MODELS,
        route: 'fallback',
        messages: [
          { role: 'system', content: 'أنت معلم مساعد للطلاب. أجب بالعربية الواضحة، واشرح خطوة بخطوة عند الحاجة. عند شرح مسألة، وضّح الفكرة ثم الحل ثم تحققًا مختصرًا. لا تخترع معلومات من كتاب لم يرسله الطالب. إذا لم تعرف الإجابة فقل ذلك بوضوح.' },
          { role: 'user', content: text }
        ],
        max_tokens: 650,
        temperature: 0.4
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const status = response.status === 429 ? 429 : 502;
      return res.status(status).json({
        error: response.status === 429
          ? 'الحصة المجانية أو حد الطلبات ممتلئ مؤقتًا. لم يتم التحويل إلى نموذج مدفوع؛ جرّب لاحقًا.'
          : 'تعذّر على النماذج المجانية الإجابة الآن. لم يتم التحويل إلى نموذج مدفوع.'
      });
    }
    const answer = data?.choices?.[0]?.message?.content;
    if (!answer) return res.status(502).json({ error: 'لم يرجع النموذج إجابة نصية.' });
    return res.json({ answer, model: data.model || 'free-model' });
  } catch {
    return res.status(502).json({ error: 'تعذّر الاتصال بمزوّد الذكاء الاصطناعي.' });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Imtihani AI server listening on ${port}`));
