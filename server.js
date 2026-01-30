// server.js (минимальная версия)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client } = require('@notionhq/client');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

// Инициализация клиентов
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VECTOR_M_PROMPTS = {
  'Thought leadership': `Извлеки 1-2 точных, контринтуитивных инсайта, которые можно превратить в короткий пост для экспертного позиционирования. Подчеркни противоречия, возможности для переосмысления или оспариваемые предположения. Избегай "воды". Пиши уверенным, ясным языком, подходящим для публичного поста.`,
  
  'Research': `Обобщи основную мысль в 5-7 пунктах. Выдели ключевые данные и отметь любые последствия, риски или возможности для DeepGlow. Объясни, что нового или неочевидного и почему это важно в контексте нативных для ИИ технологий.`,
  
  'IR/Data room': `Выдели ключевые моменты для инвесторов, финансовые импликации и потенциальное влияние на оценку компании. Акцентируй внимание на данных, метриках и трендах.`,
  
  'Share with team': `Обобщи основные идеи, которые важно донести команде. Выдели практические выводы, действия и контекст для разных отделов.`,
  
  'Product direction': `Проанализируй, как эта информация влияет на развитие продукта. Выдели тренды, возможности и угрозы для продуктовой стратегии.`,
  
  'Competitive landscape': `Выдели, что это говорит о конкурентах, заменителях или возникающих угрозах. Сосредоточься на стратегических сигналах, сдвигах в позиционировании и направлении рынка — не на списках функций.`,
  
  'BD': `Подчеркни последствия для партнёрств, каналов или экосистемы. Определи, кому это может быть важно, почему и как это может повлиять на стратегию выхода на рынок или открыть новые возможности.`,
  
  'Conference': `Обобщи темы конференции, актуальность для DeepGlow, кто должен посетить и почему, а также потенциальные высокоэффективные встречи. Включи даты, место и ключевых спикеров.`,
  
  'Strategy': `Обобщи основную мысль в 5-7 пунктах. Объясни, почему это важно для стратегии DeepGlow, что нового или неочевидного и как это влияет на структуру рынка или долгосрочное позиционирование.`
};

const SYSTEM_PROMPT = `Ты — CEO технологической компании DeepGlow. Твой стиль письма: острый, дальновидный, изощрённый, основанный на данных и реальности. Ты оптимизируешь все ответы для быстрого чтения руководителем. Фокус всегда на последствиях и действиях для DeepGlow.`;

// Health check endpoint (обязательно для Railway)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Vector-M Backend'
  });
});

// main endpoint
app.post('/api/capture', async (req, res) => {
  try {
    const { intent, intentNote, pageData } = req.body;
    
    console.log(`📥 Signal: ${intent}`);

    // 1. Create page in Notion
    const notionPage = await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: {
        'Title': {
          title: [{ text: { content: pageData.title || 'Без названия' } }]
        },
        'Source URL': { url: pageData.url || 'https://example.com' },
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
              text: { content: pageData.content || 'Контент не захвачен' }
            }]
          }
        }
      ]
    });

    console.log(`✅ The Page is created: ${notionPage.id}`);

    // 2. Отправляем успешный ответ (AI Summary можно сделать асинхронно)
    res.json({
      success: true,
      pageId: notionPage.id,
      message: 'Signal captured. AI Summary will be generated shortly.'
    });
    
  } catch (error) {
    console.error('❌ carch error:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Check server logs for more information'
    });
  }
});

// Async func for processing AI и updating Notion
async function processAIAndUpdateNotion(pageId, intent, content, title) {
  try {
    console.log(`🤖 start generation AI Summary for ${pageId}...`);
    
    // 1. Генерируем AI Summary
    const aiSummary = await generateAISummary(intent, content);
    console.log(`✅ AI Summary generated (${aiSummary.length} chars)`);
    
    // 2. Определяем Next Best Action и Priority
    const nextBestAction = getNextBestAction(intent);
    const priority = getPriority(intent);
    
    // 3. Обновляем страницу в Notion
    await notion.pages.update({
      page_id: pageId,
      properties: {
        'AI Summary': {
          rich_text: [{ text: { content: aiSummary } }]
        },
        'Status': { select: { name: 'Done' } },
        'Next Best Action': { 
          rich_text: [{ text: { content: nextBestAction } }] 
        },
        'Priority': { select: { name: priority } }
      }
    });
    
    console.log(`🎉 Page ${pageId} updated in Notion`);
    
    // 4. Отправляем уведомление в Slack если P0/P1
    if (priority === 'P0 — Critical' || priority === 'P1 — High') {
      await sendSlackNotification(title, intent, priority, nextBestAction, pageId);
    }
    
  } catch (error) {
    console.error(`❌ Ошибка обработки страницы ${pageId}:`, error);
    
    // Обновляем статус на ошибку
    try {
      await notion.pages.update({
        page_id: pageId,
        properties: {
          'Status': { select: { name: 'Parked' } },
          'AI Summary': {
            rich_text: [{ 
              text: { 
                content: `❌ Ошибка генерации AI Summary: ${error.message}` 
              } 
            }]
          }
        }
      });
    } catch (notionError) {
      console.error('Не удалось обновить статус ошибки в Notion:', notionError);
    }
  }
}

