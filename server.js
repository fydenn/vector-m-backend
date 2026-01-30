require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client } = require('@notionhq/client');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

const notion = new Client({ auth: process.env.NOTION_TOKEN });
function createOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || 'https://api.vsegpt.ru/v1';
  const model = process.env.OPENAI_MODEL || 'gpt-4';
  
  console.log(`🤖 OpenAI Config: ${baseURL}, Model: ${model}`);
  
  return new OpenAI({
    apiKey: apiKey,
    baseURL: baseURL,
    defaultHeaders: {
      'Authorization': `Bearer ${apiKey}`
    },
    timeout: 30000 // 30 секунд timeout
  });
}

const openai = createOpenAIClient();

const VECTOR_M_PROMPTS = {
  'Thought leadership': `Extract 1-2 sharp, contrarian insights that could be turned into a short thought leadership post. Highlight tensions, reframing opportunities, or challenged assumptions. Avoid fluff. Write in a confident, clear voice suitable for a public post.`,
  
  'Research': `Summarize the core insight in 5-7 bullets. Extract key data points and note any implications, risks, or opportunities for DeepGlow. Explain what's new or non-obvious and why it matters in the context of AI-native, technology-driven markets.`,
  
  'IR/Data room': `Highlight key points for investors, financial implications, and potential impact on company valuation. Focus on data, metrics, and trends that matter for investment decisions.`,
  
  'Share with team': `Summarize the main ideas that are important to communicate to the team. Highlight practical takeaways, actions, and context for different departments.`,
  
  'Product direction': `Analyze how this information impacts product development. Identify trends, opportunities, and threats for product strategy. Focus on actionable insights for roadmap planning.`,
  
  'Competitive landscape': `Identify what this suggests about competitors, substitutes, or emerging threats. Focus on strategic signals, positioning shifts, and market direction—not feature lists.`,
  
  'BD': `Highlight partnership, channel, or ecosystem implications. Identify who might care, why, and how this could impact GTM motion or open new avenues.`,
  
  'Conference': `Summarize conference themes, relevance to DeepGlow, who should attend and why, and potential high-impact meetings. Include dates, location, and key speakers if available.`,
  
  'Strategy': `Summarize the core insight in 5-7 bullets. Explain why it matters for DeepGlow's strategy, what's new or non-obvious, and how it impacts market structure or long-term positioning.`
};

const SYSTEM_PROMPT = `You are the CEO of a technology company. Your writing style: sharp, visionary, sophisticated, grounded in data and reality. Optimize all responses for fast executive scanning. Always focus on implications and actions for DeepGlow.`;

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Vector-M Backend'
  });
});



function splitContentIntoBlocks(content, maxBlockSize = 2000) {
  const blocks = [];
  let currentIndex = 0;
  
  while (currentIndex < content.length) {
    let blockEnd = currentIndex + maxBlockSize;
    
    // Стараемся не разрывать слова и предложения
    if (blockEnd < content.length) {
      // Ищем ближайший разрыв строки или точку
      const nextNewline = content.indexOf('\n', blockEnd - 100);
      const nextPeriod = content.indexOf('. ', blockEnd - 100);
      const nextSpace = content.indexOf(' ', blockEnd - 50);
      
      if (nextNewline > currentIndex && nextNewline < currentIndex + maxBlockSize + 100) {
        blockEnd = nextNewline + 1;
      } else if (nextPeriod > currentIndex && nextPeriod < currentIndex + maxBlockSize + 100) {
        blockEnd = nextPeriod + 1;
      } else if (nextSpace > currentIndex && nextSpace < currentIndex + maxBlockSize + 50) {
        blockEnd = nextSpace + 1;
      }
    }
    
    const blockContent = content.substring(currentIndex, Math.min(blockEnd, content.length));
    
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: blockContent }
        }]
      }
    });
    
    currentIndex = blockEnd;
  }
  
  return blocks;
}

