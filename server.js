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

// Main endpoint
app.post('/api/capture', async (req, res) => {
  try {
    const { intent, intentNote, pageData } = req.body;
    
    console.log(`📥 Получен сигнал: ${intent}`);
    
    // СОЗДАЕМ СТРАНИЦУ С ПРАВИЛЬНЫМИ ИМЕНАМИ ПОЛЕЙ
    const notionPage = await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: {
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Vector-M Backend запущен на порту ${PORT}`);
});