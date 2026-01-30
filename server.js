require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client } = require('@notionhq/client');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Реестр промптов Vector-M
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

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Vector-M Backend'
  });
});

// Main endpoint
app.post('/api/capture', async (req, res) => {
  try {
    const { intent, intentNote, pageData } = req.body;
    
    console.log(`📥 Получен сигнал: ${intent}`);
    
    // СОЗДАЕМ СТРАНИЦУ С ПРАВИЛЬНЫМИ ИМЕНАМИ ПОЛЕЙ
    const notionPage = await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: {
        // ВАЖНО: поле называется "Name", а не "Title"
        'Name': {
          title: [{ text: { content: pageData.title || 'Без названия' } }]
        },
        'Source URL': { 
          url: pageData.url || 'https://example.com' 
        },
        'Intent': { 
          select: { name: intent } 
        },
        'Intent Note': {
          rich_text: [{ text: { content: intentNote } }]
        },
        'Status': { 
          select: { name: 'New' } 
        }
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

    console.log(`✅ Страница создана: ${notionPage.id}`);
    
    // Немедленно возвращаем ответ
    res.json({
      success: true,
      pageId: notionPage.id,
      message: 'Signal captured. AI Summary will be generated shortly.'
    });
    
    // Асинхронно обрабатываем AI Summary
    processAIAndUpdateNotion(notionPage.id, intent, pageData.content, pageData.title);
    
  } catch (error) {
    console.error('❌ Ошибка захвата:', error);
    res.status(500).json({ 
      error: error.message
    });
  }
});

// Асинхронная обработка
async function processAIAndUpdateNotion(pageId, intent, content, title) {
  try {
    console.log(`🤖 Генерация AI Summary для ${pageId}...`);
    
    // Генерируем AI Summary
    const aiSummary = await generateAISummary(intent, content);
    console.log(`✅ AI Summary готов (${aiSummary.length} chars)`);
    
    // Определяем Next Best Action и Priority
    const nextBestAction = getNextBestAction(intent);
    const priority = getPriority(intent);
    
    // Обновляем страницу в Notion
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
    
    console.log(`🎉 Страница ${pageId} обновлена`);
    
  } catch (error) {
    console.error(`❌ Ошибка обработки:`, error);
  }
}

// Генерация AI Summary
async function generateAISummary(intent, content) {
  const userPrompt = VECTOR_M_PROMPTS[intent] || VECTOR_M_PROMPTS['Research'];
  
  const completion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { 
        role: "system", 
        content: "Ты CEO технологической компании. Пиши четко, по делу, без лишних слов." 
      },
      { 
        role: "user", 
        content: `${userPrompt}\n\nТЕКСТ:\n${content.substring(0, 5000)}`
      }
    ],
    max_tokens: 600,
    temperature: 0.7
  });
  
  return completion.choices[0].message.content;
}

// Функции определения действий и приоритетов
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

function getPriority(intent) {
  const priorities = {
    'IR/Data room': 'P0',
    'Strategy': 'P1',
    'Product direction': 'P1',
    'Thought leadership': 'P2',
    'Research': 'P2',
    'Competitive landscape': 'P2',
    'BD': 'P2',
    'Conference': 'P3',
    'Share with team': 'P3'
  };
  
  return priorities[intent] || 'P3';
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Vector-M Backend запущен на порту ${PORT}`);
});