// Main endpoint
app.post('/api/capture', async (req, res) => {
  try {
    const { intent, intentNote, pageData } = req.body;
    
    console.log(`📥 Получен сигнал: ${intent}, длина контента: ${pageData.content?.length || 0}`);
    
    // Ограничиваем общую длину контента (например, 10000 символов)
    const maxContentLength = 10000;
    let content = pageData.content || '';
    
    if (content.length > maxContentLength) {
      console.log(`⚠️ Контент сокращен с ${content.length} до ${maxContentLength} символов`);
      
      // Умное сокращение - ищем последнее предложение до лимита
      const lastSentenceEnd = content.lastIndexOf('. ', maxContentLength - 100);
      const lastParagraphEnd = content.lastIndexOf('\n\n', maxContentLength - 100);
      const cutPoint = Math.max(lastSentenceEnd, lastParagraphEnd, maxContentLength);
      
      content = content.substring(0, cutPoint) + 
        `\n\n[📝 Контент сокращен. Полный текст: ${pageData.url}]`;
    }
    
    // Разбиваем контент на блоки
    const contentBlocks = splitContentIntoBlocks(content);
    
    // Создаем страницу в Notion
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
        'Status': { select: { name: 'New' } },
        'Content Length': {
          number: content.length
        }
      },
      children: [
        // Добавляем мета-информацию как отдельный блок
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { 
                content: `📄 Ссылка: ${pageData.url}\n\n📊 Длина оригинала: ${pageData.fullLength || content.length} символов\n📝 Длина в базе: ${content.length} символов\n\n---\n`
              }
            }]
          }
        },
        // Добавляем все блоки с контентом
        ...contentBlocks
      ]
    });

    console.log(`✅ Страница создана: ${notionPage.id}, блоков: ${contentBlocks.length + 1}`);
    
    // Немедленно возвращаем ответ
    res.json({
      success: true,
      pageId: notionPage.id,
      message: 'Signal captured',
      blocksCount: contentBlocks.length,
      contentLength: content.length
    });
    
    // Асинхронно обрабатываем AI Summary
    processAIAndUpdateNotion(notionPage.id, intent, content, pageData.title);
    
  } catch (error) {
    console.error('❌ Ошибка захвата:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Check server logs for more information'
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
        content: `${userPrompt}\n\nTEXT TO ANALYZE:\n${content.substring(0, 8000)}`
      }
    ],
    max_tokens: 800,
    temperature: 0.7
  });
  
  return completion.choices[0].message.content;
}

function getNextBestAction(intent) {
  const actions = {
    'Thought leadership': 'Draft LinkedIn/blog post',
    'Research': 'Share with research team',
    'IR/Data room': 'Update investor materials',
    'Share with team': 'Distribute to relevant teams',
    'Product direction': 'Discuss in product meeting',
    'Competitive landscape': 'Update competitor analysis',
    'BD': 'Research partnership opportunities',
    'Conference': 'Plan attendance/speaking',
    'Strategy': 'Include in strategic discussion'
  };
  
  return actions[intent] || 'Review at next meeting';
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

// 🔍 Эндпоинт для проверки статуса страницы
app.get('/api/status/:pageId', async (req, res) => {
  try {
    const { pageId } = req.params;
    console.log(`🔍 Запрос статуса для страницы: ${pageId}`);
    
    // Получаем страницу из Notion
    const page = await notion.pages.retrieve({ page_id: pageId });
    
    // Извлекаем свойства
    const status = page.properties.Status?.select?.name || 'Unknown';
    const aiSummary = page.properties['AI Summary']?.rich_text?.[0]?.text?.content || '';
    const title = page.properties.Title?.title?.[0]?.plain_text || 'Без названия';
    const intent = page.properties.Intent?.select?.name || 'Unknown';
    
    res.json({
      success: true,
      pageId,
      status,
      hasAISummary: !!aiSummary,
      aiSummaryLength: aiSummary.length,
      title,
      intent,
      lastEdited: page.last_edited_time
    });
    
  } catch (error) {
    console.error(`❌ Ошибка получения статуса: ${error.message}`);
    
    // Проверяем тип ошибки
    if (error.message.includes('Could not find page with ID')) {
      res.status(404).json({
        success: false,
        error: 'Page not found',
        message: 'Запись не найдена в Notion. Убедитесь, что pageId корректен.'
      });
    } else if (error.message.includes('API token is invalid')) {
      res.status(401).json({
        success: false,
        error: 'Notion token invalid',
        message: 'Неверный Notion токен. Проверьте переменную NOTION_TOKEN.'
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Ошибка при запросе статуса'
      });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Vector-M Backend запущен на порту ${PORT}`);
});