// test-full-system.js
const axios = require('axios');

const API_URL = 'https://vector-m-backend-production.up.railway.app';

async function testFullSystem() {
  console.log('🧪 Тестирование полной системы Vector-M\n');
  
  // 1. Проверка health
  console.log('1. Проверка health check...');
  try {
    const health = await axios.get(`${API_URL}/health`);
    console.log(`   ✅ Health: ${health.data.status}`);
  } catch (error) {
    console.log(`   ❌ Health check failed: ${error.message}`);
    return;
  }
  
  // 2. Отправка тестового сигнала
  console.log('\n2. Отправка тестового сигнала...');

  
  
  const testData = {
    intent: 'Thought leadership',
    intentNote: 'Тест полной системы без Make.com',
    pageData: {
      title: 'AI Regulation Trends 2024 - Test',
      url: 'https://example.com/test',
      content: `
      Искусственный интеллект продолжает трансформировать индустрии. 
      Новые регуляции от ЕС требуют большей прозрачности алгоритмов.
      Компании, внедряющие AI, увеличивают продуктивность на 40%.
      
      Ключевые тренды 2024:
      1. Этичный AI и прозрачность
      2. Новые стандарты безопасности данных
      3. Регуляции для генеративного AI
      
      Для DeepGlow: это создает как возможности (дифференциация через этичность),
      так и риски (затраты на compliance).
      `
    }
  };
  
  try {
    const response = await axios.post(`${API_URL}/api/capture`, testData);
    console.log(`   ✅ Сигнал отправлен: ${response.data.message}`);
    console.log(`   📄 Page ID: ${response.data.pageId}`);
    
    const pageId = response.data.pageId;
    
    // 3. Проверка через 60 секунд
    console.log('\n3. Ожидаем 60 секунд для обработки...');
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    // 4. Проверка статуса
    console.log('\n4. Проверка статуса записи...');
    const status = await axios.get(`${API_URL}/api/status/${pageId}`);
    
    console.log('   📋 Статус записи:');
    console.log(`     - Status: ${status.data.status}`);
    console.log(`     - AI Summary: ${status.data.hasAISummary ? '✅ Сгенерирован' : '❌ Нет'}`);
    console.log(`     - Title: ${status.data.title}`);
    console.log(`     - Intent: ${status.data.intent}`);
    
    if (status.data.hasAISummary) {
      console.log('\n🎉 Система работает правильно!');
      console.log('   AI Summary генерируется без Make.com');
    } else {
      console.log('\n⚠️  AI Summary не сгенерирован');
      console.log('   Проверьте логи Railway: railway logs --tail');
    }
    
  } catch (error) {
    console.log(`   ❌ Ошибка: ${error.message}`);
  }
}

testFullSystem();
