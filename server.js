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

// Health check endpoint (обязательно для Railway)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Vector-M Backend'
  });
});

// Главный endpoint для захвата сигналов
app.post('/api/capture', async (req, res) => {
  try {
    const { intent, intentNote, pageData } = req.body;
    
    // 1. Создаем страницу в Notion
    const notionPage = await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: {
        'Title': {
          title: [{ text: { content: pageData?.title || 'Untitled' } }]
        },
        'Source URL': { url: pageData?.url || 'https://example.com' },
        'Intent': { select: { name: intent || 'Research' } },
        'Intent Note': {
          rich_text: [{ text: { content: intentNote || 'No note provided' } }]
        },
        'Status': { select: { name: 'New' } }
      }
    });

    // 2. Отправляем успешный ответ (AI Summary можно сделать асинхронно)
    res.json({
      success: true,
      pageId: notionPage.id,
      message: 'Signal captured successfully'
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Check your Notion token and database ID'
    });
  }
});

// Порт для Railway
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Vector-M Backend running on port ${PORT}`);
});