// Функция генерации AI Summary
async function generateAISummary(intent, content) {
  const userPrompt = VECTOR_M_PROMPTS[intent] || VECTOR_M_PROMPTS['Research'];
  
  const completion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { 
        role: "system", 
        content: SYSTEM_PROMPT 
      },
      { 
        role: "user", 
        content: `${userPrompt}\n\nТЕКСТ ДЛЯ АНАЛИЗА:\n${content.substring(0, 8000)}` // Ограничение токенов
      }
    ],
    max_tokens: 800,
    temperature: 0.7
  });
  
  return completion.choices[0].message.content;
}

// Функция определения Next Best Action
function getNextBestAction(intent) {
  const actions = {
    'Thought leadership': 'Написать пост для LinkedIn/блога',
    'Research': 'Поделиться с командой исследований',
    'IR/Data room': 'Обновить материалы для инвесторов',
    'Share with team': 'Распространить команде',
    'Product direction': 'Обсудить на продуктовой встрече',
    'Competitive landscape': 'Обновить анализ конкурентов',
    'BD': 'Исследовать возможности партнёрства',
    'Conference': 'Запланировать участие/доклад',
    'Strategy': 'Включить в стратегическое обсуждение'
  };
  
  return actions[intent] || 'Рассмотреть на ближайшей встрече';
}

// Функция определения приоритета
function getPriority(intent) {
  const priorities = {
    'IR/Data room': 'P0 — Critical',
    'Strategy': 'P1 — High',
    'Product direction': 'P1 — High',
    'Thought leadership': 'P2 — Medium',
    'Research': 'P2 — Medium',
    'Competitive landscape': 'P2 — Medium',
    'BD': 'P2 — Medium',
    'Conference': 'P3 — Low',
    'Share with team': 'P3 — Low'
  };
  
  return priorities[intent] || 'P3 — Low';
}

// Функция отправки уведомлений в Slack
async function sendSlackNotification(title, intent, priority, action, pageId) {
  if (!process.env.SLACK_WEBHOOK_URL) {
    console.log('⚠️ Slack webhook не настроен, пропускаем уведомление');
    return;
  }
  
  try {
    const axios = require('axios');
    
    const message = {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚨 Новый сигнал в Vector-M',
            emoji: true
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Приоритет:*\n${priority}`
            },
            {
              type: 'mrkdwn',
              text: `*Тип:*\n${intent}`
            }
          ]
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${title}*`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Действие:* ${action}`
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '📖 Открыть в Notion',
                emoji: true
              },
              url: `https://notion.so/${pageId.replace(/-/g, '')}`
            }
          ]
        }
      ]
    };
    
    await axios.post(process.env.SLACK_WEBHOOK_URL, message);
    console.log(`✅ Уведомление отправлено в Slack`);
    
  } catch (error) {
    console.error('❌ Ошибка отправки в Slack:', error.message);
  }
}

// Endpoint для ручной генерации AI Summary (на случай проблем)
app.post('/api/regenerate-ai/:pageId', async (req, res) => {
  try {
    const { pageId } = req.params;
    
    // Получаем страницу из Notion
    const page = await notion.pages.retrieve({ page_id: pageId });
    const blocks = await notion.blocks.children.list({ block_id: pageId });
    
    // Извлекаем контент и intent
    const intent = page.properties.Intent?.select?.name;
    let content = '';
    
    blocks.results.forEach(block => {
      if (block.type === 'paragraph' && block.paragraph?.rich_text?.[0]?.text?.content) {
        content += block.paragraph.rich_text[0].text.content + '\n';
      }
    });
    
    if (!intent || !content) {
      return res.status(400).json({ error: 'Не удалось извлечь данные из страницы' });
    }
    
    // Генерируем новый AI Summary
    const aiSummary = await generateAISummary(intent, content);
    
    // Обновляем страницу
    await notion.pages.update({
      page_id: pageId,
      properties: {
        'AI Summary': {
          rich_text: [{ text: { content: aiSummary } }]
        }
      }
    });
    
    res.json({ success: true, aiSummary });
    
  } catch (error) {
    console.error('Ошибка регенерации:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint для проверки статуса страницы
app.get('/api/status/:pageId', async (req, res) => {
  try {
    const page = await notion.pages.retrieve({ page_id: req.params.pageId });
    
    res.json({
      status: page.properties.Status?.select?.name,
      hasAISummary: !!page.properties['AI Summary']?.rich_text?.[0]?.text?.content,
      title: page.properties.Title?.title?.[0]?.text?.content,
      intent: page.properties.Intent?.select?.name
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Старт сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Vector-M Backend запущен на порту ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});
