require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client } = require('@notionhq/client');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

// Инициализация клиентов
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Реестр промптов (из документации Vector-M)
const PROMPTS = {
  'Thought leadership': `Извлеки 1-2 точных, контринтуитивных инсайта, которые можно превратить в короткий пост. Подчеркни противоречия, возможности для переосмысления. Пиши уверенным, ясным языком.`,
  'Research': `Обобщи основную мысль в 5-7 пунктах. Выдели ключевые данные и последствия.`,
  'IR/Data room': `Выдели ключевые моменты для инвесторов, финансовые импликации.`,
  'Strategy': `Проанализируй стратегические последствия и влияние на рынок.`,
};

// Endpoint для захвата из браузера
app.post('/api/capture', async (req, res) => {
  try {
    const { intent, intentNote, pageData } = req.body;
    
    // 1. Создаем страницу в Notion
    const notionPage = await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: {
        'Title': {
          title: [{ text: { content: pageData.title || 'Untitled' } }]
        },
        'Source URL': { url: pageData.url },
        'Intent': { select: { name: intent } },
        'Intent Note': {
          rich_text: [{ text: { content: intentNote } }]
        },
        'Status': { select: { name: 'New' } }
      },
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              text: { content: pageData.content || 'No content captured' }
            }]
          }
        }
      ]
    });

    // 2. Генерируем AI Summary
    const aiPrompt = PROMPTS[intent] || PROMPTS['Research'];
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "Ты аналитик компании DeepGlow." },
        { role: "user", content: `${aiPrompt}\n\nТекст: ${pageData.content}` }
      ],
      max_tokens: 500
    });

    const aiSummary = completion.choices[0].message.content;

    // 3. Обновляем страницу с AI Summary
    await notion.pages.update({
      page_id: notionPage.id,
      properties: {
        'AI Summary': {
          rich_text: [{ text: { content: aiSummary } }]
        },
        'Status': { select: { name: 'Done' } }
      }
    });

    // 4. Определяем Next Best Action и Priority
    const nextAction = getNextBestAction(intent);
    const priority = getPriority(intent);
    
    await notion.pages.update({
      page_id: notionPage.id,
      properties: {
        'Next Best Action': { rich_text: [{ text: { content: nextAction } }] },
        'Priority': { select: { name: priority } }
      }
    });

    res.json({
      success: true,
      pageId: notionPage.id,
      message: 'Signal captured and processed'
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

function getNextBestAction(intent) {
  const actions = {
    'Thought leadership': 'Draft post',
    'Research': 'Share with research team',
    'IR/Data room': 'Extract investor insights',
    'Strategy': 'Schedule strategy review',
    'Product direction': 'Update product roadmap',
    'Competitive landscape': 'Update competitor analysis',
    'BD': 'Identify partnership opportunity',
    'Conference': 'Plan attendance/speaking',
    'Share with team': 'Distribute to relevant teams'
  };
  return actions[intent] || 'Review and decide';
}

function getPriority(intent) {
  const priorities = {
    'Thought leadership': 'P2 — Medium',
    'Research': 'P2 — Medium',
    'IR/Data room': 'P1 — High',
    'Strategy': 'P0 — Critical',
    'Product direction': 'P1 — High'
  };
  return priorities[intent] || 'P3 — Low';
}

// Endpoint для вебхуков от Make.com
app.post('/api/webhook/make', async (req, res) => {
  // Обработка вебхуков для автоматизаций
  res.json({ received: true });
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Vector-M Backend',
    version: '1.0.0'
  });
});

app.post('/api/backup/notion', async (req, res) => {
  try {
    const response = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID,
    });
    
    const backupData = {
      timestamp: new Date().toISOString(),
      count: response.results.length,
      data: response.results
    };
    
    // Сохранить в Railway Storage
    // Или отправить в S3/GCS
    res.json({ success: true, backup: backupData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});