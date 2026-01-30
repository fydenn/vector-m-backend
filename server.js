require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client } = require('@notionhq/client');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

// Инициализация клиентов
const notion = new Client({ 
  auth: process.env.NOTION_TOKEN 
});

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY 
});

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


// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Vector-M Backend',
    version: '1.0.0'
  });
});

// Main endpoint для захвата сигналов
// Замените функцию создания страницы на эту:
app.post('/api/capture', async (req, res) => {
  try {
    const { intent, intentNote, pageData } = req.body;
    
    console.log(`📥 Получен сигнал: ${intent}`);
    
    // 1. Получаем структуру базы, чтобы понять типы полей
    const database = await notion.databases.retrieve({
      database_id: process.env.NOTION_DATABASE_ID,
    });
    
    // 2. Определяем тип поля Title
    const titleProperty = database.properties['Title'] || database.properties['Name'];
    const titleType = titleProperty?.type || 'title';
    
    // 3. Создаем страницу с правильным типом поля Title
    const properties = {
      'Source URL': { url: pageData.url || 'https://example.com' },
      'Intent': { select: { name: intent } },
      'Intent Note': {
        rich_text: [{ text: { content: intentNote } }]
      },
      'Status': { select: { name: 'New' } }
    };
    
    // 4. Добавляем Title в зависимости от типа
    if (titleType === 'title') {
      properties['Title'] = {
        title: [{ text: { content: pageData.title || 'Без названия' } }]
      };
    } else {
      properties['Title'] = {
        rich_text: [{ text: { content: pageData.title || 'Без названия' } }]
      };
    }
    
    // 5. Создаем страницу
    const notionPage = await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: properties,
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
    
    // 6. Немедленно возвращаем ответ клиенту
    res.json({
      success: true,
      pageId: notionPage.id,
      message: 'Signal captured. AI Summary will be generated shortly.',
      titleType: titleType // Для отладки
    });
    
    // 7. Асинхронно обрабатываем AI Summary
    processAIAndUpdateNotion(notionPage.id, intent, pageData.content, pageData.title);
    
  } catch (error) {
    console.error('❌ Ошибка захвата:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Check server logs for more information'
    });
  }
});

// Функция создания страницы в Notion
async function createNotionPage(intent, intentNote, pageData) {
  return await notion.pages.create({
    parent: { 
      database_id: process.env.NOTION_DATABASE_ID 
    },
    properties: {
      'Title': {
        title: [
          {
            type: 'text',
            text: { 
              content: pageData.title?.substring(0, 2000) || 'Без названия' 
            }
          }
        ]
      },
      'Source URL': {
        url: pageData.url || 'https://example.com'
      },
      'Intent': {
        select: { 
          name: intent 
        }
      },
      'Intent Note': {
        rich_text: [
          {
            type: 'text',
            text: { 
              content: intentNote.substring(0, 2000) 
            }
          }
        ]
      },
      'Status': {
        select: { 
          name: 'New' 
        }
      }
    },
    children: [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: { 
                content: (pageData.content || 'Контент не захвачен').substring(0, 2000) 
              }
            }
          ]
        }
      }
    ]
  });
}

// Асинхронная генерация AI Summary
async function generateAndUpdateAISummary(pageId, intent, content) {
  try {
    console.log(`🤖 Генерация AI Summary для ${pageId}...`);
    
    const prompt = VECTOR_M_PROMPTS[intent] || VECTOR_M_PROMPTS['Research'];
    const systemPrompt = `Ты — CEO технологической компании DeepGlow. Твой стиль: острый, дальновидный, основанный на данных.`;
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${prompt}\n\nТекст: ${content.substring(0, 4000)}` }
      ],
      max_tokens: 500,
      temperature: 0.7
    });
    
    const aiSummary = completion.choices[0].message.content;
    console.log(`✅ AI Summary сгенерирован (${aiSummary.length} символов)`);
    
    // Обновляем страницу в Notion
    await notion.pages.update({
      page_id: pageId,
      properties: {
        'AI Summary': {
          rich_text: [
            {
              type: 'text',
              text: { content: aiSummary }
            }
          ]
        },
        'Status': {
          select: { name: 'Done' }
        }
      }
    });
    
    console.log(`🎉 Страница ${pageId} обновлена с AI Summary`);
    
  } catch (error) {
    console.error(`❌ Ошибка генерации AI Summary для ${pageId}:`, error.message);
    
    // Обновляем с ошибкой
    try {
      await notion.pages.update({
        page_id: pageId,
        properties: {
          'AI Summary': {
            rich_text: [
              {
                type: 'text',
                text: { 
                  content: `❌ Ошибка генерации: ${error.message.substring(0, 1000)}` 
                }
              }
            ]
          },
          'Status': {
            select: { name: 'Parked' }
          }
        }
      });
    } catch (notionError) {
      console.error('Не удалось записать ошибку в Notion:', notionError);
    }
  }
}

// Test endpoint для проверки Notion connection
app.get('/api/test-notion', async (req, res) => {
  try {
    const database = await notion.databases.retrieve({
      database_id: process.env.NOTION_DATABASE_ID
    });
    
    res.json({
      success: true,
      database: {
        id: database.id,
        title: database.title[0]?.text?.content || 'No title',
        properties: Object.keys(database.properties)
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Notion connection failed',
      details: error.message
    });
  }
});

// Test endpoint для создания тестовой записи
app.post('/api/test-create', async (req, res) => {
  try {
    const testPage = await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: {
        'Title': {
          title: [
            {
              type: 'text',
              text: { content: 'Тестовая запись из API' }
            }
          ]
        },
        'Status': {
          select: { name: 'New' }
        }
      }
    });
    
    res.json({
      success: true,
      message: 'Тестовая запись создана',
      pageId: testPage.id
    });
  } catch (error) {
    res.status(500).json({
      error: 'Test creation failed',
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Vector-M Backend запущен на порту ${PORT}`);
  console.log(`✅ Health check доступен: http://localhost:${PORT}/health`);
  console.log(`📝 API endpoint: http://localhost:${PORT}/api/capture`);
});